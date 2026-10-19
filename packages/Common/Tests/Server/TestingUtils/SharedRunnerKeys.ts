/*
 * The shared Runner's key (ONEUPTIME_RUNNER_KEY) as the app is given it, for
 * suites that load the server's modules with one of these: the app lets the
 * shared Runner register with exactly that key (SharedRunnerKeyAuthorization).
 * EnvironmentConfig reads the variable once, when it is loaded, so a suite
 * sets it before it loads a fresh copy of the modules, and puts it back after.
 */

// A long random key, as npm start and the Helm chart give the app and the Runner.
export const OPERATOR_RUNNER_KEY: string =
  "9d4c2b7e1f0a8365c4e2d1b0a9f87e6d5c4b3a2918f7e6d5c4b3a2918f7e6d5c";

// Another installation's: just as long and random, and never this one's.
export const OTHER_INSTALLATION_RUNNER_KEY: string =
  "1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff001";

const originalRunnerKey: string | undefined =
  process.env["ONEUPTIME_RUNNER_KEY"];

export function setSharedRunnerKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env["ONEUPTIME_RUNNER_KEY"];
  } else {
    process.env["ONEUPTIME_RUNNER_KEY"] = value;
  }
}

export function restoreSharedRunnerKey(): void {
  setSharedRunnerKey(originalRunnerKey);
}
