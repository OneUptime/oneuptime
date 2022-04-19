"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureBuffer = void 0;
var buffer_1 = require("buffer");
var error_1 = require("./error");
var utils_1 = require("./parser/utils");
/**
 * Makes sure that, if a Uint8Array is passed in, it is wrapped in a Buffer.
 *
 * @param potentialBuffer - The potential buffer
 * @returns Buffer the input if potentialBuffer is a buffer, or a buffer that
 * wraps a passed in Uint8Array
 * @throws BSONTypeError If anything other than a Buffer or Uint8Array is passed in
 */
function ensureBuffer(potentialBuffer) {
    if (ArrayBuffer.isView(potentialBuffer)) {
        return buffer_1.Buffer.from(potentialBuffer.buffer, potentialBuffer.byteOffset, potentialBuffer.byteLength);
    }
    if (utils_1.isAnyArrayBuffer(potentialBuffer)) {
        return buffer_1.Buffer.from(potentialBuffer);
    }
    throw new error_1.BSONTypeError('Must use either Buffer or TypedArray');
}
exports.ensureBuffer = ensureBuffer;
//# sourceMappingURL=ensure_buffer.js.map