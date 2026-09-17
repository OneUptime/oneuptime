"use strict";

const mermaid = {
  initialize: function () {},
  render: function () {
    return Promise.resolve({ svg: "" });
  },
  run: function () {
    return Promise.resolve();
  },
  parse: function () {
    return Promise.resolve(true);
  },
  contentLoaded: function () {},
};

module.exports = mermaid;
module.exports.default = mermaid;
