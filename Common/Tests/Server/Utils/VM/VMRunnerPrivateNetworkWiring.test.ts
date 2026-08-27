import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * VMRunner hands the sandbox the host's real axios, so its SSRF guard is the
 * one thing standing between workflow-authored JavaScript and the internal
 * network. VMRunnerSsrf.test.ts exercises that guard for real, but it can only
 * run where the isolated-vm native module loads — so these source-level checks
 * cover the one detail that behaviour test does not: the guard now takes a
 * policy argument, and getting that argument's plumbing wrong fails open.
 *
 * Two things must hold, and neither is visible from the sandbox:
 *
 *  - The runner passes the CALLER's flag, not a literal `true` and not the
 *    instance configuration it could read itself. It also executes custom code
 *    monitors inside the Probe, which has no database to resolve a project
 *    from, so the decision cannot live here.
 *
 *  - Absent, the flag is false. A caller that never heard of the option keeps
 *    the strict policy rather than inheriting whatever was last set.
 */

const VM_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Utils",
  "VM",
);

const runnerSource: string = fs.readFileSync(
  path.join(VM_DIR, "VMRunner.ts"),
  "utf8",
);

const apiSource: string = fs.readFileSync(
  path.join(VM_DIR, "VMAPI.ts"),
  "utf8",
);

describe("VMRunner — private network policy plumbing", () => {
  test("the sandbox axios guard is called with the caller's flag", () => {
    expect(runnerSource).toMatch(
      /validateWebhookTargetIsSafe\(\s*effectiveUrl,\s*\{[\s\S]{0,600}?allowPrivateNetworkTargets:\s*\n?\s*options\.allowPrivateNetworkRequests === true,/,
    );
  });

  /*
   * "Webhook URL" is the guard's default noun and is wrong for both of this
   * runner's callers — one is a workflow script, the other is a monitor.
   */
  test("the guard is told this is a request, not a webhook", () => {
    expect(runnerSource).toMatch(/targetLabel:\s*"Request URL"/);
  });

  /*
   * The sentence telling an operator how to permit a private target has to
   * come from the caller: the workflow component's setting lives on the API
   * server and the probe's lives on the probe, which is usually a different
   * machine owned by a different person.
   */
  test("the refusal hint is passed through from the caller", () => {
    expect(runnerSource).toMatch(
      /privateNetworkHint:\s*options\.privateNetworkHint/,
    );
    expect(runnerSource).toMatch(
      /privateNetworkHint\?:\s*string \| undefined;/,
    );
  });

  test("there is exactly one call to the guard", () => {
    /*
     * A second, unguarded request path inside the runner would be invisible to
     * every test above — the sandbox would simply have two doors.
     */
    const calls: RegExpMatchArray | null = runnerSource.match(
      /validateWebhookTargetIsSafe\(/g,
    );

    expect(calls).toHaveLength(1);
  });

  test("the runner never reads the instance configuration itself", () => {
    /*
     * It would work in the App and silently differ in the Probe, where there
     * is no project to resolve. The policy has to arrive from the caller.
     */
    expect(runnerSource).not.toContain("PrivateNetworkWebhookConfig");
    expect(runnerSource).not.toContain("ProjectService");
    expect(runnerSource).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
  });

  test("the option is optional, so an unaware caller gets the strict policy", () => {
    expect(runnerSource).toMatch(
      /allowPrivateNetworkRequests\?:\s*boolean \| undefined;/,
    );
  });

  test("VMAPI passes both options through rather than dropping them", () => {
    expect(apiSource).toMatch(
      /allowPrivateNetworkRequests\?:\s*boolean \| undefined;/,
    );
    expect(apiSource).toMatch(/privateNetworkHint\?:\s*string \| undefined;/);
    // VMAPI forwards `data` wholesale; anything else would silently drop it.
    expect(apiSource).toContain("return VMRunner.runCodeInSandbox(data);");
  });
});
