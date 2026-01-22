// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const API_CONFIG = {
  BASE_URL: 'https://api.tanknu.nl',
  MIN_PRICE: 0.10,
  DEFAULT_FUEL: 'euro95',
  GEOCODE_URL: 'https://nominatim.openstreetmap.org/search'
};

const UI_CONFIG = {
  MAX_RESULTS: 10,
  DEBOUNCE_MS: 300,
  LOCATION_SUGGESTIONS_MIN_CHARS: 2,
  LOCATION_SUGGESTIONS_LIMIT: 6
};

const COUNTRY_FLAGS = {
  'DEU': '🇩🇪',
  'BEL': '🇧🇪',
  'LUX': '🇱🇺',
  'FRA': '🇫🇷',
  'GBR': '🇬🇧'
};

// ============================================================================
// STATE
// ============================================================================

const state = {
  userLocation: null,
  stationsCache: [],
  activeFilters: {
    selectedBrand: '',
    openOnly: false
  }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

window.addEventListener('load', initializeApp);

function initializeApp() {
  initializeGeolocation();
  initializeEventListeners();
  setupManualLocation();
  initHelpOverlay();
}

function initializeEventListeners() {
  // Radius slider
  document.addEventListener('input', handleSliderInput);
  
  // Search button
  document.addEventListener('click', handleSearchClick);
}

function handleSliderInput(e) {
  if (e.target.id === 'radius') {
    const radiusValue = document.getElementById('radiusValue');
    radiusValue.textContent = `${e.target.value} km`;
  }
}

async function handleSearchClick(e) {
  if (e.target.id === 'searchBtn' || e.target.closest('#searchBtn')) {
    await searchNearbyStations();
  }
}

// ============================================================================
// GEOLOCATION
// ============================================================================

function initializeGeolocation() {
  const statusEl = document.getElementById('locationStatus');

  if (!navigator.geolocation) {
    showLocationError(statusEl, 'Locatie niet ondersteund');
    return;
  }

  showLocationLoading(statusEl);

  navigator.geolocation.getCurrentPosition(
    position => handleLocationSuccess(position, statusEl),
    error => handleLocationError(error, statusEl)
  );
}

function handleLocationSuccess(position, statusEl) {
  state.userLocation = {
    lat: position.coords.latitude,
    lon: position.coords.longitude
  };
  
  statusEl.className = 'location-status';
  statusEl.innerHTML = '<span class="icon">✅</span><span>Locatie gevonden</span>';
}

function handleLocationError(error, statusEl) {
  console.error('Location error:', error);
  showLocationError(statusEl, 'Geen toegang tot locatie');
}

function showLocationLoading(statusEl) {
  statusEl.className = 'location-status loading';
  statusEl.innerHTML = '<span class="icon">⏳</span><span>Locatie ophalen...</span>';
}

function showLocationError(statusEl, message) {
  statusEl.className = 'location-status error';
  statusEl.innerHTML = `<span class="icon">⚠️</span><span>${message}</span>`;
}

// ============================================================================
// DISTANCE & GEOGRAPHY
// ============================================================================

function deg2rad(deg) {
  return deg * Math.PI / 180;
}

function computeDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

function buildBoundingBox(lat, lon, radiusKm) {
  const marginKm = Math.max(radiusKm * 0.3, 5);
  const effectiveRadius = radiusKm + marginKm;
  
  const latDelta = effectiveRadius / 111;
  const lonDelta = effectiveRadius / (111 * Math.cos(deg2rad(lat)) || 1e-6);
  
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta
  };
}

// ============================================================================
// API & DATA MAPPING
// ============================================================================

async function fetchBrandstofStationsAround(center, radiusKm, fuelType) {
  if (!center) {
    throw new Error('Geen center meegegeven');
  }

  const bbox = buildBoundingBox(center.lat, center.lon, radiusKm);
  const url = buildApiUrl(bbox, fuelType);
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'nl-NL'
    }
  });

  if (!response.ok) {
    throw new Error(`Brandstof API error: ${response.status}`);
  }

  const data = await response.json();
  const rawStations = Array.isArray(data) ? data : [];
  
  const validStations = filterValidStations(rawStations);
  const mappedStations = validStations
    .map(item => mapBrandstofApiToStation(item, center))
    .filter(Boolean);

  return mappedStations;
}

function buildApiUrl(bbox, fuelType) {
  const params = new URLSearchParams({
    pageType: 'map',
    type: (fuelType || API_CONFIG.DEFAULT_FUEL).toLowerCase(),
    left: bbox.minLon.toString(),
    bottom: bbox.minLat.toString(),
    right: bbox.maxLon.toString(),
    top: bbox.maxLat.toString()
  });

  return `${API_CONFIG.BASE_URL}?${params.toString()}`;
}

function filterValidStations(stations) {
  return stations.filter(item => {
    if (!item.fuelPrice?.prijs) return false;
    
    const price = parseFloat(item.fuelPrice.prijs.replace(',', '.'));
    return !isNaN(price) && price >= API_CONFIG.MIN_PRICE;
  });
}

function mapBrandstofApiToStation(item, center) {
  if (!item?.station) return null;
  
  const { station, fuelPrice } = item;
  const { latitude, longitude } = station;
  
  const latest_prices = buildPriceArray(fuelPrice);
  const distance_km = calculateDistance(center, latitude, longitude);
  
  return {
    id: station.id || item.id || null,
    title: station.chain || 'Onbekend',
    latitude,
    longitude,
    street_address: station.adres || '',
    postal_code: station.postcode || '',
    city: station.plaats || '',
    country: 'Nederland',
    iso3_country_code: 'NLD',
    latest_prices,
    distance_km,
    datum: fuelPrice?.datum || '',
    chain: station.chain || 'Onbekend'
  };
}

function buildPriceArray(fuelPrice) {
  if (!fuelPrice) return [];
  
  const priceStr = fuelPrice.prijs || '0';
  const priceValue = parseFloat(priceStr.replace(',', '.'));
  
  if (isNaN(priceValue)) return [];
  
  return [{
    fuel_type: (fuelPrice.tech || '').toLowerCase(),
    fuel_name: fuelPrice.type || '',
    value_eur_per_l: priceValue
  }];
}

function calculateDistance(center, lat, lon) {
  if (!center || typeof lat !== 'number' || typeof lon !== 'number') {
    return null;
  }
  
  return computeDistanceKm(center.lat, center.lon, lat, lon);
}

// ============================================================================
// STATION SEARCH & FILTERING
// ============================================================================

async function searchNearbyStations() {
  if (!state.userLocation) {
    showError('nearbyResults', 'Geen locatie beschikbaar. Geef toegang tot je locatie of vul handmatig een locatie in.');
    return;
  }

  const fuelType = document.getElementById('fuelType').value;
  const radius = Number(document.getElementById('radius').value);
  
  setSearchingState(true);

  try {
    const stations = await fetchBrandstofStationsAround(state.userLocation, radius, fuelType);
    const stationsInRadius = filterStationsByRadius(stations, radius, fuelType);
    const topStations = stationsInRadius.slice(0, UI_CONFIG.MAX_RESULTS);
    
    displayResults(topStations, fuelType, 'nearbyResults', true);
  } catch (err) {
    console.error('Search error:', err);
    showError('nearbyResults', 'Kan geen stations ophalen. Probeer het later opnieuw.');
  } finally {
    setSearchingState(false);
  }
}

function filterStationsByRadius(stations, radius, fuelType) {
  return stations
    .map(station => enrichStationWithDistance(station))
    .filter(station => station.distance_km !== null && station.distance_km <= radius)
    .sort((a, b) => comparePrices(a, b, fuelType));
}

function enrichStationWithDistance(station) {
  if (station.latitude != null && station.longitude != null) {
    station.distance_km = computeDistanceKm(
      state.userLocation.lat,
      state.userLocation.lon,
      station.latitude,
      station.longitude
    );
  }
  return station;
}

function comparePrices(stationA, stationB, fuelType) {
  const priceA = getPriceForFuel(stationA, fuelType) || Number.POSITIVE_INFINITY;
  const priceB = getPriceForFuel(stationB, fuelType) || Number.POSITIVE_INFINITY;
  return priceA - priceB;
}

function setSearchingState(isSearching) {
  const searchBtn = document.getElementById('searchBtn');
  const resultsEl = document.getElementById('nearbyResults');
  
  searchBtn.disabled = isSearching;
  searchBtn.textContent = isSearching ? 'Zoeken...' : 'Zoek goedkoopste stations';
  
  if (isSearching) {
    resultsEl.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p style="margin-top: 16px;">Stations zoeken...</p>
      </div>`;
  }
}

// ============================================================================
// PRICE UTILITIES
// ============================================================================

function getPriceForFuel(station, fuelType) {
  if (!station?.latest_prices) return null;
  
  const normalizedFuel = (fuelType || API_CONFIG.DEFAULT_FUEL).toLowerCase();
  
  const priceObj = station.latest_prices.find(p => 
    (p.fuel_type || '').toLowerCase() === normalizedFuel
  );
  
  return (priceObj && typeof priceObj.value_eur_per_l === 'number') 
    ? priceObj.value_eur_per_l 
    : null;
}

// ============================================================================
// UI RENDERING
// ============================================================================

function displayResults(stations, fuelType, targetElementId, showDistance) {
  const resultsEl = document.getElementById(targetElementId);

  if (!stations?.length) {
    showNoResults(resultsEl);
    return;
  }

  const html = stations
    .map((station, index) => renderStationCard(station, index, fuelType, showDistance))
    .join('');
  
  resultsEl.innerHTML = html;
}

function showNoResults(resultsEl) {
  resultsEl.innerHTML = `
    <div class="no-results">
      <div class="no-results-icon">🔍</div>
      <h3>Geen stations gevonden</h3>
      <p style="margin-top: 8px;">Probeer andere filters</p>
    </div>`;
}

function renderStationCard(station, index, fuelType, showDistance) {
  const priceVal = getPriceForFuel(station, fuelType);
  const priceDisplay = formatPrice(priceVal);
  const address = formatAddress(station);
  const distanceHtml = showDistance ? renderDistance(station) : '';
  const flagHtml = showDistance ? renderCountryFlag(station) : '';
  const rankBadge = index < 3 ? renderRankBadge(index) : '';
  const routeButton = renderRouteButton(station, address);

  return `
    <div class="station-card">
      ${rankBadge}
      <div class="station-header">
        <div class="station-name">${station.chain} ${flagHtml}</div>
        <div class="station-price">${priceDisplay}</div>
      </div>
      <div class="station-address">${address || 'Adres onbekend'}</div>
      <div class="station-footer">
        ${distanceHtml}
        ${routeButton}
      </div>
    </div>`;
}

function formatPrice(priceVal) {
  if (priceVal === null) {
    return 'Prijs onbekend';
  }
  return `€ ${priceVal.toFixed(3)}<span class="price-unit">/L</span>`;
}

function formatAddress(station) {
  return [station.street_address, station.postal_code, station.city]
    .filter(Boolean)
    .join(', ');
}

function renderDistance(station) {
  if (station.distance_km == null) return '';
  return `<span class="station-distance">📍 ${station.distance_km.toFixed(1)} km</span>`;
}

function renderCountryFlag(station) {
  const flag = getCountryFlag(station.iso3_country_code);
  if (!flag) return '';
  
  return `<span class="country-flag" title="${station.country || 'Buitenland'}">${flag}</span>`;
}

function getCountryFlag(countryCode) {
  if (!countryCode || countryCode === 'NLD') return '';
  return COUNTRY_FLAGS[countryCode.toUpperCase()] || '🌍';
}

function renderRankBadge(index) {
  const rankClass = ['gold', 'silver', 'bronze'][index];
  return `<div class="rank-badge ${rankClass}">${index + 1}</div>`;
}

function renderRouteButton(station, address) {
  const routeUrl = buildDirectionsUrl(state.userLocation, {
    address,
    lat: station.latitude,
    lon: station.longitude
  });
  
  if (!routeUrl) return '';
  
  const stationName = station.chain || station.title || 'tankstation';
  return `<a class="route-btn" href="${routeUrl}" target="_blank" rel="noopener" 
             aria-label="Route naar ${stationName}">🧭 Route</a>`;
}

function buildDirectionsUrl(origin, destination) {
  if (!destination) return null;

  const destStr = getDestinationString(destination);
  if (!destStr) return null;

  if (origin?.lat != null && origin?.lon != null) {
    const orig = `${origin.lat},${origin.lon}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(orig)}&destination=${encodeURIComponent(destStr)}&travelmode=driving`;
  }
  
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destStr)}&travelmode=driving`;
}

function getDestinationString(destination) {
  if (destination.address?.trim()) {
    return destination.address.trim();
  }
  
  if (destination.lat != null && destination.lon != null) {
    return `${destination.lat},${destination.lon}`;
  }
  
  return null;
}

function showError(targetElementId, message) {
  const resultsEl = document.getElementById(targetElementId);
  resultsEl.innerHTML = `<div class="error-message">${message}</div>`;
}

// ============================================================================
// MANUAL LOCATION
// ============================================================================

function setupManualLocation() {
  const input = document.getElementById('manualLocationInput');
  const list = document.getElementById('locationSuggestions');
  
  if (!input || !list) return;

  const debouncedSearch = debounce(searchLocation, UI_CONFIG.DEBOUNCE_MS);

  input.addEventListener('input', e => debouncedSearch(e.target.value, list));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      clearSuggestions(list);
    }
  });
}

async function searchLocation(query, list) {
  if (!query || query.length < UI_CONFIG.LOCATION_SUGGESTIONS_MIN_CHARS) {
    clearSuggestions(list);
    return;
  }

  try {
    const items = await fetchLocationSuggestions(query);
    renderLocationSuggestions(items, list);
  } catch (e) {
    console.warn('Location suggestion error', e);
    clearSuggestions(list);
  }
}

async function fetchLocationSuggestions(query) {
  const url = `${API_CONFIG.GEOCODE_URL}?format=jsonv2&q=${encodeURIComponent(query)}&addressdetails=1&limit=${UI_CONFIG.LOCATION_SUGGESTIONS_LIMIT}`;
  
  const response = await fetch(url, {
    headers: { 'Accept-Language': 'nl' }
  });
  
  if (!response.ok) {
    throw new Error('Geocode error');
  }
  
  return response.json();
}

function renderLocationSuggestions(items, list) {
  if (!items.length) {
    clearSuggestions(list);
    return;
  }

  const html = items.map(item => `
    <div class="suggestion-item" 
         data-lat="${item.lat}" 
         data-lon="${item.lon}" 
         data-display="${escapeHtml(item.display_name)}">
      ${escapeHtml(item.display_name)}
    </div>
  `).join('');
  
  list.innerHTML = html;
  list.style.display = 'block';
  
  attachSuggestionClickHandlers(list);
}

function attachSuggestionClickHandlers(list) {
  list.querySelectorAll('.suggestion-item').forEach(el => {
    el.addEventListener('click', () => {
      const location = {
        lat: parseFloat(el.dataset.lat),
        lon: parseFloat(el.dataset.lon),
        display: el.dataset.display
      };
      selectManualLocation(location);
    });
  });
}

function selectManualLocation({ lat, lon, display }) {
  state.userLocation = { lat, lon };
  
  updateLocationStatus(display);
  clearLocationInput(display);
  searchNearbyStations();
}

function updateLocationStatus(display) {
  const statusEl = document.getElementById('locationStatus');
  statusEl.className = 'location-status';
  statusEl.innerHTML = `<span class="icon">📍</span><span>${display}</span>`;
}

function clearLocationInput(display) {
  const list = document.getElementById('locationSuggestions');
  const input = document.getElementById('manualLocationInput');
  
  if (list) clearSuggestions(list);
  if (input) input.value = display;
}

function clearSuggestions(list) {
  list.innerHTML = '';
  list.style.display = 'none';
}

// ============================================================================
// HELP OVERLAY
// ============================================================================

function initHelpOverlay() {
  const openBtn = document.getElementById('helpOpenBtn');
  const closeBtn = document.getElementById('helpCloseBtn');
  const overlay = document.getElementById('helpOverlay');

  if (!openBtn || !closeBtn || !overlay) return;

  openBtn.addEventListener('click', () => toggleHelp(overlay, true));
  closeBtn.addEventListener('click', () => toggleHelp(overlay, false));
  
  overlay.addEventListener('click', e => {
    if (e.target === overlay) toggleHelp(overlay, false);
  });
  
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') toggleHelp(overlay, false);
  });
}

function toggleHelp(overlay, isOpen) {
  overlay.classList.toggle('active', isOpen);
  overlay.setAttribute('aria-hidden', String(!isOpen));
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

// ============================================================================
// UTILITIES
// ============================================================================

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(str) {
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  
  return String(str).replace(/[&<>"']/g, char => escapeMap[char]);
}