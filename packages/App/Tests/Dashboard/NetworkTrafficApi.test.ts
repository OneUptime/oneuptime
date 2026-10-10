/*
 * The request is built from the dashboard's APP_API_URL, which reads the
 * browser's window; the node environment has none, so it is given here.
 * The network itself is never reached: API.post is a mock.
 */
jest.mock("Common/UI/Config", () => {
  const { default: URLType } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };

  return {
    __esModule: true,
    APP_API_URL: URLType.fromString("https://oneuptime.example.com/api"),
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import {
  NETWORK_TRAFFIC_SUMMARY_PATH,
  fetchNetworkTraffic,
  parseNetworkTrafficSummary,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficApi";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { NetworkTrafficSummary } from "Common/Types/NetFlow/NetworkTraffic";
import API from "Common/UI/Utils/API/API";

/*
 * The Traffic pages read one answer per window. A server a version behind,
 * a row with a field missing, a number sent as a string: none of it may
 * take a page down, so the reader never trusts a shape.
 */

const postMock: jest.Mock = API.post as unknown as jest.Mock;

const FULL: JSONObject = {
  windowStartAt: "2026-10-01T10:00:00.000Z",
  windowEndAt: "2026-10-01T11:00:00.000Z",
  bucketSeconds: 60,
  totals: { octets: 5000, packets: 40, flows: 3 },
  maxSamplingRate: 512,
  series: [
    { time: "2026-10-01 10:00:00", octets: 1000 },
    {
      time: "2026-10-01 10:01:00",
      octets: 4000,
      inOctets: 3000,
      outOctets: 1000,
    },
  ],
  topSources: [{ ip: "10.0.0.5", octets: 3000, packets: 20 }],
  topDestinations: [{ ip: "10.0.0.9", octets: 2000, packets: 10 }],
  topConversations: [
    {
      sourceIp: "10.0.0.5",
      destinationIp: "10.0.0.9",
      octets: 1000,
      packets: 5,
    },
  ],
  topApplications: [
    { protocolNumber: 6, port: 443, octets: 5000, packets: 30 },
  ],
  topInterfaces: [
    {
      interfaceIndex: 3,
      name: "Gi0/3",
      alias: "uplink",
      speedInMbps: 1000,
      inOctets: 4000,
      outOctets: 1000,
    },
  ],
  topDevices: [
    {
      networkDeviceId: "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11",
      name: "core",
      exporterIp: "192.0.2.1",
      octets: 4000,
      packets: 30,
    },
    { exporterIp: "198.51.100.7", octets: 1000, packets: 10 },
  ],
  sources: [
    {
      networkDeviceId: "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11",
      name: "core",
      exporterIp: "192.0.2.1",
      probeId: "5d6f8e2a-1b3c-4d5e-8f70-9a1b2c3d4e5f",
      flowFormat: "IPFIX",
      samplingRate: 512,
      lastFlowAt: "2026-10-01 10:59:30",
      flows: 3,
      octets: 4000,
    },
  ],
  lastFlowAt: "2026-10-01 10:59:30",
};

describe("parseNetworkTrafficSummary", () => {
  test("reads every part of a full answer as it was sent", () => {
    const summary: NetworkTrafficSummary = parseNetworkTrafficSummary(FULL);

    expect(summary).toEqual({
      windowStartAt: "2026-10-01T10:00:00.000Z",
      windowEndAt: "2026-10-01T11:00:00.000Z",
      bucketSeconds: 60,
      totals: { octets: 5000, packets: 40, flows: 3 },
      maxSamplingRate: 512,
      series: [
        { time: "2026-10-01 10:00:00", octets: 1000 },
        {
          time: "2026-10-01 10:01:00",
          octets: 4000,
          inOctets: 3000,
          outOctets: 1000,
        },
      ],
      topSources: [{ ip: "10.0.0.5", octets: 3000, packets: 20 }],
      topDestinations: [{ ip: "10.0.0.9", octets: 2000, packets: 10 }],
      topConversations: [
        {
          sourceIp: "10.0.0.5",
          destinationIp: "10.0.0.9",
          octets: 1000,
          packets: 5,
        },
      ],
      topApplications: [
        { protocolNumber: 6, port: 443, octets: 5000, packets: 30 },
      ],
      topInterfaces: [
        {
          interfaceIndex: 3,
          name: "Gi0/3",
          alias: "uplink",
          speedInMbps: 1000,
          inOctets: 4000,
          outOctets: 1000,
        },
      ],
      topDevices: [
        {
          networkDeviceId: "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11",
          name: "core",
          exporterIp: "192.0.2.1",
          octets: 4000,
          packets: 30,
        },
        {
          networkDeviceId: undefined,
          name: undefined,
          exporterIp: "198.51.100.7",
          octets: 1000,
          packets: 10,
        },
      ],
      sources: [
        {
          networkDeviceId: "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11",
          name: "core",
          exporterIp: "192.0.2.1",
          probeId: "5d6f8e2a-1b3c-4d5e-8f70-9a1b2c3d4e5f",
          flowFormat: "IPFIX",
          samplingRate: 512,
          lastFlowAt: "2026-10-01 10:59:30",
          flows: 3,
          octets: 4000,
        },
      ],
      lastFlowAt: "2026-10-01 10:59:30",
    });
  });

  test("an empty or missing answer is an empty page, not an error", () => {
    for (const data of [undefined, {}]) {
      const summary: NetworkTrafficSummary = parseNetworkTrafficSummary(data);

      expect(summary.totals).toEqual({ octets: 0, packets: 0, flows: 0 });
      expect(summary.series).toEqual([]);
      expect(summary.topSources).toEqual([]);
      expect(summary.sources).toEqual([]);
      expect(summary.lastFlowAt).toBeNull();
      // Never a zero-width bucket or a sampling rate below one.
      expect(summary.bucketSeconds).toBe(60);
      expect(summary.maxSamplingRate).toBe(1);
    }
  });

  test("numbers sent as strings are read; anything else that is not a number is 0", () => {
    const summary: NetworkTrafficSummary = parseNetworkTrafficSummary({
      totals: { octets: "12345", packets: "many", flows: null },
      topSources: [{ ip: "10.0.0.5", octets: "300", packets: {} }],
    });

    expect(summary.totals).toEqual({ octets: 12345, packets: 0, flows: 0 });
    expect(summary.topSources).toEqual([
      { ip: "10.0.0.5", octets: 300, packets: 0 },
    ]);
  });

  test("a list that is not a list, and rows that are not objects, are left out", () => {
    const summary: NetworkTrafficSummary = parseNetworkTrafficSummary({
      topSources: "10.0.0.5",
      topDestinations: [
        null,
        7,
        "x",
        { ip: "10.0.0.9", octets: 1, packets: 1 },
      ],
    } as unknown as JSONObject);

    expect(summary.topSources).toEqual([]);
    expect(summary.topDestinations).toEqual([
      { ip: "10.0.0.9", octets: 1, packets: 1 },
    ]);
  });

  test("a series point without directions has none; an exporter's rate is at least 1", () => {
    const summary: NetworkTrafficSummary = parseNetworkTrafficSummary({
      series: [{ time: "2026-10-01 10:00:00", octets: 1 }],
      sources: [{ exporterIp: "192.0.2.1", samplingRate: 0 }],
    });

    expect(summary.series[0]).toEqual({
      time: "2026-10-01 10:00:00",
      octets: 1,
    });
    expect(summary.sources[0]!.samplingRate).toBe(1);
    expect(summary.sources[0]!.networkDeviceId).toBeUndefined();
  });
});

describe("fetchNetworkTraffic", () => {
  test("posts the request to the summary endpoint with the project's headers", async () => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: FULL });

    const summary: NetworkTrafficSummary = await fetchNetworkTraffic({
      networkDeviceId: "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11",
      startTime: "2026-10-01T10:00:00.000Z",
      endTime: "2026-10-01T11:00:00.000Z",
      filters: { sourceIp: "10.0.0.5" },
    });

    expect(NETWORK_TRAFFIC_SUMMARY_PATH).toBe("/network-traffic/summary");
    expect(postMock).toHaveBeenCalledTimes(1);
    const call: {
      url: { toString: () => string };
      data: JSONObject;
      headers: Record<string, string>;
    } = postMock.mock.calls[0]![0];
    expect(call.url.toString()).toBe(
      "https://oneuptime.example.com/api/network-traffic/summary",
    );
    expect(call.data).toEqual({
      networkDeviceId: "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11",
      startTime: "2026-10-01T10:00:00.000Z",
      endTime: "2026-10-01T11:00:00.000Z",
      filters: { sourceIp: "10.0.0.5" },
    });
    expect(call.headers).toEqual({
      tenantid: "10000000-0000-4000-8000-000000000001",
    });
    expect(summary.totals.flows).toBe(3);
  });

  test("an error answer is thrown, for the page to say", async () => {
    postMock.mockReset();
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "The time range can be at most 31 days." },
      {},
    );
    postMock.mockResolvedValue(error);

    await expect(
      fetchNetworkTraffic({
        startTime: "2026-10-01T10:00:00.000Z",
        endTime: "2026-11-20T10:00:00.000Z",
      }),
    ).rejects.toBe(error);
  });
});
