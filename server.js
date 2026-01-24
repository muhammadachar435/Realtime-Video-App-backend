require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// Enable CORS
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      "http://localhost:5173",
      "https://realtime-video-app-frontend.vercel.app" // REPLACE WITH YOUR VERCEL URL
    ];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://realtime-video-app-frontend.vercel.app" // REPLACE WITH YOUR VERCEL URL
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
});

const emailSockettoMapping = new Map();
const socketToEmailMapping = new Map();

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

    // Get users in room
    const roomSockets = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const usersInRoom = roomSockets.map(id => {
      const user = socketToEmailMapping.get(id);
      return user ? { emailId: user.emailId, name: user.name, socketId: id } : null;
    }).filter(Boolean);

    // Send room info to all
    io.to(roomId).emit("room-users", { users: usersInRoom });

    // Notify existing users about new user
    usersInRoom.forEach(user => {
      if (user.socketId !== socket.id) {
        io.to(user.socketId).emit("user-joined", { 
          emailId, 
          name, 
          socketId: socket.id 
        });
      }
    });

    // Send existing users to new user
    usersInRoom.forEach(user => {
      if (user.socketId !== socket.id) {
        socket.emit("user-joined", user);
      }
    });

    socket.emit("joined-room", {
      roomId,
      emailId,
      name,
      socketId: socket.id,
    });

    console.log(`User ${emailId} joined room ${roomId}, Total: ${roomSockets.length}`);
  });

  // Call user handler
  socket.on("call-user", ({ emailId, offer }) => {
    const toSocketId = emailSockettoMapping.get(emailId);
    const callerEmail = socketToEmailMapping.get(socket.id);

    console.log(`Call from ${callerEmail.emailId} to ${emailId}`);

    if (toSocketId) {
      io.to(toSocketId).emit("incoming-call", {
        from: socket.id,
        fromEmail: callerEmail.emailId,
        fromName: callerEmail.name,
        offer,
      });
    } else {
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
    const sender = socketToEmailMapping.get(from);
    socket.to(roomId).emit("chat-message", {
      from,
      text,
      senderName: sender?.name || "Guest",
    });
  });

  // Disconnect handler
  socket.on("disconnect", () => {
    const user = socketToEmailMapping.get(socket.id);
    if (user) {
      const { emailId } = user;
      emailSockettoMapping.delete(emailId);

      // Notify all rooms this user was in
      socket.rooms.forEach(roomId => {
        socket.to(roomId).emit("user-left", {
          emailId,
          socketId: socket.id,
        });
        
        const roomCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit("room-update", { count: roomCount });
      });
      
      console.log(`User disconnected: ${emailId} (${socket.id})`);
    }
    socketToEmailMapping.delete(socket.id);
  });
});


// ADD THIS NEW EVENT HANDLER - BEFORE disconnect handler
socket.on("leave-room", ({ roomId }) => {
  console.log(`User ${socket.id} is leaving room ${roomId}`);
  
  // Get user info
  const user = socketToEmailMapping.get(socket.id);
  
  // Notify other users in the room
  socket.to(roomId).emit("user-left", {
    emailId: user?.emailId,
    socketId: socket.id,
    reason: "User left the call"
  });
  
  // Leave the room
  socket.leave(roomId);
  
  // Update room count
  const roomCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  console.log(`Room ${roomId} now has ${roomCount} users`);
  
  // Send update to remaining users
  io.to(roomId).emit("room-update", { 
    count: roomCount,
    message: "User left the room" 
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
});
