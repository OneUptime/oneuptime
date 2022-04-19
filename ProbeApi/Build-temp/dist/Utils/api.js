"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const _this = {
    getHeaders: () => {
        return {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
            clusterKey: config_1.clusterKey,
        };
    },
    post: (url, data, withBaseUrl = false) => {
        const headers = this.getHeaders();
        return new Promise((resolve, reject) => {
            /*
             * Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
             * https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
             */
            (0, axios_1.default)({
                method: 'POST',
                url: withBaseUrl ? `${url}` : `${config_1.serverUrl}/${url}`,
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
};
exports.default = _this;
