"use strict";

import { Chat, ChatModule, DisconnectReason, Message, Person } from "../chats.js";
import { Client, GroupDMChannel, Message as DCMessage } from "discord.js-selfbot-youtsuho-v13";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import readline from "readline";

export class DiscordChatModule extends ChatModule {

    async authenticate() {

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const token = await new Promise((res, rej) => {
            rl.question("Please input your discord token. If you do not know how to obtain it, visit\nhttps://github.com/aiko-chan-ai/discord.js-selfbot-v13?#get-token-\n\nTOKEN: ", obtained => {
                rl.close();
                res(obtained);
            });
        });

        if (!existsSync("auths")) {
            mkdirSync("auths");
        }
        if (!existsSync("auths/discord_token.txt")) {
            writeFileSync("auths/discord_token.txt", token);
        }

    }

    openConnection(onSuccess, onError) {

        let token;

        if (!existsSync("auths/discord_token.txt")) {
            onError("Authentication not set up");
            return;
        } else {
            token = readFileSync("auths/discord_token.txt", { encoding: "utf-8" });
        }

        this.client = new Client();

        this.client.on("ready", async () => {
            this._fireEvent("opened");
        });

        this.client.on("messageCreate", async message => {
            if (message.channel.type !== "DM" && message.channel.type !== "GROUP_DM") {
                return;
            }
            this._fireEvent("messageReceived", this.discordMessageToWSCMessage(message), () => {
                if (message.author.id === this.client.user.id) {
                    return;
                }
                message.markRead();
            });
        });

        this.client.on("messageUpdate", async (_, newMessage) => {
            if (newMessage.channel.type !== "DM" && newMessage.channel.type !== "GROUP_DM") {
                return;
            }
            this._fireEvent("messageUpdated", newMessage.id, newMessage.channel.id, newMessage.cleanContent);
        });
        
        this.client.on("messageDelete", async message => {
            if (message.channel.type !== "DM" && message.channel.type !== "GROUP_DM") {
                return;
            }
            this._fireEvent("messageUpdated", message.id, message.channel.id, "<deleted>");
        });

        this.client.login(token).catch(onError).then(onSuccess);

    }

    closeConnection() {

        this.client.destroy().then(_ => this._fireEvent("closed", DisconnectReason.MANUAL_DISCONNECT));
        
    }

    async fetchAllChats() {

        let chats = [];

        const channels = await this.client.api.users("@me").channels.get();

        for (const channel of channels) {
            await this.client.channels.fetch(channel.id).catch(() => {});
        }

        const dms = this.client.channels.cache.filter(c => c.type === "DM" || c.type === "GROUP_DM");

        for (const dm of dms) {
            let isGroup = dm[1] instanceof GroupDMChannel;
            let lastMessageDC;
            try {
                lastMessageDC = dm[1].messages.cache.get(dm[1].lastMessageId) ?? (await dm[1].messages.fetch({ limit: 15 })).filter(m => !m.partial).first();
            } catch (e) {
                logger.error(e);
            }
            let lastMessage = this.discordMessageToWSCMessage(lastMessageDC);
            chats.push(new Chat(dm[1].id, isGroup ? dm[1].name : (dm[1].recipient.friendNickname ?? dm[1].recipient.displayName), lastMessage));
        }

        return chats;

    }

    async fetchMessagesInChat(channelId) {

        let messages = [];

        let channel = await this.client.channels.fetch(channelId);
        let fetchedMessages = await channel.messages.fetch({ limit: 100 });

        for (let message of fetchedMessages) {
            messages.push(this.discordMessageToWSCMessage(message[1]));
        }

        return messages;

    }

    async fetchUserInfo(userId) {

        let fetchedUser = await this.client.users.fetch(userId);
        return new Person(userId, fetchedUser.friendNickname ?? fetchedUser.displayName, fetchedUser.username, fetchedUser.bio ?? "<no bio found>", fetchedUser.createdAt);

    }

    sendMessage(channelId, content) {

        this.client.channels.fetch(channelId).then(channel => channel.send(content));

    }

    /**
     * @param {DCMessage} message 
     */
    discordMessageToWSCMessage(message) {
        let content = "";
        if (message?.attachments?.size > 0) {
            content += "<" + message.attachments.size + " attachments>\n"
        }
        if (message?.stickers?.size > 0) {
            content += "<sticker>";
        }
        if (message?.system) {
            content += "<system message>";
        }
        content += message?.cleanContent ?? "";
        if (content.length === 0) {
            content = null;
        }
        return new Message(message?.id, message?.channel?.id, message?.author?.id, message?.author?.friendNickname ?? message?.author?.displayName, content, message?.createdAt);
    }

    getId() {
        return "discord";
    }

    getName() {
        return "Discord";
    }

}