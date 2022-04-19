import { Buffer } from 'buffer';

/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

/* global Reflect, Promise */
var _extendStatics = function extendStatics(d, b) {
  _extendStatics = Object.setPrototypeOf || {
    __proto__: []
  } instanceof Array && function (d, b) {
    d.__proto__ = b;
  } || function (d, b) {
    for (var p in b) {
      if (b.hasOwnProperty(p)) d[p] = b[p];
    }
  };

  return _extendStatics(d, b);
};

function __extends(d, b) {
  _extendStatics(d, b);

  function __() {
    this.constructor = d;
  }

  d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}

var _assign = function __assign() {
  _assign = Object.assign || function __assign(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];

      for (var p in s) {
        if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
      }
    }

    return t;
  };

  return _assign.apply(this, arguments);
};

/** @public */
var BSONError = /** @class */ (function (_super) {
    __extends(BSONError, _super);
    function BSONError(message) {
        var _this = _super.call(this, message) || this;
        Object.setPrototypeOf(_this, BSONError.prototype);
        return _this;
    }
    Object.defineProperty(BSONError.prototype, "name", {
        get: function () {
            return 'BSONError';
        },
        enumerable: false,
        configurable: true
    });
    return BSONError;
}(Error));
/** @public */
var BSONTypeError = /** @class */ (function (_super) {
    __extends(BSONTypeError, _super);
    function BSONTypeError(message) {
        var _this = _super.call(this, message) || this;
        Object.setPrototypeOf(_this, BSONTypeError.prototype);
        return _this;
    }
    Object.defineProperty(BSONTypeError.prototype, "name", {
        get: function () {
            return 'BSONTypeError';
        },
        enumerable: false,
        configurable: true
    });
    return BSONTypeError;
}(TypeError));

function checkForMath(potentialGlobal) {
    // eslint-disable-next-line eqeqeq
    return potentialGlobal && potentialGlobal.Math == Math && potentialGlobal;
}
// https://github.com/zloirock/core-js/issues/86#issuecomment-115759028
function getGlobal() {
    // eslint-disable-next-line no-undef
    return (checkForMath(typeof globalThis === 'object' && globalThis) ||
        checkForMath(typeof window === 'object' && window) ||
        checkForMath(typeof self === 'object' && self) ||
        checkForMath(typeof global === 'object' && global) ||
        Function('return this')());
}

/**
 * Normalizes our expected stringified form of a function across versions of node
 * @param fn - The function to stringify
 */
function normalizedFunctionString(fn) {
    return fn.toString().replace('function(', 'function (');
}
function isReactNative() {
    var g = getGlobal();
    return typeof g.navigator === 'object' && g.navigator.product === 'ReactNative';
}
var insecureRandomBytes = function insecureRandomBytes(size) {
    var insecureWarning = isReactNative()
        ? 'BSON: For React Native please polyfill crypto.getRandomValues, e.g. using: https://www.npmjs.com/package/react-native-get-random-values.'
        : 'BSON: No cryptographic implementation for random bytes present, falling back to a less secure implementation.';
    console.warn(insecureWarning);
    var result = Buffer.alloc(size);
    for (var i = 0; i < size; ++i)
        result[i] = Math.floor(Math.random() * 256);
    return result;
};
var detectRandomBytes = function () {
    if (typeof window !== 'undefined') {
        // browser crypto implementation(s)
        var target_1 = window.crypto || window.msCrypto; // allow for IE11
        if (target_1 && target_1.getRandomValues) {
            return function (size) { return target_1.getRandomValues(Buffer.alloc(size)); };
        }
    }
    if (typeof global !== 'undefined' && global.crypto && global.crypto.getRandomValues) {
        // allow for RN packages such as https://www.npmjs.com/package/react-native-get-random-values to populate global
        return function (size) { return global.crypto.getRandomValues(Buffer.alloc(size)); };
    }
    var requiredRandomBytes;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        requiredRandomBytes = require('crypto').randomBytes;
    }
    catch (e) {
        // keep the fallback
    }
    // NOTE: in transpiled cases the above require might return null/undefined
    return requiredRandomBytes || insecureRandomBytes;
};
var randomBytes = detectRandomBytes();
function isAnyArrayBuffer(value) {
    return ['[object ArrayBuffer]', '[object SharedArrayBuffer]'].includes(Object.prototype.toString.call(value));
}
function isUint8Array(value) {
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}
function isBigInt64Array(value) {
    return Object.prototype.toString.call(value) === '[object BigInt64Array]';
}
function isBigUInt64Array(value) {
    return Object.prototype.toString.call(value) === '[object BigUint64Array]';
}
function isRegExp(d) {
    return Object.prototype.toString.call(d) === '[object RegExp]';
}
function isMap(d) {
    return Object.prototype.toString.call(d) === '[object Map]';
}
// To ensure that 0.4 of node works correctly
function isDate(d) {
    return isObjectLike(d) && Object.prototype.toString.call(d) === '[object Date]';
}
/**
 * @internal
 * this is to solve the `'someKey' in x` problem where x is unknown.
 * https://github.com/typescript-eslint/typescript-eslint/issues/1071#issuecomment-541955753
 */
function isObjectLike(candidate) {
    return typeof candidate === 'object' && candidate !== null;
}
function deprecate(fn, message) {
    var warned = false;
    function deprecated() {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (!warned) {
            console.warn(message);
            warned = true;
        }
        return fn.apply(this, args);
    }
    return deprecated;
}

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
        return Buffer.from(potentialBuffer.buffer, potentialBuffer.byteOffset, potentialBuffer.byteLength);
    }
    if (isAnyArrayBuffer(potentialBuffer)) {
        return Buffer.from(potentialBuffer);
    }
    throw new BSONTypeError('Must use either Buffer or TypedArray');
}

// Validation regex for v4 uuid (validates with or without dashes)
var VALIDATION_REGEX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15})$/i;
var uuidValidateString = function (str) {
    return typeof str === 'string' && VALIDATION_REGEX.test(str);
};
var uuidHexStringToBuffer = function (hexString) {
    if (!uuidValidateString(hexString)) {
        throw new BSONTypeError('UUID string representations must be a 32 or 36 character hex string (dashes excluded/included). Format: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" or "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".');
    }
    var sanitizedHexString = hexString.replace(/-/g, '');
    return Buffer.from(sanitizedHexString, 'hex');
};
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

var BYTE_LENGTH = 16;
var kId$1 = Symbol('id');
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
            this[kId$1] = Buffer.from(input.id);
            this.__id = input.__id;
        }
        else if (ArrayBuffer.isView(input) && input.byteLength === BYTE_LENGTH) {
            this.id = ensureBuffer(input);
        }
        else if (typeof input === 'string') {
            this.id = uuidHexStringToBuffer(input);
        }
        else {
            throw new BSONTypeError('Argument passed in UUID constructor must be a UUID, a 16 byte Buffer or a 32/36 character hex string (dashes excluded/included, format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).');
        }
    }
    Object.defineProperty(UUID.prototype, "id", {
        /**
         * The UUID bytes
         * @readonly
         */
        get: function () {
            return this[kId$1];
        },
        set: function (value) {
            this[kId$1] = value;
            if (UUID.cacheHexString) {
                this.__id = bufferToUuidHexString(value);
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
        var uuidHexString = bufferToUuidHexString(this.id, includeDashes);
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
        return new Binary(this.id, Binary.SUBTYPE_UUID);
    };
    /**
     * Generates a populated buffer containing a v4 uuid
     */
    UUID.generate = function () {
        var bytes = randomBytes(BYTE_LENGTH);
        // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
        // Kindly borrowed from https://github.com/uuidjs/uuid/blob/master/src/v4.js
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        return Buffer.from(bytes);
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
            return uuidValidateString(input);
        }
        if (isUint8Array(input)) {
            // check for length & uuid version (https://tools.ietf.org/html/rfc4122#section-4.1.3)
            if (input.length !== BYTE_LENGTH) {
                return false;
            }
            try {
                // get this byte as hex:             xxxxxxxx-xxxx-XXxx-xxxx-xxxxxxxxxxxx
                // check first part as uuid version: xxxxxxxx-xxxx-Xxxx-xxxx-xxxxxxxxxxxx
                return parseInt(input[6].toString(16)[0], 10) === Binary.SUBTYPE_UUID;
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
        var buffer = uuidHexStringToBuffer(hexString);
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
Object.defineProperty(UUID.prototype, '_bsontype', { value: 'UUID' });

/**
 * A class representation of the BSON Binary type.
 * @public
 */
var Binary = /** @class */ (function () {
    /**
     * @param buffer - a buffer object containing the binary data.
     * @param subType - the option binary type.
     */
    function Binary(buffer, subType) {
        if (!(this instanceof Binary))
            return new Binary(buffer, subType);
        if (!(buffer == null) &&
            !(typeof buffer === 'string') &&
            !ArrayBuffer.isView(buffer) &&
            !(buffer instanceof ArrayBuffer) &&
            !Array.isArray(buffer)) {
            throw new BSONTypeError('Binary can only be constructed from string, Buffer, TypedArray, or Array<number>');
        }
        this.sub_type = subType !== null && subType !== void 0 ? subType : Binary.BSON_BINARY_SUBTYPE_DEFAULT;
        if (buffer == null) {
            // create an empty binary buffer
            this.buffer = Buffer.alloc(Binary.BUFFER_SIZE);
            this.position = 0;
        }
        else {
            if (typeof buffer === 'string') {
                // string
                this.buffer = Buffer.from(buffer, 'binary');
            }
            else if (Array.isArray(buffer)) {
                // number[]
                this.buffer = Buffer.from(buffer);
            }
            else {
                // Buffer | TypedArray | ArrayBuffer
                this.buffer = ensureBuffer(buffer);
            }
            this.position = this.buffer.byteLength;
        }
    }
    /**
     * Updates this binary with byte_value.
     *
     * @param byteValue - a single byte we wish to write.
     */
    Binary.prototype.put = function (byteValue) {
        // If it's a string and a has more than one character throw an error
        if (typeof byteValue === 'string' && byteValue.length !== 1) {
            throw new BSONTypeError('only accepts single character String');
        }
        else if (typeof byteValue !== 'number' && byteValue.length !== 1)
            throw new BSONTypeError('only accepts single character Uint8Array or Array');
        // Decode the byte value once
        var decodedByte;
        if (typeof byteValue === 'string') {
            decodedByte = byteValue.charCodeAt(0);
        }
        else if (typeof byteValue === 'number') {
            decodedByte = byteValue;
        }
        else {
            decodedByte = byteValue[0];
        }
        if (decodedByte < 0 || decodedByte > 255) {
            throw new BSONTypeError('only accepts number in a valid unsigned byte range 0-255');
        }
        if (this.buffer.length > this.position) {
            this.buffer[this.position++] = decodedByte;
        }
        else {
            var buffer = Buffer.alloc(Binary.BUFFER_SIZE + this.buffer.length);
            // Combine the two buffers together
            this.buffer.copy(buffer, 0, 0, this.buffer.length);
            this.buffer = buffer;
            this.buffer[this.position++] = decodedByte;
        }
    };
    /**
     * Writes a buffer or string to the binary.
     *
     * @param sequence - a string or buffer to be written to the Binary BSON object.
     * @param offset - specify the binary of where to write the content.
     */
    Binary.prototype.write = function (sequence, offset) {
        offset = typeof offset === 'number' ? offset : this.position;
        // If the buffer is to small let's extend the buffer
        if (this.buffer.length < offset + sequence.length) {
            var buffer = Buffer.alloc(this.buffer.length + sequence.length);
            this.buffer.copy(buffer, 0, 0, this.buffer.length);
            // Assign the new buffer
            this.buffer = buffer;
        }
        if (ArrayBuffer.isView(sequence)) {
            this.buffer.set(ensureBuffer(sequence), offset);
            this.position =
                offset + sequence.byteLength > this.position ? offset + sequence.length : this.position;
        }
        else if (typeof sequence === 'string') {
            this.buffer.write(sequence, offset, sequence.length, 'binary');
            this.position =
                offset + sequence.length > this.position ? offset + sequence.length : this.position;
        }
    };
    /**
     * Reads **length** bytes starting at **position**.
     *
     * @param position - read from the given position in the Binary.
     * @param length - the number of bytes to read.
     */
    Binary.prototype.read = function (position, length) {
        length = length && length > 0 ? length : this.position;
        // Let's return the data based on the type we have
        return this.buffer.slice(position, position + length);
    };
    /**
     * Returns the value of this binary as a string.
     * @param asRaw - Will skip converting to a string
     * @remarks
     * This is handy when calling this function conditionally for some key value pairs and not others
     */
    Binary.prototype.value = function (asRaw) {
        asRaw = !!asRaw;
        // Optimize to serialize for the situation where the data == size of buffer
        if (asRaw && this.buffer.length === this.position) {
            return this.buffer;
        }
        // If it's a node.js buffer object
        if (asRaw) {
            return this.buffer.slice(0, this.position);
        }
        return this.buffer.toString('binary', 0, this.position);
    };
    /** the length of the binary sequence */
    Binary.prototype.length = function () {
        return this.position;
    };
    Binary.prototype.toJSON = function () {
        return this.buffer.toString('base64');
    };
    Binary.prototype.toString = function (format) {
        return this.buffer.toString(format);
    };
    /** @internal */
    Binary.prototype.toExtendedJSON = function (options) {
        options = options || {};
        var base64String = this.buffer.toString('base64');
        var subType = Number(this.sub_type).toString(16);
        if (options.legacy) {
            return {
                $binary: base64String,
                $type: subType.length === 1 ? '0' + subType : subType
            };
        }
        return {
            $binary: {
                base64: base64String,
                subType: subType.length === 1 ? '0' + subType : subType
            }
        };
    };
    Binary.prototype.toUUID = function () {
        if (this.sub_type === Binary.SUBTYPE_UUID) {
            return new UUID(this.buffer.slice(0, this.position));
        }
        throw new BSONError("Binary sub_type \"" + this.sub_type + "\" is not supported for converting to UUID. Only \"" + Binary.SUBTYPE_UUID + "\" is currently supported.");
    };
    /** @internal */
    Binary.fromExtendedJSON = function (doc, options) {
        options = options || {};
        var data;
        var type;
        if ('$binary' in doc) {
            if (options.legacy && typeof doc.$binary === 'string' && '$type' in doc) {
                type = doc.$type ? parseInt(doc.$type, 16) : 0;
                data = Buffer.from(doc.$binary, 'base64');
            }
            else {
                if (typeof doc.$binary !== 'string') {
                    type = doc.$binary.subType ? parseInt(doc.$binary.subType, 16) : 0;
                    data = Buffer.from(doc.$binary.base64, 'base64');
                }
            }
        }
        else if ('$uuid' in doc) {
            type = 4;
            data = uuidHexStringToBuffer(doc.$uuid);
        }
        if (!data) {
            throw new BSONTypeError("Unexpected Binary Extended JSON format " + JSON.stringify(doc));
        }
        return new Binary(data, type);
    };
    /** @internal */
    Binary.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Binary.prototype.inspect = function () {
        var asBuffer = this.value(true);
        return "new Binary(Buffer.from(\"" + asBuffer.toString('hex') + "\", \"hex\"), " + this.sub_type + ")";
    };
    /**
     * Binary default subtype
     * @internal
     */
    Binary.BSON_BINARY_SUBTYPE_DEFAULT = 0;
    /** Initial buffer default size */
    Binary.BUFFER_SIZE = 256;
    /** Default BSON type */
    Binary.SUBTYPE_DEFAULT = 0;
    /** Function BSON type */
    Binary.SUBTYPE_FUNCTION = 1;
    /** Byte Array BSON type */
    Binary.SUBTYPE_BYTE_ARRAY = 2;
    /** Deprecated UUID BSON type @deprecated Please use SUBTYPE_UUID */
    Binary.SUBTYPE_UUID_OLD = 3;
    /** UUID BSON type */
    Binary.SUBTYPE_UUID = 4;
    /** MD5 BSON type */
    Binary.SUBTYPE_MD5 = 5;
    /** Encrypted BSON type */
    Binary.SUBTYPE_ENCRYPTED = 6;
    /** Column BSON type */
    Binary.SUBTYPE_COLUMN = 7;
    /** User BSON type */
    Binary.SUBTYPE_USER_DEFINED = 128;
    return Binary;
}());
Object.defineProperty(Binary.prototype, '_bsontype', { value: 'Binary' });

/**
 * A class representation of the BSON Code type.
 * @public
 */
var Code = /** @class */ (function () {
    /**
     * @param code - a string or function.
     * @param scope - an optional scope for the function.
     */
    function Code(code, scope) {
        if (!(this instanceof Code))
            return new Code(code, scope);
        this.code = code;
        this.scope = scope;
    }
    Code.prototype.toJSON = function () {
        return { code: this.code, scope: this.scope };
    };
    /** @internal */
    Code.prototype.toExtendedJSON = function () {
        if (this.scope) {
            return { $code: this.code, $scope: this.scope };
        }
        return { $code: this.code };
    };
    /** @internal */
    Code.fromExtendedJSON = function (doc) {
        return new Code(doc.$code, doc.$scope);
    };
    /** @internal */
    Code.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Code.prototype.inspect = function () {
        var codeJson = this.toJSON();
        return "new Code(\"" + codeJson.code + "\"" + (codeJson.scope ? ", " + JSON.stringify(codeJson.scope) : '') + ")";
    };
    return Code;
}());
Object.defineProperty(Code.prototype, '_bsontype', { value: 'Code' });

/** @internal */
function isDBRefLike(value) {
    return (isObjectLike(value) &&
        value.$id != null &&
        typeof value.$ref === 'string' &&
        (value.$db == null || typeof value.$db === 'string'));
}
/**
 * A class representation of the BSON DBRef type.
 * @public
 */
var DBRef = /** @class */ (function () {
    /**
     * @param collection - the collection name.
     * @param oid - the reference ObjectId.
     * @param db - optional db name, if omitted the reference is local to the current db.
     */
    function DBRef(collection, oid, db, fields) {
        if (!(this instanceof DBRef))
            return new DBRef(collection, oid, db, fields);
        // check if namespace has been provided
        var parts = collection.split('.');
        if (parts.length === 2) {
            db = parts.shift();
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            collection = parts.shift();
        }
        this.collection = collection;
        this.oid = oid;
        this.db = db;
        this.fields = fields || {};
    }
    Object.defineProperty(DBRef.prototype, "namespace", {
        // Property provided for compatibility with the 1.x parser
        // the 1.x parser used a "namespace" property, while 4.x uses "collection"
        /** @internal */
        get: function () {
            return this.collection;
        },
        set: function (value) {
            this.collection = value;
        },
        enumerable: false,
        configurable: true
    });
    DBRef.prototype.toJSON = function () {
        var o = Object.assign({
            $ref: this.collection,
            $id: this.oid
        }, this.fields);
        if (this.db != null)
            o.$db = this.db;
        return o;
    };
    /** @internal */
    DBRef.prototype.toExtendedJSON = function (options) {
        options = options || {};
        var o = {
            $ref: this.collection,
            $id: this.oid
        };
        if (options.legacy) {
            return o;
        }
        if (this.db)
            o.$db = this.db;
        o = Object.assign(o, this.fields);
        return o;
    };
    /** @internal */
    DBRef.fromExtendedJSON = function (doc) {
        var copy = Object.assign({}, doc);
        delete copy.$ref;
        delete copy.$id;
        delete copy.$db;
        return new DBRef(doc.$ref, doc.$id, doc.$db, copy);
    };
    /** @internal */
    DBRef.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    DBRef.prototype.inspect = function () {
        // NOTE: if OID is an ObjectId class it will just print the oid string.
        var oid = this.oid === undefined || this.oid.toString === undefined ? this.oid : this.oid.toString();
        return "new DBRef(\"" + this.namespace + "\", new ObjectId(\"" + oid + "\")" + (this.db ? ", \"" + this.db + "\"" : '') + ")";
    };
    return DBRef;
}());
Object.defineProperty(DBRef.prototype, '_bsontype', { value: 'DBRef' });

/**
 * wasm optimizations, to do native i64 multiplication and divide
 */
var wasm = undefined;
try {
    wasm = new WebAssembly.Instance(new WebAssembly.Module(
    // prettier-ignore
    new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 13, 2, 96, 0, 1, 127, 96, 4, 127, 127, 127, 127, 1, 127, 3, 7, 6, 0, 1, 1, 1, 1, 1, 6, 6, 1, 127, 1, 65, 0, 11, 7, 50, 6, 3, 109, 117, 108, 0, 1, 5, 100, 105, 118, 95, 115, 0, 2, 5, 100, 105, 118, 95, 117, 0, 3, 5, 114, 101, 109, 95, 115, 0, 4, 5, 114, 101, 109, 95, 117, 0, 5, 8, 103, 101, 116, 95, 104, 105, 103, 104, 0, 0, 10, 191, 1, 6, 4, 0, 35, 0, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 126, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 127, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 128, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 129, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 130, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11])), {}).exports;
}
catch (_a) {
    // no wasm support
}
var TWO_PWR_16_DBL = 1 << 16;
var TWO_PWR_24_DBL = 1 << 24;
var TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL;
var TWO_PWR_64_DBL = TWO_PWR_32_DBL * TWO_PWR_32_DBL;
var TWO_PWR_63_DBL = TWO_PWR_64_DBL / 2;
/** A cache of the Long representations of small integer values. */
var INT_CACHE = {};
/** A cache of the Long representations of small unsigned integer values. */
var UINT_CACHE = {};
/**
 * A class representing a 64-bit integer
 * @public
 * @remarks
 * The internal representation of a long is the two given signed, 32-bit values.
 * We use 32-bit pieces because these are the size of integers on which
 * Javascript performs bit-operations.  For operations like addition and
 * multiplication, we split each number into 16 bit pieces, which can easily be
 * multiplied within Javascript's floating-point representation without overflow
 * or change in sign.
 * In the algorithms below, we frequently reduce the negative case to the
 * positive case by negating the input(s) and then post-processing the result.
 * Note that we must ALWAYS check specially whether those values are MIN_VALUE
 * (-2^63) because -MIN_VALUE == MIN_VALUE (since 2^63 cannot be represented as
 * a positive number, it overflows back into a negative).  Not handling this
 * case would often result in infinite recursion.
 * Common constant values ZERO, ONE, NEG_ONE, etc. are found as static properties on this class.
 */
var Long = /** @class */ (function () {
    /**
     * Constructs a 64 bit two's-complement integer, given its low and high 32 bit values as *signed* integers.
     *  See the from* functions below for more convenient ways of constructing Longs.
     *
     * Acceptable signatures are:
     * - Long(low, high, unsigned?)
     * - Long(bigint, unsigned?)
     * - Long(string, unsigned?)
     *
     * @param low - The low (signed) 32 bits of the long
     * @param high - The high (signed) 32 bits of the long
     * @param unsigned - Whether unsigned or not, defaults to signed
     */
    function Long(low, high, unsigned) {
        if (low === void 0) { low = 0; }
        if (!(this instanceof Long))
            return new Long(low, high, unsigned);
        if (typeof low === 'bigint') {
            Object.assign(this, Long.fromBigInt(low, !!high));
        }
        else if (typeof low === 'string') {
            Object.assign(this, Long.fromString(low, !!high));
        }
        else {
            this.low = low | 0;
            this.high = high | 0;
            this.unsigned = !!unsigned;
        }
        Object.defineProperty(this, '__isLong__', {
            value: true,
            configurable: false,
            writable: false,
            enumerable: false
        });
    }
    /**
     * Returns a Long representing the 64 bit integer that comes by concatenating the given low and high bits.
     * Each is assumed to use 32 bits.
     * @param lowBits - The low 32 bits
     * @param highBits - The high 32 bits
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    Long.fromBits = function (lowBits, highBits, unsigned) {
        return new Long(lowBits, highBits, unsigned);
    };
    /**
     * Returns a Long representing the given 32 bit integer value.
     * @param value - The 32 bit integer in question
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    Long.fromInt = function (value, unsigned) {
        var obj, cachedObj, cache;
        if (unsigned) {
            value >>>= 0;
            if ((cache = 0 <= value && value < 256)) {
                cachedObj = UINT_CACHE[value];
                if (cachedObj)
                    return cachedObj;
            }
            obj = Long.fromBits(value, (value | 0) < 0 ? -1 : 0, true);
            if (cache)
                UINT_CACHE[value] = obj;
            return obj;
        }
        else {
            value |= 0;
            if ((cache = -128 <= value && value < 128)) {
                cachedObj = INT_CACHE[value];
                if (cachedObj)
                    return cachedObj;
            }
            obj = Long.fromBits(value, value < 0 ? -1 : 0, false);
            if (cache)
                INT_CACHE[value] = obj;
            return obj;
        }
    };
    /**
     * Returns a Long representing the given value, provided that it is a finite number. Otherwise, zero is returned.
     * @param value - The number in question
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    Long.fromNumber = function (value, unsigned) {
        if (isNaN(value))
            return unsigned ? Long.UZERO : Long.ZERO;
        if (unsigned) {
            if (value < 0)
                return Long.UZERO;
            if (value >= TWO_PWR_64_DBL)
                return Long.MAX_UNSIGNED_VALUE;
        }
        else {
            if (value <= -TWO_PWR_63_DBL)
                return Long.MIN_VALUE;
            if (value + 1 >= TWO_PWR_63_DBL)
                return Long.MAX_VALUE;
        }
        if (value < 0)
            return Long.fromNumber(-value, unsigned).neg();
        return Long.fromBits(value % TWO_PWR_32_DBL | 0, (value / TWO_PWR_32_DBL) | 0, unsigned);
    };
    /**
     * Returns a Long representing the given value, provided that it is a finite number. Otherwise, zero is returned.
     * @param value - The number in question
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    Long.fromBigInt = function (value, unsigned) {
        return Long.fromString(value.toString(), unsigned);
    };
    /**
     * Returns a Long representation of the given string, written using the specified radix.
     * @param str - The textual representation of the Long
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @param radix - The radix in which the text is written (2-36), defaults to 10
     * @returns The corresponding Long value
     */
    Long.fromString = function (str, unsigned, radix) {
        if (str.length === 0)
            throw Error('empty string');
        if (str === 'NaN' || str === 'Infinity' || str === '+Infinity' || str === '-Infinity')
            return Long.ZERO;
        if (typeof unsigned === 'number') {
            // For goog.math.long compatibility
            (radix = unsigned), (unsigned = false);
        }
        else {
            unsigned = !!unsigned;
        }
        radix = radix || 10;
        if (radix < 2 || 36 < radix)
            throw RangeError('radix');
        var p;
        if ((p = str.indexOf('-')) > 0)
            throw Error('interior hyphen');
        else if (p === 0) {
            return Long.fromString(str.substring(1), unsigned, radix).neg();
        }
        // Do several (8) digits each time through the loop, so as to
        // minimize the calls to the very expensive emulated div.
        var radixToPower = Long.fromNumber(Math.pow(radix, 8));
        var result = Long.ZERO;
        for (var i = 0; i < str.length; i += 8) {
            var size = Math.min(8, str.length - i), value = parseInt(str.substring(i, i + size), radix);
            if (size < 8) {
                var power = Long.fromNumber(Math.pow(radix, size));
                result = result.mul(power).add(Long.fromNumber(value));
            }
            else {
                result = result.mul(radixToPower);
                result = result.add(Long.fromNumber(value));
            }
        }
        result.unsigned = unsigned;
        return result;
    };
    /**
     * Creates a Long from its byte representation.
     * @param bytes - Byte representation
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @param le - Whether little or big endian, defaults to big endian
     * @returns The corresponding Long value
     */
    Long.fromBytes = function (bytes, unsigned, le) {
        return le ? Long.fromBytesLE(bytes, unsigned) : Long.fromBytesBE(bytes, unsigned);
    };
    /**
     * Creates a Long from its little endian byte representation.
     * @param bytes - Little endian byte representation
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    Long.fromBytesLE = function (bytes, unsigned) {
        return new Long(bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24), bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24), unsigned);
    };
    /**
     * Creates a Long from its big endian byte representation.
     * @param bytes - Big endian byte representation
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    Long.fromBytesBE = function (bytes, unsigned) {
        return new Long((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7], (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3], unsigned);
    };
    /**
     * Tests if the specified object is a Long.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
    Long.isLong = function (value) {
        return isObjectLike(value) && value['__isLong__'] === true;
    };
    /**
     * Converts the specified value to a Long.
     * @param unsigned - Whether unsigned or not, defaults to signed
     */
    Long.fromValue = function (val, unsigned) {
        if (typeof val === 'number')
            return Long.fromNumber(val, unsigned);
        if (typeof val === 'string')
            return Long.fromString(val, unsigned);
        // Throws for non-objects, converts non-instanceof Long:
        return Long.fromBits(val.low, val.high, typeof unsigned === 'boolean' ? unsigned : val.unsigned);
    };
    /** Returns the sum of this and the specified Long. */
    Long.prototype.add = function (addend) {
        if (!Long.isLong(addend))
            addend = Long.fromValue(addend);
        // Divide each number into 4 chunks of 16 bits, and then sum the chunks.
        var a48 = this.high >>> 16;
        var a32 = this.high & 0xffff;
        var a16 = this.low >>> 16;
        var a00 = this.low & 0xffff;
        var b48 = addend.high >>> 16;
        var b32 = addend.high & 0xffff;
        var b16 = addend.low >>> 16;
        var b00 = addend.low & 0xffff;
        var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
        c00 += a00 + b00;
        c16 += c00 >>> 16;
        c00 &= 0xffff;
        c16 += a16 + b16;
        c32 += c16 >>> 16;
        c16 &= 0xffff;
        c32 += a32 + b32;
        c48 += c32 >>> 16;
        c32 &= 0xffff;
        c48 += a48 + b48;
        c48 &= 0xffff;
        return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned);
    };
    /**
     * Returns the sum of this and the specified Long.
     * @returns Sum
     */
    Long.prototype.and = function (other) {
        if (!Long.isLong(other))
            other = Long.fromValue(other);
        return Long.fromBits(this.low & other.low, this.high & other.high, this.unsigned);
    };
    /**
     * Compares this Long's value with the specified's.
     * @returns 0 if they are the same, 1 if the this is greater and -1 if the given one is greater
     */
    Long.prototype.compare = function (other) {
        if (!Long.isLong(other))
            other = Long.fromValue(other);
        if (this.eq(other))
            return 0;
        var thisNeg = this.isNegative(), otherNeg = other.isNegative();
        if (thisNeg && !otherNeg)
            return -1;
        if (!thisNeg && otherNeg)
            return 1;
        // At this point the sign bits are the same
        if (!this.unsigned)
            return this.sub(other).isNegative() ? -1 : 1;
        // Both are positive if at least one is unsigned
        return other.high >>> 0 > this.high >>> 0 ||
            (other.high === this.high && other.low >>> 0 > this.low >>> 0)
            ? -1
            : 1;
    };
    /** This is an alias of {@link Long.compare} */
    Long.prototype.comp = function (other) {
        return this.compare(other);
    };
    /**
     * Returns this Long divided by the specified. The result is signed if this Long is signed or unsigned if this Long is unsigned.
     * @returns Quotient
     */
    Long.prototype.divide = function (divisor) {
        if (!Long.isLong(divisor))
            divisor = Long.fromValue(divisor);
        if (divisor.isZero())
            throw Error('division by zero');
        // use wasm support if present
        if (wasm) {
            // guard against signed division overflow: the largest
            // negative number / -1 would be 1 larger than the largest
            // positive number, due to two's complement.
            if (!this.unsigned &&
                this.high === -0x80000000 &&
                divisor.low === -1 &&
                divisor.high === -1) {
                // be consistent with non-wasm code path
                return this;
            }
            var low = (this.unsigned ? wasm.div_u : wasm.div_s)(this.low, this.high, divisor.low, divisor.high);
            return Long.fromBits(low, wasm.get_high(), this.unsigned);
        }
        if (this.isZero())
            return this.unsigned ? Long.UZERO : Long.ZERO;
        var approx, rem, res;
        if (!this.unsigned) {
            // This section is only relevant for signed longs and is derived from the
            // closure library as a whole.
            if (this.eq(Long.MIN_VALUE)) {
                if (divisor.eq(Long.ONE) || divisor.eq(Long.NEG_ONE))
                    return Long.MIN_VALUE;
                // recall that -MIN_VALUE == MIN_VALUE
                else if (divisor.eq(Long.MIN_VALUE))
                    return Long.ONE;
                else {
                    // At this point, we have |other| >= 2, so |this/other| < |MIN_VALUE|.
                    var halfThis = this.shr(1);
                    approx = halfThis.div(divisor).shl(1);
                    if (approx.eq(Long.ZERO)) {
                        return divisor.isNegative() ? Long.ONE : Long.NEG_ONE;
                    }
                    else {
                        rem = this.sub(divisor.mul(approx));
                        res = approx.add(rem.div(divisor));
                        return res;
                    }
                }
            }
            else if (divisor.eq(Long.MIN_VALUE))
                return this.unsigned ? Long.UZERO : Long.ZERO;
            if (this.isNegative()) {
                if (divisor.isNegative())
                    return this.neg().div(divisor.neg());
                return this.neg().div(divisor).neg();
            }
            else if (divisor.isNegative())
                return this.div(divisor.neg()).neg();
            res = Long.ZERO;
        }
        else {
            // The algorithm below has not been made for unsigned longs. It's therefore
            // required to take special care of the MSB prior to running it.
            if (!divisor.unsigned)
                divisor = divisor.toUnsigned();
            if (divisor.gt(this))
                return Long.UZERO;
            if (divisor.gt(this.shru(1)))
                // 15 >>> 1 = 7 ; with divisor = 8 ; true
                return Long.UONE;
            res = Long.UZERO;
        }
        // Repeat the following until the remainder is less than other:  find a
        // floating-point that approximates remainder / other *from below*, add this
        // into the result, and subtract it from the remainder.  It is critical that
        // the approximate value is less than or equal to the real value so that the
        // remainder never becomes negative.
        rem = this;
        while (rem.gte(divisor)) {
            // Approximate the result of division. This may be a little greater or
            // smaller than the actual value.
            approx = Math.max(1, Math.floor(rem.toNumber() / divisor.toNumber()));
            // We will tweak the approximate result by changing it in the 48-th digit or
            // the smallest non-fractional digit, whichever is larger.
            var log2 = Math.ceil(Math.log(approx) / Math.LN2);
            var delta = log2 <= 48 ? 1 : Math.pow(2, log2 - 48);
            // Decrease the approximation until it is smaller than the remainder.  Note
            // that if it is too large, the product overflows and is negative.
            var approxRes = Long.fromNumber(approx);
            var approxRem = approxRes.mul(divisor);
            while (approxRem.isNegative() || approxRem.gt(rem)) {
                approx -= delta;
                approxRes = Long.fromNumber(approx, this.unsigned);
                approxRem = approxRes.mul(divisor);
            }
            // We know the answer can't be zero... and actually, zero would cause
            // infinite recursion since we would make no progress.
            if (approxRes.isZero())
                approxRes = Long.ONE;
            res = res.add(approxRes);
            rem = rem.sub(approxRem);
        }
        return res;
    };
    /**This is an alias of {@link Long.divide} */
    Long.prototype.div = function (divisor) {
        return this.divide(divisor);
    };
    /**
     * Tests if this Long's value equals the specified's.
     * @param other - Other value
     */
    Long.prototype.equals = function (other) {
        if (!Long.isLong(other))
            other = Long.fromValue(other);
        if (this.unsigned !== other.unsigned && this.high >>> 31 === 1 && other.high >>> 31 === 1)
            return false;
        return this.high === other.high && this.low === other.low;
    };
    /** This is an alias of {@link Long.equals} */
    Long.prototype.eq = function (other) {
        return this.equals(other);
    };
    /** Gets the high 32 bits as a signed integer. */
    Long.prototype.getHighBits = function () {
        return this.high;
    };
    /** Gets the high 32 bits as an unsigned integer. */
    Long.prototype.getHighBitsUnsigned = function () {
        return this.high >>> 0;
    };
    /** Gets the low 32 bits as a signed integer. */
    Long.prototype.getLowBits = function () {
        return this.low;
    };
    /** Gets the low 32 bits as an unsigned integer. */
    Long.prototype.getLowBitsUnsigned = function () {
        return this.low >>> 0;
    };
    /** Gets the number of bits needed to represent the absolute value of this Long. */
    Long.prototype.getNumBitsAbs = function () {
        if (this.isNegative()) {
            // Unsigned Longs are never negative
            return this.eq(Long.MIN_VALUE) ? 64 : this.neg().getNumBitsAbs();
        }
        var val = this.high !== 0 ? this.high : this.low;
        var bit;
        for (bit = 31; bit > 0; bit--)
            if ((val & (1 << bit)) !== 0)
                break;
        return this.high !== 0 ? bit + 33 : bit + 1;
    };
    /** Tests if this Long's value is greater than the specified's. */
    Long.prototype.greaterThan = function (other) {
        return this.comp(other) > 0;
    };
    /** This is an alias of {@link Long.greaterThan} */
    Long.prototype.gt = function (other) {
        return this.greaterThan(other);
    };
    /** Tests if this Long's value is greater than or equal the specified's. */
    Long.prototype.greaterThanOrEqual = function (other) {
        return this.comp(other) >= 0;
    };
    /** This is an alias of {@link Long.greaterThanOrEqual} */
    Long.prototype.gte = function (other) {
        return this.greaterThanOrEqual(other);
    };
    /** This is an alias of {@link Long.greaterThanOrEqual} */
    Long.prototype.ge = function (other) {
        return this.greaterThanOrEqual(other);
    };
    /** Tests if this Long's value is even. */
    Long.prototype.isEven = function () {
        return (this.low & 1) === 0;
    };
    /** Tests if this Long's value is negative. */
    Long.prototype.isNegative = function () {
        return !this.unsigned && this.high < 0;
    };
    /** Tests if this Long's value is odd. */
    Long.prototype.isOdd = function () {
        return (this.low & 1) === 1;
    };
    /** Tests if this Long's value is positive. */
    Long.prototype.isPositive = function () {
        return this.unsigned || this.high >= 0;
    };
    /** Tests if this Long's value equals zero. */
    Long.prototype.isZero = function () {
        return this.high === 0 && this.low === 0;
    };
    /** Tests if this Long's value is less than the specified's. */
    Long.prototype.lessThan = function (other) {
        return this.comp(other) < 0;
    };
    /** This is an alias of {@link Long#lessThan}. */
    Long.prototype.lt = function (other) {
        return this.lessThan(other);
    };
    /** Tests if this Long's value is less than or equal the specified's. */
    Long.prototype.lessThanOrEqual = function (other) {
        return this.comp(other) <= 0;
    };
    /** This is an alias of {@link Long.lessThanOrEqual} */
    Long.prototype.lte = function (other) {
        return this.lessThanOrEqual(other);
    };
    /** Returns this Long modulo the specified. */
    Long.prototype.modulo = function (divisor) {
        if (!Long.isLong(divisor))
            divisor = Long.fromValue(divisor);
        // use wasm support if present
        if (wasm) {
            var low = (this.unsigned ? wasm.rem_u : wasm.rem_s)(this.low, this.high, divisor.low, divisor.high);
            return Long.fromBits(low, wasm.get_high(), this.unsigned);
        }
        return this.sub(this.div(divisor).mul(divisor));
    };
    /** This is an alias of {@link Long.modulo} */
    Long.prototype.mod = function (divisor) {
        return this.modulo(divisor);
    };
    /** This is an alias of {@link Long.modulo} */
    Long.prototype.rem = function (divisor) {
        return this.modulo(divisor);
    };
    /**
     * Returns the product of this and the specified Long.
     * @param multiplier - Multiplier
     * @returns Product
     */
    Long.prototype.multiply = function (multiplier) {
        if (this.isZero())
            return Long.ZERO;
        if (!Long.isLong(multiplier))
            multiplier = Long.fromValue(multiplier);
        // use wasm support if present
        if (wasm) {
            var low = wasm.mul(this.low, this.high, multiplier.low, multiplier.high);
            return Long.fromBits(low, wasm.get_high(), this.unsigned);
        }
        if (multiplier.isZero())
            return Long.ZERO;
        if (this.eq(Long.MIN_VALUE))
            return multiplier.isOdd() ? Long.MIN_VALUE : Long.ZERO;
        if (multiplier.eq(Long.MIN_VALUE))
            return this.isOdd() ? Long.MIN_VALUE : Long.ZERO;
        if (this.isNegative()) {
            if (multiplier.isNegative())
                return this.neg().mul(multiplier.neg());
            else
                return this.neg().mul(multiplier).neg();
        }
        else if (multiplier.isNegative())
            return this.mul(multiplier.neg()).neg();
        // If both longs are small, use float multiplication
        if (this.lt(Long.TWO_PWR_24) && multiplier.lt(Long.TWO_PWR_24))
            return Long.fromNumber(this.toNumber() * multiplier.toNumber(), this.unsigned);
        // Divide each long into 4 chunks of 16 bits, and then add up 4x4 products.
        // We can skip products that would overflow.
        var a48 = this.high >>> 16;
        var a32 = this.high & 0xffff;
        var a16 = this.low >>> 16;
        var a00 = this.low & 0xffff;
        var b48 = multiplier.high >>> 16;
        var b32 = multiplier.high & 0xffff;
        var b16 = multiplier.low >>> 16;
        var b00 = multiplier.low & 0xffff;
        var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
        c00 += a00 * b00;
        c16 += c00 >>> 16;
        c00 &= 0xffff;
        c16 += a16 * b00;
        c32 += c16 >>> 16;
        c16 &= 0xffff;
        c16 += a00 * b16;
        c32 += c16 >>> 16;
        c16 &= 0xffff;
        c32 += a32 * b00;
        c48 += c32 >>> 16;
        c32 &= 0xffff;
        c32 += a16 * b16;
        c48 += c32 >>> 16;
        c32 &= 0xffff;
        c32 += a00 * b32;
        c48 += c32 >>> 16;
        c32 &= 0xffff;
        c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
        c48 &= 0xffff;
        return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned);
    };
    /** This is an alias of {@link Long.multiply} */
    Long.prototype.mul = function (multiplier) {
        return this.multiply(multiplier);
    };
    /** Returns the Negation of this Long's value. */
    Long.prototype.negate = function () {
        if (!this.unsigned && this.eq(Long.MIN_VALUE))
            return Long.MIN_VALUE;
        return this.not().add(Long.ONE);
    };
    /** This is an alias of {@link Long.negate} */
    Long.prototype.neg = function () {
        return this.negate();
    };
    /** Returns the bitwise NOT of this Long. */
    Long.prototype.not = function () {
        return Long.fromBits(~this.low, ~this.high, this.unsigned);
    };
    /** Tests if this Long's value differs from the specified's. */
    Long.prototype.notEquals = function (other) {
        return !this.equals(other);
    };
    /** This is an alias of {@link Long.notEquals} */
    Long.prototype.neq = function (other) {
        return this.notEquals(other);
    };
    /** This is an alias of {@link Long.notEquals} */
    Long.prototype.ne = function (other) {
        return this.notEquals(other);
    };
    /**
     * Returns the bitwise OR of this Long and the specified.
     */
    Long.prototype.or = function (other) {
        if (!Long.isLong(other))
            other = Long.fromValue(other);
        return Long.fromBits(this.low | other.low, this.high | other.high, this.unsigned);
    };
    /**
     * Returns this Long with bits shifted to the left by the given amount.
     * @param numBits - Number of bits
     * @returns Shifted Long
     */
    Long.prototype.shiftLeft = function (numBits) {
        if (Long.isLong(numBits))
            numBits = numBits.toInt();
        if ((numBits &= 63) === 0)
            return this;
        else if (numBits < 32)
            return Long.fromBits(this.low << numBits, (this.high << numBits) | (this.low >>> (32 - numBits)), this.unsigned);
        else
            return Long.fromBits(0, this.low << (numBits - 32), this.unsigned);
    };
    /** This is an alias of {@link Long.shiftLeft} */
    Long.prototype.shl = function (numBits) {
        return this.shiftLeft(numBits);
    };
    /**
     * Returns this Long with bits arithmetically shifted to the right by the given amount.
     * @param numBits - Number of bits
     * @returns Shifted Long
     */
    Long.prototype.shiftRight = function (numBits) {
        if (Long.isLong(numBits))
            numBits = numBits.toInt();
        if ((numBits &= 63) === 0)
            return this;
        else if (numBits < 32)
            return Long.fromBits((this.low >>> numBits) | (this.high << (32 - numBits)), this.high >> numBits, this.unsigned);
        else
            return Long.fromBits(this.high >> (numBits - 32), this.high >= 0 ? 0 : -1, this.unsigned);
    };
    /** This is an alias of {@link Long.shiftRight} */
    Long.prototype.shr = function (numBits) {
        return this.shiftRight(numBits);
    };
    /**
     * Returns this Long with bits logically shifted to the right by the given amount.
     * @param numBits - Number of bits
     * @returns Shifted Long
     */
    Long.prototype.shiftRightUnsigned = function (numBits) {
        if (Long.isLong(numBits))
            numBits = numBits.toInt();
        numBits &= 63;
        if (numBits === 0)
            return this;
        else {
            var high = this.high;
            if (numBits < 32) {
                var low = this.low;
                return Long.fromBits((low >>> numBits) | (high << (32 - numBits)), high >>> numBits, this.unsigned);
            }
            else if (numBits === 32)
                return Long.fromBits(high, 0, this.unsigned);
            else
                return Long.fromBits(high >>> (numBits - 32), 0, this.unsigned);
        }
    };
    /** This is an alias of {@link Long.shiftRightUnsigned} */
    Long.prototype.shr_u = function (numBits) {
        return this.shiftRightUnsigned(numBits);
    };
    /** This is an alias of {@link Long.shiftRightUnsigned} */
    Long.prototype.shru = function (numBits) {
        return this.shiftRightUnsigned(numBits);
    };
    /**
     * Returns the difference of this and the specified Long.
     * @param subtrahend - Subtrahend
     * @returns Difference
     */
    Long.prototype.subtract = function (subtrahend) {
        if (!Long.isLong(subtrahend))
            subtrahend = Long.fromValue(subtrahend);
        return this.add(subtrahend.neg());
    };
    /** This is an alias of {@link Long.subtract} */
    Long.prototype.sub = function (subtrahend) {
        return this.subtract(subtrahend);
    };
    /** Converts the Long to a 32 bit integer, assuming it is a 32 bit integer. */
    Long.prototype.toInt = function () {
        return this.unsigned ? this.low >>> 0 : this.low;
    };
    /** Converts the Long to a the nearest floating-point representation of this value (double, 53 bit mantissa). */
    Long.prototype.toNumber = function () {
        if (this.unsigned)
            return (this.high >>> 0) * TWO_PWR_32_DBL + (this.low >>> 0);
        return this.high * TWO_PWR_32_DBL + (this.low >>> 0);
    };
    /** Converts the Long to a BigInt (arbitrary precision). */
    Long.prototype.toBigInt = function () {
        return BigInt(this.toString());
    };
    /**
     * Converts this Long to its byte representation.
     * @param le - Whether little or big endian, defaults to big endian
     * @returns Byte representation
     */
    Long.prototype.toBytes = function (le) {
        return le ? this.toBytesLE() : this.toBytesBE();
    };
    /**
     * Converts this Long to its little endian byte representation.
     * @returns Little endian byte representation
     */
    Long.prototype.toBytesLE = function () {
        var hi = this.high, lo = this.low;
        return [
            lo & 0xff,
            (lo >>> 8) & 0xff,
            (lo >>> 16) & 0xff,
            lo >>> 24,
            hi & 0xff,
            (hi >>> 8) & 0xff,
            (hi >>> 16) & 0xff,
            hi >>> 24
        ];
    };
    /**
     * Converts this Long to its big endian byte representation.
     * @returns Big endian byte representation
     */
    Long.prototype.toBytesBE = function () {
        var hi = this.high, lo = this.low;
        return [
            hi >>> 24,
            (hi >>> 16) & 0xff,
            (hi >>> 8) & 0xff,
            hi & 0xff,
            lo >>> 24,
            (lo >>> 16) & 0xff,
            (lo >>> 8) & 0xff,
            lo & 0xff
        ];
    };
    /**
     * Converts this Long to signed.
     */
    Long.prototype.toSigned = function () {
        if (!this.unsigned)
            return this;
        return Long.fromBits(this.low, this.high, false);
    };
    /**
     * Converts the Long to a string written in the specified radix.
     * @param radix - Radix (2-36), defaults to 10
     * @throws RangeError If `radix` is out of range
     */
    Long.prototype.toString = function (radix) {
        radix = radix || 10;
        if (radix < 2 || 36 < radix)
            throw RangeError('radix');
        if (this.isZero())
            return '0';
        if (this.isNegative()) {
            // Unsigned Longs are never negative
            if (this.eq(Long.MIN_VALUE)) {
                // We need to change the Long value before it can be negated, so we remove
                // the bottom-most digit in this base and then recurse to do the rest.
                var radixLong = Long.fromNumber(radix), div = this.div(radixLong), rem1 = div.mul(radixLong).sub(this);
                return div.toString(radix) + rem1.toInt().toString(radix);
            }
            else
                return '-' + this.neg().toString(radix);
        }
        // Do several (6) digits each time through the loop, so as to
        // minimize the calls to the very expensive emulated div.
        var radixToPower = Long.fromNumber(Math.pow(radix, 6), this.unsigned);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        var rem = this;
        var result = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
            var remDiv = rem.div(radixToPower);
            var intval = rem.sub(remDiv.mul(radixToPower)).toInt() >>> 0;
            var digits = intval.toString(radix);
            rem = remDiv;
            if (rem.isZero()) {
                return digits + result;
            }
            else {
                while (digits.length < 6)
                    digits = '0' + digits;
                result = '' + digits + result;
            }
        }
    };
    /** Converts this Long to unsigned. */
    Long.prototype.toUnsigned = function () {
        if (this.unsigned)
            return this;
        return Long.fromBits(this.low, this.high, true);
    };
    /** Returns the bitwise XOR of this Long and the given one. */
    Long.prototype.xor = function (other) {
        if (!Long.isLong(other))
            other = Long.fromValue(other);
        return Long.fromBits(this.low ^ other.low, this.high ^ other.high, this.unsigned);
    };
    /** This is an alias of {@link Long.isZero} */
    Long.prototype.eqz = function () {
        return this.isZero();
    };
    /** This is an alias of {@link Long.lessThanOrEqual} */
    Long.prototype.le = function (other) {
        return this.lessThanOrEqual(other);
    };
    /*
     ****************************************************************
     *                  BSON SPECIFIC ADDITIONS                     *
     ****************************************************************
     */
    Long.prototype.toExtendedJSON = function (options) {
        if (options && options.relaxed)
            return this.toNumber();
        return { $numberLong: this.toString() };
    };
    Long.fromExtendedJSON = function (doc, options) {
        var result = Long.fromString(doc.$numberLong);
        return options && options.relaxed ? result.toNumber() : result;
    };
    /** @internal */
    Long.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Long.prototype.inspect = function () {
        return "new Long(\"" + this.toString() + "\"" + (this.unsigned ? ', true' : '') + ")";
    };
    Long.TWO_PWR_24 = Long.fromInt(TWO_PWR_24_DBL);
    /** Maximum unsigned value. */
    Long.MAX_UNSIGNED_VALUE = Long.fromBits(0xffffffff | 0, 0xffffffff | 0, true);
    /** Signed zero */
    Long.ZERO = Long.fromInt(0);
    /** Unsigned zero. */
    Long.UZERO = Long.fromInt(0, true);
    /** Signed one. */
    Long.ONE = Long.fromInt(1);
    /** Unsigned one. */
    Long.UONE = Long.fromInt(1, true);
    /** Signed negative one. */
    Long.NEG_ONE = Long.fromInt(-1);
    /** Maximum signed value. */
    Long.MAX_VALUE = Long.fromBits(0xffffffff | 0, 0x7fffffff | 0, false);
    /** Minimum signed value. */
    Long.MIN_VALUE = Long.fromBits(0, 0x80000000 | 0, false);
    return Long;
}());
Object.defineProperty(Long.prototype, '__isLong__', { value: true });
Object.defineProperty(Long.prototype, '_bsontype', { value: 'Long' });

var PARSE_STRING_REGEXP = /^(\+|-)?(\d+|(\d*\.\d*))?(E|e)?([-+])?(\d+)?$/;
var PARSE_INF_REGEXP = /^(\+|-)?(Infinity|inf)$/i;
var PARSE_NAN_REGEXP = /^(\+|-)?NaN$/i;
var EXPONENT_MAX = 6111;
var EXPONENT_MIN = -6176;
var EXPONENT_BIAS = 6176;
var MAX_DIGITS = 34;
// Nan value bits as 32 bit values (due to lack of longs)
var NAN_BUFFER = [
    0x7c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
].reverse();
// Infinity value bits 32 bit values (due to lack of longs)
var INF_NEGATIVE_BUFFER = [
    0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
].reverse();
var INF_POSITIVE_BUFFER = [
    0x78, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
].reverse();
var EXPONENT_REGEX = /^([-+])?(\d+)?$/;
// Extract least significant 5 bits
var COMBINATION_MASK = 0x1f;
// Extract least significant 14 bits
var EXPONENT_MASK = 0x3fff;
// Value of combination field for Inf
var COMBINATION_INFINITY = 30;
// Value of combination field for NaN
var COMBINATION_NAN = 31;
// Detect if the value is a digit
function isDigit(value) {
    return !isNaN(parseInt(value, 10));
}
// Divide two uint128 values
function divideu128(value) {
    var DIVISOR = Long.fromNumber(1000 * 1000 * 1000);
    var _rem = Long.fromNumber(0);
    if (!value.parts[0] && !value.parts[1] && !value.parts[2] && !value.parts[3]) {
        return { quotient: value, rem: _rem };
    }
    for (var i = 0; i <= 3; i++) {
        // Adjust remainder to match value of next dividend
        _rem = _rem.shiftLeft(32);
        // Add the divided to _rem
        _rem = _rem.add(new Long(value.parts[i], 0));
        value.parts[i] = _rem.div(DIVISOR).low;
        _rem = _rem.modulo(DIVISOR);
    }
    return { quotient: value, rem: _rem };
}
// Multiply two Long values and return the 128 bit value
function multiply64x2(left, right) {
    if (!left && !right) {
        return { high: Long.fromNumber(0), low: Long.fromNumber(0) };
    }
    var leftHigh = left.shiftRightUnsigned(32);
    var leftLow = new Long(left.getLowBits(), 0);
    var rightHigh = right.shiftRightUnsigned(32);
    var rightLow = new Long(right.getLowBits(), 0);
    var productHigh = leftHigh.multiply(rightHigh);
    var productMid = leftHigh.multiply(rightLow);
    var productMid2 = leftLow.multiply(rightHigh);
    var productLow = leftLow.multiply(rightLow);
    productHigh = productHigh.add(productMid.shiftRightUnsigned(32));
    productMid = new Long(productMid.getLowBits(), 0)
        .add(productMid2)
        .add(productLow.shiftRightUnsigned(32));
    productHigh = productHigh.add(productMid.shiftRightUnsigned(32));
    productLow = productMid.shiftLeft(32).add(new Long(productLow.getLowBits(), 0));
    // Return the 128 bit result
    return { high: productHigh, low: productLow };
}
function lessThan(left, right) {
    // Make values unsigned
    var uhleft = left.high >>> 0;
    var uhright = right.high >>> 0;
    // Compare high bits first
    if (uhleft < uhright) {
        return true;
    }
    else if (uhleft === uhright) {
        var ulleft = left.low >>> 0;
        var ulright = right.low >>> 0;
        if (ulleft < ulright)
            return true;
    }
    return false;
}
function invalidErr(string, message) {
    throw new BSONTypeError("\"" + string + "\" is not a valid Decimal128 string - " + message);
}
/**
 * A class representation of the BSON Decimal128 type.
 * @public
 */
var Decimal128 = /** @class */ (function () {
    /**
     * @param bytes - a buffer containing the raw Decimal128 bytes in little endian order,
     *                or a string representation as returned by .toString()
     */
    function Decimal128(bytes) {
        if (!(this instanceof Decimal128))
            return new Decimal128(bytes);
        if (typeof bytes === 'string') {
            this.bytes = Decimal128.fromString(bytes).bytes;
        }
        else if (isUint8Array(bytes)) {
            if (bytes.byteLength !== 16) {
                throw new BSONTypeError('Decimal128 must take a Buffer of 16 bytes');
            }
            this.bytes = bytes;
        }
        else {
            throw new BSONTypeError('Decimal128 must take a Buffer or string');
        }
    }
    /**
     * Create a Decimal128 instance from a string representation
     *
     * @param representation - a numeric string representation.
     */
    Decimal128.fromString = function (representation) {
        // Parse state tracking
        var isNegative = false;
        var sawRadix = false;
        var foundNonZero = false;
        // Total number of significant digits (no leading or trailing zero)
        var significantDigits = 0;
        // Total number of significand digits read
        var nDigitsRead = 0;
        // Total number of digits (no leading zeros)
        var nDigits = 0;
        // The number of the digits after radix
        var radixPosition = 0;
        // The index of the first non-zero in *str*
        var firstNonZero = 0;
        // Digits Array
        var digits = [0];
        // The number of digits in digits
        var nDigitsStored = 0;
        // Insertion pointer for digits
        var digitsInsert = 0;
        // The index of the first non-zero digit
        var firstDigit = 0;
        // The index of the last digit
        var lastDigit = 0;
        // Exponent
        var exponent = 0;
        // loop index over array
        var i = 0;
        // The high 17 digits of the significand
        var significandHigh = new Long(0, 0);
        // The low 17 digits of the significand
        var significandLow = new Long(0, 0);
        // The biased exponent
        var biasedExponent = 0;
        // Read index
        var index = 0;
        // Naively prevent against REDOS attacks.
        // TODO: implementing a custom parsing for this, or refactoring the regex would yield
        //       further gains.
        if (representation.length >= 7000) {
            throw new BSONTypeError('' + representation + ' not a valid Decimal128 string');
        }
        // Results
        var stringMatch = representation.match(PARSE_STRING_REGEXP);
        var infMatch = representation.match(PARSE_INF_REGEXP);
        var nanMatch = representation.match(PARSE_NAN_REGEXP);
        // Validate the string
        if ((!stringMatch && !infMatch && !nanMatch) || representation.length === 0) {
            throw new BSONTypeError('' + representation + ' not a valid Decimal128 string');
        }
        if (stringMatch) {
            // full_match = stringMatch[0]
            // sign = stringMatch[1]
            var unsignedNumber = stringMatch[2];
            // stringMatch[3] is undefined if a whole number (ex "1", 12")
            // but defined if a number w/ decimal in it (ex "1.0, 12.2")
            var e = stringMatch[4];
            var expSign = stringMatch[5];
            var expNumber = stringMatch[6];
            // they provided e, but didn't give an exponent number. for ex "1e"
            if (e && expNumber === undefined)
                invalidErr(representation, 'missing exponent power');
            // they provided e, but didn't give a number before it. for ex "e1"
            if (e && unsignedNumber === undefined)
                invalidErr(representation, 'missing exponent base');
            if (e === undefined && (expSign || expNumber)) {
                invalidErr(representation, 'missing e before exponent');
            }
        }
        // Get the negative or positive sign
        if (representation[index] === '+' || representation[index] === '-') {
            isNegative = representation[index++] === '-';
        }
        // Check if user passed Infinity or NaN
        if (!isDigit(representation[index]) && representation[index] !== '.') {
            if (representation[index] === 'i' || representation[index] === 'I') {
                return new Decimal128(Buffer.from(isNegative ? INF_NEGATIVE_BUFFER : INF_POSITIVE_BUFFER));
            }
            else if (representation[index] === 'N') {
                return new Decimal128(Buffer.from(NAN_BUFFER));
            }
        }
        // Read all the digits
        while (isDigit(representation[index]) || representation[index] === '.') {
            if (representation[index] === '.') {
                if (sawRadix)
                    invalidErr(representation, 'contains multiple periods');
                sawRadix = true;
                index = index + 1;
                continue;
            }
            if (nDigitsStored < 34) {
                if (representation[index] !== '0' || foundNonZero) {
                    if (!foundNonZero) {
                        firstNonZero = nDigitsRead;
                    }
                    foundNonZero = true;
                    // Only store 34 digits
                    digits[digitsInsert++] = parseInt(representation[index], 10);
                    nDigitsStored = nDigitsStored + 1;
                }
            }
            if (foundNonZero)
                nDigits = nDigits + 1;
            if (sawRadix)
                radixPosition = radixPosition + 1;
            nDigitsRead = nDigitsRead + 1;
            index = index + 1;
        }
        if (sawRadix && !nDigitsRead)
            throw new BSONTypeError('' + representation + ' not a valid Decimal128 string');
        // Read exponent if exists
        if (representation[index] === 'e' || representation[index] === 'E') {
            // Read exponent digits
            var match = representation.substr(++index).match(EXPONENT_REGEX);
            // No digits read
            if (!match || !match[2])
                return new Decimal128(Buffer.from(NAN_BUFFER));
            // Get exponent
            exponent = parseInt(match[0], 10);
            // Adjust the index
            index = index + match[0].length;
        }
        // Return not a number
        if (representation[index])
            return new Decimal128(Buffer.from(NAN_BUFFER));
        // Done reading input
        // Find first non-zero digit in digits
        firstDigit = 0;
        if (!nDigitsStored) {
            firstDigit = 0;
            lastDigit = 0;
            digits[0] = 0;
            nDigits = 1;
            nDigitsStored = 1;
            significantDigits = 0;
        }
        else {
            lastDigit = nDigitsStored - 1;
            significantDigits = nDigits;
            if (significantDigits !== 1) {
                while (digits[firstNonZero + significantDigits - 1] === 0) {
                    significantDigits = significantDigits - 1;
                }
            }
        }
        // Normalization of exponent
        // Correct exponent based on radix position, and shift significand as needed
        // to represent user input
        // Overflow prevention
        if (exponent <= radixPosition && radixPosition - exponent > 1 << 14) {
            exponent = EXPONENT_MIN;
        }
        else {
            exponent = exponent - radixPosition;
        }
        // Attempt to normalize the exponent
        while (exponent > EXPONENT_MAX) {
            // Shift exponent to significand and decrease
            lastDigit = lastDigit + 1;
            if (lastDigit - firstDigit > MAX_DIGITS) {
                // Check if we have a zero then just hard clamp, otherwise fail
                var digitsString = digits.join('');
                if (digitsString.match(/^0+$/)) {
                    exponent = EXPONENT_MAX;
                    break;
                }
                invalidErr(representation, 'overflow');
            }
            exponent = exponent - 1;
        }
        while (exponent < EXPONENT_MIN || nDigitsStored < nDigits) {
            // Shift last digit. can only do this if < significant digits than # stored.
            if (lastDigit === 0 && significantDigits < nDigitsStored) {
                exponent = EXPONENT_MIN;
                significantDigits = 0;
                break;
            }
            if (nDigitsStored < nDigits) {
                // adjust to match digits not stored
                nDigits = nDigits - 1;
            }
            else {
                // adjust to round
                lastDigit = lastDigit - 1;
            }
            if (exponent < EXPONENT_MAX) {
                exponent = exponent + 1;
            }
            else {
                // Check if we have a zero then just hard clamp, otherwise fail
                var digitsString = digits.join('');
                if (digitsString.match(/^0+$/)) {
                    exponent = EXPONENT_MAX;
                    break;
                }
                invalidErr(representation, 'overflow');
            }
        }
        // Round
        // We've normalized the exponent, but might still need to round.
        if (lastDigit - firstDigit + 1 < significantDigits) {
            var endOfString = nDigitsRead;
            // If we have seen a radix point, 'string' is 1 longer than we have
            // documented with ndigits_read, so inc the position of the first nonzero
            // digit and the position that digits are read to.
            if (sawRadix) {
                firstNonZero = firstNonZero + 1;
                endOfString = endOfString + 1;
            }
            // if negative, we need to increment again to account for - sign at start.
            if (isNegative) {
                firstNonZero = firstNonZero + 1;
                endOfString = endOfString + 1;
            }
            var roundDigit = parseInt(representation[firstNonZero + lastDigit + 1], 10);
            var roundBit = 0;
            if (roundDigit >= 5) {
                roundBit = 1;
                if (roundDigit === 5) {
                    roundBit = digits[lastDigit] % 2 === 1 ? 1 : 0;
                    for (i = firstNonZero + lastDigit + 2; i < endOfString; i++) {
                        if (parseInt(representation[i], 10)) {
                            roundBit = 1;
                            break;
                        }
                    }
                }
            }
            if (roundBit) {
                var dIdx = lastDigit;
                for (; dIdx >= 0; dIdx--) {
                    if (++digits[dIdx] > 9) {
                        digits[dIdx] = 0;
                        // overflowed most significant digit
                        if (dIdx === 0) {
                            if (exponent < EXPONENT_MAX) {
                                exponent = exponent + 1;
                                digits[dIdx] = 1;
                            }
                            else {
                                return new Decimal128(Buffer.from(isNegative ? INF_NEGATIVE_BUFFER : INF_POSITIVE_BUFFER));
                            }
                        }
                    }
                }
            }
        }
        // Encode significand
        // The high 17 digits of the significand
        significandHigh = Long.fromNumber(0);
        // The low 17 digits of the significand
        significandLow = Long.fromNumber(0);
        // read a zero
        if (significantDigits === 0) {
            significandHigh = Long.fromNumber(0);
            significandLow = Long.fromNumber(0);
        }
        else if (lastDigit - firstDigit < 17) {
            var dIdx = firstDigit;
            significandLow = Long.fromNumber(digits[dIdx++]);
            significandHigh = new Long(0, 0);
            for (; dIdx <= lastDigit; dIdx++) {
                significandLow = significandLow.multiply(Long.fromNumber(10));
                significandLow = significandLow.add(Long.fromNumber(digits[dIdx]));
            }
        }
        else {
            var dIdx = firstDigit;
            significandHigh = Long.fromNumber(digits[dIdx++]);
            for (; dIdx <= lastDigit - 17; dIdx++) {
                significandHigh = significandHigh.multiply(Long.fromNumber(10));
                significandHigh = significandHigh.add(Long.fromNumber(digits[dIdx]));
            }
            significandLow = Long.fromNumber(digits[dIdx++]);
            for (; dIdx <= lastDigit; dIdx++) {
                significandLow = significandLow.multiply(Long.fromNumber(10));
                significandLow = significandLow.add(Long.fromNumber(digits[dIdx]));
            }
        }
        var significand = multiply64x2(significandHigh, Long.fromString('100000000000000000'));
        significand.low = significand.low.add(significandLow);
        if (lessThan(significand.low, significandLow)) {
            significand.high = significand.high.add(Long.fromNumber(1));
        }
        // Biased exponent
        biasedExponent = exponent + EXPONENT_BIAS;
        var dec = { low: Long.fromNumber(0), high: Long.fromNumber(0) };
        // Encode combination, exponent, and significand.
        if (significand.high.shiftRightUnsigned(49).and(Long.fromNumber(1)).equals(Long.fromNumber(1))) {
            // Encode '11' into bits 1 to 3
            dec.high = dec.high.or(Long.fromNumber(0x3).shiftLeft(61));
            dec.high = dec.high.or(Long.fromNumber(biasedExponent).and(Long.fromNumber(0x3fff).shiftLeft(47)));
            dec.high = dec.high.or(significand.high.and(Long.fromNumber(0x7fffffffffff)));
        }
        else {
            dec.high = dec.high.or(Long.fromNumber(biasedExponent & 0x3fff).shiftLeft(49));
            dec.high = dec.high.or(significand.high.and(Long.fromNumber(0x1ffffffffffff)));
        }
        dec.low = significand.low;
        // Encode sign
        if (isNegative) {
            dec.high = dec.high.or(Long.fromString('9223372036854775808'));
        }
        // Encode into a buffer
        var buffer = Buffer.alloc(16);
        index = 0;
        // Encode the low 64 bits of the decimal
        // Encode low bits
        buffer[index++] = dec.low.low & 0xff;
        buffer[index++] = (dec.low.low >> 8) & 0xff;
        buffer[index++] = (dec.low.low >> 16) & 0xff;
        buffer[index++] = (dec.low.low >> 24) & 0xff;
        // Encode high bits
        buffer[index++] = dec.low.high & 0xff;
        buffer[index++] = (dec.low.high >> 8) & 0xff;
        buffer[index++] = (dec.low.high >> 16) & 0xff;
        buffer[index++] = (dec.low.high >> 24) & 0xff;
        // Encode the high 64 bits of the decimal
        // Encode low bits
        buffer[index++] = dec.high.low & 0xff;
        buffer[index++] = (dec.high.low >> 8) & 0xff;
        buffer[index++] = (dec.high.low >> 16) & 0xff;
        buffer[index++] = (dec.high.low >> 24) & 0xff;
        // Encode high bits
        buffer[index++] = dec.high.high & 0xff;
        buffer[index++] = (dec.high.high >> 8) & 0xff;
        buffer[index++] = (dec.high.high >> 16) & 0xff;
        buffer[index++] = (dec.high.high >> 24) & 0xff;
        // Return the new Decimal128
        return new Decimal128(buffer);
    };
    /** Create a string representation of the raw Decimal128 value */
    Decimal128.prototype.toString = function () {
        // Note: bits in this routine are referred to starting at 0,
        // from the sign bit, towards the coefficient.
        // decoded biased exponent (14 bits)
        var biased_exponent;
        // the number of significand digits
        var significand_digits = 0;
        // the base-10 digits in the significand
        var significand = new Array(36);
        for (var i = 0; i < significand.length; i++)
            significand[i] = 0;
        // read pointer into significand
        var index = 0;
        // true if the number is zero
        var is_zero = false;
        // the most significant significand bits (50-46)
        var significand_msb;
        // temporary storage for significand decoding
        var significand128 = { parts: [0, 0, 0, 0] };
        // indexing variables
        var j, k;
        // Output string
        var string = [];
        // Unpack index
        index = 0;
        // Buffer reference
        var buffer = this.bytes;
        // Unpack the low 64bits into a long
        // bits 96 - 127
        var low = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
        // bits 64 - 95
        var midl = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
        // Unpack the high 64bits into a long
        // bits 32 - 63
        var midh = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
        // bits 0 - 31
        var high = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
        // Unpack index
        index = 0;
        // Create the state of the decimal
        var dec = {
            low: new Long(low, midl),
            high: new Long(midh, high)
        };
        if (dec.high.lessThan(Long.ZERO)) {
            string.push('-');
        }
        // Decode combination field and exponent
        // bits 1 - 5
        var combination = (high >> 26) & COMBINATION_MASK;
        if (combination >> 3 === 3) {
            // Check for 'special' values
            if (combination === COMBINATION_INFINITY) {
                return string.join('') + 'Infinity';
            }
            else if (combination === COMBINATION_NAN) {
                return 'NaN';
            }
            else {
                biased_exponent = (high >> 15) & EXPONENT_MASK;
                significand_msb = 0x08 + ((high >> 14) & 0x01);
            }
        }
        else {
            significand_msb = (high >> 14) & 0x07;
            biased_exponent = (high >> 17) & EXPONENT_MASK;
        }
        // unbiased exponent
        var exponent = biased_exponent - EXPONENT_BIAS;
        // Create string of significand digits
        // Convert the 114-bit binary number represented by
        // (significand_high, significand_low) to at most 34 decimal
        // digits through modulo and division.
        significand128.parts[0] = (high & 0x3fff) + ((significand_msb & 0xf) << 14);
        significand128.parts[1] = midh;
        significand128.parts[2] = midl;
        significand128.parts[3] = low;
        if (significand128.parts[0] === 0 &&
            significand128.parts[1] === 0 &&
            significand128.parts[2] === 0 &&
            significand128.parts[3] === 0) {
            is_zero = true;
        }
        else {
            for (k = 3; k >= 0; k--) {
                var least_digits = 0;
                // Perform the divide
                var result = divideu128(significand128);
                significand128 = result.quotient;
                least_digits = result.rem.low;
                // We now have the 9 least significant digits (in base 2).
                // Convert and output to string.
                if (!least_digits)
                    continue;
                for (j = 8; j >= 0; j--) {
                    // significand[k * 9 + j] = Math.round(least_digits % 10);
                    significand[k * 9 + j] = least_digits % 10;
                    // least_digits = Math.round(least_digits / 10);
                    least_digits = Math.floor(least_digits / 10);
                }
            }
        }
        // Output format options:
        // Scientific - [-]d.dddE(+/-)dd or [-]dE(+/-)dd
        // Regular    - ddd.ddd
        if (is_zero) {
            significand_digits = 1;
            significand[index] = 0;
        }
        else {
            significand_digits = 36;
            while (!significand[index]) {
                significand_digits = significand_digits - 1;
                index = index + 1;
            }
        }
        // the exponent if scientific notation is used
        var scientific_exponent = significand_digits - 1 + exponent;
        // The scientific exponent checks are dictated by the string conversion
        // specification and are somewhat arbitrary cutoffs.
        //
        // We must check exponent > 0, because if this is the case, the number
        // has trailing zeros.  However, we *cannot* output these trailing zeros,
        // because doing so would change the precision of the value, and would
        // change stored data if the string converted number is round tripped.
        if (scientific_exponent >= 34 || scientific_exponent <= -7 || exponent > 0) {
            // Scientific format
            // if there are too many significant digits, we should just be treating numbers
            // as + or - 0 and using the non-scientific exponent (this is for the "invalid
            // representation should be treated as 0/-0" spec cases in decimal128-1.json)
            if (significand_digits > 34) {
                string.push("" + 0);
                if (exponent > 0)
                    string.push('E+' + exponent);
                else if (exponent < 0)
                    string.push('E' + exponent);
                return string.join('');
            }
            string.push("" + significand[index++]);
            significand_digits = significand_digits - 1;
            if (significand_digits) {
                string.push('.');
            }
            for (var i = 0; i < significand_digits; i++) {
                string.push("" + significand[index++]);
            }
            // Exponent
            string.push('E');
            if (scientific_exponent > 0) {
                string.push('+' + scientific_exponent);
            }
            else {
                string.push("" + scientific_exponent);
            }
        }
        else {
            // Regular format with no decimal place
            if (exponent >= 0) {
                for (var i = 0; i < significand_digits; i++) {
                    string.push("" + significand[index++]);
                }
            }
            else {
                var radix_position = significand_digits + exponent;
                // non-zero digits before radix
                if (radix_position > 0) {
                    for (var i = 0; i < radix_position; i++) {
                        string.push("" + significand[index++]);
                    }
                }
                else {
                    string.push('0');
                }
                string.push('.');
                // add leading zeros after radix
                while (radix_position++ < 0) {
                    string.push('0');
                }
                for (var i = 0; i < significand_digits - Math.max(radix_position - 1, 0); i++) {
                    string.push("" + significand[index++]);
                }
            }
        }
        return string.join('');
    };
    Decimal128.prototype.toJSON = function () {
        return { $numberDecimal: this.toString() };
    };
    /** @internal */
    Decimal128.prototype.toExtendedJSON = function () {
        return { $numberDecimal: this.toString() };
    };
    /** @internal */
    Decimal128.fromExtendedJSON = function (doc) {
        return Decimal128.fromString(doc.$numberDecimal);
    };
    /** @internal */
    Decimal128.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Decimal128.prototype.inspect = function () {
        return "new Decimal128(\"" + this.toString() + "\")";
    };
    return Decimal128;
}());
Object.defineProperty(Decimal128.prototype, '_bsontype', { value: 'Decimal128' });

/**
 * A class representation of the BSON Double type.
 * @public
 */
var Double = /** @class */ (function () {
    /**
     * Create a Double type
     *
     * @param value - the number we want to represent as a double.
     */
    function Double(value) {
        if (!(this instanceof Double))
            return new Double(value);
        if (value instanceof Number) {
            value = value.valueOf();
        }
        this.value = +value;
    }
    /**
     * Access the number value.
     *
     * @returns returns the wrapped double number.
     */
    Double.prototype.valueOf = function () {
        return this.value;
    };
    Double.prototype.toJSON = function () {
        return this.value;
    };
    Double.prototype.toString = function (radix) {
        return this.value.toString(radix);
    };
    /** @internal */
    Double.prototype.toExtendedJSON = function (options) {
        if (options && (options.legacy || (options.relaxed && isFinite(this.value)))) {
            return this.value;
        }
        // NOTE: JavaScript has +0 and -0, apparently to model limit calculations. If a user
        // explicitly provided `-0` then we need to ensure the sign makes it into the output
        if (Object.is(Math.sign(this.value), -0)) {
            return { $numberDouble: "-" + this.value.toFixed(1) };
        }
        var $numberDouble;
        if (Number.isInteger(this.value)) {
            $numberDouble = this.value.toFixed(1);
            if ($numberDouble.length >= 13) {
                $numberDouble = this.value.toExponential(13).toUpperCase();
            }
        }
        else {
            $numberDouble = this.value.toString();
        }
        return { $numberDouble: $numberDouble };
    };
    /** @internal */
    Double.fromExtendedJSON = function (doc, options) {
        var doubleValue = parseFloat(doc.$numberDouble);
        return options && options.relaxed ? doubleValue : new Double(doubleValue);
    };
    /** @internal */
    Double.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Double.prototype.inspect = function () {
        var eJSON = this.toExtendedJSON();
        return "new Double(" + eJSON.$numberDouble + ")";
    };
    return Double;
}());
Object.defineProperty(Double.prototype, '_bsontype', { value: 'Double' });

/**
 * A class representation of a BSON Int32 type.
 * @public
 */
var Int32 = /** @class */ (function () {
    /**
     * Create an Int32 type
     *
     * @param value - the number we want to represent as an int32.
     */
    function Int32(value) {
        if (!(this instanceof Int32))
            return new Int32(value);
        if (value instanceof Number) {
            value = value.valueOf();
        }
        this.value = +value | 0;
    }
    /**
     * Access the number value.
     *
     * @returns returns the wrapped int32 number.
     */
    Int32.prototype.valueOf = function () {
        return this.value;
    };
    Int32.prototype.toString = function (radix) {
        return this.value.toString(radix);
    };
    Int32.prototype.toJSON = function () {
        return this.value;
    };
    /** @internal */
    Int32.prototype.toExtendedJSON = function (options) {
        if (options && (options.relaxed || options.legacy))
            return this.value;
        return { $numberInt: this.value.toString() };
    };
    /** @internal */
    Int32.fromExtendedJSON = function (doc, options) {
        return options && options.relaxed ? parseInt(doc.$numberInt, 10) : new Int32(doc.$numberInt);
    };
    /** @internal */
    Int32.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Int32.prototype.inspect = function () {
        return "new Int32(" + this.valueOf() + ")";
    };
    return Int32;
}());
Object.defineProperty(Int32.prototype, '_bsontype', { value: 'Int32' });

/**
 * A class representation of the BSON MaxKey type.
 * @public
 */
var MaxKey = /** @class */ (function () {
    function MaxKey() {
        if (!(this instanceof MaxKey))
            return new MaxKey();
    }
    /** @internal */
    MaxKey.prototype.toExtendedJSON = function () {
        return { $maxKey: 1 };
    };
    /** @internal */
    MaxKey.fromExtendedJSON = function () {
        return new MaxKey();
    };
    /** @internal */
    MaxKey.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    MaxKey.prototype.inspect = function () {
        return 'new MaxKey()';
    };
    return MaxKey;
}());
Object.defineProperty(MaxKey.prototype, '_bsontype', { value: 'MaxKey' });

/**
 * A class representation of the BSON MinKey type.
 * @public
 */
var MinKey = /** @class */ (function () {
    function MinKey() {
        if (!(this instanceof MinKey))
            return new MinKey();
    }
    /** @internal */
    MinKey.prototype.toExtendedJSON = function () {
        return { $minKey: 1 };
    };
    /** @internal */
    MinKey.fromExtendedJSON = function () {
        return new MinKey();
    };
    /** @internal */
    MinKey.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    MinKey.prototype.inspect = function () {
        return 'new MinKey()';
    };
    return MinKey;
}());
Object.defineProperty(MinKey.prototype, '_bsontype', { value: 'MinKey' });

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
                throw new BSONTypeError('Argument passed in must have an id that is of type string or Buffer');
            }
            if ('toHexString' in inputId && typeof inputId.toHexString === 'function') {
                workingId = Buffer.from(inputId.toHexString(), 'hex');
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
            this[kId] = ensureBuffer(workingId);
        }
        else if (typeof workingId === 'string') {
            if (workingId.length === 12) {
                var bytes = Buffer.from(workingId);
                if (bytes.byteLength === 12) {
                    this[kId] = bytes;
                }
                else {
                    throw new BSONTypeError('Argument passed in must be a string of 12 bytes');
                }
            }
            else if (workingId.length === 24 && checkForHexRegExp.test(workingId)) {
                this[kId] = Buffer.from(workingId, 'hex');
            }
            else {
                throw new BSONTypeError('Argument passed in must be a string of 12 bytes or a string of 24 hex characters');
            }
        }
        else {
            throw new BSONTypeError('Argument passed in does not match the accepted types');
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
        var buffer = Buffer.alloc(12);
        // 4-byte timestamp
        buffer.writeUInt32BE(time, 0);
        // set PROCESS_UNIQUE if yet not initialized
        if (PROCESS_UNIQUE === null) {
            PROCESS_UNIQUE = randomBytes(5);
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
            isUint8Array(this.id)) {
            return otherId === Buffer.prototype.toString.call(this.id, 'latin1');
        }
        if (typeof otherId === 'string' && ObjectId.isValid(otherId) && otherId.length === 24) {
            return otherId.toLowerCase() === this.toHexString();
        }
        if (typeof otherId === 'string' && ObjectId.isValid(otherId) && otherId.length === 12) {
            return Buffer.from(otherId).equals(this.id);
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
        var buffer = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
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
            throw new BSONTypeError('Argument passed in must be a single String of 12 bytes or a string of 24 hex characters');
        }
        return new ObjectId(Buffer.from(hexString, 'hex'));
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
// Deprecated methods
Object.defineProperty(ObjectId.prototype, 'generate', {
    value: deprecate(function (time) { return ObjectId.generate(time); }, 'Please use the static `ObjectId.generate(time)` instead')
});
Object.defineProperty(ObjectId.prototype, 'getInc', {
    value: deprecate(function () { return ObjectId.getInc(); }, 'Please use the static `ObjectId.getInc()` instead')
});
Object.defineProperty(ObjectId.prototype, 'get_inc', {
    value: deprecate(function () { return ObjectId.getInc(); }, 'Please use the static `ObjectId.getInc()` instead')
});
Object.defineProperty(ObjectId, 'get_inc', {
    value: deprecate(function () { return ObjectId.getInc(); }, 'Please use the static `ObjectId.getInc()` instead')
});
Object.defineProperty(ObjectId.prototype, '_bsontype', { value: 'ObjectID' });

function alphabetize(str) {
    return str.split('').sort().join('');
}
/**
 * A class representation of the BSON RegExp type.
 * @public
 */
var BSONRegExp = /** @class */ (function () {
    /**
     * @param pattern - The regular expression pattern to match
     * @param options - The regular expression options
     */
    function BSONRegExp(pattern, options) {
        if (!(this instanceof BSONRegExp))
            return new BSONRegExp(pattern, options);
        this.pattern = pattern;
        this.options = alphabetize(options !== null && options !== void 0 ? options : '');
        if (this.pattern.indexOf('\x00') !== -1) {
            throw new BSONError("BSON Regex patterns cannot contain null bytes, found: " + JSON.stringify(this.pattern));
        }
        if (this.options.indexOf('\x00') !== -1) {
            throw new BSONError("BSON Regex options cannot contain null bytes, found: " + JSON.stringify(this.options));
        }
        // Validate options
        for (var i = 0; i < this.options.length; i++) {
            if (!(this.options[i] === 'i' ||
                this.options[i] === 'm' ||
                this.options[i] === 'x' ||
                this.options[i] === 'l' ||
                this.options[i] === 's' ||
                this.options[i] === 'u')) {
                throw new BSONError("The regular expression option [" + this.options[i] + "] is not supported");
            }
        }
    }
    BSONRegExp.parseOptions = function (options) {
        return options ? options.split('').sort().join('') : '';
    };
    /** @internal */
    BSONRegExp.prototype.toExtendedJSON = function (options) {
        options = options || {};
        if (options.legacy) {
            return { $regex: this.pattern, $options: this.options };
        }
        return { $regularExpression: { pattern: this.pattern, options: this.options } };
    };
    /** @internal */
    BSONRegExp.fromExtendedJSON = function (doc) {
        if ('$regex' in doc) {
            if (typeof doc.$regex !== 'string') {
                // This is for $regex query operators that have extended json values.
                if (doc.$regex._bsontype === 'BSONRegExp') {
                    return doc;
                }
            }
            else {
                return new BSONRegExp(doc.$regex, BSONRegExp.parseOptions(doc.$options));
            }
        }
        if ('$regularExpression' in doc) {
            return new BSONRegExp(doc.$regularExpression.pattern, BSONRegExp.parseOptions(doc.$regularExpression.options));
        }
        throw new BSONTypeError("Unexpected BSONRegExp EJSON object form: " + JSON.stringify(doc));
    };
    return BSONRegExp;
}());
Object.defineProperty(BSONRegExp.prototype, '_bsontype', { value: 'BSONRegExp' });

/**
 * A class representation of the BSON Symbol type.
 * @public
 */
var BSONSymbol = /** @class */ (function () {
    /**
     * @param value - the string representing the symbol.
     */
    function BSONSymbol(value) {
        if (!(this instanceof BSONSymbol))
            return new BSONSymbol(value);
        this.value = value;
    }
    /** Access the wrapped string value. */
    BSONSymbol.prototype.valueOf = function () {
        return this.value;
    };
    BSONSymbol.prototype.toString = function () {
        return this.value;
    };
    /** @internal */
    BSONSymbol.prototype.inspect = function () {
        return "new BSONSymbol(\"" + this.value + "\")";
    };
    BSONSymbol.prototype.toJSON = function () {
        return this.value;
    };
    /** @internal */
    BSONSymbol.prototype.toExtendedJSON = function () {
        return { $symbol: this.value };
    };
    /** @internal */
    BSONSymbol.fromExtendedJSON = function (doc) {
        return new BSONSymbol(doc.$symbol);
    };
    /** @internal */
    BSONSymbol.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    return BSONSymbol;
}());
Object.defineProperty(BSONSymbol.prototype, '_bsontype', { value: 'Symbol' });

/** @public */
var LongWithoutOverridesClass = Long;
/** @public */
var Timestamp = /** @class */ (function (_super) {
    __extends(Timestamp, _super);
    function Timestamp(low, high) {
        var _this = this;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        ///@ts-expect-error
        if (!(_this instanceof Timestamp))
            return new Timestamp(low, high);
        if (Long.isLong(low)) {
            _this = _super.call(this, low.low, low.high, true) || this;
        }
        else if (isObjectLike(low) && typeof low.t !== 'undefined' && typeof low.i !== 'undefined') {
            _this = _super.call(this, low.i, low.t, true) || this;
        }
        else {
            _this = _super.call(this, low, high, true) || this;
        }
        Object.defineProperty(_this, '_bsontype', {
            value: 'Timestamp',
            writable: false,
            configurable: false,
            enumerable: false
        });
        return _this;
    }
    Timestamp.prototype.toJSON = function () {
        return {
            $timestamp: this.toString()
        };
    };
    /** Returns a Timestamp represented by the given (32-bit) integer value. */
    Timestamp.fromInt = function (value) {
        return new Timestamp(Long.fromInt(value, true));
    };
    /** Returns a Timestamp representing the given number value, provided that it is a finite number. Otherwise, zero is returned. */
    Timestamp.fromNumber = function (value) {
        return new Timestamp(Long.fromNumber(value, true));
    };
    /**
     * Returns a Timestamp for the given high and low bits. Each is assumed to use 32 bits.
     *
     * @param lowBits - the low 32-bits.
     * @param highBits - the high 32-bits.
     */
    Timestamp.fromBits = function (lowBits, highBits) {
        return new Timestamp(lowBits, highBits);
    };
    /**
     * Returns a Timestamp from the given string, optionally using the given radix.
     *
     * @param str - the textual representation of the Timestamp.
     * @param optRadix - the radix in which the text is written.
     */
    Timestamp.fromString = function (str, optRadix) {
        return new Timestamp(Long.fromString(str, true, optRadix));
    };
    /** @internal */
    Timestamp.prototype.toExtendedJSON = function () {
        return { $timestamp: { t: this.high >>> 0, i: this.low >>> 0 } };
    };
    /** @internal */
    Timestamp.fromExtendedJSON = function (doc) {
        return new Timestamp(doc.$timestamp);
    };
    /** @internal */
    Timestamp.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Timestamp.prototype.inspect = function () {
        return "new Timestamp({ t: " + this.getHighBits() + ", i: " + this.getLowBits() + " })";
    };
    Timestamp.MAX_VALUE = Long.MAX_UNSIGNED_VALUE;
    return Timestamp;
}(LongWithoutOverridesClass));

function isBSONType(value) {
    return (isObjectLike(value) && Reflect.has(value, '_bsontype') && typeof value._bsontype === 'string');
}
// INT32 boundaries
var BSON_INT32_MAX$1 = 0x7fffffff;
var BSON_INT32_MIN$1 = -0x80000000;
// INT64 boundaries
var BSON_INT64_MAX$1 = 0x7fffffffffffffff;
var BSON_INT64_MIN$1 = -0x8000000000000000;
// all the types where we don't need to do any special processing and can just pass the EJSON
//straight to type.fromExtendedJSON
var keysToCodecs = {
    $oid: ObjectId,
    $binary: Binary,
    $uuid: Binary,
    $symbol: BSONSymbol,
    $numberInt: Int32,
    $numberDecimal: Decimal128,
    $numberDouble: Double,
    $numberLong: Long,
    $minKey: MinKey,
    $maxKey: MaxKey,
    $regex: BSONRegExp,
    $regularExpression: BSONRegExp,
    $timestamp: Timestamp
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserializeValue(value, options) {
    if (options === void 0) { options = {}; }
    if (typeof value === 'number') {
        if (options.relaxed || options.legacy) {
            return value;
        }
        // if it's an integer, should interpret as smallest BSON integer
        // that can represent it exactly. (if out of range, interpret as double.)
        if (Math.floor(value) === value) {
            if (value >= BSON_INT32_MIN$1 && value <= BSON_INT32_MAX$1)
                return new Int32(value);
            if (value >= BSON_INT64_MIN$1 && value <= BSON_INT64_MAX$1)
                return Long.fromNumber(value);
        }
        // If the number is a non-integer or out of integer range, should interpret as BSON Double.
        return new Double(value);
    }
    // from here on out we're looking for bson types, so bail if its not an object
    if (value == null || typeof value !== 'object')
        return value;
    // upgrade deprecated undefined to null
    if (value.$undefined)
        return null;
    var keys = Object.keys(value).filter(function (k) { return k.startsWith('$') && value[k] != null; });
    for (var i = 0; i < keys.length; i++) {
        var c = keysToCodecs[keys[i]];
        if (c)
            return c.fromExtendedJSON(value, options);
    }
    if (value.$date != null) {
        var d = value.$date;
        var date = new Date();
        if (options.legacy) {
            if (typeof d === 'number')
                date.setTime(d);
            else if (typeof d === 'string')
                date.setTime(Date.parse(d));
        }
        else {
            if (typeof d === 'string')
                date.setTime(Date.parse(d));
            else if (Long.isLong(d))
                date.setTime(d.toNumber());
            else if (typeof d === 'number' && options.relaxed)
                date.setTime(d);
        }
        return date;
    }
    if (value.$code != null) {
        var copy = Object.assign({}, value);
        if (value.$scope) {
            copy.$scope = deserializeValue(value.$scope);
        }
        return Code.fromExtendedJSON(value);
    }
    if (isDBRefLike(value) || value.$dbPointer) {
        var v = value.$ref ? value : value.$dbPointer;
        // we run into this in a "degenerate EJSON" case (with $id and $ref order flipped)
        // because of the order JSON.parse goes through the document
        if (v instanceof DBRef)
            return v;
        var dollarKeys = Object.keys(v).filter(function (k) { return k.startsWith('$'); });
        var valid_1 = true;
        dollarKeys.forEach(function (k) {
            if (['$ref', '$id', '$db'].indexOf(k) === -1)
                valid_1 = false;
        });
        // only make DBRef if $ keys are all valid
        if (valid_1)
            return DBRef.fromExtendedJSON(v);
    }
    return value;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeArray(array, options) {
    return array.map(function (v, index) {
        options.seenObjects.push({ propertyName: "index " + index, obj: null });
        try {
            return serializeValue(v, options);
        }
        finally {
            options.seenObjects.pop();
        }
    });
}
function getISOString(date) {
    var isoStr = date.toISOString();
    // we should only show milliseconds in timestamp if they're non-zero
    return date.getUTCMilliseconds() !== 0 ? isoStr : isoStr.slice(0, -5) + 'Z';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeValue(value, options) {
    if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
        var index = options.seenObjects.findIndex(function (entry) { return entry.obj === value; });
        if (index !== -1) {
            var props = options.seenObjects.map(function (entry) { return entry.propertyName; });
            var leadingPart = props
                .slice(0, index)
                .map(function (prop) { return prop + " -> "; })
                .join('');
            var alreadySeen = props[index];
            var circularPart = ' -> ' +
                props
                    .slice(index + 1, props.length - 1)
                    .map(function (prop) { return prop + " -> "; })
                    .join('');
            var current = props[props.length - 1];
            var leadingSpace = ' '.repeat(leadingPart.length + alreadySeen.length / 2);
            var dashes = '-'.repeat(circularPart.length + (alreadySeen.length + current.length) / 2 - 1);
            throw new BSONTypeError('Converting circular structure to EJSON:\n' +
                ("    " + leadingPart + alreadySeen + circularPart + current + "\n") +
                ("    " + leadingSpace + "\\" + dashes + "/"));
        }
        options.seenObjects[options.seenObjects.length - 1].obj = value;
    }
    if (Array.isArray(value))
        return serializeArray(value, options);
    if (value === undefined)
        return null;
    if (value instanceof Date || isDate(value)) {
        var dateNum = value.getTime(), 
        // is it in year range 1970-9999?
        inRange = dateNum > -1 && dateNum < 253402318800000;
        if (options.legacy) {
            return options.relaxed && inRange
                ? { $date: value.getTime() }
                : { $date: getISOString(value) };
        }
        return options.relaxed && inRange
            ? { $date: getISOString(value) }
            : { $date: { $numberLong: value.getTime().toString() } };
    }
    if (typeof value === 'number' && (!options.relaxed || !isFinite(value))) {
        // it's an integer
        if (Math.floor(value) === value) {
            var int32Range = value >= BSON_INT32_MIN$1 && value <= BSON_INT32_MAX$1, int64Range = value >= BSON_INT64_MIN$1 && value <= BSON_INT64_MAX$1;
            // interpret as being of the smallest BSON integer type that can represent the number exactly
            if (int32Range)
                return { $numberInt: value.toString() };
            if (int64Range)
                return { $numberLong: value.toString() };
        }
        return { $numberDouble: value.toString() };
    }
    if (value instanceof RegExp || isRegExp(value)) {
        var flags = value.flags;
        if (flags === undefined) {
            var match = value.toString().match(/[gimuy]*$/);
            if (match) {
                flags = match[0];
            }
        }
        var rx = new BSONRegExp(value.source, flags);
        return rx.toExtendedJSON(options);
    }
    if (value != null && typeof value === 'object')
        return serializeDocument(value, options);
    return value;
}
var BSON_TYPE_MAPPINGS = {
    Binary: function (o) { return new Binary(o.value(), o.sub_type); },
    Code: function (o) { return new Code(o.code, o.scope); },
    DBRef: function (o) { return new DBRef(o.collection || o.namespace, o.oid, o.db, o.fields); },
    Decimal128: function (o) { return new Decimal128(o.bytes); },
    Double: function (o) { return new Double(o.value); },
    Int32: function (o) { return new Int32(o.value); },
    Long: function (o) {
        return Long.fromBits(
        // underscore variants for 1.x backwards compatibility
        o.low != null ? o.low : o.low_, o.low != null ? o.high : o.high_, o.low != null ? o.unsigned : o.unsigned_);
    },
    MaxKey: function () { return new MaxKey(); },
    MinKey: function () { return new MinKey(); },
    ObjectID: function (o) { return new ObjectId(o); },
    ObjectId: function (o) { return new ObjectId(o); },
    BSONRegExp: function (o) { return new BSONRegExp(o.pattern, o.options); },
    Symbol: function (o) { return new BSONSymbol(o.value); },
    Timestamp: function (o) { return Timestamp.fromBits(o.low, o.high); }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeDocument(doc, options) {
    if (doc == null || typeof doc !== 'object')
        throw new BSONError('not an object instance');
    var bsontype = doc._bsontype;
    if (typeof bsontype === 'undefined') {
        // It's a regular object. Recursively serialize its property values.
        var _doc = {};
        for (var name in doc) {
            options.seenObjects.push({ propertyName: name, obj: null });
            try {
                _doc[name] = serializeValue(doc[name], options);
            }
            finally {
                options.seenObjects.pop();
            }
        }
        return _doc;
    }
    else if (isBSONType(doc)) {
        // the "document" is really just a BSON type object
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        var outDoc = doc;
        if (typeof outDoc.toExtendedJSON !== 'function') {
            // There's no EJSON serialization function on the object. It's probably an
            // object created by a previous version of this library (or another library)
            // that's duck-typing objects to look like they were generated by this library).
            // Copy the object into this library's version of that type.
            var mapper = BSON_TYPE_MAPPINGS[doc._bsontype];
            if (!mapper) {
                throw new BSONTypeError('Unrecognized or invalid _bsontype: ' + doc._bsontype);
            }
            outDoc = mapper(outDoc);
        }
        // Two BSON types may have nested objects that may need to be serialized too
        if (bsontype === 'Code' && outDoc.scope) {
            outDoc = new Code(outDoc.code, serializeValue(outDoc.scope, options));
        }
        else if (bsontype === 'DBRef' && outDoc.oid) {
            outDoc = new DBRef(serializeValue(outDoc.collection, options), serializeValue(outDoc.oid, options), serializeValue(outDoc.db, options), serializeValue(outDoc.fields, options));
        }
        return outDoc.toExtendedJSON(options);
    }
    else {
        throw new BSONError('_bsontype must be a string, but was: ' + typeof bsontype);
    }
}
/**
 * EJSON parse / stringify API
 * @public
 */
// the namespace here is used to emulate `export * as EJSON from '...'`
// which as of now (sept 2020) api-extractor does not support
// eslint-disable-next-line @typescript-eslint/no-namespace
var EJSON;
(function (EJSON) {
    /**
     * Parse an Extended JSON string, constructing the JavaScript value or object described by that
     * string.
     *
     * @example
     * ```js
     * const { EJSON } = require('bson');
     * const text = '{ "int32": { "$numberInt": "10" } }';
     *
     * // prints { int32: { [String: '10'] _bsontype: 'Int32', value: '10' } }
     * console.log(EJSON.parse(text, { relaxed: false }));
     *
     * // prints { int32: 10 }
     * console.log(EJSON.parse(text));
     * ```
     */
    function parse(text, options) {
        var finalOptions = Object.assign({}, { relaxed: true, legacy: false }, options);
        // relaxed implies not strict
        if (typeof finalOptions.relaxed === 'boolean')
            finalOptions.strict = !finalOptions.relaxed;
        if (typeof finalOptions.strict === 'boolean')
            finalOptions.relaxed = !finalOptions.strict;
        return JSON.parse(text, function (key, value) {
            if (key.indexOf('\x00') !== -1) {
                throw new BSONError("BSON Document field names cannot contain null bytes, found: " + JSON.stringify(key));
            }
            return deserializeValue(value, finalOptions);
        });
    }
    EJSON.parse = parse;
    /**
     * Converts a BSON document to an Extended JSON string, optionally replacing values if a replacer
     * function is specified or optionally including only the specified properties if a replacer array
     * is specified.
     *
     * @param value - The value to convert to extended JSON
     * @param replacer - A function that alters the behavior of the stringification process, or an array of String and Number objects that serve as a whitelist for selecting/filtering the properties of the value object to be included in the JSON string. If this value is null or not provided, all properties of the object are included in the resulting JSON string
     * @param space - A String or Number object that's used to insert white space into the output JSON string for readability purposes.
     * @param options - Optional settings
     *
     * @example
     * ```js
     * const { EJSON } = require('bson');
     * const Int32 = require('mongodb').Int32;
     * const doc = { int32: new Int32(10) };
     *
     * // prints '{"int32":{"$numberInt":"10"}}'
     * console.log(EJSON.stringify(doc, { relaxed: false }));
     *
     * // prints '{"int32":10}'
     * console.log(EJSON.stringify(doc));
     * ```
     */
    function stringify(value, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    replacer, space, options) {
        if (space != null && typeof space === 'object') {
            options = space;
            space = 0;
        }
        if (replacer != null && typeof replacer === 'object' && !Array.isArray(replacer)) {
            options = replacer;
            replacer = undefined;
            space = 0;
        }
        var serializeOptions = Object.assign({ relaxed: true, legacy: false }, options, {
            seenObjects: [{ propertyName: '(root)', obj: null }]
        });
        var doc = serializeValue(value, serializeOptions);
        return JSON.stringify(doc, replacer, space);
    }
    EJSON.stringify = stringify;
    /**
     * Serializes an object to an Extended JSON string, and reparse it as a JavaScript object.
     *
     * @param value - The object to serialize
     * @param options - Optional settings passed to the `stringify` function
     */
    function serialize(value, options) {
        options = options || {};
        return JSON.parse(stringify(value, options));
    }
    EJSON.serialize = serialize;
    /**
     * Deserializes an Extended JSON object into a plain JavaScript object with native/BSON types
     *
     * @param ejson - The Extended JSON object to deserialize
     * @param options - Optional settings passed to the parse method
     */
    function deserialize(ejson, options) {
        options = options || {};
        return parse(JSON.stringify(ejson), options);
    }
    EJSON.deserialize = deserialize;
})(EJSON || (EJSON = {}));

/* eslint-disable @typescript-eslint/no-explicit-any */
/** @public */
var bsonMap;
var bsonGlobal = getGlobal();
if (bsonGlobal.Map) {
    bsonMap = bsonGlobal.Map;
}
else {
    // We will return a polyfill
    bsonMap = /** @class */ (function () {
        function Map(array) {
            if (array === void 0) { array = []; }
            this._keys = [];
            this._values = {};
            for (var i = 0; i < array.length; i++) {
                if (array[i] == null)
                    continue; // skip null and undefined
                var entry = array[i];
                var key = entry[0];
                var value = entry[1];
                // Add the key to the list of keys in order
                this._keys.push(key);
                // Add the key and value to the values dictionary with a point
                // to the location in the ordered keys list
                this._values[key] = { v: value, i: this._keys.length - 1 };
            }
        }
        Map.prototype.clear = function () {
            this._keys = [];
            this._values = {};
        };
        Map.prototype.delete = function (key) {
            var value = this._values[key];
            if (value == null)
                return false;
            // Delete entry
            delete this._values[key];
            // Remove the key from the ordered keys list
            this._keys.splice(value.i, 1);
            return true;
        };
        Map.prototype.entries = function () {
            var _this = this;
            var index = 0;
            return {
                next: function () {
                    var key = _this._keys[index++];
                    return {
                        value: key !== undefined ? [key, _this._values[key].v] : undefined,
                        done: key !== undefined ? false : true
                    };
                }
            };
        };
        Map.prototype.forEach = function (callback, self) {
            self = self || this;
            for (var i = 0; i < this._keys.length; i++) {
                var key = this._keys[i];
                // Call the forEach callback
                callback.call(self, this._values[key].v, key, self);
            }
        };
        Map.prototype.get = function (key) {
            return this._values[key] ? this._values[key].v : undefined;
        };
        Map.prototype.has = function (key) {
            return this._values[key] != null;
        };
        Map.prototype.keys = function () {
            var _this = this;
            var index = 0;
            return {
                next: function () {
                    var key = _this._keys[index++];
                    return {
                        value: key !== undefined ? key : undefined,
                        done: key !== undefined ? false : true
                    };
                }
            };
        };
        Map.prototype.set = function (key, value) {
            if (this._values[key]) {
                this._values[key].v = value;
                return this;
            }
            // Add the key to the list of keys in order
            this._keys.push(key);
            // Add the key and value to the values dictionary with a point
            // to the location in the ordered keys list
            this._values[key] = { v: value, i: this._keys.length - 1 };
            return this;
        };
        Map.prototype.values = function () {
            var _this = this;
            var index = 0;
            return {
                next: function () {
                    var key = _this._keys[index++];
                    return {
                        value: key !== undefined ? _this._values[key].v : undefined,
                        done: key !== undefined ? false : true
                    };
                }
            };
        };
        Object.defineProperty(Map.prototype, "size", {
            get: function () {
                return this._keys.length;
            },
            enumerable: false,
            configurable: true
        });
        return Map;
    }());
}

/** @internal */
var BSON_INT32_MAX = 0x7fffffff;
/** @internal */
var BSON_INT32_MIN = -0x80000000;
/** @internal */
var BSON_INT64_MAX = Math.pow(2, 63) - 1;
/** @internal */
var BSON_INT64_MIN = -Math.pow(2, 63);
/**
 * Any integer up to 2^53 can be precisely represented by a double.
 * @internal
 */
var JS_INT_MAX = Math.pow(2, 53);
/**
 * Any integer down to -2^53 can be precisely represented by a double.
 * @internal
 */
var JS_INT_MIN = -Math.pow(2, 53);
/** Number BSON Type @internal */
var BSON_DATA_NUMBER = 1;
/** String BSON Type @internal */
var BSON_DATA_STRING = 2;
/** Object BSON Type @internal */
var BSON_DATA_OBJECT = 3;
/** Array BSON Type @internal */
var BSON_DATA_ARRAY = 4;
/** Binary BSON Type @internal */
var BSON_DATA_BINARY = 5;
/** Binary BSON Type @internal */
var BSON_DATA_UNDEFINED = 6;
/** ObjectId BSON Type @internal */
var BSON_DATA_OID = 7;
/** Boolean BSON Type @internal */
var BSON_DATA_BOOLEAN = 8;
/** Date BSON Type @internal */
var BSON_DATA_DATE = 9;
/** null BSON Type @internal */
var BSON_DATA_NULL = 10;
/** RegExp BSON Type @internal */
var BSON_DATA_REGEXP = 11;
/** Code BSON Type @internal */
var BSON_DATA_DBPOINTER = 12;
/** Code BSON Type @internal */
var BSON_DATA_CODE = 13;
/** Symbol BSON Type @internal */
var BSON_DATA_SYMBOL = 14;
/** Code with Scope BSON Type @internal */
var BSON_DATA_CODE_W_SCOPE = 15;
/** 32 bit Integer BSON Type @internal */
var BSON_DATA_INT = 16;
/** Timestamp BSON Type @internal */
var BSON_DATA_TIMESTAMP = 17;
/** Long BSON Type @internal */
var BSON_DATA_LONG = 18;
/** Decimal128 BSON Type @internal */
var BSON_DATA_DECIMAL128 = 19;
/** MinKey BSON Type @internal */
var BSON_DATA_MIN_KEY = 0xff;
/** MaxKey BSON Type @internal */
var BSON_DATA_MAX_KEY = 0x7f;
/** Binary Default Type @internal */
var BSON_BINARY_SUBTYPE_DEFAULT = 0;
/** Binary Function Type @internal */
var BSON_BINARY_SUBTYPE_FUNCTION = 1;
/** Binary Byte Array Type @internal */
var BSON_BINARY_SUBTYPE_BYTE_ARRAY = 2;
/** Binary Deprecated UUID Type @deprecated Please use BSON_BINARY_SUBTYPE_UUID_NEW @internal */
var BSON_BINARY_SUBTYPE_UUID = 3;
/** Binary UUID Type @internal */
var BSON_BINARY_SUBTYPE_UUID_NEW = 4;
/** Binary MD5 Type @internal */
var BSON_BINARY_SUBTYPE_MD5 = 5;
/** Encrypted BSON type @internal */
var BSON_BINARY_SUBTYPE_ENCRYPTED = 6;
/** Column BSON type @internal */
var BSON_BINARY_SUBTYPE_COLUMN = 7;
/** Binary User Defined Type @internal */
var BSON_BINARY_SUBTYPE_USER_DEFINED = 128;

function calculateObjectSize$1(object, serializeFunctions, ignoreUndefined) {
    var totalLength = 4 + 1;
    if (Array.isArray(object)) {
        for (var i = 0; i < object.length; i++) {
            totalLength += calculateElement(i.toString(), object[i], serializeFunctions, true, ignoreUndefined);
        }
    }
    else {
        // If we have toBSON defined, override the current object
        if (typeof (object === null || object === void 0 ? void 0 : object.toBSON) === 'function') {
            object = object.toBSON();
        }
        // Calculate size
        for (var key in object) {
            totalLength += calculateElement(key, object[key], serializeFunctions, false, ignoreUndefined);
        }
    }
    return totalLength;
}
/** @internal */
function calculateElement(name, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
value, serializeFunctions, isArray, ignoreUndefined) {
    if (serializeFunctions === void 0) { serializeFunctions = false; }
    if (isArray === void 0) { isArray = false; }
    if (ignoreUndefined === void 0) { ignoreUndefined = false; }
    // If we have toBSON defined, override the current object
    if (typeof (value === null || value === void 0 ? void 0 : value.toBSON) === 'function') {
        value = value.toBSON();
    }
    switch (typeof value) {
        case 'string':
            return 1 + Buffer.byteLength(name, 'utf8') + 1 + 4 + Buffer.byteLength(value, 'utf8') + 1;
        case 'number':
            if (Math.floor(value) === value &&
                value >= JS_INT_MIN &&
                value <= JS_INT_MAX) {
                if (value >= BSON_INT32_MIN && value <= BSON_INT32_MAX) {
                    // 32 bit
                    return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (4 + 1);
                }
                else {
                    return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
                }
            }
            else {
                // 64 bit
                return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
            }
        case 'undefined':
            if (isArray || !ignoreUndefined)
                return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + 1;
            return 0;
        case 'boolean':
            return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (1 + 1);
        case 'object':
            if (value == null || value['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
                return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + 1;
            }
            else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
                return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (12 + 1);
            }
            else if (value instanceof Date || isDate(value)) {
                return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
            }
            else if (ArrayBuffer.isView(value) ||
                value instanceof ArrayBuffer ||
                isAnyArrayBuffer(value)) {
                return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (1 + 4 + 1) + value.byteLength);
            }
            else if (value['_bsontype'] === 'Long' ||
                value['_bsontype'] === 'Double' ||
                value['_bsontype'] === 'Timestamp') {
                return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
            }
            else if (value['_bsontype'] === 'Decimal128') {
                return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (16 + 1);
            }
            else if (value['_bsontype'] === 'Code') {
                // Calculate size depending on the availability of a scope
                if (value.scope != null && Object.keys(value.scope).length > 0) {
                    return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        1 +
                        4 +
                        4 +
                        Buffer.byteLength(value.code.toString(), 'utf8') +
                        1 +
                        calculateObjectSize$1(value.scope, serializeFunctions, ignoreUndefined));
                }
                else {
                    return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        1 +
                        4 +
                        Buffer.byteLength(value.code.toString(), 'utf8') +
                        1);
                }
            }
            else if (value['_bsontype'] === 'Binary') {
                // Check what kind of subtype we have
                if (value.sub_type === Binary.SUBTYPE_BYTE_ARRAY) {
                    return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        (value.position + 1 + 4 + 1 + 4));
                }
                else {
                    return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (value.position + 1 + 4 + 1));
                }
            }
            else if (value['_bsontype'] === 'Symbol') {
                return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    Buffer.byteLength(value.value, 'utf8') +
                    4 +
                    1 +
                    1);
            }
            else if (value['_bsontype'] === 'DBRef') {
                // Set up correct object for serialization
                var ordered_values = Object.assign({
                    $ref: value.collection,
                    $id: value.oid
                }, value.fields);
                // Add db reference if it exists
                if (value.db != null) {
                    ordered_values['$db'] = value.db;
                }
                return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    1 +
                    calculateObjectSize$1(ordered_values, serializeFunctions, ignoreUndefined));
            }
            else if (value instanceof RegExp || isRegExp(value)) {
                return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    1 +
                    Buffer.byteLength(value.source, 'utf8') +
                    1 +
                    (value.global ? 1 : 0) +
                    (value.ignoreCase ? 1 : 0) +
                    (value.multiline ? 1 : 0) +
                    1);
            }
            else if (value['_bsontype'] === 'BSONRegExp') {
                return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    1 +
                    Buffer.byteLength(value.pattern, 'utf8') +
                    1 +
                    Buffer.byteLength(value.options, 'utf8') +
                    1);
            }
            else {
                return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    calculateObjectSize$1(value, serializeFunctions, ignoreUndefined) +
                    1);
            }
        case 'function':
            // WTF for 0.4.X where typeof /someregexp/ === 'function'
            if (value instanceof RegExp || isRegExp(value) || String.call(value) === '[object RegExp]') {
                return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    1 +
                    Buffer.byteLength(value.source, 'utf8') +
                    1 +
                    (value.global ? 1 : 0) +
                    (value.ignoreCase ? 1 : 0) +
                    (value.multiline ? 1 : 0) +
                    1);
            }
            else {
                if (serializeFunctions && value.scope != null && Object.keys(value.scope).length > 0) {
                    return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        1 +
                        4 +
                        4 +
                        Buffer.byteLength(normalizedFunctionString(value), 'utf8') +
                        1 +
                        calculateObjectSize$1(value.scope, serializeFunctions, ignoreUndefined));
                }
                else if (serializeFunctions) {
                    return ((name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        1 +
                        4 +
                        Buffer.byteLength(normalizedFunctionString(value), 'utf8') +
                        1);
                }
            }
    }
    return 0;
}

var FIRST_BIT = 0x80;
var FIRST_TWO_BITS = 0xc0;
var FIRST_THREE_BITS = 0xe0;
var FIRST_FOUR_BITS = 0xf0;
var FIRST_FIVE_BITS = 0xf8;
var TWO_BIT_CHAR = 0xc0;
var THREE_BIT_CHAR = 0xe0;
var FOUR_BIT_CHAR = 0xf0;
var CONTINUING_CHAR = 0x80;
/**
 * Determines if the passed in bytes are valid utf8
 * @param bytes - An array of 8-bit bytes. Must be indexable and have length property
 * @param start - The index to start validating
 * @param end - The index to end validating
 */
function validateUtf8(bytes, start, end) {
    var continuation = 0;
    for (var i = start; i < end; i += 1) {
        var byte = bytes[i];
        if (continuation) {
            if ((byte & FIRST_TWO_BITS) !== CONTINUING_CHAR) {
                return false;
            }
            continuation -= 1;
        }
        else if (byte & FIRST_BIT) {
            if ((byte & FIRST_THREE_BITS) === TWO_BIT_CHAR) {
                continuation = 1;
            }
            else if ((byte & FIRST_FOUR_BITS) === THREE_BIT_CHAR) {
                continuation = 2;
            }
            else if ((byte & FIRST_FIVE_BITS) === FOUR_BIT_CHAR) {
                continuation = 3;
            }
            else {
                return false;
            }
        }
    }
    return !continuation;
}

// Internal long versions
var JS_INT_MAX_LONG = Long.fromNumber(JS_INT_MAX);
var JS_INT_MIN_LONG = Long.fromNumber(JS_INT_MIN);
var functionCache = {};
function deserialize$1(buffer, options, isArray) {
    options = options == null ? {} : options;
    var index = options && options.index ? options.index : 0;
    // Read the document size
    var size = buffer[index] |
        (buffer[index + 1] << 8) |
        (buffer[index + 2] << 16) |
        (buffer[index + 3] << 24);
    if (size < 5) {
        throw new BSONError("bson size must be >= 5, is " + size);
    }
    if (options.allowObjectSmallerThanBufferSize && buffer.length < size) {
        throw new BSONError("buffer length " + buffer.length + " must be >= bson size " + size);
    }
    if (!options.allowObjectSmallerThanBufferSize && buffer.length !== size) {
        throw new BSONError("buffer length " + buffer.length + " must === bson size " + size);
    }
    if (size + index > buffer.byteLength) {
        throw new BSONError("(bson size " + size + " + options.index " + index + " must be <= buffer length " + buffer.byteLength + ")");
    }
    // Illegal end value
    if (buffer[index + size - 1] !== 0) {
        throw new BSONError("One object, sized correctly, with a spot for an EOO, but the EOO isn't 0x00");
    }
    // Start deserializtion
    return deserializeObject(buffer, index, options, isArray);
}
var allowedDBRefKeys = /^\$ref$|^\$id$|^\$db$/;
function deserializeObject(buffer, index, options, isArray) {
    if (isArray === void 0) { isArray = false; }
    var evalFunctions = options['evalFunctions'] == null ? false : options['evalFunctions'];
    var cacheFunctions = options['cacheFunctions'] == null ? false : options['cacheFunctions'];
    var fieldsAsRaw = options['fieldsAsRaw'] == null ? null : options['fieldsAsRaw'];
    // Return raw bson buffer instead of parsing it
    var raw = options['raw'] == null ? false : options['raw'];
    // Return BSONRegExp objects instead of native regular expressions
    var bsonRegExp = typeof options['bsonRegExp'] === 'boolean' ? options['bsonRegExp'] : false;
    // Controls the promotion of values vs wrapper classes
    var promoteBuffers = options['promoteBuffers'] == null ? false : options['promoteBuffers'];
    var promoteLongs = options['promoteLongs'] == null ? true : options['promoteLongs'];
    var promoteValues = options['promoteValues'] == null ? true : options['promoteValues'];
    // Ensures default validation option if none given
    var validation = options.validation == null ? { utf8: true } : options.validation;
    // Shows if global utf-8 validation is enabled or disabled
    var globalUTFValidation = true;
    // Reflects utf-8 validation setting regardless of global or specific key validation
    var validationSetting;
    // Set of keys either to enable or disable validation on
    var utf8KeysSet = new Set();
    // Check for boolean uniformity and empty validation option
    var utf8ValidatedKeys = validation.utf8;
    if (typeof utf8ValidatedKeys === 'boolean') {
        validationSetting = utf8ValidatedKeys;
    }
    else {
        globalUTFValidation = false;
        var utf8ValidationValues = Object.keys(utf8ValidatedKeys).map(function (key) {
            return utf8ValidatedKeys[key];
        });
        if (utf8ValidationValues.length === 0) {
            throw new BSONError('UTF-8 validation setting cannot be empty');
        }
        if (typeof utf8ValidationValues[0] !== 'boolean') {
            throw new BSONError('Invalid UTF-8 validation option, must specify boolean values');
        }
        validationSetting = utf8ValidationValues[0];
        // Ensures boolean uniformity in utf-8 validation (all true or all false)
        if (!utf8ValidationValues.every(function (item) { return item === validationSetting; })) {
            throw new BSONError('Invalid UTF-8 validation option - keys must be all true or all false');
        }
    }
    // Add keys to set that will either be validated or not based on validationSetting
    if (!globalUTFValidation) {
        for (var _i = 0, _a = Object.keys(utf8ValidatedKeys); _i < _a.length; _i++) {
            var key = _a[_i];
            utf8KeysSet.add(key);
        }
    }
    // Set the start index
    var startIndex = index;
    // Validate that we have at least 4 bytes of buffer
    if (buffer.length < 5)
        throw new BSONError('corrupt bson message < 5 bytes long');
    // Read the document size
    var size = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
    // Ensure buffer is valid size
    if (size < 5 || size > buffer.length)
        throw new BSONError('corrupt bson message');
    // Create holding object
    var object = isArray ? [] : {};
    // Used for arrays to skip having to perform utf8 decoding
    var arrayIndex = 0;
    var done = false;
    var isPossibleDBRef = isArray ? false : null;
    // While we have more left data left keep parsing
    while (!done) {
        // Read the type
        var elementType = buffer[index++];
        // If we get a zero it's the last byte, exit
        if (elementType === 0)
            break;
        // Get the start search index
        var i = index;
        // Locate the end of the c string
        while (buffer[i] !== 0x00 && i < buffer.length) {
            i++;
        }
        // If are at the end of the buffer there is a problem with the document
        if (i >= buffer.byteLength)
            throw new BSONError('Bad BSON Document: illegal CString');
        // Represents the key
        var name = isArray ? arrayIndex++ : buffer.toString('utf8', index, i);
        // shouldValidateKey is true if the key should be validated, false otherwise
        var shouldValidateKey = true;
        if (globalUTFValidation || utf8KeysSet.has(name)) {
            shouldValidateKey = validationSetting;
        }
        else {
            shouldValidateKey = !validationSetting;
        }
        if (isPossibleDBRef !== false && name[0] === '$') {
            isPossibleDBRef = allowedDBRefKeys.test(name);
        }
        var value = void 0;
        index = i + 1;
        if (elementType === BSON_DATA_STRING) {
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0) {
                throw new BSONError('bad string length in bson');
            }
            value = getValidatedString(buffer, index, index + stringSize - 1, shouldValidateKey);
            index = index + stringSize;
        }
        else if (elementType === BSON_DATA_OID) {
            var oid = Buffer.alloc(12);
            buffer.copy(oid, 0, index, index + 12);
            value = new ObjectId(oid);
            index = index + 12;
        }
        else if (elementType === BSON_DATA_INT && promoteValues === false) {
            value = new Int32(buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24));
        }
        else if (elementType === BSON_DATA_INT) {
            value =
                buffer[index++] |
                    (buffer[index++] << 8) |
                    (buffer[index++] << 16) |
                    (buffer[index++] << 24);
        }
        else if (elementType === BSON_DATA_NUMBER && promoteValues === false) {
            value = new Double(buffer.readDoubleLE(index));
            index = index + 8;
        }
        else if (elementType === BSON_DATA_NUMBER) {
            value = buffer.readDoubleLE(index);
            index = index + 8;
        }
        else if (elementType === BSON_DATA_DATE) {
            var lowBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var highBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            value = new Date(new Long(lowBits, highBits).toNumber());
        }
        else if (elementType === BSON_DATA_BOOLEAN) {
            if (buffer[index] !== 0 && buffer[index] !== 1)
                throw new BSONError('illegal boolean type value');
            value = buffer[index++] === 1;
        }
        else if (elementType === BSON_DATA_OBJECT) {
            var _index = index;
            var objectSize = buffer[index] |
                (buffer[index + 1] << 8) |
                (buffer[index + 2] << 16) |
                (buffer[index + 3] << 24);
            if (objectSize <= 0 || objectSize > buffer.length - index)
                throw new BSONError('bad embedded document length in bson');
            // We have a raw value
            if (raw) {
                value = buffer.slice(index, index + objectSize);
            }
            else {
                var objectOptions = options;
                if (!globalUTFValidation) {
                    objectOptions = _assign(_assign({}, options), { validation: { utf8: shouldValidateKey } });
                }
                value = deserializeObject(buffer, _index, objectOptions, false);
            }
            index = index + objectSize;
        }
        else if (elementType === BSON_DATA_ARRAY) {
            var _index = index;
            var objectSize = buffer[index] |
                (buffer[index + 1] << 8) |
                (buffer[index + 2] << 16) |
                (buffer[index + 3] << 24);
            var arrayOptions = options;
            // Stop index
            var stopIndex = index + objectSize;
            // All elements of array to be returned as raw bson
            if (fieldsAsRaw && fieldsAsRaw[name]) {
                arrayOptions = {};
                for (var n in options) {
                    arrayOptions[n] = options[n];
                }
                arrayOptions['raw'] = true;
            }
            if (!globalUTFValidation) {
                arrayOptions = _assign(_assign({}, arrayOptions), { validation: { utf8: shouldValidateKey } });
            }
            value = deserializeObject(buffer, _index, arrayOptions, true);
            index = index + objectSize;
            if (buffer[index - 1] !== 0)
                throw new BSONError('invalid array terminator byte');
            if (index !== stopIndex)
                throw new BSONError('corrupted array bson');
        }
        else if (elementType === BSON_DATA_UNDEFINED) {
            value = undefined;
        }
        else if (elementType === BSON_DATA_NULL) {
            value = null;
        }
        else if (elementType === BSON_DATA_LONG) {
            // Unpack the low and high bits
            var lowBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var highBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var long = new Long(lowBits, highBits);
            // Promote the long if possible
            if (promoteLongs && promoteValues === true) {
                value =
                    long.lessThanOrEqual(JS_INT_MAX_LONG) && long.greaterThanOrEqual(JS_INT_MIN_LONG)
                        ? long.toNumber()
                        : long;
            }
            else {
                value = long;
            }
        }
        else if (elementType === BSON_DATA_DECIMAL128) {
            // Buffer to contain the decimal bytes
            var bytes = Buffer.alloc(16);
            // Copy the next 16 bytes into the bytes buffer
            buffer.copy(bytes, 0, index, index + 16);
            // Update index
            index = index + 16;
            // Assign the new Decimal128 value
            var decimal128 = new Decimal128(bytes);
            // If we have an alternative mapper use that
            if ('toObject' in decimal128 && typeof decimal128.toObject === 'function') {
                value = decimal128.toObject();
            }
            else {
                value = decimal128;
            }
        }
        else if (elementType === BSON_DATA_BINARY) {
            var binarySize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var totalBinarySize = binarySize;
            var subType = buffer[index++];
            // Did we have a negative binary size, throw
            if (binarySize < 0)
                throw new BSONError('Negative binary type element size found');
            // Is the length longer than the document
            if (binarySize > buffer.byteLength)
                throw new BSONError('Binary type size larger than document size');
            // Decode as raw Buffer object if options specifies it
            if (buffer['slice'] != null) {
                // If we have subtype 2 skip the 4 bytes for the size
                if (subType === Binary.SUBTYPE_BYTE_ARRAY) {
                    binarySize =
                        buffer[index++] |
                            (buffer[index++] << 8) |
                            (buffer[index++] << 16) |
                            (buffer[index++] << 24);
                    if (binarySize < 0)
                        throw new BSONError('Negative binary type element size found for subtype 0x02');
                    if (binarySize > totalBinarySize - 4)
                        throw new BSONError('Binary type with subtype 0x02 contains too long binary size');
                    if (binarySize < totalBinarySize - 4)
                        throw new BSONError('Binary type with subtype 0x02 contains too short binary size');
                }
                if (promoteBuffers && promoteValues) {
                    value = buffer.slice(index, index + binarySize);
                }
                else {
                    value = new Binary(buffer.slice(index, index + binarySize), subType);
                }
            }
            else {
                var _buffer = Buffer.alloc(binarySize);
                // If we have subtype 2 skip the 4 bytes for the size
                if (subType === Binary.SUBTYPE_BYTE_ARRAY) {
                    binarySize =
                        buffer[index++] |
                            (buffer[index++] << 8) |
                            (buffer[index++] << 16) |
                            (buffer[index++] << 24);
                    if (binarySize < 0)
                        throw new BSONError('Negative binary type element size found for subtype 0x02');
                    if (binarySize > totalBinarySize - 4)
                        throw new BSONError('Binary type with subtype 0x02 contains too long binary size');
                    if (binarySize < totalBinarySize - 4)
                        throw new BSONError('Binary type with subtype 0x02 contains too short binary size');
                }
                // Copy the data
                for (i = 0; i < binarySize; i++) {
                    _buffer[i] = buffer[index + i];
                }
                if (promoteBuffers && promoteValues) {
                    value = _buffer;
                }
                else {
                    value = new Binary(_buffer, subType);
                }
            }
            // Update the index
            index = index + binarySize;
        }
        else if (elementType === BSON_DATA_REGEXP && bsonRegExp === false) {
            // Get the start search index
            i = index;
            // Locate the end of the c string
            while (buffer[i] !== 0x00 && i < buffer.length) {
                i++;
            }
            // If are at the end of the buffer there is a problem with the document
            if (i >= buffer.length)
                throw new BSONError('Bad BSON Document: illegal CString');
            // Return the C string
            var source = buffer.toString('utf8', index, i);
            // Create the regexp
            index = i + 1;
            // Get the start search index
            i = index;
            // Locate the end of the c string
            while (buffer[i] !== 0x00 && i < buffer.length) {
                i++;
            }
            // If are at the end of the buffer there is a problem with the document
            if (i >= buffer.length)
                throw new BSONError('Bad BSON Document: illegal CString');
            // Return the C string
            var regExpOptions = buffer.toString('utf8', index, i);
            index = i + 1;
            // For each option add the corresponding one for javascript
            var optionsArray = new Array(regExpOptions.length);
            // Parse options
            for (i = 0; i < regExpOptions.length; i++) {
                switch (regExpOptions[i]) {
                    case 'm':
                        optionsArray[i] = 'm';
                        break;
                    case 's':
                        optionsArray[i] = 'g';
                        break;
                    case 'i':
                        optionsArray[i] = 'i';
                        break;
                }
            }
            value = new RegExp(source, optionsArray.join(''));
        }
        else if (elementType === BSON_DATA_REGEXP && bsonRegExp === true) {
            // Get the start search index
            i = index;
            // Locate the end of the c string
            while (buffer[i] !== 0x00 && i < buffer.length) {
                i++;
            }
            // If are at the end of the buffer there is a problem with the document
            if (i >= buffer.length)
                throw new BSONError('Bad BSON Document: illegal CString');
            // Return the C string
            var source = buffer.toString('utf8', index, i);
            index = i + 1;
            // Get the start search index
            i = index;
            // Locate the end of the c string
            while (buffer[i] !== 0x00 && i < buffer.length) {
                i++;
            }
            // If are at the end of the buffer there is a problem with the document
            if (i >= buffer.length)
                throw new BSONError('Bad BSON Document: illegal CString');
            // Return the C string
            var regExpOptions = buffer.toString('utf8', index, i);
            index = i + 1;
            // Set the object
            value = new BSONRegExp(source, regExpOptions);
        }
        else if (elementType === BSON_DATA_SYMBOL) {
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0) {
                throw new BSONError('bad string length in bson');
            }
            var symbol = getValidatedString(buffer, index, index + stringSize - 1, shouldValidateKey);
            value = promoteValues ? symbol : new BSONSymbol(symbol);
            index = index + stringSize;
        }
        else if (elementType === BSON_DATA_TIMESTAMP) {
            var lowBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var highBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            value = new Timestamp(lowBits, highBits);
        }
        else if (elementType === BSON_DATA_MIN_KEY) {
            value = new MinKey();
        }
        else if (elementType === BSON_DATA_MAX_KEY) {
            value = new MaxKey();
        }
        else if (elementType === BSON_DATA_CODE) {
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0) {
                throw new BSONError('bad string length in bson');
            }
            var functionString = getValidatedString(buffer, index, index + stringSize - 1, shouldValidateKey);
            // If we are evaluating the functions
            if (evalFunctions) {
                // If we have cache enabled let's look for the md5 of the function in the cache
                if (cacheFunctions) {
                    // Got to do this to avoid V8 deoptimizing the call due to finding eval
                    value = isolateEval(functionString, functionCache, object);
                }
                else {
                    value = isolateEval(functionString);
                }
            }
            else {
                value = new Code(functionString);
            }
            // Update parse index position
            index = index + stringSize;
        }
        else if (elementType === BSON_DATA_CODE_W_SCOPE) {
            var totalSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            // Element cannot be shorter than totalSize + stringSize + documentSize + terminator
            if (totalSize < 4 + 4 + 4 + 1) {
                throw new BSONError('code_w_scope total size shorter minimum expected length');
            }
            // Get the code string size
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            // Check if we have a valid string
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0) {
                throw new BSONError('bad string length in bson');
            }
            // Javascript function
            var functionString = getValidatedString(buffer, index, index + stringSize - 1, shouldValidateKey);
            // Update parse index position
            index = index + stringSize;
            // Parse the element
            var _index = index;
            // Decode the size of the object document
            var objectSize = buffer[index] |
                (buffer[index + 1] << 8) |
                (buffer[index + 2] << 16) |
                (buffer[index + 3] << 24);
            // Decode the scope object
            var scopeObject = deserializeObject(buffer, _index, options, false);
            // Adjust the index
            index = index + objectSize;
            // Check if field length is too short
            if (totalSize < 4 + 4 + objectSize + stringSize) {
                throw new BSONError('code_w_scope total size is too short, truncating scope');
            }
            // Check if totalSize field is too long
            if (totalSize > 4 + 4 + objectSize + stringSize) {
                throw new BSONError('code_w_scope total size is too long, clips outer document');
            }
            // If we are evaluating the functions
            if (evalFunctions) {
                // If we have cache enabled let's look for the md5 of the function in the cache
                if (cacheFunctions) {
                    // Got to do this to avoid V8 deoptimizing the call due to finding eval
                    value = isolateEval(functionString, functionCache, object);
                }
                else {
                    value = isolateEval(functionString);
                }
                value.scope = scopeObject;
            }
            else {
                value = new Code(functionString, scopeObject);
            }
        }
        else if (elementType === BSON_DATA_DBPOINTER) {
            // Get the code string size
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            // Check if we have a valid string
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0)
                throw new BSONError('bad string length in bson');
            // Namespace
            if (validation != null && validation.utf8) {
                if (!validateUtf8(buffer, index, index + stringSize - 1)) {
                    throw new BSONError('Invalid UTF-8 string in BSON document');
                }
            }
            var namespace = buffer.toString('utf8', index, index + stringSize - 1);
            // Update parse index position
            index = index + stringSize;
            // Read the oid
            var oidBuffer = Buffer.alloc(12);
            buffer.copy(oidBuffer, 0, index, index + 12);
            var oid = new ObjectId(oidBuffer);
            // Update the index
            index = index + 12;
            // Upgrade to DBRef type
            value = new DBRef(namespace, oid);
        }
        else {
            throw new BSONError('Detected unknown BSON type ' + elementType.toString(16) + ' for fieldname "' + name + '"');
        }
        if (name === '__proto__') {
            Object.defineProperty(object, name, {
                value: value,
                writable: true,
                enumerable: true,
                configurable: true
            });
        }
        else {
            object[name] = value;
        }
    }
    // Check if the deserialization was against a valid array/object
    if (size !== index - startIndex) {
        if (isArray)
            throw new BSONError('corrupt array bson');
        throw new BSONError('corrupt object bson');
    }
    // if we did not find "$ref", "$id", "$db", or found an extraneous $key, don't make a DBRef
    if (!isPossibleDBRef)
        return object;
    if (isDBRefLike(object)) {
        var copy = Object.assign({}, object);
        delete copy.$ref;
        delete copy.$id;
        delete copy.$db;
        return new DBRef(object.$ref, object.$id, object.$db, copy);
    }
    return object;
}
/**
 * Ensure eval is isolated, store the result in functionCache.
 *
 * @internal
 */
function isolateEval(functionString, functionCache, object) {
    if (!functionCache)
        return new Function(functionString);
    // Check for cache hit, eval if missing and return cached function
    if (functionCache[functionString] == null) {
        functionCache[functionString] = new Function(functionString);
    }
    // Set the object
    return functionCache[functionString].bind(object);
}
function getValidatedString(buffer, start, end, shouldValidateUtf8) {
    var value = buffer.toString('utf8', start, end);
    // if utf8 validation is on, do the check
    if (shouldValidateUtf8) {
        for (var i = 0; i < value.length; i++) {
            if (value.charCodeAt(i) === 0xfffd) {
                if (!validateUtf8(buffer, start, end)) {
                    throw new BSONError('Invalid UTF-8 string in BSON document');
                }
                break;
            }
        }
    }
    return value;
}

// Copyright (c) 2008, Fair Oaks Labs, Inc.
function writeIEEE754(buffer, value, offset, endian, mLen, nBytes) {
    var e;
    var m;
    var c;
    var bBE = endian === 'big';
    var eLen = nBytes * 8 - mLen - 1;
    var eMax = (1 << eLen) - 1;
    var eBias = eMax >> 1;
    var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
    var i = bBE ? nBytes - 1 : 0;
    var d = bBE ? -1 : 1;
    var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;
    value = Math.abs(value);
    if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
    }
    else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
            e--;
            c *= 2;
        }
        if (e + eBias >= 1) {
            value += rt / c;
        }
        else {
            value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
            e++;
            c /= 2;
        }
        if (e + eBias >= eMax) {
            m = 0;
            e = eMax;
        }
        else if (e + eBias >= 1) {
            m = (value * c - 1) * Math.pow(2, mLen);
            e = e + eBias;
        }
        else {
            m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
            e = 0;
        }
    }
    if (isNaN(value))
        m = 0;
    while (mLen >= 8) {
        buffer[offset + i] = m & 0xff;
        i += d;
        m /= 256;
        mLen -= 8;
    }
    e = (e << mLen) | m;
    if (isNaN(value))
        e += 8;
    eLen += mLen;
    while (eLen > 0) {
        buffer[offset + i] = e & 0xff;
        i += d;
        e /= 256;
        eLen -= 8;
    }
    buffer[offset + i - d] |= s * 128;
}

var regexp = /\x00/; // eslint-disable-line no-control-regex
var ignoreKeys = new Set(['$db', '$ref', '$id', '$clusterTime']);
/*
 * isArray indicates if we are writing to a BSON array (type 0x04)
 * which forces the "key" which really an array index as a string to be written as ascii
 * This will catch any errors in index as a string generation
 */
function serializeString(buffer, key, value, index, isArray) {
    // Encode String type
    buffer[index++] = BSON_DATA_STRING;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes + 1;
    buffer[index - 1] = 0;
    // Write the string
    var size = buffer.write(value, index + 4, undefined, 'utf8');
    // Write the size of the string to buffer
    buffer[index + 3] = ((size + 1) >> 24) & 0xff;
    buffer[index + 2] = ((size + 1) >> 16) & 0xff;
    buffer[index + 1] = ((size + 1) >> 8) & 0xff;
    buffer[index] = (size + 1) & 0xff;
    // Update index
    index = index + 4 + size;
    // Write zero
    buffer[index++] = 0;
    return index;
}
function serializeNumber(buffer, key, value, index, isArray) {
    // We have an integer value
    // TODO(NODE-2529): Add support for big int
    if (Number.isInteger(value) &&
        value >= BSON_INT32_MIN &&
        value <= BSON_INT32_MAX) {
        // If the value fits in 32 bits encode as int32
        // Set int type 32 bits or less
        buffer[index++] = BSON_DATA_INT;
        // Number of written bytes
        var numberOfWrittenBytes = !isArray
            ? buffer.write(key, index, undefined, 'utf8')
            : buffer.write(key, index, undefined, 'ascii');
        // Encode the name
        index = index + numberOfWrittenBytes;
        buffer[index++] = 0;
        // Write the int value
        buffer[index++] = value & 0xff;
        buffer[index++] = (value >> 8) & 0xff;
        buffer[index++] = (value >> 16) & 0xff;
        buffer[index++] = (value >> 24) & 0xff;
    }
    else {
        // Encode as double
        buffer[index++] = BSON_DATA_NUMBER;
        // Number of written bytes
        var numberOfWrittenBytes = !isArray
            ? buffer.write(key, index, undefined, 'utf8')
            : buffer.write(key, index, undefined, 'ascii');
        // Encode the name
        index = index + numberOfWrittenBytes;
        buffer[index++] = 0;
        // Write float
        writeIEEE754(buffer, value, index, 'little', 52, 8);
        // Adjust index
        index = index + 8;
    }
    return index;
}
function serializeNull(buffer, key, _, index, isArray) {
    // Set long type
    buffer[index++] = BSON_DATA_NULL;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    return index;
}
function serializeBoolean(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_BOOLEAN;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Encode the boolean value
    buffer[index++] = value ? 1 : 0;
    return index;
}
function serializeDate(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_DATE;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write the date
    var dateInMilis = Long.fromNumber(value.getTime());
    var lowBits = dateInMilis.getLowBits();
    var highBits = dateInMilis.getHighBits();
    // Encode low bits
    buffer[index++] = lowBits & 0xff;
    buffer[index++] = (lowBits >> 8) & 0xff;
    buffer[index++] = (lowBits >> 16) & 0xff;
    buffer[index++] = (lowBits >> 24) & 0xff;
    // Encode high bits
    buffer[index++] = highBits & 0xff;
    buffer[index++] = (highBits >> 8) & 0xff;
    buffer[index++] = (highBits >> 16) & 0xff;
    buffer[index++] = (highBits >> 24) & 0xff;
    return index;
}
function serializeRegExp(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_REGEXP;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    if (value.source && value.source.match(regexp) != null) {
        throw Error('value ' + value.source + ' must not contain null bytes');
    }
    // Adjust the index
    index = index + buffer.write(value.source, index, undefined, 'utf8');
    // Write zero
    buffer[index++] = 0x00;
    // Write the parameters
    if (value.ignoreCase)
        buffer[index++] = 0x69; // i
    if (value.global)
        buffer[index++] = 0x73; // s
    if (value.multiline)
        buffer[index++] = 0x6d; // m
    // Add ending zero
    buffer[index++] = 0x00;
    return index;
}
function serializeBSONRegExp(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_REGEXP;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Check the pattern for 0 bytes
    if (value.pattern.match(regexp) != null) {
        // The BSON spec doesn't allow keys with null bytes because keys are
        // null-terminated.
        throw Error('pattern ' + value.pattern + ' must not contain null bytes');
    }
    // Adjust the index
    index = index + buffer.write(value.pattern, index, undefined, 'utf8');
    // Write zero
    buffer[index++] = 0x00;
    // Write the options
    index = index + buffer.write(value.options.split('').sort().join(''), index, undefined, 'utf8');
    // Add ending zero
    buffer[index++] = 0x00;
    return index;
}
function serializeMinMax(buffer, key, value, index, isArray) {
    // Write the type of either min or max key
    if (value === null) {
        buffer[index++] = BSON_DATA_NULL;
    }
    else if (value._bsontype === 'MinKey') {
        buffer[index++] = BSON_DATA_MIN_KEY;
    }
    else {
        buffer[index++] = BSON_DATA_MAX_KEY;
    }
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    return index;
}
function serializeObjectId(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_OID;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write the objectId into the shared buffer
    if (typeof value.id === 'string') {
        buffer.write(value.id, index, undefined, 'binary');
    }
    else if (isUint8Array(value.id)) {
        // Use the standard JS methods here because buffer.copy() is buggy with the
        // browser polyfill
        buffer.set(value.id.subarray(0, 12), index);
    }
    else {
        throw new BSONTypeError('object [' + JSON.stringify(value) + '] is not a valid ObjectId');
    }
    // Adjust index
    return index + 12;
}
function serializeBuffer(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_BINARY;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Get size of the buffer (current write point)
    var size = value.length;
    // Write the size of the string to buffer
    buffer[index++] = size & 0xff;
    buffer[index++] = (size >> 8) & 0xff;
    buffer[index++] = (size >> 16) & 0xff;
    buffer[index++] = (size >> 24) & 0xff;
    // Write the default subtype
    buffer[index++] = BSON_BINARY_SUBTYPE_DEFAULT;
    // Copy the content form the binary field to the buffer
    buffer.set(ensureBuffer(value), index);
    // Adjust the index
    index = index + size;
    return index;
}
function serializeObject(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined, isArray, path) {
    if (checkKeys === void 0) { checkKeys = false; }
    if (depth === void 0) { depth = 0; }
    if (serializeFunctions === void 0) { serializeFunctions = false; }
    if (ignoreUndefined === void 0) { ignoreUndefined = true; }
    if (isArray === void 0) { isArray = false; }
    if (path === void 0) { path = []; }
    for (var i = 0; i < path.length; i++) {
        if (path[i] === value)
            throw new BSONError('cyclic dependency detected');
    }
    // Push value to stack
    path.push(value);
    // Write the type
    buffer[index++] = Array.isArray(value) ? BSON_DATA_ARRAY : BSON_DATA_OBJECT;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    var endIndex = serializeInto(buffer, value, checkKeys, index, depth + 1, serializeFunctions, ignoreUndefined, path);
    // Pop stack
    path.pop();
    return endIndex;
}
function serializeDecimal128(buffer, key, value, index, isArray) {
    buffer[index++] = BSON_DATA_DECIMAL128;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write the data from the value
    // Prefer the standard JS methods because their typechecking is not buggy,
    // unlike the `buffer` polyfill's.
    buffer.set(value.bytes.subarray(0, 16), index);
    return index + 16;
}
function serializeLong(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] =
        value._bsontype === 'Long' ? BSON_DATA_LONG : BSON_DATA_TIMESTAMP;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write the date
    var lowBits = value.getLowBits();
    var highBits = value.getHighBits();
    // Encode low bits
    buffer[index++] = lowBits & 0xff;
    buffer[index++] = (lowBits >> 8) & 0xff;
    buffer[index++] = (lowBits >> 16) & 0xff;
    buffer[index++] = (lowBits >> 24) & 0xff;
    // Encode high bits
    buffer[index++] = highBits & 0xff;
    buffer[index++] = (highBits >> 8) & 0xff;
    buffer[index++] = (highBits >> 16) & 0xff;
    buffer[index++] = (highBits >> 24) & 0xff;
    return index;
}
function serializeInt32(buffer, key, value, index, isArray) {
    value = value.valueOf();
    // Set int type 32 bits or less
    buffer[index++] = BSON_DATA_INT;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write the int value
    buffer[index++] = value & 0xff;
    buffer[index++] = (value >> 8) & 0xff;
    buffer[index++] = (value >> 16) & 0xff;
    buffer[index++] = (value >> 24) & 0xff;
    return index;
}
function serializeDouble(buffer, key, value, index, isArray) {
    // Encode as double
    buffer[index++] = BSON_DATA_NUMBER;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write float
    writeIEEE754(buffer, value.value, index, 'little', 52, 8);
    // Adjust index
    index = index + 8;
    return index;
}
function serializeFunction(buffer, key, value, index, _checkKeys, _depth, isArray) {
    buffer[index++] = BSON_DATA_CODE;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Function string
    var functionString = normalizedFunctionString(value);
    // Write the string
    var size = buffer.write(functionString, index + 4, undefined, 'utf8') + 1;
    // Write the size of the string to buffer
    buffer[index] = size & 0xff;
    buffer[index + 1] = (size >> 8) & 0xff;
    buffer[index + 2] = (size >> 16) & 0xff;
    buffer[index + 3] = (size >> 24) & 0xff;
    // Update index
    index = index + 4 + size - 1;
    // Write zero
    buffer[index++] = 0;
    return index;
}
function serializeCode(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined, isArray) {
    if (checkKeys === void 0) { checkKeys = false; }
    if (depth === void 0) { depth = 0; }
    if (serializeFunctions === void 0) { serializeFunctions = false; }
    if (ignoreUndefined === void 0) { ignoreUndefined = true; }
    if (isArray === void 0) { isArray = false; }
    if (value.scope && typeof value.scope === 'object') {
        // Write the type
        buffer[index++] = BSON_DATA_CODE_W_SCOPE;
        // Number of written bytes
        var numberOfWrittenBytes = !isArray
            ? buffer.write(key, index, undefined, 'utf8')
            : buffer.write(key, index, undefined, 'ascii');
        // Encode the name
        index = index + numberOfWrittenBytes;
        buffer[index++] = 0;
        // Starting index
        var startIndex = index;
        // Serialize the function
        // Get the function string
        var functionString = typeof value.code === 'string' ? value.code : value.code.toString();
        // Index adjustment
        index = index + 4;
        // Write string into buffer
        var codeSize = buffer.write(functionString, index + 4, undefined, 'utf8') + 1;
        // Write the size of the string to buffer
        buffer[index] = codeSize & 0xff;
        buffer[index + 1] = (codeSize >> 8) & 0xff;
        buffer[index + 2] = (codeSize >> 16) & 0xff;
        buffer[index + 3] = (codeSize >> 24) & 0xff;
        // Write end 0
        buffer[index + 4 + codeSize - 1] = 0;
        // Write the
        index = index + codeSize + 4;
        //
        // Serialize the scope value
        var endIndex = serializeInto(buffer, value.scope, checkKeys, index, depth + 1, serializeFunctions, ignoreUndefined);
        index = endIndex - 1;
        // Writ the total
        var totalSize = endIndex - startIndex;
        // Write the total size of the object
        buffer[startIndex++] = totalSize & 0xff;
        buffer[startIndex++] = (totalSize >> 8) & 0xff;
        buffer[startIndex++] = (totalSize >> 16) & 0xff;
        buffer[startIndex++] = (totalSize >> 24) & 0xff;
        // Write trailing zero
        buffer[index++] = 0;
    }
    else {
        buffer[index++] = BSON_DATA_CODE;
        // Number of written bytes
        var numberOfWrittenBytes = !isArray
            ? buffer.write(key, index, undefined, 'utf8')
            : buffer.write(key, index, undefined, 'ascii');
        // Encode the name
        index = index + numberOfWrittenBytes;
        buffer[index++] = 0;
        // Function string
        var functionString = value.code.toString();
        // Write the string
        var size = buffer.write(functionString, index + 4, undefined, 'utf8') + 1;
        // Write the size of the string to buffer
        buffer[index] = size & 0xff;
        buffer[index + 1] = (size >> 8) & 0xff;
        buffer[index + 2] = (size >> 16) & 0xff;
        buffer[index + 3] = (size >> 24) & 0xff;
        // Update index
        index = index + 4 + size - 1;
        // Write zero
        buffer[index++] = 0;
    }
    return index;
}
function serializeBinary(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_BINARY;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Extract the buffer
    var data = value.value(true);
    // Calculate size
    var size = value.position;
    // Add the deprecated 02 type 4 bytes of size to total
    if (value.sub_type === Binary.SUBTYPE_BYTE_ARRAY)
        size = size + 4;
    // Write the size of the string to buffer
    buffer[index++] = size & 0xff;
    buffer[index++] = (size >> 8) & 0xff;
    buffer[index++] = (size >> 16) & 0xff;
    buffer[index++] = (size >> 24) & 0xff;
    // Write the subtype to the buffer
    buffer[index++] = value.sub_type;
    // If we have binary type 2 the 4 first bytes are the size
    if (value.sub_type === Binary.SUBTYPE_BYTE_ARRAY) {
        size = size - 4;
        buffer[index++] = size & 0xff;
        buffer[index++] = (size >> 8) & 0xff;
        buffer[index++] = (size >> 16) & 0xff;
        buffer[index++] = (size >> 24) & 0xff;
    }
    // Write the data to the object
    buffer.set(data, index);
    // Adjust the index
    index = index + value.position;
    return index;
}
function serializeSymbol(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_SYMBOL;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write the string
    var size = buffer.write(value.value, index + 4, undefined, 'utf8') + 1;
    // Write the size of the string to buffer
    buffer[index] = size & 0xff;
    buffer[index + 1] = (size >> 8) & 0xff;
    buffer[index + 2] = (size >> 16) & 0xff;
    buffer[index + 3] = (size >> 24) & 0xff;
    // Update index
    index = index + 4 + size - 1;
    // Write zero
    buffer[index++] = 0x00;
    return index;
}
function serializeDBRef(buffer, key, value, index, depth, serializeFunctions, isArray) {
    // Write the type
    buffer[index++] = BSON_DATA_OBJECT;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    var startIndex = index;
    var output = {
        $ref: value.collection || value.namespace,
        $id: value.oid
    };
    if (value.db != null) {
        output.$db = value.db;
    }
    output = Object.assign(output, value.fields);
    var endIndex = serializeInto(buffer, output, false, index, depth + 1, serializeFunctions);
    // Calculate object size
    var size = endIndex - startIndex;
    // Write the size
    buffer[startIndex++] = size & 0xff;
    buffer[startIndex++] = (size >> 8) & 0xff;
    buffer[startIndex++] = (size >> 16) & 0xff;
    buffer[startIndex++] = (size >> 24) & 0xff;
    // Set index
    return endIndex;
}
function serializeInto(buffer, object, checkKeys, startingIndex, depth, serializeFunctions, ignoreUndefined, path) {
    if (checkKeys === void 0) { checkKeys = false; }
    if (startingIndex === void 0) { startingIndex = 0; }
    if (depth === void 0) { depth = 0; }
    if (serializeFunctions === void 0) { serializeFunctions = false; }
    if (ignoreUndefined === void 0) { ignoreUndefined = true; }
    if (path === void 0) { path = []; }
    startingIndex = startingIndex || 0;
    path = path || [];
    // Push the object to the path
    path.push(object);
    // Start place to serialize into
    var index = startingIndex + 4;
    // Special case isArray
    if (Array.isArray(object)) {
        // Get object keys
        for (var i = 0; i < object.length; i++) {
            var key = '' + i;
            var value = object[i];
            // Is there an override value
            if (typeof (value === null || value === void 0 ? void 0 : value.toBSON) === 'function') {
                value = value.toBSON();
            }
            if (typeof value === 'string') {
                index = serializeString(buffer, key, value, index, true);
            }
            else if (typeof value === 'number') {
                index = serializeNumber(buffer, key, value, index, true);
            }
            else if (typeof value === 'bigint') {
                throw new BSONTypeError('Unsupported type BigInt, please use Decimal128');
            }
            else if (typeof value === 'boolean') {
                index = serializeBoolean(buffer, key, value, index, true);
            }
            else if (value instanceof Date || isDate(value)) {
                index = serializeDate(buffer, key, value, index, true);
            }
            else if (value === undefined) {
                index = serializeNull(buffer, key, value, index, true);
            }
            else if (value === null) {
                index = serializeNull(buffer, key, value, index, true);
            }
            else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
                index = serializeObjectId(buffer, key, value, index, true);
            }
            else if (isUint8Array(value)) {
                index = serializeBuffer(buffer, key, value, index, true);
            }
            else if (value instanceof RegExp || isRegExp(value)) {
                index = serializeRegExp(buffer, key, value, index, true);
            }
            else if (typeof value === 'object' && value['_bsontype'] == null) {
                index = serializeObject(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined, true, path);
            }
            else if (typeof value === 'object' &&
                isBSONType(value) &&
                value._bsontype === 'Decimal128') {
                index = serializeDecimal128(buffer, key, value, index, true);
            }
            else if (value['_bsontype'] === 'Long' || value['_bsontype'] === 'Timestamp') {
                index = serializeLong(buffer, key, value, index, true);
            }
            else if (value['_bsontype'] === 'Double') {
                index = serializeDouble(buffer, key, value, index, true);
            }
            else if (typeof value === 'function' && serializeFunctions) {
                index = serializeFunction(buffer, key, value, index, checkKeys, depth, true);
            }
            else if (value['_bsontype'] === 'Code') {
                index = serializeCode(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined, true);
            }
            else if (value['_bsontype'] === 'Binary') {
                index = serializeBinary(buffer, key, value, index, true);
            }
            else if (value['_bsontype'] === 'Symbol') {
                index = serializeSymbol(buffer, key, value, index, true);
            }
            else if (value['_bsontype'] === 'DBRef') {
                index = serializeDBRef(buffer, key, value, index, depth, serializeFunctions, true);
            }
            else if (value['_bsontype'] === 'BSONRegExp') {
                index = serializeBSONRegExp(buffer, key, value, index, true);
            }
            else if (value['_bsontype'] === 'Int32') {
                index = serializeInt32(buffer, key, value, index, true);
            }
            else if (value['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
                index = serializeMinMax(buffer, key, value, index, true);
            }
            else if (typeof value['_bsontype'] !== 'undefined') {
                throw new BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
            }
        }
    }
    else if (object instanceof bsonMap || isMap(object)) {
        var iterator = object.entries();
        var done = false;
        while (!done) {
            // Unpack the next entry
            var entry = iterator.next();
            done = !!entry.done;
            // Are we done, then skip and terminate
            if (done)
                continue;
            // Get the entry values
            var key = entry.value[0];
            var value = entry.value[1];
            // Check the type of the value
            var type = typeof value;
            // Check the key and throw error if it's illegal
            if (typeof key === 'string' && !ignoreKeys.has(key)) {
                if (key.match(regexp) != null) {
                    // The BSON spec doesn't allow keys with null bytes because keys are
                    // null-terminated.
                    throw Error('key ' + key + ' must not contain null bytes');
                }
                if (checkKeys) {
                    if ('$' === key[0]) {
                        throw Error('key ' + key + " must not start with '$'");
                    }
                    else if (~key.indexOf('.')) {
                        throw Error('key ' + key + " must not contain '.'");
                    }
                }
            }
            if (type === 'string') {
                index = serializeString(buffer, key, value, index);
            }
            else if (type === 'number') {
                index = serializeNumber(buffer, key, value, index);
            }
            else if (type === 'bigint' || isBigInt64Array(value) || isBigUInt64Array(value)) {
                throw new BSONTypeError('Unsupported type BigInt, please use Decimal128');
            }
            else if (type === 'boolean') {
                index = serializeBoolean(buffer, key, value, index);
            }
            else if (value instanceof Date || isDate(value)) {
                index = serializeDate(buffer, key, value, index);
            }
            else if (value === null || (value === undefined && ignoreUndefined === false)) {
                index = serializeNull(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
                index = serializeObjectId(buffer, key, value, index);
            }
            else if (isUint8Array(value)) {
                index = serializeBuffer(buffer, key, value, index);
            }
            else if (value instanceof RegExp || isRegExp(value)) {
                index = serializeRegExp(buffer, key, value, index);
            }
            else if (type === 'object' && value['_bsontype'] == null) {
                index = serializeObject(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined, false, path);
            }
            else if (type === 'object' && value['_bsontype'] === 'Decimal128') {
                index = serializeDecimal128(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Long' || value['_bsontype'] === 'Timestamp') {
                index = serializeLong(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Double') {
                index = serializeDouble(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Code') {
                index = serializeCode(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined);
            }
            else if (typeof value === 'function' && serializeFunctions) {
                index = serializeFunction(buffer, key, value, index, checkKeys, depth, serializeFunctions);
            }
            else if (value['_bsontype'] === 'Binary') {
                index = serializeBinary(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Symbol') {
                index = serializeSymbol(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'DBRef') {
                index = serializeDBRef(buffer, key, value, index, depth, serializeFunctions);
            }
            else if (value['_bsontype'] === 'BSONRegExp') {
                index = serializeBSONRegExp(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Int32') {
                index = serializeInt32(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
                index = serializeMinMax(buffer, key, value, index);
            }
            else if (typeof value['_bsontype'] !== 'undefined') {
                throw new BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
            }
        }
    }
    else {
        if (typeof (object === null || object === void 0 ? void 0 : object.toBSON) === 'function') {
            // Provided a custom serialization method
            object = object.toBSON();
            if (object != null && typeof object !== 'object') {
                throw new BSONTypeError('toBSON function did not return an object');
            }
        }
        // Iterate over all the keys
        for (var key in object) {
            var value = object[key];
            // Is there an override value
            if (typeof (value === null || value === void 0 ? void 0 : value.toBSON) === 'function') {
                value = value.toBSON();
            }
            // Check the type of the value
            var type = typeof value;
            // Check the key and throw error if it's illegal
            if (typeof key === 'string' && !ignoreKeys.has(key)) {
                if (key.match(regexp) != null) {
                    // The BSON spec doesn't allow keys with null bytes because keys are
                    // null-terminated.
                    throw Error('key ' + key + ' must not contain null bytes');
                }
                if (checkKeys) {
                    if ('$' === key[0]) {
                        throw Error('key ' + key + " must not start with '$'");
                    }
                    else if (~key.indexOf('.')) {
                        throw Error('key ' + key + " must not contain '.'");
                    }
                }
            }
            if (type === 'string') {
                index = serializeString(buffer, key, value, index);
            }
            else if (type === 'number') {
                index = serializeNumber(buffer, key, value, index);
            }
            else if (type === 'bigint') {
                throw new BSONTypeError('Unsupported type BigInt, please use Decimal128');
            }
            else if (type === 'boolean') {
                index = serializeBoolean(buffer, key, value, index);
            }
            else if (value instanceof Date || isDate(value)) {
                index = serializeDate(buffer, key, value, index);
            }
            else if (value === undefined) {
                if (ignoreUndefined === false)
                    index = serializeNull(buffer, key, value, index);
            }
            else if (value === null) {
                index = serializeNull(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
                index = serializeObjectId(buffer, key, value, index);
            }
            else if (isUint8Array(value)) {
                index = serializeBuffer(buffer, key, value, index);
            }
            else if (value instanceof RegExp || isRegExp(value)) {
                index = serializeRegExp(buffer, key, value, index);
            }
            else if (type === 'object' && value['_bsontype'] == null) {
                index = serializeObject(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined, false, path);
            }
            else if (type === 'object' && value['_bsontype'] === 'Decimal128') {
                index = serializeDecimal128(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Long' || value['_bsontype'] === 'Timestamp') {
                index = serializeLong(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Double') {
                index = serializeDouble(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Code') {
                index = serializeCode(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined);
            }
            else if (typeof value === 'function' && serializeFunctions) {
                index = serializeFunction(buffer, key, value, index, checkKeys, depth, serializeFunctions);
            }
            else if (value['_bsontype'] === 'Binary') {
                index = serializeBinary(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Symbol') {
                index = serializeSymbol(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'DBRef') {
                index = serializeDBRef(buffer, key, value, index, depth, serializeFunctions);
            }
            else if (value['_bsontype'] === 'BSONRegExp') {
                index = serializeBSONRegExp(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'Int32') {
                index = serializeInt32(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
                index = serializeMinMax(buffer, key, value, index);
            }
            else if (typeof value['_bsontype'] !== 'undefined') {
                throw new BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
            }
        }
    }
    // Remove the path
    path.pop();
    // Final padding byte for object
    buffer[index++] = 0x00;
    // Final size
    var size = index - startingIndex;
    // Write the size of the object
    buffer[startingIndex++] = size & 0xff;
    buffer[startingIndex++] = (size >> 8) & 0xff;
    buffer[startingIndex++] = (size >> 16) & 0xff;
    buffer[startingIndex++] = (size >> 24) & 0xff;
    return index;
}

/** @internal */
// Default Max Size
var MAXSIZE = 1024 * 1024 * 17;
// Current Internal Temporary Serialization Buffer
var buffer = Buffer.alloc(MAXSIZE);
/**
 * Sets the size of the internal serialization buffer.
 *
 * @param size - The desired size for the internal serialization buffer
 * @public
 */
function setInternalBufferSize(size) {
    // Resize the internal serialization buffer if needed
    if (buffer.length < size) {
        buffer = Buffer.alloc(size);
    }
}
/**
 * Serialize a Javascript object.
 *
 * @param object - the Javascript object to serialize.
 * @returns Buffer object containing the serialized object.
 * @public
 */
function serialize(object, options) {
    if (options === void 0) { options = {}; }
    // Unpack the options
    var checkKeys = typeof options.checkKeys === 'boolean' ? options.checkKeys : false;
    var serializeFunctions = typeof options.serializeFunctions === 'boolean' ? options.serializeFunctions : false;
    var ignoreUndefined = typeof options.ignoreUndefined === 'boolean' ? options.ignoreUndefined : true;
    var minInternalBufferSize = typeof options.minInternalBufferSize === 'number' ? options.minInternalBufferSize : MAXSIZE;
    // Resize the internal serialization buffer if needed
    if (buffer.length < minInternalBufferSize) {
        buffer = Buffer.alloc(minInternalBufferSize);
    }
    // Attempt to serialize
    var serializationIndex = serializeInto(buffer, object, checkKeys, 0, 0, serializeFunctions, ignoreUndefined, []);
    // Create the final buffer
    var finishedBuffer = Buffer.alloc(serializationIndex);
    // Copy into the finished buffer
    buffer.copy(finishedBuffer, 0, 0, finishedBuffer.length);
    // Return the buffer
    return finishedBuffer;
}
/**
 * Serialize a Javascript object using a predefined Buffer and index into the buffer,
 * useful when pre-allocating the space for serialization.
 *
 * @param object - the Javascript object to serialize.
 * @param finalBuffer - the Buffer you pre-allocated to store the serialized BSON object.
 * @returns the index pointing to the last written byte in the buffer.
 * @public
 */
function serializeWithBufferAndIndex(object, finalBuffer, options) {
    if (options === void 0) { options = {}; }
    // Unpack the options
    var checkKeys = typeof options.checkKeys === 'boolean' ? options.checkKeys : false;
    var serializeFunctions = typeof options.serializeFunctions === 'boolean' ? options.serializeFunctions : false;
    var ignoreUndefined = typeof options.ignoreUndefined === 'boolean' ? options.ignoreUndefined : true;
    var startIndex = typeof options.index === 'number' ? options.index : 0;
    // Attempt to serialize
    var serializationIndex = serializeInto(buffer, object, checkKeys, 0, 0, serializeFunctions, ignoreUndefined);
    buffer.copy(finalBuffer, startIndex, 0, serializationIndex);
    // Return the index
    return startIndex + serializationIndex - 1;
}
/**
 * Deserialize data as BSON.
 *
 * @param buffer - the buffer containing the serialized set of BSON documents.
 * @returns returns the deserialized Javascript Object.
 * @public
 */
function deserialize(buffer, options) {
    if (options === void 0) { options = {}; }
    return deserialize$1(buffer instanceof Buffer ? buffer : ensureBuffer(buffer), options);
}
/**
 * Calculate the bson size for a passed in Javascript object.
 *
 * @param object - the Javascript object to calculate the BSON byte size for
 * @returns size of BSON object in bytes
 * @public
 */
function calculateObjectSize(object, options) {
    if (options === void 0) { options = {}; }
    options = options || {};
    var serializeFunctions = typeof options.serializeFunctions === 'boolean' ? options.serializeFunctions : false;
    var ignoreUndefined = typeof options.ignoreUndefined === 'boolean' ? options.ignoreUndefined : true;
    return calculateObjectSize$1(object, serializeFunctions, ignoreUndefined);
}
/**
 * Deserialize stream data as BSON documents.
 *
 * @param data - the buffer containing the serialized set of BSON documents.
 * @param startIndex - the start index in the data Buffer where the deserialization is to start.
 * @param numberOfDocuments - number of documents to deserialize.
 * @param documents - an array where to store the deserialized documents.
 * @param docStartIndex - the index in the documents array from where to start inserting documents.
 * @param options - additional options used for the deserialization.
 * @returns next index in the buffer after deserialization **x** numbers of documents.
 * @public
 */
function deserializeStream(data, startIndex, numberOfDocuments, documents, docStartIndex, options) {
    var internalOptions = Object.assign({ allowObjectSmallerThanBufferSize: true, index: 0 }, options);
    var bufferData = ensureBuffer(data);
    var index = startIndex;
    // Loop over all documents
    for (var i = 0; i < numberOfDocuments; i++) {
        // Find size of the document
        var size = bufferData[index] |
            (bufferData[index + 1] << 8) |
            (bufferData[index + 2] << 16) |
            (bufferData[index + 3] << 24);
        // Update options with index
        internalOptions.index = index;
        // Parse the document at this point
        documents[docStartIndex + i] = deserialize$1(bufferData, internalOptions);
        // Adjust index by the document size
        index = index + size;
    }
    // Return object containing end index of parsing and list of documents
    return index;
}
/**
 * BSON default export
 * @deprecated Please use named exports
 * @privateRemarks
 * We want to someday deprecate the default export,
 * so none of the new TS types are being exported on the default
 * @public
 */
var BSON = {
    Binary: Binary,
    Code: Code,
    DBRef: DBRef,
    Decimal128: Decimal128,
    Double: Double,
    Int32: Int32,
    Long: Long,
    UUID: UUID,
    Map: bsonMap,
    MaxKey: MaxKey,
    MinKey: MinKey,
    ObjectId: ObjectId,
    ObjectID: ObjectId,
    BSONRegExp: BSONRegExp,
    BSONSymbol: BSONSymbol,
    Timestamp: Timestamp,
    EJSON: EJSON,
    setInternalBufferSize: setInternalBufferSize,
    serialize: serialize,
    serializeWithBufferAndIndex: serializeWithBufferAndIndex,
    deserialize: deserialize,
    calculateObjectSize: calculateObjectSize,
    deserializeStream: deserializeStream,
    BSONError: BSONError,
    BSONTypeError: BSONTypeError
};

export default BSON;
export { BSONError, BSONRegExp, BSONSymbol, BSONTypeError, BSON_BINARY_SUBTYPE_BYTE_ARRAY, BSON_BINARY_SUBTYPE_COLUMN, BSON_BINARY_SUBTYPE_DEFAULT, BSON_BINARY_SUBTYPE_ENCRYPTED, BSON_BINARY_SUBTYPE_FUNCTION, BSON_BINARY_SUBTYPE_MD5, BSON_BINARY_SUBTYPE_USER_DEFINED, BSON_BINARY_SUBTYPE_UUID, BSON_BINARY_SUBTYPE_UUID_NEW, BSON_DATA_ARRAY, BSON_DATA_BINARY, BSON_DATA_BOOLEAN, BSON_DATA_CODE, BSON_DATA_CODE_W_SCOPE, BSON_DATA_DATE, BSON_DATA_DBPOINTER, BSON_DATA_DECIMAL128, BSON_DATA_INT, BSON_DATA_LONG, BSON_DATA_MAX_KEY, BSON_DATA_MIN_KEY, BSON_DATA_NULL, BSON_DATA_NUMBER, BSON_DATA_OBJECT, BSON_DATA_OID, BSON_DATA_REGEXP, BSON_DATA_STRING, BSON_DATA_SYMBOL, BSON_DATA_TIMESTAMP, BSON_DATA_UNDEFINED, BSON_INT32_MAX, BSON_INT32_MIN, BSON_INT64_MAX, BSON_INT64_MIN, Binary, Code, DBRef, Decimal128, Double, EJSON, Int32, Long, LongWithoutOverridesClass, bsonMap as Map, MaxKey, MinKey, ObjectId as ObjectID, ObjectId, Timestamp, UUID, calculateObjectSize, deserialize, deserializeStream, serialize, serializeWithBufferAndIndex, setInternalBufferSize };
//# sourceMappingURL=bson.esm.js.map
