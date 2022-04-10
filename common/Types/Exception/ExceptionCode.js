"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ExceptionCode;
(function (ExceptionCode) {
    ExceptionCode[ExceptionCode["GeneralException"] = 1] = "GeneralException";
    ExceptionCode[ExceptionCode["APIException"] = 2] = "APIException";
    ExceptionCode[ExceptionCode["BadDataException"] = 400] = "BadDataException";
})(ExceptionCode || (ExceptionCode = {}));
exports.default = ExceptionCode;
