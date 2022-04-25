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
const ping_1 = __importDefault(require("ping"));
/*
 * It collects all monitors then ping them one by one to store their response
 * Checks if the IP Address of the IP monitor is up or down
 * Creates incident if a IP Address is down and resolves it when they come back up
 */
exports.default = {
    ping: ({ monitor }) => __awaiter(void 0, void 0, void 0, function* () {
        if (monitor && monitor.type) {
            if (monitor.data.IPAddress) {
                let retry = true;
                let retryCount = 0;
                while (retry || retryCount > 2) {
                    const { res, resp, rawResp } = yield pingfetch(monitor.data.IPAddress);
                    const response = yield apiService_1.default.ping(monitor._id, {
                        monitor,
                        res,
                        resp,
                        rawResp,
                        type: monitor.type,
                        retryCount,
                    });
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
const pingfetch = (IPAddress) => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date().getTime();
    let resp = null;
    let rawResp = null;
    let res = null;
    try {
        const response = yield ping_1.default.promise.probe(IPAddress, {
            timeout: 120,
            extra: ['-i', '2'],
        });
        const isAlive = response ? response.alive : false;
        res = new Date().getTime() - now;
        resp = {
            status: isAlive ? 200 : 408,
            body: null,
        };
        rawResp = {
            body: null,
            status: isAlive ? 200 : 408,
        };
    }
    catch (error) {
        res = new Date().getTime() - now;
        resp = { status: 408, body: error };
    }
    return { res, resp, rawResp };
});
