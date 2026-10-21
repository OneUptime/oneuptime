import { describe, expect, test } from "@jest/globals";
import {
  formatBitsPerSecond,
  formatSharePercent,
  formatTrafficBytes,
  getApplicationLabel,
  getBitsPerSecond,
  getInterfaceLabel,
  getInterfaceUtilizationPercent,
  getPeakBitsPerSecond,
  getSharePercent,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficFormat";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * How the Traffic pages write their numbers. Links are sold in decimal
 * units - a 1 Gbps port moves a billion bits a second - so bytes and rates
 * are decimal too (1 kB is 1000 bytes), and a rate is bits, not bytes.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

describe("formatTrafficBytes", () => {
  test.each([
    [0, "0 B"],
    [999, "999 B"],
    [1000, "1.00 kB"],
    [1234, "1.23 kB"],
    [12_345, "12.3 kB"],
    [123_456, "123 kB"],
    [1_234_567, "1.23 MB"],
    [5_000_000_000, "5.00 GB"],
    [7_250_000_000_000, "7.25 TB"],
    [3_000_000_000_000_000, "3.00 PB"],
    // Past the last unit it keeps counting in it.
    [4_000_000_000_000_000_000, "4000 PB"],
  ])("%d bytes read %s", (octets: number, text: string) => {
    expect(formatTrafficBytes(octets)).toBe(text);
  });

  test.each([
    [-5, "0 B"],
    [Number.NaN, "0 B"],
    [Number.POSITIVE_INFINITY, "0 B"],
  ])("%d is no traffic", (octets: number, text: string) => {
    expect(formatTrafficBytes(octets)).toBe(text);
  });
});

describe("formatBitsPerSecond and getBitsPerSecond", () => {
  test("a rate is bytes times eight over the seconds", () => {
    // 7.5 MB in a minute: 1 Mbps.
    expect(getBitsPerSecond(7_500_000, 60)).toBe(1_000_000);
    expect(getBitsPerSecond(125, 1)).toBe(1000);
  });

  test("no time, or no number, is no rate", () => {
    expect(getBitsPerSecond(1000, 0)).toBe(0);
    expect(getBitsPerSecond(1000, -1)).toBe(0);
    expect(getBitsPerSecond(Number.NaN, 60)).toBe(0);
  });

  test.each([
    [0, "0 bps"],
    [133.33, "133 bps"],
    [1000, "1.00 kbps"],
    [500_000, "500 kbps"],
    [1_000_000, "1.00 Mbps"],
    [12_345_678, "12.3 Mbps"],
    [1_500_000_000, "1.50 Gbps"],
    [40_000_000_000_000, "40.0 Tbps"],
  ])("%d bits a second read %s", (bitsPerSecond: number, text: string) => {
    expect(formatBitsPerSecond(bitsPerSecond)).toBe(text);
  });
});

describe("getPeakBitsPerSecond", () => {
  test("the busiest bucket's rate", () => {
    expect(
      getPeakBitsPerSecond(
        [
          { time: "2026-10-01T10:00:00Z", octets: 750_000 },
          { time: "2026-10-01T10:01:00Z", octets: 7_500_000 },
          { time: "2026-10-01T10:02:00Z", octets: 0 },
        ],
        60,
      ),
    ).toBe(1_000_000);
  });

  test("a wider bucket spreads the same bytes thinner", () => {
    const series: Array<{ time: string; octets: number }> = [
      { time: "2026-10-01T10:00:00Z", octets: 7_500_000 },
    ];

    expect(getPeakBitsPerSecond(series, 600)).toBe(100_000);
  });

  test("no series, no peak", () => {
    expect(getPeakBitsPerSecond([], 60)).toBe(0);
  });
});

describe("getSharePercent and formatSharePercent", () => {
  test("a row's part of the page's total", () => {
    expect(getSharePercent(25, 100)).toBe(25);
    expect(formatSharePercent(25, 100)).toBe("25%");
    expect(formatSharePercent(2, 3)).toBe("67%");
  });

  test("a sliver says it is under one percent, never 0%", () => {
    expect(formatSharePercent(1, 1000)).toBe("<1%");
  });

  test("nothing is 0%, and a share never passes 100%", () => {
    expect(formatSharePercent(0, 100)).toBe("0%");
    expect(getSharePercent(10, 0)).toBe(0);
    // An interface row counts in and out: it may exceed the page's bytes.
    expect(getSharePercent(150, 100)).toBe(100);
  });
});

describe("getApplicationLabel", () => {
  test.each([
    [6, 443, "HTTPS", "TCP port 443"],
    [17, 443, "QUIC", "UDP port 443"],
    [17, 53, "DNS", "UDP port 53"],
    [6, 22, "SSH", "TCP port 22"],
  ])(
    "protocol %d port %d is %s, with %s under it",
    (protocol: number, port: number, name: string, detail: string) => {
      expect(getApplicationLabel(protocol, port, ENGLISH)).toEqual({
        name: name,
        detail: detail,
      });
    },
  );

  test("a port no service is known on reads as its protocol and port", () => {
    expect(getApplicationLabel(6, 8081, ENGLISH)).toEqual({
      name: "TCP port 8081",
      detail: null,
    });
  });

  test("a protocol without ports reads as the protocol alone", () => {
    expect(getApplicationLabel(1, 0, ENGLISH)).toEqual({
      name: "ICMP",
      detail: null,
    });
    expect(getApplicationLabel(47, 0, ENGLISH).name).toBe("GRE");
  });

  test("a protocol nobody named reads as its number", () => {
    expect(getApplicationLabel(253, 0, ENGLISH)).toEqual({
      name: "Protocol 253",
      detail: null,
    });
  });

  test("a port-carrying protocol with no service port left reads as the protocol", () => {
    expect(getApplicationLabel(6, 0, ENGLISH)).toEqual({
      name: "TCP",
      detail: null,
    });
  });
});

describe("getInterfaceLabel and getInterfaceUtilizationPercent", () => {
  test("an interface is named from the device's SNMP walk, else by its index", () => {
    expect(
      getInterfaceLabel(
        { interfaceIndex: 3, name: "Gi0/3", inOctets: 1, outOctets: 1 },
        ENGLISH,
      ),
    ).toBe("Gi0/3");
    expect(
      getInterfaceLabel(
        { interfaceIndex: 7, inOctets: 1, outOctets: 1 },
        ENGLISH,
      ),
    ).toBe("Interface 7");
  });

  test("how busy the busier direction was, on average, as a share of the link's speed", () => {
    // 450 MB in over an hour on a 10 Mbps link: 1 Mbps, 10%.
    expect(
      getInterfaceUtilizationPercent(
        {
          interfaceIndex: 1,
          speedInMbps: 10,
          inOctets: 450_000_000,
          outOctets: 45_000_000,
        },
        3600,
      ),
    ).toBeCloseTo(10, 6);
  });

  test("an interface's share is capped at 100% (sampling estimates can overshoot)", () => {
    expect(
      getInterfaceUtilizationPercent(
        {
          interfaceIndex: 1,
          speedInMbps: 1,
          inOctets: 10_000_000_000,
          outOctets: 0,
        },
        60,
      ),
    ).toBe(100);
  });

  test("no speed known, or no time, is no utilization", () => {
    expect(
      getInterfaceUtilizationPercent(
        { interfaceIndex: 1, inOctets: 1000, outOctets: 1000 },
        3600,
      ),
    ).toBeNull();
    expect(
      getInterfaceUtilizationPercent(
        { interfaceIndex: 1, speedInMbps: 100, inOctets: 1, outOctets: 1 },
        0,
      ),
    ).toBeNull();
  });
});
