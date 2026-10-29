import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import {
  MAX_READ_SUMMARY_WARNINGS,
  NetworkControllerReadSummary,
  readNetworkControllerReadSummary,
} from "../../../Types/NetworkController/NetworkControllerReadSummary";
import { describe, expect, test } from "@jest/globals";

/*
 * What the last read found, read back from the connection's JSON without
 * trusting it: the row and the page draw only what this returns.
 */

describe("reading a stored read summary", () => {
  test("a connection never read has none", () => {
    expect(readNetworkControllerReadSummary(undefined)).toBeUndefined();
    expect(readNetworkControllerReadSummary(null)).toBeUndefined();
    expect(readNetworkControllerReadSummary([])).toBeUndefined();
    expect(
      readNetworkControllerReadSummary({ status: "done" }),
    ).toBeUndefined();
  });

  test("a full summary is read as it was written", () => {
    const summary: NetworkControllerReadSummary = {
      status: "partial",
      organizationName: "Acme",
      networkCount: 312,
      applianceCount: 287,
      matchedDeviceCount: 40,
      uplinkWindows: 1,
      newestUplinkAt: "2026-10-24T11:50:00.000Z",
      analyticsNetworks: 120,
      analyticsNetworksWaiting: 192,
      trafficAnalysisOffNetworks: 3,
      rowsWritten: 5400,
      requestCount: 245,
      wasRateLimited: true,
      warnings: ["Traffic analysis is off on 3 networks."],
      failureKind: LlmConnectionFailureKind.RateLimited,
      durationMs: 81000,
      finishedAt: "2026-10-24T11:56:21.000Z",
    };

    expect(readNetworkControllerReadSummary(summary)).toEqual(summary);
  });

  test("numbers that are not numbers read as 0, and an unknown failure kind as none", () => {
    const read: NetworkControllerReadSummary | undefined =
      readNetworkControllerReadSummary({
        status: "success",
        networkCount: "12",
        applianceCount: -4,
        requestCount: "many",
        failureKind: "gremlins",
        wasRateLimited: "yes",
      });

    expect(read?.networkCount).toBe(12);
    expect(read?.applianceCount).toBe(0);
    expect(read?.requestCount).toBe(0);
    expect(read?.failureKind).toBeUndefined();
    expect(read?.wasRateLimited).toBe(false);
    expect(read?.newestUplinkAt).toBeUndefined();
  });

  test("the devices the device list described are read back with it", () => {
    const read: NetworkControllerReadSummary | undefined =
      readNetworkControllerReadSummary({
        status: "success",
        deviceCount: 1204,
        describedDeviceCount: 212,
      });

    expect(read?.deviceCount).toBe(1204);
    expect(read?.describedDeviceCount).toBe(212);
  });

  test("a summary from before Meraki filled in devices' details has no device counts, not zeros", () => {
    const read: NetworkControllerReadSummary | undefined =
      readNetworkControllerReadSummary({
        status: "success",
        applianceCount: 5,
      });

    expect(read).toBeDefined();
    expect("deviceCount" in read!).toBe(false);
    expect("describedDeviceCount" in read!).toBe(false);
  });

  test("more devices described than listed cannot be: held to the list", () => {
    const read: NetworkControllerReadSummary | undefined =
      readNetworkControllerReadSummary({
        status: "success",
        deviceCount: 10,
        describedDeviceCount: 25,
      });

    expect(read?.describedDeviceCount).toBe(10);
  });

  test("warnings are text only, and at most ten", () => {
    const read: NetworkControllerReadSummary | undefined =
      readNetworkControllerReadSummary({
        status: "success",
        warnings: [
          "one",
          5,
          "",
          ...Array.from({ length: 20 }, (_: unknown, index: number) => {
            return `w${index}`;
          }),
        ],
      });

    expect(read?.warnings).toHaveLength(MAX_READ_SUMMARY_WARNINGS);
    expect(read?.warnings[0]).toBe("one");
    expect(
      read?.warnings.every((warning: string) => {
        return typeof warning === "string" && warning.length > 0;
      }),
    ).toBe(true);
  });
});
