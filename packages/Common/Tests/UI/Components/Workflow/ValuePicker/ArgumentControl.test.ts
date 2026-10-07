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
  [ComponentInputType.CronTab]: ArgumentControl.Plain,
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
});
