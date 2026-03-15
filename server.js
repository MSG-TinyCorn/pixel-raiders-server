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
