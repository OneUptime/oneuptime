"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Code = void 0;
/**
 * A class representation of the BSON Code type.
 * @public
 */
var Code = /** @class */ (function () {
    /**
     * @param code - a string or function.
     * @param scope - an optional scope for the function.
     */
    function Code(code, scope) {
        if (!(this instanceof Code))
            return new Code(code, scope);
        this.code = code;
        this.scope = scope;
    }
    Code.prototype.toJSON = function () {
        return { code: this.code, scope: this.scope };
    };
    /** @internal */
    Code.prototype.toExtendedJSON = function () {
        if (this.scope) {
            return { $code: this.code, $scope: this.scope };
        }
        return { $code: this.code };
    };
    /** @internal */
    Code.fromExtendedJSON = function (doc) {
        return new Code(doc.$code, doc.$scope);
    };
    /** @internal */
    Code.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Code.prototype.inspect = function () {
        var codeJson = this.toJSON();
        return "new Code(\"" + codeJson.code + "\"" + (codeJson.scope ? ", " + JSON.stringify(codeJson.scope) : '') + ")";
    };
    return Code;
}());
exports.Code = Code;
Object.defineProperty(Code.prototype, '_bsontype', { value: 'Code' });
//# sourceMappingURL=code.js.map