// python -m http.server 8080

const map = L.map("map", {
    zoomControl: false,
    zoomSnap: 0.25,
    zoomDelta: 0.5
}).setView([12.8655, 77.5625], 15);

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
        attribution: "© OpenStreetMap contributors © CARTO",
        maxZoom: 22
    }
).addTo(map);

const boundaryLayer = L.layerGroup().addTo(map);
const ndviLayer = L.layerGroup().addTo(map);
const roadLayer = L.layerGroup().addTo(map);
const buildingLayer = L.layerGroup().addTo(map);
const amenityLayer = L.layerGroup().addTo(map);
const parkLayer = L.layerGroup().addTo(map);
const naturalLayer = L.layerGroup().addTo(map);

let ndviOverlay = null;
let currentYear = 2026;

let layoutPolygon = null;
let layoutBoundaryLine = null;

const searchIndex = [];

const stats = {
    layoutArea: 36.3228,
    buildingCount: 0, 
    parkCount: 0, 
    greenArea: 27.917,
    denseCanopyArea: 15.93,
    satelliteDate: "2026-02-01"
};

function updateStats(){
    document.getElementById("stat-area").textContent = stats.layoutArea + " ha";
    document.getElementById("stat-buildings").textContent = stats.buildingCount;
    document.getElementById("stat-parks").textContent = stats.parkCount;
    document.getElementById("stat-green").textContent = stats.greenArea + " ha";
    document.getElementById("stat-green%").textContent = (100 * stats.greenArea / stats.layoutArea).toFixed(1)+"%";
    document.getElementById("stat-dense").textContent = stats.denseCanopyArea + " ha";
    document.getElementById("stat-dense%").textContent = (100 * stats.denseCanopyArea / stats.layoutArea).toFixed(1)+"%";
    document.getElementById("stat-date").textContent = stats.satelliteDate;
}

async function loadNDVIYear(year) {
    currentYear = year;
    if (ndviOverlay) ndviLayer.removeLayer(ndviOverlay);

    const bounds = await (
        await fetch("data/ndvi_bounds.json")
    ).json();

    ndviOverlay = L.imageOverlay(
        `data/ndvi_imgs_hd/NDVI_${year}.png`,
        bounds,
        {
            opacity: 0.38,
            interactive: false
        }
    );

    ndviOverlay.addTo(ndviLayer);
    const label = document.getElementById("ndvi-year-label");
    if (label) label.textContent = year;
}

function closeRing(coords) {
    const ring = [...coords];
    const first = ring[0];
    const last = ring[ring.length - 1];

    if (first[0] !== last[0] || first[1] !== last[1])
        ring.push(first);

    return ring;
}

function toLeafletLatLngs(coords) {
    return coords.map(([lng, lat]) => [lat, lng]);
}

function layerCenter(layer) {
    if (layer.getLatLng)
        return layer.getLatLng();
    if (layer.getBounds)
        return layer.getBounds().getCenter();
    return null;
}

// Generic hover styling

function enablePolygonHover(layer, normalStyle, hoverStyle) {
    layer.on({
        mouseover() {
            layer.setStyle(hoverStyle);
            layer.bringToFront();
        },
        mouseout() {
            layer.setStyle(normalStyle);
        }
    });
}

function enableCircleHover(layer, normalStyle, hoverStyle) {
    layer.on({
        mouseover() {
            layer.setStyle(hoverStyle);
        },
        mouseout() {
            layer.setStyle(normalStyle);
        }
    });
}

function safePopupName(properties = {}, fallback) {
    return (
        properties.name ||
        properties.title ||
        properties.amenity ||
        properties.shop ||
        properties.building ||
        properties["addr:housenumber"] ||
        properties.ref ||
        fallback
    );
}

function bindFeaturePopup(layer, name, badge, cls) {
    layer.bindPopup(`
        <div class="popup-name">${name}</div>
        <span class="popup-badge ${cls}">${badge}</span>
    `);
}

function addSearchEntry(name, layer) {
    const center = layerCenter(layer);
    if (!center) return;
    searchIndex.push({
        name,
        latlng: center,
        layer
    });
}

function searchFeature(query) {
    query = query.trim().toLowerCase();
    if (!query) return;

    const item = searchIndex.find(x =>
        x.name.toLowerCase().includes(query)
    );

    if (!item) return;
    map.setView(item.latlng, 19);
    item.layer.openPopup();
}

/** * Utility to force closed LineStrings into true Polygons 
 * This prevents turf.area() from outputting 0 and fixes Leaflet inner fill selection
 */
function fixGeoJSONPolygons(geojson) {
    turf.featureEach(geojson, feature => {
        if (feature.geometry && feature.geometry.type === "LineString") {
            let coords = feature.geometry.coordinates;
            // A valid polygon needs at least 3 points.
            if (coords.length >= 3) {
                const first = coords[0];
                const last = coords[coords.length - 1];
                // Ensure the ring is closed
                if (first[0] !== last[0] || first[1] !== last[1]) {
                    coords = [...coords, [first[0], first[1]]];
                }
                // Once closed, it must have at least 4 coordinates to be a valid Turf polygon
                if (coords.length >= 4) {
                    feature.geometry.type = "Polygon";
                    feature.geometry.coordinates = [coords];
                }
            }
        }
    });
    return geojson;
}

async function loadBounds() {
    const coords = await (
        await fetch("data/bounds.json")
    ).json();

    const ring = closeRing(coords);
    layoutPolygon = turf.polygon([ring]);
    stats.layoutArea = +((turf.area(layoutPolygon) / 10000).toFixed(4));
    updateStats();
    layoutBoundaryLine = turf.polygonToLine(layoutPolygon);

    const boundary = L.polygon(
        toLeafletLatLngs(ring),
        {
            color: "#f85149",
            weight: 2,
            fill: false,
            dashArray: "6 4"
        }
    ).addTo(boundaryLayer);

    await loadNDVIYear(2026);

    map.fitBounds(boundary.getBounds(), {
        padding: [40, 40]
    });
}

function clipRoadFeature(feature) {
    const kept = [];

    turf.flattenEach(feature, flat => {
        if (flat.geometry.type !== "LineString")
            return;

        const split = turf.lineSplit(
            flat,
            layoutBoundaryLine
        );

        const segments =
            split.features.length ?
            split.features :
            [flat];

        for (const seg of segments) {

            if (seg.geometry.coordinates.length < 2)
                continue;

            const len = turf.length(seg, {
                units: "kilometers"
            });

            if (len === 0)
                continue;

            const mid = turf.along(
                seg,
                len / 2,
                { units: "kilometers" }
            );

            if (
                turf.booleanPointInPolygon(
                    mid,
                    layoutPolygon
                )
            ) {
                kept.push(seg);
            }
        }
    });

    return kept;
}

async function loadRoads() {
    const geojson = await (
        await fetch("data/roads.geojson")
    ).json();

    const clipped = [];

    turf.flattenEach(geojson, feature => {
        clipped.push(
            ...clipRoadFeature(feature)
        );
    });

    L.geoJSON(
        turf.featureCollection(clipped),
        {
            style: {
                color: "#d29922",
                weight: 2.5,
                opacity: 0.85
            }
        }
    ).addTo(roadLayer);
}

let hoveredBuilding = null;

async function loadBuildings() {
    let geojson = await (
        await fetch("data/buildings.geojson")
    ).json();

    // Fix incorrect LineStrings into Polygons before calculating areas
    geojson = fixGeoJSONPolygons(geojson);

    const insideBuildings = geojson.features.filter(feature =>
        turf.booleanWithin(feature, layoutPolygon)
    );
    
    stats.buildingCount = insideBuildings.length;
    updateStats();

    let count = 1;

    L.geoJSON({
        type: "FeatureCollection",
        features: insideBuildings
    }, {
        style() {
            return {
                color: "#7ec8ff",
                weight: 1.2,
                opacity: 1,
                fill: true, // Forces Leaflet to consider the fill area interactive
                fillColor: "#58a6ff",
                fillOpacity: 0.35,
                interactive: true
            };
        },

        onEachFeature(feature, layer) {
            let area = 0;
            let perimeter = null;
            let center = [0, 0];
            
            area = turf.area(feature);
            center = turf.centroid(feature).geometry.coordinates;
            
            try {
                perimeter = turf.length(
                    turf.polygonToLine(feature),
                    { units: "meters" }
                );
            } catch(e) {
                perimeter = 0; // Fallback in case of weird geometries
            }

            let size;

            if (area < 100)
                size = "Small";
            else if (area < 400)
                size = "Medium";
            else
                size = "Large";

            layer.bindPopup(`
                <div class="popup-name">
                    🏢 Building ${count++}
                </div>
                <span class="popup-badge building">
                    Building
                </span>
                <table class="popup-table">
                    <tr>
                        <td>Size</td>
                        <td>${size}</td>
                    </tr>
                    <tr>
                        <td>Footprint</td>
                        <td>${area.toFixed(0)} m²</td>
                    </tr>
                    ${
                        perimeter !== null
                        ? `<tr>
                                <td>Perimeter</td>
                                <td>${perimeter.toFixed(1)} m</td>
                        </tr>`
                        : ""
                    }
                    <tr>
                        <td>Latitude</td>
                        <td>${center[1].toFixed(6)}</td>
                    </tr>
                    <tr>
                        <td>Longitude</td>
                        <td>${center[0].toFixed(6)}</td>
                    </tr>
                </table>
            `);

            enablePolygonHover(layer, {
                color: "#7ec8ff",
                fillColor: "#58a6ff",
                fillOpacity: 0.35,
                weight: 1.2
            }, {
                color: "#ffffff",
                fillColor: "#7ec8ff",
                fillOpacity: 0.6,
                weight: 2
            });

            addSearchEntry(`Building ${count - 1}`, layer);
        }
    }).addTo(buildingLayer);
}

async function loadAmenities() {
    const geojson = await (
        await fetch("data/amenities.geojson")
    ).json();

    const insideAmenities = geojson.features.filter(feature => {
        try {
            if (feature.geometry.type === "Point") {
                return turf.booleanPointInPolygon(
                    feature,
                    layoutPolygon
                );
            }

            return turf.booleanWithin(
                feature,
                layoutPolygon
            );

        }
        catch {
            return false;
        }
    });

    let count = 1;
    L.geoJSON({
        type: "FeatureCollection",
        features: insideAmenities
    }, {
        pointToLayer(feature, latlng) {
            return L.circleMarker(latlng, {
                radius: 6,
                color: "#a5d6ff",
                weight: 2,
                fillColor: "#58a6ff",
                fillOpacity: 0.9
            });
        },
        style: {
            color: "#58a6ff",
            weight: 1.2,
            opacity: 0.8,
            fillOpacity: 0.12
        },
        onEachFeature(feature, layer) {
            const name = safePopupName(
                feature.properties,
                `Amenity ${count++}`
            );
            bindFeaturePopup(
                layer,
                name,
                "Amenity",
                "amenity"
            );

            enableCircleHover(
                layer,
                {
                    radius: 6,
                    color: "#a5d6ff",
                    weight: 2,
                    fillColor: "#58a6ff",
                    fillOpacity: 0.9
                },
                {
                    radius: 8,
                    color: "#ffffff",
                    weight: 3,
                    fillColor: "#58a6ff",
                    fillOpacity: 1
                }
            );

            addSearchEntry(name, layer);
        }
    }).addTo(amenityLayer);
}

let parkFeatures = [];

async function loadParks() {
    let geojson = await (
        await fetch("data/parks.geojson")
    ).json();
    
    // Convert enclosed LineStrings to Polygons
    geojson = fixGeoJSONPolygons(geojson);

    const insideParks = geojson.features.filter(feature => {
        try {
            return turf.booleanWithin(feature, layoutPolygon);
        }
        catch {
            return false;
        }
    });

    parkFeatures = insideParks;
    stats.parkCount = insideParks.length;
    updateStats();

    let count = 1;

    L.geoJSON({
        type: "FeatureCollection",
        features: insideParks
    }, {
        style: {
            color: "#3fb950",
            weight: 2,
            fill: true,
            fillColor: "#3fb950",
            fillOpacity: 0.18,
            interactive: true
        },
        onEachFeature(feature, layer) {
            const name = safePopupName(
                feature.properties,
                `Park ${count++}`
            );

            const area = turf.area(feature);

            let perimeter = 0;

            try {
                perimeter = turf.length(
                    turf.polygonToLine(feature),
                    { units: "meters" }
                );
            }
            catch {
                perimeter = null;
            }

            layer.bindPopup(`
                <div class="popup-name">${name}</div>

                <span class="popup-badge park">
                    Park
                </span>

                <table class="popup-table">

                    <tr>
                        <td>Area</td>
                        <td>${area.toFixed(0)} m²</td>
                    </tr>

                    ${
                        perimeter !== null ?
                        `<tr>
                            <td>Perimeter</td>
                            <td>${perimeter.toFixed(1)} m</td>
                        </tr>`
                        : ""
                    }

                </table>
            `);

            enablePolygonHover(
                layer,
                {
                    color: "#3fb950",
                    fillColor: "#3fb950",
                    fillOpacity: 0.18,
                    weight: 2
                },
                {
                    color: "#ffffff",
                    fillColor: "#3fb950",
                    fillOpacity: 0.45,
                    weight: 3
                }
            );

            addSearchEntry(name, layer);
        }
    }).addTo(parkLayer);
}

function nearestParkDistance(building) {
    const centroid = turf.centroid(building);
    let min = Infinity;

    for (const park of parkFeatures) {
        const nearest = turf.nearestPointOnLine(
            turf.polygonToLine(park),
            centroid
        );

        const d = turf.distance(
            centroid,
            nearest,
            { units: "meters" }
        );

        if (d < min) min = d;
    }
    return min;
}

async function loadNatural() {
    let geojson = await (
        await fetch("data/natural.geojson")
    ).json();
    
    // Convert enclosed LineStrings to Polygons
    geojson = fixGeoJSONPolygons(geojson);

    let count = 1;

    L.geoJSON(geojson, {
        style: {
            color: "#8b949e",
            weight: 1.5,
            fill: true,
            fillColor: "#8b949e",
            fillOpacity: 0.12,
            interactive: true
        },
        onEachFeature(feature, layer) {
            const name = safePopupName(
                feature.properties,
                `Natural Feature ${count++}`
            );
            bindFeaturePopup(
                layer,
                name,
                "Natural",
                "natural"
            );

            enablePolygonHover(
                layer,
                {
                    color: "#8b949e",
                    fillColor: "#8b949e",
                    fillOpacity: 0.12,
                    weight: 1.5
                },
                {
                    color: "#ffffff",
                    fillColor: "#8b949e",
                    fillOpacity: 0.35,
                    weight: 2.5
                }
            );

            addSearchEntry(name, layer);
        }
    }).addTo(naturalLayer);
}

const layerMap = {
    ndvi: ndviLayer,
    roads: roadLayer,
    buildings: buildingLayer,
    amenities: amenityLayer,
    parks: parkLayer,
    natural: naturalLayer,
    boundary: boundaryLayer
};

const layerState = {};

Object.keys(layerMap).forEach(key => {
    layerState[key] = true;
});

function toggleLayer(id) {
    const layer = layerMap[id];
    if (!layer) return;
    layerState[id] = !layerState[id];
    const btn = document.getElementById("toggle-" + id);

    if (layerState[id]) {
        map.addLayer(layer);
        btn?.classList.add("on");
    }
    else {
        map.removeLayer(layer);
        btn?.classList.remove("on");
    }
}

(async function init() {
    try {
        await loadBounds();
        await Promise.all([
            loadRoads(),
            loadBuildings(),
            loadAmenities(),
            loadParks(),
            loadNatural()
        ]);
    }
    catch (err) {
        console.error(
            "Initialization failed:",
            err
        );
    }
})();

/* ── SIDEBAR RESIZE ───────────────────────────────────── */
(function () {
    const sidebar = document.getElementById("sidebar");
    const handle  = document.getElementById("sidebar-resize");
    if (!sidebar || !handle) return;

    let dragging = false;

    handle.addEventListener("mousedown", e => {
        dragging = true;
        handle.classList.add("resizing");
        document.body.style.cursor      = "col-resize";
        document.body.style.userSelect  = "none";
        e.preventDefault();
    });

    document.addEventListener("mousemove", e => {
        if (!dragging) return;
        const w = Math.max(200, Math.min(520, e.clientX));
        sidebar.style.width    = w + "px";
        sidebar.style.minWidth = w + "px";
        map.invalidateSize();
    });

    document.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove("resizing");
        document.body.style.cursor     = "";
        document.body.style.userSelect = "";
    });
})();

function updateTimelineLabel() {
    const slider = document.getElementById("ndvi-slider");
    const label = document.getElementById("ndvi-year-label");
    if (!slider || !label) return;

    const min = +slider.min || 2005;
    const max = +slider.max || 2026;
    const val = +slider.value || 2026;

    const percent = ((val - min) / (max - min)) * 100;
    label.textContent = val;
    
    // Centers the floating badge over the slider thumb
    label.style.left = `calc(${percent}% + (${8 - percent * 0.16}px))`;
}

// HISTORICAL CHART INITIALIZATION
function initChart() {
    const ctx = document.getElementById('coverChart');
    if (!ctx) return;

    // Years 2005 to 2026
    const years = Array.from({length: 22}, (_, i) => 2005 + i);

    const greenCoverData = [55, 54.5, 54, 53, 56, 58, 60, 59, 62, 64, 65, 68, 70, 71, 72, 73, 73.5, 75, 75.8, 76.5, 76.8, 76.8];
    const denseCanopyData = [25, 24, 24, 23, 25, 27, 28, 28, 30, 31, 33, 35, 37, 38, 39, 40, 41, 42, 43, 43.5, 43.8, 43.8];

    window.coverChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                {
                    label: 'Green Cover',
                    data: greenCoverData,
                    borderColor: '#39ff14', // Neon Green
                    backgroundColor: 'rgba(57, 255, 20, 0.05)',
                    borderWidth: 2,
                    tension: 0.3, // Smooth curves
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: true
                },
                {
                    label: 'Dense Canopy',
                    data: denseCanopyData,
                    borderColor: '#1e5230', // Deeper forest green for contrast
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    borderDash: [4, 4], // Dashed line to differentiate easily
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#8b949e',
                        usePointStyle: true,
                        pointStyle: 'rect',
                        boxWidth: 8,
                        boxHeight: 8,
                        font: {
                            family: "'Space Grotesk', sans-serif",
                            size: 10
                        }
                    }
                },
                tooltip: {
                    backgroundColor: '#161b22',
                    titleColor: '#e6edf3',
                    bodyColor: '#e6edf3',
                    borderColor: '#30363d',
                    borderWidth: 1,
                    padding: 8,
                    bodyFont: { family: "'Space Grotesk', sans-serif" },
                    titleFont: { family: "'Space Grotesk', sans-serif" },
                    callbacks: {
                        label: (context) => ` ${context.dataset.label}: ${context.parsed.y}%`
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(139, 148, 158, 0.1)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#8b949e',
                        maxTicksLimit: 5, // Prevents X axis from looking cluttered
                        font: {
                            family: "'Space Grotesk', sans-serif",
                            size: 9
                        }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(139, 148, 158, 0.1)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#8b949e',
                        font: {
                            family: "'Space Grotesk', sans-serif",
                            size: 9
                        },
                        callback: (value) => value + '%'
                    },
                    min: 0,
                    max: 100
                }
            }
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const slider = document.getElementById("ndvi-slider");
    if (slider) {
        slider.addEventListener("input", e => {
            loadNDVIYear(Number(e.target.value));
            updateTimelineLabel();
        });
    }
    initChart();
    updateTimelineLabel();
});

// ── Chart popup toggle ──
const chartPopup = document.getElementById('chart-popup');
const chartFab   = document.getElementById('chart-fab');
const popupClose = document.getElementById('popup-close');

function toggleChartPopup(show) {
    if (typeof show === 'boolean') {
        chartPopup.classList.toggle('visible', show);
    } else {
        chartPopup.classList.toggle('visible');
    }

    // Give the panel time to finish its slide transition, then resize the chart
    setTimeout(() => {
        if (window.coverChartInstance && window.coverChartInstance.resize) {
            window.coverChartInstance.resize();
        }
    }, 400); // matches the CSS transition duration
}

chartFab.addEventListener('click', () => toggleChartPopup());
popupClose.addEventListener('click', () => toggleChartPopup(false));
