/**
 * @param { number } num desired length of characters
 * @description generates random alphanumeric characters
 * @returns { string } a string of random characters
 */

module.exports = (num = 15) => {
    const input =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let output = '';
    for (let i = 0; i < num; i++) {
        output += input.charAt(Math.floor(Math.random() * input.length));
    }
    return output;
};
