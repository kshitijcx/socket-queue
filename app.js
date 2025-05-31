import express from "express";
import http from "http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import cors from "cors";
import { Server } from "socket.io";
import dotenv from "dotenv";
import User from "./user.js";
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.password !== password) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  res.json({ token });
});

// User Queue
const queue = [];

io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  socket.on("auth", (token) => {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.id;
      enqueue(socket);
    } catch {
      socket.emit("error", "Authentication failed");
      socket.disconnect();
    }
  });

  socket.on("signal", (data) => {
    if (socket.partner) {
      socket.to(socket.partner).emit("signal", {
        signal: data.signal,
        from: socket.id,
      });
    }
  });

  socket.on("chat", (message) => {
    if (socket.partner) {
      socket.to(socket.partner).emit("chat", {
        message,
        from: socket.id,
      });
    }
  });

  socket.on("next", () => {
    if (socket.partner) {
      io.to(socket.partner).emit("partner_left");
      const oldPartner = io.sockets.sockets.get(socket.partner);
      if (oldPartner) {
        oldPartner.partner = null;
        enqueue(oldPartner);
      }
    }
    socket.partner = null;
    enqueue(socket);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected", socket.id);
    removeFromQueue(socket);
    if (socket.partner) {
      io.to(socket.partner).emit("partner_left");
      const partnerSocket = io.sockets.sockets.get(socket.partner);
      if (partnerSocket) {
        partnerSocket.partner = null;
        enqueue(partnerSocket);
      }
    }
  });
});

function enqueue(socket) {
  if (!queue.includes(socket)) {
    queue.push(socket);
  }
  tryPair();
}

function removeFromQueue(socket) {
  const index = queue.indexOf(socket);
  if (index !== -1) {
    queue.splice(index, 1);
  }
}

function tryPair() {
  while (queue.length >= 2) {
    const user1 = queue.shift();
    const user2 = queue.shift();

    user1.partner = user2.id;
    user2.partner = user1.id;

    user1.emit("partner_found", { partnerId: user2.id });
    user2.emit("partner_found", { partnerId: user1.id });
  }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
