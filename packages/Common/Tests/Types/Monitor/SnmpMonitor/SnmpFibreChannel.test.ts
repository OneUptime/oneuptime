import SnmpFibreChannelUtil, {
  FIBRE_CHANNEL_COUNTERS,
  FIBRE_CHANNEL_COUNTER_DESCRIPTIONS,
  FIBRE_CHANNEL_COUNTER_TITLES,
  FIBRE_CHANNEL_ERROR_COUNTERS,
  FIBRE_CHANNEL_IF_TYPE,
  FIBRE_CHANNEL_PORT_TYPE_TITLES,
  FibreChannelCounter,
  FibreChannelPortType,
  INTER_SWITCH_LINK_PORT_TYPES,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import { describe, expect, test } from "@jest/globals";

/*
 * What a Fibre Channel port carries beside its IF-MIB interface: its type,
 * why it is down, and its counters. Five of the counters are errors - they
 * count bad frames and broken links, and are what SNMP Interface Errors
 * (per second) adds up on a Fibre Channel port. The other four are not:
 * BB credit zero counts every time a busy, healthy link waits for credit
 * (millions of times a day on an ISL), and discards and credit loss are
 * what a slow-draining device does to a healthy link.
 */

describe("the counters", () => {
  test("every counter has a title and says what it counts", () => {
    for (const counter of FIBRE_CHANNEL_COUNTERS) {
      expect(FIBRE_CHANNEL_COUNTER_TITLES[counter]).toBeTruthy();
      expect(FIBRE_CHANNEL_COUNTER_DESCRIPTIONS[counter]).toMatch(/\.$/);
      expect(SnmpFibreChannelUtil.getCounterTitle(counter)).toBe(
        FIBRE_CHANNEL_COUNTER_TITLES[counter],
      );
    }
  });

  test("the list holds every counter once, errors first", () => {
    expect(new Set(FIBRE_CHANNEL_COUNTERS).size).toBe(
      Object.values(FibreChannelCounter).length,
    );
    expect(FIBRE_CHANNEL_COUNTERS.slice(0, 5)).toEqual(
      FIBRE_CHANNEL_ERROR_COUNTERS,
    );
  });

  test.each([
    [FibreChannelCounter.CrcErrors, true],
    [FibreChannelCounter.InvalidTransmissionWords, true],
    [FibreChannelCounter.LinkFailures, true],
    [FibreChannelCounter.LossOfSync, true],
    [FibreChannelCounter.LossOfSignal, true],
    [FibreChannelCounter.Discards, false],
    [FibreChannelCounter.TimeoutDiscards, false],
    [FibreChannelCounter.CreditLoss, false],
    [FibreChannelCounter.BbCreditZero, false],
  ])("%s is an error: %s", (counter: FibreChannelCounter, isError: boolean) => {
    expect(SnmpFibreChannelUtil.isErrorCounter(counter)).toBe(isError);
  });

  test.each([
    ["crcErrors", FibreChannelCounter.CrcErrors],
    [" creditLoss ", FibreChannelCounter.CreditLoss],
    ["bbCreditZero", FibreChannelCounter.BbCreditZero],
  ])("%j parses as %s", (text: string, counter: FibreChannelCounter) => {
    expect(SnmpFibreChannelUtil.parseCounter(text)).toBe(counter);
  });

  test.each([undefined, null, "", "CRC Errors", "crcerrors", "errors"])(
    "%j is no counter",
    (text: string | null | undefined) => {
      expect(SnmpFibreChannelUtil.parseCounter(text)).toBeUndefined();
    },
  );
});

describe("the port types", () => {
  test.each([
    [FibreChannelPortType.E, "E-Port"],
    [FibreChannelPortType.TE, "TE-Port"],
    [FibreChannelPortType.EX, "EX-Port"],
    [FibreChannelPortType.F, "F-Port"],
    [FibreChannelPortType.NP, "NP-Port"],
  ])("%s reads %s", (portType: FibreChannelPortType, title: string) => {
    expect(SnmpFibreChannelUtil.getPortTypeTitle(portType)).toBe(title);
  });

  test("every type has a title", () => {
    for (const portType of Object.values(FibreChannelPortType)) {
      expect(FIBRE_CHANNEL_PORT_TYPE_TITLES[portType]).toBeTruthy();
    }
  });

  test.each([undefined, null, "", "e", "E-Port", "fabric"])(
    "%j is no type, and no title",
    (text: string | null | undefined) => {
      expect(SnmpFibreChannelUtil.parsePortType(text)).toBeUndefined();
      expect(SnmpFibreChannelUtil.getPortTypeTitle(text)).toBeUndefined();
    },
  );

  test("inter-switch links are the expansion ports: E, TE and EX", () => {
    expect(INTER_SWITCH_LINK_PORT_TYPES).toEqual([
      FibreChannelPortType.E,
      FibreChannelPortType.TE,
      FibreChannelPortType.EX,
    ]);

    for (const portType of Object.values(FibreChannelPortType)) {
      expect(SnmpFibreChannelUtil.isInterSwitchLink(portType)).toBe(
        INTER_SWITCH_LINK_PORT_TYPES.includes(portType),
      );
    }

    expect(SnmpFibreChannelUtil.isInterSwitchLink(undefined)).toBe(false);
    expect(SnmpFibreChannelUtil.isInterSwitchLink(" TE ")).toBe(true);
  });
});

describe("isFibreChannelInterfaceType", () => {
  test("IANAifType fibreChannel(56), and nothing else", () => {
    expect(FIBRE_CHANNEL_IF_TYPE).toBe(56);
    expect(SnmpFibreChannelUtil.isFibreChannelInterfaceType(56)).toBe(true);

    for (const other of [6, 53, 117, 161, 0, undefined, null]) {
      expect(SnmpFibreChannelUtil.isFibreChannelInterfaceType(other)).toBe(
        false,
      );
    }
  });
});

describe("sumErrorRates", () => {
  test("adds up the error counters' rates only", () => {
    expect(
      SnmpFibreChannelUtil.sumErrorRates({
        [FibreChannelCounter.CrcErrors]: 2,
        [FibreChannelCounter.InvalidTransmissionWords]: 6,
        [FibreChannelCounter.LinkFailures]: 0.5,
        [FibreChannelCounter.BbCreditZero]: 4000,
        [FibreChannelCounter.CreditLoss]: 0.05,
        [FibreChannelCounter.Discards]: 3,
      }),
    ).toBe(8.5);
  });

  test("a port whose error counters all rate zero has zero errors, not none", () => {
    expect(
      SnmpFibreChannelUtil.sumErrorRates({
        [FibreChannelCounter.CrcErrors]: 0,
      }),
    ).toBe(0);
  });

  test("no error counter with a rate is no rate at all", () => {
    expect(SnmpFibreChannelUtil.sumErrorRates(undefined)).toBeUndefined();
    expect(SnmpFibreChannelUtil.sumErrorRates({})).toBeUndefined();
    expect(
      SnmpFibreChannelUtil.sumErrorRates({
        [FibreChannelCounter.BbCreditZero]: 12,
      }),
    ).toBeUndefined();
  });

  test("a rate that is not a finite number is skipped", () => {
    expect(
      SnmpFibreChannelUtil.sumErrorRates({
        [FibreChannelCounter.CrcErrors]: NaN,
        [FibreChannelCounter.LinkFailures]: 1,
      }),
    ).toBe(1);
  });
});
