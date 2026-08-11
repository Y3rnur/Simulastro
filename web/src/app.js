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
const saveSceneBtn = document.getElementById('saveSceneBtn');

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

// Camera movement pan offset parameters
let cameraOffsetX = 0;
let cameraOffsetY = 0;
let isDraggingCamera = false;
let cameraDragStart = { x: 0, y: 0 };

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
const placementControls = document.getElementById('placementControls');
const placementToggle = document.getElementById('placementToggle');
const massSlider = document.getElementById('massSlider');
const massLabel = document.getElementById('massLabel');
const velocityScaleInput = document.getElementById('velocityScale');
const uploadSceneBtn = document.getElementById('uploadSceneBtn');
const clearPlacementBtn = document.getElementById('clearPlacementBtn');

// Mouse hover/click on bodies logic
let hoveredBodyId = null;       // ID of body currently under the mouse
let pinnedBodyId = null;          // ID of body currently pinned via click

// Body inspector bindings
const inspectorCard = document.getElementById('bodyInspectorCard');
const inspId = document.getElementById('inspId');
const inspMass = document.getElementById('inspMass');
const inspRadius = document.getElementById('inspRadius');
const inspPos = document.getElementById('inspPos');
const inspSpeed = document.getElementById('inspSpeed');
const inspectorPinStatus = document.getElementById('inspectorPinStatus');

// Auth UI bindings
const authEmailInput = document.getElementById('authEmailInput');
const authPasswordInput = document.getElementById('authPasswordInput');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loggedOutView = document.getElementById('loggedOutView');
const loggedInView = document.getElementById('loggedInView');
const userDisplayNameDisplay = document.getElementById('userDisplayNameDisplay');

// Register modal bindings
const registerModal = document.getElementById('registerModal');
const openRegisterModalBtn = document.getElementById('openRegisterModalBtn');
const closeRegisterModalBtn = document.getElementById('closeRegisterModalBtn');
const submitRegisterBtn = document.getElementById('submitRegisterBtn');
const regDisplayName = document.getElementById('regDisplayName');
const regEmail = document.getElementById('regEmail');
const regPassword = document.getElementById('regPassword');
const regErrorMsg = document.getElementById('regErrorMsg');

let selectedSceneId = null;

// Load scene modal bindings
const loadSceneModal = document.getElementById('loadSceneModal');
const openLoadModalBtn = document.getElementById('openLoadModalBtn');
const closeLoadModalBtn = document.getElementById('closeLoadModalBtn');
const refreshScenesModalBtn = document.getElementById('refreshScenesModalBtn');
const modalSceneListContainer = document.getElementById('modalSceneListContainer');
const confirmLoadSceneBtn = document.getElementById('confirmLoadSceneBtn');

// Save confirm modal bindings
const saveConfirmModal = document.getElementById('saveConfirmModal');
const confirmSaveBtn = document.getElementById('confirmSaveBtn');
const cancelSaveBtn = document.getElementById('cancelSaveBtn');

// Edit scene modal bindings
const editSceneModal = document.getElementById('editSceneModal');
const closeEditModalBtn = document.getElementById('closeEditModalBtn');
const cancelEditModalBtn = document.getElementById('cancelEditModalBtn');
const confirmEditSceneBtn = document.getElementById('confirmEditSceneBtn');
const editSceneNameInput = document.getElementById('editSceneNameInput');
const editSceneDescInput = document.getElementById('editSceneDescInput');

let editingSceneId = null;

let currentUser = JSON.parse(localStorage.getItem('astrophysics_user')) || null;

function updateAuthUI() {
    if (currentUser) {
        loggedOutView.style.display = 'none';
        loggedInView.style.display = 'block';
        userDisplayNameDisplay.textContent = currentUser.display_name;
    } else {
        loggedOutView.style.display = 'block';
        loggedInView.style.display = 'none';
        authEmailInput.value = '';
        authPasswordInput.value = '';
    }
}
updateAuthUI();

// Modal open/close triggers
openRegisterModalBtn.addEventListener('click', () => {
    registerModal.style.display = 'flex';
    regErrorMsg.style.display = 'none';
});

closeRegisterModalBtn.addEventListener('click', () => {
    registerModal.style.display = 'none';
});

// Login handler
loginBtn.addEventListener('click', async () => {
    const email = authEmailInput.value.trim();
    const password = authPasswordInput.value.trim();

    if (!email || !password) return alert('Please enter both email and password.');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (response.ok) {
            currentUser = data; // { display_name, email, message }
            localStorage.setItem('astrophysics_user', JSON.stringify(currentUser));
            updateAuthUI();
        } else {
            alert(data.message || 'Login failed');
        }
    } catch (err) {
        console.error('Login network error:', err);
        alert('Failed to connect to backend server.');
    }
});

// Logout handler
logoutBtn.addEventListener('click', () => {
    currentUser = null;
    localStorage.removeItem('astrophysics_user');
    updateAuthUI();
});

// Registration submit handler
submitRegisterBtn.addEventListener('click', async () => {
    const display_name = regDisplayName.value.trim();
    const email = regEmail.value.trim();
    const password = regPassword.value.trim();

    if (!display_name || !email || !password) {
        regErrorMsg.textContent = 'All fields are required.';
        regErrorMsg.style.display = 'block';
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name, email, password })
        });
        const data = await response.json();

        if (response.ok) {
            alert('Registration successful! You can now log in.');
            registerModal.style.display = 'none';
            authEmailInput.value = email;
            regDisplayName.value = '';
            regEmail.value = '';
            regPassword.value = '';
        } else {
            regErrorMsg.textContent = data.message || 'Registration failed.';
            regErrorMsg.style.display = 'block';
        }
    } catch (err) {
        console.error('Registration network error:', err);
        regErrorMsg.textContent = 'Server connection error.';
        regErrorMsg.style.display = 'block';
    }
});

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
        const sx = SCREEN_CENTER + (wx + cameraOffsetX) * ZOOM_SCALE;
        const sy = SCREEN_CENTER - (wy + cameraOffsetY) * ZOOM_SCALE;
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
        x: (sx - SCREEN_CENTER) / ZOOM_SCALE - cameraOffsetX,
        y: (SCREEN_CENTER - sy) / ZOOM_SCALE - cameraOffsetY
    };
}

function massFromLog(logVal) {
    return Math.pow(10, logVal);
}

function radiusFromMass(mass) {
    const volume = (3.0 * mass) / (4.0 * Math.PI * DENSITY);
    return Math.cbrt(Math.max(volume, 0));
}

function updateInspectorCard(body, isPinned, clientX, clientY) {
    if (!body) {
        if (!pinnedBodyId) {
            inspectorCard.style.display = 'none';
        }
        return;
    }

    inspId.textContent = body.id + (!body.alive ? ' (DEAD)' : '');
    inspMass.textContent = body.mass.toExponential(2);

    const speed = Math.sqrt((body.vx || 0) ** 2 + (body.vy || 0) ** 2);
    inspSpeed.textContent = speed.toFixed(2);

    const radiusRow = inspRadius.parentElement;
    const posRow = inspPos.parentElement;

    inspRadius.textContent = body.radius.toFixed(1);
    inspPos.textContent = `${body.x.toFixed(1)}, ${body.y.toFixed(1)}`;

    if (isPinned) {
        inspRadius.textContent = body.radius.toFixed(3);
        inspPos.textContent = `${body.x.toFixed(1)}, ${body.y.toFixed(1)}`;
        if (radiusRow) radiusRow.style.display = 'block';
        if (posRow) posRow.style.display = 'block';

        inspectorPinStatus.textContent = 'PINNED (CLICK TO UNPIN)';
        inspectorPinStatus.style.color = '#22c55e';
        inspectorPinStatus.style.background = 'rgba(34, 197, 94, 0.1)';
    } else {
        if (radiusRow) radiusRow.style.display = 'none';
        if (posRow) posRow.style.display = 'none';

        inspectorPinStatus.textContent = 'HOVERING';
        inspectorPinStatus.style.color = '#f59e0b';
        inspectorPinStatus.style.background = 'rgba(245, 158, 11, 0.1)';
    }

    inspectorCard.style.display = 'block';

    const screenPos = worldToScreen(body.x, body.y);

    if (isPinned) {
        // position pinned card near target body
        inspectorCard.style.left = `${screenPos.x + 15}px`;
        inspectorCard.style.top = `${screenPos.y + 15}px`;
    } else {
        // position pinned card near mouse cursor
        inspectorCard.style.left = `${clientX + 15}px`;
        inspectorCard.style.top = `${clientY + 15}px`;
    }
}

canvas.addEventListener('pointermove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;

    if (isDraggingCamera) {
        const dx = ev.clientX - cameraDragStart.x;
        const dy = ev.clientY - cameraDragStart.y;
        
        // Adjust camera offset inversely relative to zoom scale
        cameraOffsetX += dx / ZOOM_SCALE;
        cameraOffsetY -= dy / ZOOM_SCALE;
        
        cameraDragStart = { x: ev.clientX, y: ev.clientY };
        return;
    }

    // Handle placement hover line if in placement mode & drawing vector
    if (placementMode && placementPos) {
        placementHoverPos = screenToWorld(sx, sy);
    }

    // Handle body inspection hover (only if not pinned to a body)
    if (!pinnedBodyId) {
        const hoveredBody = findBodyAtScreenCord(sx, sy);
        if (hoveredBody) {
            hoveredBodyId = hoveredBody.id;
            updateInspectorCard(hoveredBody, false, ev.clientX, ev.clientY);
        } else {
            hoveredBodyId = null;
            inspectorCard.style.display = 'none';
        }
    }
});

canvas.addEventListener('pointerup', () => {
    if (isDraggingCamera) {
        isDraggingCamera = false;
        canvas.style.cursor = placementToggle.checked ? 'crosshair' : 'grab';
    }
});

canvas.addEventListener('pointerleave', () => {
    placementHoverPos = null;
    if (isDraggingCamera) {
        isDraggingCamera = false;
        canvas.style.cursor = placementToggle.checked ? 'crosshair' : 'grab';
    }
});

canvas.addEventListener('pointerdown', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;

    const clickedBody = findBodyAtScreenCord(sx, sy);
    if (clickedBody) {
        if (pinnedBodyId === clickedBody.id) {
            // unpin if clicking the same body again
            pinnedBodyId = null;
            inspectorCard.style.display = 'none';
        } else {
            // pin to this body
            pinnedBodyId = clickedBody.id;
            updateInspectorCard(clickedBody, true, ev.clientX, ev.clientY);
        }
        return;
    } else if (pinnedBodyId) {
        // clicked empty space while pinned -> unpin
        pinnedBodyId = null;
        inspectorCard.style.display = 'none';
    }

    if (!placementToggle.checked) {
        isDraggingCamera = true;
        cameraDragStart = { x: ev.clientX, y: ev.clientY };
        canvas.style.cursor = 'grabbing';
        return;
    }
    
    if (currentHistoryFrame) {
        currentHistoryFrame = null;
        currentHistoryIndex = null;
        trails.clear();
        timeSlider.disabled = true;
        timeSlider.style.cursor = "not-allowed";

        placementMode = true;
        if (placementToggle) placementToggle.checked = true;
        if (placementControls) placementControls.style.display = 'block';

        console.log("🔄 Exited history mode via canvas click.");
    }

    if (!placementToggle.checked) return;

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

function findBodyAtScreenCord(sx, sy) {
    let candidateBodies = [];

    if (currentHistoryFrame && currentHistoryFrame.bodies) {
        candidateBodies = currentHistoryFrame.bodies.map(normalizeBody);
    } else if (!placementMode && currentLiveFrame && currentLiveFrame.bodies) {
        candidateBodies = currentLiveFrame.bodies.map(normalizeBody);
    } else if (placementMode && placementBodies.length > 0) {
        candidateBodies = placementBodies;
    } else if (currentLiveFrame && currentLiveFrame.bodies) {
        // fallback to live bodies if available
        candidateBodies = currentLiveFrame.bodies.map(normalizeBody);
    }

    for (const rawBody of candidateBodies) {
        const body = normalizeBody(rawBody);

        // ignore dead bodies
        if (!body.alive) continue;

        const screenPos = worldToScreen(body.x, body.y);
        const radiusPx = Math.max(6, body.radius * ZOOM_SCALE);

        const dx = sx - screenPos.x;
        const dy = sy - screenPos.y;
        const distSq = dx * dx + dy * dy;

        // Check if mouse is within body radius (also a padding for ease of click)
        const hitRadius = Math.max(radiusPx, 10);
        if (distSq <= hitRadius * hitRadius) {
            return body;
        }
    }
    return null;
}

function updateNextBodyId(bodies) {
    if (!bodies || bodies.length === 0) return;
    const maxId = bodies.reduce((max, b) => Math.max(max, Number(b.id) || 0), 0);
    nextBodyId = Math.max(1000, maxId + 1);
    console.log(`🔄 nextBodyId synchronized to: ${nextBodyId}`);
}

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

        placementMode = false;
        if (placementToggle) placementToggle.checked = false;
        if (placementControls) placementControls.style.display = 'none';
        canvas.style.cursor = 'grab';

        if (historicalTimelineCache.length > 0) {
            timeSlider.min = 0;
            timeSlider.max = historicalTimelineCache.length - 1;

            const lastIndex = historicalTimelineCache.length - 1;
            timeSlider.value = lastIndex;
            timeSlider.disabled = false;
            timeSlider.style.cursor = "pointer";

            currentHistoryIndex = lastIndex;
            currentHistoryFrame = historicalTimelineCache[lastIndex];
            currentLiveFrame = null;

            updateSliderLabel(lastIndex, historicalTimelineCache.length);

            if (currentHistoryFrame) {
                frameEl.textContent = currentHistoryFrame.frameNumber || 0;
                timeEl.textContent = (currentHistoryFrame.timestamp || 0).toFixed(3);
                bodiesEl.textContent = currentHistoryFrame.bodies ? currentHistoryFrame.bodies.length : 0;
            }
        }
        
        previousLiveBodiesMap.clear();
        return;
    }

    if (packet.type === 'SCENE_LIST') {
        console.log("Received scenes list:", packet.scenes);
        renderSceneList(packet.scenes);
    }

    if (packet.type === 'LOADED_SCENE') {
        console.log("Loaded scene bodies into placement array:", packet.scene);
        placementMode = true;
        currentHistoryFrame = null;
        currentLiveFrame = null;
        historicalTimelineCache = [];
        
        // Map backend bodies directly into frontend placement array
        placementBodies = packet.scene.bodies.map((b, index) => ({
            id: b.id || (1000 + index),
            mass: b.mass,
            radius: b.radius,
            x: b.x,
            y: b.y,
            vx: b.vx || 0,
            vy: b.vy || 0,
            alive: true
        }));

        updateNextBodyId(placementBodies);

        if (typeof timeSlider !== 'undefined' && timeSlider) {
            timeSlider.value = 0;
            timeSlider.disabled = true;
        }

        if (placementToggle) placementToggle.checked = true;
        if (placementControls) placementControls.style.display = 'block';

        if (loadSceneModal) {
            loadSceneModal.style.display = 'none';
        }
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
    if (!placementMode || currentHistoryFrame) return;

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

    // pinned inspector card telemetry tick
    if (pinnedBodyId) {
        let pinnedBody = null;

        const candidateBodies = (currentLiveFrame && currentLiveFrame.bodies) 
            ? currentLiveFrame.bodies.map(normalizeBody) 
            : placementBodies;

        const found = candidateBodies.find(b => b.id === pinnedBodyId);
        if (found && found.alive) {
            pinnedBody = found;
            // update the card with fresh stats and re-anchor its position to the moving body
            updateInspectorCard(pinnedBody, true, 0, 0);
        } else {
            // if pinned body exploded or disappeared, auto-unpin the card
            pinnedBodyId = null;
            inspectorCard.style.display = 'none';
        }
    }

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
            canvas.style.cursor = 'grab';
        });
    } else {
        sendControl('PLAY');
        if (placementToggle) placementToggle.checked = false;
        placementMode = false;
        canvas.style.cursor = 'grab';
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
    canvas.style.cursor = 'crosshair';
    
    console.log("📤 Sent Command: PAUSE")
};

historyBtn.onclick = () => {
    socket.send(JSON.stringify({ type: 'FETCH_HISTORY' }));
    console.log("📤 Sent Command: FETCH_HISTORY");
};

if (placementControls && placementToggle) {
    placementControls.style.display = placementToggle.checked ? 'block' : 'none';

    canvas.style.cursor = placementToggle.checked ? 'crosshair' : 'grab';

    placementToggle.onchange = (e) => {
        placementMode = e.target.checked;
        placementControls.style.display = placementMode ? 'block' : 'none';

        canvas.style.cursor = placementMode ? 'crosshair' : 'grab';
        isDraggingCamera = false;

        if (placementMode && currentHistoryFrame) {
            currentHistoryFrame = null;
            currentHistoryIndex = null;
            trails.clear();
            timeSlider.disabled = true;
            timeSlider.style.cursor = "not-allowed";
            console.log("🛠️ Exited history mode via Placement Mode checkbox.");
        }
    };
} else {
    console.warn("⚠️ Warning: placementControls or placementToggle element not found in DOM yet!")
}

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

window.addEventListener('keydown', (ev) => {
    if (!placementMode || currentHistoryFrame) return;
    // Check for Ctrl+Z (or Cmd+Z on Mac)
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault(); // Prevent browser default undo if any

        // Priority 1: Cancel active placement draft if we are currently dragging a vector
        if (placementPos) {
            placementPos = null;
            placementHoverPos = null;
            console.log("↩️ Canceled active placement draft.");
            return;
        }

        // Priority 2: Pop the last successfully placed body if array is not empty
        if (placementBodies.length > 0) {
            const removed = placementBodies.pop();
            console.log("↩️ Undid last placed body:", removed.id);
        }
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

function sendSaveScene() {
    if (placementBodies.length === 0) {
        console.warn("⚠️ No bodies on canvas to save!");
        return;
    }

    const payload = {
        type: 'SAVE_SCENE',
        scene: {
            bodies: placementBodies.map((b, index) => ({
                id: b.id || index,
                mass: b.mass,
                radius: b.radius,
                x: b.x,
                y: b.y,
                vx: b.vx || 0,
                vy: b.vy || 0,
                alive: true
            }))
        }
    };

    socket.send(JSON.stringify(payload));
    console.log("💾 Sent payload: SAVE_SCENE to PostgreSQL");
}

if (saveSceneBtn) {
    saveSceneBtn.onclick = () => {
        if (placementBodies.length === 0) {
            console.warn("⚠️ No bodies on canvas to save!");
            return;
        }

        if (saveConfirmModal) {
            saveConfirmModal.style.display = 'flex';
        }
    };
}

if (confirmSaveBtn) {
    confirmSaveBtn.onclick = () => {
        sendSaveScene();
        if (saveConfirmModal) saveConfirmModal.style.display = 'none';
    }
}

if (cancelSaveBtn) {
    cancelSaveBtn.onclick = () => {
        if (saveConfirmModal) saveConfirmModal.style.display = 'none';
    };
}

// Open modal & request list
if (openLoadModalBtn) {
    openLoadModalBtn.onclick = () => {
        loadSceneModal.style.display = 'flex';
        requestSceneList();
    };
}

// Close modal
if (closeLoadModalBtn) {
    closeLoadModalBtn.onclick = () => {
        loadSceneModal.style.display = 'none';
    };
}

// Refresh list button inside modal
if (refreshScenesModalBtn) {
    refreshScenesModalBtn.onclick = () => {
        requestSceneList();
    };
}

// Confirm Load Action
if (confirmLoadSceneBtn) {
    confirmLoadSceneBtn.onclick = () => {
        if (selectedSceneId) {
            socket.send(JSON.stringify({ 
                type: 'LOAD_SCENE', 
                scene_id: selectedSceneId 
            }));
            console.log(`📤 Requested load for scene ID: ${selectedSceneId}`);
            loadSceneModal.style.display = 'none';
        }
    };
}

// Helper for LIST_SCENES
function requestSceneList() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'LIST_SCENES' }));
        console.log("📤 Requested user scenes list");
    } else {
        console.warn("⚠️ WebSocket not connected");
    }
}

// Function to render scenes list (called when SCENE_LIST message arrives from backend)
function renderSceneList(scenes) {
    modalSceneListContainer.innerHTML = '';
    selectedSceneId = null;
    confirmLoadSceneBtn.disabled = true;

    if (!scenes || scenes.length === 0) {
        modalSceneListContainer.innerHTML = '<div style="color: #64748b; font-size: 0.8rem; text-align: center; padding: 12px;">No saved scenes found.</div>';
        return;
    }

    scenes.forEach(scene => {
        const row = document.createElement('div');
        row.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: #0f172a; border: 1px solid #1e293b; padding: 8px 10px; border-radius: 4px; cursor: pointer; transition: border-color 0.2s;";
        
        const textWrapper = document.createElement('div');
        textWrapper.style.cssText = "display: flex; flex-direction: column; flex: 1; overflow: hidden; margin-right: 8px;";

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = "font-size: 0.8rem; color: #f8fafc; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
        nameSpan.textContent = scene.name;
        nameSpan.title = scene.name;

        const descSpan = document.createElement('span');
        descSpan.style.cssText = "font-size: 0.7rem; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;";
        const sceneDesc = scene.descriptions || scene.Descriptions || "";
        descSpan.textContent = sceneDesc ? sceneDesc : "No description provided.";

        textWrapper.appendChild(nameSpan);
        textWrapper.appendChild(descSpan);

        row.onclick = () => {
            document.querySelectorAll('.scene-row-item').forEach(r => r.style.borderColor = '#1e293b');
            row.style.borderColor = '#38bdf8';
            selectedSceneId = scene.id;
            confirmLoadSceneBtn.removeAttribute('disabled');
        };
        row.classList.add('scene-row-item');

        // Actions container (Edit & Delete buttons)
        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = "display: flex; gap: 4px; align-items: center;";

        // Edit Button
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️';
        editBtn.title = 'Edit Scene Metadata';
        editBtn.style.cssText = "background: rgba(56, 189, 248, 0.1); border: 1px solid #0369a1; color: #38bdf8; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 0.75rem;";
        
        editBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent selecting row
            editingSceneId = scene.id;
            editSceneNameInput.value = scene.name;
            editSceneDescInput.value = sceneDesc;
            editSceneModal.style.display = 'flex';
        };

        // Delete Button payload sender
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑️';
        deleteBtn.title = 'Delete Scene';
        deleteBtn.style.cssText = "background: rgba(239, 68, 68, 0.1); border: 1px solid #7f1d1d; color: #ef4444; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 0.75rem; margin-left: 8px;";
        
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete scene "${scene.name}"?`)) {
                socket.send(JSON.stringify({
                    type: 'DELETE_SCENE',
                    scene_id: scene.id
                }));
                console.log(`📤 Requested deletion for scene ID: ${scene.id}`);
            }
        };

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);

        row.appendChild(textWrapper);
        row.appendChild(actionsDiv);
        modalSceneListContainer.appendChild(row);
    });
}

confirmEditSceneBtn.onclick = () => {
    if (!editingSceneId) return;

    const newName = editSceneNameInput.value.trim();
    const newDesc = editSceneDescInput.value.trim();

    if (!newName) {
        alert("Scene name cannot be empty!");
        return;
    }

    socket.send(JSON.stringify({
        type: 'UPDATE_SCENE',
        scene_id: editingSceneId,
        name: newName,
        descriptions: newDesc
    }));

    console.log(`📤 Requested update for scene ID: ${editingSceneId}`);
    closeEditModal();
};

function closeEditModal() {
    editSceneModal.style.display = 'none';
    editingSceneId = null;
}
closeEditModalBtn.onclick = closeEditModal;
cancelEditModalBtn.onclick = closeEditModal;

function sendControl(cmd) {
    socket.send(JSON.stringify({ type: 'CONTROL', command: cmd}));
}