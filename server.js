const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// In-memory leaderboard (resets if server restarts - free tier limitation)
let scores = [];

function getThisWeek() {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  return scores.filter(s => new Date(s.date) > weekAgo);
}

app.get('/leaderboard', (req, res) => {
  const allTime = [...scores].sort((a, b) => b.score - a.score).slice(0, 10);
  const thisWeek = [...getThisWeek()].sort((a, b) => b.score - a.score).slice(0, 10);
  res.json({ allTime, thisWeek });
});

app.post('/submit-score', (req, res) => {
  const { name, score, wave } = req.body;
  if (!name || typeof score !== 'number') return res.status(400).json({ error: 'Invalid' });
  const entry = { name: name.substring(0, 12).toUpperCase(), score, wave, date: new Date().toISOString() };
  scores.push(entry);
  scores = scores.sort((a, b) => b.score - a.score).slice(0, 100);
  res.json({ success: true });
});

app.post('/create-payment', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({ amount: 100, currency: 'gbp' });
    res.json({ clientSecret: intent.client_secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/create-revive', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({ amount: 30, currency: 'gbp' });
    res.json({ clientSecret: intent.client_secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(3000);
