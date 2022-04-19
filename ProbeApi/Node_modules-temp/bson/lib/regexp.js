"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BSONRegExp = void 0;
var error_1 = require("./error");
function alphabetize(str) {
    return str.split('').sort().join('');
}
/**
 * A class representation of the BSON RegExp type.
 * @public
 */
var BSONRegExp = /** @class */ (function () {
    /**
     * @param pattern - The regular expression pattern to match
     * @param options - The regular expression options
     */
    function BSONRegExp(pattern, options) {
        if (!(this instanceof BSONRegExp))
            return new BSONRegExp(pattern, options);
        this.pattern = pattern;
        this.options = alphabetize(options !== null && options !== void 0 ? options : '');
        if (this.pattern.indexOf('\x00') !== -1) {
            throw new error_1.BSONError("BSON Regex patterns cannot contain null bytes, found: " + JSON.stringify(this.pattern));
        }
        if (this.options.indexOf('\x00') !== -1) {
            throw new error_1.BSONError("BSON Regex options cannot contain null bytes, found: " + JSON.stringify(this.options));
        }
        // Validate options
        for (var i = 0; i < this.options.length; i++) {
            if (!(this.options[i] === 'i' ||
                this.options[i] === 'm' ||
                this.options[i] === 'x' ||
                this.options[i] === 'l' ||
                this.options[i] === 's' ||
                this.options[i] === 'u')) {
                throw new error_1.BSONError("The regular expression option [" + this.options[i] + "] is not supported");
            }
        }
    }
    BSONRegExp.parseOptions = function (options) {
        return options ? options.split('').sort().join('') : '';
    };
    /** @internal */
    BSONRegExp.prototype.toExtendedJSON = function (options) {
        options = options || {};
        if (options.legacy) {
            return { $regex: this.pattern, $options: this.options };
        }
        return { $regularExpression: { pattern: this.pattern, options: this.options } };
    };
    /** @internal */
    BSONRegExp.fromExtendedJSON = function (doc) {
        if ('$regex' in doc) {
            if (typeof doc.$regex !== 'string') {
                // This is for $regex query operators that have extended json values.
                if (doc.$regex._bsontype === 'BSONRegExp') {
                    return doc;
                }
            }
            else {
                return new BSONRegExp(doc.$regex, BSONRegExp.parseOptions(doc.$options));
            }
        }
        if ('$regularExpression' in doc) {
            return new BSONRegExp(doc.$regularExpression.pattern, BSONRegExp.parseOptions(doc.$regularExpression.options));
        }
        throw new error_1.BSONTypeError("Unexpected BSONRegExp EJSON object form: " + JSON.stringify(doc));
    };
    return BSONRegExp;
}());
exports.BSONRegExp = BSONRegExp;
Object.defineProperty(BSONRegExp.prototype, '_bsontype', { value: 'BSONRegExp' });
//# sourceMappingURL=regexp.js.map