import NetworkTrafficSummaryUtil, {
  FIND_QUERY_REQUIRED_MESSAGE,
  ParsedNetworkTrafficFindRequest,
  ParsedNetworkTrafficRequest,
} from "../../../../Server/Utils/NetworkFlow/NetworkTrafficSummary";
import NetworkAddressNamesUtil, {
  NetworkAddressNamesRequest,
} from "../../../../Server/Utils/NetworkFlow/NetworkAddressNames";
import NetworkTrafficAggregationService, {
  NetworkTrafficAggregates,
  NetworkTrafficDnsName,
  NetworkTrafficQuery,
} from "../../../../Server/Services/NetworkTrafficAggregationService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import logger from "../../../../Server/Utils/Logger";
import TelemetryReadAccess from "../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import QueryTimeoutException from "../../../../Types/Exception/QueryTimeoutException";
import {
  MAX_NETWORK_TRAFFIC_FIND_QUERY_LENGTH,
  NETWORK_TRAFFIC_FIND_LIMIT,
  NetworkTrafficFindResult,
  NetworkTrafficSummary,
} from "../../../../Types/NetFlow/NetworkTraffic";
import {
  NetworkAddressNameSource,
  NetworkTrafficAddressNames,
} from "../../../../Types/NetFlow/NetworkAddressName";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A Traffic page's names (issue #5340): the summary names every address
 * the page shows - its lists, both ends of its conversations, its filters,
 * the exporters that are no device yet - in one go, with the DNS names its
 * flows carried; names never take the page down. And "find an address" by
 * a name: within the page's scope and window, answered only with addresses
 * the page can show, busiest first.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const ROUTER: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000001");
const NOW: Date = new Date("2026-10-28T12:00:00.000Z");

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("80000000-0000-4000-8000-000000000001"),
};

function aggregates(
  overrides: Partial<NetworkTrafficAggregates> = {},
): NetworkTrafficAggregates {
  return {
    totals: { octets: 100, packets: 2, flows: 2 },
    maxSamplingRate: 1,
    bucketSeconds: 60,
    series: [],
    topSources: [],
    topDestinations: [],
    topConversations: [],
    topApplications: [],
    topInterfaces: [],
    topDevices: [],
    dnsNames: new Map(),
    ...overrides,
  };
}

function request(
  overrides: Partial<ParsedNetworkTrafficRequest> = {},
): ParsedNetworkTrafficRequest {
  return {
    networkDeviceId: null,
    networkSiteId: null,
    startTime: new Date("2026-10-28T11:00:00.000Z"),
    endTime: NOW,
    filters: {},
    ...overrides,
  };
}

function dns(name: string, at: string): NetworkTrafficDnsName {
  return { name: name, at: at };
}

let resolve: SpyInstance<typeof NetworkAddressNamesUtil.resolve>;

beforeEach(() => {
  const scope: TelemetryReadScope =
    TelemetryReadScopeUtil.getUnrestrictedScope();

  jest.spyOn(TelemetryReadAccess, "getScope").mockResolvedValue(scope as never);
  jest
    .spyOn(NetworkTrafficAggregationService, "getSources")
    .mockResolvedValue([] as never);
  jest
    .spyOn(NetworkTrafficAggregationService, "getLastFlowAt")
    .mockResolvedValue(null as never);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(NetworkInterfaceService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });

  resolve = jest
    .spyOn(NetworkAddressNamesUtil, "resolve")
    .mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function resolveRequest(index: number = 0): NetworkAddressNamesRequest {
  return resolve.mock.calls[index]![0] as NetworkAddressNamesRequest;
}

describe("the summary names the page's addresses", () => {
  test("every address the page shows is named in one go, in the order the page shows them", async () => {
    jest
      .spyOn(NetworkTrafficAggregationService, "getAggregates")
      .mockResolvedValue(
        aggregates({
          topSources: [
            { ip: "10.0.0.1", octets: 10, packets: 1 },
            { ip: "10.0.0.2", octets: 9, packets: 1 },
          ],
          topDestinations: [
            { ip: "10.0.0.2", octets: 9, packets: 1 },
            { ip: "198.51.100.20", octets: 8, packets: 1 },
          ],
          topConversations: [
            {
              sourceIp: "10.0.0.3",
              destinationIp: "198.51.100.20",
              octets: 5,
              packets: 1,
            },
          ],
          topDevices: [
            // A device's own address is its device's name: not asked about.
            {
              networkDeviceId: ROUTER.toString(),
              exporterIp: "10.255.0.1",
              octets: 9,
              packets: 1,
            },
            // An exporter that is no device yet may have a name of its own.
            {
              networkDeviceId: PROJECT.toString(),
              exporterIp: "10.9.9.9",
              octets: 1,
              packets: 1,
            },
          ],
        }) as never,
      );

    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request({ filters: { hostIp: "10.0.0.50" } }),
      now: NOW,
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolveRequest().addresses).toEqual([
      "10.0.0.50",
      "10.0.0.1",
      "10.0.0.2",
      "198.51.100.20",
      "10.0.0.3",
      "10.9.9.9",
    ]);
    expect(String(resolveRequest().projectId)).toBe(PROJECT.toString());
    expect(resolveRequest().props).toBe(PROPS);
    expect(resolveRequest().startTime).toEqual(
      new Date("2026-10-28T11:00:00.000Z"),
    );
    expect(resolveRequest().endTime).toEqual(NOW);
  });

  test("every filter that names an address is asked about, even when the window is empty of it", async () => {
    jest
      .spyOn(NetworkTrafficAggregationService, "getAggregates")
      .mockResolvedValue(aggregates() as never);

    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request({
        filters: {
          sourceIp: "10.0.0.1",
          destinationIp: "10.0.0.2",
          exporterIp: "10.255.0.9",
        },
      }),
      now: NOW,
    });

    expect(resolveRequest().addresses).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.255.0.9",
    ]);
  });

  test("the DNS names the page's flows carried are handed over, the newest of each", async () => {
    jest
      .spyOn(NetworkTrafficAggregationService, "getAggregates")
      .mockResolvedValue(
        aggregates({
          topSources: [{ ip: "10.0.0.1", octets: 10, packets: 1 }],
          dnsNames: new Map([
            ["10.0.0.1", dns("fs01.corp.example", "2026-10-28 11:30:00")],
          ]),
        }) as never,
      );

    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request(),
      now: NOW,
    });

    expect(Array.from(resolveRequest().dnsNames!.entries())).toEqual([
      ["10.0.0.1", "fs01.corp.example"],
    ]);
  });

  test("the answer carries the names as they were resolved", async () => {
    const names: NetworkTrafficAddressNames = {
      "10.0.0.1": {
        name: "mumbai-fs01",
        source: NetworkAddressNameSource.Host,
        resourceId: "60000000-0000-4000-8000-000000000001",
        subnetName: "Mumbai office",
        subnet: "10.0.0.0/24",
      },
    };
    resolve.mockResolvedValue(names as never);
    jest
      .spyOn(NetworkTrafficAggregationService, "getAggregates")
      .mockResolvedValue(
        aggregates({
          topSources: [{ ip: "10.0.0.1", octets: 10, packets: 1 }],
        }) as never,
      );

    const summary: NetworkTrafficSummary =
      await NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request(),
        now: NOW,
      });

    expect(summary.addressNames).toEqual(names);
  });

  test("a page with no addresses asks for no names", async () => {
    jest
      .spyOn(NetworkTrafficAggregationService, "getAggregates")
      .mockResolvedValue(aggregates() as never);

    const summary: NetworkTrafficSummary =
      await NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request(),
        now: NOW,
      });

    expect(resolve).not.toHaveBeenCalled();
    expect(summary.addressNames).toEqual({});
  });

  test("names that cannot be read leave the page answering, with addresses as themselves", async () => {
    resolve.mockRejectedValue(new Error("names went away") as never);
    jest
      .spyOn(NetworkTrafficAggregationService, "getAggregates")
      .mockResolvedValue(
        aggregates({
          topSources: [{ ip: "10.0.0.1", octets: 10, packets: 1 }],
        }) as never,
      );

    const summary: NetworkTrafficSummary =
      await NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request(),
        now: NOW,
      });

    expect(summary.addressNames).toEqual({});
    expect(summary.topSources).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not name the page's addresses"),
    );
  });
});

describe("NetworkTrafficSummaryUtil.getPageAddresses", () => {
  test("each address once, the known devices' own exporters left out", () => {
    expect(
      NetworkTrafficSummaryUtil.getPageAddresses({
        request: request({ filters: { sourceIp: "10.0.0.1" } }),
        aggregates: aggregates({
          topSources: [{ ip: "10.0.0.1", octets: 1, packets: 1 }],
          topDestinations: [{ ip: "10.0.0.1", octets: 1, packets: 1 }],
          topConversations: [
            {
              sourceIp: "10.0.0.1",
              destinationIp: "10.0.0.1",
              octets: 1,
              packets: 1,
            },
          ],
        }),
        topDevices: [
          {
            networkDeviceId: ROUTER.toString(),
            exporterIp: "10.255.0.1",
            octets: 1,
            packets: 1,
          },
        ],
        sources: [
          {
            exporterIp: "10.255.0.7",
            flowFormat: "IPFIX",
            samplingRate: 1,
            lastFlowAt: "",
            flows: 1,
            octets: 1,
          },
        ],
      }),
    ).toEqual(["10.0.0.1", "10.255.0.7"]);
  });
});

describe("NetworkTrafficSummaryUtil.parseFindRequest", () => {
  test("reads the page's scope and window, and the text typed on one line", () => {
    const parsed: ParsedNetworkTrafficFindRequest =
      NetworkTrafficSummaryUtil.parseFindRequest(
        {
          networkDeviceId: ROUTER.toString(),
          startTime: "2026-10-28T11:00:00.000Z",
          endTime: "2026-10-28T12:00:00.000Z",
          query: "  mumbai\n fs01 ",
          // A find never narrows by the page's filters.
          filters: { sourceIp: "10.0.0.1" },
        },
        NOW,
      );

    expect(parsed.query).toBe("mumbai fs01");
    expect(String(parsed.networkDeviceId)).toBe(ROUTER.toString());
    expect(parsed.startTime).toEqual(new Date("2026-10-28T11:00:00.000Z"));
    expect(parsed.filters).toEqual({});
  });

  test("nothing typed asks for a name or an address", () => {
    for (const body of [{}, { query: "" }, { query: "   " }, null, "text"]) {
      expect(() => {
        NetworkTrafficSummaryUtil.parseFindRequest(body, NOW);
      }).toThrow(new BadDataException(FIND_QUERY_REQUIRED_MESSAGE));
    }
  });

  test("a query that is not text is refused", () => {
    expect(() => {
      NetworkTrafficSummaryUtil.parseFindRequest({ query: ["a"] }, NOW);
    }).toThrow(new BadDataException("query must be text"));
  });

  test("a query longer than a name can be is refused", () => {
    // Cleaned names stop at 100 characters, so this is about the limit itself.
    expect(MAX_NETWORK_TRAFFIC_FIND_QUERY_LENGTH).toBe(100);
    expect(
      NetworkTrafficSummaryUtil.parseFindRequest(
        { query: "a".repeat(MAX_NETWORK_TRAFFIC_FIND_QUERY_LENGTH) },
        NOW,
      ).query,
    ).toHaveLength(MAX_NETWORK_TRAFFIC_FIND_QUERY_LENGTH);
  });

  test("the page's scope is checked as the summary's is", () => {
    expect(() => {
      NetworkTrafficSummaryUtil.parseFindRequest(
        { query: "fs01", networkDeviceId: "not-an-id" },
        NOW,
      );
    }).toThrow(BadDataException);
  });
});

describe("NetworkTrafficSummaryUtil.find", () => {
  let byDns: SpyInstance<
    typeof NetworkTrafficAggregationService.findAddressesByDnsName
  >;
  let byName: SpyInstance<typeof NetworkAddressNamesUtil.findAddressesByName>;
  let traffic: SpyInstance<
    typeof NetworkTrafficAggregationService.getAddressTraffic
  >;

  beforeEach(() => {
    byDns = jest
      .spyOn(NetworkTrafficAggregationService, "findAddressesByDnsName")
      .mockResolvedValue(new Map() as never);
    byName = jest
      .spyOn(NetworkAddressNamesUtil, "findAddressesByName")
      .mockResolvedValue([] as never);
    traffic = jest
      .spyOn(NetworkTrafficAggregationService, "getAddressTraffic")
      .mockResolvedValue(new Map() as never);
  });

  function findRequest(
    query: string,
    overrides: Partial<ParsedNetworkTrafficFindRequest> = {},
  ): ParsedNetworkTrafficFindRequest {
    return { ...request(), query: query, ...overrides };
  }

  test("a name: searched in the flows' DNS names and the project's own names, answered busiest first with the name the page calls each", async () => {
    byDns.mockResolvedValue(
      new Map([["10.0.0.31", "mum-print-02.corp.example"]]) as never,
    );
    byName.mockResolvedValue(["10.0.0.35", "10.0.0.99"] as never);
    traffic.mockResolvedValue(
      new Map([
        ["10.0.0.35", 12_500_000],
        ["10.0.0.31", 8_110_000],
      ]) as never,
    );
    resolve.mockResolvedValue({
      "10.0.0.35": {
        name: "mumbai-fs01",
        source: NetworkAddressNameSource.Host,
      },
      "10.0.0.31": {
        name: "mum-print-02.corp.example",
        source: NetworkAddressNameSource.Dns,
      },
    } as never);

    const result: NetworkTrafficFindResult =
      await NetworkTrafficSummaryUtil.find({
        props: PROPS,
        request: findRequest("mum"),
      });

    expect(result.matches).toEqual([
      {
        address: "10.0.0.35",
        name: "mumbai-fs01",
        source: NetworkAddressNameSource.Host,
        octets: 12_500_000,
      },
      {
        address: "10.0.0.31",
        name: "mum-print-02.corp.example",
        source: NetworkAddressNameSource.Dns,
        octets: 8_110_000,
      },
    ]);

    // Only the candidates are read for traffic; the page's window and scope, no filters.
    const trafficArgs: {
      query: NetworkTrafficQuery;
      addresses: Array<string>;
    } = traffic.mock.calls[0]![0] as never;
    expect(trafficArgs.addresses).toEqual([
      "10.0.0.31",
      "10.0.0.35",
      "10.0.0.99",
    ]);
    expect(trafficArgs.query.filters).toEqual({});
    expect(String(trafficArgs.query.projectId)).toBe(PROJECT.toString());

    // The names are those of the addresses found, with the DNS names that matched.
    expect(resolveRequest().addresses).toEqual(["10.0.0.35", "10.0.0.31"]);
    expect(Array.from(resolveRequest().dnsNames!.entries())).toEqual([
      ["10.0.0.31", "mum-print-02.corp.example"],
    ]);
    expect(resolveRequest().props).toBe(PROPS);
  });

  test("a name that matched no address with traffic in the window answers nothing", async () => {
    byName.mockResolvedValue(["10.0.0.35"] as never);

    const result: NetworkTrafficFindResult =
      await NetworkTrafficSummaryUtil.find({
        props: PROPS,
        request: findRequest("idle-host"),
      });

    expect(result.matches).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  test("a match whose name the page would not show (the record left the window) is left out", async () => {
    byName.mockResolvedValue(["10.0.0.35"] as never);
    traffic.mockResolvedValue(new Map([["10.0.0.35", 10]]) as never);
    resolve.mockResolvedValue({} as never);

    const result: NetworkTrafficFindResult =
      await NetworkTrafficSummaryUtil.find({
        props: PROPS,
        request: findRequest("payroll"),
      });

    expect(result.matches).toEqual([]);
  });

  test("an address typed is its own answer when the window has its traffic, named or not", async () => {
    traffic.mockResolvedValue(new Map([["2001:db8::5", 42]]) as never);

    const result: NetworkTrafficFindResult =
      await NetworkTrafficSummaryUtil.find({
        props: PROPS,
        request: findRequest("2001:DB8:0:0::5"),
      });

    expect(byDns).not.toHaveBeenCalled();
    expect(byName).not.toHaveBeenCalled();
    expect(
      (traffic.mock.calls[0]![0] as { addresses: Array<string> }).addresses,
    ).toEqual(["2001:db8::5"]);
    expect(result.matches).toEqual([
      {
        address: "2001:db8::5",
        name: "",
        source: NetworkAddressNameSource.Dns,
        octets: 42,
      },
    ]);
  });

  test("at most NETWORK_TRAFFIC_FIND_LIMIT addresses are answered", async () => {
    const many: Map<string, number> = new Map();

    for (
      let index: number = 0;
      index < NETWORK_TRAFFIC_FIND_LIMIT + 5;
      index++
    ) {
      many.set(`10.0.1.${index}`, 1000 - index);
    }

    byName.mockResolvedValue(Array.from(many.keys()) as never);
    traffic.mockResolvedValue(many as never);
    resolve.mockImplementation((async (data: NetworkAddressNamesRequest) => {
      const names: NetworkTrafficAddressNames = {};

      for (const address of data.addresses) {
        names[address] = {
          name: `host-${address}`,
          source: NetworkAddressNameSource.Host,
        };
      }

      return names;
    }) as never);

    const result: NetworkTrafficFindResult =
      await NetworkTrafficSummaryUtil.find({
        props: PROPS,
        request: findRequest("host"),
      });

    expect(result.matches).toHaveLength(NETWORK_TRAFFIC_FIND_LIMIT);
    expect(resolveRequest().addresses).toHaveLength(NETWORK_TRAFFIC_FIND_LIMIT);
  });

  test("a device's page finds within that device's flows, through the caller's read", async () => {
    const findOneBy: SpyInstance<typeof NetworkDeviceService.findOneBy> = jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(new NetworkDevice(ROUTER) as never);

    await NetworkTrafficSummaryUtil.find({
      props: PROPS,
      request: findRequest("fs01", { networkDeviceId: ROUTER }),
    });

    expect(
      (findOneBy.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps })
        .props,
    ).toBe(PROPS);
    const dnsArgs: { query: NetworkTrafficQuery; text: string } = byDns.mock
      .calls[0]![0] as never;
    expect(dnsArgs.text).toBe("fs01");
    expect(
      dnsArgs.query.devices.serviceIds?.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([ROUTER.toString()]);
  });

  test("a device the caller cannot read is not found, and nothing is searched", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(null as never);

    await expect(
      NetworkTrafficSummaryUtil.find({
        props: PROPS,
        request: findRequest("fs01", { networkDeviceId: ROUTER }),
      }),
    ).rejects.toThrow();
    expect(byDns).not.toHaveBeenCalled();
    expect(byName).not.toHaveBeenCalled();
  });

  test("a search that ran out of time says to pick a shorter range", async () => {
    byDns.mockRejectedValue({
      code: "159",
      type: "TIMEOUT_EXCEEDED",
    } as never);

    await expect(
      NetworkTrafficSummaryUtil.find({
        props: PROPS,
        request: findRequest("fs01"),
      }),
    ).rejects.toThrow(QueryTimeoutException);
  });

  test("any other failure is passed on", async () => {
    traffic.mockRejectedValue(new Error("connection refused") as never);
    byName.mockResolvedValue(["10.0.0.35"] as never);

    await expect(
      NetworkTrafficSummaryUtil.find({
        props: PROPS,
        request: findRequest("fs01"),
      }),
    ).rejects.toThrow("connection refused");
  });
});
