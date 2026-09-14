process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const axiosCalls: Array<{
  url: string;
  timeout: number | undefined;
  signal: unknown;
}> = [];

import ExternalStatusPageMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { Readable } from "stream";

/*
 * Follow-up to https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * The provider fetchers read `config.timeout || options.timeout`, so the
 * per-step timeout could never win over the type-specific config default.
 */

function buildConfig(timeout: number): MonitorStepExternalStatusPageMonitor {
  return {
    // A public literal keeps this unit test independent from real DNS.
    statusPageUrl: "https://1.1.1.1",
    provider: ExternalStatusPageProviderType.AtlassianStatuspage,
    timeout: timeout,
    retries: 3,
  };
}

beforeEach(() => {
  axiosCalls.length = 0;
  let elapsedInMs: number = 0;
  jest.spyOn(Date, "now").mockImplementation(() => {
    return 1_788_456_000_000 + elapsedInMs;
  });
  jest
    .spyOn(axios, "get")
    .mockImplementation(
      async (
        url: string,
        options?: AxiosRequestConfig,
      ): Promise<AxiosResponse> => {
        axiosCalls.push({
          url: url,
          timeout: options?.timeout,
          signal: options?.signal,
        });
        elapsedInMs += 100;

        return {
          status: 200,
          statusText: "OK",
          data: Readable.from([
            Buffer.from(
              JSON.stringify({
                status: {
                  indicator: "none",
                  description: "All Systems Go",
                },
                components: [],
                incidents: [],
              }),
            ),
          ]),
          headers: {},
          config: {},
          request: {},
        } as AxiosResponse;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ExternalStatusPageMonitorUtil timeout precedence", () => {
  test("prefers an explicitly supplied options.timeout over the config default", async () => {
    await ExternalStatusPageMonitorUtil.fetch(buildConfig(10000), {
      timeout: 1234,
      isOnlineCheckRequest: true,
    });

    expect(axiosCalls).toHaveLength(3);
    expect(
      axiosCalls.map((call: { timeout: number | undefined }) => {
        return call.timeout;
      }),
    ).toEqual([1234, 1134, 1034]);
    expect(
      new Set(
        axiosCalls.map((call: { signal: unknown }): unknown => {
          return call.signal;
        }),
      ).size,
    ).toBe(1);
  });

  test("falls back to the config timeout when the caller supplies none", async () => {
    await ExternalStatusPageMonitorUtil.fetch(buildConfig(2500), {
      isOnlineCheckRequest: true,
    });

    expect(axiosCalls).toHaveLength(3);
    expect(
      axiosCalls.map((call: { timeout: number | undefined }) => {
        return call.timeout;
      }),
    ).toEqual([2500, 2400, 2300]);
    expect(
      new Set(
        axiosCalls.map((call: { signal: unknown }): unknown => {
          return call.signal;
        }),
      ).size,
    ).toBe(1);
  });

  test("creates a fresh deadline when the same caller options object is reused", async () => {
    const options: NonNullable<
      Parameters<typeof ExternalStatusPageMonitorUtil.fetch>[1]
    > = {
      timeout: 2500,
      isOnlineCheckRequest: true,
    };

    await ExternalStatusPageMonitorUtil.fetch(buildConfig(10000), options);
    expect(options.executionContext).toBeUndefined();

    await ExternalStatusPageMonitorUtil.fetch(buildConfig(10000), options);
    expect(options.executionContext).toBeUndefined();

    expect(axiosCalls).toHaveLength(6);
    expect(axiosCalls[0]!.signal).toBe(axiosCalls[1]!.signal);
    expect(axiosCalls[1]!.signal).toBe(axiosCalls[2]!.signal);
    expect(axiosCalls[3]!.signal).toBe(axiosCalls[4]!.signal);
    expect(axiosCalls[4]!.signal).toBe(axiosCalls[5]!.signal);
    expect(axiosCalls[3]!.signal).not.toBe(axiosCalls[0]!.signal);
  });
});
