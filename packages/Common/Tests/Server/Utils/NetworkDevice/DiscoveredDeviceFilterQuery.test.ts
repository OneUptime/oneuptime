import {
  DiscoveredDeviceScope,
  DiscoveredDeviceStatement,
  StatementParams,
  buildCountsStatement,
  buildFiltersCondition,
  buildIdsStatement,
  buildRowsStatement,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDeviceQuery";
import {
  DiscoveredDeviceFilter,
  DiscoveredDeviceFilterField,
  DiscoveredDeviceFilterOperator,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
} from "../../../../Types/NetworkDevice/DiscoveredDevice";
import { describe, expect, test } from "@jest/globals";

/*
 * The Discovered Devices list's filters as SQL (OneUptime issue #9304): each
 * one a condition on the classified rows, every one of them and the search
 * holding at once, in the counts, the page and "select every matching row"
 * alike - and whatever a person typed reaches the database as a parameter,
 * never as SQL.
 */

const SCOPE: DiscoveredDeviceScope = {
  projectId: "aa000000-0000-4000-8000-000000000001",
  walkSeenSince: new Date("2026-11-08T11:45:00.000Z"),
  controllerSeenSince: new Date("2026-11-08T06:00:00.000Z"),
};

const SITE: string = "20000000-0000-4000-8000-000000000001";

function condition(filters: Array<DiscoveredDeviceFilter>): {
  sql: string;
  params: Array<unknown>;
} {
  const params: StatementParams = new StatementParams();
  const sql: string = buildFiltersCondition(filters, params);
  return { sql: sql, params: params.values };
}

function text(
  field: DiscoveredDeviceFilterField,
  operator: DiscoveredDeviceFilterOperator,
  value?: string,
): DiscoveredDeviceFilter {
  return {
    field: field,
    operator: operator,
    values: value === undefined ? [] : [value],
  };
}

describe("buildFiltersCondition", () => {
  test("no filter narrows nothing", () => {
    expect(condition([])).toEqual({ sql: "TRUE", params: [] });
  });

  test("text is compared without case, its wildcards only characters", () => {
    const vendor: { sql: string; params: Array<unknown> } = condition([
      text(
        DiscoveredDeviceFilterField.Vendor,
        DiscoveredDeviceFilterOperator.Contains,
        "50%_off",
      ),
    ]);

    expect(vendor.sql).toBe(`c."vendor" ILIKE $1 ESCAPE '!'`);
    expect(vendor.params).toEqual(["%50!%!_off%"]);

    expect(
      condition([
        text(
          DiscoveredDeviceFilterField.IpAddress,
          DiscoveredDeviceFilterOperator.StartsWith,
          "10.34.",
        ),
      ]).params,
    ).toEqual(["10.34.%"]);
    expect(
      condition([
        text(
          DiscoveredDeviceFilterField.Hostname,
          DiscoveredDeviceFilterOperator.EndsWith,
          ".corp",
        ),
      ]).params,
    ).toEqual(["%.corp"]);
    expect(
      condition([
        text(
          DiscoveredDeviceFilterField.Vendor,
          DiscoveredDeviceFilterOperator.Is,
          "Axis",
        ),
      ]).sql,
    ).toBe(`lower(btrim(c."vendor")) = lower($1)`);
  });

  test("is not and does not contain keep the rows that have no value", () => {
    expect(
      condition([
        text(
          DiscoveredDeviceFilterField.Vendor,
          DiscoveredDeviceFilterOperator.IsNot,
          "Axis",
        ),
      ]).sql,
    ).toBe(
      `(NOT (NULLIF(btrim(c."vendor"), '') IS NOT NULL) OR lower(btrim(c."vendor")) <> lower($1))`,
    );
    expect(
      condition([
        text(
          DiscoveredDeviceFilterField.Vendor,
          DiscoveredDeviceFilterOperator.NotContains,
          "Axis",
        ),
      ]).sql,
    ).toContain(`NOT (NULLIF(btrim(c."vendor"), '') IS NOT NULL) OR NOT (`);
  });

  test("empty means no value, blank or not", () => {
    expect(
      condition([
        text(
          DiscoveredDeviceFilterField.Hostname,
          DiscoveredDeviceFilterOperator.IsEmpty,
        ),
        text(
          DiscoveredDeviceFilterField.Vendor,
          DiscoveredDeviceFilterOperator.IsNotEmpty,
        ),
      ]),
    ).toEqual({
      sql: `NOT (NULLIF(btrim(c."hostname"), '') IS NOT NULL)\n  AND (NULLIF(btrim(c."vendor"), '') IS NOT NULL)`,
      params: [],
    });
  });

  test("the name is the one the list shows: classification, hostname, address, then MAC", () => {
    expect(
      condition([
        text(
          DiscoveredDeviceFilterField.Name,
          DiscoveredDeviceFilterOperator.Contains,
          "camera",
        ),
      ]).sql,
    ).toBe(
      `COALESCE(NULLIF(btrim(c."classification"), ''), NULLIF(btrim(c."hostname"), ''), NULLIF(c."address", ''), c."macAddress") ILIKE $1 ESCAPE '!'`,
    );
  });

  test("a MAC is compared as hex digits however it is separated", () => {
    expect(
      condition([
        text(
          DiscoveredDeviceFilterField.MacAddress,
          DiscoveredDeviceFilterOperator.StartsWith,
          "20-4B-22",
        ),
      ]),
    ).toEqual({ sql: `c."macKey" ILIKE $1 ESCAPE '!'`, params: ["204b22%"] });
  });

  test("a site is one of the picked sites, not one of them, none or any", () => {
    expect(
      condition([
        {
          field: DiscoveredDeviceFilterField.Site,
          operator: DiscoveredDeviceFilterOperator.Is,
          values: [SITE],
        },
      ]),
    ).toEqual({ sql: `c."siteId" = ANY($1::uuid[])`, params: [[SITE]] });
    expect(
      condition([
        {
          field: DiscoveredDeviceFilterField.Site,
          operator: DiscoveredDeviceFilterOperator.IsNot,
          values: [SITE],
        },
      ]).sql,
    ).toBe(`(c."siteId" IS NULL OR NOT (c."siteId" = ANY($1::uuid[])))`);
    expect(
      condition([
        {
          field: DiscoveredDeviceFilterField.Site,
          operator: DiscoveredDeviceFilterOperator.IsEmpty,
          values: [],
        },
      ]).sql,
    ).toBe(`c."siteId" IS NULL`);
  });

  test("Seen By: a controller's client list, a walk, or either", () => {
    const seenBy: (values: Array<string>) => string = (
      values: Array<string>,
    ): string => {
      return condition([
        {
          field: DiscoveredDeviceFilterField.Source,
          operator: DiscoveredDeviceFilterOperator.Is,
          values: values,
        },
      ]).sql;
    };

    expect(seenBy(["controller"])).toBe(`c."isFromController"`);
    expect(seenBy(["walk"])).toBe(`NOT c."isFromController"`);
    expect(seenBy(["walk", "controller"])).toBe("TRUE");
  });

  test("Last Seen: before, after, or between two instants", () => {
    expect(
      condition([
        {
          field: DiscoveredDeviceFilterField.LastSeen,
          operator: DiscoveredDeviceFilterOperator.Between,
          values: ["2026-11-01T00:00:00.000Z", "2026-11-02T23:59:59.999Z"],
        },
      ]),
    ).toEqual({
      sql: `c."lastSeenAt" BETWEEN $1::timestamptz AND $2::timestamptz`,
      params: ["2026-11-01T00:00:00.000Z", "2026-11-02T23:59:59.999Z"],
    });
    expect(
      condition([
        {
          field: DiscoveredDeviceFilterField.LastSeen,
          operator: DiscoveredDeviceFilterOperator.Before,
          values: ["2026-11-01T00:00:00.000Z"],
        },
      ]).sql,
    ).toBe(`c."lastSeenAt" < $1::timestamptz`);
  });
});

describe("every statement applies them with the search", () => {
  const FILTERS: Array<DiscoveredDeviceFilter> = [
    text(
      DiscoveredDeviceFilterField.Vendor,
      DiscoveredDeviceFilterOperator.Contains,
      '\'; DROP TABLE "NetworkEndpoint"; --',
    ),
  ];

  const statements: Array<[string, DiscoveredDeviceStatement]> = [
    [
      "counts",
      buildCountsStatement({
        scope: SCOPE,
        search: "camera",
        filters: FILTERS,
      }),
    ],
    [
      "rows",
      buildRowsStatement({
        scope: SCOPE,
        search: "camera",
        filters: FILTERS,
        show: DiscoveredDeviceShow.All,
        sort: DiscoveredDeviceSort.LastSeen,
        sortOrder: "desc",
        limit: 25,
        skip: 0,
      }),
    ],
    [
      "ids",
      buildIdsStatement({
        scope: SCOPE,
        search: "camera",
        filters: FILTERS,
        show: DiscoveredDeviceShow.All,
        sort: DiscoveredDeviceSort.LastSeen,
        sortOrder: "desc",
        limit: 5000,
      }),
    ],
  ];

  test.each(statements)(
    "%s: the filter is a condition, its value a parameter",
    (_name: string, statement: DiscoveredDeviceStatement) => {
      expect(statement.sql).toContain(`c."vendor" ILIKE`);
      expect(statement.sql).not.toContain("DROP TABLE");
      expect(statement.params).toContain(
        `%'; DROP TABLE "NetworkEndpoint"; --%`,
      );
    },
  );

  test("without filters a statement reads as before", () => {
    expect(buildCountsStatement({ scope: SCOPE, search: "" }).sql).toContain(
      "WHERE TRUE\n  AND TRUE",
    );
  });
});
