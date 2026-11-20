import RequestsStepCheck, {
  getRequestsAddress,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/RequestsStepCheck";
import { settleStepCheck } from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import { StepCheckResult } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import { ResponseLinkKind } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  CHECK_CANNOT_ADDRESS_IS_PROXY,
  CHECK_CANNOT_NO_TELEMETRY,
  CHECK_CANNOT_NO_TRAFFIC_REQUESTS,
  CHECK_CANNOT_READ_FAILED,
  CHECK_REQUESTS_ALL_TURNED_AWAY,
  CHECK_REQUESTS_GOT_THROUGH,
  CHECK_REQUESTS_SINCE,
  CHECK_REQUESTS_SOME_UNREAD,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { AddressCoverage } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressRequests";
import {
  ADDRESS,
  AppRequest,
  DETECTED_AT,
  MINUTE,
  at,
  context,
  fakeEvidence,
  planStep,
  previousCheck,
  requests,
  stepCheckCase,
  stepTarget,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * "Check that nothing else from 35.196.249.14 got through" (#10340): every
 * request from the address since the case's first detection, as the app's
 * traces and logs say it ended - not only the ones the detections matched.
 * All turned away is proven; some got past the app's checks is not done;
 * a request whose answer cannot be read keeps it to Looks Done, never
 * Verified; and one that gets through after it held has stopped holding.
 */

const KEY: string = "confirm:requests";
const WINDOW_START: string = new Date(
  DETECTED_AT.getTime() - 60 * MINUTE,
).toISOString();

async function check(data: {
  appRequests?: Array<AppRequest>;
  minute: number;
  previous?: ReturnType<typeof previousCheck> | null;
  evidence?: Parameters<typeof fakeEvidence>[0];
  value?: string;
}): Promise<StepCheckResult> {
  const result: StepCheckResult | null = await RequestsStepCheck.check(
    context({
      target: stepTarget({
        step: planStep(KEY, data.value ?? ADDRESS),
        previous: data.previous || null,
      }),
      evidence: fakeEvidence({
        appRequests: data.appRequests || [],
        ...data.evidence,
      }).evidence,
      minute: data.minute,
    }),
  );

  expect(result).not.toBeNull();

  return result!;
}

// The scanner's twelve probes, every one turned away with a 404.
const TURNED_AWAY: Array<AppRequest> = requests(12, { minute: 0, status: 404 });

describe("how far the address's requests got", () => {
  test("every one turned away by the app is verified, counted since the case's first detection", async () => {
    const result: StepCheckResult = await check({
      appRequests: TURNED_AWAY,
      minute: 15,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_REQUESTS_ALL_TURNED_AWAY,
      values: { address: ADDRESS },
      count: 12,
    });
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_REQUESTS_SINCE,
        values: {},
        times: { time: WINDOW_START },
      },
    ]);
    expect(result.evidence.data).toMatchObject({
      doneSince: at(15).toISOString(),
      requests: 12,
      rejected: 12,
      unknown: 0,
    });
  });

  test("a request whose answer cannot be read keeps it to Looks Done: it is never taken as turned away", async () => {
    const result: StepCheckResult = await check({
      appRequests: [...TURNED_AWAY, { minute: 13, status: 0 }],
      minute: 15,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_REQUESTS_SOME_UNREAD,
      values: { address: ADDRESS },
      numbers: { rejected: 12 },
      count: 13,
    });
  });

  test("some answered by the app are not done: they got past its checks, and their traces are one click away", async () => {
    const result: StepCheckResult = await check({
      appRequests: [
        ...TURNED_AWAY,
        { minute: 13, status: 200, traceId: "trace-ok" },
      ],
      minute: 15,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_REQUESTS_GOT_THROUGH,
      values: { address: ADDRESS },
      numbers: { through: 1 },
      count: 13,
    });
    expect(result.evidence.links).toEqual([
      {
        kind: ResponseLinkKind.OpenTraces,
        traceIds: ["trace-ok"],
        startTime: WINDOW_START,
        endTime: at(15).toISOString(),
      },
    ]);
  });

  test.each([
    ["a 5xx the request broke something with", { status: 502 }],
    ["a failed span with no status", { status: 0, isFailed: true }],
    ["a redirect the app answered", { status: 302 }],
  ])(
    "%s got past the app's checks",
    async (_name: string, outcome: Partial<AppRequest>) => {
      const result: StepCheckResult = await check({
        appRequests: [...TURNED_AWAY, { minute: 13, status: 0, ...outcome }],
        minute: 15,
      });

      expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    },
  );

  test("keeps the moment it first held while it holds", async () => {
    const first: StepCheckResult = await check({
      appRequests: TURNED_AWAY,
      minute: 15,
    });
    const again: StepCheckResult = await check({
      appRequests: [...TURNED_AWAY, { minute: 20, status: 403 }],
      minute: 25,
      previous: previousCheck({
        stepKey: KEY,
        state: first.state,
        evidence: first.evidence,
        stateSince: at(15),
      }),
    });

    expect(again.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(again.evidence.data["doneSince"]).toBe(at(15).toISOString());
  });
});

describe("a request that gets through after it held", () => {
  test("is Regressed, from the first request past the app's checks after it held", async () => {
    const held: StepCheckResult = await check({
      appRequests: TURNED_AWAY,
      minute: 15,
    });
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: KEY,
      state: held.state,
      evidence: held.evidence,
      stateSince: at(15),
    });
    const result: StepCheckResult = await check({
      appRequests: [
        ...TURNED_AWAY,
        { minute: 30, status: 200, traceId: "trace-late" },
      ],
      minute: 31,
      previous,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(result.evidence.data["regressedAt"]).toBe(at(30).toISOString());
    expect(
      settleStepCheck({
        previous,
        result,
        now: at(31),
        intervalInMinutes: RequestsStepCheck.intervalInMinutes,
      }).isNewRegression,
    ).toBe(true);

    // Read again, it is the same regression: told once.
    const regressed: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: KEY,
      state: result.state,
      evidence: result.evidence,
      stateSince: at(31),
    });
    const again: StepCheckResult = await check({
      appRequests: [
        ...TURNED_AWAY,
        { minute: 30, status: 200, traceId: "trace-late" },
      ],
      minute: 40,
      previous: regressed,
    });

    expect(again.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(again.evidence.data["regressedAt"]).toBe(at(30).toISOString());
  });

  test("a request that got through before anyone said it held is simply not done", async () => {
    const result: StepCheckResult = await check({
      appRequests: [
        ...TURNED_AWAY,
        { minute: 5, status: 200, traceId: "trace-early" },
      ],
      minute: 15,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
  });
});

describe("what OneUptime cannot tell, and why", () => {
  test("no traces or logs from the app: it says so, with the docs", async () => {
    const result: StepCheckResult = await check({
      minute: 15,
      evidence: {
        coverage: {
          coverage: AddressCoverage.NoTelemetry,
          topAddresses: [],
          addressCount: 0,
        },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_CANNOT_NO_TELEMETRY,
      values: { address: ADDRESS },
    });
  });

  test("an address the app saw no request from: it cannot tell how far its requests got", async () => {
    const result: StepCheckResult = await check({ minute: 15 });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_CANNOT_NO_TRAFFIC_REQUESTS,
      values: { address: ADDRESS },
    });
  });

  test("requests that cannot be read are no answer", async () => {
    const result: StepCheckResult = await check({
      appRequests: TURNED_AWAY,
      minute: 15,
      evidence: { failing: ["readAddressRequests"] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence.template).toBe(CHECK_CANNOT_READ_FAILED);
  });

  test("a Cloudflare address says nothing about who sent the requests", async () => {
    const result: StepCheckResult = await check({
      minute: 15,
      value: "172.64.10.10",
    });

    expect(result.evidence.sentence).toEqual({
      template: CHECK_CANNOT_ADDRESS_IS_PROXY,
      values: { address: "172.64.10.10" },
    });
  });
});

describe("the address the step is about", () => {
  test("is the step's own, else the opening detection's group, else the case's first public address", () => {
    const target: ReturnType<typeof stepTarget> = stepTarget({
      step: planStep(KEY),
    });

    expect(
      getRequestsAddress({
        securityCase: stepCheckCase({
          entities: [
            { type: SecurityEntityType.IpAddress, value: "10.0.0.4" },
            { type: SecurityEntityType.IpAddress, value: "34.120.10.10" },
          ],
        }),
        target,
      }),
    ).toBe("34.120.10.10");
    expect(
      getRequestsAddress({
        securityCase: stepCheckCase({ entities: [] }),
        target,
      }),
    ).toBe("");
  });

  test("a case about no public address has no such step to check", async () => {
    const result: StepCheckResult | null = await RequestsStepCheck.check(
      context({
        target: stepTarget({ step: planStep(KEY) }),
        evidence: fakeEvidence({}).evidence,
        minute: 15,
        securityCase: {
          entities: [{ type: SecurityEntityType.IpAddress, value: "10.0.0.4" }],
        },
      }),
    );

    expect(result).toBeNull();
  });
});
