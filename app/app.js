
const express = require('express')
const app = express();
const port = 3000;
const bodyParser = require('body-parser');
const pgp = require('pg-promise')();
const bcrypt = require('bcrypt');
const fs = require('fs');
const session = require('express-session');
const { authenticateUser, checkContributor } = require('./authorizeuser.js');
const { getPosts } = require('./getposts.js');
const { get } = require('http');
const https = require('https');
const  xss = require ('xss');  //  Cross-site scripting package

var user_n;

const pepper = 'yshlxehpyoxi';




//session middleware -Vin
//memory store for session
const store = new session.MemoryStore();

app.use(
  session({
    //secret for signing/encrypting cookies, needs to be stored securely later
    secret: "dvndjfdnjkd",
    //cookie to store session idea, expires after 1 hr
    //need to figure out how to logout after cookie expiration, probably timeout function
    cookie: {
      maxAge: 3600000,
      httpOnly: true,
      //set false and lax for local development
      secure: false,
      sameSite: "lax"
    },
    //two properties determining how often session object is saved
    resave: false,
    saveUninitialized: false,
    store
  })
);

// Create the posts JSON from database
const cn_posts = {
  host: 'db',
  port: 5432,
  database: 'blogapp',
  user: 'blogapp_user',
  password: 'blogapp_user_password',
  max: 30 // use up to 30 connections


};

const db_posts = pgp(cn_posts);

const cn = {
  host: 'db',
  port: 5432,
  database: 'blogapp',
  user: 'blogapp_admin',
  password: 'blogapp_admin_password',
  max: 30 // use up to 30 connections
};

const db = pgp(cn);

//changed to only static assets not html pages so they can't be accessed directly.
app.use('/css', express.static(__dirname + '/public/css'));
app.use('/js', express.static(__dirname + '/public/js'));
app.use('/imgs', express.static(__dirname + '/public/imgs'));
app.use('/json', express.static(__dirname + '/public/json'));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

//public pages - can be accessed by any user

// Landing page - Get the Graphic Input
app.get('/', async (req, res) => {
  /// send the static file
  res.sendFile(__dirname + '/public/html/graphic.html', (err) => {
    if (err) {
      console.log(err);
    }
  })
  //moved code for getting posts from json to index and posts pages
});

app.post('/click', (req, res) => {
    const { x, y, n } = req.body;

    console.log('Received:', x, y, n);

    console.log (' n is a ' ,typeof n);
   user_n = n;
  
     res.json({ redirect: '/login' });

  console.log('Received3:', x, y, n);
});


app.get('/login', (req, res) => {
  console.log  ( 'Got to line 105');
  res.sendFile(__dirname + '/public/html/login.html', (err) => {
    if (err) {
      console.log(err);
    }
  })
  console.log  ( 'Got to line 110');
});



//Register GET route -Vin
app.get('/register', async (req, res) => {
  //send static file
  res.sendFile(__dirname + '/public/html/register.html', (err) => {
    if (err) {
      console.log(err)
    }
  })
})

//Register POST route -Vin
//need to check if password is weak or in pwnedpasswords
app.post('/register', async (req, res) => {
  const username = req.body.username_input;
  const password = req.body.password_input;
  try {
    //need to account for if account info empty
    //bcrypt generates unique salt for user password and hashes it with password+pepper
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password + pepper, salt);
    const role = 'SUBSCRIBER'
    //need to change insert query to enrole user, need to add column for salt in database
    const result = await db.oneOrNone('SELECT enrole_user ($1, $2, $3);', [username, hashedPassword, role]);
    res.send('An email has been sent to activate your account');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Login POST request
app.post('/password', async (req, res) => {
  const username = req.body.username_input;
  const password = req.body.password_input;

  const ip_addr =
    req.socket.remoteAddress?.replace('::ffff:', '');

  try {
    const login_check = await db.one(
      'SELECT check_user_login2 ($1, $2, $3, $4, $5) AS check',
      [username, password, 'localhost', ip_addr, user_n]
    );
    //check failed login first
    if (login_check.check !== 0) {
      return res.sendFile(__dirname + '/public/html/login_failed.html', (err) => {
        if (err) {
          console.error(err);
          return res.status(500).send('Login failed');
        }
      });
    }
    //check user role
    const subs = await db.one(
      'SELECT role FROM user_vw WHERE username = $1',
      [username]
    );
    // Regenerate session after login
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regen failed:', err);
        return res.status(500).send('Login error');
      }
      //adds authentication to session and user details
      req.session.authenticated = true;
      req.session.user = {
        username: username,
        role: subs.role
      };
      //page redirect in regenerate so can't redirect without regen session
      if (subs.role === 'CONTRIBUTOR') {
        return res.json({ success: true, redirectTo: '/index.html' });
      }
      return res.json({ success: true, redirectTo: '/index_subs.html' });
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).send('Login failed');
  }
});

//protected pages
//middleware for refreshing posts.json
const refreshPosts = async (req, res, next) => {
  try {
    await getPosts(db_posts);
  } catch (err) {
    console.error('Failed to refresh posts:', err)
    res.status(500).send('Unable to get posts.')
  }
  next();
}

//get route for contrib homepage
app.get('/index.html', authenticateUser, refreshPosts, (req, res) => {
  //checks role if user exists
  const role = req.session.user?.role;

  console.log ( 'Line 184, role is ' + role);
  //only send to regular index if contributor
  if (role === 'CONTRIBUTOR') {
    res.sendFile(__dirname + '/public/html/index.html')
  }
  //redirects to sub index
  return res.redirect('/index_subs.html')
});
//get route sub home page
app.get('/index_subs.html', authenticateUser, refreshPosts, (req, res) => {
  res.sendFile(__dirname + '/public/html/index_subs.html')
});

//get route to give current user to front end
app.get('/current-user', authenticateUser, (req, res) => {
  return res.json({ username: req.session.user.username })
})
//get route for posts page
app.get('/posts', authenticateUser, refreshPosts, (req, res) => {
  res.sendFile(__dirname + '/public/html/posts.html');
});

//get route for my_posts page
app.get('/my_posts', authenticateUser, (req, res) => {
  res.sendFile(__dirname + '/public/html/my_posts.html');
});

// Make a post POST request
app.post('/makepost', authenticateUser, async (req, res) => {
  console.log('Makepost called ');
  // Read in current posts
  const json = fs.readFileSync(__dirname + '/public/json/posts.json');
  const posts = JSON.parse(json);
  // Get the current date
  let curDate = new Date();
  curDate = curDate.toLocaleString("en-GB");
  // Find post with the highest ID
  let maxId = 0;
  for (let i = 0; i < posts.length; i++) {
    if (posts[i].postId > maxId) {
      maxId = posts[i].postId;
    }
  }

  // Initialise ID for a new post
  let newId = 0;

  // If postId is empty, user is making a new post
  if (req.body.postId == "") {
    newId = maxId + 1;
  } else { // If postID != empty, user is editing a post
    newId = req.body.postId;

    // Find post with the matching ID, delete it from posts so user can submit their new version
    let index = posts.findIndex(item => item.postId == newId);
    posts.splice(index, 1);
  }
  // Clean posts

  var clean_title = xss(req.body.title_field );
  var clean_content = xss( req.body.content_field);
  // Add post to posts.json
  posts.push({ "username": req.session.user.username, "timestamp": curDate, "postId": newId, "title": clean_title, "content": clean_content });
  
  fs.writeFileSync(__dirname + '/public/json/posts.json', JSON.stringify(posts));

  // Write post to database,
  const query_post = 'with user_w as (select id as userid from blogapp_admin.user_vw  where username=$1) \
           insert into posts ( userid, title, content )   select userid , $2 as title, $3 as content from user_w;';

  await db_posts.none(query_post, [req.session.user.username, clean_title, clean_content]);



  // Redirect back to my_posts.html
  res.sendFile(__dirname + "/public/html/my_posts.html");
});

// Delete a post POST request
app.post('/deletepost', authenticateUser, (req, res) => {

  // Read in current posts
  const json = fs.readFileSync(__dirname + '/public/json/posts.json');
  var posts = JSON.parse(json);

  // Find post with matching ID and delete it
  let index = posts.findIndex(item => item.postId == req.body.postId);
  posts.splice(index, 1);

  // Update posts.json
  fs.writeFileSync(__dirname + '/public/json/posts.json', JSON.stringify(posts));

  res.sendFile(__dirname + "/public/html/my_posts.html");
});
//logout point to destroy session?

 const server = app.listen(port, () => {
  console.log(`My app listening on port ${port}!`)
}); 





app.use((req, res, next) => {
  req.on('aborted', () => {
    console.error(`Request aborted: ${req.method} ${req.originalUrl}`);
  });
  next();
});
