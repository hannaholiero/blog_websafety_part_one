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
const registerRoutes = require('./blueprints/register');



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
app.use('/', loginRoutes);
app.use('/', registerRoutes);

// Anslut till MongoDB-databasen
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Kontrollerar så den är ansluten till databasen
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB Atlas');
});

function hasPermission(action) {
  return async (req, res, next) => {
    const username = req.session.username;
    const role = await redisClient.hGet(`user:${username}`, "role");
    const hasPermission = await redisClient.sIsMember(`role:${role}`, action)
    if (hasPermission) {
      next(); // Permission granted
    } else {
      res.status(403).send("Access Denied"); // Permission denied
    }
  };
}

function isAuthenticated() {
  return async (req, res, next) => {
    if (req.session.user) {
      next(); //Permission granted
    } else {
      res.status(401).send("Access Denied"); // Permission denied
    }
  };
}

// HOMEPAGE: GET-förfrågningar
app.get('/', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: 'desc' });
    if (req.session.user) {
      const userHasRoleAdmin = (req.session.user.role === 'admin');
      res.render('homepage.ejs', { userIsLoggedIn: true, userIsAdmin: userHasRoleAdmin, loggedInUsername: req.session.user.firstName, posts: posts });
    } else {
      res.render('homepage.ejs', { userIsLoggedIn: false, userIsAdmin: false, loggedInUsername: '', posts: posts });
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

// NYTT BLOGGINLÄGG: GET-förfrågningar
app.get('/newpost', isAuthenticated(), async (req, res) => {
  res.render('new_post', { userIsLoggedIn: true, loggedInUsername: req.session.user.firstName });
});


// NYTT BLOGGINLÄGG: POST-förfrågningar
app.post('/newpost', isAuthenticated(), async (req, res) => {
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
      creatorId: req.session.user.userId
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




app.delete('/newpost/:id', isAuthenticated(), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.userId;
    const isAdmin = (req.session.user.role === 'admin');

    const findPostById = await Post.findById(id);
    const postOwner = findPostById.creatorId;
    console.log(findPostById);

    console.log("postowner: " + postOwner);
    console.log("userId is " + userId);
    console.log("");
    console.log(typeof userId);
    console.log(typeof postOwner);


    if (!isAdmin && postOwner !== userId) {
      return res.status(403).send("Access Denied"); // Permission denied
    }
    const findPostAndDelete = await Post.findByIdAndDelete(id);

    // Kontrollera om inlägget inte kunde hittas
    if (!findPostAndDelete) {
      return res.status(404).json({ ok: false, message: `Cannot find any post with ID ${id}` });
    } else {
      console.log("all good");
      // Om inlägget har tagits bort, omdirigera till startsidan
      return res.status(200).json({ ok: true, message: `Post ${id} has been deleted` });
    }
  } catch (error) {
    // Hantera eventuella fel
    res.status(500).json({ message: error.message });
  }
});


// BLOGGINLÄGG: Ta bort inlägg
// app.post('/newpost/:id', isAuthenticated(), async (req, res) => {

//   try {
//     const { id } = req.params; // Hämta inläggets ID

//     // Sök och ta bort inlägget från databasen baserat på det angivna ID:et
//     const findPost = await Post.findByIdAndDelete(id);

//     // Kontrollera om inlägget inte kunde hittas
//     if (!findPost) {
//       return res.status(404).json({ message: `Cannot find any post with ID ${id}` });
//     } else {
//       // Om inlägget har tagits bort, omdirigera till startsidan
//       res.redirect('/');
//     }
//   } catch (error) {
//     // Hantera eventuella fel
//     res.status(500).json({ message: error.message });
//   }
// });



// // Funktion för att bekräfta radering
// function confirmDelete(postId) {
//   if (!req.session.user) {
//     return res.status(401).send("Not permitted.");
//   }
//   var confirmation = confirm("Är du säker på att du vill ta bort detta inlägg?");
//   if (confirmation) {
//     document.getElementById("deleteForm_" + postId).submit();
//   }
// };


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
