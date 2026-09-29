import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import SnmpInterfaceRateUtil from "../../../../Server/Utils/Monitor/SnmpInterfaceRateUtil";
import { JSONObject } from "../../../../Types/JSON";
import OneUptimeDate from "../../../../Types/Date";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";

/*
 * SnmpInterfaceRateUtil turns two consecutive walks' cumulative IF-MIB
 * counters into per-interface rates. Probes stay stateless: the previous
 * walk arrives as NetworkDevice.lastWalkLog — a JSON blob of
 * `{ snmpResponse, monitoredAt }` — and the current side of the delta is
 * server time, so these tests pin the exact rate arithmetic under a mocked
 * clock, plus every guard that must leave the response untouched (first
 * walk, empty walks, unparseable or future timestamps, counter wraps).
 */

const NOW: Date = new Date("2026-07-16T12:01:00.000Z");
const SIXTY_SECONDS_AGO: string = "2026-07-16T12:00:00.000Z";

function buildResponse(
  interfaces: Array<SnmpInterface> | undefined,
): SnmpMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 12,
    failureCause: "",
    oidResponses: [],
    ...(interfaces !== undefined ? { interfaces: interfaces } : {}),
  };
}

function currentInterface(overrides?: Partial<SnmpInterface>): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: "GigabitEthernet0/1",
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    ...overrides,
  };
}

function previousWalkLog(options?: {
  interfaces?: Array<JSONObject> | undefined;
  monitoredAt?: string | undefined;
  omitInterfaces?: boolean;
}): JSONObject {
  return {
    snmpResponse: {
      isOnline: true,
      ...(options?.omitInterfaces
        ? {}
        : {
            interfaces: options?.interfaces ?? [
              { interfaceIndex: 1, inOctets: 0, outOctets: 0 },
            ],
          }),
    },
    monitoredAt: options?.monitoredAt ?? SIXTY_SECONDS_AGO,
  };
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SnmpInterfaceRateUtil.attachInterfaceRates — no-op guards", () => {
  test("does nothing when there is no snmpResponse", () => {
    // Must simply not throw — there is nothing to attach rates to.
    expect(() => {
      SnmpInterfaceRateUtil.attachInterfaceRates({
        snmpResponse: undefined,
        previousWalkLog: previousWalkLog(),
      });
    }).not.toThrow();
  });

  test("does nothing when the current walk has no interfaces array", () => {
    const response: SnmpMonitorResponse = buildResponse(undefined);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog(),
    });

    expect(response.interfaces).toBeUndefined();
  });

  test("does nothing when the current walk's interfaces array is empty", () => {
    const response: SnmpMonitorResponse = buildResponse([]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog(),
    });

    expect(response.interfaces).toEqual([]);
  });

  test("a device's first walk (no previousWalkLog) attaches no rates", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 1000 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: undefined,
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
    expect(iface.outBitsPerSecond).toBeUndefined();
    expect(iface.utilizationPercent).toBeUndefined();
    expect(iface.errorsPerSecond).toBeUndefined();
  });

  test("a previous walk with no interfaces key attaches no rates", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 1000 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({ omitInterfaces: true }),
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
  });

  test("a previous walk with an empty interfaces array attaches no rates", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 1000 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({ interfaces: [] }),
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
  });

  test("a previous walk log without monitoredAt attaches no rates", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 1000 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: {
        snmpResponse: {
          interfaces: [{ interfaceIndex: 1, inOctets: 0 }],
        },
      },
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
  });

  test("an unparseable monitoredAt attaches no rates", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 1000 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({ monitoredAt: "not-a-timestamp" }),
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
  });

  test.each([
    // Clock skew: the stored walk claims to be from the future.
    ["a future monitoredAt", "2026-07-16T12:02:00.000Z"],
    // Same instant: elapsed is exactly zero — division must not happen.
    ["a monitoredAt equal to now", "2026-07-16T12:01:00.000Z"],
  ])("%s (elapsed <= 0) attaches no rates", (_label: string, when: string) => {
    const iface: SnmpInterface = currentInterface({ inOctets: 1000 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({ monitoredAt: when }),
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
    expect(iface.utilizationPercent).toBeUndefined();
  });
});

describe("SnmpInterfaceRateUtil.attachInterfaceRates — rate arithmetic", () => {
  test("in/out bits per second are the octet deltas over the elapsed window", () => {
    const iface: SnmpInterface = currentInterface({
      inOctets: 750,
      outOctets: 3000,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 0, outOctets: 1500 }],
      }),
    });

    // (750 - 0) octets * 8 bits / 60 s = 100 bps.
    expect(iface.inBitsPerSecond).toBe(100);
    // (3000 - 1500) octets * 8 bits / 60 s = 200 bps.
    expect(iface.outBitsPerSecond).toBe(200);
  });

  test("rates are rounded to two decimal places", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 1000 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 0 }],
      }),
    });

    // 1000 * 8 / 60 = 133.333… → 133.33.
    expect(iface.inBitsPerSecond).toBe(133.33);
  });

  test("errorsPerSecond sums both directions over the elapsed window", () => {
    const iface: SnmpInterface = currentInterface({
      inErrors: 30,
      outErrors: 45,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inErrors: 0, outErrors: 15 }],
      }),
    });

    // ((30 - 0) + (45 - 15)) / 60 s = 1 error per second.
    expect(iface.errorsPerSecond).toBe(1);
  });

  test("errorsPerSecond is computed even when only one direction has a delta", () => {
    const iface: SnmpInterface = currentInterface({ inErrors: 6 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inErrors: 0 }],
      }),
    });

    // 6 / 60 s = 0.1 errors per second; the missing direction counts as 0.
    expect(iface.errorsPerSecond).toBe(0.1);
  });

  test("no error counters on either side leaves errorsPerSecond unset", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 750 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 0 }],
      }),
    });

    expect(iface.errorsPerSecond).toBeUndefined();
  });

  test("a previous counter that is not a number yields no rate", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 750 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: "0" }],
      }),
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
  });
});

describe("SnmpInterfaceRateUtil.attachInterfaceRates — counter wraps", () => {
  test("a negative octet delta (wrap or reboot) leaves that direction's rate unset", () => {
    const iface: SnmpInterface = currentInterface({
      // Wrapped: went backwards relative to the previous walk.
      inOctets: 100,
      // Healthy direction on the same interface keeps its rate.
      outOctets: 3000,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [
          { interfaceIndex: 1, inOctets: 4000000000, outOctets: 1500 },
        ],
      }),
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
    expect(iface.outBitsPerSecond).toBe(200);
  });

  test("a negative error delta leaves errorsPerSecond unset when both directions wrapped", () => {
    const iface: SnmpInterface = currentInterface({
      inErrors: 1,
      outErrors: 1,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inErrors: 500, outErrors: 500 }],
      }),
    });

    expect(iface.errorsPerSecond).toBeUndefined();
  });

  test("a zero delta is a valid rate of 0, not a wrap", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 750 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 750 }],
      }),
    });

    expect(iface.inBitsPerSecond).toBe(0);
  });
});

describe("SnmpInterfaceRateUtil.attachInterfaceRates — utilization", () => {
  test("utilizationPercent comes from the busiest direction against the link speed", () => {
    const iface: SnmpInterface = currentInterface({
      inOctets: 750,
      outOctets: 1500,
      speedInBitsPerSecond: 1000,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 0, outOctets: 0 }],
      }),
    });

    expect(iface.inBitsPerSecond).toBe(100);
    expect(iface.outBitsPerSecond).toBe(200);
    // Busiest direction is out at 200 bps of a 1000 bps link → 20%.
    expect(iface.utilizationPercent).toBe(20);
  });

  test("utilization is computed when only one direction has a rate", () => {
    const iface: SnmpInterface = currentInterface({
      inOctets: 750,
      speedInBitsPerSecond: 1000,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 0 }],
      }),
    });

    expect(iface.utilizationPercent).toBe(10);
  });

  test("no link speed means no utilization even when rates exist", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 750 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 0 }],
      }),
    });

    expect(iface.inBitsPerSecond).toBe(100);
    expect(iface.utilizationPercent).toBeUndefined();
  });

  test("a zero link speed never divides", () => {
    const iface: SnmpInterface = currentInterface({
      inOctets: 750,
      speedInBitsPerSecond: 0,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 0 }],
      }),
    });

    expect(iface.utilizationPercent).toBeUndefined();
  });

  test("no utilization when both directions wrapped", () => {
    const iface: SnmpInterface = currentInterface({
      inOctets: 1,
      outOctets: 1,
      speedInBitsPerSecond: 1000,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 999, outOctets: 999 }],
      }),
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
    expect(iface.outBitsPerSecond).toBeUndefined();
    expect(iface.utilizationPercent).toBeUndefined();
  });
});

describe("SnmpInterfaceRateUtil.attachInterfaceRates — interface matching", () => {
  test("an interface only present in the current walk is skipped", () => {
    const newIface: SnmpInterface = currentInterface({
      interfaceIndex: 9,
      inOctets: 750,
      speedInBitsPerSecond: 1000,
    });
    const knownIface: SnmpInterface = currentInterface({
      interfaceIndex: 1,
      inOctets: 750,
    });
    const response: SnmpMonitorResponse = buildResponse([newIface, knownIface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: 1, inOctets: 0 }],
      }),
    });

    // Index 9 has no previous counters — nothing to delta against.
    expect(newIface.inBitsPerSecond).toBeUndefined();
    expect(newIface.utilizationPercent).toBeUndefined();
    // Index 1 still gets its rate; a new port never blocks the others.
    expect(knownIface.inBitsPerSecond).toBe(100);
  });

  test("previous interfaces without a numeric interfaceIndex are ignored", () => {
    const iface: SnmpInterface = currentInterface({ inOctets: 750 });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [{ interfaceIndex: "1", inOctets: 0 }],
      }),
    });

    expect(iface.inBitsPerSecond).toBeUndefined();
  });

  test("interfaces are matched by interfaceIndex, not array position", () => {
    const iface: SnmpInterface = currentInterface({
      interfaceIndex: 2,
      inOctets: 750,
    });
    const response: SnmpMonitorResponse = buildResponse([iface]);

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: response,
      previousWalkLog: previousWalkLog({
        interfaces: [
          // Different order and an unrelated port first.
          { interfaceIndex: 7, inOctets: 999999 },
          { interfaceIndex: 2, inOctets: 0 },
        ],
      }),
    });

    expect(iface.inBitsPerSecond).toBe(100);
  });
});
