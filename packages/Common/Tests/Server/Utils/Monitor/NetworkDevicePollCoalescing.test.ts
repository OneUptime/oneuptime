import { describe, expect, test } from "@jest/globals";
import SnmpInterfaceRateUtil from "../../../../Server/Utils/Monitor/SnmpInterfaceRateUtil";
import SnmpOidRateUtil, {
  SnmpOidCounterBaseline,
} from "../../../../Server/Utils/Monitor/SnmpOidRateUtil";
import { JSONObject } from "../../../../Types/JSON";
import SnmpDataType from "../../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";

/*
 * WHAT A POLL SKIPPED BY THE BACKLOG LOSES, AND WHAT IT DOES NOT.
 *
 * Under a telemetry backlog longer than a device's polling interval, the
 * queue holds one job per device, and that job processes the device's
 * newest poll; the ones before it are never processed
 * (NetworkDevicePollLatestStore, in App). Rates are counter growth against
 * the device's rate baseline (NetworkDevice.lastWalkLog), which only a
 * processed poll moves, so this pins - with the rate utils the poll
 * pipeline uses - that the newest poll's rates cover the skipped poll's
 * interval too:
 *
 *   - no counter growth is lost: the newer poll's rate times its (longer)
 *     window is all the traffic of both intervals;
 *   - the rate is the average over both intervals, so a burst inside the
 *     skipped one is spread over the two;
 *   - a counter that went backwards inside the longer window (a wrap, a
 *     reboot) gives no rate for it, as a counter that goes backwards between
 *     two polls always has.
 *
 * What the skipped poll does lose - its own metric points and its own
 * evaluation by the device's monitors - follows from it never being
 * processed, and is pinned in App (ProcessCoalescedProbeIngest.test.ts:
 * only the newest poll is handed to the pipeline).
 */

const BASELINE_AT: Date = new Date("2026-11-14T10:00:00.000Z");
const SKIPPED_AT: Date = new Date("2026-11-14T10:05:00.000Z");
const NEWEST_AT: Date = new Date("2026-11-14T10:10:00.000Z");

function seconds(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000;
}

function walk(inOctets: number, outOctets: number): SnmpMonitorResponse {
  const port: SnmpInterface = {
    interfaceIndex: 1,
    name: "GigabitEthernet0/1",
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    inOctets: inOctets,
    outOctets: outOctets,
  } as SnmpInterface;

  return {
    isOnline: true,
    responseTimeInMs: 40,
    failureCause: "",
    oidResponses: [],
    interfaces: [port],
  };
}

// The device's baseline after a poll was processed (what lastWalkLog keeps).
function baselineOf(response: SnmpMonitorResponse, at: Date): JSONObject {
  return {
    snmpResponse: {
      interfaces: JSON.parse(JSON.stringify(response.interfaces)),
    },
    monitoredAt: at.toISOString(),
  };
}

function inBps(
  response: SnmpMonitorResponse,
  previous: JSONObject,
  now: Date,
): number | undefined {
  SnmpInterfaceRateUtil.attachInterfaceRates({
    snmpResponse: response,
    previousWalkLog: previous,
    now: now,
  });

  return response.interfaces![0]!.inBitsPerSecond;
}

describe("a poll skipped by the backlog: interface rates", () => {
  // 1,000,000 octets at 10:00, 7,000,000 at 10:05, 8,500,000 at 10:10.
  const baseline: SnmpMonitorResponse = walk(1_000_000, 2_000_000);

  test("the newest poll's rate covers both intervals: no traffic is lost", () => {
    const newest: SnmpMonitorResponse = walk(8_500_000, 2_000_000);
    const rate: number = inBps(
      newest,
      baselineOf(baseline, BASELINE_AT),
      NEWEST_AT,
    )!;

    // 7,500,000 octets over ten minutes.
    expect(rate).toBe(100_000);
    expect(rate * seconds(BASELINE_AT, NEWEST_AT)).toBe(7_500_000 * 8);
  });

  test("it is the time-weighted average of the two rates the skipped poll would have split it into", () => {
    // Processed one by one: a burst, then quiet.
    const skipped: SnmpMonitorResponse = walk(7_000_000, 2_000_000);
    const burst: number = inBps(
      skipped,
      baselineOf(baseline, BASELINE_AT),
      SKIPPED_AT,
    )!;
    const quiet: number = inBps(
      walk(8_500_000, 2_000_000),
      baselineOf(skipped, SKIPPED_AT),
      NEWEST_AT,
    )!;

    expect(burst).toBe(160_000);
    expect(quiet).toBe(40_000);

    // Coalesced: one rate, the average - the burst is spread over both.
    const coalesced: number = inBps(
      walk(8_500_000, 2_000_000),
      baselineOf(baseline, BASELINE_AT),
      NEWEST_AT,
    )!;

    expect(coalesced).toBe((burst + quiet) / 2);
    expect(coalesced).toBeLessThan(burst);
  });

  test("a counter that went backwards inside the longer window gives no rate, as between any two polls", () => {
    // Rebooted between the baseline and the newest poll.
    const newest: SnmpMonitorResponse = walk(400_000, 2_000_000);

    expect(
      inBps(newest, baselineOf(baseline, BASELINE_AT), NEWEST_AT),
    ).toBeUndefined();
  });

  test("an older poll processed after the newest gets no rate: the baseline is never put back", () => {
    // The newest became the baseline at 10:10; a stray older poll arrives.
    const newest: SnmpMonitorResponse = walk(8_500_000, 2_000_000);

    expect(
      inBps(
        walk(7_000_000, 2_000_000),
        baselineOf(newest, NEWEST_AT),
        SKIPPED_AT,
      ),
    ).toBeUndefined();
  });
});

describe("a poll skipped by the backlog: counter OID rates", () => {
  const IF_IN_ERRORS: string = "1.3.6.1.2.1.2.2.1.14.1";

  function oidPoll(value: number): SnmpMonitorResponse {
    return {
      isOnline: true,
      responseTimeInMs: 40,
      failureCause: "",
      oidResponses: [
        {
          oid: IF_IN_ERRORS,
          name: "ifInErrors.1",
          value: value,
          type: SnmpDataType.Counter32,
        },
      ],
    };
  }

  function rateOf(
    response: SnmpMonitorResponse,
    previous: SnmpOidCounterBaseline,
    now: Date,
  ): number | undefined {
    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: previous,
      now: now,
    });

    return response.oidResponses[0]!.ratePerSecond;
  }

  test("the newest poll's rate is the growth since the last processed poll, over that longer window", () => {
    const baseline: SnmpOidCounterBaseline = SnmpOidRateUtil.getCounterBaseline(
      { snmpResponse: oidPoll(1_000), now: BASELINE_AT },
    )!;

    // 600 errors over ten minutes, whatever the skipped poll read.
    expect(rateOf(oidPoll(1_600), baseline, NEWEST_AT)).toBe(1);
  });

  test("a counter that wrapped inside the longer window gives no rate", () => {
    const baseline: SnmpOidCounterBaseline = SnmpOidRateUtil.getCounterBaseline(
      { snmpResponse: oidPoll(4_294_967_000), now: BASELINE_AT },
    )!;

    expect(rateOf(oidPoll(500), baseline, NEWEST_AT)).toBeUndefined();
  });
});
