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
const apiService_1 = __importDefault(require("../Utils/apiService"));
const pingFetch_1 = __importDefault(require("../Utils/pingFetch"));
const Logger_1 = __importDefault(require("CommonServer/Utils/Logger"));
/*
 * It collects all monitors then ping them one by one to store their response
 * Checks if the website of the url in the monitors is up or down
 * Creates incident if a website is down and resolves it when they come back up
 */
exports.default = {
    ping: ({ monitor }) => __awaiter(void 0, void 0, void 0, function* () {
        if (monitor && monitor.type) {
            if (monitor.data.url) {
                const headers = yield apiService_1.default.headers(monitor.headers, monitor.bodyType);
                const body = yield apiService_1.default.body(monitor && monitor.text && monitor.text.length
                    ? monitor.text
                    : monitor.formData, monitor && monitor.text && monitor.text.length
                    ? 'text'
                    : 'formData');
                let retry = true;
                let retryCount = 0;
                while (retry || retryCount > 2) {
                    const { res, resp, rawResp } = yield (0, pingFetch_1.default)(monitor.data.url, monitor.method, body, headers);
                    Logger_1.default.info(`Monitor ID ${monitor._id}: Start saving data to ingestor.`);
                    const response = yield apiService_1.default.ping(monitor._id, {
                        monitor,
                        res,
                        resp,
                        rawResp,
                        type: monitor.type,
                        retryCount,
                    });
                    Logger_1.default.info(`Monitor ID ${monitor._id}: End saving data to ingestor.`);
                    if (response && !response.retry) {
                        retry = false;
                    }
                    else {
                        retryCount++;
                    }
                }
            }
        }
    }),
};
