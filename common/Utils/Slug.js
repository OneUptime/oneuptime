"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const slugify_1 = __importDefault(require("slugify"));
const nanoid_1 = require("nanoid");
const nanoid_dictionary_1 = require("nanoid-dictionary");
class Slug {
    static getSlug(name) {
        name = String(name);
        if (!name || !name.trim())
            return;
        let slug = (0, slugify_1.default)(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });
        slug = `${slug}-${(0, nanoid_1.customAlphabet)(nanoid_dictionary_1.numbers, 10)}`;
        slug = slug.toLowerCase();
        return slug;
    }
}
exports.default = Slug;
