import { Say } from "../../../Types/Call/CallRequest";
import {
  SpokenCallVoice,
  getSpokenCallVoice,
} from "../../../Types/Call/CallVoice";
import {
  CALL_CODE_PAUSE,
  SayRecordNumber,
  SpeechPart,
  getSpeechCharacters,
  getSpeechParts,
  isSsmlVoice,
  renderSpeechAsText,
  toSpokenText,
  toTwimlText,
} from "../../../Utils/Call/CallSpeech";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";

/*
 * HOW A CALL'S SENTENCES GO INTO ITS TWIML, IN THE CALL'S VOICE.
 *
 * Every <Say> of a call - what it says when it is placed (Notification
 * service, CallService), the answer to a key the person pressed
 * (NotificationMiddleware), the message it leaves on voicemail - is written
 * here, so one call speaks with one voice and spells a record's number one
 * way:
 *
 *   - the voice, when the call names one of OneUptime's lists
 *     (Types/Call/CallVoice) - another language's too, for a call in the
 *     person's language (#11066) - with the language it speaks: Twilio may fail a
 *     <Say> whose voice and language do not go together, and <Say>'s
 *     language is en-US unless it says otherwise. A voice the list does not
 *     hold is never written: the account's default voice speaks, as it did
 *     before voices could be chosen;
 *   - a record's number ("INC-42") spelled with SSML's
 *     <say-as interpret-as="characters"> for a voice that reads it, and with
 *     spaced letters ("I N C 42") for any other, the account's default among
 *     them (Utils/Call/CallSpeech). A code a sentence says (Say.code,
 *     #11461) is spelled the same way, a character at a time, with a
 *     <break> between each. The number and the code are the only SSML a call
 *     ever carries, so a <Say> that has neither - the keys' prompt, a
 *     goodbye - is plain text in any voice;
 *   - every text in characters TwiML can carry, through Twilio's builder,
 *     which escapes it: a title, a name or a voice is never TwiML or SSML.
 */

// Where a call's sentences go: the call itself, or its prompt for a key.
export type SayParent = VoiceResponse | VoiceResponse.Gather;

// How a call speaks: its voice, and the number prefixes it spells.
export interface CallSpeechOptions {
  /*
   * The voice the call speaks with, as OneUptime's list writes it
   * ("Polly.Joanna-Neural"). None - or one the list does not hold - is the
   * Twilio account's default voice.
   */
  voice: string | undefined;
  /*
   * The project's own number prefixes ("INC-", "#"): a number written with
   * one is spelled wherever the call says it.
   */
  recordNumberPrefixes: ReadonlyArray<string>;
  /*
   * Whether a record's number may be spelled with SSML for a voice that
   * reads it. Left out, it may. A call whose SSML could not be built is
   * built again without it (CallService), in spaced letters.
   */
  isSsmlAllowed?: boolean | undefined;
  /*
   * How "#42", a number without a prefix, is said: in the words of the
   * call's language (Utils/Call/CallSpeech getSayRecordNumber). English's
   * "number 42" when left out.
   */
  sayNumber?: SayRecordNumber | undefined;
}

// A text as it is: what a call says, when nothing measures it.
const AS_IT_IS: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * A code's characters into a <Say>, one at a time (#11461): each its own
 * <say-as interpret-as="characters">, which every voice of OneUptime's lists
 * reads as that one character - a digit as its name, in the voice's language
 * - with a pause of CALL_CODE_PAUSE between two, so the code is heard as
 * its characters, never as a number.
 */
const sayCodeInto: (node: VoiceResponse.Say, characters: string) => void = (
  node: VoiceResponse.Say,
  characters: string,
): void => {
  getSpeechCharacters(characters).forEach(
    (character: string, index: number): void => {
      if (index > 0) {
        node.break({ time: CALL_CODE_PAUSE });
      }

      node.sayAs({ "interpret-as": "characters" }, character);
    },
  );
};

// The voice a call names, from OneUptime's lists, or null for the account's default.
export function getCallSpeechVoice(
  speech: CallSpeechOptions,
): SpokenCallVoice | null {
  return getSpokenCallVoice(speech.voice);
}

/*
 * The attributes of every <Say> of a call: the voice and the language it
 * speaks, for a voice of OneUptime's list; none for the account's default.
 */
export function getSayAttributes(
  voice: SpokenCallVoice | null,
): VoiceResponse.SayAttributes {
  if (!voice) {
    return {};
  }

  return {
    voice: voice.value as NonNullable<VoiceResponse.SayAttributes["voice"]>,
    language: voice.language as NonNullable<
      VoiceResponse.SayAttributes["language"]
    >,
  };
}

/*
 * One sentence into the TwiML, as `say` has its texts: a <Say> - or
 * nothing, for a sentence with no words. For a voice that reads SSML, its
 * record's number is a <say-as interpret-as="characters">; for any other -
 * the account's default voice among them - it is spelled with spaces. A
 * sentence with no number to spell is plain text in any voice: SSML goes
 * only where it spells a number. Every text is put in characters TwiML can
 * carry, and the builder escapes it.
 */
export function sayInto(
  parent: SayParent,
  sentence: Say | string,
  speech: CallSpeechOptions,
  say: (text: string) => string = AS_IT_IS,
): void {
  const voice: SpokenCallVoice | null = getCallSpeechVoice(speech);
  const parts: Array<SpeechPart> = getSpeechParts(
    typeof sentence === "string" ? { sayMessage: sentence } : sentence,
    speech.recordNumberPrefixes,
    speech.sayNumber,
  );

  const attributes: VoiceResponse.SayAttributes = getSayAttributes(voice);

  const spellsANumber: boolean = parts.some((part: SpeechPart): boolean => {
    return "characters" in part;
  });

  if (
    !spellsANumber ||
    speech.isSsmlAllowed === false ||
    !isSsmlVoice(voice ? voice.value : undefined)
  ) {
    const text: string = renderSpeechAsText(
      parts.map((part: SpeechPart): SpeechPart => {
        return "characters" in part
          ? { characters: toTwimlText(part.characters), isPaced: part.isPaced }
          : { text: toSpokenText(part.text) };
      }),
    );

    if (!text.trim()) {
      return;
    }

    parent.say(attributes, say(text));
    return;
  }

  const spoken: Array<SpeechPart> = parts
    .map((part: SpeechPart): SpeechPart => {
      return "characters" in part
        ? {
            characters: toTwimlText(part.characters).trim(),
            isPaced: part.isPaced,
          }
        : { text: toSpokenText(part.text) };
    })
    .filter((part: SpeechPart): boolean => {
      return "characters" in part ? part.characters !== "" : part.text !== "";
    });

  const hasWords: boolean = spoken.some((part: SpeechPart): boolean => {
    return "characters" in part || part.text.trim() !== "";
  });

  if (!hasWords) {
    return;
  }

  const node: VoiceResponse.Say = parent.say(attributes, "");

  for (const part of spoken) {
    if ("characters" in part && part.isPaced) {
      sayCodeInto(node, part.characters);
    } else if ("characters" in part) {
      node.sayAs({ "interpret-as": "characters" }, part.characters);
    } else {
      node.addText(say(part.text));
    }
  }
}
