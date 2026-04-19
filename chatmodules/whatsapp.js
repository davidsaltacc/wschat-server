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

class Store {

    constructor() {
        this._messages = {};
        this._chats = {};
        this._contacts = {};
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
				this._messages[normalizeJid(message.key.remoteJid)] ??= {};
                this._messages[normalizeJid(message.key.remoteJid)][message.key] = message;
			}

            for (const chat of newChats) {
				this._chats[chat.id] = chat;
			}
            
            for (const contact of newContacts) {
				this._contacts[contact.id] = contact;
			}

        });

        socket.ev.on("messages.upsert", ({ messages, type }) => {
            if (type == "notify") {

                for (const message of messages) {
                    this._messages[normalizeJid(message.key.remoteJid)] ??= {};
                    this._messages[normalizeJid(message.key.remoteJid)][message.key] = message;
				}

            }
        });

        socket.ev.on("messages.update", updates => {

            for (const update of updates) {
                const newMessage = this._messages[normalizeJid(update.key.remoteJid)][update.key] = {
                    ...this._messages[normalizeJid(update.key.remoteJid)][update.key],
                    ...update.update
                };

                for (const listener of this._messageUpdateListeners) {
                    listener(newMessage);
                }
			}

        });

        socket.ev.on("messages.delete", ({ keys, jid, all }) => {

            if (all) {
                delete this._messages[jid];
            } else {
                for (const key of keys) {
                    delete this._messages[normalizeJid(key.remoteJid)][key];
                }
            }

        });

        socket.ev.on("chats.upsert", newChats => {
            for (const chat of newChats) {
                this._chats[normalizeJid(chat.newJid)] = chat;
            }
        });

        socket.ev.on("chats.delete", ids => {
            for (const id of ids) {
                delete this._chats[id];
            }
        });

        socket.ev.on("contacts.upsert", contacts => {
            for (const contact of contacts) {
				this._contacts[contact.id] = contact;
            }
        });

        socket.ev.on("contacts.update", contacts => {
            for (const contact of contacts) {
				this._contacts[contact.id] = {
                    ...this._contacts[contact.id],
                    ...contact
                }
            }
        });

    }

    getMessage(key) {
        return this._messages[normalizeJid(key.remoteJid)][key];
    }

    getLatestMessage(jid) {
        const keys = this._messages[normalizeJid(jid)].keys();
        keys.sort((a, b) => (this._messages[normalizeJid(jid)][b].messageTimestamp ?? 0) - (this._messages[normalizeJid(jid)][a].messageTimestamp ?? 0));
        return this._messages[normalizeJid(jid)][keys[0]];
    }
    
    getAllMessageKeysInChat(jid) {
        return this._messages[normalizeJid(jid)].keys();
    }
    
    getAllMessagesInChat(jid) {
        return this._messages[normalizeJid(jid)].values();
    }

    setMessage(message) {
        this._messages[normalizeJid(message.key.remoteJid)][message.key] = message;
    }

    getChat(jid) {
        return this._chats[normalizeJid(jid)];
    }

    setChat(chat) {
        this._chats[normalizeJid(chat.newJid)] = chat;
    }

    getAllChats() {
        return this._chats.values();
    } 

    getContact(id) {
        return this._contacts[id];
    }

    setContact(contact) {
        this._contacts[contact.id] = contact;
    }

    existsOnDisk() {
        return existsSync("states/whatsapp/chats.json") && existsSync("states/whatsapp/messages.json") && existsSync("states/whatsapp/contacts.json");
    }

    saveToDisk() { // we have to save whatsapp chats to disk, because unlike with discord we can't just really simply re-fetch some stuff as whatsapp is quite a bit stricter

        if (existsSync("states/whatsapp")) {
            mkdirSync("states/whatsapp", { recursive: true });
        }

        writeFileSync("states/whatsapp/chats.json", JSON.stringify(this._chats));
        writeFileSync("states/whatsapp/messages.json", JSON.stringify(this._messages));
        writeFileSync("states/whatsapp/contacts.json", JSON.stringify(this._contacts));

    }

    readFromDisk() {

        try {
            if (existsSync("states/whatsapp/chats.json")) {
                this._chats = JSON.parse(readFileSync("states/whatsapp/chats.json"));
            }
        } catch (e) {
            logger.error(e, "failed to load chats");
        }

        try {
            if (existsSync("states/whatsapp/messages.json")) {
                this._messages = JSON.parse(readFileSync("states/whatsapp/messages.json"));
            }
        } catch (e) {
            logger.error(e, "failed to load messages");
        }

        try {
            if (existsSync("states/whatsapp/contacts.json")) {
                this._contacts = JSON.parse(readFileSync("states/whatsapp/contacts.json"));
            }
        } catch (e) {
            logger.error(e, "failed to load contacts");
        }

    }

    purgeMessagesExceptLatest(amount) {

        for (const jid in this._messages) {

            const keys = this._messages[jid].keys();

            keys.sort((a, b) => (this._messages[jid][b].messageTimestamp ?? 0) - (this._messages[jid][a].messageTimestamp ?? 0));
            const deleted = keys.slice(amount - 1, null);
            
            for (const deletedKey of deleted) {
                delete this._messages[jid][deletedKey];
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

        const store = new Store();
    
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

            sock.store = store;
            store.bind(sock);

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

        this.makeSock(false).then(sock => {

            this.sock = sock;

            const store = new Store();
            store.readFromDisk();

            sock.store = store;
            store.bind(sock);

            const done = () => {

                const save = () => {
                    store.purgeMessagesExceptLatest(100);
                    store.saveToDisk();
                };
                
                sock.saveInterval = setInterval(() => save, 15_000);

                process.on("exit", save);
                process.on("SIGINT", save);
                process.on("SIGUSR1", save);
                process.on("SIGUSR2", save);
                process.on("uncaughtException", save);

                onSuccess();

            };

            sock.restartTries = 0;

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

                        if (sock.store.existsOnDisk()) {
                            done();
                        }
 
                    }
    
                } catch (e) {
                    onError(e);
                    return;
                }
    
            });

            sock.ev.on("messaging-history.set", async ({ chats, contacts, messages, isLatest, progress, syncType }) => {

                if (progress) {
                    logger.info("whatsapp sync progress at " + progress);
                }
        
                if (progress === 100 && !sock.store.existsOnDisk()) {
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

            store.listenMessageUpdate(message => {
                this._fireEvent("messageUpdated", update.key.id, normalizeJid(update.key.remoteJid), this.messageToWSCMessage(message));
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

        this.sock?.end();
        this._fireEvent("closed", _DisconnectReason.MANUAL_DISCONNECT);

    }

    async fetchAllChats() { 
        return this.sock.store.getAllChats().map(chat => new Chat(normalizeJid(chat.newJid), chat.displayName ?? chat.name, this.sock.store.getLatestMessage(chat.newJid), true, true));
    }

    async fetchMessagesInChat(chatId) {
        return this.sock.store.getAllMessagesInChat(chatId).map(message => this.messageToWSCMessage(message));
    }

    async fetchUserInfo(userId) {
        return new Person(userId, this.sock.store.getContact(userId).name, "", await this.sock.fetchStatus([ userId ])[0].toString(), new Date(0));
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

        let content = "";

        if (message.message?.imageMessage) { content += "<image>\n"; } 
        if (message.message?.documentMessage) { content += "<file>\n"; } 
        if (message.message?.audioMessage) { content += "<voice message>\n"; }
        if (message.message?.stickerMessage) { content += "<sticker>\n"; }
        if (message.message?.viewOnceMessage) { content += "<view-once message>\n"; }
        if (message.message?.viewOnceMessageV2) { content += "<view-once message>\n"; }
        if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) { content += "<in reply to another message>\n"; }
        content += message.message?.conversation ?? message.message?.extendedTextMessage?.text ?? "";

        return new Message(JSON.stringify(message.key), normalizeJid(message.key.remoteJid), message.key.participant, this.sock.store.getContact(message.key.participant).name ?? message.pushName, content, new Date(message.messageTimestamp));
    }

    getId() {
        return "whatsapp";
    }

    getName() {
        return "WhatsApp";
    }

}
