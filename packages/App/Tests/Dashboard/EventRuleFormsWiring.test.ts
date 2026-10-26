import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The on-call, privacy, SLA, reminder and runbook rule forms of Incidents,
 * Alerts and Scheduled Maintenance start with the rule: what it matches, then
 * what it does, its name filled in from that (Dashboard Utils/Form/
 * EventRuleForm).
 * They used to open on "Basic Info" ("Rule Info" on a reminder rule) - a
 * name and a description before anyone had said what the rule was for -
 * unlike the label, owner and grouping rules on the same menus.
 *
 * App has no renderer, so the pages are read as text and the wiring is
 * pinned: each page takes the shared steps and action fields, none keeps a
 * Basic Info step, the help panels speak plainly, and the maintenance
 * reminder rule's one choice still describes what the reminder worker does
 * with the two columns it writes. Common's EventRuleFormsRender draws every
 * one of these forms; EventRuleForm.test.ts holds their rules.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Runs of whitespace, so a source reads the same however prettier wraps it.
const WHITESPACE: RegExp = /\s+/g;

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

interface RulePageCase {
  file: string;
  steps: string;
  // How many of its forms (a page with an episode tab has two).
  forms: number;
  actionFields: string;
}

const RULE_PAGES: Array<RulePageCase> = [
  {
    file: "Pages/Incidents/Settings/IncidentOnCallRules.tsx",
    steps: "getOnCallRuleFormSteps<",
    forms: 2,
    actionFields: "...getOnCallRuleActionFields<",
  },
  {
    file: "Pages/Alerts/Settings/AlertOnCallRules.tsx",
    steps: "getOnCallRuleFormSteps<",
    forms: 2,
    actionFields: "...getOnCallRuleActionFields<",
  },
  {
    file: "Pages/Incidents/Settings/IncidentPrivacyRules.tsx",
    steps: "getPrivacyRuleFormSteps<",
    forms: 2,
    actionFields: "...getPrivacyRuleActionFields<",
  },
  {
    file: "Pages/Alerts/Settings/AlertPrivacyRules.tsx",
    steps: "getPrivacyRuleFormSteps<",
    forms: 2,
    actionFields: "...getPrivacyRuleActionFields<",
  },
  {
    file: "Pages/Incidents/Settings/IncidentSlaRules.tsx",
    steps: "getSlaRuleFormSteps<",
    forms: 1,
    actionFields: "makeName: getSlaRuleName",
  },
  {
    file: "Pages/Incidents/Settings/IncidentReminderRules.tsx",
    steps: "getReminderRuleFormSteps<",
    forms: 1,
    actionFields:
      '...getReminderRuleActionFields<IncidentReminderRule>("incident")',
  },
  {
    file: "Pages/Alerts/Settings/AlertReminderRules.tsx",
    steps: "getReminderRuleFormSteps<",
    forms: 1,
    actionFields: '...getReminderRuleActionFields<AlertReminderRule>("alert")',
  },
  {
    file: "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceReminderRules.tsx",
    steps: "getReminderRuleFormSteps<",
    forms: 1,
    actionFields: "...getMaintenanceReminderRuleActionFields()",
  },
  /*
   * The runbook rules of Incidents, Alerts and Scheduled Maintenance: one
   * table, drawn on each product's Rules menu for its own trigger.
   */
  {
    file: "Components/Runbook/RunbookRulesTable.tsx",
    steps: "getRunbookRuleFormSteps<",
    forms: 1,
    actionFields: "...getRunbookRuleActionFields<RunbookRule>()",
  },
];

describe("the rule forms start with the rule", () => {
  test.each(RULE_PAGES)(
    "$file takes the shared steps and what its rule does",
    (page: RulePageCase) => {
      const source: string = read(page.file);

      expect(countOf(source, `formSteps={${page.steps}`)).toBe(page.forms);
      expect(source).toContain(page.actionFields);
      // The steps come from the shared module, never written on the page.
      expect(source).not.toMatch(/formSteps=\{\s*\[/);
    },
  );

  test.each(RULE_PAGES)(
    "$file asks for no name first",
    (page: RulePageCase) => {
      const source: string = read(page.file);

      for (const retired of [
        '"Basic Info"',
        '"Rule Info"',
        '"basic-info"',
        '"rule-info"',
      ]) {
        expect({
          file: page.file,
          retired,
          found: source.includes(retired),
        }).toEqual({ file: page.file, retired, found: false });
      }
    },
  );

  test("the shared steps are written out, so the form guards can place every field", () => {
    const source: string = read("Utils/Form/EventRuleForm.ts");

    for (const step of [
      '{ title: "Match", id: "match-criteria" }',
      '{ title: "On-Call Policies", id: "on-call" }',
      '{ title: "Name", id: "rule-name" }',
      '{ title: "Targets", id: "sla-targets" }',
      '{ title: "Reminders", id: "reminder-settings" }',
      '{ title: "Runbooks", id: "runbooks" }',
    ]) {
      expect(source).toContain(step);
    }

    // Every field a helper hands a page names its step as a string literal.
    expect(source).not.toMatch(/stepId:\s*[A-Z_]{3,}/);
  });

  test("no Incidents, Alerts or Scheduled Maintenance rule page opens on Basic Info", () => {
    const folders: Array<string> = [
      "Pages/Incidents/Settings",
      "Pages/Alerts/Settings",
      "Pages/ScheduledMaintenanceEvents/Settings",
    ];

    for (const folder of folders) {
      for (const file of fs.readdirSync(path.join(DASHBOARD_SRC, folder))) {
        if (!file.endsWith("Rules.tsx")) {
          continue;
        }

        const source: string = read(`${folder}/${file}`);

        expect({ file, basicInfo: source.includes('"Basic Info"') }).toEqual({
          file,
          basicInfo: false,
        });
      }
    }
  });
});

describe("the help panels speak plainly", () => {
  test.each(RULE_PAGES)("$file", (page: RulePageCase) => {
    const source: string = read(page.file);

    for (const jargon of [
      "(M2M)",
      "any-of",
      "isPrivate",
      "execute on-call duty policies",
      "Auto-execute",
      "Auto-mark",
      "users + members of owner teams",
      "fire on-call policies",
      "Remind While Event is Scheduled",
      // The reminder rules' help said this, over forms with no stop state.
      "stop state",
      "Stop State",
      "re-notify",
    ]) {
      expect({
        file: page.file,
        jargon,
        found: source.includes(jargon),
      }).toEqual({ file: page.file, jargon, found: false });
    }
  });

  test("each help panel keeps the Match Criteria heading the shared builder rewrites", () => {
    for (const page of RULE_PAGES) {
      expect({
        file: page.file,
        headings: countOf(read(page.file), "### Match Criteria"),
      }).toEqual({ file: page.file, headings: page.forms });
    }
  });
});

describe("a maintenance reminder rule's one choice", () => {
  const timing: string = read(
    "Components/Reminders/MaintenanceReminderTiming.ts",
  );
  const worker: string = fs.readFileSync(
    path.join(
      APP_ROOT,
      "FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendUnresolvedReminderNotification.ts",
    ),
    "utf8",
  );

  test("still describes what the worker does with the two columns", () => {
    /*
     * "While it is in progress" (switch off) waits for the start: the worker
     * defers a rule that does not remind while scheduled until the event
     * starts. "Before it starts" (Ongoing) stops at the start.
     */
    expect(worker).toContain("!rule.remindWhileScheduled &&");
    expect(worker).toContain(
      "OneUptimeDate.isInTheFuture(scheduledMaintenance.startsAt)",
    );
    expect(worker).toContain("ScheduledMaintenanceReminderStopState.Ongoing");
    expect(worker).toContain("isScheduledMaintenanceOngoing");

    expect(timing).toContain('"From when the event starts until it ends."');
    expect(timing).toContain(
      '"From when the event is scheduled until it starts."',
    );
    expect(timing).toContain(
      '"From when the event is scheduled until it ends."',
    );
  });

  test("the list shows the choice, not its two columns", () => {
    const page: string = read(
      "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceReminderRules.tsx",
    );

    expect(page).toContain("title: MAINTENANCE_REMINDER_TIMING_FIELD_TITLE");
    expect(page).toContain("<MaintenanceReminderTimingText rule={item} />");
    expect(page).not.toContain('title: "Remind While Scheduled"');
    expect(page).not.toContain('title: "Stop Reminders When"');
  });

  test("a rule that never reminds is marked in the list, as a rule that adds nothing is", () => {
    const text: string = read(
      "Components/Reminders/MaintenanceReminderTimingText.tsx",
    );

    /*
     * A pill that says why on hover, on a tap, on keyboard focus and to a
     * screen reader (ExplainedPill), not under a mouse only.
     */
    expect(text).toContain("<ExplainedPill");
    expect(text).not.toContain("<Pill");
    expect(text).toContain("color={Yellow}");
    expect(text).toContain("text={MAINTENANCE_REMINDER_NEVER_REMINDS_TEXT}");
    expect(text).toContain(
      "explanation={MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE}",
    );
    // Not an empty value's dash: a phone's card leaves an empty value out.
    expect(text).not.toContain("TableEmptyValue");
  });
});

describe("an incident's and an alert's reminder rules list", () => {
  test.each([
    [
      "Pages/Incidents/Settings/IncidentReminderRules.tsx",
      "IncidentReminderRule",
    ],
    ["Pages/Alerts/Settings/AlertReminderRules.tsx", "AlertReminderRule"],
  ])(
    "%s shows Stop Reminders When as the form words it, in the reader's language",
    (file: string, model: string) => {
      const page: string = read(file).replace(WHITESPACE, " ");

      expect(page).toContain(
        `title: "Stop Reminders When", type: FieldType.Element, getElement: (item: ${model}): ReactElement => { return ( <ReminderStopStateText value={item.stopRemindersOnState} /> );`,
      );
      expect(page).not.toContain(
        'title: "Stop Reminders When", type: FieldType.Text',
      );
    },
  );

  test("the list and the form read one word for each answer", () => {
    const form: string = read("Utils/Form/EventRuleForm.ts");
    const text: string = read("Components/Reminders/ReminderStopStateText.tsx");

    expect(form).toContain(
      '[ReminderStopState.Resolved]: translationKey("Resolved"),',
    );
    expect(form).toContain(
      '[ReminderStopState.Acknowledged]: translationKey("Acknowledged"),',
    );
    expect(form).toContain(
      "title: REMINDER_STOP_STATE_TITLES[ReminderStopState.Resolved],",
    );
    expect(form).toContain(
      "title: REMINDER_STOP_STATE_TITLES[ReminderStopState.Acknowledged],",
    );
    expect(text).toContain(
      "REMINDER_STOP_STATE_TITLES[readStopState(props.value)]",
    );
  });
});

describe("a new SLA rule starts with targets", () => {
  const page: string = read("Pages/Incidents/Settings/IncidentSlaRules.tsx");
  const form: string = read("Utils/Form/EventRuleForm.ts");

  test("15 minutes to respond and 4 hours to resolve, named after them", () => {
    expect(form).toContain(
      "export const DEFAULT_SLA_RESPONSE_TIME_IN_MINUTES: number = 15;",
    );
    expect(form).toContain(
      "export const DEFAULT_SLA_RESOLUTION_TIME_IN_MINUTES: number = 240;",
    );
    expect(form).toContain("name: getSlaRuleName(values),");
  });

  test("on the Create form only, so an Edit form never fills in an empty target", () => {
    expect(page).toContain(
      "createInitialValues={getNewSlaRuleValues<IncidentSlaRule>()}",
    );
    // Not field defaults: those fill an empty stored value on Edit too.
    expect(page).not.toContain("defaultValue: DEFAULT_SLA_");
  });

  test("its number boxes have no placeholder that reads like a value", () => {
    const fields: string = page.slice(page.indexOf("formFields={["));

    for (const column of [
      "responseTimeInMinutes",
      "resolutionTimeInMinutes",
      "internalNoteReminderIntervalInMinutes",
      "publicNoteReminderIntervalInMinutes",
    ]) {
      const at: number = fields.indexOf(`${column}: true`);
      expect(at).toBeGreaterThan(-1);
      const field: string = fields.slice(
        at,
        fields.indexOf("},\n          {", at),
      );
      expect({
        column,
        hasPlaceholder: field.includes("placeholder:"),
      }).toEqual({ column, hasPlaceholder: false });
    }
  });

  /*
   * An emptied box is saved as none, on Create and on Edit - by the form
   * every page shares (ModelForm runs Types/Database/BlankColumnValue on
   * what it sends), not by a hook of this page's own: the page kept one
   * (clearEmptiedSlaRuleMinutes) while every other form's emptied number
   * failed to save. Common's EventRuleFormsRender empties a target on both
   * forms and reads what is sent.
   */
  test("an emptied box is left to the shared form, which saves it as none", () => {
    expect(page).not.toContain("clearEmptiedSlaRuleMinutes");
    expect(page).not.toContain("onBeforeCreate=");
    expect(page).not.toContain("onBeforeUpdate=");

    const modelForm: string = fs.readFileSync(
      path.join(
        APP_ROOT,
        "..",
        "Common",
        "UI",
        "Components",
        "Forms",
        "ModelForm.tsx",
      ),
      "utf8",
    );

    expect(modelForm).toContain("clearBlankColumnValues(valuesToSend, model);");
  });

  test("the list shows the targets right after the name", () => {
    const columns: string = page.slice(
      page.indexOf("columns={["),
      page.indexOf("viewPageRoute="),
    );
    const order: Array<number> = [
      "name: true",
      "responseTimeInMinutes: true",
      "resolutionTimeInMinutes: true",
      "description: true",
      "isEnabled: true",
    ].map((column: string): number => {
      return columns.indexOf(column);
    });

    expect(
      order.every((at: number): boolean => {
        return at > -1;
      }),
    ).toBe(true);
    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);
  });
});
