const API_BASE = '/api';
let userLocation = null;

// Tabs
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');

  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById(`${tabName}-tab`).classList.add('active');
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn && btn.dataset.tab) {
    switchTab(btn.dataset.tab);
  }
});

// Sliders live-waarde
document.addEventListener('input', (e) => {
  if (e.target.id === 'radius') {
    document.getElementById('radiusValue').textContent = `${e.target.value} km`;
  }
  if (e.target.id === 'limitSlider') {
    document.getElementById('limitValue').textContent = e.target.value;
  }
});

// Geolocatie ophalen
window.addEventListener('load', () => {
  const statusEl = document.getElementById('locationStatus');

  if (!('geolocation' in navigator)) {
    statusEl.className = 'location-status error';
    statusEl.innerHTML = '<span class="icon">⚠️</span><span>Locatie niet ondersteund</span>';
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
});

// Event listeners voor knoppen
document.addEventListener('click', async (e) => {
  if (e.target.id === 'searchBtn') {
    await searchNearbyStations();
  }
  if (e.target.id === 'nationwideBtn') {
    await searchNationwideStations();
  }
});

// Zoeken – dichtbij
async function searchNearbyStations() {
  if (!userLocation) {
    showError('nearbyResults', 'Geen locatie beschikbaar. Geef toegang tot je locatie.');
    return;
  }

  const fuelType = document.getElementById('fuelType').value;
  const radius = document.getElementById('radius').value;
  const resultsEl = document.getElementById('nearbyResults');
  const searchBtn = document.getElementById('searchBtn');

  searchBtn.disabled = true;
  searchBtn.textContent = 'Zoeken...';
  resultsEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p style="margin-top: 16px;">Stations zoeken...</p></div>';

  try {
    const url = `${API_BASE}/stations/cheapest?lat=${userLocation.lat}&lon=${userLocation.lon}&radius_km=${radius}&fuel_type=${fuelType}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const stations = await res.json();
    displayResults(stations, fuelType, 'nearbyResults', true);
  } catch (err) {
    console.error('Search error:', err);
    showError('nearbyResults', 'Er ging iets mis bij het ophalen van de stations. Check of de API via /api bereikbaar is.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Zoek goedkoopste stations';
  }
}

// Zoeken – landelijk (proxyvoorbeeld: Utrecht als middenpunt met ruime straal)
async function searchNationwideStations() {
  const fuelType = document.getElementById('nationwideFuelType').value;
  const limit = document.getElementById('limitSlider').value;
  const resultsEl = document.getElementById('nationwideResults');
  const searchBtn = document.getElementById('nationwideBtn');

  searchBtn.disabled = true;
  searchBtn.textContent = 'Laden...';
  resultsEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p style="margin-top: 16px;">Beste prijzen ophalen...</p></div>';

  try {
    const url = `${API_BASE}/stations/cheapest?lat=52.0907&lon=5.1214&radius_km=100&fuel_type=${fuelType}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const stations = await res.json();
    displayResults(stations, fuelType, 'nationwideResults', false);
  } catch (err) {
    console.error('Search error:', err);
    showError('nationwideResults', 'Er ging iets mis bij het ophalen van de stations. Check of de API via /api bereikbaar is.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Toon goedkoopste landelijk';
  }
}

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
    const price = station.latest_prices?.find(p =>
      p.fuel_type === fuelType || p.fuel_name?.includes(fuelType)
    );

    const priceValue = price?.value_eur_per_l
      ? `€ ${price.value_eur_per_l.toFixed(3)}`
      : 'Prijs onbekend';

    const address = [station.street_address, station.postal_code, station.city]
      .filter(Boolean)
      .join(', ');

    const distance = station.distance_km && showDistance
      ? `<span class="station-distance">📍 ${station.distance_km.toFixed(1)} km</span>`
      : '';

    let rankBadge = '';
    if (index < 3) {
      const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze';
      rankBadge = `<div class="rank-badge ${rankClass}">${index + 1}</div>`;
    }

    return `
      <div class="station-card">
        ${rankBadge}
        <div class="station-header">
          <div class="station-name">${station.title || 'Onbekend station'}</div>
          <div class="station-price">
            ${priceValue}
            ${price ? '<span class="price-unit">/L</span>' : ''}
          </div>
        </div>
        <div class="station-address">${address || 'Adres onbekend'}</div>
        ${distance}
      </div>`;
  }).join('');

  resultsEl.innerHTML = html;
}

function showError(targetElementId, message) {
  const resultsEl = document.getElementById(targetElementId);
  resultsEl.innerHTML = `<div class="error-message">${message}</div>`;
}
