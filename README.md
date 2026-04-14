# WSChat

A simple yet secure to use WebSocket server allowing access to multiple messaging platform through one simple unified API. 

Still in development, not yet meant for actual use.

## Supported Platforms

Discord, WhatsApp

(more to possibly come)

# Setup

1. Create a TOKENS file (instructions in TOKENS_EXAMPLE)
2. Optionally, edit the CONFIG file to fit your needs
3. Add your TLS certificates (cert.pem and key.pem) in the certs/ folder (create if not present) - or disable TLS (very insecure, only for development!) in the CONFIG file
4. Authenticate individual enabled platforms via `npm run auth`
5. Run `npm run main` to start the API OR
6. Run `npm run main-ui` to start the API and also serve a small web ui

The server will then listen under the specified port for incoming websocket connections.

If ran via `npm run main-ui` (or `node main.js --serve-ui`), it will also listen for incoming http/s connections, and serve content from the web-ui/ folder, which contains a simple WSChat client implementation with web-based UI.

# Security?

Authentication is password-based, it gets hashed on the client and THEN stored to avoid possible infostealers, then the hash gets sent to the server which does some additional authentication. Your password is pretty much guaranteed to not leak out. The actual chats are secure too, as long as you have TLS enabled. It does not provide end-to-end encryption, but as the server software is fully open source, and does not permanently store messages, you should be pretty safe.

# Performance

Should run decently on low-end hardware. The modules for all of the platforms, unless explicitly specified, do not rely on opening a chrome tab and controlling it programatically, they impersonate a real client and communicate with the platforms directly.

# Disclaimer

I do not support using any form of software to automate user behavior on any messaging platforms that do not officially support it, such as Discord, WhatsApp and other platforms supported by this project. This project is for educational purposes only, and I do not guarantee anyone's safety from being banned from the platforms they use this project on.
