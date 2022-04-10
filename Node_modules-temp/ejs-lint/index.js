'use strict';
const ejs = require('ejs');
const EJS_INCLUDE_REGEX = require('ejs-include-regex');
const check = require('syntax-error');

module.exports = function lint(text, opts = {}) {
  const arr = new ejs.Template(text, opts).parseTemplateText();
  // Initialize mode var
  // This is used to indicate the status:
  // Inside Scriptlet, mode=1 (scriptlet) or mode=2 (expression)
  // Outside Scriptlet, mode=0
  let mode;
  // Initialize delimiter variable
  const d = opts.delimiter || '%';
  const js = arr
    .map((str) => {
      switch (str) {
        case `<${d}`:
        case `<${d}_`:
          mode = 1;
          return padWhitespace(str);
        case `<${d}=`:
        case `<${d}-`:
          mode = 2;
          return `;${padWhitespace(str)}`;
        case `${d}>`:
        case `-${d}>`:
        case `_${d}>`:
          str = padWhitespace(str) + (mode === 2 ? ';' : '');
          mode = 0;
          return str;
        case (str.match(EJS_INCLUDE_REGEX) || {}).input:
          // if old-style include
          // - replace with whitespace if preprocessorInclude is set
          // - otherwise, leave it intact so it errors out correctly
          return opts.preprocessorInclude ? padWhitespace(str) : str;
        default:
          // If inside Scriptlet, pass through
          if (mode) return str;
          // else, pad with whitespace
          return padWhitespace(str);
      }
    })
    .join('');
  const checkOptions = {
    allowAwaitOutsideFunction: !!opts.await,
  };
  return check(js, undefined, checkOptions);
};

function padWhitespace(text) {
  let res = '';
  text.split('\n').forEach((line, i) => {
    // Add newline
    if (i !== 0) res += '\n';
    // Pad with whitespace between each newline
    for (let x = 0; x < line.length; x++) res += ' ';
  });
  return res;
}
