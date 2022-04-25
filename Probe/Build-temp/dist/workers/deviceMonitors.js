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
const moment_1 = __importDefault(require("moment"));
const apiService_1 = __importDefault(require("../Utils/apiService"));
/*
 * It collects all IOT device monitors then check the last time they where pinged
 * If the difference is greater than 2 minutes
 * Creates incident if a website is down and resolves it when they come back up
 */
exports.default = {
    ping: (monitor) => __awaiter(void 0, void 0, void 0, function* () {
        const newDate = new moment_1.default();
        const resDate = new Date();
        if (monitor && monitor.type) {
            const d = new moment_1.default(monitor.lastPingTime);
            if (newDate.diff(d, 'minutes') > 3) {
                const time = yield apiService_1.default.getMonitorTime(monitor._id, newDate);
                if (time.status === 'online') {
                    yield apiService_1.default.ping(monitor._id, {
                        monitor,
                        type: monitor.type,
                    });
                }
            }
            else {
                const res = new Date().getTime() - resDate.getTime();
                const newTime = yield apiService_1.default.getMonitorTime(monitor._id, newDate);
                if (newTime.status === 'offline') {
                    yield apiService_1.default.ping(monitor._id, {
                        monitor,
                        res,
                        type: monitor.type,
                    });
                }
            }
        }
    }),
};
