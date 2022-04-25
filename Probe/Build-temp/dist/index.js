"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("CommonServer/utils/env");
require("CommonServer/utils/process");
const await_sleep_1 = __importDefault(require("await-sleep"));
const main_1 = __importDefault(require("./workers/main"));
const config_1 = __importDefault(require("./utils/config"));
const Logger_1 = __importDefault(require("CommonServer/Utils/Logger"));
const cronMinuteStartTime = Math.floor(Math.random() * 50);
setTimeout(() => __awaiter(void 0, void 0, void 0, function* () {
    // Keep monitoring in an infinate loop.
    //eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            yield main_1.default.runJob();
        }
        catch (error) {
            Logger_1.default.error(error);
            Logger_1.default.info('Sleeping for 30 seconds...');
            yield (0, await_sleep_1.default)(30 * 1000);
        }
    }
}), cronMinuteStartTime * 1000);
Logger_1.default.info(`Probe with Probe Name ${config_1.default.probeName} and Probe Key ${config_1.default.probeKey}. OneUptime Probe API URL: ${config_1.default.probeApiUrl}`);
