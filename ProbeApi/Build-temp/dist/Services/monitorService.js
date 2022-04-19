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
const database_1 = __importDefault(require("CommonServer/Utils/database"));
const Date_1 = __importDefault(require("Common/Types/Date"));
const monitorCollection = database_1.default.getDatabase().collection('monitors');
exports.default = {
    getProbeMonitors(probeId, limit) {
        return __awaiter(this, void 0, void 0, function* () {
            //Get monitors that have not been pinged for the last minute.
            const date = Date_1.default.getOneMinAgo();
            const key = `${probeId}_pingtime`;
            const emptyQuery = {
                deleted: false,
                disabled: false,
                type: {
                    $in: ['url', 'api'],
                },
                [key]: { $exists: false },
            };
            const query = {
                deleted: false,
                disabled: false,
                type: {
                    $in: [
                        'url',
                        'api',
                        'incomingHttpRequest',
                        'kubernetes',
                        'ip',
                        'server-monitor',
                    ],
                },
                [key]: { $lt: date },
            };
            let monitors = [];
            const monitorsThatHaveNeverBeenPinged = yield monitorCollection.find(emptyQuery).limit(limit).toArray();
            monitors = monitors.concat(monitorsThatHaveNeverBeenPinged);
            if (monitorsThatHaveNeverBeenPinged.length < limit) {
                const monitorsThatHaveBeenPingedBeforeOneMinute = yield monitorCollection
                    .find(query)
                    .sort({ [key]: 1 })
                    .limit(limit)
                    .toArray();
                monitors = monitors.concat(monitorsThatHaveBeenPingedBeforeOneMinute);
            }
            if (monitors && monitors.length > 0) {
                yield monitorCollection.updateMany({
                    _id: {
                        $in: monitors.map((monitor) => {
                            return monitor._id;
                        }),
                    },
                }, { $set: { [key]: new Date((0, moment_1.default)().format()) } });
                return monitors;
            }
            return [];
        });
    },
};
