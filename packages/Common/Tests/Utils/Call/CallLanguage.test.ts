import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import {
  SpokenCall,
  getSpokenCall,
  getSpokenCalls,
} from "../../../Utils/Call/CallLanguage";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH OF A CALL'S WORDS ARE SPOKEN, AND BY WHICH VOICE (#11066).
 *
 * A call to a person who reads another language carries its words twice:
 * English in `data`, theirs in `inLanguage`. Theirs are spoken only by a
 * voice of their language, of the kind the account chose; anything else
 * speaks English, as every call did. One language's words never go to
 * another language's voice.
 */

const ENGLISH: CallRequestMessage["data"] = [
  { sayMessage: "This is a call from Acme." },
];

const GERMAN: CallRequestMessage["data"] = [
  { sayMessage: "Dies ist ein Anruf von Acme." },
];

const call: (inLanguage?: unknown) => CallRequestMessage = (
  inLanguage?: unknown,
): CallRequestMessage => {
  return {
    data: ENGLISH,
    ...(inLanguage === undefined
      ? {}
      : { inLanguage: inLanguage as CallRequestMessage["inLanguage"] }),
  };
};

const ENGLISH_IN: (voice: string | undefined) => SpokenCall = (
  voice: string | undefined,
): SpokenCall => {
  return { data: ENGLISH, voice: voice, language: "en" };
};

describe("a call with no words in another language", () => {
  test("is spoken in English, by the voice the account chose, or its default", () => {
    expect(getSpokenCalls(call(), "Polly.Joanna-Neural")).toEqual([
      ENGLISH_IN("Polly.Joanna-Neural"),
    ]);
    expect(getSpokenCalls(call(), undefined)).toEqual([ENGLISH_IN(undefined)]);
  });

  test("a voice off the list is the account's default, as it always was", () => {
    expect(getSpokenCalls(call(), "Polly.Joanna")).toEqual([
      ENGLISH_IN(undefined),
    ]);
  });
});

describe("a call in another language", () => {
  test("is spoken in it by its voice of the account's kind, English after it should that not build", () => {
    expect(
      getSpokenCalls(
        call({ language: "de", data: GERMAN }),
        "Polly.Joanna-Neural",
      ),
    ).toEqual([
      { data: GERMAN, voice: "Polly.Vicki-Neural", language: "de" },
      ENGLISH_IN("Polly.Joanna-Neural"),
    ]);

    expect(
      getSpokenCall(
        call({ language: "de", data: GERMAN }),
        "Polly.Matthew-Neural",
      ),
    ).toEqual({ data: GERMAN, voice: "Polly.Daniel-Neural", language: "de" });
  });

  test("through an account that chose no voice is English: its default voice speaks no other language", () => {
    expect(
      getSpokenCalls(call({ language: "de", data: GERMAN }), undefined),
    ).toEqual([ENGLISH_IN(undefined)]);
    expect(getSpokenCalls(call({ language: "de", data: GERMAN }), "")).toEqual([
      ENGLISH_IN(undefined),
    ]);
  });

  test("whose language no provider has a voice for is English (Persian)", () => {
    expect(
      getSpokenCalls(
        call({ language: "fa", data: [{ sayMessage: "تماس" }] }),
        "Polly.Joanna-Neural",
      ),
    ).toEqual([ENGLISH_IN("Polly.Joanna-Neural")]);
  });

  test("an account whose voice is another language's is no voice at all: its English is never read by it", () => {
    expect(
      getSpokenCalls(
        call({ language: "de", data: GERMAN }),
        "Polly.Vicki-Neural",
      ),
    ).toEqual([ENGLISH_IN(undefined)]);
  });

  test("names its language as OneUptime does: Austria's German is German", () => {
    expect(
      getSpokenCall(
        call({ language: "de-AT", data: GERMAN }),
        "Polly.Joanna-Neural",
      ),
    ).toEqual({ data: GERMAN, voice: "Polly.Vicki-Neural", language: "de" });
  });

  test("in English, or a language OneUptime does not write in, is the English call", () => {
    for (const language of ["en", "EN", "tlh", "xx-YY"]) {
      expect(
        getSpokenCalls(
          call({ language: language, data: GERMAN }),
          "Polly.Joanna-Neural",
        ),
      ).toEqual([ENGLISH_IN("Polly.Joanna-Neural")]);
    }
  });

  test("anything but words and a language is no call in another language", () => {
    for (const inLanguage of [
      null,
      "de",
      42,
      [],
      { language: "de" },
      { language: "de", data: [] },
      { language: "de", data: "Dies ist ein Anruf." },
      { language: 7, data: GERMAN },
      { data: GERMAN },
    ]) {
      expect(getSpokenCalls(call(inLanguage), "Polly.Joanna-Neural")).toEqual([
        ENGLISH_IN("Polly.Joanna-Neural"),
      ]);
    }
  });
});
