"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BSONSymbol = void 0;
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
exports.BSONSymbol = BSONSymbol;
Object.defineProperty(BSONSymbol.prototype, '_bsontype', { value: 'Symbol' });
//# sourceMappingURL=symbol.js.map