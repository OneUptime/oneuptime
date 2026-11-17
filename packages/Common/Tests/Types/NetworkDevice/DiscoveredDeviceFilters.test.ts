import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DISCOVERED_DEVICE_FILTER_OPERATORS,
  DiscoveredDeviceFilterField,
  DiscoveredDeviceFilterOperator,
  MAX_DISCOVERED_DEVICE_FILTERS,
  readDiscoveredDeviceFilters,
  readDiscoveredDeviceListRequest,
} from "../../../Types/NetworkDevice/DiscoveredDevice";
import { describe, expect, test } from "@jest/globals";

/*
 * The Discovered Devices list's filters (OneUptime issue #9304): what a list
 * request may carry besides its search. A filter is a field, an operator the
 * field may be compared by - the filter chips' own words - and the values
 * that operator needs. A chip still being typed asks for nothing; anything
 * else that is wrong is refused in a sentence.
 */

const SITE_A: string = "20000000-0000-4000-8000-00000000000A";
const SITE_B: string = "20000000-0000-4000-8000-00000000000b";

describe("reading the filters", () => {
  test("none, or nothing, is no filter", () => {
    expect(readDiscoveredDeviceFilters(undefined)).toEqual([]);
    expect(readDiscoveredDeviceFilters(null)).toEqual([]);
    expect(readDiscoveredDeviceFilters([])).toEqual([]);
    expect(readDiscoveredDeviceListRequest({}).filters).toBeUndefined();
  });

  test("a text field compares against the one value typed, trimmed", () => {
    expect(
      readDiscoveredDeviceFilters([
        { field: "vendor", operator: "contains", values: [" Axis ", "more"] },
        { field: "macAddress", operator: "starts_with", values: ["00:1a"] },
      ]),
    ).toEqual([
      { field: "vendor", operator: "contains", values: ["Axis"] },
      { field: "macAddress", operator: "starts_with", values: ["00:1a"] },
    ]);
  });

  test("is empty and is not empty need no value", () => {
    expect(
      readDiscoveredDeviceFilters([
        { field: "hostname", operator: "is_empty", values: ["ignored"] },
        { field: "site", operator: "is_not_empty" },
      ]),
    ).toEqual([
      { field: "hostname", operator: "is_empty", values: [] },
      { field: "site", operator: "is_not_empty", values: [] },
    ]);
  });

  test("a chip still being typed asks for nothing", () => {
    expect(
      readDiscoveredDeviceFilters([
        { field: "name", operator: "contains", values: ["   "] },
        { field: "lastSeen", operator: "between", values: ["2026-11-01"] },
      ]),
    ).toEqual([]);
  });

  test("sites are ids, each once, in one case", () => {
    expect(
      readDiscoveredDeviceFilters([
        { field: "site", operator: "is", values: [SITE_A, SITE_A, SITE_B] },
      ]),
    ).toEqual([
      {
        field: "site",
        operator: "is",
        values: [SITE_A.toLowerCase(), SITE_B],
      },
    ]);
    expect(() => {
      readDiscoveredDeviceFilters([
        { field: "site", operator: "is", values: ["not-a-site"] },
      ]);
    }).toThrow(new BadDataException("This site was not found."));
  });

  test("Seen By is a switch or router, or a network controller", () => {
    expect(
      readDiscoveredDeviceFilters([
        { field: "source", operator: "is", values: ["controller"] },
      ]),
    ).toEqual([{ field: "source", operator: "is", values: ["controller"] }]);
    expect(() => {
      readDiscoveredDeviceFilters([
        { field: "source", operator: "is", values: ["printer"] },
      ]);
    }).toThrow(BadDataException);
  });

  test("Last Seen takes instants, written the one way", () => {
    expect(
      readDiscoveredDeviceFilters([
        {
          field: "lastSeen",
          operator: "between",
          values: ["2026-11-01T00:00:00Z", "2026-11-02T23:59:59.999Z"],
        },
        { field: "lastSeen", operator: "before", values: ["2026-11-01"] },
      ]),
    ).toEqual([
      {
        field: "lastSeen",
        operator: "between",
        values: ["2026-11-01T00:00:00.000Z", "2026-11-02T23:59:59.999Z"],
      },
      {
        field: "lastSeen",
        operator: "before",
        values: ["2026-11-01T00:00:00.000Z"],
      },
    ]);
    expect(() => {
      readDiscoveredDeviceFilters([
        { field: "lastSeen", operator: "after", values: ["yesterday-ish"] },
      ]);
    }).toThrow(new BadDataException("Pick a date to filter by."));
  });

  test("a field it does not know, or an operator the field is not compared by, is refused", () => {
    const refusal: BadDataException = new BadDataException(
      "One of the filters cannot be used. Clear it and pick it again.",
    );

    for (const filter of [
      { field: "owner", operator: "is", values: ["x"] },
      { field: "vendor", operator: "before", values: ["x"] },
      { field: "site", operator: "contains", values: [SITE_A] },
      { field: "lastSeen", operator: "contains", values: ["x"] },
      { field: "source", operator: "is_not", values: ["walk"] },
      { field: "vendor", operator: "contains", values: [42] },
      { field: "vendor", operator: "contains", values: "Axis" },
      "vendor",
    ]) {
      expect(() => {
        readDiscoveredDeviceFilters([filter]);
      }).toThrow(refusal);
    }

    expect(() => {
      readDiscoveredDeviceFilters({ field: "vendor" });
    }).toThrow(refusal);
  });

  test("too many filters, or too long a value, is refused", () => {
    expect(() => {
      readDiscoveredDeviceFilters(
        new Array(MAX_DISCOVERED_DEVICE_FILTERS + 1).fill({
          field: "vendor",
          operator: "contains",
          values: ["a"],
        }),
      );
    }).toThrow(BadDataException);
    expect(() => {
      readDiscoveredDeviceFilters([
        { field: "vendor", operator: "contains", values: ["a".repeat(101)] },
      ]);
    }).toThrow(new BadDataException("Filter for at most 100 characters."));
  });

  test("a list request carries them beside its search", () => {
    expect(
      readDiscoveredDeviceListRequest({
        search: "camera",
        filters: [
          { field: "ipAddress", operator: "starts_with", values: ["10.34."] },
        ],
      }),
    ).toMatchObject({
      search: "camera",
      filters: [
        { field: "ipAddress", operator: "starts_with", values: ["10.34."] },
      ],
    });
  });

  test("every text field is compared by the text chip's eight operators", () => {
    for (const field of [
      DiscoveredDeviceFilterField.Name,
      DiscoveredDeviceFilterField.IpAddress,
      DiscoveredDeviceFilterField.MacAddress,
      DiscoveredDeviceFilterField.Vendor,
      DiscoveredDeviceFilterField.Hostname,
    ]) {
      expect([...DISCOVERED_DEVICE_FILTER_OPERATORS[field]].sort()).toEqual(
        [
          DiscoveredDeviceFilterOperator.Is,
          DiscoveredDeviceFilterOperator.IsNot,
          DiscoveredDeviceFilterOperator.Contains,
          DiscoveredDeviceFilterOperator.NotContains,
          DiscoveredDeviceFilterOperator.StartsWith,
          DiscoveredDeviceFilterOperator.EndsWith,
          DiscoveredDeviceFilterOperator.IsEmpty,
          DiscoveredDeviceFilterOperator.IsNotEmpty,
        ].sort(),
      );
    }
  });
});
