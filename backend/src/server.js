require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/auth/callback'
);

app.get('/api/login-url', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    redirect_uri: 'http://localhost:3000/auth/callback'
  });
  res.send({ url });
});

app.get('/api/oauth2callback', async (req, res) => {
  console.log("🌐 Received code from Google:", req.query.code);
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    console.log('✅ Tokens:', tokens);
    res.json({ tokens });
  } catch (error) {
    console.error('OAuth callback error:', error.message);
    res.status(500).json({ error: 'OAuth error', details: error.message });
  }
});

app.get('/api/emails', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    console.log('📬 Token received in /api/emails:', token);

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // DON'T call verifyIdToken — this is not an id_token!
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const { data } = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 5
    });

    res.json(data.messages || []);
  } catch (error) {
    console.error('Gmail API Error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch emails',
      details: error.response?.data || error.message
    });
  }
});


app.listen(5000, () => console.log('🚀 Backend running on http://localhost:5000'));

