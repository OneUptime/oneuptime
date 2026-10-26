import { describe, expect, test } from "@jest/globals";
import ReminderStopState from "../../../Types/Reminder/ReminderStopState";
import ScheduledMaintenanceReminderStopState from "../../../Types/Reminder/ScheduledMaintenanceReminderStopState";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import type Field from "../../../UI/Components/Forms/Types/Field";
import {
  DEFAULT_REMINDER_INTERVAL_IN_MINUTES,
  DEFAULT_SLA_RESOLUTION_TIME_IN_MINUTES,
  DEFAULT_SLA_RESPONSE_TIME_IN_MINUTES,
  ON_CALL_RULE_NAME_WORDING,
  ON_CALL_RULE_POLICIES_DESCRIPTION,
  PRIVACY_RULE_NAMES,
  REMINDER_STOP_STATE_TITLES,
  followValueWithRuleName,
  getMaintenanceReminderRuleName,
  getNewMaintenanceReminderRuleName,
  getNewSlaRuleValues,
  getOnCallRuleActionFields,
  getOnCallRuleFormSteps,
  getOnCallRuleName,
  getPrivacyRuleActionFields,
  getPrivacyRuleFormSteps,
  getReminderRuleActionFields,
  getReminderRuleFormSteps,
  getReminderRuleName,
  getRunbookRuleActionFields,
  getRunbookRuleFormSteps,
  getRunbookRuleName,
  RUNBOOK_RULE_NAME_DESCRIPTION,
  RUNBOOK_RULE_NAME_WORDING,
  RUNBOOK_RULE_RUNBOOKS_DESCRIPTION,
  getSlaRuleFormSteps,
  getSlaRuleName,
  readMinutes,
  readStopState,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/EventRuleForm";
import { OnCallRuleRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";
import {
  FILLED_IN_RULE_NAME_KEY,
  RULE_NAME_MAX_LENGTH,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/ResourceRuleForm";
import {
  DEFAULT_MAINTENANCE_REMINDER_TIMING,
  MAINTENANCE_REMINDER_TIMINGS,
  MAINTENANCE_REMINDER_TIMING_COLUMNS,
  MaintenanceReminderTiming,
  getMaintenanceReminderTiming,
  isMaintenanceReminderTiming,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/MaintenanceReminderTiming";
import { getValuesForMaintenanceReminderTiming } from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/MaintenanceReminderRuleFields";

/*
 * The rules of the on-call, privacy, SLA and reminder rule forms, read
 * without drawing them (EventRuleFormsRender draws them): the steps every
 * one walks, the names they fill in, and how a maintenance reminder rule's
 * one choice maps onto its two stored columns and back.
 */

type Values = Record<string, unknown>;

// Runs a field's onChange the way FormField does, and returns what it set.
function change(
  onChange: Field<Values>["onChange"],
  value: unknown,
  values: Values,
): Values | null {
  let set: Values | null = null;

  onChange?.(value, values as never, (next: unknown): void => {
    set = next as Values;
  });

  return set;
}

describe("every rule starts with what it matches", () => {
  test.each([
    ["an on-call", "On-Call Policies", "on-call", getOnCallRuleFormSteps],
    ["a privacy", "Name", "rule-name", getPrivacyRuleFormSteps],
    ["an SLA", "Targets", "sla-targets", getSlaRuleFormSteps],
    ["a reminder", "Reminders", "reminder-settings", getReminderRuleFormSteps],
    ["a runbook", "Runbooks", "runbooks", getRunbookRuleFormSteps],
  ] as Array<
    [string, string, string, () => Array<{ title: string; id: string }>]
  >)(
    "%s rule walks Match, then %s",
    (
      _kind: string,
      title: string,
      id: string,
      getSteps: () => Array<{ title: string; id: string }>,
    ) => {
      expect(getSteps()).toEqual([
        { title: "Match", id: "match-criteria" },
        { title: title, id: id },
      ]);
    },
  );

  test.each([
    ["an on-call", getOnCallRuleActionFields<Values>(OnCallRuleRecord.Alert)],
    ["a privacy", getPrivacyRuleActionFields<Values>("incident")],
    ["a reminder", getReminderRuleActionFields<Values>("incident")],
    ["a runbook", getRunbookRuleActionFields<Values>()],
  ] as Array<[string, Array<Field<Values>>]>)(
    "%s rule asks nothing on its Match step, and its name and description after what it does",
    (_kind: string, fields: Array<Field<Values>>) => {
      const stepIds: Set<string | undefined> = new Set(
        fields.map((field: Field<Values>): string | undefined => {
          return field.stepId;
        }),
      );

      // One step - the rule's own - holds every field the helper gives.
      expect(stepIds.size).toBe(1);
      expect(stepIds.has("match-criteria")).toBe(false);

      const keys: Array<string> = fields.map((field: Field<Values>): string => {
        return Object.keys(field.field || {})[0] || "";
      });

      const nameAt: number = keys.indexOf("name");

      expect(keys.slice(nameAt, nameAt + 3)).toEqual([
        "name",
        "isEnabled",
        "description",
      ]);

      const enabled: Field<Values> = fields[keys.indexOf("isEnabled")]!;
      // A rule starts on: Enabled is on the Edit form only.
      expect(enabled.doNotShowWhenCreating).toBe(true);

      const description: Field<Values> = fields[keys.indexOf("description")]!;
      // Folded under More fields.
      expect(description.collapsibleSection).toBeDefined();
      expect(description.required).toBe(false);

      // Whatever follows the description is folded with it: one More fields.
      for (const field of fields.slice(nameAt + 3)) {
        expect(field.collapsibleSection).toBe(description.collapsibleSection);
      }

      const name: Field<Values> = fields[keys.indexOf("name")]!;
      expect(name.required).toBe(true);
      expect(name.validation?.maxLength).toBe(RULE_NAME_MAX_LENGTH);
    },
  );
});

describe("an on-call rule's name", () => {
  test("is the policies it pages", () => {
    expect(getOnCallRuleName(["Platform on-call"])).toBe(
      "Page Platform on-call",
    );
    expect(getOnCallRuleName(["Platform on-call", "Database on-call"])).toBe(
      "Page Platform on-call, Database on-call",
    );
    expect(getOnCallRuleName([])).toBe("");
    expect(ON_CALL_RULE_NAME_WORDING.picksSlot).toBe("policies");
  });

  test("counts what does not fit, and always fits the Name column", () => {
    const many: Array<string> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): string => {
        return `Team ${index + 1} primary on-call rotation`;
      },
    );
    const name: string = getOnCallRuleName(many);

    expect(name.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(name).toMatch(/^Page Team 1 primary on-call rotation/);
    expect(name).toMatch(/and \d+ more$/);
  });

  test("the policies picker is required and names the rule as it changes", () => {
    const policies: Field<Values> = getOnCallRuleActionFields<Values>(
      OnCallRuleRecord.Alert,
    )[0]!;

    expect(Object.keys(policies.field || {})).toEqual(["onCallDutyPolicies"]);
    expect(policies.required).toBe(true);
    expect(policies.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(policies.onChange).toBeDefined();
  });

  test("the policies picker says what it is for in one sentence", () => {
    const policies: Field<Values> = getOnCallRuleActionFields<Values>(
      OnCallRuleRecord.Alert,
    )[0]!;

    expect(policies.description).toBe(ON_CALL_RULE_POLICIES_DESCRIPTION);
    expect(ON_CALL_RULE_POLICIES_DESCRIPTION).toBe(
      "The on-call policies to page when this rule matches.",
    );
    // That a policy two rules pick runs once is for the help and the docs.
    expect(ON_CALL_RULE_POLICIES_DESCRIPTION).not.toContain("runs once");
  });
});

describe("a runbook rule's name", () => {
  test("is the runbooks it starts", () => {
    expect(getRunbookRuleName(["Database failover"])).toBe(
      "Start Database failover",
    );
    expect(getRunbookRuleName(["Database failover", "Flush cache"])).toBe(
      "Start Database failover, Flush cache",
    );
    // A runbook picked twice is named once; blank names are not named.
    expect(
      getRunbookRuleName(["Database failover", " ", "Database failover"]),
    ).toBe("Start Database failover");
    expect(getRunbookRuleName([])).toBe("");
    expect(RUNBOOK_RULE_NAME_WORDING.picksSlot).toBe("runbooks");
    expect(RUNBOOK_RULE_NAME_WORDING.allPicks).toBe("Start {{runbooks}}");
  });

  test("counts what does not fit, and always fits the Name column", () => {
    const many: Array<string> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): string => {
        return `Restart the checkout service in region ${index + 1}`;
      },
    );
    const name: string = getRunbookRuleName(many);

    expect(name.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(name).toMatch(/^Start Restart the checkout service in region 1/);
    expect(name).toMatch(/and \d+ more$/);

    // One runbook too long to fit on its own is shortened, with an ellipsis.
    const long: string = getRunbookRuleName(["x".repeat(500)]);
    expect(long.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(long.startsWith("Start x")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });

  test("the runbooks picker is required, lists runbooks and says what it is for in one sentence", () => {
    const runbooks: Field<Values> = getRunbookRuleActionFields<Values>()[0]!;

    expect(Object.keys(runbooks.field || {})).toEqual(["runbooks"]);
    expect(runbooks.title).toBe("Runbooks to Start");
    expect(runbooks.required).toBe(true);
    expect(runbooks.stepId).toBe("runbooks");
    expect(runbooks.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(runbooks.dropdownModal?.type).toBe(Runbook);
    expect(runbooks.dropdownModal?.labelField).toBe("name");
    expect(runbooks.description).toBe(RUNBOOK_RULE_RUNBOOKS_DESCRIPTION);
    expect(RUNBOOK_RULE_RUNBOOKS_DESCRIPTION).toBe(
      "The runbooks to start when this rule matches.",
    );
  });

  test("the name says it follows the runbooks, with an example of one", () => {
    const name: Field<Values> = getRunbookRuleActionFields<Values>().find(
      (field: Field<Values>): boolean => {
        return Object.keys(field.field || {})[0] === "name";
      },
    )!;

    expect(name.description).toBe(RUNBOOK_RULE_NAME_DESCRIPTION);
    expect(name.placeholder).toBe("e.g. Start Database failover");
    expect(name.validation?.minLength).toBe(2);
  });

  test("picking runbooks names the rule after them, until a name is typed", () => {
    const onChange: Field<Values>["onChange"] =
      getRunbookRuleActionFields<Values>()[0]!.onChange;

    const pick: (
      values: Values,
      picked: Array<string>,
      before: Array<string>,
    ) => Values | null = (
      values: Values,
      picked: Array<string>,
      before: Array<string>,
    ): Values | null => {
      let set: Values | null = null;

      onChange?.(
        picked,
        values as never,
        (next: unknown): void => {
          set = next as Values;
        },
        {
          selectedOptions: picked.map((label: string) => {
            return { label: label, value: label };
          }),
          previousOptions: before.map((label: string) => {
            return { label: label, value: label };
          }),
        },
      );

      return set;
    };

    // An empty name takes the runbook's.
    expect(pick({}, ["Database failover"], [])).toEqual({
      name: "Start Database failover",
      [FILLED_IN_RULE_NAME_KEY]: "Start Database failover",
    });

    // The name it filled in follows the next pick.
    expect(
      pick(
        {
          name: "Start Database failover",
          [FILLED_IN_RULE_NAME_KEY]: "Start Database failover",
        },
        ["Database failover", "Flush cache"],
        ["Database failover"],
      ),
    ).toEqual({
      name: "Start Database failover, Flush cache",
      [FILLED_IN_RULE_NAME_KEY]: "Start Database failover, Flush cache",
    });

    // A name somebody typed stays.
    expect(
      pick({ name: "Fail over the primary" }, ["Database failover"], []),
    ).toBeNull();

    // Taking every runbook away empties the name the form filled in.
    expect(
      pick(
        {
          name: "Start Database failover",
          [FILLED_IN_RULE_NAME_KEY]: "Start Database failover",
        },
        [],
        ["Database failover"],
      ),
    ).toEqual({ name: "", [FILLED_IN_RULE_NAME_KEY]: "" });
  });
});

describe("a privacy rule's name", () => {
  test("starts as what the rule does, for each kind of record", () => {
    expect(PRIVACY_RULE_NAMES).toEqual({
      incident: "Make incidents private",
      incidentEpisode: "Make incident episodes private",
      alert: "Make alerts private",
      alertEpisode: "Make alert episodes private",
    });

    for (const record of [
      "incident",
      "incidentEpisode",
      "alert",
      "alertEpisode",
    ] as const) {
      const name: Field<Values> =
        getPrivacyRuleActionFields<Values>(record)[0]!;

      expect(name.defaultValue).toBe(PRIVACY_RULE_NAMES[record]);
      // It says what the rule does, where the name is asked for.
      expect(String(name.description)).toMatch(
        /become private: only their owners, project admins and project owners can see them\.$/,
      );
    }
  });
});

describe("readMinutes", () => {
  test.each([
    [30, 30],
    ["45", 45],
    [" 15 ", 15],
    ["", null],
    [0, null],
    ["0", null],
    ["-5", null],
    ["1.5", null],
    ["abc", null],
    [undefined, null],
    [null, null],
  ] as Array<[unknown, number | null]>)(
    "reads %p as %p",
    (value: unknown, minutes: number | null) => {
      expect(readMinutes(value)).toBe(minutes);
    },
  );
});

describe("an SLA rule's name", () => {
  test.each([
    [15, 60, "Respond in 15 minutes, resolve in 1 hour"],
    [30, 240, "Respond in 30 minutes, resolve in 4 hours"],
    [15, undefined, "Respond in 15 minutes"],
    [undefined, 1440, "Resolve in 1 day"],
    [1, 2880, "Respond in 1 minute, resolve in 2 days"],
    [undefined, undefined, ""],
    ["", "", ""],
  ] as Array<[unknown, unknown, string]>)(
    "response %p and resolution %p make %p",
    (response: unknown, resolution: unknown, name: string) => {
      expect(
        getSlaRuleName({
          responseTimeInMinutes: response,
          resolutionTimeInMinutes: resolution,
        }),
      ).toBe(name);
    },
  );
});

describe("a new SLA rule", () => {
  test("starts with targets - respond in 15 minutes, resolve in 4 hours - named after them", () => {
    expect(DEFAULT_SLA_RESPONSE_TIME_IN_MINUTES).toBe(15);
    expect(DEFAULT_SLA_RESOLUTION_TIME_IN_MINUTES).toBe(240);
    expect(getNewSlaRuleValues<Values>()).toEqual({
      responseTimeInMinutes: 15,
      resolutionTimeInMinutes: 240,
      name: "Respond in 15 minutes, resolve in 4 hours",
    });
  });

  test("its name is the one its targets make, so it follows them from the start", () => {
    const start: Values = getNewSlaRuleValues<Values>() as Values;

    expect(start["name"]).toBe(getSlaRuleName(start));

    const resolution: Field<Values> = {
      onChange: followValueWithRuleName<Values>({
        column: "resolutionTimeInMinutes",
        makeName: getSlaRuleName,
      }),
    } as Field<Values>;

    expect(change(resolution.onChange, "60", start)?.["name"]).toBe(
      "Respond in 15 minutes, resolve in 1 hour",
    );
    expect(change(resolution.onChange, "", start)?.["name"]).toBe(
      "Respond in 15 minutes",
    );
  });
});

describe("a reminder rule's stop, as a word", () => {
  test("the form's answers and the list read the same word for each stop", () => {
    expect(REMINDER_STOP_STATE_TITLES).toEqual({
      [ReminderStopState.Resolved]: "Resolved",
      [ReminderStopState.Acknowledged]: "Acknowledged",
    });

    for (const record of ["incident", "alert"] as const) {
      const stop: Field<Values> =
        getReminderRuleActionFields<Values>(record)[1]!;

      expect(
        (stop.radioButtonOptions || []).map(
          (option: { title: string }): string => {
            return option.title;
          },
        ),
      ).toEqual(["Resolved", "Acknowledged"]);
    }
  });

  test("anything but Acknowledged stops at Resolved, as the workers read it", () => {
    expect(readStopState(ReminderStopState.Acknowledged)).toBe(
      ReminderStopState.Acknowledged,
    );
    expect(readStopState(ReminderStopState.Resolved)).toBe(
      ReminderStopState.Resolved,
    );
    for (const other of [undefined, null, "", "Ongoing", 0]) {
      expect(readStopState(other)).toBe(ReminderStopState.Resolved);
    }
  });
});

describe("an incident's or an alert's reminder rule", () => {
  test("is named after how often and until when it reminds", () => {
    expect(
      getReminderRuleName({
        reminderIntervalInMinutes: 30,
        stopRemindersOnState: ReminderStopState.Resolved,
      }),
    ).toBe("Remind every 30 minutes until resolved");
    expect(
      getReminderRuleName({
        reminderIntervalInMinutes: 60,
        stopRemindersOnState: ReminderStopState.Acknowledged,
      }),
    ).toBe("Remind every 1 hour until acknowledged");
    // A stop the form has not read yet is the column's default, Resolved.
    expect(getReminderRuleName({ reminderIntervalInMinutes: 120 })).toBe(
      "Remind every 2 hours until resolved",
    );
    expect(getReminderRuleName({ reminderIntervalInMinutes: "" })).toBe("");
  });

  test("starts every 30 minutes until resolved, named that way", () => {
    const fields: Array<Field<Values>> =
      getReminderRuleActionFields<Values>("alert");
    const interval: Field<Values> = fields[0]!;
    const stop: Field<Values> = fields[1]!;
    const name: Field<Values> = fields[2]!;

    expect(DEFAULT_REMINDER_INTERVAL_IN_MINUTES).toBe(30);
    expect(interval.defaultValue).toBe(30);
    expect(name.defaultValue).toBe("Remind every 30 minutes until resolved");

    // Two plain answers, Resolved first, each saying what it means.
    expect(stop.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(stop.hideColumnDescription).toBe(true);
    expect(stop.radioButtonOptions).toEqual([
      {
        title: "Resolved",
        description: "Keep reminding until the alert is resolved.",
        value: ReminderStopState.Resolved,
      },
      {
        title: "Acknowledged",
        description: "Stop once someone acknowledges the alert.",
        value: ReminderStopState.Acknowledged,
      },
    ]);
  });
});

describe("a name that follows a value", () => {
  const follow: Field<Values>["onChange"] = followValueWithRuleName<Values>({
    column: "reminderIntervalInMinutes",
    makeName: getReminderRuleName,
  });

  test("follows while the name is the one the old value made", () => {
    expect(
      change(follow, "15", {
        reminderIntervalInMinutes: 30,
        name: "Remind every 30 minutes until resolved",
      }),
    ).toEqual({
      reminderIntervalInMinutes: 30,
      name: "Remind every 15 minutes until resolved",
      [FILLED_IN_RULE_NAME_KEY]: "Remind every 15 minutes until resolved",
    });
  });

  test("fills an empty name in", () => {
    expect(
      change(follow, 45, { reminderIntervalInMinutes: "", name: "" })?.["name"],
    ).toBe("Remind every 45 minutes until resolved");
  });

  test("leaves a name somebody typed alone", () => {
    expect(
      change(follow, "15", {
        reminderIntervalInMinutes: 30,
        name: "Nag the team",
      }),
    ).toBeNull();
  });

  test("empties the name it made once the value makes none", () => {
    expect(
      change(follow, "", {
        reminderIntervalInMinutes: 30,
        name: "Remind every 30 minutes until resolved",
      })?.["name"],
    ).toBe("");
  });
});

describe("a maintenance reminder rule's one choice", () => {
  test("offers three answers, in progress first, as a new rule starts", () => {
    expect(MAINTENANCE_REMINDER_TIMINGS).toEqual([
      MaintenanceReminderTiming.WhileInProgress,
      MaintenanceReminderTiming.BeforeItStarts,
      MaintenanceReminderTiming.BeforeAndDuring,
    ]);
    expect(DEFAULT_MAINTENANCE_REMINDER_TIMING).toBe(
      MaintenanceReminderTiming.WhileInProgress,
    );
  });

  test("each answer stores the two columns it means", () => {
    expect(MAINTENANCE_REMINDER_TIMING_COLUMNS).toEqual({
      [MaintenanceReminderTiming.WhileInProgress]: {
        remindWhileScheduled: false,
        stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
      },
      [MaintenanceReminderTiming.BeforeItStarts]: {
        remindWhileScheduled: true,
        stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
      },
      [MaintenanceReminderTiming.BeforeAndDuring]: {
        remindWhileScheduled: true,
        stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
      },
    });
  });

  test("reads every stored pair back as its answer, and the pair that never reminds as none", () => {
    for (const timing of MAINTENANCE_REMINDER_TIMINGS) {
      expect(
        getMaintenanceReminderTiming(
          MAINTENANCE_REMINDER_TIMING_COLUMNS[timing],
        ),
      ).toBe(timing);
    }

    expect(
      getMaintenanceReminderTiming({
        remindWhileScheduled: false,
        stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
      }),
    ).toBeNull();

    // A new rule's columns, not read yet: what the defaults always did.
    expect(getMaintenanceReminderTiming({})).toBe(
      MaintenanceReminderTiming.WhileInProgress,
    );
    expect(getMaintenanceReminderTiming({ remindWhileScheduled: true })).toBe(
      MaintenanceReminderTiming.BeforeAndDuring,
    );
  });

  test("knows its own answers", () => {
    expect(isMaintenanceReminderTiming("before-it-starts")).toBe(true);
    expect(isMaintenanceReminderTiming("Ongoing")).toBe(false);
    expect(isMaintenanceReminderTiming(undefined)).toBe(false);
  });

  test("names the rule after how often and when it reminds", () => {
    expect(getNewMaintenanceReminderRuleName()).toBe(
      "Remind every 30 minutes while it is in progress",
    );
    expect(
      getMaintenanceReminderRuleName({
        reminderIntervalInMinutes: 60,
        ...MAINTENANCE_REMINDER_TIMING_COLUMNS[
          MaintenanceReminderTiming.BeforeItStarts
        ],
      }),
    ).toBe("Remind every 1 hour before it starts");
    expect(
      getMaintenanceReminderRuleName({
        reminderIntervalInMinutes: 1440,
        ...MAINTENANCE_REMINDER_TIMING_COLUMNS[
          MaintenanceReminderTiming.BeforeAndDuring
        ],
      }),
    ).toBe("Remind every 1 day before and during the event");
    // The pair that never reminds names nothing.
    expect(
      getMaintenanceReminderRuleName({
        reminderIntervalInMinutes: 30,
        remindWhileScheduled: false,
        stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
      }),
    ).toBe("");
  });

  test("picking an answer writes its columns and follows the form's own name", () => {
    expect(
      getValuesForMaintenanceReminderTiming({
        values: {
          reminderIntervalInMinutes: 30,
          remindWhileScheduled: false,
          stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
          name: "Remind every 30 minutes while it is in progress",
        },
        timing: MaintenanceReminderTiming.BeforeItStarts,
      }),
    ).toEqual({
      reminderIntervalInMinutes: 30,
      remindWhileScheduled: true,
      stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
      name: "Remind every 30 minutes before it starts",
      [FILLED_IN_RULE_NAME_KEY]: "Remind every 30 minutes before it starts",
    });
  });

  test("picking an answer keeps a name somebody typed", () => {
    expect(
      getValuesForMaintenanceReminderTiming({
        values: {
          reminderIntervalInMinutes: 30,
          remindWhileScheduled: false,
          stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
          name: "Ops reminders",
        },
        timing: MaintenanceReminderTiming.BeforeAndDuring,
      }),
    ).toEqual({
      reminderIntervalInMinutes: 30,
      remindWhileScheduled: true,
      stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
      name: "Ops reminders",
    });
  });

  test("a rule that never reminded gets the answer's name once one is picked", () => {
    expect(
      getValuesForMaintenanceReminderTiming({
        values: {
          reminderIntervalInMinutes: 30,
          remindWhileScheduled: false,
          stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
          name: "",
        },
        timing: MaintenanceReminderTiming.WhileInProgress,
      })["name"],
    ).toBe("Remind every 30 minutes while it is in progress");
  });
});
