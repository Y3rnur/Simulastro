// website configurations
const wsProto = (location.protocol === 'https:') ? 'wss://' : 'ws://';
const wsUrl = wsProto + location.host + '/ws';
const socket = new WebSocket(wsUrl);

// Canvas configurations
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// UI Info Panel Element Bindings
const statusEl = document.getElementById('connectionStatus');
const frameEl = document.getElementById('telemetryFrame');
const timeEl = document.getElementById('telemetryTime');
const bodiesEl = document.getElementById('telemetryBodies');

// Interactive Control Buttons
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const historyBtn = document.getElementById('historyBtn');

const timeSlider = document.getElementById('timeSlider');
const sliderIndexDisplay = document.getElementById('sliderIndexDisplay');

const speedSlider = document.getElementById('speedSlider');
const speedLabel = document.getElementById('speedLabel');
const presetButtons = document.querySelectorAll('.preset-buttons button');

// Viewport dimensions
const VIEW_SIZE = 800;
canvas.width = VIEW_SIZE;
canvas.height = VIEW_SIZE;

let lastRenderTime = performance.now();

// Coordinate mapping parameters
const SCREEN_CENTER = VIEW_SIZE / 2;
let ZOOM_SCALE = 0.1;

// Local history memory array
let historicalTimelineCache = [];

// Trail config
let TRAIL_MAX_POINTS = 60;
let TRAIL_OPACITY = 0.9;
let TRAIL_MIN_OPACITY = 0.02;
let TRAIL_LINE_WIDTH = 1.5;

// Trails map
const trails = new Map();

// Explosion config
const EXPLOSION_MIN_PARTICLES = 12;
const EXPLOSION_MAX_PARTICLES = 60;
const EXPLOSION_BASE_SPEED = 150;    // world units/sec
const EXPLOSION_SPEED_VARIANCE = 60;
const EXPLOSION_PARTICLE_MIN_TTL = 300;  // ms
const EXPLOSION_PARTICLE_MAX_TTL = 2400; // ms
const EXPLOSION_PARTICLE_MAX_SIZE = 4;
const EXPLOSION_PARTICLE_MIN_SIZE = 1;
const EXPLOSION_FADE_DURATION_MS = 1200;

// Explosion runtime state
const exploded = new Set();           // body IDs that already exploded (one-shot)
const hiddenBodies = new Set();       // body IDs to skip rendering (post-explosion)
const explosions = new Map();         // id -> { particles: [{x,y,vx,vy,ttl,age,size,color}], startedAt }
const deathFades = new Map();         // id -> { alpha: number, remainingMs: number }

// Auto-zoom config
const AUTO_ZOOM_TARGET_FRACTION = 0.05;
const AUTO_ZOOM_MIN = 0.000001;
const AUTO_ZOOM_MAX = 10.0;

let autoZoomDone = false;
let userAdjustedZoom = false;
let currentHistoryIndex = null;

let currentLiveFrame = null;
let currentHistoryFrame = null;

// Placement mode state
let placementMode = true;
let placementBodies = [];       // local array of placed bodies
let nextBodyId = 1000;          // start id for user-placed bodies
let placementPos = null;        // first click world pos {x, y}
let placementHoverPos = null;
const DENSITY = 2000.0;         // matching with engine's density value

// Placement modal bindings
const placementToggle = document.getElementById('placementToggle');
const massSlider = document.getElementById('massSlider');
const massLabel = document.getElementById('massLabel');
const velocityScaleInput = document.getElementById('velocityScale');
const uploadSceneBtn = document.getElementById('uploadSceneBtn');
const clearPlacementBtn = document.getElementById('clearPlacementBtn');

socket.onopen = () => {
    statusEl.textContent = 'Connected';
    statusEl.className = 'connected';
    console.log('🛰️ Live WebSocket Telemetry link established with Go Hub.');
};

socket.onclose = () => {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'disconnected';
    console.log('❌ Telemetry connection dropped.');
}

function normalizeBody(b) {
    return {
        id: b.id,
        x: (b.x !== undefined && b.x !== null) ? Number(b.x) : 0.0,
        y: (b.y !== undefined && b.y !== null) ? Number(b.y) : 0.0,
        vx: (b.vx !== undefined && b.vx !== null) ? Number(b.vx) : 0.0,
        vy: (b.vy !== undefined && b.vy !== null) ? Number(b.vy) : 0.0,
        mass: (b.mass !== undefined && b.mass !== null) ? Number(b.mass) : 0.0,
        radius: (b.radius !== undefined && b.radius !== null) ? Number(b.radius) : 0.0,
        alive: (b.alive !== undefined && b.alive !== null) ? Boolean(b.alive) : false,
    };
}

const worldToScreen = (wx, wy) => {
        const sx = SCREEN_CENTER + wx * ZOOM_SCALE;
        const sy = SCREEN_CENTER - wy * ZOOM_SCALE;
        return { x: sx, y: sy};
    };

function velocityFromDrag(start, end, scale) {
    return {
        vx: (end.x - start.x) * scale,
        vy: (end.y - start.y) * scale
    };
}

function screenToWorld(sx, sy) {
    return {
        x: (sx - SCREEN_CENTER) / ZOOM_SCALE,
        y: (SCREEN_CENTER - sy) / ZOOM_SCALE
    };
}

function massFromLog(logVal) {
    return Math.pow(10, logVal);
}

function radiusFromMass(mass) {
    const volume = (3.0 * mass) / (4.0 * Math.PI * DENSITY);
    return Math.cbrt(Math.max(volume, 0));
}

canvas.addEventListener('pointermove', (ev) => {
    if (!placementMode || !placementPos) return;

    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;

    placementHoverPos = screenToWorld(sx, sy);
});

canvas.addEventListener('pointerleave', () => {
    placementHoverPos = null;
});

canvas.addEventListener('pointerdown', (ev) => {
    if (!placementToggle.checked) return;   // only works in placement mode

    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const world = screenToWorld(sx, sy);

    if (!placementPos) {
        // first click -> set base position and preview
        placementPos = world;
        placementHoverPos = world;
        return;
    }

    // second click -> set velocity
    const velocityScale = Number(velocityScaleInput.value) || 0.01;
    const velocity = velocityFromDrag(placementPos, world, velocityScale);

    const logMass = Number(massSlider.value);
    const mass = massFromLog(logMass);
    const radius = radiusFromMass(mass);

    placementBodies.push({
        id: nextBodyId++,
        mass,
        radius,
        x: placementPos.x,
        y: placementPos.y,
        vx: velocity.vx,
        vy: velocity.vy,
        alive: true
    });
    
    placementPos = null;
    placementHoverPos = null;
});

function updateTrails(frame) {
    if (!frame || !frame.bodies) return;
    const idsSeen = new Set();

    for (const b of frame.bodies) {

        const isAlive = b.alive !== undefined && b.alive !== null ? b.alive : false;

        if (!isAlive) continue;

        const id = b.id;
        idsSeen.add(id);

        const x = Number(b.x);
        const y = Number(b.y);

        let arr = trails.get(id);
        if (!arr) {
            arr = [];
            trails.set(id, arr);
        }

        // append current position (circular behaviour)
        arr.push({ x, y });
        if (arr.length > TRAIL_MAX_POINTS) arr.shift();
    }

    // cleanup of dead or gone planets
    for (const id of Array.from(trails.keys())) {
        if (!idsSeen.has(id)) {
            trails.delete(id);
        }
    }
}

function drawTrails(ctx) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = TRAIL_LINE_WIDTH;

    for (const [id, arr] of trails.entries()) {
        if (!arr || arr.length < 2) continue;

        const n = arr.length;
        for (let i = 1; i < n; ++i) {
            const p0 = worldToScreen(arr[i - 1].x, arr[i - 1].y);
            const p1 = worldToScreen(arr[i].x, arr[i].y);

            // fade from tail
            const t = i / (n - 1);
            const alpha = TRAIL_MIN_OPACITY + (TRAIL_OPACITY - TRAIL_MIN_OPACITY) * t;

            const rgb = '255,200,0';
            ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;

            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
        }
    }

    ctx.restore();
}

// build per-body trails for a history frame index
function buildHistoryTrailsForIndex(idx) {
    trails.clear();
    if (!historicalTimelineCache || historicalTimelineCache.length === 0) return;

    const start = Math.max(0, idx - TRAIL_MAX_POINTS + 1);
    for (let i = start; i <= idx; i++) {
        const frame = historicalTimelineCache[i];
        if (!frame || !frame.bodies) continue;
        for (const raw of frame.bodies) {
            const b = normalizeBody(raw);
            let arr = trails.get(b.id);
            if (!arr) {
                arr = [];
                trails.set(b.id, arr);
            }
            arr.push({ x: b.x, y: b.y });
            
            if (arr.length > TRAIL_MAX_POINTS) arr.shift();
        }
    }
}

function triggerExplosionFromBody(body) {
    const id = body.id;
    if (exploded.has(id)) return;
    exploded.add(id);

    const count = Math.min(EXPLOSION_MAX_PARTICLES,
                  Math.max(EXPLOSION_MIN_PARTICLES, Math.floor((body.radius || 1) * 0.6)));

    const parts = [];
    const inheritVx = Number(body.vx || 0) * 0.25;
    const inheritVy = Number(body.vy || 0) * 0.25;

    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const intensity = Math.sqrt(body.radius || 10) * 2;
        const speed = (EXPLOSION_BASE_SPEED + (Math.random() * EXPLOSION_SPEED_VARIANCE)) * intensity;
        const vx = Math.cos(angle) * speed + (Math.random() - 0.5) * 10 + inheritVx;
        const vy = Math.sin(angle) * speed + (Math.random() - 0.5) * 10 + inheritVy;
        const ttl = EXPLOSION_PARTICLE_MIN_TTL + Math.random() * (EXPLOSION_PARTICLE_MAX_TTL - EXPLOSION_PARTICLE_MIN_TTL);
        const size = EXPLOSION_PARTICLE_MIN_SIZE + Math.random() * (EXPLOSION_PARTICLE_MAX_SIZE - EXPLOSION_PARTICLE_MIN_SIZE);

        const color = `255,150,40`;

        parts.push({
            x: Number(body.x),
            y: Number(body.y),
            vx, vy,
            ttl,
            age: 0,
            size,
            color
        });
    }

    explosions.set(id, { particles: parts, startedAt: performance.now() });
    console.log(`💥 triggerExplosion: id=${id} particles=${parts.length}, pos=(${body.x},${body.y})`);
}

function updateExplosions(deltaMs) {
    for (const [id, ex] of explosions.entries()) {
        const parts = ex.particles;
        const dt = deltaMs / 1000.0;

        for (let p of parts) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= 0.995;
            p.vy *= 0.995;
            p.age += deltaMs;
        }

        ex.particles = parts.filter(p => p.age < p.ttl);

        if (ex.particles.length === 0) {
            explosions.delete(id);
            hiddenBodies.add(id);
        }
    }
}

function updateDeathFades(deltaMs) {
    const done = [];
    for (const [id, s] of deathFades.entries()) {
        s.remainingMs -= deltaMs;
        s.alpha = Math.max(0, s.remainingMs / EXPLOSION_FADE_DURATION_MS);
        if (s.remainingMs <= 0) done.push(id);
    }
    for (const id of done) {
        deathFades.delete(id);
        hiddenBodies.add(id);
    }
}

function drawExplosions(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [id, ex] of explosions.entries()) {
        for (const p of ex.particles) {
            const t = Math.max(0, 1 - p.age / p.ttl);
            const alpha = t;    // linear fade
            const { x: sx, y: sy } = worldToScreen(p.x, p.y);
            ctx.fillStyle = `rgba(${p.color}, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

let previousLiveBodiesMap = new Map();

// Data intake
socket.onmessage = (event) => {
    const packet = JSON.parse(event.data);

    if (packet.type === 'LIVE') {
        const payloadBodies = packet.payload.bodies || [];

        for (const raw of payloadBodies) {
            const body = normalizeBody(raw);
            const prev = previousLiveBodiesMap.get(body.id);

            if (prev && prev.alive && !body.alive) {
                // trigger particle explosion when previously alive body become dead
                triggerExplosionFromBody(body);

                deathFades.set(body.id, {
                    alpha: 1.0,
                    remainingMs: typeof EXPLOSION_FADE_DURATION_MS !== 'undefined' ? EXPLOSION_FADE_DURATION_MS : 1500
                });
            }
        }

        previousLiveBodiesMap.clear();
        for (const raw of payloadBodies) {
            const body = normalizeBody(raw);
            previousLiveBodiesMap.set(body.id, body);
        }

        currentLiveFrame = packet.payload;
        currentHistoryFrame = null;
        updateTrails(packet.payload);

        if (!autoZoomDone && packet.payload.bodies && packet.payload.bodies.length) {
            autoFitZoomForBodies(packet.payload.bodies);
        }
        return;
    }

    if (packet.type === 'HISTORY') {
        historicalTimelineCache = packet.frames || [];
        currentHistoryFrame = historicalTimelineCache[historicalTimelineCache.length - 1] || null;
        currentLiveFrame = null;
        previousLiveBodiesMap.clear();
        return;
    }
};

// Timeline range slider movements
timeSlider.oninput = (e) => {
    const selectedIndex = parseInt(e.target.value, 10);
    updateSliderLabel(selectedIndex, historicalTimelineCache.length);

    currentHistoryIndex = selectedIndex;
    currentHistoryFrame = historicalTimelineCache[selectedIndex];

    // Sync info dashboard with historical point values
    frameEl.textContent = currentHistoryFrame.frameNumber || 0;
    timeEl.textContent = (currentHistoryFrame.timestamp || 0).toFixed(3);
    bodiesEl.textContent = currentHistoryFrame.bodies ? currentHistoryFrame.bodies.length : 0;

    buildHistoryTrailsForIndex(selectedIndex);
}

function updateSliderLabel(current, total) {
    sliderIndexDisplay.textContent = `${current + 1}/${total}`;
}

// radius computing helper
function computeDisplayRadius(body) {
    let rawRadius;

    if (body.radius !== undefined && body.radius !== null && body.radius > 0) {
        rawRadius = body.radius;
    } else {
        const mass = Math.max(body.mass || 0, 1e-12);
        const density = 2000.0;
        const volume = (3.0 * mass) / (4.0 * Math.PI * density);
        rawRadius = Math.cbrt(volume);
    }

    let px = rawRadius * ZOOM_SCALE;

    return Math.max(4, px);
}

// helper to compute radius
function rawRadiusFromBody(body) {
    if (!body) return 0;
    if (body.radius !== undefined && body.radius !== null && body.radius > 0) {
        return Number(body.radius);
    }
    const mass = Math.max(Number(body.mass || 0), 1e-12);
    const density = 2000.0;
    const volume = (3.0 * mass) / (4.0 * Math.PI * density);
    return Math.cbrt(volume);
}

// auto-fit function
function autoFitZoomForBodies(bodies, targetFraction = AUTO_ZOOM_TARGET_FRACTION) {
    if (userAdjustedZoom) return;
    if (!bodies || !bodies.length) return;

    let maxRaw = 0;
    for (const raw of bodies) {
        const b = normalizeBody(raw);
        const r = rawRadiusFromBody(b);
        if (r > maxRaw) maxRaw = r;
    }
    if (maxRaw <= 0) return;

    const targetPx = VIEW_SIZE * targetFraction;
    let newScale = targetPx / maxRaw;
    newScale = Math.max(AUTO_ZOOM_MIN, Math.min(AUTO_ZOOM_MAX, newScale));

    ZOOM_SCALE = newScale;

    autoZoomDone = true;
}

function renderSceneBase() {
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, SCREEN_CENTER);
    ctx.lineTo(VIEW_SIZE, SCREEN_CENTER);
    ctx.moveTo(SCREEN_CENTER, 0);
    ctx.lineTo(SCREEN_CENTER, VIEW_SIZE);
    ctx.stroke(); 
}

function drawPlacementOverlay() {
    if (!placementMode) return;

    // draw placed bodies
    for (const body of placementBodies) {
        const { x: sx, y: sy } = worldToScreen(body.x, body.y);
        const radiusPx = Math.max(4, body.radius * ZOOM_SCALE);

        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#7c3aed';
        ctx.beginPath();
        ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // draw preview (if first point set)
    if (placementPos) {
        const previewRadius = radiusFromMass(massFromLog(Number(massSlider.value)));
        const previewScreen = worldToScreen(placementPos.x, placementPos.y);
        const previewRadiusPx = Math.max(4, previewRadius * ZOOM_SCALE);

        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(previewScreen.x, previewScreen.y, previewRadiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    if (placementPos && placementHoverPos) {
        const start = worldToScreen(placementPos.x, placementPos.y);
        const end = worldToScreen(placementHoverPos.x, placementHoverPos.y);

        ctx.save();
        ctx.strokeStyle = '#22c55e';
        ctx.fillStyle = '#22c55e';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 12;

        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

function renderBodiesFromFrame(frameBodies, isHistory = false) {
    for (const raw of frameBodies || []) {
        const body = normalizeBody(raw);

        let bodyAlpha = 1.0;
        if (!isHistory && !body.alive) {
            const df = deathFades.get(body.id);
            bodyAlpha = df ? df.alpha : 0;
        }
        if (bodyAlpha <= 0) continue;

        const { x: sx, y: sy } = worldToScreen(body.x, body.y);
        const radiusPx = computeDisplayRadius(body);

        ctx.save();
        ctx.globalAlpha = bodyAlpha;

        ctx.fillStyle = body.alive ? '#38bdf8' : '#ef4444';
        ctx.shadowBlur = body.alive ? 12 : 0;
        ctx.shadowColor = '#0284c7';
        ctx.beginPath();
        ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = body.alive ? '#94a3b8' : '#78716c';
        ctx.font = '10px monospace';
        ctx.fillText(`ID:${body.id}${!body.alive ? ' (DEAD)' : ''}`, sx + radiusPx + 6, sy + 4)

        ctx.restore();
    }
}

// main rendering loop logic
function renderLoop(now) {
    const deltaMs = Math.min(now - lastRenderTime, 200);
    lastRenderTime = now;

    renderSceneBase();
    drawTrails(ctx);

    if (currentHistoryFrame) {
        renderBodiesFromFrame(currentHistoryFrame.bodies, true);
    } else if (currentLiveFrame) {
        updateExplosions(deltaMs);
        updateDeathFades(deltaMs);
        drawExplosions(ctx);
        renderBodiesFromFrame(currentLiveFrame.bodies, false);
    }

    drawPlacementOverlay();
    requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);

function sendSpeed(mult) {
    const msg = JSON.stringify({ type: 'SET_SPEED', multiplier: Number(mult) });
    socket.send(msg);
}

// UI Button actions
playBtn.onclick = () => {
    exploded.clear();
    explosions.clear();
    deathFades.clear();
    previousLiveBodiesMap.clear();

    // upload placement bodies
    if (placementBodies.length > 0) {
        sendUploadScene(() => {
            sendControl('PLAY');
            if (placementToggle) placementToggle.checked = false;
            placementMode = false;
        });
    } else {
        sendControl('PLAY');
        if (placementToggle) placementToggle.checked = false;
        placementMode = false;
    }

    // Lock the timeline slider while simulation is playing forward live
    timeSlider.disabled = true;
    timeSlider.style.cursor = "not-allowed";
    historyBtn.disabled = true;
    currentHistoryIndex = null;
    console.log("📤 Sent Command: PLAY");
};

pauseBtn.onclick = () => {
    sendControl('PAUSE');
    historyBtn.disabled = false;
    if (placementToggle) {
        placementToggle.checked = true;
    }
    placementMode = true;
    
    console.log("📤 Sent Command: PAUSE")
};

historyBtn.onclick = () => {
    socket.send(JSON.stringify({ type: 'FETCH_HISTORY' }));
    console.log("📤 Sent Command: FETCH_HISTORY");
};

placementToggle.onchange = (e) => {
    placementMode = e.target.checked;
};

// Add a simple window event listener or bind to an input slider to zoom on the fly
window.addEventListener('wheel', (e) => {
    userAdjustedZoom = true;
    if (e.deltaY > 0) ZOOM_SCALE *= 0.9;  // Zoom out
    else ZOOM_SCALE *= 1.1;               // Zoom in
    ZOOM_SCALE = Math.max(AUTO_ZOOM_MIN, Math.min(AUTO_ZOOM_MAX, ZOOM_SCALE));

    if (currentHistoryIndex !== null) {
        buildHistoryTrailsForIndex(currentHistoryIndex);
    }
});

// Speed slider
speedSlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    speedLabel.textContent = `${val.toFixed(1)}x`;
    sendSpeed(val);
});

// Speed preset buttons
presetButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const val = Number(btn.dataset.speed);
        speedSlider.value = val;
        speedLabel.textContent = `${val.toFixed(1)}x`;
        sendSpeed(val);
    });
});

// Mass slider
massSlider.addEventListener('input', () => {
    const logVal = Number(massSlider.value);
    const mass = massFromLog(logVal);
    massLabel.textContent = mass.toExponential(2);
});

clearPlacementBtn.addEventListener('click', () => {
    placementBodies = [];
    placementPos = null;
})

uploadSceneBtn.addEventListener('click', () => {
    sendUploadScene();
})

function sendUploadScene(cb) {
    const scene = { 
        bodies: placementBodies
    };
    socket.send(JSON.stringify({
        type: 'UPLOAD_SCENE',
        scene
    }));

    if (cb) cb();
}

function sendControl(cmd) {
    socket.send(JSON.stringify({ type: 'CONTROL', command: cmd}));
}