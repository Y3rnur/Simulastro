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
const EXPLOSION_BASE_SPEED = 100;    // world units/sec
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

const socket = new WebSocket('ws://localhost:8080/ws');

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
        const speed = EXPLOSION_BASE_SPEED + (Math.random() * EXPLOSION_SPEED_VARIANCE);
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
    const doneIds = [];

    for (const [id, ex] of explosions.entries()) {
        const parts = ex.particles;
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            const dt = deltaMs / 1000.0;
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            p.vx *= 0.995;
            p.vy *= 0.995;
            p.age += deltaMs;
            if (p.age >= p.ttl) parts.splice(i, 1);
        }
        if (parts.length === 0) {
            doneIds.push(id);
        }
    }

    for (const id of doneIds) {
        explosions.delete(id);
        hiddenBodies.add(id);
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

// Data intake
socket.onmessage = (event) => {
    try {
        const packet = JSON.parse(event.data);

        // Handle timeline history blocks
        if (packet.type === "HISTORY") {
            console.log(`🕒 History payload received. Captured ${packet.frames.length} frames.`);
            historicalTimelineCache = packet.frames || [];

            // clear live visual state so live traces don't pollute history view
            trails.clear();
            explosions.clear();
            deathFades.clear();
            console.log("🧹 Cleared live trails/explosions before rendering history");

            if (historicalTimelineCache.length > 0) {
                // Unlock and configure range timeline slider
                timeSlider.disabled = false;
                timeSlider.style.cursor = "pointer";
                timeSlider.min = 0;
                timeSlider.max = historicalTimelineCache.length - 1;
                timeSlider.value = historicalTimelineCache.length - 1; // Default to final snapshot position

                updateSliderLabel(historicalTimelineCache.length - 1, historicalTimelineCache.length);

                const last = historicalTimelineCache[historicalTimelineCache.length - 1];
                if (last && last.bodies && last.bodies.length) {
                    autoFitZoomForBodies(last.bodies);
                }

                // instantly render the final frame of downloaded timeline
                renderHistoryFrameIndex(historicalTimelineCache.length - 1);
            }
            return;
        }

        // Handle live streaming updates
        if (packet.type === "LIVE") {
            const telemetryFrame = packet.payload;

            if (!autoZoomDone && telemetryFrame.bodies && telemetryFrame.bodies.length) {
                autoFitZoomForBodies(telemetryFrame.bodies);
            }
            
            console.log('LIVE', telemetryFrame.frameNumber, telemetryFrame.timestamp);
            if (telemetryFrame.bodies && telemetryFrame.bodies.length) {
                for (const raw of telemetryFrame.bodies) {
                    const b = normalizeBody(raw);

                    if (!b.alive) {
                        triggerExplosionFromBody(b);
                        trails.delete(b.id);
                        if (!deathFades.has(b.id) && !hiddenBodies.has(b.id)) {
                            deathFades.set(b.id, { alpha: 1.0, remainingMs: EXPLOSION_FADE_DURATION_MS });
                        }
                    } else {
                        hiddenBodies.delete(b.id);
                        deathFades.delete(b.id);
                    }
                }
                telemetryFrame.bodies.forEach(raw => {
                    const b = normalizeBody(raw);
                    const sx = SCREEN_CENTER + (b.x * ZOOM_SCALE);
                    const sy = SCREEN_CENTER - (b.y * ZOOM_SCALE);
                    const dr = computeDisplayRadius(b);
                    
                    console.log(`BODY id=${b.id} x=${b.x} y=${b.y} sx=${sx.toFixed(2)} sy=${sy.toFixed(2)} r=${dr.toFixed(2)} alive=${b.alive}`);
                });
            } else {
                console.log('NO BODIES in payload');
            }

            // Update control panel stats dashboard fields
            frameEl.textContent = telemetryFrame.frameNumber || 0;
            timeEl.textContent = (telemetryFrame.timestamp || 0).toFixed(3);
            bodiesEl.textContent = telemetryFrame.bodies ? telemetryFrame.bodies.length : 0;

            updateTrails(telemetryFrame);

            // Initiate canvas draw sequence for received frame
            renderSimulationFrame(telemetryFrame.bodies || [], false);
        }
    } catch (err) {
        console.error("❌ Telemetry Parsing Error:", err);
    }
};

// Timeline range slider movements
timeSlider.oninput = (e) => {
    const selectedIndex = parseInt(e.target.value, 10);
    updateSliderLabel(selectedIndex, historicalTimelineCache.length);
    renderHistoryFrameIndex(selectedIndex);
}

function updateSliderLabel(current, total) {
    sliderIndexDisplay.textContent = `${current + 1}/${total}`;
}

function renderHistoryFrameIndex(index) {
    const targetFrame = historicalTimelineCache[index];
    if (!targetFrame) return;

    // Sync info dashboard with historical point values
    frameEl.textContent = targetFrame.frameNumber || 0;
    timeEl.textContent = (targetFrame.timestamp || 0).toFixed(3);
    bodiesEl.textContent = targetFrame.bodies ? targetFrame.bodies.length : 0;

    // build trails that reflect historical motion
    buildHistoryTrailsForIndex(index);

    // Render coordinates using canvas loop
    renderSimulationFrame(targetFrame.bodies || [], true);
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

// Rendering pipeline
function renderSimulationFrame(bodies, isHistory = false) {
    const now = performance.now();
    let deltaMs = now - lastRenderTime;
    if (deltaMs > 200) deltaMs = 200;
    lastRenderTime = now;

    const normBodies = (bodies || []).map(normalizeBody);

    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, SCREEN_CENTER); ctx.lineTo(VIEW_SIZE, SCREEN_CENTER);
    ctx.moveTo(SCREEN_CENTER, 0); ctx.lineTo(SCREEN_CENTER, VIEW_SIZE);
    ctx.stroke();

    if (!isHistory) {
        drawTrails(ctx);
        updateExplosions(deltaMs);
        updateDeathFades(deltaMs);
        drawExplosions(ctx);
    } else {
        drawTrails(ctx);
    }

    normBodies.forEach(body => {
        if (!isHistory && hiddenBodies.has(body.id)) return;

        // coordinate transformation
        const screenX = SCREEN_CENTER + (body.x * ZOOM_SCALE);
        const screenY = SCREEN_CENTER - (body.y * ZOOM_SCALE);
        
        // draw the planet as circle — compute radius from engine-provided radius or mass fallback
        const displayRadius = computeDisplayRadius(body);
        
        ctx.save();

        let bodyAlpha = 1.0;
        if (!isHistory) {
            if (!body.alive) {
                const df = deathFades.get(body.id);
                bodyAlpha = df ? df.alpha : 0.35;
            }
        }

        if (bodyAlpha <= 0) return; // skip drawing the fully faded body

        ctx.save();
        ctx.globalAlpha = bodyAlpha;

        ctx.beginPath();
        ctx.arc(screenX, screenY, displayRadius, 0, 2 * Math.PI);

        ctx.fillStyle = body.alive ? '#38bdf8' : '#ef4444';
        ctx.shadowBlur = body.alive ? 12 : 0;
        ctx.shadowColor = '#0284c7';

        ctx.fill();
        ctx.closePath();

        ctx.shadowBlur = 0;
        ctx.fillStyle = body.alive ? '#94a3b8' : '#78716c';
        ctx.font = '10px monospace';
        ctx.fillText(`ID:${body.id}${!body.alive ? ' (DEAD)' : ''}`, screenX + displayRadius + 6, screenY + 4);

        ctx.restore();
    });
}

function sendSpeed(mult) {
    const msg = JSON.stringify({ type: 'SET_SPEED', multiplier: Number(mult) });
    socket.send(msg);
}

// UI Button actions
playBtn.onclick = () => {
    // Lock the timeline slider while simulation is playing forward live
    timeSlider.disabled = true;
    timeSlider.style.cursor = "not-allowed";
    historyBtn.disabled = true;
    socket.send("PLAY");
    console.log("📤 Sent Command: PLAY");
};

pauseBtn.onclick = () => {
    socket.send("PAUSE");
    historyBtn.disabled = false;
    console.log("📤 Sent Command: PAUSE")
};

historyBtn.onclick = () => {
    socket.send("FETCH_HISTORY");
    console.log("📤 Sent Command: FETCH_HISTORY");
};

// Add a simple window event listener or bind to an input slider to zoom on the fly
window.addEventListener('wheel', (e) => {
    userAdjustedZoom = true;
    if (e.deltaY > 0) ZOOM_SCALE *= 0.9;  // Zoom out
    else ZOOM_SCALE *= 1.1;               // Zoom in
    ZOOM_SCALE = Math.max(AUTO_ZOOM_MIN, Math.min(AUTO_ZOOM_MAX, ZOOM_SCALE));
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