import {
  CallSpeechOptions,
  getSayAttributes,
  sayInto,
} from "../../../../Server/Utils/Call/CallTwimlSpeech";
import {
  CALL_VOICES,
  CallVoice,
  getCallVoice,
} from "../../../../Types/Call/CallVoice";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY <SAY> OF A CALL, IN THE CALL'S VOICE (#10948).
 *
 * The one writer of a call's sentences - the call itself, the keypad's
 * answers, voicemail. A voice of OneUptime's list is named with the
 * language it speaks; any other value names nothing, and the account's
 * default voice speaks, as every call did. SSML is a record number's
 * say-as, for a voice that reads it, and nothing else: a sentence with no
 * number - the keys' prompt, a goodbye - is plain text in any voice.
 */

const PREFIXES: ReadonlyArray<string> = ["#", "INC-", "ALT-"];

function twimlOf(
  sentences: Array<string | { sayMessage: string; recordNumber?: string }>,
  speech: CallSpeechOptions,
): string {
  const response: VoiceResponse = new VoiceResponse();

  for (const sentence of sentences) {
    sayInto(response, sentence, speech);
  }

  return response.toString();
}

function body(twiml: string): string {
  return twiml
    .replace('<?xml version="1.0" encoding="UTF-8"?><Response>', "")
    .replace("</Response>", "");
}

describe("the voice a <Say> names", () => {
  test.each(
    CALL_VOICES.map((voice: CallVoice) => {
      return [voice.value, voice];
    }),
  )("%s, with the language it speaks", (_value: string, voice: CallVoice) => {
    expect(getSayAttributes(voice)).toEqual({
      voice: voice.value,
      language: voice.language,
    });

    expect(
      body(
        twimlOf(["Press 1 to acknowledge, or 2 to escalate."], {
          voice: voice.value,
          recordNumberPrefixes: PREFIXES,
        }),
      ),
    ).toBe(
      `<Say voice="${voice.value}" language="${voice.language}">Press 1 to acknowledge, or 2 to escalate.</Say>`,
    );
  });

  test("none for the account's default voice: the <Say> is as every call's was", () => {
    expect(getSayAttributes(null)).toEqual({});
    expect(
      body(
        twimlOf(["This is a call from OneUptime."], {
          voice: undefined,
          recordNumberPrefixes: [],
        }),
      ),
    ).toBe("<Say>This is a call from One Uptime.</Say>");
  });

  test("none for a voice the list does not hold: it is never written into the TwiML", () => {
    for (const voice of [
      "man",
      "alice",
      "Polly.Joanna",
      "Google.en-US-Chirp3-HD-Aoede",
      "polly.joanna-neural",
      'Polly.Joanna-Neural" language="xx',
      "</Say><Dial>+19005550100</Dial>",
    ]) {
      const twiml: string = twimlOf(
        ["A new incident has been created: INC-42."],
        {
          voice: voice,
          recordNumberPrefixes: PREFIXES,
        },
      );

      expect({ voice, twiml: body(twiml) }).toEqual({
        voice,
        twiml: "<Say>A new incident has been created: I N C 42.</Say>",
      });
    }
  });
});

describe("SSML, for a voice that reads it", () => {
  test("a record number's prefix is spelled with say-as characters", () => {
    for (const voice of CALL_VOICES) {
      expect(
        body(
          twimlOf(
            [
              {
                sayMessage: "A new Critical Incident has been created: INC-42.",
                recordNumber: "INC-42",
              },
            ],
            { voice: voice.value, recordNumberPrefixes: [] },
          ),
        ),
      ).toBe(
        `<Say voice="${voice.value}" language="${voice.language}">A new Critical Incident has been created: <say-as interpret-as="characters">INC</say-as> 42.</Say>`,
      );
    }
  });

  test("is the only markup a sentence ever carries: the keys and a goodbye are plain text in an SSML voice", () => {
    const twiml: string = twimlOf(
      [
        "Press 1 to acknowledge, or 2 to escalate.",
        "That key does nothing.",
        "You did not press a key, so this incident is not acknowledged. Good bye.",
      ],
      { voice: "Polly.Matthew-Neural", recordNumberPrefixes: PREFIXES },
    );

    expect(twiml).not.toContain("say-as");
    expect(body(twiml)).toBe(
      '<Say voice="Polly.Matthew-Neural" language="en-US">Press 1 to acknowledge, or 2 to escalate.</Say>' +
        '<Say voice="Polly.Matthew-Neural" language="en-US">That key does nothing.</Say>' +
        '<Say voice="Polly.Matthew-Neural" language="en-US">You did not press a key, so this incident is not acknowledged. Good bye.</Say>',
    );
  });

  test("turned off, a record number is spaced letters in the same voice: a call whose SSML could not be built is built so", () => {
    expect(
      body(
        twimlOf(
          [
            {
              sayMessage: "A new incident has been created: INC-42.",
              recordNumber: "INC-42",
            },
          ],
          {
            voice: "Google.en-US-Neural2-F",
            recordNumberPrefixes: [],
            isSsmlAllowed: false,
          },
        ),
      ),
    ).toBe(
      '<Say voice="Google.en-US-Neural2-F" language="en-US">A new incident has been created: I N C 42.</Say>',
    );
  });

  test("never for the account's default voice, which may be Basic and fail a <Say> that carries it", () => {
    expect(
      body(
        twimlOf(
          [
            {
              sayMessage: "A new incident has been created: INC-42.",
              recordNumber: "INC-42",
            },
          ],
          { voice: undefined, recordNumberPrefixes: [], isSsmlAllowed: true },
        ),
      ),
    ).toBe("<Say>A new incident has been created: I N C 42.</Say>");
  });

  test("markup in a sentence is only ever spoken, in any voice", () => {
    const hostile: string =
      '</Say><Dial>+19005550100</Dial><say-as interpret-as="characters">x</say-as> INC-42 & "go"';

    for (const voice of [undefined, "Polly.Joanna-Neural"]) {
      const twiml: string = twimlOf([hostile], {
        voice: voice,
        recordNumberPrefixes: PREFIXES,
      });

      expect(twiml).not.toContain("<Dial>");
      expect(twiml.split("<say-as").length - 1).toBe(voice ? 1 : 0);
      expect(twiml).toContain("&lt;/Say&gt;&lt;Dial&gt;");
    }
  });
});

describe("a sentence with no words", () => {
  test("is left out, rather than an empty <Say>", () => {
    for (const voice of [undefined, "Polly.Brian-Neural"]) {
      const twiml: string = twimlOf(["", "   ", "\u0001\u0002"], {
        voice: voice,
        recordNumberPrefixes: [],
      });

      expect(twiml).not.toContain("<Say");
      expect(twiml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    }
  });
});

describe("the list's voices are the ones named", () => {
  test("each voice getSayAttributes names is the list's own entry", () => {
    for (const voice of CALL_VOICES) {
      expect(getCallVoice(getSayAttributes(voice).voice)).toBe(voice);
    }
  });
});
