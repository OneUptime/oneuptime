"use strict";

/*
 * Stands in for @cspotcode/source-map-support in Transpiler.test.ts (Common
 * does not install ts-node or it): records what the transpiler installs, on
 * a global, so every copy of this module jest's registries load records in
 * the same place.
 */
const KEY = "__oneuptimeTranspilerTestSourceMapSupportInstalls";

if (!globalThis[KEY]) {
  globalThis[KEY] = [];
}

module.exports = {
  install: function install(options) {
    globalThis[KEY].push(options);
  },
};
