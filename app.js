// Moduler
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const saltRounds = 10;
const session = require('express-session');
const cookieParser = require('cookie-parser');
const MongoDBStore = require('connect-mongodb-session')(session);
const { User, Post } = require('./models/models')
const loginRoutes = require('./blueprints/login');


// Skapar en Express-app
const app = express();

// Skapar en MongoDBStore för att hantera sessions
const store = new MongoDBStore({
  uri: process.env.MONGODB_URI,
  collection: 'mySessions',
});

// Kontrollera för MongoDB-anslutningsfel
store.on('error', function (error) {
  console.log('MongoDBStore error:', error);
});

// Konfigurera appen
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
    // Cookien sparas i 15 minuter
    cookie: {
      maxAge: 1000 * 60 * 15,
      httpOnly: true,
      // Eftersom vi inte har en https://-sida så är secure: false
      secure: false,
      sameSite: 'strict',
    },
    store: store,
  })
);
app.use('/', loginRoutes)

// Anslut till MongoDB-databasen
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Kontrollerar så den är ansluten till databasen
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB Atlas');
});



// HOMEPAGE: GET-förfrågningar
app.get('/', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: 'desc' });

    // Konsollogga för att kontrollera session
    console.log('Session id:', req.session.id);
    console.log('Session data:', req.session);

    if (req.session.user) {
      res.render('homepage.ejs', { userIsLoggedIn: true, loggedInUsername: req.session.user.firstName, posts: posts });
    } else {
      res.render('homepage.ejs', { userIsLoggedIn: false, loggedInUsername: '', posts: posts });
    }
  } catch (error) {
    console.log(error);
    res.status(500).send('Internal Server Error');
  }
});

// LOGIN-sida: GET-förfrågningar
app.get('/login', (req, res) => {
  res.render('login'); // Rendera "login.ejs" för inloggningssidan
});

// REGISTRERA ANVÄNDARE: GET-förfrågningar
app.get('/register', (req, res) => {
  res.render('register.ejs', { userIsLoggedIn: false, loggedInUsername: '' });
});

// REGISTRERA ANVÄNDARE: POST-förfrågningar
app.post('/register', async (req, res) => {
  try {
    // Skapa en hash av det angivna lösenordet
    const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);

    // Skapa en ny användare med angivet förnamn, e-postadress och hashat lösenord
    const newUser = new User({
      firstName: req.body.firstName,
      email: req.body.username,
      password: hashedPassword,
    });

    // Spara den nya användaren i databasen
    await newUser.save();
    console.log('User saved to blogDB:', newUser);

    // Skapa en sessionsvariabel för den nya användaren och redirecta till inloggningssidan
    req.session.user = { username: newUser.email, firstName: newUser.firstName };
    res.redirect('/login');
  } catch (error) {
    // Hantera eventuella fel
    console.log('Error saving user to blogDB:', error);
    res.status(500).send('Internal Server Error');
  }
});


// NYTT BLOGGINLÄGG: GET-förfrågningar
app.get('/newpost', async (req, res) => {
  res.render('new_post', { userIsLoggedIn: true, loggedInUsername: req.session.user.firstName });
});

// NYTT BLOGGINLÄGG: POST-förfrågningar
app.post('/newpost', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send("Not permitted.");
  }
  try {

    // Skapa ett nytt blogginlägg med titel, content, datum och hämta användare från sessionsdata
    const newPost = new Post({
      title: req.body.title,
      content: req.body.content,
      createdAt: Date.now(),
      createdBy: req.session.user.firstName,
    });
    // Spara blogginlägget i databasen
    await newPost.save();
    console.log('Post saved to blogDB:', newPost);

    // Hämta samtliga blogginläggen, sortera efter senast skrivna (desc) -> redirecta till startsidan
    const posts = await Post.find().sort({ createdAt: 'desc' });
    res.redirect('/');
  } catch (error) {
    // Hantera eventuella fel
    console.log('Error saving post to blogDB', error);
    res.status(500).send('Något gick fel när inlägget skulle sparas');
  }
});

// BLOGGINLÄGG: Ta bort inlägg
app.post('/newpost/:id', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send("Not permitted.");
  }

  try {
    const { id } = req.params; // Hämta inläggets ID

    // Sök och ta bort inlägget från databasen baserat på det angivna ID:et
    const findPost = await Post.findByIdAndDelete(id);

    // Kontrollera om inlägget inte kunde hittas
    if (!findPost) {
      return res.status(404).json({ message: `Cannot find any post with ID ${id}` });
    } else {
      // Om inlägget har tagits bort, omdirigera till startsidan
      res.redirect('/');
    }
  } catch (error) {
    // Hantera eventuella fel
    res.status(500).json({ message: error.message });
  }
});

// Funktion för att bekräfta radering
function confirmDelete(postId) {
  var confirmation = confirm("Är du säker på att du vill ta bort detta inlägg?");
  if (confirmation) {
    document.getElementById("deleteForm_" + postId).submit();
  }
}


// LOGOUT: GET
app.get('/logout', async (req, res) => {
  console.log('Logout');

  // Förstör användar-sessionen och logga ut användaren
  req.session.destroy(err => {
    if (err) {
      // Om det uppstår ett fel - skicka felstatus och meddelande
      res.status(400).send('Unable to log out');
    } else {
      // Om utloggningen går toppen - omdirigera till startsidan
      res.redirect('/');
    }
  });
});

// Använder filerna i mappen /public 
app.use(express.static("public"));

// Då kör vi då!
app.listen(3000, () => {
  console.log('Server started on port 3000.');
});
