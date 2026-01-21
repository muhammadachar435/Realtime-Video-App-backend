/* eslint-disable no-undef */

require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const cors = require("cors");

app.use(express.json());
app.use(bodyParser.json());

// CORS for REST endpoints
app.use(
  cors({
    origin: [
      "https://realtime-video-app-frontend.vercel.app", // production frontend
      "http://localhost:5173", // optional: local frontend for testing
    ],
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// ---------- Socket.IO ----------
const io = new Server(server, {
  cors: {
    origin: [
      "https://realtime-video-app-frontend.vercel.app",
      "http://localhost:5173", // optional: local frontend
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});



const emailSockettoMapping = new Map();
const socketToEmailMapping = new Map();

// connection built
io.on("connection", (socket) => {
  console.log("New Connection: ", socket.id);

  socket.on("join-room", (data) => {
    const { roomId, emailId, name } = data;

    if (!roomId || !emailId || !name) {
      return;
    }

    // Store mappings
    emailSockettoMapping.set(emailId, socket.id);
    socketToEmailMapping.set(socket.id, { emailId, name });

    // Join room
    socket.join(roomId);

    // room Users
    const usersInRoom = Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
      (id) => socketToEmailMapping.get(id)?.name || "Unknown",
    );
    io.to(roomId).emit("room-users", { users: usersInRoom });

    usersInRoom.forEach((userSocketId) => {
      const userInfo = socketToEmailMapping.get(userSocketId);
      socket.emit("user-joined", userInfo);
    });

    // Notify others that new user joined
    socket.to(roomId).emit("user-joined", { emailId, name, socketId: socket.id });

    // Notify self that joined
    socket.emit("joined-room", {
      roomId,
      emailId,
      name,
      socketId: socket.id,
    });

    // Send room count to everyone in room
    const roomCount = io.sockets.adapter.rooms.get(roomId)?.size || 1;
    io.to(roomId).emit("room-update", { count: roomCount });

    console.log(`User ${emailId} joined room ${roomId}`);
  });

  // Call user handler
  socket.on("call-user", ({ emailId, offer }) => {
    const toSocketId = emailSockettoMapping.get(emailId);
    const callerEmail = socketToEmailMapping.get(socket.id);

    console.log(`Call from ${callerEmail.emailId} (${socket.id}) to ${emailId} (${toSocketId})`);

    if (toSocketId) {
      io.to(toSocketId).emit("incoming-call", {
        from: socket.id,
        fromEmail: callerEmail.emailId,
        fromName: callerEmail.name,
        offer,
      });
      console.log(`Call forwarded to ${toSocketId}`);
    } else {
      console.log(`User ${emailId} not found`);
      socket.emit("user-not-found", { emailId });
    }
  });

  // call-accepted
  socket.on("call-accepted", ({ to, ans }) => {
    const user = socketToEmailMapping.get(socket.id);
    io.to(to).emit("call-accepted", {
      ans,
      from: socket.id,
      fromEmail: user.emailId,
      fromName: user.name,
    });
  });

  // ICE Candidate exchange
  socket.on("ice-candidate", ({ to, candidate }) => {
    console.log(`ICE Candidate from ${socket.id} to ${to}`);
    io.to(to).emit("ice-candidate", {
      candidate,
      from: socket.id,
    });
  });

  socket.on("camera-toggle", ({ cameraOn, roomId }) => {
    socket.to(roomId).emit("camera-toggle", { cameraOn });
  });

  // Chat-message
  socket.on("chat-message", ({ roomId, from, text }) => {
    console.log("Chat message:", roomId, from, text);

    // Get sender info
    const sender = socketToEmailMapping.get(from);

    // Send with sender name
    socket.to(roomId).emit("chat-message", {
      from,
      text,
      senderName: sender?.name || "Guest", // THIS LINE FIXES IT
    });
  });

  // Disconnect handler
  socket.on("disconnect", () => {
    const user = socketToEmailMapping.get(socket.id);
    if (user) {
      const { emailId } = user;
      emailSockettoMapping.delete(emailId);

      socket.broadcast.emit("user-left", {
        emailId,
        socketId: socket.id,
      });

      // Update room counts
      socket.rooms.forEach((roomId) => {
        const roomCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit("room-update", { count: roomCount });
      });
      console.log(`User disconnected: ${emailId} (${socket.id})`);
    }
    socketToEmailMapping.delete(socket.id);
  });

  // Error handler
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Health check endpoint
app.get("/", (req, res) => res.send("Backend is Running!"));
app.get("/status", (req, res) => {
  res.json({
    status: "active",
    connections: io.engine.clientsCount,
    users: Array.from(emailSockettoMapping.keys()),
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
