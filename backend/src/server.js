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
      let html = decodeBase64(node.body.data);
      
      // Replace CID image URLs
      html = html.replace(/src="cid:([^"]+)"/gi, (match, cidContent) => {
        // You might want to implement a method to resolve CID images
        // For now, we'll remove the src attribute
        return 'src=""';
      });

      return html;
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

const processEmailAttachments = (payload) => {
  const attachments = [];
  
  const findAttachments = (node) => {
    if (node.parts) {
      node.parts.forEach(part => {
        if (part.filename || part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            body: part.body
          });
        }
        findAttachments(part);
      });
    }
  };

  findAttachments(payload);
  return attachments;
};

const replaceInlineImages = async (gmail, html, payload) => {
  const cidMap = {};
  
  const findInlineImages = (node) => {
    if (node.parts) {
      node.parts.forEach(part => {
        if (part.body?.attachmentId && part.headers?.some(h => h.name.toLowerCase() === 'content-id')) {
          const cidHeader = part.headers.find(h => h.name.toLowerCase() === 'content-id');
          const cid = cidHeader.value.replace(/[<>]/g, '');
          cidMap[cid] = part.body.attachmentId;
        }
        findInlineImages(part);
      });
    }
  };

  const fetchAttachmentData = async (attachmentId, messageId) => {
    try {
      const { data } = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: messageId,
        id: attachmentId
      });
      return data;
    } catch (error) {
      console.error('Failed to fetch attachment:', error);
      return null;
    }
  };

  findInlineImages(payload);

  // Replace CID URLs with base64 data URIs
  let processedHtml = html;
  for (const [cid, attachmentId] of Object.entries(cidMap)) {
    try {
      const attachmentData = await fetchAttachmentData(attachmentId, payload.id);
      if (attachmentData) {
        const regex = new RegExp(`src="cid:${cid}"`, 'gi');
        processedHtml = processedHtml.replace(
          regex, 
          `src="data:image/jpeg;base64,${attachmentData}"`
        );
      }
    } catch (error) {
      console.error(`Failed to process CID ${cid}:`, error);
    }
  }

  return processedHtml;
};

const extractEmailAddress = (input) => {
  // Regular expression to match email within angle brackets or standalone
  const emailRegex = /<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/;
  const match = input.match(emailRegex);
  
  if (match) {
    return match[1]; // Return the captured email address
  }
  
  // Fallback to trimming and basic validation
  const trimmedEmail = input.trim();
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmedEmail) 
    ? trimmedEmail 
    : null;
};

const verifySentMail = async (gmail, messageId) => {
  try {
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata'
    });

    console.log('Sent Message Verification:', {
      id: message.data.id,
      threadId: message.data.threadId,
      labelIds: message.data.labelIds,
      snippet: message.data.snippet
    });

    return message.data;
  } catch (error) {
    console.error('Failed to verify sent message:', error);
    return null;
  }
};

// You can call this after sending the message
// await verifySentMail(gmail, sendResponse.data.id);
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
  const { to, subject, message, threadId, messageId, draft } = req.body;
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

    const cleanEmail = extractEmailAddress(to);
    
    // Construct raw message with proper threading
    const rawMessage = Buffer.from(
      `From: ${user.email}\r\n` +
      `To: ${cleanEmail}\r\n` +
      `Subject: ${subject}\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n` +
      `MIME-Version: 1.0\r\n` +
      `In-Reply-To: ${messageId}\r\n` +
      `References: ${messageId}\r\n\r\n` +
      `${message}`
    ).toString('base64url');

    try {
      if (draft) {
        const draftResponse = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: {
            message: { 
              raw: rawMessage,
              threadId: threadId // Include thread ID for drafts
            }
          }
        });
        res.json({ message: 'Draft saved!', draftId: draftResponse.data.id });
      } else {
        const sendResponse = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { 
            raw: rawMessage,
            threadId: threadId // Include thread ID when sending
          }
        });
        
        // Fetch the full message to return complete details
        const sentMessage = await gmail.users.messages.get({
          userId: 'me',
          id: sendResponse.data.id,
          format: 'full'
        });

        res.json({ 
          message: 'Reply sent!', 
          messageId: sendResponse.data.id,
          threadId: threadId,
          sentMessage: {
            id: sentMessage.data.id,
            from: user.email,
            to: cleanEmail,
            subject: subject,
            date: new Date().toISOString(),
            body: message,
            type: 'sent'
          }
        });
      }
    } catch (sendError) {
      console.error('Gmail API Send Error:', sendError);
      res.status(500).json({ 
        error: 'Failed to send/save email', 
        details: sendError.message 
      });
    }
  } catch (err) {
    console.error('Reply process error:', err);
    res.status(500).json({ 
      error: 'Failed to process reply', 
      details: err.message 
    });
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
// Add endpoint to follow "from" emails
app.post('/api/follow-from-email', async (req, res) => {
  const token = req.cookies.token;
  const emailToFollow = req.body.email;
  
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!emailToFollow) return res.status(400).json({ error: 'Email is required' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (!user.followedFromEmails) user.followedFromEmails = [];
    if (!user.followedFromEmails.includes(emailToFollow)) {
      user.followedFromEmails.push(emailToFollow);
      await user.save();
    }
    
    res.json({ 
      message: 'Email added to "from" follow list', 
      followedFromEmails: user.followedFromEmails 
    });
  } catch (err) {
    console.error('Failed to add followed from email:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add endpoint to follow "to" emails
app.post('/api/follow-to-email', async (req, res) => {
  const token = req.cookies.token;
  const emailToFollow = req.body.email;
  
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!emailToFollow) return res.status(400).json({ error: 'Email is required' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (!user.followedToEmails) user.followedToEmails = [];
    if (!user.followedToEmails.includes(emailToFollow)) {
      user.followedToEmails.push(emailToFollow);
      await user.save();
    }
    
    res.json({ 
      message: 'Email added to "to" follow list', 
      followedToEmails: user.followedToEmails 
    });
  } catch (err) {
    console.error('Failed to add followed to email:', err);
    res.status(500).json({ error: 'Server error' });
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
// Add this to your server.js
app.get('/api/thread/:threadId', async (req, res) => {
  const token = req.cookies.token;
  const threadId = req.params.threadId;

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

    const { data: thread } = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
    });

    const messages = thread.messages.map((msg) => {
      const headers = msg.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown sender';
      const to = headers.find(h => h.name === 'To')?.value || 'Unknown recipient';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const date = new Date(parseInt(msg.internalDate)).toISOString();
      const body = extractBodyFromPayload(msg.payload);
      const messageId = headers.find(h => h.name === 'Message-ID')?.value;

      return { 
        id: msg.id,
        messageId,
        from, 
        to,
        subject, 
        date, 
        body,
      };
    });

    res.json({
      id: threadId,
      subject: messages[0]?.subject || '(no subject)',
      messages,
    });
  } catch (err) {
    console.error('Thread fetch error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch thread', 
      details: err.message 
    });
  }
});
// Get followed emails
app.get('/api/followed-emails', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });
    if (!user) return res.status(401).json({ error: 'User not found' });

    res.json({ 
      followedFromEmails: user.followedFromEmails || [],
      followedToEmails: user.followedToEmails || []
    });
  } catch (err) {
    console.error('Failed to get followed emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/followed-emails', async (req, res) => {
  const token = req.cookies.token;
  const { fromEmails = [], toEmails = [] } = req.body;
  
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.googleId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Update both from and to email lists
    user.followedFromEmails = fromEmails;
    user.followedToEmails = toEmails;
    
    await user.save();
    
    res.json({ 
      message: 'Followed emails updated', 
      followedFromEmails: user.followedFromEmails,
      followedToEmails: user.followedToEmails
    });
  } catch (err) {
    console.error('Failed to update followed emails:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Update followed emails
app.post('/api/emails/followed', async (req, res) => {
  const token = req.cookies.token;
  const senderEmails = req.body.senders;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!Array.isArray(senderEmails)) return res.status(400).json({ error: 'Senders must be an array' });
  
  // Add more detailed logging
  console.log(`Fetching emails for ${senderEmails.length} senders: ${senderEmails.join(', ')}`);

  try {
    // Your existing code...
    
    // Add more logging
    console.log(`Found ${allMessages.length} total messages`);
    console.log(`Grouped into ${Object.keys(grouped).length} sender groups`);
    
    // Return threads
    res.json(threads);
  } catch (err) {
    console.error('Detailed error:', err);
    res.status(500).json({ error: 'Fetch failed', details: err.message, stack: err.stack });
  }
});
app.post('/api/email-threads', async (req, res) => {
  const token = req.cookies.token;
  const { fromEmails = [], toEmails = [], limit = 50, offset = 0 } = req.body;

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

    const fetchThreadsWithTimeout = async (emails, type) => {
      const threads = [];
      for (const email of emails) {
        try {
          const { data: threadList } = await gmail.users.threads.list({
            userId: 'me',
            q: `${type}:${email}`,
            maxResults: limit
          });

          if (threadList.threads) {
            const threadsData = await Promise.all(
              threadList.threads.map(async (thread) => {
                const { data: fullThread } = await gmail.users.threads.get({
                  userId: 'me',
                  id: thread.id,
                });

                // Include all messages in the thread
                const messages = fullThread.messages.map((msg) => {
                  const headers = msg.payload.headers;
                  const messageId = headers.find(h => h.name === 'Message-ID')?.value;
                  const from = headers.find(h => h.name === 'From')?.value || 'Unknown sender';
                  const to = headers.find(h => h.name === 'To')?.value || 'Unknown recipient';
                  const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
                  const date = new Date(parseInt(msg.internalDate)).toISOString();
                  const body = extractBodyFromPayload(msg.payload);

                  return { 
                    id: msg.id,
                    messageId,
                    from, 
                    to,
                    subject, 
                    date, 
                    body,
                    type: type
                  };
                });

                return {
                  id: thread.id,
                  subject: messages[0]?.subject || '(no subject)',
                  messages,
                };
              })
            );

            threads.push(...threadsData);
          }
        } catch (error) {
          console.error(`Failed to fetch threads for ${email}:`, error);
        }
      }
      return threads;
    };

    // Fetch threads with custom logic to include all messages
    const fromThreads = await fetchThreadsWithTimeout(fromEmails, 'from');
    const toThreads = await fetchThreadsWithTimeout(toEmails, 'to');

    // Combine and deduplicate threads
    const combinedThreads = [...fromThreads, ...toThreads];
    const uniqueThreads = combinedThreads.reduce((acc, thread) => {
      const existingThread = acc.find(t => t.id === thread.id);
      if (!existingThread) {
        acc.push(thread);
      } else {
        // Merge messages if thread already exists
        existingThread.messages = [
          ...existingThread.messages,
          ...thread.messages
        ];
      }
      return acc;
    }, []);

    res.json({ 
      threads: uniqueThreads,
      totalCount: uniqueThreads.length
    });
  } catch (err) {
    console.error('Thread fetch error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch email threads', 
      details: err.message 
    });
  }
});
app.listen(5000, () => console.log('🚀 Backend running on http://localhost:5000'));
