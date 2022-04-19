"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EJSON = exports.isBSONType = void 0;
var binary_1 = require("./binary");
var code_1 = require("./code");
var db_ref_1 = require("./db_ref");
var decimal128_1 = require("./decimal128");
var double_1 = require("./double");
var error_1 = require("./error");
var int_32_1 = require("./int_32");
var long_1 = require("./long");
var max_key_1 = require("./max_key");
var min_key_1 = require("./min_key");
var objectid_1 = require("./objectid");
var utils_1 = require("./parser/utils");
var regexp_1 = require("./regexp");
var symbol_1 = require("./symbol");
var timestamp_1 = require("./timestamp");
function isBSONType(value) {
    return (utils_1.isObjectLike(value) && Reflect.has(value, '_bsontype') && typeof value._bsontype === 'string');
}
exports.isBSONType = isBSONType;
// INT32 boundaries
var BSON_INT32_MAX = 0x7fffffff;
var BSON_INT32_MIN = -0x80000000;
// INT64 boundaries
var BSON_INT64_MAX = 0x7fffffffffffffff;
var BSON_INT64_MIN = -0x8000000000000000;
// all the types where we don't need to do any special processing and can just pass the EJSON
//straight to type.fromExtendedJSON
var keysToCodecs = {
    $oid: objectid_1.ObjectId,
    $binary: binary_1.Binary,
    $uuid: binary_1.Binary,
    $symbol: symbol_1.BSONSymbol,
    $numberInt: int_32_1.Int32,
    $numberDecimal: decimal128_1.Decimal128,
    $numberDouble: double_1.Double,
    $numberLong: long_1.Long,
    $minKey: min_key_1.MinKey,
    $maxKey: max_key_1.MaxKey,
    $regex: regexp_1.BSONRegExp,
    $regularExpression: regexp_1.BSONRegExp,
    $timestamp: timestamp_1.Timestamp
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
            if (value >= BSON_INT32_MIN && value <= BSON_INT32_MAX)
                return new int_32_1.Int32(value);
            if (value >= BSON_INT64_MIN && value <= BSON_INT64_MAX)
                return long_1.Long.fromNumber(value);
        }
        // If the number is a non-integer or out of integer range, should interpret as BSON Double.
        return new double_1.Double(value);
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
            else if (long_1.Long.isLong(d))
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
        return code_1.Code.fromExtendedJSON(value);
    }
    if (db_ref_1.isDBRefLike(value) || value.$dbPointer) {
        var v = value.$ref ? value : value.$dbPointer;
        // we run into this in a "degenerate EJSON" case (with $id and $ref order flipped)
        // because of the order JSON.parse goes through the document
        if (v instanceof db_ref_1.DBRef)
            return v;
        var dollarKeys = Object.keys(v).filter(function (k) { return k.startsWith('$'); });
        var valid_1 = true;
        dollarKeys.forEach(function (k) {
            if (['$ref', '$id', '$db'].indexOf(k) === -1)
                valid_1 = false;
        });
        // only make DBRef if $ keys are all valid
        if (valid_1)
            return db_ref_1.DBRef.fromExtendedJSON(v);
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
            throw new error_1.BSONTypeError('Converting circular structure to EJSON:\n' +
                ("    " + leadingPart + alreadySeen + circularPart + current + "\n") +
                ("    " + leadingSpace + "\\" + dashes + "/"));
        }
        options.seenObjects[options.seenObjects.length - 1].obj = value;
    }
    if (Array.isArray(value))
        return serializeArray(value, options);
    if (value === undefined)
        return null;
    if (value instanceof Date || utils_1.isDate(value)) {
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
            var int32Range = value >= BSON_INT32_MIN && value <= BSON_INT32_MAX, int64Range = value >= BSON_INT64_MIN && value <= BSON_INT64_MAX;
            // interpret as being of the smallest BSON integer type that can represent the number exactly
            if (int32Range)
                return { $numberInt: value.toString() };
            if (int64Range)
                return { $numberLong: value.toString() };
        }
        return { $numberDouble: value.toString() };
    }
    if (value instanceof RegExp || utils_1.isRegExp(value)) {
        var flags = value.flags;
        if (flags === undefined) {
            var match = value.toString().match(/[gimuy]*$/);
            if (match) {
                flags = match[0];
            }
        }
        var rx = new regexp_1.BSONRegExp(value.source, flags);
        return rx.toExtendedJSON(options);
    }
    if (value != null && typeof value === 'object')
        return serializeDocument(value, options);
    return value;
}
var BSON_TYPE_MAPPINGS = {
    Binary: function (o) { return new binary_1.Binary(o.value(), o.sub_type); },
    Code: function (o) { return new code_1.Code(o.code, o.scope); },
    DBRef: function (o) { return new db_ref_1.DBRef(o.collection || o.namespace, o.oid, o.db, o.fields); },
    Decimal128: function (o) { return new decimal128_1.Decimal128(o.bytes); },
    Double: function (o) { return new double_1.Double(o.value); },
    Int32: function (o) { return new int_32_1.Int32(o.value); },
    Long: function (o) {
        return long_1.Long.fromBits(
        // underscore variants for 1.x backwards compatibility
        o.low != null ? o.low : o.low_, o.low != null ? o.high : o.high_, o.low != null ? o.unsigned : o.unsigned_);
    },
    MaxKey: function () { return new max_key_1.MaxKey(); },
    MinKey: function () { return new min_key_1.MinKey(); },
    ObjectID: function (o) { return new objectid_1.ObjectId(o); },
    ObjectId: function (o) { return new objectid_1.ObjectId(o); },
    BSONRegExp: function (o) { return new regexp_1.BSONRegExp(o.pattern, o.options); },
    Symbol: function (o) { return new symbol_1.BSONSymbol(o.value); },
    Timestamp: function (o) { return timestamp_1.Timestamp.fromBits(o.low, o.high); }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeDocument(doc, options) {
    if (doc == null || typeof doc !== 'object')
        throw new error_1.BSONError('not an object instance');
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
                throw new error_1.BSONTypeError('Unrecognized or invalid _bsontype: ' + doc._bsontype);
            }
            outDoc = mapper(outDoc);
        }
        // Two BSON types may have nested objects that may need to be serialized too
        if (bsontype === 'Code' && outDoc.scope) {
            outDoc = new code_1.Code(outDoc.code, serializeValue(outDoc.scope, options));
        }
        else if (bsontype === 'DBRef' && outDoc.oid) {
            outDoc = new db_ref_1.DBRef(serializeValue(outDoc.collection, options), serializeValue(outDoc.oid, options), serializeValue(outDoc.db, options), serializeValue(outDoc.fields, options));
        }
        return outDoc.toExtendedJSON(options);
    }
    else {
        throw new error_1.BSONError('_bsontype must be a string, but was: ' + typeof bsontype);
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
                throw new error_1.BSONError("BSON Document field names cannot contain null bytes, found: " + JSON.stringify(key));
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
})(EJSON = exports.EJSON || (exports.EJSON = {}));
//# sourceMappingURL=extended_json.js.map