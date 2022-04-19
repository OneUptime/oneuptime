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
const Express_1 = __importDefault(require("CommonServer/utils/Express"));
const monitorService_1 = __importDefault(require("../Services/monitorService"));
const router = Express_1.default.getRouter();
const ProbeAuthorization_1 = __importDefault(require("CommonServer/middleware/ProbeAuthorization"));
const Response_1 = require("CommonServer/utils/Response");
const Response_2 = require("CommonServer/utils/Response");
const PositiveNumber_1 = __importDefault(require("Common/Types/PositiveNumber"));
router.get('/monitors', ProbeAuthorization_1.default.isAuthorizedProbe, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const oneUptimeRequest = req;
        const limit = new PositiveNumber_1.default(parseInt(req.query.limit || '10'));
        const monitors = yield monitorService_1.default.getProbeMonitors(oneUptimeRequest.probe.id, limit);
        return (0, Response_2.sendListResponse)(req, res, monitors, monitors.length);
    }
    catch (error) {
        return (0, Response_1.sendErrorResponse)(req, res, error);
    }
}));
exports.default = router;
