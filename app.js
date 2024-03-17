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
const { User, Post, Comment } = require('./models/models')
const helmet = require('helmet');
const contentSecurityPolicy = require("helmet-csp");
const DOMPurify = require('isomorphic-dompurify');
const crypto = require('crypto');



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

// Anslut till MongoDB-databasen
mongoose.connect(process.env.MONGODB_URI);
// Kontrollerar så den är ansluten till databasen
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB Atlas');
});

// Generera nytt cspNonce på varje requests
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("hex");
  // Kan inte göra samma med csrf, den måste kunna valideras på nästa request innan det genereras nytt.
  // req.session.csrfToken = crypto.randomBytes(64).toString("hex");
  next();
});


app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    scriptSrc: [
      "'self'",
      (req, res) => `'nonce-${res.locals.cspNonce}'`,
      "https://kit.fontawesome.com/",
      "https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js",
      "https://maxcdn.bootstrapcdn.com/bootstrap/3.4.1/js/bootstrap.min.js",
    ],
    connectSrc: ["'self'", "https://ka-f.fontawesome.com"],
  }
}));


function isAuthenticated(req, res, next) {
  if (req.session.user) {
    console.log("Authentication ok");
    next(); //Permission granted
  } else {
    res.status(401).send("Access Denied"); // Permission denied
  }
}

function verifyCsrfToken(req, res, next) {
  if (req.session.csrfToken === req.body._csrf) {
    console.log("CSRF OK");
    next();
  } else {
    res.status(403).send("Invalid CSRF-token");
  }
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
    //Kolla ifall Github-användaren finns i db
    const foundGithubUser = await User.findOne({ githubId: userInfo.id });
    const csrfToken = crypto.randomBytes(64).toString("hex"); //En lång random sträng.
    req.session.csrfToken = csrfToken; // Token knyts till den aktuella sessionen.
    //Om kontot finns - skapa sessionsanvändare
    if (foundGithubUser) {
      console.log('hittade githuvanvändare', foundGithubUser);

      req.session.user = {
        userId: foundGithubUser._id.toString(),
        username: foundGithubUser.email,
        firstName: foundGithubUser.firstName,
        role: foundGithubUser.role
      };
      req.session.save(() => {
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
      req.session.user = {
        userId: newUser._id.toString(),
        username: newUser.email,
        firstName: newUser.firstName,
        role: newUser.role,
      };
      return res.redirect('/');
    }
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
    const comments = await Comment.find().sort({ createdAt: 'desc' });

    if (req.session.user) {
      const userHasRoleAdmin = (req.session.user.role === 'admin');
      res.render('homepage.ejs', {
        supersecret: `${res.locals.cspNonce}`,
        csrfToken: req.session.csrfToken, //CSRF-token skickas med till formuläret.
        userIsLoggedIn: true,
        userIsAdmin: userHasRoleAdmin,
        loggedInUserId: req.session.user.userId,
        loggedInUsername: req.session.user.firstName,
        posts: posts,
        comments: comments
      });
    } else {
      res.render('homepage.ejs', {
        supersecret: `${res.locals.cspNonce}`,
        csrfToken: '',
        userIsLoggedIn: false,
        userIsAdmin: false,
        loggedInUsername: '',
        loggedInUserId: false,
        posts: posts,
        comments: comments,
      });
    }
    //supersecret = crypto.randomBytes(64).toString("hex"); //En lång random sträng.
  } catch (error) {
    console.log(error);
    res.status(500).send('Internal Server Error');
  }

});

// LOGIN-sida: GET-förfrågningar
app.get('/login', (req, res) => {
  const userIsCreated = req.query.userCreated;
  res.render('login', { userIsCreated: userIsCreated, csrfToken: req.session.csrfToken });

});

// REGISTRERA ANVÄNDARE: GET-förfrågningar
app.get('/register', (req, res) => {
  res.render('register', { userIsLoggedIn: false, loggedInUsername: '', csrfToken: req.session.csrfToken });
});

// NYTT BLOGGINLÄGG: GET-förfrågningar
app.get('/newpost', isAuthenticated, async (req, res) => {
  console.log("här är jag");
  console.log("the csrfToken is" + req.session.csrfToken);
  res.render('new_post', { userIsLoggedIn: true, loggedInUsername: req.session.user.firstName, csrfToken: req.session.csrfToken });
});




// LOGIN-sida: POST-förfrågningar
app.post('/login', async (req, res) => {
  // Hämta användarnamn och lösenord från POST-förfrågan
  let { username, password } = req.body;
  username = DOMPurify.sanitize(username);

  try {
    // Sök efter användaren i databasen baserat på e-post
    const foundUser = await User.findOne({ email: username });

    if (foundUser) {
      // Om användaren finns, jämför det angivna lösenordet med det hashade lösenordet i databasen
      const result = await bcrypt.compare(password, foundUser.password);

      if (result) {
        const csrfToken = crypto.randomBytes(64).toString("hex"); //En lång random sträng.
        req.session.csrfToken = csrfToken; // Token knyts till den aktuella sessionen.
        // Om lösenordet är korrekt, skapa en sessionsvariabel för användaren, skicka sedan till startsidan
        req.session.user = {
          userId: foundUser._id.toString(),
          username: foundUser.email,
          firstName: foundUser.firstName,
          role: foundUser.role
        };
        req.session.save(() => {
          console.log('Successful login. User data:', req.session.user);
          res.redirect("/");
        });
      } else {
        // Om lösenordet är fel - skriver dock ut 'username or password' för att inte avslöja ifall användaren finns
        return res.status(403).send('Incorrect username or password, please try again');
      }
    } else {
      // Om användarnamnet inte finns i databasen - samma felmeddelande, för att inte avslöja ifall användaren finns
      return res.status(403).send('Incorrect username or password, please try again');
    }
  } catch (error) {
    // Hantera eventuella fel 
    console.log(error);
    res.status(500).send('Internal Server Error');
  }
});


// REGISTRERA ANVÄNDARE - POST
app.post('/register', async (req, res) => {
  try {
    let { firstName, username, password } = req.body;
    firstName = DOMPurify.sanitize(firstName);
    username = DOMPurify.sanitize(username);

    if (firstName === ""
      || username === ""
      || password === "") {
      return res.status(403).send('Please enter a valid username, email and password');
    }
    //Ifall lösenordet är under 10 tecken
    if (password.length < 10) {
      return res.status(403).send('Lösenordet behöver innehålla minst 10 tecken! Tips - Försök att ha med specialtecken, siffror, versaler och undvik befintliga ord.');
    }

    const foundUser = await User.findOne({ email: username });
    if (foundUser) {
      // FRÅGA TILL KRISTIAN: Hur kan man göra detta utan att avslöja för användaren att epostadressen finns i databasen?
      return res.status(403).send('A user with this email address already exists. Please try another email address or try to login');
    }

    // Skapa en hash av det angivna lösenordet
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Skapa en ny användare med angiven information och tilldela standardrollen 'reader'
    const newUser = new User({
      firstName: firstName,
      email: username,
      password: hashedPassword,
      role: 'reader', // Tilldelar standardrollen 'reader' för nya användare
    });

    // Spara den nya användaren i databasen
    await newUser.save();

    console.log('User saved to blogDB:', newUser);

    // Skapa en sessionsvariabel för den nya användaren och redirecta till inloggningssidan
    req.session.user = { username: newUser.email, firstName: newUser.firstName };
    const csrfToken = crypto.randomBytes(64).toString("hex"); //En lång random sträng.
    req.session.csrfToken = csrfToken; // Token knyts till den aktuella sessionen.
    res.redirect('/login?userCreated=1');
  } catch (error) {
    // Hantera eventuella fel
    console.log('Error saving user to blogDB:', error);
    res.status(500).send('Internal Server Error');
  }
});


// NYTT BLOGGINLÄGG: POST-förfrågningar
app.post('/newpost', isAuthenticated, verifyCsrfToken, async (req, res) => {

  try {
    let { title, content } = req.body;
    title = DOMPurify.sanitize(title);
    content = DOMPurify.sanitize(content, { ALLOWED_TAGS: ['b', 'u', 'em', 'strong'] });

    if (title === ""
      || content === "") {
      return res.status(403).send('Please write something!');
    }

    // Skapa ett nytt blogginlägg med titel, content, datum och hämta användare från sessionsdata
    const newPost = new Post({
      title: title,
      content: content,
      createdAt: Date.now(),
      createdBy: req.session.user.firstName,
      creatorId: req.session.user.userId,
      _csrf: req.body._csrf,

    });
    // Spara blogginlägget i databasen
    await newPost.save();
    console.log('Post saved to blogDB:', newPost);

    res.redirect('/');
  } catch (error) {
    // Hantera eventuella fel
    console.log('Error saving post to blogDB', error);
    res.status(500).send('Något gick fel när inlägget skulle sparas');
  }
});



// KOMMENTAR-route
app.post('/comment/:postId', isAuthenticated, verifyCsrfToken, async (req, res) => {
  try {
    const { postId } = req.params;
    let { comment } = req.body;
    comment = DOMPurify.sanitize(comment, { ALLOWED_TAGS: ['b', 'u', 'strong'] });

    if (comment === "") {
      return res.status(403).send('Please write a comment, an empty one is so boring');
    }
    // Sparar kommentaren i databasen och returnera kommentaren med användarnamn
    const newComment = await Comment.create({
      commentContent: comment,
      createdAt: Date.now(),
      createdBy: req.session.user.firstName,
      creatorId: req.session.user.id,
      postId: postId,
    });
    await newComment.save();
    console.log("post saved maddafakka", newComment);
    res.redirect('/');


  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).send('Internal Server Error');
  }
});




app.delete('/newpost/:id', isAuthenticated, verifyCsrfToken, async (req, res) => {
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
    const findCommentAndDelete = await Comment.deleteMany({ postId: id });
    console.log(findPostAndDelete);
    console.log(findCommentAndDelete);

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


