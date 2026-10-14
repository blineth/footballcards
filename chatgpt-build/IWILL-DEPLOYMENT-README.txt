iTrustLaw assessment deployment

Hostinger Node.js settings
- Node: 20.x or newer
- Build command: npm run build
- Start command: npm start

Keep existing environment variables
- VITE_CALENDLY_URL
- ZOHO_REFRESH_TOKEN
- ZOHO_CLIENT_ID
- ZOHO_CLIENT_SECRET

Add for Will submissions
- RESEND_API_KEY
- WILL_EMAIL_FROM

Optional overrides
- WILL_EMAIL_TO (defaults to info@itrust121.com)
- WILL_EMAIL_BCC (defaults to ethan@itrust121.com)

The application has no npm production dependencies. The build command validates the prebuilt site and the start command runs the dependency-free Node server.
