import {
  CALL_VOICES,
  CALL_VOICE_CHARACTERS_IN_A_PAGE,
  CALL_VOICE_MOST_CHARACTERS_IN_A_PAGE,
  CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD,
  CALL_VOICE_VALUES,
  CallVoice,
  CallVoiceGender,
  CallVoiceLanguage,
  CallVoiceProvider,
  getCallVoice,
  getCallVoiceCentsOfAPage,
  getCallVoiceCostOfAPageInUsd,
  getCallVoiceError,
  toCallVoiceValue,
  toStoredCallVoice,
} from "../../../Types/Call/CallVoice";
import { describe, expect, test } from "@jest/globals";

/*
 * THE VOICES ONEUPTIME'S CALLS CAN SPEAK WITH (#10948).
 *
 * A short list rather than a free-text field: each voice is one Twilio
 * names, in English - a call in another language speaks it with that
 * language's voice of its kind (CallLanguageVoices, #11066) - reads the SSML a
 * call uses, and is named
 * in TwiML only as the list writes it - with the language it speaks, which
 * Twilio needs beside it. Anything else is no voice: the account's default.
 */

const ISSUE_EXAMPLES: ReadonlyArray<string> = [
  "Polly.Joanna-Neural",
  "Polly.Matthew-Neural",
  "Google.en-US-Neural2-F",
];

describe("the list", () => {
  test("is short, and holds the voices the issue named", () => {
    expect(CALL_VOICES.length).toBeGreaterThanOrEqual(ISSUE_EXAMPLES.length);
    expect(CALL_VOICES.length).toBeLessThanOrEqual(8);

    for (const example of ISSUE_EXAMPLES) {
      expect(CALL_VOICE_VALUES).toContain(example);
    }
  });

  test("names each voice once, as Twilio's <Say voice> takes it: its provider, a dot, its name", () => {
    expect(new Set(CALL_VOICE_VALUES).size).toBe(CALL_VOICE_VALUES.length);

    for (const voice of CALL_VOICES) {
      const prefix: string =
        voice.provider === CallVoiceProvider.AmazonPolly ? "Polly." : "Google.";

      expect(voice.value.startsWith(prefix)).toBe(true);
      // Nothing that needs escaping in an attribute, and no space.
      expect(voice.value).toMatch(/^[A-Za-z0-9.-]+$/);
    }
  });

  test("every voice is a neural one, Twilio's natural-sounding tier, never Basic, standard or generative", () => {
    for (const voice of CALL_VOICES) {
      expect(
        voice.value.endsWith("-Neural") || voice.value.includes("-Neural2-"),
      ).toBe(true);
      expect(voice.value).not.toMatch(/Generative|Chirp|Standard|Wavenet/);
      expect(["man", "woman", "alice"]).not.toContain(voice.value);
    }
  });

  test("every voice an admin chooses speaks English, in the language <Say> is told it speaks", () => {
    for (const voice of CALL_VOICES) {
      expect(Object.values(CallVoiceLanguage)).toContain(voice.language);
      expect(voice.language.startsWith("en-")).toBe(true);

      // A Google voice's name carries its language: the two must agree.
      if (voice.provider === CallVoiceProvider.Google) {
        expect(voice.value).toContain(`.${voice.language}-`);
      }
    }

    // Polly's British voices speak en-GB, whose <Say> fails without it.
    expect(getCallVoice("Polly.Amy-Neural")?.language).toBe(
      CallVoiceLanguage.BritishEnglish,
    );
    expect(getCallVoice("Polly.Brian-Neural")?.language).toBe(
      CallVoiceLanguage.BritishEnglish,
    );
    expect(getCallVoice("Polly.Joanna-Neural")?.language).toBe(
      CallVoiceLanguage.USEnglish,
    );
  });

  test("offers a woman's and a man's voice for each language and each provider it lists", () => {
    const kinds: Set<string> = new Set(
      CALL_VOICES.map((voice: CallVoice): string => {
        return `${voice.provider} ${voice.language} ${voice.gender}`;
      }),
    );

    for (const voice of CALL_VOICES) {
      for (const gender of Object.values(CallVoiceGender)) {
        expect(kinds).toContain(
          `${voice.provider} ${voice.language} ${gender}`,
        );
      }
    }
  });

  test("every voice reads SSML: a record number's prefix is spelled with say-as", () => {
    for (const voice of CALL_VOICES) {
      expect(voice.readsSsml).toBe(true);
    }
  });

  test("cannot be changed at run time", () => {
    expect(Object.isFrozen(CALL_VOICES)).toBe(true);
    expect(Object.isFrozen(CALL_VOICE_VALUES)).toBe(true);
  });
});

describe("a voice a value names", () => {
  test("is the listed voice, written as the list writes it, the spaces around it let go", () => {
    for (const voice of CALL_VOICES) {
      expect(getCallVoice(voice.value)).toBe(voice);
      expect(getCallVoice(`  ${voice.value}\n`)).toBe(voice);
      expect(toCallVoiceValue(` ${voice.value} `)).toBe(voice.value);
    }
  });

  test("is none for anything else: no voice is ever named that the list does not hold", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      42,
      {},
      ["Polly.Joanna-Neural"],
      "man",
      "woman",
      "alice",
      "Polly.Joanna",
      "Polly.Joanna-Generative",
      "Google.en-US-Standard-C",
      "Google.en-US-Chirp3-HD-Aoede",
      "polly.joanna-neural",
      "POLLY.JOANNA-NEURAL",
      "Polly. Joanna-Neural",
      'Polly.Joanna-Neural" language="xx',
      "Polly.Joanna-Neural><Dial>+19005550100</Dial>",
      "Polly.Joanna-Neural\u0000",
    ]) {
      expect({ value, voice: getCallVoice(value) }).toEqual({
        value,
        voice: null,
      });
      expect(toCallVoiceValue(value)).toBeUndefined();
    }
  });
});

describe("a voice a write gives", () => {
  test("is taken when it is a voice of the list, or none", () => {
    for (const value of [undefined, null, "", "  ", ...CALL_VOICE_VALUES]) {
      expect(getCallVoiceError(value)).toBeNull();
    }
  });

  test("is refused otherwise, saying which voices there are and that empty is the account's default", () => {
    const error: string | null = getCallVoiceError("Polly.Joanna");

    expect(error).toBe(
      `The call voice "Polly.Joanna" is not one OneUptime offers. Choose one of ${CALL_VOICE_VALUES.join(", ")}, or leave it empty for your Twilio account's default voice.`,
    );

    for (const value of [
      "man",
      "polly.joanna-neural",
      42,
      true,
      { voice: "Polly.Joanna-Neural" },
    ]) {
      expect(getCallVoiceError(value)).toMatch(
        /^The call voice ".*" is not one OneUptime offers\./,
      );
    }
  });

  test("says a long refused value only in part", () => {
    const error: string = getCallVoiceError("x".repeat(5000))!;

    expect(error.length).toBeLessThan(500);
  });

  test("is stored as the list writes it, and an empty one as none", () => {
    expect(toStoredCallVoice(" Polly.Brian-Neural ")).toBe(
      "Polly.Brian-Neural",
    );
    expect(toStoredCallVoice("")).toBeNull();
    expect(toStoredCallVoice("   ")).toBeNull();
    expect(toStoredCallVoice(null)).toBeNull();
  });
});

describe("what a voice costs", () => {
  test("Twilio's neural voice price, per 100 characters said", () => {
    expect(CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD).toBe(0.0032);
  });

  test("a page's call says about 500 characters in English: under 2 US cents in a voice of the list", () => {
    expect(CALL_VOICE_CHARACTERS_IN_A_PAGE).toBe(500);

    for (const voice of CALL_VOICES) {
      const cost: number = getCallVoiceCostOfAPageInUsd(voice);

      expect(cost).toBeGreaterThan(0.01);
      expect(cost).toBeLessThan(0.02);
    }
  });

  test("and up to 700 in another language (#11066): the picker says under 3 US cents, which holds in every one", () => {
    expect(CALL_VOICE_MOST_CHARACTERS_IN_A_PAGE).toBe(700);

    for (const voice of CALL_VOICES) {
      expect(getCallVoiceCentsOfAPage(voice)).toBe(3);
    }
  });

  test("the account's default voice is free", () => {
    expect(getCallVoiceCostOfAPageInUsd(null)).toBe(0);
    expect(getCallVoiceCentsOfAPage(null)).toBe(0);
  });
});
