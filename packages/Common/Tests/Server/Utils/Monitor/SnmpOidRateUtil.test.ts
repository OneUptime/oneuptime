import { describe, expect, test } from "@jest/globals";
import SnmpOidRateUtil, {
  SNMP_OID_COUNTER_BASELINE_KEY,
  SNMP_OID_COUNTER_BASELINE_LIMIT,
  SnmpOidCounterBaseline,
} from "../../../../Server/Utils/Monitor/SnmpOidRateUtil";
import { JSONObject } from "../../../../Types/JSON";
import SnmpDataType from "../../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";

/*
 * How fast each counter OID a device's poll read grows, per second - what
 * the SNMP OID Rate (per second) criteria compares. A counter only grows
 * until it wraps or the device restarts, so its raw value says nothing
 * about now; the rate does. The server keeps the counters each poll read
 * (oidCounters, in the device's lastWalkLog) and rates the next poll
 * against them.
 */

const IF_IN_ERRORS: string = "1.3.6.1.2.1.2.2.1.14.3";
const IF_HC_IN_OCTETS: string = "1.3.6.1.2.1.31.1.1.1.6.3";
const SYS_UPTIME: string = "1.3.6.1.2.1.1.3.0";
const CPU: string = "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1";

const EARLIER: Date = new Date("2026-09-21T12:00:00.000Z");
const FIVE_MINUTES_LATER: Date = new Date("2026-09-21T12:05:00.000Z");

function responseWith(
  oidResponses: Array<SnmpOidResponse>,
): SnmpMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 30,
    failureCause: "",
    oidResponses: oidResponses,
  };
}

function counter(
  oid: string,
  value: string | number | null,
  type: SnmpDataType = SnmpDataType.Counter32,
): SnmpOidResponse {
  return { oid: oid, name: "ifInErrors.3", value: value, type: type };
}

function baselineOf(
  values: Record<string, string>,
  readAt: Date = EARLIER,
): SnmpOidCounterBaseline {
  return { values: values, readAt: readAt.toISOString() };
}

describe("SnmpOidRateUtil.isCounter", () => {
  test("Counter, Counter32 and Counter64 are counters; nothing else is", () => {
    for (const type of Object.values(SnmpDataType)) {
      expect({ type, isCounter: SnmpOidRateUtil.isCounter(type) }).toEqual({
        type,
        isCounter:
          type === SnmpDataType.Counter ||
          type === SnmpDataType.Counter32 ||
          type === SnmpDataType.Counter64,
      });
    }

    expect(SnmpOidRateUtil.isCounter(undefined)).toBe(false);
  });
});

describe("SnmpOidRateUtil.getCounterBaseline", () => {
  test("keeps each counter's reading, by OID, and when the poll came", () => {
    expect(
      SnmpOidRateUtil.getCounterBaseline({
        snmpResponse: responseWith([
          counter(`.${IF_IN_ERRORS}`, 1200),
          counter(IF_HC_IN_OCTETS, 9007199254740000, SnmpDataType.Counter64),
          { oid: CPU, value: 7, type: SnmpDataType.Gauge32 },
          { oid: SYS_UPTIME, value: 8640000, type: SnmpDataType.TimeTicks },
        ]),
        now: FIVE_MINUTES_LATER,
      }),
    ).toEqual({
      values: {
        [IF_IN_ERRORS]: "1200",
        [IF_HC_IN_OCTETS]: "9007199254740000",
      },
      readAt: "2026-09-21T12:05:00.000Z",
    });
  });

  test("is nothing when the poll read no counter", () => {
    expect(
      SnmpOidRateUtil.getCounterBaseline({
        snmpResponse: responseWith([
          { oid: CPU, value: 7, type: SnmpDataType.Gauge32 },
        ]),
        now: FIVE_MINUTES_LATER,
      }),
    ).toBeUndefined();
    expect(
      SnmpOidRateUtil.getCounterBaseline({
        snmpResponse: undefined,
        now: FIVE_MINUTES_LATER,
      }),
    ).toBeUndefined();
  });

  test("leaves out a counter that came back without a number", () => {
    expect(
      SnmpOidRateUtil.getCounterBaseline({
        snmpResponse: responseWith([
          counter(IF_IN_ERRORS, null),
          counter(IF_HC_IN_OCTETS, ""),
          counter("1.3.6.1.2.1.2.2.1.20.3", "not a number"),
        ]),
        now: FIVE_MINUTES_LATER,
      }),
    ).toBeUndefined();
  });

  test("reads a counter a probe sent as text", () => {
    expect(
      SnmpOidRateUtil.getCounterBaseline({
        snmpResponse: responseWith([counter(IF_IN_ERRORS, " 42 ")]),
        now: FIVE_MINUTES_LATER,
      })?.values,
    ).toEqual({ [IF_IN_ERRORS]: "42" });
  });

  test("keeps the first reading of an OID listed twice", () => {
    expect(
      SnmpOidRateUtil.getCounterBaseline({
        snmpResponse: responseWith([
          counter(IF_IN_ERRORS, 10),
          counter(`.${IF_IN_ERRORS}`, 99),
        ]),
        now: FIVE_MINUTES_LATER,
      })?.values,
    ).toEqual({ [IF_IN_ERRORS]: "10" });
  });

  test(`keeps at most ${SNMP_OID_COUNTER_BASELINE_LIMIT} counters`, () => {
    const many: Array<SnmpOidResponse> = Array.from(
      { length: SNMP_OID_COUNTER_BASELINE_LIMIT + 25 },
      (_value: unknown, index: number): SnmpOidResponse => {
        return counter(`1.3.6.1.2.1.2.2.1.14.${index + 1}`, index);
      },
    );

    expect(
      Object.keys(
        SnmpOidRateUtil.getCounterBaseline({
          snmpResponse: responseWith(many),
          now: FIVE_MINUTES_LATER,
        })!.values,
      ),
    ).toHaveLength(SNMP_OID_COUNTER_BASELINE_LIMIT);
  });
});

describe("SnmpOidRateUtil.readBaseline", () => {
  test("reads the counters a lastWalkLog keeps", () => {
    const log: JSONObject = {
      snmpResponse: { interfaces: [] },
      monitoredAt: EARLIER.toISOString(),
      [SNMP_OID_COUNTER_BASELINE_KEY]: {
        values: { [IF_IN_ERRORS]: "1200", [IF_HC_IN_OCTETS]: 77 },
        readAt: EARLIER.toISOString(),
      },
    };

    expect(SnmpOidRateUtil.readBaseline(log)).toEqual({
      values: { [IF_IN_ERRORS]: "1200", [IF_HC_IN_OCTETS]: "77" },
      readAt: EARLIER.toISOString(),
    });
  });

  test("is nothing for a log without counters, or with them in a shape it does not know", () => {
    for (const log of [
      undefined,
      null,
      {},
      { snmpResponse: { interfaces: [] } },
      { [SNMP_OID_COUNTER_BASELINE_KEY]: "text" },
      { [SNMP_OID_COUNTER_BASELINE_KEY]: [] },
      { [SNMP_OID_COUNTER_BASELINE_KEY]: { values: {} } },
      {
        [SNMP_OID_COUNTER_BASELINE_KEY]: {
          values: [1, 2],
          readAt: EARLIER.toISOString(),
        },
      },
      {
        [SNMP_OID_COUNTER_BASELINE_KEY]: {
          values: { [IF_IN_ERRORS]: "1" },
          readAt: "not a date",
        },
      },
    ] as Array<JSONObject | null | undefined>) {
      expect(SnmpOidRateUtil.readBaseline(log)).toBeUndefined();
    }
  });
});

describe("SnmpOidRateUtil.attachOidRates", () => {
  test("a counter's rate is its growth over the seconds between the two polls", () => {
    const response: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 1500),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: baselineOf({ [IF_IN_ERRORS]: "1200" }),
      now: FIVE_MINUTES_LATER,
    });

    // 300 more errors in 300 seconds.
    expect(response.oidResponses[0]!.ratePerSecond).toBe(1);
  });

  test("is rounded to two decimals", () => {
    const response: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 1201),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: baselineOf({ [IF_IN_ERRORS]: "1200" }),
      now: FIVE_MINUTES_LATER,
    });

    expect(response.oidResponses[0]!.ratePerSecond).toBe(0);

    const busier: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 1300),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: busier,
      previousBaseline: baselineOf({ [IF_IN_ERRORS]: "1200" }),
      now: FIVE_MINUTES_LATER,
    });

    expect(busier.oidResponses[0]!.ratePerSecond).toBe(0.33);
  });

  test("an unchanged counter grows at zero per second", () => {
    const response: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 1200),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: baselineOf({ [IF_IN_ERRORS]: "1200" }),
      now: FIVE_MINUTES_LATER,
    });

    expect(response.oidResponses[0]!.ratePerSecond).toBe(0);
  });

  test("a 64-bit octet counter rates exactly at a busy link's size", () => {
    const response: SnmpMonitorResponse = responseWith([
      counter(
        IF_HC_IN_OCTETS,
        3750000000000 + 37500000000,
        SnmpDataType.Counter64,
      ),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: baselineOf({ [IF_HC_IN_OCTETS]: "3750000000000" }),
      now: FIVE_MINUTES_LATER,
    });

    // 37.5 GB in 300 seconds: 125,000,000 octets a second (1 Gbit/s).
    expect(response.oidResponses[0]!.ratePerSecond).toBe(125000000);
  });

  test("a counter that went backwards - it wrapped, or the device restarted - has no rate", () => {
    const response: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 3),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: baselineOf({ [IF_IN_ERRORS]: "1200" }),
      now: FIVE_MINUTES_LATER,
    });

    expect(response.oidResponses[0]!.ratePerSecond).toBeUndefined();
  });

  test("a counter the previous poll did not read has no rate yet", () => {
    const response: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 1500),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: baselineOf({ [IF_HC_IN_OCTETS]: "10" }),
      now: FIVE_MINUTES_LATER,
    });

    expect(response.oidResponses[0]!.ratePerSecond).toBeUndefined();
  });

  test("a device's first poll has no rate at all", () => {
    const response: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 1500),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: undefined,
      now: FIVE_MINUTES_LATER,
    });

    expect(response.oidResponses[0]!.ratePerSecond).toBeUndefined();
  });

  test("no time between the polls - or a clock that went back - gives no rate", () => {
    for (const readAt of [
      FIVE_MINUTES_LATER,
      new Date("2026-09-21T12:10:00Z"),
    ]) {
      const response: SnmpMonitorResponse = responseWith([
        counter(IF_IN_ERRORS, 1500),
      ]);

      SnmpOidRateUtil.attachOidRates({
        snmpResponse: response,
        previousBaseline: baselineOf({ [IF_IN_ERRORS]: "1200" }, readAt),
        now: FIVE_MINUTES_LATER,
      });

      expect(response.oidResponses[0]!.ratePerSecond).toBeUndefined();
    }
  });

  test("gauges, uptimes and text are never given a rate", () => {
    const response: SnmpMonitorResponse = responseWith([
      { oid: CPU, value: 9, type: SnmpDataType.Gauge32 },
      { oid: SYS_UPTIME, value: 8640000, type: SnmpDataType.TimeTicks },
      {
        oid: "1.3.6.1.2.1.1.5.0",
        value: "sw-core-01",
        type: SnmpDataType.OctetString,
      },
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: baselineOf({
        [CPU]: "7",
        [SYS_UPTIME]: "8610000",
        "1.3.6.1.2.1.1.5.0": "1",
      }),
      now: FIVE_MINUTES_LATER,
    });

    for (const oidResponse of response.oidResponses) {
      expect(oidResponse.ratePerSecond).toBeUndefined();
    }
  });

  test("matches an OID however it is spelled (a leading dot or not)", () => {
    const response: SnmpMonitorResponse = responseWith([
      counter(`.${IF_IN_ERRORS}`, 1500),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: response,
      previousBaseline: baselineOf({ [IF_IN_ERRORS]: "1200" }),
      now: FIVE_MINUTES_LATER,
    });

    expect(response.oidResponses[0]!.ratePerSecond).toBe(1);
  });

  test("the counters one poll keeps rate the next poll", () => {
    const first: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 1200),
    ]);
    const kept: SnmpOidCounterBaseline | undefined =
      SnmpOidRateUtil.getCounterBaseline({
        snmpResponse: first,
        now: EARLIER,
      });
    const stored: JSONObject = JSON.parse(
      JSON.stringify({ [SNMP_OID_COUNTER_BASELINE_KEY]: kept }),
    ) as JSONObject;

    const second: SnmpMonitorResponse = responseWith([
      counter(IF_IN_ERRORS, 1800),
    ]);

    SnmpOidRateUtil.attachOidRates({
      snmpResponse: second,
      previousBaseline: SnmpOidRateUtil.readBaseline(stored),
      now: FIVE_MINUTES_LATER,
    });

    expect(second.oidResponses[0]!.ratePerSecond).toBe(2);
  });
});
