import CallService from "../../FeatureSet/Notification/Services/CallService";
import URL from "Common/Types/API/URL";
import CallRequest from "Common/Types/Call/CallRequest";
import Phone from "Common/Types/Phone";
import {
  MAX_CALL_TWIML_LENGTH,
  TRUNCATED_TEXT_NOTE_PLAIN,
} from "Common/Utils/MessageFit";
import { describe, expect, test } from "@jest/globals";

/*
 * A CALL'S SCRIPT IS ONE TWILIO TAKES.
 *
 * Twilio refuses TwiML of more than 4,000 characters, and the call is not
 * made. What a call says is a notification's text - a template can place a
 * description in it. generateTwimlForCall cuts the texts it speaks, the
 * longest first and all to about the same length, each ending with a note
 * that the rest is in OneUptime; a call that fits is made as it always was.
 * The real Twilio TwiML builder runs here.
 */

function callSaying(...texts: Array<string>): CallRequest {
  return {
    to: new Phone("+15555550177"),
    data: [
      ...texts.map((text: string) => {
        return { sayMessage: text };
      }),
      {
        introMessage: "Press 1 to acknowledge.",
        numDigits: 1,
        timeoutInSeconds: 10,
        noInputMessage: "No input received.",
        onInputCallRequest: {},
        // The answer's address carries a signed token: it counts too.
        responseUrl: URL.fromString(
          "https://oneuptime.example.com/notification/voice/input",
        ),
      },
    ],
  } as unknown as CallRequest;
}

// The texts a TwiML speaks, unescaped.
function spokenIn(twiml: string): Array<string> {
  return Array.from(
    twiml.matchAll(/<Say>([^<]*)<\/Say>/g),
    (match: RegExpMatchArray): string => {
      return match[1]!
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
    },
  );
}

describe("CallService.generateTwimlForCall", () => {
  test("a call that fits is made as it always was", () => {
    const twiml: string = CallService.generateTwimlForCall(
      callSaying("Incident 42. Checkout is down."),
    );

    expect(spokenIn(twiml)).toEqual([
      "Incident 42. Checkout is down.",
      "Press 1 to acknowledge.",
      "No input received.",
    ]);
  });

  test("a description of thousands of characters is cut to fit, and the prompts stay whole", () => {
    const description: string = `Incident 42. ${"The checkout service returned an error. ".repeat(300)}`;

    const twiml: string = CallService.generateTwimlForCall(
      callSaying(description),
    );
    const spoken: Array<string> = spokenIn(twiml);

    expect(twiml.length).toBeLessThanOrEqual(MAX_CALL_TWIML_LENGTH);
    expect(spoken[0]!.startsWith("Incident 42. The checkout service")).toBe(
      true,
    );
    expect(spoken[0]!.endsWith(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
    expect(spoken.slice(1)).toEqual([
      "Press 1 to acknowledge.",
      "No input received.",
    ]);
  });

  test("XML escaping counts toward the limit", () => {
    const twiml: string = CallService.generateTwimlForCall(
      callSaying(`<&>"'`.repeat(2000)),
    );

    expect(twiml.length).toBeLessThanOrEqual(MAX_CALL_TWIML_LENGTH);
    expect(spokenIn(twiml)[0]!.endsWith(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
  });

  test("several long texts are cut to about the same length", () => {
    const twiml: string = CallService.generateTwimlForCall(
      callSaying("a".repeat(5000), "b".repeat(5000), "Short."),
    );
    const spoken: Array<string> = spokenIn(twiml);

    expect(twiml.length).toBeLessThanOrEqual(MAX_CALL_TWIML_LENGTH);
    expect(spoken[2]).toBe("Short.");
    expect(Math.abs(spoken[0]!.length - spoken[1]!.length)).toBeLessThan(10);
  });
});
