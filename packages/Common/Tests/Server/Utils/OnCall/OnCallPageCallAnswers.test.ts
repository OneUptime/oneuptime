import {
  CALL_NOT_ACKNOWLEDGED_SENTENCE,
  ON_CALL_PAGE_CALL_GOOD_BYE,
  getCallAnswerEscalated,
  getCallAnswerLanguage,
  getCallAnswerNotAcknowledged,
  getCallAnswerNotEscalated,
  getCallAnswerTranslator,
  getCallAnswerWrongKeySentence,
} from "../../../../Server/Utils/OnCall/OnCallPageCallAnswers";
import { ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE } from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import {
  CALL_LANGUAGE_VOICES,
  CALL_VOICES,
  SpokenCallVoice,
} from "../../../../Types/Call/CallVoice";
import {
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { CALL_WRONG_KEY_SENTENCE } from "../../../../Utils/Call/CallKeypad";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A PAGE'S CALL ANSWERS A KEY WITH, IN THE CALL'S LANGUAGE (#11066).
 *
 * The keypad route words a few answers itself: "That key does nothing."
 * before it asks again, that a 1 could not acknowledge the page, and what
 * escalating did once 2 is pressed. It words them in the language of the
 * voice the call speaks with, which the call's keypad token carries - so a
 * German call is answered in German, by its German voice, and an English
 * one exactly as it always was.
 */

const RESULT: OnCallPassOnResult = {
  outcome: OnCallPassOnOutcome.NextRulePaged,
  isPreview: false,
  isDirectPage: false,
  policyName: "Payments",
  rule: { order: 2, name: "Platform leads" },
  pagedNames: ["Sam Lee"],
  stillPagedNames: [],
  ruleCount: 3,
};

const STILL_PAGED: OnCallPassOnResult = {
  outcome: OnCallPassOnOutcome.OthersStillPaged,
  isPreview: false,
  isDirectPage: false,
  policyName: "Payments",
  pagedNames: [],
  stillPagedNames: ["Bob Smith", "Ana Lopez"],
  nextStepAt: new Date("2026-11-27T05:28:00.000Z"),
  nextRule: { order: 3 },
  ruleCount: 3,
};

describe("the language a call is answered in", () => {
  test("is the language of the voice it speaks with", () => {
    for (const voice of CALL_LANGUAGE_VOICES) {
      expect(getCallAnswerLanguage(voice.value)).toBe(voice.readerLanguage);
    }

    expect(getCallAnswerLanguage("Polly.Vicki-Neural")).toBe("de");
    expect(getCallAnswerLanguage("Google.cmn-TW-Wavenet-B")).toBe("zh-TW");
  });

  test("is English for an English voice, the account's default voice, and any voice off the list", () => {
    for (const voice of CALL_VOICES) {
      expect(getCallAnswerLanguage(voice.value)).toBe("en");
    }

    for (const voice of [undefined, null, "", "man", "Polly.Hans", "x"]) {
      expect(getCallAnswerLanguage(voice)).toBe("en");
    }
  });

  test("its translator is the call's: values go in with no isolate marks, Arabic's too", () => {
    expect(getCallAnswerTranslator("Google.ar-XA-Wavenet-A").language).toBe(
      "ar",
    );
    expect(
      getCallAnswerTranslator("Google.ar-XA-Wavenet-A").translateTemplate(
        "{{pager}} says: {{message}}",
        { pager: "Alice", message: "Hi" },
      ),
    ).toBe("يقول Alice: Hi");
  });
});

describe("before a wrong key is asked again", () => {
  test("says the key does nothing, in the call's language", () => {
    expect(getCallAnswerWrongKeySentence("Polly.Vicki-Neural")).toBe(
      "Diese Taste hat keine Funktion.",
    );
    expect(getCallAnswerWrongKeySentence("Polly.Takumi-Neural")).toBe(
      "そのキーには何も割り当てられていません。",
    );
    expect(getCallAnswerWrongKeySentence("Polly.Lea-Neural")).toBe(
      "Cette touche ne fait rien.",
    );
  });

  test("in English, as it always did", () => {
    for (const voice of [undefined, "Polly.Joanna-Neural"]) {
      expect(getCallAnswerWrongKeySentence(voice)).toBe(
        CALL_WRONG_KEY_SENTENCE,
      );
    }
  });

  test("says it in every language a call is spoken in, never in English", () => {
    for (const voice of CALL_LANGUAGE_VOICES) {
      expect(getCallAnswerWrongKeySentence(voice.value)).not.toBe(
        CALL_WRONG_KEY_SENTENCE,
      );
    }
  });
});

describe("a 1 that could not acknowledge the page", () => {
  test("is the call's sentence, the one the route always said", () => {
    expect(CALL_NOT_ACKNOWLEDGED_SENTENCE).toBe(
      ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE,
    );
    expect(getCallAnswerNotAcknowledged(undefined)).toBe(
      "This page could not be acknowledged just now. Please acknowledge it from the dashboard. Good bye.",
    );
  });

  test("in the call's language", () => {
    expect(getCallAnswerNotAcknowledged("Polly.Vicki-Neural")).toBe(
      "Diese Alarmierung konnte gerade nicht bestätigt werden. Bitte bestätigen Sie sie im Dashboard. Auf Wiederhören.",
    );

    for (const voice of CALL_LANGUAGE_VOICES) {
      expect(getCallAnswerNotAcknowledged(voice.value)).not.toBe(
        CALL_NOT_ACKNOWLEDGED_SENTENCE,
      );
    }
  });
});

describe("a 2 that escalated the page", () => {
  test("in English, says what it always said, word for word", () => {
    for (const result of [RESULT, STILL_PAGED]) {
      expect(
        getCallAnswerEscalated({
          voice: "Polly.Joanna-Neural",
          noun: "incident",
          result: result,
          wording: { timezone: "UTC" },
        }),
      ).toBe(
        `You escalated this incident. ${getOnCallPassOnSentence(result, {
          timezone: "UTC",
        })} Good bye.`,
      );
    }

    expect(
      getCallAnswerEscalated({
        voice: undefined,
        noun: "page",
        result: RESULT,
      }),
    ).toBe(
      "You escalated this page. The policy is now paging Platform leads (Level 2 of 3): Sam Lee. Good bye.",
    );
  });

  test("in German, says it as the Escalate dialog does, and good bye", () => {
    expect(
      getCallAnswerEscalated({
        voice: "Polly.Vicki-Neural",
        noun: "incident",
        result: RESULT,
      }),
    ).toBe(
      "Sie haben diesen Vorfall eskaliert. Die Richtlinie alarmiert jetzt Platform leads (Stufe 2 von 3): Sam Lee. Auf Wiederhören.",
    );
    expect(
      getCallAnswerEscalated({
        voice: "Polly.Daniel-Neural",
        noun: "alert episode",
        result: RESULT,
      }),
    ).toContain("Sie haben diese Warnungsepisode eskaliert.");
  });

  test("names who is still paged, joined in the call's language, and when the policy moves on", () => {
    const sentence: string = getCallAnswerEscalated({
      voice: "Polly.Vicki-Neural",
      noun: "incident",
      result: STILL_PAGED,
      wording: { timezone: "UTC" },
    }).replace(/ /g, " ");

    expect(sentence).toContain("Bob Smith und Ana Lopez");
    expect(sentence).toContain("Stufe 3 von 3");
    expect(sentence.endsWith("Auf Wiederhören.")).toBe(true);
    // The person's own clock: 05:28 UTC.
    expect(sentence).toMatch(/5:28/);
  });

  test("a kind of record the call does not know is a page", () => {
    expect(
      getCallAnswerEscalated({
        voice: "Polly.Vicki-Neural",
        noun: "something else",
        result: RESULT,
      }),
    ).toContain("Sie haben diese Alarmierung eskaliert.");
  });

  test("in every language a call is spoken in, none of it is English", () => {
    const english: string = getCallAnswerEscalated({
      voice: undefined,
      noun: "incident",
      result: RESULT,
    });

    for (const voice of CALL_LANGUAGE_VOICES) {
      const said: string = getCallAnswerEscalated({
        voice: voice.value,
        noun: "incident",
        result: RESULT,
      });

      expect(said).not.toBe(english);
      expect(said).not.toContain("You escalated");
      expect(said).not.toContain("Good bye");
      expect(said).not.toContain("is now paging");
      // The level's name and the people, as the team wrote them.
      expect(said).toContain("Platform leads");
      expect(said).toContain("Sam Lee");
    }
  });
});

describe("a 2 that could not escalate the page", () => {
  const ACKNOWLEDGED: {
    passedOn: boolean;
    refusal: OnCallPassOnRefusal;
    acknowledgedByName: string;
  } = {
    passedOn: false,
    refusal: OnCallPassOnRefusal.RecordAcknowledged,
    acknowledgedByName: "Ana Lopez",
  };

  test("in English, says why as it always did", () => {
    expect(
      getCallAnswerNotEscalated({
        voice: undefined,
        answer: ACKNOWLEDGED,
        wording: { recordLabel: "This incident" },
      }),
    ).toBe(
      `${getOnCallPassOnRefusalSentence(ACKNOWLEDGED, {
        recordLabel: "This incident",
      })} Good bye.`,
    );
    expect(
      getCallAnswerNotEscalated({
        voice: "Polly.Joanna-Neural",
        answer: { passedOn: false, refusal: OnCallPassOnRefusal.NotPaged },
      }),
    ).toBe("You are not being paged about this right now. Good bye.");
  });

  test("in the call's language, as the Escalate dialog says why", () => {
    expect(
      getCallAnswerNotEscalated({
        voice: "Polly.Vicki-Neural",
        answer: { passedOn: false, refusal: OnCallPassOnRefusal.NotPaged },
      }),
    ).toBe("Sie werden dazu gerade nicht alarmiert. Auf Wiederhören.");
    expect(
      getCallAnswerNotEscalated({
        voice: "Polly.Vicki-Neural",
        answer: ACKNOWLEDGED,
        wording: { recordLabel: "This incident" },
      }),
    ).toBe(
      "Ana Lopez hat es bereits bestätigt, daher gibt es nichts zu eskalieren. Auf Wiederhören.",
    );

    for (const refusal of Object.values(OnCallPassOnRefusal)) {
      for (const voice of CALL_LANGUAGE_VOICES.filter(
        (each: SpokenCallVoice): boolean => {
          return each.gender === "female";
        },
      )) {
        const said: string = getCallAnswerNotEscalated({
          voice: voice.value,
          answer: { passedOn: false, refusal: refusal },
        });

        expect(said).not.toContain("Good bye");
        expect(said.endsWith(ON_CALL_PAGE_CALL_GOOD_BYE)).toBe(false);
      }
    }
  });
});
