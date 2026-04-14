"use strict";

import { logger } from "./logger.js";
logger.level = "warn";
const { ENABLED_MODULES } = await import("./config.js"); // dynamic import to stop logs from messing with user interaction

for (const module of ENABLED_MODULES) {
    
    console.log("Authenticating " + module.getName())
    await module.authenticate();

}