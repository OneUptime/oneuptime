"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const StartServer_1 = __importDefault(require("CommonServer/utils/StartServer"));
StartServer_1.default.use(['/ProbeAPI/probe', '/probe'], require('./api/probe'));
exports.default = StartServer_1.default;
