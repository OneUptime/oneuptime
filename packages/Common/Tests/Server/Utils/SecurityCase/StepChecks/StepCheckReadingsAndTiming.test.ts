import { getAddressWindow } from "../../../../../Server/Utils/SecurityCase/StepChecks/AddressStepChecks";
import {
  AddressCoverage,
  AddressRequestsSourceReading,
  EMPTY_SOURCE_READING,
  buildLogRequestsStatement,
  buildSpanRequestsStatement,
  getAddressCoverage,
  getLogJsonClientNeedles,
  isProxyAddress,
  mergeSourceReadings,
  readSourceRow,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressRequests";
import {
  getCaseNextStepCheckAt,
  settleStepCheck,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import {
  STEP_CHECK_MAX_INTERVAL_IN_MINUTES,
  StepCheckResult,
  evidenceOf,
  getDoneSince,
  getNextCheckAt,
  isStillRegressed,
  sentence,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import { getStepCheck } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheckRegistry";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  ProxyKind,
  getProxyKind,
  getProxyOfAddresses,
  isAddressInRange,
} from "../../../../../Utils/SecurityCase/ProxyAddresses";
import {
  ADDRESS,
  CASE_ID,
  DETECTED_AT,
  MINUTE,
  PROJECT_ID,
  at,
  planStep,
  previousCheck,
  stepCheckCase,
  stepTarget,
  tick,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * What every step check (#10340) shares: when a step counts as done, when
 * it is read again, how a result is kept - a step that stopped holding
 * stays so through a read that failed, and is told once - and how the
 * app's requests are read: bounded statements whose address is a
 * parameter, never SQL, and a read that runs out of time fails.
 */

const KEY: string = `contain:block-ip:${ADDRESS}`;
const HELD: StepCheckResult = {
  state: SecurityCaseStepCheckState.LooksDone,
  evidence: evidenceOf({
    sentence: sentence("quiet"),
    data: { doneSince: at(20) },
  }),
};
const REGRESSED: StepCheckResult = {
  state: SecurityCaseStepCheckState.Regressed,
  evidence: evidenceOf({
    sentence: sentence("again"),
    data: { regressedAt: at(70) },
  }),
};

describe("since when a step is done", () => {
  test("is the later of a person's tick and the moment OneUptime saw it hold", () => {
    expect(
      getDoneSince(
        stepTarget({
          step: planStep(KEY, ADDRESS),
          task: tick(KEY, 10),
          previous: previousCheck({
            stepKey: KEY,
            state: HELD.state,
            evidence: HELD.evidence,
            stateSince: at(60),
          }),
        }),
      ),
    ).toEqual(at(20));
    expect(
      getDoneSince(stepTarget({ step: planStep(KEY), task: tick(KEY, 25) })),
    ).toEqual(at(25));
  });

  test("a tick from before it stopped holding is spent; one after says it is dealt with", () => {
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: KEY,
      state: REGRESSED.state,
      evidence: REGRESSED.evidence,
      stateSince: at(76),
    });

    expect(
      getDoneSince(
        stepTarget({ step: planStep(KEY), previous, task: tick(KEY, 10) }),
      ),
    ).toBeNull();
    expect(
      isStillRegressed(
        stepTarget({ step: planStep(KEY), previous, task: tick(KEY, 10) }),
      ),
    ).toBe(true);
    expect(
      getDoneSince(
        stepTarget({ step: planStep(KEY), previous, task: tick(KEY, 90) }),
      ),
    ).toEqual(at(90));
    expect(
      isStillRegressed(
        stepTarget({ step: planStep(KEY), previous, task: tick(KEY, 90) }),
      ),
    ).toBe(false);
  });

  test("nobody said so: nothing", () => {
    expect(getDoneSince(stepTarget({ step: planStep(KEY) }))).toBeNull();
  });
});

describe("how a result is kept", () => {
  test("keeps the moment a step got into its state for as long as it stays in it", () => {
    const settled: ReturnType<typeof settleStepCheck> = settleStepCheck({
      previous: previousCheck({
        stepKey: KEY,
        state: HELD.state,
        evidence: HELD.evidence,
        stateSince: at(60),
      }),
      result: HELD,
      now: at(70),
      intervalInMinutes: 5,
    });

    expect(settled.stateSince).toEqual(at(60));
    expect(settled.nextCheckAt).toEqual(at(75));
    expect(settled.isNewRegression).toBe(false);
  });

  test("a step that stops holding is a new regression once; the same one again is not", () => {
    const first: ReturnType<typeof settleStepCheck> = settleStepCheck({
      previous: previousCheck({
        stepKey: KEY,
        state: HELD.state,
        evidence: HELD.evidence,
        stateSince: at(60),
      }),
      result: REGRESSED,
      now: at(76),
      intervalInMinutes: 5,
    });

    expect(first.isNewRegression).toBe(true);
    expect(first.stateSince).toEqual(at(76));
    expect(
      settleStepCheck({
        previous: previousCheck({
          stepKey: KEY,
          state: REGRESSED.state,
          evidence: REGRESSED.evidence,
          stateSince: at(76),
        }),
        result: REGRESSED,
        now: at(81),
        intervalInMinutes: 5,
      }).isNewRegression,
    ).toBe(false);
  });

  test("a step that stopped holding stays so through a read that failed, and is read again soon", () => {
    const settled: ReturnType<typeof settleStepCheck> = settleStepCheck({
      previous: previousCheck({
        stepKey: KEY,
        state: REGRESSED.state,
        evidence: REGRESSED.evidence,
        stateSince: at(76),
      }),
      result: {
        state: SecurityCaseStepCheckState.CannotTell,
        evidence: evidenceOf({
          sentence: sentence("failed"),
          data: { readFailed: true },
        }),
        recheckInMinutes: 2,
      },
      now: at(81),
      intervalInMinutes: 5,
    });

    expect(settled.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(settled.evidence).toEqual(REGRESSED.evidence);
    expect(settled.nextCheckAt).toEqual(at(83));
  });
});

describe("when a step is read again", () => {
  test("at its kind's cadence while in flux, less often once it has held, never later than an hour", () => {
    const next: (
      state: SecurityCaseStepCheckState,
      heldMinutes: number,
    ) => number = (
      state: SecurityCaseStepCheckState,
      heldMinutes: number,
    ): number => {
      return (
        (getNextCheckAt({
          state,
          stateSince: at(0),
          now: at(heldMinutes),
          intervalInMinutes: 15,
        }).getTime() -
          at(heldMinutes).getTime()) /
        MINUTE
      );
    };

    expect(next(SecurityCaseStepCheckState.NotDone, 600)).toBe(15);
    expect(next(SecurityCaseStepCheckState.Verified, 30)).toBe(15);
    expect(next(SecurityCaseStepCheckState.Verified, 90)).toBe(45);
    expect(next(SecurityCaseStepCheckState.Verified, 25 * 60)).toBe(
      STEP_CHECK_MAX_INTERVAL_IN_MINUTES,
    );
    expect(next(SecurityCaseStepCheckState.NotNeeded, 90)).toBe(45);
  });

  test("a case is read at its soonest step, never in the past, and after half an hour with nothing due", () => {
    expect(
      getCaseNextStepCheckAt({ nextCheckAts: [at(30), at(25)], now: at(20) }),
    ).toEqual(at(25));
    expect(
      getCaseNextStepCheckAt({ nextCheckAts: [at(10)], now: at(20) }),
    ).toEqual(at(21));
    expect(getCaseNextStepCheckAt({ nextCheckAts: [], now: at(20) })).toEqual(
      at(50),
    );
  });

  test("an address's requests are read from an hour before the first detection, at most three days back", () => {
    expect(
      getAddressWindow({ securityCase: stepCheckCase(), now: at(30) }),
    ).toEqual({ start: at(-60), end: at(30) });
    expect(
      getAddressWindow({
        securityCase: stepCheckCase(),
        now: at(10 * 24 * 60),
      }).start,
    ).toEqual(at(7 * 24 * 60));
  });
});

describe("which check reads a step", () => {
  test.each([
    [`contain:block-ip:${ADDRESS}`, "contain:block-ip"],
    ["confirm:requests", "confirm:requests"],
    ["confirm:false-positive:rule-id", "confirm:false-positive"],
    ["contain:user:alice@acme.com", "contain:user"],
    ["contain:host:web-01", "contain:host"],
    ["contain:incident", "contain:incident"],
    // The Fix steps OneUptime can read back (#10347).
    ["fix:public-app", "fix:public-app"],
    ["fix:credentials", "fix:credentials"],
    ["fix:brute-force", "fix:brute-force"],
  ])("%s is checked by the %s check", (key: string, kind: string) => {
    expect(getStepCheck(key)?.kind).toBe(kind);
  });

  test.each([
    "confirm:take",
    "contain:mark-contained",
    "fix:account-changes",
    "fix:persistence",
    "close",
  ])(
    "%s is the case's own to say, or a person's: no check reads it",
    (key: string) => {
      expect(getStepCheck(key)).toBeNull();
    },
  );
});

describe("the app's requests from an address, as ClickHouse is asked for them", () => {
  const input: Parameters<typeof buildSpanRequestsStatement>[0] = {
    projectId: PROJECT_ID,
    address: "203.0.113.7",
    start: at(-60),
    end: at(30),
    since: at(20),
    recentSince: at(0),
  };

  test("the server spans whose client's address is the address, the address a parameter, never SQL", () => {
    const statement: Statement = buildSpanRequestsStatement(input);

    expect(statement.query).not.toContain("203.0.113.7");
    expect(Object.values(statement.query_params)).toContain(input.address);
    expect(Object.values(statement.query_params)).toContain("client.address");
    expect(Object.values(statement.query_params)).toContain("http.client_ip");
    // A read that runs out of time fails, so it is never read as "no requests".
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("an address written to break out of its quotes stays a value", () => {
    for (const statement of [
      buildSpanRequestsStatement({ ...input, address: "1.1.1.1' OR 1=1 --" }),
      buildLogRequestsStatement({ ...input, address: "1.1.1.1' OR 1=1 --" }),
    ]) {
      expect(statement.query).not.toContain("OR 1=1");
    }
  });

  test("the access log lines that start with the address or name it under a client field", () => {
    const statement: Statement = buildLogRequestsStatement(input);

    expect(statement.query).not.toContain("203.0.113.7");
    expect(Object.values(statement.query_params)).toContain(
      `${input.address} `,
    );
    expect(getLogJsonClientNeedles("203.0.113.7")).toContain(
      '"remote_addr":"203.0.113.7"',
    );
    expect(getLogJsonClientNeedles("203.0.113.7")).toContain(
      '"client_ip": "203.0.113.7"',
    );
  });

  test("a row read back: ClickHouse's epoch for no rows is no moment, and a count is whole", () => {
    expect(readSourceRow(undefined)).toEqual(EMPTY_SOURCE_READING);
    expect(
      readSourceRow({
        total: "3",
        firstSeen: "1970-01-01 00:00:00.000000000",
        lastSeen: "2026-11-17 19:20:00.000000000",
        afterSince: 1,
        rejected: 2,
        through: 1,
        unknown: 0,
        throughAfterSince: 1,
        recent: 1,
        throughTraceIds: ["t1", "", 7],
      }),
    ).toMatchObject({
      total: 3,
      firstSeenAt: null,
      lastSeenAt: at(20),
      throughTraceIds: ["t1"],
    });
  });

  test("traces and logs of the same requests are counted once: the larger of each, not their sum", () => {
    const spans: AddressRequestsSourceReading = {
      ...EMPTY_SOURCE_READING,
      total: 10,
      rejected: 10,
      lastSeenAt: at(20),
      throughTraceIds: [],
    };
    const logs: AddressRequestsSourceReading = {
      ...EMPTY_SOURCE_READING,
      total: 12,
      rejected: 11,
      through: 1,
      lastSeenAt: at(22),
      throughTraceIds: ["t1"],
    };

    expect(mergeSourceReadings(spans, logs)).toMatchObject({
      total: 12,
      rejected: 11,
      through: 1,
      lastSeenAt: at(22),
      throughTraceIds: ["t1"],
    });
  });
});

describe("what OneUptime can see of an app's requests by address", () => {
  test.each([
    [
      { serverSpans: 0, withAddress: 0, topAddresses: [], logs: 0 },
      AddressCoverage.NoTelemetry,
    ],
    [
      { serverSpans: 0, withAddress: 0, topAddresses: [], logs: 40 },
      AddressCoverage.Sees,
    ],
    [
      { serverSpans: 50, withAddress: 0, topAddresses: [], logs: 0 },
      AddressCoverage.NoClientAddress,
    ],
    [
      {
        serverSpans: 50,
        withAddress: 50,
        topAddresses: ["104.16.1.1", "172.64.2.2"],
        logs: 0,
      },
      AddressCoverage.ProxyAddresses,
    ],
    [
      {
        serverSpans: 50,
        withAddress: 50,
        topAddresses: ["10.0.1.12", "10.0.2.40"],
        logs: 0,
      },
      AddressCoverage.LoadBalancerAddresses,
    ],
    [
      {
        serverSpans: 50,
        withAddress: 50,
        topAddresses: ["104.16.1.1", "35.196.249.14"],
        logs: 0,
      },
      AddressCoverage.Sees,
    ],
  ])(
    "%j reads as %s",
    (
      data: Parameters<typeof getAddressCoverage>[0],
      coverage: AddressCoverage,
    ) => {
      expect(getAddressCoverage(data)).toBe(coverage);
    },
  );

  test("Cloudflare's published ranges, in IPv4 and IPv6, are a proxy's; a private address a load balancer's", () => {
    expect(getProxyKind("104.16.0.1")).toBe(ProxyKind.Cloudflare);
    expect(getProxyKind("2606:4700::6810:84e5")).toBe(ProxyKind.Cloudflare);
    expect(getProxyKind("10.0.0.4")).toBe(ProxyKind.LoadBalancer);
    expect(getProxyKind(ADDRESS)).toBeNull();
    expect(isProxyAddress("172.71.255.255")).toBe(true);
    expect(isProxyAddress("172.72.0.0")).toBe(false);
    expect(isAddressInRange("104.24.0.1", "104.24.0.0/14")).toBe(true);
    expect(isAddressInRange("not an address", "104.24.0.0/14")).toBe(false);
    expect(getProxyOfAddresses(["10.0.0.1", "104.16.0.1"])).toBeNull();
  });
});

// The constants the fixtures are read against (control).
test("the fixtures' case was first detected at DETECTED_AT", () => {
  expect(stepCheckCase().firstDetectedAt).toEqual(DETECTED_AT);
  expect(stepCheckCase().securityCaseId).toEqual(CASE_ID);
});
