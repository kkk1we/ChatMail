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
  const { code } = req.query;

  const tempClient = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/auth/callback'
  );

  try {
    const { tokens } = await tempClient.getToken(code);
    tempClient.setCredentials(tokens);
    console.log("✅ Tokens received:", tokens);

    res.json({
      message: 'Authentication successful',
      tokens,
    });
  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'OAuth error',
      details: error.response?.data || error.message
    });
  }
});

app.get('/api/emails', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  console.log("📬 Token received in /api/emails:", token);

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  oauth2Client.setCredentials({ access_token: token });

  try {
    await oauth2Client.getTokenInfo(token);
    console.log('✅ Token is valid');
  } catch (tokenError) {
    console.warn('⚠️ Invalid access token, attempting refresh...');

    if (!process.env.REFRESH_TOKEN) {
      return res.status(401).json({ error: 'Refresh token not available' });
    }

    try {
      oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      console.log('🔄 Token refreshed');
    } catch (refreshError) {
      console.error('🔒 Refresh failed:', refreshError.message);
      return res.status(401).json({ error: 'Token refresh failed' });
    }
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const { data: threadList } = await gmail.users.threads.list({
      userId: 'me',
      maxResults: 10
    });

    if (!threadList.threads) return res.json([]);

    const extractCleanBody = (payload) => {
      const decode = (b64) => Buffer.from(b64, 'base64').toString('utf-8');

      const getHTML = (part) => {
        if (part.mimeType === 'text/html' && part.body?.data) return decode(part.body.data);
        if (part.parts) {
          for (const subPart of part.parts) {
            const found = getHTML(subPart);
            if (found) return found;
          }
        }
        return null;
      };

      const getPlain = (part) => {
        if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
        if (part.parts) {
          for (const subPart of part.parts) {
            const found = getPlain(subPart);
            if (found) return found;
          }
        }
        return null;
      };

      return getHTML(payload) || getPlain(payload) || '(No content)';
    };

    const threadsWithMessages = await Promise.all(
      threadList.threads.map(async (thread) => {
        const { data: fullThread } = await gmail.users.threads.get({
          userId: 'me',
          id: thread.id
        });

        const messages = fullThread.messages.map((msg) => {
          const headers = msg.payload.headers;
          const from = headers.find(h => h.name === 'From')?.value || 'Unknown sender';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          const date = new Date(parseInt(msg.internalDate)).toISOString();

          const body = extractCleanBody(msg.payload);

          return { from, subject, date, body };
        });

        return {
          id: thread.id,
          subject: messages[0]?.subject,
          messages,
        };
      })
    );

    res.json(threadsWithMessages);
  } catch (error) {
    console.error('Gmail fetch failed:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch emails', details: error.message });
  }
});

app.listen(5000, () => console.log('🚀 Backend running on http://localhost:5000'));
