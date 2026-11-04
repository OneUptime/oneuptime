/*
 * The tests that run against real servers (Tests/...Live.test.ts): a real
 * Node environment, because database drivers need its timers and signals,
 * and none of the browser setup the unit tests share.
 */
const base = require("./jest.config.json");

module.exports = {
  ...base,
  testEnvironment: "node",
  setupFilesAfterEnv: [],
  testRegex: "./Tests/(.*)EnginesLive\\.test\\.ts$",
};
