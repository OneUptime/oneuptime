import { afterEach, beforeEach } from "@jest/globals";

/*
 * How much an egress refusal may say depends on the deployment:
 * DataSourceEgressGuard.shouldIncludeResolutionDetail() — which SSRFProtection
 * shares — allows detail on a self-hosted install and none on SaaS
 * (BILLING_ENABLED=true) or once DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true.
 *
 * CI exports BILLING_ENABLED=true, so a suite that asserts a detailed refusal
 * ("resolves to 127.0.0.1", "could not be resolved via DNS") without pinning
 * these passes on a laptop and fails in CI. Call this at the top of such a
 * file or describe: every test in scope starts on a self-hosted install, a
 * test about SaaS sets the variable itself, and the originals are restored
 * afterwards.
 */
const EGRESS_POLICY_ENV_VARS: Array<string> = [
  "BILLING_ENABLED",
  "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
];

export function startEachTestOnSelfHostedEgressPolicy(): void {
  const saved: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();

  beforeEach(() => {
    for (const name of EGRESS_POLICY_ENV_VARS) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of EGRESS_POLICY_ENV_VARS) {
      const value: string | undefined = saved.get(name);

      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
}
