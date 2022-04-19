"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deprecate = exports.isObjectLike = exports.isDate = exports.haveBuffer = exports.isMap = exports.isRegExp = exports.isBigUInt64Array = exports.isBigInt64Array = exports.isUint8Array = exports.isAnyArrayBuffer = exports.randomBytes = exports.normalizedFunctionString = void 0;
var buffer_1 = require("buffer");
var global_1 = require("../utils/global");
/**
 * Normalizes our expected stringified form of a function across versions of node
 * @param fn - The function to stringify
 */
function normalizedFunctionString(fn) {
    return fn.toString().replace('function(', 'function (');
}
exports.normalizedFunctionString = normalizedFunctionString;
function isReactNative() {
    var g = global_1.getGlobal();
    return typeof g.navigator === 'object' && g.navigator.product === 'ReactNative';
}
var insecureRandomBytes = function insecureRandomBytes(size) {
    var insecureWarning = isReactNative()
        ? 'BSON: For React Native please polyfill crypto.getRandomValues, e.g. using: https://www.npmjs.com/package/react-native-get-random-values.'
        : 'BSON: No cryptographic implementation for random bytes present, falling back to a less secure implementation.';
    console.warn(insecureWarning);
    var result = buffer_1.Buffer.alloc(size);
    for (var i = 0; i < size; ++i)
        result[i] = Math.floor(Math.random() * 256);
    return result;
};
var detectRandomBytes = function () {
    if (typeof window !== 'undefined') {
        // browser crypto implementation(s)
        var target_1 = window.crypto || window.msCrypto; // allow for IE11
        if (target_1 && target_1.getRandomValues) {
            return function (size) { return target_1.getRandomValues(buffer_1.Buffer.alloc(size)); };
        }
    }
    if (typeof global !== 'undefined' && global.crypto && global.crypto.getRandomValues) {
        // allow for RN packages such as https://www.npmjs.com/package/react-native-get-random-values to populate global
        return function (size) { return global.crypto.getRandomValues(buffer_1.Buffer.alloc(size)); };
    }
    var requiredRandomBytes;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        requiredRandomBytes = require('crypto').randomBytes;
    }
    catch (e) {
        // keep the fallback
    }
    // NOTE: in transpiled cases the above require might return null/undefined
    return requiredRandomBytes || insecureRandomBytes;
};
exports.randomBytes = detectRandomBytes();
function isAnyArrayBuffer(value) {
    return ['[object ArrayBuffer]', '[object SharedArrayBuffer]'].includes(Object.prototype.toString.call(value));
}
exports.isAnyArrayBuffer = isAnyArrayBuffer;
function isUint8Array(value) {
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}
exports.isUint8Array = isUint8Array;
function isBigInt64Array(value) {
    return Object.prototype.toString.call(value) === '[object BigInt64Array]';
}
exports.isBigInt64Array = isBigInt64Array;
function isBigUInt64Array(value) {
    return Object.prototype.toString.call(value) === '[object BigUint64Array]';
}
exports.isBigUInt64Array = isBigUInt64Array;
function isRegExp(d) {
    return Object.prototype.toString.call(d) === '[object RegExp]';
}
exports.isRegExp = isRegExp;
function isMap(d) {
    return Object.prototype.toString.call(d) === '[object Map]';
}
exports.isMap = isMap;
/** Call to check if your environment has `Buffer` */
function haveBuffer() {
    return typeof global !== 'undefined' && typeof global.Buffer !== 'undefined';
}
exports.haveBuffer = haveBuffer;
// To ensure that 0.4 of node works correctly
function isDate(d) {
    return isObjectLike(d) && Object.prototype.toString.call(d) === '[object Date]';
}
exports.isDate = isDate;
/**
 * @internal
 * this is to solve the `'someKey' in x` problem where x is unknown.
 * https://github.com/typescript-eslint/typescript-eslint/issues/1071#issuecomment-541955753
 */
function isObjectLike(candidate) {
    return typeof candidate === 'object' && candidate !== null;
}
exports.isObjectLike = isObjectLike;
function deprecate(fn, message) {
    var warned = false;
    function deprecated() {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (!warned) {
            console.warn(message);
            warned = true;
        }
        return fn.apply(this, args);
    }
    return deprecated;
}
exports.deprecate = deprecate;
//# sourceMappingURL=utils.js.map