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

let rooms = {};
let duoQueue = null;
let trioQueue = [];
let battleQueue = null;

function makeRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

app.get('/leaderboard', async (req, res) => {
  try {
    const d = getDB();
    const mode = req.query.mode || 'solo';
    const col = 'scores_' + mode;
    const allTime = await d.collection(col).find().sort({score:-1}).limit(10).toArray();
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
    const thisWeek = await d.collection(col).find({date:{$gte:weekAgo}}).sort({score:-1}).limit(10).toArray();
    res.json({ allTime, thisWeek });
  } catch(e) { res.status(503).json({ error: e.message }); }
});

app.get('/elo-leaderb


