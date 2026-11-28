import {
  CALL_LANGUAGE_VOICES,
  CALL_VOICES,
  CALL_VOICE_READER_LANGUAGES,
  CALL_VOICE_VALUES,
  CallVoice,
  CallVoiceGender,
  CallVoiceProvider,
  SPOKEN_CALL_VOICES,
  SpokenCallVoice,
  getCallVoice,
  getCallVoiceError,
  getCallVoiceForLanguage,
  getCallVoicesOfLanguage,
  getSpokenCallVoice,
  hasCallVoiceForLanguage,
  toCallVoiceValue,
  toSpokenCallVoiceValue,
} from "../../../Types/Call/CallVoice";
import {
  DEFAULT_READER_LANGUAGE,
  READER_LANGUAGE_CODES,
} from "../../../Types/ReaderLanguage";
import { describe, expect, test } from "@jest/globals";

/*
 * THE VOICES A CALL SPEAKS ANOTHER LANGUAGE WITH (#11066).
 *
 * A call to a person who reads another language is said in it, by a voice
 * of that language, and only by one: one language's words read by another
 * language's voice are not understood. These hold the list to what the
 * call needs of it, and to the voices Twilio, Amazon and Google listed
 * when it was checked (2026-11-27): a change to it is a decision, made
 * here on purpose.
 */

// The list as it was checked: [language, <Say language>, woman, man].
const CHECKED: ReadonlyArray<[string, string, string, string]> = [
  ["de", "de-DE", "Polly.Vicki-Neural", "Polly.Daniel-Neural"],
  ["fr", "fr-FR", "Polly.Lea-Neural", "Polly.Remi-Neural"],
  ["es", "es-ES", "Polly.Lucia-Neural", "Polly.Sergio-Neural"],
  ["it", "it-IT", "Polly.Bianca-Neural", "Polly.Adriano-Neural"],
  ["pt", "pt-BR", "Polly.Camila-Neural", "Polly.Thiago-Neural"],
  ["nl", "nl-NL", "Polly.Laura-Neural", "Google.nl-NL-Wavenet-G"],
  ["da", "da-DK", "Polly.Sofie-Neural", "Google.da-DK-Wavenet-G"],
  ["no", "nb-NO", "Polly.Ida-Neural", "Google.nb-NO-Wavenet-G"],
  ["sv", "sv-SE", "Polly.Elin-Neural", "Google.sv-SE-Wavenet-G"],
  ["ru", "ru-RU", "Google.ru-RU-Wavenet-A", "Google.ru-RU-Wavenet-B"],
  ["ja", "ja-JP", "Polly.Kazuha-Neural", "Polly.Takumi-Neural"],
  ["ko", "ko-KR", "Polly.Seoyeon-Neural", "Google.ko-KR-Neural2-C"],
  ["zh-CN", "cmn-CN", "Polly.Zhiyu-Neural", "Google.cmn-CN-Wavenet-B"],
  ["zh-TW", "cmn-TW", "Google.cmn-TW-Wavenet-A", "Google.cmn-TW-Wavenet-B"],
  ["hi", "hi-IN", "Polly.Kajal-Neural", "Google.hi-IN-Neural2-B"],
  ["ar", "ar-XA", "Google.ar-XA-Wavenet-A", "Google.ar-XA-Wavenet-B"],
];

/*
 * The languages <Say language="..."> takes, as Twilio's own library types
 * it (twilio/lib/twiml/VoiceResponse SayLanguage) - the ones a voice here
 * may be told it speaks.
 */
const TWILIO_SAY_LANGUAGES: ReadonlyArray<string> = [
  "ar-XA",
  "cmn-CN",
  "cmn-TW",
  "da-DK",
  "de-DE",
  "en-GB",
  "en-US",
  "es-ES",
  "fr-FR",
  "hi-IN",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "nb-NO",
  "nl-NL",
  "pt-BR",
  "ru-RU",
  "sv-SE",
];

const voice: (value: string) => SpokenCallVoice = (
  value: string,
): SpokenCallVoice => {
  const found: SpokenCallVoice | null = getSpokenCallVoice(value);

  expect(found).not.toBeNull();

  return found!;
};

const chosen: (value: string) => CallVoice = (value: string): CallVoice => {
  const found: CallVoice | null = getCallVoice(value);

  expect(found).not.toBeNull();

  return found!;
};

describe("the list", () => {
  test("is the list that was checked against Twilio's, Amazon's and Google's, in its order", () => {
    expect(
      CALL_LANGUAGE_VOICES.map((each: SpokenCallVoice): Array<string> => {
        return [each.readerLanguage, each.language, each.gender, each.value];
      }),
    ).toEqual(
      CHECKED.flatMap(
        ([readerLanguage, language, woman, man]: [
          string,
          string,
          string,
          string,
        ]): Array<Array<string>> => {
          return [
            [readerLanguage, language, CallVoiceGender.Female, woman],
            [readerLanguage, language, CallVoiceGender.Male, man],
          ];
        },
      ),
    );
  });

  test("speaks every language OneUptime writes in but English, whose voices an admin chooses, and Persian, which no provider has a voice for", () => {
    expect([...CALL_VOICE_READER_LANGUAGES].sort()).toEqual(
      READER_LANGUAGE_CODES.filter((code: string): boolean => {
        return code !== DEFAULT_READER_LANGUAGE && code !== "fa";
      }).sort(),
    );
    expect(hasCallVoiceForLanguage("fa")).toBe(false);
    expect(getCallVoicesOfLanguage("fa")).toEqual([]);
  });

  test("a woman's and a man's voice for each language, a woman's first", () => {
    for (const language of CALL_VOICE_READER_LANGUAGES) {
      expect(
        getCallVoicesOfLanguage(language).map(
          (each: SpokenCallVoice): string => {
            return each.gender;
          },
        ),
      ).toEqual([CallVoiceGender.Female, CallVoiceGender.Male]);
    }
  });

  test("each voice is named once, as Twilio's <Say voice> takes it: its maker, a dot, its name", () => {
    const values: Array<string> = SPOKEN_CALL_VOICES.map(
      (each: SpokenCallVoice): string => {
        return each.value;
      },
    );

    expect(new Set(values).size).toBe(values.length);

    for (const each of CALL_LANGUAGE_VOICES) {
      expect(each.value).toMatch(/^[A-Za-z0-9.-]+$/);
      expect(each.value.startsWith("Polly.")).toBe(
        each.provider === CallVoiceProvider.AmazonPolly,
      );
      expect(each.value.startsWith("Google.")).toBe(
        each.provider === CallVoiceProvider.Google,
      );
    }
  });

  test("every voice is in Twilio's Neural tier - Polly's neural voices, Google's WaveNet and Neural2 - at the English voices' price", () => {
    for (const each of CALL_LANGUAGE_VOICES) {
      if (each.provider === CallVoiceProvider.AmazonPolly) {
        expect(each.value).toMatch(/^Polly\.[A-Za-z]+-Neural$/);
      } else {
        expect(each.value).toMatch(
          /^Google\.[a-z]{2,3}-[A-Z]{2}-(Wavenet|Neural2)-[A-Z]$/,
        );
      }

      expect(each.value).not.toMatch(
        /Standard|Chirp|Generative|Journey|Studio/,
      );
      expect(["man", "woman", "alice"]).not.toContain(each.value);
    }
  });

  test("each is told the language it speaks, one <Say> takes, and a Google voice's name carries it", () => {
    for (const each of CALL_LANGUAGE_VOICES) {
      expect(TWILIO_SAY_LANGUAGES).toContain(each.language);

      if (each.provider === CallVoiceProvider.Google) {
        expect(each.value).toContain(`.${each.language}-`);
      }
    }
  });

  test("speaks each language in the variety OneUptime writes it in", () => {
    expect(voice("Polly.Lucia-Neural").language).toBe("es-ES");
    expect(voice("Polly.Camila-Neural").language).toBe("pt-BR");
    expect(voice("Polly.Ida-Neural").language).toBe("nb-NO");
    expect(voice("Google.cmn-TW-Wavenet-A").readerLanguage).toBe("zh-TW");
    expect(voice("Polly.Zhiyu-Neural").readerLanguage).toBe("zh-CN");
    // Modern Standard Arabic, not Amazon's Gulf Arabic voices.
    expect(voice("Google.ar-XA-Wavenet-A").readerLanguage).toBe("ar");
    expect(getSpokenCallVoice("Polly.Hala-Neural")).toBeNull();
  });

  test("every voice reads the SSML a call uses: a record number spelled with say-as", () => {
    for (const each of SPOKEN_CALL_VOICES) {
      expect(each.readsSsml).toBe(true);
    }
  });

  test("the English voices an admin chooses speak English, and say so", () => {
    for (const each of CALL_VOICES) {
      expect(each.readerLanguage).toBe(DEFAULT_READER_LANGUAGE);
    }

    expect(SPOKEN_CALL_VOICES.slice(0, CALL_VOICES.length)).toEqual(
      CALL_VOICES,
    );
  });

  test("cannot be changed at run time", () => {
    expect(Object.isFrozen(CALL_LANGUAGE_VOICES)).toBe(true);
    expect(Object.isFrozen(SPOKEN_CALL_VOICES)).toBe(true);
    expect(Object.isFrozen(CALL_VOICE_READER_LANGUAGES)).toBe(true);

    for (const each of CALL_LANGUAGE_VOICES) {
      expect(Object.isFrozen(each)).toBe(true);
    }
  });
});

describe("a voice of another language is spoken, never chosen", () => {
  test("a call's token, log and TwiML may name it", () => {
    for (const each of CALL_LANGUAGE_VOICES) {
      expect(getSpokenCallVoice(each.value)).toBe(each);
      expect(getSpokenCallVoice(` ${each.value}\n`)).toBe(each);
      expect(toSpokenCallVoiceValue(each.value)).toBe(each.value);
    }
  });

  test("an account never chooses it: its calls' English would be read in another language", () => {
    for (const each of CALL_LANGUAGE_VOICES) {
      expect(getCallVoice(each.value)).toBeNull();
      expect(toCallVoiceValue(each.value)).toBeUndefined();
      expect(CALL_VOICE_VALUES).not.toContain(each.value);
      expect(getCallVoiceError(each.value)).toMatch(
        /is not one OneUptime offers/,
      );
    }
  });

  test("anything else names none", () => {
    for (const value of [
      undefined,
      null,
      "",
      42,
      "polly.vicki-neural",
      "Polly.Vicki",
      "Google.de-DE-Neural2-A",
      "Google.de-DE-Standard-A",
      'Polly.Vicki-Neural" language="en-US',
    ]) {
      expect(getSpokenCallVoice(value)).toBeNull();
      expect(toSpokenCallVoiceValue(value)).toBeUndefined();
    }
  });
});

describe("the voice a call speaks with to a person who reads a language", () => {
  test("is none when the account chose none: its default voice speaks English only", () => {
    for (const language of [
      DEFAULT_READER_LANGUAGE,
      ...CALL_VOICE_READER_LANGUAGES,
    ]) {
      expect(getCallVoiceForLanguage(null, language)).toBeNull();
    }
  });

  test("in English, is the voice chosen", () => {
    for (const each of CALL_VOICES) {
      expect(getCallVoiceForLanguage(each, "en")).toBe(each);
      expect(getCallVoiceForLanguage(each, "en-GB")).toBe(each);
      expect(getCallVoiceForLanguage(each, undefined)).toBe(each);
      // A language OneUptime does not write in reads as English.
      expect(getCallVoiceForLanguage(each, "tlh")).toBe(each);
    }
  });

  test("in another language, is its voice of the same kind: a woman's for a woman's, a man's for a man's", () => {
    for (const each of CALL_VOICES) {
      for (const language of CALL_VOICE_READER_LANGUAGES) {
        const spoken: SpokenCallVoice | null = getCallVoiceForLanguage(
          each,
          language,
        );

        expect(spoken).not.toBeNull();
        expect(spoken!.readerLanguage).toBe(language);
        expect(spoken!.gender).toBe(each.gender);
      }
    }
  });

  test("Joanna and Amy speak German as Vicki, Matthew and Brian as Daniel; Google's English voices as the same", () => {
    expect(
      getCallVoiceForLanguage(chosen("Polly.Joanna-Neural"), "de")?.value,
    ).toBe("Polly.Vicki-Neural");
    expect(
      getCallVoiceForLanguage(chosen("Polly.Amy-Neural"), "de")?.value,
    ).toBe("Polly.Vicki-Neural");
    expect(
      getCallVoiceForLanguage(chosen("Polly.Matthew-Neural"), "de")?.value,
    ).toBe("Polly.Daniel-Neural");
    expect(
      getCallVoiceForLanguage(chosen("Google.en-US-Neural2-J"), "de")?.value,
    ).toBe("Polly.Daniel-Neural");
    expect(
      getCallVoiceForLanguage(chosen("Google.en-US-Neural2-F"), "ja")?.value,
    ).toBe("Polly.Kazuha-Neural");
    expect(
      getCallVoiceForLanguage(chosen("Polly.Brian-Neural"), "ru")?.value,
    ).toBe("Google.ru-RU-Wavenet-B");
  });

  test("a language's code is read as OneUptime reads one: Austria's German is German, Bokmal Norwegian", () => {
    expect(
      getCallVoiceForLanguage(chosen("Polly.Joanna-Neural"), "de-AT")?.value,
    ).toBe("Polly.Vicki-Neural");
    expect(
      getCallVoiceForLanguage(chosen("Polly.Joanna-Neural"), "nb")?.value,
    ).toBe("Polly.Ida-Neural");
    expect(
      getCallVoiceForLanguage(chosen("Polly.Joanna-Neural"), "zh-Hant")?.value,
    ).toBe("Google.cmn-TW-Wavenet-A");
  });

  test("is none for Persian: the call is in English, never Persian words in another voice", () => {
    for (const each of CALL_VOICES) {
      expect(getCallVoiceForLanguage(each, "fa")).toBeNull();
    }
  });
});
