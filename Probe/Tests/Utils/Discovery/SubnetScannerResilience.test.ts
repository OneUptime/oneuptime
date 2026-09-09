import "../../TestingUtils/DiscoveryEnvironment";

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import SubnetScanner, {
  SubnetScanConfig,
  SubnetScanProgress,
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import { SpyInstance } from "jest-mock";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

const credential: SubnetScanSnmpConfig = {
  id: "one",
  label: "SNMP v2c",
  snmpVersion: SnmpVersion.V2c,
  communityString: "public",
  port: 161,
};
function config(overrides: Partial<SubnetScanConfig> = {}): SubnetScanConfig {
  return { cidr: "10.0.0.0/29", snmpConfigs: [credential], ...overrides };
}
async function flushWorkers(): Promise<void> {
  for (let i: number = 0; i < 40; i++) {
    await Promise.resolve();
  }
}
stubReverseDnsAsResolvingNothing();
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("SubnetScanner bounded work and live progress (#3672)", () => {
  it("covers the reported 15,360-address range with bounded, fully utilized workers", async () => {
    let pings: number = 0;
    let peakPings: number = 0;
    let snmp: number = 0;
    let peakSnmp: number = 0;
    const pingSpy: SpyInstance<typeof SubnetScanner.isHostAliveByPing> = jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async () => {
        peakPings = Math.max(peakPings, ++pings);
        await Promise.resolve();
        pings--;
        return false;
      });
    const snmpSpy: SpyInstance<typeof SnmpMonitor.probeSystemInfo> = jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async () => {
        peakSnmp = Math.max(peakSnmp, ++snmp);
        await Promise.resolve();
        snmp--;
        return null;
      });
    const reports: Array<SubnetScanProgress> = [];
    const result: SubnetScanResult = await SubnetScanner.scan(
      config({
        cidr: "10.240-249.0-255.220-225",
        onProgress: (progress: SubnetScanProgress) => {
          reports.push(progress);
        },
      }),
    );
    expect(result.scannedHostCount).toBe(15360);
    expect(pingSpy).toHaveBeenCalledTimes(15360);
    expect(snmpSpy).toHaveBeenCalledTimes(15360);
    expect(peakPings).toBe(128);
    expect(peakSnmp).toBe(256);
    expect(pings + snmp).toBe(0);
    expect(result.icmpFilteredFallbackHostCount).toBe(15360);
    expect(reports[reports.length - 1]).toMatchObject({
      sweptHostCount: 15360,
      phase: "snmp-fallback",
      phaseCompletedHostCount: 15360,
      phaseTotalHostCount: 15360,
    });
  });

  it("reports completed addresses while another ping is stalled and stops promptly on abort", async () => {
    jest.useFakeTimers({ doNotFake: ["performance"] });
    const controller: AbortController = new AbortController();
    let release: (alive: boolean) => void = (): void => {};
    const pending: Promise<boolean> = new Promise(
      (resolve: (alive: boolean) => void) => {
        release = resolve;
      },
    );
    const pingSpy: SpyInstance<typeof SubnetScanner.isHostAliveByPing> = jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        return host === "10.0.0.1" ? await pending : false;
      });
    const snmpSpy: SpyInstance<typeof SnmpMonitor.probeSystemInfo> = jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockResolvedValue(null);
    const reports: Array<SubnetScanProgress> = [];
    const scanning: Promise<unknown> = SubnetScanner.scan(
      config({
        signal: controller.signal,
        onProgress: (progress: SubnetScanProgress) => {
          reports.push(progress);
        },
      }),
    );
    await flushWorkers();
    jest.advanceTimersByTime(1000);
    expect(reports[0]).toMatchObject({
      sweptHostCount: 5,
      phase: "icmp",
      phaseCompletedHostCount: 5,
      phaseTotalHostCount: 6,
    });
    const rejected: Promise<void> =
      expect(scanning).rejects.toThrow("scan deadline");
    controller.abort(new Error("scan deadline"));
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
    release(true);
    await flushWorkers();
    jest.advanceTimersByTime(5000);
    expect(reports).toHaveLength(1);
    expect(pingSpy).toHaveBeenCalledTimes(6);
    expect(snmpSpy).not.toHaveBeenCalled();
  });

  it("makes confirmed SNMP hosts available before a slow peer finishes", async () => {
    jest.useFakeTimers({ doNotFake: ["performance"] });
    const controller: AbortController = new AbortController();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (monitor: MonitorStepSnmpMonitor) => {
        if (monitor.hostname === "10.0.0.6") {
          return await new Promise<SnmpSystemInfo | null>(() => {});
        }
        return { sysName: monitor.hostname };
      });
    const reports: Array<SubnetScanProgress> = [];
    const scanning: Promise<SubnetScanResult> = SubnetScanner.scan(
      config({
        signal: controller.signal,
        onProgress: (progress: SubnetScanProgress) => {
          reports.push(progress);
        },
      }),
    );
    await flushWorkers();
    jest.advanceTimersByTime(1000);
    expect(reports[0]).toMatchObject({
      sweptHostCount: 5,
      phase: "snmp",
      phaseCompletedHostCount: 5,
      phaseTotalHostCount: 6,
      snmpResponderCount: 5,
    });
    expect(reports[0]?.discoveredHosts).toHaveLength(5);
    const rejected: Promise<void> = expect(scanning).rejects.toThrow("stop");
    controller.abort(new Error("stop"));
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });

  it("reports fallback work even when every address has already been swept", async () => {
    jest.useFakeTimers({ doNotFake: ["performance"] });
    const controller: AbortController = new AbortController();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (monitor: MonitorStepSnmpMonitor) => {
        if (monitor.hostname === "10.0.0.6") {
          return await new Promise<null>(() => {});
        }
        return null;
      });
    const reports: Array<SubnetScanProgress> = [];
    const scanning: Promise<SubnetScanResult> = SubnetScanner.scan(
      config({
        signal: controller.signal,
        onProgress: (progress: SubnetScanProgress) => {
          reports.push(progress);
        },
      }),
    );
    await flushWorkers();
    jest.advanceTimersByTime(1000);
    expect(reports[reports.length - 1]).toMatchObject({
      sweptHostCount: 6,
      phase: "snmp-fallback",
      phaseCompletedHostCount: 5,
      phaseTotalHostCount: 6,
    });
    const rejected: Promise<void> = expect(scanning).rejects.toThrow("stop");
    controller.abort(new Error("stop"));
    await rejected;
  });

  it("cannot be stalled by an upload callback that never settles", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    const result: SubnetScanResult = await SubnetScanner.scan(
      config({
        isSnmpEnabled: false,
        onProgress: () => {
          return new Promise<void>(() => {});
        },
      }),
    );
    expect(result.discoveredHosts).toHaveLength(6);
  });

  it("does not start a queued scan after its deadline has already passed", async () => {
    const controller: AbortController = new AbortController();
    controller.abort(new Error("deadline"));
    const pingSpy: SpyInstance<typeof SubnetScanner.isHostAliveByPing> =
      jest.spyOn(SubnetScanner, "isHostAliveByPing");
    await expect(
      SubnetScanner.scan(config({ signal: controller.signal })),
    ).rejects.toThrow("deadline");
    expect(pingSpy).not.toHaveBeenCalled();
  });

  it("does not try another credential or schedule another address after abort", async () => {
    const controller: AbortController = new AbortController();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    const snmpSpy: SpyInstance<typeof SnmpMonitor.probeSystemInfo> = jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async () => {
        controller.abort(new Error("deadline"));
        return null;
      });
    await expect(
      SubnetScanner.scan(
        config({
          maxConcurrency: 1,
          signal: controller.signal,
          snmpConfigs: [credential, { ...credential, id: "two" }],
        }),
      ),
    ).rejects.toThrow("deadline");
    expect(snmpSpy).toHaveBeenCalledTimes(1);
  });

  it("copies host objects so a progress consumer cannot corrupt the final result", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockResolvedValue({ sysName: "switch" });
    const result: SubnetScanResult = await SubnetScanner.scan(
      config({
        onProgress: (progress: SubnetScanProgress) => {
          progress.discoveredHosts[0]!.sysName = "changed";
        },
      }),
    );
    expect(result.discoveredHosts[0]?.sysName).toBe("switch");
  });

  it("keeps at least one worker for a positive fractional override", () => {
    expect(
      SubnetScanner.getSweepConcurrency({
        hostCount: 6,
        maxConcurrency: 128,
        override: 0.5,
      }),
    ).toBe(1);
    expect(
      SubnetScanner.getSweepConcurrency({
        hostCount: 6,
        maxConcurrency: 128,
        override: Infinity,
      }),
    ).toBe(6);
  });
});
