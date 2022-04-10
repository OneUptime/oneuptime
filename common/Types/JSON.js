"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JSONFunctions = void 0;
class JSONFunctions {
    toCompressedString(val) {
        return JSON.stringify(val, null, 2);
    }
    toString(val) {
        return JSON.stringify(val);
    }
}
exports.JSONFunctions = JSONFunctions;
