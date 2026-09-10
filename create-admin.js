import bcrypt from 'bcrypt';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';

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

const username = 'admin';
const password = 'admin123456';

const saltRounds = 10;
const passwordHash = bcrypt.hashSync(password, saltRounds);

db.data.admin_users.push({
  id: Date.now(),
  username: username,
  password_hash: passwordHash,
  created_at: new Date().toISOString()
});
await db.write();

console.log('Admin account created successfully!');
console.log('Username: admin');
console.log('Password: admin123456');
console.log('You can now log in at /admin/login');
