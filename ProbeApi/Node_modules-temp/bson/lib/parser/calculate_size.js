"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateObjectSize = void 0;
var buffer_1 = require("buffer");
var binary_1 = require("../binary");
var constants = require("../constants");
var utils_1 = require("./utils");
function calculateObjectSize(object, serializeFunctions, ignoreUndefined) {
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
exports.calculateObjectSize = calculateObjectSize;
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
            return 1 + buffer_1.Buffer.byteLength(name, 'utf8') + 1 + 4 + buffer_1.Buffer.byteLength(value, 'utf8') + 1;
        case 'number':
            if (Math.floor(value) === value &&
                value >= constants.JS_INT_MIN &&
                value <= constants.JS_INT_MAX) {
                if (value >= constants.BSON_INT32_MIN && value <= constants.BSON_INT32_MAX) {
                    // 32 bit
                    return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (4 + 1);
                }
                else {
                    return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
                }
            }
            else {
                // 64 bit
                return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
            }
        case 'undefined':
            if (isArray || !ignoreUndefined)
                return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + 1;
            return 0;
        case 'boolean':
            return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (1 + 1);
        case 'object':
            if (value == null || value['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
                return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + 1;
            }
            else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
                return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (12 + 1);
            }
            else if (value instanceof Date || utils_1.isDate(value)) {
                return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
            }
            else if (ArrayBuffer.isView(value) ||
                value instanceof ArrayBuffer ||
                utils_1.isAnyArrayBuffer(value)) {
                return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (1 + 4 + 1) + value.byteLength);
            }
            else if (value['_bsontype'] === 'Long' ||
                value['_bsontype'] === 'Double' ||
                value['_bsontype'] === 'Timestamp') {
                return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
            }
            else if (value['_bsontype'] === 'Decimal128') {
                return (name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (16 + 1);
            }
            else if (value['_bsontype'] === 'Code') {
                // Calculate size depending on the availability of a scope
                if (value.scope != null && Object.keys(value.scope).length > 0) {
                    return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        1 +
                        4 +
                        4 +
                        buffer_1.Buffer.byteLength(value.code.toString(), 'utf8') +
                        1 +
                        calculateObjectSize(value.scope, serializeFunctions, ignoreUndefined));
                }
                else {
                    return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        1 +
                        4 +
                        buffer_1.Buffer.byteLength(value.code.toString(), 'utf8') +
                        1);
                }
            }
            else if (value['_bsontype'] === 'Binary') {
                // Check what kind of subtype we have
                if (value.sub_type === binary_1.Binary.SUBTYPE_BYTE_ARRAY) {
                    return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        (value.position + 1 + 4 + 1 + 4));
                }
                else {
                    return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) + (value.position + 1 + 4 + 1));
                }
            }
            else if (value['_bsontype'] === 'Symbol') {
                return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    buffer_1.Buffer.byteLength(value.value, 'utf8') +
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
                return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    1 +
                    calculateObjectSize(ordered_values, serializeFunctions, ignoreUndefined));
            }
            else if (value instanceof RegExp || utils_1.isRegExp(value)) {
                return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    1 +
                    buffer_1.Buffer.byteLength(value.source, 'utf8') +
                    1 +
                    (value.global ? 1 : 0) +
                    (value.ignoreCase ? 1 : 0) +
                    (value.multiline ? 1 : 0) +
                    1);
            }
            else if (value['_bsontype'] === 'BSONRegExp') {
                return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    1 +
                    buffer_1.Buffer.byteLength(value.pattern, 'utf8') +
                    1 +
                    buffer_1.Buffer.byteLength(value.options, 'utf8') +
                    1);
            }
            else {
                return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    calculateObjectSize(value, serializeFunctions, ignoreUndefined) +
                    1);
            }
        case 'function':
            // WTF for 0.4.X where typeof /someregexp/ === 'function'
            if (value instanceof RegExp || utils_1.isRegExp(value) || String.call(value) === '[object RegExp]') {
                return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                    1 +
                    buffer_1.Buffer.byteLength(value.source, 'utf8') +
                    1 +
                    (value.global ? 1 : 0) +
                    (value.ignoreCase ? 1 : 0) +
                    (value.multiline ? 1 : 0) +
                    1);
            }
            else {
                if (serializeFunctions && value.scope != null && Object.keys(value.scope).length > 0) {
                    return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        1 +
                        4 +
                        4 +
                        buffer_1.Buffer.byteLength(utils_1.normalizedFunctionString(value), 'utf8') +
                        1 +
                        calculateObjectSize(value.scope, serializeFunctions, ignoreUndefined));
                }
                else if (serializeFunctions) {
                    return ((name != null ? buffer_1.Buffer.byteLength(name, 'utf8') + 1 : 0) +
                        1 +
                        4 +
                        buffer_1.Buffer.byteLength(utils_1.normalizedFunctionString(value), 'utf8') +
                        1);
                }
            }
    }
    return 0;
}
//# sourceMappingURL=calculate_size.js.map