"use strict";

export class Person {

    constructor(id, displayName, uniqueName, biography, creationDate) {
        this.id = id;
        this.displayName = displayName;
        this.uniqueName = uniqueName;
        this.biography = biography;
        this.creationDate = creationDate;
    }

}

export class Message {

    constructor(messageId, authorId, authorDisplayName, content, date) {
        this.messageId = messageId;
        this.authorId = authorId;
        this.authorName = authorDisplayName;
        this.content = content;
        this.date = date;
    }

}

export class Chat {

    constructor(chatId, chatName, lastMessage) {
        this.chatId = chatId;
        this.chatName = chatName;
        this.lastMessage = lastMessage;
    }

}

export class DisconnectReason {
    static MANUAL_DISCONNECT = 0;
    static CONNECTION_LOST = 1;
    static ERROR_OCCURED = 2;
}

export class ChatModule {

    // common events:
    // opened(), closed(DisconnectReason), error(Exception), messageReceived(Message), messageUpdated(any(messageId), string(newContent))

    constructor() {
        if (this.constructor == ChatModule) {
            throw new Error("Tried to instantiate abstract ChatModule class");
        }
        this.events = {};
    }

    async authenticate() { // authenticate somehow and save authentication state to disk somehow, will be called seperate from main program
        throw new Error("authenticate is not implemented");
    }

    on(event, handler) {
        this.events[event] ??= [];
        this.events[event].push(handler);
    }

    removeEventHandler(event, handler) {
        this.events[event] ??= [];
        this.events[event] = this.events[event].splice(this.events[event].indexOf(handler), 1);
    }

    _fireEvent(event, ...data) {
        this.events[event] ??= [];
        this.events[event].forEach(handler => {
            handler(...data);
        });
    }

    openConnection(onSuccess, onError) {
        throw new Error("openConnection is not implemented");
    }

    closeConnection() {
        throw new Error("closeConnection is not implemented");
    }

    async fetchAllChats() { // return Chat[]
        throw new Error("fetchAllChats is not implemented");
    }

    async fetchMessagesInChat(chatId) { // return Message[]
        throw new Error("fetchMessagesInChat is not implemented");
    }

    async fetchUserInfo(userId) { // return User
        throw new Error("fetchUserInfo is not implemented");
    }

    sendMessage(content) {
        throw new Error("sendMessage is not implemented");
    }

    getId() {
        throw new Error("getId is not implemented");
    }

    getName() {
        throw new Error("getName is not implemented");
    }

}
