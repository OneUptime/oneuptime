/*
 * THE VOICES ONEUPTIME'S PHONE CALLS CAN SPEAK WITH (#10948).
 *
 * A call's TwiML names its voice on every <Say>. Naming none, as every call
 * did before this list, leaves it to the Twilio account's default voice:
 * Twilio's Basic "man", unless the account's owner picked another in the
 * Twilio Console. Twilio says its Basic voices are not for production, and
 * they read no SSML (https://www.twilio.com/docs/voice/twiml/say/text-speech).
 *
 * This is the short list of voices an admin can choose instead: for the
 * server's own Twilio account (Admin Dashboard > Settings > Call and SMS,
 * GlobalConfig.twilioCallVoice) and for a project's own Twilio config
 * (ProjectCallSMSConfig.twilioCallVoice) - the account that places a call,
 * whose owner Twilio bills for the voice. Each is a neural voice of Amazon
 * Polly or Google in English, as calls are, and reads the one SSML tag a
 * call uses: <say-as interpret-as="characters">, which spells a record's
 * number ("INC") letter by letter (Utils/Call/CallSpeech).
 *
 * A voice is stored, sent and named in TwiML only as it is written here
 * (getCallVoice): a value that is not one of these - typed through the API,
 * left by a later release, carried by a token - is no voice at all, and the
 * call speaks with the account's default voice as before, so a voice never
 * stops a call from being placed. Its language goes beside it: Twilio says a
 * voice with a language it does not speak - <Say>'s default is en-US - may
 * fail the <Say>.
 *
 * A CALL IN ANOTHER LANGUAGE (#11066). A page's call is written in the
 * language of the person it calls, as their texts and emails are - but a
 * voice speaks one language, and one language's words read by another
 * language's voice are not understood. So the words of a call in another
 * language are spoken only by a voice of that language: one of
 * CALL_LANGUAGE_VOICES, a woman's or a man's as the voice the account
 * chose is (getCallVoiceForLanguage). A call through an account that chose
 * none - its default voice, Basic "man" unless its owner picked another,
 * speaks English only - and a call to a person whose language has no voice
 * here (Persian: neither Amazon nor Google offers one) is in English, as
 * every call was.
 *
 * Pure, with no Node or browser APIs: the server, the Notification service
 * and the Dashboards read the same list.
 */

import { DEFAULT_READER_LANGUAGE, toReaderLanguage } from "../ReaderLanguage";

export enum CallVoiceProvider {
  AmazonPolly = "Amazon Polly",
  Google = "Google",
}

// The language a voice speaks, as <Say language="..."> names it.
export enum CallVoiceLanguage {
  USEnglish = "en-US",
  BritishEnglish = "en-GB",
}

export enum CallVoiceGender {
  Female = "female",
  Male = "male",
}

/*
 * A voice a call can speak with: one an admin chooses (CALL_VOICES) or one
 * OneUptime speaks another language with (CALL_LANGUAGE_VOICES).
 */
export interface SpokenCallVoice {
  /*
   * As TwiML's <Say voice="..."> names it, and as it is stored:
   * "Polly.Joanna-Neural".
   */
  value: string;
  // The name it goes by: "Joanna", or Google's own, "Neural2-F".
  name: string;
  provider: CallVoiceProvider;
  // The language <Say language="..."> is told it speaks: "en-US", "de-DE", "cmn-CN".
  language: string;
  /*
   * The language of the words it is given, as OneUptime names its languages
   * (Types/ReaderLanguage): "en", "de", "zh-CN".
   */
  readerLanguage: string;
  gender: CallVoiceGender;
  // Whether it reads SSML's <say-as interpret-as="characters">: each one here does.
  readsSsml: boolean;
}

// A voice an admin chooses for an account: in English, as its calls are.
export interface CallVoice extends SpokenCallVoice {
  language: CallVoiceLanguage;
}

/*
 * Twilio's price for these voices - neural ones - per 100 characters said,
 * in US dollars, as Twilio listed it in November 2026
 * (https://www.twilio.com/en-us/voice/pricing/us). Twilio prices a call's
 * speech in blocks of 100 characters, 100 at least. Basic voices, the
 * account default's, are free.
 */
export const CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD: number = 0.0032;

/*
 * About how many characters a page's call says when nobody presses a key:
 * who calls, what happened and its number, the keys and a title, twice,
 * then its goodbye (Utils/Call/OnCallPageCall) - a title is cut at 100
 * characters.
 */
export const CALL_VOICE_CHARACTERS_IN_A_PAGE: number = 500;

export const CALL_VOICES: ReadonlyArray<CallVoice> = Object.freeze([
  {
    value: "Polly.Joanna-Neural",
    name: "Joanna",
    provider: CallVoiceProvider.AmazonPolly,
    language: CallVoiceLanguage.USEnglish,
    readerLanguage: DEFAULT_READER_LANGUAGE,
    gender: CallVoiceGender.Female,
    readsSsml: true,
  },
  {
    value: "Polly.Matthew-Neural",
    name: "Matthew",
    provider: CallVoiceProvider.AmazonPolly,
    language: CallVoiceLanguage.USEnglish,
    readerLanguage: DEFAULT_READER_LANGUAGE,
    gender: CallVoiceGender.Male,
    readsSsml: true,
  },
  {
    value: "Polly.Amy-Neural",
    name: "Amy",
    provider: CallVoiceProvider.AmazonPolly,
    language: CallVoiceLanguage.BritishEnglish,
    readerLanguage: DEFAULT_READER_LANGUAGE,
    gender: CallVoiceGender.Female,
    readsSsml: true,
  },
  {
    value: "Polly.Brian-Neural",
    name: "Brian",
    provider: CallVoiceProvider.AmazonPolly,
    language: CallVoiceLanguage.BritishEnglish,
    readerLanguage: DEFAULT_READER_LANGUAGE,
    gender: CallVoiceGender.Male,
    readsSsml: true,
  },
  {
    value: "Google.en-US-Neural2-F",
    name: "Neural2-F",
    provider: CallVoiceProvider.Google,
    language: CallVoiceLanguage.USEnglish,
    readerLanguage: DEFAULT_READER_LANGUAGE,
    gender: CallVoiceGender.Female,
    readsSsml: true,
  },
  {
    value: "Google.en-US-Neural2-J",
    name: "Neural2-J",
    provider: CallVoiceProvider.Google,
    language: CallVoiceLanguage.USEnglish,
    readerLanguage: DEFAULT_READER_LANGUAGE,
    gender: CallVoiceGender.Male,
    readsSsml: true,
  },
] as Array<CallVoice>);

// Every voice's value, as the API and Terraform take them (TableColumn.allowedValues).
export const CALL_VOICE_VALUES: ReadonlyArray<string> = Object.freeze(
  CALL_VOICES.map((voice: CallVoice): string => {
    return voice.value;
  }),
);

/*
 * The voice a value names, or null: a value names a voice only as this list
 * writes it, around which only spaces are let go. Anything else - another
 * casing, a voice not listed, a Basic voice, something that is not text -
 * names none, and the call speaks with the account's default voice.
 */
export function getCallVoice(value: unknown): CallVoice | null {
  if (typeof value !== "string") {
    return null;
  }

  const name: string = value.trim();

  return (
    CALL_VOICES.find((voice: CallVoice): boolean => {
      return voice.value === name;
    }) || null
  );
}

// The value of the voice a value names, as it is stored and named; undefined for none.
export function toCallVoiceValue(value: unknown): string | undefined {
  return getCallVoice(value)?.value;
}

/*
 * Why a write's voice is refused, or null when it is taken: a voice from
 * the list, or none - left out, null or empty - for the account's default
 * voice. A write is refused rather than saved as no voice, so a typo
 * through the API or Terraform says so instead of leaving the default.
 */
export function getCallVoiceError(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  if (typeof value === "string" && getCallVoice(value)) {
    return null;
  }

  return `The call voice "${String(value).slice(0, 100)}" is not one OneUptime offers. Choose one of ${CALL_VOICE_VALUES.join(", ")}, or leave it empty for your Twilio account's default voice.`;
}

/*
 * What a write stores for a voice it gives: the voice as the list writes
 * it, or null for an empty one - the account's default voice. A value
 * getCallVoiceError refuses never gets here.
 */
export function toStoredCallVoice(value: unknown): string | null {
  return toCallVoiceValue(value) || null;
}

/*
 * THE VOICES A CALL SPEAKS ANOTHER LANGUAGE WITH (#11066): a woman's and a
 * man's for each language OneUptime writes in that a provider has a voice
 * for. Each is in Twilio's Neural tier - Amazon Polly's neural voices and
 * Google's WaveNet and Neural2 voices, at the price of the English ones -
 * and reads the SSML a call uses. Amazon's where it has one, as its voices
 * keep their names; Google's where it has none, from the voices Google
 * lists since its voice refresh, so none is one Google is retiring. Checked
 * on 2026-11-27 against:
 *
 *   - Twilio's list of the voices <Say> speaks, last changed on 2026-10-07
 *     (https://www.twilio.com/docs/voice/twiml/say/text-speech), which puts
 *     Polly's neural voices and Google's WaveNet and Neural2 ones in its
 *     Neural tier;
 *   - Amazon Polly's (https://docs.aws.amazon.com/polly/latest/dg/available-voices.html);
 *   - Google Cloud's (https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types).
 *
 * Each language's variety is the one OneUptime's words are written in:
 * Spain's Spanish, Brazil's Portuguese, Norwegian Bokmal, Modern Standard
 * Arabic (Google's ar-XA: Amazon's Arabic voices speak the Gulf's), and
 * Mandarin for both Chinese languages - Taiwan's for Traditional Chinese.
 * Persian has none: neither Amazon nor Google offers a Persian voice, so a
 * call to a person who reads Persian is in English.
 *
 * None of these is chosen by an admin, and none is stored: a call takes the
 * one of its person's language from the voice its account chose
 * (getCallVoiceForLanguage), and only this list's own values are ever
 * written into TwiML.
 */
const LANGUAGE_VOICE_ROWS: ReadonlyArray<
  [
    readerLanguage: string,
    language: string,
    woman: string,
    womanName: string,
    man: string,
    manName: string,
  ]
> = [
  ["de", "de-DE", "Polly.Vicki-Neural", "Vicki", "Polly.Daniel-Neural", "Daniel"],
  ["fr", "fr-FR", "Polly.Lea-Neural", "Léa", "Polly.Remi-Neural", "Rémi"],
  ["es", "es-ES", "Polly.Lucia-Neural", "Lucia", "Polly.Sergio-Neural", "Sergio"],
  ["it", "it-IT", "Polly.Bianca-Neural", "Bianca", "Polly.Adriano-Neural", "Adriano"],
  ["pt", "pt-BR", "Polly.Camila-Neural", "Camila", "Polly.Thiago-Neural", "Thiago"],
  ["nl", "nl-NL", "Polly.Laura-Neural", "Laura", "Google.nl-NL-Wavenet-G", "Wavenet-G"],
  ["da", "da-DK", "Polly.Sofie-Neural", "Sofie", "Google.da-DK-Wavenet-G", "Wavenet-G"],
  ["no", "nb-NO", "Polly.Ida-Neural", "Ida", "Google.nb-NO-Wavenet-G", "Wavenet-G"],
  ["sv", "sv-SE", "Polly.Elin-Neural", "Elin", "Google.sv-SE-Wavenet-G", "Wavenet-G"],
  ["ru", "ru-RU", "Google.ru-RU-Wavenet-A", "Wavenet-A", "Google.ru-RU-Wavenet-B", "Wavenet-B"],
  ["ja", "ja-JP", "Polly.Kazuha-Neural", "Kazuha", "Polly.Takumi-Neural", "Takumi"],
  ["ko", "ko-KR", "Polly.Seoyeon-Neural", "Seoyeon", "Google.ko-KR-Neural2-C", "Neural2-C"],
  ["zh-CN", "cmn-CN", "Polly.Zhiyu-Neural", "Zhiyu", "Google.cmn-CN-Wavenet-B", "Wavenet-B"],
  ["zh-TW", "cmn-TW", "Google.cmn-TW-Wavenet-A", "Wavenet-A", "Google.cmn-TW-Wavenet-B", "Wavenet-B"],
  ["hi", "hi-IN", "Polly.Kajal-Neural", "Kajal", "Google.hi-IN-Neural2-B", "Neural2-B"],
  ["ar", "ar-XA", "Google.ar-XA-Wavenet-A", "Wavenet-A", "Google.ar-XA-Wavenet-B", "Wavenet-B"],
];

// A voice of the list, its maker read off its name.
const languageVoice: (data: {
  value: string;
  name: string;
  language: string;
  readerLanguage: string;
  gender: CallVoiceGender;
}) => SpokenCallVoice = (data: {
  value: string;
  name: string;
  language: string;
  readerLanguage: string;
  gender: CallVoiceGender;
}): SpokenCallVoice => {
  return Object.freeze({
    value: data.value,
    name: data.name,
    provider: data.value.startsWith("Polly.")
      ? CallVoiceProvider.AmazonPolly
      : CallVoiceProvider.Google,
    language: data.language,
    readerLanguage: data.readerLanguage,
    gender: data.gender,
    readsSsml: true,
  });
};

export const CALL_LANGUAGE_VOICES: ReadonlyArray<SpokenCallVoice> =
  Object.freeze(
    LANGUAGE_VOICE_ROWS.flatMap(
      ([readerLanguage, language, woman, womanName, man, manName]: [
        string,
        string,
        string,
        string,
        string,
        string,
      ]): Array<SpokenCallVoice> => {
        return [
          languageVoice({
            value: woman,
            name: womanName,
            language: language,
            readerLanguage: readerLanguage,
            gender: CallVoiceGender.Female,
          }),
          languageVoice({
            value: man,
            name: manName,
            language: language,
            readerLanguage: readerLanguage,
            gender: CallVoiceGender.Male,
          }),
        ];
      },
    ),
  );

// Every voice a call may speak with: the ones an admin chooses, then the other languages'.
export const SPOKEN_CALL_VOICES: ReadonlyArray<SpokenCallVoice> = Object.freeze(
  [...CALL_VOICES, ...CALL_LANGUAGE_VOICES],
);

/*
 * The languages a call can be spoken in besides English, in the list's
 * order: each has a woman's and a man's voice.
 */
export const CALL_VOICE_READER_LANGUAGES: ReadonlyArray<string> = Object.freeze(
  LANGUAGE_VOICE_ROWS.map(
    (row: (typeof LANGUAGE_VOICE_ROWS)[number]): string => {
      return row[0];
    },
  ),
);

/*
 * The voice a value names among every voice a call may speak with
 * (SPOKEN_CALL_VOICES), or null - read as getCallVoice reads one: as the
 * list writes it, the spaces around it let go. What a call's keypad token,
 * its log and its TwiML carry, another language's voice among them.
 */
export function getSpokenCallVoice(value: unknown): SpokenCallVoice | null {
  if (typeof value !== "string") {
    return null;
  }

  const name: string = value.trim();

  return (
    SPOKEN_CALL_VOICES.find((voice: SpokenCallVoice): boolean => {
      return voice.value === name;
    }) || null
  );
}

// Its value, as TwiML names it; undefined for none.
export function toSpokenCallVoiceValue(value: unknown): string | undefined {
  return getSpokenCallVoice(value)?.value;
}

// The voices that speak a language other than English, a woman's first.
export function getCallVoicesOfLanguage(
  readerLanguage: string | null | undefined,
): Array<SpokenCallVoice> {
  const language: string = toReaderLanguage(readerLanguage);

  return CALL_LANGUAGE_VOICES.filter((voice: SpokenCallVoice): boolean => {
    return voice.readerLanguage === language;
  });
}

// Whether a call can be spoken in a language: English, or one with voices of its own.
export function hasCallVoiceForLanguage(
  readerLanguage: string | null | undefined,
): boolean {
  const language: string = toReaderLanguage(readerLanguage);

  return (
    language === DEFAULT_READER_LANGUAGE ||
    getCallVoicesOfLanguage(language).length > 0
  );
}

/*
 * The voice a call speaks with to a person who reads `readerLanguage`,
 * when the account that places it chose `chosen` (#11066):
 *
 *   - English: the voice chosen;
 *   - another language: its voice of the same kind - a woman's for a
 *     woman's, a man's for a man's, of the same maker where there is one -
 *     or, should the language have none of that kind, its other voice;
 *   - null when no voice is chosen - the account's default voice speaks
 *     English only - or the language has no voice (Persian): the call is
 *     then in English, in the voice chosen.
 */
export function getCallVoiceForLanguage(
  chosen: CallVoice | null,
  readerLanguage: string | null | undefined,
): SpokenCallVoice | null {
  if (!chosen) {
    return null;
  }

  const language: string = toReaderLanguage(readerLanguage);

  if (language === DEFAULT_READER_LANGUAGE) {
    return chosen;
  }

  const likeness: (voice: SpokenCallVoice) => number = (
    voice: SpokenCallVoice,
  ): number => {
    return (
      (voice.gender === chosen.gender ? 2 : 0) +
      (voice.provider === chosen.provider ? 1 : 0)
    );
  };

  return getCallVoicesOfLanguage(language).reduce(
    (best: SpokenCallVoice | null, voice: SpokenCallVoice) => {
      return !best || likeness(voice) > likeness(best) ? voice : best;
    },
    null,
  );
}

/*
 * About what a page's call costs in this voice, in US dollars, as Twilio
 * prices it: blocks of 100 characters, for about as many as a page's call
 * says. Free (0) for no voice - the account's default.
 */
export function getCallVoiceCostOfAPageInUsd(voice: CallVoice | null): number {
  if (!voice) {
    return 0;
  }

  return (
    Math.ceil(CALL_VOICE_CHARACTERS_IN_A_PAGE / 100) *
    CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD
  );
}

/*
 * The same in whole US cents, rounded up: what the picker says a page's
 * call costs at most ("under 2 US cents"). 0 for the account's default
 * voice, which is free.
 */
export function getCallVoiceCentsOfAPage(voice: CallVoice | null): number {
  return Math.ceil(
    Number((getCallVoiceCostOfAPageInUsd(voice) * 100).toFixed(6)),
  );
}
