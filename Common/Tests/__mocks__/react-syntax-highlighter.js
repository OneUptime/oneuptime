"use strict";

const React = require("react");

function SyntaxHighlighter(props) {
  return React.createElement(
    "pre",
    { "data-testid": "syntax-highlighter" },
    props && props.children,
  );
}

SyntaxHighlighter.registerLanguage = function () {};

module.exports = SyntaxHighlighter;
module.exports.default = SyntaxHighlighter;
module.exports.Prism = SyntaxHighlighter;
module.exports.Light = SyntaxHighlighter;
module.exports.PrismLight = SyntaxHighlighter;
