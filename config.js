"use strict";

import { logger } from "./logger.js";
import { DiscordChatModule } from "./chatmodules/discord.js";
import { readFileSync } from "fs";

logger.info("Reading config file");

const configFile = readFileSync("CONFIG", { encoding: "utf8" });

if (!configFile) {
    throw new Error("CONFIG file not present.");
}

const config = {};

for (let line of configFile.split("\n")) {
    if (!line.trimStart().startsWith("#")) {
        let pair = line.split("=");
        if (pair.length > 1) {
            config[pair[0]] = pair.slice(1).join("=").trim();
        }
    }
}

const allModules = [
    DiscordChatModule
];

const enabledModulesIds = config["enabledModules"].split(",");
const enabledModules = [];

for (const module of allModules) {
    let instance = new module();
    if (enabledModulesIds.indexOf(instance.getId()) >= 0) {
        enabledModules.push(instance);
    }
}

export const ENABLED_MODULES = enabledModules;
export const PORT = parseInt(config["port"]);
export const USE_INSECURE = config["useTLS"] === "false";

