import {
  cannotHoldBlank,
  clearBlankColumnValues,
  isBlankFormValue,
} from "../../../Types/Database/BlankColumnValue";
import { ColumnMetadataSource } from "../../../Types/Database/NumericColumnValue";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import IncidentSlaRule from "../../../Models/DatabaseModels/IncidentSlaRule";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN EMPTIED NUMBER, DATE OR PORT BOX IS SAVED AS.
 *
 * The maintainer's follow-ups: "An emptied optional number field is sent as
 * an empty string, which Postgres refuses (fixed only for SLA rules)." A
 * number box hands the form "" once it is emptied; ModelForm now sends what
 * the blank means (Types/Database/BlankColumnValue): none for a column that
 * may be empty, the column's default for one that may not, and nothing for
 * one that may not and has no default - the stored value stays.
 */

function metadataSource(
  columns: Record<string, Partial<TableColumnMetadata>>,
): ColumnMetadataSource {
  return {
    getTableColumnMetadata: (column: string): TableColumnMetadata => {
      return columns[column] as TableColumnMetadata;
    },
  };
}

describe("isBlankFormValue", () => {
  test.each(["", " ", "   ", "\t"])("%p is blank", (value: string) => {
    expect(isBlankFormValue(value)).toBe(true);
  });

  test.each([0, "0", "15", null, undefined, false, [], {}])(
    "%p is not",
    (value: unknown) => {
      expect(isBlankFormValue(value)).toBe(false);
    },
  );
});

describe("cannotHoldBlank", () => {
  test("number, date and port columns cannot hold an empty string", () => {
    for (const type of [
      TableColumnType.Number,
      TableColumnType.SmallNumber,
      TableColumnType.BigNumber,
      TableColumnType.PositiveNumber,
      TableColumnType.SmallPositiveNumber,
      TableColumnType.BigPositiveNumber,
      TableColumnType.Date,
      TableColumnType.Port,
    ]) {
      expect({ type, cannotHoldBlank: cannotHoldBlank(type) }).toEqual({
        type,
        cannotHoldBlank: true,
      });
    }
  });

  test("text columns can: an emptied text box is an empty text", () => {
    for (const type of [
      TableColumnType.ShortText,
      TableColumnType.LongText,
      TableColumnType.VeryLongText,
      TableColumnType.Name,
      TableColumnType.Description,
      TableColumnType.Markdown,
      TableColumnType.Email,
    ]) {
      expect({ type, cannotHoldBlank: cannotHoldBlank(type) }).toEqual({
        type,
        cannotHoldBlank: false,
      });
    }

    expect(cannotHoldBlank(undefined)).toBe(false);
    expect(cannotHoldBlank(null)).toBe(false);
  });
});

describe("clearBlankColumnValues", () => {
  const source: ColumnMetadataSource = metadataSource({
    retries: { type: TableColumnType.Number, required: false },
    samplePercentage: {
      type: TableColumnType.Number,
      required: true,
      defaultValue: 100,
    },
    priorityOrder: { type: TableColumnType.Number, required: true },
    endsAt: { type: TableColumnType.Date, required: false },
    smtpPort: { type: TableColumnType.Port, required: false },
    name: { type: TableColumnType.ShortText, required: true },
  });

  test("a column that may be empty: none", () => {
    const values: JSONObject = { retries: "", endsAt: "  ", smtpPort: "" };

    expect(clearBlankColumnValues(values, source)).toBe(values);
    expect(values).toEqual({ retries: null, endsAt: null, smtpPort: null });
  });

  test("a column that may not be empty: its default", () => {
    const values: JSONObject = { samplePercentage: "" };

    clearBlankColumnValues(values, source);

    expect(values).toEqual({ samplePercentage: 100 });
  });

  test("a column that may not be empty and has no default: not sent, so what is stored stays", () => {
    const values: JSONObject = { priorityOrder: "", name: "Checkout" };

    clearBlankColumnValues(values, source);

    expect(values).toEqual({ name: "Checkout" });
    expect("priorityOrder" in values).toBe(false);
  });

  test("everything else is left exactly as it is", () => {
    const values: JSONObject = {
      retries: "3",
      samplePercentage: 40,
      endsAt: "2026-10-26T10:00",
      name: "",
      notAColumn: "",
      priorityOrder: 0,
    };
    const before: JSONObject = { ...values };

    clearBlankColumnValues(values, source);

    expect(values).toEqual(before);
  });
});

describe("the models' own columns", () => {
  test("an SLA rule's emptied target is none, and its at-risk threshold goes back to 80", () => {
    const values: JSONObject = {
      responseTimeInMinutes: "",
      resolutionTimeInMinutes: " ",
      internalNoteReminderIntervalInMinutes: "",
      publicNoteReminderIntervalInMinutes: "",
      atRiskThresholdInPercentage: "",
      name: "Customer SLA",
    };

    clearBlankColumnValues(values, new IncidentSlaRule());

    expect(values).toEqual({
      responseTimeInMinutes: null,
      resolutionTimeInMinutes: null,
      internalNoteReminderIntervalInMinutes: null,
      publicNoteReminderIntervalInMinutes: null,
      atRiskThresholdInPercentage: 80,
      name: "Customer SLA",
    });
  });

  test("a replay policy's emptied numbers are what its boxes promised: 100%, no budget, no ceiling", () => {
    const values: JSONObject = {
      sessionReplaySamplePercentage: "",
      sessionReplayLcpBudgetMs: "",
      sessionReplayLongTaskBudgetMs: "",
      sessionReplaySlowRequestBudgetMs: "",
      sessionReplayMonthlyBudgetInGB: "",
    };

    clearBlankColumnValues(values, new RumApplication());

    expect(values).toEqual({
      sessionReplaySamplePercentage: 100,
      sessionReplayLcpBudgetMs: 0,
      sessionReplayLongTaskBudgetMs: 0,
      sessionReplaySlowRequestBudgetMs: 0,
      sessionReplayMonthlyBudgetInGB: null,
    });
  });

  /*
   * Every number, date and port column of every model: an emptied box is
   * never sent as "" - it is none, the column's default, or not sent.
   */
  test("no column of any model that cannot hold a blank is ever sent one", () => {
    let checked: number = 0;

    for (const ModelType of Models) {
      const model: BaseModel = new ModelType();
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of columns) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        if (!metadata || !cannotHoldBlank(metadata.type)) {
          continue;
        }

        const values: JSONObject = { [column]: "" };
        clearBlankColumnValues(values, model);
        checked++;

        const sent: unknown = values[column];
        const expected: unknown = !metadata.required
          ? null
          : metadata.defaultValue !== undefined &&
              metadata.defaultValue !== null
            ? metadata.defaultValue
            : undefined;

        expect({ column: `${model.tableName}.${column}`, sent }).toEqual({
          column: `${model.tableName}.${column}`,
          sent: expected,
        });
        expect(sent).not.toBe("");
      }
    }

    // The scan reached the models: there are hundreds of such columns.
    expect(checked).toBeGreaterThan(200);
  });
});
