
const q = e => document.querySelector(e);

const loginButton = q("#login-button");
const serverUrlInput = q("#server-url-input");
const passwordInput = q("#password-input");
const loginStatus = q("#login-status-text");
const rememberLogin = q("#remember-login");

serverUrlInput.value = "";

loginButton.onclick = () => {
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

        loginButton.innerHTML = "Logging in...";

        const ws = new WebSocket(wsUrl.href);

    });
};