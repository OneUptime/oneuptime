// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner, {
  SubnetScanConfig,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * github.com/OneUptime/oneuptime/issues/3598 — "Large-range Discovery Scan
 * (15,360 hosts) takes 24+ hours and still incomplete".
 *
 * The sweep used to run a flat 32 workers whatever it was sweeping. That
 * number IS the arithmetic behind the report: a dead address costs ~1s in the
 * ICMP pass and ~2s per credential set in the SNMP one, so 32 workers put a
 * floor of eight minutes on the ICMP pass of a 15,360-address range and
 * another sixteen on the SNMP pass whenever the ICMP-filtered fallback fires —
 * before SNMP v3's extra round trip, and before a second credential set
 * doubles the SNMP half again. A /24 and a /17 were given the same pool, so
 * the cost of a large scan grew strictly linearly with nothing absorbing it.
 *
 * These tests pin the sizing that replaced it, and the three properties it has
 * to hold at once: a small sweep keeps exactly the 32 workers it always had, a
 * large one scales with its size, and neither pass ever exceeds its own
 * ceiling — the ICMP one lower than the SNMP one, because an ICMP worker holds
 * a forked `ping` process where an SNMP worker holds a UDP socket.
 */

const ONLY_CONFIG_ID: string = "config-1";

function buildSnmpConfig(
  overrides: Partial<SubnetScanSnmpConfig> = {},
): SubnetScanSnmpConfig {
  return {
    id: ONLY_CONFIG_ID,
    label: "SNMP v2c on port 161",
    snmpVersion: SnmpVersion.V2c,
    communityString: "public",
    port: 161,
    ...overrides,
  };
}

function scanConfig(
  cidr: string,
  overrides: Partial<SubnetScanConfig> = {},
): SubnetScanConfig {
  return {
    cidr: cidr,
    snmpConfigs: [buildSnmpConfig()],
    ...overrides,
  };
}

stubReverseDnsAsResolvingNothing();

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The two ceilings the scanner itself applies, restated here rather than
 * exported from the module.
 *
 * Deliberate: a test that imported the constant would pass for any value it
 * held, and these two numbers are a resource decision (how many child
 * processes and how many sockets a probe container may hold at once) that
 * should not be changeable without a test saying so out loud.
 */
const ICMP_CEILING: number = 128;
const SNMP_CEILING: number = 256;

// The floor. A small sweep behaves exactly as it did before any of this.
const FLOOR: number = 32;

describe("SubnetScanner.getSweepConcurrency", () => {
  it("keeps the historical 32 workers for a /24", () => {
    expect(
      SubnetScanner.getSweepConcurrency({
        hostCount: 254,
        maxConcurrency: ICMP_CEILING,
      }),
    ).toBe(FLOOR);
  });

  it("never runs more workers than the sweep has addresses", () => {
    /*
     * Six addresses must not spin up 32 workers; the extra 26 would each be
     * created only to find the cursor past the end.
     */
    expect(
      SubnetScanner.getSweepConcurrency({
        hostCount: 6,
        maxConcurrency: ICMP_CEILING,
      }),
    ).toBe(6);

    expect(
      SubnetScanner.getSweepConcurrency({
        hostCount: 1,
        maxConcurrency: ICMP_CEILING,
      }),
    ).toBe(1);
  });

  it("scales up for the range in the report, well past the old flat 32", () => {
    const reportedRangeSize: number = 15360;

    const icmp: number = SubnetScanner.getSweepConcurrency({
      hostCount: reportedRangeSize,
      maxConcurrency: ICMP_CEILING,
    });

    expect(icmp).toBe(ICMP_CEILING);
    expect(icmp).toBeGreaterThan(FLOOR);
  });

  it("gives the SNMP pass a higher ceiling than the ICMP pass", () => {
    /*
     * The asymmetry is the point: an ICMP worker holds a forked OS `ping`
     * process, an SNMP worker holds a UDP socket. At the scan-size ceiling
     * both passes are pinned to their own maximum, and they differ.
     */
    const hostCount: number = ScanTargetUtil.MAX_SCAN_HOSTS;

    expect(
      SubnetScanner.getSweepConcurrency({
        hostCount: hostCount,
        maxConcurrency: ICMP_CEILING,
      }),
    ).toBe(ICMP_CEILING);

    expect(
      SubnetScanner.getSweepConcurrency({
        hostCount: hostCount,
        maxConcurrency: SNMP_CEILING,
      }),
    ).toBe(SNMP_CEILING);
  });

  it("keeps the biggest allowed scan's passes inside a few minutes each", () => {
    /*
     * The property the sizing exists for, stated as wall clock rather than as
     * a worker count: at the address ceiling, one pass over every address must
     * not take the better part of an hour.
     *
     * 2 seconds per dead address is the SNMP pass's own timeout, which is the
     * expensive half and the half the ICMP-filtered fallback runs over the
     * WHOLE range.
     */
    const secondsPerDeadHost: number = 2;
    const passSeconds: number =
      (ScanTargetUtil.MAX_SCAN_HOSTS * secondsPerDeadHost) /
      SubnetScanner.getSweepConcurrency({
        hostCount: ScanTargetUtil.MAX_SCAN_HOSTS,
        maxConcurrency: SNMP_CEILING,
      });

    expect(passSeconds).toBeLessThanOrEqual(5 * 60);

    // And the old flat pool is exactly the thing that could not do that.
    expect(
      (ScanTargetUtil.MAX_SCAN_HOSTS * secondsPerDeadHost) / FLOOR,
    ).toBeGreaterThan(30 * 60);
  });

  it("is monotonic in the host count, so a bigger range is never given less", () => {
    let previous: number = 0;

    for (const hostCount of [1, 6, 254, 1024, 4096, 15360, 32768]) {
      const concurrency: number = SubnetScanner.getSweepConcurrency({
        hostCount: hostCount,
        maxConcurrency: SNMP_CEILING,
      });

      expect(concurrency).toBeGreaterThanOrEqual(previous);
      previous = concurrency;
    }
  });

  describe("an operator override", () => {
    it("wins outright, above and below the derived value", () => {
      expect(
        SubnetScanner.getSweepConcurrency({
          hostCount: 32768,
          maxConcurrency: SNMP_CEILING,
          override: 8,
        }),
      ).toBe(8);

      expect(
        SubnetScanner.getSweepConcurrency({
          hostCount: 254,
          maxConcurrency: ICMP_CEILING,
          override: 512,
        }),
      ).toBe(512);
    });

    it("is clamped, so a typo cannot fork ten thousand processes", () => {
      expect(
        SubnetScanner.getSweepConcurrency({
          hostCount: 32768,
          maxConcurrency: SNMP_CEILING,
          override: 999999,
        }),
      ).toBe(1024);
    });

    it("treats 0 and undefined as 'work it out', not as zero workers", () => {
      const derived: number = SubnetScanner.getSweepConcurrency({
        hostCount: 4096,
        maxConcurrency: SNMP_CEILING,
      });

      expect(
        SubnetScanner.getSweepConcurrency({
          hostCount: 4096,
          maxConcurrency: SNMP_CEILING,
          override: 0,
        }),
      ).toBe(derived);

      expect(
        SubnetScanner.getSweepConcurrency({
          hostCount: 4096,
          maxConcurrency: SNMP_CEILING,
          override: undefined,
        }),
      ).toBe(derived);
    });
  });
});

describe("SubnetScanner.getSegmentSize", () => {
  it("is at least 512, so a small sweep is a single segment", () => {
    /*
     * That is what keeps a /24 behaving exactly as it did before segmenting
     * existed: every address pinged before any is SNMP-probed, one progress
     * report, one pass.
     */
    expect(SubnetScanner.getSegmentSize(FLOOR)).toBe(512);
    expect(SubnetScanner.getSegmentSize(1)).toBe(512);
  });

  it("grows with the pool, so a segment stays about eight waves of work", () => {
    expect(SubnetScanner.getSegmentSize(ICMP_CEILING)).toBe(ICMP_CEILING * 8);
    expect(SubnetScanner.getSegmentSize(SNMP_CEILING)).toBe(SNMP_CEILING * 8);
  });
});

/*
 * The sizing is only worth anything if the sweep actually runs at it. These
 * measure what is in flight rather than what was computed.
 */
describe("SubnetScanner — the sweep runs at the size it chose", () => {
  interface InFlight {
    now: number;
    peak: number;
  }

  /*
   * Yields on a microtask rather than a timer: 32k timers would make this test
   * take minutes, and a microtask is enough for every worker in a wave to be
   * in flight at once (runConcurrently starts them in a synchronous loop).
   */
  function recordPeak(record: InFlight): () => Promise<void> {
    return async (): Promise<void> => {
      record.now++;
      record.peak = Math.max(record.peak, record.now);
      await Promise.resolve();
      record.now--;
    };
  }

  it("holds a /24 to the 32 workers it has always had", async () => {
    const pings: InFlight = { now: 0, peak: 0 };
    const tick: () => Promise<void> = recordPeak(pings);

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (): Promise<boolean> => {
        await tick();
        return false;
      });
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    await SubnetScanner.scan(scanConfig("10.0.0.0/24"));

    expect(pings.peak).toBe(FLOOR);
  });

  it("runs a big range far wider than 32, up to the ICMP ceiling", async () => {
    const pings: InFlight = { now: 0, peak: 0 };
    const tick: () => Promise<void> = recordPeak(pings);

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (): Promise<boolean> => {
        await tick();
        return false;
      });
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    // 32,768 addresses — the largest target a scan may carry.
    await SubnetScanner.scan(scanConfig("10.0.0-127.0-255"));

    expect(pings.peak).toBe(ICMP_CEILING);
  });

  it("runs the SNMP fallback pass at the higher SNMP ceiling", async () => {
    const probes: InFlight = { now: 0, peak: 0 };
    const tick: () => Promise<void> = recordPeak(probes);

    // Nothing answers ICMP, so every address is re-probed over SNMP.
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (): Promise<null> => {
        await tick();
        return null;
      });

    await SubnetScanner.scan(scanConfig("10.0.0-127.0-255"));

    expect(probes.peak).toBe(SNMP_CEILING);
  });

  it("obeys an explicit override on both passes", async () => {
    const pings: InFlight = { now: 0, peak: 0 };
    const probes: InFlight = { now: 0, peak: 0 };
    const pingTick: () => Promise<void> = recordPeak(pings);
    const probeTick: () => Promise<void> = recordPeak(probes);

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (): Promise<boolean> => {
        await pingTick();
        return true;
      });
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (): Promise<null> => {
        await probeTick();
        return null;
      });

    await SubnetScanner.scan(scanConfig("10.0.0.0/23", { maxConcurrency: 4 }));

    expect(pings.peak).toBe(4);
    expect(probes.peak).toBe(4);
  });
});
