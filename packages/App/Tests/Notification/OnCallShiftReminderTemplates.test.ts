import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Dictionary from "Common/Types/Dictionary";
import OnCallShiftReminderRunner, {
  ShiftReminderMessage,
} from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";
import { MaterializedShift } from "Common/Types/OnCallDutyPolicy/MaterializedShift";
import {
  at,
  shift,
} from "../../../Common/Tests/Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * UserOnCallShiftReminder.hbs and UserOnCallShiftReassigned.hbs — the two
 * emails behind shift reminders.
 *
 * They are rendered here with the EXACT vars the runner's message builders
 * produce, through the same partials MailService registers, so a renamed
 * variable on either side shows up as an empty subject line or a button
 * pointing nowhere in this file rather than in somebody's inbox. The last
 * tests pin the variable names by parsing the templates.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const NOW: Date = at("2026-09-03T15:00:00Z");
const SHIFT_START: Date = at("2026-09-03T16:00:00Z");
const SHIFT_END: Date = at("2026-09-04T16:00:00Z");

function templateSource(name: EmailTemplateType): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function render(name: EmailTemplateType, vars: Dictionary<string>): string {
  return Handlebars.compile(templateSource(name))({
    homeURL: "https://oneuptime.example.com",
    year: "2026",
    ...vars,
  });
}

function aliceShift(
  overrides: Partial<MaterializedShift> = {},
): MaterializedShift {
  return shift({
    scheduleId: "schedule-1",
    scheduleName: "Payments",
    projectId: "project-1",
    userId: "user-a",
    userName: "Alice Andersson",
    start: SHIFT_START,
    end: SHIFT_END,
    scheduleTimezone: "Europe/Stockholm",
    ...overrides,
  });
}

/*
 * Every variable a template reads at its top level: plain {{name}}, the
 * right-hand sides of partial parameters ({{> Partial text=name}}),
 * arguments of (concat ...) and {{#if name}} guards.
 */
function referencedVariables(source: string): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const match of source.matchAll(/\{\{([^}]*)\}\}/g)) {
    let inner: string = match[1]!.trim();

    if (inner.startsWith("/")) {
      continue;
    }

    if (inner.startsWith("#if")) {
      names.add(inner.replace(/^#if\s+/, "").trim());
      continue;
    }

    if (inner.startsWith(">")) {
      // Drop the partial name, string literals and parameter keys.
      inner = inner.replace(/^>\s*\S+/, "");
      inner = inner.replace(/"[^"]*"/g, "");
      inner = inner.replace(/\b\w+=/g, "");

      for (const token of inner.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
        if (token !== "this" && token !== "concat") {
          names.add(token);
        }
      }

      continue;
    }

    names.add(inner);
  }

  return names;
}

beforeAll(() => {
  // Mirrors FeatureSet/Notification/Utils/Handlebars.ts (see CompleteRegistrationTemplate.test.ts).
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }

  Handlebars.registerHelper(
    "ifCond",
    function (v1: any, v2: any, options: any) {
      // @ts-expect-error - Handlebars uses dynamic this context for template helpers
      return v1 === v2 ? options.fn(this) : options.inverse(this);
    },
  );

  Handlebars.registerHelper("concat", (v1: any, v2: any) => {
    return v1 + v2;
  });
});

describe("EmailTemplateType", () => {
  test("names the two reminder templates, and both files exist", () => {
    expect(EmailTemplateType.UserOnCallShiftReminder).toBe(
      "UserOnCallShiftReminder.hbs",
    );
    expect(EmailTemplateType.UserOnCallShiftReassigned).toBe(
      "UserOnCallShiftReassigned.hbs",
    );
    expect(
      fs.existsSync(
        Path.resolve(TEMPLATES_DIR, EmailTemplateType.UserOnCallShiftReminder),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        Path.resolve(
          TEMPLATES_DIR,
          EmailTemplateType.UserOnCallShiftReassigned,
        ),
      ),
    ).toBe(true);
  });
});

/*
 * The `concat` helper MailService registers takes exactly TWO arguments
 * (FeatureSet/Notification/Utils/Handlebars.ts) and silently drops the rest.
 * A four-argument call renders the headline as "Your on-call shift on
 * Payments" and nothing else — which is how these templates first shipped.
 * Every (concat ...) must therefore nest rather than stack.
 */
const WHITESPACE: RegExp = /\s/;

function concatArities(source: string): Array<number> {
  const arities: Array<number> = [];
  const stripped: string = source.replace(/"[^"]*"/g, '"s"');

  for (const match of stripped.matchAll(/\(concat\b/g)) {
    let depth: number = 0;
    let args: number = 0;
    let inToken: boolean = false;

    for (let index: number = match.index!; index < stripped.length; index++) {
      const char: string = stripped[index]!;

      if (char === "(") {
        if (depth === 1) {
          args++;
        }
        depth++;
        inToken = false;
        continue;
      }

      if (char === ")") {
        depth--;
        if (depth === 0) {
          break;
        }
        continue;
      }

      if (depth === 1) {
        if (WHITESPACE.test(char)) {
          inToken = false;
        } else if (!inToken) {
          inToken = true;
          args++;
        }
      }
    }

    // The first token at depth 1 is the helper name itself.
    arities.push(args - 1);
  }

  return arities;
}

describe("concat helper arity", () => {
  test.each([
    EmailTemplateType.UserOnCallShiftReminder,
    EmailTemplateType.UserOnCallShiftReassigned,
  ])(
    "%s only ever calls concat with two arguments",
    (name: EmailTemplateType) => {
      const arities: Array<number> = concatArities(templateSource(name));

      expect(arities.length).toBeGreaterThan(0);
      expect(
        arities.every((arity: number) => {
          return arity === 2;
        }),
      ).toBe(true);
    },
  );

  test("the parser catches the four-argument call these templates shipped with", () => {
    expect(
      concatArities(
        '{{> EmailTitle title=(concat "a " scheduleName " b " remainingText) }}',
      ),
    ).toEqual([4]);
    expect(
      concatArities(
        '{{> EmailTitle title=(concat (concat "a " scheduleName) (concat " b " remainingText)) }}',
      ),
    ).toEqual([2, 2, 2]);
  });
});

describe("UserOnCallShiftReminder.hbs", () => {
  const message: ShiftReminderMessage =
    OnCallShiftReminderRunner.buildReminderMessage({
      shift: aliceShift(),
      lead: 60,
      now: NOW,
      timezone: "Europe/Berlin",
      dashboardUrl: DASHBOARD_URL,
    });

  test("the runner points the reminder at this template", () => {
    expect(message.templateType).toBe(
      EmailTemplateType.UserOnCallShiftReminder,
    );
  });

  test("renders the headline with the schedule and the lead", () => {
    const html: string = render(message.templateType, message.vars);

    expect(html).toContain("Your on-call shift on Payments starts in 1 hour");
  });

  test("renders every detail row from the builder's vars", () => {
    const html: string = render(message.templateType, message.vars);

    expect(html).toContain("Payments Policy");
    expect(html).toContain("Thu 3 Sep 18:00 Europe/Berlin");
    expect(html).toContain("Fri 4 Sep 18:00 Europe/Berlin");
    expect(html).toContain("Reminder Lead Time:");
    expect(html).toContain("1 hour");
    expect(html).toContain(message.vars["description"]!);
  });

  test("links to the schedule twice: the button and a copyable line", () => {
    const html: string = render(message.templateType, message.vars);
    const link: string = message.vars["scheduleViewLink"]!;

    expect(link).toContain("/project-1/on-call-duty/schedules/schedule-1");
    expect(html.split(link).length - 1).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('href=""');
  });

  test("shows the 'Covering For' row only for a covering shift", () => {
    const plain: string = render(message.templateType, message.vars);

    expect(plain).not.toContain("Covering For:");

    const covering: ShiftReminderMessage =
      OnCallShiftReminderRunner.buildReminderMessage({
        shift: aliceShift({
          userId: "user-b",
          userName: "Bob Brown",
          override: {
            originalUserId: "user-a",
            originalUserName: "Alice Andersson",
            overrideStartsAt: SHIFT_START,
            overrideEndsAt: SHIFT_END,
          },
        }),
        lead: 60,
        now: NOW,
        timezone: "Europe/Berlin",
        dashboardUrl: DASHBOARD_URL,
      });

    const html: string = render(covering.templateType, covering.vars);

    expect(html).toContain("Covering For:");
    expect(html).toContain("Alice Andersson");
  });

  test("renders the catch-up variant (same template, 'Heads up' wording)", () => {
    const catchUp: ShiftReminderMessage =
      OnCallShiftReminderRunner.buildCatchUpMessage({
        shift: aliceShift(),
        now: at("2026-09-03T15:32:00Z"),
        timezone: "Europe/Berlin",
        dashboardUrl: DASHBOARD_URL,
      });

    expect(catchUp.templateType).toBe(
      EmailTemplateType.UserOnCallShiftReminder,
    );

    const html: string = render(catchUp.templateType, catchUp.vars);

    expect(html).toContain("starts in 28 minutes");
    /*
     * A catch-up also goes to a shift that did not move (a lead configured
     * after its instant passed), so it never claims the shift changed.
     */
    expect(html).toContain("Heads up: your on-call shift on Payments");
    expect(html).not.toContain("now starts in");
  });

  test("leaves no unresolved mustache and tells the recipient where to change the reminder", () => {
    const html: string = render(message.templateType, message.vars);

    expect(html).not.toContain("{{");
    expect(html).toContain("Calendar Feed page under User Settings");
    expect(html).toContain("reassigned");
  });

  test("reads only variables the builder sets", () => {
    const referenced: Set<string> = referencedVariables(
      templateSource(EmailTemplateType.UserOnCallShiftReminder),
    );

    expect(Array.from(referenced).sort()).toEqual(
      [
        "coveringFor",
        "description",
        "endsAt",
        "leadText",
        "policyNames",
        "remainingText",
        "scheduleName",
        "scheduleViewLink",
        "startsAt",
      ].sort(),
    );

    for (const name of referenced) {
      expect(Object.keys(message.vars)).toContain(name);
    }
  });
});

describe("UserOnCallShiftReassigned.hbs", () => {
  const message: ShiftReminderMessage =
    OnCallShiftReminderRunner.buildReassignedMessage({
      scheduleName: "Payments",
      projectId: "project-1",
      scheduleId: "schedule-1",
      shiftStartsAt: SHIFT_START,
      coveredBy: "Bob Brown",
      timezone: "Europe/Berlin",
      dashboardUrl: DASHBOARD_URL,
    });

  test("the runner points the reassigned notice at this template", () => {
    expect(message.templateType).toBe(
      EmailTemplateType.UserOnCallShiftReassigned,
    );
  });

  test("renders the headline, the shift time and who covers it now", () => {
    const html: string = render(message.templateType, message.vars);

    expect(html).toContain(
      "Your on-call shift on Payments has been reassigned",
    );
    expect(html).toContain("Thu 3 Sep 18:00 Europe/Berlin");
    expect(html).toContain("Now Covered By:");
    expect(html).toContain("Bob Brown");
    expect(html).toContain(message.vars["description"]!);
  });

  test("omits the 'Now Covered By' row when nobody holds the shift", () => {
    const unassigned: ShiftReminderMessage =
      OnCallShiftReminderRunner.buildReassignedMessage({
        scheduleName: "Payments",
        projectId: "project-1",
        scheduleId: "schedule-1",
        shiftStartsAt: SHIFT_START,
        coveredBy: null,
        timezone: "Europe/Berlin",
        dashboardUrl: DASHBOARD_URL,
      });

    const html: string = render(unassigned.templateType, unassigned.vars);

    expect(html).not.toContain("Now Covered By:");
    expect(html).toContain("is no longer assigned to you");
  });

  test("links to the schedule and leaves no unresolved mustache", () => {
    const html: string = render(message.templateType, message.vars);

    expect(html).toContain(message.vars["scheduleViewLink"]!);
    expect(html).not.toContain('href=""');
    expect(html).not.toContain("{{");
  });

  test("reads only variables the builder sets", () => {
    const referenced: Set<string> = referencedVariables(
      templateSource(EmailTemplateType.UserOnCallShiftReassigned),
    );

    expect(Array.from(referenced).sort()).toEqual(
      [
        "coveredBy",
        "description",
        "scheduleName",
        "scheduleViewLink",
        "startsAt",
      ].sort(),
    );

    for (const name of referenced) {
      expect(Object.keys(message.vars)).toContain(name);
    }
  });
});
