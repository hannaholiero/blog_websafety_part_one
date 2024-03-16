const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { User } = require("../models/models");
require('dotenv').config();
const saltRounds = 10;
const crypto = require('crypto');

const csrfToken = crypto.randomBytes(64).toString("hex"); //En lång random sträng.

router.post('/register', async (req, res) => {
  try {
    // Skapa en hash av det angivna lösenordet
    const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);

    // Skapa en ny användare med angiven information och tilldela standardrollen 'reader'
    const newUser = new User({
      firstName: req.body.firstName,
      email: req.body.username,
      password: hashedPassword,
      role: 'reader', // Tilldelar standardrollen 'reader' för nya användare
    });

    // Spara den nya användaren i databasen
    await newUser.save();
    console.log('User saved to blogDB:', newUser);

    // Skapa en sessionsvariabel för den nya användaren och redirecta till inloggningssidan
    req.session.user = { username: newUser.email, firstName: newUser.firstName, csrfToken: req.session.csrfToken, };
    res.redirect('/login');
  } catch (error) {
    // Hantera eventuella fel
    console.log('Error saving user to blogDB:', error);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
