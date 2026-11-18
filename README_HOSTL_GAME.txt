HOSTL Game — Clean build for new Render project

What's included:
- Full multiplayer game (Colyseus + browser client)
- Account system (Google login, saving, friends, shop, etc.)
- Efficiency mode (server goes nearly idle when 0 players online)

What's removed for this clean build:
- All promo / redeem codes are disabled
  (the /api/redeem-code route returns "codes_disabled")

Deploy on Render:
1. Create a new Web Service
2. Connect this project / upload these files
3. Build command: (leave empty or npm install)
4. Start command: npm start
5. Set environment variables if you have them:
   - HOSTL_SESSION_SECRET
   - HOSTL_RECOVERY_SECRET
   - GOOGLE_CLIENT_ID
   - HOSTL_DATA_DIR  (use a persistent disk path when you can)

Free-tier note:
Without a persistent disk, account files can reset on redeploy/sleep.
Firebase accounts later is a good upgrade path.
