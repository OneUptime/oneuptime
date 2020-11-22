/**
 * @description checks if an array contains duplicate values
 * @param {array} myArray the array to be checked
 * @returns {boolean} true or false
 */
module.exports = function isArrayUnique(myArray) {
    return myArray.length === new Set(myArray).size;
};
