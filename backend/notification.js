// notify_server.js
import { WebSocketServer } from 'ws';
import express from 'express';
import bodyParser from 'body-parser';

const PORT = 9000;
const app = express();
app.use(bodyParser.json());

// This map acts as our live registry of connections.
// Key: "client_C1" or "driver_D1", Value: WebSocket connection object
const connections = new Map();

// --- HTTP Server for Internal Communication ---
// The Queue Server will call this endpoint when a match is made.
app.post('/send-notification', (req, res) => {
    const { targetId, payload } = req.body;
    console.log(`🔔 Received request to notify ${targetId}`);

    const targetSocket = connections.get(targetId);

    if (targetSocket && targetSocket.readyState === WebSocket.OPEN) { 
        targetSocket.send(JSON.stringify(payload));
        console.log(`  ✅ Notification sent successfully to ${targetId}.`);
        res.status(200).json({ success: true, message: 'Notification sent.' });
    } else {
        console.log(`  ❌ Could not find an active connection for ${targetId}.`);
        res.status(404).json({ success: false, message: 'Target client/driver not connected.' });
    }
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Notification Server's HTTP listener running on port ${PORT}`);
});

// --- WebSocket Server for Client/Driver Connections ---
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
    let connectionId = null; // To keep track of who this connection belongs to

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // The first message from any client/driver MUST be for registration
            if (data.type === 'register') {
                connectionId = data.id; // e.g., "client_C1" or "driver_D1"
                connections.set(connectionId, ws);
                console.log(`✅ Registered and connected: ${connectionId}`);
                ws.send(JSON.stringify({ type: 'info', message: 'Successfully registered.' }));
            }
        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        if (connectionId) {
            connections.delete(connectionId);
            console.log(`❌ Disconnected: ${connectionId}`);
        }
    });
});

// Attach the WebSocket server to the HTTP server
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});