"use strict";

import { pino } from "pino";
import { pinoHttp } from "pino-http";
import pretty from "pino-pretty";

export const logger = pino({
    transport: {
        target: "pino-pretty",
        options: {
            colorize: pretty.isColorSupported
        }
    }
});

export const httpLogger = pinoHttp({
    logger
});