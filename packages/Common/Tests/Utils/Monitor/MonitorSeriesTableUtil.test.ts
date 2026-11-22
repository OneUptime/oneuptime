import MonitorEvaluationSummary, {
  MonitorEvaluationSeriesRow,
  MonitorEvaluationSeriesValueKind,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { Translator, createTranslator } from "../../../Types/Translator";
import MonitorSeriesTableUtil, {
  MonitorSeriesTableRow,
} from "../../../Utils/Monitor/MonitorSeriesTableUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERIES CARD OF A GROUPED MONITOR'S OVERVIEW (#10062), WITHOUT REACT:
 * the rows the last check's summary keeps, named as the series' incidents
 * and alerts name them, with their latest value in the reader's digits.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");
const GERMAN: Translator = createTranslator(undefined, "de");
const PERSIAN: Translator = createTranslator(undefined, "fa");

function row(
  data: Partial<MonitorEvaluationSeriesRow> & { fingerprint: string },
): MonitorEvaluationSeriesRow {
  return {
    labels: {},
    valueKind: MonitorEvaluationSeriesValueKind.Metric,
    metCriteriaIds: [],
    ...data,
  };
}

function summary(data: {
  rows: Array<MonitorEvaluationSeriesRow>;
  count?: number;
}): MonitorEvaluationSummary {
  return {
    evaluatedAt: new Date("2026-11-22T09:00:00.000Z"),
    criteriaResults: [
      {
        criteriaId: "offline",
        criteriaName: "High Filesystem - Usage > 90%",
        filterCondition: FilterCondition.Any,
        met: false,
        message: "",
        filters: [],
      },
      {
        criteriaId: "online",
        criteriaName: "Healthy",
        filterCondition: FilterCondition.Any,
        met: false,
        message: "",
        filters: [],
      },
      {
        criteriaId: "nameless",
        filterCondition: FilterCondition.Any,
        met: false,
        message: "",
        filters: [],
      },
    ],
    events: [],
    series: { count: data.count ?? data.rows.length, rows: data.rows },
  };
}

describe("MonitorSeriesTableUtil.getSeries", () => {
  test("a grouped check's summary has its series; any other has none, and the card is not drawn", () => {
    expect(MonitorSeriesTableUtil.getSeries(summary({ rows: [] }))).toEqual({
      count: 0,
      rows: [],
    });

    expect(
      MonitorSeriesTableUtil.getSeries({
        evaluatedAt: new Date(),
        criteriaResults: [],
        events: [],
      }),
    ).toBeNull();
    expect(MonitorSeriesTableUtil.getSeries(undefined)).toBeNull();
    expect(MonitorSeriesTableUtil.getSeries(null)).toBeNull();

    // A stored value that is not shaped as one is ignored.
    expect(
      MonitorSeriesTableUtil.getSeries({
        evaluatedAt: new Date(),
        criteriaResults: [],
        events: [],
        series: { rows: "nope" },
      } as unknown as MonitorEvaluationSummary),
    ).toBeNull();
  });
});

describe("MonitorSeriesTableUtil.getRows", () => {
  test("a disk is named by its mount and device, with its value and the criteria it met by name", () => {
    const rows: Array<MonitorSeriesTableRow> = MonitorSeriesTableUtil.getRows({
      summary: summary({
        rows: [
          row({
            fingerprint: "data",
            labels: { device: "/dev/sdb1", mountpoint: "/data" },
            value: 96,
            unit: "%",
            metCriteriaIds: ["offline", "online", "nameless"],
          }),
        ],
      }),
      translator: ENGLISH,
    });

    expect(rows).toHaveLength(1);
    expect(
      rows[0]!.labels.map((label: { name: string; value: string }) => {
        return `${label.name}: ${label.value}`;
      }),
    ).toEqual(["Mount: /data", "Device: /dev/sdb1"]);
    expect(rows[0]!.valueText).toBe("96.00%");
    expect(rows[0]!.criteriaNames).toEqual([
      "High Filesystem - Usage > 90%",
      "Healthy",
      "Unnamed criteria",
    ]);
    expect(rows[0]!.isKeepingStatus).toBe(false);
  });

  test("a series that keeps the status says so; one with no value has none", () => {
    const rows: Array<MonitorSeriesTableRow> = MonitorSeriesTableUtil.getRows({
      summary: summary({
        rows: [
          row({ fingerprint: "data", isKeepingStatus: true, value: 89, unit: "%" }),
          row({ fingerprint: "gone" }),
        ],
      }),
      translator: ENGLISH,
    });

    expect(rows[0]!.isKeepingStatus).toBe(true);
    expect(rows[0]!.criteriaNames).toEqual([]);
    expect(rows[1]!.valueText).toBeNull();
  });

  test("a criteria the summary no longer names reads as an unnamed one", () => {
    const rows: Array<MonitorSeriesTableRow> = MonitorSeriesTableUtil.getRows({
      summary: summary({
        rows: [row({ fingerprint: "a", metCriteriaIds: ["deleted"] })],
      }),
      translator: ENGLISH,
    });

    expect(rows[0]!.criteriaNames).toEqual(["Unnamed criteria"]);
  });

  test("a series with nothing to name it by is still listed, by its fingerprint", () => {
    const rows: Array<MonitorSeriesTableRow> = MonitorSeriesTableUtil.getRows({
      summary: summary({ rows: [row({ fingerprint: "abc123" })] }),
      translator: ENGLISH,
    });

    expect(rows[0]!.fingerprint).toBe("abc123");
    expect(rows[0]!.labels).toEqual([]);
  });

  test("a device's name, from what else is known of it, comes before its id", () => {
    const rows: Array<MonitorSeriesTableRow> = MonitorSeriesTableUtil.getRows({
      summary: summary({
        rows: [
          row({
            fingerprint: "install",
            labels: { "app.installation.id": "1b4e" },
            context: { "device.name": "Store 0412" },
            valueKind: MonitorEvaluationSeriesValueKind.Spans,
            value: 3,
          }),
        ],
      }),
      translator: ENGLISH,
    });

    expect(rows[0]!.labels[0]!.value).toBe("Store 0412");
  });
});

describe("MonitorSeriesTableUtil.getValueText", () => {
  test("a metric's value with its unit, written as its charts write it", () => {
    expect(
      MonitorSeriesTableUtil.getValueText({
        row: row({ fingerprint: "a", value: 89, unit: "%" }),
        translator: ENGLISH,
      }),
    ).toBe("89.00%");

    expect(
      MonitorSeriesTableUtil.getValueText({
        row: row({
          fingerprint: "a",
          value: 2147483648,
          unit: "By",
        }),
        translator: ENGLISH,
      }),
    ).toBe("2.15 GB");

    // A value with no dimension stays a bare number.
    expect(
      MonitorSeriesTableUtil.getValueText({
        row: row({ fingerprint: "a", value: 3.14159 }),
        translator: ENGLISH,
      }),
    ).toBe("3.14");
  });

  test("in the reader's digits and decimal sign", () => {
    expect(
      MonitorSeriesTableUtil.getValueText({
        row: row({ fingerprint: "a", value: 89, unit: "%" }),
        translator: GERMAN,
      }),
    ).toBe("89,00 %");

    expect(
      MonitorSeriesTableUtil.getValueText({
        row: row({ fingerprint: "a", value: 89.5, unit: "%" }),
        translator: PERSIAN,
      }),
    ).toBe("۸۹٫۵۰٪");
  });

  test("a Logs or Traces group's count, as a count", () => {
    expect(
      MonitorSeriesTableUtil.getValueText({
        row: row({
          fingerprint: "a",
          value: 12,
          valueKind: MonitorEvaluationSeriesValueKind.Logs,
        }),
        translator: ENGLISH,
      }),
    ).toBe("12 logs");

    expect(
      MonitorSeriesTableUtil.getValueText({
        row: row({
          fingerprint: "a",
          value: 1,
          valueKind: MonitorEvaluationSeriesValueKind.Spans,
        }),
        translator: ENGLISH,
      }),
    ).toBe("1 span");
  });

  test("no value, or one that is not a number, is none", () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        MonitorSeriesTableUtil.getValueText({
          row: row({ fingerprint: "a", value: value, unit: "%" }),
          translator: ENGLISH,
        }),
      ).toBeNull();
    }
  });
});

describe("MonitorSeriesTableUtil.getShareText", () => {
  test("says how many series the list shows of how many the check read", () => {
    expect(
      MonitorSeriesTableUtil.getShareText({
        series: {
          count: 2345,
          rows: Array.from({ length: 50 }, (_: unknown, index: number) => {
            return row({ fingerprint: `s${index}` });
          }),
        },
        translator: ENGLISH,
      }),
    ).toBe(
      "Showing 50 of 2,345 series: those that keep the status or meet a criteria come first.",
    );
  });

  test("says nothing when every series is listed", () => {
    expect(
      MonitorSeriesTableUtil.getShareText({
        series: { count: 2, rows: [row({ fingerprint: "a" }), row({ fingerprint: "b" })] },
        translator: ENGLISH,
      }),
    ).toBeNull();
  });
});
