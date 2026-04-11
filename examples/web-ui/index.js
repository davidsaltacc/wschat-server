/**
 * @returns {HTMLElement | null}
 */
const q = e => document.querySelector(e);

function timeAgoNice(date) {
    const ranges = {
        years: 3600 * 24 * 365,
        months: 3600 * 24 * 30,
        weeks: 3600 * 24 * 7,
        days: 3600 * 24,
        hours: 3600,
        minutes: 60
    };
    const secondsElapsed = (date.getTime() - Date.now()) / 1000;
    for (let key in ranges) {
        if (ranges[key] < Math.abs(secondsElapsed)) {
            const delta = secondsElapsed / ranges[key];
            return new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }).format(Math.round(delta), key);
        }
    }
}

const loginButton = q("#login-button");
const loginOverlay = q("#login-overlay");
const serverUrlInput = q("#server-url-input");
const passwordInput = q("#password-input");
const loginStatus = q("#login-status-text");
const rememberLogin = q("#remember-login");
const loadingChats = q("#loading-chats-text");

serverUrlInput.value = "";

let loggedIn = false;
let loadedChats = [];
let chatUpdateInterval = null;

function constructChatsInUi() {
    
    loadingChats.style.display = "none";

    loadedChats.sort((a, b) => (b.lastMessage?.date ?? 0) - (a.lastMessage?.date ?? 0)); 

    for (const chat of loadedChats) {

        const baseChat = q("#basechat");
        const cloned = baseChat.cloneNode(true);
        baseChat.parentElement.appendChild(cloned);
    
        cloned.style.display = "";
        cloned.className = "chat";
        cloned.id = "chat-" + chat.chatId;

        const platform = cloned.querySelector("#basechat-platform");
        platform.innerHTML = chat.module;
        platform.id = "";
        if (chat.module == "discord") {
            platform.style.color = "#5865f2";
        }

        cloned.querySelector("#basechat-name").innerHTML = chat.chatName;
        cloned.querySelector("#basechat-name").id = "chat-" + chat.chatId + "-name";

        cloned.querySelector("#basechat-last-content").innerHTML = chat.lastMessage.content;
        cloned.querySelector("#basechat-last-content").id = "chat-" + chat.chatId + "-last-content";

        cloned.querySelector("#basechat-last-author").innerHTML = chat.lastMessage.authorDisplayName;
        cloned.querySelector("#basechat-last-author").id = "chat-" + chat.chatId + "-last-author";

        cloned.querySelector("#basechat-last-date").innerHTML = chat.lastMessage.date;
        cloned.querySelector("#basechat-last-date").id = "chat-" + chat.chatId + "-last-date";
        
        cloned.querySelector("#basechat-last-date-nice").id = "chat-" + chat.chatId + "-last-date-nice";

    }

    clearInterval(chatUpdateInterval);
    chatUpdateInterval = setInterval(() => {

        document.querySelectorAll(".chat").forEach(chatElement => {

            const date = new Date(parseInt(q("#" + chatElement.id + "-last-date").innerHTML));
            q("#" + chatElement.id + "-last-date-nice").innerHTML = timeAgoNice(date);

        });

    }, 1000);

}

function login(wsUrl) {

    loginButton.innerHTML = "Logging in...";
    loginButton.disabled = true;
    loginButton.style.color = "#8f8f8f";

    let ws;
    try {
        ws = new WebSocket(wsUrl);
    } catch (e) {
        loginStatus.innerHTML = "Failed to connect";
        loginButton.innerHTML = "Login";
        console.error(e);
        return;
    }

    ws.onerror = e => {
        loginStatus.innerHTML = "Error occured";
        loginButton.innerHTML = "Login";
        loginButton.disabled = false;
        loginButton.style.color = "#ffffff";
        loginOverlay.style.display = "";
        loadingChats.style.display = "";
        loggedIn = false;
        console.error(e);
    };

    ws.onopen = () => {

        loggedIn = true;

        if (rememberLogin.checked) {
            localStorage.setItem("wsurl", wsUrl);
        }

        loginOverlay.style.display = "none";

        ws.send(JSON.stringify({
            type: "requestChats",
            data: {}
        }));

    };

    ws.onmessage = event => {

        const rawData = event.data;
        const parsed = JSON.parse(rawData);
        const type = parsed.type;
        const data = parsed.data;

        switch (type) {
            case "chatList": {
                loadedChats = data.chats;
                constructChatsInUi();
                break;
            }
            default: {
                break;
            }
        }

    };
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

const _wsurl = localStorage.getItem("wsurl");
if (_wsurl) {
    login(_wsurl);
}