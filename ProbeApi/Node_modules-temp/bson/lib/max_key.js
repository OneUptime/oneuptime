"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaxKey = void 0;
/**
 * A class representation of the BSON MaxKey type.
 * @public
 */
var MaxKey = /** @class */ (function () {
    function MaxKey() {
        if (!(this instanceof MaxKey))
            return new MaxKey();
    }
    /** @internal */
    MaxKey.prototype.toExtendedJSON = function () {
        return { $maxKey: 1 };
    };
    /** @internal */
    MaxKey.fromExtendedJSON = function () {
        return new MaxKey();
    };
    /** @internal */
    MaxKey.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    MaxKey.prototype.inspect = function () {
        return 'new MaxKey()';
    };
    return MaxKey;
}());
exports.MaxKey = MaxKey;
Object.defineProperty(MaxKey.prototype, '_bsontype', { value: 'MaxKey' });
//# sourceMappingURL=max_key.js.map