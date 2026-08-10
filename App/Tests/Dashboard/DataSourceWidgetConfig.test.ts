import { describe, expect, test } from "@jest/globals";
import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import {
  getConfiguredDataSourceQueries,
  isDataSourceQueryConfigured,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils/DataSourceWidget";

/*
 * These two helpers are the only gate between a freshly dropped Data Source
 * widget and the /data-source/query endpoint. Every Data Source widget is
 * seeded with a blank query card so the editor opens on something, which
 * means "the query object exists" carries no information at all — without
 * the blank/whitespace checks below, every dashboard load would fire a
 * request per placeholder widget and paint the canvas with errors the user
 * never asked for. The whitespace cases matter most: they are what a user
 * who typed a query and then deleted it lands on, and what a paste from
 * documentation (trailing newline, non-breaking space) produces.
 */

type MakeConfig = (
  dataSourceId: unknown,
  query: unknown,
) => DataSourceQueryConfig;

const config: MakeConfig = (
  dataSourceId: unknown,
  query: unknown,
): DataSourceQueryConfig => {
  return {
    dataSourceId: dataSourceId as string,
    query: query as string,
  };
};

const VALID_SOURCE_ID: string = "a2f0f3c0-0000-4000-8000-000000000001";

describe("DataSourceWidget.isDataSourceQueryConfigured - missing pieces", () => {
  test("no query config at all is not configured", () => {
    expect(isDataSourceQueryConfigured(undefined)).toBe(false);
  });

  test("an object missing either field entirely is not configured", () => {
    expect(
      isDataSourceQueryConfigured({
        query: "up",
      } as unknown as DataSourceQueryConfig),
    ).toBe(false);

    expect(
      isDataSourceQueryConfigured({
        dataSourceId: VALID_SOURCE_ID,
      } as unknown as DataSourceQueryConfig),
    ).toBe(false);

    expect(
      isDataSourceQueryConfigured({} as unknown as DataSourceQueryConfig),
    ).toBe(false);
  });

  test("the seeded blank query card is not configured", () => {
    // Mirrors DashboardDataSourceChartComponentUtil.getDefaultComponent().
    expect(
      isDataSourceQueryConfigured({
        id: "b1c2d3e4",
        dataSourceId: "",
        query: "",
      }),
    ).toBe(false);
  });

  test("a source picked but no query typed is not configured", () => {
    expect(isDataSourceQueryConfigured(config(VALID_SOURCE_ID, ""))).toBe(
      false,
    );
  });

  test("a query typed but no source picked is not configured", () => {
    expect(isDataSourceQueryConfigured(config("", "SELECT 1 AS value"))).toBe(
      false,
    );
  });

  test("a legend on its own does not make a query runnable", () => {
    expect(
      isDataSourceQueryConfigured({
        dataSourceId: "",
        query: "",
        legend: "{{instance}}",
      }),
    ).toBe(false);
  });
});

describe("DataSourceWidget.isDataSourceQueryConfigured - whitespace only", () => {
  test("a whitespace-only query is treated as no query", () => {
    // What a user who typed a query and then deleted it leaves behind.
    for (const blank of [" ", "   ", "\t", "\n", "\r\n", " \t\n "]) {
      expect(isDataSourceQueryConfigured(config(VALID_SOURCE_ID, blank))).toBe(
        false,
      );
    }
  });

  test("a whitespace-only data source id is treated as no source", () => {
    for (const blank of [" ", "\t", "\n", " \t\n "]) {
      expect(isDataSourceQueryConfigured(config(blank, "up"))).toBe(false);
    }
  });

  test("both fields whitespace-only is not configured", () => {
    expect(isDataSourceQueryConfigured(config("  ", "\n\t"))).toBe(false);
  });

  test("a non-breaking space pasted from docs still counts as blank", () => {
    expect(isDataSourceQueryConfigured(config(VALID_SOURCE_ID, " "))).toBe(
      false,
    );
  });
});

describe("DataSourceWidget.isDataSourceQueryConfigured - runnable queries", () => {
  test("a source and a real query is configured", () => {
    expect(
      isDataSourceQueryConfigured(
        config(VALID_SOURCE_ID, "rate(http_requests_total[5m])"),
      ),
    ).toBe(true);
  });

  test("a one-character query is enough - blankness is the only bar", () => {
    expect(isDataSourceQueryConfigured(config(VALID_SOURCE_ID, "1"))).toBe(
      true,
    );
  });

  test("whitespace around real content does not disqualify the query", () => {
    /*
     * Trailing newlines are normal in a multi-line SQL editor; the trim is
     * only there to detect emptiness, not to reject padded input.
     */
    expect(
      isDataSourceQueryConfigured(config(VALID_SOURCE_ID, "\n  SELECT 1  \n")),
    ).toBe(true);
    expect(
      isDataSourceQueryConfigured(config(`  ${VALID_SOURCE_ID}  `, "up")),
    ).toBe(true);
  });

  test("multi-line SQL with macros is configured", () => {
    expect(
      isDataSourceQueryConfigured(
        config(
          VALID_SOURCE_ID,
          "SELECT time, value\nFROM metrics\nWHERE time BETWEEN $__startTime AND $__endTime",
        ),
      ),
    ).toBe(true);
  });
});

describe("DataSourceWidget.isDataSourceQueryConfigured - values from stored JSONB", () => {
  /*
   * dashboardViewConfig is JSONB written by older builds and by the API, so
   * a field can come back as null or a non-string. A dashboard load must not
   * be taken down by one malformed widget.
   */
  test("nulls are treated as missing rather than throwing", () => {
    expect(isDataSourceQueryConfigured(config(null, "up"))).toBe(false);
    expect(isDataSourceQueryConfigured(config(VALID_SOURCE_ID, null))).toBe(
      false,
    );
    expect(isDataSourceQueryConfigured(config(null, null))).toBe(false);
  });

  test("undefined fields are treated as missing", () => {
    expect(isDataSourceQueryConfigured(config(undefined, "up"))).toBe(false);
    expect(
      isDataSourceQueryConfigured(config(VALID_SOURCE_ID, undefined)),
    ).toBe(false);
  });

  test("a zero-valued number is falsy and therefore not configured", () => {
    expect(isDataSourceQueryConfigured(config(0, "up"))).toBe(false);
    expect(isDataSourceQueryConfigured(config(VALID_SOURCE_ID, 0))).toBe(false);
  });

  /*
   * A truthy non-string is the dangerous case: null and 0 are caught by
   * falsiness alone, so only these prove the type is actually checked
   * rather than assumed. Calling .trim() on them would throw during render
   * and take the whole dashboard down over one malformed widget.
   */
  test("a non-zero number reports not-configured rather than throwing", () => {
    expect(isDataSourceQueryConfigured(config(123, "up"))).toBe(false);
    expect(isDataSourceQueryConfigured(config(VALID_SOURCE_ID, 123))).toBe(
      false,
    );
  });

  test("object- and array-valued fields report not-configured", () => {
    expect(
      isDataSourceQueryConfigured(config({ _id: VALID_SOURCE_ID }, "up")),
    ).toBe(false);
    expect(
      isDataSourceQueryConfigured(config(VALID_SOURCE_ID, { sql: "SELECT 1" })),
    ).toBe(false);
    expect(isDataSourceQueryConfigured(config([VALID_SOURCE_ID], "up"))).toBe(
      false,
    );
    expect(isDataSourceQueryConfigured(config(true, "up"))).toBe(false);
  });

  test("a malformed entry is filtered out of a chart's query list, not thrown on", () => {
    expect(
      getConfiguredDataSourceQueries([
        config(123, "up"),
        config(VALID_SOURCE_ID, 'up{job="api"}'),
        config({ nested: true }, "rate(x[5m])"),
      ]),
    ).toEqual([config(VALID_SOURCE_ID, 'up{job="api"}')]);
  });
});

describe("DataSourceWidget.getConfiguredDataSourceQueries", () => {
  test("a widget with no query list yields nothing to run", () => {
    expect(getConfiguredDataSourceQueries(undefined)).toEqual([]);
    expect(getConfiguredDataSourceQueries([])).toEqual([]);
  });

  test("an all-unconfigured list yields nothing to run", () => {
    /*
     * The chart widget then renders "configure a query" rather than firing a
     * request with zero queries.
     */
    expect(
      getConfiguredDataSourceQueries([
        { id: "1", dataSourceId: "", query: "" },
        { id: "2", dataSourceId: VALID_SOURCE_ID, query: "   " },
        { id: "3", dataSourceId: " ", query: "up" },
      ]),
    ).toEqual([]);
  });

  test("half-filled queries are dropped and the rest keep their order", () => {
    const first: DataSourceQueryConfig = {
      id: "1",
      dataSourceId: VALID_SOURCE_ID,
      query: "up",
    };
    const blank: DataSourceQueryConfig = {
      id: "2",
      dataSourceId: "",
      query: "",
    };
    const second: DataSourceQueryConfig = {
      id: "3",
      dataSourceId: VALID_SOURCE_ID,
      query: "rate(errors_total[5m])",
      legend: "{{instance}}",
    };
    const sourceOnly: DataSourceQueryConfig = {
      id: "4",
      dataSourceId: VALID_SOURCE_ID,
      query: "\n \t",
    };
    const third: DataSourceQueryConfig = {
      id: "5",
      dataSourceId: VALID_SOURCE_ID,
      query: "SELECT 1",
    };

    const configured: Array<DataSourceQueryConfig> =
      getConfiguredDataSourceQueries([
        blank,
        first,
        sourceOnly,
        second,
        blank,
        third,
      ]);

    // Order matters: series colours and legend order follow the array index.
    expect(configured).toEqual([first, second, third]);
    expect(
      configured.map((item: DataSourceQueryConfig) => {
        return item.id;
      }),
    ).toEqual(["1", "3", "5"]);
  });

  test("the kept entries are the same objects, not copies", () => {
    const kept: DataSourceQueryConfig = {
      id: "1",
      dataSourceId: VALID_SOURCE_ID,
      query: "up",
    };

    const configured: Array<DataSourceQueryConfig> =
      getConfiguredDataSourceQueries([kept]);

    expect(configured[0]).toBe(kept);
  });

  test("the input array is never mutated and is never returned", () => {
    /*
     * The chart widget memoizes on `arguments.queries` and diffs the result
     * against the last fetch, so mutating the stored config in place would
     * both corrupt the dashboard and defeat the diff.
     */
    const input: Array<DataSourceQueryConfig> = [
      { id: "1", dataSourceId: "", query: "" },
      { id: "2", dataSourceId: VALID_SOURCE_ID, query: "up" },
    ];
    const snapshot: string = JSON.stringify(input);

    const configured: Array<DataSourceQueryConfig> =
      getConfiguredDataSourceQueries(input);

    expect(configured).not.toBe(input);
    expect(input).toHaveLength(2);
    expect(JSON.stringify(input)).toBe(snapshot);

    configured.push({ id: "3", dataSourceId: VALID_SOURCE_ID, query: "down" });
    expect(input).toHaveLength(2);
  });

  test("an empty list still yields a fresh array each call", () => {
    const input: Array<DataSourceQueryConfig> = [];
    const first: Array<DataSourceQueryConfig> =
      getConfiguredDataSourceQueries(input);
    const second: Array<DataSourceQueryConfig> =
      getConfiguredDataSourceQueries(input);

    expect(first).not.toBe(input);
    expect(first).not.toBe(second);
  });

  test("null holes in a stored list are skipped rather than thrown on", () => {
    const kept: DataSourceQueryConfig = {
      id: "1",
      dataSourceId: VALID_SOURCE_ID,
      query: "up",
    };

    expect(
      getConfiguredDataSourceQueries([
        null as unknown as DataSourceQueryConfig,
        kept,
        undefined as unknown as DataSourceQueryConfig,
      ]),
    ).toEqual([kept]);
  });
});
