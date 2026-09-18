import { describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import path from "path";

/*
 * The loader under real node + ts-node, the way App/Index.ts runs it in the
 * image - not through jest's module registry, which resolves, transforms and
 * caches modules its own way. Proves, with the environment variables alone:
 *   - a TypeScript `export default` entry is unwrapped and registered on the
 *     same EnterpriseEdition instance core reads;
 *   - a compiled .js CommonJS entry loads too;
 *   - ONEUPTIME_EDITION=enterprise with no module, and billing without ee,
 *     stop the boot with a non-zero exit and a readable reason.
 *
 * Uses the fixtures only, never the repository's ee/: core CI jobs run with
 * ee/ removed.
 */

const APP_ROOT: string = path.resolve(__dirname, "../..");
const FIXTURES_DIR: string = path.join(
  APP_ROOT,
  "Tests",
  "Fixtures",
  "EnterpriseModules",
);
const PROBE: string = path.join(FIXTURES_DIR, "BootProbe.ts");
const RESULT_MARKER: string = "ENTERPRISE_BOOT_PROBE_RESULT ";
const FAILURE_MARKER: string = "ENTERPRISE_BOOT_PROBE_FAILED ";

const MANAGED_VARIABLES: Array<string> = [
  "ONEUPTIME_EDITION",
  "ONEUPTIME_EE_DIR",
  "BILLING_ENABLED",
  "ALLOW_BILLING_WITHOUT_ENTERPRISE",
  "IS_ENTERPRISE_EDITION",
];

interface ProbeRun {
  status: number | null;
  output: string;
  result: Record<string, unknown> | null;
  failure: string | null;
}

const runProbe: (variables: Record<string, string>) => ProbeRun = (
  variables: Record<string, string>,
): ProbeRun => {
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const name of MANAGED_VARIABLES) {
    delete env[name];
  }

  env["TS_NODE_TRANSPILE_ONLY"] = "1";
  env["BILLING_ENABLED"] = "false";
  Object.assign(env, variables);

  const spawned: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["--require", "ts-node/register", PROBE],
    {
      cwd: APP_ROOT,
      env,
      encoding: "utf8",
      timeout: 150000,
    },
  );

  const output: string = `${spawned.stdout ?? ""}${spawned.stderr ?? ""}`;
  const lines: Array<string> = output.split("\n");
  const resultLine: string | undefined = lines.find((line: string) => {
    return line.startsWith(RESULT_MARKER);
  });
  const failureLine: string | undefined = lines.find((line: string) => {
    return line.startsWith(FAILURE_MARKER);
  });

  return {
    status: spawned.status,
    output,
    result: resultLine
      ? (JSON.parse(resultLine.slice(RESULT_MARKER.length)) as Record<
          string,
          unknown
        >)
      : null,
    failure: failureLine ? failureLine.slice(FAILURE_MARKER.length) : null,
  };
};

describe("EnterpriseLoader under real node + ts-node", () => {
  test("loads a TypeScript default-export module and registers it", () => {
    const run: ProbeRun = runProbe({
      ONEUPTIME_EDITION: "enterprise",
      ONEUPTIME_EE_DIR: path.join(FIXTURES_DIR, "DefaultExport"),
    });

    expect({ status: run.status, failure: run.failure }).toEqual({
      status: 0,
      failure: null,
    });
    expect(run.result).toEqual({
      outcome: "loaded",
      edition: "enterprise",
      entryFile: path.join(FIXTURES_DIR, "DefaultExport", "Server", "Index.ts"),
      initCompleted: true,
      licenseStatus: "missing",
      isLoaded: true,
      version: "0.0.0-DefaultExport",
      placeholders: [
        "EnterpriseLicense:SendLicenseNotificationEmails",
        "EnterpriseLicense:ReconcileInstanceUsage",
        "InstanceHealth:EvaluateRedisHealth",
      ],
    });
  }, 180000);

  test("loads a compiled CommonJS .js entry under ONEUPTIME_EDITION=auto", () => {
    const run: ProbeRun = runProbe({
      ONEUPTIME_EE_DIR: path.join(FIXTURES_DIR, "CommonJs"),
    });

    expect(run.status).toBe(0);
    expect(run.result).toMatchObject({
      outcome: "loaded",
      edition: "auto",
      isLoaded: true,
      version: "0.0.0-CommonJs",
    });
  }, 180000);

  test("ONEUPTIME_EDITION=enterprise without a module exits non-zero", () => {
    const run: ProbeRun = runProbe({
      ONEUPTIME_EDITION: "enterprise",
      ONEUPTIME_EE_DIR: path.join(FIXTURES_DIR, "DoesNotExist"),
    });

    expect(run.status).toBe(3);
    expect(run.result).toBeNull();
    expect(run.failure).toContain("ONEUPTIME_EDITION=enterprise");
  }, 180000);

  test("billing without the enterprise module exits non-zero", () => {
    const run: ProbeRun = runProbe({
      ONEUPTIME_EDITION: "community",
      BILLING_ENABLED: "true",
    });

    expect(run.status).toBe(3);
    expect(run.failure).toContain("BILLING_ENABLED=true");
  }, 180000);
});
