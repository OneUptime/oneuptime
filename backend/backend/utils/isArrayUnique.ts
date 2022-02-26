/**
 * @description checks if an array contains duplicate values
 * @param {array} myArray the array to be checked
 * @returns {boolean} true or false
 */
export default function isArrayUnique(myArray: $TSFixMe) {
    return myArray.length === new Set(myArray).size;
};
