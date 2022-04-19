import { Buffer } from 'buffer';
/**
 * A class representation of the BSON Binary type.
 * @public
 */
export declare class Binary {
    _bsontype: 'Binary';
    /* Excluded from this release type: BSON_BINARY_SUBTYPE_DEFAULT */
    /** Initial buffer default size */
    static readonly BUFFER_SIZE = 256;
    /** Default BSON type */
    static readonly SUBTYPE_DEFAULT = 0;
    /** Function BSON type */
    static readonly SUBTYPE_FUNCTION = 1;
    /** Byte Array BSON type */
    static readonly SUBTYPE_BYTE_ARRAY = 2;
    /** Deprecated UUID BSON type @deprecated Please use SUBTYPE_UUID */
    static readonly SUBTYPE_UUID_OLD = 3;
    /** UUID BSON type */
    static readonly SUBTYPE_UUID = 4;
    /** MD5 BSON type */
    static readonly SUBTYPE_MD5 = 5;
    /** Encrypted BSON type */
    static readonly SUBTYPE_ENCRYPTED = 6;
    /** Column BSON type */
    static readonly SUBTYPE_COLUMN = 7;
    /** User BSON type */
    static readonly SUBTYPE_USER_DEFINED = 128;
    buffer: Buffer;
    sub_type: number;
    position: number;
    /**
     * @param buffer - a buffer object containing the binary data.
     * @param subType - the option binary type.
     */
    constructor(buffer?: string | BinarySequence, subType?: number);
    /**
     * Updates this binary with byte_value.
     *
     * @param byteValue - a single byte we wish to write.
     */
    put(byteValue: string | number | Uint8Array | Buffer | number[]): void;
    /**
     * Writes a buffer or string to the binary.
     *
     * @param sequence - a string or buffer to be written to the Binary BSON object.
     * @param offset - specify the binary of where to write the content.
     */
    write(sequence: string | BinarySequence, offset: number): void;
    /**
     * Reads **length** bytes starting at **position**.
     *
     * @param position - read from the given position in the Binary.
     * @param length - the number of bytes to read.
     */
    read(position: number, length: number): BinarySequence;
    /**
     * Returns the value of this binary as a string.
     * @param asRaw - Will skip converting to a string
     * @remarks
     * This is handy when calling this function conditionally for some key value pairs and not others
     */
    value(asRaw?: boolean): string | BinarySequence;
    /** the length of the binary sequence */
    length(): number;
    toJSON(): string;
    toString(format?: string): string;
    /* Excluded from this release type: toExtendedJSON */
    toUUID(): UUID;
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface BinaryExtended {
    $binary: {
        subType: string;
        base64: string;
    };
}
/** @public */
export declare interface BinaryExtendedLegacy {
    $type: string;
    $binary: string;
}
/** @public */
export declare type BinarySequence = Uint8Array | Buffer | number[];
/**
 * BSON default export
 * @deprecated Please use named exports
 * @privateRemarks
 * We want to someday deprecate the default export,
 * so none of the new TS types are being exported on the default
 * @public
 */
declare const BSON: {
    Binary: typeof Binary;
    Code: typeof Code;
    DBRef: typeof DBRef;
    Decimal128: typeof Decimal128;
    Double: typeof Double;
    Int32: typeof Int32;
    Long: typeof Long;
    UUID: typeof UUID;
    Map: MapConstructor;
    MaxKey: typeof MaxKey;
    MinKey: typeof MinKey;
    ObjectId: typeof ObjectId;
    ObjectID: typeof ObjectId;
    BSONRegExp: typeof BSONRegExp;
    BSONSymbol: typeof BSONSymbol;
    Timestamp: typeof Timestamp;
    EJSON: typeof EJSON;
    setInternalBufferSize: typeof setInternalBufferSize;
    serialize: typeof serialize;
    serializeWithBufferAndIndex: typeof serializeWithBufferAndIndex;
    deserialize: typeof deserialize;
    calculateObjectSize: typeof calculateObjectSize;
    deserializeStream: typeof deserializeStream;
    BSONError: typeof BSONError;
    BSONTypeError: typeof BSONTypeError;
};
export default BSON;
/* Excluded from this release type: BSON_BINARY_SUBTYPE_BYTE_ARRAY */
/* Excluded from this release type: BSON_BINARY_SUBTYPE_COLUMN */
/* Excluded from this release type: BSON_BINARY_SUBTYPE_DEFAULT */
/* Excluded from this release type: BSON_BINARY_SUBTYPE_ENCRYPTED */
/* Excluded from this release type: BSON_BINARY_SUBTYPE_FUNCTION */
/* Excluded from this release type: BSON_BINARY_SUBTYPE_MD5 */
/* Excluded from this release type: BSON_BINARY_SUBTYPE_USER_DEFINED */
/* Excluded from this release type: BSON_BINARY_SUBTYPE_UUID */
/* Excluded from this release type: BSON_BINARY_SUBTYPE_UUID_NEW */
/* Excluded from this release type: BSON_DATA_ARRAY */
/* Excluded from this release type: BSON_DATA_BINARY */
/* Excluded from this release type: BSON_DATA_BOOLEAN */
/* Excluded from this release type: BSON_DATA_CODE */
/* Excluded from this release type: BSON_DATA_CODE_W_SCOPE */
/* Excluded from this release type: BSON_DATA_DATE */
/* Excluded from this release type: BSON_DATA_DBPOINTER */
/* Excluded from this release type: BSON_DATA_DECIMAL128 */
/* Excluded from this release type: BSON_DATA_INT */
/* Excluded from this release type: BSON_DATA_LONG */
/* Excluded from this release type: BSON_DATA_MAX_KEY */
/* Excluded from this release type: BSON_DATA_MIN_KEY */
/* Excluded from this release type: BSON_DATA_NULL */
/* Excluded from this release type: BSON_DATA_NUMBER */
/* Excluded from this release type: BSON_DATA_OBJECT */
/* Excluded from this release type: BSON_DATA_OID */
/* Excluded from this release type: BSON_DATA_REGEXP */
/* Excluded from this release type: BSON_DATA_STRING */
/* Excluded from this release type: BSON_DATA_SYMBOL */
/* Excluded from this release type: BSON_DATA_TIMESTAMP */
/* Excluded from this release type: BSON_DATA_UNDEFINED */
/* Excluded from this release type: BSON_INT32_MAX */
/* Excluded from this release type: BSON_INT32_MIN */
/* Excluded from this release type: BSON_INT64_MAX */
/* Excluded from this release type: BSON_INT64_MIN */
/** @public */
export declare class BSONError extends Error {
    constructor(message: string);
    readonly name: string;
}
/**
 * A class representation of the BSON RegExp type.
 * @public
 */
export declare class BSONRegExp {
    _bsontype: 'BSONRegExp';
    pattern: string;
    options: string;
    /**
     * @param pattern - The regular expression pattern to match
     * @param options - The regular expression options
     */
    constructor(pattern: string, options?: string);
    static parseOptions(options?: string): string;
}
/** @public */
export declare interface BSONRegExpExtended {
    $regularExpression: {
        pattern: string;
        options: string;
    };
}
/** @public */
export declare interface BSONRegExpExtendedLegacy {
    $regex: string | BSONRegExp;
    $options: string;
}
/**
 * A class representation of the BSON Symbol type.
 * @public
 */
export declare class BSONSymbol {
    _bsontype: 'Symbol';
    value: string;
    /**
     * @param value - the string representing the symbol.
     */
    constructor(value: string);
    /** Access the wrapped string value. */
    valueOf(): string;
    toString(): string;
    /* Excluded from this release type: inspect */
    toJSON(): string;
}
/** @public */
export declare interface BSONSymbolExtended {
    $symbol: string;
}
/** @public */
export declare class BSONTypeError extends TypeError {
    constructor(message: string);
    readonly name: string;
}
/**
 * Calculate the bson size for a passed in Javascript object.
 *
 * @param object - the Javascript object to calculate the BSON byte size for
 * @returns size of BSON object in bytes
 * @public
 */
export declare function calculateObjectSize(object: Document, options?: CalculateObjectSizeOptions): number;
/** @public */
export declare type CalculateObjectSizeOptions = Pick<SerializeOptions, 'serializeFunctions' | 'ignoreUndefined'>;
/**
 * A class representation of the BSON Code type.
 * @public
 */
export declare class Code {
    _bsontype: 'Code';
    code: string | Function;
    scope?: Document;
    /**
     * @param code - a string or function.
     * @param scope - an optional scope for the function.
     */
    constructor(code: string | Function, scope?: Document);
    toJSON(): {
        code: string | Function;
        scope?: Document;
    };
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface CodeExtended {
    $code: string | Function;
    $scope?: Document;
}
/**
 * A class representation of the BSON DBRef type.
 * @public
 */
export declare class DBRef {
    _bsontype: 'DBRef';
    collection: string;
    oid: ObjectId;
    db?: string;
    fields: Document;
    /**
     * @param collection - the collection name.
     * @param oid - the reference ObjectId.
     * @param db - optional db name, if omitted the reference is local to the current db.
     */
    constructor(collection: string, oid: ObjectId, db?: string, fields?: Document);
    /* Excluded from this release type: namespace */
    /* Excluded from this release type: namespace */
    toJSON(): DBRefLike & Document;
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface DBRefLike {
    $ref: string;
    $id: ObjectId;
    $db?: string;
}
/**
 * A class representation of the BSON Decimal128 type.
 * @public
 */
export declare class Decimal128 {
    _bsontype: 'Decimal128';
    readonly bytes: Buffer;
    /**
     * @param bytes - a buffer containing the raw Decimal128 bytes in little endian order,
     *                or a string representation as returned by .toString()
     */
    constructor(bytes: Buffer | string);
    /**
     * Create a Decimal128 instance from a string representation
     *
     * @param representation - a numeric string representation.
     */
    static fromString(representation: string): Decimal128;
    /** Create a string representation of the raw Decimal128 value */
    toString(): string;
    toJSON(): Decimal128Extended;
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface Decimal128Extended {
    $numberDecimal: string;
}
/**
 * Deserialize data as BSON.
 *
 * @param buffer - the buffer containing the serialized set of BSON documents.
 * @returns returns the deserialized Javascript Object.
 * @public
 */
export declare function deserialize(buffer: Buffer | ArrayBufferView | ArrayBuffer, options?: DeserializeOptions): Document;
/** @public */
export declare interface DeserializeOptions {
    /** evaluate functions in the BSON document scoped to the object deserialized. */
    evalFunctions?: boolean;
    /** cache evaluated functions for reuse. */
    cacheFunctions?: boolean;
    /**
     * use a crc32 code for caching, otherwise use the string of the function.
     * @deprecated this option to use the crc32 function never worked as intended
     * due to the fact that the crc32 function itself was never implemented.
     * */
    cacheFunctionsCrc32?: boolean;
    /** when deserializing a Long will fit it into a Number if it's smaller than 53 bits */
    promoteLongs?: boolean;
    /** when deserializing a Binary will return it as a node.js Buffer instance. */
    promoteBuffers?: boolean;
    /** when deserializing will promote BSON values to their Node.js closest equivalent types. */
    promoteValues?: boolean;
    /** allow to specify if there what fields we wish to return as unserialized raw buffer. */
    fieldsAsRaw?: Document;
    /** return BSON regular expressions as BSONRegExp instances. */
    bsonRegExp?: boolean;
    /** allows the buffer to be larger than the parsed BSON object */
    allowObjectSmallerThanBufferSize?: boolean;
    /** Offset into buffer to begin reading document from */
    index?: number;
    raw?: boolean;
    /** Allows for opt-out utf-8 validation for all keys or
     * specified keys. Must be all true or all false.
     *
     * @example
     * ```js
     * // disables validation on all keys
     *  validation: { utf8: false }
     *
     * // enables validation only on specified keys a, b, and c
     *  validation: { utf8: { a: true, b: true, c: true } }
     *
     *  // disables validation only on specified keys a, b
     *  validation: { utf8: { a: false, b: false } }
     * ```
     */
    validation?: {
        utf8: boolean | Record<string, true> | Record<string, false>;
    };
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
export declare function deserializeStream(data: Buffer | ArrayBufferView | ArrayBuffer, startIndex: number, numberOfDocuments: number, documents: Document[], docStartIndex: number, options: DeserializeOptions): number;
/** @public */
export declare interface Document {
    [key: string]: any;
}
/**
 * A class representation of the BSON Double type.
 * @public
 */
export declare class Double {
    _bsontype: 'Double';
    value: number;
    /**
     * Create a Double type
     *
     * @param value - the number we want to represent as a double.
     */
    constructor(value: number);
    /**
     * Access the number value.
     *
     * @returns returns the wrapped double number.
     */
    valueOf(): number;
    toJSON(): number;
    toString(radix?: number): string;
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface DoubleExtended {
    $numberDouble: string;
}
/**
 * EJSON parse / stringify API
 * @public
 */
export declare namespace EJSON {
    export interface Options {
        /** Output using the Extended JSON v1 spec */
        legacy?: boolean;
        /** Enable Extended JSON's `relaxed` mode, which attempts to return native JS types where possible, rather than BSON types */
        relaxed?: boolean;
        /**
         * Disable Extended JSON's `relaxed` mode, which attempts to return BSON types where possible, rather than native JS types
         * @deprecated Please use the relaxed property instead
         */
        strict?: boolean;
    }
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
    export function parse(text: string, options?: EJSON.Options): SerializableTypes;
    export type JSONPrimitive = string | number | boolean | null;
    export type SerializableTypes = Document | Array<JSONPrimitive | Document> | JSONPrimitive;
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
    export function stringify(value: SerializableTypes, replacer?: (number | string)[] | ((this: any, key: string, value: any) => any) | EJSON.Options, space?: string | number, options?: EJSON.Options): string;
    /**
     * Serializes an object to an Extended JSON string, and reparse it as a JavaScript object.
     *
     * @param value - The object to serialize
     * @param options - Optional settings passed to the `stringify` function
     */
    export function serialize(value: SerializableTypes, options?: EJSON.Options): Document;
    /**
     * Deserializes an Extended JSON object into a plain JavaScript object with native/BSON types
     *
     * @param ejson - The Extended JSON object to deserialize
     * @param options - Optional settings passed to the parse method
     */
    export function deserialize(ejson: Document, options?: EJSON.Options): SerializableTypes;
}
/** @public */
export declare type EJSONOptions = EJSON.Options;
/**
 * A class representation of a BSON Int32 type.
 * @public
 */
export declare class Int32 {
    _bsontype: 'Int32';
    value: number;
    /**
     * Create an Int32 type
     *
     * @param value - the number we want to represent as an int32.
     */
    constructor(value: number | string);
    /**
     * Access the number value.
     *
     * @returns returns the wrapped int32 number.
     */
    valueOf(): number;
    toString(radix?: number): string;
    toJSON(): number;
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface Int32Extended {
    $numberInt: string;
}
declare const kId: unique symbol;
declare const kId_2: unique symbol;
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
export declare class Long {
    _bsontype: 'Long';
    /** An indicator used to reliably determine if an object is a Long or not. */
    __isLong__: true;
    /**
     * The high 32 bits as a signed value.
     */
    high: number;
    /**
     * The low 32 bits as a signed value.
     */
    low: number;
    /**
     * Whether unsigned or not.
     */
    unsigned: boolean;
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
    constructor(low?: number | bigint | string, high?: number | boolean, unsigned?: boolean);
    static TWO_PWR_24: Long;
    /** Maximum unsigned value. */
    static MAX_UNSIGNED_VALUE: Long;
    /** Signed zero */
    static ZERO: Long;
    /** Unsigned zero. */
    static UZERO: Long;
    /** Signed one. */
    static ONE: Long;
    /** Unsigned one. */
    static UONE: Long;
    /** Signed negative one. */
    static NEG_ONE: Long;
    /** Maximum signed value. */
    static MAX_VALUE: Long;
    /** Minimum signed value. */
    static MIN_VALUE: Long;
    /**
     * Returns a Long representing the 64 bit integer that comes by concatenating the given low and high bits.
     * Each is assumed to use 32 bits.
     * @param lowBits - The low 32 bits
     * @param highBits - The high 32 bits
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    static fromBits(lowBits: number, highBits: number, unsigned?: boolean): Long;
    /**
     * Returns a Long representing the given 32 bit integer value.
     * @param value - The 32 bit integer in question
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    static fromInt(value: number, unsigned?: boolean): Long;
    /**
     * Returns a Long representing the given value, provided that it is a finite number. Otherwise, zero is returned.
     * @param value - The number in question
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    static fromNumber(value: number, unsigned?: boolean): Long;
    /**
     * Returns a Long representing the given value, provided that it is a finite number. Otherwise, zero is returned.
     * @param value - The number in question
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    static fromBigInt(value: bigint, unsigned?: boolean): Long;
    /**
     * Returns a Long representation of the given string, written using the specified radix.
     * @param str - The textual representation of the Long
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @param radix - The radix in which the text is written (2-36), defaults to 10
     * @returns The corresponding Long value
     */
    static fromString(str: string, unsigned?: boolean, radix?: number): Long;
    /**
     * Creates a Long from its byte representation.
     * @param bytes - Byte representation
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @param le - Whether little or big endian, defaults to big endian
     * @returns The corresponding Long value
     */
    static fromBytes(bytes: number[], unsigned?: boolean, le?: boolean): Long;
    /**
     * Creates a Long from its little endian byte representation.
     * @param bytes - Little endian byte representation
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    static fromBytesLE(bytes: number[], unsigned?: boolean): Long;
    /**
     * Creates a Long from its big endian byte representation.
     * @param bytes - Big endian byte representation
     * @param unsigned - Whether unsigned or not, defaults to signed
     * @returns The corresponding Long value
     */
    static fromBytesBE(bytes: number[], unsigned?: boolean): Long;
    /**
     * Tests if the specified object is a Long.
     */
    static isLong(value: any): value is Long;
    /**
     * Converts the specified value to a Long.
     * @param unsigned - Whether unsigned or not, defaults to signed
     */
    static fromValue(val: number | string | {
        low: number;
        high: number;
        unsigned?: boolean;
    }, unsigned?: boolean): Long;
    /** Returns the sum of this and the specified Long. */
    add(addend: string | number | Long | Timestamp): Long;
    /**
     * Returns the sum of this and the specified Long.
     * @returns Sum
     */
    and(other: string | number | Long | Timestamp): Long;
    /**
     * Compares this Long's value with the specified's.
     * @returns 0 if they are the same, 1 if the this is greater and -1 if the given one is greater
     */
    compare(other: string | number | Long | Timestamp): 0 | 1 | -1;
    /** This is an alias of {@link Long.compare} */
    comp(other: string | number | Long | Timestamp): 0 | 1 | -1;
    /**
     * Returns this Long divided by the specified. The result is signed if this Long is signed or unsigned if this Long is unsigned.
     * @returns Quotient
     */
    divide(divisor: string | number | Long | Timestamp): Long;
    /**This is an alias of {@link Long.divide} */
    div(divisor: string | number | Long | Timestamp): Long;
    /**
     * Tests if this Long's value equals the specified's.
     * @param other - Other value
     */
    equals(other: string | number | Long | Timestamp): boolean;
    /** This is an alias of {@link Long.equals} */
    eq(other: string | number | Long | Timestamp): boolean;
    /** Gets the high 32 bits as a signed integer. */
    getHighBits(): number;
    /** Gets the high 32 bits as an unsigned integer. */
    getHighBitsUnsigned(): number;
    /** Gets the low 32 bits as a signed integer. */
    getLowBits(): number;
    /** Gets the low 32 bits as an unsigned integer. */
    getLowBitsUnsigned(): number;
    /** Gets the number of bits needed to represent the absolute value of this Long. */
    getNumBitsAbs(): number;
    /** Tests if this Long's value is greater than the specified's. */
    greaterThan(other: string | number | Long | Timestamp): boolean;
    /** This is an alias of {@link Long.greaterThan} */
    gt(other: string | number | Long | Timestamp): boolean;
    /** Tests if this Long's value is greater than or equal the specified's. */
    greaterThanOrEqual(other: string | number | Long | Timestamp): boolean;
    /** This is an alias of {@link Long.greaterThanOrEqual} */
    gte(other: string | number | Long | Timestamp): boolean;
    /** This is an alias of {@link Long.greaterThanOrEqual} */
    ge(other: string | number | Long | Timestamp): boolean;
    /** Tests if this Long's value is even. */
    isEven(): boolean;
    /** Tests if this Long's value is negative. */
    isNegative(): boolean;
    /** Tests if this Long's value is odd. */
    isOdd(): boolean;
    /** Tests if this Long's value is positive. */
    isPositive(): boolean;
    /** Tests if this Long's value equals zero. */
    isZero(): boolean;
    /** Tests if this Long's value is less than the specified's. */
    lessThan(other: string | number | Long | Timestamp): boolean;
    /** This is an alias of {@link Long#lessThan}. */
    lt(other: string | number | Long | Timestamp): boolean;
    /** Tests if this Long's value is less than or equal the specified's. */
    lessThanOrEqual(other: string | number | Long | Timestamp): boolean;
    /** This is an alias of {@link Long.lessThanOrEqual} */
    lte(other: string | number | Long | Timestamp): boolean;
    /** Returns this Long modulo the specified. */
    modulo(divisor: string | number | Long | Timestamp): Long;
    /** This is an alias of {@link Long.modulo} */
    mod(divisor: string | number | Long | Timestamp): Long;
    /** This is an alias of {@link Long.modulo} */
    rem(divisor: string | number | Long | Timestamp): Long;
    /**
     * Returns the product of this and the specified Long.
     * @param multiplier - Multiplier
     * @returns Product
     */
    multiply(multiplier: string | number | Long | Timestamp): Long;
    /** This is an alias of {@link Long.multiply} */
    mul(multiplier: string | number | Long | Timestamp): Long;
    /** Returns the Negation of this Long's value. */
    negate(): Long;
    /** This is an alias of {@link Long.negate} */
    neg(): Long;
    /** Returns the bitwise NOT of this Long. */
    not(): Long;
    /** Tests if this Long's value differs from the specified's. */
    notEquals(other: string | number | Long | Timestamp): boolean;
    /** This is an alias of {@link Long.notEquals} */
    neq(other: string | number | Long | Timestamp): boolean;
    /** This is an alias of {@link Long.notEquals} */
    ne(other: string | number | Long | Timestamp): boolean;
    /**
     * Returns the bitwise OR of this Long and the specified.
     */
    or(other: number | string | Long): Long;
    /**
     * Returns this Long with bits shifted to the left by the given amount.
     * @param numBits - Number of bits
     * @returns Shifted Long
     */
    shiftLeft(numBits: number | Long): Long;
    /** This is an alias of {@link Long.shiftLeft} */
    shl(numBits: number | Long): Long;
    /**
     * Returns this Long with bits arithmetically shifted to the right by the given amount.
     * @param numBits - Number of bits
     * @returns Shifted Long
     */
    shiftRight(numBits: number | Long): Long;
    /** This is an alias of {@link Long.shiftRight} */
    shr(numBits: number | Long): Long;
    /**
     * Returns this Long with bits logically shifted to the right by the given amount.
     * @param numBits - Number of bits
     * @returns Shifted Long
     */
    shiftRightUnsigned(numBits: Long | number): Long;
    /** This is an alias of {@link Long.shiftRightUnsigned} */
    shr_u(numBits: number | Long): Long;
    /** This is an alias of {@link Long.shiftRightUnsigned} */
    shru(numBits: number | Long): Long;
    /**
     * Returns the difference of this and the specified Long.
     * @param subtrahend - Subtrahend
     * @returns Difference
     */
    subtract(subtrahend: string | number | Long | Timestamp): Long;
    /** This is an alias of {@link Long.subtract} */
    sub(subtrahend: string | number | Long | Timestamp): Long;
    /** Converts the Long to a 32 bit integer, assuming it is a 32 bit integer. */
    toInt(): number;
    /** Converts the Long to a the nearest floating-point representation of this value (double, 53 bit mantissa). */
    toNumber(): number;
    /** Converts the Long to a BigInt (arbitrary precision). */
    toBigInt(): bigint;
    /**
     * Converts this Long to its byte representation.
     * @param le - Whether little or big endian, defaults to big endian
     * @returns Byte representation
     */
    toBytes(le?: boolean): number[];
    /**
     * Converts this Long to its little endian byte representation.
     * @returns Little endian byte representation
     */
    toBytesLE(): number[];
    /**
     * Converts this Long to its big endian byte representation.
     * @returns Big endian byte representation
     */
    toBytesBE(): number[];
    /**
     * Converts this Long to signed.
     */
    toSigned(): Long;
    /**
     * Converts the Long to a string written in the specified radix.
     * @param radix - Radix (2-36), defaults to 10
     * @throws RangeError If `radix` is out of range
     */
    toString(radix?: number): string;
    /** Converts this Long to unsigned. */
    toUnsigned(): Long;
    /** Returns the bitwise XOR of this Long and the given one. */
    xor(other: Long | number | string): Long;
    /** This is an alias of {@link Long.isZero} */
    eqz(): boolean;
    /** This is an alias of {@link Long.lessThanOrEqual} */
    le(other: string | number | Long | Timestamp): boolean;
    toExtendedJSON(options?: EJSONOptions): number | LongExtended;
    static fromExtendedJSON(doc: {
        $numberLong: string;
    }, options?: EJSONOptions): number | Long;
    inspect(): string;
}
/** @public */
export declare interface LongExtended {
    $numberLong: string;
}
/** @public */
export declare type LongWithoutOverrides = new (low: unknown, high?: number, unsigned?: boolean) => {
    [P in Exclude<keyof Long, TimestampOverrides>]: Long[P];
};
/** @public */
export declare const LongWithoutOverridesClass: LongWithoutOverrides;
/** @public */
declare let Map_2: MapConstructor;
export { Map_2 as Map };
/**
 * A class representation of the BSON MaxKey type.
 * @public
 */
export declare class MaxKey {
    _bsontype: 'MaxKey';
    constructor();
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface MaxKeyExtended {
    $maxKey: 1;
}
/**
 * A class representation of the BSON MinKey type.
 * @public
 */
export declare class MinKey {
    _bsontype: 'MinKey';
    constructor();
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface MinKeyExtended {
    $minKey: 1;
}
/**
 * A class representation of the BSON ObjectId type.
 * @public
 */
declare class ObjectId {
    _bsontype: 'ObjectId';
    /* Excluded from this release type: index */
    static cacheHexString: boolean;
    /* Excluded from this release type: [kId] */
    /* Excluded from this release type: __id */
    /**
     * Create an ObjectId type
     *
     * @param inputId - Can be a 24 character hex string, 12 byte binary Buffer, or a number.
     */
    constructor(inputId?: string | number | ObjectId | ObjectIdLike | Buffer | Uint8Array);
    /*
    * The ObjectId bytes
    * @readonly
    */
    id: Buffer;
    /*
    * The generation time of this ObjectId instance
    * @deprecated Please use getTimestamp / createFromTime which returns an int32 epoch
    */
    generationTime: number;
    /** Returns the ObjectId id as a 24 character hex string representation */
    toHexString(): string;
    /* Excluded from this release type: getInc */
    /**
     * Generate a 12 byte id buffer used in ObjectId's
     *
     * @param time - pass in a second based timestamp.
     */
    static generate(time?: number): Buffer;
    /**
     * Converts the id into a 24 character hex string for printing
     *
     * @param format - The Buffer toString format parameter.
     */
    toString(format?: string): string;
    /** Converts to its JSON the 24 character hex string representation. */
    toJSON(): string;
    /**
     * Compares the equality of this ObjectId with `otherID`.
     *
     * @param otherId - ObjectId instance to compare against.
     */
    equals(otherId: string | ObjectId | ObjectIdLike): boolean;
    /** Returns the generation date (accurate up to the second) that this ID was generated. */
    getTimestamp(): Date;
    /* Excluded from this release type: createPk */
    /**
     * Creates an ObjectId from a second based number, with the rest of the ObjectId zeroed out. Used for comparisons or sorting the ObjectId.
     *
     * @param time - an integer number representing a number of seconds.
     */
    static createFromTime(time: number): ObjectId;
    /**
     * Creates an ObjectId from a hex string representation of an ObjectId.
     *
     * @param hexString - create a ObjectId from a passed in 24 character hexstring.
     */
    static createFromHexString(hexString: string): ObjectId;
    /**
     * Checks if a value is a valid bson ObjectId
     *
     * @param id - ObjectId instance to validate.
     */
    static isValid(id: string | number | ObjectId | ObjectIdLike | Buffer | Uint8Array): boolean;
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
export { ObjectId as ObjectID };
export { ObjectId };
/** @public */
export declare interface ObjectIdExtended {
    $oid: string;
}
/** @public */
export declare interface ObjectIdLike {
    id: string | Buffer;
    __id?: string;
    toHexString(): string;
}
/**
 * Serialize a Javascript object.
 *
 * @param object - the Javascript object to serialize.
 * @returns Buffer object containing the serialized object.
 * @public
 */
export declare function serialize(object: Document, options?: SerializeOptions): Buffer;
/** @public */
export declare interface SerializeOptions {
    /** the serializer will check if keys are valid. */
    checkKeys?: boolean;
    /** serialize the javascript functions **(default:false)**. */
    serializeFunctions?: boolean;
    /** serialize will not emit undefined fields **(default:true)** */
    ignoreUndefined?: boolean;
    /* Excluded from this release type: minInternalBufferSize */
    /** the index in the buffer where we wish to start serializing into */
    index?: number;
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
export declare function serializeWithBufferAndIndex(object: Document, finalBuffer: Buffer, options?: SerializeOptions): number;
/**
 * Sets the size of the internal serialization buffer.
 *
 * @param size - The desired size for the internal serialization buffer
 * @public
 */
export declare function setInternalBufferSize(size: number): void;
/** @public */
export declare class Timestamp extends LongWithoutOverridesClass {
    _bsontype: 'Timestamp';
    static readonly MAX_VALUE: Long;
    /**
     * @param low - A 64-bit Long representing the Timestamp.
     */
    constructor(long: Long);
    /**
     * @param value - A pair of two values indicating timestamp and increment.
     */
    constructor(value: {
        t: number;
        i: number;
    });
    /**
     * @param low - the low (signed) 32 bits of the Timestamp.
     * @param high - the high (signed) 32 bits of the Timestamp.
     * @deprecated Please use `Timestamp({ t: high, i: low })` or `Timestamp(Long(low, high))` instead.
     */
    constructor(low: number, high: number);
    toJSON(): {
        $timestamp: string;
    };
    /** Returns a Timestamp represented by the given (32-bit) integer value. */
    static fromInt(value: number): Timestamp;
    /** Returns a Timestamp representing the given number value, provided that it is a finite number. Otherwise, zero is returned. */
    static fromNumber(value: number): Timestamp;
    /**
     * Returns a Timestamp for the given high and low bits. Each is assumed to use 32 bits.
     *
     * @param lowBits - the low 32-bits.
     * @param highBits - the high 32-bits.
     */
    static fromBits(lowBits: number, highBits: number): Timestamp;
    /**
     * Returns a Timestamp from the given string, optionally using the given radix.
     *
     * @param str - the textual representation of the Timestamp.
     * @param optRadix - the radix in which the text is written.
     */
    static fromString(str: string, optRadix: number): Timestamp;
    /* Excluded from this release type: toExtendedJSON */
    /* Excluded from this release type: fromExtendedJSON */
    inspect(): string;
}
/** @public */
export declare interface TimestampExtended {
    $timestamp: {
        t: number;
        i: number;
    };
}
/** @public */
export declare type TimestampOverrides = '_bsontype' | 'toExtendedJSON' | 'fromExtendedJSON' | 'inspect';
/**
 * A class representation of the BSON UUID type.
 * @public
 */
export declare class UUID {
    _bsontype: 'UUID';
    static cacheHexString: boolean;
    /* Excluded from this release type: [kId] */
    /* Excluded from this release type: __id */
    /**
     * Create an UUID type
     *
     * @param input - Can be a 32 or 36 character hex string (dashes excluded/included) or a 16 byte binary Buffer.
     */
    constructor(input?: string | Buffer | UUID);
    /*
    * The UUID bytes
    * @readonly
    */
    id: Buffer;
    /**
     * Generate a 16 byte uuid v4 buffer used in UUIDs
     */
    /**
     * Returns the UUID id as a 32 or 36 character hex string representation, excluding/including dashes (defaults to 36 character dash separated)
     * @param includeDashes - should the string exclude dash-separators.
     * */
    toHexString(includeDashes?: boolean): string;
    /**
     * Converts the id into a 36 character (dashes included) hex string, unless a encoding is specified.
     */
    toString(encoding?: string): string;
    /**
     * Converts the id into its JSON string representation.
     * A 36 character (dashes included) hex string in the format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
     */
    toJSON(): string;
    /**
     * Compares the equality of this UUID with `otherID`.
     *
     * @param otherId - UUID instance to compare against.
     */
    equals(otherId: string | Buffer | UUID): boolean;
    /**
     * Creates a Binary instance from the current UUID.
     */
    toBinary(): Binary;
    /**
     * Generates a populated buffer containing a v4 uuid
     */
    static generate(): Buffer;
    /**
     * Checks if a value is a valid bson UUID
     * @param input - UUID, string or Buffer to validate.
     */
    static isValid(input: string | Buffer | UUID): boolean;
    /**
     * Creates an UUID from a hex string representation of an UUID.
     * @param hexString - 32 or 36 character hex string (dashes excluded/included).
     */
    static createFromHexString(hexString: string): UUID;
    inspect(): string;
}
/** @public */
export declare type UUIDExtended = {
    $uuid: string;
};
export {};
