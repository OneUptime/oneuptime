import { describe, expect, test } from "@jest/globals";
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
  getOnCallPageMergeTakenOverMessage,
  getOnCallPageMergedMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * A PAGE MERGED INTO THE PERSON'S OPEN PAGE FROM ANOTHER POLICY'S RUN, IN
 * THE DASHBOARD (issue #7837, OnCallPageMerge).
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
