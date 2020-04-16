/**
 * @param {array} arr array that needs flattening
 * @description flattens an array of any depth
 * @return {array} a flattened array
 */

module.exports = function flat(arr) {
    let flattened = [];
    (function flatten(arr) {
        for (let val of arr) {
            if (Array.isArray(val)) {
                flatten(val);
            } else {
                flattened.push(val);
            }
        }
    })(arr);
    return flattened;
};
