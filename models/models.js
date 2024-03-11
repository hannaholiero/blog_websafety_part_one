const mongoose = require('mongoose');


// Skapa ett mongoose-schema för användare
const userSchema = new mongoose.Schema({
  firstName: String,
  email: String,
  password: String,
  role: {
    type: String,
    enum: ['reader', 'admin'],
    default: 'reader', // Standardrollen för nya användare
  },
  githubId: String,
});


// Skapa ett mongoose-schema för blogg-poster
const postSchema = new mongoose.Schema({
  title: String,
  content: String,
  createdAt: Date,
  createdBy: String,
  creatorId: String,
});


module.exports = {
  User: mongoose.model('User', userSchema),
  Post: mongoose.model('Post', postSchema),
};
