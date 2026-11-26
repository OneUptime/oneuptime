import CallService, {
  CALL_PROMPT_REPEATS,
  CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS,
  getCallGatewayMessage,
  getCallVoicemailWords,
} from "../../FeatureSet/Notification/Services/CallService";
import Project from "Common/Models/DatabaseModels/Project";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import { ON_CALL_KEYPAD_TOKEN_PURPOSE } from "Common/Server/Utils/OnCall/OnCallKeypadToken";
import URL from "Common/Types/API/URL";
import CallRequest, {
  CallRequestMessage,
  GatherInput,
  OnCallInputRequest,
  Say,
} from "Common/Types/Call/CallRequest";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { MAX_CALL_TWIML_LENGTH } from "Common/Utils/MessageFit";
import { CALL_VOICES } from "Common/Types/Call/CallVoice";
import {
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
} from "@xmldom/xmldom";
import { describe, expect, test } from "@jest/globals";

/*
 * A CALL THAT ASKS FOR A KEY TAKES ONE AT ANY MOMENT, AND ASKS TWICE (#10762).
 *
 * The TwiML an on-call call is made with used to say its words, then open an
 * empty <Gather>: a key pressed while it spoke was dropped, the keys came
 * after a title of any length, and a person who missed them heard them once
 * and was hung up on. Now everything is said inside the <Gather input="dtmf">
 * (barge-in): who calls and what happened, the prompt, the details after it;
 * then, after a pause, the details and the prompt again. Twilio waits the
 * prompt's timeout once all of it is said, and a call nobody answered says
 * its no-input words and ends - the page left as it was, not acknowledged.
 *
 * Each TwiML here is parsed as XML and read element by element, through the
 * real CallService and Twilio's real TwiML builder: no title, project name
 * or severity can become TwiML or SSML.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0fa10762-0000-4000-8000-000000000001",
);

const RESPONSE_URL: string =
  "https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/0fa10762-0000-4000-8000-000000000001?pageToken=page-link-token";

const ANSWERS: OnCallInputRequest = {
  "1": { sayMessage: "You have acknowledged this incident. Good bye" },
  default: { sayMessage: "Invalid input. Good bye" },
};

const PROMPT: string = "Press 1 to acknowledge, or 2 to escalate.";
const NO_INPUT: string =
  "You did not press a key, so this incident is not acknowledged. Good bye.";

// A prompt for a key, as an on-call page's call carries one.
function prompt(overrides: Partial<GatherInput> = {}): GatherInput {
  return {
    introMessage: PROMPT,
    numDigits: 1,
    timeoutInSeconds: 10,
    noInputMessage: NO_INPUT,
    onInputCallRequest: ANSWERS,
    responseUrl: URL.fromString(RESPONSE_URL),
    ...overrides,
  };
}

// An on-call page's call, as this release's worker writes one.
function pageCall(
  options: {
    title?: string;
    projectName?: string;
    headline?: string;
    recordNumber?: string | undefined;
    personMessage?: string;
  } = {},
): CallRequest {
  const data: CallRequestMessage["data"] = [
    {
      sayMessage: `This is a call from ${options.projectName ?? "Acme Production"}.`,
    },
    {
      sayMessage:
        options.headline ?? "A new Critical Incident has been created: INC-42.",
      ...(options.recordNumber === undefined && options.headline !== undefined
        ? {}
        : { recordNumber: options.recordNumber ?? "INC-42" }),
      repeated: true,
    },
    {
      sayMessage:
        options.title ?? "Checkout API is down for customers in Europe",
      afterPrompt: true,
      repeated: true,
    },
  ];

  if (options.personMessage) {
    data.push({ sayMessage: options.personMessage, afterPrompt: true });
  }

  data.push(prompt());

  return { to: new Phone("+15555550142"), data: data };
}

// The TwiML of a call, parsed: its <Response>.
function responseOf(twiml: string): XmlElement {
  const document: ReturnType<DOMParser["parseFromString"]> =
    new DOMParser().parseFromString(twiml, "text/xml");

  const response: XmlElement | null = document.documentElement;

  expect(response).not.toBeNull();
  expect(response!.tagName).toBe("Response");

  return response!;
}

// The elements directly inside one, in order.
function childrenOf(element: XmlElement): Array<XmlElement> {
  const children: Array<XmlElement> = [];

  for (let index: number = 0; index < element.childNodes.length; index++) {
    const child: XmlNode = element.childNodes[index]!;

    if (child.nodeType === child.ELEMENT_NODE) {
      children.push(child as XmlElement);
    }
  }

  return children;
}

function tagsOf(element: XmlElement): Array<string> {
  return childrenOf(element).map((child: XmlElement): string => {
    return child.tagName;
  });
}

// What one element says: its text, its SSML's text included.
function textOf(element: XmlElement): string {
  return element.textContent || "";
}

// The texts a part of the call says, in order.
function saidIn(element: XmlElement): Array<string> {
  return childrenOf(element)
    .filter((child: XmlElement): boolean => {
      return child.tagName === "Say";
    })
    .map(textOf);
}

// Every element of the TwiML, at any depth.
function allElements(element: XmlElement): Array<XmlElement> {
  return childrenOf(element).flatMap((child: XmlElement) => {
    return [child, ...allElements(child)];
  });
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

function twimlOf(
  callRequest: CallRequestMessage,
  voice?: string | undefined,
): string {
  return CallService.generateTwimlForCall(callRequest, {
    userOnCallLogTimelineId: NOTIFICATION,
    voice: voice,
  });
}

describe("everything is said inside the <Gather>, so a key stops it at any moment (barge-in)", () => {
  test("the call is the prompt, then its no-input words, then it hangs up", () => {
    expect(tagsOf(responseOf(twimlOf(pageCall())))).toEqual([
      "Gather",
      "Say",
      "Hangup",
    ]);
  });

  test("the <Gather> listens for keys only, one of them, and posts it", () => {
    const gather: XmlElement = gatherOf(twimlOf(pageCall()));

    expect(gather.getAttribute("input")).toBe("dtmf");
    expect(gather.getAttribute("numDigits")).toBe("1");
    expect(gather.getAttribute("method")).toBe("POST");
    expect(gather.getAttribute("timeout")).toBe("10");
  });

  test("who calls, what happened, the prompt and the title are all children of the <Gather>, never before it", () => {
    const twiml: string = twimlOf(pageCall());
    const response: XmlElement = responseOf(twiml);

    expect(saidIn(response)).toEqual([NO_INPUT]);
    expect(saidIn(gatherOf(twiml))).toContain(
      "This is a call from Acme Production.",
    );
    expect(saidIn(gatherOf(twiml))).toContain(PROMPT);
  });
});

describe("the prompt comes before the title, and the details and prompt are said twice", () => {
  test("first: who calls, what happened, the prompt, the title; after a pause: what happened, the title, the prompt", () => {
    const gather: XmlElement = gatherOf(twimlOf(pageCall()));

    expect(tagsOf(gather)).toEqual([
      "Say",
      "Say",
      "Say",
      "Say",
      "Pause",
      "Say",
      "Say",
      "Say",
    ]);
    expect(saidIn(gather)).toEqual([
      "This is a call from Acme Production.",
      "A new Critical Incident has been created: I N C 42.",
      PROMPT,
      "Checkout API is down for customers in Europe",
      "A new Critical Incident has been created: I N C 42.",
      "Checkout API is down for customers in Europe",
      PROMPT,
    ]);
  });

  test("the pause is silence the call still listens through, of the length set", () => {
    const pauses: Array<XmlElement> = childrenOf(
      gatherOf(twimlOf(pageCall())),
    ).filter((element: XmlElement): boolean => {
      return element.tagName === "Pause";
    });

    expect(CALL_PROMPT_REPEATS).toBe(1);
    expect(CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS).toBe(5);
    expect(pauses).toHaveLength(CALL_PROMPT_REPEATS);
    expect(pauses[0]!.getAttribute("length")).toBe("5");
  });

  test("a person's message is said once, after the title; who calls is said once", () => {
    const said: Array<string> = saidIn(
      gatherOf(
        twimlOf(
          pageCall({
            personMessage: "Alice Kim says: Can you check the database?",
          }),
        ),
      ),
    );

    expect(said).toEqual([
      "This is a call from Acme Production.",
      "A new Critical Incident has been created: I N C 42.",
      PROMPT,
      "Checkout API is down for customers in Europe",
      "Alice Kim says: Can you check the database?",
      "A new Critical Incident has been created: I N C 42.",
      "Checkout API is down for customers in Europe",
      PROMPT,
    ]);
  });

  test("once all of it is said, the call waits the prompt's timeout, says its no-input words and ends", () => {
    const response: XmlElement = responseOf(twimlOf(pageCall()));
    const children: Array<XmlElement> = childrenOf(response);

    expect(children[0]!.getAttribute("timeout")).toBe("10");
    expect(children[1]!.tagName).toBe("Say");
    expect(textOf(children[1]!)).toBe(NO_INPUT);
    expect(children[2]!.tagName).toBe("Hangup");
    // Nothing posts the empty result: the page is left as it was.
    expect(children[0]!.getAttribute("actionOnEmptyResult")).toBeNull();
  });

  test("a prompt with no timeout waits Twilio's 5 seconds, as before", () => {
    const call: CallRequest = pageCall();
    call.data[call.data.length - 1] = prompt({ timeoutInSeconds: 0 });

    expect(gatherOf(twimlOf(call)).getAttribute("timeout")).toBe("5");
  });
});

describe("a call from a worker of the release before, while an upgrade rolls out", () => {
  // Its words as it wrote them: no place, nothing marked to say again.
  const earlierCall: CallRequest = {
    to: new Phone("+15555550142"),
    data: [
      { sayMessage: "This is a call from One Uptime" },
      { sayMessage: "A new incident has been created" },
      { sayMessage: "Incident number INC-42, Checkout API is down" },
      prompt({
        introMessage:
          "To acknowledge this incident, press 1. If you can't take it, press 2 to escalate.",
        noInputMessage: "You have not entered any input. Good bye",
      }),
    ],
  };

  test("is said in its own order, inside the <Gather>, and asks for the keys again after a pause", () => {
    const twiml: string = twimlOf(earlierCall);
    const gather: XmlElement = gatherOf(twiml);

    expect(tagsOf(gather)).toEqual([
      "Say",
      "Say",
      "Say",
      "Say",
      "Pause",
      "Say",
    ]);
    expect(saidIn(gather)).toEqual([
      "This is a call from One Uptime",
      "A new incident has been created",
      "Incident number INC-42, Checkout API is down",
      "To acknowledge this incident, press 1. If you can't take it, press 2 to escalate.",
      "To acknowledge this incident, press 1. If you can't take it, press 2 to escalate.",
    ]);
    expect(saidIn(responseOf(twiml))).toEqual([
      "You have not entered any input. Good bye",
    ]);
  });
});

describe("a call that asks for no key says its sentences, as it always did", () => {
  test("a verification code: its sentences in order, then it hangs up - no <Gather>, no <Pause>", () => {
    const twiml: string = twimlOf({
      data: [
        { sayMessage: "This is a call from OneUptime." },
        { sayMessage: "Your verification code is 1  2  3  4  5  6" },
        { sayMessage: "Thank you for using OneUptime. Good bye." },
      ],
    });

    expect(tagsOf(responseOf(twiml))).toEqual(["Say", "Say", "Say", "Hangup"]);
    expect(saidIn(responseOf(twiml))).toEqual([
      "This is a call from One Uptime.",
      "Your verification code is 1  2  3  4  5  6",
      "Thank you for using One Uptime. Good bye.",
    ]);
  });
});

describe("a record's number is spelled, so INC is never read as Incorporated", () => {
  test("for the account's default voice - every call OneUptime places - with spaced letters, and no SSML", () => {
    const twiml: string = twimlOf(pageCall());

    expect(twiml).toContain(
      "A new Critical Incident has been created: I N C 42.",
    );
    expect(twiml).not.toContain("say-as");
    expect(twiml).not.toContain("INC-42");
    // No voice is named: Twilio's account default speaks.
    for (const say of allElements(responseOf(twiml)).filter(
      (element: XmlElement): boolean => {
        return element.tagName === "Say";
      },
    )) {
      expect(say.getAttribute("voice")).toBeNull();
    }
  });

  test("a voice OneUptime does not offer - a Basic voice, or a Polly or Google voice not on its list - is never named: the account's default speaks, with spaced letters", () => {
    for (const voice of [
      "man",
      "woman",
      "alice",
      "Polly.Joanna",
      "Google.en-US-Standard-C",
      "Google.en-US-Chirp3-HD-Aoede",
    ]) {
      const twiml: string = twimlOf(pageCall(), voice);

      expect(twiml).toContain(
        "<Say>A new Critical Incident has been created: I N C 42.</Say>",
      );
      expect(twiml).not.toContain("say-as");
      expect(twiml).not.toContain("voice=");
      expect(twiml).not.toContain(voice);
    }
  });

  test("for each voice OneUptime offers - Amazon Polly's and Google's - with SSML's say-as characters", () => {
    for (const { value: voice, language } of CALL_VOICES) {
      const twiml: string = twimlOf(pageCall(), voice);
      const headline: XmlElement = childrenOf(gatherOf(twiml))[1]!;
      const sayAs: Array<XmlElement> = childrenOf(headline);

      expect(headline.getAttribute("voice")).toBe(voice);
      expect(headline.getAttribute("language")).toBe(language);
      expect(sayAs).toHaveLength(1);
      expect(sayAs[0]!.tagName).toBe("say-as");
      expect(sayAs[0]!.getAttribute("interpret-as")).toBe("characters");
      expect(textOf(sayAs[0]!)).toBe("INC");
      expect(textOf(headline)).toBe(
        "A new Critical Incident has been created: INC 42.",
      );
      expect(twiml).toContain(
        `<Say voice="${voice}" language="${language}">A new Critical Incident has been created: <say-as interpret-as="characters">INC</say-as> 42.</Say>`,
      );
      // Every sentence is spoken by the voice named, in the language it speaks.
      for (const say of allElements(responseOf(twiml)).filter(
        (element: XmlElement): boolean => {
          return element.tagName === "Say";
        },
      )) {
        expect(say.getAttribute("voice")).toBe(voice);
        expect(say.getAttribute("language")).toBe(language);
      }
    }
  });

  test("#42, a number without a prefix, is number 42", () => {
    const twiml: string = twimlOf(
      pageCall({
        headline: "A new incident has been created: #42.",
        recordNumber: "#42",
      }),
    );

    expect(saidIn(gatherOf(twiml))[1]).toBe(
      "A new incident has been created: number 42.",
    );
  });

  test("a sentence with no record number is said as written", () => {
    const twiml: string = twimlOf(
      pageCall({
        headline: "A new incident has been created.",
        recordNumber: undefined,
      }),
    );

    expect(saidIn(gatherOf(twiml))[1]).toBe("A new incident has been created.");
  });
});

describe("a number written with one of the project's prefixes is spelled in any call", () => {
  test("an owner's message, which carries no record number of its own", () => {
    const twiml: string = CallService.generateTwimlForCall(
      {
        data: [
          {
            sayMessage:
              "This is a message from OneUptime. New incident created: INC-42 (Checkout down after ALT-7). Good bye.",
          },
        ],
      },
      { recordNumberPrefixes: ["#", "INC-", "ALT-"] },
    );

    expect(saidIn(responseOf(twiml))).toEqual([
      "This is a message from One Uptime. New incident created: I N C 42 (Checkout down after A L T 7). Good bye.",
    ]);
  });

  test("a page's title that names another record", () => {
    const twiml: string = CallService.generateTwimlForCall(
      pageCall({ title: "Checkout down again after INC-41 was resolved" }),
      {
        userOnCallLogTimelineId: NOTIFICATION,
        recordNumberPrefixes: ["#", "INC-"],
      },
    );

    expect(saidIn(gatherOf(twiml))[3]).toBe(
      "Checkout down again after I N C 41 was resolved",
    );
  });

  test("with SSML for a voice that reads it", () => {
    const twiml: string = CallService.generateTwimlForCall(
      { data: [{ sayMessage: "New alert created: ALT-7." }] },
      { voice: "Polly.Joanna-Neural", recordNumberPrefixes: ["ALT-"] },
    );

    expect(twiml).toContain(
      `<Say voice="Polly.Joanna-Neural" language="en-US">New alert created: <say-as interpret-as="characters">ALT</say-as> 7.</Say>`,
    );
  });

  test("a call without the project's prefixes says the text as written", () => {
    expect(
      saidIn(
        responseOf(
          CallService.generateTwimlForCall({
            data: [{ sayMessage: "New incident created: INC-42." }],
          }),
        ),
      ),
    ).toEqual(["New incident created: INC-42."]);
  });

  test("a voicemail spells them too", () => {
    expect(
      getCallVoicemailWords(
        {
          to: new Phone("+15555550142"),
          data: [{ sayMessage: "New incident created: INC-42" }],
        },
        ["INC-"],
      ),
    ).toBe("New incident created: I N C 42.");
  });

  test("the prefixes are the project's own, each kind's, and # for a number without one", () => {
    const project: Project = new Project();
    project.incidentNumberPrefix = "INC-";
    project.alertNumberPrefix = " ALT- ";
    project.incidentEpisodeNumberPrefix = "INC-";
    project.alertEpisodeNumberPrefix = "";
    project.securityCaseNumberPrefix = "CASE-";

    expect(CallService.getRecordNumberPrefixes(project)).toEqual([
      "#",
      "INC-",
      "ALT-",
      "CASE-",
    ]);
    expect(CallService.getRecordNumberPrefixes(new Project())).toEqual(["#"]);
    expect(CallService.getRecordNumberPrefixes(null)).toEqual([]);
  });
});

describe("the product's name", () => {
  test("is said as two words, as text to speech says it right", () => {
    const twiml: string = twimlOf(pageCall({ projectName: "OneUptime" }));

    expect(saidIn(gatherOf(twiml))[0]).toBe("This is a call from One Uptime.");
  });

  test("is the installation's own name when it goes by one", () => {
    const branded: CallRequest = ProductBrandingText.brandCallRequest(
      pageCall({ projectName: "OneUptime" }),
      { productName: "Acme Monitoring" },
    );

    expect(saidIn(gatherOf(twimlOf(branded)))[0]).toBe(
      "This is a call from Acme Monitoring.",
    );
  });
});

describe("no title, project or severity can change the call's TwiML", () => {
  const HOSTILE: Array<string> = [
    `</Say><Dial>+19005550100</Dial><Say>`,
    `<Hangup/>`,
    `Latency > 2s & errors < 1% for "checkout" 'eu'`,
    `<say-as interpret-as="characters">INC</say-as>`,
    `<break time="10s"/> <prosody rate="x-slow">slow</prosody>`,
    `]]><![CDATA[ <Redirect>https://evil.example/twiml</Redirect>`,
    `&lt;Dial&gt; &amp;&amp; &#x3C;Play&#x3E;`,
  ];

  for (const voice of [undefined, "Polly.Joanna-Neural"]) {
    describe(`for ${voice || "the account's default voice"}`, () => {
      test.each(HOSTILE)("a title %s is only ever spoken", (title: string) => {
        const twiml: string = twimlOf(pageCall({ title: title }), voice);
        const gather: XmlElement = gatherOf(twiml);

        // Only <Say> and <Pause> inside the <Gather>, as ever.
        expect(new Set(tagsOf(gather))).toEqual(new Set(["Say", "Pause"]));
        // No verb or SSML a title names; the only SSML is the record number's.
        const tags: Array<string> = allElements(responseOf(twiml)).map(
          (element: XmlElement): string => {
            return element.tagName;
          },
        );

        for (const injected of [
          "Dial",
          "Redirect",
          "Play",
          "break",
          "prosody",
        ]) {
          expect(tags).not.toContain(injected);
        }

        expect(
          allElements(responseOf(twiml)).filter((element: XmlElement) => {
            return element.tagName === "say-as";
          }),
        ).toHaveLength(voice ? 2 : 0);
        expect(
          tagsOf(responseOf(twiml)).filter((tag: string): boolean => {
            return tag === "Hangup";
          }),
        ).toHaveLength(1);
        // And it is said exactly as written, twice.
        expect(
          saidIn(gather).filter((said: string): boolean => {
            return said === title;
          }),
        ).toHaveLength(2);
      });

      test.each(HOSTILE)(
        "a project or severity named %s is only ever spoken",
        (name: string) => {
          const twiml: string = twimlOf(
            pageCall({
              projectName: name,
              headline: `A new ${name} incident has been created: INC-42.`,
              recordNumber: "INC-42",
            }),
            voice,
          );
          const gather: XmlElement = gatherOf(twiml);

          expect(new Set(tagsOf(gather))).toEqual(new Set(["Say", "Pause"]));
          expect(saidIn(gather)[0]).toBe(`This is a call from ${name}.`);
          expect(saidIn(gather)[1]).toBe(
            voice
              ? `A new ${name} incident has been created: INC 42.`
              : `A new ${name} incident has been created: I N C 42.`,
          );
        },
      );
    });
  }

  test("the keypad action's query is escaped as an attribute", () => {
    const twiml: string = twimlOf(pageCall());

    expect(twiml).toMatch(/action="[^"]*\?token=[^"&]+"/);
    expect(twiml).not.toContain("pageToken");
  });

  test("a control character in a title no longer stops the call: Twilio's builder threw on it", () => {
    const title: string = "\u001b[31mERROR\u001b[0m disk\u0001full \ud83d";
    const twiml: string = twimlOf(pageCall({ title: title }));

    expect(saidIn(gatherOf(twiml))[3]).toBe("ERROR disk full  ");
  });

  test("a sentence with no words is left out, rather than an empty <Say>", () => {
    const call: CallRequest = pageCall();
    (call.data[2] as Say).sayMessage = "\u0001\u0002";

    const gather: XmlElement = gatherOf(twimlOf(call));

    expect(saidIn(gather)).toEqual([
      "This is a call from Acme Production.",
      "A new Critical Incident has been created: I N C 42.",
      PROMPT,
      "A new Critical Incident has been created: I N C 42.",
      PROMPT,
    ]);
  });
});

describe("keys 1 and 2 go where they always went", () => {
  test("the action is the page's keypad address, with the call's own token naming this notification and saying what 1 answers", () => {
    const action: string = gatherOf(twimlOf(pageCall())).getAttribute(
      "action",
    )!;
    const parsed: globalThis.URL = new globalThis.URL(action);

    expect(parsed.origin + parsed.pathname).toBe(RESPONSE_URL.split("?")[0]);
    expect(Array.from(parsed.searchParams.keys())).toEqual(["token"]);

    const claims: JSONObject = JSONFunctions.deserialize(
      JSONWebToken.decodeJsonPayload(parsed.searchParams.get("token")!),
    );

    expect(claims["purpose"]).toBe(ON_CALL_KEYPAD_TOKEN_PURPOSE);
    expect(claims["notification"]).toBe(NOTIFICATION.toString());
    expect((claims["1"] as JSONObject)["sayMessage"]).toBe(
      ANSWERS["1"]!.sayMessage,
    );
    expect((claims["default"] as JSONObject)["sayMessage"]).toBe(
      ANSWERS["default"]!.sayMessage,
    );
  });

  test("one action for the whole call: asking twice adds no second <Gather>", () => {
    const twiml: string = twimlOf(pageCall());

    expect(twiml.split("<Gather").length - 1).toBe(1);
    expect(twiml.split("token=").length - 1).toBe(1);
  });
});

describe("a call stays within the TwiML Twilio takes, asked twice", () => {
  test("a 500-character title and a long message fit, and the prompt stays whole", () => {
    const twiml: string = twimlOf(
      pageCall({
        title: "Checkout API p95 latency above 2 seconds ".repeat(12),
        personMessage: `Alice Kim says: ${"Please check the database replication lag. ".repeat(12)}`,
      }),
    );

    expect(twiml.length).toBeLessThanOrEqual(MAX_CALL_TWIML_LENGTH);
    expect(
      saidIn(gatherOf(twiml)).filter((said: string): boolean => {
        return said === PROMPT;
      }),
    ).toHaveLength(2);
  });

  test("text far beyond it is cut to fit, the same way each time it is said", () => {
    const twiml: string = twimlOf(
      pageCall({
        title: "The checkout service returned an error. ".repeat(400),
      }),
    );
    const said: Array<string> = saidIn(gatherOf(twiml));

    expect(twiml.length).toBeLessThanOrEqual(MAX_CALL_TWIML_LENGTH);
    expect(said[3]).toBe(said[5]);
    expect(said[2]).toBe(PROMPT);
    expect(said[6]).toBe(PROMPT);
  });
});

describe("what a voicemail and a gateway are told the call said", () => {
  test("a voicemail repeats it as a voice says it: the number spelled", () => {
    expect(getCallVoicemailWords(pageCall())).toBe(
      "This is a call from Acme Production. A new Critical Incident has been created: I N C 42. Checkout API is down for customers in Europe.",
    );
  });

  test("a gateway is told it as text: the number as written, and no prompt", () => {
    expect(getCallGatewayMessage(pageCall())).toBe(
      "This is a call from Acme Production. A new Critical Incident has been created: INC-42. Checkout API is down for customers in Europe.",
    );
  });

  test("a title cut for speech ends its sentence with its mark", () => {
    expect(
      getCallGatewayMessage(pageCall({ title: "Checkout API is down…" })),
    ).toContain("Checkout API is down…");
    expect(
      getCallGatewayMessage(pageCall({ title: "Checkout API is down…" })),
    ).not.toContain("down….");
  });
});
