require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const User = require('./models/User'); // <-- matches your structure

const app = express();
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/auth/callback'
);

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(cookieParser());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ MongoDB connected'));

app.get('/api/login-url', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send', 
      'openid', 
      'email', 
      'profile'],
  });
  res.send({ url });
});
const extractBodyFromPayload = (payload) => {
  const decodeBase64 = (str) => {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  };

  const findHtmlPart = (node) => {
    if (!node) return '';

    if (node.mimeType === 'text/html' && node.body?.data) {
      return decodeBase64(node.body.data);
    }

    if (node.parts && Array.isArray(node.parts)) {
      for (const part of node.parts) {
        const result = findHtmlPart(part);
        if (result) return result;
      }
    }

    return '';
  };

  const html = findHtmlPart(payload);
  if (html) return html;

  // fallback to plain text if HTML isn't found
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  return '';
};


app.get('/api/oauth2callback', async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email; // <-- get email

    let user = await User.findOne({ googleId });

    if (!user) {
      user = new User({ googleId, refreshToken: tokens.refresh_token, email }); // <-- store email
      await user.save();
    } else {
      if (tokens.refresh_token) {
        user.refreshToken = tokens.refresh_token;
      }
      user.email = email; // <-- update email in case it changed
      await user.save();
    }



    const jwtToken = jwt.sign({ googleId }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', jwtToken, {
      httpOnly: true,
      sameSite: 'Lax',
    });
    console.log(`✅ User logged in: ${googleId}`);
    res.json({ message: 'Login successful' });
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).json({ error: 'OAuth callback failed', details: err.message });
  }
});
app.get('/api/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No session' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });
    if (!user) return res.status(401).json({ error: 'Invalid user' });

    res.json({ email: user.email, googleId: user.googleId });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});
app.get('/api/profile', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });

    if (!user || !user.refreshToken) return res.status(401).json({ error: 'No refresh token' });

    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    res.json(profile);
  } catch (err) {
    console.error('Profile fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile', details: err.message });
  }
});

app.get('/api/session', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No session' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });
    if (!user) return res.status(401).json({ error: 'Invalid user' });

    res.json({ googleId: user.googleId });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});


app.post('/api/reply', async (req, res) => {
  const { threadId, to, subject, message } = req.body;
  const token = req.cookies.token;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });

    if (!user?.refreshToken) return res.status(401).json({ error: 'No refresh token' });

    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build the raw message with rich content
    const rawMessage = Buffer.from(
      `From: Me <me@gmail.com>\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${subject}\r\n` +
      `In-Reply-To: ${threadId}\r\n` +
      `References: ${threadId}\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n\r\n` +
      `${message}`  // Include HTML content for rich formatting
    ).toString('base64url');

    // Save as draft or send
    if (req.body.draft) {
      await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: { raw: rawMessage },
        }
      });
      res.json({ message: 'Draft saved!' });
    } else {
      // Send the reply
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: rawMessage,
          threadId,
        }
      });
      res.json({ message: 'Reply sent!' });
    }
  } catch (err) {
    console.error('Reply failed:', err);
    res.status(500).json({ error: 'Failed to send reply', details: err.message });
  }
});
app.get('/api/emails', async (req, res) => {
  const token = req.cookies.token;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });

    if (!user || !user.refreshToken) {
      return res.status(401).json({ error: 'No refresh token found' });
    }

    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const { data: threadList } = await gmail.users.threads.list({ userId: 'me'});

    if (!threadList.threads) return res.json([]);

    const threadsWithMessages = await Promise.all(
      threadList.threads.map(async (thread) => {
        const { data: fullThread } = await gmail.users.threads.get({ userId: 'me', id: thread.id });

        const messages = fullThread.messages.map((msg) => {
          const headers = msg.payload.headers;
          const from = headers.find(h => h.name === 'From')?.value || 'Unknown sender';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          const date = new Date(parseInt(msg.internalDate)).toISOString();

          const body = extractBodyFromPayload(msg.payload);
          console.log("📧 Extracted body (length):", body?.length);

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
  } catch (err) {
    console.error('Email fetch error:', err.message);
    res.status(500).json({ error: 'Email fetch failed', details: err.message });
  }
});
app.post('/api/emails/grouped', async (req, res) => {
  const token = req.cookies.token;
  const senderEmails = req.body.senders; // array of emails

  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!Array.isArray(senderEmails)) return res.status(400).json({ error: 'Senders must be an array' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });

    if (!user?.refreshToken) return res.status(401).json({ error: 'No refresh token' });

    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const allMessages = [];

    for (const sender of senderEmails) {
      const { data: messagesList } = await gmail.users.messages.list({
        userId: 'me',
        q: `from:${sender}`,
        maxResults: 100, // adjust if needed
      });

      if (messagesList.messages) {
        const fullMessages = await Promise.all(
          messagesList.messages.map(async (msg) => {
            const { data } = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id,
            });

            const headers = data.payload.headers;
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
            const date = new Date(parseInt(data.internalDate)).toISOString();
            const body = extractBodyFromPayload(data.payload);

            return { id: msg.id, from, subject, date, body };
          })
        );

        allMessages.push(...fullMessages);
      }
    }

    // Group messages by sender
    const grouped = {};
    allMessages.forEach((msg) => {
      if (!grouped[msg.from]) grouped[msg.from] = [];
      grouped[msg.from].push(msg);
    });

    const threads = Object.entries(grouped).map(([sender, messages]) => ({
      id: sender,
      subject: messages[0]?.subject,
      messages,
    }));

    res.json(threads);
  } catch (err) {
    console.error('Grouped fetch failed:', err);
    res.status(500).json({ error: 'Fetch failed', details: err.message });
  }
});

app.get('/api/emails/from/:sender', async (req, res) => {
  const token = req.cookies.token;
  const senderEmail = req.params.sender; // Sender email from URL parameter

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Verify token and get user
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });

    if (!user || !user.refreshToken) {
      return res.status(401).json({ error: 'No refresh token found' });
    }

    // Set OAuth credentials
    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    // Create Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch threads from the specified sender
    const { data: threadList } = await gmail.users.threads.list({
      userId: 'me',
      q: `from:${senderEmail}`, // Filter threads by sender's email
      maxResults: 100  // Fetch 100 threads (adjust as needed)
    });

    if (!threadList.threads) return res.json([]);  // No threads found

    // Fetch full thread data
    const threadsWithMessages = await Promise.all(
      threadList.threads.map(async (thread) => {
        const { data: fullThread } = await gmail.users.threads.get({
          userId: 'me',
          id: thread.id,
        });

        const messages = fullThread.messages.map((msg) => {
          const headers = msg.payload.headers;
          const from = headers.find(h => h.name === 'From')?.value || 'Unknown sender';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          const date = new Date(parseInt(msg.internalDate)).toISOString();
          const body = extractBodyFromPayload(msg.payload);

          return { from, subject, date, body };
        });

        return {
          id: thread.id,
          subject: messages[0]?.subject,
          messages,
        };
      })
    );

    res.json(threadsWithMessages);  // Return all the threads with messages

  } catch (err) {
    console.error('Email fetch error:', err.message);
    res.status(500).json({ error: 'Email fetch failed', details: err.message });
  }
});
app.post('/api/emails/followed', async (req, res) => {
  const token = req.cookies.token;
  const senderEmails = req.body.senders; // List of email addresses to follow

  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!Array.isArray(senderEmails)) return res.status(400).json({ error: 'Senders must be an array' });

  try {
    // Verify token and get user
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });

    if (!user || !user.refreshToken) {
      return res.status(401).json({ error: 'No refresh token found' });
    }

    // Set OAuth credentials
    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    // Create Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const allMessages = [];

    // Fetch threads for each sender in the list
    for (const sender of senderEmails) {
      const { data: messagesList } = await gmail.users.messages.list({
        userId: 'me',
        q: `from:${sender}`,  // Filter by sender's email address
        maxResults: 100,  // Adjust if needed
      });

      if (messagesList.messages) {
        const fullMessages = await Promise.all(
          messagesList.messages.map(async (msg) => {
            const { data } = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id,
            });

            const headers = data.payload.headers;
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
            const date = new Date(parseInt(data.internalDate)).toISOString();
            const body = extractBodyFromPayload(data.payload);

            return { id: msg.id, from, subject, date, body };
          })
        );

        allMessages.push(...fullMessages);
      }
    }

    // Group messages by sender (optional)
    const grouped = {};
    allMessages.forEach((msg) => {
      const sender = msg.from;
      if (!grouped[sender]) grouped[sender] = [];
      grouped[sender].push(msg);
    });

    const threads = Object.entries(grouped).map(([sender, messages]) => ({
      id: sender,
      subject: messages[0]?.subject,
      messages,
    }));

    res.json(threads);  // Return all the threads with messages

  } catch (err) {
    console.error('Grouped fetch failed:', err);
    res.status(500).json({ error: 'Fetch failed', details: err.message });
  }
});

app.listen(5000, () => console.log('🚀 Backend running on http://localhost:5000'));
