import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-production';

// Initialize database with lowdb
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, {
  settings: {
    message: 'Please wait, we\'ll get back to you shortly.',
    loading_duration: 10,
    updated_at: new Date().toISOString()
  },
  admin_users: []
});

// Initialize database
await db.read();
if (!db.data) {
  db.data = {
    settings: {
      message: 'Please wait, we\'ll get back to you shortly.',
      loading_duration: 10,
      updated_at: new Date().toISOString()
    },
    admin_users: []
  };
  await db.write();
}

// Create default admin account if none exists
if (db.data.admin_users.length === 0) {
  const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
  const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123456';
  
  const saltRounds = 10;
  const passwordHash = bcrypt.hashSync(defaultPassword, saltRounds);
  
  db.data.admin_users.push({
    id: Date.now(),
    username: defaultUsername,
    password_hash: passwordHash,
    created_at: new Date().toISOString()
  });
  await db.write();
  
  console.log('Default admin account created:');
  console.log(`Username: ${defaultUsername}`);
  console.log('Password: [set from environment or default]');
  console.log('Please change the password after first login!');
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/admin/login');
  }
}

// Public routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'loading.html'));
});

app.get('/message', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'message.html'));
});

// API routes for public
app.get('/api/settings', (req, res) => {
  const settings = db.data.settings;
  res.json({
    message: settings.message,
    loading_duration: settings.loading_duration
  });
});

// Admin routes
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  console.log('Login attempt:', { username, password: password ? '***' : 'empty' });
  console.log('Admin users in DB:', db.data.admin_users.map(u => ({ username: u.username, hasHash: !!u.password_hash })));
  
  const user = db.data.admin_users.find(u => u.username === username);
  
  console.log('User found:', !!user);
  
  if (user) {
    const match = bcrypt.compareSync(password, user.password_hash);
    console.log('Password match:', match);
    
    if (match) {
      req.session.authenticated = true;
      req.session.username = username;
      res.redirect('/admin');
      return;
    }
  }
  
  res.redirect('/admin/login?error=1');
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.post('/admin/update', requireAuth, async (req, res) => {
  const { message, loading_duration } = req.body;
  
  console.log('Update request:', { message, loading_duration });
  
  // Validate loading duration
  const duration = parseInt(loading_duration);
  if (isNaN(duration) || duration < 10 || duration > 15) {
    console.log('Invalid duration:', duration);
    return res.status(400).json({ error: 'Loading duration must be between 10 and 15 seconds' });
  }
  
  // Validate message
  if (!message || message.trim().length === 0) {
    console.log('Empty message');
    return res.status(400).json({ error: 'Message cannot be empty' });
  }
  
  console.log('Saving settings...');
  db.data.settings.message = message;
  db.data.settings.loading_duration = duration;
  db.data.settings.updated_at = new Date().toISOString();
  await db.write();
  
  console.log('Settings saved:', db.data.settings);
  res.json({ success: true, message: 'Changes saved successfully' });
});

app.get('/admin/settings', requireAuth, (req, res) => {
  const settings = db.data.settings;
  res.json(settings);
});

app.post('/admin/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.redirect('/admin/login');
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
