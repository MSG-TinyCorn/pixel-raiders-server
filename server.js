const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

let scores = [];
let waitingPlayer = null;
let rooms = {};

function getThisWeek() {
  const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
  return scores.filter(s => new Date(s.date) > weekAgo);
}

app.get('/leaderboard', (req, res) => {
  const allTime = [...scores].sort((a,b) => b.score-a.score).slice(0,10);
  const thisWeek = [...getThisWeek()].sort((a,b) => b.score-a.score).slice(0,10);
  res.json({ allTime, thisWeek });
});

app.post('/submit-score', (req, res) => {
  const { name, score, wave } = req.body;
  if (!name || typeof score !== 'number') return res.status(400).json({ error: 'Invalid' });
  scores.push({ name: name.substring(0,12).toUpperCase(), score, wave, date: new Date().toISOString() });
  scores = scores.sort((a,b) => b.score-a.score).slice(0,100);
  res.json({ success: true });
});

app.post('/create-payment', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({ amount: 100, currency: 'gbp' });
    res.json({ clientSecret: intent.client_secret });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/create-revive', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({ amount: 30, currency: 'gbp' });
    res.json({ clientSecret: intent.client_secret });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

io.on('connection', socket => {
  socket.on('find-match', () => {
    if (waitingPlayer && waitingPlayer.id !== socket.id) {
      const roomId = socket.id + waitingPlayer.id;
      const p1 = waitingPlayer;
      waitingPlayer = null;
      rooms[roomId] = { players: [p1.id, socket.id] };
      p1.join(roomId);
      socket.join(roomId);
      io.to(p1.id).emit('match-found', { roomId, color: 'red', isHost: true });
      io.to(socket.id).emit('match-found', { roomId, color: 'blue', isHost: false });
    } else {
      waitingPlayer = socket;
      socket.emit('waiting');
    }
  });

  socket.on('game-state', (data) => {
    socket.to(data.roomId).emit('partner-state', data);
  });

  socket.on('enemy-killed', (data) => {
    socket.to(data.roomId).emit('enemy-killed', data);
  });

  socket.on('cancel-match', () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) waitingPlayer = null;
  });

  socket.on('disconnect', () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) waitingPlayer = null;
    for (let roomId in rooms) {
      const room = rooms[roomId];
      if (room.players.includes(socket.id)) {
        const partnerId = room.players.find(id => id !== socket.id);
        if (partnerId) io.to(partnerId).emit('partner-left');
        delete rooms[roomId];
      }
    }
  });
});

server.listen(3000);
