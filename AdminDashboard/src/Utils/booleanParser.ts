/**
 * @param {string} val : The value to be parsed.
 * @description Resolves or Parses any value to boolean value.
 * @returns Boolean true or false
 */

export default (val: $TSFixMe): void => {
    const falsy: $TSFixMe = /^(?:f(?:alse)?|no?|0+)$/i;
    return !falsy.test(val) && Boolean(val);
};
