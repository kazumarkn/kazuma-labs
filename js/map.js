// map.js
// Robust COG loader for GitHub Pages using geotiff.js + georaster-layer-for-leaflet
// Features:
// - Range-request test (byte-range) to detect if remote server supports partial requests
// - Good error handling and console logs
// - Auto-detect raster bounds and zoom to extent
// - Pixel inspection on click
// - Opacity control, basemap switching

// -----------------------------
// CONFIG
// -----------------------------
const COG_BASE_URL = "https://kazumarkn.github.io/Indonesian-CSLSA/cogs//"; // <- change if needed https://raw.githubusercontent.com/kazumarkn/Indonesian-CSLSA/main/cogs/ or https://kazumarkn.github.io/Indonesian-CSLSA/cogs/


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

// monthly range: 1950-01 .. 2025-09 (909 months). We will derive label YYYY_MM when needed.
const START_YEAR = 1950;
const TOTAL_MONTHS = 909;

// -----------------------------
// UTILITIES
// -----------------------------
function monthLabelFromIndex(i) {
  const y = START_YEAR + Math.floor(i / 12);
  const m = 1 + (i % 12);
  return `${y}_${String(m).padStart(2, "0")}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * Test for byte-range support using a small HEAD/Range request.
 * Returns true if server returns 206 Partial Content or supports HEAD properly.
 */
async function supportsRangeRequests(url) {
  try {
    // Try a HEAD first (some servers respond with Accept-Ranges in HEAD)
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) {
      // HEAD not allowed: try a tiny range request
      const rangeResp = await fetch(url, { headers: { Range: "bytes=0-1" } });
      return rangeResp.status === 206 || rangeResp.status === 200;
    } else {
      const acceptRanges = head.headers.get("accept-ranges");
      if (acceptRanges && acceptRanges !== "none") return true;
      // fallback to sending a tiny range request
      const rangeResp = await fetch(url, { headers: { Range: "bytes=0-1" } });
      return rangeResp.status === 206 || rangeResp.status === 200;
    }
  } catch (err) {
    console.warn("Range request check failed:", err);
    return false;
  }
}

// show a minimal loading overlay inside panel
function setLoading(isLoading, text = "Loading...") {
  const panel = document.getElementById("panel");
  if (!panel) return;
  let el = document.getElementById("loadingOverlay");
  if (isLoading) {
    if (!el) {
      el = document.createElement("div");
      el.id = "loadingOverlay";
      el.style.position = "absolute";
      el.style.top = "6px";
      el.style.right = "6px";
      el.style.background = "rgba(255,255,255,0.95)";
      el.style.padding = "6px 8px";
      el.style.borderRadius = "4px";
      el.style.fontSize = "12px";
      el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.15)";
      panel.appendChild(el);
    }
    el.textContent = text;
    el.style.display = "block";
  } else {
    if (el) el.style.display = "none";
  }
}

// -----------------------------
// MAP INIT
// -----------------------------
const map = L.map("map", { center: [-2.5, 118], zoom: 5 });

const baseLayers = {
  osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; OpenStreetMap' }),
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
  terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17 })
};

// add default base
baseLayers.osm.addTo(map);

// small state
let currentLayer = null;
let currentGeoraster = null; // stored parseGeoraster result (if available)

// -----------------------------
// UI ELEMENTS binding
// -----------------------------
const varSelect = document.getElementById("variableSelect");
const yearSelect = document.getElementById("yearSelect");
const monthSelect = document.getElementById("monthSelect"); // optional
const loadBtn = document.getElementById("loadBtn");
const opacitySlider = document.getElementById("opacitySlider");
const basemapSelect = document.getElementById("basemapSelect");
const legend = document.getElementById("legend");

// populate variables
(function populateVars() {
  if (!varSelect) return;
  VARIABLES.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    varSelect.appendChild(opt);
  });
})();

// populate years (1950-2025)
(function populateYears() {
  if (!yearSelect) return;
  for (let y = START_YEAR; y <= START_YEAR + Math.floor((TOTAL_MONTHS - 1) / 12); y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
})();

// optional month select: auto-create if not present in HTML
(function ensureMonthSelect() {
  if (!monthSelect) {
    // create monthSelect dynamically and append to panel if panel exists
    const panel = document.getElementById("panel");
    if (panel) {
      const label = document.createElement("strong");
      label.textContent = "Month";
      label.style.display = "block";
      label.style.marginTop = "6px";
      panel.appendChild(label);

      const sel = document.createElement("select");
      sel.id = "monthSelect";
      const months = ["01","02","03","04","05","06","07","08","09","10","11","12"];
      const mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      months.forEach((m,i) => {
        const o = document.createElement("option");
        o.value = m;
        o.textContent = `${mNames[i]} (${m})`;
        sel.appendChild(o);
      });
      panel.appendChild(sel);
      // make monthSelect global variable reference
      window.monthSelect = sel;
    }
  }
})();

// -----------------------------
// CORE: load a COG and add to map
// -----------------------------
async function loadCOGFor(variable, year, month = "01") {
  setLoading(true, "Checking COG availability...");

  // build filename expected convention: variable_YYYY_MM.tif
  const dateLabel = `${year}_${month}`;
  const filename = `${variable}_${dateLabel}.tif`;
  const url = `${COG_BASE_URL}${filename}`;

  console.log("Attempting to load COG:", url);

  // quick availability test
  try {
    const headResp = await fetch(url, { method: "HEAD" });
    if (!headResp.ok) {
      // HEAD might be rejected; try tiny range fetch
      const rtest = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1" } });
      if (!rtest.ok) {
        setLoading(false);
        throw new Error(`Resource not accessible (status: ${rtest.status}). Check the filename and repo path: ${url}`);
      }
    }
  } catch (err) {
    setLoading(false);
    console.error("COG availability check failed:", err);
    alert("Failed to access COG file. Check filename/path in COG_BASE_URL and that file exists.\n\n" + err.message);
    return;
  }

  // check range support (important for streaming)
  let rangeOK = await supportsRangeRequests(url);
  console.log("Range request support:", rangeOK);

  // fetch entire file as arrayBuffer (parseGeoraster needs that)
  // For large files this will download whole file; georaster-layer supports streaming for COGs,
  // but parseGeoraster from arrayBuffer is simplest and reliable for GitHub Pages COGs.
  setLoading(true, "Downloading COG (this may take a moment)...");
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to download COG (status ${resp.status})`);
    const arrayBuffer = await resp.arrayBuffer();

    setLoading(true, "Parsing COG...");
    const georaster = await parseGeoraster(arrayBuffer);
    currentGeoraster = georaster;

    // Remove old layer
    if (currentLayer) {
      try { map.removeLayer(currentLayer); } catch (e) { console.warn(e); }
      currentLayer = null;
    }

    // Create layer
    currentLayer = new GeoRasterLayer({
      georaster: georaster,
      opacity: parseFloat(opacitySlider ? opacitySlider.value : 0.75),
      resolution: 256
    });

    currentLayer.addTo(map);

    // fit to bounds (georaster-layer offers getBounds())
    try {
      const bounds = currentLayer.getBounds();
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds);
      } else {
        // fallback: compute bounds from georaster metadata
        const gx = georaster.xmin, gy = georaster.ymin, gx2 = georaster.xmax, gy2 = georaster.ymax;
        if (typeof gx !== "undefined") {
          map.fitBounds([[gy, gx], [gy2, gx2]]);
        }
      }
    } catch (e) {
      console.warn("Could not auto-zoom to raster bounds:", e);
    }

    setLoading(false);
    console.info("COG loaded successfully:", filename);
  } catch (err) {
    setLoading(false);
    console.error("Error loading/parsing COG:", err);
    alert("Failed to load or parse COG. See console for details.\n\nChecked URL:\n" + url);
  }
}

// -----------------------------
// PIXEL INSPECTION (click)
// -----------------------------
map.on("click", async function(e) {
  if (!currentLayer || !currentGeoraster) return;

  // try GeoRasterLayer method first (returns Promise)
  try {
    if (typeof currentLayer.getValueAtLatLng === "function") {
      const val = await currentLayer.getValueAtLatLng(e.latlng.lat, e.latlng.lng);
      L.popup()
        .setLatLng(e.latlng)
        .setContent(`<b>Value:</b> ${Array.isArray(val) ? val.join(", ") : val}`)
        .openOn(map);
      return;
    }
  } catch (err) {
    console.warn("getValueAtLatLng failed:", err);
  }

  // fallback: compute from georaster manually
  try {
    const georaster = currentGeoraster;
    const px = Math.floor((e.latlng.lng - georaster.xmin) / georaster.pixelWidth);
    const py = Math.floor((georaster.ymax - e.latlng.lat) / Math.abs(georaster.pixelHeight));
    let msgs = [];
    if (georaster.values && georaster.values.length) {
      georaster.values.forEach((band, bi) => {
        const row = (py * georaster.width) + px;
        const v = (band && band[row] !== undefined) ? band[row] : null;
        msgs.push(`B${bi+1}: ${v}`);
      });
    } else {
      msgs.push("No raw band arrays available to sample.");
    }
    L.popup()
      .setLatLng(e.latlng)
      .setContent(`<b>Pixel</b><br>${msgs.join("<br>")}`)
      .openOn(map);
  } catch (err) {
    console.warn("manual pixel sample failed:", err);
  }
});

// -----------------------------
// UI HANDLERS
// -----------------------------
if (loadBtn) {
  loadBtn.addEventListener("click", () => {
    const variable = (varSelect && varSelect.value) ? varSelect.value : VARIABLES[0];
    const year = (yearSelect && yearSelect.value) ? yearSelect.value : String(START_YEAR);
    const month = (window.monthSelect && window.monthSelect.value) ? window.monthSelect.value : "01";
    loadCOGFor(variable, year, month);
  });
}

// load on change for variable/year/month for convenience
if (varSelect) varSelect.addEventListener("change", () => { /* do nothing until user clicks Load */ });
if (yearSelect) yearSelect.addEventListener("change", () => { /* do nothing until user clicks Load */ });
if (window.monthSelect) window.monthSelect.addEventListener("change", () => { /* do nothing */ });

// opacity control
if (opacitySlider) {
  opacitySlider.addEventListener("input", () => {
    const v = parseFloat(opacitySlider.value);
    if (currentLayer && typeof currentLayer.setOpacity === "function") currentLayer.setOpacity(v);
  });
}

// basemap switch
if (basemapSelect) {
  basemapSelect.addEventListener("change", () => {
    const val = basemapSelect.value;
    // remove current base layers
    Object.values(baseLayers).forEach(bl => {
      try { map.removeLayer(bl); } catch (e) {}
    });
    if (val === "osm") baseLayers.osm.addTo(map);
    else if (val === "sat") baseLayers.sat.addTo(map);
    else if (val === "terrain") baseLayers.terrain.addTo(map);
  });
}

// automatically try loading defaults on first load
window.addEventListener("load", () => {
  // set sensible defaults
  if (varSelect) varSelect.value = VARIABLES[0];
  if (yearSelect) yearSelect.value = String(START_YEAR);
  if (opacitySlider) opacitySlider.value = "0.75";

  // attempt to auto-load first month of START_YEAR to give immediate feedback
  const month = (window.monthSelect && window.monthSelect.value) ? window.monthSelect.value : "01";
  loadCOGFor(VARIABLES[0], String(START_YEAR), month);

});

/* =========================
   Satellite / Globe Animation
   ========================= */

const canvas = document.getElementById("globeCanvas");
const ctx = canvas.getContext("2d");

let w, h;
function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

// Globe parameters
const center = { x: w / 2, y: h / 2 };
const globeRadius = Math.min(w, h) * 0.22;

// Satellite points
const satellites = [];
const SAT_COUNT = 80;

for (let i = 0; i < SAT_COUNT; i++) {
  satellites.push({
    angle: Math.random() * Math.PI * 2,
    radius: globeRadius + Math.random() * 120,
    speed: 0.0005 + Math.random() * 0.001
  });
}

function drawGlobe() {
  ctx.beginPath();
  ctx.arc(center.x, center.y, globeRadius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0, 194, 199, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawSatellites() {
  satellites.forEach(s => {
    s.angle += s.speed;

    const x = center.x + Math.cos(s.angle) * s.radius;
    const y = center.y + Math.sin(s.angle) * s.radius;

    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#00c2c7";
    ctx.fill();

    // Connection line
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "rgba(0, 194, 199, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function animate() {
  ctx.clearRect(0, 0, w, h);
  center.x = w / 2;
  center.y = h / 2;

  drawGlobe();
  drawSatellites();

  requestAnimationFrame(animate);
}

animate();
