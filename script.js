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

let layoutPolygon = null;
let layoutBoundaryLine = null;

const searchIndex = [];

const stats = {
    layoutArea: 36.3228,
    buildingCount: 0,  // loaded later
    parkCount: 0,  // loaded later
    greenArea: 27.917,
    denseCanopyArea: 15.93,
    satelliteDate: "2026-02-01"
};

function updateStats(){
    document.getElementById("stat-area").textContent = stats.layoutArea + " ha";
    document.getElementById("stat-buildings").textContent = stats.buildingCount;
    document.getElementById("stat-parks").textContent = stats.parkCount;
    document.getElementById("stat-green").textContent = stats.greenArea + " ha";
    document.getElementById("stat-green%").textContent = (stats.greenArea / stats.layoutArea).toFixed(1)+"%";
    document.getElementById("stat-dense").textContent = stats.denseCanopyArea + " ha";
    document.getElementById("stat-dense%").textContent = (stats.denseCanopyArea / stats.layoutArea).toFixed(1)+"%";
    document.getElementById("stat-date").textContent = stats.satelliteDate;
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

async function loadBounds() {
    const coords = await (
        await fetch("data/bounds.json")
    ).json();

    const ring = closeRing(coords);
    layoutPolygon = turf.polygon([ring]);
    stats.layoutArea = turf.area(layoutPolygon);
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

    const ndviBounds = await (
        await fetch("data/ndvi_bounds.json")
    ).json();

    L.imageOverlay(
        "data/ndvi.png",
        ndviBounds,
        {
            opacity: 0.35,
            interactive: false
        }
    ).addTo(ndviLayer);

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

async function loadBuildings() {
    const geojson = await (
        await fetch("data/buildings.geojson")
    ).json();
    stats.buildingCount = geojson.features.length;
    updateStats();

    let count = 1;
    L.geoJSON(geojson, {
        style: {
            color: "#58a6ff",
            weight: 1.3,
            opacity: 0.75,
            fillOpacity: 0.08
        },

        onEachFeature(feature, layer) {
            const name = safePopupName(
                feature.properties,
                `Building ${count++}`
            );
            bindFeaturePopup(
                layer,
                name,
                "Building",
                "building"
            );
            addSearchEntry(name, layer);
        }

    }).addTo(buildingLayer);


}

async function loadAmenities() {
    const geojson = await (
        await fetch("data/amenities.geojson")
    ).json();

    let count = 1;
    L.geoJSON(geojson, {

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
            addSearchEntry(name, layer);
        }

    }).addTo(amenityLayer);


}

async function loadParks() {
    const geojson = await (
        await fetch("data/parks.geojson")
    ).json();
    stats.parkCount = geojson.features.length;
    updateStats();

    let count = 1;
    L.geoJSON(geojson, {
        style: {
            color: "#3fb950",
            weight: 2,
            fillColor: "#3fb950",
            fillOpacity: 0.18

        },

        onEachFeature(feature, layer) {
            const name = safePopupName(
                feature.properties,
                `Park ${count++}`
            );
            bindFeaturePopup(
                layer,
                name,
                "Park",
                "park"
            );
            addSearchEntry(name, layer);
        }

    }).addTo(parkLayer);


}

async function loadNatural() {
    const geojson = await (
        await fetch("data/natural.geojson")
    ).json();

    L.geoJSON(geojson, {
        style: {
            color: "#8b949e",
            weight: 1.5,
            fillColor: "#8b949e",
            fillOpacity: 0.12
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
