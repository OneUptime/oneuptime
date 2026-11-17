import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DISCOVERED_DEVICE_FILTER_OPERATORS,
  DiscoveredDeviceFilterField,
  readDiscoveredDeviceFilters,
} from "Common/Types/NetworkDevice/DiscoveredDevice";
import OneUptimeDate from "Common/Types/Date";
/*
 * The browser-bound modules the API module imports are mocked: Common/UI/
 * Config reads `window` at import time.
 */
jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return { __esModule: true, default: { getCommonHeaders: jest.fn() } };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return { __esModule: true, default: { get: jest.fn(), post: jest.fn() } };
});

import {
  DISCOVERED_DEVICE_CHIPS,
  DiscoveredDeviceChip,
  DiscoveredDeviceChipState,
  EMPTY_DISCOVERED_DEVICE_CHIP_STATE,
  countActiveDiscoveredDeviceChips,
  getDiscoveredDeviceChips,
  setDiscoveredDeviceChip,
  toDiscoveredDeviceFilters,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceFilters";
import { toListRequestBody } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceApi";
import {
  DiscoveredDeviceEmptyKind,
  getDiscoveredDeviceEmptyKind,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceItems";

/*
 * OneUptime issue #9304: Network > Discovered Devices had a search box and
 * nothing else, while the Devices list beside it narrows by chips. These pin
 * the chips the list draws, what each asks the server for - in exactly the
 * words the server reads - and that they are the chips every network list
 * draws (FacetFilterBar and its chips), with the search kept beside them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readCode(...parts: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const FOLDER: Array<string> = [
  "Components",
  "NetworkDevice",
  "DiscoveredDevices",
];

const SITE: string = "20000000-0000-4000-8000-000000000001";

function stateWith(
  field: DiscoveredDeviceFilterField,
  values: Array<string>,
  operator: DiscoveredDeviceChipState["operators"][DiscoveredDeviceFilterField] = "is",
): DiscoveredDeviceChipState {
  return setDiscoveredDeviceChip(
    EMPTY_DISCOVERED_DEVICE_CHIP_STATE,
    field,
    values,
    operator || "is",
  );
}

describe("the chips", () => {
  test("name, IP address, MAC address, vendor, hostname, site, what saw it and when", () => {
    expect(
      DISCOVERED_DEVICE_CHIPS.map((chip: DiscoveredDeviceChip) => {
        return [chip.field, chip.label, chip.type];
      }),
    ).toEqual([
      ["name", "Name", "text"],
      ["ipAddress", "IP Address", "text"],
      ["macAddress", "MAC Address", "text"],
      ["vendor", "Vendor", "text"],
      ["hostname", "Hostname", "text"],
      ["site", "Site", "options"],
      ["source", "Seen By", "options"],
      ["lastSeen", "Last Seen", "dateRange"],
    ]);
  });

  test("a site's own list is one site's already, so it has no Site chip", () => {
    expect(
      getDiscoveredDeviceChips({ isSiteList: true }).map(
        (chip: DiscoveredDeviceChip) => {
          return chip.field;
        },
      ),
    ).not.toContain(DiscoveredDeviceFilterField.Site);
    expect(getDiscoveredDeviceChips({ isSiteList: false })).toHaveLength(
      DISCOVERED_DEVICE_CHIPS.length,
    );
  });

  test("each chip offers only what the server compares that field by", () => {
    for (const chip of DISCOVERED_DEVICE_CHIPS) {
      const server: ReadonlyArray<string> =
        DISCOVERED_DEVICE_FILTER_OPERATORS[chip.field];

      for (const operator of chip.supportedOperators) {
        // Last Seen's "on a day" is sent as a day's range.
        if (
          chip.field === DiscoveredDeviceFilterField.LastSeen &&
          operator === "is"
        ) {
          continue;
        }

        expect(server).toContain(operator);
      }
    }
  });
});

describe("what the chips ask the server for", () => {
  test("nothing, until a chip holds a value", () => {
    expect(
      toDiscoveredDeviceFilters(
        DISCOVERED_DEVICE_CHIPS,
        EMPTY_DISCOVERED_DEVICE_CHIP_STATE,
      ),
    ).toEqual([]);
    expect(
      countActiveDiscoveredDeviceChips(
        DISCOVERED_DEVICE_CHIPS,
        EMPTY_DISCOVERED_DEVICE_CHIP_STATE,
      ),
    ).toBe(0);

    // An operator picked before a value is typed keeps, and asks for nothing.
    const picked: DiscoveredDeviceChipState = stateWith(
      DiscoveredDeviceFilterField.Vendor,
      [],
      "contains",
    );

    expect(picked.operators.vendor).toBe("contains");
    expect(toDiscoveredDeviceFilters(DISCOVERED_DEVICE_CHIPS, picked)).toEqual(
      [],
    );
  });

  test("several chips at once, every one of them in the request, each as the server reads it", () => {
    let state: DiscoveredDeviceChipState = stateWith(
      DiscoveredDeviceFilterField.Vendor,
      ["Sunnovo"],
      "contains",
    );
    state = setDiscoveredDeviceChip(
      state,
      DiscoveredDeviceFilterField.IpAddress,
      ["10.34."],
      "starts_with",
    );
    state = setDiscoveredDeviceChip(
      state,
      DiscoveredDeviceFilterField.Site,
      [SITE],
      "is",
    );
    state = setDiscoveredDeviceChip(
      state,
      DiscoveredDeviceFilterField.Hostname,
      [],
      "is_empty",
    );
    state = setDiscoveredDeviceChip(
      state,
      DiscoveredDeviceFilterField.Source,
      ["controller"],
      "is",
    );

    const filters: Array<unknown> = toDiscoveredDeviceFilters(
      DISCOVERED_DEVICE_CHIPS,
      state,
    );

    expect(filters).toEqual([
      { field: "ipAddress", operator: "starts_with", values: ["10.34."] },
      { field: "vendor", operator: "contains", values: ["Sunnovo"] },
      { field: "hostname", operator: "is_empty", values: [] },
      { field: "site", operator: "is", values: [SITE] },
      { field: "source", operator: "is", values: ["controller"] },
    ]);
    expect(
      countActiveDiscoveredDeviceChips(DISCOVERED_DEVICE_CHIPS, state),
    ).toBe(5);

    // The server reads every one of them back as it was sent.
    expect(readDiscoveredDeviceFilters(filters)).toEqual(filters);
  });

  test("Last Seen: on a day is that whole day, between is from the first day's start to the last's end", () => {
    const day: DiscoveredDeviceChipState = stateWith(
      DiscoveredDeviceFilterField.LastSeen,
      ["2026-11-10"],
      "is",
    );
    const start: Date = OneUptimeDate.fromString("2026-11-10");

    expect(toDiscoveredDeviceFilters(DISCOVERED_DEVICE_CHIPS, day)).toEqual([
      {
        field: "lastSeen",
        operator: "between",
        values: [
          OneUptimeDate.getStartOfDay(start).toISOString(),
          OneUptimeDate.getEndOfDay(start).toISOString(),
        ],
      },
    ]);

    const range: DiscoveredDeviceChipState = stateWith(
      DiscoveredDeviceFilterField.LastSeen,
      ["2026-11-01/2026-11-10"],
      "between",
    );

    expect(
      toDiscoveredDeviceFilters(DISCOVERED_DEVICE_CHIPS, range)[0]?.values,
    ).toEqual([
      OneUptimeDate.getStartOfDay(
        OneUptimeDate.fromString("2026-11-01"),
      ).toISOString(),
      OneUptimeDate.getEndOfDay(start).toISOString(),
    ]);

    const before: DiscoveredDeviceChipState = stateWith(
      DiscoveredDeviceFilterField.LastSeen,
      ["2026-11-01"],
      "before",
    );

    expect(toDiscoveredDeviceFilters(DISCOVERED_DEVICE_CHIPS, before)).toEqual([
      {
        field: "lastSeen",
        operator: "before",
        values: [OneUptimeDate.fromString("2026-11-01").toISOString()],
      },
    ]);
  });

  test("a range still being typed asks for nothing, and is not counted", () => {
    const half: DiscoveredDeviceChipState = stateWith(
      DiscoveredDeviceFilterField.LastSeen,
      ["2026-11-01/"],
      "between",
    );

    expect(toDiscoveredDeviceFilters(DISCOVERED_DEVICE_CHIPS, half)).toEqual(
      [],
    );
    expect(
      countActiveDiscoveredDeviceChips(DISCOVERED_DEVICE_CHIPS, half),
    ).toBe(0);
  });

  test("a chip cleared goes back to nothing", () => {
    const set: DiscoveredDeviceChipState = stateWith(
      DiscoveredDeviceFilterField.Vendor,
      ["Axis"],
      "is",
    );

    expect(
      setDiscoveredDeviceChip(
        set,
        DiscoveredDeviceFilterField.Vendor,
        [],
        "is",
      ),
    ).toEqual(EMPTY_DISCOVERED_DEVICE_CHIP_STATE);
  });

  test("the request carries the filters only when one narrows the list", () => {
    const base: Parameters<typeof toListRequestBody>[0] = {
      search: "camera",
      show: "all" as never,
      sort: "lastSeen" as never,
      sortOrder: "desc",
    };

    expect(toListRequestBody(base)).not.toHaveProperty("filters");
    expect(toListRequestBody({ ...base, filters: [] })).not.toHaveProperty(
      "filters",
    );
    expect(
      toListRequestBody({
        ...base,
        filters: [
          {
            field: DiscoveredDeviceFilterField.Vendor,
            operator: "contains" as never,
            values: ["Axis"],
          },
        ],
      })["filters"],
    ).toEqual([{ field: "vendor", operator: "contains", values: ["Axis"] }]);
  });

  test("a list the chips empty says nothing matches, as a search does", () => {
    expect(
      getDiscoveredDeviceEmptyKind({
        search: "",
        isFiltered: true,
        show: "all" as never,
        counts: { all: 0, notMonitored: 0, monitored: 0, hidden: 0 },
      }),
    ).toBe(DiscoveredDeviceEmptyKind.NoMatch);
  });
});

describe("wired the way every network list is", () => {
  const TABLE: string = readCode(...FOLDER, "DiscoveredDevicesTable.tsx");
  const BAR: string = readCode(...FOLDER, "DiscoveredDeviceFilterBar.tsx");

  test("the chips sit in the bar every list's chips sit in, drawn by the chips the Devices list uses", () => {
    expect(BAR).toContain(
      'import FacetFilterBar from "../../ResourceOwners/FacetFilterBar";',
    );
    expect(BAR).toContain("<FilterChipValueInput");
    expect(BAR).toContain("<FilterChipDropdown");
    expect(BAR).toContain("<FilterChipDateRange");
    expect(TABLE).toContain(
      "<DiscoveredDeviceFilterBar chips={chips} state={chipState} onChange={setChipState} />",
    );
  });

  test("the search stays, and the page, the select-all and the counts all carry the filters", () => {
    expect(TABLE).toContain('data-testid="discovered-devices-search"');
    expect(TABLE).toMatch(
      /listDiscoveredDevices\(\{ search: debouncedSearch, filters: filters,/,
    );
    expect(TABLE).toMatch(
      /selectAllDiscoveredDevices\(\{ search: debouncedSearch, filters: filters,/,
    );
  });

  test("the other device lists filter by the same name, hostname and vendor", () => {
    for (const page of [
      ["Pages", "NetworkDevice", "Devices.tsx"],
      ["Pages", "NetworkDevice", "Archived.tsx"],
      ["Pages", "NetworkSite", "View", "Devices.tsx"],
    ]) {
      const code: string = readCode(...page);

      for (const title of [
        'title: "Name"',
        'title: "Hostname"',
        'title: "Vendor"',
      ]) {
        expect(code.slice(code.indexOf("filters={["))).toContain(title);
      }
    }
  });
});
