const API_BASE = '/api';
let userLocation = null;
let priceChart = null;

// ===== TAB SWITCHING =====
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

// ===== SLIDERS =====
document.addEventListener('input', (e) => {
  if (e.target.id === 'radius') {
    document.getElementById('radiusValue').textContent = `${e.target.value} km`;
  }
  if (e.target.id === 'limitSlider') {
    document.getElementById('limitValue').textContent = e.target.value;
  }
});

// ===== GEOLOCATIE =====
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
  setupManualLocation();
});

// ===== EVENT LISTENERS =====
document.addEventListener('click', async (e) => {
  if (e.target.id === 'searchBtn' || e.target.closest('#searchBtn')) {
    await searchNearbyStations();
  }
  if (e.target.id === 'nationwideBtn' || e.target.closest('#nationwideBtn')) {
    await searchNationwideStations();
  }
  if (e.target.id === 'loadDataBtn' || e.target.closest('#loadDataBtn')) {
    await loadPriceData();
  }
});

// ===== ZOEKEN DICHTBIJ =====
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
    
    try {
      const latestRes = await fetch(`${API_BASE}/avg-prices/latest`);
      if (latestRes.ok) {
        const latestData = await latestRes.json();
        const cur = latestData.find(i => i.fuel_type === fuelType);
        const el = document.getElementById('nearbyUpdated');
        if (cur) {
          const runRaw = cur.run_timestamp || cur.created_at;
          const runDate = parseTimestamp(runRaw);
          el.textContent = `Bijgewerkt ${formatTime(runDate)}`;
          el.title = runDate ? runDate.toISOString() : '';
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('Could not fetch avg-prices for update label', e);
    }
  } catch (err) {
    console.error('Search error:', err);
    showError('nearbyResults', 'Kan geen stations ophalen. Controleer of de API bereikbaar is.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Zoek goedkoopste stations';
  }
}

// ===== ZOEKEN LANDELIJK =====
async function searchNationwideStations() {
  const fuelType = document.getElementById('nationwideFuelType').value;
  const limit = document.getElementById('limitSlider').value;
  const resultsEl = document.getElementById('nationwideResults');
  const searchBtn = document.getElementById('nationwideBtn');

  searchBtn.disabled = true;
  searchBtn.textContent = 'Laden...';
  resultsEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p style="margin-top: 16px;">Beste prijzen ophalen...</p></div>';

  try {
    const url = `${API_BASE}/stations/cheapest?lat=52.0907&lon=5.1214&radius_km=100&fuel_type=${fuelType}&limit=${limit}&country_iso3=NLD`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const stations = await res.json();
    displayResults(stations, fuelType, 'nationwideResults', false);
    
    try {
      const latestRes = await fetch(`${API_BASE}/avg-prices/latest?country_iso3=NLD`);
      if (latestRes.ok) {
        const latestData = await latestRes.json();
        const cur = latestData.find(i => i.fuel_type === fuelType);
        const el = document.getElementById('nationwideUpdated');
        if (cur) {
          const runRaw = cur.run_timestamp || cur.created_at;
          const runDate = parseTimestamp(runRaw);
          el.textContent = `Bijgewerkt ${formatTime(runDate)}`;
          el.title = runDate ? runDate.toISOString() : '';
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('Could not fetch avg-prices for update label', e);
    }
  } catch (err) {
    console.error('Search error:', err);
    showError('nationwideResults', 'Kan geen stations ophalen. Controleer of de API bereikbaar is.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Toon goedkoopste landelijk';
  }
}

// ===== PRIJSDATA LADEN =====
async function loadPriceData() {
  const fuelType = document.getElementById('dataFuelType').value;
  const loadBtn = document.getElementById('loadDataBtn');
  const resultsEl = document.getElementById('dataResults');
  const currentPriceCard = document.getElementById('currentPriceCard');
  const chartCard = document.getElementById('chartCard');

  loadBtn.disabled = true;
  loadBtn.textContent = 'Laden...';
  resultsEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p style="margin-top: 16px;">Prijsdata ophalen...</p></div>';

  try {
    const latestRes = await fetch(`${API_BASE}/avg-prices/latest?country_iso3=NLD`);
    if (!latestRes.ok) throw new Error(`API error: ${latestRes.status}`);
    const latestData = await latestRes.json();
    const currentFuel = latestData.find(item => item.fuel_type === fuelType);

    if (currentFuel) {
      document.getElementById('currentAvgPrice').textContent = `€ ${currentFuel.avg_price.toFixed(3)}`;
      document.getElementById('currentPriceMeta').textContent = 
        `Gebaseerd op ${currentFuel.sample_count} tankstations · ${formatDate(currentFuel.run_timestamp)}`;
      currentPriceCard.style.display = 'block';
    }

    const historyRes = await fetch(`${API_BASE}/avg-prices/history?fuel_type=${fuelType}&country_iso3=NLD`);
    if (!historyRes.ok) throw new Error(`API error: ${historyRes.status}`);
    const historyData = await historyRes.json();

    if (historyData && historyData.length > 0) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentData = historyData
        .filter(item => new Date(item.run_timestamp) >= thirtyDaysAgo)
        .sort((a, b) => new Date(a.run_timestamp) - new Date(b.run_timestamp));

      if (recentData.length > 0) {
        renderChart(recentData);
        chartCard.style.display = 'block';
        resultsEl.innerHTML = '';
      } else {
        resultsEl.innerHTML = '<div class="no-results"><div class="no-results-icon">📊</div><h3>Geen recente data</h3><p style="margin-top: 8px;">Er zijn nog geen gegevens van de laatste 30 dagen</p></div>';
      }
    } else {
      resultsEl.innerHTML = '<div class="no-results"><div class="no-results-icon">📊</div><h3>Geen data beschikbaar</h3><p style="margin-top: 8px;">Probeer het later opnieuw</p></div>';
    }

  } catch (err) {
    console.error('Data error:', err);
    showError('dataResults', 'Kan prijsdata niet ophalen. Controleer of de API bereikbaar is.');
    currentPriceCard.style.display = 'none';
    chartCard.style.display = 'none';
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = 'Laad prijshistorie';
  }
}

// ===== CHART RENDEREN =====
function renderChart(data) {
  const ctx = document.getElementById('priceChart');
  
  if (priceChart) {
    priceChart.destroy();
  }

  const dailyData = {};
  
  data.forEach(item => {
    const date = new Date(item.run_timestamp);
    const dateKey = date.toISOString().split('T')[0];
    
    if (!dailyData[dateKey]) {
      dailyData[dateKey] = {
        prices: [],
        date: date
      };
    }
    dailyData[dateKey].prices.push(item.avg_price);
  });

  const dailyAverages = Object.keys(dailyData)
    .sort()
    .map(dateKey => ({
      date: dailyData[dateKey].date,
      avgPrice: dailyData[dateKey].prices.reduce((a, b) => a + b, 0) / dailyData[dateKey].prices.length
    }));

  const labels = dailyAverages.map(item => 
    item.date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  );

  const prices = dailyAverages.map(item => item.avgPrice);

  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Gemiddelde prijs (€/L)',
        data: prices,
        borderColor: '#1e40af',
        backgroundColor: 'rgba(30, 64, 175, 0.1)',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#1e40af',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(31, 41, 55, 0.95)',
          padding: 12,
          titleColor: '#fff',
          bodyColor: '#fff',
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: function(context) {
              return `€ ${context.parsed.y.toFixed(3)} per liter`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: function(value) {
              return '€ ' + value.toFixed(3);
            },
            font: {
              size: 11
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        },
        x: {
          ticks: {
            font: {
              size: 11
            },
            maxRotation: 45,
            minRotation: 45
          },
          grid: {
            display: false
          }
        }
      }
    }
  });
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
    const price = station.latest_prices?.find(p =>
      p.fuel_type === fuelType || (p.fuel_name && p.fuel_name.includes(fuelType))
    );

    const priceValue =
      price && price.value_eur_per_l
        ? `€ ${price.value_eur_per_l.toFixed(3)}`
        : 'Prijs onbekend';

    const address = [station.street_address, station.postal_code, station.city]
      .filter(Boolean)
      .join(', ');

    const distance = (showDistance && station.distance_km != null)
      ? `<span class="station-distance">📍 ${Number(station.distance_km).toFixed(1)} km</span>`
      : '';

    // vlag alleen tonen in de "dichtbij"-tab (showDistance === true)
    const countryFlag = showDistance ? getCountryFlag(station.iso3_country_code) : '';

    const flagBadge = countryFlag
      ? `<span class="country-flag" title="${station.country || 'Buitenland'}">${countryFlag}</span>`
      : '';

    // gebruik gewoon de titel zoals hij is aangeleverd
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
          <div class="station-name">${titleWithFlag}</div>
          <div class="station-price">
            ${priceValue}
            ${price ? '<span class="price-unit">/L</span>' : ''}
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

// ===== DATUM FORMATTEREN =====
function parseTimestamp(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(ts)) {
    return new Date(ts);
  }
  return new Date(ts + 'Z');
}

function formatDate(dateInput) {
  const date = parseTimestamp(dateInput);
  if (!date || isNaN(date.getTime())) return 'Onbekende tijd';
  return date.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTime(dateInput) {
  const date = parseTimestamp(dateInput);
  if (!date || isNaN(date.getTime())) return 'Onbekend';
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
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
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&addressdetails=1&limit=6&countrycodes=nl`;
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

  const activeTab = document.querySelector('.tab.active');
  if (activeTab && activeTab.dataset.tab === 'nearby') {
    searchNearbyStations();
  }
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