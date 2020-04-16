/**
 * @param { number } num desired length of characters
 * @description generates random alphanumeric characters
 * @returns { string } a string of random characters
 */

module.exports = (num = 15) => {
    var input =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var output = '';
    for (var i = 0; i < num; i++) {
        output += input.charAt(Math.floor(Math.random() * input.length));
    }
    return output;
};
