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

// Viewport dimensions
const VIEW_SIZE = 800;
canvas.width = VIEW_SIZE;
canvas.height = VIEW_SIZE;

// Coordinate mapping parameters
const SCREEN_CENTER = VIEW_SIZE / 2;
let ZOOM_SCALE = 0.1;

// Local history memory array
let historicalTimelineCache = [];

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

// Data intake
socket.onmessage = (event) => {
    try {
        const packet = JSON.parse(event.data);

        // Handle timeline history blocks
        if (packet.type === "HISTORY") {
            console.log(`🕒 History payload received. Captured ${packet.frames.length} frames.`);
            historicalTimelineCache = packet.frames || [];

            if (historicalTimelineCache.length > 0) {
                // Unlock and configure range timeline slider
                timeSlider.disabled = false;
                timeSlider.style.cursor = "pointer";
                timeSlider.min = 0;
                timeSlider.max = historicalTimelineCache.length - 1;
                timeSlider.value = historicalTimelineCache.length - 1; // Default to final snapshot position

                updateSliderLabel(historicalTimelineCache.length - 1, historicalTimelineCache.length);

                // instantly render the final frame of downloaded timeline
                renderHistoryFrameIndex(historicalTimelineCache.length - 1);
            }
            return;
        }

        // Handle live streaming updates
        if (packet.type === "LIVE") {
            const telemetryFrame = packet.payload;
            
            console.log('LIVE', telemetryFrame.frameNumber, telemetryFrame.timestamp);
            if (telemetryFrame.bodies && telemetryFrame.bodies.length) {
                telemetryFrame.bodies.forEach(b => {
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

            // Initiate canvas draw sequence for received frame
            renderSimulationFrame(telemetryFrame.bodies || []);
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

    // Render coordinates using canvas loop
    renderSimulationFrame(targetFrame.bodies || []);
}

// radius computing helper
function computeDisplayRadius(body) {
    let rawRadius = (body.radius !== undefined && body.radius !== null)
        ? body.radius
        : Math.cbrt(Math.max(body.mass || 1e-6, 1e-6)) * 0.0005;
    let px = rawRadius * ZOOM_SCALE;
    px = Math.max(4, Math.min(px, 35)); // clamp range (px)
    return px;
}

// Rendering pipeline
function renderSimulationFrame(bodies) {
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, SCREEN_CENTER); ctx.lineTo(VIEW_SIZE, SCREEN_CENTER);
    ctx.moveTo(SCREEN_CENTER, 0); ctx.lineTo(SCREEN_CENTER, VIEW_SIZE);
    ctx.stroke();

    bodies.forEach(body => {
        // zero value float optimization (Protobuf drops 0.0)
        const rawX = body.x !== undefined && body.x !== null ? body.x : 0.0;
        const rawY = body.y !== undefined && body.y !== null ? body.y : 0.0;

        // false boolean optimization (Protobuf drops false)
        const isAlive = body.alive !== undefined && body.alive !== null ? body.alive : false;

        // coordinate transformation
        const screenX = SCREEN_CENTER + (rawX * ZOOM_SCALE);
        const screenY = SCREEN_CENTER - (rawY * ZOOM_SCALE);
        
        // draw the planet as circle — compute radius from engine-provided radius or mass fallback
        const displayRadius = computeDisplayRadius(body);
        
        ctx.save();

        if (isAlive) {
            ctx.globalAlpha = 0.35;  // dead bodies become ghostly trails
        }

        ctx.beginPath();
        ctx.arc(screenX, screenY, displayRadius, 0, 2 * Math.PI);

        ctx.fillStyle = isAlive ? '#38bdf8' : '#ef4444';
        ctx.shadowBlur = isAlive ? 12 : 0;
        ctx.shadowColor = '#0284c7';

        ctx.fill();
        ctx.closePath();

        ctx.shadowBlur = 0;
        ctx.fillStyle = isAlive ? '#94a3b8' : '#78716c';
        ctx.font = '10px monospace';
        ctx.fillText(`ID:${body.id}${!body.alive ? ' (DEAD)' : ''}`, screenX + displayRadius + 6, screenY + 4);

        ctx.restore();
    });
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
    if (e.deltaY > 0) ZOOM_SCALE *= 0.9;  // Zoom out
    else ZOOM_SCALE *= 1.1;               // Zoom in
});