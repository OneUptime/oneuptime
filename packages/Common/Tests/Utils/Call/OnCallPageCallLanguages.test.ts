import URL from "../../../Types/API/URL";
import {
  CallRequestMessage,
  GatherInput,
  Say,
} from "../../../Types/Call/CallRequest";
import { CALL_VOICE_READER_LANGUAGES } from "../../../Types/Call/CallVoice";
import { OnCallObserverPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { OnCallPersonPageNotice } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  ON_CALL_TEST_PAGE_CALL_ACKNOWLEDGED,
  ON_CALL_TEST_PAGE_CALL_GREETING,
  ON_CALL_TEST_PAGE_CALL_INVALID_INPUT,
  ON_CALL_TEST_PAGE_CALL_NO_INPUT,
  ON_CALL_TEST_PAGE_CALL_PROMPT,
  getOnCallTestPageCallAcknowledged,
  getOnCallTestPageCallGreeting,
  getOnCallTestPageCallInvalidInput,
  getOnCallTestPageCallNoInput,
  getOnCallTestPageCallPrompt,
  getOnCallTestPageCallWhatItTests,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPageWords";
import { Translator } from "../../../Types/Translator";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
  getCallTranslator,
} from "../../../Server/Utils/ServerTranslation";
import {
  CALL_WRONG_KEY_SENTENCE,
  getCallWrongKeySentence,
} from "../../../Utils/Call/CallKeypad";
import {
  getRecordNumberSpeech,
  getSayRecordNumber,
  getSpeechParts,
  renderSpeechAsText,
  sayRecordNumberInEnglish,
} from "../../../Utils/Call/CallSpeech";
import {
  ON_CALL_PAGE_CALL_PROMPT,
  OnCallPageCallInput,
  buildOnCallPageCallData,
  getOnCallPageCallLeadInLanguage,
  getOnCallPageCallOpening,
  getOnCallPageCallPrompt,
  getOnCallPageCallRecordLabelInLanguage,
} from "../../../Utils/Call/OnCallPageCall";
import { describe, expect, test } from "@jest/globals";

/*
 * A PAGE'S CALL IN THE LANGUAGE OF THE PERSON IT CALLS (#11066).
 *
 * Written with the person's translator, as their texts are: OneUptime's
 * own words in their language - who calls, what the page is, the keys, the
 * words for silence and for a wrong key, every answer - and what the team
 * wrote as written. English stays word for word what every call said.
 */

const RESPONSE_URL: URL = URL.fromString(
  "https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/0fa11066-0000-4000-8000-000000000001?pageToken=t",
);

const KINDS: ReadonlyArray<OnCallObserverPageRecordKind> = [
  "incident",
  "alert",
  "incident episode",
  "alert episode",
];

const ALICE: OnCallPersonPageNotice = { pagedByName: "Alice Kim" };

const NOTICES: ReadonlyArray<[string, OnCallPersonPageNotice]> = [
  ["by name", ALICE],
  ["through a team", { pagedByName: "Alice Kim", teamName: "Platform" }],
  ["through a schedule", { pagedByName: "Alice Kim", scheduleName: "Primary" }],
  [
    "a policy started by hand",
    { pagedByName: "Alice Kim", policyName: "Database escalation" },
  ],
  ["by nobody named", { pagedByName: "  " }],
];

function input(
  overrides: Partial<OnCallPageCallInput> = {},
  record: Partial<OnCallPageCallInput["record"]> = {},
): OnCallPageCallInput {
  return {
    record: {
      noun: "incident",
      number: "INC-42",
      severityName: "Critical Incident",
      title: "Checkout API is down",
      ...record,
    },
    projectName: "Acme Production",
    responseUrl: RESPONSE_URL,
    ...overrides,
  };
}

// Every kind of page a call is placed for.
function everyPage(): Array<[string, OnCallPageCallInput]> {
  const pages: Array<[string, OnCallPageCallInput]> = [];

  for (const noun of KINDS) {
    const record: Partial<OnCallPageCallInput["record"]> = {
      noun: noun,
      severityName: noun.startsWith("incident") ? "Critical Incident" : "High",
    };

    pages.push([`a first page about an ${noun}`, input({}, record)]);
    pages.push([
      `a page again about an ${noun}, with its timeout`,
      input({ pageAgain: { pageAgainNumber: 1, minutes: 30 } }, record),
    ]);
    pages.push([
      `a page again about an ${noun}, without its timeout`,
      input({ pageAgain: { pageAgainNumber: 1 } }, record),
    ]);
    pages.push([
      `an observer's page about an ${noun}`,
      input({ isObserverPage: true }, record),
    ]);

    for (const [how, notice] of NOTICES) {
      pages.push([
        `a person's page about an ${noun}, ${how}`,
        input({ personPage: notice }, record),
      ]);
      pages.push([
        `an observer's person's page about an ${noun}, ${how}`,
        input({ personPage: notice, isObserverPage: true }, record),
      ]);
    }
  }

  return pages;
}

function sentencesOf(data: CallRequestMessage["data"]): Array<Say> {
  return data.filter((item: unknown): boolean => {
    return typeof (item as Say).sayMessage === "string";
  }) as Array<Say>;
}

function promptOf(data: CallRequestMessage["data"]): GatherInput {
  return data.find((item: unknown): boolean => {
    return typeof (item as GatherInput).introMessage === "string";
  }) as GatherInput;
}

// Every text a call speaks or answers with.
function wordsOf(data: CallRequestMessage["data"]): Array<string> {
  const prompt: GatherInput = promptOf(data);

  return [
    ...sentencesOf(data).map((sentence: Say): string => {
      return sentence.sayMessage;
    }),
    prompt.introMessage,
    prompt.noInputMessage,
    ...Object.values(prompt.onInputCallRequest).map((say: Say): string => {
      return say.sayMessage;
    }),
  ];
}

const GERMAN: Translator = getCallTranslator("de");
const JAPANESE: Translator = getCallTranslator("ja");
const ENGLISH: Translator = getCallTranslator("en");

describe("in English", () => {
  test.each(everyPage())(
    "%s says word for word what every call said",
    (_name: string, page: OnCallPageCallInput) => {
      expect(buildOnCallPageCallData(page, ENGLISH)).toEqual(
        buildOnCallPageCallData(page),
      );
    },
  );

  test("the prompt and the wrong key's words are the call's own English", () => {
    expect(getOnCallPageCallPrompt(ENGLISH)).toBe(ON_CALL_PAGE_CALL_PROMPT);
    expect(getOnCallPageCallPrompt()).toBe(
      "Press 1 to acknowledge, or 2 to escalate.",
    );
    expect(getCallWrongKeySentence(ENGLISH)).toBe(CALL_WRONG_KEY_SENTENCE);
    expect(getCallWrongKeySentence()).toBe("That key does nothing.");
  });

  test("a project's name that ends a sentence ends it once, in every language", () => {
    expect(getOnCallPageCallOpening("Acme Inc.")).toBe(
      "This is a call from Acme Inc.",
    );
    expect(getOnCallPageCallOpening("Acme!")).toBe("This is a call from Acme!");
    expect(getOnCallPageCallOpening("Acme Inc.", GERMAN)).toBe(
      "Dies ist ein Anruf von Acme Inc.",
    );
    expect(getOnCallPageCallOpening("", GERMAN)).toBe(
      "Dies ist ein Anruf von OneUptime.",
    );
  });

  test("a test page's call says what it always said", () => {
    expect(getOnCallTestPageCallGreeting()).toBe(
      ON_CALL_TEST_PAGE_CALL_GREETING,
    );
    expect(getOnCallTestPageCallPrompt()).toBe(ON_CALL_TEST_PAGE_CALL_PROMPT);
    expect(getOnCallTestPageCallPrompt()).toBe(
      "To acknowledge this test page, press 1.",
    );
    expect(getOnCallTestPageCallAcknowledged()).toBe(
      ON_CALL_TEST_PAGE_CALL_ACKNOWLEDGED,
    );
    expect(getOnCallTestPageCallNoInput()).toBe(
      ON_CALL_TEST_PAGE_CALL_NO_INPUT,
    );
    expect(getOnCallTestPageCallInvalidInput()).toBe(
      ON_CALL_TEST_PAGE_CALL_INVALID_INPUT,
    );
    expect(
      getOnCallTestPageCallWhatItTests({
        recordKind: OnCallTestPageRecordKind.Incident,
        projectName: "Acme",
        severityName: "Critical",
      }),
    ).toBe(
      "This tests how Acme pages you for an incident of severity Critical.",
    );
    expect(
      getOnCallTestPageCallWhatItTests({
        recordKind: OnCallTestPageRecordKind.Alert,
        projectName: "Acme",
      }),
    ).toBe("This tests how Acme pages you for an alert.");
  });
});

describe("in German", () => {
  const data: CallRequestMessage["data"] = buildOnCallPageCallData(
    input(),
    GERMAN,
  );

  test("says who calls, that a new incident was created, and the record on its own", () => {
    expect(
      sentencesOf(data).map((sentence: Say): string => {
        return sentence.sayMessage;
      }),
    ).toEqual([
      "Dies ist ein Anruf von Acme Production.",
      "Ein neuer Vorfall wurde erstellt.",
      // OneUptime's default severity, in German, as the text message names it.
      "Kritischer Vorfall INC-42.",
      "Checkout API is down",
    ]);
  });

  test("the record carries its number, so its prefix is spelled, and is said again with the prompt", () => {
    const [, lead, record, title] = sentencesOf(data);

    expect(lead).toEqual({
      sayMessage: "Ein neuer Vorfall wurde erstellt.",
      repeated: true,
    });
    expect(record).toEqual({
      sayMessage: "Kritischer Vorfall INC-42.",
      recordNumber: "INC-42",
      repeated: true,
    });
    // The team's title as written, after the prompt.
    expect(title).toEqual({
      sayMessage: "Checkout API is down",
      afterPrompt: true,
      repeated: true,
    });
  });

  test("asks for 1 to acknowledge and 2 to escalate, and words silence and every key", () => {
    const prompt: GatherInput = promptOf(data);

    expect(prompt.introMessage).toBe(
      "Drücken Sie 1, um zu bestätigen, oder 2, um zu eskalieren.",
    );
    expect(prompt.noInputMessage).toBe(
      "Sie haben keine Taste gedrückt, daher ist dieser Vorfall nicht bestätigt. Auf Wiederhören.",
    );
    expect(prompt.onInputCallRequest["1"]?.sayMessage).toBe(
      "Sie haben diesen Vorfall bestätigt. Auf Wiederhören",
    );
    expect(prompt.onInputCallRequest["default"]?.sayMessage).toBe(
      "Diese Taste hat keine Funktion, daher ist dieser Vorfall nicht bestätigt. Auf Wiederhören.",
    );
    // The same listening and the same keys as an English call.
    expect(prompt.numDigits).toBe(1);
    expect(prompt.timeoutInSeconds).toBe(10);
    expect(Object.keys(prompt.onInputCallRequest).sort()).toEqual([
      "1",
      "default",
    ]);
    expect(prompt.responseUrl).toBe(RESPONSE_URL);
  });

  test("words each kind of record its own way", () => {
    expect(
      getOnCallPageCallLeadInLanguage(input({}, { noun: "alert" }), GERMAN),
    ).toBe("Eine neue Warnung wurde erstellt.");
    expect(
      getOnCallPageCallRecordLabelInLanguage(
        { noun: "alert", number: "ALR-7", severityName: "High" },
        GERMAN,
      ),
    ).toBe("Warnung ALR-7 (Hoch)");
    expect(
      promptOf(buildOnCallPageCallData(input({}, { noun: "alert" }), GERMAN))
        .noInputMessage,
    ).toBe(
      "Sie haben keine Taste gedrückt, daher ist diese Warnung nicht bestätigt. Auf Wiederhören.",
    );
  });

  test("a project's own severity reads as written", () => {
    expect(
      getOnCallPageCallRecordLabelInLanguage(
        { noun: "incident", number: "INC-42", severityName: "Sev 1" },
        GERMAN,
      ),
    ).toBe("Vorfall INC-42 (Sev 1)");
  });

  test("a record with neither a severity nor a number says what the page is, and nothing on its own", () => {
    const sentences: Array<Say> = sentencesOf(
      buildOnCallPageCallData(
        input({}, { number: null, severityName: null }),
        GERMAN,
      ),
    );

    expect(
      sentences.map((sentence: Say): string => {
        return sentence.sayMessage;
      }),
    ).toEqual([
      "Dies ist ein Anruf von Acme Production.",
      "Ein neuer Vorfall wurde erstellt.",
      "Checkout API is down",
    ]);
  });

  test("a page again says how long since it was acknowledged, in German", () => {
    /*
     * A duration's figure is held to its word with a no-break space, as
     * every German sentence holds it: a voice reads it as a space.
     */
    expect(
      getOnCallPageCallLeadInLanguage(
        input({ pageAgain: { pageAgainNumber: 1, minutes: 90 } }),
        GERMAN,
      ).replace(/\u00a0/g, " "),
    ).toBe(
      "Ein Vorfall ist 1 Stunde 30 Minuten nach der Bestätigung noch immer nicht behoben.",
    );
    expect(
      getOnCallPageCallLeadInLanguage(
        input({ pageAgain: { pageAgainNumber: 1 } }),
        GERMAN,
      ),
    ).toBe("Ein Vorfall ist nach der Bestätigung noch immer nicht behoben.");
  });

  test("a person's page says who paged, through what, and their message", () => {
    expect(
      getOnCallPageCallLeadInLanguage(
        input({
          personPage: { pagedByName: "Alice Kim", teamName: "Platform" },
        }),
        GERMAN,
      ),
    ).toBe("Alice Kim hat Platform wegen eines Vorfalls alarmiert.");
    expect(
      getOnCallPageCallLeadInLanguage(
        input({
          personPage: { pagedByName: "Alice Kim", policyName: "DB" },
        }),
        GERMAN,
      ),
    ).toBe(
      "Alice Kim hat die Bereitschaftsrichtlinie DB für einen Vorfall gestartet.",
    );
    // Nobody named: "Someone", in German.
    expect(
      getOnCallPageCallLeadInLanguage(
        input({ personPage: { pagedByName: "" } }),
        GERMAN,
      ),
    ).toBe("Jemand hat Sie wegen eines Vorfalls alarmiert.");

    const withMessage: Array<Say> = sentencesOf(
      buildOnCallPageCallData(
        input({
          personPage: { pagedByName: "Alice Kim", message: "Bitte DB prüfen" },
        }),
        GERMAN,
      ),
    );

    expect(withMessage[withMessage.length - 1]).toEqual({
      sayMessage: "Alice Kim sagt: Bitte DB prüfen",
      afterPrompt: true,
    });
  });

  test("an observer's page says what it is, asks for 1 only, and that it acknowledges nothing", () => {
    const observer: CallRequestMessage["data"] = buildOnCallPageCallData(
      input({ isObserverPage: true }),
      GERMAN,
    );

    expect(
      sentencesOf(observer).map((sentence: Say): string => {
        return sentence.sayMessage;
      }),
    ).toEqual([
      "Dies ist ein Anruf von Acme Production.",
      "Sie wurden wegen eines Vorfalls als Beobachter alarmiert.",
      "Kritischer Vorfall INC-42.",
      "Sie bleiben informiert: Die Zuständigen kümmern sich weiter um diesen Vorfall.",
      "Checkout API is down",
    ]);
    expect(promptOf(observer).introMessage).toBe(
      "Um zu bestätigen, dass Sie dies gehört haben, drücken Sie 1. Der Vorfall wird dadurch nicht bestätigt.",
    );
    expect(promptOf(observer).onInputCallRequest["1"]?.sayMessage).toBe(
      "Danke. Die Alarmierung ist als gehört markiert. Auf Wiederhören",
    );
  });

  test("a test page's call is German too", () => {
    expect(getOnCallTestPageCallGreeting(GERMAN)).toBe(
      "Dies ist eine Test-Alarmierung. Alles in Ordnung.",
    );
    expect(getOnCallTestPageCallPrompt(GERMAN)).toBe(
      "Um diese Test-Alarmierung zu bestätigen, drücken Sie 1.",
    );
    expect(
      getOnCallTestPageCallWhatItTests({
        recordKind: OnCallTestPageRecordKind.Alert,
        projectName: "Acme",
        severityName: "Hoch",
        translator: GERMAN,
      }),
    ).toBe(
      "Damit wird getestet, wie Acme Sie bei einer Warnung mit dem Schweregrad Hoch alarmiert.",
    );
  });

  test("a bare number is said in German: Nummer 42", () => {
    expect(
      renderSpeechAsText(
        getRecordNumberSpeech("#42", getSayRecordNumber(GERMAN)),
      ),
    ).toBe("Nummer 42");
    expect(
      renderSpeechAsText(
        getSpeechParts(
          { sayMessage: "Vorfall #42.", recordNumber: "#42" },
          ["#"],
          getSayRecordNumber(GERMAN),
        ),
      ),
    ).toBe("Vorfall Nummer 42.");
    // English as it always was.
    expect(sayRecordNumberInEnglish("42")).toBe("number 42");
    expect(renderSpeechAsText(getRecordNumberSpeech("#42"))).toBe("number 42");
  });
});

describe("in Japanese", () => {
  const data: CallRequestMessage["data"] = buildOnCallPageCallData(
    input(),
    JAPANESE,
  );

  test("ends the record said on its own with Japanese's full stop", () => {
    expect(
      sentencesOf(data).map((sentence: Say): string => {
        return sentence.sayMessage;
      }),
    ).toEqual([
      "Acme Production からのお電話です。",
      "新しいインシデントが作成されました。",
      // The default severity in Japanese, naming the kind already.
      "重大インシデント INC-42。",
      "Checkout API is down",
    ]);
    expect(sentencesOf(data)[2]!.recordNumber).toBe("INC-42");
  });

  test("asks for the same keys", () => {
    expect(promptOf(data).introMessage).toBe(
      "確認するには 1 を、エスカレーションするには 2 を押してください。",
    );
    expect(getCallWrongKeySentence(JAPANESE)).toBe(
      "そのキーには何も割り当てられていません。",
    );
  });

  test("a bare number is said the Japanese way", () => {
    expect(
      renderSpeechAsText(
        getRecordNumberSpeech("#42", getSayRecordNumber(JAPANESE)),
      ),
    ).toBe("42番");
  });
});

describe.each(
  CALL_VOICE_READER_LANGUAGES.map((code: string): [string] => {
    return [code];
  }),
)("in %s", (code: string) => {
  const translator: Translator = getCallTranslator(code);

  test("every page's every word is the language's own: none of the call's English is left", () => {
    for (const [, page] of everyPage()) {
      const english: Array<string> = wordsOf(buildOnCallPageCallData(page));
      const words: Array<string> = wordsOf(
        buildOnCallPageCallData(page, translator),
      );

      // The team's title is said as written, in every language.
      for (const word of words) {
        if (word === "Checkout API is down") {
          continue;
        }

        expect([code, word, english.includes(word)]).toEqual([
          code,
          word,
          false,
        ]);
      }
    }
  });

  test("asks for 1 to acknowledge and 2 to escalate - the digits the keypad route reads - once each", () => {
    const prompt: string = getOnCallPageCallPrompt(translator);

    expect(prompt.split("1")).toHaveLength(2);
    expect(prompt.split("2")).toHaveLength(2);

    for (const noun of KINDS) {
      const observerPrompt: string = promptOf(
        buildOnCallPageCallData(
          input({ isObserverPage: true }, { noun: noun }),
          translator,
        ),
      ).introMessage;

      // An observer's call takes 1, and offers nothing to escalate.
      expect(observerPrompt.split("1")).toHaveLength(2);
      expect(observerPrompt).not.toContain("2");
    }

    expect(getOnCallTestPageCallPrompt(translator).split("1")).toHaveLength(2);
  });

  test("its words go into the call as they are: no isolate marks, which a voice would meet as characters", () => {
    for (const [, page] of everyPage()) {
      for (const word of wordsOf(buildOnCallPageCallData(page, translator))) {
        expect(word).not.toContain(FIRST_STRONG_ISOLATE);
        expect(word).not.toContain(POP_DIRECTIONAL_ISOLATE);
      }
    }
  });

  test("the record said on its own carries its number, and ends as the language ends a sentence", () => {
    const sentences: Array<Say> = sentencesOf(
      buildOnCallPageCallData(input(), translator),
    );
    const record: Say | undefined = sentences.find((sentence: Say) => {
      return sentence.recordNumber === "INC-42";
    });

    expect(record).toBeDefined();
    expect(record!.sayMessage).toContain("INC-42");
    expect(record!.sayMessage).toMatch(/[.。।]$/u);
    expect(record!.repeated).toBe(true);
  });
});
