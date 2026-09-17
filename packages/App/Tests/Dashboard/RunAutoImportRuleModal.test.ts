import {
  AutoImportRuleRunResult,
  RuleRunResultUtil,
} from "Common/Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * describeAutoImportRun is pure text over the run counters and lives in
 * Common — no react and no browser config in its import graph — so this
 * suite runs in Node without mocking any browser-time seam.
 */
const describeAutoImportRun: (result: AutoImportRuleRunResult) => string =
  RuleRunResultUtil.describeAutoImportRun.bind(RuleRunResultUtil);

function result(
  overrides: Partial<AutoImportRuleRunResult>,
): AutoImportRuleRunResult {
  return {
    hostsEvaluated: 1,
    hostsMatched: 1,
    hostsExcluded: 0,
    hostsSkippedAlreadyRegistered: 1,
    devicesCreated: 0,
    devicesFailed: 0,
    monitorsWouldCreate: 0,
    monitorsCreated: 0,
    monitorsSkippedAlreadyExisting: 0,
    monitorsSkippedUnsupportedHost: 0,
    monitorsFailed: 0,
    deviceFailureReasons: [],
    monitorFailureReasons: [],
    monitorProvisioningHalted: false,
    isTruncated: false,
    hostsPendingImport: 0,
    monitorsPendingCreation: 0,
    hasUnevaluatedScans: false,
    hasMoreScans: false,
    isDryRun: false,
    matchedIpAddressSample: [],
    ...overrides,
  };
}

describe("auto-import rule run summary", () => {
  it("uses singular grammar for one skipped monitor request", () => {
    const summary: string = describeAutoImportRun(
      result({ monitorsSkippedAlreadyExisting: 1 }),
    );

    expect(summary).toContain(
      "1 requested active Network Device monitor was skipped",
    );
    expect(summary).not.toContain("monitor were");
  });

  it("describes multiple skipped requests without claiming that many monitors exist", () => {
    expect(
      describeAutoImportRun(result({ monitorsSkippedAlreadyExisting: 3 })),
    ).toContain("3 requested active Network Device monitors were skipped");
  });

  it("explains that a dry-run cap can come from device or monitor work", () => {
    const summary: string = describeAutoImportRun(
      result({ isDryRun: true, isTruncated: true }),
    );

    expect(summary).toContain("device-import and active-monitor creation");
    expect(summary).not.toContain("imports this many");
  });

  /*
   * The report issue #3643 was actually given: 501 matched, 501 already had
   * devices, 500 monitors failed, and the only advice was to run it again.
   * This is that whole dialog, as the fixed engine now fills it in.
   */
  it("tells an operator whose run created nothing what to do about it", () => {
    const summary: string = describeAutoImportRun(
      result({
        hostsEvaluated: 501,
        hostsMatched: 501,
        hostsSkippedAlreadyRegistered: 501,
        devicesCreated: 0,
        monitorsCreated: 0,
        monitorsFailed: 501,
        monitorProvisioningHalted: true,
        monitorFailureReasons: [
          "This rule's Monitor Template could not be loaded. It may have been deleted, moved to another project, or changed to a monitor type other than Network Device. Edit the rule and select a Network Device Monitor Template.",
        ],
      }),
    );

    expect(summary).toContain(
      "501 active Network Device monitors could not be created",
    );
    expect(summary).toContain(
      "Edit the rule and select a Network Device Monitor Template.",
    );
    expect(summary).toContain("Monitor provisioning stopped");
    // The advice that sent this operator in a circle.
    expect(summary).not.toContain("run again to continue");
    expect(summary).not.toContain("check the server logs");
  });
});

/*
 * The modal itself renders, so the App suite (a plain Node environment, with
 * FeatureSet/Dashboard outside App/tsconfig.json) reads its source the way the
 * other Dashboard wiring tests do. Its actual loop lives in
 * Common/Utils/NetworkAutomation/AutoImportRunChain and is behaviour-tested
 * there; what has to be pinned HERE is that the modal still drives it, and
 * that nothing has quietly reverted the button to a single capped pass —
 * which is what OneUptime issue #3642 was.
 */
const MODAL_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "NetworkAutomation",
    "RunAutoImportRuleModal.tsx",
  ),
  "utf8",
);

function code(): string {
  return MODAL_SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ");
}

describe("Run Now drives every capped pass (issue #3642)", () => {
  it("runs the rule through the chain rather than posting once", () => {
    expect(code()).toContain("await AutoImportRunChain.run({");
    expect(code()).toContain("isDryRun: props.isDryRun");
  });

  it("posts one pass per chain iteration, to the rule's run endpoint", () => {
    const source: string = code();

    expect(source).toContain(
      "runPass: async (): Promise<AutoImportRuleRunResult | null> => {",
    );
    expect(source).toContain(
      "`/network-device-auto-import-rule/${props.ruleId}/run`",
    );
    // A failed pass answers null so the chain keeps the earlier passes.
    expect(source).toContain("setError(API.getFriendlyMessage(response))");
    expect(source).toContain("return null;");
  });

  it("stops chaining when the operator closes the dialog", () => {
    const source: string = code();

    expect(source).toContain("isCancelledRef.current = true;");
    expect(source).toContain("isCancelled: (): boolean => {");
    /*
     * And clears the flag on mount: StrictMode's development
     * mount/unmount/remount would otherwise latch it and cancel every run
     * before its first pass.
     */
    expect(source).toContain("isCancelledRef.current = false;");
  });

  it("reports the merged outcome, not just the final pass", () => {
    expect(code()).toContain("setResult(outcome.result)");
  });

  it("says the import is still going while passes are chaining", () => {
    const source: string = code();

    expect(source).toContain("RuleRunResultUtil.describeAutoImportProgress(");
    expect(source).toContain(
      "description={isRunning && progress ? progress : description}",
    );
  });

  /*
   * A part-way failure leaves real imports behind. The report must still be
   * shown, with the error alongside it rather than instead of it.
   */
  it("keeps the report visible when a pass failed", () => {
    const reportBlock: string = code().split("if (result) {")[1] || "";

    expect(reportBlock).toContain("error={error || undefined}");
  });
});
