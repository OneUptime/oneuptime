import { describe, expect, test } from "@jest/globals";
import Models from "../../../Models/DatabaseModels/Index";
import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import {
  CliOperation,
  getCliFieldFlagsFor,
} from "../../../Utils/DeveloperDocs/CliCommands";

/*
 * THE CLI'S cloud-budget COMMAND TAKES WHAT A BUDGET IS NOW (#11008).
 *
 * The CLI and the MCP tools are made from the model's columns, so a budget's
 * scope, period, plan and the people it tells are flags of `oneuptime
 * cloud-budget create` and `update` as soon as the columns are - this holds
 * them to it, so a script can make every budget the Dashboard can.
 */

function flagsOf(
  operation: CliOperation.Create | CliOperation.Update,
): Array<string> {
  return getCliFieldFlagsFor(CloudBudget, operation).map(
    (entry: { flag: string }): string => {
      // "--plan-split" as the flag is typed.
      return entry.flag.replace(/^--/, "");
    },
  );
}

describe("the CLI's cloud-budget command", () => {
  test("is one of the models the CLI is made from", () => {
    expect(Models).toContain(CloudBudget);
  });

  test.each([CliOperation.Create, CliOperation.Update] as const)(
    "%s takes a budget's scope, period, plan and who hears",
    (operation: CliOperation.Create | CliOperation.Update) => {
      expect(flagsOf(operation)).toEqual(
        expect.arrayContaining([
          "name",
          "monthly-amount",
          "currency",
          "cost-basis",
          "scope",
          "cloud-account-id",
          "cloud-cost-group-id",
          "filter-rules",
          "period",
          "fiscal-year-start-month",
          "plan-split",
          "monthly-plan",
          "alert-thresholds",
          "alert-on-projection",
          "alert-on-anomaly",
          "unusual-day-threshold",
          "unusual-day-threshold-unit",
          "notify-cost-group-team",
        ]),
      );
    },
  );

  test("never takes what the server works out", () => {
    for (const flag of flagsOf(CliOperation.Create)) {
      expect([
        "spent-this-month",
        "projected-this-month",
        "spent-this-period",
        "projected-this-period",
        "last-checked-at",
        "alert-state",
      ]).not.toContain(flag);
    }
  });
});
