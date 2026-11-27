import L from 'leaflet';
import { transit_realtime } from 'gtfs-realtime-bindings';

const $ = id => document.getElementById(id);
const warsaw = [52.232, 21.009];
const map = L.map('map', {
  zoomControl: false, preferCanvas: true, attributionControl: true, minZoom: 6, maxZoom: 19
}).setView(warsaw, 12);
map.attributionControl.setPrefix(false);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);
const positions = L.layerGroup().addTo(map);
const color = { bus: '#17664c', tram: '#a83239' };
const polishTime = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', second: '2-digit'
});
const polishDate = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'medium'
});
const validLine = line => /^[A-Z0-9-]{1,12}$/.test(line);
const kindOf = line => /^\d{1,2}$/.test(line) ? 'tram' : 'bus';

let vehicles = [];
let receivedAt = 0;
let busy = false;
let mode = 'all';
let activeLine = '';
let selected = '';
let favoritesOpen = false;
let favorites = new Set();
try {
  const stored = JSON.parse(localStorage.getItem('favorite-lines') || '[]');
  if (Array.isArray(stored)) favorites = new Set(stored.filter(line => typeof line === 'string' && validLine(line)));
} catch {
  // The map can still work without device storage.
}

function element(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function button(label, click, focusKey) {
  const node = element('button', label);
  node.type = 'button';
  if (focusKey) node.dataset.focusKey = focusKey;
  node.addEventListener('click', click);
  return node;
}

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 1e11 ? number * 1000 : 0;
}

function decode(buffer) {
  const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  const time = timestamp(feed.header?.timestamp);
  if (!time) throw new Error('Missing feed timestamp');
  const unique = new Map();
  for (const entry of feed.entity) {
    const v = entry.vehicle;
    if (!v?.position || entry.isDeleted) continue;
    // The Warsaw feed identifies lines and brigades as V/<line>/<brigade>.
    const [, idLine, brigade] = entry.id.split('/');
    const line = v.trip?.routeId || idLine;
    const { latitude, longitude } = v.position;
    if (!line || !validLine(line) || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < 51.6 || latitude > 52.9 || longitude < 19.8 || longitude > 22) continue;
    const updated = timestamp(v.timestamp);
    if (updated && time - updated > 10 * 60_000) continue;
    unique.set(entry.id, {
      id: entry.id, line, brigade, coords: [latitude, longitude], kind: kindOf(line),
      label: v.vehicle?.label, updated
    });
  }
  return { time, vehicles: [...unique.values()] };
}

function matching() {
  return vehicles.filter(v => (mode === 'all' || v.kind === mode) && (!activeLine || v.line === activeLine));
}

function changeLine(line) {
  activeLine = line;
  selected = '';
  favoritesOpen = false;
  $('line-query').value = line;
  if (line && mode !== 'all' && kindOf(line) !== mode) setMode('all');
  else render();
  const points = matching();
  if (line && points.length) {
    map.fitBounds(L.latLngBounds(points.map(v => v.coords)), { padding: [52, 52], maxZoom: 15 });
  }
}

function setMode(value) {
  mode = value;
  if (activeLine && mode !== 'all' && kindOf(activeLine) !== mode) {
    activeLine = '';
    $('line-query').value = '';
  }
  selected = '';
  document.querySelectorAll('[data-mode]').forEach(node => node.setAttribute('aria-pressed', node.dataset.mode === mode));
  render();
}

function showVehicle(v, center = false) {
  selected = v.id;
  favoritesOpen = false;
  if (center) map.setView(v.coords, Math.max(14, map.getZoom()));
  render();
}

function renderMap(points) {
  positions.clearLayers();
  const zoom = map.getZoom();
  const bounds = map.getBounds().pad(.15);
  const showLabels = Boolean(activeLine) || zoom >= 15;
  for (const v of points) {
    if (!bounds.contains(v.coords)) continue;
    const focused = v.id === selected;
    const dot = L.circleMarker(v.coords, {
      radius: focused ? 9 : zoom >= 13 ? 6 : 4,
      weight: focused ? 3 : 1.5, color: '#fff', fillColor: color[v.kind], fillOpacity: .92,
      bubblingMouseEvents: false
    }).addTo(positions);
    dot.on('click', () => showVehicle(v));
    if (showLabels || focused) {
      dot.bindTooltip(element('span', v.line), {
        permanent: true, direction: 'center', className: 'vehicle-label ' + v.kind,
        opacity: 1, interactive: true
      });
      const label = dot.getTooltip().getElement();
      if (label) L.DomEvent.on(label, 'click', click => {
        L.DomEvent.stopPropagation(click);
        showVehicle(v);
      });
    }
    if (focused) dot.bringToFront();
  }
}

function renderPanel(points) {
  const title = $('panel-title');
  const content = $('panel-content');
  const scroll = content.scrollTop;
  const focusKey = content.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  content.replaceChildren();
  $('toggle-favorites').setAttribute('aria-expanded', favoritesOpen);
  const chosenVehicle = points.find(v => v.id === selected);
  if (favoritesOpen) {
    title.textContent = 'Ulubione linie';
    if (favorites.size) {
      const list = element('div', '', 'vehicle-list');
      for (const line of [...favorites].sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }))) {
        list.append(button('Linia ' + line, () => changeLine(line), 'favorite-' + line));
      }
      content.append(list);
    } else {
      content.append(element('p', 'Wyszukaj linię i dotknij gwiazdki, aby ją zapisać.', 'panel-placeholder'));
    }
  } else if (activeLine || chosenVehicle) {
    const line = activeLine || chosenVehicle.line;
    title.textContent = chosenVehicle ? 'Szczegóły pojazdu' : 'Linia ' + line;
    const summary = element('div', '', 'line-info');
    summary.append(element('span', line, 'line-badge ' + kindOf(line)));
    const lineVehicles = points.filter(v => v.line === line);
    const label = kindOf(line) === 'tram' ? 'Tramwaj' : 'Autobus';
    summary.append(element('p', chosenVehicle ? label : 'Pojazdy w danych GPS: ' + lineVehicles.length));
    const star = button(favorites.has(line) ? '★ Zapisana' : '☆ Zapisz', () => {
      if (favorites.has(line)) favorites.delete(line);
      else favorites.add(line);
      try {
        localStorage.setItem('favorite-lines', JSON.stringify([...favorites]));
      } catch {
        // Keep favorites usable until the page closes.
      }
      renderPanel(points);
    }, 'save-line');
    star.setAttribute('aria-pressed', favorites.has(line));
    summary.append(star, button('Wyczyść', () => changeLine(''), 'clear-line'));
    content.append(summary);
    if (chosenVehicle) {
      const details = [
        chosenVehicle.label && 'Numer taborowy ' + chosenVehicle.label,
        chosenVehicle.brigade && 'Brygada ' + chosenVehicle.brigade,
        chosenVehicle.updated && 'GPS ' + polishTime.format(chosenVehicle.updated)
      ].filter(Boolean);
      if (details.length) content.append(element('p', details.join(' · '), 'vehicle-detail'));
    } else if (lineVehicles.length) {
      const list = element('div', '', 'vehicle-list');
      for (const v of lineVehicles) {
        const entry = button(v.label || 'Brygada ' + (v.brigade || '—'), () => showVehicle(v, true), v.id);
        entry.setAttribute('aria-label', v.label ? 'Pokaż pojazd ' + v.label : entry.textContent);
        list.append(entry);
      }
      content.append(list);
    }
  } else {
    title.textContent = 'Pojazdy na mapie';
    if (!receivedAt) {
      content.append(element('p', busy ? 'Pobieranie pozycji pojazdów…' : 'Brak pozycji do wyświetlenia.', 'panel-placeholder'));
    } else {
      const stats = element('div', '', 'stats');
      const counts = [
        ['bus', 'Autobusy', points.filter(v => v.kind === 'bus').length],
        ['tram', 'Tramwaje', points.filter(v => v.kind === 'tram').length]
      ];
      for (const [kind, label, count] of counts) {
        if (mode !== 'all' && mode !== kind) continue;
        const stat = element('div', '', 'stat ' + kind);
        stat.append(element('strong', count.toLocaleString('pl-PL')), document.createTextNode(label));
        stats.append(stat);
      }
      content.append(stats);
    }
  }
  content.scrollTop = scroll;
  if (focusKey) {
    [...content.querySelectorAll('button')].find(node => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
  }
}

function render() {
  const points = matching();
  renderMap(points);
  renderPanel(points);
}

let feedError = false;
let mapError = false;
function showStatus() {
  const stale = receivedAt && Date.now() - receivedAt > 120_000;
  const state = feedError ? (receivedAt ? 'Brak połączenia' : 'Dane niedostępne')
    : stale ? 'Dane opóźnione' : receivedAt ? 'Na żywo' : 'Ładowanie';
  $('status').textContent = state;
  $('status-dot').className = 'status-dot' + (feedError || stale ? ' warning' : receivedAt ? ' live' : '');
  $('feed-time').textContent = receivedAt ? 'Dane z ' + polishTime.format(receivedAt) : state;
  $('source-date').textContent = receivedAt ? 'Odczyt źródłowy: ' + polishDate.format(receivedAt) : 'Oczekiwanie na dane';
  const note = [feedError && (receivedAt ? 'Wyświetlam ostatnie pozycje.' : 'Nie udało się pobrać pozycji.'), mapError && 'Część mapy jest niedostępna.'].filter(Boolean).join(' ');
  $('map-note').textContent = note;
  $('map-note').hidden = !note;
}

async function refresh() {
  if (busy) return;
  busy = true;
  $('refresh').disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16_000);
  try {
    const response = await fetch('/vehicles.pb', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Feed unavailable: ' + response.status);
    const data = decode(await response.arrayBuffer());
    if (data.time >= receivedAt) {
      receivedAt = data.time;
      vehicles = data.vehicles;
    }
    feedError = false;
  } catch {
    feedError = true;
  } finally {
    clearTimeout(timeout);
    busy = false;
    $('refresh').disabled = false;
    showStatus();
    render();
  }
}

let tileFailures = 0;
tiles.on('loading', () => { tileFailures = 0; });
tiles.on('tileerror', () => { tileFailures += 1; });
tiles.on('load', () => { mapError = tileFailures > 0; showStatus(); });
map.on('moveend', () => renderMap(matching()));
new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));

$('search').addEventListener('submit', event => {
  event.preventDefault();
  const line = $('line-query').value.trim().toUpperCase();
  if (line && !validLine(line)) {
    $('line-query').setCustomValidity('Wpisz numer linii, np. 175, 17, E-1 lub N01.');
    $('line-query').reportValidity();
    return;
  }
  $('line-query').blur();
  changeLine(line);
});
$('line-query').addEventListener('input', () => $('line-query').setCustomValidity(''));
document.querySelectorAll('[data-mode]').forEach(node => node.addEventListener('click', () => setMode(node.dataset.mode)));
$('toggle-favorites').addEventListener('click', () => {
  favoritesOpen = !favoritesOpen;
  renderPanel(matching());
});
$('source-button').addEventListener('click', () => $('sources').showModal());
$('zoom-in').addEventListener('click', () => map.zoomIn());
$('zoom-out').addEventListener('click', () => map.zoomOut());
$('recenter').addEventListener('click', () => map.setView(warsaw, 12));
$('refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
refresh();
