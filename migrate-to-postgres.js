import pg from 'pg';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

// Get DATABASE_URL from environment or use default for local development
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/link_db';

console.log('Connecting to PostgreSQL...');
const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Read existing db.json
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);
await db.read();

if (!db.data) {
  console.log('No existing data found in db.json. Exiting.');
  process.exit(0);
}

console.log('Existing data found in db.json:');
console.log('- Settings:', db.data.settings ? 'Yes' : 'No');
console.log('- Admin users:', db.data.admin_users ? db.data.admin_users.length : 0);

try {
  // Create tables
  console.log('Creating tables...');
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL DEFAULT 'Please wait, we\'ll get back to you shortly.',
      loading_duration INTEGER NOT NULL DEFAULT 10,
      image_data BYTEA,
      image_mimetype TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  
  console.log('Tables created successfully.');
  
  // Check if settings already exist
  const settingsResult = await pool.query('SELECT COUNT(*) as count FROM settings');
  const settingsCount = parseInt(settingsResult.rows[0].count);
  
  if (settingsCount > 0) {
    console.log('Settings already存在 in database. Skipping settings migration.');
  } else if (db.data.settings) {
    console.log('Migrating settings...');
    const { message, loading_duration, image_data, image_mimetype, updated_at } = db.data.settings;
    
    let imageBuffer = null;
    if (image_data) {
      imageBuffer = Buffer.from(image_data, 'base64');
    }
    
    await pool.query(
      `INSERT INTO settings (message, loading_duration, image_data, image_mimetype, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [message, loading_duration, imageBuffer, image_mimetype, updated_at]
    );
    console.log('Settings migrated successfully.');
  }
  
  // Migrate admin users
  if (db.data.admin_users && db.data.admin_users.length > 0) {
    console.log('Migrating admin users...');
    
    for (const user of db.data.admin_users) {
      // Check if user already exists
      const existingUser = await pool.query(
        'SELECT id FROM admin_users WHERE username = $1',
        [user.username]
      );
      
      if (existingUser.rows.length > 0) {
        console.log(`User "${user.username}" already exists. Skipping.`);
        continue;
      }
      
      await pool.query(
        `INSERT INTO admin_users (username, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4)`,
        [user.username, user.password_hash, user.created_at, user.updated_at || user.created_at]
      );
      console.log(`User "${user.username}" migrated successfully.`);
    }
  } else {
    console.log('No admin users to migrate.');
  }
  
  console.log('\nMigration completed successfully!');
  console.log('\nIMPORTANT: db.json has been preserved.');
  console.log('You can now delete db.json after verifying the migration worked correctly.');
  
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
} finally {
  await pool.end();
}
