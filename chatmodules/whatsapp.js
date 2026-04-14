"use strict";

import makeWASocket, { Browsers, DisconnectReason, makeCacheableSignalKeyStore, useMultiFileAuthState } from "baileys";
import { ChatModule } from "../chats.js";
import { logger } from "../logger.js";
import { existsSync, mkdirSync, openAsBlob, rmSync, unlinkSync, writeFileSync } from "fs";
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
    }
    
    /** 
     * @param {ReturnType<typeof import("baileys").makeWASocket>} socket 
     */
    bind(socket) {

        socket.ev.on("messaging-history.set", ({
			chats: newChats,
			messages: newMessages
		}) => {

            for (const message of newMessages) {
				this._messages[normalizeJid(message.key.remoteJid)] ??= {};
                this._messages[normalizeJid(message.key.remoteJid)][message.key] = message;
			}
            for (const chat of newChats) {
				this._chats[chat.id] = chat;
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
            if (type == "notify") {

                for (const update of updates) {
                    this._messages[normalizeJid(update.key.remoteJid)][update.update.key]?.message?.conversation = update?.update?.message?.conversation;
                    this._messages[normalizeJid(update.key.remoteJid)][update.update.key]?.message?.extendedTextMessage = update?.update?.message?.extendedTextMessage;
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

    }

    getMessage(key) {
        return this._messages[normalizeJid(message.key.remoteJid)][key];
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

    saveToDisk() { // we have to save whatsapp chats to disk, because unlike with discord we can't just really simply re-fetch some stuff as whatsapp is quite a bit stricter

        if (existsSync("states/whatsapp")) {
            mkdirSync("states/whatsapp", { recursive: true });
        }

        writeFileSync("states/whatsapp/chats.json", JSON.stringify(this._chats));
        writeFileSync("states/whatsapp/messages.json", JSON.stringify(this._messages));

    }

    readFromDisk() {
        // TODO
    }

    purgeMessagesExceptLatest(amount) { // TODO keep `amount` messages in each chat (sort by date, ideally)
        // TODO
    }

}

export class WhatsAppChatModule extends ChatModule {

    async authenticate() {

        rmSync("auths/auth_state", { recursive: true });
        mkdirSync("auths/auth_state");

        let sock = this.makeSock(true);

        const onQrCodeUrl = url => console.log("QR code available at: " + url + "\nPlease scan it with your WhatsApp mobile app to link it.\nWSChat will show up as \"Google Chrome\" in your linked devices.");

        await new Promise((res, rej) => {
    
            const onUpdate = async update => {
    
                try {
                
                    const { connection, lastDisconnect, qr } = update;
    
                    if (connection === "close" && lastDisconnect?.error?.output?.statusCode === DisconnectReason.restartRequired) {
                        sock = await makeSock(true);
                        sock.ev.on("connection.update", onUpdate);
                    } else if (connection === "close" && !!lastDisconnect?.error) {
                        logger.info("connection closed, error code: " + lastDisconnect.error.output?.statusCode);
                        rej(new Error(lastDisconnect?.error?.output));
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
                        res();
                    }
    
                } catch (e) {
                    rej(e);
                    return;
                }
    
            };
    
            sock.ev.on("connection.update", onUpdate);
    
        });
    
        await sock.end();

    }

    async fetchLatestVersion() {
        return [
            ...JSON.parse(await (await fetch("https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/versions.json")).text())["currentVersion"].replace("-alpha", "").split("."), "alpha"
        ];
    }

    async makeSock(isForAuth) {
    
        const { state, saveCreds } = await useMultiFileAuthState("auth_state");
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
            getMessage: async (key) => await store.getMessage(key)
        };
    
        const sock = makeWASocket(conf);

        sock.store = store;
        store.bind(sock);
        
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

    getId() {
        return "whatsapp";
    }

    getName() {
        return "WhatsApp";
    }

}