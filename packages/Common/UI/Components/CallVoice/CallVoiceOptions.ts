import {
  CALL_VOICES,
  CallVoice,
  CallVoiceGender,
  CallVoiceLanguage,
  getCallVoice,
} from "../../../Types/Call/CallVoice";
import {
  Translator,
  getInlineSeparator,
  translationKey,
} from "../../../Types/Translator";
import { DropdownOption } from "../Dropdown/Dropdown";

/*
 * THE WORDS OF THE CALL VOICE PICKER (#10948), for the server's Twilio
 * account (Admin Dashboard > Settings > Call and SMS) and a project's own
 * Twilio config (Project Settings > Notification Channels > Twilio Config):
 * one look, one set of words, both read from OneUptime's list of voices
 * (Types/Call/CallVoice).
 *
 * A voice is offered by its own name, as Amazon and Google name it -
 * "Joanna", "Neural2-F" - drawn as written, and under it, in the reader's
 * language, who makes it and how it sounds: "Amazon Polly · US English,
 * female voice". No voice is the picker's empty choice, its placeholder:
 * the voice the Twilio account uses by default, as every call spoke with
 * before voices could be chosen.
 */

// The picker's empty choice: no voice named, the account's own default.
export const CALL_VOICE_DEFAULT_LABEL: string = translationKey(
  "Your Twilio account's default voice",
);

// How a voice sounds, by its language and its kind: the words under its name.
export const CALL_VOICE_KIND_WORDS: Readonly<
  Record<CallVoiceLanguage, Readonly<Record<CallVoiceGender, string>>>
> = {
  [CallVoiceLanguage.USEnglish]: {
    [CallVoiceGender.Female]: translationKey("US English, female voice"),
    [CallVoiceGender.Male]: translationKey("US English, male voice"),
  },
  [CallVoiceLanguage.BritishEnglish]: {
    [CallVoiceGender.Female]: translationKey("British English, female voice"),
    [CallVoiceGender.Male]: translationKey("British English, male voice"),
  },
};

// How a voice sounds, as an English key: "US English, female voice".
export function getCallVoiceKindWords(voice: CallVoice): string {
  return CALL_VOICE_KIND_WORDS[voice.language][voice.gender];
}

/*
 * Who makes a voice and how it sounds, in the reader's language: "Amazon
 * Polly · US English, female voice". The maker is a product's own name,
 * written as it is.
 */
export function getCallVoiceDescription(
  voice: CallVoice,
  translator: Translator,
): string {
  const kind: string = getCallVoiceKindWords(voice);

  return `${voice.provider}${getInlineSeparator(translator.language)}${
    translator.translateText(kind) || kind
  }`;
}

/*
 * A voice in a line of its own, for the card that says which one is
 * chosen: "Joanna · Amazon Polly · US English, female voice" - or, with
 * none, the account's default voice, in the reader's language. A value the
 * list does not hold is none, as the call takes it.
 */
export function getCallVoiceSummary(
  value: unknown,
  translator: Translator,
): string {
  const voice: CallVoice | null = getCallVoice(value);

  if (!voice) {
    return (
      translator.translateText(CALL_VOICE_DEFAULT_LABEL) ||
      CALL_VOICE_DEFAULT_LABEL
    );
  }

  return `${voice.name}${getInlineSeparator(
    translator.language,
  )}${getCallVoiceDescription(voice, translator)}`;
}

/*
 * The picker's options, in the list's order: each voice by its own name,
 * drawn as written, with who makes it and how it sounds under it, already
 * in the reader's language. The account's default voice is not one of
 * them: it is the placeholder, which clearing the picker picks.
 */
export function getCallVoiceOptions(
  translator: Translator,
): Array<DropdownOption> {
  return CALL_VOICES.map((voice: CallVoice): DropdownOption => {
    return {
      value: voice.value,
      label: voice.name,
      isUserContent: true,
      description: getCallVoiceDescription(voice, translator),
      isDescriptionUserContent: true,
    };
  });
}
