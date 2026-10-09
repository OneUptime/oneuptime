import ServerMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ServerMonitorCriteria";
import EvaluateOverTime from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import IncomingRequestCriteria from "../../../../../Server/Utils/Monitor/Criteria/IncomingRequestCriteria";
import IncomingEmailCriteria from "../../../../../Server/Utils/Monitor/Criteria/IncomingEmailCriteria";
import ReceivingCoverage from "../../../../../Server/Utils/Telemetry/ReceivingCoverage";
import ReceivingSilence, {
  MeasuredSilence,
} from "../../../../../Server/Utils/Monitor/ReceivingSilence";
import InstanceReceivingPeriodService from "../../../../../Server/Services/InstanceReceivingPeriodService";
import PostgresAppInstance from "../../../../../Server/Infrastructure/PostgresDatabase";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncomingEmailMonitorRequest from "../../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import ServerMonitorResponse from "../../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ReceivingGap,
  ReceivingGapReason,
} from "../../../../../Utils/Telemetry/ReceivingGaps";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Issue #2825: a server agent, a heartbeat sender or a mailbox cannot reach
 * OneUptime while OneUptime itself is not receiving. Each of the three checks
 * that turn silence into "offline" counts only the time OneUptime was
 * receiving - and stays exactly as strict as before when it was receiving
 * throughout.
 */

const MINUTE: number = 60_000;
const NOW: Date = new Date("2026-10-09T12:00:00.000Z");

function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

function gap(
  fromMinutesAgo: number,
  toMinutesAgo: number,
  reason: ReceivingGapReason = ReceivingGapReason.NotReceiving,
): ReceivingGap {
  return {
    startsAt: ago(fromMinutesAgo),
    endsAt: ago(toMinutesAgo),
    reason,
  };
}

let gapsSpy: SpyInstance<typeof ReceivingCoverage.getGaps>;

function givenGaps(gaps: Array<ReceivingGap>): void {
  gapsSpy.mockImplementation(
    async (data: { startsAt: Date; endsAt: Date }) => {
      return gaps.filter((g: ReceivingGap) => {
        return g.endsAt > data.startsAt && g.startsAt < data.endsAt;
      });
    },
  );
}

beforeEach(() => {
  ReceivingCoverage.clearCache();
  gapsSpy = jest.spyOn(ReceivingCoverage, "getGaps");
  givenGaps([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function serverResponse(minutesSinceLastCheck: number): DataToProcess {
  const response: ServerMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    hostname: "web-01",
    requestReceivedAt: ago(minutesSinceLastCheck),
    timeNow: NOW,
    onlyCheckRequestReceivedAt: true,
  };
  return response as DataToProcess;
}

const IS_OFFLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};

const IS_ONLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.True,
  value: undefined,
};

async function server(
  minutesSinceLastCheck: number,
  filter: CriteriaFilter,
): Promise<string | null> {
  return ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: serverResponse(minutesSinceLastCheck),
    criteriaFilter: filter,
  });
}

describe("Server monitor: Is Online counts only time OneUptime was receiving", () => {
  test("silent through an outage but not for 3 receiving minutes: still online", async () => {
    // Last check-in 12 minutes ago; OneUptime was down for 10 of them.
    givenGaps([gap(11, 1)]);
    expect(await server(12, IS_OFFLINE)).toBeNull();
    expect(await server(12, IS_ONLINE)).toContain("true");
  });

  test("silent for 3 receiving minutes after the outage: offline", async () => {
    givenGaps([gap(14, 4)]);
    // 15 minutes since the last check-in, 10 of them OneUptime was down.
    expect(await server(15, IS_OFFLINE)).toContain("false");
    expect(await server(15, IS_ONLINE)).toBeNull();
  });

  test("the reconnect grace and a backed-up queue count as not receiving too", async () => {
    givenGaps([
      gap(9, 4, ReceivingGapReason.NotReceiving),
      gap(4, 2, ReceivingGapReason.Reconnecting),
      gap(2, 0, ReceivingGapReason.CatchingUp),
    ]);
    // 10 wall minutes, but only 1 of them could OneUptime hear the agent.
    expect(await server(10, IS_OFFLINE)).toBeNull();
  });

  test("a gap that began before the last check-in only removes the part after it", async () => {
    givenGaps([gap(30, 5)]);
    // Last check-in 8 minutes ago, inside the gap: 5 receiving minutes since.
    expect(await server(8, IS_OFFLINE)).toContain("false");
  });

  test("with no gaps it is exactly as strict as before, at the threshold", async () => {
    expect(await server(3, IS_OFFLINE)).toContain("false");
    expect(await server(2, IS_OFFLINE)).toBeNull();
  });

  test("a recent check-in never asks when OneUptime was receiving", async () => {
    await server(1, IS_ONLINE);
    await server(2, IS_OFFLINE);
    expect(gapsSpy).not.toHaveBeenCalled();
  });

  test("a longer custom threshold is judged on receiving minutes too", async () => {
    givenGaps([gap(20, 8)]);
    const tenMinutes: CriteriaFilter = {
      ...IS_OFFLINE,
      evaluateOverTime: true,
      evaluateOverTimeOptions: { timeValueInMinutes: 10 },
    } as CriteriaFilter;
    /*
     * 21 wall minutes, 9 receiving: not yet. The over-time window has no
     * stored samples to read, so it falls through to the check-in time.
     */
    jest
      .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
      .mockResolvedValue({ earlyReturn: null, value: undefined });
    expect(await server(21, tenMinutes)).toBeNull();
    expect(await server(22, tenMinutes)).toContain("false");
  });

  test("a ledger that cannot be read leaves the check as strict as before (fails open)", async () => {
    gapsSpy.mockRestore();
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest
      .spyOn(InstanceReceivingPeriodService, "readLedger")
      .mockRejectedValue(new Error("connection refused"));
    expect(await server(12, IS_OFFLINE)).toContain("false");
  });
});

function incomingRequest(minutesSinceLastRequest: number): DataToProcess {
  const request: IncomingMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    incomingRequestReceivedAt: ago(minutesSinceLastRequest),
    checkedAt: NOW,
    onlyCheckForIncomingRequestReceivedAt: true,
  };
  return request as DataToProcess;
}

async function heartbeat(
  minutesSinceLastRequest: number,
  filterType: FilterType,
  value: number,
): Promise<string | null> {
  return IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: incomingRequest(minutesSinceLastRequest),
    criteriaFilter: {
      checkOn: CheckOn.IncomingRequest,
      filterType,
      value,
    },
  });
}

describe("Incoming request: received / not received in N minutes", () => {
  test("a cron job that could not reach OneUptime during an upgrade is not late", async () => {
    /*
     * Pings every 5 minutes; the ones 8 and 3 minutes ago hit the upgrade.
     * Only the part of the outage after the last ping counts as excluded.
     */
    givenGaps([gap(14, 3)]);
    expect(
      await heartbeat(13, FilterType.NotRecievedInMinutes, 10),
    ).toBeNull();
    expect(await heartbeat(13, FilterType.RecievedInMinutes, 10)).toBe(
      "Incoming request / heartbeat received in 10 minutes. It was received 13 minutes ago, 10 of them while OneUptime was not receiving requests, which do not count.",
    );
  });

  test("a sender silent for longer than the window while OneUptime was receiving is late", async () => {
    givenGaps([gap(14, 3)]);
    expect(await heartbeat(25, FilterType.NotRecievedInMinutes, 10)).toBe(
      "Incoming request / heartbeat not received in 10 minutes. It was received 25 minutes ago, 11 of them while OneUptime was not receiving requests, which do not count.",
    );
    expect(await heartbeat(25, FilterType.RecievedInMinutes, 10)).toBeNull();
  });

  test("with no gaps the wording and the verdicts are the same as before", async () => {
    expect(await heartbeat(12, FilterType.NotRecievedInMinutes, 10)).toBe(
      "Incoming request / heartbeat not received in 10 minutes. It was received 12 minutes ago.",
    );
    expect(await heartbeat(10, FilterType.RecievedInMinutes, 10)).toBe(
      "Incoming request / heartbeat received in 10 minutes. It was received 10 minutes ago.",
    );
    expect(
      await heartbeat(10, FilterType.NotRecievedInMinutes, 10),
    ).toBeNull();
  });

  test("a request inside the window never asks when OneUptime was receiving", async () => {
    await heartbeat(2, FilterType.RecievedInMinutes, 10);
    await heartbeat(2, FilterType.NotRecievedInMinutes, 10);
    expect(gapsSpy).not.toHaveBeenCalled();
  });
});

function incomingEmail(minutesSinceLastEmail: number): DataToProcess {
  const email: IncomingEmailMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    emailReceivedAt: ago(minutesSinceLastEmail),
    checkedAt: NOW,
    onlyCheckForIncomingEmailReceivedAt: true,
    emailFrom: "backup@example.com",
    emailTo: "inbox@example.com",
    emailSubject: "Backup finished",
    emailBody: "",
  } as IncomingEmailMonitorRequest;
  return email as DataToProcess;
}

async function mailbox(
  minutesSinceLastEmail: number,
  filterType: FilterType,
  value: number,
): Promise<string | null> {
  return IncomingEmailCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: incomingEmail(minutesSinceLastEmail),
    criteriaFilter: {
      checkOn: CheckOn.EmailReceivedAt,
      filterType,
      value,
    },
  });
}

describe("Incoming email: received / not received in N minutes", () => {
  test("an email held up by OneUptime's restart is not late", async () => {
    givenGaps([gap(70, 30)]);
    expect(await mailbox(75, FilterType.NotRecievedInMinutes, 60)).toBeNull();
    expect(await mailbox(75, FilterType.RecievedInMinutes, 60)).toBe(
      "Email received in 60 minutes. It was received 75 minutes ago, 40 of them while OneUptime was not receiving email, which do not count.",
    );
  });

  test("a mailbox silent for the window while OneUptime was receiving is late", async () => {
    givenGaps([gap(70, 30)]);
    expect(await mailbox(110, FilterType.NotRecievedInMinutes, 60)).toBe(
      "Email not received in 60 minutes. It was received 110 minutes ago, 40 of them while OneUptime was not receiving email, which do not count.",
    );
  });

  test("with no gaps nothing changes", async () => {
    expect(await mailbox(61, FilterType.NotRecievedInMinutes, 60)).toBe(
      "Email not received in 60 minutes. It was received 61 minutes ago.",
    );
  });
});

describe("ReceivingSilence", () => {
  test("measures wall, receiving and not-receiving minutes", async () => {
    givenGaps([gap(30, 20), gap(10, 8, ReceivingGapReason.Reconnecting)]);
    const silence: MeasuredSilence = await ReceivingSilence.measure({
      lastHeardAt: ago(40),
      now: NOW,
      thresholdInMinutes: 5,
    });
    expect(silence).toEqual({
      wallMinutes: 40,
      receivingMinutes: 28,
      notReceivingMinutes: 12,
    });
  });

  test("accepts dates serialized as strings, as a queued job carries them", async () => {
    givenGaps([gap(30, 20)]);
    const silence: MeasuredSilence = await ReceivingSilence.measure({
      lastHeardAt: ago(40).toISOString(),
      now: NOW.toISOString(),
      thresholdInMinutes: 5,
    });
    expect(silence.receivingMinutes).toBe(30);
  });

  test("below the threshold it does not ask and reports the wall clock", async () => {
    givenGaps([gap(3, 1)]);
    const silence: MeasuredSilence = await ReceivingSilence.measure({
      lastHeardAt: ago(4),
      now: NOW,
      thresholdInMinutes: 5,
    });
    expect(silence).toEqual({
      wallMinutes: 4,
      receivingMinutes: 4,
      notReceivingMinutes: 0,
    });
    expect(gapsSpy).not.toHaveBeenCalled();
  });

  test("describes the silence in a root cause, with the excluded time only when there is some", () => {
    expect(
      ReceivingSilence.describe({
        silence: { wallMinutes: 9, receivingMinutes: 9, notReceivingMinutes: 0 },
        verb: "received",
        what: "requests",
      }),
    ).toBe("It was received 9 minutes ago.");
    expect(
      ReceivingSilence.describe({
        silence: { wallMinutes: 9, receivingMinutes: 4, notReceivingMinutes: 5 },
        verb: "received",
        what: "requests",
      }),
    ).toBe(
      "It was received 9 minutes ago, 5 of them while OneUptime was not receiving requests, which do not count.",
    );
  });
});
