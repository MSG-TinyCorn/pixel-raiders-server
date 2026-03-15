const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(cors());
app.use(express.json());

let db;
async function connectDB() {
  try {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    db = client.db('pixelraiders');
    console.log('MongoDB connected');
  } catch(e) {
    console.error('MongoDB failed:', e.message);
    setTimeout(connectDB, 5000);
  }
}
connectDB();

function getDB() {
  if (!db) throw new Error('Database not ready');
  return db;
}

let waitingPlayer = null;
let rooms = {};
