"use strict";

const React = require("react");

function ReactMarkdown(props) {
  return React.createElement(
    "div",
    { "data-testid": "react-markdown" },
    props && props.children,
  );
}

module.exports = ReactMarkdown;
module.exports.default = ReactMarkdown;
module.exports.defaultUrlTransform = function (url) {
  return url;
};
