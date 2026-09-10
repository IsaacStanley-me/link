import bcrypt from 'bcrypt';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const defaultData = {
  settings: {
    message: 'Please wait, we\'ll get back to you shortly.',
    loading_duration: 15,
    updated_at: new Date().toISOString()
  },
  admin_users: []
};
const db = new Low(adapter, defaultData);

await db.read();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function setupAdmin() {
  console.log('=== Admin Account Setup ===\n');
  
  // Check if admin users already exist
  if (db.data.admin_users.length > 0) {
    console.log(`There are already ${db.data.admin_users.length} admin account(s) in the database.`);
    const answer = await question('Do you want to create another admin account? (yes/no): ');
    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      console.log('Setup cancelled.');
      rl.close();
      process.exit(0);
    }
  }
  
  const username = await question('Enter admin username: ');
  
  if (!username || username.trim().length === 0) {
    console.log('Username cannot be empty.');
    rl.close();
    process.exit(1);
  }
  
  // Check if username already exists
  const existingUser = db.data.admin_users.find(u => u.username === username);
  if (existingUser) {
    console.log('Username already exists.');
    rl.close();
    process.exit(1);
  }
  
  const password = await question('Enter admin password: ');
  
  if (!password || password.length < 8) {
    console.log('Password must be at least 8 characters long.');
    rl.close();
    process.exit(1);
  }
  
  const confirmPassword = await question('Confirm password: ');
  
  if (password !== confirmPassword) {
    console.log('Passwords do not match.');
    rl.close();
    process.exit(1);
  }
  
  // Hash password
  const saltRounds = 10;
  const passwordHash = bcrypt.hashSync(password, saltRounds);
  
  // Insert admin user
  try {
    db.data.admin_users.push({
      id: Date.now(),
      username: username,
      password_hash: passwordHash,
      created_at: new Date().toISOString()
    });
    await db.write();
    console.log('\nAdmin account created successfully!');
    console.log('You can now log in at /admin/login');
  } catch (error) {
    console.error('Error creating admin account:', error.message);
    rl.close();
    process.exit(1);
  }
  
  rl.close();
  process.exit(0);
}

setupAdmin();
