"use strict";

import makeWASocket, { Browsers, DisconnectReason, makeCacheableSignalKeyStore, useMultiFileAuthState } from "baileys";
import { Chat, ChatModule, Message, Person, DisconnectReason as _DisconnectReason } from "../chats.js";
import { logger } from "../logger.js";
import { existsSync, mkdirSync, openAsBlob, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import NodeCache from "node-cache";
import QRCode from "qrcode";

function normalizeJid(jid) {

	const split = jid?.split("@");

    if (!split || split.length <= 0) {
        return null;
    }

	const server = split[1];
	const user = split[0].split(":")[0].split("_")[0];
    
    return user + "@" + (server === "c.us" ? "s.whatsapp.net" : server);

}

function stringifyJSONMap(input) {
    return JSON.stringify(input, (key, value) => {
        if (value instanceof Map) {
            return {
                dataType: "Map",
                value: Array.from(value.entries()),
            };
        } else {
            return value;
        }
    });
}

function parseJSONMap(input) {
    return JSON.parse(input, (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (value.dataType === "Map") {
                return new Map(value.value);
            }
        }
        return value;
    });
}

class Store {

    constructor() {
        this._messages = new Map();
        this._chats = new Map();
        this._contacts = new Map();
        this._messageUpdateListeners = [];
    }
    
    /** 
     * @param {ReturnType<typeof import("baileys").makeWASocket>} socket 
     */
    bind(socket) {

        socket.ev.on("messaging-history.set", ({
			chats: newChats,
			messages: newMessages,
            contacts: newContacts
		}) => {

            for (const message of newMessages) {
                if (!this._messages.has(normalizeJid(message.key.remoteJid))) {
                    this._messages.set(normalizeJid(message.key.remoteJid), new Map());
                }
                this._messages.get(normalizeJid(message.key.remoteJid)).set(message.key, message);
			}

            for (const chat of newChats) {
                this._chats.set(normalizeJid(chat.id), {
                    ...this._chats.get(normalizeJid(chat.id)),
                    ...chat
                });
			}
            
            for (const contact of newContacts) {
                this._contacts.set(normalizeJid(contact.id), {
                    ...this._contacts.get(normalizeJid(contact.id)),
                    ...contact
                });
			}

        });

        socket.ev.on("messages.upsert", ({ messages, type }) => {
            if (type == "notify") {

                for (const message of messages) {
                    if (!this._messages.has(normalizeJid(message.key.remoteJid))) {
                        this._messages.set(normalizeJid(message.key.remoteJid), new Map());
                    }
                    this._messages.get(normalizeJid(message.key.remoteJid)).set(message.key, message);
				}

            }
        });

        socket.ev.on("messages.update", updates => {

            for (const update of updates) {
                if (!this._messages.has(normalizeJid(update.key.remoteJid))) {
                    this._messages.set(normalizeJid(update.key.remoteJid), new Map());
                }
                const newMessage = {
                    ...this._messages.get(normalizeJid(update.key.remoteJid)).get(update.key),
                    ...update.update
                };
                this._messages.get(normalizeJid(update.key.remoteJid)).set(update.key, newMessage);

                for (const listener of this._messageUpdateListeners) {
                    listener(newMessage);
                }
			}

        });

        socket.ev.on("messages.delete", ({ keys, jid, all }) => {

            if (all) {
                this._messages.delete(normalizeJid(jid));
            } else {
                for (const key of keys) {
                    if (key && this._messages.has(normalizeJid(key.remoteJid))) {
                        this._messages.get(normalizeJid(key.remoteJid)).delete(key);
                    }
                }
            }

        });

        socket.ev.on("chats.upsert", newChats => {
            for (const chat of newChats) {
                this._chats.set(normalizeJid(chat.id), chat);
            }
        });

        socket.ev.on("chats.delete", ids => {
            for (const id of ids) {
                this._chats.delete(normalizeJid(id));
            }
        });

        socket.ev.on("contacts.upsert", contacts => {
            for (const contact of contacts) {
                this._contacts.set(normalizeJid(contact.id), contact);
            }
        });

        socket.ev.on("contacts.update", contacts => {
            for (const contact of contacts) {
				this._contacts.set(normalizeJid(contact.id), {
                    ...this._contacts.get(normalizeJid(contact.id)),
                    ...contact
                });
            }
        });

    }

    getMessage(key) {
        return this._messages.get(normalizeJid(key.remoteJid)).get(key);
    }

    getLatestMessage(jid) {
        if (!this._messages.has(normalizeJid(jid))) {
            return null;
        }
        const keys = Array.from(this._messages.get(normalizeJid(jid)).keys()); 
        keys.sort((a, b) => (this._messages.get(normalizeJid(jid)).get(b).messageTimestamp ?? 0) - (this._messages.get(normalizeJid(jid)).get(a).messageTimestamp ?? 0));
        return this._messages.get(normalizeJid(jid)).get(keys[0]);
    }
    
    getAllMessageKeysInChat(jid) {
        return Array.from(this._messages.get(normalizeJid(jid))?.keys() ?? []);
    }
    
    getAllMessagesInChat(jid) {
        return Array.from(this._messages.get(normalizeJid(jid))?.values() ?? []);
    }

    setMessage(message) {
        this._messages.get(normalizeJid(message.key.remoteJid)).set(message.key, message);
    }

    getChat(jid) {
        return this._chats.get(normalizeJid(jid));
    }

    setChat(chat) {
        this._chats.set(normalizeJid(chat.id), chat);
    }

    getAllChats() {
        return Array.from(this._chats.values());
    } 

    getContact(id) {
        return this._contacts.get(normalizeJid(id));
    }

    setContact(contact) {
        this._contacts.set(normalizeJid(contact.id), contact);
    }

    existsOnDisk() {
        return existsSync("states/whatsapp/chats.json") && existsSync("states/whatsapp/messages.json") && existsSync("states/whatsapp/contacts.json");
    }

    saveToDisk() { // we have to save whatsapp chats to disk, because unlike with discord we can't just really simply re-fetch some stuff as whatsapp is quite a bit stricter

        if (!existsSync("states/whatsapp")) {
            mkdirSync("states/whatsapp", { recursive: true });
        }

        writeFileSync("states/whatsapp/chats.json", stringifyJSONMap(this._chats));
        writeFileSync("states/whatsapp/messages.json", stringifyJSONMap(this._messages));
        writeFileSync("states/whatsapp/contacts.json", stringifyJSONMap(this._contacts));

    }

    readFromDisk() {

        try {
            if (existsSync("states/whatsapp/chats.json")) {
                this._chats = parseJSONMap(readFileSync("states/whatsapp/chats.json"));
            }
        } catch (e) {
            logger.error(e, "failed to load chats");
        }

        try {
            if (existsSync("states/whatsapp/messages.json")) {
                this._messages = parseJSONMap(readFileSync("states/whatsapp/messages.json"));
            }
        } catch (e) {
            logger.error(e, "failed to load messages");
        }

        try {
            if (existsSync("states/whatsapp/contacts.json")) {
                this._contacts = parseJSONMap(readFileSync("states/whatsapp/contacts.json"));
            }
        } catch (e) {
            logger.error(e, "failed to load contacts");
        }

    }

    purgeMessagesExceptLatest(amount) {

        for (const jid in Array.from(this._messages.keys())) {

            const keys = Array.from(this._messages.get(jid)?.keys() ?? []);

            if (keys.length > 0) {
                keys.sort((a, b) => (this._messages.get(jid).get(b).messageTimestamp ?? 0) - (this._messages.get(jid).get(a).messageTimestamp ?? 0));
                const deleted = keys.slice(amount - 1, null);
                
                for (const deletedKey of deleted) {
                    this._messages.get(jid).delete(deletedKey);
                }
            }

        }

    }

    listenMessageUpdate(listener) { // utility method that provides a full message instead of a partial when messages get updated
        this._messageUpdateListeners.push(listener);
    }

}

export class WhatsAppChatModule extends ChatModule {

    async authenticate() {

        if (existsSync("auths/whatsapp_auth_state")) {
            rmSync("auths/whatsapp_auth_state", { recursive: true });
        }
        mkdirSync("auths/whatsapp_auth_state");
        if (existsSync("states/whatsapp")) {
            rmSync("states/whatsapp", { recursive: true });
        }

        let sock = await this.makeSock(true);

        const onQrCodeUrl = url => console.log("QR code available at: " + url + "\nPlease scan it with your WhatsApp mobile app to link it.\nWSChat will show up as \"Google Chrome\" in your linked devices.\n\nPlease do note: Errors and other log statements will appear. Just ignore them.");

        await new Promise((res, rej) => {
    
            const onUpdate = async update => {
    
                try {
                
                    const { connection, lastDisconnect, qr } = update;
    
                    if (connection === "close" && lastDisconnect?.error?.output?.statusCode === DisconnectReason.restartRequired) {
                        sock = await this.makeSock(true);
                        sock.ev.on("connection.update", onUpdate);
                    } else if (connection === "close" && !!lastDisconnect?.error) {
                        logger.info("connection closed, error code: " + lastDisconnect?.error?.output?.statusCode);
                        rej(lastDisconnect?.error?.output);
                        return;
                    } else if (connection === "close" && !lastDisconnect?.error) {
                        logger.info("connection closed with no errors");
                        res();
                        return;
                    }
    
                    if (qr) {
                        await QRCode.toFile("qrcode.png", qr, { errorCorrectionLevel: "M" });
                        const body = new FormData();
                        body.set("files[]", await openAsBlob("qrcode.png"), "qrcode.png");
                        let response = await fetch("https://uguu.se/upload?output=text", {
                            method: "POST",
                            body
                        });
                        let content = await response.text();
                        unlinkSync("qrcode.png");
                        onQrCodeUrl(content);
                    }
                    
                    if (connection === "open") {
                        await sock.end();
                    }
    
                } catch (e) {
                    rej(e);
                    return;
                }
    
            };
    
            sock.ev.on("connection.update", onUpdate);

        });

        process.exit(0);

    }

    async fetchLatestVersion() {
        return [
            ...JSON.parse(await (await fetch("https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/versions.json")).text())["currentVersion"].replace("-alpha", "").split("."), "alpha"
        ];
    }

    async makeSock(isForAuth) {
    
        const { state, saveCreds } = await useMultiFileAuthState("auths/whatsapp_auth_state");
        const groupCache = new NodeCache();
    
        const conf = {
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            version: await this.fetchLatestVersion(),
            logger,
            browser: Browsers.windows("Google Chrome"),
            markOnlineOnConnect: false,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => !isForAuth,
            cachedGroupMetadata: async (jid) => groupCache.get(jid),
            getMessage: isForAuth ? undefined : async (key) => await store.getMessage(key)
        };
    
        const sock = makeWASocket(conf);

        if (!isForAuth) {

            sock.store = this.store;
            this.store.bind(sock);

        }

        sock.ev.on("creds.update", saveCreds);
    
        sock.ev.on("groups.update", async ([ event ]) => {
            const metadata = await sock.groupMetadata(event.id);
            groupCache.set(event.id, metadata);
        });
        
        sock.ev.on("group-participants.update", async event => {
            const metadata = await sock.groupMetadata(event.id);
            groupCache.set(event.id, metadata);
        });
    
        return sock;
    
    }

    openConnection(onSuccess, onError) {

        this.store = new Store();
        this.store.readFromDisk();

        this.makeSock(false).then(sock => {

            this.sock = sock;

            const done = () => {

                const save = (exit, err) => {
                    try {
                        this.store.purgeMessagesExceptLatest(100);
                        this.store.saveToDisk();
                        if (err) {
                            logger.error(err, "uncaught exception");
                        }
                        if (exit) {
                            process.exit(0);
                        }
                    } catch (e) {
                        logger.error(e, "encountered exception while saving whatsapp state");
                    }
                };
                
                sock.saveInterval = setInterval(() => save(false, null), 15_000);

                process.on("exit", () => save(true));
                process.on("SIGINT", () => save(true));
                process.on("SIGUSR1", () => save(true));
                process.on("SIGUSR2", () => save(true));
                process.on("uncaughtException", e => save(true, e));

                onSuccess();

            };

            sock.restartTries = 0;
            let syncInProgress = false;

            sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {

                try {
                
                    if (qr) {
                        sock.end();
                        onError("not authenticated, please authenticate whatsapp first");
                        return;
                    }
    
                    if (connection === "close" && lastDisconnect?.error?.output?.statusCode === DisconnectReason.restartRequired) {
    
                        this.openConnection(onSuccess, onError);
                        
                    } else if (connection === "close" && !!lastDisconnect?.error) {
    
                        logger.info("connection closed, error code: " + lastDisconnect.error.output?.statusCode);
    
                        if (lastDisconnect.error.output?.statusCode === DisconnectReason.loggedOut) {
                            onError("invalid session. re-authenticate");
                            return;
                        }
    
                        if (sock.restartTries > 5) {
                            logger.info("(whatsapp) Connection closed. Waiting for 5 seconds, then trying to reconnect.");
                            await new Promise((res, _) => setTimeout(res, 5_000));
                        } else if (sock.restartTries > 10) {
                            logger.info("(whatsapp) Connection closed. Waiting for 30 seconds, then trying to reconnect.");
                            await new Promise((res, _) => setTimeout(res, 30_000));
                        } else if (sock.restartTries > 20) {
                            logger.error("(whatsapp) Connection closed after 20 retries, giving up.");
                            this._fireEvent("closed", _DisconnectReason.CONNECTION_LOST);
                            return;
                        } else {
                            logger.info("(whatsapp) Connection closed. Waiting for 1 second, then trying to reconnect.");
                            await new Promise((res, _) => setTimeout(res, 1_000));
                        }
    
                        sock.restartTries++;
    
                        this.openConnection(onSuccess, onError);
    
                    }
    
                    if (connection === "open") {
    
                        if (sock.restartTries > 0) {
                            logger.info("(whatsapp) Successfully restored connection.");
                            sock.restartTries = 0;
                        }

                        logger.info("waiting 5 seconds for any history sync, then resuming");
                        await new Promise((res, _) => setTimeout(res, 5000));
                        if (!syncInProgress) {
                            done();
                        }
 
                    }
    
                } catch (e) {
                    onError(e);
                    return;
                }
    
            });

            sock.ev.on("messaging-history.set", async ({ chats, contacts, messages, isLatest, progress, syncType }) => {

                syncInProgress = true;

                if (progress) {
                    logger.info("whatsapp sync progress at " + progress);
                }
        
                if (progress === 100 && syncInProgress) {
                    done();
                }
        
            });

            sock.ev.on("messages.upsert", ({ messages, type, requestId }) => {
                if (type === "notify") {
                    for (const message of messages) {
                        
                        this._fireEvent("messageReceived", this.messageToWSCMessage(message), () => {

                            if (message.key.fromMe) {
                                return;
                            }

                            this.sock.readMessages([ message.key ]);

                        });

                    }
                }
            });

            this.store.listenMessageUpdate(message => {
                this._fireEvent("messageUpdated", message?.key?.id, normalizeJid(message?.key?.remoteJid), this.messageToWSCMessage(message));
            });

            sock.ev.on("messages.delete", ({ keys, jid, all }) => {

                if (all) {
                    this._fireEvent("messagesDeleted", store.getAllMessageKeysInChat(jid).map(key => key.id), normalizeJid(jid));
                } else {

                    const deleted = {};

                    for (const key of keys) {
                        
                        deleted[normalizeJid(key.remoteJid)] ??= [];
                        deleted[normalizeJid(key.remoteJid)].push(key.id);

                    }

                    for (const jid in deleted) {
                        const keys = deleted[jid];
                        this._fireEvent("messagesDeleted", keys.map(key => key.id), jid);
                    }

                }

            });

        });

    }

    closeConnection() {

        this.store.saveToDisk();
        this.sock?.end();
        this._fireEvent("closed", _DisconnectReason.MANUAL_DISCONNECT);

    }

    async fetchAllChats() { 
        return this.sock.store.getAllChats().map(chat => new Chat(normalizeJid(chat.id), chat.name ?? this.sock.store.getContact(chat.id)?.name ?? chat.displayName ?? "unknown", this.messageToWSCMessage(this.sock.store.getLatestMessage(chat.id)), true, true));
    }

    async fetchMessagesInChat(chatId) {
        return this.sock.store.getAllMessagesInChat(chatId).map(message => this.messageToWSCMessage(message));
    }

    async fetchUserInfo(userId) {
        return new Person(userId, this.sock.store.getContact(userId)?.name, "", await this.sock.fetchStatus([ userId ])[0].toString(), new Date(0));
    }

    sendMessage(chatId, content) {
        this.sock.sendMessage(chatId, { text: content });
    }

    deleteMessage(chatId, messageId) {
        this.sock.sendMessage(chatId, { delete: JSON.parse(messageId) });
    }

    editMessage(chatId, messageId, newContent) {
        this.sock.sendMessage(chatId, { text: newContent, edit: JSON.parse(messageId) });
    }

    /**
     * @param {import("baileys").WAMessage} message 
     */
    messageToWSCMessage(message) {

        if (!message) {
            return null;
        }

        let content = "";

        if (message.message?.imageMessage) { content += "<image>\n"; } 
        if (message.message?.documentMessage) { content += "<file>\n"; } 
        if (message.message?.audioMessage) { content += "<voice message>\n"; }
        if (message.message?.stickerMessage) { content += "<sticker>\n"; }
        if (message.message?.viewOnceMessage) { content += "<view-once message>\n"; }
        if (message.message?.viewOnceMessageV2) { content += "<view-once message>\n"; }
        if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) { content += "<in reply to another message>\n"; }
        content += message.message?.conversation ?? message.message?.extendedTextMessage?.text ?? "";

        return new Message(JSON.stringify(message.key), normalizeJid(message.key?.remoteJid), message.key?.participant, this.sock.store.getContact(message.key?.participant)?.name ?? message.pushName, content, new Date(parseInt(message.messageTimestamp) * 1000));
    }

    getId() {
        return "whatsapp";
    }

    getName() {
        return "WhatsApp";
    }

}
