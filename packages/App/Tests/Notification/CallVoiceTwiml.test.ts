import CallService from "../../FeatureSet/Notification/Services/CallService";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger from "Common/Server/Utils/Logger";
import OnCallKeypadToken, {
  OnCallKeypadTokenReading,
} from "Common/Server/Utils/OnCall/OnCallKeypadToken";
import URL from "Common/Types/API/URL";
import { CALL_VOICES, CallVoice } from "Common/Types/Call/CallVoice";
import CallRequest, {
  CallRequestMessage,
  GatherInput,
  OnCallInputRequest,
} from "Common/Types/Call/CallRequest";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { MAX_CALL_TWIML_LENGTH } from "Common/Utils/MessageFit";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import {
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
} from "@xmldom/xmldom";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * THE VOICE A CALL SPEAKS WITH, AND HOW ITS PROMPT TAKES A KEY (#10948,
 * #10949).
 *
 * The TwiML of a page's call, read element by element through the real
 * CallService and Twilio's real builder:
 *
 *   - with no voice chosen, as every call was: no voice named, a record
 *     number in spaced letters;
 *   - with each voice OneUptime offers: every <Say> of the call names it
 *     and the language it speaks, and a record number is spelled with SSML
 *     - the only SSML a call carries, so the keys are plain text in it;
 *   - a voice whose SSML, or whose name, cannot be built never loses the
 *     page: the call is built in spaced letters, then in the account's
 *     default voice;
 *   - the prompt takes every key - # and * too - and its keypad token
 *     carries what the keypad route needs to ask again after a wrong key,
 *     and the voice to answer in.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0fa10948-0000-4000-8000-0000000000c1",
);

const RESPONSE_URL: string =
  "https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/0fa10948-0000-4000-8000-0000000000c1?pageToken=page-link-token";

const ANSWERS: OnCallInputRequest = {
  "1": { sayMessage: "You have acknowledged this incident. Good bye" },
  default: {
    sayMessage:
      "That key does nothing, so this incident is not acknowledged. Good bye.",
  },
};

const PROMPT: string = "Press 1 to acknowledge, or 2 to escalate.";
const NO_INPUT: string =
  "You did not press a key, so this incident is not acknowledged. Good bye.";

function pageCall(title: string = "Checkout API is down"): CallRequest {
  const prompt: GatherInput = {
    introMessage: PROMPT,
    numDigits: 1,
    timeoutInSeconds: 10,
    noInputMessage: NO_INPUT,
    onInputCallRequest: ANSWERS,
    responseUrl: URL.fromString(RESPONSE_URL),
  };

  return {
    to: new Phone("+15555550142"),
    data: [
      { sayMessage: "This is a call from Acme Production." },
      {
        sayMessage: "A new Critical Incident has been created: INC-42.",
        recordNumber: "INC-42",
        repeated: true,
      },
      { sayMessage: title, afterPrompt: true, repeated: true },
      prompt,
    ],
  };
}

function twimlOf(
  callRequest: CallRequestMessage,
  voice?: string | undefined,
): string {
  return CallService.generateTwimlForCall(callRequest, {
    userOnCallLogTimelineId: NOTIFICATION,
    voice: voice,
    recordNumberPrefixes: ["#", "INC-"],
  });
}

function responseOf(twiml: string): XmlElement {
  return new DOMParser().parseFromString(twiml, "text/xml")
    .documentElement as XmlElement;
}

function allElements(element: XmlElement): Array<XmlElement> {
  const found: Array<XmlElement> = [];

  for (let index: number = 0; index < element.childNodes.length; index++) {
    const child: XmlNode = element.childNodes[index]!;

    if (child.nodeType === child.ELEMENT_NODE) {
      found.push(child as XmlElement, ...allElements(child as XmlElement));
    }
  }

  return found;
}

function saysOf(twiml: string): Array<XmlElement> {
  return allElements(responseOf(twiml)).filter(
    (element: XmlElement): boolean => {
      return element.tagName === "Say";
    },
  );
}

function gatherOf(twiml: string): XmlElement {
  const gathers: Array<XmlElement> = allElements(responseOf(twiml)).filter(
    (element: XmlElement): boolean => {
      return element.tagName === "Gather";
    },
  );

  expect(gathers).toHaveLength(1);

  return gathers[0]!;
}

// The claims of the call's keypad token, as the keypad route reads them.
function keypadOf(twiml: string): OnCallKeypadTokenReading {
  const action: globalThis.URL = new globalThis.URL(
    gatherOf(twiml).getAttribute("action")!,
  );
  const claims: JSONObject = JSONFunctions.deserialize(
    JSONWebToken.decodeJsonPayload(action.searchParams.get("token")!),
  );

  return OnCallKeypadToken.read({
    claims: claims,
    userOnCallLogTimelineId: NOTIFICATION,
    pageToken: undefined,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the prompt takes every key", () => {
  test("no key ends it early: # and * reach the keypad route, which asks again", () => {
    const gather: XmlElement = gatherOf(twimlOf(pageCall()));

    expect(gather.hasAttribute("finishOnKey")).toBe(true);
    expect(gather.getAttribute("finishOnKey")).toBe("");
    expect(gather.getAttribute("numDigits")).toBe("1");
    expect(gather.getAttribute("input")).toBe("dtmf");
  });

  test("its keypad token carries the prompt, its words for silence and how long it listens", () => {
    const keypad: OnCallKeypadTokenReading = keypadOf(twimlOf(pageCall()));

    expect(keypad).toMatchObject({
      isAccepted: true,
      isEarlierCall: false,
      prompt: {
        sayMessage: PROMPT,
        noInputMessage: NO_INPUT,
        timeoutInSeconds: 10,
      },
    });
    // What each key answers is where it always was.
    expect((keypad as { answers: OnCallInputRequest }).answers["1"]).toEqual(
      ANSWERS["1"],
    );
  });

  test("a prompt with no timeout listens Twilio's 5 seconds, and asks again as long", () => {
    const call: CallRequest = pageCall();
    (call.data[3] as GatherInput).timeoutInSeconds = 0;

    const twiml: string = twimlOf(call);

    expect(gatherOf(twiml).getAttribute("timeout")).toBe("5");
    expect(
      (keypadOf(twiml) as { prompt: { timeoutInSeconds: number } }).prompt
        .timeoutInSeconds,
    ).toBe(5);
  });
});

describe("no voice chosen: the call is as every call was", () => {
  test("no <Say> names a voice or a language, and a record number is spaced letters", () => {
    const twiml: string = twimlOf(pageCall());

    for (const say of saysOf(twiml)) {
      expect(say.hasAttribute("voice")).toBe(false);
      expect(say.hasAttribute("language")).toBe(false);
    }

    expect(twiml).toContain(
      "<Say>A new Critical Incident has been created: I N C 42.</Say>",
    );
    expect(twiml).not.toContain("say-as");
    expect((keypadOf(twiml) as { voice?: string }).voice).toBeUndefined();
  });
});

describe.each(
  CALL_VOICES.map((voice: CallVoice): [string, CallVoice] => {
    return [voice.value, voice];
  }),
)("%s", (_value: string, voice: CallVoice) => {
  test("every <Say> of the call names it and the language it speaks: one call, one voice", () => {
    const says: Array<XmlElement> = saysOf(twimlOf(pageCall(), voice.value));

    // Who calls, what happened, the keys, the title, twice; then the goodbye.
    expect(says).toHaveLength(8);

    for (const say of says) {
      expect(say.getAttribute("voice")).toBe(voice.value);
      expect(say.getAttribute("language")).toBe(voice.language);
    }
  });

  test("a record number is spelled with SSML, and nothing else is: the keys are plain text", () => {
    const twiml: string = twimlOf(pageCall(), voice.value);
    const sayAs: Array<XmlElement> = allElements(responseOf(twiml)).filter(
      (element: XmlElement): boolean => {
        return element.tagName === "say-as";
      },
    );

    // The headline, twice.
    expect(sayAs).toHaveLength(2);

    for (const each of sayAs) {
      expect(each.getAttribute("interpret-as")).toBe("characters");
      expect(each.textContent).toBe("INC");
    }

    for (const say of saysOf(twiml)) {
      if ((say.textContent || "").includes("Press 1")) {
        expect(allElements(say)).toHaveLength(0);
        expect(say.textContent).toBe(PROMPT);
      }
    }
  });

  test("its keypad token carries the voice, so every answer to a key is said in it", () => {
    expect(
      (keypadOf(twimlOf(pageCall(), voice.value)) as { voice?: string }).voice,
    ).toBe(voice.value);
  });

  test("the message left on voicemail is said in it too", () => {
    expect(
      CallService.generateVoicemailTwiml(
        "This is a call from OneUptime about an on-call page.",
        { voice: voice.value },
      ),
    ).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${voice.value}" language="${voice.language}">This is a call from One Uptime about an on-call page.</Say><Hangup/></Response>`,
    );
  });

  test("the call stays within the TwiML Twilio takes, with the longest title", () => {
    const twiml: string = twimlOf(
      pageCall("The checkout service returned an error. ".repeat(400)),
      voice.value,
    );

    expect(twiml.length).toBeLessThanOrEqual(MAX_CALL_TWIML_LENGTH);
    expect(
      saysOf(twiml).filter((say: XmlElement): boolean => {
        return say.textContent === PROMPT;
      }),
    ).toHaveLength(2);
  });
});

describe("a voice OneUptime does not offer is never named", () => {
  test.each([
    "man",
    "alice",
    "Polly.Joanna",
    "Google.en-US-Chirp3-HD-Aoede",
    "polly.joanna-neural",
    'Polly.Joanna-Neural" language="xx-XX',
  ])("%s: the call is as one with no voice chosen", (voice: string) => {
    const twiml: string = twimlOf(pageCall(), voice);

    expect(twiml).not.toContain("voice=");
    expect(twiml).not.toContain("say-as");
    expect((keypadOf(twiml) as { voice?: string }).voice).toBeUndefined();
  });

  test("voicemail too", () => {
    expect(
      CallService.generateVoicemailTwiml("Good bye.", { voice: "man" }),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Good bye.</Say><Hangup/></Response>',
    );
    expect(CallService.generateVoicemailTwiml("Good bye.")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Good bye.</Say><Hangup/></Response>',
    );
  });
});

/*
 * A VOICE THAT FAILS SSML NEVER LOSES THE PAGE.
 *
 * Should the SSML of a voice ever fail to build - Twilio's builder refusing
 * a say-as - the call is built again in spaced letters, in the same voice;
 * should the voice itself fail, in the account's default voice, as every
 * call was built before voices could be chosen. Either way the page's call
 * is placed, its keys intact.
 */
describe("a voice that fails never loses the page", () => {
  test("SSML that cannot be built: the call is built in spaced letters, in the same voice, its keys and token intact", () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {});
    const sayAs: jest.SpyInstance = jest
      .spyOn(VoiceResponse.Say.prototype, "sayAs")
      .mockImplementation(() => {
        throw new Error("say-as is not supported");
      });

    const twiml: string = twimlOf(pageCall(), "Polly.Joanna-Neural");

    expect(sayAs).toHaveBeenCalled();
    expect(twiml).not.toContain("say-as");
    expect(twiml).toContain(
      '<Say voice="Polly.Joanna-Neural" language="en-US">A new Critical Incident has been created: I N C 42.</Say>',
    );
    expect(gatherOf(twiml).getAttribute("finishOnKey")).toBe("");
    expect(keypadOf(twiml)).toMatchObject({
      isAccepted: true,
      voice: "Polly.Joanna-Neural",
      prompt: { sayMessage: PROMPT },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not be built in Polly.Joanna-Neural with SSML, so it is built with spaced letters instead",
      ),
    );
  });

  test("a voice that cannot be built at all: the call is built in the account's default voice, as every call was", () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {});

    const failsWithAVoice: (
      original: (...args: Array<unknown>) => unknown,
    ) => (this: unknown, ...args: Array<unknown>) => unknown = (
      original: (...args: Array<unknown>) => unknown,
    ) => {
      return function (this: unknown, ...args: Array<unknown>): unknown {
        const attributes: unknown = args[0];

        if (
          attributes &&
          typeof attributes === "object" &&
          (attributes as { voice?: unknown }).voice
        ) {
          throw new Error("this voice is not available");
        }

        return original.apply(this, args);
      };
    };

    const gatherSay: (...args: Array<unknown>) => unknown = VoiceResponse.Gather
      .prototype.say as never;
    const responseSay: (...args: Array<unknown>) => unknown = VoiceResponse
      .prototype.say as never;

    jest
      .spyOn(VoiceResponse.Gather.prototype, "say")
      .mockImplementation(failsWithAVoice(gatherSay) as never);
    jest
      .spyOn(VoiceResponse.prototype, "say")
      .mockImplementation(failsWithAVoice(responseSay) as never);

    const twiml: string = twimlOf(pageCall(), "Google.en-US-Neural2-F");

    expect(twiml).not.toContain("voice=");
    expect(twiml).toContain(
      "<Say>A new Critical Incident has been created: I N C 42.</Say>",
    );
    // The keys still go where they always went, and its answers in the default voice.
    expect(gatherOf(twiml).getAttribute("action")).toContain("token=");
    expect(keypadOf(twiml)).toMatchObject({
      isAccepted: true,
      prompt: { sayMessage: PROMPT },
    });
    expect((keypadOf(twiml) as { voice?: string }).voice).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("in the account's default voice instead"),
    );
  });

  test("a call that cannot be built even so fails as it always did, rather than being placed with nothing to say", () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {});
    jest.spyOn(VoiceResponse.prototype, "hangup").mockImplementation(() => {
      throw new Error("the builder is broken");
    });

    expect(() => {
      return twimlOf(pageCall(), "Polly.Brian-Neural");
    }).toThrow("the builder is broken");
  });
});
