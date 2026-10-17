/*
 * Which control each kind of step setting gets, and so whether it has the
 * value picker. The whole table, so a new input type has to be placed.
 */

import {
  ArgumentControl,
  argumentControlFor,
} from "../../../../../UI/Components/Workflow/ValuePicker/ArgumentControl";
import { ComponentInputType } from "../../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

const EXPECTED: Record<ComponentInputType, ArgumentControl> = {
  [ComponentInputType.Text]: ArgumentControl.Text,
  [ComponentInputType.URL]: ArgumentControl.Text,
  [ComponentInputType.Email]: ArgumentControl.Text,
  [ComponentInputType.LongText]: ArgumentControl.MultiLineText,
  [ComponentInputType.Markdown]: ArgumentControl.MultiLineText,
  [ComponentInputType.AnyValue]: ArgumentControl.MultiLineText,
  [ComponentInputType.Number]: ArgumentControl.Number,
  [ComponentInputType.Decimal]: ArgumentControl.Number,
  [ComponentInputType.Password]: ArgumentControl.Password,
  [ComponentInputType.Boolean]: ArgumentControl.Boolean,
  [ComponentInputType.Date]: ArgumentControl.Date,
  [ComponentInputType.DateTime]: ArgumentControl.DateTime,
  [ComponentInputType.HTML]: ArgumentControl.HTMLCode,
  [ComponentInputType.JSON]: ArgumentControl.JSONCode,
  [ComponentInputType.JSONArray]: ArgumentControl.JSONCode,
  [ComponentInputType.BaseModel]: ArgumentControl.JSONCode,
  [ComponentInputType.BaseModelArray]: ArgumentControl.JSONCode,
  [ComponentInputType.Query]: ArgumentControl.JSONCode,
  [ComponentInputType.Select]: ArgumentControl.JSONCode,
  [ComponentInputType.StringDictionary]: ArgumentControl.KeyValueRows,
  // Code reads values through its Arguments, not its source.
  [ComponentInputType.JavaScript]: ArgumentControl.Plain,
  // Choices from a fixed list.
  [ComponentInputType.Operator]: ArgumentControl.Plain,
  [ComponentInputType.ValueType]: ArgumentControl.Plain,
  [ComponentInputType.WorkflowSelect]: ArgumentControl.Plain,
  [ComponentInputType.IncidentTemplateSelect]: ArgumentControl.Plain,
  [ComponentInputType.AlertSeveritySelect]: ArgumentControl.Plain,
  [ComponentInputType.IncidentSeveritySelect]: ArgumentControl.Plain,
  [ComponentInputType.CronTab]: ArgumentControl.Plain,
  // A choice of a few answers, each with a line saying what it means.
  [ComponentInputType.Choice]: ArgumentControl.ChoiceRows,
  // Who a Page step pages: the people picker, with a chip per value.
  [ComponentInputType.UserList]: ArgumentControl.RecordList,
  [ComponentInputType.TeamList]: ArgumentControl.RecordList,
  [ComponentInputType.OnCallScheduleList]: ArgumentControl.RecordList,
  [ComponentInputType.OnCallPolicyList]: ArgumentControl.RecordList,
  // Edited in the step's own settings (Workflow/Switch), never as a field.
  [ComponentInputType.SwitchCases]: ArgumentControl.Plain,
};

describe("argumentControlFor", () => {
  test.each(Object.values(ComponentInputType))(
    "%s",
    (type: ComponentInputType) => {
      expect(
        argumentControlFor({ type: type, value: null, isRowsDictionary: true }),
      ).toBe(EXPECTED[type]);
    },
  );

  test("a dictionary the rows cannot show stays JSON", () => {
    expect(
      argumentControlFor({
        type: ComponentInputType.StringDictionary,
        value: "{{local.components.x.returnValues.headers}}",
        isRowsDictionary: false,
      }),
    ).toBe(ArgumentControl.JSONCode);
  });

  test("a choice holding a reference shows it, rather than a choice it is not", () => {
    expect(
      argumentControlFor({
        type: ComponentInputType.Operator,
        value: "{{local.variables.operator}}",
      }),
    ).toBe(ArgumentControl.Text);
  });

  test("a text value is text whatever it holds", () => {
    expect(
      argumentControlFor({
        type: ComponentInputType.URL,
        value: "{{global.variables.BASE}}/x",
      }),
    ).toBe(ArgumentControl.Text);
  });

  test("what a page is about is a row per answer, whichever answer is stored - or none, or one that is not an answer", () => {
    for (const value of [
      undefined,
      null,
      "",
      "new-alert",
      "incident",
      "alert",
      "postmortem",
      7,
    ]) {
      expect(
        argumentControlFor({ type: ComponentInputType.Choice, value: value }),
      ).toBe(ArgumentControl.ChoiceRows);
    }
  });

  test("held as a value from an earlier step, it is shown as that value: the rows have no answer for it", () => {
    expect(
      argumentControlFor({
        type: ComponentInputType.Choice,
        value: "{{local.variables.about}}",
      }),
    ).toBe(ArgumentControl.Text);
  });

  test("a severity is the list of the project's severities, and a value from a step is shown as that value", () => {
    expect(
      argumentControlFor({
        type: ComponentInputType.AlertSeveritySelect,
        value: "5e000000-0000-4000-8000-0000000000c1",
      }),
    ).toBe(ArgumentControl.Plain);
    expect(
      argumentControlFor({
        type: ComponentInputType.AlertSeveritySelect,
        value:
          "{{local.components.alert-on-create-1.returnValues.model.alertSeverityId}}",
      }),
    ).toBe(ArgumentControl.Text);
  });

  test.each([
    ComponentInputType.UserList,
    ComponentInputType.TeamList,
    ComponentInputType.OnCallScheduleList,
    ComponentInputType.OnCallPolicyList,
  ])(
    "%s is the list control whatever it holds: a value from a step is an entry of its own, not the whole setting",
    (type: ComponentInputType) => {
      const owners: string =
        "{{local.components.incident-on-create-1.returnValues.model.ownerUsers}}";

      for (const value of [
        undefined,
        null,
        "",
        [],
        ["10000000-0000-4000-8000-000000000001"],
        [owners],
        ["10000000-0000-4000-8000-000000000001", owners],
        // As a workflow written by hand may store it.
        owners,
        "jane@example.com",
      ]) {
        expect(argumentControlFor({ type: type, value: value })).toBe(
          ArgumentControl.RecordList,
        );
      }
    },
  );
});
