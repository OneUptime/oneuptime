/*
 * A compiled (.js) CommonJS entry that assigns module.exports directly: there
 * is no .default to unwrap, and the loader must still find Server/Index.js
 * when Server/Index.ts does not exist.
 */
const factory = require("../../FixtureModuleFactory");

module.exports = factory.createFixtureModule("CommonJs");
