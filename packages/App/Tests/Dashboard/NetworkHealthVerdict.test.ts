import { describe, expect, test } from "@jest/globals";
import {
  NETWORK_HEALTH_COPY,
  NETWORK_HEALTH_PENDING_NOTE,
  NetworkHealthPlural,
  NetworkHealthTone,
  NetworkHealthVerdict,
  NetworkHealthVerdictInput,
  NetworkHealthVerdictKind,
  getNetworkHealthVerdict,
  getPendingNoteCount,
} from "../../FeatureSet/Dashboard/src/Components/Network/NetworkHealthVerdict";

/*
 * The sentence the Network Overview opens with. "Is my network healthy, and
 * if not, what is wrong?" is what someone opens Network for, so the verdict
 * must be the WORST news there is, worded for the count, and never claim
 * more than the counts say. These tests pin the ladder, the tones, the
 * counts each sentence is worded for, and the copy's own shape.
 */

const HEALTHY_FLEET: NetworkHealthVerdictInput = {
  totalDevices: 40,
  devicesUp: 40,
  devicesDown: 0,
  devicesPending: 0,
  interfacesDown: 0,
  unhealthySites: 0,
  snmpFailingDevices: 0,
};

function verdictFor(
  overrides: Partial<NetworkHealthVerdictInput>,
): NetworkHealthVerdict {
  const verdict: NetworkHealthVerdict | null = getNetworkHealthVerdict({
    ...HEALTHY_FLEET,
    ...overrides,
  });

  if (!verdict) {
    throw new Error("Expected a verdict for a fleet with devices");
  }

  return verdict;
}

describe("getNetworkHealthVerdict - nothing to judge", () => {
  test("a project with no devices has no verdict (the first-run page speaks instead)", () => {
    expect(
      getNetworkHealthVerdict({
        ...HEALTHY_FLEET,
        totalDevices: 0,
        devicesUp: 0,
      }),
    ).toBeNull();
  });

  test("no devices is no verdict even when other counts arrive non-zero", () => {
    expect(
      getNetworkHealthVerdict({
        totalDevices: 0,
        devicesUp: 0,
        devicesDown: 3,
        devicesPending: 2,
        interfacesDown: 4,
        unhealthySites: 1,
        snmpFailingDevices: 5,
      }),
    ).toBeNull();
  });
});

describe("getNetworkHealthVerdict - worst news first", () => {
  test("devices down outrank everything else", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      devicesUp: 37,
      devicesDown: 3,
      unhealthySites: 2,
      interfacesDown: 9,
      snmpFailingDevices: 4,
    });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.DevicesDown);
    expect(verdict.tone).toBe(NetworkHealthTone.Critical);
    expect(verdict.headlineCount).toBe(3);
    expect(verdict.detailCount).toBe(3);
  });

  test("unhealthy sites come next, when every device answers", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      unhealthySites: 2,
      interfacesDown: 9,
      snmpFailingDevices: 4,
    });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.SitesUnhealthy);
    expect(verdict.tone).toBe(NetworkHealthTone.Warning);
    expect(verdict.headlineCount).toBe(2);
  });

  test("then dark interfaces, counted as interfaces", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      interfacesDown: 9,
      snmpFailingDevices: 4,
    });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.InterfacesDown);
    expect(verdict.tone).toBe(NetworkHealthTone.Warning);
    expect(verdict.headlineCount).toBe(9);
  });

  test("then devices whose SNMP walk is failing", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      snmpFailingDevices: 4,
    });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.SnmpFailing);
    expect(verdict.tone).toBe(NetworkHealthTone.Warning);
    expect(verdict.headlineCount).toBe(4);
  });

  test("a fleet nothing has checked yet is waiting, not healthy and not down", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      totalDevices: 4,
      devicesUp: 0,
      devicesPending: 4,
    });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.Waiting);
    expect(verdict.tone).toBe(NetworkHealthTone.Waiting);
    expect(verdict.detailCount).toBe(4);
  });

  test("everything answering is healthy, counted as the devices that are up", () => {
    const verdict: NetworkHealthVerdict = verdictFor({});

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.Healthy);
    expect(verdict.tone).toBe(NetworkHealthTone.Healthy);
    expect(verdict.headlineCount).toBe(40);
  });

  test("a healthy fleet with a few still pending counts only the checked ones as up", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      totalDevices: 42,
      devicesUp: 40,
      devicesPending: 2,
    });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.Healthy);
    expect(verdict.headlineCount).toBe(40);
  });

  test("pending devices never hide a device that is down", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      totalDevices: 10,
      devicesUp: 0,
      devicesDown: 1,
      devicesPending: 9,
    });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.DevicesDown);
    expect(verdict.headlineCount).toBe(1);
  });

  test("an up count that lags the total is taken from the total less pending", () => {
    // The tally can count a device neither up nor pending (a stale row).
    const verdict: NetworkHealthVerdict = verdictFor({
      totalDevices: 10,
      devicesUp: 6,
      devicesPending: 2,
    });

    expect(verdict.headlineCount).toBe(8);
  });
});

describe("getNetworkHealthVerdict - counts the API could get wrong", () => {
  test.each([
    ["negative", -3],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("a %s down count reads as none", (_label: string, value: number): void => {
    const verdict: NetworkHealthVerdict = verdictFor({ devicesDown: value });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.Healthy);
  });

  test("a fractional count is rounded down, never up", () => {
    const verdict: NetworkHealthVerdict = verdictFor({ devicesDown: 2.9 });

    expect(verdict.kind).toBe(NetworkHealthVerdictKind.DevicesDown);
    expect(verdict.headlineCount).toBe(2);
  });

  test("a fraction of one down device is not a device down", () => {
    expect(verdictFor({ devicesDown: 0.4 }).kind).toBe(
      NetworkHealthVerdictKind.Healthy,
    );
  });
});

describe("getPendingNoteCount", () => {
  test("says how many are still waiting under a healthy verdict", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      totalDevices: 42,
      devicesUp: 40,
      devicesPending: 2,
    });

    expect(getPendingNoteCount(verdict, 2)).toBe(2);
  });

  test("says it under a verdict about something else too", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      devicesDown: 1,
      devicesPending: 3,
    });

    expect(getPendingNoteCount(verdict, 3)).toBe(3);
  });

  test("says nothing under the waiting verdict, which is about waiting already", () => {
    const verdict: NetworkHealthVerdict = verdictFor({
      totalDevices: 4,
      devicesUp: 0,
      devicesPending: 4,
    });

    expect(getPendingNoteCount(verdict, 4)).toBe(0);
  });

  test("says nothing with no verdict", () => {
    expect(getPendingNoteCount(null, 5)).toBe(0);
  });

  test("never counts below zero", () => {
    expect(getPendingNoteCount(verdictFor({}), -1)).toBe(0);
  });
});

const SNMP_WORD: RegExp = /\bSNMP\b/;

describe("the copy", () => {
  const ALL_KINDS: Array<NetworkHealthVerdictKind> = Object.values(
    NetworkHealthVerdictKind,
  );

  test("every verdict kind has a headline and a line", () => {
    for (const kind of ALL_KINDS) {
      expect(NETWORK_HEALTH_COPY[kind]).toBeDefined();
      expect(NETWORK_HEALTH_COPY[kind].headline.other.length).toBeGreaterThan(
        0,
      );
      expect(NETWORK_HEALTH_COPY[kind].detail.other.length).toBeGreaterThan(0);
    }
  });

  test("a verdict carries its kind's own words", () => {
    const verdict: NetworkHealthVerdict = verdictFor({ devicesDown: 2 });

    expect(verdict.headline).toBe(
      NETWORK_HEALTH_COPY[NetworkHealthVerdictKind.DevicesDown].headline,
    );
    expect(verdict.detail).toBe(
      NETWORK_HEALTH_COPY[NetworkHealthVerdictKind.DevicesDown].detail,
    );
  });

  /*
   * A headline about a number must put that number in front of the reader
   * in every plural form it can be shown in, or "3 devices are down" would
   * read "devices are down" in some count.
   */
  test("every counted headline puts the count in its general form", () => {
    for (const kind of [
      NetworkHealthVerdictKind.DevicesDown,
      NetworkHealthVerdictKind.SitesUnhealthy,
      NetworkHealthVerdictKind.InterfacesDown,
      NetworkHealthVerdictKind.SnmpFailing,
      NetworkHealthVerdictKind.Healthy,
    ]) {
      expect(NETWORK_HEALTH_COPY[kind].headline.other).toContain("{{count}}");
    }
  });

  /*
   * A device is down when its probe cannot reach it OR when the monitor
   * bound to it reports it offline - the same two causes the attention list
   * under the hero names. A line that blamed the probe alone would be false
   * for every monitor-backed device in it.
   */
  test("the devices-down line names the probe and the monitor alike", () => {
    const detail: NetworkHealthPlural =
      NETWORK_HEALTH_COPY[NetworkHealthVerdictKind.DevicesDown].detail;

    expect(detail.one).toContain("probe or monitor");
    expect(detail.other).toContain("probes or monitors");
    expect(detail.one).not.toMatch(SNMP_WORD);
    expect(detail.other).not.toMatch(SNMP_WORD);
  });

  test("the waiting line counts the devices it is waiting for", () => {
    const detail: NetworkHealthPlural =
      NETWORK_HEALTH_COPY[NetworkHealthVerdictKind.Waiting].detail;

    expect(detail.one).toContain("{{count}}");
    expect(detail.other).toContain("{{count}}");
  });

  test("the pending note counts the devices still waiting", () => {
    expect(NETWORK_HEALTH_PENDING_NOTE.one).toContain("{{count}}");
    expect(NETWORK_HEALTH_PENDING_NOTE.other).toContain("{{count}}");
  });

  /*
   * The headline is the plain-language answer: the words people who are
   * not network engineers use. Jargon belongs in the details below it.
   */
  test("headlines speak plainly - no protocol or table names", () => {
    const JARGON: RegExp = /\b(ARP|FDB|LLDP|CDP|OID|walk|poll|rollup)\b/i;

    for (const kind of ALL_KINDS) {
      const headline: NetworkHealthPlural = NETWORK_HEALTH_COPY[kind].headline;

      expect(headline.one).not.toMatch(JARGON);
      expect(headline.other).not.toMatch(JARGON);
    }
  });

  test("the headlines end without a full stop, the lines with one", () => {
    for (const kind of ALL_KINDS) {
      const copy: {
        headline: NetworkHealthPlural;
        detail: NetworkHealthPlural;
      } = NETWORK_HEALTH_COPY[kind];

      expect(copy.headline.one.endsWith(".")).toBe(false);
      expect(copy.headline.other.endsWith(".")).toBe(false);
      expect(copy.detail.one.endsWith(".")).toBe(true);
      expect(copy.detail.other.endsWith(".")).toBe(true);
    }
  });
});
