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
/*
 * It collects all monitors then ping them one by one to store their response
 * Checks if the website of the url in the monitors is up or down
 * Creates incident if a website is down and resolves it when they come back up
 */
exports.default = {
    run: ({ monitor }) => __awaiter(void 0, void 0, void 0, function* () {
        if (monitor && monitor.type) {
            if (monitor.data.link && monitor.criteria) {
                const up = monitor.criteria.up
                    ? yield checkCondition(monitor.criteria.up)
                    : false;
                const degraded = monitor.criteria.degraded
                    ? yield checkCondition(monitor.criteria.degraded)
                    : false;
                const down = monitor.criteria.down
                    ? yield checkCondition(monitor.criteria.down)
                    : false;
                if (up || degraded || down) {
                    yield apiService_1.default.ping(monitor._id, {
                        monitor,
                        res: null,
                        resp: null,
                        type: monitor.type,
                        retryCount: 3,
                    });
                }
            }
        }
    }),
};
const checkCondition = (condition) => __awaiter(void 0, void 0, void 0, function* () {
    let response = false;
    if (condition && condition.and && condition.and.length) {
        for (let i = 0; i < condition.and.length; i++) {
            if (condition.and[i] &&
                condition.and[i].responseType &&
                condition.and[i].responseType === 'incomingTime') {
                response = true;
                break;
            }
            else if (condition.and[i] &&
                condition.and[i].collection &&
                condition.and[i].collection.length) {
                const tempAnd = yield checkCondition(condition.and[i].collection);
                if (tempAnd) {
                    response = true;
                }
            }
        }
    }
    else if (condition && condition.or && condition.or.length) {
        for (let i = 0; i < condition.or.length; i++) {
            if (condition.or[i] &&
                condition.or[i].responseType &&
                condition.or[i].responseType === 'incomingTime') {
                response = true;
                break;
            }
            else if (condition.or[i] &&
                condition.or[i].collection &&
                condition.or[i].collection.length) {
                const tempOr = yield checkCondition(condition.or[i].collection);
                if (tempOr) {
                    response = true;
                }
            }
        }
    }
    return response;
});
