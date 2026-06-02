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
const ZOOM_SCALE = 25.0;

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
        // coordinate transformation
        const screenX = SCREEN_CENTER + (body.x * ZOOM_SCALE);
        const screenY = SCREEN_CENTER - (body.y * ZOOM_SCALE);
        
        // draw the planet as circle
        ctx.beginPath();
        ctx.arc(screenX, screenY, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#38bdf8';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#0284c7';
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.fillText(`ID:${body.id}`, screenX + 12, screenY + 4);
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