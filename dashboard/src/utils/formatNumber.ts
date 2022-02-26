// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import { isNumber } from 'lodash';

const format = (number: $TSFixMe) => {
    if (!isNumber(number)) return null;
    let formattedValue = '';
    let index = 0;
    const formats = [
        { index: 'T', value: 1e12 },
        { index: 'B', value: 1e9 },
        { index: 'M', value: 1e6 },
        { index: 'K', value: 1000 },
    ];
    // return the number if less than 1000.
    if (number < 1000) {
        formattedValue = number.toString();
    }
    // terminate if we have a formatted value or the next index is not defined
    while (formattedValue === '' && formats[index]) {
        const currentFormat = formats[index];

        let val = (number / currentFormat.value).toFixed(2);
        const remainder = number % currentFormat.value;
        // @ts-expect-error ts-migrate(2365) FIXME: Operator '<' cannot be applied to types 'string' a... Remove this comment to see the full error message
        const isValueLessThanOne = val < 1;
        let formattedRemainder = '';

        if (!isValueLessThanOne) {
            // this is a success we try to format the value and the remainder
            if (remainder !== 0) {
                // value has remainder
                // convert value to string and fetch the digit after the decimal
                const stringVal = val.toString();
                formattedRemainder = stringVal.substr(
                    stringVal.indexOf('.') + 1
                );

                // if the formatted remainder is divisible by 10, without a remainder, we return just the first digit
                // this is to avoid .50 instead we have .5
                const intFormattedRemainder = parseInt(formattedRemainder);
                const tenthRemainder = intFormattedRemainder % 10;
                if (tenthRemainder === 0) {
                    formattedRemainder = formattedRemainder.substr(0, 1);
                }
            }
            // parse value to integer to get whole number
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string'.
            val = parseInt(number / currentFormat.value);

            // prepare the final value with the whole number, remainder and indicator
            formattedValue =
                remainder === 0
                    ? `${val}${currentFormat.index}`
                    : `${val}.${formattedRemainder}${currentFormat.index}`;
        }
        // goto the next index
        index = index + 1;
    }
    return formattedValue;
};

// return the provided number in a particular decimal place
export function numDecimal(num: $TSFixMe, decimalPlace = 2) {
    decimalPlace = Number(decimalPlace);
    return Number.parseFloat(num).toFixed(decimalPlace);
}

export default format;
