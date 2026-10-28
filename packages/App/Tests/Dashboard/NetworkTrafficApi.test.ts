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
  MAX_ADDRESS_NAMES_READ,
  NETWORK_TRAFFIC_FIND_ADDRESS_PATH,
  NETWORK_TRAFFIC_SUMMARY_PATH,
  fetchNetworkTraffic,
  findNetworkTrafficAddress,
  parseNetworkTrafficAddressNames,
  parseNetworkTrafficFindResult,
  parseNetworkTrafficSummary,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficApi";
import {
  NETWORK_TRAFFIC_FIND_LIMIT,
  NetworkTrafficFindResult,
} from "Common/Types/NetFlow/NetworkTraffic";
import {
  NetworkAddressNameSource,
  NetworkTrafficAddressNames,
} from "Common/Types/NetFlow/NetworkAddressName";
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
  addressNames: {
    "10.0.0.5": {
      name: "mumbai-fs01",
      source: "host",
      resourceId: "60000000-0000-4000-8000-000000000001",
      subnetName: "Mumbai office",
      subnet: "10.0.0.0/24",
    },
  },
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
      addressNames: {
        "10.0.0.5": {
          name: "mumbai-fs01",
          source: NetworkAddressNameSource.Host,
          resourceId: "60000000-0000-4000-8000-000000000001",
          subnetName: "Mumbai office",
          subnet: "10.0.0.0/24",
        },
      },
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
      // A server older than names sends none: every address is itself.
      expect(summary.addressNames).toEqual({});
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

/*
 * Names (issue #5340): a page's names are read as any answer is - an entry
 * that is not one is left out, and the address is then shown as itself.
 */
describe("parseNetworkTrafficAddressNames", () => {
  test("keeps each address's name, source, record and subnet as they were sent", () => {
    const names: NetworkTrafficAddressNames = parseNetworkTrafficAddressNames({
      "10.0.0.5": {
        name: "mumbai-fs01",
        source: "host",
        resourceId: "60000000-0000-4000-8000-000000000001",
      },
      "2001:db8::5": { name: "v6.corp.example", source: "dns" },
      "10.0.0.6": { subnetName: "Mumbai office", subnet: "10.0.0.0/24" },
    });

    expect(names).toEqual({
      "10.0.0.5": {
        name: "mumbai-fs01",
        source: NetworkAddressNameSource.Host,
        resourceId: "60000000-0000-4000-8000-000000000001",
      },
      "2001:db8::5": {
        name: "v6.corp.example",
        source: NetworkAddressNameSource.Dns,
      },
      "10.0.0.6": { subnetName: "Mumbai office", subnet: "10.0.0.0/24" },
    });
  });

  test("a name is drawn on one line: control characters and line breaks are taken out", () => {
    const names: NetworkTrafficAddressNames = parseNetworkTrafficAddressNames({
      "10.0.0.5": { name: "  Payroll\n SaaS ", source: "address-name" },
    });

    expect(names["10.0.0.5"]?.name).toBe("Payroll SaaS");
  });

  test("an entry that is not an address, or names nothing, is left out", () => {
    // JSON.parse makes "__proto__" an own key, as an answer off the wire would.
    const answer: unknown = JSON.parse(
      '{"router-1": {"name": "core", "source": "host"}, "__proto__": {"name": "polluted"}, "constructor": {"name": "nope"}, "10.0.0.5": "a name, not an object", "10.0.0.6": {"name": "", "subnetName": ""}, "10.0.0.7": null}',
    );
    const names: NetworkTrafficAddressNames =
      parseNetworkTrafficAddressNames(answer);

    expect(names).toEqual({});
    expect(Object.keys(names)).toEqual([]);
    expect(({} as Record<string, unknown>)["name"]).toBeUndefined();
  });

  test("a source this page does not know, a record id that is not one, a subnet that is not one: left off the name", () => {
    expect(
      parseNetworkTrafficAddressNames({
        "10.0.0.5": {
          name: "core",
          source: "something-newer",
          resourceId: "not-a-uuid",
          subnetName: "Office",
          subnet: "not a subnet",
        },
      }),
    ).toEqual({ "10.0.0.5": { name: "core", subnetName: "Office" } });
  });

  test("anything that is not an object of names is no names", () => {
    for (const value of [undefined, null, "names", 5, [{ name: "a" }]]) {
      expect(parseNetworkTrafficAddressNames(value)).toEqual({});
    }
  });

  test("at most a page's worth of names is read", () => {
    const many: JSONObject = {};

    for (let index: number = 0; index < MAX_ADDRESS_NAMES_READ + 25; index++) {
      many[`10.${Math.floor(index / 256)}.${index % 256}.1`] = {
        name: `host-${index}`,
      };
    }

    expect(Object.keys(parseNetworkTrafficAddressNames(many))).toHaveLength(
      MAX_ADDRESS_NAMES_READ,
    );
  });
});

describe("findNetworkTrafficAddress", () => {
  test("posts what was typed, with the page's scope and window, to the find endpoint", async () => {
    postMock.mockReset();
    postMock.mockResolvedValue({
      data: {
        matches: [
          {
            address: "10.0.0.5",
            name: "mumbai-fs01",
            source: "host",
            octets: "12500000",
          },
        ],
      },
    });

    const result: NetworkTrafficFindResult = await findNetworkTrafficAddress({
      networkSiteId: "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11",
      startTime: "2026-10-01T10:00:00.000Z",
      endTime: "2026-10-01T11:00:00.000Z",
      query: "mumbai",
    });

    expect(NETWORK_TRAFFIC_FIND_ADDRESS_PATH).toBe(
      "/network-traffic/find-address",
    );
    const call: {
      url: { toString: () => string };
      data: JSONObject;
      headers: Record<string, string>;
    } = postMock.mock.calls[0]![0];
    expect(call.url.toString()).toBe(
      "https://oneuptime.example.com/api/network-traffic/find-address",
    );
    expect(call.data).toEqual({
      networkSiteId: "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11",
      startTime: "2026-10-01T10:00:00.000Z",
      endTime: "2026-10-01T11:00:00.000Z",
      query: "mumbai",
    });
    expect(call.headers).toEqual({
      tenantid: "10000000-0000-4000-8000-000000000001",
    });
    expect(result.matches).toEqual([
      {
        address: "10.0.0.5",
        name: "mumbai-fs01",
        source: NetworkAddressNameSource.Host,
        octets: 12500000,
      },
    ]);
  });

  test("an error answer is thrown, for the box to say", async () => {
    postMock.mockReset();
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "Type a name or an IP address to find." },
      {},
    );
    postMock.mockResolvedValue(error);

    await expect(
      findNetworkTrafficAddress({
        startTime: "2026-10-01T10:00:00.000Z",
        endTime: "2026-10-01T11:00:00.000Z",
        query: " ",
      }),
    ).rejects.toBe(error);
  });
});

describe("parseNetworkTrafficFindResult", () => {
  test("leaves out what is not an address and what is there twice; a source it does not know reads as DNS", () => {
    expect(
      parseNetworkTrafficFindResult({
        matches: [
          { address: "10.0.0.5", name: "a", source: "host", octets: 3 },
          { address: "10.0.0.5", name: "b", source: "host", octets: 2 },
          { address: "router-1", name: "c", source: "host", octets: 1 },
          { address: "10.0.0.6", name: 5, source: "newer", octets: "x" },
          null,
        ],
      } as unknown as JSONObject),
    ).toEqual({
      matches: [
        {
          address: "10.0.0.5",
          name: "a",
          source: NetworkAddressNameSource.Host,
          octets: 3,
        },
        {
          address: "10.0.0.6",
          name: "",
          source: NetworkAddressNameSource.Dns,
          octets: 0,
        },
      ],
    });
  });

  test("at most the find limit, and nothing for an answer that is not one", () => {
    const matches: Array<JSONObject> = [];

    for (let index: number = 0; index < NETWORK_TRAFFIC_FIND_LIMIT + 5; index++) {
      matches.push({ address: `10.0.0.${index + 1}`, name: "x", octets: 1 });
    }

    expect(parseNetworkTrafficFindResult({ matches }).matches).toHaveLength(
      NETWORK_TRAFFIC_FIND_LIMIT,
    );
    expect(parseNetworkTrafficFindResult(undefined)).toEqual({ matches: [] });
    expect(
      parseNetworkTrafficFindResult({ matches: "none" } as unknown as JSONObject),
    ).toEqual({ matches: [] });
  });
});
