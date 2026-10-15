import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { appendAttributeFilters } from "Common/Server/Utils/AnalyticsDatabase/AttributeFilterStatement";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import NotWildcard from "Common/Types/BaseDatabase/NotWildcard";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import OneUptimeDate from "Common/Types/Date";
import escapeRegExp from "Common/Utils/RegExpEscape";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * idx_attribute_values (#4706) against a real ClickHouse server.
 *
 * A log search filtered on an attribute value used to read the whole
 * `attributes` map of every row in the window. LogItemV3 and SpanItemV3 now
 * carry a bloom filter over the attribute values, the list query's own
 * `attributes['k'] = 'v'` / `IN (...)` uses it as it is, and every chart
 * checks an exact value with `has(mapValues(attributes), v)` in front of its
 * case-insensitive lambda. The unit suites pin the SQL; this one shows what
 * ClickHouse does with it, on the table the Log model creates:
 *
 *   1. Nothing a search returns changes. For every attribute operator, on
 *      both read paths - the list (StatementGenerator, exact keys) and the
 *      charts (AttributeFilterStatement, keys matched case-insensitively) -
 *      the rows match an independent evaluation of the filter over the
 *      fixture, with the index used and with skip indexes switched off; on
 *      the charts also the statement as it was before this change (the same
 *      SQL without the value check), run without the index.
 *   2. A rare value is read from the granules that hold it, and only those
 *      (plus the bloom filter's rare false positive): EXPLAIN names
 *      idx_attribute_values, and the marks ClickHouse selects fall with it.
 *      Removing the index from the model, or the value check from the
 *      charts, fails this.
 *   3. The index claims nothing it cannot do: a value in every granule
 *      selects every granule, and the service reads return what the
 *      fixture says.
 *
 * The table is the model's own (columns, skip indexes, sort key) with one
 * difference: 256-row granules with adaptive granularity off
 * (index_granularity = 256, index_granularity_bytes = 0), so a fixture of a
 * few thousand rows spans a hundred granules and the granule each row lands
 * in is known. The production table keeps ClickHouse's defaults; the index
 * works per granule either way.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/AttributeValueIndexClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import LogService from "Common/Server/Services/LogService";
import LogAggregationService, {
  FacetValue,
  HistogramBucket,
} from "Common/Server/Services/LogAggregationService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `attribute_value_index_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

/*
 * The hour the fixture's rows sit in: from the last whole minute less 90
 * minutes or, when that hour would cross a midnight (UTC), the hour before
 * that midnight. The Log table is partitioned by toYYYYMMDD(time), and
 * rows of two days make two parts where the layout needs one (a run
 * between 00:40 and 01:30 UTC saw 2).
 */
const RECENT_START: number =
  Math.floor(Date.now() / MINUTE) * MINUTE - 90 * MINUTE;
const NEXT_MIDNIGHT: number = (Math.floor(RECENT_START / DAY) + 1) * DAY;
const WINDOW_START: Date = new Date(
  RECENT_START + 60 * MINUTE > NEXT_MIDNIGHT
    ? NEXT_MIDNIGHT - 60 * MINUTE
    : RECENT_START,
);
const WINDOW_END: Date = new Date(WINDOW_START.getTime() + 60 * MINUTE);

// Sorts before OTHER_PROJECT_ID, so its rows fill the part from granule 0.
const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000004706",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000004706",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000004706",
);

const GRANULE_ROWS: number = 256;
const GRANULES: number = 100;
const ROWS: number = GRANULE_ROWS * GRANULES;
const OTHER_PROJECT_ROWS: number = 300;

const RARE: string = "/orders/export";
// A burst of the rare value: 20 rows in a row, all in granule 50.
const BURST_START: number = 50 * GRANULE_ROWS;
const BURST_ROWS: number = 20;

const ROUTES: Array<string> = [
  "/cart",
  "/checkout",
  "/users/:id",
  "/products",
  "/search",
  "/login",
  "/100%_off",
];

const QUOTED_NOTE: string = `it's "quoted" \\ escaped`;

interface Fixture {
  index: number;
  project: ObjectID;
  body: string;
  attributes: Record<string, string>;
}

/*
 * Every kind of row a filter has to get right: a key in another casing, a
 * key that is missing, a key that is present and empty, numbers stored as
 * text, LIKE metacharacters, quotes and backslashes, a value that differs
 * only in case, a key on half the rows - and the rare value, in a burst and
 * spread out, the same value in another project.
 */
function fixtureAttributes(index: number): Record<string, string> {
  const attributes: Record<string, string> = {
    "http.method": index % 10 < 7 ? "GET" : "POST",
    "duration.ms": String(index % 1000),
    "user.id": `user-${index % 3000}`,
    note: index % 9 === 0 ? QUOTED_NOTE : "plain",
    tenant: index % 600 === 0 ? "Tenant-A" : "tenant-a",
  };

  if (index % 2 === 0) {
    attributes["flag"] = "true";
  }

  const routeKey: string = index % 1500 === 7 ? "HTTP.Route" : "http.route";

  if (index >= BURST_START && index < BURST_START + BURST_ROWS) {
    attributes[routeKey] = RARE;
  } else if (index % 5000 === 1234 || index % 3000 === 7) {
    attributes[routeKey] = RARE;
  } else if (index % 50 === 3) {
    // No route at all.
  } else if (index % 50 === 4) {
    attributes[routeKey] = "";
  } else {
    attributes[routeKey] = ROUTES[index % ROUTES.length]!;
  }

  return attributes;
}

const FIXTURES: Array<Fixture> = [
  ...Array.from({ length: ROWS }, (_value: unknown, index: number): Fixture => {
    return {
      index: index,
      project: PROJECT_ID,
      body: `row-${index}`,
      attributes: fixtureAttributes(index),
    };
  }),
  ...Array.from(
    { length: OTHER_PROJECT_ROWS },
    (_value: unknown, index: number): Fixture => {
      return {
        index: index,
        project: OTHER_PROJECT_ID,
        body: `other-${index}`,
        attributes: { "http.route": RARE, "http.method": "GET" },
      };
    },
  ),
];

const OWN_ROWS: Array<Fixture> = FIXTURES.filter(
  (fixture: Fixture): boolean => {
    return fixture.project === PROJECT_ID;
  },
);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

function logRow(fixture: Fixture): JSONObject {
  // 50 minutes of rows, in fixture order, a distinct time each.
  const time: Date = new Date(
    WINDOW_START.getTime() +
      MINUTE +
      Math.floor((fixture.index * 50 * MINUTE) / ROWS),
  );

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: fixture.project.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + fixture.index),
    severityText: LogSeverity.Information,
    severityNumber: 9,
    attributes: fixture.attributes,
    attributeKeys: Object.keys(fixture.attributes).sort(),
    entityKeys: [],
    traceId: "",
    spanId: "",
    body: fixture.body,
    retentionDate: retentionDate,
  };
}

// --- An independent reading of each filter, over the fixture ---

type Oracle = (attributes: Record<string, string>) => boolean;

const DECIMAL: RegExp = /^-?\d+(\.\d+)?$/;

// The values under every key that matches `key` case-insensitively.
function valuesUnder(
  attributes: Record<string, string>,
  key: string,
): Array<string> {
  return Object.entries(attributes)
    .filter(([name]: [string, string]): boolean => {
      return name.toLowerCase() === key.toLowerCase();
    })
    .map(([, value]: [string, string]): string => {
      return value;
    });
}

// What a Map subscript reads: the exact key, '' when it is missing.
function subscript(attributes: Record<string, string>, key: string): string {
  return attributes[key] ?? "";
}

// A glob as ILIKE reads it: `*` any run, `?` one character, case ignored.
function globMatches(glob: string, value: string): boolean {
  const pattern: string = escapeRegExp(glob)
    .split("\\*")
    .join(".*")
    .split("\\?")
    .join(".");

  return new RegExp(`^${pattern}$`, "is").test(value);
}

function numberOf(value: string): number | null {
  return DECIMAL.test(value) ? Number(value) : null;
}

const anyValue: (key: string, test: (value: string) => boolean) => Oracle = (
  key: string,
  test: (value: string) => boolean,
): Oracle => {
  return (attributes: Record<string, string>): boolean => {
    return valuesUnder(attributes, key).some(test);
  };
};

const not: (oracle: Oracle) => Oracle = (oracle: Oracle): Oracle => {
  return (attributes: Record<string, string>): boolean => {
    return !oracle(attributes);
  };
};

const lowerIncludes: (needle: string) => (value: string) => boolean = (
  needle: string,
) => {
  return (value: string): boolean => {
    return value.toLowerCase().includes(needle.toLowerCase());
  };
};

// --- The chart path: AttributeFilterStatement, keys case-insensitive ---

interface ChartCase {
  label: string;
  attributes: Record<string, unknown>;
  oracle: Oracle;
  // Whether this filter needs a value present, so the value index applies.
  prefiltered: boolean;
}

const CHART_CASES: Array<ChartCase> = [
  {
    label: "equals a rare value",
    attributes: { "http.route": RARE },
    oracle: anyValue("http.route", (v: string) => {
      return v === RARE;
    }),
    prefiltered: true,
  },
  {
    label: "equals a common value",
    attributes: { "http.method": "GET" },
    oracle: anyValue("http.method", (v: string) => {
      return v === "GET";
    }),
    prefiltered: true,
  },
  {
    label: "equals a value no row has",
    attributes: { "http.route": "/does-not-exist" },
    oracle: (): boolean => {
      return false;
    },
    prefiltered: true,
  },
  {
    label: "equals, the key typed in another casing",
    attributes: { "HTTP.ROUTE": RARE },
    oracle: anyValue("http.route", (v: string) => {
      return v === RARE;
    }),
    prefiltered: true,
  },
  {
    label: "equals is case-sensitive on the value",
    attributes: { tenant: "Tenant-A" },
    oracle: anyValue("tenant", (v: string) => {
      return v === "Tenant-A";
    }),
    prefiltered: true,
  },
  {
    label: "equals a value holding LIKE metacharacters",
    attributes: { "http.route": "/100%_off" },
    oracle: anyValue("http.route", (v: string) => {
      return v === "/100%_off";
    }),
    prefiltered: true,
  },
  {
    label: "equals a value holding quotes and a backslash",
    attributes: { note: QUOTED_NOTE },
    oracle: anyValue("note", (v: string) => {
      return v === QUOTED_NOTE;
    }),
    prefiltered: true,
  },
  {
    label: "equals a number sent as a JSON number",
    attributes: { "duration.ms": 500 },
    oracle: anyValue("duration.ms", (v: string) => {
      return v === "500";
    }),
    prefiltered: true,
  },
  {
    label: "an explicit EqualTo",
    attributes: { "http.route": { _type: "EqualTo", value: RARE } },
    oracle: anyValue("http.route", (v: string) => {
      return v === RARE;
    }),
    prefiltered: true,
  },
  {
    label: "is any of (a list)",
    attributes: { "http.route": [RARE, "/cart"] },
    oracle: anyValue("http.route", (v: string) => {
      return v === RARE || v === "/cart";
    }),
    prefiltered: true,
  },
  {
    label: "is any of (an Includes operator)",
    attributes: { "http.route": { _type: "Includes", value: [RARE] } },
    oracle: anyValue("http.route", (v: string) => {
      return v === RARE;
    }),
    prefiltered: true,
  },
  {
    label: "is any of numbers sent as JSON numbers",
    attributes: { "duration.ms": [5, 6] },
    oracle: anyValue("duration.ms", (v: string) => {
      return v === "5" || v === "6";
    }),
    prefiltered: true,
  },
  {
    label: "is any of, with a blank in the list (present and empty)",
    attributes: { "http.route": ["", "/cart"] },
    oracle: anyValue("http.route", (v: string) => {
      return v === "" || v === "/cart";
    }),
    prefiltered: true,
  },
  {
    label: "a blank value: missing or empty",
    attributes: { "http.route": "" },
    oracle: not(
      anyValue("http.route", (v: string) => {
        return v !== "";
      }),
    ),
    prefiltered: false,
  },
  {
    label: "does not equal",
    attributes: { "http.route": { _type: "NotEqual", value: RARE } },
    oracle: not(
      anyValue("http.route", (v: string) => {
        return v === RARE;
      }),
    ),
    prefiltered: false,
  },
  {
    label: "does not equal blank: present and not empty",
    attributes: { "http.route": { _type: "NotEqual", value: "" } },
    oracle: anyValue("http.route", (v: string) => {
      return v !== "";
    }),
    prefiltered: false,
  },
  {
    label: "is none of",
    attributes: {
      "http.route": { _type: "IncludesNone", value: [RARE, "/cart"] },
    },
    oracle: not(
      anyValue("http.route", (v: string) => {
        return v === RARE || v === "/cart";
      }),
    ),
    prefiltered: false,
  },
  {
    label: "contains, case-insensitively",
    attributes: { "http.route": { _type: "Search", value: "ORDERS" } },
    oracle: anyValue("http.route", lowerIncludes("ORDERS")),
    prefiltered: false,
  },
  {
    label: "contains a literal %",
    attributes: { "http.route": { _type: "Search", value: "100%" } },
    oracle: anyValue("http.route", lowerIncludes("100%")),
    prefiltered: false,
  },
  {
    label: "does not contain",
    attributes: { "http.route": { _type: "NotContains", value: "orders" } },
    oracle: not(anyValue("http.route", lowerIncludes("orders"))),
    prefiltered: false,
  },
  {
    label: "starts with",
    attributes: { "http.route": { _type: "StartsWith", value: "/ORDERS" } },
    oracle: anyValue("http.route", (v: string) => {
      return v.toLowerCase().startsWith("/orders");
    }),
    prefiltered: false,
  },
  {
    label: "ends with a literal _",
    attributes: { "http.route": { _type: "EndsWith", value: "_off" } },
    oracle: anyValue("http.route", (v: string) => {
      return v.toLowerCase().endsWith("_off");
    }),
    prefiltered: false,
  },
  {
    label: "matches globs",
    attributes: {
      "http.route": { _type: "Wildcard", value: ["/orders/*", "/c?rt"] },
    },
    oracle: anyValue("http.route", (v: string) => {
      return globMatches("/orders/*", v) || globMatches("/c?rt", v);
    }),
    prefiltered: false,
  },
  {
    label: "does not match a glob",
    attributes: {
      "http.route": { _type: "NotWildcard", value: ["/orders/*"] },
    },
    oracle: not(
      anyValue("http.route", (v: string) => {
        return globMatches("/orders/*", v);
      }),
    ),
    prefiltered: false,
  },
  {
    label: "greater than",
    attributes: { "duration.ms": { _type: "GreaterThan", value: 990 } },
    oracle: anyValue("duration.ms", (v: string) => {
      return (numberOf(v) ?? -Infinity) > 990;
    }),
    prefiltered: false,
  },
  {
    label: "greater than or equal",
    attributes: { "duration.ms": { _type: "GreaterThanOrEqual", value: 990 } },
    oracle: anyValue("duration.ms", (v: string) => {
      return (numberOf(v) ?? -Infinity) >= 990;
    }),
    prefiltered: false,
  },
  {
    label: "less than",
    attributes: { "duration.ms": { _type: "LessThan", value: 5 } },
    oracle: anyValue("duration.ms", (v: string) => {
      return (numberOf(v) ?? Infinity) < 5;
    }),
    prefiltered: false,
  },
  {
    label: "less than or equal",
    attributes: { "duration.ms": { _type: "LessThanOrEqual", value: 5 } },
    oracle: anyValue("duration.ms", (v: string) => {
      return (numberOf(v) ?? Infinity) <= 5;
    }),
    prefiltered: false,
  },
  {
    label: "exists",
    attributes: { flag: { _type: "NotNull" } },
    oracle: anyValue("flag", (v: string) => {
      return v !== "";
    }),
    prefiltered: false,
  },
  {
    label: "does not exist",
    attributes: { flag: { _type: "IsNull" } },
    oracle: not(
      anyValue("flag", (v: string) => {
        return v !== "";
      }),
    ),
    prefiltered: false,
  },
  {
    label: "two keys at once",
    attributes: { "http.route": RARE, "http.method": "GET" },
    oracle: (attributes: Record<string, string>): boolean => {
      return (
        valuesUnder(attributes, "http.route").includes(RARE) &&
        valuesUnder(attributes, "http.method").includes("GET")
      );
    },
    prefiltered: true,
  },
];

// --- The list path: StatementGenerator, exact keys ---

interface ListCase {
  label: string;
  attributes: Record<string, unknown>;
  oracle: Oracle;
}

const LIST_CASES: Array<ListCase> = [
  {
    label: "equals a rare value (a bare value)",
    attributes: { "http.route": RARE },
    oracle: (a: Record<string, string>): boolean => {
      return subscript(a, "http.route") === RARE;
    },
  },
  {
    label: "equals, as an EqualTo",
    attributes: { "http.route": new EqualTo(RARE) },
    oracle: (a: Record<string, string>): boolean => {
      return subscript(a, "http.route") === RARE;
    },
  },
  {
    label:
      "equals under the other casing of the key (the list reads keys exactly)",
    attributes: { "HTTP.Route": RARE },
    oracle: (a: Record<string, string>): boolean => {
      return subscript(a, "HTTP.Route") === RARE;
    },
  },
  {
    label: "equals a common value",
    attributes: { "http.method": "GET" },
    oracle: (a: Record<string, string>): boolean => {
      return subscript(a, "http.method") === "GET";
    },
  },
  {
    label: "equals a value no row has",
    attributes: { "http.route": "/does-not-exist" },
    oracle: (): boolean => {
      return false;
    },
  },
  {
    label: "equals blank: missing or empty",
    attributes: { "http.route": "" },
    oracle: (a: Record<string, string>): boolean => {
      return subscript(a, "http.route") === "";
    },
  },
  {
    label: "is any of",
    attributes: { "http.route": new Includes([RARE, "/cart"]) },
    oracle: (a: Record<string, string>): boolean => {
      return [RARE, "/cart"].includes(subscript(a, "http.route"));
    },
  },
  {
    label: "is any of, with a blank (missing or empty counts)",
    attributes: { "http.route": new Includes(["", "/cart"]) },
    oracle: (a: Record<string, string>): boolean => {
      return ["", "/cart"].includes(subscript(a, "http.route"));
    },
  },
  {
    label: "is none of",
    attributes: { "http.route": new IncludesNone([RARE, "/cart"]) },
    oracle: (a: Record<string, string>): boolean => {
      return ![RARE, "/cart"].includes(subscript(a, "http.route"));
    },
  },
  {
    label: "does not equal",
    attributes: { "http.route": new NotEqual(RARE) },
    oracle: (a: Record<string, string>): boolean => {
      return subscript(a, "http.route") !== RARE;
    },
  },
  {
    label: "does not exist",
    attributes: { flag: new IsNull() },
    oracle: (a: Record<string, string>): boolean => {
      return subscript(a, "flag") === "";
    },
  },
  {
    label: "exists",
    attributes: { flag: new NotNull() },
    oracle: (a: Record<string, string>): boolean => {
      return subscript(a, "flag") !== "";
    },
  },
  {
    label: "greater than",
    attributes: { "duration.ms": new GreaterThan(990) },
    oracle: (a: Record<string, string>): boolean => {
      return (numberOf(subscript(a, "duration.ms")) ?? -Infinity) > 990;
    },
  },
  {
    label: "greater than or equal",
    attributes: { "duration.ms": new GreaterThanOrEqual(990) },
    oracle: (a: Record<string, string>): boolean => {
      return (numberOf(subscript(a, "duration.ms")) ?? -Infinity) >= 990;
    },
  },
  {
    label: "less than",
    attributes: { "duration.ms": new LessThan(5) },
    oracle: (a: Record<string, string>): boolean => {
      return (numberOf(subscript(a, "duration.ms")) ?? Infinity) < 5;
    },
  },
  {
    label: "less than or equal",
    attributes: { "duration.ms": new LessThanOrEqual(5) },
    oracle: (a: Record<string, string>): boolean => {
      return (numberOf(subscript(a, "duration.ms")) ?? Infinity) <= 5;
    },
  },
  {
    label: "contains, keys and values case-insensitively",
    attributes: { "HTTP.ROUTE": new Search("ORDERS") },
    oracle: anyValue("http.route", lowerIncludes("ORDERS")),
  },
  {
    label: "does not contain",
    attributes: { "http.route": new NotContains("orders") },
    oracle: not(anyValue("http.route", lowerIncludes("orders"))),
  },
  {
    label: "starts with",
    attributes: { "http.route": new StartsWith("/orders") },
    oracle: anyValue("http.route", (v: string) => {
      return v.toLowerCase().startsWith("/orders");
    }),
  },
  {
    label: "ends with",
    attributes: { "http.route": new EndsWith("_off") },
    oracle: anyValue("http.route", (v: string) => {
      return v.toLowerCase().endsWith("_off");
    }),
  },
  {
    label: "matches globs",
    attributes: { "http.route": new Wildcard(["/orders/*", "/c?rt"]) },
    oracle: anyValue("http.route", (v: string) => {
      return globMatches("/orders/*", v) || globMatches("/c?rt", v);
    }),
  },
  {
    label: "does not match a glob",
    attributes: { "http.route": new NotWildcard(["/orders/*"]) },
    oracle: not(
      anyValue("http.route", (v: string) => {
        return globMatches("/orders/*", v);
      }),
    ),
  },
];

function expectedBodies(oracle: Oracle): Array<string> {
  return OWN_ROWS.filter((fixture: Fixture): boolean => {
    return oracle(fixture.attributes);
  })
    .map((fixture: Fixture): string => {
      return fixture.body;
    })
    .sort();
}

/*
 * Whether any attribute of the row - under any key - holds `value`: all a
 * bloom filter over mapValues(attributes) can tell a granule apart by.
 */
function holdsValue(value: string): Oracle {
  return (attributes: Record<string, string>): boolean => {
    return Object.values(attributes).includes(value);
  };
}

// The granules a part keeps the rows that satisfy `oracle` in.
function expectedGranules(oracle: Oracle): Set<number> {
  return new Set(
    OWN_ROWS.filter((fixture: Fixture): boolean => {
      return oracle(fixture.attributes);
    }).map((fixture: Fixture): number => {
      return Math.floor(fixture.index / GRANULE_ROWS);
    }),
  );
}

const VALUE_PREFILTER: RegExp =
  /has(Any)?\(mapValues\(attributes\), \{p\d+:(String|Array\(String\))\}\) AND /g;
const INDEX_LINE: string = "Name: idx_attribute_values";
const GRANULES_LINE: RegExp = /Granules: (\d+)\/(\d+)/;

// No skip index at all, and no remembered condition results.
const WITHOUT_SKIP_INDEXES: Record<string, string | number> = {
  use_skip_indexes: 0,
  use_query_condition_cache: 0,
};

const AS_IS: Record<string, string | number> = {
  use_query_condition_cache: 0,
};

integration("idx_attribute_values against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Record<string, unknown> | undefined;

  // The chart filter the way every chart applies it: one project's rows.
  function chartStatement(attributes: Record<string, unknown>): Statement {
    const statement: Statement = SQL`SELECT body FROM ${database}.${new Log().tableName} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: PROJECT_ID,
    }}`;

    appendAttributeFilters({
      statement: statement,
      attributes: attributes,
      validateKey: (): void => {},
    });

    return statement;
  }

  // The list query the logs explorer runs, every matching row on one page.
  function listStatement(attributes: Record<string, unknown>): Statement {
    return LogService.toFindStatement({
      query: {
        projectId: PROJECT_ID,
        time: new InBetween<Date>(WINDOW_START, WINDOW_END),
        attributes: attributes,
      } as any,
      select: { body: true } as any,
      sort: { time: SortOrder.Descending } as any,
      limit: ROWS,
      skip: 0,
      props: { isRoot: true },
    }).statement;
  }

  async function rows(
    query: string,
    queryParams: Record<string, unknown>,
    settings: Record<string, string | number>,
  ): Promise<Array<string>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: query,
      query_params: queryParams,
      format: "JSONEachRow",
      clickhouse_settings: settings,
    });

    return ((await result.json()) as Array<{ body: string }>)
      .map((row: { body: string }): string => {
        return row.body;
      })
      .sort();
  }

  async function bodies(
    statement: Statement,
    settings: Record<string, string | number>,
  ): Promise<Array<string>> {
    return rows(statement.query, statement.query_params, settings);
  }

  /*
   * The statement as the charts sent it before #4706: the same SQL without
   * the value check (its parameter is left bound and unused).
   */
  async function bodiesAsBefore(statement: Statement): Promise<Array<string>> {
    return rows(
      statement.query.replace(VALUE_PREFILTER, ""),
      statement.query_params,
      WITHOUT_SKIP_INDEXES,
    );
  }

  /*
   * What EXPLAIN says idx_attribute_values leaves of the granules before it:
   * `{selected, of}`, or undefined when the query does not use the index.
   */
  async function valueIndexGranules(
    statement: Statement,
  ): Promise<{ selected: number; of: number } | undefined> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: `EXPLAIN indexes = 1 ${statement.query}`,
      query_params: statement.query_params,
      format: "JSONEachRow",
      clickhouse_settings: AS_IS,
    });

    const lines: Array<string> = (
      (await result.json()) as Array<{ explain: string }>
    ).map((row: { explain: string }): string => {
      return row.explain;
    });

    const at: number = lines.findIndex((line: string): boolean => {
      return line.includes(INDEX_LINE);
    });

    if (at < 0) {
      return undefined;
    }

    for (const line of lines.slice(at + 1, at + 6)) {
      const match: RegExpExecArray | null = GRANULES_LINE.exec(line);

      if (match) {
        return { selected: Number(match[1]), of: Number(match[2]) };
      }
    }

    return undefined;
  }

  // The marks ClickHouse selected to read, from its own query log.
  async function selectedMarks(
    statement: Statement,
    settings: Record<string, string | number>,
  ): Promise<number> {
    const comment: string = `attribute-value-index-${ObjectID.generate().toString()}`;

    await bodies(statement, { ...settings, log_comment: comment });
    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const result: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT ProfileEvents['SelectedMarks'] AS marks FROM system.query_log WHERE log_comment = {comment:String} AND type = 'QueryFinish' ORDER BY event_time_microseconds DESC LIMIT 1",
      query_params: { comment: comment },
      format: "JSONEachRow",
    });

    const logged: Array<{ marks: string | number }> =
      (await result.json()) as Array<{ marks: string | number }>;

    expect(logged).toHaveLength(1);

    return Number(logged[0]!.marks);
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    const model: AnalyticsBaseModel = new Log();
    const generator: StatementGenerator<AnalyticsBaseModel> =
      new StatementGenerator<AnalyticsBaseModel>({
        modelType: Log,
        database: clickhouse,
      });
    const columns: Statement = generator.toColumnsCreateStatement(
      model.tableColumns,
    );

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS index_granularity = ${GRANULE_ROWS}, index_granularity_bytes = 0`,
      query_params: columns.query_params,
    });

    original = {
      database: LogService.database,
      databaseClient: LogService.databaseClient,
      ingestDatabase: LogService.ingestDatabase,
      ingestDatabaseClient: LogService.ingestDatabaseClient,
    };

    LogService.database = clickhouse;
    LogService.databaseClient = client;
    LogService.ingestDatabase = clickhouse;
    LogService.ingestDatabaseClient = client;

    // One insert, so the fixture is one part laid out in fixture order.
    await client.insert({
      table: `${database}.${model.tableName}`,
      values: FIXTURES.map(logRow),
      format: "JSONEachRow",
    });

    const parts: { json: () => Promise<unknown> } = await client.query({
      query: `SELECT count() AS parts, sum(rows) AS rows FROM system.parts WHERE database = {database:String} AND table = {table:String} AND active`,
      query_params: { database: database, table: model.tableName },
      format: "JSONEachRow",
    });

    /*
     * One part, so row n of the project sits in granule floor(n / 256).
     * (UInt64 arrives as a JSON number or string depending on the
     * server's output_format_json_quote_64bit_integers; read both.)
     */
    const [layout] = (await parts.json()) as Array<{
      parts: string | number;
      rows: string | number;
    }>;

    expect(Number(layout!.parts)).toBe(1);
    expect(Number(layout!.rows)).toBe(ROWS + OTHER_PROJECT_ROWS);
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(LogService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the table the Log model creates carries the index over the attribute values", async () => {
    const result: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT name, type_full, expr, granularity FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String} AND name = 'idx_attribute_values'",
      query_params: { database: database, table: new Log().tableName },
      format: "JSONEachRow",
    });

    const indexes: Array<{
      name: string;
      type_full: string;
      expr: string;
      granularity: string | number;
    }> = (await result.json()) as Array<{
      name: string;
      type_full: string;
      expr: string;
      granularity: string | number;
    }>;

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.name).toBe("idx_attribute_values");
    expect(indexes[0]!.type_full).toBe("bloom_filter(0.01)");
    expect(indexes[0]!.expr).toBe("mapValues(attributes)");
    expect(Number(indexes[0]!.granularity)).toBe(1);
  });

  describe("nothing a chart returns changes", () => {
    test.each(CHART_CASES)(
      "$label: the same rows with the index, without it, as before the change, and as the fixture says",
      async ({ attributes, oracle }: ChartCase) => {
        const statement: Statement = chartStatement(attributes);
        const expected: Array<string> = expectedBodies(oracle);

        expect(await bodies(statement, AS_IS)).toEqual(expected);
        expect(await bodies(statement, WITHOUT_SKIP_INDEXES)).toEqual(expected);
        expect(await bodiesAsBefore(statement)).toEqual(expected);
      },
    );

    test("the fixture holds every case a filter must get right", () => {
      const routeKeys: Set<string> = new Set();

      for (const fixture of OWN_ROWS) {
        for (const key of Object.keys(fixture.attributes)) {
          if (key.toLowerCase() === "http.route") {
            routeKeys.add(key);
          }
        }
      }

      expect([...routeKeys].sort()).toEqual(["HTTP.Route", "http.route"]);
      expect(
        expectedBodies((a: Record<string, string>) => {
          return !("http.route" in a) && !("HTTP.Route" in a);
        }).length,
      ).toBeGreaterThan(0);
      expect(
        expectedBodies((a: Record<string, string>) => {
          return a["http.route"] === "";
        }).length,
      ).toBeGreaterThan(0);
      expect(expectedBodies(CHART_CASES[0]!.oracle).length).toBeGreaterThan(
        BURST_ROWS,
      );
    });
  });

  describe("nothing the list returns changes", () => {
    test.each(LIST_CASES)(
      "$label: the same rows with the index, without it, and as the fixture says",
      async ({ attributes, oracle }: ListCase) => {
        const statement: Statement = listStatement(attributes);
        const expected: Array<string> = expectedBodies(oracle);

        expect(await bodies(statement, AS_IS)).toEqual(expected);
        expect(await bodies(statement, WITHOUT_SKIP_INDEXES)).toEqual(expected);
      },
    );

    test("the explorer's own list read returns the rare value's rows", async () => {
      const logs: Array<Log> = await LogService.findBy({
        query: {
          projectId: PROJECT_ID,
          time: new InBetween<Date>(WINDOW_START, WINDOW_END),
          attributes: { "http.route": RARE },
        } as any,
        select: { body: true },
        sort: { time: SortOrder.Descending },
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });

      expect(
        logs
          .map((log: Log): string => {
            return log.body || "";
          })
          .sort(),
      ).toEqual(
        expectedBodies((a: Record<string, string>) => {
          return a["http.route"] === RARE;
        }),
      );
    });
  });

  describe("a rare value is read from the granules that hold it", () => {
    const rareInCharts: Oracle = CHART_CASES[0]!.oracle;
    // Every granule where some attribute holds the rare value.
    const holdingRare: number = expectedGranules(holdsValue(RARE)).size;

    test("a chart's value check selects the granules holding the value and no more than a few false positives", async () => {
      const granules: { selected: number; of: number } | undefined =
        await valueIndexGranules(chartStatement({ "http.route": RARE }));

      expect(granules).toBeDefined();
      expect(granules!.of).toBe(GRANULES);
      // Never fewer than the matching rows sit in: no false negatives...
      expect(granules!.selected).toBeGreaterThanOrEqual(
        expectedGranules(rareInCharts).size,
      );
      // ...and at 1% only the odd false positive past the value's granules.
      expect(granules!.selected).toBeLessThanOrEqual(holdingRare + 5);
      expect(holdingRare).toBeLessThan(GRANULES / 4);
    });

    test("so does a list of values", async () => {
      const granules: { selected: number; of: number } | undefined =
        await valueIndexGranules(
          chartStatement({ "http.route": [RARE, "/does-not-exist"] }),
        );

      expect(granules).toBeDefined();
      expect(granules!.selected).toBeGreaterThanOrEqual(
        expectedGranules(rareInCharts).size,
      );
      expect(granules!.selected).toBeLessThanOrEqual(holdingRare + 5);
    });

    test("a value no row has selects almost nothing", async () => {
      const granules: { selected: number; of: number } | undefined =
        await valueIndexGranules(chartStatement({ "http.route": "/nope" }));

      expect(granules).toBeDefined();
      expect(granules!.selected).toBeLessThanOrEqual(5);
    });

    test("the list's own attributes['k'] = 'v' uses the index as it is", async () => {
      const granules: { selected: number; of: number } | undefined =
        await valueIndexGranules(listStatement({ "http.route": RARE }));

      expect(granules).toBeDefined();
      // The list reads the key exactly; the index cannot tell keys apart.
      expect(granules!.selected).toBeGreaterThanOrEqual(
        expectedGranules((a: Record<string, string>) => {
          return a["http.route"] === RARE;
        }).size,
      );
      expect(granules!.selected).toBeLessThanOrEqual(holdingRare + 5);
    });

    test("so does the list's IN (...)", async () => {
      const granules: { selected: number; of: number } | undefined =
        await valueIndexGranules(
          listStatement({ "http.route": new Includes([RARE, "/nope"]) }),
        );

      expect(granules).toBeDefined();
      expect(granules!.selected).toBeLessThan(GRANULES / 4);
    });

    test("the marks ClickHouse selects drop with it - and come back without the index", async () => {
      const statement: Statement = chartStatement({ "http.route": RARE });

      const withIndex: number = await selectedMarks(statement, AS_IS);
      const withoutIndex: number = await selectedMarks(statement, {
        ...AS_IS,
        ignore_data_skipping_indices: "idx_attribute_values",
      });

      expect(withoutIndex).toBeGreaterThanOrEqual(GRANULES);
      expect(withIndex).toBeLessThanOrEqual(holdingRare + 5);
      expect(withIndex * 4).toBeLessThan(withoutIndex);
    });
  });

  describe("the index claims nothing it cannot do", () => {
    test("a value in every granule selects every granule", async () => {
      const granules: { selected: number; of: number } | undefined =
        await valueIndexGranules(chartStatement({ "http.method": "GET" }));

      expect(granules).toEqual({ selected: GRANULES, of: GRANULES });
    });

    test.each([
      ["a blank value", { "http.route": "" }],
      ["does not equal", { "http.route": { _type: "NotEqual", value: RARE } }],
      ["contains", { "http.route": { _type: "Search", value: "orders" } }],
      ["a glob", { "http.route": { _type: "Wildcard", value: ["/orders/*"] } }],
      [
        "is none of",
        { "http.route": { _type: "IncludesNone", value: [RARE] } },
      ],
      ["greater than", { "duration.ms": { _type: "GreaterThan", value: 990 } }],
      ["exists", { flag: { _type: "NotNull" } }],
    ])(
      "%s does not use it",
      async (_label: string, attributes: Record<string, unknown>) => {
        expect(
          await valueIndexGranules(chartStatement(attributes)),
        ).toBeUndefined();
      },
    );

    test("the list's blank equality does not use it: a missing key reads as ''", async () => {
      expect(
        await valueIndexGranules(listStatement({ "http.route": "" })),
      ).toBeUndefined();
      expect(
        await valueIndexGranules(
          listStatement({ "http.route": new Includes(["", "/cart"]) }),
        ),
      ).toBeUndefined();
    });
  });

  describe("the service reads answer as the fixture says", () => {
    const rare: Record<string, string> = { "http.route": RARE };
    const rareRows: Array<string> = expectedBodies(
      anyValue("http.route", (v: string) => {
        return v === RARE;
      }),
    );

    test("the histogram counts the rare value's rows", async () => {
      const buckets: Array<HistogramBucket> =
        await LogAggregationService.getHistogram({
          projectId: PROJECT_ID,
          startTime: WINDOW_START,
          endTime: WINDOW_END,
          bucketSizeInMinutes: 60,
          attributes: rare,
        });

      expect(
        buckets.reduce((total: number, bucket: HistogramBucket): number => {
          return total + bucket.count;
        }, 0),
      ).toBe(rareRows.length);
    });

    test("the method facet counts them by method", async () => {
      const facet: Array<FacetValue> =
        await LogAggregationService.getFacetValues({
          projectId: PROJECT_ID,
          startTime: WINDOW_START,
          endTime: WINDOW_END,
          facetKey: "http.method",
          attributes: rare,
        });

      const counted: Record<string, number> = {};

      for (const fixture of OWN_ROWS) {
        if (valuesUnder(fixture.attributes, "http.route").includes(RARE)) {
          const method: string = fixture.attributes["http.method"]!;
          counted[method] = (counted[method] || 0) + 1;
        }
      }

      expect(
        Object.fromEntries(
          facet.map((value: FacetValue): [string, number] => {
            return [value.value, value.count];
          }),
        ),
      ).toEqual(counted);
    });

    test("the export returns exactly the rare value's rows, of one project", async () => {
      const exported: Array<JSONObject> =
        await LogAggregationService.getExportLogs({
          projectId: PROJECT_ID,
          startTime: WINDOW_START,
          endTime: WINDOW_END,
          limit: 10000,
          attributes: rare,
        });

      expect(
        exported
          .map((row: JSONObject): string => {
            return String(row["body"]);
          })
          .sort(),
      ).toEqual(rareRows);
    });
  });
});

describe("idx_attribute_values ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
