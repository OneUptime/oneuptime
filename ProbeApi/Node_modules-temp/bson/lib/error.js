"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BSONTypeError = exports.BSONError = void 0;
/** @public */
var BSONError = /** @class */ (function (_super) {
    __extends(BSONError, _super);
    function BSONError(message) {
        var _this = _super.call(this, message) || this;
        Object.setPrototypeOf(_this, BSONError.prototype);
        return _this;
    }
    Object.defineProperty(BSONError.prototype, "name", {
        get: function () {
            return 'BSONError';
        },
        enumerable: false,
        configurable: true
    });
    return BSONError;
}(Error));
exports.BSONError = BSONError;
/** @public */
var BSONTypeError = /** @class */ (function (_super) {
    __extends(BSONTypeError, _super);
    function BSONTypeError(message) {
        var _this = _super.call(this, message) || this;
        Object.setPrototypeOf(_this, BSONTypeError.prototype);
        return _this;
    }
    Object.defineProperty(BSONTypeError.prototype, "name", {
        get: function () {
            return 'BSONTypeError';
        },
        enumerable: false,
        configurable: true
    });
    return BSONTypeError;
}(TypeError));
exports.BSONTypeError = BSONTypeError;
//# sourceMappingURL=error.js.map