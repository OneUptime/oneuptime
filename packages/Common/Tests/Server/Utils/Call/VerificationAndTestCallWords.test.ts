import getCallInLanguage from "../../../../Server/Utils/Call/CallInLanguage";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
  SERVER_LOCALES,
  getCallTranslator,
} from "../../../../Server/Utils/ServerTranslation";
import {
  CallInLanguage,
  CallRequestMessage,
  Say,
} from "../../../../Types/Call/CallRequest";
import { DEFAULT_READER_LANGUAGE } from "../../../../Types/ReaderLanguage";
import { Translator } from "../../../../Types/Translator";
import { writeCodeForCall } from "../../../../Utils/Call/CallSpeech";
import { getOnCallPageCallOpening } from "../../../../Utils/Call/OnCallPageCall";
import {
  PROJECT_TEST_CALL_ENGLISH,
  PROJECT_TEST_CALL_SENTENCE,
  SERVER_TEST_CALL_ENGLISH,
  SERVER_TEST_CALL_SENTENCE,
  getProjectTestCallData,
  getServerTestCallData,
} from "../../../../Utils/Call/TestCall";
import {
  VERIFICATION_CALL_CODE_REPEATS,
  VERIFICATION_CALL_CODE_SENTENCE,
  VERIFICATION_CALL_GOODBYE,
  getVerificationCallData,
} from "../../../../Utils/Call/VerificationCodeCall";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THE VERIFICATION CALL AND SEND TEST CALL SAY, IN EVERY LANGUAGE
 * (#11461).
 *
 * Both were English only. They are built as an on-call page's call is: in
 * English, word for word as before - what a Notification service of the
 * release before, an account that keeps its default voice and a person who
 * reads English hear - and, for a person who reads another language, in
 * theirs too (CallRequest's inLanguage, with getCallTranslator). The code
 * of a verification call is carried by each sentence that says it, three
 * times, so a voice says it a digit at a time in any language. Every
 * language OneUptime writes in gets its words, Persian too: Twilio says a
 * Persian reader's call in English, but a call and SMS gateway picks its
 * own voice (#11459).
 */

const LANGUAGES: Array<string> = Object.keys(SERVER_LOCALES).filter(
  (language: string): boolean => {
    return language !== DEFAULT_READER_LANGUAGE;
  },
);

const CODE: string = "048291";
const WRITTEN_CODE: string = "0  4  8  2  9  1";

// The verification call every release made, as UserCallService wrote it.
function legacyVerificationCall(code: string): CallRequestMessage["data"] {
  const spokenCode: string = code.split("").join("  ");

  return [
    { sayMessage: "This is a call from OneUptime." },
    { sayMessage: "Your verification code is " + spokenCode },
    { sayMessage: "Your verification code is " + spokenCode },
    { sayMessage: "Your verification code is " + spokenCode },
    { sayMessage: "Thank you for using OneUptime. Good bye." },
  ];
}

function sentencesOf(data: CallRequestMessage["data"]): Array<Say> {
  return data as Array<Say>;
}

// What a language's locale says for a key: its own words, never the English left in.
function wordingOf(language: string, key: string): string {
  const wording: string | undefined = SERVER_LOCALES[language]![key];

  expect(wording).toBeDefined();

  return wording!;
}

// How a sentence of a language ends: a full stop of its own script.
const ENDS_A_SENTENCE: RegExp = /[.。।]$/u;

describe("the verification call in English", () => {
  test("is word for word the call every release made", () => {
    expect(getVerificationCallData(CODE)).toEqual(legacyVerificationCall(CODE));
    expect(getVerificationCallData("123456")).toEqual(
      legacyVerificationCall("123456"),
    );
  });

  test("carries no code field: an English call says its code as it always did", () => {
    for (const sentence of sentencesOf(getVerificationCallData(CODE))) {
      expect(sentence.code).toBeUndefined();
      expect(Object.keys(sentence)).toEqual(["sayMessage"]);
    }
  });

  test("says the code three times, spaced out", () => {
    expect(VERIFICATION_CALL_CODE_REPEATS).toBe(3);
    expect(
      sentencesOf(getVerificationCallData(CODE)).filter(
        (sentence: Say): boolean => {
          return sentence.sayMessage.includes(WRITTEN_CODE);
        },
      ),
    ).toHaveLength(3);
  });

  test("the keys of its other languages are its own sentences", () => {
    expect(VERIFICATION_CALL_CODE_SENTENCE).toBe(
      "Your verification code is {{code}}.",
    );
    expect(VERIFICATION_CALL_GOODBYE).toBe(
      "Thank you for using {{product}}. Good bye.",
    );
  });
});

describe("Send Test Call in English", () => {
  test("Make test call, on the Admin Dashboard: word for word as before", () => {
    expect(SERVER_TEST_CALL_ENGLISH).toBe(
      "This is a test call from OneUptime. Calls from this server work.",
    );
    expect(getServerTestCallData()).toEqual([
      { sayMessage: SERVER_TEST_CALL_ENGLISH },
    ]);
  });

  test("a project's Twilio config: word for word as before", () => {
    expect(PROJECT_TEST_CALL_ENGLISH).toBe(
      "This is a test call from OneUptime.",
    );
    expect(getProjectTestCallData()).toEqual([
      { sayMessage: PROJECT_TEST_CALL_ENGLISH },
    ]);
  });

  test("the English translator says the same words", () => {
    const english: Translator = getCallTranslator("en");

    expect(getServerTestCallData(english)).toEqual(getServerTestCallData());
    expect(getProjectTestCallData(english)).toEqual(getProjectTestCallData());
    expect(SERVER_TEST_CALL_SENTENCE).toBe(
      "This is a test call from {{product}}. Calls from this server work.",
    );
    expect(PROJECT_TEST_CALL_SENTENCE).toBe(
      "This is a test call from {{product}}.",
    );
  });
});

describe.each(
  LANGUAGES.map((language: string): [string] => {
    return [language];
  }),
)("in %s", (language: string) => {
  const translator: Translator = getCallTranslator(language);

  test("the locale words each new sentence itself, keeping its placeholder and its full stop", () => {
    for (const [key, placeholder] of [
      [VERIFICATION_CALL_CODE_SENTENCE, "{{code}}"],
      [VERIFICATION_CALL_GOODBYE, "{{product}}"],
      [SERVER_TEST_CALL_SENTENCE, "{{product}}"],
      [PROJECT_TEST_CALL_SENTENCE, "{{product}}"],
    ] as Array<[string, string]>) {
      const wording: string = wordingOf(language, key);

      expect([key, wording]).not.toEqual([key, key]);
      expect([key, wording.split(placeholder).length - 1]).toEqual([key, 1]);
      expect([key, ENDS_A_SENTENCE.test(wording)]).toEqual([key, true]);
    }
  });

  test("the verification call: who calls, the code three times - each sentence carrying it - and goodbye, all in the language", () => {
    const sentences: Array<Say> = sentencesOf(
      getVerificationCallData(CODE, translator),
    );
    const english: Array<Say> = sentencesOf(getVerificationCallData(CODE));

    expect(sentences).toHaveLength(5);
    expect(sentences[0]!.sayMessage).toBe(
      getOnCallPageCallOpening(undefined, translator),
    );

    for (const index of [1, 2, 3]) {
      const sentence: Say = sentences[index]!;

      expect(sentence.code).toBe(WRITTEN_CODE);
      expect(sentence.sayMessage).toContain(WRITTEN_CODE);
      expect(sentence.sayMessage).toBe(
        translator.translateTemplate(VERIFICATION_CALL_CODE_SENTENCE, {
          code: WRITTEN_CODE,
        }),
      );
    }

    expect(sentences[4]!.sayMessage).toContain("OneUptime");
    expect(sentences[4]!.code).toBeUndefined();

    // None of its sentences is the English one.
    sentences.forEach((sentence: Say, index: number): void => {
      expect([index, sentence.sayMessage]).not.toEqual([
        index,
        english[index]!.sayMessage,
      ]);
    });
  });

  test("the code is written once in each sentence, its digits as they are - never the language's own digits", () => {
    for (const sentence of sentencesOf(
      getVerificationCallData(CODE, translator),
    ).slice(1, 4)) {
      expect(sentence.sayMessage.split(WRITTEN_CODE).length - 1).toBe(1);
    }
  });

  test("no sentence carries the marks a page sets a value apart with: a voice would meet them", () => {
    const said: string = JSON.stringify([
      ...getVerificationCallData(CODE, translator),
      ...getServerTestCallData(translator),
      ...getProjectTestCallData(translator),
    ]);

    expect(said).not.toContain(FIRST_STRONG_ISOLATE);
    expect(said).not.toContain(POP_DIRECTIONAL_ISOLATE);
  });

  test("the test calls: one sentence each, in the language, naming the product", () => {
    for (const [data, english] of [
      [getServerTestCallData(translator), SERVER_TEST_CALL_ENGLISH],
      [getProjectTestCallData(translator), PROJECT_TEST_CALL_ENGLISH],
    ] as Array<[CallRequestMessage["data"], string]>) {
      const sentences: Array<Say> = sentencesOf(data);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]!.sayMessage).not.toBe(english);
      expect(sentences[0]!.sayMessage).toContain("OneUptime");
    }
  });

  test("a call to a person who reads it carries its words in it, beside the English (getCallInLanguage)", () => {
    const inLanguage: CallInLanguage | undefined = getCallInLanguage(
      language,
      (callTranslator: Translator): CallRequestMessage["data"] => {
        return getVerificationCallData(CODE, callTranslator);
      },
    );

    expect(inLanguage).toEqual({
      language: language,
      data: getVerificationCallData(CODE, translator),
    });
  });
});

describe("which calls carry words in another language (getCallInLanguage)", () => {
  const build: (translator: Translator) => CallRequestMessage["data"] = (
    translator: Translator,
  ): CallRequestMessage["data"] => {
    return getServerTestCallData(translator);
  };

  test("none for a person who reads English: the call is its English alone", () => {
    expect(getCallInLanguage("en", build)).toBeUndefined();
    expect(getCallInLanguage("en-GB", build)).toBeUndefined();
  });

  test("none for no language, or one OneUptime does not write in", () => {
    for (const language of [undefined, null, "", "xx", "klingon"]) {
      expect(getCallInLanguage(language, build)).toBeUndefined();
    }
  });

  test("a language tag of a region is its language", () => {
    expect(getCallInLanguage("de-AT", build)?.language).toBe("de");
    expect(getCallInLanguage("pt-BR", build)?.language).toBe("pt");
  });

  test("Persian too, which no Twilio voice speaks: a call and SMS gateway picks its own voice", () => {
    const inLanguage: CallInLanguage | undefined = getCallInLanguage(
      "fa",
      build,
    );

    expect(inLanguage?.language).toBe("fa");
    expect((inLanguage!.data[0] as Say).sayMessage).toBe(
      wordingOf("fa", SERVER_TEST_CALL_SENTENCE).replace(
        "{{product}}",
        "OneUptime",
      ),
    );
  });

  test("the words are built with the language's call translator, once", () => {
    const languagesBuilt: Array<string> = [];

    getCallInLanguage("ja", (translator: Translator) => {
      languagesBuilt.push(translator.language);
      return [];
    });

    expect(languagesBuilt).toEqual(["ja"]);
  });

  test("the code a call carries in another language is the code the English says", () => {
    for (const language of LANGUAGES) {
      const english: Array<Say> = sentencesOf(getVerificationCallData(CODE));
      const inLanguage: Array<Say> = sentencesOf(
        getCallInLanguage(language, (translator: Translator) => {
          return getVerificationCallData(CODE, translator);
        })!.data,
      );

      expect(english[1]!.sayMessage.endsWith(inLanguage[1]!.code!)).toBe(true);
      expect(writeCodeForCall(CODE)).toBe(inLanguage[1]!.code);
    }
  });
});
