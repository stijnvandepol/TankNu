const BRANDSTOF_API_BASE = 'https://api.tanknu.nl';
const MIN_PRICE_EUR_PER_L = 0.10;

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

// ===== BRANDSTOF API MAPPING =====
function mapBrandstofApiToStation(item, center) {
  // De nieuwe API geeft een ander formaat terug
  // item heeft: id, station {...}, fuelPrice {...}
  
  if (!item || !item.station) return null;
  
  const station = item.station;
  const fuelPrice = item.fuelPrice;
  
  const lat = station.latitude;
  const lon = station.longitude;
  
  // Extract address parts
  const street = station.adres || '';
  const postal_code = station.postcode || '';
  const city = station.plaats || '';
  const brand = station.chain || 'Onbekend';
  
  // Extract price info from fuelPrice
  // Gebruik fuelPrice.tech omdat het al "euro95" format is (zonder spaties!)
  // fuelPrice.type is "euro 95" (met spatie) dus niet geschikt
  const fuelTypeRaw = fuelPrice?.tech || '';
  const priceStr = fuelPrice?.prijs || '0';
  const priceValue = parseFloat(priceStr.replace(',', '.')) || null;
  
  // Normaliseer brandstoftype - tech field is al correct
  const normalizedFuelType = fuelTypeRaw.toLowerCase();
  
  // Build latest_prices array (dezelfde structuur als voorheen)
  const latest_prices = priceValue !== null ? [{
    fuel_type: normalizedFuelType,
    fuel_name: fuelType,
    value_eur_per_l: priceValue
  }] : [];
  
  let distance_km = null;
  if (center && typeof lat === 'number' && typeof lon === 'number') {
    distance_km = computeDistanceKm(center.lat, center.lon, lat, lon);
  }
  
  // Datum info
  const datum = fuelPrice?.datum || '';
  
  return {
    id: station.id || item.id || null,
    title: brand,
    latitude: lat,
    longitude: lon,
    street_address: street,
    postal_code,
    city,
    country: 'Nederland',
    iso3_country_code: 'NLD',
    latest_prices,
    openingHours: null, // Nieuwe API heeft geen openingsuren
    distance_km,
    datum,
    chain: brand
  };
}

// ===== BRANDSTOFPRIJS =====
function getPriceForFuel(station, fuelType) {
  if (!station || !Array.isArray(station.latest_prices)) return null;
  
  // Match fuelType (lowercase) against stored fuel_type
  const normalizedFuel = (fuelType || 'euro95').toString().toLowerCase();

  const priceObj = station.latest_prices.find(p => {
    const pType = (p.fuel_type || '').toString().toLowerCase();
    return pType === normalizedFuel;
  });

  if (!priceObj || typeof priceObj.value_eur_per_l !== 'number') return null;

  return priceObj.value_eur_per_l;
}

// ===== BRANDSTOF-STATIONS OPHALEN EN FILTEREN OP PRIJS =====
async function fetchBrandstofStationsAround(center, radiusKm, fuelType) {
  if (!center) throw new Error('Geen center meegegeven');

  const bbox = buildBoundingBox(center.lat, center.lon, radiusKm);

  // Brandstoftype wordt direct naar API gestuurd (alle waarden zijn al lowercase)
  const apiFuelType = (fuelType || 'euro95').toString().toLowerCase();

  const params = new URLSearchParams();
  params.set('pageType', 'map');
  params.set('type', apiFuelType);
  params.set('left', bbox.minLon.toString());
  params.set('bottom', bbox.minLat.toString());
  params.set('right', bbox.maxLon.toString());
  params.set('top', bbox.maxLat.toString());

  const url = `${BRANDSTOF_API_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'nl-NL'
    }
  });

  if (!res.ok) {
    throw new Error(`Brandstof API error: ${res.status}`);
  }

  const data = await res.json();
  const list = Array.isArray(data) ? data : [];

  // Filter op minimale prijs
  const filteredRaw = list.filter(item => {
    if (!item.fuelPrice || typeof item.fuelPrice.prijs !== 'string') return false;
    
    const priceStr = item.fuelPrice.prijs.replace(',', '.');
    const price = parseFloat(priceStr);
    
    return !isNaN(price) && price >= MIN_PRICE_EUR_PER_L;
  });

  // Map naar standaard station objecten
  const stations = filteredRaw.map(item => mapBrandstofApiToStation(item, center)).filter(s => s !== null);

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

  searchBtn.disabled = true;
  searchBtn.textContent = 'Zoeken...';
  resultsEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p style="margin-top: 16px;">Stations zoeken...</p></div>';

  try {
    const allStations = await fetchBrandstofStationsAround(userLocation, radius, fuelType);

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

    inRadius.sort((a, b) => {
      const pa = getPriceForFuel(a, fuelType) || Number.POSITIVE_INFINITY;
      const pb = getPriceForFuel(b, fuelType) || Number.POSITIVE_INFINITY;
      return pa - pb;
    });

    // Toon top 10 resultaten
    const limited = inRadius.slice(0, 10);
    displayResults(limited, fuelType, 'nearbyResults', true);

  } catch (err) {
    console.error('Search error:', err);
    showError('nearbyResults', 'Kan geen stations ophalen. Probeer het later opnieuw.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Zoek goedkoopste stations';
  }
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

    const titleWithFlag = flagBadge
      ? `${station.chain || station.title || 'Onbekend station'} ${flagBadge}`
      : (station.chain || station.title || 'Onbekend station');

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
          <div class="station-name">${titleWithFlag}</div>
          <div class="station-price">
            ${priceValue}
            ${hasPrice ? '<span class="price-unit">/L</span>' : ''}
          </div>
        </div>
        <div class="station-address">${address || 'Adres onbekend'}</div>
        <div class="station-footer">
          ${distance}
          ${routeUrl
        ? `<a class="route-btn" href="${routeUrl}" target="_blank" rel="noopener" aria-label="Route naar ${station.chain || station.title || 'tankstation'}">🧭 Route</a>`
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