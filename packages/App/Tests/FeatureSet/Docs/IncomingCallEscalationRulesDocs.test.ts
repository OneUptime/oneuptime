import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import {
  DEFAULT_INCOMING_CALL_RING_SECONDS,
  MAX_INCOMING_CALL_RING_SECONDS,
  MIN_INCOMING_CALL_RING_SECONDS,
} from "Common/Types/IncomingCall/IncomingCallRingTime";
import { getDefaultEscalationRuleName } from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
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
 * More fields. The page used to list an Order field, Teams and Users that the
 * form never had. Markdown is not compiled, so these tests read the sources
 * of truth - the form's module, the page, the ring time's limits and the
 * model's columns - and check each language's page tells the same story,
 * in the words that language's dashboard shows.
 *
 * A new rule rings for 20 seconds, so the call moves on before most
 * voicemail picks up. Rules used to start at 30 and the ones saved then keep
 * their 30, which each page says once, in its voicemail note - the only
 * place 30 may still appear.
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

// What a new rule started with before it rang for 20 seconds.
const PREVIOUS_DEFAULT_RING_SECONDS: number = 30;

const UPGRADE_PAGE_RELATIVE_PATH: string = "installation/upgrading.md";

// A line of Step 6's example: it names one of the three levels.
const EXAMPLE_LEVEL: RegExp = /Level [123]/;

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

// The numbers a line holds, in either digit set.
function numbersIn(line: string): Array<number> {
  return (toLatinDigits(line).match(/\d+/g) || []).map(Number);
}

// The line of Step 6 that describes the Ring for field.
function findRingBullet(lang: string): string {
  const locale: Record<string, string> = readDashboardLocale(lang);

  const lines: Array<string> = findStepSix(lang)
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().startsWith(`- **${locale[RING_FOR]}**`);
    });

  expect(lines).toHaveLength(1);

  return lines[0]!;
}

// Step 6's voicemail note: its first "> **" line.
function findVoicemailNote(lang: string): string {
  const note: string | undefined = findStepSix(lang)
    .split("\n")
    .find((line: string): boolean => {
      return line.startsWith("> **");
    });

  expect(note).toBeDefined();

  return note!;
}

// The line that tells API users what the rule's columns are.
function findApiSentence(lang: string): string | null {
  const lines: Array<string> = readPage(lang)
    .split("\n")
    .filter((line: string): boolean => {
      return line.includes("`escalateAfterSeconds`") && !line.startsWith("|");
    });

  expect(lines.length).toBeLessThanOrEqual(1);

  return lines[0] || null;
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
    expect(DEFAULT_INCOMING_CALL_RING_SECONDS).toBe(20);
    expect(DEFAULT_INCOMING_CALL_RING_SECONDS).not.toBe(
      PREVIOUS_DEFAULT_RING_SECONDS,
    );
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
      locale[MORE_FIELDS_SECTION_TITLE],
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

  it("says a new rule rings for 20 seconds, in the line about Ring for", () => {
    // The default, then Twilio's limits, and no other number.
    expect([...new Set(numbersIn(findRingBullet(lang)))].sort()).toEqual(
      [
        DEFAULT_INCOMING_CALL_RING_SECONDS,
        MIN_INCOMING_CALL_RING_SECONDS,
        MAX_INCOMING_CALL_RING_SECONDS,
      ].sort(),
    );
    expect(numbersIn(findRingBullet(lang))).not.toContain(
      PREVIOUS_DEFAULT_RING_SECONDS,
    );
  });

  it("rings each level of its example for the default", () => {
    const ringTimes: Array<number> = findStepSix(lang)
      .split("\n")
      .filter((line: string): boolean => {
        return EXAMPLE_LEVEL.test(line);
      })
      .flatMap((line: string): Array<number> => {
        // The level numbers themselves are not ring times.
        return numbersIn(line).filter((value: number): boolean => {
          return value > 3;
        });
      });

    // The German and Swedish pages have no example.
    if (lang === "de" || lang === "sv") {
      expect(ringTimes).toEqual([]);
      return;
    }

    expect(ringTimes.length).toBeGreaterThanOrEqual(3);

    for (const ringTime of ringTimes) {
      expect(ringTime).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    }
  });

  it("tells owners of older rules that theirs still ring for 30, in the voicemail note", () => {
    const numbers: Array<number> = numbersIn(findVoicemailNote(lang));

    expect(numbers).toContain(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(numbers).toContain(PREVIOUS_DEFAULT_RING_SECONDS);
    expect(
      numbers.filter((value: number): boolean => {
        return (
          value !== DEFAULT_INCOMING_CALL_RING_SECONDS &&
          value !== PREVIOUS_DEFAULT_RING_SECONDS
        );
      }),
    ).toEqual([]);
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

describe.each(LANGUAGES)("the whole %s page", (lang: string) => {
  it("mentions the old 30 second default only in the voicemail note", () => {
    const note: string = findVoicemailNote(lang);

    const linesWithThirty: Array<string> = readPage(lang)
      .split("\n")
      .filter((line: string): boolean => {
        return numbersIn(line).includes(PREVIOUS_DEFAULT_RING_SECONDS);
      });

    expect(linesWithThirty).toEqual([note]);
  });

  it("tells API users a rule left without a ring time rings for 20", () => {
    const sentence: string | null = findApiSentence(lang);

    // The German page is the short one: it has no API sentence.
    if (lang === "de") {
      expect(sentence).toBeNull();
      return;
    }

    expect(numbersIn(sentence!)).toEqual([DEFAULT_INCOMING_CALL_RING_SECONDS]);
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

  it("gives the ring time's default of 20 and Twilio's limits", () => {
    const row: string | undefined = table!
      .split("\n")
      .find((line: string): boolean => {
        return isRowOf(line, locale[RING_FOR]!);
      });

    expect([...new Set(numbersIn(row!))].sort()).toEqual(
      [
        DEFAULT_INCOMING_CALL_RING_SECONDS,
        MIN_INCOMING_CALL_RING_SECONDS,
        MAX_INCOMING_CALL_RING_SECONDS,
      ].sort(),
    );
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

describe("the upgrade notes", () => {
  const upgrading: string = fs.readFileSync(
    path.join(CONTENT_DIR, "en", UPGRADE_PAGE_RELATIVE_PATH),
    "utf8",
  );

  // The "Other changes in 14" item about the ring time.
  const item: string =
    upgrading.split(/\n(?=- \*\*)/).find((part: string): boolean => {
      return part.startsWith(
        "- **New incoming call escalation rules ring for 20 seconds, not 30.**",
      );
    }) || "";

  // The item as one line: Markdown wraps it wherever it likes.
  const flatItem: string = item.replace(/\s+/g, " ");

  it("list the new default under Other changes in 14", () => {
    const otherChanges: number = upgrading.indexOf("### Other changes in 14");
    const itemAt: number = upgrading.indexOf(item);

    expect(item).not.toBe("");
    expect(otherChanges).toBeGreaterThan(-1);
    expect(itemAt).toBeGreaterThan(otherChanges);
    // Still inside that section: before the next heading.
    expect(itemAt).toBeLessThan(upgrading.indexOf("\n### ", otherChanges + 1));
  });

  it("say where the default applies, under the names each place uses", () => {
    for (const name of [
      `**${RING_FOR}**`,
      "`escalateAfterSeconds`",
      "`escalate_after_seconds`",
    ]) {
      expect(flatItem).toContain(name);
    }
  });

  it("say existing rules keep their ring time", () => {
    expect(flatItem).toContain(
      "Rules that already exist keep the ring time they have: the upgrade changes only the column's default.",
    );
  });

  it("tell Terraform users what their next plan shows, and how to keep 30", () => {
    expect(flatItem).toContain(
      "A Terraform configuration that leaves `escalate_after_seconds` out will plan `30 -> 20` for the rules it manages once you upgrade the provider; set `escalate_after_seconds = 30` to keep 30.",
    );
  });

  it("link to the incoming call policy page", () => {
    expect(flatItem).toContain(
      "[Incoming Call Policy](/docs/on-call/incoming-call-policy)",
    );
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
