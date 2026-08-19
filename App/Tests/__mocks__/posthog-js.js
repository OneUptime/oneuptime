"use strict";

/*
 * posthog-js reads browser globals (`location`) at import time, which the
 * "node" test environment does not provide. Analytics.ts imports it eagerly,
 * so any test that pulls in a Common UI component would fail to load.
 */
const posthog = {
  init: function () {},
  identify: function () {},
  reset: function () {},
  capture: function () {},
};

module.exports = posthog;
module.exports.default = posthog;
