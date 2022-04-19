"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Decimal128 = void 0;
var buffer_1 = require("buffer");
var error_1 = require("./error");
var long_1 = require("./long");
var utils_1 = require("./parser/utils");
var PARSE_STRING_REGEXP = /^(\+|-)?(\d+|(\d*\.\d*))?(E|e)?([-+])?(\d+)?$/;
var PARSE_INF_REGEXP = /^(\+|-)?(Infinity|inf)$/i;
var PARSE_NAN_REGEXP = /^(\+|-)?NaN$/i;
var EXPONENT_MAX = 6111;
var EXPONENT_MIN = -6176;
var EXPONENT_BIAS = 6176;
var MAX_DIGITS = 34;
// Nan value bits as 32 bit values (due to lack of longs)
var NAN_BUFFER = [
    0x7c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
].reverse();
// Infinity value bits 32 bit values (due to lack of longs)
var INF_NEGATIVE_BUFFER = [
    0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
].reverse();
var INF_POSITIVE_BUFFER = [
    0x78, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
].reverse();
var EXPONENT_REGEX = /^([-+])?(\d+)?$/;
// Extract least significant 5 bits
var COMBINATION_MASK = 0x1f;
// Extract least significant 14 bits
var EXPONENT_MASK = 0x3fff;
// Value of combination field for Inf
var COMBINATION_INFINITY = 30;
// Value of combination field for NaN
var COMBINATION_NAN = 31;
// Detect if the value is a digit
function isDigit(value) {
    return !isNaN(parseInt(value, 10));
}
// Divide two uint128 values
function divideu128(value) {
    var DIVISOR = long_1.Long.fromNumber(1000 * 1000 * 1000);
    var _rem = long_1.Long.fromNumber(0);
    if (!value.parts[0] && !value.parts[1] && !value.parts[2] && !value.parts[3]) {
        return { quotient: value, rem: _rem };
    }
    for (var i = 0; i <= 3; i++) {
        // Adjust remainder to match value of next dividend
        _rem = _rem.shiftLeft(32);
        // Add the divided to _rem
        _rem = _rem.add(new long_1.Long(value.parts[i], 0));
        value.parts[i] = _rem.div(DIVISOR).low;
        _rem = _rem.modulo(DIVISOR);
    }
    return { quotient: value, rem: _rem };
}
// Multiply two Long values and return the 128 bit value
function multiply64x2(left, right) {
    if (!left && !right) {
        return { high: long_1.Long.fromNumber(0), low: long_1.Long.fromNumber(0) };
    }
    var leftHigh = left.shiftRightUnsigned(32);
    var leftLow = new long_1.Long(left.getLowBits(), 0);
    var rightHigh = right.shiftRightUnsigned(32);
    var rightLow = new long_1.Long(right.getLowBits(), 0);
    var productHigh = leftHigh.multiply(rightHigh);
    var productMid = leftHigh.multiply(rightLow);
    var productMid2 = leftLow.multiply(rightHigh);
    var productLow = leftLow.multiply(rightLow);
    productHigh = productHigh.add(productMid.shiftRightUnsigned(32));
    productMid = new long_1.Long(productMid.getLowBits(), 0)
        .add(productMid2)
        .add(productLow.shiftRightUnsigned(32));
    productHigh = productHigh.add(productMid.shiftRightUnsigned(32));
    productLow = productMid.shiftLeft(32).add(new long_1.Long(productLow.getLowBits(), 0));
    // Return the 128 bit result
    return { high: productHigh, low: productLow };
}
function lessThan(left, right) {
    // Make values unsigned
    var uhleft = left.high >>> 0;
    var uhright = right.high >>> 0;
    // Compare high bits first
    if (uhleft < uhright) {
        return true;
    }
    else if (uhleft === uhright) {
        var ulleft = left.low >>> 0;
        var ulright = right.low >>> 0;
        if (ulleft < ulright)
            return true;
    }
    return false;
}
function invalidErr(string, message) {
    throw new error_1.BSONTypeError("\"" + string + "\" is not a valid Decimal128 string - " + message);
}
/**
 * A class representation of the BSON Decimal128 type.
 * @public
 */
var Decimal128 = /** @class */ (function () {
    /**
     * @param bytes - a buffer containing the raw Decimal128 bytes in little endian order,
     *                or a string representation as returned by .toString()
     */
    function Decimal128(bytes) {
        if (!(this instanceof Decimal128))
            return new Decimal128(bytes);
        if (typeof bytes === 'string') {
            this.bytes = Decimal128.fromString(bytes).bytes;
        }
        else if (utils_1.isUint8Array(bytes)) {
            if (bytes.byteLength !== 16) {
                throw new error_1.BSONTypeError('Decimal128 must take a Buffer of 16 bytes');
            }
            this.bytes = bytes;
        }
        else {
            throw new error_1.BSONTypeError('Decimal128 must take a Buffer or string');
        }
    }
    /**
     * Create a Decimal128 instance from a string representation
     *
     * @param representation - a numeric string representation.
     */
    Decimal128.fromString = function (representation) {
        // Parse state tracking
        var isNegative = false;
        var sawRadix = false;
        var foundNonZero = false;
        // Total number of significant digits (no leading or trailing zero)
        var significantDigits = 0;
        // Total number of significand digits read
        var nDigitsRead = 0;
        // Total number of digits (no leading zeros)
        var nDigits = 0;
        // The number of the digits after radix
        var radixPosition = 0;
        // The index of the first non-zero in *str*
        var firstNonZero = 0;
        // Digits Array
        var digits = [0];
        // The number of digits in digits
        var nDigitsStored = 0;
        // Insertion pointer for digits
        var digitsInsert = 0;
        // The index of the first non-zero digit
        var firstDigit = 0;
        // The index of the last digit
        var lastDigit = 0;
        // Exponent
        var exponent = 0;
        // loop index over array
        var i = 0;
        // The high 17 digits of the significand
        var significandHigh = new long_1.Long(0, 0);
        // The low 17 digits of the significand
        var significandLow = new long_1.Long(0, 0);
        // The biased exponent
        var biasedExponent = 0;
        // Read index
        var index = 0;
        // Naively prevent against REDOS attacks.
        // TODO: implementing a custom parsing for this, or refactoring the regex would yield
        //       further gains.
        if (representation.length >= 7000) {
            throw new error_1.BSONTypeError('' + representation + ' not a valid Decimal128 string');
        }
        // Results
        var stringMatch = representation.match(PARSE_STRING_REGEXP);
        var infMatch = representation.match(PARSE_INF_REGEXP);
        var nanMatch = representation.match(PARSE_NAN_REGEXP);
        // Validate the string
        if ((!stringMatch && !infMatch && !nanMatch) || representation.length === 0) {
            throw new error_1.BSONTypeError('' + representation + ' not a valid Decimal128 string');
        }
        if (stringMatch) {
            // full_match = stringMatch[0]
            // sign = stringMatch[1]
            var unsignedNumber = stringMatch[2];
            // stringMatch[3] is undefined if a whole number (ex "1", 12")
            // but defined if a number w/ decimal in it (ex "1.0, 12.2")
            var e = stringMatch[4];
            var expSign = stringMatch[5];
            var expNumber = stringMatch[6];
            // they provided e, but didn't give an exponent number. for ex "1e"
            if (e && expNumber === undefined)
                invalidErr(representation, 'missing exponent power');
            // they provided e, but didn't give a number before it. for ex "e1"
            if (e && unsignedNumber === undefined)
                invalidErr(representation, 'missing exponent base');
            if (e === undefined && (expSign || expNumber)) {
                invalidErr(representation, 'missing e before exponent');
            }
        }
        // Get the negative or positive sign
        if (representation[index] === '+' || representation[index] === '-') {
            isNegative = representation[index++] === '-';
        }
        // Check if user passed Infinity or NaN
        if (!isDigit(representation[index]) && representation[index] !== '.') {
            if (representation[index] === 'i' || representation[index] === 'I') {
                return new Decimal128(buffer_1.Buffer.from(isNegative ? INF_NEGATIVE_BUFFER : INF_POSITIVE_BUFFER));
            }
            else if (representation[index] === 'N') {
                return new Decimal128(buffer_1.Buffer.from(NAN_BUFFER));
            }
        }
        // Read all the digits
        while (isDigit(representation[index]) || representation[index] === '.') {
            if (representation[index] === '.') {
                if (sawRadix)
                    invalidErr(representation, 'contains multiple periods');
                sawRadix = true;
                index = index + 1;
                continue;
            }
            if (nDigitsStored < 34) {
                if (representation[index] !== '0' || foundNonZero) {
                    if (!foundNonZero) {
                        firstNonZero = nDigitsRead;
                    }
                    foundNonZero = true;
                    // Only store 34 digits
                    digits[digitsInsert++] = parseInt(representation[index], 10);
                    nDigitsStored = nDigitsStored + 1;
                }
            }
            if (foundNonZero)
                nDigits = nDigits + 1;
            if (sawRadix)
                radixPosition = radixPosition + 1;
            nDigitsRead = nDigitsRead + 1;
            index = index + 1;
        }
        if (sawRadix && !nDigitsRead)
            throw new error_1.BSONTypeError('' + representation + ' not a valid Decimal128 string');
        // Read exponent if exists
        if (representation[index] === 'e' || representation[index] === 'E') {
            // Read exponent digits
            var match = representation.substr(++index).match(EXPONENT_REGEX);
            // No digits read
            if (!match || !match[2])
                return new Decimal128(buffer_1.Buffer.from(NAN_BUFFER));
            // Get exponent
            exponent = parseInt(match[0], 10);
            // Adjust the index
            index = index + match[0].length;
        }
        // Return not a number
        if (representation[index])
            return new Decimal128(buffer_1.Buffer.from(NAN_BUFFER));
        // Done reading input
        // Find first non-zero digit in digits
        firstDigit = 0;
        if (!nDigitsStored) {
            firstDigit = 0;
            lastDigit = 0;
            digits[0] = 0;
            nDigits = 1;
            nDigitsStored = 1;
            significantDigits = 0;
        }
        else {
            lastDigit = nDigitsStored - 1;
            significantDigits = nDigits;
            if (significantDigits !== 1) {
                while (digits[firstNonZero + significantDigits - 1] === 0) {
                    significantDigits = significantDigits - 1;
                }
            }
        }
        // Normalization of exponent
        // Correct exponent based on radix position, and shift significand as needed
        // to represent user input
        // Overflow prevention
        if (exponent <= radixPosition && radixPosition - exponent > 1 << 14) {
            exponent = EXPONENT_MIN;
        }
        else {
            exponent = exponent - radixPosition;
        }
        // Attempt to normalize the exponent
        while (exponent > EXPONENT_MAX) {
            // Shift exponent to significand and decrease
            lastDigit = lastDigit + 1;
            if (lastDigit - firstDigit > MAX_DIGITS) {
                // Check if we have a zero then just hard clamp, otherwise fail
                var digitsString = digits.join('');
                if (digitsString.match(/^0+$/)) {
                    exponent = EXPONENT_MAX;
                    break;
                }
                invalidErr(representation, 'overflow');
            }
            exponent = exponent - 1;
        }
        while (exponent < EXPONENT_MIN || nDigitsStored < nDigits) {
            // Shift last digit. can only do this if < significant digits than # stored.
            if (lastDigit === 0 && significantDigits < nDigitsStored) {
                exponent = EXPONENT_MIN;
                significantDigits = 0;
                break;
            }
            if (nDigitsStored < nDigits) {
                // adjust to match digits not stored
                nDigits = nDigits - 1;
            }
            else {
                // adjust to round
                lastDigit = lastDigit - 1;
            }
            if (exponent < EXPONENT_MAX) {
                exponent = exponent + 1;
            }
            else {
                // Check if we have a zero then just hard clamp, otherwise fail
                var digitsString = digits.join('');
                if (digitsString.match(/^0+$/)) {
                    exponent = EXPONENT_MAX;
                    break;
                }
                invalidErr(representation, 'overflow');
            }
        }
        // Round
        // We've normalized the exponent, but might still need to round.
        if (lastDigit - firstDigit + 1 < significantDigits) {
            var endOfString = nDigitsRead;
            // If we have seen a radix point, 'string' is 1 longer than we have
            // documented with ndigits_read, so inc the position of the first nonzero
            // digit and the position that digits are read to.
            if (sawRadix) {
                firstNonZero = firstNonZero + 1;
                endOfString = endOfString + 1;
            }
            // if negative, we need to increment again to account for - sign at start.
            if (isNegative) {
                firstNonZero = firstNonZero + 1;
                endOfString = endOfString + 1;
            }
            var roundDigit = parseInt(representation[firstNonZero + lastDigit + 1], 10);
            var roundBit = 0;
            if (roundDigit >= 5) {
                roundBit = 1;
                if (roundDigit === 5) {
                    roundBit = digits[lastDigit] % 2 === 1 ? 1 : 0;
                    for (i = firstNonZero + lastDigit + 2; i < endOfString; i++) {
                        if (parseInt(representation[i], 10)) {
                            roundBit = 1;
                            break;
                        }
                    }
                }
            }
            if (roundBit) {
                var dIdx = lastDigit;
                for (; dIdx >= 0; dIdx--) {
                    if (++digits[dIdx] > 9) {
                        digits[dIdx] = 0;
                        // overflowed most significant digit
                        if (dIdx === 0) {
                            if (exponent < EXPONENT_MAX) {
                                exponent = exponent + 1;
                                digits[dIdx] = 1;
                            }
                            else {
                                return new Decimal128(buffer_1.Buffer.from(isNegative ? INF_NEGATIVE_BUFFER : INF_POSITIVE_BUFFER));
                            }
                        }
                    }
                }
            }
        }
        // Encode significand
        // The high 17 digits of the significand
        significandHigh = long_1.Long.fromNumber(0);
        // The low 17 digits of the significand
        significandLow = long_1.Long.fromNumber(0);
        // read a zero
        if (significantDigits === 0) {
            significandHigh = long_1.Long.fromNumber(0);
            significandLow = long_1.Long.fromNumber(0);
        }
        else if (lastDigit - firstDigit < 17) {
            var dIdx = firstDigit;
            significandLow = long_1.Long.fromNumber(digits[dIdx++]);
            significandHigh = new long_1.Long(0, 0);
            for (; dIdx <= lastDigit; dIdx++) {
                significandLow = significandLow.multiply(long_1.Long.fromNumber(10));
                significandLow = significandLow.add(long_1.Long.fromNumber(digits[dIdx]));
            }
        }
        else {
            var dIdx = firstDigit;
            significandHigh = long_1.Long.fromNumber(digits[dIdx++]);
            for (; dIdx <= lastDigit - 17; dIdx++) {
                significandHigh = significandHigh.multiply(long_1.Long.fromNumber(10));
                significandHigh = significandHigh.add(long_1.Long.fromNumber(digits[dIdx]));
            }
            significandLow = long_1.Long.fromNumber(digits[dIdx++]);
            for (; dIdx <= lastDigit; dIdx++) {
                significandLow = significandLow.multiply(long_1.Long.fromNumber(10));
                significandLow = significandLow.add(long_1.Long.fromNumber(digits[dIdx]));
            }
        }
        var significand = multiply64x2(significandHigh, long_1.Long.fromString('100000000000000000'));
        significand.low = significand.low.add(significandLow);
        if (lessThan(significand.low, significandLow)) {
            significand.high = significand.high.add(long_1.Long.fromNumber(1));
        }
        // Biased exponent
        biasedExponent = exponent + EXPONENT_BIAS;
        var dec = { low: long_1.Long.fromNumber(0), high: long_1.Long.fromNumber(0) };
        // Encode combination, exponent, and significand.
        if (significand.high.shiftRightUnsigned(49).and(long_1.Long.fromNumber(1)).equals(long_1.Long.fromNumber(1))) {
            // Encode '11' into bits 1 to 3
            dec.high = dec.high.or(long_1.Long.fromNumber(0x3).shiftLeft(61));
            dec.high = dec.high.or(long_1.Long.fromNumber(biasedExponent).and(long_1.Long.fromNumber(0x3fff).shiftLeft(47)));
            dec.high = dec.high.or(significand.high.and(long_1.Long.fromNumber(0x7fffffffffff)));
        }
        else {
            dec.high = dec.high.or(long_1.Long.fromNumber(biasedExponent & 0x3fff).shiftLeft(49));
            dec.high = dec.high.or(significand.high.and(long_1.Long.fromNumber(0x1ffffffffffff)));
        }
        dec.low = significand.low;
        // Encode sign
        if (isNegative) {
            dec.high = dec.high.or(long_1.Long.fromString('9223372036854775808'));
        }
        // Encode into a buffer
        var buffer = buffer_1.Buffer.alloc(16);
        index = 0;
        // Encode the low 64 bits of the decimal
        // Encode low bits
        buffer[index++] = dec.low.low & 0xff;
        buffer[index++] = (dec.low.low >> 8) & 0xff;
        buffer[index++] = (dec.low.low >> 16) & 0xff;
        buffer[index++] = (dec.low.low >> 24) & 0xff;
        // Encode high bits
        buffer[index++] = dec.low.high & 0xff;
        buffer[index++] = (dec.low.high >> 8) & 0xff;
        buffer[index++] = (dec.low.high >> 16) & 0xff;
        buffer[index++] = (dec.low.high >> 24) & 0xff;
        // Encode the high 64 bits of the decimal
        // Encode low bits
        buffer[index++] = dec.high.low & 0xff;
        buffer[index++] = (dec.high.low >> 8) & 0xff;
        buffer[index++] = (dec.high.low >> 16) & 0xff;
        buffer[index++] = (dec.high.low >> 24) & 0xff;
        // Encode high bits
        buffer[index++] = dec.high.high & 0xff;
        buffer[index++] = (dec.high.high >> 8) & 0xff;
        buffer[index++] = (dec.high.high >> 16) & 0xff;
        buffer[index++] = (dec.high.high >> 24) & 0xff;
        // Return the new Decimal128
        return new Decimal128(buffer);
    };
    /** Create a string representation of the raw Decimal128 value */
    Decimal128.prototype.toString = function () {
        // Note: bits in this routine are referred to starting at 0,
        // from the sign bit, towards the coefficient.
        // decoded biased exponent (14 bits)
        var biased_exponent;
        // the number of significand digits
        var significand_digits = 0;
        // the base-10 digits in the significand
        var significand = new Array(36);
        for (var i = 0; i < significand.length; i++)
            significand[i] = 0;
        // read pointer into significand
        var index = 0;
        // true if the number is zero
        var is_zero = false;
        // the most significant significand bits (50-46)
        var significand_msb;
        // temporary storage for significand decoding
        var significand128 = { parts: [0, 0, 0, 0] };
        // indexing variables
        var j, k;
        // Output string
        var string = [];
        // Unpack index
        index = 0;
        // Buffer reference
        var buffer = this.bytes;
        // Unpack the low 64bits into a long
        // bits 96 - 127
        var low = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
        // bits 64 - 95
        var midl = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
        // Unpack the high 64bits into a long
        // bits 32 - 63
        var midh = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
        // bits 0 - 31
        var high = buffer[index++] | (buffer[index++] << 8) | (buffer[index++] << 16) | (buffer[index++] << 24);
        // Unpack index
        index = 0;
        // Create the state of the decimal
        var dec = {
            low: new long_1.Long(low, midl),
            high: new long_1.Long(midh, high)
        };
        if (dec.high.lessThan(long_1.Long.ZERO)) {
            string.push('-');
        }
        // Decode combination field and exponent
        // bits 1 - 5
        var combination = (high >> 26) & COMBINATION_MASK;
        if (combination >> 3 === 3) {
            // Check for 'special' values
            if (combination === COMBINATION_INFINITY) {
                return string.join('') + 'Infinity';
            }
            else if (combination === COMBINATION_NAN) {
                return 'NaN';
            }
            else {
                biased_exponent = (high >> 15) & EXPONENT_MASK;
                significand_msb = 0x08 + ((high >> 14) & 0x01);
            }
        }
        else {
            significand_msb = (high >> 14) & 0x07;
            biased_exponent = (high >> 17) & EXPONENT_MASK;
        }
        // unbiased exponent
        var exponent = biased_exponent - EXPONENT_BIAS;
        // Create string of significand digits
        // Convert the 114-bit binary number represented by
        // (significand_high, significand_low) to at most 34 decimal
        // digits through modulo and division.
        significand128.parts[0] = (high & 0x3fff) + ((significand_msb & 0xf) << 14);
        significand128.parts[1] = midh;
        significand128.parts[2] = midl;
        significand128.parts[3] = low;
        if (significand128.parts[0] === 0 &&
            significand128.parts[1] === 0 &&
            significand128.parts[2] === 0 &&
            significand128.parts[3] === 0) {
            is_zero = true;
        }
        else {
            for (k = 3; k >= 0; k--) {
                var least_digits = 0;
                // Perform the divide
                var result = divideu128(significand128);
                significand128 = result.quotient;
                least_digits = result.rem.low;
                // We now have the 9 least significant digits (in base 2).
                // Convert and output to string.
                if (!least_digits)
                    continue;
                for (j = 8; j >= 0; j--) {
                    // significand[k * 9 + j] = Math.round(least_digits % 10);
                    significand[k * 9 + j] = least_digits % 10;
                    // least_digits = Math.round(least_digits / 10);
                    least_digits = Math.floor(least_digits / 10);
                }
            }
        }
        // Output format options:
        // Scientific - [-]d.dddE(+/-)dd or [-]dE(+/-)dd
        // Regular    - ddd.ddd
        if (is_zero) {
            significand_digits = 1;
            significand[index] = 0;
        }
        else {
            significand_digits = 36;
            while (!significand[index]) {
                significand_digits = significand_digits - 1;
                index = index + 1;
            }
        }
        // the exponent if scientific notation is used
        var scientific_exponent = significand_digits - 1 + exponent;
        // The scientific exponent checks are dictated by the string conversion
        // specification and are somewhat arbitrary cutoffs.
        //
        // We must check exponent > 0, because if this is the case, the number
        // has trailing zeros.  However, we *cannot* output these trailing zeros,
        // because doing so would change the precision of the value, and would
        // change stored data if the string converted number is round tripped.
        if (scientific_exponent >= 34 || scientific_exponent <= -7 || exponent > 0) {
            // Scientific format
            // if there are too many significant digits, we should just be treating numbers
            // as + or - 0 and using the non-scientific exponent (this is for the "invalid
            // representation should be treated as 0/-0" spec cases in decimal128-1.json)
            if (significand_digits > 34) {
                string.push("" + 0);
                if (exponent > 0)
                    string.push('E+' + exponent);
                else if (exponent < 0)
                    string.push('E' + exponent);
                return string.join('');
            }
            string.push("" + significand[index++]);
            significand_digits = significand_digits - 1;
            if (significand_digits) {
                string.push('.');
            }
            for (var i = 0; i < significand_digits; i++) {
                string.push("" + significand[index++]);
            }
            // Exponent
            string.push('E');
            if (scientific_exponent > 0) {
                string.push('+' + scientific_exponent);
            }
            else {
                string.push("" + scientific_exponent);
            }
        }
        else {
            // Regular format with no decimal place
            if (exponent >= 0) {
                for (var i = 0; i < significand_digits; i++) {
                    string.push("" + significand[index++]);
                }
            }
            else {
                var radix_position = significand_digits + exponent;
                // non-zero digits before radix
                if (radix_position > 0) {
                    for (var i = 0; i < radix_position; i++) {
                        string.push("" + significand[index++]);
                    }
                }
                else {
                    string.push('0');
                }
                string.push('.');
                // add leading zeros after radix
                while (radix_position++ < 0) {
                    string.push('0');
                }
                for (var i = 0; i < significand_digits - Math.max(radix_position - 1, 0); i++) {
                    string.push("" + significand[index++]);
                }
            }
        }
        return string.join('');
    };
    Decimal128.prototype.toJSON = function () {
        return { $numberDecimal: this.toString() };
    };
    /** @internal */
    Decimal128.prototype.toExtendedJSON = function () {
        return { $numberDecimal: this.toString() };
    };
    /** @internal */
    Decimal128.fromExtendedJSON = function (doc) {
        return Decimal128.fromString(doc.$numberDecimal);
    };
    /** @internal */
    Decimal128.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    Decimal128.prototype.inspect = function () {
        return "new Decimal128(\"" + this.toString() + "\")";
    };
    return Decimal128;
}());
exports.Decimal128 = Decimal128;
Object.defineProperty(Decimal128.prototype, '_bsontype', { value: 'Decimal128' });
//# sourceMappingURL=decimal128.js.map