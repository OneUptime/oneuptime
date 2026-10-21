import { describe, expect, test } from "@jest/globals";
import {
  FILTER_APPLICATION_LABEL,
  FILTER_DESTINATION_LABEL,
  FILTER_DEVICE_LABEL,
  FILTER_EXPORTER_LABEL,
  FILTER_HOST_LABEL,
  FILTER_INTERFACE_LABEL,
  FILTER_SOURCE_LABEL,
  NETWORK_TRAFFIC_DEFAULT_RANGE,
  NETWORK_TRAFFIC_URL_PARAMS,
  NetworkTrafficFilterChip,
  NetworkTrafficFilterKind,
  NetworkTrafficViewState,
  getDefaultNetworkTrafficView,
  getNetworkTrafficFilterChips,
  readNetworkTrafficView,
  toNetworkTrafficUrlParams,
  withApplicationFilter,
  withoutNetworkTrafficFilter,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficUrlState";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import { NetworkTrafficFilters } from "Common/Types/NetFlow/NetworkTraffic";
import TimeRange from "Common/Types/Time/TimeRange";

/*
 * A Traffic page keeps what it shows - the time range and the filters a
 * click added - in the address bar, so a link to it lands on exactly that
 * view. The address is untrusted: anything the server would refuse is left
 * out here instead of failing the page.
 */

const DEVICE_ID: string = "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11";

function reader(query: string): (name: string) => string | null {
  const params: URLSearchParams = new URLSearchParams(query);

  return (name: string): string | null => {
    return params.get(name);
  };
}

// The address a view writes, as the browser would hold it.
function toQuery(view: NetworkTrafficViewState): string {
  const params: Dictionary<string | null> = toNetworkTrafficUrlParams(view);
  const search: URLSearchParams = new URLSearchParams();

  for (const name of Object.keys(params)) {
    const value: string | null | undefined = params[name];

    if (value !== null && value !== undefined) {
      search.set(name, value);
    }
  }

  return search.toString();
}

describe("the default view", () => {
  test("is the past hour with no filter, and writes nothing to the address", () => {
    const view: NetworkTrafficViewState = getDefaultNetworkTrafficView();

    expect(NETWORK_TRAFFIC_DEFAULT_RANGE).toBe(TimeRange.PAST_ONE_HOUR);
    expect(view).toEqual({
      range: { range: TimeRange.PAST_ONE_HOUR },
      filters: {},
    });
    expect(toQuery(view)).toBe("");
  });

  test("a bare address reads as the default view", () => {
    expect(readNetworkTrafficView(reader(""))).toEqual(
      getDefaultNetworkTrafficView(),
    );
  });

  test("every parameter the page owns is cleared when it is not set", () => {
    const params: Dictionary<string | null> = toNetworkTrafficUrlParams(
      getDefaultNetworkTrafficView(),
    );

    expect(Object.keys(params).sort()).toEqual(
      [...NETWORK_TRAFFIC_URL_PARAMS].sort(),
    );
    for (const name of NETWORK_TRAFFIC_URL_PARAMS) {
      expect(params[name]).toBeNull();
    }
  });
});

describe("the time range in the address", () => {
  test("a preset is written by its name and read back", () => {
    const view: NetworkTrafficViewState = {
      range: { range: TimeRange.PAST_ONE_DAY },
      filters: {},
    };

    expect(toQuery(view)).toBe("range=Past+1+Day");
    expect(readNetworkTrafficView(reader(toQuery(view)))).toEqual(view);
  });

  test("a custom window (a zoom) is written with its start and end, and read back", () => {
    const start: Date = new Date("2026-10-01T10:15:00.000Z");
    const end: Date = new Date("2026-10-01T10:45:00.000Z");
    const view: NetworkTrafficViewState = {
      range: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      },
      filters: {},
    };

    const read: NetworkTrafficViewState = readNetworkTrafficView(
      reader(toQuery(view)),
    );

    expect(read.range.range).toBe(TimeRange.CUSTOM);
    expect(read.range.startAndEndDate?.startValue.toISOString()).toBe(
      start.toISOString(),
    );
    expect(read.range.startAndEndDate?.endValue.toISOString()).toBe(
      end.toISOString(),
    );
  });

  test.each([
    ["an unknown range", "range=Past+7+Years"],
    ["a custom range with no dates", "range=Custom"],
    [
      "a custom range with a date that is not one",
      "range=Custom&start=yesterday&end=2026-10-01T10:00:00Z",
    ],
    [
      "a custom range that ends before it starts",
      "range=Custom&start=2026-10-01T11:00:00Z&end=2026-10-01T10:00:00Z",
    ],
    [
      "a custom range of no length",
      "range=Custom&start=2026-10-01T11:00:00Z&end=2026-10-01T11:00:00Z",
    ],
  ])("%s falls back to the past hour", (_label: string, query: string) => {
    expect(readNetworkTrafficView(reader(query)).range).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
    });
  });
});

describe("the filters in the address", () => {
  test("every filter is written and read back", () => {
    const filters: NetworkTrafficFilters = {
      sourceIp: "10.0.0.5",
      destinationIp: "10.0.0.9",
      hostIp: "192.0.2.1",
      protocolNumber: 6,
      port: 443,
      interfaceIndex: 12,
      networkDeviceId: DEVICE_ID,
      exporterIp: "198.51.100.7",
    };
    const view: NetworkTrafficViewState = {
      range: { range: TimeRange.PAST_ONE_HOUR },
      filters: filters,
    };

    expect(readNetworkTrafficView(reader(toQuery(view))).filters).toEqual(
      filters,
    );
  });

  test("short names keep the address readable", () => {
    expect(
      toQuery({
        range: { range: TimeRange.PAST_ONE_HOUR },
        filters: { sourceIp: "10.0.0.5", protocolNumber: 17, port: 53 },
      }),
    ).toBe("src=10.0.0.5&proto=17&port=53");
  });

  test("an IPv6 address is read in its canonical spelling", () => {
    expect(
      readNetworkTrafficView(reader("src=2001:DB8:0:0:0:0:0:1")).filters,
    ).toEqual({ sourceIp: "2001:db8::1" });
  });

  test.each([
    ["an address that is not one", "src=not-an-ip"],
    ["a script in an address", "dst=%3Cscript%3E"],
    ["a protocol past 255", "proto=256"],
    ["a negative port", "port=-1"],
    ["a port past 65535", "port=70000"],
    ["a fractional interface", "if=1.5"],
    ["a device that is not an id", "device=router-1"],
  ])("%s is left out", (_label: string, query: string) => {
    expect(readNetworkTrafficView(reader(query)).filters).toEqual({});
  });

  test("one bad value never costs the good ones", () => {
    expect(
      readNetworkTrafficView(reader("src=10.0.0.5&port=99999&dst=bad")).filters,
    ).toEqual({ sourceIp: "10.0.0.5" });
  });
});

describe("the chips over the page", () => {
  function chipsOf(
    filters: NetworkTrafficFilters,
    names: {
      deviceName?: string;
      interfaceName?: string;
      applicationName?: string;
    } = {},
  ): Array<NetworkTrafficFilterChip> {
    return getNetworkTrafficFilterChips(filters, names);
  }

  test("no filter, no chip", () => {
    expect(chipsOf({})).toEqual([]);
  });

  test("each filter says what it narrows to, in the order a reader narrows a page", () => {
    const chips: Array<NetworkTrafficFilterChip> = chipsOf(
      {
        protocolNumber: 6,
        port: 443,
        hostIp: "192.0.2.1",
        destinationIp: "10.0.0.9",
        sourceIp: "10.0.0.5",
        interfaceIndex: 3,
        exporterIp: "198.51.100.7",
        networkDeviceId: DEVICE_ID,
      },
      {
        deviceName: "core-router",
        interfaceName: "Gi0/3",
        applicationName: "HTTPS",
      },
    );

    expect(
      chips.map((chip: NetworkTrafficFilterChip): NetworkTrafficFilterKind => {
        return chip.kind;
      }),
    ).toEqual([
      "device",
      "exporter",
      "interface",
      "source",
      "destination",
      "host",
      "application",
    ]);
    expect(chips).toEqual([
      {
        kind: "device",
        template: FILTER_DEVICE_LABEL,
        values: { device: "core-router" },
      },
      {
        kind: "exporter",
        template: FILTER_EXPORTER_LABEL,
        values: { address: "198.51.100.7" },
      },
      {
        kind: "interface",
        template: FILTER_INTERFACE_LABEL,
        values: { interface: "Gi0/3" },
      },
      {
        kind: "source",
        template: FILTER_SOURCE_LABEL,
        values: { address: "10.0.0.5" },
      },
      {
        kind: "destination",
        template: FILTER_DESTINATION_LABEL,
        values: { address: "10.0.0.9" },
      },
      {
        kind: "host",
        template: FILTER_HOST_LABEL,
        values: { address: "192.0.2.1" },
      },
      {
        kind: "application",
        template: FILTER_APPLICATION_LABEL,
        values: { application: "HTTPS" },
      },
    ]);
  });

  test("an id the page has no name for is still said, as the id", () => {
    expect(
      chipsOf({ networkDeviceId: DEVICE_ID, interfaceIndex: 9, port: 8080 }),
    ).toEqual([
      {
        kind: "device",
        template: FILTER_DEVICE_LABEL,
        values: { device: DEVICE_ID },
      },
      {
        kind: "interface",
        template: FILTER_INTERFACE_LABEL,
        values: { interface: "#9" },
      },
      {
        kind: "application",
        template: FILTER_APPLICATION_LABEL,
        values: { application: "8080" },
      },
    ]);
  });

  test("the chip labels are whole sentences with their values as placeholders", () => {
    for (const template of [
      FILTER_SOURCE_LABEL,
      FILTER_DESTINATION_LABEL,
      FILTER_HOST_LABEL,
      FILTER_APPLICATION_LABEL,
      FILTER_INTERFACE_LABEL,
      FILTER_DEVICE_LABEL,
      FILTER_EXPORTER_LABEL,
    ]) {
      expect(template).toMatch(/\{\{[a-z]+\}\}/);
    }
  });
});

describe("removing and adding filters", () => {
  const ALL: NetworkTrafficFilters = {
    sourceIp: "10.0.0.5",
    destinationIp: "10.0.0.9",
    hostIp: "192.0.2.1",
    protocolNumber: 6,
    port: 443,
    interfaceIndex: 3,
    networkDeviceId: DEVICE_ID,
    exporterIp: "198.51.100.7",
  };

  test.each([
    ["source", ["sourceIp"]],
    ["destination", ["destinationIp"]],
    ["host", ["hostIp"]],
    ["application", ["protocolNumber", "port"]],
    ["interface", ["interfaceIndex"]],
    ["device", ["networkDeviceId"]],
    ["exporter", ["exporterIp"]],
  ] as Array<[NetworkTrafficFilterKind, Array<keyof NetworkTrafficFilters>]>)(
    "a chip's x for %s takes out exactly %j",
    (
      kind: NetworkTrafficFilterKind,
      removed: Array<keyof NetworkTrafficFilters>,
    ) => {
      const next: NetworkTrafficFilters = withoutNetworkTrafficFilter(
        ALL,
        kind,
      );

      expect(Object.keys(next).sort()).toEqual(
        Object.keys(ALL)
          .filter((key: string): boolean => {
            return !removed.includes(key as keyof NetworkTrafficFilters);
          })
          .sort(),
      );
      // The filters the page shows are never changed in place.
      expect(Object.keys(ALL)).toHaveLength(8);
    },
  );

  test("a click on an application row filters its protocol and its service port", () => {
    expect(withApplicationFilter({ sourceIp: "10.0.0.5" }, 6, 443)).toEqual({
      sourceIp: "10.0.0.5",
      protocolNumber: 6,
      port: 443,
    });
  });

  test("a protocol without ports filters the protocol alone, dropping an older port", () => {
    expect(
      withApplicationFilter({ protocolNumber: 6, port: 443 }, 1, 0),
    ).toEqual({ protocolNumber: 1 });
    expect(withApplicationFilter({}, 47, 0)).toEqual({ protocolNumber: 47 });
  });

  test("a port-carrying protocol with no service port left filters the protocol", () => {
    expect(withApplicationFilter({}, 17, 0)).toEqual({ protocolNumber: 17 });
  });
});
