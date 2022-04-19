"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinKey = void 0;
/**
 * A class representation of the BSON MinKey type.
 * @public
 */
var MinKey = /** @class */ (function () {
    function MinKey() {
        if (!(this instanceof MinKey))
            return new MinKey();
    }
    /** @internal */
    MinKey.prototype.toExtendedJSON = function () {
        return { $minKey: 1 };
    };
    /** @internal */
    MinKey.fromExtendedJSON = function () {
        return new MinKey();
    };
    /** @internal */
    MinKey.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    MinKey.prototype.inspect = function () {
        return 'new MinKey()';
    };
    return MinKey;
}());
exports.MinKey = MinKey;
Object.defineProperty(MinKey.prototype, '_bsontype', { value: 'MinKey' });
//# sourceMappingURL=min_key.js.map