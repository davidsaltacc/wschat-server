"use strict";

import readline from "readline";
import { createHash, randomBytes } from "crypto";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const password = await new Promise((res, rej) => {
    rl.question("Plaintext password: ", obtained => {
        rl.close();
        res(obtained.trim());
    });
});

const passHashHexLower = createHash("sha256").update(password).digest("hex").toLowerCase();
const salt = randomBytes(8); 
const merged = passHashHexLower + salt.toString("hex").toLowerCase(); 
const finalHashBase64 = createHash("sha256").update(merged).digest("base64");
const finalToken = finalHashBase64 + "." + salt.toString("base64");

console.log(finalToken);