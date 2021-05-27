/**
 * @description joins the content of an array by comma separator
 * @param {array} arr array of strings
 * @returns a string
 */

module.exports = (arr = []) => {
    return arr.join(', ').replace(/, ([^,]*)$/, ' and $1');
};
