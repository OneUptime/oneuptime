"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeInto = void 0;
var binary_1 = require("../binary");
var constants = require("../constants");
var ensure_buffer_1 = require("../ensure_buffer");
var error_1 = require("../error");
var extended_json_1 = require("../extended_json");
var float_parser_1 = require("../float_parser");
var long_1 = require("../long");
var map_1 = require("../map");
var utils_1 = require("./utils");
var regexp = /\x00/; // eslint-disable-line no-control-regex
var ignoreKeys = new Set(['$db', '$ref', '$id', '$clusterTime']);
/*
 * isArray indicates if we are writing to a BSON array (type 0x04)
 * which forces the "key" which really an array index as a string to be written as ascii
 * This will catch any errors in index as a string generation
 */
function serializeString(buffer, key, value, index, isArray) {
    // Encode String type
    buffer[index++] = constants.BSON_DATA_STRING;
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
        value >= constants.BSON_INT32_MIN &&
        value <= constants.BSON_INT32_MAX) {
        // If the value fits in 32 bits encode as int32
        // Set int type 32 bits or less
        buffer[index++] = constants.BSON_DATA_INT;
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
        buffer[index++] = constants.BSON_DATA_NUMBER;
        // Number of written bytes
        var numberOfWrittenBytes = !isArray
            ? buffer.write(key, index, undefined, 'utf8')
            : buffer.write(key, index, undefined, 'ascii');
        // Encode the name
        index = index + numberOfWrittenBytes;
        buffer[index++] = 0;
        // Write float
        float_parser_1.writeIEEE754(buffer, value, index, 'little', 52, 8);
        // Adjust index
        index = index + 8;
    }
    return index;
}
function serializeNull(buffer, key, _, index, isArray) {
    // Set long type
    buffer[index++] = constants.BSON_DATA_NULL;
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
    buffer[index++] = constants.BSON_DATA_BOOLEAN;
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
    buffer[index++] = constants.BSON_DATA_DATE;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write the date
    var dateInMilis = long_1.Long.fromNumber(value.getTime());
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
    buffer[index++] = constants.BSON_DATA_REGEXP;
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
    buffer[index++] = constants.BSON_DATA_REGEXP;
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
        buffer[index++] = constants.BSON_DATA_NULL;
    }
    else if (value._bsontype === 'MinKey') {
        buffer[index++] = constants.BSON_DATA_MIN_KEY;
    }
    else {
        buffer[index++] = constants.BSON_DATA_MAX_KEY;
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
    buffer[index++] = constants.BSON_DATA_OID;
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
    else if (utils_1.isUint8Array(value.id)) {
        // Use the standard JS methods here because buffer.copy() is buggy with the
        // browser polyfill
        buffer.set(value.id.subarray(0, 12), index);
    }
    else {
        throw new error_1.BSONTypeError('object [' + JSON.stringify(value) + '] is not a valid ObjectId');
    }
    // Adjust index
    return index + 12;
}
function serializeBuffer(buffer, key, value, index, isArray) {
    // Write the type
    buffer[index++] = constants.BSON_DATA_BINARY;
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
    buffer[index++] = constants.BSON_BINARY_SUBTYPE_DEFAULT;
    // Copy the content form the binary field to the buffer
    buffer.set(ensure_buffer_1.ensureBuffer(value), index);
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
            throw new error_1.BSONError('cyclic dependency detected');
    }
    // Push value to stack
    path.push(value);
    // Write the type
    buffer[index++] = Array.isArray(value) ? constants.BSON_DATA_ARRAY : constants.BSON_DATA_OBJECT;
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
    buffer[index++] = constants.BSON_DATA_DECIMAL128;
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
        value._bsontype === 'Long' ? constants.BSON_DATA_LONG : constants.BSON_DATA_TIMESTAMP;
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
    buffer[index++] = constants.BSON_DATA_INT;
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
    buffer[index++] = constants.BSON_DATA_NUMBER;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write float
    float_parser_1.writeIEEE754(buffer, value.value, index, 'little', 52, 8);
    // Adjust index
    index = index + 8;
    return index;
}
function serializeFunction(buffer, key, value, index, _checkKeys, _depth, isArray) {
    if (_checkKeys === void 0) { _checkKeys = false; }
    if (_depth === void 0) { _depth = 0; }
    buffer[index++] = constants.BSON_DATA_CODE;
    // Number of written bytes
    var numberOfWrittenBytes = !isArray
        ? buffer.write(key, index, undefined, 'utf8')
        : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Function string
    var functionString = utils_1.normalizedFunctionString(value);
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
        buffer[index++] = constants.BSON_DATA_CODE_W_SCOPE;
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
        buffer[index++] = constants.BSON_DATA_CODE;
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
    buffer[index++] = constants.BSON_DATA_BINARY;
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
    if (value.sub_type === binary_1.Binary.SUBTYPE_BYTE_ARRAY)
        size = size + 4;
    // Write the size of the string to buffer
    buffer[index++] = size & 0xff;
    buffer[index++] = (size >> 8) & 0xff;
    buffer[index++] = (size >> 16) & 0xff;
    buffer[index++] = (size >> 24) & 0xff;
    // Write the subtype to the buffer
    buffer[index++] = value.sub_type;
    // If we have binary type 2 the 4 first bytes are the size
    if (value.sub_type === binary_1.Binary.SUBTYPE_BYTE_ARRAY) {
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
    buffer[index++] = constants.BSON_DATA_SYMBOL;
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
    buffer[index++] = constants.BSON_DATA_OBJECT;
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
                throw new error_1.BSONTypeError('Unsupported type BigInt, please use Decimal128');
            }
            else if (typeof value === 'boolean') {
                index = serializeBoolean(buffer, key, value, index, true);
            }
            else if (value instanceof Date || utils_1.isDate(value)) {
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
            else if (utils_1.isUint8Array(value)) {
                index = serializeBuffer(buffer, key, value, index, true);
            }
            else if (value instanceof RegExp || utils_1.isRegExp(value)) {
                index = serializeRegExp(buffer, key, value, index, true);
            }
            else if (typeof value === 'object' && value['_bsontype'] == null) {
                index = serializeObject(buffer, key, value, index, checkKeys, depth, serializeFunctions, ignoreUndefined, true, path);
            }
            else if (typeof value === 'object' &&
                extended_json_1.isBSONType(value) &&
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
                throw new error_1.BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
            }
        }
    }
    else if (object instanceof map_1.Map || utils_1.isMap(object)) {
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
            else if (type === 'bigint' || utils_1.isBigInt64Array(value) || utils_1.isBigUInt64Array(value)) {
                throw new error_1.BSONTypeError('Unsupported type BigInt, please use Decimal128');
            }
            else if (type === 'boolean') {
                index = serializeBoolean(buffer, key, value, index);
            }
            else if (value instanceof Date || utils_1.isDate(value)) {
                index = serializeDate(buffer, key, value, index);
            }
            else if (value === null || (value === undefined && ignoreUndefined === false)) {
                index = serializeNull(buffer, key, value, index);
            }
            else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
                index = serializeObjectId(buffer, key, value, index);
            }
            else if (utils_1.isUint8Array(value)) {
                index = serializeBuffer(buffer, key, value, index);
            }
            else if (value instanceof RegExp || utils_1.isRegExp(value)) {
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
                throw new error_1.BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
            }
        }
    }
    else {
        if (typeof (object === null || object === void 0 ? void 0 : object.toBSON) === 'function') {
            // Provided a custom serialization method
            object = object.toBSON();
            if (object != null && typeof object !== 'object') {
                throw new error_1.BSONTypeError('toBSON function did not return an object');
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
                throw new error_1.BSONTypeError('Unsupported type BigInt, please use Decimal128');
            }
            else if (type === 'boolean') {
                index = serializeBoolean(buffer, key, value, index);
            }
            else if (value instanceof Date || utils_1.isDate(value)) {
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
            else if (utils_1.isUint8Array(value)) {
                index = serializeBuffer(buffer, key, value, index);
            }
            else if (value instanceof RegExp || utils_1.isRegExp(value)) {
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
                throw new error_1.BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
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
exports.serializeInto = serializeInto;
//# sourceMappingURL=serializer.js.map