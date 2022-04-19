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
const moment_1 = __importDefault(require("moment"));
const mongodb_1 = require("mongodb");
const database_1 = __importDefault(require("CommonServer/utils/database"));
const probeCollection = database_1.default.getDatabase().collection('probes');
const uuid_1 = require("uuid");
const api_1 = require("../Utils/api");
const Config_1 = require("../Config");
const realtimeBaseUrl = `${Config_1.realtimeUrl}/realtime`;
exports.default = {
    create: function (data) {
        return __awaiter(this, void 0, void 0, function* () {
            let probeKey;
            if (data.probeKey) {
                probeKey = data.probeKey;
            }
            else {
                probeKey = (0, uuid_1.v1)();
            }
            const storedProbe = yield this.findOneBy({
                probeName: data.probeName,
            });
            if (storedProbe && storedProbe.probeName) {
                const error = new Error('Probe name already exists.');
                error.code = 400;
                throw error;
            }
            else {
                const probe = {};
                probe.probeKey = probeKey;
                probe.probeName = data.probeName;
                probe.version = data.probeVersion;
                const now = new Date((0, moment_1.default)().format());
                probe.createdAt = now;
                probe.lastAlive = now;
                probe.deleted = false;
                const result = yield probeCollection.insertOne(probe);
                const savedProbe = yield this.findOneBy({
                    _id: (0, mongodb_1.ObjectId)(result.insertedId),
                });
                return savedProbe;
            }
        });
    },
    findOneBy: function (query) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!query) {
                query = {};
            }
            if (!query.deleted) {
                query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
            }
            const probe = yield probeCollection.findOne(query);
            return probe;
        });
    },
    updateOneBy: function (query, data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!query) {
                query = {};
            }
            if (!query.deleted) {
                query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
            }
            yield probeCollection.updateOne(query, { $set: data });
            const probe = yield this.findOneBy(query);
            return probe;
        });
    },
    updateProbeStatus: function (probeId) {
        return __awaiter(this, void 0, void 0, function* () {
            const now = new Date((0, moment_1.default)().format());
            yield probeCollection.updateOne({
                _id: (0, mongodb_1.ObjectId)(probeId),
                $or: [{ deleted: false }, { deleted: { $exists: false } }],
            }, { $set: { lastAlive: now } });
            const probe = yield this.findOneBy({
                _id: (0, mongodb_1.ObjectId)(probeId),
            });
            // Realtime update for probe
            (0, api_1.post)(`${realtimeBaseUrl}/update-probe`, { data: probe }, true);
            return probe;
        });
    },
};
