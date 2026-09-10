# Loading/Redirect Web Application

A simple web application with a loading page, message page, and secure admin panel.

## Features

- **Public Loading Page**: Displays "PAYPAL" text with a circular spinner for a configurable duration (15-20 seconds)
- **Message Page**: Shows a customizable message after the loading period
- **Admin Panel**: Secure dashboard to manage settings
  - Edit the message displayed to visitors
  - Configure loading duration (15-20 seconds)
  - View current settings
  - Secure authentication with password hashing
- **Database**: SQLite database for persistent settings storage
- **Security**: Session-based authentication, bcrypt password hashing, input validation

## Technology Stack

- **Backend**: Node.js with Express
- **Database**: SQLite (better-sqlite3)
- **Authentication**: express-session + bcrypt
- **Frontend**: Plain HTML, CSS, and JavaScript (no frameworks)

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)

### Setup Steps

1. **Clone or download the project**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the project root with the following content:
   ```
   PORT=3000
   SESSION_SECRET=your-random-secret-string-here
   ```
   
   Replace `your-random-secret-string-here` with a secure random string for production.

4. **Create an admin account**
   ```bash
   npm run setup-admin
   ```
   
   Follow the prompts to create a username and password (minimum 8 characters).

5. **Start the server**
   ```bash
   npm start
   ```

   The application will be available at `http://localhost:3000`

## Routes

- `/` - Public loading page (shows PAYPAL text and spinner)
- `/message` - Public message page (displays the configured message)
- `/admin/login` - Admin login page
- `/admin` - Protected admin dashboard (requires authentication)
- `/admin/logout` - Logout endpoint

## API Endpoints

- `GET /api/settings` - Get public settings (message, loading_duration)
- `POST /admin/login` - Admin login
- `GET /admin/settings` - Get admin settings (requires authentication)
- `POST /admin/update` - Update settings (requires authentication)
- `POST /admin/logout` - Logout (requires authentication)

## Admin Panel Usage

1. Navigate to `/admin/login`
2. Enter your admin credentials
3. On the dashboard:
   - Edit the message in the textarea
   - Select loading duration (15-20 seconds)
   - Click "Save Changes"
   - Click "Logout" when done

## Configuration

### Loading Duration

The loading duration can be configured from the admin panel:
- Minimum: 15 seconds
- Maximum: 20 seconds
- Default: 15 seconds

### Message

The default message is: "Please wait, we'll get back to you shortly."

This can be changed from the admin panel and will be immediately applied to all visitors.

## Security Features

- Passwords are hashed using bcrypt (10 salt rounds)
- Session-based authentication with secure cookies
- Admin routes protected by authentication middleware
- Input validation for loading duration (15-20 seconds only)
- No credentials exposed in frontend JavaScript
- Environment variables for sensitive configuration

## Deployment

### Local Deployment

Follow the installation steps above.

### Production Deployment

1. **Set production environment variables**
   - Change `SESSION_SECRET` to a strong random string
   - Set appropriate `PORT` (e.g., 80 or 443 if running directly)

2. **Use a process manager** (recommended)
   ```bash
   npm install -g pm2
   pm2 start server.js --name loading-app
   ```

3. **Use a reverse proxy** (recommended for production)
   - Configure Nginx or Apache to proxy to your Node.js app
   - Enable HTTPS/SSL certificates

4. **Database backup**
   - The SQLite database file is `app.db`
   - Regularly backup this file

### Cloud Deployment Options

- **Heroku**: Deploy as a Node.js app
- **Render**: Deploy as a web service
- **Railway**: Deploy as a Node.js service
- **DigitalOcean App Platform**: Deploy as a Node.js app
- **Vercel**: May require adaptation (serverless functions)

## File Structure

```
.
├── package.json          # Dependencies and scripts
├── server.js             # Main server file
├── setup-admin.js        # Admin account creation script
├── .env.example          # Environment variables template
├── .env                  # Your environment variables (not in git)
├── db.json               # JSON database (created on first run)
├── README.md             # This file
└── public/
    ├── loading.html      # Public loading page
    ├── message.html      # Public message page
    ├── admin-login.html  # Admin login page
    └── admin-dashboard.html  # Admin dashboard
```

## Troubleshooting

### Port already in use
Change the `PORT` in your `.env` file.

### Database errors
Delete `app.db` and restart the server to recreate the database. You'll need to run `npm run setup-admin` again.

### Admin login not working
Ensure you've created an admin account using `npm run setup-admin`. Check that the username and password are correct.

### Settings not saving
Check that the `app.db` file has write permissions.

## Development

To make changes to the application:

1. Edit the HTML files in the `public/` directory
2. Edit `server.js` for backend changes
3. Restart the server after changes

## License

This project is provided as-is for educational purposes.
