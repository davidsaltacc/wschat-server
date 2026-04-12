"use strict";

import { PORT, USE_INSECURE, ENABLED_MODULES as modules } from "./config.js";
import { authenticate, initAuth } from "./auth.js";
import { logger, httpLogger } from "./logger.js";
import { createServer } from "https";
import { createServer as createInsecureServer } from "http";
import { WebSocketServer } from "ws";
import { readFile, readFileSync } from "fs";

initAuth();

logger.info("Creating server");

const serveWebUI = process.argv[2]?.indexOf("--serve-ui") >= 0;

const server = (USE_INSECURE ? createInsecureServer : createServer)(USE_INSECURE ? {} : {
    cert: readFileSync("certs/cert.pem"),
    key: readFileSync("certs/key.pem")
}, function handleRequest(req, res) {

    httpLogger(req, res);

    let path = new URL(req.url, "https://127.0.0.1" /* can be anything, only for parsing */).pathname.substring(1).split("/");
    if (serveWebUI) {

        if (path[0]?.length === 0) {
            path[0] = null;
        }

        let filePath = "web-ui/" + (path[0] ?? "index.html");

        readFile(filePath, { encoding: "utf-8" }, (error, content) => {
            if (error) {
                if (error.code == "ENOENT" || error.code == "EISDIR") {
                    res.writeHead(404);
                    res.end();
                } else {
                    logger.error(error);
                    res.writeHead(500);
                    res.end(); 
                }
            }
            else {
                res.writeHead(200);
                res.end(content.replaceAll("_IS_HOSTED_BY_WSCHAT_SERVER_INSTANCE_PLACEHOLDER_", "1"));
            }
        });

        return;

    }

    res.writeHead(403);
    res.end();

});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", function connection(ws, request) {

    logger.info("new connection from " + ws._socket.remoteAddress);

    ws.isAlive = true;
    ws.on("pong", function pong() {
        ws.isAlive = true;
    });

    ws.on("error", logger.error);
  
    ws.on("message", function message(message) {

        try {
            
            const response = JSON.parse(message.toString("utf-8"));
            const type = response.type;
            const data = response.data;

            switch (type) {
                case "disconnect": {
                    ws.close(1001);
                    break;
                }
                case "chatOpened": {
                    ws.openChat = data.chatId;
                    break;
                }
                case "messageSent": {
                    
                    for (const module of modules) {
                        if (module.getId() == data.module) {
                            module.sendMessage(data.chatId, data.content);
                            break;
                        }
                    }

                    break;
                }
                case "requestChats": {

                    const fetchTasks = [];

                    for (const module of modules) {
                        fetchTasks.push((async () => {
                            return {
                                module: module.getId(),
                                chats: await module.fetchAllChats()
                            };
                        })());
                    }

                    Promise.all(fetchTasks).then(fetchedChatsList => {

                        const chats = [];

                        for (const list of fetchedChatsList) {
                            for (const chat of list.chats) {
                                chats.push({
                                    chatId: chat.chatId,
                                    chatName: chat.chatName,
                                    module: list.module,
                                    lastMessage: {
                                        messageId: chat.lastMessage.messageId,
                                        authorId: chat.lastMessage.authorId,
                                        authorDisplayName: chat.lastMessage.authorDisplayName,
                                        content: chat.lastMessage.content,
                                        date: chat.lastMessage.date?.getTime()
                                    }
                                });
                            }
                        }
                        
                        ws.send(JSON.stringify({
                            type: "chatList",
                            data: {
                                chats
                            }
                        }));

                    });

                    break;
                }
                case "requestMessages": {

                    for (const module of modules) {
                        if (module.getId() == data.module) {
                            module.fetchMessagesInChat(data.chatId).then(fetchedMessages => {

                                const messages = [];

                                for (const message of fetchedMessages) {
                                    messages.push({
                                        messageId: message.messageId,
                                        authorId: message.authorId,
                                        authorDisplayName: message.authorDisplayName,
                                        content: message.content,
                                        date: message.date.getTime()
                                    });
                                }

                                ws.send(JSON.stringify({
                                    type: "messageList",
                                    data: {
                                        chatId: data.chatId,
                                        messages
                                    }
                                }));

                            });
                            break;
                        }
                    }

                    break;
                }
                case "requestUserInfo": {
                    
                    for (const module of modules) {
                        if (module.getId() == data.module) {
                            module.fetchUserInfo(data.id).then(fetchedUserData => {

                                ws.send(JSON.stringify({
                                    type: "userInfo",
                                    data: {
                                        info: {
                                            id: data.id,
                                            displayName: fetchedUserData.displayName,
                                            uniqueName: fetchedUserData.uniqueName,
                                            biography: fetchedUserData.biography,
                                            creationDate: fetchedUserData.creationDate.getTime()
                                        }
                                    }
                                }));

                            })
                            break;
                        }
                    }

                    break;
                }
                default: {
                    break;
                }
            }

        } catch (e) {
            logger.error(e, "failed to handle request " + message);
        }

    });

    ws.openChat = null;

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

    socket.on("error", logger.error);
  
    authenticate(request, function next(err, success) {

        if (err || !success) {
            if (err) {
                logger.error(err);
            }
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

function anyClientsOnline() {
    return wss.clients.size > 0;
}

function anyClientOpenedChat(chatId) {
    if (!anyClientsOnline()) {
        return false;
    }
    for (const ws of wss.clients) {
        if (ws.openChat === chatId) {
            return true;
        }
    }
    return false;
}

logger.info("Loading Modules");

for (const module of modules) {
    await new Promise((res, rej) => {
        module.openConnection(res, rej);
    });
    module.on("messageReceived", (message, markRead) => {
        if (!anyClientsOnline()) {
            return;
        }
        if (anyClientOpenedChat(message.chatId)) {
            markRead();
        }
        for (const ws of wss.clients) {
            ws.send(JSON.stringify({
                type: "messageReceived",
                data: {
                    chatId: message.chatId,
                    module: module.getId(),
                    message: {
                        messageId: message.messageId,
                        authorId: message.authorId,
                        authorDisplayName: message.authorDisplayName,
                        content: message.content,
                        date: message.date.getTime()
                    }
                }
            }));
        }
    });
    module.on("messageUpdated", (messageId, chatId, newContent) => {
        if (!anyClientsOnline()) {
            return;
        }
        for (const ws of wss.clients) {
            ws.send(JSON.stringify({
                type: "messageUpdated",
                data: {
                    chatId: chatId,
                    module: module.getId(),
                    messageId,
                    newContent
                }
            }));
        }
    });
}

server.listen(PORT);
logger.info("Server listening on port " + PORT);
