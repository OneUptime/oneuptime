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
const axios_1 = __importDefault(require("axios"));
const URL_1 = __importDefault(require("../Types/API/URL"));
const Response_1 = __importDefault(require("../Types/API/Response"));
const ErrorResponse_1 = __importDefault(require("../Types/API/ErrorResponse"));
const HTTPMethod_1 = __importDefault(require("../Types/API/HTTPMethod"));
const ApiException_1 = __importDefault(require("../Types/exception/ApiException"));
const Protocol_1 = __importDefault(require("../Types/API/Protocol"));
const Hostname_1 = __importDefault(require("../Types/API/Hostname"));
class API {
    constructor(protocol, hostname) {
        this._protocol = Protocol_1.default.HTTPS;
        this._hostname = new Hostname_1.default('localhost');
        this.protocol = protocol;
        this.hostname = hostname;
    }
    get protocol() {
        return this._protocol;
    }
    set protocol(v) {
        this._protocol = v;
    }
    get hostname() {
        return this._hostname;
    }
    set hostname(v) {
        this._hostname = v;
    }
    get(path, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield API.get(new URL_1.default(this.protocol, this.hostname, path), data, headers);
        });
    }
    delete(path, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield API.delete(new URL_1.default(this.protocol, this.hostname, path), data, headers);
        });
    }
    put(path, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield API.put(new URL_1.default(this.protocol, this.hostname, path), data, headers);
        });
    }
    post(path, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield API.post(new URL_1.default(this.protocol, this.hostname, path), data, headers);
        });
    }
    static handleError(error) {
        return error;
    }
    static getDefaultHeaders() {
        const defaultHeaders = {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
        };
        return defaultHeaders;
    }
    static getHeaders(headers) {
        let defaultHeaders = this.getDefaultHeaders();
        if (headers) {
            defaultHeaders = Object.assign(Object.assign({}, defaultHeaders), headers);
        }
        return defaultHeaders;
    }
    static get(url, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.fetch(HTTPMethod_1.default.GET, url, data, headers);
        });
    }
    static delete(url, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.fetch(HTTPMethod_1.default.DELETE, url, data, headers);
        });
    }
    static put(url, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.fetch(HTTPMethod_1.default.PUT, url, data, headers);
        });
    }
    static post(url, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.fetch(HTTPMethod_1.default.POST, url, data, headers);
        });
    }
    static fetch(method, url, data, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            const apiHeaders = this.getHeaders(headers);
            try {
                const result = yield (0, axios_1.default)({
                    method: method,
                    url: url.toString(),
                    headers: apiHeaders,
                    data,
                });
                const response = new Response_1.default(result.status, result.data);
                return response;
            }
            catch (e) {
                const error = e;
                let errorResponse;
                if (axios_1.default.isAxiosError(error)) {
                    // do whatever you want with native error
                    errorResponse = this.getErrorResponse(error);
                }
                else {
                    errorResponse = new ApiException_1.default(error.message);
                }
                this.handleError(errorResponse);
                throw errorResponse;
            }
        });
    }
    static getErrorResponse(error) {
        if (error.response) {
            return new ErrorResponse_1.default(error.response.status, error.response.data);
        }
        throw new ApiException_1.default('No error response body');
    }
}
exports.default = API;
