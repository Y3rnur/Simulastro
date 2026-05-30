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

// Viewport dimensions
const VIEW_SIZE = 800;
canvas.width = VIEW_SIZE;
canvas.height = VIEW_SIZE;

// Coordinate mapping parameters
const SCREEN_CENTER = VIEW_SIZE / 2;
const ZOOM_SCALE = 2.0;

const socket = new WebSocket('ws://localhost:8080/ws');

socket.onopen = () => {
    statusEl.textContent = 'Connected';
    statusEl.className = 'connected';
    console.log('🛰️ Live WebSocket Telemetry link established with Go Hub.');
};

// Data intake
socket.onmessage = (event) => {
    const telemetryFrame = JSON.parse(event.data);

    // Update control panel stats dashboard fields
    frameEl.textContent = telemetryFrame.frameNumber || 0;
    timeEl.textContent = (telemetryFrame.timestamp || 0).toFixed(3);
    bodiesEl.textContent = telemetryFrame.bodies ? telemetryFrame.bodies.length : 0;

    // Initiate canvas draw sequence for received frame
    renderSimulationFrame(telemetryFrame.bodies || []);
};

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

        ctx.FillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.fillText(`ID:${body.id}`, screenX + 12, screenY + 4);
    });
}

// UI Button actions
playBtn.onclick = () =>  {
    socket.send("PLAY");
    console.log("📤 Sent Command: PLAY");
};

pauseBtn.onclick = () => {
    socket.send("PAUSE");
    console.log("📤 Sent Command: PAUSE")
};

historyBtn.onclick = () => {
    socket.send("FETCH_HISTORY");
    console.log("📤 Sent Command: FETCH_HISTORY");
};