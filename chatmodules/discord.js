import { Chat, ChatModule, DisconnectReason, Message } from "../chats";
import { Client, GroupDMChannel } from "discord.js-selfbot-youtsuho-v13";

class DiscordChatModule extends ChatModule {

    constructor(token) {
        super();
        this.token = token;
    }

    openConnection() {

        this.client = new Client();

        this.client.on("ready", async () => {
            this._fireEvent("opened");
        });

        this.client.on("messageCreate", async message => {
            this._fireEvent("messageReceived", new Message(message.id, message.author.id, message.author.displayName, message.content, message.createdAt));
        });

        this.client.on("messageUpdate", async (_, newMessage) => {
            this._fireEvent("messageUpdated", newMessage.id, newMessage.content);
        });

        this.client.login(token);

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
            let isGroup = dm instanceof GroupDMChannel;
            let lastMessage = new Message(dm[1].lastMessage.author.id, dm[1].lastMessage.author.displayName, dm[1].lastMessage.content, dm[1].lastMessage.createdAt);
            chats.push(new Chat(dm[1].id, isGroup ? dm[1].name : dm[1].recipient.displayName, lastMessage));
        }

        return chats;

    }

    getId() {
        return "discord";
    }

    getName() {
        return "Discord";
    }

}