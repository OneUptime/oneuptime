import { OnCallTestPageRecordKind } from "./OnCallTestPage";
import { getEnglishPageTranslator } from "./OnCallPageWords";
import { translationKey, Translator } from "../Translator";

/*
 * WHAT A TEST PAGE SAYS, IN THE LANGUAGE OF THE PERSON IT PAGES.
 *
 * A test page (OnCallTestPage) reaches a person through the same channels a
 * real page does, and every message says TEST in its first words - in the
 * person's language, as every page's words are (Types/UserLanguage,
 * Common/Server/Locales) - and that nothing is wrong. Each sentence is a
 * whole sentence for each kind of record the test stands in for, so a
 * language words "an incident" and "an alert" its own way.
 *
 * A call is in the person's language too, spoken by a voice of that
 * language where the call has one (#11066), and English otherwise.
 * WhatsApp sends the test message Meta approved.
 *
 * Pure, with no Node, browser or database APIs.
 */

// A fixed sentence in a translator's language; English without one.
const say: (translator: Translator | undefined, sentence: string) => string = (
  translator: Translator | undefined,
  sentence: string,
): string => {
  return (
    (translator || getEnglishPageTranslator()).translateText(sentence) ||
    sentence
  );
};

// "TEST page from OneUptime": the first words of every message.
export const getOnCallTestPageHeadline: (
  translator: Translator,
  productName: string,
) => string = (translator: Translator, productName: string): string => {
  return translator.translateTemplate(
    translationKey("TEST page from {{product}}"),
    { product: productName },
  );
};

/*
 * What the test is, and that nothing is wrong: "Nothing is wrong. This
 * tests how Acme pages you for an incident of severity Critical."
 */
export const getOnCallTestPageWhatItTests: (
  translator: Translator,
  data: {
    recordKind: OnCallTestPageRecordKind;
    projectName: string;
    severityName: string;
  },
) => string = (
  translator: Translator,
  data: {
    recordKind: OnCallTestPageRecordKind;
    projectName: string;
    severityName: string;
  },
): string => {
  const values: { project: string; severity: string } = {
    project: data.projectName,
    severity: data.severityName,
  };

  return data.recordKind === OnCallTestPageRecordKind.Alert
    ? translator.translateTemplate(
        translationKey(
          "Nothing is wrong. This tests how {{project}} pages you for an alert of severity {{severity}}.",
        ),
        values,
      )
    : translator.translateTemplate(
        translationKey(
          "Nothing is wrong. This tests how {{project}} pages you for an incident of severity {{severity}}.",
        ),
        values,
      );
};

// What the person is asked to do.
export const getOnCallTestPageAskToAcknowledge: (
  translator: Translator,
) => string = (translator: Translator): string => {
  const sentence: string = translationKey("Acknowledge it to finish the test.");

  return translator.translateText(sentence) || sentence;
};

// The link, or the button, that acknowledges a test page.
export const getOnCallTestPageAcknowledgeLabel: (
  translator: Translator,
) => string = (translator: Translator): string => {
  const sentence: string = translationKey("Acknowledge test page");

  return translator.translateText(sentence) || sentence;
};

/*
 * Who sent the test, and why this person: themselves, an admin, or a test
 * of a policy that pages them. Empty when nobody is known to have sent it.
 */
export const getOnCallTestPageSentBy: (
  translator: Translator,
  data: {
    isSentBySelf: boolean;
    senderName: string;
    policyName?: string | undefined;
  },
) => string = (
  translator: Translator,
  data: {
    isSentBySelf: boolean;
    senderName: string;
    policyName?: string | undefined;
  },
): string => {
  const senderName: string = data.senderName.trim();
  const policyName: string = (data.policyName || "").trim();

  if (policyName) {
    return translator.translateTemplate(
      translationKey(
        "{{name}} is testing the on-call policy {{policy}}, which pages you.",
      ),
      { name: senderName || "OneUptime", policy: policyName },
    );
  }

  if (data.isSentBySelf) {
    const sentence: string = translationKey(
      "You sent yourself this test page.",
    );

    return translator.translateText(sentence) || sentence;
  }

  if (!senderName) {
    return "";
  }

  return translator.translateTemplate(
    translationKey("{{name}} sent you this test page."),
    { name: senderName },
  );
};

/*
 * The test's text message, whole: TEST first, the project, that nothing is
 * wrong, and the link to acknowledge it. The link goes in as it is, after a
 * space, in every language, so a phone makes it a link.
 */
export const getOnCallTestPageSmsText: (
  translator: Translator,
  data: { productName: string; projectName: string; link: string },
) => string = (
  translator: Translator,
  data: { productName: string; projectName: string; link: string },
): string => {
  return translator.translateTemplate(
    translationKey(
      "TEST page from {{product}} for {{project}}: nothing is wrong. Acknowledge: {{link}}",
    ),
    {
      product: data.productName,
      project: data.projectName,
      link: data.link,
    },
  );
};

// The test's email subject.
export const getOnCallTestPageEmailSubject: (
  translator: Translator,
  projectName: string,
) => string = (translator: Translator, projectName: string): string => {
  return translator.translateTemplate(
    translationKey("TEST page from {{project}}: nothing is wrong"),
    { project: projectName },
  );
};

/*
 * THE CALL, said as a real page's call is (Utils/Call/OnCallPageCall): who
 * calls, that it is a test and nothing is wrong, to press 1 to acknowledge
 * it, then what it tests - and all but who calls said again with the prompt
 * while no key is pressed. In the person's language, as a page's call is
 * (#11066), and spoken by a voice of that language - else in English, word
 * for word as it always was. The English constants are each sentence's key.
 */
export const ON_CALL_TEST_PAGE_CALL_GREETING: string = translationKey(
  "This is a test page. Nothing is wrong.",
);

// The key that acknowledges a test page, in every language.
export const ON_CALL_TEST_PAGE_CALL_DIGIT: string = "1";

// The greeting in the call's language.
export const getOnCallTestPageCallGreeting: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  return say(translator, ON_CALL_TEST_PAGE_CALL_GREETING);
};

/*
 * What the test is for: "This tests how Acme pages you for an incident of
 * severity Critical." - or, for a test that stands in for no severity, "for
 * an incident" - in the call's language.
 */
export const getOnCallTestPageCallWhatItTests: (data: {
  recordKind: OnCallTestPageRecordKind;
  projectName: string;
  severityName?: string | null | undefined;
  translator?: Translator | undefined;
}) => string = (data: {
  recordKind: OnCallTestPageRecordKind;
  projectName: string;
  severityName?: string | null | undefined;
  translator?: Translator | undefined;
}): string => {
  const translator: Translator = data.translator || getEnglishPageTranslator();
  const severityName: string = (data.severityName || "").trim();
  const isAlert: boolean = data.recordKind === OnCallTestPageRecordKind.Alert;

  if (!severityName) {
    return translator.translateTemplate(
      isAlert
        ? translationKey("This tests how {{project}} pages you for an alert.")
        : translationKey(
            "This tests how {{project}} pages you for an incident.",
          ),
      { project: data.projectName },
    );
  }

  return translator.translateTemplate(
    isAlert
      ? translationKey(
          "This tests how {{project}} pages you for an alert of severity {{severity}}.",
        )
      : translationKey(
          "This tests how {{project}} pages you for an incident of severity {{severity}}.",
        ),
    { project: data.projectName, severity: severityName },
  );
};

// What the test's call asks for: its key is 1 in every language.
const CALL_PROMPT: string = translationKey(
  "To acknowledge this test page, press {{key}}.",
);

export const ON_CALL_TEST_PAGE_CALL_PROMPT: string = `To acknowledge this test page, press ${ON_CALL_TEST_PAGE_CALL_DIGIT}.`;

export const getOnCallTestPageCallPrompt: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  return (translator || getEnglishPageTranslator()).translateTemplate(
    CALL_PROMPT,
    { key: ON_CALL_TEST_PAGE_CALL_DIGIT },
  );
};

export const ON_CALL_TEST_PAGE_CALL_ACKNOWLEDGED: string = translationKey(
  "You have acknowledged this test page. It works. Good bye",
);

export const getOnCallTestPageCallAcknowledged: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  return say(translator, ON_CALL_TEST_PAGE_CALL_ACKNOWLEDGED);
};

export const ON_CALL_TEST_PAGE_CALL_NO_INPUT: string = translationKey(
  "You did not press a key, so this test page is not acknowledged. Good bye.",
);

export const getOnCallTestPageCallNoInput: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  return say(translator, ON_CALL_TEST_PAGE_CALL_NO_INPUT);
};

/*
 * What the test's call says to a wrong key once it has asked again as often
 * as it may (Utils/Call/CallKeypad), before it ends.
 */
export const ON_CALL_TEST_PAGE_CALL_INVALID_INPUT: string = translationKey(
  "That key does nothing, so this test page is not acknowledged. Good bye.",
);

export const getOnCallTestPageCallInvalidInput: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  return say(translator, ON_CALL_TEST_PAGE_CALL_INVALID_INPUT);
};
