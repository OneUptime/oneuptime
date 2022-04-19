"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BSONRegExp = exports.MaxKey = exports.MinKey = exports.Int32 = exports.Double = exports.Timestamp = exports.Long = exports.UUID = exports.ObjectId = exports.Binary = exports.DBRef = exports.BSONSymbol = exports.Map = exports.Code = exports.LongWithoutOverridesClass = exports.EJSON = exports.BSON_INT64_MIN = exports.BSON_INT64_MAX = exports.BSON_INT32_MIN = exports.BSON_INT32_MAX = exports.BSON_DATA_UNDEFINED = exports.BSON_DATA_TIMESTAMP = exports.BSON_DATA_SYMBOL = exports.BSON_DATA_STRING = exports.BSON_DATA_REGEXP = exports.BSON_DATA_OID = exports.BSON_DATA_OBJECT = exports.BSON_DATA_NUMBER = exports.BSON_DATA_NULL = exports.BSON_DATA_MIN_KEY = exports.BSON_DATA_MAX_KEY = exports.BSON_DATA_LONG = exports.BSON_DATA_INT = exports.BSON_DATA_DECIMAL128 = exports.BSON_DATA_DBPOINTER = exports.BSON_DATA_DATE = exports.BSON_DATA_CODE_W_SCOPE = exports.BSON_DATA_CODE = exports.BSON_DATA_BOOLEAN = exports.BSON_DATA_BINARY = exports.BSON_DATA_ARRAY = exports.BSON_BINARY_SUBTYPE_COLUMN = exports.BSON_BINARY_SUBTYPE_ENCRYPTED = exports.BSON_BINARY_SUBTYPE_UUID_NEW = exports.BSON_BINARY_SUBTYPE_UUID = exports.BSON_BINARY_SUBTYPE_USER_DEFINED = exports.BSON_BINARY_SUBTYPE_MD5 = exports.BSON_BINARY_SUBTYPE_FUNCTION = exports.BSON_BINARY_SUBTYPE_DEFAULT = exports.BSON_BINARY_SUBTYPE_BYTE_ARRAY = void 0;
exports.deserializeStream = exports.calculateObjectSize = exports.deserialize = exports.serializeWithBufferAndIndex = exports.serialize = exports.setInternalBufferSize = exports.BSONTypeError = exports.BSONError = exports.ObjectID = exports.Decimal128 = void 0;
var buffer_1 = require("buffer");
var binary_1 = require("./binary");
Object.defineProperty(exports, "Binary", { enumerable: true, get: function () { return binary_1.Binary; } });
var code_1 = require("./code");
Object.defineProperty(exports, "Code", { enumerable: true, get: function () { return code_1.Code; } });
var db_ref_1 = require("./db_ref");
Object.defineProperty(exports, "DBRef", { enumerable: true, get: function () { return db_ref_1.DBRef; } });
var decimal128_1 = require("./decimal128");
Object.defineProperty(exports, "Decimal128", { enumerable: true, get: function () { return decimal128_1.Decimal128; } });
var double_1 = require("./double");
Object.defineProperty(exports, "Double", { enumerable: true, get: function () { return double_1.Double; } });
var ensure_buffer_1 = require("./ensure_buffer");
var extended_json_1 = require("./extended_json");
var int_32_1 = require("./int_32");
Object.defineProperty(exports, "Int32", { enumerable: true, get: function () { return int_32_1.Int32; } });
var long_1 = require("./long");
Object.defineProperty(exports, "Long", { enumerable: true, get: function () { return long_1.Long; } });
var map_1 = require("./map");
Object.defineProperty(exports, "Map", { enumerable: true, get: function () { return map_1.Map; } });
var max_key_1 = require("./max_key");
Object.defineProperty(exports, "MaxKey", { enumerable: true, get: function () { return max_key_1.MaxKey; } });
var min_key_1 = require("./min_key");
Object.defineProperty(exports, "MinKey", { enumerable: true, get: function () { return min_key_1.MinKey; } });
var objectid_1 = require("./objectid");
Object.defineProperty(exports, "ObjectId", { enumerable: true, get: function () { return objectid_1.ObjectId; } });
Object.defineProperty(exports, "ObjectID", { enumerable: true, get: function () { return objectid_1.ObjectId; } });
var error_1 = require("./error");
var calculate_size_1 = require("./parser/calculate_size");
// Parts of the parser
var deserializer_1 = require("./parser/deserializer");
var serializer_1 = require("./parser/serializer");
var regexp_1 = require("./regexp");
Object.defineProperty(exports, "BSONRegExp", { enumerable: true, get: function () { return regexp_1.BSONRegExp; } });
var symbol_1 = require("./symbol");
Object.defineProperty(exports, "BSONSymbol", { enumerable: true, get: function () { return symbol_1.BSONSymbol; } });
var timestamp_1 = require("./timestamp");
Object.defineProperty(exports, "Timestamp", { enumerable: true, get: function () { return timestamp_1.Timestamp; } });
var uuid_1 = require("./uuid");
Object.defineProperty(exports, "UUID", { enumerable: true, get: function () { return uuid_1.UUID; } });
var constants_1 = require("./constants");
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_BYTE_ARRAY", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_BYTE_ARRAY; } });
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_DEFAULT", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_DEFAULT; } });
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_FUNCTION", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_FUNCTION; } });
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_MD5", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_MD5; } });
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_USER_DEFINED", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_USER_DEFINED; } });
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_UUID", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_UUID; } });
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_UUID_NEW", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_UUID_NEW; } });
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_ENCRYPTED", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_ENCRYPTED; } });
Object.defineProperty(exports, "BSON_BINARY_SUBTYPE_COLUMN", { enumerable: true, get: function () { return constants_1.BSON_BINARY_SUBTYPE_COLUMN; } });
Object.defineProperty(exports, "BSON_DATA_ARRAY", { enumerable: true, get: function () { return constants_1.BSON_DATA_ARRAY; } });
Object.defineProperty(exports, "BSON_DATA_BINARY", { enumerable: true, get: function () { return constants_1.BSON_DATA_BINARY; } });
Object.defineProperty(exports, "BSON_DATA_BOOLEAN", { enumerable: true, get: function () { return constants_1.BSON_DATA_BOOLEAN; } });
Object.defineProperty(exports, "BSON_DATA_CODE", { enumerable: true, get: function () { return constants_1.BSON_DATA_CODE; } });
Object.defineProperty(exports, "BSON_DATA_CODE_W_SCOPE", { enumerable: true, get: function () { return constants_1.BSON_DATA_CODE_W_SCOPE; } });
Object.defineProperty(exports, "BSON_DATA_DATE", { enumerable: true, get: function () { return constants_1.BSON_DATA_DATE; } });
Object.defineProperty(exports, "BSON_DATA_DBPOINTER", { enumerable: true, get: function () { return constants_1.BSON_DATA_DBPOINTER; } });
Object.defineProperty(exports, "BSON_DATA_DECIMAL128", { enumerable: true, get: function () { return constants_1.BSON_DATA_DECIMAL128; } });
Object.defineProperty(exports, "BSON_DATA_INT", { enumerable: true, get: function () { return constants_1.BSON_DATA_INT; } });
Object.defineProperty(exports, "BSON_DATA_LONG", { enumerable: true, get: function () { return constants_1.BSON_DATA_LONG; } });
Object.defineProperty(exports, "BSON_DATA_MAX_KEY", { enumerable: true, get: function () { return constants_1.BSON_DATA_MAX_KEY; } });
Object.defineProperty(exports, "BSON_DATA_MIN_KEY", { enumerable: true, get: function () { return constants_1.BSON_DATA_MIN_KEY; } });
Object.defineProperty(exports, "BSON_DATA_NULL", { enumerable: true, get: function () { return constants_1.BSON_DATA_NULL; } });
Object.defineProperty(exports, "BSON_DATA_NUMBER", { enumerable: true, get: function () { return constants_1.BSON_DATA_NUMBER; } });
Object.defineProperty(exports, "BSON_DATA_OBJECT", { enumerable: true, get: function () { return constants_1.BSON_DATA_OBJECT; } });
Object.defineProperty(exports, "BSON_DATA_OID", { enumerable: true, get: function () { return constants_1.BSON_DATA_OID; } });
Object.defineProperty(exports, "BSON_DATA_REGEXP", { enumerable: true, get: function () { return constants_1.BSON_DATA_REGEXP; } });
Object.defineProperty(exports, "BSON_DATA_STRING", { enumerable: true, get: function () { return constants_1.BSON_DATA_STRING; } });
Object.defineProperty(exports, "BSON_DATA_SYMBOL", { enumerable: true, get: function () { return constants_1.BSON_DATA_SYMBOL; } });
Object.defineProperty(exports, "BSON_DATA_TIMESTAMP", { enumerable: true, get: function () { return constants_1.BSON_DATA_TIMESTAMP; } });
Object.defineProperty(exports, "BSON_DATA_UNDEFINED", { enumerable: true, get: function () { return constants_1.BSON_DATA_UNDEFINED; } });
Object.defineProperty(exports, "BSON_INT32_MAX", { enumerable: true, get: function () { return constants_1.BSON_INT32_MAX; } });
Object.defineProperty(exports, "BSON_INT32_MIN", { enumerable: true, get: function () { return constants_1.BSON_INT32_MIN; } });
Object.defineProperty(exports, "BSON_INT64_MAX", { enumerable: true, get: function () { return constants_1.BSON_INT64_MAX; } });
Object.defineProperty(exports, "BSON_INT64_MIN", { enumerable: true, get: function () { return constants_1.BSON_INT64_MIN; } });
var extended_json_2 = require("./extended_json");
Object.defineProperty(exports, "EJSON", { enumerable: true, get: function () { return extended_json_2.EJSON; } });
var timestamp_2 = require("./timestamp");
Object.defineProperty(exports, "LongWithoutOverridesClass", { enumerable: true, get: function () { return timestamp_2.LongWithoutOverridesClass; } });
var error_2 = require("./error");
Object.defineProperty(exports, "BSONError", { enumerable: true, get: function () { return error_2.BSONError; } });
Object.defineProperty(exports, "BSONTypeError", { enumerable: true, get: function () { return error_2.BSONTypeError; } });
/** @internal */
// Default Max Size
var MAXSIZE = 1024 * 1024 * 17;
// Current Internal Temporary Serialization Buffer
var buffer = buffer_1.Buffer.alloc(MAXSIZE);
/**
 * Sets the size of the internal serialization buffer.
 *
 * @param size - The desired size for the internal serialization buffer
 * @public
 */
function setInternalBufferSize(size) {
    // Resize the internal serialization buffer if needed
    if (buffer.length < size) {
        buffer = buffer_1.Buffer.alloc(size);
    }
}
exports.setInternalBufferSize = setInternalBufferSize;
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
        buffer = buffer_1.Buffer.alloc(minInternalBufferSize);
    }
    // Attempt to serialize
    var serializationIndex = serializer_1.serializeInto(buffer, object, checkKeys, 0, 0, serializeFunctions, ignoreUndefined, []);
    // Create the final buffer
    var finishedBuffer = buffer_1.Buffer.alloc(serializationIndex);
    // Copy into the finished buffer
    buffer.copy(finishedBuffer, 0, 0, finishedBuffer.length);
    // Return the buffer
    return finishedBuffer;
}
exports.serialize = serialize;
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
    var serializationIndex = serializer_1.serializeInto(buffer, object, checkKeys, 0, 0, serializeFunctions, ignoreUndefined);
    buffer.copy(finalBuffer, startIndex, 0, serializationIndex);
    // Return the index
    return startIndex + serializationIndex - 1;
}
exports.serializeWithBufferAndIndex = serializeWithBufferAndIndex;
/**
 * Deserialize data as BSON.
 *
 * @param buffer - the buffer containing the serialized set of BSON documents.
 * @returns returns the deserialized Javascript Object.
 * @public
 */
function deserialize(buffer, options) {
    if (options === void 0) { options = {}; }
    return deserializer_1.deserialize(buffer instanceof buffer_1.Buffer ? buffer : ensure_buffer_1.ensureBuffer(buffer), options);
}
exports.deserialize = deserialize;
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
    return calculate_size_1.calculateObjectSize(object, serializeFunctions, ignoreUndefined);
}
exports.calculateObjectSize = calculateObjectSize;
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
    var bufferData = ensure_buffer_1.ensureBuffer(data);
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
        documents[docStartIndex + i] = deserializer_1.deserialize(bufferData, internalOptions);
        // Adjust index by the document size
        index = index + size;
    }
    // Return object containing end index of parsing and list of documents
    return index;
}
exports.deserializeStream = deserializeStream;
/**
 * BSON default export
 * @deprecated Please use named exports
 * @privateRemarks
 * We want to someday deprecate the default export,
 * so none of the new TS types are being exported on the default
 * @public
 */
var BSON = {
    Binary: binary_1.Binary,
    Code: code_1.Code,
    DBRef: db_ref_1.DBRef,
    Decimal128: decimal128_1.Decimal128,
    Double: double_1.Double,
    Int32: int_32_1.Int32,
    Long: long_1.Long,
    UUID: uuid_1.UUID,
    Map: map_1.Map,
    MaxKey: max_key_1.MaxKey,
    MinKey: min_key_1.MinKey,
    ObjectId: objectid_1.ObjectId,
    ObjectID: objectid_1.ObjectId,
    BSONRegExp: regexp_1.BSONRegExp,
    BSONSymbol: symbol_1.BSONSymbol,
    Timestamp: timestamp_1.Timestamp,
    EJSON: extended_json_1.EJSON,
    setInternalBufferSize: setInternalBufferSize,
    serialize: serialize,
    serializeWithBufferAndIndex: serializeWithBufferAndIndex,
    deserialize: deserialize,
    calculateObjectSize: calculateObjectSize,
    deserializeStream: deserializeStream,
    BSONError: error_1.BSONError,
    BSONTypeError: error_1.BSONTypeError
};
exports.default = BSON;
//# sourceMappingURL=bson.js.map