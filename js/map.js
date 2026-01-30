// =============================
// Kazuma Labs – Map + Globe JS
// =============================

// -----------------------------
// CONFIG
// -----------------------------
const COG_BASE_URL = "https://kazumarkn.github.io/Indonesian-CSLSA/cogs/";

const VARIABLES = [
  "suitability_index",
  "suitability_class",
  "mem_temp",
  "mem_precip",
  "mem_soiln",
  "mem_sw",
  "mem_elev",
  "mem_slope"
];

const START_YEAR = 1950;
const TOTAL_MONTHS = 909;

// -----------------------------
// UTILITIES
// -----------------------------
function pad(n) {
  return String(n).padStart(2, "0");
}

async function supportsRangeRequests(url) {
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) {
      const ar = head.headers.get("accept-ranges");
      if (ar && ar !== "none") return true;
    }
    const r = await fetch(url, { headers: { Range: "bytes=0-1" } });
    return r.status === 206 || r.status === 200;
  } catch {
    return false;
  }
}

function setLoading(isLoading, text = "Loading...") {
  const panel = document.getElementById("panel");
  if (!panel) return;

  let el = document.getElementById("loadingOverlay");
  if (isLoading) {
    if (!el) {
      el = document.createElement("div");
      el.id = "loadingOverlay";
      el.style.cssText = `
        position:absolute;top:6px;right:6px;
        background:rgba(255,255,255,.95);
        padding:6px 8px;border-radius:4px;
        font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,.15)
      `;
      panel.appendChild(el);
    }
    el.textContent = text;
    el.style.display = "block";
  } else if (el) {
    el.style.display = "none";
  }
}

// -----------------------------
// MAP INIT (Leaflet)
// -----------------------------
const map = L.map("map", { center: [-2.5, 118], zoom: 5 });

const baseLayers = {
  osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }),
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
  terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17 })
};

baseLayers.osm.addTo(map);

let currentLayer = null;
let currentGeoraster = null;

// -----------------------------
// UI ELEMENTS
// -----------------------------
const varSelect = document.getElementById("variableSelect");
const yearSelect = document.getElementById("yearSelect");
const loadBtn = document.getElementById("loadBtn");
const opacitySlider = document.getElementById("opacitySlider");
const basemapSelect = document.getElementById("basemapSelect");

// -----------------------------
// LOAD COG
// -----------------------------
async function loadCOGFor(variable, year, month = "01") {
  const filename = `${variable}_${year}_${month}.tif`;
  const url = `${COG_BASE_URL}${filename}`;

  setLoading(true, "Loading raster…");

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("COG not found");

    const buf = await resp.arrayBuffer();
    const georaster = await parseGeoraster(buf);
    currentGeoraster = georaster;

    if (currentLayer) map.removeLayer(currentLayer);

    currentLayer = new GeoRasterLayer({
      georaster,
      opacity: opacitySlider ? opacitySlider.value : 0.75,
      resolution: 256
    });

    currentLayer.addTo(map);
    map.fitBounds(currentLayer.getBounds());

    setLoading(false);
  } catch (e) {
    console.error(e);
    alert("Failed to load raster.");
    setLoading(false);
  }
}

// -----------------------------
// UI EVENTS
// -----------------------------
if (loadBtn) {
  loadBtn.onclick = () =>
    loadCOGFor(varSelect.value, yearSelect.value, "01");
}

if (opacitySlider) {
  opacitySlider.oninput = () =>
    currentLayer && currentLayer.setOpacity(opacitySlider.value);
}

if (basemapSelect) {
  basemapSelect.onchange = () => {
    Object.values(baseLayers).forEach(l => map.removeLayer(l));
    baseLayers[basemapSelect.value].addTo(map);
  };
}

// =============================
// 🌍 GLOBE + SATELLITE BACKGROUND
// =============================
(function globeBackground() {
  const canvas = document.getElementById("globeCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let w, h;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  const satellites = Array.from({ length: 90 }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 160 + Math.random() * 120,
    speed: 0.0006 + Math.random() * 0.001
  }));

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    // globe ring
    ctx.beginPath();
    ctx.arc(cx, cy, 140, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,194,199,.25)";
    ctx.lineWidth = 2;
    ctx.stroke();

    satellites.forEach(s => {
      s.angle += s.speed;
      const x = cx + Math.cos(s.angle) * s.radius;
      const y = cy + Math.sin(s.angle) * s.radius;

      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#00c2c7";
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(0,194,199,.08)";
      ctx.stroke();
    });

    requestAnimationFrame(draw);
  }

  draw();
})();
