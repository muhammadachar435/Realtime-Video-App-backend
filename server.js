require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// ✅ SIMPLE CORS setup - ALLOW EVERYTHING for testing
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'] // Support both
});

// Store connected users
const users = new Map(); // socket.id -> {email, name, roomId}

io.on("connection", (socket) => {
  console.log("✅ New user connected:", socket.id);

  // 1. Join Room
  socket.on("join-room", (data) => {
    const { roomId, emailId, name } = data;
    
    console.log(`📥 User joining: ${name} (${emailId}) to room ${roomId}`);
    
    // Store user info
    users.set(socket.id, { emailId, name, roomId });
    
    // Join room
    socket.join(roomId);
    
    // Tell this user they joined
    socket.emit("joined-room", { success: true, roomId });
    
    // Get all other users in the room
    const roomUsers = [];
    const roomSockets = io.sockets.adapter.rooms.get(roomId) || new Set();
    
    roomSockets.forEach(sid => {
      if (sid !== socket.id && users.has(sid)) {
        const user = users.get(sid);
        roomUsers.push({
          socketId: sid,
          emailId: user.emailId,
          name: user.name
        });
        
        // Tell existing user about new user
        io.to(sid).emit("user-joined", {
          socketId: socket.id,
          emailId,
          name
        });
      }
    });
    
    // Send existing users to new user
    socket.emit("existing-users", roomUsers);
    
    console.log(`👥 Room ${roomId} now has ${roomSockets.size} users`);
  });

  // 2. Send WebRTC Offer
  socket.on("offer", (data) => {
    const { to, offer } = data;
    console.log(`📤 Offer from ${socket.id} to ${to}`);
    
    if (io.sockets.sockets.has(to)) {
      io.to(to).emit("offer", {
        from: socket.id,
        offer: offer
      });
    }
  });

  // 3. Send WebRTC Answer
  socket.on("answer", (data) => {
    const { to, answer } = data;
    console.log(`📥 Answer from ${socket.id} to ${to}`);
    
    if (io.sockets.sockets.has(to)) {
      io.to(to).emit("answer", {
        from: socket.id,
        answer: answer
      });
    }
  });

  // 4. Exchange ICE Candidates
  socket.on("ice-candidate", (data) => {
    const { to, candidate } = data;
    
    if (io.sockets.sockets.has(to)) {
      io.to(to).emit("ice-candidate", {
        from: socket.id,
        candidate: candidate
      });
    }
  });

  // 5. Handle Chat Messages
  socket.on("chat-message", (data) => {
    const { roomId, text } = data;
    const user = users.get(socket.id);
    
    socket.to(roomId).emit("chat-message", {
      from: socket.id,
      name: user?.name || "Guest",
      text: text,
      time: new Date().toISOString()
    });
  });

  // 6. Handle Disconnection
  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
    
    const user = users.get(socket.id);
    if (user) {
      // Notify others in the room
      socket.to(user.roomId).emit("user-left", {
        socketId: socket.id,
        name: user.name
      });
      
      // Remove from storage
      users.delete(socket.id);
    }
  });
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "Server is running!",
    users: users.size,
    message: "WebRTC Signaling Server"
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ WebSocket ready for connections`);
});
