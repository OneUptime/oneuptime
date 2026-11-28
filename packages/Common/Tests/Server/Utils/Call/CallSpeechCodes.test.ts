import {
  CallSpeechOptions,
  sayInto,
} from "../../../../Server/Utils/Call/CallTwimlSpeech";
import { Say } from "../../../../Types/Call/CallRequest";
import {
  CALL_LANGUAGE_VOICES,
  CALL_VOICES,
  SpokenCallVoice,
} from "../../../../Types/Call/CallVoice";
import {
  CALL_CODE_CHARACTER_SEPARATOR,
  CALL_CODE_PAUSE,
  SpeechPart,
  getSpeechParts,
  renderSpeechAsText,
  writeCodeForCall,
} from "../../../../Utils/Call/CallSpeech";
import { seededRandom, SeededRandom } from "../../../Helpers/SeededRandom";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * A CODE A CALL SAYS, A CHARACTER AT A TIME (#11461).
 *
 * The phone number verification call reads a six-digit code. Written as
 * one number a voice reads it as one ("four hundred eighty-two thousand
 * nine hundred thirteen") - and "000123" as 123 - in any language. So a
 * sentence carries the code it says (Say.code), as it writes it, and the
 * voice is given its characters one at a time: each its own <say-as
 * interpret-as="characters">, with a <break> of CALL_CODE_PAUSE between
 * two, for a voice that reads SSML - every voice a call in another
 * language speaks with - and spaced out, as the English call has always
 * written its code, for any other. A sentence with no code is said as it
 * was, so the English call is unchanged.
 */

const GERMAN: SpokenCallVoice = CALL_LANGUAGE_VOICES.find(
  (voice: SpokenCallVoice): boolean => {
    return voice.value === "Polly.Vicki-Neural";
  },
)!;

const SPEECH: CallSpeechOptions = {
  voice: GERMAN.value,
  recordNumberPrefixes: ["#", "INC-"],
};

function twimlOf(sentence: Say | string, speech: CallSpeechOptions): string {
  const response: VoiceResponse = new VoiceResponse();

  sayInto(response, sentence, speech);

  return response
    .toString()
    .replace('<?xml version="1.0" encoding="UTF-8"?><Response>', "")
    .replace("</Response>", "");
}

// Every <say-as> of the TwiML: what it is told it is.
const SAY_AS: RegExp = /<say-as interpret-as="([^"]*)">([^<]*)<\/say-as>/g;

// Every <break> of the TwiML.
const BREAK: RegExp = /<break time="([^"]*)"\/>/g;

// The characters each <say-as> of a <Say> says, in order: each as characters.
function spelledIn(twiml: string): Array<string> {
  return Array.from(twiml.matchAll(SAY_AS)).map(
    (match: RegExpMatchArray): string => {
      expect(match[1]).toBe("characters");
      return match[2] || "";
    },
  );
}

// The pauses of a <Say>, in order.
function pausesIn(twiml: string): Array<string> {
  return Array.from(twiml.matchAll(BREAK)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
}

describe("a code as a call's words write it (writeCodeForCall)", () => {
  test("is its characters, two spaces apart, as the verification call has always written its code", () => {
    expect(writeCodeForCall("482913")).toBe("4  8  2  9  1  3");
    expect(CALL_CODE_CHARACTER_SEPARATOR).toBe("  ");
    // As every release built it: code.split("").join("  ").
    expect(writeCodeForCall("482913")).toBe("482913".split("").join("  "));
  });

  test("keeps every leading zero", () => {
    expect(writeCodeForCall("000123")).toBe("0  0  0  1  2  3");
    expect(writeCodeForCall("000000")).toBe("0  0  0  0  0  0");
  });

  test("leaves the whitespace a code was written with out", () => {
    expect(writeCodeForCall(" 48 29 13 ")).toBe("4  8  2  9  1  3");
    expect(writeCodeForCall("4\t8\n2")).toBe("4  8  2");
  });

  test("nothing, for no code", () => {
    expect(writeCodeForCall("")).toBe("");
    expect(writeCodeForCall("   ")).toBe("");
    expect(writeCodeForCall(undefined as unknown as string)).toBe("");
  });

  test("for every code of six digits: its digits, in order, two spaces apart", () => {
    const random: SeededRandom = seededRandom(11461);

    for (let index: number = 0; index < 300; index++) {
      let code: string = "";

      for (let digit: number = 0; digit < 6; digit++) {
        code += String(random(10));
      }

      expect([code, writeCodeForCall(code)]).toEqual([
        code,
        code.split("").join("  "),
      ]);
    }
  });
});

describe("a sentence that says a code (getSpeechParts)", () => {
  test("is its words, then the code's characters, said a character at a time, then the rest", () => {
    expect(
      getSpeechParts({
        sayMessage: "Ihr Bestätigungscode lautet 4  8  2  9  1  3.",
        code: "4  8  2  9  1  3",
      }),
    ).toEqual([
      { text: "Ihr Bestätigungscode lautet " },
      { characters: "482913", isPaced: true },
      { text: "." },
    ]);
  });

  test("wherever the language puts it: inside a Japanese sentence", () => {
    expect(
      getSpeechParts({
        sayMessage: "確認コードは 0  4  2  7  7  1 です。",
        code: "0  4  2  7  7  1",
      }),
    ).toEqual([
      { text: "確認コードは " },
      { characters: "042771", isPaced: true },
      { text: " です。" },
    ]);
  });

  test("at the start of a sentence, or its end", () => {
    expect(
      getSpeechParts({ sayMessage: "1  2  3 is it.", code: "1  2  3" }),
    ).toEqual([{ characters: "123", isPaced: true }, { text: " is it." }]);
    expect(
      getSpeechParts({ sayMessage: "It is 1  2  3", code: "1  2  3" }),
    ).toEqual([{ text: "It is " }, { characters: "123", isPaced: true }]);
  });

  test("every time the sentence says it", () => {
    expect(
      getSpeechParts({
        sayMessage: "1  2 and again 1  2.",
        code: "1  2",
      }),
    ).toEqual([
      { characters: "12", isPaced: true },
      { text: " and again " },
      { characters: "12", isPaced: true },
      { text: "." },
    ]);
  });

  test("its digits are no record's number, whatever the project's prefixes", () => {
    expect(
      getSpeechParts(
        {
          sayMessage: "Votre code de vérification est 4  2.",
          code: "4  2",
        },
        ["#", "INC-", ""],
      ),
    ).toEqual([
      { text: "Votre code de vérification est " },
      { characters: "42", isPaced: true },
      { text: "." },
    ]);
  });

  test("beside a record's number, each is spelled its own way", () => {
    expect(
      getSpeechParts(
        {
          sayMessage: "INC-42: 7  7",
          recordNumber: "INC-42",
          code: "7  7",
        },
        ["INC-"],
      ),
    ).toEqual([
      { characters: "INC" },
      { text: " 42" },
      { text: ": " },
      { characters: "77", isPaced: true },
    ]);
  });

  test("a sentence that no longer says its code is said as written", () => {
    expect(
      getSpeechParts({ sayMessage: "Ihr Code lautet …", code: "4  8  2" }),
    ).toEqual([{ text: "Ihr Code lautet …" }]);
  });

  test("a code of spaces, or none, is no code", () => {
    for (const code of ["", "   ", undefined]) {
      expect(
        getSpeechParts({
          sayMessage: "Your verification code is 4  8  2",
          code: code,
        }),
      ).toEqual([{ text: "Your verification code is 4  8  2" }]);
    }
  });

  test("a sentence with no code - the English call's - is said exactly as it always was", () => {
    expect(
      getSpeechParts({
        sayMessage: "Your verification code is 4  8  2  9  1  3",
      }),
    ).toEqual([{ text: "Your verification code is 4  8  2  9  1  3" }]);
  });

  test("as text, for a voice that reads no SSML, it reads back as the sentence wrote it", () => {
    const sayMessage: string = "Su código de verificación es 9  0  0  1  2  8.";
    const parts: Array<SpeechPart> = getSpeechParts({
      sayMessage: sayMessage,
      code: "9  0  0  1  2  8",
    });

    expect(renderSpeechAsText(parts)).toBe(sayMessage);
  });
});

describe("a code in a <Say> (sayInto)", () => {
  const sentence: Say = {
    sayMessage: "Ihr Bestätigungscode lautet 4  8  2  9  1  3.",
    code: "4  8  2  9  1  3",
  };

  test("by a voice that reads SSML: each digit its own <say-as>, a pause between two, in the call's voice and language", () => {
    expect(twimlOf(sentence, SPEECH)).toBe(
      `<Say voice="Polly.Vicki-Neural" language="de-DE">Ihr Bestätigungscode lautet <say-as interpret-as="characters">4</say-as><break time="${CALL_CODE_PAUSE}"/><say-as interpret-as="characters">8</say-as><break time="${CALL_CODE_PAUSE}"/><say-as interpret-as="characters">2</say-as><break time="${CALL_CODE_PAUSE}"/><say-as interpret-as="characters">9</say-as><break time="${CALL_CODE_PAUSE}"/><say-as interpret-as="characters">1</say-as><break time="${CALL_CODE_PAUSE}"/><say-as interpret-as="characters">3</say-as>.</Say>`,
    );
  });

  test("the pause is half a second: each digit heard, and written down, before the next", () => {
    expect(CALL_CODE_PAUSE).toBe("500ms");
    expect(pausesIn(twimlOf(sentence, SPEECH))).toEqual(
      Array(5).fill(CALL_CODE_PAUSE),
    );
  });

  test("a leading zero is said as its digit, never dropped", () => {
    const twiml: string = twimlOf(
      { sayMessage: "Code 0  0  7.", code: "0  0  7" },
      SPEECH,
    );

    expect(spelledIn(twiml)).toEqual(["0", "0", "7"]);
  });

  test("by every voice a call in another language speaks with, and every voice an account chooses", () => {
    for (const voice of [...CALL_LANGUAGE_VOICES, ...CALL_VOICES]) {
      const twiml: string = twimlOf(sentence, {
        voice: voice.value,
        recordNumberPrefixes: [],
      });

      expect([voice.value, spelledIn(twiml)]).toEqual([
        voice.value,
        ["4", "8", "2", "9", "1", "3"],
      ]);
      expect(pausesIn(twiml)).toHaveLength(5);
      expect(twiml.startsWith(`<Say voice="${voice.value}"`)).toBe(true);
    }
  });

  test("with SSML not allowed - a call built again after its SSML failed - spaced out, as the sentence writes it", () => {
    expect(twimlOf(sentence, { ...SPEECH, isSsmlAllowed: false })).toBe(
      '<Say voice="Polly.Vicki-Neural" language="de-DE">Ihr Bestätigungscode lautet 4  8  2  9  1  3.</Say>',
    );
  });

  test("by the account's default voice, which reads no SSML: spaced out, with no voice named", () => {
    expect(
      twimlOf(sentence, { voice: undefined, recordNumberPrefixes: [] }),
    ).toBe("<Say>Ihr Bestätigungscode lautet 4  8  2  9  1  3.</Say>");
  });

  test("a sentence with no code is plain text in any voice: no SSML where nothing is spelled", () => {
    expect(
      twimlOf("Vielen Dank, dass Sie One Uptime nutzen. Auf Wiederhören.", {
        voice: GERMAN.value,
        recordNumberPrefixes: [],
      }),
    ).toBe(
      '<Say voice="Polly.Vicki-Neural" language="de-DE">Vielen Dank, dass Sie One Uptime nutzen. Auf Wiederhören.</Say>',
    );
  });

  test("the words around the code are escaped as every text of a call is: a code never smuggles TwiML", () => {
    const twiml: string = twimlOf(
      {
        sayMessage: "<Dial>+19005550100</Dial> 1  2",
        code: "1  2",
      },
      SPEECH,
    );

    expect(twiml).not.toContain("<Dial>");
    expect(twiml).toContain("&lt;Dial&gt;");
    expect(spelledIn(twiml)).toEqual(["1", "2"]);
  });
});
