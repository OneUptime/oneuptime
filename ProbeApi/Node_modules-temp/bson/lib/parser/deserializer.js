"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserialize = void 0;
var buffer_1 = require("buffer");
var binary_1 = require("../binary");
var code_1 = require("../code");
var constants = require("../constants");
var db_ref_1 = require("../db_ref");
var decimal128_1 = require("../decimal128");
var double_1 = require("../double");
var error_1 = require("../error");
var int_32_1 = require("../int_32");
var long_1 = require("../long");
var max_key_1 = require("../max_key");
var min_key_1 = require("../min_key");
var objectid_1 = require("../objectid");
var regexp_1 = require("../regexp");
var symbol_1 = require("../symbol");
var timestamp_1 = require("../timestamp");
var validate_utf8_1 = require("../validate_utf8");
// Internal long versions
var JS_INT_MAX_LONG = long_1.Long.fromNumber(constants.JS_INT_MAX);
var JS_INT_MIN_LONG = long_1.Long.fromNumber(constants.JS_INT_MIN);
var functionCache = {};
function deserialize(buffer, options, isArray) {
    options = options == null ? {} : options;
    var index = options && options.index ? options.index : 0;
    // Read the document size
    var size = buffer[index] |
        (buffer[index + 1] << 8) |
        (buffer[index + 2] << 16) |
        (buffer[index + 3] << 24);
    if (size < 5) {
        throw new error_1.BSONError("bson size must be >= 5, is " + size);
    }
    if (options.allowObjectSmallerThanBufferSize && buffer.length < size) {
        throw new error_1.BSONError("buffer length " + buffer.length + " must be >= bson size " + size);
    }
    if (!options.allowObjectSmallerThanBufferSize && buffer.length !== size) {
        throw new error_1.BSONError("buffer length " + buffer.length + " must === bson size " + size);
    }
    if (size + index > buffer.byteLength) {
        throw new error_1.BSONError("(bson size " + size + " + options.index " + index + " must be <= buffer length " + buffer.byteLength + ")");
    }
    // Illegal end value
    if (buffer[index + size - 1] !== 0) {
        throw new error_1.BSONError("One object, sized correctly, with a spot for an EOO, but the EOO isn't 0x00");
    }
    // Start deserializtion
    return deserializeObject(buffer, index, options, isArray);
}
exports.deserialize = deserialize;
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
            throw new error_1.BSONError('UTF-8 validation setting cannot be empty');
        }
        if (typeof utf8ValidationValues[0] !== 'boolean') {
            throw new error_1.BSONError('Invalid UTF-8 validation option, must specify boolean values');
        }
        validationSetting = utf8ValidationValues[0];
        // Ensures boolean uniformity in utf-8 validation (all true or all false)
        if (!utf8ValidationValues.every(function (item) { return item === validationSetting; })) {
            throw new error_1.BSONError('Invalid UTF-8 validation option - keys must be all true or all false');
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
        throw new error_1.BSONError('corrupt bson message < 5 bytes long');
    // Read the document size
    var size = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
    // Ensure buffer is valid size
    if (size < 5 || size > buffer.length)
        throw new error_1.BSONError('corrupt bson message');
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
            throw new error_1.BSONError('Bad BSON Document: illegal CString');
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
        if (elementType === constants.BSON_DATA_STRING) {
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0) {
                throw new error_1.BSONError('bad string length in bson');
            }
            value = getValidatedString(buffer, index, index + stringSize - 1, shouldValidateKey);
            index = index + stringSize;
        }
        else if (elementType === constants.BSON_DATA_OID) {
            var oid = buffer_1.Buffer.alloc(12);
            buffer.copy(oid, 0, index, index + 12);
            value = new objectid_1.ObjectId(oid);
            index = index + 12;
        }
        else if (elementType === constants.BSON_DATA_INT && promoteValues === false) {
            value = new int_32_1.Int32(buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24));
        }
        else if (elementType === constants.BSON_DATA_INT) {
            value =
                buffer[index++] |
                    (buffer[index++] << 8) |
                    (buffer[index++] << 16) |
                    (buffer[index++] << 24);
        }
        else if (elementType === constants.BSON_DATA_NUMBER && promoteValues === false) {
            value = new double_1.Double(buffer.readDoubleLE(index));
            index = index + 8;
        }
        else if (elementType === constants.BSON_DATA_NUMBER) {
            value = buffer.readDoubleLE(index);
            index = index + 8;
        }
        else if (elementType === constants.BSON_DATA_DATE) {
            var lowBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var highBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            value = new Date(new long_1.Long(lowBits, highBits).toNumber());
        }
        else if (elementType === constants.BSON_DATA_BOOLEAN) {
            if (buffer[index] !== 0 && buffer[index] !== 1)
                throw new error_1.BSONError('illegal boolean type value');
            value = buffer[index++] === 1;
        }
        else if (elementType === constants.BSON_DATA_OBJECT) {
            var _index = index;
            var objectSize = buffer[index] |
                (buffer[index + 1] << 8) |
                (buffer[index + 2] << 16) |
                (buffer[index + 3] << 24);
            if (objectSize <= 0 || objectSize > buffer.length - index)
                throw new error_1.BSONError('bad embedded document length in bson');
            // We have a raw value
            if (raw) {
                value = buffer.slice(index, index + objectSize);
            }
            else {
                var objectOptions = options;
                if (!globalUTFValidation) {
                    objectOptions = __assign(__assign({}, options), { validation: { utf8: shouldValidateKey } });
                }
                value = deserializeObject(buffer, _index, objectOptions, false);
            }
            index = index + objectSize;
        }
        else if (elementType === constants.BSON_DATA_ARRAY) {
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
                arrayOptions = __assign(__assign({}, arrayOptions), { validation: { utf8: shouldValidateKey } });
            }
            value = deserializeObject(buffer, _index, arrayOptions, true);
            index = index + objectSize;
            if (buffer[index - 1] !== 0)
                throw new error_1.BSONError('invalid array terminator byte');
            if (index !== stopIndex)
                throw new error_1.BSONError('corrupted array bson');
        }
        else if (elementType === constants.BSON_DATA_UNDEFINED) {
            value = undefined;
        }
        else if (elementType === constants.BSON_DATA_NULL) {
            value = null;
        }
        else if (elementType === constants.BSON_DATA_LONG) {
            // Unpack the low and high bits
            var lowBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var highBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var long = new long_1.Long(lowBits, highBits);
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
        else if (elementType === constants.BSON_DATA_DECIMAL128) {
            // Buffer to contain the decimal bytes
            var bytes = buffer_1.Buffer.alloc(16);
            // Copy the next 16 bytes into the bytes buffer
            buffer.copy(bytes, 0, index, index + 16);
            // Update index
            index = index + 16;
            // Assign the new Decimal128 value
            var decimal128 = new decimal128_1.Decimal128(bytes);
            // If we have an alternative mapper use that
            if ('toObject' in decimal128 && typeof decimal128.toObject === 'function') {
                value = decimal128.toObject();
            }
            else {
                value = decimal128;
            }
        }
        else if (elementType === constants.BSON_DATA_BINARY) {
            var binarySize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var totalBinarySize = binarySize;
            var subType = buffer[index++];
            // Did we have a negative binary size, throw
            if (binarySize < 0)
                throw new error_1.BSONError('Negative binary type element size found');
            // Is the length longer than the document
            if (binarySize > buffer.byteLength)
                throw new error_1.BSONError('Binary type size larger than document size');
            // Decode as raw Buffer object if options specifies it
            if (buffer['slice'] != null) {
                // If we have subtype 2 skip the 4 bytes for the size
                if (subType === binary_1.Binary.SUBTYPE_BYTE_ARRAY) {
                    binarySize =
                        buffer[index++] |
                            (buffer[index++] << 8) |
                            (buffer[index++] << 16) |
                            (buffer[index++] << 24);
                    if (binarySize < 0)
                        throw new error_1.BSONError('Negative binary type element size found for subtype 0x02');
                    if (binarySize > totalBinarySize - 4)
                        throw new error_1.BSONError('Binary type with subtype 0x02 contains too long binary size');
                    if (binarySize < totalBinarySize - 4)
                        throw new error_1.BSONError('Binary type with subtype 0x02 contains too short binary size');
                }
                if (promoteBuffers && promoteValues) {
                    value = buffer.slice(index, index + binarySize);
                }
                else {
                    value = new binary_1.Binary(buffer.slice(index, index + binarySize), subType);
                }
            }
            else {
                var _buffer = buffer_1.Buffer.alloc(binarySize);
                // If we have subtype 2 skip the 4 bytes for the size
                if (subType === binary_1.Binary.SUBTYPE_BYTE_ARRAY) {
                    binarySize =
                        buffer[index++] |
                            (buffer[index++] << 8) |
                            (buffer[index++] << 16) |
                            (buffer[index++] << 24);
                    if (binarySize < 0)
                        throw new error_1.BSONError('Negative binary type element size found for subtype 0x02');
                    if (binarySize > totalBinarySize - 4)
                        throw new error_1.BSONError('Binary type with subtype 0x02 contains too long binary size');
                    if (binarySize < totalBinarySize - 4)
                        throw new error_1.BSONError('Binary type with subtype 0x02 contains too short binary size');
                }
                // Copy the data
                for (i = 0; i < binarySize; i++) {
                    _buffer[i] = buffer[index + i];
                }
                if (promoteBuffers && promoteValues) {
                    value = _buffer;
                }
                else {
                    value = new binary_1.Binary(_buffer, subType);
                }
            }
            // Update the index
            index = index + binarySize;
        }
        else if (elementType === constants.BSON_DATA_REGEXP && bsonRegExp === false) {
            // Get the start search index
            i = index;
            // Locate the end of the c string
            while (buffer[i] !== 0x00 && i < buffer.length) {
                i++;
            }
            // If are at the end of the buffer there is a problem with the document
            if (i >= buffer.length)
                throw new error_1.BSONError('Bad BSON Document: illegal CString');
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
                throw new error_1.BSONError('Bad BSON Document: illegal CString');
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
        else if (elementType === constants.BSON_DATA_REGEXP && bsonRegExp === true) {
            // Get the start search index
            i = index;
            // Locate the end of the c string
            while (buffer[i] !== 0x00 && i < buffer.length) {
                i++;
            }
            // If are at the end of the buffer there is a problem with the document
            if (i >= buffer.length)
                throw new error_1.BSONError('Bad BSON Document: illegal CString');
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
                throw new error_1.BSONError('Bad BSON Document: illegal CString');
            // Return the C string
            var regExpOptions = buffer.toString('utf8', index, i);
            index = i + 1;
            // Set the object
            value = new regexp_1.BSONRegExp(source, regExpOptions);
        }
        else if (elementType === constants.BSON_DATA_SYMBOL) {
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0) {
                throw new error_1.BSONError('bad string length in bson');
            }
            var symbol = getValidatedString(buffer, index, index + stringSize - 1, shouldValidateKey);
            value = promoteValues ? symbol : new symbol_1.BSONSymbol(symbol);
            index = index + stringSize;
        }
        else if (elementType === constants.BSON_DATA_TIMESTAMP) {
            var lowBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            var highBits = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            value = new timestamp_1.Timestamp(lowBits, highBits);
        }
        else if (elementType === constants.BSON_DATA_MIN_KEY) {
            value = new min_key_1.MinKey();
        }
        else if (elementType === constants.BSON_DATA_MAX_KEY) {
            value = new max_key_1.MaxKey();
        }
        else if (elementType === constants.BSON_DATA_CODE) {
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0) {
                throw new error_1.BSONError('bad string length in bson');
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
                value = new code_1.Code(functionString);
            }
            // Update parse index position
            index = index + stringSize;
        }
        else if (elementType === constants.BSON_DATA_CODE_W_SCOPE) {
            var totalSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            // Element cannot be shorter than totalSize + stringSize + documentSize + terminator
            if (totalSize < 4 + 4 + 4 + 1) {
                throw new error_1.BSONError('code_w_scope total size shorter minimum expected length');
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
                throw new error_1.BSONError('bad string length in bson');
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
                throw new error_1.BSONError('code_w_scope total size is too short, truncating scope');
            }
            // Check if totalSize field is too long
            if (totalSize > 4 + 4 + objectSize + stringSize) {
                throw new error_1.BSONError('code_w_scope total size is too long, clips outer document');
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
                value = new code_1.Code(functionString, scopeObject);
            }
        }
        else if (elementType === constants.BSON_DATA_DBPOINTER) {
            // Get the code string size
            var stringSize = buffer[index++] |
                (buffer[index++] << 8) |
                (buffer[index++] << 16) |
                (buffer[index++] << 24);
            // Check if we have a valid string
            if (stringSize <= 0 ||
                stringSize > buffer.length - index ||
                buffer[index + stringSize - 1] !== 0)
                throw new error_1.BSONError('bad string length in bson');
            // Namespace
            if (validation != null && validation.utf8) {
                if (!validate_utf8_1.validateUtf8(buffer, index, index + stringSize - 1)) {
                    throw new error_1.BSONError('Invalid UTF-8 string in BSON document');
                }
            }
            var namespace = buffer.toString('utf8', index, index + stringSize - 1);
            // Update parse index position
            index = index + stringSize;
            // Read the oid
            var oidBuffer = buffer_1.Buffer.alloc(12);
            buffer.copy(oidBuffer, 0, index, index + 12);
            var oid = new objectid_1.ObjectId(oidBuffer);
            // Update the index
            index = index + 12;
            // Upgrade to DBRef type
            value = new db_ref_1.DBRef(namespace, oid);
        }
        else {
            throw new error_1.BSONError('Detected unknown BSON type ' + elementType.toString(16) + ' for fieldname "' + name + '"');
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
            throw new error_1.BSONError('corrupt array bson');
        throw new error_1.BSONError('corrupt object bson');
    }
    // if we did not find "$ref", "$id", "$db", or found an extraneous $key, don't make a DBRef
    if (!isPossibleDBRef)
        return object;
    if (db_ref_1.isDBRefLike(object)) {
        var copy = Object.assign({}, object);
        delete copy.$ref;
        delete copy.$id;
        delete copy.$db;
        return new db_ref_1.DBRef(object.$ref, object.$id, object.$db, copy);
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
                if (!validate_utf8_1.validateUtf8(buffer, start, end)) {
                    throw new error_1.BSONError('Invalid UTF-8 string in BSON document');
                }
                break;
            }
        }
    }
    return value;
}
//# sourceMappingURL=deserializer.js.map