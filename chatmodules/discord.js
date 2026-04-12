"use strict";

import { Chat, ChatModule, DisconnectReason, Message, Person } from "../chats.js";
import { logger } from "../logger.js";
import { Client, GroupDMChannel } from "discord.js-selfbot-youtsuho-v13";
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
            this._fireEvent("messageReceived", new Message(message.id, message.channel.id, message.author.id, message.author.displayName, message.content, message.createdAt), () => {
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
            this._fireEvent("messageUpdated", newMessage.id, newMessage.channel.id, newMessage.content);
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
                lastMessageDC = dm[1].messages.cache.get(dm[1].lastMessageId) ?? await dm[1].messages.fetch(dm[1].lastMessageId);
                // TODO appears to be invalid, shows as "undefined" in UI if the last message in chat was deleted at some point (todo just fetch the next normal one)
            } catch (e) {
                logger.error(e);
            }
            let lastMessage = new Message(lastMessageDC?.id, dm[1].id, lastMessageDC?.author?.id, lastMessageDC?.author?.displayName, lastMessageDC?.content, lastMessageDC?.createdAt);
            chats.push(new Chat(dm[1].id, isGroup ? dm[1].name : dm[1].recipient.displayName, lastMessage));
        }

        return chats;

    }

    async fetchMessagesInChat(channelId) {

        let messages = [];

        let channel = await this.client.channels.fetch(channelId);
        let fetchedMessages = await channel.messages.fetch({ limit: 100 });

        for (let message of fetchedMessages) {
            message = message[1];
            messages.push(new Message(message.id, channelId, message.author.id, message.author.displayName, message.content, message.createdAt));
        }

        return messages;

    }

    async fetchUserInfo(userId) {

        let fetchedUser = await this.client.users.fetch(userId);
        return new Person(userId, fetchedUser.displayName, fetchedUser.username, "", fetchedUser.createdAt);
        // TODO if the selfbot api can fetch user bio's

    }

    sendMessage(channelId, content) {

        this.client.channels.fetch(channelId).then(channel => channel.send(content));

    }

    getId() {
        return "discord";
    }

    getName() {
        return "Discord";
    }

}