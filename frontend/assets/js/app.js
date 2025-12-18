const ANWB_API_BASE = 'https://api.tanknu.nl/routing/points-of-interest/v3/all';
const MIN_PRICE_EUR_PER_L = 0.10;
const ANWB_API_KEY = '';

let userLocation = null;
let allStationsCache = []; // Cache voor alle opgehaalde stations
let activeFilters = {
  selectedBrand: '',
  openOnly: false
};

// ===== SLIDERS =====
document.addEventListener('input', (e) => {
  if (e.target.id === 'radius') {
    document.getElementById('radiusValue').textContent = `${e.target.value} km`;
  }
});

// ===== GEOLOCATIE =====
window.addEventListener('load', () => {
  const statusEl = document.getElementById('locationStatus');

  if (!('geolocation' in navigator)) {
    statusEl.className = 'location-status error';
    statusEl.innerHTML = '<span class="icon">⚠️</span><span>Locatie niet ondersteund</span>';
    setupManualLocation();
    return;
  }

  statusEl.className = 'location-status loading';
  statusEl.innerHTML = '<span class="icon">⏳</span><span>Locatie ophalen...</span>';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };
      statusEl.className = 'location-status';
      statusEl.innerHTML = '<span class="icon">✅</span><span>Locatie gevonden</span>';
    },
    (error) => {
      console.error('Location error:', error);
      statusEl.className = 'location-status error';
      statusEl.innerHTML = '<span class="icon">⚠️</span><span>Geen toegang tot locatie</span>';
    }
  );
  setupManualLocation();
});

// ===== EVENT LISTENERS =====
document.addEventListener('click', async (e) => {
  if (e.target.id === 'searchBtn' || e.target.closest('#searchBtn')) {
    await searchNearbyStations();
  }
  
  // Reset filters button
  if (e.target.id === 'resetFiltersBtn') {
    resetFilters();
  }
});

// Filter listeners
document.addEventListener('change', (e) => {
  // Brand dropdown
  if (e.target.id === 'brandFilter') {
    activeFilters.selectedBrand = e.target.value;
    applyFilters();
  }
  
  // Open only checkbox
  if (e.target.id === 'filterOpenOnly') {
    activeFilters.openOnly = e.target.checked;
    applyFilters();
  }
});

// ===== HULPFUNCTIES VOOR AFSTAND EN BOUNDING BOX =====
function deg2rad(deg) {
  return deg * Math.PI / 180;
}

function computeDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Bouw een bounding box rond een punt met een straal + marge.
 * radiusKm = straal die de gebruiker kiest.
 * We vragen een iets grotere box op (radiusKm + marge), zodat
 * we in de frontend exact op radiusKm kunnen filteren.
 */
function buildBoundingBox(lat, lon, radiusKm) {
  const marginKm = Math.max(radiusKm * 0.3, 5); // kleine straal: +5km, 50km: +15km, etc.
  const effectiveRadius = radiusKm + marginKm;

  const latDelta = effectiveRadius / 111; // ruwweg km -> graden
  const lonDelta = effectiveRadius / (111 * Math.cos(deg2rad(lat)) || 1e-6);

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta
  };
}

// ===== ANWB-API MAPPING =====
function mapAnwbPoiToStation(poi, center) {
  const coords = poi.coordinates || {};
  const lat = coords.latitude;
  const lon = coords.longitude;

  const addr = poi.address || {};
  const street = addr.streetAddress || '';
  const postal_code = addr.postalCode || '';
  const city = addr.city || '';
  const country = addr.country || '';
  const iso3_country_code = (addr.iso3CountryCode || '').toString().toUpperCase();

  const prices = Array.isArray(poi.prices) ? poi.prices : [];
  const latest_prices = prices.map(p => ({
    fuel_type: (p.fuelType || '').toString().toUpperCase(),
    fuel_name: p.fuelName || '',
    value_eur_per_l: typeof p.value === 'number' ? p.value : null
  }));
  
  // Opening hours van de API
  const openingHours = Array.isArray(poi.openingHours) ? poi.openingHours : null;

  let distance_km = null;
  if (center && typeof lat === 'number' && typeof lon === 'number') {
    distance_km = computeDistanceKm(center.lat, center.lon, lat, lon);
  }

  return {
    id: poi.id || null,
    title: poi.title || 'Onbekend station',
    latitude: lat,
    longitude: lon,
    street_address: street,
    postal_code,
    city,
    country,
    iso3_country_code,
    latest_prices,
    openingHours,
    distance_km
  };
}

// ===== BRANDSTOFPRIJS =====
function getPriceForFuel(station, fuelType) {
  if (!station || !Array.isArray(station.latest_prices)) return null;
  const normalizedFuel = (fuelType || '').toString().toUpperCase();

  const priceObj = station.latest_prices.find(p =>
    (p.fuel_type && p.fuel_type.toString().toUpperCase() === normalizedFuel) ||
    (p.fuel_name && p.fuel_name.toString().toUpperCase().includes(normalizedFuel))
  );

  if (!priceObj || typeof priceObj.value_eur_per_l !== 'number') return null;

  return priceObj.value_eur_per_l;
}

// ===== ANWB-STATIONS OPHALEN EN HIER AL HARD FILTEREN OP VALUE =====
async function fetchAnwbStationsAround(center, radiusKm, fuelType) {
  if (!center) throw new Error('Geen center meegegeven');

  const bbox = buildBoundingBox(center.lat, center.lon, radiusKm);

  const params = new URLSearchParams();
  params.set('type-filter', 'FUEL_STATION');
  params.set(
    'bounding-box-filter',
    `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`
  );

  if (ANWB_API_KEY) {
    params.set('apikey', ANWB_API_KEY);
  }

  const url = `${ANWB_API_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'nl-NL'
    }
  });

  if (!res.ok) {
    throw new Error(`ANWB API error: ${res.status}`);
  }

  const data = await res.json();
  const list = Array.isArray(data.value) ? data.value : [];

  const normalizedFuel = fuelType ? fuelType.toString().toUpperCase() : null;

  // PREFILTER OP RUWE ANWB-DATA:
  // alleen POI's overhouden die voor de gekozen brandstof een value >= MIN_PRICE_EUR_PER_L hebben
  const filteredRaw = list.filter(poi => {
    if (!Array.isArray(poi.prices) || !normalizedFuel) return false;

    return poi.prices.some(p => {
      if (typeof p.value !== 'number') return false;
      if (p.value < MIN_PRICE_EUR_PER_L) return false;

      const t = (p.fuelType || '').toString().toUpperCase();
      const n = (p.fuelName || '').toString().toUpperCase();

      return t === normalizedFuel || n.includes(normalizedFuel);
    });
  });

  // Map alleen nog de al-gefilterde POI's
  const stations = filteredRaw.map(poi => mapAnwbPoiToStation(poi, center));

  return stations;
}

// ===== ZOEKEN DICHTBIJ =====
async function searchNearbyStations() {
  if (!userLocation) {
    showError('nearbyResults', 'Geen locatie beschikbaar. Geef toegang tot je locatie of vul handmatig een locatie in.');
    return;
  }

  const fuelType = document.getElementById('fuelType').value;
  const radius = Number(document.getElementById('radius').value);
  const resultsEl = document.getElementById('nearbyResults');
  const searchBtn = document.getElementById('searchBtn');
  const filterSection = document.getElementById('filterSection');

  searchBtn.disabled = true;
  searchBtn.textContent = 'Zoeken...';
  resultsEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p style="margin-top: 16px;">Stations zoeken...</p></div>';
  filterSection.style.display = 'none';

  try {
    // hier komen alleen nog stations binnen die al een geldige prijs voor de gekozen brandstof hebben
    const allStations = await fetchAnwbStationsAround(userLocation, radius, fuelType);

    // exacte afstand + filter op straal
    let inRadius = allStations
      .map(station => {
        if (station.latitude != null && station.longitude != null) {
          station.distance_km = computeDistanceKm(
            userLocation.lat,
            userLocation.lon,
            station.latitude,
            station.longitude
          );
        } else {
          station.distance_km = null;
        }
        return station;
      })
      .filter(s => s.distance_km != null && s.distance_km <= radius);

    // sorteren op prijs (goedkoopste eerst)
    inRadius.sort((a, b) => {
      const pa = getPriceForFuel(a, fuelType) || Number.POSITIVE_INFINITY;
      const pb = getPriceForFuel(b, fuelType) || Number.POSITIVE_INFINITY;
      return pa - pb;
    });

    // Bewaar alle stations in cache
    allStationsCache = inRadius;

    // Toon filter sectie en bouw brand filters
    if (inRadius.length > 0) {
      buildBrandFilters(inRadius);
      filterSection.style.display = 'block';
    }

    // Toon gefilterde resultaten
    applyFilters();

  } catch (err) {
    console.error('Search error:', err);
    showError('nearbyResults', 'Kan geen stations ophalen. Probeer het later opnieuw.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Zoek goedkoopste stations';
  }
}

// ===== FILTER FUNCTIES =====
function extractBrandName(stationTitle) {
  const title = (stationTitle || '').trim();
  
  // Bekende merken met speciale behandeling
  const titleLower = title.toLowerCase();
  const specialBrands = {
    'van kessel': 'Van Kessel',
    't-energy': 'T-Energy',
    'tank-stop': 'Tank-stop',
    'cng express': 'CNG Express'
  };
  
  // Check op speciale merken (met spaties of speciale tekens)
  for (const [key, value] of Object.entries(specialBrands)) {
    if (titleLower.includes(key)) {
      return value;
    }
  }
  
  // Haal het eerste woord als merknaam (alles voor spatie, haakje of andere scheiding)
  const match = title.match(/^([A-Za-z0-9]+)/);
  if (match && match[1]) {
    const brand = match[1];
    // Zorg voor correcte capitalisatie
    return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
  }
  
  return 'Overig';
}

function buildBrandFilters(stations) {
  const brandSelect = document.getElementById('brandFilter');
  if (!brandSelect) return;
  
  // Extract unieke merken
  const brandSet = new Set();
  stations.forEach(station => {
    const brand = extractBrandName(station.title);
    brandSet.add(brand);
  });
  
  const sortedBrands = Array.from(brandSet).sort();
  
  // Vul dropdown met opties (behoud "Alle merken" optie)
  const options = sortedBrands.map(brand => 
    `<option value="${brand}">${brand}</option>`
  ).join('');
  
  brandSelect.innerHTML = '<option value="">Alle merken</option>' + options;
}

function isStationOpen(station) {
  // Simpele check: als er openingHours is en het is een array, neem aan dat het open is
  // Voor een betere implementatie zou je de huidige tijd moeten checken tegen openingHours
  if (!station.openingHours || !Array.isArray(station.openingHours)) {
    return true; // Geen info = toon wel
  }
  
  // Check of er 24/7 opening is
  const has24x7 = station.openingHours.some(hours => {
    return hours.opens === '00:00' && hours.closes === '24:00';
  });
  
  if (has24x7) return true;
  
  // Voor nu: simpele check op basis van dag
  const now = new Date();
  const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const currentDay = dayNames[now.getDay()];
  const currentTime = now.getHours() * 60 + now.getMinutes();
  
  const todayHours = station.openingHours.find(h => 
    h.dayOfWeek && h.dayOfWeek.includes(currentDay)
  );
  
  if (!todayHours) return false;
  
  const openTime = parseTimeString(todayHours.opens);
  const closeTime = parseTimeString(todayHours.closes);
  
  return currentTime >= openTime && currentTime <= closeTime;
}

function parseTimeString(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function applyFilters() {
  const fuelType = document.getElementById('fuelType').value;
  
  let filtered = allStationsCache.filter(station => {
    // Brand filter
    if (activeFilters.selectedBrand) {
      const brand = extractBrandName(station.title);
      if (brand !== activeFilters.selectedBrand) {
        return false;
      }
    }
    
    // Open only filter
    if (activeFilters.openOnly && !isStationOpen(station)) {
      return false;
    }
    
    return true;
  });
  
  // Limiteer tot 10 resultaten
  const limited = filtered.slice(0, 10);
  
  displayResults(limited, fuelType, 'nearbyResults', true);
}

function resetFilters() {
  // Reset filter state
  activeFilters.selectedBrand = '';
  activeFilters.openOnly = false;
  
  // Reset UI
  const brandFilter = document.getElementById('brandFilter');
  if (brandFilter) brandFilter.value = '';
  document.getElementById('filterOpenOnly').checked = false;
  
  // Herlaad resultaten
  applyFilters();
}

// ===== GOOGLE MAPS ROUTE URL =====
function buildDirectionsUrl(origin, destination) {
  if (!destination) return null;

  let destStr = null;
  if (destination.address && destination.address.trim().length > 0) {
    destStr = destination.address.trim();
  } else if (destination.lat != null && destination.lon != null) {
    destStr = `${destination.lat},${destination.lon}`;
  }
  if (!destStr) return null;

  if (origin && origin.lat != null && origin.lon != null) {
    const orig = `${origin.lat},${origin.lon}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(orig)}&destination=${encodeURIComponent(destStr)}&travelmode=driving`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destStr)}&travelmode=driving`;
}

// ===== VLAG BEPALEN OP BASIS VAN LANDCODE =====
function getCountryFlag(countryCode) {
  if (!countryCode) return '';
  const code = countryCode.toUpperCase().trim();

  if (code === 'NLD') return '';

  const flags = {
    'DEU': '🇩🇪',
    'BEL': '🇧🇪',
    'LUX': '🇱🇺',
    'FRA': '🇫🇷',
    'GBR': '🇬🇧',
  };

  return flags[code] || '🌍';
}

// ===== RESULTATEN TONEN =====
function displayResults(stations, fuelType, targetElementId, showDistance) {
  const resultsEl = document.getElementById(targetElementId);

  if (!stations || stations.length === 0) {
    resultsEl.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <h3>Geen stations gevonden</h3>
        <p style="margin-top: 8px;">Probeer andere filters</p>
      </div>`;
    return;
  }

  const html = stations.map((station, index) => {
    const priceVal = getPriceForFuel(station, fuelType);
    const hasPrice = priceVal !== null;

    const priceValue = hasPrice
      ? `€ ${priceVal.toFixed(3)}`
      : 'Prijs onbekend';

    const address = [station.street_address, station.postal_code, station.city]
      .filter(Boolean)
      .join(', ');

    const distance = (showDistance && station.distance_km != null)
      ? `<span class="station-distance">📍 ${Number(station.distance_km).toFixed(1)} km</span>`
      : '';

    const countryFlag = showDistance ? getCountryFlag(station.iso3_country_code) : '';

    const flagBadge = countryFlag
      ? `<span class="country-flag" title="${station.country || 'Buitenland'}">${countryFlag}</span>`
      : '';
      
    // Check of station open is
    const stationOpen = isStationOpen(station);
    const openBadge = stationOpen 
      ? '<span class="open-badge open">🟢 Open</span>'
      : '<span class="open-badge closed">🔴 Gesloten</span>';

    const titleWithFlag = flagBadge
      ? `${station.title || 'Onbekend station'} ${flagBadge}`
      : (station.title || 'Onbekend station');

    const routeUrl = buildDirectionsUrl(
      userLocation,
      {
        address,
        lat: station.latitude,
        lon: station.longitude,
      }
    );

    let rankBadge = '';
    if (index < 3) {
      const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze';
      rankBadge = `<div class="rank-badge ${rankClass}">${index + 1}</div>`;
    }

    return `
      <div class="station-card">
        ${rankBadge}
        <div class="station-header">
          <div class="station-name">${titleWithFlag} ${openBadge}</div>
          <div class="station-price">
            ${priceValue}
            ${hasPrice ? '<span class="price-unit">/L</span>' : ''}
          </div>
        </div>
        <div class="station-address">${address || 'Adres onbekend'}</div>
        <div class="station-footer">
          ${distance}
          ${routeUrl
        ? `<a class="route-btn" href="${routeUrl}" target="_blank" rel="noopener" aria-label="Route naar ${station.title || 'tankstation'}">🧭 Route</a>`
        : ''}
        </div>
      </div>`;
  }).join('');

  resultsEl.innerHTML = html;
}

// ===== ERROR TONEN =====
function showError(targetElementId, message) {
  const resultsEl = document.getElementById(targetElementId);
  resultsEl.innerHTML = `<div class="error-message">${message}</div>`;
}

// ===== MANUAL LOCATION =====
function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function setupManualLocation() {
  const input = document.getElementById('manualLocationInput');
  const list = document.getElementById('locationSuggestions');
  if (!input || !list) return;

  const doSearch = debounce(async (q) => {
    if (!q || q.length < 2) {
      list.innerHTML = '';
      list.style.display = 'none';
      return;
    }
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&addressdetails=1&limit=6`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'nl' } });
      if (!res.ok) throw new Error('geocode error');
      const items = await res.json();
      renderLocationSuggestions(items);
    } catch (e) {
      console.warn('Location suggestion error', e);
      list.innerHTML = '';
      list.style.display = 'none';
    }
  }, 300);

  input.addEventListener('input', (e) => {
    doSearch(e.target.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      list.innerHTML = '';
      list.style.display = 'none';
    }
  });

  function renderLocationSuggestions(items) {
    const html = items.map(it => {
      const display = it.display_name;
      return `<div class="suggestion-item" data-lat="${it.lat}" data-lon="${it.lon}" data-display="${escapeHtml(display)}">${escapeHtml(display)}</div>`;
    }).join('');
    list.innerHTML = html;
    if (items.length > 0) {
      list.style.display = 'block';
      Array.from(list.querySelectorAll('.suggestion-item')).forEach(el => {
        el.addEventListener('click', () => {
          const lat = parseFloat(el.dataset.lat);
          const lon = parseFloat(el.dataset.lon);
          const display = el.dataset.display;
          selectManualLocation({ lat, lon, display });
        });
      });
    } else {
      list.style.display = 'none';
    }
  }
}

function selectManualLocation({ lat, lon, display }) {
  userLocation = { lat, lon };
  const statusEl = document.getElementById('locationStatus');
  statusEl.className = 'location-status';
  statusEl.innerHTML = `<span class="icon">📍</span><span>${display}</span>`;

  const list = document.getElementById('locationSuggestions');
  if (list) { list.innerHTML = ''; list.style.display = 'none'; }
  const input = document.getElementById('manualLocationInput');
  if (input) input.value = display;

  searchNearbyStations();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (s) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
  });
}

// ===== HELP OVERLAY =====
(function initHelpOverlay() {
  const openBtn = document.getElementById('helpOpenBtn');
  const closeBtn = document.getElementById('helpCloseBtn');
  const overlay = document.getElementById('helpOverlay');

  if (!openBtn || !closeBtn || !overlay) return;

  function openHelp() {
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeHelp() {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  openBtn.addEventListener('click', openHelp);
  closeBtn.addEventListener('click', closeHelp);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeHelp();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeHelp();
    }
  });
})();