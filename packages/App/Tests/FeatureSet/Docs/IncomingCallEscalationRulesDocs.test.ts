import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import {
  DEFAULT_INCOMING_CALL_RING_SECONDS,
  MAX_INCOMING_CALL_RING_SECONDS,
  MIN_INCOMING_CALL_RING_SECONDS,
} from "Common/Types/IncomingCall/IncomingCallRingTime";
import { getDefaultEscalationRuleName } from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Step 6: Configure Escalation Rules" of the Incoming Call Policy docs page,
 * against the form and the API it describes, in every docs language.
 *
 * Adding an incoming call escalation rule is one step: Who to call (an
 * on-call schedule or one person - never a team, which a rule cannot call)
 * and Ring for (in seconds), with the name and the description under
 * Advanced. The page used to list an Order field, Teams and Users that the
 * form never had. Markdown is not compiled, so these tests read the sources
 * of truth - the form's module, the page, the ring time's limits and the
 * model's columns - and check each language's page tells the same story,
 * in the words that language's dashboard shows.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const PAGE_RELATIVE_PATH: string = "on-call/incoming-call-policy.md";

const FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/IncomingCallEscalationRuleForm.ts";
const PAGE_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Escalation.tsx";

// The form's own words, as the dashboard draws them in English.
const WHO_TO_CALL: string = "Who to call";
const RING_FOR: string = "Ring for (in seconds)";
const ADD_RULE: string = "Add Escalation Rule";
const RULES_TAB: string = "Escalation Rules";

const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readPage(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, PAGE_RELATIVE_PATH),
    "utf8",
  );
}

// The words a language's dashboard shows: English where it has none.
function readDashboardLocale(lang: string): Record<string, string> {
  const file: string = path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`);
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(file, "utf8"),
  );

  return new Proxy(locale, {
    get: (target: Record<string, string>, key: string): string => {
      return target[key] || key;
    },
  });
}

// Persian pages write their numbers in Persian digits.
function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (digit: string): string => {
    return String(PERSIAN_DIGITS.indexOf(digit));
  });
}

// The page's "## " sections, by heading, with their text.
function sections(markdown: string): Array<{ heading: string; body: string }> {
  const found: Array<{ heading: string; body: string }> = [];

  for (const part of markdown.split(/^## /m).slice(1)) {
    const newline: number = part.indexOf("\n");

    found.push({
      heading: part.slice(0, newline).trim(),
      body: part.slice(newline + 1),
    });
  }

  return found;
}

// The step that adds an escalation rule: the section that says to click Add.
function findStepSix(lang: string): string {
  const locale: Record<string, string> = readDashboardLocale(lang);
  const addRule: string = `**${locale[ADD_RULE]}**`;

  const matching: Array<{ heading: string; body: string }> = sections(
    readPage(lang),
  ).filter((section: { body: string }): boolean => {
    return section.body.includes(addRule);
  });

  expect(matching).toHaveLength(1);

  return matching[0]!.body;
}

// Whether a line of a table is the row a setting is described in.
function isRowOf(line: string, setting: string): boolean {
  return line.startsWith(`| ${setting} `);
}

/*
 * The "Escalation Rule Settings" table, when the page has one: the
 * subsection with a row for Who to call. (Step 6's example has a "Who to
 * call" column, not a row.)
 */
function findSettingsTable(lang: string): string | null {
  const locale: Record<string, string> = readDashboardLocale(lang);
  const markdown: string = readPage(lang);

  for (const part of markdown.split(/^### /m).slice(1)) {
    const table: string = part.split(/^## /m)[0]!;

    if (
      table.split("\n").some((line: string): boolean => {
        return isRowOf(line, locale[WHO_TO_CALL]!);
      })
    ) {
      return table;
    }
  }

  return null;
}

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

describe("the docs describe the form the dashboard draws", () => {
  it("covers all seventeen docs languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
  });

  it("names the form's fields and its button as the dashboard does", () => {
    const form: string = readRepoFile(FORM_FILE);

    expect(form).toContain(`title: "${WHO_TO_CALL}"`);
    expect(form).toContain(`title: "${RING_FOR}"`);

    const page: string = readRepoFile(PAGE_FILE);

    expect(page).toContain('createVerb="Add"');
    expect(page).toContain('singularName="Escalation Rule"');
    expect(page).toContain(`title: "${RULES_TAB}"`);
  });

  it("gives the ring time Twilio takes, and the API's default", () => {
    expect(DEFAULT_INCOMING_CALL_RING_SECONDS).toBe(30);
    expect(MIN_INCOMING_CALL_RING_SECONDS).toBe(5);
    expect(MAX_INCOMING_CALL_RING_SECONDS).toBe(600);
    expect(
      (
        new IncomingCallPolicyEscalationRule().getTableColumnMetadata(
          "escalateAfterSeconds",
        ) as { defaultValue?: unknown }
      ).defaultValue,
    ).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
  });
});

describe.each(LANGUAGES)("the %s page's Step 6", (lang: string) => {
  const locale: Record<string, string> = readDashboardLocale(lang);

  it("walks the one-step form, with that language's labels", () => {
    const step: string = findStepSix(lang);

    for (const label of [
      locale[RULES_TAB],
      locale[ADD_RULE],
      locale[WHO_TO_CALL],
      locale[RING_FOR],
      locale["Name"],
      locale["Description"],
      locale["Advanced"],
    ]) {
      expect(step).toContain(`**${label}**`);
    }
  });

  it("asks for nothing the form does not: no teams, users or order fields", () => {
    const step: string = findStepSix(lang);

    for (const label of [
      "Teams",
      "Users",
      "Order",
      "Escalate After (seconds)",
      "On-Call Schedule",
    ]) {
      expect(step).not.toContain(`**${label}**`);
      expect(step).not.toContain(`**${locale[label]}**`);
    }
  });

  it("gives the ring time's default and Twilio's limits", () => {
    const step: string = toLatinDigits(findStepSix(lang));

    for (const value of [
      DEFAULT_INCOMING_CALL_RING_SECONDS,
      MIN_INCOMING_CALL_RING_SECONDS,
      MAX_INCOMING_CALL_RING_SECONDS,
    ]) {
      expect(step).toContain(String(value));
    }
  });

  it("names an unnamed rule after its level, as the list does", () => {
    const step: string = findStepSix(lang);

    expect(step).toContain(`**${getDefaultEscalationRuleName(1)}**`);
    expect(step).toContain(`**${getDefaultEscalationRuleName(2)}**`);
  });

  it("warns about voicemail beside the ring time", () => {
    const step: string = findStepSix(lang);

    const note: string | undefined = step
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("> **");
      });

    expect(note).toBeDefined();
    expect(note).toContain(`**${locale["Ring for"]}**`);
  });
});

describe.each(LANGUAGES)("the %s page's settings table", (lang: string) => {
  const locale: Record<string, string> = readDashboardLocale(lang);
  const table: string | null = findSettingsTable(lang);

  // The German page is the short one: it has no settings tables.
  const hasTable: boolean = lang !== "de";

  it(hasTable ? "is there" : "is left out, as the page always did", () => {
    expect(Boolean(table)).toBe(hasTable);
  });

  if (!hasTable) {
    return;
  }

  it("lists who to call and the ring time, and no team or user rows", () => {
    const rows: Array<string> = table!.split("\n").filter((line: string) => {
      return line.startsWith("| ");
    });

    const hasRow: (setting: string) => boolean = (setting: string): boolean => {
      return rows.some((line: string): boolean => {
        return isRowOf(line, setting);
      });
    };

    expect(hasRow(locale[WHO_TO_CALL]!)).toBe(true);
    expect(hasRow(locale[RING_FOR]!)).toBe(true);

    for (const setting of [
      "Teams",
      "Users",
      "Escalate After Seconds",
      "On-Call Schedule",
    ]) {
      expect(hasRow(setting)).toBe(false);
      expect(hasRow(locale[setting]!)).toBe(false);
    }
  });

  it("names the API's columns, which the rule has", () => {
    const rule: IncomingCallPolicyEscalationRule =
      new IncomingCallPolicyEscalationRule();

    for (const column of [
      "onCallDutyPolicyScheduleId",
      "userId",
      "escalateAfterSeconds",
    ]) {
      expect(table).toContain(`\`${column}\``);
      expect(rule.hasColumn(column)).toBe(true);
    }
  });
});

describe("the English page", () => {
  const english: string = readPage("en");

  it("says a rule calls on-call schedules or people, not teams", () => {
    expect(english).toContain(
      "3. Routing the call through escalation rules (on-call schedules or people)",
    );
    expect(english).not.toContain("Try Backup Team");
    expect(english).not.toContain("(teams, schedules, or users)");
  });

  it("tells what to do when calls end in voicemail", () => {
    const troubleshooting: string = sections(english).find(
      (section: { heading: string }): boolean => {
        return section.heading === "Troubleshooting";
      },
    )!.body;

    expect(troubleshooting).toContain(
      "If calls end up in an engineer's voicemail, set the rule's **Ring for** below the time their phone takes to go to voicemail",
    );
  });
});
