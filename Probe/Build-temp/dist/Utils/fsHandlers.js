"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const readdir = (0, util_1.promisify)(fs_1.default.readdir);
const rmdir = (0, util_1.promisify)(fs_1.default.rmdir);
const unlink = (0, util_1.promisify)(fs_1.default.unlink);
/**
 * @description a promise based utility to read content of a file
 * @param {string} filePath path to file
 */
function readFileContent(filePath) {
    return new Promise((resolve, reject) => {
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.readFile(filePath, { encoding: 'utf8' }, (error, data) => {
                if (error) {
                    reject(error);
                }
                resolve(data);
            });
        }
    });
}
/**
 * @description an asynchronous function to handle deleting a file
 * @param {string} file path to file
 */
function deleteFile(file) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs_1.default.existsSync(file)) {
            yield unlink(file);
        }
    });
}
/**
 * @description a promise based utility to handle deleting a folder and it's content
 * @param {string} dir directory with or without file
 */
function deleteFolderRecursive(dir) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs_1.default.existsSync(dir)) {
            const entries = yield readdir(dir, { withFileTypes: true });
            yield Promise.all(entries.map((entry) => {
                const fullPath = path_1.default.join(dir, entry.name);
                return entry.isDirectory()
                    ? deleteFolderRecursive(fullPath)
                    : unlink(fullPath);
            }));
            yield rmdir(dir); // Finally remove now empty directory
        }
    });
}
exports.default = {
    readFileContent,
    deleteFile,
    deleteFolderRecursive,
};
