import "../../TestingUtils/DiscoveryEnvironment";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";
import {
  ScanProgressReporter,
  scanWithDeadline,
  buildScanProgressMessage,
} from "../../../Jobs/Discovery/FetchScans";
import SubnetScanner, {
  SubnetScanConfig,
  SubnetScanProgress,
  SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";

const progress: SubnetScanProgress = {
  sweptHostCount: 100,
  totalHostCount: 15360,
  discoveredHosts: [{ ipAddress: "192.0.2.1", snmpReachable: true }],
  snmpResponderCount: 1,
  isIcmpOnlySweep: false,
};

function reporter(intervalInMs: number): ScanProgressReporter {
  return new ScanProgressReporter({
    scanId: "11111111-2222-3333-4444-555555555555",
    resultUrl: URL.fromString(
      "https://oneuptime.example.com/probe/discovery-scan/result",
    ),
    intervalInMs,
  });
}

stubReverseDnsAsResolvingNothing();

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("discovery progress lifecycle (#3672)", () => {
  test("flushes the latest throttled findings before closing a failed scan", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    const subject: ScanProgressReporter = reporter(30000);
    subject.report(progress);
    subject.report({ ...progress, sweptHostCount: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await subject.close(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]![0].data).toMatchObject({
      isPartial: true,
      scannedHostCount: 200,
      discoveredDevices: progress.discoveredHosts,
    });
    subject.report({ ...progress, sweptHostCount: 300 });
    await subject.close(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("coalesces pending updates and waits for the current upload before flushing", async () => {
    let release: () => void = (): void => {};
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    fetchSpy.mockImplementationOnce((): never => {
      return new Promise<void>((resolve: () => void) => {
        release = resolve;
      }) as never;
    });
    const subject: ScanProgressReporter = reporter(0);
    subject.report(progress);
    subject.report({ ...progress, sweptHostCount: 200 });
    subject.report({ ...progress, sweptHostCount: 300 });
    const closing: Promise<void> = subject.close(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    release();
    await closing;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]![0].data).toMatchObject({
      scannedHostCount: 300,
    });
  });

  test("successful completion discards pending partials because the final result supersedes them", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    const subject: ScanProgressReporter = reporter(30000);
    subject.report(progress);
    await subject.close();
    await subject.close(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("a failed final partial upload cannot prevent the terminal failure report", async () => {
    jest
      .spyOn(API, "fetch")
      .mockRejectedValue(new Error("Server unavailable") as never);
    const subject: ScanProgressReporter = reporter(30000);
    subject.report(progress);
    await expect(subject.close(true)).resolves.toBeUndefined();
  });

  test("the deadline aborts the scanner and prevents abandoned work from reporting progress", async () => {
    jest.useFakeTimers({ doNotFake: ["performance"] });
    let captured: SubnetScanConfig | undefined;
    jest
      .spyOn(SubnetScanner, "scan")
      .mockImplementation(
        (config: SubnetScanConfig): Promise<SubnetScanResult> => {
          captured = config;
          return new Promise<SubnetScanResult>(() => {});
        },
      );
    // eslint-disable-next-line @typescript-eslint/typedef
    const onProgress = jest.fn<(value: SubnetScanProgress) => void>();
    const running: Promise<SubnetScanResult> = scanWithDeadline(
      { cidr: "192.0.2.0/24", onProgress },
      "test-scan",
      1000,
    );
    const outcome: Promise<void> =
      expect(running).rejects.toThrow("did not finish");
    expect(captured?.signal?.aborted).toBe(false);
    await captured?.onProgress?.(progress);
    expect(onProgress).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1000);
    await outcome;
    expect(captured?.signal?.aborted).toBe(true);
    await captured?.onProgress?.(progress);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("live phase descriptions", () => {
  const phaseCases: Array<[SubnetScanProgress["phase"], string]> = [
    ["icmp", "Checking ping reachability"],
    ["snmp", "Checking SNMP credentials"],
    ["snmp-fallback", "Checking SNMP on addresses that did not answer ping"],
  ];
  test.each(phaseCases)(
    "describes %s work even when no new host has responded",
    (phase: SubnetScanProgress["phase"], label: string) => {
      const message: string = buildScanProgressMessage({
        ...progress,
        phase,
        phaseCompletedHostCount: 1024,
        phaseTotalHostCount: 15360,
        discoveredHosts: [],
        snmpResponderCount: 0,
      });
      expect(message).toContain(`${label} (1,024 of 15,360)`);
      expect(message.length).toBeLessThanOrEqual(500);
    },
  );
});
