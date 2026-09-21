import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-production';

// Configure multer for image upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(file.mimetype);
    if (extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files (JPEG, JPG, PNG, WEBP) are allowed'));
  }
});

// Initialize PostgreSQL connection
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/link_db';
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
});

console.log('Connecting to PostgreSQL...');

// Initialize database schema
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      message TEXT NOT NULL DEFAULT 'Please wait, we''ll get back to you shortly.',
      loading_duration INTEGER NOT NULL DEFAULT 15,
      image_data BYTEA,
      image_mimetype TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(link_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(link_id, username)
    );
  `);

  console.log('Database schema initialized.');

  // Migration: Add link_id to existing data if schema was updated
  try {
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'settings' AND column_name = 'link_id'
    `);
    
    if (columnCheck.rows.length === 0) {
      console.log('Old schema detected, migrating to multi-link system...');
      
      // Add link_id column to settings
      await pool.query(`ALTER TABLE settings ADD COLUMN link_id INTEGER`);
      await pool.query(`ALTER TABLE settings ADD CONSTRAINT fk_settings_link FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE`);
      await pool.query(`ALTER TABLE settings ADD CONSTRAINT unique_settings_link UNIQUE(link_id)`);
      
      // Add link_id column to admin_users
      await pool.query(`ALTER TABLE admin_users ADD COLUMN link_id INTEGER`);
      await pool.query(`ALTER TABLE admin_users ADD CONSTRAINT fk_admin_users_link FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE`);
      await pool.query(`ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_username_key`);
      await pool.query(`ALTER TABLE admin_users ADD CONSTRAINT unique_admin_user UNIQUE(link_id, username)`);
      
      // Create Link 1 and migrate existing data
      const linkResult = await pool.query('INSERT INTO links (id, created_at) VALUES (1, NOW()) ON CONFLICT (id) DO UPDATE SET id = 1 RETURNING id');
      const linkId = linkResult.rows[0].id;
      
      await pool.query('UPDATE settings SET link_id = $1 WHERE link_id IS NULL', [linkId]);
      await pool.query('UPDATE admin_users SET link_id = $1 WHERE link_id IS NULL', [linkId]);
      
      console.log(`Migration complete: Existing data assigned to Link ${linkId}`);
    } else {
      console.log('Multi-link schema already in place.');
    }
  } catch (error) {
    console.error('Error during schema migration:', error);
  }

  // Automatic migration from db.json if it exists
  const dbFile = path.join(__dirname, 'db.json');
  try {
    const fs = await import('fs');
    if (fs.existsSync(dbFile)) {
      console.log('Found db.json, checking for migration...');
      
      const adapter = new JSONFile(dbFile);
      const db = new Low(adapter);
      await db.read();
      
      if (db.data && (db.data.settings || (db.data.admin_users && db.data.admin_users.length > 0))) {
        console.log('Existing data found in db.json, migrating to PostgreSQL...');
        
        // Create Link 1 for db.json data
        const linkResult = await pool.query('INSERT INTO links (id, created_at) VALUES (1, NOW()) ON CONFLICT (id) DO UPDATE SET id = 1 RETURNING id');
        const linkId = linkResult.rows[0].id;
        
        // Migrate settings if they exist
        if (db.data.settings) {
          const settingsCount = await pool.query('SELECT COUNT(*) as count FROM settings');
          if (parseInt(settingsCount.rows[0].count) === 0) {
            const { message, loading_duration, image_data, image_mimetype, updated_at } = db.data.settings;
            
            let imageBuffer = null;
            if (image_data) {
              imageBuffer = Buffer.from(image_data, 'base64');
            }
            
            await pool.query(
              `INSERT INTO settings (link_id, message, loading_duration, image_data, image_mimetype, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [linkId, message, loading_duration, imageBuffer, image_mimetype, updated_at]
            );
            console.log('Settings migrated from db.json.');
          } else {
            console.log('Settings already exist in PostgreSQL, skipping migration.');
          }
        }
        
        // Migrate admin users if they exist
        if (db.data.admin_users && db.data.admin_users.length > 0) {
          for (const user of db.data.admin_users) {
            const existingUser = await pool.query(
              'SELECT id FROM admin_users WHERE username = $1 AND link_id = $2',
              [user.username, linkId]
            );
            
            if (existingUser.rows.length === 0) {
              await pool.query(
                `INSERT INTO admin_users (link_id, username, password_hash, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5)`,
                [linkId, user.username, user.password_hash, user.created_at, user.updated_at || user.created_at]
              );
              console.log(`Admin user "${user.username}" migrated from db.json.`);
            } else {
              console.log(`Admin user "${user.username}" already exists in PostgreSQL, skipping.`);
            }
          }
        }
        
        console.log('Migration from db.json completed.');
        console.log('IMPORTANT: db.json has been preserved. You can delete it after verifying the migration worked correctly.');
      } else {
        console.log('db.json exists but contains no data, skipping migration.');
      }
    } else {
      console.log('No db.json found, skipping migration.');
    }
  } catch (error) {
    console.error('Error during migration from db.json:', error);
    console.log('Continuing with database initialization...');
  }

  // Check if Link 1 exists, create if not
  const linkCount = await pool.query('SELECT COUNT(*) as count FROM links');
  if (parseInt(linkCount.rows[0].count) === 0) {
    await pool.query('INSERT INTO links (id, created_at) VALUES (1, NOW())');
    console.log('Link 1 created.');
  }

  // Check if settings exist for Link 1, create default if not
  const settingsResult = await pool.query('SELECT COUNT(*) as count FROM settings WHERE link_id = 1');
  if (parseInt(settingsResult.rows[0].count) === 0) {
   await pool.query(`
      INSERT INTO settings (link_id, message, loading_duration, updated_at)
      VALUES (1, 'Please wait, we''ll get back to you shortly.', 15, NOW())
    `);
    console.log('Default settings created for Link 1.');
  }

  // Create default admin account for Link 1 if none exists
  const adminResult = await pool.query('SELECT COUNT(*) as count FROM admin_users WHERE link_id = 1');
  if (parseInt(adminResult.rows[0].count) === 0) {
    const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123456';
    
    const saltRounds = 10;
    const passwordHash = bcrypt.hashSync(defaultPassword, saltRounds);
    
    await pool.query(
      'INSERT INTO admin_users (link_id, username, password_hash) VALUES ($1, $2, $3)',
      [1, defaultUsername, passwordHash]
    );
    
    console.log('Default admin account created for Link 1:');
    console.log(`Username: ${defaultUsername}`);
    console.log('Password: [set from environment or default]');
    console.log('Please change the password after first login!');
  }

  console.log('PostgreSQL connection established.');
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
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

// Middleware to get link_id from request (query param, path param, or default to 1)
function getLinkId(req) {
  if (req.params.linkId) {
    return parseInt(req.params.linkId);
  }
  if (req.query.link_id) {
    return parseInt(req.query.link_id);
  }
  return 1; // Default to Link 1
}

// Public routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'loading.html'));
});

app.get('/link/:linkId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'loading.html'));
});

app.get('/message', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'message.html'));
});

app.get('/link/:linkId/message', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'message.html'));
});

// API routes for public
app.get('/api/settings', async (req, res) => {
  try {
    const linkId = getLinkId(req);
    const result = await pool.query('SELECT message, loading_duration, image_data FROM settings WHERE link_id = $1', [linkId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }
    const settings = result.rows[0];
    res.json({
      message: settings.message,
      loading_duration: settings.loading_duration,
      has_image: !!settings.image_data
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Serve image
app.get('/api/image', async (req, res) => {
  try {
    const linkId = getLinkId(req);
    const result = await pool.query('SELECT image_data, image_mimetype FROM settings WHERE link_id = $1', [linkId]);
    if (result.rows.length === 0) {
      return res.status(404).send('Link not found');
    }
    const settings = result.rows[0];
    if (settings.image_data && settings.image_mimetype) {
      res.set('Content-Type', settings.image_mimetype);
      res.send(settings.image_data);
    } else {
      res.status(404).send('No image found');
    }
  } catch (error) {
    console.error('Error fetching image:', error);
    res.status(500).send('Failed to fetch image');
  }
});

// Admin routes
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.post('/admin/login', async (req, res) => {
  const { username, password, link_id } = req.body;
  const linkId = link_id ? parseInt(link_id) : 1;
  
  console.log('Login attempt:', { username, linkId, password: password ? '***' : 'empty' });
  
  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1 AND link_id = $2', [username, linkId]);
    const user = result.rows[0];
    
    console.log('User found:', !!user);
    
    if (user) {
      const match = bcrypt.compareSync(password, user.password_hash);
      console.log('Password match:', match);
      
      if (match) {
        req.session.authenticated = true;
        req.session.username = username;
        req.session.link_id = linkId;
        res.redirect(`/admin?link_id=${linkId}`);
        return;
      }
    }
    
    res.redirect(`/admin/login?error=1&link_id=${linkId}`);
  } catch (error) {
    console.error('Login error:', error);
    res.redirect(`/admin/login?error=1&link_id=${linkId}`);
  }
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.post('/admin/update', requireAuth, upload.single('image'), async (req, res) => {
  const { message, loading_duration, remove_image } = req.body;
  const linkId = req.session.link_id || 1;
  
  console.log('Update request:', { linkId, message, loading_duration, hasImage: !!req.file, removeImage: remove_image });
  
  // Validate loading duration
  const duration = parseInt(loading_duration);
  if (isNaN(duration) || duration < 15 || duration > 20) {
    console.log('Invalid duration:', duration);
    return res.status(400).json({ error: 'Loading duration must be between 15 and 20 seconds' });
  }
  
  // Validate message
  if (!message || message.trim().length === 0) {
    console.log('Empty message');
    return res.status(400).json({ error: 'Message cannot be empty' });
  }
  
  try {
    console.log('Saving settings...');
    
    // Handle image
    let imageData = null;
    let imageMimetype = null;
    
    if (remove_image === 'true') {
      imageData = null;
      imageMimetype = null;
    } else if (req.file) {
      imageData = req.file.buffer;
      imageMimetype = req.file.mimetype;
    } else {
      // Keep existing image
      const existingResult = await pool.query('SELECT image_data, image_mimetype FROM settings WHERE link_id = $1', [linkId]);
      const existing = existingResult.rows[0];
      imageData = existing.image_data;
      imageMimetype = existing.image_mimetype;
    }
    
    await pool.query(
      `UPDATE settings 
       SET message = $1, loading_duration = $2, image_data = $3, image_mimetype = $4, updated_at = NOW()
       WHERE link_id = $5`,
      [message, duration, imageData, imageMimetype, linkId]
    );
    
    console.log('Settings saved');
    res.json({ success: true, message: 'Changes saved successfully' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.get('/admin/settings', requireAuth, async (req, res) => {
  try {
    const linkId = req.session.link_id || 1;
    const result = await pool.query('SELECT * FROM settings WHERE link_id = $1', [linkId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }
    const settings = result.rows[0];
    res.json({
      message: settings.message,
      loading_duration: settings.loading_duration,
      image_data: settings.image_data,
      image_mimetype: settings.image_mimetype,
      updated_at: settings.updated_at,
      current_username: req.session.username
    });
  } catch (error) {
    console.error('Error fetching admin settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/admin/update-account', requireAuth, async (req, res) => {
  const { new_username, new_password } = req.body;
  const currentUsername = req.session.username;
  const linkId = req.session.link_id || 1;
  
  console.log('Account update request:', { linkId, currentUsername, hasNewUsername: !!new_username, hasNewPassword: !!new_password });
  
  try {
    // Check if username already exists (if changing username)
    if (new_username && new_username !== currentUsername) {
      const existingUser = await pool.query('SELECT id FROM admin_users WHERE username = $1 AND link_id = $2', [new_username, linkId]);
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }
    
    // Build update query
    let updateFields = [];
    let updateValues = [];
    let paramIndex = 1;
    
    if (new_username) {
      updateFields.push(`username = $${paramIndex}`);
      updateValues.push(new_username);
      paramIndex++;
    }
    
    if (new_password) {
      const saltRounds = 10;
      const passwordHash = bcrypt.hashSync(new_password, saltRounds);
      updateFields.push(`password_hash = $${paramIndex}`);
      updateValues.push(passwordHash);
      paramIndex++;
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No changes provided' });
    }
    
    updateFields.push(`updated_at = NOW()`);
    updateValues.push(currentUsername);
    updateValues.push(linkId);
    
    const query = `UPDATE admin_users SET ${updateFields.join(', ')} WHERE username = $${paramIndex} AND link_id = $${paramIndex + 1}`;
    await pool.query(query, updateValues);
    
    // Update session username if changed
    if (new_username) {
      req.session.username = new_username;
    }
    
    console.log('Account updated');
    res.json({ 
      success: true, 
      message: 'Account updated successfully',
      new_username: new_username || currentUsername
    });
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

app.post('/admin/logout', requireAuth, (req, res) => {
  const linkId = req.session.link_id || 1;
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.redirect(`/admin/login?link_id=${linkId}`);
  });
});

// Super-admin routes for managing links (restricted to Link 1 admin)
app.get('/admin/links', requireAuth, async (req, res) => {
  try {
    // Only Link 1 admin can manage links
    if (req.session.link_id !== 1) {
      return res.status(403).json({ error: 'Only Link 1 admin can manage links' });
    }
    
    const result = await pool.query('SELECT id, created_at FROM links ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching links:', error);
    res.status(500).json({ error: 'Failed to fetch links' });
  }
});

app.post('/admin/links', requireAuth, async (req, res) => {
  try {
    // Only Link 1 admin can manage links
    if (req.session.link_id !== 1) {
      return res.status(403).json({ error: 'Only Link 1 admin can manage links' });
    }
    
    const result = await pool.query('INSERT INTO links (created_at) VALUES (NOW()) RETURNING id');
    const newLinkId = result.rows[0].id;
    
    // Create default settings for new link
    await pool.query(
      `INSERT INTO settings (link_id, message, loading_duration, updated_at)
       VALUES ($1, 'Please wait, we''ll get back to you shortly.', 15, NOW())`,
      [newLinkId]
    );
    
    // Create default admin account for new link
    const defaultUsername = `admin${newLinkId}`;
    const defaultPassword = 'admin123456';
    const saltRounds = 10;
    const passwordHash = bcrypt.hashSync(defaultPassword, saltRounds);
    
    await pool.query(
      'INSERT INTO admin_users (link_id, username, password_hash) VALUES ($1, $2, $3)',
      [newLinkId, defaultUsername, passwordHash]
    );
    
    res.json({ 
      success: true, 
      link_id: newLinkId,
      username: defaultUsername,
      password: defaultPassword,
      message: 'Link created successfully. Please change the default password.'
    });
  } catch (error) {
    console.error('Error creating link:', error);
    res.status(500).json({ error: 'Failed to create link' });
  }
});

app.delete('/admin/links/:linkId', requireAuth, async (req, res) => {
  try {
    // Only Link 1 admin can manage links
    if (req.session.link_id !== 1) {
      return res.status(403).json({ error: 'Only Link 1 admin can manage links' });
    }
    
    const linkId = parseInt(req.params.linkId);
    
    // Prevent deleting Link 1
    if (linkId === 1) {
      return res.status(400).json({ error: 'Cannot delete Link 1' });
    }
    
    await pool.query('DELETE FROM links WHERE id = $1', [linkId]);
    res.json({ success: true, message: 'Link deleted successfully' });
  } catch (error) {
    console.error('Error deleting link:', error);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
