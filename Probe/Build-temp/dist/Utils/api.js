"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const config_1 = __importDefault(require("./config"));
const _this = {
    getHeaders: () => {
        return {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
            probeName: config_1.default.probeName,
            probeKey: config_1.default.probeKey,
            clusterKey: config_1.default.clusterKey,
            probeVersion: config_1.default.probeVersion,
        };
    },
    post: (url, data) => {
        const headers = this.getHeaders();
        return new Promise((resolve, reject) => {
            /*
             * Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
             * https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
             */
            (0, axios_1.default)({
                method: 'POST',
                url: `${config_1.default.dataIngestorUrl}/${url}`,
                headers,
                data,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
                .then((response) => {
                resolve(response.data);
            })
                .then((error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                reject(error);
            });
        });
    },
    get: (url, limit = 10) => {
        const headers = this.getHeaders();
        return new Promise((resolve, reject) => {
            (0, axios_1.default)({
                method: 'GET',
                url: `${config_1.default.probeApiUrl}/${url}?limit=${limit}`,
                headers,
            })
                .then((response) => {
                resolve(response.data);
            })
                .then((error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                reject(error);
            });
        });
    },
    put: (url, data) => {
        const headers = this.getHeaders();
        return new Promise((resolve, reject) => {
            /*
             * Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
             * https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
             */
            (0, axios_1.default)({
                method: 'PUT',
                url: `${config_1.default.dataIngestorUrl}/${url}`,
                headers,
                data,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
                .then((response) => {
                resolve(response.data);
            })
                .then((error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                reject(error);
            });
        });
    },
    delete: (url, data) => {
        const headers = this.getHeaders();
        return new Promise((resolve, reject) => {
            (0, axios_1.default)({
                method: 'DELETE',
                url: `${config_1.default.dataIngestorUrl}/${url}`,
                headers,
                data,
            })
                .then((response) => {
                resolve(response.data);
            })
                .then((error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                reject(error);
            });
        });
    },
};
exports.default = _this;
