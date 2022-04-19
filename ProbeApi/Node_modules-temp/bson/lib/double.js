"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Double = void 0;
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
exports.Double = Double;
Object.defineProperty(Double.prototype, '_bsontype', { value: 'Double' });
//# sourceMappingURL=double.js.map