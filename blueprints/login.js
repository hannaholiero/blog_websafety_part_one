const express = require('express');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const router = express.Router();
const { User } = require("../models/models")

// LOGIN-sida: POST-förfrågningar
router.post('/login', async (req, res) => {
  // Hämta användarnamn och lösenord från POST-förfrågan
  const { username, password } = req.body;

  try {
    // Sök efter användaren i databasen baserat på e-post
    const foundUser = await User.findOne({ email: username });

    if (foundUser) {
      // Om användaren finns, jämför det angivna lösenordet med det hashade lösenordet i databasen
      const result = await bcrypt.compare(password, foundUser.password);

      if (result) {
        // Om lösenordet är korrekt, skapa en sessionsvariabel för användaren, skicka sedan till startsidan
        req.session.user = { username: foundUser.email, firstName: foundUser.firstName };
        req.session.save(() => {
          console.log('Successful login. User data:', req.session.user);
          res.redirect('/');
        });
      } else {
        // Om lösenordet är fel, skicka tillbaka till inloggningssidan med en popup-ruta
        console.log('Incorrect password');
        res.send('<script>alert("Nämen! Lösenordet var fel - försök igen!"); window.location.href = "/login";</script>');
      }
    } else {
      // Om användarnamnet inte finns i databasen, skicka tillbaka till inloggningssidan med en popup-ruta
      console.log('Incorrect username');
      res.send('<script>alert("Attans, fel användarnamn. Det ska vara din mailadress, försök igen!"); window.location.href = "/login";</script>');
    }
  } catch (error) {
    // Hantera eventuella fel 
    console.log(error);
    res.status(500).send('Internal Server Error');
  }
});


module.exports = router;