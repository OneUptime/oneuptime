/*
 * `@jest/globals` FOR CODE THAT RUNS OUTSIDE JEST: an App server started as
 * a process of its own by a test (ReplicaProcess.js).
 *
 * The worlds the Common suites drive the real services in
 * (Tests/Server/Services/WorkspaceRules) stand their database and far ends
 * in with jest.spyOn. Outside Jest there is no `jest` object, so this hands
 * them the same spies, from the library Jest makes them with (jest-mock).
 */

const { ModuleMocker } = require("jest-mock");

const mocker = new ModuleMocker(globalThis);

module.exports = {
  jest: {
    fn: (implementation) => {
      return mocker.fn(implementation);
    },
    spyOn: (object, methodName, accessType) => {
      return mocker.spyOn(object, methodName, accessType);
    },
    restoreAllMocks: () => {
      return mocker.restoreAllMocks();
    },
    clearAllMocks: () => {
      return mocker.clearAllMocks();
    },
  },
};
