"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Exception_1 = __importDefault(require("./Exception"));
const ExceptionCode_1 = __importDefault(require("./ExceptionCode"));
class BadDataException extends Exception_1.default {
    constructor(message) {
        super(ExceptionCode_1.default.BadDataException, message);
    }
}
exports.default = BadDataException;
