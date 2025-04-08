const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true },
  refreshToken: String,
  email: String, // <-- add this
});

module.exports = mongoose.model('User', userSchema);
