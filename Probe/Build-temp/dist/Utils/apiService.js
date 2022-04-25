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
const api_1 = __importDefault(require("./api"));
exports.default = {
    headers: (val, type) => __awaiter(void 0, void 0, void 0, function* () {
        const header = {};
        if (type && type.length) {
            header['Content-Type'] = type;
        }
        if (val && val.length) {
            val.forEach((head) => {
                header[head.key] = head.value;
            });
        }
        return header;
    }),
    body: (val, type) => __awaiter(void 0, void 0, void 0, function* () {
        let bodyContent = {};
        if (type && type === 'formData' && val && val[0] && val[0].key) {
            val.forEach((bod) => {
                bodyContent[bod.key] = bod.value;
            });
            bodyContent = JSON.stringify(bodyContent);
        }
        else if (type && type === 'text' && val && val.length) {
            bodyContent = val;
        }
        return bodyContent;
    }),
    setMonitorTime: function (monitorId, responseTime, responseStatus, status) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield api_1.default.post(`probe/setTime/${monitorId}`, {
                responseTime,
                responseStatus,
                status,
            });
        });
    },
    getMonitorTime: function (monitorId, date) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield api_1.default.post(`probe/getTime/${monitorId}`, { date });
        });
    },
    ping: function (monitorId, data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield api_1.default.post(`probe/ping/${monitorId}`, data);
        });
    },
    setScanStatus: function (monitorIds, status) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield api_1.default.post('probe/set-scan-status', {
                scanning: status,
                monitorIds,
            });
        });
    },
    addProbeScan: function (monitorIds) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield api_1.default.post('probe/add-probe-scan', { monitorIds });
        });
    },
    removeProbeScan: function (monitorIds) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield api_1.default.post('probe/remove-probe-scan', { monitorIds });
        });
    },
};
