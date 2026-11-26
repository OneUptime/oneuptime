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
 * Pure, with no Node or browser APIs: the server, the Notification service
 * and the Dashboards read the same list.
 */

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

export interface CallVoice {
  /*
   * As TwiML's <Say voice="..."> names it, and as it is stored:
   * "Polly.Joanna-Neural".
   */
  value: string;
  // The name it goes by: "Joanna", or Google's own, "Neural2-F".
  name: string;
  provider: CallVoiceProvider;
  language: CallVoiceLanguage;
  gender: CallVoiceGender;
  // Whether it reads SSML's <say-as interpret-as="characters">: each one here does.
  readsSsml: boolean;
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
    gender: CallVoiceGender.Female,
    readsSsml: true,
  },
  {
    value: "Polly.Matthew-Neural",
    name: "Matthew",
    provider: CallVoiceProvider.AmazonPolly,
    language: CallVoiceLanguage.USEnglish,
    gender: CallVoiceGender.Male,
    readsSsml: true,
  },
  {
    value: "Polly.Amy-Neural",
    name: "Amy",
    provider: CallVoiceProvider.AmazonPolly,
    language: CallVoiceLanguage.BritishEnglish,
    gender: CallVoiceGender.Female,
    readsSsml: true,
  },
  {
    value: "Polly.Brian-Neural",
    name: "Brian",
    provider: CallVoiceProvider.AmazonPolly,
    language: CallVoiceLanguage.BritishEnglish,
    gender: CallVoiceGender.Male,
    readsSsml: true,
  },
  {
    value: "Google.en-US-Neural2-F",
    name: "Neural2-F",
    provider: CallVoiceProvider.Google,
    language: CallVoiceLanguage.USEnglish,
    gender: CallVoiceGender.Female,
    readsSsml: true,
  },
  {
    value: "Google.en-US-Neural2-J",
    name: "Neural2-J",
    provider: CallVoiceProvider.Google,
    language: CallVoiceLanguage.USEnglish,
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
