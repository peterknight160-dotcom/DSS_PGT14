
const express = require('express');
const app = express();
const port = 3000;

// ── Security packages ──
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
require('dotenv').config();

// ── Stripe ──
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Subscription plan definitions — amounts in pence (GBP)
const PLANS = {
    onetime: { name: 'One-time Access',      amount: 1999, currency: 'gbp', mode: 'payment'      },
    monthly: { name: 'Monthly Subscription', amount: 999,  currency: 'gbp', mode: 'subscription' },
    annual:  { name: 'Annual Subscription',  amount: 7999, currency: 'gbp', mode: 'subscription' }
};

// ── Database ──
const pgp = require('pg-promise')();
const cn = {
    host:     process.env.DB_HOST || 'db',
    port:     process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'blogapp',
    user:     process.env.DB_USER || 'blogapp_admin',
    password: process.env.DB_PASSWORD,
    max:      30
};
const db = pgp(cn);

// ── Body parser ──
var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ── Helmet: sets secure HTTP headers ──
app.use(helmet());

// ── Serve static files ──
app.use(express.static(__dirname + '/public'));

// ── Session management ──
// Each user now gets their own secure session instead of a shared variable
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,        // Prevents JS from reading the cookie
        secure:   false,       // Set to true when using HTTPS in production
        sameSite: 'strict',    // Prevents CSRF via cookie
        maxAge:   1000 * 60 * 60 // Session expires after 1 hour
    }
}));

// ── Rate limiting on login ──
// Blocks an IP after 10 failed attempts in 15 minutes
const loginLimiter = rateLimit({
    windowMs:       15 * 60 * 1000,
    max:            10,
    message:        'Too many login attempts. Please try again in 15 minutes.',
    standardHeaders: true,
    legacyHeaders:  false
});

// ── Auth middleware ──
// Protects routes so only logged-in users can access them
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        res.redirect('/');
    }
}

// ── Landing page ──
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/html/login.html', (err) => {
        if (err) console.log(err);
    });
});

// ── Login POST ──
app.post('/', loginLimiter, async (req, res) => {

    const username = req.body.username_input;
    const password = req.body.password_input;

    // Basic input validation — reject empty or oversized inputs immediately
    if (!username || !password) {
        return res.sendFile(__dirname + '/public/html/login_failed.html');
    }

    if (username.length > 50 || password.length > 100) {
        return res.sendFile(__dirname + '/public/html/login_failed.html');
    }

    try {
        // Fetch the stored password hash for this username from the database
        // NOTE: your DB function should return the hashed password for the user,
        // not do the comparison itself — so bcrypt can compare it here securely.
        // If your check_user_login function already handles this, adjust accordingly.
        const login_check = await db.one(
            'SELECT check_user_login($1, $2, $3, $4) as check',
            [username, password, 'localhost', '127.0.0.1']
        );

        if (login_check.check == 0) {
            // Regenerate session ID on login to prevent session fixation attacks
            req.session.regenerate((err) => {
                if (err) {
                    console.error('Session regeneration error:', err);
                    return res.sendFile(__dirname + '/public/html/login_failed.html');
                }

                // Store user in session (NOT in a shared variable)
                req.session.user = username;

                res.sendFile(__dirname + '/public/html/index.html', (err) => {
                    if (err) console.log(err);
                });
            });

        } else {
            // Generic error — never tell the user which field was wrong
            res.sendFile(__dirname + '/public/html/login_failed.html', (err) => {
                if (err) console.log(err);
            });
        }

    } catch (err) {
        // Never expose raw DB errors to the client
        console.error('Login error:', err);
        res.sendFile(__dirname + '/public/html/login_failed.html');
    }
});

// ── Make a post ──
// requireAuth ensures only logged-in users can post
app.post('/makepost', requireAuth, async (req, res) => {

    // Get the logged-in user from the session (not a shared variable)
    const currentUser = req.session.user;

    const title   = req.body.title_field;
    const content = req.body.content_field;
    const postId  = req.body.postId;

    // Input validation
    if (!title || !content) {
        return res.status(400).send('Title and content are required.');
    }

    if (title.length > 150 || content.length > 5000) {
        return res.status(400).send('Input exceeds maximum allowed length.');
    }

    try {
        const curDate = new Date().toLocaleString('en-GB');
        const json    = require('fs').readFileSync(__dirname + '/public/json/posts.json');
        var posts     = JSON.parse(json);

        let maxId = posts.reduce((max, p) => p.postId > max ? p.postId : max, 0);
        let newId;

        if (postId == '') {
            newId = maxId + 1;
        } else {
            newId = postId;
            let index = posts.findIndex(item => item.postId == newId);
            posts.splice(index, 1);
        }

        posts.push({
            username:  currentUser,
            timestamp: curDate,
            postId:    newId,
            title:     title,
            content:   content
        });

        require('fs').writeFileSync(
            __dirname + '/public/json/posts.json',
            JSON.stringify(posts)
        );

        res.sendFile(__dirname + '/public/html/my_posts.html');

    } catch (err) {
        console.error('Make post error:', err);
        res.status(500).send('An error occurred. Please try again.');
    }
});

// ── Delete a post ──
app.post('/deletepost', requireAuth, async (req, res) => {

    const currentUser = req.session.user;

    try {
        const json  = require('fs').readFileSync(__dirname + '/public/json/posts.json');
        var posts   = JSON.parse(json);

        const postId = req.body.postId;
        const post   = posts.find(item => item.postId == postId);

        // Security check: only allow the post owner to delete their own posts
        if (!post || post.username !== currentUser) {
            return res.status(403).send('Forbidden: you can only delete your own posts.');
        }

        let index = posts.findIndex(item => item.postId == postId);
        posts.splice(index, 1);

        require('fs').writeFileSync(
            __dirname + '/public/json/posts.json',
            JSON.stringify(posts)
        );

        res.sendFile(__dirname + '/public/html/my_posts.html');

    } catch (err) {
        console.error('Delete post error:', err);
        res.status(500).send('An error occurred. Please try again.');
    }
});

// ── Payment page ──
app.get('/payment', requireAuth, (req, res) => {
    res.sendFile(__dirname + '/public/html/payment.html', (err) => {
        if (err) console.log(err);
    });
});

// ── Create Stripe Checkout Session ──
app.post('/create-checkout-session', requireAuth, async (req, res) => {
    const planKey = req.body.plan;
    const plan    = PLANS[planKey];

    if (!plan) return res.status(400).json({ error: 'Invalid plan selected.' });

    try {
        let sessionConfig = {
            payment_method_types: ['card'],
            customer_email:       req.session.user,
            metadata: {
                username: req.session.user,
                plan:     planKey
            },
            success_url: `${process.env.APP_URL || 'http://localhost:3000'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:  `${process.env.APP_URL || 'http://localhost:3000'}/payment-cancel`,
        };

        if (plan.mode === 'subscription') {
            // Create a price dynamically for subscription plans
            const price = await stripe.prices.create({
                unit_amount:  plan.amount,
                currency:     plan.currency,
                recurring:    { interval: planKey === 'monthly' ? 'month' : 'year' },
                product_data: { name: plan.name }
            });
            sessionConfig.mode       = 'subscription';
            sessionConfig.line_items = [{ price: price.id, quantity: 1 }];
        } else {
            // One-time payment
            sessionConfig.mode       = 'payment';
            sessionConfig.line_items = [{
                price_data: {
                    currency:     plan.currency,
                    unit_amount:  plan.amount,
                    product_data: { name: plan.name }
                },
                quantity: 1
            }];
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        // TODO: Save pending payment to DB once payments table is created
        // await db.none(
        //     'INSERT INTO payments (username, plan, stripe_session_id, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
        //     [req.session.user, planKey, session.id, 'pending']
        // );

        res.json({ url: session.url });

    } catch (err) {
        console.error('Stripe error:', err.message);
        res.status(500).json({ error: 'Payment setup failed. Please try again.' });
    }
});

// ── Payment success ──
app.get('/payment-success', requireAuth, async (req, res) => {
    try {
        // Verify with Stripe — never trust the URL param alone
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

        if (session.payment_status === 'paid' || session.status === 'complete') {
            console.log(`Payment success: user=${req.session.user}, plan=${session.metadata.plan}`);

            // TODO: Update payment status in DB once payments table is created
            // await db.none(
            //     'UPDATE payments SET status = $1 WHERE stripe_session_id = $2',
            //     ['success', req.query.session_id]
            // );
        }

    } catch (err) {
        console.error('Payment success verification error:', err.message);
    }

    res.sendFile(__dirname + '/public/html/payment_success.html', (err) => {
        if (err) console.log(err);
    });
});

// ── Payment cancelled ──
app.get('/payment-cancel', requireAuth, (req, res) => {
    res.sendFile(__dirname + '/public/html/payment_cancel.html', (err) => {
        if (err) console.log(err);
    });
});

// ── Logout ──
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/');
    });
});

// ── Request abort logging ──
app.use((req, res, next) => {
    req.on('aborted', () => {
        console.error(`Request aborted: ${req.method} ${req.originalUrl}`);
    });
    next();
});

// ── Start server ──
const server = app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});

server.setTimeout(300000);