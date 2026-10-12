import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import StatusPageHistoryChartBarColorRule from "../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import Color from "../../../Types/Color";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A status page bar color rule for an uptime of at least 0%.
 *
 * It is the bottom rule of a list - every day reaches it - and the
 * recommended rules a new status page starts with end with one. The
 * required-column check (DatabaseService.checkRequiredFields) read any falsy
 * value as missing, so a rule made with 0 was refused as
 * "uptimePercentGreaterThanOrEqualTo is required": from the dashboard's form,
 * which lets 0 through, as from the API. The rule's service now says 0 is a
 * value of that column. Every other required number is read as it was.
 */

type RequiredCheck = {
  checkRequiredFields: (data: unknown) => unknown;
  isRequiredColumnValueGiven: (column: string, value: unknown) => boolean;
};

function asRequiredCheck(service: unknown): RequiredCheck {
  return service as RequiredCheck;
}

function rule(data: {
  uptime?: unknown;
  color?: string | undefined;
}): StatusPageHistoryChartBarColorRule {
  const model: StatusPageHistoryChartBarColorRule =
    new StatusPageHistoryChartBarColorRule();
  model.projectId = ObjectID.generate();
  model.statusPageId = ObjectID.generate();
  (model as unknown as { uptimePercentGreaterThanOrEqualTo: unknown })[
    "uptimePercentGreaterThanOrEqualTo"
  ] = data.uptime;

  if (data.color) {
    model.barColor = new Color(data.color);
  }

  return model;
}

function check(model: StatusPageHistoryChartBarColorRule): void {
  asRequiredCheck(
    StatusPageHistoryChartBarColorRuleService,
  ).checkRequiredFields(model);
}

describe("a bar color rule for an uptime of at least 0%", () => {
  test("is not refused as missing its percentage", () => {
    expect(() => {
      check(rule({ uptime: 0, color: "#7f1d1d" }));
    }).not.toThrow();
  });

  test.each([100, 99.95, 50, 0.5])("nor is one for %p%", (uptime: number) => {
    expect(() => {
      check(rule({ uptime: uptime, color: "#22c55e" }));
    }).not.toThrow();
  });

  test.each([
    ["no percentage at all", undefined],
    ["a null one", null],
    ["one that is not a number", Number.NaN],
    ["an empty one", ""],
  ] as Array<[string, unknown]>)(
    "a rule with %s still is",
    (_what: string, uptime: unknown) => {
      const attempt: () => void = (): void => {
        check(rule({ uptime: uptime, color: "#22c55e" }));
      };

      expect(attempt).toThrow(BadDataException);
      expect(attempt).toThrow("uptimePercentGreaterThanOrEqualTo is required");
    },
  );

  test("the rule's other required columns are still required", () => {
    expect(() => {
      check(rule({ uptime: 0 }));
    }).toThrow("barColor is required");
  });
});

describe("every other required number is read as it was", () => {
  test("the default: any falsy value is missing, 0 included", () => {
    const base: RequiredCheck = asRequiredCheck(StatusPageService);

    expect(base.isRequiredColumnValueGiven("anything", 0)).toBe(false);
    expect(base.isRequiredColumnValueGiven("anything", Number.NaN)).toBe(false);
    expect(base.isRequiredColumnValueGiven("anything", "")).toBe(false);
    expect(base.isRequiredColumnValueGiven("anything", null)).toBe(false);
    expect(base.isRequiredColumnValueGiven("anything", undefined)).toBe(false);
    expect(base.isRequiredColumnValueGiven("anything", 5)).toBe(true);
    expect(base.isRequiredColumnValueGiven("anything", "text")).toBe(true);
  });

  test("the rule's service lets 0 through for its percentage alone", () => {
    const service: RequiredCheck = asRequiredCheck(
      StatusPageHistoryChartBarColorRuleService,
    );

    expect(
      service.isRequiredColumnValueGiven(
        "uptimePercentGreaterThanOrEqualTo",
        0,
      ),
    ).toBe(true);
    expect(service.isRequiredColumnValueGiven("order", 0)).toBe(false);
    expect(
      service.isRequiredColumnValueGiven(
        "uptimePercentGreaterThanOrEqualTo",
        Number.NaN,
      ),
    ).toBe(false);
    expect(
      service.isRequiredColumnValueGiven(
        "uptimePercentGreaterThanOrEqualTo",
        "",
      ),
    ).toBe(false);
  });

  // A reminder every 0 minutes is still refused, as the check always did.
  test("an incident reminder every 0 minutes is still refused", () => {
    const reminder: IncidentReminderRule = new IncidentReminderRule();
    reminder.projectId = ObjectID.generate();
    reminder.name = "Every minute";
    reminder.isEnabled = true;
    reminder.reminderIntervalInMinutes = 0;
    (reminder as unknown as { stopRemindersOnState: string })[
      "stopRemindersOnState"
    ] = "Acknowledged";

    expect(() => {
      asRequiredCheck(IncidentReminderRuleService).checkRequiredFields(
        reminder,
      );
    }).toThrow("reminderIntervalInMinutes is required");
  });
});
