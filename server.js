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

const eloCache = {};

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

app.get('/elo-leaderboard', async (req, res) => {
  try {
    const d = getDB();
    const top = await d.collection('elo').find().sort({elo:-1}).limit(20).toArray();
    res.json({ top });
  } catch(e) { res.status(503).json({ error: e.message }); }
});

app.post('/submit-score', async (req, res) => {
  try {
    const d = getDB();
    const { name, score, wave, mode } = req.body;
    if (!name || typeof score !== 'number') return res.status(400).json({error:'Invalid'});
    const col = 'scores_' + (mode || 'solo');
    await d.collection(col).insertOne({name:name.substring(0,12).toUpperCase(),score,wave,date:new Date()});
    res.json({ success: true });
  } catch(e) { res.status(503).json({ error: e.message }); }
});

app.post('/update-elo', async (req, res) => {
  try {
    const d = getDB();
    const { name, result } = req.body;
    if (!name) return res.status(400).json({error:'Invalid'});
    const change = result === 'win' ? 100 : -25;
    const existing = await d.collection('elo').findOne({ name: name.toUpperCase() });
    if (existing) {
      const newElo = Math.max(0, existing.elo + change);
      await d.collection('elo').updateOne({ name: name.toUpperCase() }, { $set: { elo: newElo, updatedAt: new Date() } });
      res.json({ elo: newElo });
    } else {
      const startElo = Math.max(0, 0 + change);
      await d.collection('elo').insertOne({ name: name.toUpperCase(), elo: startElo, createdAt: new Date(), updatedAt: new Date() });
      res.json({ elo: startElo });
    }
  } catch(e) { res.status(503).json({ error: e.message }); }
});

app.get('/get-elo', async (req, res) => {
  try {
    const d = getDB();
    const name = req.query.name;
    if (!name) return res.status(400).json({error:'Invalid'});
    const existing = await d.collection('elo').findOne({ name: name.toUpperCase() });
    res.json({ elo: existing ? existing.elo : 0 });
  } catch(e) { res.status(503).json({ error: e.message }); }
});

app.post('/create-payment', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({amount:100,currency:'gbp'});
    res.json({ clientSecret: intent.client_secret });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/create-revive', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({amount:30,currency:'gbp'});
    res.json({ clientSecret: intent.client_secret });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
io.on('connection', socket => {

  socket.on('share-elo', (data) => {
    eloCache[socket.id] = data.elo || 0;
  });

  socket.on('find-duo', () => {
    if (duoQueue && duoQueue.id !== socket.id) {
      const roomId = makeRoomId();
      const p1 = duoQueue; duoQueue = null;
      rooms[roomId] = { players: [p1.id, socket.id], mode: 'duo' };
      p1.join(roomId); socket.join(roomId);
      io.to(p1.id).emit('match-found', { roomId, color: 'red', mode: 'duo', players: 2, oppElo: eloCache[socket.id]||0 });
      io.to(socket.id).emit('match-found', { roomId, color: 'blue', mode: 'duo', players: 2, oppElo: eloCache[p1.id]||0 });
    } else { duoQueue = socket; socket.emit('waiting'); }
  });

  socket.on('find-trio', () => {
    trioQueue = trioQueue.filter(s => s.id !== socket.id);
    trioQueue.push(socket);
    socket.emit('waiting', { inQueue: trioQueue.length });
    if (trioQueue.length >= 3) {
      const roomId = makeRoomId();
      const players = trioQueue.splice(0, 3);
      rooms[roomId] = { players: players.map(p => p.id), mode: 'trio' };
      players.forEach((p, i) => {
        const others = players.filter((_,j) => j !== i);
        const avgOppElo = Math.round(others.reduce((s,o) => s + (eloCache[o.id]||0), 0) / others.length);
        p.join(roomId);
        io.to(p.id).emit('match-found', { roomId, color: ['red','blue','green'][i], mode: 'trio', players: 3, oppElo: avgOppElo });
      });
    }
  });

  socket.on('find-battle', () => {
    if (battleQueue && battleQueue.id !== socket.id) {
      const roomId = makeRoomId();
      const p1 = battleQueue; battleQueue = null;
      rooms[roomId] = { players: [p1.id, socket.id], mode: 'battle' };
      p1.join(roomId); socket.join(roomId);
      io.to(p1.id).emit('battle-found', { roomId, side: 'bottom', oppElo: eloCache[socket.id]||0 });
      io.to(socket.id).emit('battle-found', { roomId, side: 'top', oppElo: eloCache[p1.id]||0 });
    } else { battleQueue = socket; socket.emit('waiting'); }
  });

  socket.on('battle-state', data => socket.to(data.roomId).emit('battle-opponent-state', data));
  socket.on('battle-hit', data => socket.to(data.roomId).emit('battle-got-hit', data));
  socket.on('battle-powerup-taken', data => socket.to(data.roomId).emit('battle-powerup-gone', data));
  socket.on('start-with-robots', data => socket.to(data.roomId).emit('start-with-robots', data));
  socket.on('game-state', data => socket.to(data.roomId).emit('partner-state', data));
  socket.on('enemy-killed', data => socket.to(data.roomId).emit('enemy-killed', data));
  socket.on('player-died', data => socket.to(data.roomId).emit('partner-died', { color: data.color }));

  socket.on('cancel-match', () => {
    if (duoQueue && duoQueue.id === socket.id) duoQueue = null;
    if (battleQueue && battleQueue.id === socket.id) battleQueue = null;
    trioQueue = trioQueue.filter(s => s.id !== socket.id);
  });

  socket.on('disconnect', () => {
    if (duoQueue && duoQueue.id === socket.id) duoQueue = null;
    if (battleQueue && battleQueue.id === socket.id) battleQueue = null;
    trioQueue = trioQueue.filter(s => s.id !== socket.id);
    delete eloCache[socket.id];
    for (let roomId in rooms) {
      const room = rooms[roomId];
      if (room.players.includes(socket.id)) {
        const others = room.players.filter(id => id !== socket.id);
        others.forEach(id => io.to(id).emit('partner-left', {}));
        others.forEach(id => io.to(id).emit('battle-opponent-left'));
        room.players = room.players.filter(id => id !== socket.id);
        if (room.players.length === 0) delete rooms[roomId];
      }
    }
  });
});

server.listen(3000);
