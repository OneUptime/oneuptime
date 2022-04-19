"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectId = void 0;
var buffer_1 = require("buffer");
var ensure_buffer_1 = require("./ensure_buffer");
var error_1 = require("./error");
var utils_1 = require("./parser/utils");
// Regular expression that checks for hex value
var checkForHexRegExp = new RegExp('^[0-9a-fA-F]{24}$');
// Unique sequence for the current process (initialized on first use)
var PROCESS_UNIQUE = null;
var kId = Symbol('id');
/**
 * A class representation of the BSON ObjectId type.
 * @public
 */
var ObjectId = /** @class */ (function () {
    /**
     * Create an ObjectId type
     *
     * @param inputId - Can be a 24 character hex string, 12 byte binary Buffer, or a number.
     */
    function ObjectId(inputId) {
        if (!(this instanceof ObjectId))
            return new ObjectId(inputId);
        // workingId is set based on type of input and whether valid id exists for the input
        var workingId;
        if (typeof inputId === 'object' && inputId && 'id' in inputId) {
            if (typeof inputId.id !== 'string' && !ArrayBuffer.isView(inputId.id)) {
                throw new error_1.BSONTypeError('Argument passed in must have an id that is of type string or Buffer');
            }
            if ('toHexString' in inputId && typeof inputId.toHexString === 'function') {
                workingId = buffer_1.Buffer.from(inputId.toHexString(), 'hex');
            }
            else {
                workingId = inputId.id;
            }
        }
        else {
            workingId = inputId;
        }
        // the following cases use workingId to construct an ObjectId
        if (workingId == null || typeof workingId === 'number') {
            // The most common use case (blank id, new objectId instance)
            // Generate a new id
            this[kId] = ObjectId.generate(typeof workingId === 'number' ? workingId : undefined);
        }
        else if (ArrayBuffer.isView(workingId) && workingId.byteLength === 12) {
            this[kId] = ensure_buffer_1.ensureBuffer(workingId);
        }
        else if (typeof workingId === 'string') {
            if (workingId.length === 12) {
                var bytes = buffer_1.Buffer.from(workingId);
                if (bytes.byteLength === 12) {
                    this[kId] = bytes;
                }
                else {
                    throw new error_1.BSONTypeError('Argument passed in must be a string of 12 bytes');
                }
            }
            else if (workingId.length === 24 && checkForHexRegExp.test(workingId)) {
                this[kId] = buffer_1.Buffer.from(workingId, 'hex');
            }
            else {
                throw new error_1.BSONTypeError('Argument passed in must be a string of 12 bytes or a string of 24 hex characters');
            }
        }
        else {
            throw new error_1.BSONTypeError('Argument passed in does not match the accepted types');
        }
        // If we are caching the hex string
        if (ObjectId.cacheHexString) {
            this.__id = this.id.toString('hex');
        }
    }
    Object.defineProperty(ObjectId.prototype, "id", {
        /**
         * The ObjectId bytes
         * @readonly
         */
        get: function () {
            return this[kId];
        },
        set: function (value) {
            this[kId] = value;
            if (ObjectId.cacheHexString) {
                this.__id = value.toString('hex');
            }
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ObjectId.prototype, "generationTime", {
        /**
         * The generation time of this ObjectId instance
         * @deprecated Please use getTimestamp / createFromTime which returns an int32 epoch
         */
        get: function () {
            return this.id.readInt32BE(0);
        },
        set: function (value) {
            // Encode time into first 4 bytes
            this.id.writeUInt32BE(value, 0);
        },
        enumerable: false,
        configurable: true
    });
    /** Returns the ObjectId id as a 24 character hex string representation */
    ObjectId.prototype.toHexString = function () {
        if (ObjectId.cacheHexString && this.__id) {
            return this.__id;
        }
        var hexString = this.id.toString('hex');
        if (ObjectId.cacheHexString && !this.__id) {
            this.__id = hexString;
        }
        return hexString;
    };
    /**
     * Update the ObjectId index
     * @privateRemarks
     * Used in generating new ObjectId's on the driver
     * @internal
     */
    ObjectId.getInc = function () {
        return (ObjectId.index = (ObjectId.index + 1) % 0xffffff);
    };
    /**
     * Generate a 12 byte id buffer used in ObjectId's
     *
     * @param time - pass in a second based timestamp.
     */
    ObjectId.generate = function (time) {
        if ('number' !== typeof time) {
            time = Math.floor(Date.now() / 1000);
        }
        var inc = ObjectId.getInc();
        var buffer = buffer_1.Buffer.alloc(12);
        // 4-byte timestamp
        buffer.writeUInt32BE(time, 0);
        // set PROCESS_UNIQUE if yet not initialized
        if (PROCESS_UNIQUE === null) {
            PROCESS_UNIQUE = utils_1.randomBytes(5);
        }
        // 5-byte process unique
        buffer[4] = PROCESS_UNIQUE[0];
        buffer[5] = PROCESS_UNIQUE[1];
        buffer[6] = PROCESS_UNIQUE[2];
        buffer[7] = PROCESS_UNIQUE[3];
        buffer[8] = PROCESS_UNIQUE[4];
        // 3-byte counter
        buffer[11] = inc & 0xff;
        buffer[10] = (inc >> 8) & 0xff;
        buffer[9] = (inc >> 16) & 0xff;
        return buffer;
    };
    /**
     * Converts the id into a 24 character hex string for printing
     *
     * @param format - The Buffer toString format parameter.
     */
    ObjectId.prototype.toString = function (format) {
        // Is the id a buffer then use the buffer toString method to return the format
        if (format)
            return this.id.toString(format);
        return this.toHexString();
    };
    /** Converts to its JSON the 24 character hex string representation. */
    ObjectId.prototype.toJSON = function () {
        return this.toHexString();
    };
    /**
     * Compares the equality of this ObjectId with `otherID`.
     *
     * @param otherId - ObjectId instance to compare against.
     */
    ObjectId.prototype.equals = function (otherId) {
        if (otherId === undefined || otherId === null) {
            return false;
        }
        if (otherId instanceof ObjectId) {
            return this.toString() === otherId.toString();
        }
        if (typeof otherId === 'string' &&
            ObjectId.isValid(otherId) &&
            otherId.length === 12 &&
            utils_1.isUint8Array(this.id)) {
            return otherId === buffer_1.Buffer.prototype.toString.call(this.id, 'latin1');
        }
        if (typeof otherId === 'string' && ObjectId.isValid(otherId) && otherId.length === 24) {
            return otherId.toLowerCase() === this.toHexString();
        }
        if (typeof otherId === 'string' && ObjectId.isValid(otherId) && otherId.length === 12) {
            return buffer_1.Buffer.from(otherId).equals(this.id);
        }
        if (typeof otherId === 'object' &&
            'toHexString' in otherId &&
            typeof otherId.toHexString === 'function') {
            return otherId.toHexString() === this.toHexString();
        }
        return false;
    };
    /** Returns the generation date (accurate up to the second) that this ID was generated. */
    ObjectId.prototype.getTimestamp = function () {
        var timestamp = new Date();
        var time = this.id.readUInt32BE(0);
        timestamp.setTime(Math.floor(time) * 1000);
        return timestamp;
    };
    /** @internal */
    ObjectId.createPk = function () {
        return new ObjectId();
    };
    /**
     * Creates an ObjectId from a second based number, with the rest of the ObjectId zeroed out. Used for comparisons or sorting the ObjectId.
     *
     * @param time - an integer number representing a number of seconds.
     */
    ObjectId.createFromTime = function (time) {
        var buffer = buffer_1.Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        // Encode time into first 4 bytes
        buffer.writeUInt32BE(time, 0);
        // Return the new objectId
        return new ObjectId(buffer);
    };
    /**
     * Creates an ObjectId from a hex string representation of an ObjectId.
     *
     * @param hexString - create a ObjectId from a passed in 24 character hexstring.
     */
    ObjectId.createFromHexString = function (hexString) {
        // Throw an error if it's not a valid setup
        if (typeof hexString === 'undefined' || (hexString != null && hexString.length !== 24)) {
            throw new error_1.BSONTypeError('Argument passed in must be a single String of 12 bytes or a string of 24 hex characters');
        }
        return new ObjectId(buffer_1.Buffer.from(hexString, 'hex'));
    };
    /**
     * Checks if a value is a valid bson ObjectId
     *
     * @param id - ObjectId instance to validate.
     */
    ObjectId.isValid = function (id) {
        if (id == null)
            return false;
        try {
            new ObjectId(id);
            return true;
        }
        catch (_a) {
            return false;
        }
    };
    /** @internal */
    ObjectId.prototype.toExtendedJSON = function () {
        if (this.toHexString)
            return { $oid: this.toHexString() };
        return { $oid: this.toString('hex') };
    };
    /** @internal */
    ObjectId.fromExtendedJSON = function (doc) {
        return new ObjectId(doc.$oid);
    };
    /**
     * Converts to a string representation of this Id.
     *
     * @returns return the 24 character hex string representation.
     * @internal
     */
    ObjectId.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    ObjectId.prototype.inspect = function () {
        return "new ObjectId(\"" + this.toHexString() + "\")";
    };
    /** @internal */
    ObjectId.index = Math.floor(Math.random() * 0xffffff);
    return ObjectId;
}());
exports.ObjectId = ObjectId;
// Deprecated methods
Object.defineProperty(ObjectId.prototype, 'generate', {
    value: utils_1.deprecate(function (time) { return ObjectId.generate(time); }, 'Please use the static `ObjectId.generate(time)` instead')
});
Object.defineProperty(ObjectId.prototype, 'getInc', {
    value: utils_1.deprecate(function () { return ObjectId.getInc(); }, 'Please use the static `ObjectId.getInc()` instead')
});
Object.defineProperty(ObjectId.prototype, 'get_inc', {
    value: utils_1.deprecate(function () { return ObjectId.getInc(); }, 'Please use the static `ObjectId.getInc()` instead')
});
Object.defineProperty(ObjectId, 'get_inc', {
    value: utils_1.deprecate(function () { return ObjectId.getInc(); }, 'Please use the static `ObjectId.getInc()` instead')
});
Object.defineProperty(ObjectId.prototype, '_bsontype', { value: 'ObjectID' });
//# sourceMappingURL=objectid.js.map