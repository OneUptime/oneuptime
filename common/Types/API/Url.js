"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Protocol_1 = __importDefault(require("./Protocol"));
const Route_1 = __importDefault(require("./Route"));
const Hostname_1 = __importDefault(require("./Hostname"));
class URL {
    constructor(protocol, hostname, route) {
        this._route = new Route_1.default();
        this._hostname = new Hostname_1.default('localhost');
        this._protocol = Protocol_1.default.HTTPS;
        this.hostname = hostname;
        this.protocol = protocol;
        if (route) {
            this.route = route;
        }
    }
    get route() {
        return this._route;
    }
    set route(v) {
        this._route = v;
    }
    get hostname() {
        return this._hostname;
    }
    set hostname(v) {
        this._hostname = v;
    }
    get protocol() {
        return this._protocol;
    }
    set protocol(v) {
        this._protocol = v;
    }
    isHttps() {
        return this.protocol === Protocol_1.default.HTTPS;
    }
    toString() {
        return `${this.protocol}${this.hostname}${this.route}`;
    }
}
exports.default = URL;
