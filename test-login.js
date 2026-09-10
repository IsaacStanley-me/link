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

const user = db.data.admin_users.find(u => u.username === username);

console.log('Testing login:');
console.log('Username:', username);
console.log('Password:', password);
console.log('User found:', !!user);

if (user) {
  console.log('Stored hash:', user.password_hash);
  const match = bcrypt.compareSync(password, user.password_hash);
  console.log('Password match:', match);
}
