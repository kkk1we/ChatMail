// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: String,
  email: String,
  refreshToken: String,
  followedFromEmails: [String], // New field for "from" emails
  followedToEmails: [String],   // New field for "to" emails
});

module.exports = mongoose.model('User', userSchema);