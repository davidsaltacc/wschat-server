import { createServer } from "http";
import { WebSocketServer } from "ws";
import { readFileSync } from "fs";
import { pino } from "pino";
import { pinoHttp } from "pino-http";
import pretty from "pino-pretty";

const logger = pino({
    transport: {
        target: "pino-pretty",
        options: {
            colorize: pretty.isColorSupported
        }
    }
});

const httpLogger = pinoHttp({
    logger
});

logger.info("Reading config file");

const configFile = readFileSync("CONFIG", { encoding: "utf8" });

if (!configFile) {
    throw new Error("CONFIG file not present.");
}

const config = {};

for (let line of configFile.split("\n")) {
    if (!line.trimStart().startsWith("#")) {
        let pair = line.split("=");
        if (pair.length > 1) {
            config[pair[0]] = pair.slice(1).join("=");
        }
    }
}

const PORT = parseInt(config["port"]);

logger.info("Creating server");

const server = createServer(function handleRequest(req, res) {
    httpLogger(req, res);
    res.writeHead(403);
    res.end();
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", function connection(ws, request, client) {

    ws.isAlive = true;
    ws.on("pong", function pong() {
        ws.isAlive = true;
    });

    ws.on("error", console.error);
  
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

    socket.on("error", console.error);
  
    authenticate(request, function next(err, client) {

        if (err || !client) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }
    
        socket.removeListener("error", console.error);
    
        wss.handleUpgrade(request, socket, head, function done(ws) {
            wss.emit("connection", ws, request, client);
        });

    });
});

server.listen(PORT);
logger.info("Server listening on port " + PORT);
