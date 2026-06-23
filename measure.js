const measureLayer = L.layerGroup().addTo(map);

let measureMode = null;
let measurePoints = [];
let measureMarkers = [];
let measurePath = null;

const shapes = [];
let nextId = 1;

function addShapeToRegistry(type, label, grpLayer) {
    shapes.push({
        id: nextId++,
        type,
        label,
        layer: grpLayer,
        visible: true
    });

    renderShapesList();
}

function toggleShape(id) {
    const s = shapes.find(x => x.id === id);
    if (!s) return;

    s.visible = !s.visible;

    if (s.visible)
        measureLayer.addLayer(s.layer);
    else
        measureLayer.removeLayer(s.layer);

    renderShapesList();
}

function deleteShape(id) {
    const idx = shapes.findIndex(x => x.id === id);
    if (idx === -1) return;

    measureLayer.removeLayer(shapes[idx].layer);
    shapes.splice(idx, 1);

    renderShapesList();
}

function renderShapesList() {

    const list = document.getElementById("shapes-list");

    if (!list) return;

    if (shapes.length === 0) {
        list.innerHTML =
            '<div class="shapes-empty">No measurements yet</div>';
        return;
    }

    list.innerHTML = shapes.map(s => `
        <div class="shape-item${s.visible ? "" : " faded"}">

            <span class="shape-icon">
                ${s.type === "distance" ? "📏" : "📐"}
            </span>

            <span class="shape-label">${s.label}</span>

            <div class="shape-actions">

                <button
                    class="shape-btn vis"
                    onclick="toggleShape(${s.id})"
                    title="${s.visible ? "Hide" : "Show"}">

                    ${s.visible ? "●" : "○"}

                </button>

                <button
                    class="shape-btn del"
                    onclick="deleteShape(${s.id})"
                    title="Delete">

                    ✕

                </button>

            </div>

        </div>
    `).join("");
}

function setMeasureMode(mode) {

    if (measureMode === mode) {
        endMeasureMode();
        return;
    }

    endMeasureMode();

    measureMode = mode;

    map.getContainer().style.cursor = "crosshair";

    document
        .getElementById("btn-measure-dist")
        .classList.toggle("active", mode === "distance");

    document
        .getElementById("btn-measure-area")
        .classList.toggle("active", mode === "area");

    showFinishBtn(true);

    setHint(
        mode === "distance"
            ? "🖱 Click to add points"
            : "🖱 Click to draw polygon"
    );
}

function endMeasureMode() {
    measureMode = null;
    measurePoints = [];

    clearTempDraw();
    map.getContainer().style.cursor = "";

    ["btn-measure-dist", "btn-measure-area"].forEach(id =>
        document.getElementById(id)?.classList.remove("active")
    );

    showFinishBtn(false);
    setHint("");
}

function clearTempDraw() {
    measureMarkers.forEach(m => measureLayer.removeLayer(m));
    measureMarkers = [];

    if (measurePath) {
        measureLayer.removeLayer(measurePath);
        measurePath = null;
    }
}

function clearAllMeasurements() {
    endMeasureMode();
    measureLayer.clearLayers();
    shapes.length = 0;
    renderShapesList();
}

function showFinishBtn(show) {
    const btn = document.getElementById("btn-finish");
    if (btn) btn.style.display = show ? "block" : "none";
}

function setHint(text) {
    const el = document.getElementById("measure-hint");
    if (!el) return;

    el.textContent = text;
    el.style.display = text ? "block" : "none";
}

/* ── FINISH BUTTON ────────────────────────────────────────── */

function finishCurrentMeasure() {
    if (!measureMode) return;

    if (measureMode === "distance") {
        if (measurePoints.length < 2) {
            setHint("⚠ Add at least 2 points first");
            return;
        }
        finishDistance();
    }
    else {
        if (measurePoints.length < 3) {
            setHint("⚠ Add at least 3 points first");
            return;
        }
        finishArea();
    }

    endMeasureMode();
}

function fmtDist(km) {
    return km < 1
        ? `${(km * 1000).toFixed(1)} m`
        : `${km.toFixed(3)} km`;
}

function fmtArea(sqm) {
    return sqm >= 10000
        ? `${(sqm / 10000).toFixed(2)} ha`
        : `${sqm.toFixed(1)} m²`;
}

map.on("click", e => {
    if (!measureMode) return;
    measurePoints.push([e.latlng.lng, e.latlng.lat]);

    const marker = L.circleMarker(
        [e.latlng.lat, e.latlng.lng],
        {
            radius: 4,
            color: "#fff",
            weight: 2,
            fillColor: "#f0a500",
            fillOpacity: 1
        }
    ).addTo(measureLayer);

    measureMarkers.push(marker);
    const n = measurePoints.length;

    if (measureMode === "distance") {
        setHint(
            `${n} point${n !== 1 ? "s" : ""} · click for more, or Finish`
        );
    }
    else {
        const need = Math.max(0, 3 - n);
        setHint(
            need > 0
                ? `${n} point${n !== 1 ? "s" : ""} · need ${need} more`
                : `${n} points · click for more, or Finish`
        );
    }

    redrawPreview();
});

function redrawPreview() {
    if (measurePath)
        measureLayer.removeLayer(measurePath);
    if (measurePoints.length < 2)
        return;

    measurePath = L.polyline(
        measurePoints.map(([lng, lat]) => [lat, lng]),
        {
            color: "#f0a500",
            weight: 2,
            dashArray: "6 4",
            opacity: 0.85
        }
    ).addTo(measureLayer);
}

function finishDistance() {
    const dist = turf.length(
        turf.lineString(measurePoints),
        { units: "kilometers" }
    );

    const label = fmtDist(dist);
    const grp = L.featureGroup([
        L.polyline(
            measurePoints.map(([lng, lat]) => [lat, lng]),
            {
                color: "#f0a500",
                weight: 2.5
            }
        )
    ]).addTo(measureLayer);

    const last = measurePoints.at(-1);
    L.popup({ closeButton: true })
        .setLatLng([last[1], last[0]])
        .setContent(`
            <div class="popup-name">📏 ${label}</div>
            <span class="popup-badge building">Distance</span>
        `)
        .openOn(map);
    addShapeToRegistry("distance", label, grp);
}

function finishArea() {
    const closed = [...measurePoints, measurePoints[0]];
    const poly = turf.polygon([closed]);
    const sqm = turf.area(poly);
    const label = fmtArea(sqm);

    const grp = L.featureGroup([
        L.polygon(
            measurePoints.map(([lng, lat]) => [lat, lng]),
            {
                color: "#3fb950",
                weight: 2,
                fillColor: "#3fb950",
                fillOpacity: 0.15
            }
        )
    ]).addTo(measureLayer);

    const [lng, lat] = turf.centroid(poly).geometry.coordinates;
    L.popup({ closeButton: true })
        .setLatLng([lat, lng])
        .setContent(`
            <div class="popup-name">📐 ${label}</div>
            <span class="popup-badge park">Area</span>
        `)
        .openOn(map);
    addShapeToRegistry("area", label, grp);
}

renderShapesList();
