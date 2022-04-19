"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UUID = void 0;
var buffer_1 = require("buffer");
var ensure_buffer_1 = require("./ensure_buffer");
var binary_1 = require("./binary");
var uuid_utils_1 = require("./uuid_utils");
var utils_1 = require("./parser/utils");
var error_1 = require("./error");
var BYTE_LENGTH = 16;
var kId = Symbol('id');
/**
 * A class representation of the BSON UUID type.
 * @public
 */
var UUID = /** @class */ (function () {
    /**
     * Create an UUID type
     *
     * @param input - Can be a 32 or 36 character hex string (dashes excluded/included) or a 16 byte binary Buffer.
     */
    function UUID(input) {
        if (typeof input === 'undefined') {
            // The most common use case (blank id, new UUID() instance)
            this.id = UUID.generate();
        }
        else if (input instanceof UUID) {
            this[kId] = buffer_1.Buffer.from(input.id);
            this.__id = input.__id;
        }
        else if (ArrayBuffer.isView(input) && input.byteLength === BYTE_LENGTH) {
            this.id = ensure_buffer_1.ensureBuffer(input);
        }
        else if (typeof input === 'string') {
            this.id = uuid_utils_1.uuidHexStringToBuffer(input);
        }
        else {
            throw new error_1.BSONTypeError('Argument passed in UUID constructor must be a UUID, a 16 byte Buffer or a 32/36 character hex string (dashes excluded/included, format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).');
        }
    }
    Object.defineProperty(UUID.prototype, "id", {
        /**
         * The UUID bytes
         * @readonly
         */
        get: function () {
            return this[kId];
        },
        set: function (value) {
            this[kId] = value;
            if (UUID.cacheHexString) {
                this.__id = uuid_utils_1.bufferToUuidHexString(value);
            }
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Generate a 16 byte uuid v4 buffer used in UUIDs
     */
    /**
     * Returns the UUID id as a 32 or 36 character hex string representation, excluding/including dashes (defaults to 36 character dash separated)
     * @param includeDashes - should the string exclude dash-separators.
     * */
    UUID.prototype.toHexString = function (includeDashes) {
        if (includeDashes === void 0) { includeDashes = true; }
        if (UUID.cacheHexString && this.__id) {
            return this.__id;
        }
        var uuidHexString = uuid_utils_1.bufferToUuidHexString(this.id, includeDashes);
        if (UUID.cacheHexString) {
            this.__id = uuidHexString;
        }
        return uuidHexString;
    };
    /**
     * Converts the id into a 36 character (dashes included) hex string, unless a encoding is specified.
     */
    UUID.prototype.toString = function (encoding) {
        return encoding ? this.id.toString(encoding) : this.toHexString();
    };
    /**
     * Converts the id into its JSON string representation.
     * A 36 character (dashes included) hex string in the format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
     */
    UUID.prototype.toJSON = function () {
        return this.toHexString();
    };
    /**
     * Compares the equality of this UUID with `otherID`.
     *
     * @param otherId - UUID instance to compare against.
     */
    UUID.prototype.equals = function (otherId) {
        if (!otherId) {
            return false;
        }
        if (otherId instanceof UUID) {
            return otherId.id.equals(this.id);
        }
        try {
            return new UUID(otherId).id.equals(this.id);
        }
        catch (_a) {
            return false;
        }
    };
    /**
     * Creates a Binary instance from the current UUID.
     */
    UUID.prototype.toBinary = function () {
        return new binary_1.Binary(this.id, binary_1.Binary.SUBTYPE_UUID);
    };
    /**
     * Generates a populated buffer containing a v4 uuid
     */
    UUID.generate = function () {
        var bytes = utils_1.randomBytes(BYTE_LENGTH);
        // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
        // Kindly borrowed from https://github.com/uuidjs/uuid/blob/master/src/v4.js
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        return buffer_1.Buffer.from(bytes);
    };
    /**
     * Checks if a value is a valid bson UUID
     * @param input - UUID, string or Buffer to validate.
     */
    UUID.isValid = function (input) {
        if (!input) {
            return false;
        }
        if (input instanceof UUID) {
            return true;
        }
        if (typeof input === 'string') {
            return uuid_utils_1.uuidValidateString(input);
        }
        if (utils_1.isUint8Array(input)) {
            // check for length & uuid version (https://tools.ietf.org/html/rfc4122#section-4.1.3)
            if (input.length !== BYTE_LENGTH) {
                return false;
            }
            try {
                // get this byte as hex:             xxxxxxxx-xxxx-XXxx-xxxx-xxxxxxxxxxxx
                // check first part as uuid version: xxxxxxxx-xxxx-Xxxx-xxxx-xxxxxxxxxxxx
                return parseInt(input[6].toString(16)[0], 10) === binary_1.Binary.SUBTYPE_UUID;
            }
            catch (_a) {
                return false;
            }
        }
        return false;
    };
    /**
     * Creates an UUID from a hex string representation of an UUID.
     * @param hexString - 32 or 36 character hex string (dashes excluded/included).
     */
    UUID.createFromHexString = function (hexString) {
        var buffer = uuid_utils_1.uuidHexStringToBuffer(hexString);
        return new UUID(buffer);
    };
    /**
     * Converts to a string representation of this Id.
     *
     * @returns return the 36 character hex string representation.
     * @internal
     */
    UUID.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    UUID.prototype.inspect = function () {
        return "new UUID(\"" + this.toHexString() + "\")";
    };
    return UUID;
}());
exports.UUID = UUID;
Object.defineProperty(UUID.prototype, '_bsontype', { value: 'UUID' });
//# sourceMappingURL=uuid.js.map