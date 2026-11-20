import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  getIncomingCallTwilioConfigQuery,
  INCOMING_CALL_TWILIO_CONFIG_USES,
  IncomingCallTwilioConfigCopy,
  isIncomingCallTwilioConfig,
} from "../../../FeatureSet/Dashboard/src/Components/IncomingCallPolicy/IncomingCallTwilioConfigCopy";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import Includes from "Common/Types/BaseDatabase/Includes";
import TwilioConfigUses, {
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN INCOMING CALL POLICY'S TWILIO PICKER LISTS ONLY THE CONFIGS USED FOR
 * CALLS (#8885), AS THE PAGE, ITS WORDS AND THE DOCS SAY IT.
 *
 * The picker asks for the configs used for Calls and SMS or Calls only -
 * the uses that make calls (TwilioConfigUses.makesCalls) - as a status
 * page's asks for the ones that send SMS. Its words are in every Dashboard
 * language, and every docs language's "Choose the Twilio account" step says
 * which configs the list offers, in the words its language's Dashboard
 * draws the uses in. Common's IncomingCallTwilioConfigPicker draws the page.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const OVERVIEW_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Index.tsx",
);

const STATUS_PAGE_PICKER_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SubscriberSettings.tsx",
);

const WORDS: ReadonlyArray<string> = Object.values(
  IncomingCallTwilioConfigCopy,
);

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// Runs of whitespace, so a source reads the same however prettier wraps it.
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

/*
 * The "Choose the Twilio account" step of a language's page: the paragraph
 * that names the Setup card and the picker's field. (In most languages the
 * field and the Twilio Config card have one name, so the field alone is not
 * enough to find it.)
 */
function chooseStep(language: string): string {
  const page: string = fs.readFileSync(
    path.join(CONTENT_DIR, language, "on-call/incoming-call-policy.md"),
    "utf8",
  );
  const field: string = `**${drawnDashboardLabel(language, "Twilio Configuration")}**`;
  const card: string = `**${drawnDashboardLabel(language, "Setup")}**`;
  const paragraphs: Array<string> = page
    .split("\n")
    .filter((line: string): boolean => {
      return (
        line.includes(field) && line.includes(card) && !line.startsWith("|")
      );
    });

  expect({ language, found: paragraphs.length }).toEqual({
    language,
    found: 1,
  });

  return paragraphs[0]!;
}

describe("the configs the picker lists", () => {
  it("are the ones used for calls - Calls and SMS, Calls only - never SMS only", () => {
    expect([...INCOMING_CALL_TWILIO_CONFIG_USES]).toEqual(
      TWILIO_CONFIG_USES.filter((use: TwilioConfigUse): boolean => {
        return TwilioConfigUses.makesCalls(use);
      }),
    );
    expect([...INCOMING_CALL_TWILIO_CONFIG_USES]).toEqual([
      TwilioConfigUse.CallsAndSms,
      TwilioConfigUse.CallsOnly,
    ]);
  });

  it("are asked for by their use, an Includes the server reads", () => {
    const query: Record<string, unknown> =
      getIncomingCallTwilioConfigQuery() as Record<string, unknown>;

    expect(Object.keys(query)).toEqual(["usedFor"]);
    expect(query["usedFor"]).toBeInstanceOf(Includes);
    expect((query["usedFor"] as Includes).values).toEqual([
      TwilioConfigUse.CallsAndSms,
      TwilioConfigUse.CallsOnly,
    ]);
  });

  it("a new query each time: the page's picker cannot change what the next one asks", () => {
    const first: Includes = getIncomingCallTwilioConfigQuery()[
      "usedFor"
    ] as Includes;

    (first.values as Array<string>).push(TwilioConfigUse.SmsOnly);

    expect(
      (getIncomingCallTwilioConfigQuery()["usedFor"] as Includes).values,
    ).toEqual([TwilioConfigUse.CallsAndSms, TwilioConfigUse.CallsOnly]);
    expect(INCOMING_CALL_TWILIO_CONFIG_USES).not.toContain(
      TwilioConfigUse.SmsOnly,
    );
  });

  it.each([
    [TwilioConfigUse.CallsAndSms, true],
    [TwilioConfigUse.CallsOnly, true],
    [TwilioConfigUse.SmsOnly, false],
    // A config made before the choice, or a value nobody wrote: calls and SMS.
    [undefined, true],
    [null, true],
    ["not a use", true],
  ])(
    "a policy's config used for %p takes calls: %p",
    (use: unknown, takes: boolean) => {
      expect(isIncomingCallTwilioConfig(use)).toBe(takes);
    },
  );

  it("are what the status page's picker leaves out, and the other way round: each lists what its page sends", () => {
    const statusPagePicker: string = flat(
      fs.readFileSync(STATUS_PAGE_PICKER_FILE, "utf8"),
    );

    // The status page lists the configs that send SMS: SMS only among them.
    expect(statusPagePicker).toContain(
      "usedFor: new Includes([ TwilioConfigUse.CallsAndSms, TwilioConfigUse.SmsOnly, ])",
    );
    // The two pickers share Calls and SMS, and part on the rest.
    expect(INCOMING_CALL_TWILIO_CONFIG_USES).toContain(
      TwilioConfigUse.CallsAndSms,
    );
    expect(INCOMING_CALL_TWILIO_CONFIG_USES).not.toContain(
      TwilioConfigUse.SmsOnly,
    );
  });
});

describe("the policy's Overview", () => {
  const overview: string = flat(fs.readFileSync(OVERVIEW_FILE, "utf8"));

  it("asks the picker for the configs used for calls, and says the rest are not listed", () => {
    expect(overview).toContain(
      'dropdownModal: { type: ProjectCallSMSConfig, labelField: "name", valueField: "_id", query: getIncomingCallTwilioConfigQuery(), },',
    );
    expect(overview).toContain(
      "description: IncomingCallTwilioConfigCopy.pickerDescription,",
    );
    expect(overview).not.toContain(
      "Select the Twilio configuration to use for incoming calls.",
    );
  });

  it("counts, as the picker opens, the configs it would list and all of them", () => {
    expect(overview).toContain("query: getIncomingCallTwilioConfigQuery(),");
    expect(overview).toContain(
      "setTwilioConfigCounts({ forCalls: forCalls, total: total });",
    );
    // A project with none for calls is shown no picker.
    expect(overview).toContain("twilioConfigCounts.forCalls > 0 && (");
    expect(overview).toContain("twilioConfigCounts.forCalls === 0 && (");
  });

  it("reads what the policy's config is used for", () => {
    expect(overview).toContain(
      "projectCallSMSConfig: { name: true, // One used for SMS only is listed no more: its card says so. usedFor: true, },",
    );
  });
});

describe("the words", () => {
  it("are each one sentence, short enough to sit under a field", () => {
    for (const word of WORDS) {
      expect({ word, length: word.length <= 210 }).toEqual({
        word,
        length: true,
      });
    }

    expect(IncomingCallTwilioConfigCopy.pickerDescription.length).toBeLessThan(
      150,
    );
  });

  it("are in en.json as themselves", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const word of WORDS) {
      expect([word, english[word]]).toEqual([word, word]);
    }
  });

  it.each(TRANSLATED_LOCALES)("%s has each, translated", (language: string) => {
    const locale: Record<string, unknown> = readLocale(language);

    for (const word of WORDS) {
      const translated: unknown = locale[word];

      expect({ word, isText: typeof translated === "string" }).toEqual({
        word,
        isText: true,
      });
      expect({ word, isEnglish: translated === word }).toEqual({
        word,
        isEnglish: false,
      });
    }
  });
});

describe("the docs", () => {
  const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

  it("are checked in all seventeen docs languages", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  it.each(LANGUAGES)(
    "%s: choosing the account says the list offers the configs used for calls, in the Dashboard's words",
    (language: string) => {
      const step: string = chooseStep(language);

      for (const use of [
        TwilioConfigUse.CallsAndSms,
        TwilioConfigUse.CallsOnly,
        TwilioConfigUse.SmsOnly,
      ]) {
        const label: string = `**${drawnDashboardLabel(language, use)}**`;

        expect({ language, use, named: step.includes(label) }).toEqual({
          language,
          use,
          named: true,
        });
      }

      // Calls and SMS and Calls only are offered first; SMS only follows.
      expect(
        step.indexOf(
          `**${drawnDashboardLabel(language, TwilioConfigUse.CallsOnly)}**`,
        ),
      ).toBeLessThan(
        step.indexOf(
          `**${drawnDashboardLabel(language, TwilioConfigUse.SmsOnly)}**`,
        ),
      );
    },
  );

  it("English says it in so many words", () => {
    expect(chooseStep("en")).toContain(
      "The list offers only the configurations used for **Calls and SMS** or **Calls only**. A policy whose configuration is later set to **SMS only** keeps it, and its card says what to change.",
    );
  });
});
