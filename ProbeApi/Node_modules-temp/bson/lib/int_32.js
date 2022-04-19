"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Int32 = void 0;
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
exports.Int32 = Int32;
Object.defineProperty(Int32.prototype, '_bsontype', { value: 'Int32' });
//# sourceMappingURL=int_32.js.map