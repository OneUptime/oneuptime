import AutoImportRunChain, {
  AutoImportRunChainOutcome,
} from "../../../Utils/NetworkAutomation/AutoImportRunChain";
import {
  AutoImportRuleRunResult,
  MAX_AUTO_IMPORT_RUN_PASSES,
} from "../../../Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it } from "@jest/globals";

/*
 * One press of "Run Rule" drives as many capped server passes as the estate
 * needs. Before OneUptime issue #3642 it drove exactly one, so a 909-device
 * estate imported 500 and stopped — with the remainder reachable only by an
 * operator who noticed the cap line and pressed the button again.
 *
 * The loop's exits are the whole contract: done, no progress, cancelled, or
 * the chain's own ceiling. Each one is asserted here, with no renderer in the
 * import graph.
 */

function pass(
  overrides: Partial<AutoImportRuleRunResult>,
): AutoImportRuleRunResult {
  return {
    hostsEvaluated: 0,
    hostsMatched: 0,
    hostsExcluded: 0,
    hostsSkippedAlreadyRegistered: 0,
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

// Answers with the given passes in order, then repeats the last one forever.
function serve(responses: Array<AutoImportRuleRunResult | null>): {
  runPass: () => Promise<AutoImportRuleRunResult | null>;
  calls: () => number;
} {
  let index: number = 0;

  return {
    calls: (): number => {
      return index;
    },
    runPass: async (): Promise<AutoImportRuleRunResult | null> => {
      const answer: AutoImportRuleRunResult | null =
        responses[Math.min(index, responses.length - 1)] ?? null;
      index++;
      return answer;
    },
  };
}

describe("AutoImportRunChain", () => {
  /*
   * The issue, reproduced at the seam that fixes it: the server can only do
   * 500 at a time, the estate is 909, and one press has to finish it.
   */
  it("keeps running passes until the server stops reporting truncation", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({
        hostsEvaluated: 909,
        hostsMatched: 909,
        devicesCreated: 500,
        hostsPendingImport: 409,
        isTruncated: true,
      }),
      pass({
        hostsEvaluated: 909,
        hostsMatched: 909,
        hostsSkippedAlreadyRegistered: 500,
        devicesCreated: 409,
      }),
    ]);

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      runPass: server.runPass,
    });

    expect(server.calls()).toBe(2);
    expect(outcome.passCount).toBe(2);
    expect(outcome.result?.devicesCreated).toBe(909);
    expect(outcome.result?.isTruncated).toBe(false);
    expect(outcome.result?.hostsPendingImport).toBe(0);
  });

  it("stops after one pass when nothing was truncated", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({ devicesCreated: 3 }),
    ]);

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      runPass: server.runPass,
    });

    expect(server.calls()).toBe(1);
    expect(outcome.result?.devicesCreated).toBe(3);
  });

  /*
   * A pass that hit the cap without creating anything — every attempt failed,
   * or a concurrent sweep had already spent the project's budget — would fail
   * identically next time. Chaining into it would spin.
   */
  it("stops when a truncated pass made no progress", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({
        devicesCreated: 0,
        monitorsCreated: 0,
        devicesFailed: 500,
        hostsPendingImport: 409,
        isTruncated: true,
      }),
    ]);

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      runPass: server.runPass,
    });

    expect(server.calls()).toBe(1);
    expect(outcome.result?.isTruncated).toBe(true);
    // The remainder is still reported, so the operator is not left guessing.
    expect(outcome.result?.hostsPendingImport).toBe(409);
  });

  /*
   * A pass that halted monitor provisioning has proved the fault is systemic
   * (issue #3643). It creates nothing, so the no-progress exit already stops
   * the chain — pinned here because chaining into a halted run would repeat
   * the identical failure up to the pass ceiling.
   */
  it("does not chain past a run that halted monitor provisioning", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({
        monitorsFailed: 500,
        monitorProvisioningHalted: true,
        monitorFailureReasons: [
          "This rule's Monitor Template could not be loaded.",
        ],
        monitorsPendingCreation: 409,
        isTruncated: true,
      }),
    ]);

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      runPass: server.runPass,
    });

    expect(server.calls()).toBe(1);
    expect(outcome.result?.monitorProvisioningHalted).toBe(true);
    expect(outcome.result?.monitorFailureReasons).toHaveLength(1);
  });

  // A monitor-only pass IS progress, even with zero devices created.
  it("keeps going when only monitors were created", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({
        monitorsCreated: 500,
        monitorsPendingCreation: 409,
        isTruncated: true,
      }),
      pass({ monitorsCreated: 409 }),
    ]);

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      runPass: server.runPass,
    });

    expect(server.calls()).toBe(2);
    expect(outcome.result?.monitorsCreated).toBe(909);
    expect(outcome.result?.monitorsPendingCreation).toBe(0);
  });

  /*
   * A dry run writes nothing, so the next pass would evaluate the identical
   * estate and answer identically. Chaining it would be an infinite loop that
   * accomplishes nothing.
   */
  it("never chains a dry run", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({ isDryRun: true, isTruncated: true, monitorsWouldCreate: 500 }),
    ]);

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: true,
      runPass: server.runPass,
    });

    expect(server.calls()).toBe(1);
    expect(outcome.result?.isTruncated).toBe(true);
  });

  /*
   * "One press finishes the job" must not mean "one press runs for an hour".
   * Past the ceiling the operator gets a report of what is left and decides.
   */
  it("stops at its own ceiling and reports what is left", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({ devicesCreated: 500, hostsPendingImport: 400, isTruncated: true }),
    ]);

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      maxPasses: 3,
      runPass: server.runPass,
    });

    expect(server.calls()).toBe(3);
    expect(outcome.passCount).toBe(3);
    expect(outcome.result?.devicesCreated).toBe(1500);
    expect(outcome.result?.isTruncated).toBe(true);
    expect(outcome.result?.hostsPendingImport).toBe(400);
  });

  it("defaults to the shared pass ceiling", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({ devicesCreated: 1, hostsPendingImport: 1, isTruncated: true }),
    ]);

    await AutoImportRunChain.run({ isDryRun: false, runPass: server.runPass });

    expect(server.calls()).toBe(MAX_AUTO_IMPORT_RUN_PASSES);
  });

  /*
   * A failed pass does not undo the ones before it: 500 devices really were
   * imported, and throwing that summary away would leave the operator less
   * informed than before they pressed the button.
   */
  it("keeps earlier passes when a later one fails", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({ devicesCreated: 500, hostsPendingImport: 409, isTruncated: true }),
      null,
    ]);

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      runPass: server.runPass,
    });

    expect(server.calls()).toBe(2);
    expect(outcome.passCount).toBe(1);
    expect(outcome.result?.devicesCreated).toBe(500);
  });

  it("has nothing to report when the very first pass fails", async () => {
    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      runPass: async (): Promise<AutoImportRuleRunResult | null> => {
        return null;
      },
    });

    expect(outcome.result).toBeNull();
    expect(outcome.passCount).toBe(0);
  });

  // Closing the dialog must not leave a chain importing behind the operator.
  it("stops chaining once cancelled", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({ devicesCreated: 500, hostsPendingImport: 409, isTruncated: true }),
    ]);
    let cancelled: boolean = false;

    const outcome: AutoImportRunChainOutcome = await AutoImportRunChain.run({
      isDryRun: false,
      runPass: async (): Promise<AutoImportRuleRunResult | null> => {
        cancelled = true;
        return server.runPass();
      },
      isCancelled: (): boolean => {
        return cancelled;
      },
    });

    expect(server.calls()).toBe(1);
    expect(outcome.wasCancelled).toBe(true);
    // What the one completed pass did is still accounted for.
    expect(outcome.result?.devicesCreated).toBe(500);
  });

  it("reports progress after each truncated pass, never after the last", async () => {
    const server: ReturnType<typeof serve> = serve([
      pass({ devicesCreated: 500, hostsPendingImport: 409, isTruncated: true }),
      pass({ devicesCreated: 409 }),
    ]);
    const progressSeen: Array<number> = [];

    await AutoImportRunChain.run({
      isDryRun: false,
      runPass: server.runPass,
      onProgress: (progress: AutoImportRuleRunResult): void => {
        progressSeen.push(progress.devicesCreated);
      },
    });

    expect(progressSeen).toEqual([500]);
  });
});
