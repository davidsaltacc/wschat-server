"use strict";

import { PORT, USE_HTTP, ENABLED_MODULES } from "./config.js";
import { authenticate, initAuth } from "./auth.js";
import { logger, httpLogger } from "./logger.js";
import { createServer } from "https";
import { createServer as createInsecureServer } from "http";
import { WebSocketServer } from "ws";
import { readFileSync } from "fs";

initAuth();

logger.info("Creating server");

const server = (USE_HTTP ? createInsecureServer : createServer)(USE_HTTP ? {} : {
    cert: readFileSync("certs/cert.pem"),
    key: readFileSync("certs/key.pem")
}, function handleRequest(req, res) {
    httpLogger(req, res);
    res.writeHead(403);
    res.end();
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", function connection(ws, request) {

    ws.isAlive = true;
    ws.on("pong", function pong() {
        ws.isAlive = true;
    });

    ws.on("error", logger.error);
  
    ws.on("message", function message(data) {
        
    });

});

const heartbeatInterval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {

        if (ws.isAlive === false) {
            return ws.terminate();
        }
    
        ws.isAlive = false;
        ws.ping();
        
    });
}, 30000);
  
wss.on("close", function close() {
    clearInterval(heartbeatInterval);
});

server.on("upgrade", function upgrade(request, socket, head) {
    
    httpLogger(req);

    socket.on("error", logger.error);
  
    authenticate(request, function next(err, success) {

        if (err || !success) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }
    
        socket.removeListener("error", logger.error);
    
        wss.handleUpgrade(request, socket, head, function done(ws) {
            wss.emit("connection", ws);
        });

    });
});

server.listen(PORT);
logger.info("Server listening on port " + PORT);
