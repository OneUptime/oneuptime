import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { describe, expect, test } from "@jest/globals";

/*
 * THE API REFERENCE SAYS WHICH PERSON IS WHICH.
 *
 * A user override's overrideUserId is the person whose pages are rerouted
 * - the one who is away - and routeAlertsToUserId the person who gets them
 * (OnCallDutyPolicyEscalationRuleService.getRouteAlertToUserId,
 * UserOverrideUtil). Both columns used to be described as "User who is being
 * overridden by this object", so the API reference and the Terraform docs
 * generated from these descriptions could not tell anyone which way an
 * override runs, and the policy column was described as an escalation
 * rule's. The paging logs had the same slip the other way: their
 * overridedByUser holds the person the alert was meant for, and was
 * described as the "User who overrode this alert".
 *
 * Descriptions only: titles, columns and the schema are unchanged.
 */

function describeColumn(model: BaseModel, column: string): string {
  const metadata: TableColumnMetadata = model.getTableColumnMetadata(column);

  expect(metadata).toBeDefined();

  return metadata.description || "";
}

describe("a user override's columns", () => {
  const override: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();

  test.each(["overrideUser", "overrideUserId"])(
    "%s is the person who is away, whose alerts go to the cover",
    (column: string) => {
      const description: string = describeColumn(override, column);

      expect(description).toContain("who is away");
      expect(description).toContain("alerts that would page this user go to");
      expect(description).not.toContain("being overridden");
    },
  );

  test.each(["routeAlertsToUser", "routeAlertsToUserId"])(
    "%s is the person who covers, who gets the alerts",
    (column: string) => {
      const description: string = describeColumn(override, column);

      expect(description).toContain("who covers");
      expect(description).toContain("this user gets the alerts");
      expect(description).not.toContain("being overridden");
    },
  );

  test.each(["routeAlertsToUser", "routeAlertsToUserId"])(
    "%s says what leaving it empty does: the person away is skipped in the rotation",
    (column: string) => {
      const description: string = describeColumn(override, column);

      expect(description).toContain("Leave it empty to skip");
      expect(description).toContain("next person in the rotation");
    },
  );

  test.each(["overrideUser", "overrideUserId"])(
    "%s says what happens to the person away with nobody named to cover",
    (column: string) => {
      expect(describeColumn(override, column)).toContain(
        "they are skipped: each of their turns in an on-call schedule goes to the next person in the rotation",
      );
    },
  );

  test.each(["onCallDutyPolicy", "onCallDutyPolicyId"])(
    "%s is the policy the override applies to, empty for every policy",
    (column: string) => {
      const description: string = describeColumn(override, column);

      expect(description).toContain("this override applies to");
      expect(description).toContain("global override");
      expect(description).not.toContain("escalation rule");
    },
  );

  test("its start and end say what they do to the alerts", () => {
    expect(describeColumn(override, "startsAt")).toContain(
      "sending the Override User's alerts to the Route Alerts To User",
    );
    expect(describeColumn(override, "endsAt")).toContain(
      "alerts page the Override User again",
    );
  });

  test("the table says what an override is for, and where it applies", () => {
    const description: string = override.tableDescription || "";

    expect(description).toContain("While someone is away");
    expect(description).toContain("to the person who covers");
    expect(description).toContain("With nobody named to cover, it skips them");
    expect(description).toContain("applies to every on-call policy");
  });

  /*
   * Who covers is optional since overrides can skip somebody instead
   * (task oncall-skip-user-until): the column is nullable and the API and
   * the Terraform provider no longer require it. Everything else is as it
   * was.
   */
  test("the columns and titles are as they were; who covers is optional", () => {
    for (const [column, title, required] of [
      ["overrideUserId", "Override User ID", true],
      ["routeAlertsToUserId", "Route Alerts To User ID", false],
      ["startsAt", "Start At", true],
      ["endsAt", "Ends At", true],
      ["onCallDutyPolicyId", "On-Call Policy ID", false],
    ] as Array<[string, string, boolean]>) {
      const metadata: TableColumnMetadata =
        override.getTableColumnMetadata(column);

      expect({ column, title: metadata.title }).toEqual({ column, title });
      expect({ column, required: Boolean(metadata.required) }).toEqual({
        column,
        required,
      });
    }
  });
});

describe("the paging logs' Overridden by User", () => {
  test.each([
    ["the policy execution log", new OnCallDutyPolicyExecutionLogTimeline()],
    ["a user's on-call log", new UserOnCallLog()],
  ] as Array<[string, BaseModel]>)(
    "in %s, is the person the alert was meant for",
    (_where: string, model: BaseModel) => {
      for (const column of ["overridedByUser", "overridedByUserId"]) {
        const description: string = describeColumn(model, column);

        expect(description).toContain("this alert would have paged");
        expect(description).toContain("because they were away");
        expect(description).not.toContain("who overrode");
      }
    },
  );
});
