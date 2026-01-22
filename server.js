/* eslint-disable no-undef */
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// Enable CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true
}));

app.use(express.json());
app.use(bodyParser.json());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8
});

const emailSockettoMapping = new Map();
const socketToEmailMapping = new Map();

// Helper function to get user info
const getUserInfo = (socketId) => {
  return socketToEmailMapping.get(socketId) || { emailId: 'unknown', name: 'Guest' };
};

// connection built
io.on("connection", (socket) => {
  console.log("✅ New Connection:", socket.id);

  // Heartbeat to keep connection alive
  socket.on("ping", (cb) => {
    if (typeof cb === "function") {
      cb();
    }
  });

  socket.on("join-room", (data) => {
    const { roomId, emailId, name } = data;

    if (!roomId || !emailId || !name) {
      socket.emit("error", { message: "Missing required fields" });
      return;
    }

    // Store mappings
    emailSockettoMapping.set(emailId, socket.id);
    socketToEmailMapping.set(socket.id, { emailId, name });

    // Join room
    socket.join(roomId);
    console.log(`👤 ${name} (${emailId}) joined room ${roomId}`);

    // Get all users in room
    const room = io.sockets.adapter.rooms.get(roomId);
    const usersInRoom = room ? Array.from(room).map(id => getUserInfo(id)) : [];

    // Notify existing users about new user
    socket.to(roomId).emit("user-joined", { 
      emailId, 
      name, 
      socketId: socket.id 
    });

    // Send existing users to new user
    usersInRoom.forEach(user => {
      if (user.emailId !== emailId) {
        socket.emit("user-joined", {
          emailId: user.emailId,
          name: user.name,
          socketId: emailSockettoMapping.get(user.emailId)
        });
      }
    });

    // Notify self
    socket.emit("joined-room", {
      roomId,
      emailId,
      name,
      socketId: socket.id,
    });

    console.log(`Room ${roomId} now has ${usersInRoom.length + 1} users`);
  });

  // Call user handler
  socket.on("call-user", ({ emailId, offer }) => {
    const toSocketId = emailSockettoMapping.get(emailId);
    const caller = getUserInfo(socket.id);

    console.log(`📞 Call from ${caller.emailId} to ${emailId}`);

    if (toSocketId) {
      io.to(toSocketId).emit("incoming-call", {
        from: socket.id,
        fromEmail: caller.emailId,
        fromName: caller.name,
        offer,
      });
    } else {
      console.log(`❌ User ${emailId} not found`);
      socket.emit("user-not-found", { emailId });
    }
  });

  // call-accepted
  socket.on("call-accepted", ({ to, ans, fromEmail, fromName }) => {
    const user = getUserInfo(socket.id);
    console.log(`✅ Call accepted by ${user.emailId} to ${to}`);
    
    io.to(to).emit("call-accepted", {
      ans,
      from: socket.id,
      fromEmail: user.emailId,
      fromName: user.name,
    });
  });

  // ICE Candidate exchange
  socket.on("ice-candidate", ({ to, candidate }) => {
    console.log(`🧊 ICE candidate from ${socket.id} to ${to}`);
    
    if (io.sockets.sockets.has(to)) {
      io.to(to).emit("ice-candidate", {
        candidate,
        from: socket.id,
      });
    } else {
      console.log(`❌ Target socket ${to} not found`);
    }
  });

  socket.on("camera-toggle", ({ cameraOn, roomId }) => {
    socket.to(roomId).emit("camera-toggle", { cameraOn });
  });

  // Chat-message
  socket.on("chat-message", ({ roomId, from, text }) => {
    const sender = getUserInfo(from);
    
    socket.to(roomId).emit("chat-message", {
      from,
      text,
      senderName: sender.name,
      senderEmail: sender.emailId
    });
  });

  // Leave room
  socket.on("leave-room", ({ roomId }) => {
    const user = getUserInfo(socket.id);
    if (user) {
      console.log(`👋 ${user.name} left room ${roomId}`);
      socket.to(roomId).emit("user-left", {
        emailId: user.emailId,
        socketId: socket.id,
      });
    }
    socket.leave(roomId);
  });

  // Disconnect handler
  socket.on("disconnect", (reason) => {
    const user = getUserInfo(socket.id);
    if (user) {
      const { emailId, name } = user;
      emailSockettoMapping.delete(emailId);
      
      console.log(`❌ Disconnected: ${name} (${emailId}), Reason: ${reason}`);
      
      // Notify all rooms user was in
      socket.rooms.forEach(roomId => {
        socket.to(roomId).emit("user-left", {
          emailId,
          socketId: socket.id,
          name
        });
      });
    }
    socketToEmailMapping.delete(socket.id);
  });

  // Error handler
  socket.on("error", (error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "active",
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    uptime: process.uptime()
  });
});

// WebRTC configuration endpoint
app.get("/config", (req, res) => {
  res.json({
    iceServers: [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:global.stun.twilio.com:3478"
        ]
      },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
      }
    ]
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌐 Access at: http://localhost:${PORT}`);
});
