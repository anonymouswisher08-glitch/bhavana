// Load env variables
require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

// Import model
const Message = require("./models/Message");
const ThankYou = require("./models/ThankYou");
const ActivityLog = require("./models/ActivityLog");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const roomMembers = new Map();

const PORT = Number(process.env.PORT) || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("MONGO_URI is not set. Add it in your .env file.");
    process.exit(1);
}

// --------------------
// MongoDB Atlas Connection
// --------------------
mongoose.connect(MONGO_URI)
.then(() => console.log("MongoDB Atlas connected"))
.catch(err => {
    console.error("DB connection error:", err);
    process.exit(1);
});

// --------------------
// Middleware
// --------------------
app.use(express.static(path.join(__dirname, "public")));

function sanitizeInput(value) {
    return typeof value === "string" ? value.trim() : "";
}

function isValidRoom(room) {
    return room.length >= 1 && room.length <= 64;
}

function isValidMessage(msg) {
    return msg.length >= 1 && msg.length <= 1000;
}

function isValidSender(sender) {
    return sender === "a" || sender === "b";
}

function normalizeLocation(rawLocation) {
    if (!rawLocation || typeof rawLocation !== "object") {
        return undefined;
    }

    const lat = Number(rawLocation.lat);
    const lng = Number(rawLocation.lng);
    const accuracy = Number(rawLocation.accuracy);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return undefined;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return undefined;
    }

    return {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : undefined
    };
}

function normalizeMetadata(rawMetadata) {
    if (!rawMetadata || typeof rawMetadata !== "object") {
        return undefined;
    }

    try {
        return JSON.parse(JSON.stringify(rawMetadata));
    } catch (err) {
        return undefined;
    }
}

async function logActivity({
    eventType,
    room,
    sender,
    socketId,
    ip,
    userAgent,
    location,
    metadata
}) {
    try {
        await ActivityLog.create({
            eventType,
            room,
            sender,
            socketId,
            ip,
            userAgent,
            location,
            metadata,
            time: new Date()
        });
    } catch (err) {
        console.error("Activity log error:", err);
    }
}

// --------------------
// Socket.IO Logic
// --------------------
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    const ip = socket.handshake.address || "";
    const userAgent = socket.handshake.headers["user-agent"] || "";

    logActivity({
        eventType: "socket_connected",
        socketId: socket.id,
        ip,
        userAgent
    });

    socket.on("pageOpen", async (payload) => {
        const sender = sanitizeInput(payload?.sender) || "guest";
        const room = sanitizeInput(payload?.room) || "birthday-page";
        const location = normalizeLocation(payload?.location);
        const metadata = normalizeMetadata({
            locationPermission: sanitizeInput(payload?.locationPermission) || "unknown"
        });

        await logActivity({
            eventType: "page_opened",
            room,
            sender,
            socketId: socket.id,
            ip,
            userAgent,
            location,
            metadata
        });
    });

    // Join Room
    socket.on("joinRoom", async (payload) => {
        const room = sanitizeInput(payload?.room);
        const sender = sanitizeInput(payload?.sender).toLowerCase();

        if (!isValidRoom(room)) {
            socket.emit("errorMessage", "Invalid room. Use 1-64 characters.");
            return;
        }

        if (!isValidSender(sender)) {
            socket.emit("errorMessage", "User ID must be only 'a' or 'b'.");
            return;
        }

        if (!roomMembers.has(room)) {
            roomMembers.set(room, new Map());
        }

        const members = roomMembers.get(room);
        const existing = [...members.values()];
        const roomHasSender = existing.includes(sender);
        const roomSize = members.size;

        if (roomSize >= 2 && !members.has(socket.id)) {
            socket.emit("errorMessage", "This room already has 2 users.");
            return;
        }

        if (roomHasSender && members.get(socket.id) !== sender) {
            socket.emit("errorMessage", `User ID '${sender}' is already in this room.`);
            return;
        }

        members.set(socket.id, sender);

        socket.join(room);
        socket.data.room = room;
        socket.data.sender = sender;
        console.log(`User joined room: ${room}`);
        logActivity({
            eventType: "room_joined",
            room,
            sender,
            socketId: socket.id,
            ip,
            userAgent
        });

        try {
            const messages = await Message.find({ room }).sort({ time: 1 }).limit(200);
            socket.emit("loadMessages", messages);
        } catch (err) {
            console.error("Error loading messages:", err);
            socket.emit("errorMessage", "Could not load messages.");
        }
    });

    // Send Message
    socket.on("message", async (payload) => {
        const room = sanitizeInput(payload?.room);
        const msg = sanitizeInput(payload?.msg);
        const sender = sanitizeInput(payload?.sender).toLowerCase();
        const location = normalizeLocation(payload?.location);

        if (!isValidRoom(room)) {
            socket.emit("errorMessage", "Invalid room.");
            return;
        }

        if (!isValidMessage(msg)) {
            socket.emit("errorMessage", "Message must be 1-1000 characters.");
            return;
        }

        if (!isValidSender(sender)) {
            socket.emit("errorMessage", "User ID must be only 'a' or 'b'.");
            return;
        }

        if (socket.data.room !== room || socket.data.sender !== sender) {
            socket.emit("errorMessage", "Join room as 'a' or 'b' before sending.");
            return;
        }

        try {
            const newMsg = new Message({
                room,
                text: msg,
                sender,
                location,
                time: new Date()
            });

            await newMsg.save();
            logActivity({
                eventType: "message_sent",
                room,
                sender,
                socketId: socket.id,
                ip,
                userAgent,
                location,
                metadata: normalizeMetadata({ textLength: msg.length })
            });

            // Emit to all users in room
            io.to(room).emit("message", newMsg);
        } catch (err) {
            console.error("Error saving message:", err);
            socket.emit("errorMessage", "Could not send message.");
        }
    });

    socket.on("thankYou", async (payload) => {
        const room = sanitizeInput(payload?.room) || "birthday-page";
        const sender = sanitizeInput(payload?.sender) || "guest";
        const location = normalizeLocation(payload?.location);
        const metadata = normalizeMetadata(payload?.metadata);

        if (!isValidRoom(room)) {
            socket.emit("errorMessage", "Invalid room.");
            return;
        }

        if (sender.length > 64) {
            socket.emit("errorMessage", "Invalid sender.");
            return;
        }

        try {
            const thankYou = new ThankYou({
                room,
                sender,
                time: new Date()
            });

            await thankYou.save();
            logActivity({
                eventType: "thank_you_clicked",
                room,
                sender,
                socketId: socket.id,
                ip,
                userAgent,
                location,
                metadata
            });
            socket.emit("thankYouSaved", { time: thankYou.time });
        } catch (err) {
            console.error("Error saving thank you:", err);
            socket.emit("errorMessage", "Could not save thank you.");
        }
    });

    // Disconnect
    socket.on("disconnect", () => {
        const room = socket.data.room;
        const sender = socket.data.sender;
        if (room && roomMembers.has(room)) {
            const members = roomMembers.get(room);
            members.delete(socket.id);
            if (members.size === 0) {
                roomMembers.delete(room);
            }
        }
        logActivity({
            eventType: "socket_disconnected",
            room,
            sender,
            socketId: socket.id,
            ip,
            userAgent
        });
        console.log("User disconnected:", socket.id);
    });
});

// --------------------
// Start Server (local only)
// --------------------
if (process.env.VERCEL !== "1") {
    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

module.exports = app;
