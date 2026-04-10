"use strict";

import { logger } from "./logger.js";
import { createHash, timingSafeEqual } from "crypto";

const tokens = [];

export function initAuth() {

    logger.info("Setting up authentication");

    const tokensFile = readFileSync("TOKENS", { encoding: "utf8" });

    if (!tokensFile) {
        throw new Error("TOKENS file not present.");
    }

    for (let line of tokensFile.split("\n")) {
        if (!line.trimStart().startsWith("#")) {
            let pair = line.split(".");
            if (pair.length === 2) {
                tokens.push({
                    hash: Uint8Array.from(Buffer.from(pair[0], "base64")),
                    salt: Uint8Array.from(Buffer.from(pair[1], "base64"))
                });
            }
        }
    }

}

export function authenticate(request, next) {
    
    try {
        if (request.headers.authorization) {
            
            const authSha256 = request.headers.authorization;
    
            for (let token in tokens) {
                let toHash = authSha256.toLowerCase() + token.salt.toString("hex").toLowerCase();
                let hashed = createHash("sha256").update(toHash).digest();
                if (timingSafeEqual(hashed, token.hash)) {
                    next(null, true);
                    return;
                }
            }
        }
    } catch (e) {
        next(e, false);
        return;
    }

    next(null, false);
    
}
