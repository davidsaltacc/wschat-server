/**
 * @returns {HTMLElement | null}
 */
const q = e => document.querySelector(e);
const qA = e => document.querySelectorAll(e);

function timeAgoNice(date) {
    const ranges = {
        years: 3600 * 24 * 365,
        months: 3600 * 24 * 30,
        weeks: 3600 * 24 * 7,
        days: 3600 * 24,
        hours: 3600,
        minutes: 60,
        seconds: 1
    };
    const secondsElapsed = (date.getTime() - Date.now()) / 1000;
    for (let key in ranges) {
        if (ranges[key] < Math.abs(secondsElapsed)) {
            const delta = secondsElapsed / ranges[key];
            return new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }).format(Math.round(delta), key);
        }
    }
    return "now";
}

qA("textarea").forEach(textarea => {
    textarea.style.height = (textarea.scrollHeight - 12) + "px";
    textarea.style.overflowY = "hidden";
  
    textarea.addEventListener("input", () => {
        textarea.style.height = "auto";
        textarea.style.height = (textarea.scrollHeight - 12) + "px";
    });
});

const loginButton = q("#login-button");
const logoutButton = q("#logout-button");
const loginOverlay = q("#login-overlay");
const chatsOverlay = q("#chats-overlay");
const serverUrlInput = q("#server-url-input");
const passwordInput = q("#password-input");
const loginStatus = q("#login-status-text");
const rememberLogin = q("#remember-login");
const loadingChats = q("#loading-chats-text");
const closeChatsButton = q("#close-chat-button");
const sendMessageContent = q("#sendmessage-content");
const sendMessageButton = q("#sendmessage-button");

serverUrlInput.value = "";

let loggedIn = false;
let loadedChats = [];
let chatUpdateInterval = null;
let messagesUpdateInterval = null;
let openedChatId = null;
let onChatHistoryFetched = () => {};
let ws;

function clearChats() {

    const baseChat = q("#basechat");
    const cloned = baseChat.cloneNode(true);
    const chatContainer = baseChat.parentElement;
    chatContainer.innerHTML = "";
    chatContainer.appendChild(cloned);

}

function clearMessages() {

    const baseMessage = q("#basemessage");
    const cloned = baseMessage.cloneNode(true);
    const messagesContainer = baseMessage.parentElement;
    messagesContainer.innerHTML = "";
    messagesContainer.appendChild(cloned);

}

function constructChatMessages(chat) {

    clearMessages();

    chat.messages.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

    for (const message of chat.messages) {

        const baseMessage = q("#basemessage");
        const cloned = baseMessage.cloneNode(true);
        baseMessage.parentElement.appendChild(cloned);
    
        cloned.style.display = "";
        cloned.className = "message";
        cloned.id = "message-" + message.messageId;

        cloned.querySelector("#basemessage-author").innerText = message.authorDisplayName;
        cloned.querySelector("#basemessage-author").id = "message-" + message.messageId + "-author";
        
        cloned.querySelector("#basemessage-content").innerText = message.content;
        cloned.querySelector("#basemessage-content").id = "message-" + message.messageId + "-content";
        
        cloned.querySelector("#basemessage-date").innerText = message.date;
        cloned.querySelector("#basemessage-date").id = "message-" + message.messageId + "-date";

        cloned.querySelector("#basemessage-date-nice").id = "message-" + message.messageId + "-date-nice";

    }

    clearInterval(messagesUpdateInterval);
    const updateTimes = () => {

        qA(".message").forEach(messageElement => {

            const date = new Date(parseInt(q("#" + messageElement.id + "-date").innerHTML));
            q("#" + messageElement.id + "-date-nice").innerText = timeAgoNice(date);

        });

    };
    updateTimes();
    messagesUpdateInterval = setInterval(updateTimes, 1000);

}

function openChat(id) {

    openedChatId = id;

    ws.send(JSON.stringify({
        type: "chatOpened",
        data: {
            chatId: id
        }
    }));

    chatsOverlay.style.display = "none";

    clearMessages();

    const openChatName = q("#openchat-name");
    const openChatPlatform = q("#openchat-platform");

    let chat = loadedChats.filter(c => c.chatId === id);
    if (chat.length > 0) {
        chat = chat[0];
    } else {
        closeChatsButton.click();
        return;
    }

    openChatName.innerText = chat.chatName;
    openChatPlatform.innerText = chat.module;
    openChatPlatform.style.color = "#ffffff";
    if (chat.module == "discord") {
        openChatPlatform.style.color = "#5865f2";
    }

    sendMessageButton.onclick = () => {

        if (openedChatId == null) {
            return;
        }

        const content = sendMessageContent.value;

        if (content.length === 0) {
            return;
        }

        sendMessageContent.value = "";
        sendMessageContent.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));


        ws.send(JSON.stringify({
            type: "messageSent",
            data: {
                chatId: openedChatId,
                module: q("#openchat-platform").innerText,
                content
            }
        }));

    };

    if (!chat.historyFetched) {

        ws.send(JSON.stringify({
            type: "requestMessages",
            data: {
                chatId: id,
                module: chat.module
            }
        }));

        onChatHistoryFetched = chat => {
            chat.historyFetched = true;
            constructChatMessages(chat);
        };

        return;

    } 
    
    constructChatMessages(chat);

}

function constructChatList() {

    clearChats();
    
    loadingChats.style.display = "none";

    loadedChats.sort((a, b) => (b.lastMessage?.date ?? 0) - (a.lastMessage?.date ?? 0)); 

    for (const chat of loadedChats) {

        const baseChat = q("#basechat");
        const cloned = baseChat.cloneNode(true);
        baseChat.parentElement.appendChild(cloned);
    
        cloned.style.display = "";
        cloned.className = "chat";
        cloned.id = "chat-" + chat.chatId;

        cloned.onclick = () => openChat(chat.chatId);

        const platform = cloned.querySelector("#basechat-platform");
        platform.innerText = chat.module;
        platform.id = "";
        platform.style.color = "#ffffff";
        if (chat.module == "discord") {
            platform.style.color = "#5865f2";
        }

        cloned.querySelector("#basechat-name").innerText = chat.chatName;
        cloned.querySelector("#basechat-name").id = "chat-" + chat.chatId + "-name";

        cloned.querySelector("#basechat-last-content").innerText = chat.lastMessage.content?.replaceAll("\n", " ");
        cloned.querySelector("#basechat-last-content").id = "chat-" + chat.chatId + "-last-content";

        cloned.querySelector("#basechat-last-author").innerText = chat.lastMessage.authorDisplayName;
        cloned.querySelector("#basechat-last-author").id = "chat-" + chat.chatId + "-last-author";

        cloned.querySelector("#basechat-last-date").innerText = chat.lastMessage.date;
        cloned.querySelector("#basechat-last-date").id = "chat-" + chat.chatId + "-last-date";
        
        cloned.querySelector("#basechat-last-date-nice").id = "chat-" + chat.chatId + "-last-date-nice";

    }

    clearInterval(chatUpdateInterval);
    const updateTimes = () => {

        qA(".chat").forEach(chatElement => {

            const date = new Date(parseInt(q("#" + chatElement.id + "-last-date").innerHTML));
            q("#" + chatElement.id + "-last-date-nice").innerText = timeAgoNice(date);

        });

    };
    updateTimes();
    chatUpdateInterval = setInterval(updateTimes, 1000);

}

function login(wsUrl) {

    loginButton.innerHTML = "Logging in...";
    loginButton.disabled = true;
    loginButton.style.color = "#8f8f8f";

    let _ws;
    try {
        _ws = new WebSocket(wsUrl);
    } catch (e) {
        loginStatus.innerHTML = "Failed to connect";
        loginButton.innerHTML = "Login";
        console.error(e);
        return;
    }

    _ws.onerror = e => {
        loginStatus.innerHTML = "Error occured";
        loginButton.innerHTML = "Login";
        loginButton.disabled = false;
        loginButton.style.color = "#ffffff";
        loginOverlay.style.display = "flex";
        chatsOverlay.style.display = "flex";
        loadingChats.style.display = "";
        loggedIn = false;
        _ws.send(JSON.stringify({
            type: "disconnect",
            data: {}
        }));
        console.error(e);
    };

    _ws.onopen = () => {

        loggedIn = true;

        if (rememberLogin.checked) {
            localStorage.setItem("wsurl", wsUrl);
        }

        loginOverlay.style.display = "none";

        _ws.send(JSON.stringify({
            type: "requestChats",
            data: {}
        }));

    };

    _ws.onmessage = event => {

        const rawData = event.data;
        const parsed = JSON.parse(rawData);
        const type = parsed.type;
        const data = parsed.data;

        switch (type) {
            case "chatList": {
                loadedChats = data.chats;
                for (const chat of loadedChats) {
                    chat.messages = [ chat.lastMessage ];
                    chat.historyFetched = false;
                }
                constructChatList();
                break;
            }
            case "messageList": {
                let chat = loadedChats.filter(c => c.chatId === data.chatId);
                if (chat.length > 0) {
                    chat = chat[0];
                    chat.messages = chat.messages.concat(data.messages);
                    chat.messages = [...new Map(chat.messages.map(m => [m.messageId, m])).values()]; // remove dupes
                    chat.messages.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
                    chat.messages = chat.messages.slice(null, 200); // only keep last 200 messages
                    onChatHistoryFetched(chat);
                }
                break;
            }
            case "messageReceived": {
                let chat = loadedChats.filter(c => c.chatId === data.chatId);
                if (chat.length > 0) {
                    chat = chat[0];
                    chat.lastMessage = data.message;
                    chat.messages.push(data.message);
                    chat.messages.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
                    chat.messages = chat.messages.slice(null, 200); // only keep last 200 messages
                    constructChatList();
                    if (openedChatId === data.chatId) {
                        constructChatMessages(chat);
                    }
                }
                break;
            }
            case "messageUpdated": {
                let chat = loadedChats.filter(c => c.chatId === data.chatId);
                if (chat.length > 0) {
                    chat = chat[0];
                    let message = chat.messages.filter(c => c.messageId === data.messageId);
                    if (message.length > 0) {
                        message = message[0];
                        chat.messages[chat.messages.indexOf(message)].content = data.newContent;
                    }
                    constructChatList();
                    if (openedChatId === data.chatId) {
                        constructChatMessages(chat);
                    }
                }
                break;
            }
            default: {
                break;
            }
        }

    };

    ws = _ws;
}

loginButton.onclick = () => {

    if (loggedIn) {
        return;
    }

    crypto.subtle.digest("SHA-256", new TextEncoder("utf-8").encode(passwordInput.value)).then(function(hash) { // sha256 of password
        
        const hashHex = [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("").toLowerCase(); // to lower hex
        
        let wsUrl;
        try {
            wsUrl = new URL(serverUrlInput.value);
        } catch {
            loginStatus.innerHTML = "Invalid URL";
            return;
        }
        loginStatus.innerHTML = "";

        wsUrl.searchParams.append("authentication", hashHex);

        login(wsUrl.href);

    });

};

logoutButton.onclick = () => {

    if (!loggedIn) {
        return;
    }

    clearInterval(chatUpdateInterval);
    chatUpdateInterval = null;

    ws.send(JSON.stringify({
        type: "disconnect",
        data: {
            chatId: null
        }
    }));

    localStorage.removeItem("wsurl");
    window.location.reload();

};

closeChatsButton.onclick = () => {

    openedChatId = null;

    clearInterval(messagesUpdateInterval);
    messagesUpdateInterval = null;

    ws.send(JSON.stringify({
        type: "chatOpened",
        data: {
            chatId: null
        }
    }));

    chatsOverlay.style.display = "flex";

}

const _wsurl = localStorage.getItem("wsurl");
if (_wsurl) {
    login(_wsurl);
}
