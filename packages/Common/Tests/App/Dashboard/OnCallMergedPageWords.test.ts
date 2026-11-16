import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import { getOnCallLogOwnLineSentence } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/OnCallLogLineWords";
import {
  ON_CALL_ALREADY_PAGED_STATUS_LABEL,
  ON_CALL_TIMELINE_STATUS_LABELS,
  USER_ON_CALL_LOG_STATUS_LABELS,
  getOnCallTimelineStatusFilterOptions,
  getUserOnCallLogStatusFilterOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/OnCallLogStatusLabels";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { readOnCallLogLine } from "../../../Types/OnCallDutyPolicy/OnCallLogLine";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  OnCallPageCoverKind,
  getOnCallPageMergeTakenOverMessage,
  getOnCallPageMergedLine,
  getOnCallPageMergedMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * A PAGE MERGED INTO THE PERSON'S OPEN PAGE FROM ANOTHER RUN, IN THE
 * DASHBOARD (issues #7837, #8859, OnCallPageMerge).
 *
 * The Execution Timeline's line for them and User Settings > On-Call Logs'
 * page of theirs are stored "Already Paged" and read so - a pill, and a
 * Status filter's option - and View Status Message words their line in the
 * reader's language, the policy's name as written: "Already paged about
 * this by Payments, so not paged again.", and once it took the page over,
 * "Their page from Payments is over, so this policy pages them now." -
 * through the Dashboard's own locale files, so a missing translation fails
 * here.
 */

type Locale = Record<string, string>;

const LOCALES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// Each Dashboard language's word for an on-call policy, as its locale words it.
const POLICY_WORDS: Record<string, string> = {
  ar: "سياسة",
  da: "politik",
  de: "Richtlinie",
  es: "política",
  fa: "سیاست",
  fr: "politique",
  hi: "नीति",
  it: "policy",
  ja: "ポリシー",
  ko: "정책",
  nl: "beleid",
  no: "policy",
  pt: "política",
  ru: "политик",
  sv: "policy",
  "zh-CN": "策略",
  "zh-TW": "策略",
};

const translatorFor: (locale: Locale, language: string) => Translator = (
  locale: Locale,
  language: string,
): Translator => {
  return createTranslator((text: string) => {
    return locale[text];
  }, language);
};

const ENGLISH: Translator = translatorFor(
  englishLocale as unknown as Locale,
  "en",
);
const GERMAN: Translator = translatorFor(
  germanLocale as unknown as Locale,
  "de",
);
const PERSIAN: Translator = translatorFor(
  persianLocale as unknown as Locale,
  "fa",
);

function wordsOf(translator: Translator, line: string): string | null {
  return getOnCallLogOwnLineSentence(translator, {
    line: readOnCallLogLine(line),
    isTestPage: false,
  });
}

describe("a merged page's line, in the reader's words", () => {
  test("in English, as the server writes it", () => {
    expect(
      wordsOf(ENGLISH, getOnCallPageMergedMessage({ policyName: "Payments" })),
    ).toBe("Already paged about this by Payments, so not paged again.");
    expect(
      wordsOf(
        ENGLISH,
        getOnCallPageMergeTakenOverMessage({ policyName: "Payments" }),
      ),
    ).toBe("Their page from Payments is over, so this policy pages them now.");
  });

  test("in German, the policy's name as written", () => {
    const merged: string | null = wordsOf(
      GERMAN,
      getOnCallPageMergedMessage({ policyName: "Payments" }),
    );
    const takenOver: string | null = wordsOf(
      GERMAN,
      getOnCallPageMergeTakenOverMessage({ policyName: "Payments" }),
    );

    expect(merged).toContain("Payments");
    expect(merged).toContain("bereits");
    expect(merged).not.toContain("Already paged");
    expect(takenOver).toContain("Payments");
    expect(takenOver).not.toContain("is over");
  });

  test("a line naming no policy says another policy in the reader's words, never the server's English", () => {
    const merged: string | null = wordsOf(
      GERMAN,
      getOnCallPageMergedMessage({ policyName: null }),
    );
    const takenOver: string | null = wordsOf(
      PERSIAN,
      getOnCallPageMergeTakenOverMessage({ policyName: null }),
    );

    expect(merged).toBe(
      germanLocale[
        "Already paged about this by another on-call policy, so not paged again."
      ],
    );
    expect(merged).not.toContain("another on-call policy");
    expect(takenOver).toBe(
      persianLocale[
        "Their page from another on-call policy is over, so this policy pages them now."
      ],
    );
  });
});

/*
 * MERGED INTO A DIRECT PAGE (#8859): a page Jane sent from a chat, or a
 * workflow's - each line in its own words, never as a policy's, and the
 * take-over of a merged workflow's page saying it pages them directly.
 */
describe("a page merged into a direct page, in the reader's words", () => {
  const JANE: string = getOnCallPageMergedLine({
    kind: OnCallPageCoverKind.PersonPage,
    name: "Jane Doe",
  });
  const NIGHTLY: string = getOnCallPageMergedLine({
    kind: OnCallPageCoverKind.WorkflowPage,
    name: "Nightly Checks",
  });
  const TAKEN_OVER_DIRECTLY: string = getOnCallPageMergeTakenOverMessage({
    policyName: "Payments",
    isDirectPage: true,
  });

  test("in English, as the server writes it", () => {
    expect(wordsOf(ENGLISH, JANE)).toBe(
      "Already paged directly about this by Jane Doe, so not paged again.",
    );
    expect(wordsOf(ENGLISH, NIGHTLY)).toBe(
      "Already paged about this through the workflow Nightly Checks, so not paged again.",
    );
    expect(wordsOf(ENGLISH, TAKEN_OVER_DIRECTLY)).toBe(
      "Their page from Payments is over, so they are paged directly now.",
    );
    expect(
      wordsOf(
        ENGLISH,
        getOnCallPageMergeTakenOverMessage({
          policyName: null,
          isDirectPage: true,
        }),
      ),
    ).toBe(
      "Their page from another on-call policy is over, so they are paged directly now.",
    );
  });

  test("in German and Persian, the name as written and none of the server's English", () => {
    for (const translator of [GERMAN, PERSIAN]) {
      const jane: string | null = wordsOf(translator, JANE);
      const nightly: string | null = wordsOf(translator, NIGHTLY);
      const takenOver: string | null = wordsOf(translator, TAKEN_OVER_DIRECTLY);

      expect(jane).toContain("Jane Doe");
      expect(jane).not.toContain("Already paged");
      expect(nightly).toContain("Nightly Checks");
      expect(nightly).not.toContain("workflow");
      expect(takenOver).toContain("Payments");
      expect(takenOver).not.toContain("is over");
    }

    expect(wordsOf(GERMAN, NIGHTLY)).toContain("Arbeitsablauf");
    expect(wordsOf(PERSIAN, NIGHTLY)).toContain("گردش کاری");
  });

  test("a direct page's line and a policy's are worded apart", () => {
    expect(wordsOf(GERMAN, JANE)).not.toBe(
      wordsOf(GERMAN, getOnCallPageMergedMessage({ policyName: "Jane Doe" })),
    );
    expect(wordsOf(GERMAN, TAKEN_OVER_DIRECTLY)).not.toBe(
      wordsOf(
        GERMAN,
        getOnCallPageMergeTakenOverMessage({ policyName: "Payments" }),
      ),
    );
  });

  /*
   * "Their page from {{name}} is over" names whatever the merged page stood
   * on - a policy, Jane, a workflow - so no language may word the name as a
   * policy's: Russian said "Вызов политикой {{name}}", "the page by the
   * policy Jane Doe".
   */
  test.each(Object.entries(POLICY_WORDS))(
    "%s words the take-over line's name as no policy's",
    (code: string, policyWord: string) => {
      const locale: Locale = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIRECTORY, `${code}.json`), "utf8"),
      ) as Locale;

      for (const key of [
        "Their page from {{name}} is over, so this policy pages them now.",
        "Their page from {{name}} is over, so they are paged directly now.",
      ]) {
        const words: string = locale[key] || "";
        const beforeName: string = words.slice(0, words.indexOf("{{name}}"));

        expect(words).toContain("{{name}}");
        expect(beforeName.toLowerCase()).not.toContain(
          policyWord.toLowerCase(),
        );
      }
    },
  );
});

describe("its status, as the pills and the Status filters read it", () => {
  test("a run's line and a person's page are both Already Paged", () => {
    expect(
      ON_CALL_TIMELINE_STATUS_LABELS[
        OnCallDutyExecutionLogTimelineStatus.AlreadyPaged
      ],
    ).toBe("Already Paged");
    expect(
      USER_ON_CALL_LOG_STATUS_LABELS[
        UserNotificationExecutionStatus.AlreadyPaged
      ],
    ).toBe("Already Paged");
  });

  test("each Status filter offers it, filtering by the stored value", () => {
    expect(
      getOnCallTimelineStatusFilterOptions().find(
        (option: DropdownOption): boolean => {
          return (
            option.value === OnCallDutyExecutionLogTimelineStatus.AlreadyPaged
          );
        },
      )?.label,
    ).toBe(ON_CALL_ALREADY_PAGED_STATUS_LABEL);
    expect(
      getUserOnCallLogStatusFilterOptions().find(
        (option: DropdownOption): boolean => {
          return option.value === UserNotificationExecutionStatus.AlreadyPaged;
        },
      )?.label,
    ).toBe(ON_CALL_ALREADY_PAGED_STATUS_LABEL);
  });

  test("it is worded in German and Persian", () => {
    expect(GERMAN.translateText(ON_CALL_ALREADY_PAGED_STATUS_LABEL)).toBe(
      "Bereits alarmiert",
    );
    expect(PERSIAN.translateText(ON_CALL_ALREADY_PAGED_STATUS_LABEL)).toBe(
      "پیش‌تر فراخوانده شده",
    );
  });
});
