"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const BadDataException_1 = __importDefault(require("./exception/BadDataException"));
class PositiveNumber {
    constructor(positiveNumber) {
        this._positiveNumber = 0;
        if (positiveNumber < 0) {
            throw new BadDataException_1.default('positiveNumber cannot be less than 0');
        }
        this.positiveNumber = positiveNumber;
    }
    get positiveNumber() {
        return this._positiveNumber;
    }
    set positiveNumber(v) {
        this._positiveNumber = v;
    }
    toString() {
        return this.positiveNumber.toString();
    }
    toNumber() {
        return this.positiveNumber;
    }
}
exports.default = PositiveNumber;
