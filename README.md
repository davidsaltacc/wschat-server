# WSChat Server

simple unified websocket api for multiple messaging platforms

# Setup

1. Create a TOKENS file (instructions in TOKENS_EXAMPLE)
2. Optionally, edit the CONFIG file to fit your needs
3. Add your HTTPS certificates (cert.pem and key.pem) in the certs/ folder (create if not present) - or disable HTTPS (very insecure, only for development!) in the CONFIG file
4. Authenticate individual platforms via `npm run auth`
5. Run `npm run main` to start the API OR
6. Run `npm run main-ui` to start the API and also serve a small web ui