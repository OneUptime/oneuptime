"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ExceptionCode_1 = __importDefault(require("./ExceptionCode"));
class Exception extends Error {
    constructor(code, message) {
        super(message);
        this._code = ExceptionCode_1.default.GeneralException;
        this.code = code;
    }
    get code() {
        return this._code;
    }
    set code(v) {
        this._code = v;
    }
}
exports.default = Exception;
