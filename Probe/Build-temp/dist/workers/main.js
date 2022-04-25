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
const Logger_1 = __importDefault(require("CommonServer/Utils/Logger"));
const api_1 = __importDefault(require("../Utils/api"));
const apiMonitors_1 = __importDefault(require("./apiMonitors"));
const urlMonitors_1 = __importDefault(require("./urlMonitors"));
const ipMonitors_1 = __importDefault(require("./ipMonitors"));
const serverMonitors_1 = __importDefault(require("./serverMonitors"));
const incomingHttpRequestMonitors_1 = __importDefault(require("./incomingHttpRequestMonitors"));
const kubernetesMonitors_1 = __importDefault(require("./kubernetesMonitors"));
let limit = process.env['RESOURCES_LIMIT'];
if (limit && typeof limit === 'string') {
    limit = parseInt(limit);
}
const await_sleep_1 = __importDefault(require("await-sleep"));
const _this = {
    runJob: function () {
        return __awaiter(this, void 0, void 0, function* () {
            Logger_1.default.info(`Getting a list of ${limit} monitors`);
            let monitors = yield api_1.default.get('probe/monitors', limit);
            monitors = JSON.parse(monitors.data); // Parse the stringified data
            Logger_1.default.info(`Number of Monitors fetched - ${monitors.length} monitors`);
            if (monitors.length === 0) {
                // There are no monitors to monitor. Sleep for 30 seconds and then wake up.
                Logger_1.default.info('No monitors to monitor. Sleeping for 30 seconds.');
                yield (0, await_sleep_1.default)(30 * 1000);
            }
            // Loop over the monitor
            for (const monitor of monitors) {
                Logger_1.default.info(`Monitor ID ${monitor._id}: Currently monitoring`);
                if (monitor.type === 'api') {
                    Logger_1.default.info(`Monitor ID ${monitor._id}: Start monitoring API monitor`);
                    yield apiMonitors_1.default.ping({ monitor });
                    Logger_1.default.info(`Monitor ID ${monitor._id}: End monitoring API monitor`);
                }
                else if (monitor.type === 'url') {
                    Logger_1.default.info(`Monitor ID ${monitor._id}: Start monitoring URL monitor`);
                    yield urlMonitors_1.default.ping({ monitor });
                    Logger_1.default.info(`Monitor ID ${monitor._id}: End monitoring URL monitor`);
                }
                else if (monitor.type === 'ip') {
                    Logger_1.default.info(`Monitor ID ${monitor._id}: Start monitoring IP monitor`);
                    yield ipMonitors_1.default.ping({ monitor });
                    Logger_1.default.info(`Monitor ID ${monitor._id}: End monitoring IP monitor`);
                }
                else if (monitor.type === 'server-monitor' &&
                    monitor.agentlessConfig) {
                    Logger_1.default.info(`Monitor ID ${monitor._id}: Start monitoring Server monitor`);
                    yield serverMonitors_1.default.run({ monitor });
                    Logger_1.default.info(`Monitor ID ${monitor._id}: End monitoring Server monitor`);
                }
                else if (monitor.type === 'incomingHttpRequest') {
                    Logger_1.default.info(`Monitor ID ${monitor._id}: Start monitoring Incoming HTTP Request monitor`);
                    yield incomingHttpRequestMonitors_1.default.run({ monitor });
                    Logger_1.default.info(`Monitor ID ${monitor._id}: End monitoring Incoming HTTP Request monitor`);
                }
                else if (monitor.type === 'kubernetes') {
                    Logger_1.default.info(`Monitor ID ${monitor._id}: Start monitoring Kubernetes monitor`);
                    yield kubernetesMonitors_1.default.run({ monitor });
                    Logger_1.default.info(`Monitor ID ${monitor._id}: End monitoring Kubernetes monitor`);
                }
            }
        });
    },
};
exports.default = _this;
