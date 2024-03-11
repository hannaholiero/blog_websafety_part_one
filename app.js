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
mongoose.connect(process.env.MONGODB_URI);

// Kontrollerar så den är ansluten till databasen
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB Atlas');
});





function isAuthenticated() {
  return async (req, res, next) => {
    if (req.session.user) {
      next(); //Permission granted
    } else {
      res.status(401).send("Access Denied"); // Permission denied
    }
  };
}

// GITHUB: INLOGGNING

app.get('/auth/github', (_req, res) => {
  const authUrl = `http://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}`;
  res.redirect(authUrl); // Omdirigera till GitHub-inloggning
});

app.get('/auth/github/login/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
      }),
      headers: {
        Accept: 'application/json',
      },
    });
    const jsonResponse = await response.json();
    req.session.access_token = jsonResponse.access_token;
    const userInfo = await getUserInfoFromGitHub(req.session.access_token);
    req.session.user = userInfo;
    req.session.authenticated = true;
    const githubId = userInfo.id;
    console.log(githubId);
    //Kollar ifall Githubanvändaren finns i den lokala(atlas)-databasen
    const foundGithubUser = await User.findOne({ githubId: userInfo.id });
    //Om kontot finns - skapa sessionsanvändare
    if (foundGithubUser) {

      req.session.user = {
        userId: foundGithubUser._id.toString(),
        username: foundGithubUser.email,
        firstName: foundGithubUser.firstName,
        role: foundGithubUser.role
      };
      req.session.save(() => {
        console.log('Successful login. User data:', req.session.user);

        return res.redirect('/');
      });
      return;
      //Om inte - skapa nytt konto mha info från userInfo
    } else {
      const newUser = new User({
        firstName: userInfo.login,
        email: userInfo.email,
        password: '',
        role: 'reader', // Tilldelar standardrollen 'reader' för nya användare,
        githubId: userInfo.id
      });

      // Spara den nya användaren i databasen
      await newUser.save();
      console.log('User saved to blogDB:', newUser);

      // Skapa en sessionsvariabel för den nya användaren och redirecta till inloggningssidan
      req.session.user = { username: newUser.email, firstName: newUser.firstName };

    }

    console.log(userInfo)
  } catch (error) {
    console.error('Error during GitHub callback:', error);
    res.status(500).send('Internal Server Error');
  }
});


const getUserInfoFromGitHub = async (access_token) => {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  });
  return await response.json();
};







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
