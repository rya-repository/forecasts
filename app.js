const CONFIG_PATH = "./venues.json";
const PAGE_REFRESH_MS = 5 * 60 * 1000;

const DEFAULT_LAYOUT = {
  calibratedForVenues: 3,
  minScaleFactor: 0.58,
  scaleExponent: 1,
  cropAnchor: "top-left"
};

const DEFAULT_CROP = {
  x: 0,
  y: 10,
  width: 470,
  height: 120,
  scale: 0.45,
  sourceWidth: 1400,
  sourceHeight: 900,
  autoScaleWithCount: true
};

let hasResizeListener = false;
let currentVenueCount = 0;
let runtimeLayout = { ...DEFAULT_LAYOUT };
let runtimeDefaultCrop = { ...DEFAULT_CROP };

function toFiniteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getAutoScaleFactor(crop = {}) {
  if (crop.autoScaleWithCount === false) {
    return 1;
  }

  const baseVenueCount = Math.max(1, toFiniteNumber(runtimeLayout.calibratedForVenues, 3));
  const minScaleFactor = Math.min(1, Math.max(0.2, toFiniteNumber(runtimeLayout.minScaleFactor, 0.58)));
  const exponent = Math.max(0.2, toFiniteNumber(runtimeLayout.scaleExponent, 1));

  if (currentVenueCount <= baseVenueCount) {
    return 1;
  }

  const ratio = baseVenueCount / currentVenueCount;
  const scaled = Math.pow(ratio, exponent);
  return Math.max(minScaleFactor, scaled);
}

function toWindyEmbedUrl(rawUrl, mode = "forecast") {
  if (!rawUrl) {
    return rawUrl;
  }

  if (rawUrl.includes("embed.windy.com/embed2.html")) {
    return rawUrl;
  }

  const detailedMatch = rawUrl.match(
    /windy\.com\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+)/i
  );
  const mapMatch = rawUrl.match(/windy\.com\/\?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+)/i);

  if (!detailedMatch && !mapMatch) {
    return rawUrl;
  }

  const markerLat = detailedMatch ? detailedMatch[1] : null;
  const markerLon = detailedMatch ? detailedMatch[2] : null;
  const centerLat = detailedMatch ? detailedMatch[3] : mapMatch[1];
  const centerLon = detailedMatch ? detailedMatch[4] : mapMatch[2];
  const zoom = detailedMatch ? detailedMatch[5] : mapMatch[3];
  const detailLat = markerLat || centerLat;
  const detailLon = markerLon || centerLon;

  const params = new URLSearchParams({
    lat: centerLat,
    lon: centerLon,
    zoom,
    level: "surface",
    overlay: "wind",
    product: "ecmwf",
    menu: "",
    message: "",
    marker: mode === "forecast" ? "true" : "",
    calendar: "",
    pressure: "",
    type: mode === "forecast" ? "forecast" : "map",
    location: "coordinates",
    metricWind: "knots",
    metricTemp: "C",
    radarRange: "-1"
  });

  if (mode === "forecast") {
    params.set("detail", `${detailLat},${detailLon}`);
    params.set("detailLat", detailLat);
    params.set("detailLon", detailLon);
  }

  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

async function loadConfig() {
  try {
    const response = await fetch(CONFIG_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load ${CONFIG_PATH}: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (window.location.protocol === "file:") {
      throw new Error(
        "Unable to load venues.json from file://. Run a local server (python -m http.server 8080) or use GitHub Pages."
      );
    }

    throw error;
  }
}

function normalizeConfig(config) {
  runtimeLayout = { ...DEFAULT_LAYOUT };
  runtimeDefaultCrop = { ...DEFAULT_CROP };

  if (!Array.isArray(config?.venues)) {
    throw new Error("venues.json must include a venues array.");
  }

  const venues = config.venues.map((venue, index) => {
    if (!venue || typeof venue !== "object") {
      throw new Error(`Venue at index ${index} must be an object.`);
    }
    if (!venue.name || !venue.url) {
      throw new Error(`Venue at index ${index} must include name and url.`);
    }

    return {
      ...venue,
      crop: { ...runtimeDefaultCrop }
    };
  });

  return {
    ...config,
    venues
  };
}

function applyCrop(frame, crop = {}) {
  const x = Number(crop.x ?? 650);
  const y = Number(crop.y ?? 70);
  const width = Number(crop.width ?? 470);
  const height = Number(crop.height ?? 190);
  const scale = Number(crop.scale ?? 1);
  const sourceWidth = Number(crop.sourceWidth ?? 1400);
  const sourceHeight = Number(crop.sourceHeight ?? 900);

  frame.dataset.cropX = String(x);
  frame.dataset.cropY = String(y);
  frame.dataset.cropWidth = String(width);
  frame.dataset.cropHeight = String(height);
  frame.dataset.cropScale = String(scale);
  frame.dataset.sourceWidth = String(sourceWidth);
  frame.dataset.sourceHeight = String(sourceHeight);
}

function fitForecastFrame(frame) {
  const wrapper = frame.closest(".forecast-crop");
  if (!wrapper) {
    return;
  }

  const x = Number(frame.dataset.cropX ?? 650);
  const y = Number(frame.dataset.cropY ?? 70);
  const cropWidth = Math.max(1, Number(frame.dataset.cropWidth ?? 470));
  const cropHeight = Math.max(1, Number(frame.dataset.cropHeight ?? 190));
  const cropScale = Number(frame.dataset.cropScale ?? 1);
  const sourceWidth = Math.max(800, Number(frame.dataset.sourceWidth ?? 1400));
  const sourceHeight = Math.max(500, Number(frame.dataset.sourceHeight ?? 900));
  const cropAnchor = frame.dataset.cropAnchor || runtimeLayout.cropAnchor || "top-left";

  const autoScaleFactor = getAutoScaleFactor({
    autoScaleWithCount: frame.dataset.autoScaleWithCount === "false" ? false : true
  });

  frame.style.width = `${sourceWidth}px`;
  frame.style.height = `${sourceHeight}px`;

  const wrapperWidth = Math.max(1, wrapper.clientWidth);
  const wrapperHeight = Math.max(1, wrapper.clientHeight);
  const fitScaleX = wrapperWidth / cropWidth;
  const fitScaleY = wrapperHeight / cropHeight;
  const finalScale = cropScale * autoScaleFactor * Math.max(fitScaleX, fitScaleY);
  const offsetX = cropAnchor === "center" ? (wrapperWidth - cropWidth * finalScale) / 2 : 0;
  const offsetY = cropAnchor === "center" ? (wrapperHeight - cropHeight * finalScale) / 2 : 0;
  const tx = -x * finalScale + offsetX;
  const ty = -y * finalScale + offsetY;

  frame.style.transform = `translate(${tx}px, ${ty}px) scale(${finalScale})`;
}

function fitAllForecastFrames() {
  document.querySelectorAll(".forecast-frame").forEach((frame) => {
    fitForecastFrame(frame);
  });
}

function renderVenueCard(venue, template) {
  const fragment = template.content.cloneNode(true);
  const title = fragment.querySelector(".forecast-card__title");
  const frame = fragment.querySelector(".forecast-frame");

  title.textContent = venue.name;
  frame.src = toWindyEmbedUrl(venue.url, "forecast");
  frame.title = `${venue.name} forecast panel`;
  frame.addEventListener("load", () => {
    fitForecastFrame(frame);
  });

  frame.dataset.autoScaleWithCount = String(runtimeDefaultCrop.autoScaleWithCount !== false);
  frame.dataset.cropAnchor = String(runtimeLayout.cropAnchor || "top-left");

  applyCrop(frame, venue.crop);

  return fragment;
}

function updateTimestamp() {
  const target = document.querySelector("#updated-at");
  const now = new Date();
  target.textContent = `Updated ${now.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function renderMap(map) {
  const mapPanel = document.querySelector("#map-panel");
  const frame = document.createElement("iframe");
  frame.loading = "lazy";
  frame.src = toWindyEmbedUrl(map.url, "map");
  frame.title = map.title || "Windy map";
  frame.referrerPolicy = "no-referrer-when-downgrade";
  mapPanel.replaceChildren(frame);
}

function renderError(message) {
  const list = document.querySelector("#forecast-list");
  const mapPanel = document.querySelector("#map-panel");
  const block = document.createElement("div");
  block.className = "error";
  block.textContent = message;
  list.replaceChildren(block);
  mapPanel.replaceChildren();
}

function startAutoRefresh() {
  const refreshNow = () => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("_refresh", String(Date.now()));
    window.location.replace(nextUrl.toString());
  };

  window.setTimeout(refreshNow, PAGE_REFRESH_MS);
}

async function init() {
  const list = document.querySelector("#forecast-list");
  const template = document.querySelector("#venue-template");

  try {
    const rawConfig = await loadConfig();
    const config = normalizeConfig(rawConfig);

    if (!Array.isArray(config.venues) || config.venues.length === 0) {
      throw new Error("No venues found in venues.json.");
    }

    currentVenueCount = config.venues.length;

    list.replaceChildren();
    document.documentElement.style.setProperty("--venue-count", String(currentVenueCount));
    const compactGap = Math.max(4, 14 - currentVenueCount);
    document.documentElement.style.setProperty("--venue-gap", `${compactGap}px`);
    config.venues.forEach((venue) => {
      list.appendChild(renderVenueCard(venue, template));
    });

    fitAllForecastFrames();
    requestAnimationFrame(() => {
      fitAllForecastFrames();
    });

    if (!hasResizeListener) {
      window.addEventListener("resize", fitAllForecastFrames);
      hasResizeListener = true;
    }

    if (config.map?.url) {
      renderMap(config.map);
    }

    updateTimestamp();
  } catch (error) {
    renderError(`Unable to load forecasts. ${error.message}`);
  }
}

init();
startAutoRefresh();
