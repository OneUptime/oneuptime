"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Route {
    constructor(route) {
        this._route = '';
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
    toString() {
        return this.route;
    }
}
exports.default = Route;
