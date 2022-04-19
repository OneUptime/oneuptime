"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bufferToUuidHexString = exports.uuidHexStringToBuffer = exports.uuidValidateString = void 0;
var buffer_1 = require("buffer");
var error_1 = require("./error");
// Validation regex for v4 uuid (validates with or without dashes)
var VALIDATION_REGEX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15})$/i;
var uuidValidateString = function (str) {
    return typeof str === 'string' && VALIDATION_REGEX.test(str);
};
exports.uuidValidateString = uuidValidateString;
var uuidHexStringToBuffer = function (hexString) {
    if (!exports.uuidValidateString(hexString)) {
        throw new error_1.BSONTypeError('UUID string representations must be a 32 or 36 character hex string (dashes excluded/included). Format: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" or "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".');
    }
    var sanitizedHexString = hexString.replace(/-/g, '');
    return buffer_1.Buffer.from(sanitizedHexString, 'hex');
};
exports.uuidHexStringToBuffer = uuidHexStringToBuffer;
var bufferToUuidHexString = function (buffer, includeDashes) {
    if (includeDashes === void 0) { includeDashes = true; }
    return includeDashes
        ? buffer.toString('hex', 0, 4) +
            '-' +
            buffer.toString('hex', 4, 6) +
            '-' +
            buffer.toString('hex', 6, 8) +
            '-' +
            buffer.toString('hex', 8, 10) +
            '-' +
            buffer.toString('hex', 10, 16)
        : buffer.toString('hex');
};
exports.bufferToUuidHexString = bufferToUuidHexString;
//# sourceMappingURL=uuid_utils.js.map