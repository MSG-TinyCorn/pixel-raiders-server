const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

app.post('/verify-payment', async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status === 'succeeded') {
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (e) {
    res.json({ success: false });
  }
});

app.post('/create-payment', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({
      amount: 100,
      currency: 'gbp',
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/create-revive', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({
      amount: 30,
      currency: 'gbp',
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.listen(3000);
