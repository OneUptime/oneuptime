import {
  CallSpeechOptions,
  getCallSpeechVoice,
  getSayAttributes,
  sayInto,
} from "../../../../Server/Utils/Call/CallTwimlSpeech";
import { getCallTranslator } from "../../../../Server/Utils/ServerTranslation";
import OnCallKeypadToken, {
  OnCallKeypadTokenReading,
} from "../../../../Server/Utils/OnCall/OnCallKeypadToken";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import {
  CALL_LANGUAGE_VOICES,
  SpokenCallVoice,
} from "../../../../Types/Call/CallVoice";
import { OnCallInputRequest } from "../../../../Types/Call/CallRequest";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import { getSayRecordNumber, isSsmlVoice } from "../../../../Utils/Call/CallSpeech";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY <SAY> OF A CALL IN ANOTHER LANGUAGE, IN THAT LANGUAGE'S VOICE
 * (#11066).
 *
 * The voices a call speaks another language with are written into its
 * TwiML as the English ones are: named, with the language they speak, and
 * reading the record number's SSML. A bare number is said in the words of
 * the call's language. A call's keypad token carries its voice, so every
 * answer is said in it.
 */

const PREFIXES: ReadonlyArray<string> = ["#", "INC-"];

const NOTIFICATION: ObjectID = new ObjectID(
  "0fa11066-0000-4000-8000-0000000000a1",
);

function twimlOf(
  sentences: Array<string | { sayMessage: string; recordNumber?: string }>,
  speech: CallSpeechOptions,
): string {
  const response: VoiceResponse = new VoiceResponse();

  for (const sentence of sentences) {
    sayInto(response, sentence, speech);
  }

  return response
    .toString()
    .replace('<?xml version="1.0" encoding="UTF-8"?><Response>', "")
    .replace("</Response>", "");
}

describe.each(
  CALL_LANGUAGE_VOICES.map((voice: SpokenCallVoice): [string, SpokenCallVoice] => {
    return [voice.value, voice];
  }),
)("%s", (_value: string, voice: SpokenCallVoice) => {
  test("is named on every <Say>, with the language it speaks", () => {
    expect(getCallSpeechVoice({ voice: voice.value, recordNumberPrefixes: [] }))
      .toBe(voice);
    expect(getSayAttributes(voice)).toEqual({
      voice: voice.value,
      language: voice.language,
    });
    expect(
      twimlOf(["1"], { voice: voice.value, recordNumberPrefixes: PREFIXES }),
    ).toBe(`<Say voice="${voice.value}" language="${voice.language}">1</Say>`);
  });

  test("spells a record's number with SSML, as the English voices do", () => {
    expect(isSsmlVoice(voice.value)).toBe(true);
    expect(
      twimlOf([{ sayMessage: "INC-42.", recordNumber: "INC-42" }], {
        voice: voice.value,
        recordNumberPrefixes: PREFIXES,
      }),
    ).toBe(
      `<Say voice="${voice.value}" language="${voice.language}"><say-as interpret-as="characters">INC</say-as> 42.</Say>`,
    );
  });

  test("its keypad token carries it, so every answer is said in it", () => {
    const answers: OnCallInputRequest = {
      "1": { sayMessage: "1" },
      default: { sayMessage: "default" },
    };
    const token: string = OnCallKeypadToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
      answers: answers,
      voice: voice.value,
    });
    const claims: JSONObject = JSONFunctions.deserialize(
      JSONWebToken.decodeJsonPayload(token),
    );
    const reading: OnCallKeypadTokenReading = OnCallKeypadToken.read({
      claims: claims,
      userOnCallLogTimelineId: NOTIFICATION,
      pageToken: undefined,
    });

    expect(reading).toMatchObject({ isAccepted: true, voice: voice.value });
  });
});

describe("a call's words in its language", () => {
  test("say a bare number in that language's words", () => {
    expect(
      twimlOf([{ sayMessage: "Vorfall #42.", recordNumber: "#42" }], {
        voice: "Polly.Vicki-Neural",
        recordNumberPrefixes: PREFIXES,
        isSsmlAllowed: false,
        sayNumber: getSayRecordNumber(getCallTranslator("de")),
      }),
    ).toBe(
      '<Say voice="Polly.Vicki-Neural" language="de-DE">Vorfall Nummer 42.</Say>',
    );
    // English's "number 42" without words of the call's own.
    expect(
      twimlOf([{ sayMessage: "Incident #42.", recordNumber: "#42" }], {
        voice: "Polly.Joanna-Neural",
        recordNumberPrefixes: PREFIXES,
      }),
    ).toBe(
      '<Say voice="Polly.Joanna-Neural" language="en-US">Incident number 42.</Say>',
    );
  });

  test("keep their own script through the TwiML builder, escaped as any text", () => {
    expect(
      twimlOf(["あなたを呼び出しました <Dial>。"], {
        voice: "Polly.Kazuha-Neural",
        recordNumberPrefixes: PREFIXES,
      }),
    ).toBe(
      '<Say voice="Polly.Kazuha-Neural" language="ja-JP">あなたを呼び出しました &lt;Dial&gt;。</Say>',
    );
  });

  test("a prompt carried in another language comes back from the keypad token as it was written", () => {
    const token: string = OnCallKeypadToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
      answers: {
        "1": { sayMessage: "आपने यह घटना स्वीकार की। नमस्ते" },
        default: { sayMessage: "उस कुंजी से कुछ नहीं होता।" },
      },
      prompt: {
        sayMessage:
          "स्वीकार करने के लिए 1 दबाएँ, या एस्केलेट करने के लिए 2 दबाएँ।",
        noInputMessage: "आपने कोई कुंजी नहीं दबाई। नमस्ते।",
        timeoutInSeconds: 10,
      },
      voice: "Polly.Kajal-Neural",
    });
    const reading: OnCallKeypadTokenReading = OnCallKeypadToken.read({
      claims: JSONFunctions.deserialize(JSONWebToken.decodeJsonPayload(token)),
      userOnCallLogTimelineId: NOTIFICATION,
      pageToken: undefined,
    });

    expect(reading).toMatchObject({
      isAccepted: true,
      voice: "Polly.Kajal-Neural",
      prompt: {
        sayMessage:
          "स्वीकार करने के लिए 1 दबाएँ, या एस्केलेट करने के लिए 2 दबाएँ।",
        noInputMessage: "आपने कोई कुंजी नहीं दबाई। नमस्ते।",
        timeoutInSeconds: 10,
      },
    });
    expect(
      (reading as { answers: OnCallInputRequest }).answers["1"]?.sayMessage,
    ).toBe("आपने यह घटना स्वीकार की। नमस्ते");
  });
});
