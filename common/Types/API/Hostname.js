"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Hostname {
    constructor(hostname) {
        this._route = '';
        if (hostname) {
            this.hostname = hostname;
        }
    }
    get hostname() {
        return this._route;
    }
    set hostname(v) {
        this._route = v;
    }
    toString() {
        return this.hostname;
    }
}
exports.default = Hostname;
