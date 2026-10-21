import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Project from "../../../Models/DatabaseModels/Project";
import Service from "../../../Models/DatabaseModels/Service";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import {
  EMPTY_TEXT_COLUMN_TYPES,
  isPlanGatedColumnDefault,
  isPlanGatedColumnOff,
} from "../../../Types/Billing/PlanGatedColumnDefault";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Recurring from "../../../Types/Events/Recurring";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../../Types/Timezone";
import { describe, expect, test } from "@jest/globals";

/*
 * The rule that lets a paid feature always be switched off, on any plan: a
 * plan-gated column's default - what a record holds when nobody set it -
 * needs no plan. These pin which values count as the default, against the
 * models' real column metadata and against made-up columns for the edges.
 */

const column: (
  data: Partial<TableColumnMetadata> & { type: TableColumnType },
) => TableColumnMetadata = (
  data: Partial<TableColumnMetadata> & { type: TableColumnType },
): TableColumnMetadata => {
  return { ...data } as TableColumnMetadata;
};

describe("a boolean column with a default (most plan-gated switches)", () => {
  const offByDefault: TableColumnMetadata =
    new StatusPage().getTableColumnMetadata("isReportEnabled");
  const onByDefault: TableColumnMetadata =
    new StatusPage().getTableColumnMetadata("showIncidentsOnStatusPage");

  test("the default is false for email reports, a public dashboard and requiring SSO", () => {
    for (const metadata of [
      offByDefault,
      new Dashboard().getTableColumnMetadata("isPublicDashboard"),
      new Project().getTableColumnMetadata("requireSsoForLogin"),
    ]) {
      expect(isPlanGatedColumnDefault(metadata, false)).toBe(true);
      expect(isPlanGatedColumnDefault(metadata, true)).toBe(false);
    }
  });

  test("a column on by default (showing incidents, a public status page) goes back to true", () => {
    for (const metadata of [
      onByDefault,
      new StatusPage().getTableColumnMetadata("isPublicStatusPage"),
    ]) {
      expect(isPlanGatedColumnDefault(metadata, true)).toBe(true);
      expect(isPlanGatedColumnDefault(metadata, false)).toBe(false);
    }
  });

  test("anything that is not the boolean itself is not the default: no plan's feature for an unclear value", () => {
    for (const value of [
      "false",
      "true",
      0,
      1,
      "",
      null,
      {},
      [],
      new Date(0),
    ]) {
      expect([value, isPlanGatedColumnDefault(offByDefault, value)]).toEqual([
        value,
        false,
      ]);
    }
  });

  test("a value that is not written (undefined) is never the default", () => {
    expect(isPlanGatedColumnDefault(offByDefault, undefined)).toBe(false);
    expect(isPlanGatedColumnDefault(onByDefault, undefined)).toBe(false);
  });
});

describe("a number or text column with a default", () => {
  test("the number it declares, and only that number, as a number", () => {
    const metadata: TableColumnMetadata =
      new StatusPage().getTableColumnMetadata("showEpisodeHistoryInDays");

    expect(metadata.defaultValue).toBe(14);
    expect(isPlanGatedColumnDefault(metadata, 14)).toBe(true);

    for (const value of [13, 15, 0, "14", null, ""]) {
      expect([value, isPlanGatedColumnDefault(metadata, value)]).toEqual([
        value,
        false,
      ]);
    }
  });

  test("an enum held as text: the value it declares (reports' Rolling period, UTC)", () => {
    const period: TableColumnMetadata = new StatusPage().getTableColumnMetadata(
      "reportPeriodType",
    );
    const timezone: TableColumnMetadata =
      new StatusPage().getTableColumnMetadata("reportTimezone");

    expect(
      isPlanGatedColumnDefault(period, StatusPageReportPeriodType.Rolling),
    ).toBe(true);
    expect(
      isPlanGatedColumnDefault(
        period,
        StatusPageReportPeriodType.PreviousCalendarPeriod,
      ),
    ).toBe(false);
    expect(isPlanGatedColumnDefault(timezone, Timezone.UTC)).toBe(true);
    expect(isPlanGatedColumnDefault(timezone, Timezone.EuropeLondon)).toBe(
      false,
    );
    // A column with a default is not cleared by an empty string or null.
    expect(isPlanGatedColumnDefault(timezone, "")).toBe(false);
    expect(isPlanGatedColumnDefault(timezone, null)).toBe(false);
  });
});

describe("a column with no default: nothing set is the default", () => {
  test("null clears custom code, an IP allowlist, a retention override and a report schedule", () => {
    const columns: Array<TableColumnMetadata> = [
      new StatusPage().getTableColumnMetadata("customJavaScript"),
      new StatusPage().getTableColumnMetadata("headerHTML"),
      new StatusPage().getTableColumnMetadata("customCSS"),
      new StatusPage().getTableColumnMetadata("ipWhitelist"),
      new StatusPage().getTableColumnMetadata("embeddedOverallStatusToken"),
      new StatusPage().getTableColumnMetadata("reportRecurringInterval"),
      new StatusPage().getTableColumnMetadata("reportStartDateTime"),
      new Dashboard().getTableColumnMetadata("ipWhitelist"),
      new Service().getTableColumnMetadata("retainTelemetryDataForDays"),
      new Service().getTableColumnMetadata("telemetryRetentionConfig"),
      new Project().getTableColumnMetadata("telemetryRetentionConfig"),
    ];

    for (const metadata of columns) {
      expect([
        metadata.title,
        isPlanGatedColumnDefault(metadata, null),
      ]).toEqual([metadata.title, true]);
    }
  });

  test("an empty string clears a text column - custom code, an IP allowlist, a token", () => {
    for (const name of [
      "customJavaScript",
      "headerHTML",
      "footerHTML",
      "customCSS",
      "ipWhitelist",
      "embeddedOverallStatusToken",
    ]) {
      expect([
        name,
        isPlanGatedColumnDefault(
          new StatusPage().getTableColumnMetadata(name),
          "",
        ),
      ]).toEqual([name, true]);
    }
  });

  test("an empty string is not a value of a number, date or JSON column", () => {
    for (const metadata of [
      new Service().getTableColumnMetadata("retainTelemetryDataForDays"),
      new Service().getTableColumnMetadata("telemetryRetentionConfig"),
      new StatusPage().getTableColumnMetadata("reportStartDateTime"),
      new StatusPage().getTableColumnMetadata("reportRecurringInterval"),
    ]) {
      expect([metadata.title, isPlanGatedColumnDefault(metadata, "")]).toEqual([
        metadata.title,
        false,
      ]);
    }
  });

  test("blank lines are not nothing: a list of blank lines is still a list", () => {
    const ipAllowlist: TableColumnMetadata =
      new StatusPage().getTableColumnMetadata("ipWhitelist");

    for (const value of [" ", "\n", "\n\n", "\t", " \n "]) {
      expect(isPlanGatedColumnDefault(ipAllowlist, value)).toBe(false);
    }
  });

  test("setting the feature is never the default: an allowlist, custom code, a retention, a schedule", () => {
    expect(
      isPlanGatedColumnDefault(
        new StatusPage().getTableColumnMetadata("ipWhitelist"),
        "10.0.0.0/8",
      ),
    ).toBe(false);
    expect(
      isPlanGatedColumnDefault(
        new StatusPage().getTableColumnMetadata("customJavaScript"),
        "console.log(1)",
      ),
    ).toBe(false);
    expect(
      isPlanGatedColumnDefault(
        new Service().getTableColumnMetadata("retainTelemetryDataForDays"),
        30,
      ),
    ).toBe(false);
    expect(
      isPlanGatedColumnDefault(
        new Service().getTableColumnMetadata("retainTelemetryDataForDays"),
        0,
      ),
    ).toBe(false);
    expect(
      isPlanGatedColumnDefault(
        new Service().getTableColumnMetadata("telemetryRetentionConfig"),
        {},
      ),
    ).toBe(false);
    expect(
      isPlanGatedColumnDefault(
        new StatusPage().getTableColumnMetadata("reportRecurringInterval"),
        new Recurring(),
      ),
    ).toBe(false);
  });
});

describe("a switch with no declared default (no plan-gated column has one today)", () => {
  const switchColumn: TableColumnMetadata = column({
    type: TableColumnType.Boolean,
  });

  test("is off when it holds nothing, so false and null are its default, as the dashboard's switches read it", () => {
    expect(isPlanGatedColumnDefault(switchColumn, false)).toBe(true);
    expect(isPlanGatedColumnDefault(switchColumn, null)).toBe(true);
  });

  test("true, or anything that is not a boolean, is not", () => {
    for (const value of [true, "false", 0, ""]) {
      expect([value, isPlanGatedColumnDefault(switchColumn, value)]).toEqual([
        value,
        false,
      ]);
    }
  });
});

describe("JSON defaults (no plan-gated column has one today)", () => {
  const jsonColumn: TableColumnMetadata = column({
    type: TableColumnType.JSON,
    defaultValue: { enabled: false, levels: ["error", "warning"] },
  });

  test("the same JSON, keys in any order, is the default", () => {
    expect(
      isPlanGatedColumnDefault(jsonColumn, {
        levels: ["error", "warning"],
        enabled: false,
      }),
    ).toBe(true);
  });

  test("any difference is not: a value, a missing or extra key, array order, a class instance", () => {
    for (const value of [
      { enabled: true, levels: ["error", "warning"] },
      { enabled: false },
      { enabled: false, levels: ["error", "warning"], extra: 1 },
      { enabled: false, levels: ["warning", "error"] },
      [false, ["error", "warning"]],
      new Date(0),
      null,
      "",
    ]) {
      expect([value, isPlanGatedColumnDefault(jsonColumn, value)]).toEqual([
        value,
        false,
      ]);
    }
  });
});

describe("no metadata", () => {
  test("a column the model does not have has no default", () => {
    expect(isPlanGatedColumnDefault(undefined, false)).toBe(false);
    expect(isPlanGatedColumnDefault(null, null)).toBe(false);
  });
});

describe("which column types an empty string clears", () => {
  test("only text a person types", () => {
    expect([...EMPTY_TEXT_COLUMN_TYPES].sort()).toEqual(
      [
        TableColumnType.ShortText,
        TableColumnType.LongText,
        TableColumnType.VeryLongText,
        TableColumnType.HTML,
        TableColumnType.CSS,
        TableColumnType.JavaScript,
        TableColumnType.Markdown,
        TableColumnType.Description,
      ].sort(),
    );

    for (const type of [
      TableColumnType.Number,
      TableColumnType.Date,
      TableColumnType.JSON,
      TableColumnType.Boolean,
      TableColumnType.ObjectID,
    ]) {
      expect(isPlanGatedColumnDefault(column({ type }), "")).toBe(false);
    }
  });
});

describe("isPlanGatedColumnOff: whether a value read back leaves the feature off", () => {
  test("nothing stored reads as the default, whatever the column", () => {
    for (const metadata of [
      new StatusPage().getTableColumnMetadata("isReportEnabled"),
      new StatusPage().getTableColumnMetadata("showIncidentsOnStatusPage"),
      new Service().getTableColumnMetadata("retainTelemetryDataForDays"),
      undefined,
    ]) {
      expect(isPlanGatedColumnOff(metadata, null)).toBe(true);
      expect(isPlanGatedColumnOff(metadata, undefined)).toBe(true);
    }
  });

  test("a stored value is off exactly when it is the default", () => {
    const retention: TableColumnMetadata = new Service().getTableColumnMetadata(
      "retainTelemetryDataForDays",
    );

    expect(isPlanGatedColumnOff(retention, 30)).toBe(false);
    expect(
      isPlanGatedColumnOff(
        new StatusPage().getTableColumnMetadata("isReportEnabled"),
        true,
      ),
    ).toBe(false);
    expect(
      isPlanGatedColumnOff(
        new StatusPage().getTableColumnMetadata("isReportEnabled"),
        false,
      ),
    ).toBe(true);
    expect(
      isPlanGatedColumnOff(
        new StatusPage().getTableColumnMetadata("ipWhitelist"),
        "",
      ),
    ).toBe(true);
  });
});
