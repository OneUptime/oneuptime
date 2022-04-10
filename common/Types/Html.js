"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class HTML {
    constructor(html) {
        this._html = '';
        this.html = html;
    }
    get html() {
        return this._html;
    }
    set html(v) {
        this._html = v;
    }
    toString() {
        return this.html;
    }
}
exports.default = HTML;
