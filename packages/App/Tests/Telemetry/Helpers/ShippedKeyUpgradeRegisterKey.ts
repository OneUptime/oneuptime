/*
 * The REGISTER_PROBE_KEY ProbeShippedKeyUpgradePostgres runs with: a key of
 * the installation's own, set before anything reads EnvironmentConfig (which
 * reads it once, when first imported). So it is that suite's FIRST import,
 * and it sets the key only when that suite is opted in, leaving every other
 * run's environment as it was.
 */
export const UPGRADE_SUITE_REGISTER_PROBE_KEY: string =
  "3f1d9c7a5b2e4f6081a3c5e7d9b1f3a5c7e9d1b3f5a7c9e1";

export const isUpgradeSuiteOptedIn: boolean =
  process.env["RUN_POSTGRES_PROBE_SHIPPED_KEY_UPGRADE_TESTS"] === "true";

if (isUpgradeSuiteOptedIn) {
  process.env["REGISTER_PROBE_KEY"] = UPGRADE_SUITE_REGISTER_PROBE_KEY;
}
