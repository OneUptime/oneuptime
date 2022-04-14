/**
 * @param { number } num desired length of characters
 * @description generates random alphanumeric characters
 * @returns { string } a string of random characters
 */

export default (num = 15): void => {
    const input: $TSFixMe =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let output: $TSFixMe = '';
    for (let i: $TSFixMe = 0; i < num; i++) {
        output += input.charAt(Math.floor(Math.random() * input.length));
    }
    return output;
};
