import BlockAddressStepCheck, {
  BLOCK_APPLYING_RECHECK_MINUTES,
  decideBlockAddress,
  getBlockSince,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/BlockAddressStepCheck";
import { AddressBlockEvidence } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressBlocks";
import { AddressCoverage } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressRequests";
import {
  STEP_CHECK_DOCS_PATH,
  StepCheckResult,
  StepCheckTarget,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import { settleStepCheck } from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import { ResponseLinkKind } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  CHECK_BLOCK_ENFORCED_AT,
  CHECK_BLOCK_NOT_ENFORCED,
  CHECK_BLOCK_NOT_PROOF,
  CHECK_BLOCK_QUIET,
  CHECK_BLOCK_QUIET_SINCE,
  CHECK_BLOCK_REGRESSED,
  CHECK_BLOCK_SINCE_AGAIN,
  CHECK_BLOCK_STILL_REACHING,
  CHECK_CANNOT_ADDRESS_IS_PROXY,
  CHECK_CANNOT_LOAD_BALANCER_ADDRESSES,
  CHECK_CANNOT_NO_CLIENT_ADDRESS,
  CHECK_CANNOT_NO_TELEMETRY,
  CHECK_CANNOT_NO_TRAFFIC,
  CHECK_CANNOT_PROXY_ADDRESSES,
  CHECK_CANNOT_READ_FAILED,
  CHECK_FACT_SEEN_ADDRESSES,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  ADDRESS,
  AppRequest,
  DETECTED_AT,
  MINUTE,
  RecordingEvidence,
  at,
  context,
  fakeEvidence,
  planStep,
  previousCheck,
  requests,
  stepTarget,
  tick,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * "Block 35.196.249.14 at your firewall, WAF or load balancer" (#10340),
 * checked against the app's own requests from the address: whether they
 * still reach it. A block made anywhere - in the firewall by hand, at a
 * CDN - shows the same way, as the requests stopping; one OneUptime made
 * at a destination it reads back is Verified. An address that keeps
 * sending is not blocked; one that sends again after it was blocked has
 * stopped holding; and one OneUptime cannot see says why.
 */

const KEY: string = `contain:block-ip:${ADDRESS}`;

function target(
  overrides: Partial<Parameters<typeof stepTarget>[0]> = {},
): StepCheckTarget {
  return stepTarget({ step: planStep(KEY, ADDRESS), ...overrides });
}

async function check(data: {
  appRequests?: Array<AppRequest>;
  minute: number;
  target?: StepCheckTarget;
  evidence?: Parameters<typeof fakeEvidence>[0];
}): Promise<{ result: StepCheckResult; recording: RecordingEvidence }> {
  const recording: RecordingEvidence = fakeEvidence({
    appRequests: data.appRequests || [],
    ...data.evidence,
  });
  const result: StepCheckResult | null = await BlockAddressStepCheck.check(
    context({
      target: data.target || target(),
      evidence: recording.evidence,
      minute: data.minute,
    }),
  );

  expect(result).not.toBeNull();

  return { result: result!, recording };
}

// A scanner that sent a request a minute for the first twenty minutes.
const SCANNED: Array<AppRequest> = requests(21, { minute: 0, status: 404 });

describe("while the address still reaches the app", () => {
  test("is not done, and says how many requests came in the last half hour and when the latest did", async () => {
    const { result } = await check({
      appRequests: requests(41, { minute: 0, status: 404 }),
      minute: 45,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_BLOCK_STILL_REACHING,
      values: { address: ADDRESS },
      times: { latest: at(40).toISOString() },
      count: 26,
    });
  });

  test("reads the requests from an hour before the case's first detection to now, asking about no moment while nobody ticked it", async () => {
    const { recording } = await check({ appRequests: SCANNED, minute: 25 });

    expect(recording.reads[1]).toEqual({
      reader: "readAddressRequests",
      asked: {
        address: ADDRESS,
        start: new Date(DETECTED_AT.getTime() - 60 * MINUTE),
        end: at(25),
        since: null,
      },
    });
  });
});

describe("an address that went quiet", () => {
  test("looks done after half an hour without a request, saying how many it sent in the hour before, and that it proves nothing", async () => {
    const { result } = await check({ appRequests: SCANNED, minute: 60 });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_BLOCK_QUIET,
      values: { address: ADDRESS },
      times: { since: at(20).toISOString() },
      count: 21,
    });
    expect(result.evidence.facts).toEqual([
      { template: CHECK_BLOCK_NOT_PROOF, values: {} },
    ]);
    expect(result.evidence.data["doneSince"]).toBe(at(20).toISOString());
  });

  test("is not done yet after twenty minutes of quiet: an address that pauses is no block", async () => {
    const { result } = await check({ appRequests: SCANNED, minute: 40 });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
  });

  test("still looks done when the hour before could not be counted, saying since when it is quiet", async () => {
    const { result } = await check({
      appRequests: SCANNED,
      minute: 60,
      evidence: { failing: ["countAddressRequests"] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence.template).toBe(CHECK_BLOCK_QUIET_SINCE);
  });
});

describe("a block made by hand, outside OneUptime, and then proven by the requests", () => {
  // The analyst blocked it at their own firewall at minute 25, and ticked the step.
  const BLOCKED_BY_HAND: Array<AppRequest> = requests(25, {
    minute: 0,
    status: 404,
  });

  test("looks done as soon as no request came after the tick, without waiting half an hour", async () => {
    const { result, recording } = await check({
      appRequests: BLOCKED_BY_HAND,
      minute: 35,
      target: target({ task: tick(KEY, 25) }),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    // Counted from the tick and the two minutes a rule takes to reach every node.
    expect((recording.reads[1]!.asked as { since: Date | null }).since).toEqual(
      at(27),
    );
    expect(result.evidence.data["doneSince"]).toBe(at(25).toISOString());
  });

  test("a request in the two minutes after the tick is the rule still reaching every node, not a block that failed", async () => {
    const { result } = await check({
      appRequests: [...BLOCKED_BY_HAND, { minute: 26, status: 404 }],
      minute: 35,
      target: target({ task: tick(KEY, 25) }),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
  });

  test("is verified once a destination OneUptime reads back holds the block, from the later of the tick and the block", async () => {
    const block: AddressBlockEvidence = {
      destination: "Cloudflare",
      appliedAt: at(30),
      sentence: {
        template: "{{address}} is blocked at Cloudflare.",
        values: {},
      },
      link: {
        kind: ResponseLinkKind.OpenProvider,
        provider: "Cloudflare",
        url: "https://dash.cloudflare.com/",
      },
    };
    const { result } = await check({
      appRequests: BLOCKED_BY_HAND,
      minute: 40,
      target: target({ task: tick(KEY, 25) }),
      evidence: { blocks: [block] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toEqual(block.sentence);
    expect(result.evidence.links).toEqual([block.link]);
    expect(result.evidence.data["doneSince"]).toBe(at(30).toISOString());
    expect(result.evidence.data["destination"]).toBe("Cloudflare");
  });

  /*
   * #10562: the Blocklist that cannot be read says nothing either way - the
   * step says OneUptime could not check it just now and looks again soon,
   * never "not blocked", and never judges by the requests as if no block
   * were there.
   */
  test("a Blocklist that cannot be read: OneUptime could not check it just now, and looks again in two minutes", async () => {
    const { result, recording } = await check({
      appRequests: BLOCKED_BY_HAND,
      minute: 35,
      target: target({ task: tick(KEY, 25) }),
      evidence: { failing: ["readAddressBlocks"] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_CANNOT_READ_FAILED,
      values: {},
    });
    expect(result.evidence.data["readFailed"]).toBe(true);
    expect(result.recheckInMinutes).toBe(2);
    // The requests are not read once the Blocklist could not be.
    expect(
      recording.reads.map((read: { reader: string }): string => {
        return read.reader;
      }),
    ).toEqual(["readAddressBlocks"]);
  });

  test("a step that stopped holding stays so through a Blocklist that cannot be read", async () => {
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: KEY,
      state: SecurityCaseStepCheckState.Regressed,
      evidence: {
        sentence: {
          template: CHECK_BLOCK_REGRESSED,
          values: { address: ADDRESS },
        },
        facts: [],
        links: [],
        data: { regressedAt: at(38).toISOString() },
      },
      stateSince: at(40),
    });
    const { result } = await check({
      appRequests: BLOCKED_BY_HAND,
      minute: 45,
      target: target({ task: tick(KEY, 25), previous }),
      evidence: { failing: ["readAddressBlocks"] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(
      settleStepCheck({
        previous,
        result,
        now: at(45),
        intervalInMinutes: BlockAddressStepCheck.intervalInMinutes,
      }).state,
    ).toBe(SecurityCaseStepCheckState.Regressed);
  });
});

/*
 * #10562: a block the Blocklist records that no destination holds is never
 * the address blocked. The step says it beside what the requests say, and
 * looks again within a minute while a destination is still applying it.
 */
describe("a block the Blocklist records that nothing holds", () => {
  // The address sent a request a minute until minute 25, when the step was ticked.
  const BLOCKED_BY_HAND: Array<AppRequest> = requests(25, {
    minute: 0,
    status: 404,
  });
  const recorded: (isApplying: boolean) => AddressBlockEvidence = (
    isApplying: boolean,
  ): AddressBlockEvidence => {
    return {
      destination: "",
      appliedAt: at(26),
      sentence: {
        template: CHECK_BLOCK_NOT_ENFORCED,
        values: { value: ADDRESS },
      },
      link: { kind: ResponseLinkKind.OpenBlocklist, value: ADDRESS },
      isNotEnforced: true,
      isApplying,
    };
  };

  test("never verifies the step: a quiet address after a tick still only looks done, and says the block holds nowhere", async () => {
    const { result } = await check({
      appRequests: BLOCKED_BY_HAND,
      minute: 35,
      target: target({ task: tick(KEY, 25) }),
      evidence: { blocks: [recorded(false)] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.facts[0]).toEqual({
      template: CHECK_BLOCK_NOT_ENFORCED,
      values: { value: ADDRESS },
    });
    expect(result.evidence.links).toContainEqual({
      kind: ResponseLinkKind.OpenBlocklist,
      value: ADDRESS,
    });
    expect(result.evidence.data["isBlockNotEnforced"]).toBe(true);
    expect(result.recheckInMinutes).toBeUndefined();
  });

  test("an address that still reaches the app is not done yet, with the block said to hold nowhere", async () => {
    const { result } = await check({
      appRequests: requests(41, { minute: 0, status: 404 }),
      minute: 45,
      evidence: { blocks: [recorded(false)] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.facts).toContainEqual({
      template: CHECK_BLOCK_NOT_ENFORCED,
      values: { value: ADDRESS },
    });
  });

  test("while a destination is still applying it, the step is checked again within a minute", async () => {
    const { result } = await check({
      appRequests: requests(41, { minute: 0, status: 404 }),
      minute: 45,
      evidence: { blocks: [recorded(true)] },
    });

    expect(result.recheckInMinutes).toBe(BLOCK_APPLYING_RECHECK_MINUTES);
    expect(BLOCK_APPLYING_RECHECK_MINUTES).toBe(1);
  });

  test("a block a destination holds beside one it does not: verified by the one that holds", async () => {
    const held: AddressBlockEvidence = {
      destination: "Cloudflare",
      appliedAt: at(30),
      sentence: {
        template: CHECK_BLOCK_ENFORCED_AT,
        values: { address: ADDRESS, destination: "Cloudflare" },
      },
      link: { kind: ResponseLinkKind.OpenBlocklist, value: ADDRESS },
    };
    const { result } = await check({
      appRequests: BLOCKED_BY_HAND,
      minute: 40,
      target: target({ task: tick(KEY, 25) }),
      evidence: { blocks: [recorded(true), held] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toEqual(held.sentence);
    expect(result.evidence.facts).not.toContainEqual(recorded(true).sentence);
    expect(result.recheckInMinutes).toBeUndefined();
  });

  test("the moment requests are counted from is the block a destination holds, never one it only records", () => {
    expect(
      getBlockSince({ target: target(), blocks: [recorded(true)] }),
    ).toBeNull();
  });
});

describe("a block that stops holding", () => {
  // OneUptime saw the address go quiet at minute 20: the block looked done.
  const QUIET: StepCheckResult = decideBlockAddress({
    address: ADDRESS,
    now: at(60),
    target: target(),
    blocks: [],
    reading: null,
    coverage: null,
    hourBefore: null,
  });

  async function heldThenSent(minute: number): Promise<StepCheckResult> {
    const looksDone: StepCheckResult = (
      await check({ appRequests: SCANNED, minute: 60 })
    ).result;

    return (
      await check({
        appRequests: [
          ...SCANNED,
          ...requests(6, { minute: 70, status: 200, traceId: "trace" }),
        ],
        minute,
        target: target({
          previous: previousCheck({
            stepKey: KEY,
            state: looksDone.state,
            evidence: looksDone.evidence,
            stateSince: at(60),
          }),
        }),
      })
    ).result;
  }

  test("a read that fails can never say it holds (control)", () => {
    expect(QUIET.state).toBe(SecurityCaseStepCheckState.CannotTell);
  });

  test("is Regressed when the address gets through again, from the first request after it held, with their traces", async () => {
    const result: StepCheckResult = await heldThenSent(76);

    expect(result.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_BLOCK_REGRESSED,
      values: { address: ADDRESS },
      times: { time: at(70).toISOString() },
    });
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_BLOCK_SINCE_AGAIN,
        values: { address: ADDRESS },
        times: { time: at(70).toISOString() },
        count: 6,
      },
    ]);
    expect(result.evidence.links).toEqual([
      {
        kind: ResponseLinkKind.OpenTraces,
        traceIds: [
          "trace-0",
          "trace-1",
          "trace-2",
          "trace-3",
          "trace-4",
          "trace-5",
        ],
        startTime: new Date(DETECTED_AT.getTime() - 60 * MINUTE).toISOString(),
        endTime: at(76).toISOString(),
      },
    ]);
    expect(result.evidence.data["regressedAt"]).toBe(at(70).toISOString());
  });

  test("stays the same regression while the address keeps coming, so the people on the case are told once", async () => {
    const first: StepCheckResult = await heldThenSent(76);
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: KEY,
      state: first.state,
      evidence: first.evidence,
      stateSince: at(76),
    });
    const { result: again } = await check({
      appRequests: [
        ...SCANNED,
        ...requests(10, { minute: 70, status: 200, traceId: "trace" }),
      ],
      minute: 81,
      target: target({ previous }),
    });

    expect(again.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(again.evidence.data["regressedAt"]).toBe(at(70).toISOString());
    expect(
      settleStepCheck({
        previous,
        result: again,
        now: at(81),
        intervalInMinutes: BlockAddressStepCheck.intervalInMinutes,
      }).isNewRegression,
    ).toBe(false);
  });

  test("holds again once the address is quiet for half an hour", async () => {
    const first: StepCheckResult = await heldThenSent(76);
    const { result } = await check({
      appRequests: [
        ...SCANNED,
        ...requests(6, { minute: 70, status: 200, traceId: "trace" }),
      ],
      minute: 110,
      target: target({
        previous: previousCheck({
          stepKey: KEY,
          state: first.state,
          evidence: first.evidence,
          stateSince: at(76),
        }),
      }),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
  });

  test("a tick after it stopped holding is judged from the new tick: getting through again is a new regression", async () => {
    const first: StepCheckResult = await heldThenSent(76);
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: KEY,
      state: first.state,
      evidence: first.evidence,
      stateSince: at(76),
    });
    const { result } = await check({
      appRequests: [
        ...SCANNED,
        ...requests(6, { minute: 70, status: 200, traceId: "trace" }),
        { minute: 95, status: 200, traceId: "again" },
      ],
      minute: 96,
      target: target({ previous, task: tick(KEY, 90) }),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(result.evidence.data["regressedAt"]).toBe(at(95).toISOString());
    expect(
      settleStepCheck({
        previous,
        result,
        now: at(96),
        intervalInMinutes: BlockAddressStepCheck.intervalInMinutes,
      }).isNewRegression,
    ).toBe(true);
  });

  test("a read that fails after it stopped holding keeps it Regressed: not being able to read is no sign it holds", async () => {
    const first: StepCheckResult = await heldThenSent(76);
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: KEY,
      state: first.state,
      evidence: first.evidence,
      stateSince: at(76),
    });
    const { result } = await check({
      minute: 81,
      target: target({ previous }),
      evidence: { failing: ["readAddressRequests"] },
    });
    const settled: ReturnType<typeof settleStepCheck> = settleStepCheck({
      previous,
      result,
      now: at(81),
      intervalInMinutes: BlockAddressStepCheck.intervalInMinutes,
    });

    expect(settled.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(settled.stateSince).toEqual(at(76));
    expect(settled.isNewRegression).toBe(false);
  });
});

describe("what OneUptime cannot tell, and why", () => {
  test.each([
    [
      AddressCoverage.NoTelemetry,
      CHECK_CANNOT_NO_TELEMETRY,
      { address: ADDRESS },
    ],
    [AddressCoverage.NoClientAddress, CHECK_CANNOT_NO_CLIENT_ADDRESS, {}],
    [AddressCoverage.ProxyAddresses, CHECK_CANNOT_PROXY_ADDRESSES, {}],
    [
      AddressCoverage.LoadBalancerAddresses,
      CHECK_CANNOT_LOAD_BALANCER_ADDRESSES,
      {},
    ],
  ])(
    "no request from the address, and the app's traces say %s: it says so, with the docs",
    async (
      coverage: AddressCoverage,
      template: string,
      values: Record<string, string>,
    ) => {
      const { result } = await check({
        minute: 30,
        evidence: {
          coverage: {
            coverage,
            topAddresses: ["104.16.1.1", "104.16.1.2"],
            addressCount: 2,
          },
        },
      });

      expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
      expect(result.evidence.sentence).toEqual({ template, values });
      expect(result.evidence.docsPath).toBe(STEP_CHECK_DOCS_PATH);
      expect(result.evidence.facts).toEqual([
        {
          template: CHECK_FACT_SEEN_ADDRESSES,
          values: { address: "104.16.1.1" },
          count: 2,
        },
      ]);
    },
  );

  test("an address the app's traces could show, that never reached it: going quiet would mean nothing", async () => {
    const { result } = await check({ minute: 30 });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_CANNOT_NO_TRAFFIC,
      values: { address: ADDRESS },
    });
    expect(result.evidence.docsPath).toBeUndefined();
    expect(result.evidence.facts).toEqual([]);
  });

  test("the app's requests that cannot be read are never read as no requests: it tries again in two minutes", async () => {
    const { result } = await check({
      appRequests: SCANNED,
      minute: 60,
      evidence: { failing: ["readAddressRequests"] },
    });

    expect(result).toEqual({
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: {
        sentence: { template: CHECK_CANNOT_READ_FAILED, values: {} },
        facts: [],
        links: [],
        data: { readFailed: true },
      },
      recheckInMinutes: 2,
    });
  });

  test("no request and a coverage that cannot be read is no answer either", async () => {
    const { result } = await check({
      minute: 30,
      evidence: { failing: ["readAddressCoverage"] },
    });

    expect(result.evidence.data["readFailed"]).toBe(true);
  });

  test("a Cloudflare address is how visitors reach the app, not who sent the requests: nothing is read", async () => {
    const recording: RecordingEvidence = fakeEvidence({});
    const result: StepCheckResult | null = await BlockAddressStepCheck.check(
      context({
        target: stepTarget({
          step: planStep("contain:block-ip:104.16.0.1", "104.16.0.1"),
        }),
        evidence: recording.evidence,
        minute: 30,
      }),
    );

    expect(result?.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result?.evidence.sentence).toEqual({
      template: CHECK_CANNOT_ADDRESS_IS_PROXY,
      values: { address: "104.16.0.1" },
    });
    expect(recording.reads).toEqual([]);
  });

  test("a step about no address is not one it checks", async () => {
    const result: StepCheckResult | null = await BlockAddressStepCheck.check(
      context({
        target: stepTarget({ step: planStep("contain:block-ip:") }),
        evidence: fakeEvidence({}).evidence,
        minute: 30,
      }),
    );

    expect(result).toBeNull();
  });
});

describe("the moment requests are counted from", () => {
  test("is the later of the tick and the newest block in force, and the grace after it", () => {
    expect(
      getBlockSince({
        target: target({ task: tick(KEY, 25) }),
        blocks: [
          {
            destination: "Cloudflare",
            appliedAt: at(31),
            sentence: { template: "", values: {} },
          },
        ],
      }),
    ).toEqual(at(33));
  });

  test("is nothing while nobody said the step is done", () => {
    expect(getBlockSince({ target: target(), blocks: [] })).toBeNull();
  });
});
