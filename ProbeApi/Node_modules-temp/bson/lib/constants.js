"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BSON_BINARY_SUBTYPE_USER_DEFINED = exports.BSON_BINARY_SUBTYPE_COLUMN = exports.BSON_BINARY_SUBTYPE_ENCRYPTED = exports.BSON_BINARY_SUBTYPE_MD5 = exports.BSON_BINARY_SUBTYPE_UUID_NEW = exports.BSON_BINARY_SUBTYPE_UUID = exports.BSON_BINARY_SUBTYPE_BYTE_ARRAY = exports.BSON_BINARY_SUBTYPE_FUNCTION = exports.BSON_BINARY_SUBTYPE_DEFAULT = exports.BSON_DATA_MAX_KEY = exports.BSON_DATA_MIN_KEY = exports.BSON_DATA_DECIMAL128 = exports.BSON_DATA_LONG = exports.BSON_DATA_TIMESTAMP = exports.BSON_DATA_INT = exports.BSON_DATA_CODE_W_SCOPE = exports.BSON_DATA_SYMBOL = exports.BSON_DATA_CODE = exports.BSON_DATA_DBPOINTER = exports.BSON_DATA_REGEXP = exports.BSON_DATA_NULL = exports.BSON_DATA_DATE = exports.BSON_DATA_BOOLEAN = exports.BSON_DATA_OID = exports.BSON_DATA_UNDEFINED = exports.BSON_DATA_BINARY = exports.BSON_DATA_ARRAY = exports.BSON_DATA_OBJECT = exports.BSON_DATA_STRING = exports.BSON_DATA_NUMBER = exports.JS_INT_MIN = exports.JS_INT_MAX = exports.BSON_INT64_MIN = exports.BSON_INT64_MAX = exports.BSON_INT32_MIN = exports.BSON_INT32_MAX = void 0;
/** @internal */
exports.BSON_INT32_MAX = 0x7fffffff;
/** @internal */
exports.BSON_INT32_MIN = -0x80000000;
/** @internal */
exports.BSON_INT64_MAX = Math.pow(2, 63) - 1;
/** @internal */
exports.BSON_INT64_MIN = -Math.pow(2, 63);
/**
 * Any integer up to 2^53 can be precisely represented by a double.
 * @internal
 */
exports.JS_INT_MAX = Math.pow(2, 53);
/**
 * Any integer down to -2^53 can be precisely represented by a double.
 * @internal
 */
exports.JS_INT_MIN = -Math.pow(2, 53);
/** Number BSON Type @internal */
exports.BSON_DATA_NUMBER = 1;
/** String BSON Type @internal */
exports.BSON_DATA_STRING = 2;
/** Object BSON Type @internal */
exports.BSON_DATA_OBJECT = 3;
/** Array BSON Type @internal */
exports.BSON_DATA_ARRAY = 4;
/** Binary BSON Type @internal */
exports.BSON_DATA_BINARY = 5;
/** Binary BSON Type @internal */
exports.BSON_DATA_UNDEFINED = 6;
/** ObjectId BSON Type @internal */
exports.BSON_DATA_OID = 7;
/** Boolean BSON Type @internal */
exports.BSON_DATA_BOOLEAN = 8;
/** Date BSON Type @internal */
exports.BSON_DATA_DATE = 9;
/** null BSON Type @internal */
exports.BSON_DATA_NULL = 10;
/** RegExp BSON Type @internal */
exports.BSON_DATA_REGEXP = 11;
/** Code BSON Type @internal */
exports.BSON_DATA_DBPOINTER = 12;
/** Code BSON Type @internal */
exports.BSON_DATA_CODE = 13;
/** Symbol BSON Type @internal */
exports.BSON_DATA_SYMBOL = 14;
/** Code with Scope BSON Type @internal */
exports.BSON_DATA_CODE_W_SCOPE = 15;
/** 32 bit Integer BSON Type @internal */
exports.BSON_DATA_INT = 16;
/** Timestamp BSON Type @internal */
exports.BSON_DATA_TIMESTAMP = 17;
/** Long BSON Type @internal */
exports.BSON_DATA_LONG = 18;
/** Decimal128 BSON Type @internal */
exports.BSON_DATA_DECIMAL128 = 19;
/** MinKey BSON Type @internal */
exports.BSON_DATA_MIN_KEY = 0xff;
/** MaxKey BSON Type @internal */
exports.BSON_DATA_MAX_KEY = 0x7f;
/** Binary Default Type @internal */
exports.BSON_BINARY_SUBTYPE_DEFAULT = 0;
/** Binary Function Type @internal */
exports.BSON_BINARY_SUBTYPE_FUNCTION = 1;
/** Binary Byte Array Type @internal */
exports.BSON_BINARY_SUBTYPE_BYTE_ARRAY = 2;
/** Binary Deprecated UUID Type @deprecated Please use BSON_BINARY_SUBTYPE_UUID_NEW @internal */
exports.BSON_BINARY_SUBTYPE_UUID = 3;
/** Binary UUID Type @internal */
exports.BSON_BINARY_SUBTYPE_UUID_NEW = 4;
/** Binary MD5 Type @internal */
exports.BSON_BINARY_SUBTYPE_MD5 = 5;
/** Encrypted BSON type @internal */
exports.BSON_BINARY_SUBTYPE_ENCRYPTED = 6;
/** Column BSON type @internal */
exports.BSON_BINARY_SUBTYPE_COLUMN = 7;
/** Binary User Defined Type @internal */
exports.BSON_BINARY_SUBTYPE_USER_DEFINED = 128;
//# sourceMappingURL=constants.js.map