import SnmpInterfaceRateUtil from "../../../../Server/Utils/Monitor/SnmpInterfaceRateUtil";
import NetworkDeviceWalkUtil from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import { JSONObject } from "../../../../Types/JSON";
import {
  FibreChannelCounter,
  FibreChannelCounterValues,
  FibreChannelPortType,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * A Fibre Channel port's own counters, rated between two polls the way an
 * interface's octets and errors are (#11014, #11015). Each counter is rated
 * on its own; one that went backwards - a 32-bit SW-MIB counter that
 * wrapped, or `statsclear` / `clear counters` on the switch - has no rate
 * that poll: never a negative one, never a spike. The error counters'
 * rates are the port's errorsPerSecond, in place of ifInErrors and
 * ifOutErrors, which count the same frames where a switch fills them.
 */

const MONITORED_AT: Date = new Date("2026-11-26T10:00:00.000Z");

function port(
  interfaceIndex: number,
  counters: FibreChannelCounterValues | undefined,
  extra: Partial<SnmpInterface> = {},
): SnmpInterface {
  return {
    interfaceIndex: interfaceIndex,
    name: `fc1/${interfaceIndex}`,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    ...(counters
      ? {
          fibreChannel: {
            portType: FibreChannelPortType.F,
            counters: counters,
          },
        }
      : {}),
    ...extra,
  };
}

function rate(
  previous: Array<SnmpInterface>,
  current: Array<SnmpInterface>,
  seconds: number = 60,
): Array<SnmpInterface> {
  const response: SnmpMonitorResponse = {
    isOnline: true,
    responseTimeInMs: 10,
    failureCause: "",
    oidResponses: [],
    interfaces: current,
  };

  SnmpInterfaceRateUtil.attachInterfaceRates({
    snmpResponse: response,
    previousWalkLog: {
      snmpResponse: JSON.parse(
        JSON.stringify({ interfaces: previous }),
      ) as JSONObject,
      monitoredAt: MONITORED_AT.toISOString(),
    },
    now: new Date(MONITORED_AT.getTime() + seconds * 1000),
  });

  return current;
}

describe("getFibreChannelRates", () => {
  test("every counter's delta over the window, per second", () => {
    expect(
      SnmpInterfaceRateUtil.getFibreChannelRates({
        current: {
          [FibreChannelCounter.CrcErrors]: 130,
          [FibreChannelCounter.BbCreditZero]: 244000,
          [FibreChannelCounter.CreditLoss]: 3,
        },
        previous: {
          [FibreChannelCounter.CrcErrors]: 10,
          [FibreChannelCounter.BbCreditZero]: 4000,
          [FibreChannelCounter.CreditLoss]: 0,
        },
        elapsedSeconds: 60,
      }),
    ).toEqual({
      [FibreChannelCounter.CrcErrors]: 2,
      [FibreChannelCounter.BbCreditZero]: 4000,
      [FibreChannelCounter.CreditLoss]: 0.05,
    });
  });

  test("one error a minute is a rate, not zero: four decimals", () => {
    expect(
      SnmpInterfaceRateUtil.getFibreChannelRates({
        current: { [FibreChannelCounter.LinkFailures]: 1 },
        previous: { [FibreChannelCounter.LinkFailures]: 0 },
        elapsedSeconds: 60,
      }),
    ).toEqual({ [FibreChannelCounter.LinkFailures]: 0.0167 });
  });

  test("a counter that went backwards has no rate; the others still do", () => {
    expect(
      SnmpInterfaceRateUtil.getFibreChannelRates({
        current: {
          [FibreChannelCounter.CrcErrors]: 5,
          [FibreChannelCounter.Discards]: 60,
        },
        previous: {
          [FibreChannelCounter.CrcErrors]: 4294967290,
          [FibreChannelCounter.Discards]: 0,
        },
        elapsedSeconds: 60,
      }),
    ).toEqual({ [FibreChannelCounter.Discards]: 1 });
  });

  test("a counter only one poll read has no rate", () => {
    expect(
      SnmpInterfaceRateUtil.getFibreChannelRates({
        current: {
          [FibreChannelCounter.CrcErrors]: 5,
          [FibreChannelCounter.LossOfSync]: 2,
        },
        previous: { [FibreChannelCounter.CrcErrors]: 5 },
        elapsedSeconds: 60,
      }),
    ).toEqual({ [FibreChannelCounter.CrcErrors]: 0 });
  });

  test("nothing to rate is no rates at all", () => {
    expect(
      SnmpInterfaceRateUtil.getFibreChannelRates({
        current: undefined,
        previous: { [FibreChannelCounter.CrcErrors]: 5 },
        elapsedSeconds: 60,
      }),
    ).toBeUndefined();
    expect(
      SnmpInterfaceRateUtil.getFibreChannelRates({
        current: { [FibreChannelCounter.CrcErrors]: 5 },
        previous: undefined,
        elapsedSeconds: 60,
      }),
    ).toBeUndefined();
    expect(
      SnmpInterfaceRateUtil.getFibreChannelRates({
        current: { [FibreChannelCounter.CrcErrors]: 5 },
        previous: "not counters",
        elapsedSeconds: 60,
      }),
    ).toBeUndefined();
  });

  test.each([0, -60, NaN, Infinity])(
    "a window of %s seconds rates nothing",
    (elapsedSeconds: number) => {
      expect(
        SnmpInterfaceRateUtil.getFibreChannelRates({
          current: { [FibreChannelCounter.CrcErrors]: 6 },
          previous: { [FibreChannelCounter.CrcErrors]: 5 },
          elapsedSeconds: elapsedSeconds,
        }),
      ).toBeUndefined();
    },
  );

  test("a previous value stored as something other than a number is skipped", () => {
    expect(
      SnmpInterfaceRateUtil.getFibreChannelRates({
        current: { [FibreChannelCounter.CrcErrors]: 6 },
        previous: { [FibreChannelCounter.CrcErrors]: "5" },
        elapsedSeconds: 60,
      }),
    ).toBeUndefined();
  });
});

describe("attachInterfaceRates on Fibre Channel ports", () => {
  test("the port's errors per second are its Fibre Channel errors, not IF-MIB's", () => {
    const [current] = rate(
      [
        port(
          1,
          {
            [FibreChannelCounter.CrcErrors]: 0,
            [FibreChannelCounter.InvalidTransmissionWords]: 0,
          },
          { inErrors: 0, outErrors: 0 },
        ),
      ],
      [
        port(
          1,
          {
            [FibreChannelCounter.CrcErrors]: 120,
            [FibreChannelCounter.InvalidTransmissionWords]: 360,
          },
          // An MDS counts the same frames in ifInErrors: not twice.
          { inErrors: 480, outErrors: 0 },
        ),
      ],
    );

    expect(current!.fibreChannel?.ratesPerSecond).toEqual({
      [FibreChannelCounter.CrcErrors]: 2,
      [FibreChannelCounter.InvalidTransmissionWords]: 6,
    });
    expect(current!.errorsPerSecond).toBe(8);
  });

  test("credit waits, discards and credit loss are charted, never counted as errors", () => {
    const [current] = rate(
      [
        port(1, {
          [FibreChannelCounter.CrcErrors]: 0,
          [FibreChannelCounter.BbCreditZero]: 0,
          [FibreChannelCounter.Discards]: 0,
          [FibreChannelCounter.TimeoutDiscards]: 0,
          [FibreChannelCounter.CreditLoss]: 0,
        }),
      ],
      [
        port(1, {
          [FibreChannelCounter.CrcErrors]: 0,
          [FibreChannelCounter.BbCreditZero]: 2400000,
          [FibreChannelCounter.Discards]: 600,
          [FibreChannelCounter.TimeoutDiscards]: 30,
          [FibreChannelCounter.CreditLoss]: 3,
        }),
      ],
    );

    expect(current!.errorsPerSecond).toBe(0);
    expect(current!.fibreChannel?.ratesPerSecond).toMatchObject({
      [FibreChannelCounter.BbCreditZero]: 40000,
      [FibreChannelCounter.Discards]: 10,
      [FibreChannelCounter.TimeoutDiscards]: 0.5,
      [FibreChannelCounter.CreditLoss]: 0.05,
    });
  });

  test("statsclear between two polls: no rate for the cleared counters, no spike", () => {
    const [current] = rate(
      [
        port(
          1,
          {
            [FibreChannelCounter.CrcErrors]: 5000,
            [FibreChannelCounter.LinkFailures]: 30,
          },
          { inErrors: 5000 },
        ),
      ],
      [
        port(
          1,
          {
            [FibreChannelCounter.CrcErrors]: 2,
            [FibreChannelCounter.LinkFailures]: 0,
          },
          { inErrors: 2 },
        ),
      ],
    );

    expect(current!.fibreChannel?.ratesPerSecond).toBeUndefined();
    // IF-MIB's counter was cleared too: still no rate rather than a spike.
    expect(current!.errorsPerSecond).toBeUndefined();
  });

  test("a port the previous poll had no Fibre Channel counters for is rated from IF-MIB, as before", () => {
    const [current] = rate(
      [port(1, undefined, { inErrors: 0, outErrors: 0 })],
      [
        port(
          1,
          { [FibreChannelCounter.CrcErrors]: 12 },
          { inErrors: 60, outErrors: 0 },
        ),
      ],
    );

    expect(current!.fibreChannel?.ratesPerSecond).toBeUndefined();
    expect(current!.errorsPerSecond).toBe(1);
  });

  test("an Ethernet port beside them is rated as it always was", () => {
    const [current] = rate(
      [port(5, undefined, { inErrors: 10, outErrors: 0 })],
      [port(5, undefined, { inErrors: 11, outErrors: 0 })],
    );

    expect(current!.fibreChannel).toBeUndefined();
    expect(current!.errorsPerSecond).toBe(0.0167);
  });

  test("ports are matched by ifIndex: another port's counters are never its baseline", () => {
    const [first, second] = rate(
      [
        port(1, { [FibreChannelCounter.CrcErrors]: 0 }),
        port(2, { [FibreChannelCounter.CrcErrors]: 600 }),
      ],
      [
        port(1, { [FibreChannelCounter.CrcErrors]: 60 }),
        port(2, { [FibreChannelCounter.CrcErrors]: 600 }),
      ],
    );

    expect(first!.errorsPerSecond).toBe(1);
    expect(second!.errorsPerSecond).toBe(0);
  });
});

describe("NetworkDeviceWalkUtil.toRateBaselineInterfaces", () => {
  test("keeps what the next poll's rates need: the Fibre Channel counters, not their rates or the port's words", () => {
    const baseline: Array<JSONObject> =
      NetworkDeviceWalkUtil.toRateBaselineInterfaces([
        port(
          1,
          { [FibreChannelCounter.CrcErrors]: 12 },
          { inOctets: 100, inErrors: 3 },
        ),
        port(2, undefined, { inOctets: 7 }),
      ] as Array<SnmpInterface>) as unknown as Array<JSONObject>;

    const fibreChannel: JSONObject | undefined = baseline[0]![
      "fibreChannel"
    ] as JSONObject | undefined;

    expect(fibreChannel).toEqual({
      counters: { [FibreChannelCounter.CrcErrors]: 12 },
    });
    expect(baseline[0]!["inOctets"]).toBe(100);
    expect(baseline[0]!["inErrors"]).toBe(3);
    expect(baseline[1]!["fibreChannel"]).toBeUndefined();
  });
});
