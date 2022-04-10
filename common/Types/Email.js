"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const BadDataException_1 = __importDefault(require("./exception/BadDataException"));
class Email {
    constructor(email) {
        this._email = '';
        const re = /^(([^<>()[\].,;:\s@"]+(.[^<>()[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+.)+[^<>()[\].,;:\s@"]{2,})$/i;
        const isValid = re.test(email);
        if (!isValid) {
            throw new BadDataException_1.default('Email is not in valid format.');
        }
        this.email = email;
    }
    get email() {
        return this._email;
    }
    set email(v) {
        this._email = v;
    }
    toString() {
        return this.email;
    }
}
exports.default = Email;
