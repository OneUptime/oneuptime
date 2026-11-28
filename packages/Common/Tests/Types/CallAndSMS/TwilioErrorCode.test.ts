import {
  TWILIO_ERROR_CODE_MEANINGS,
  getTwilioErrorCodeMeaning,
  getTwilioErrorCodeUrl,
  isTwilioErrorCode,
} from "../../../Types/CallAndSMS/TwilioErrorCode";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A TWILIO ERROR CODE MEANS (#11417).
 *
 * The SMS log's Error Code column showed Twilio's code as a bare number. It
 * links to Twilio's page for the code, and the common codes say in one
 * plain line what they mean. These hold which codes are Twilio's - never a
 * gateway's HTTP status or a network's code, which the same column keeps -
 * where each links, and the lines: one per code, each a sentence that says
 * what happened to the SMS.
 */

// The codes the log explains, each with Twilio's own title for it (twilio.com/docs/api/errors/<code>).
const TWILIO_TITLES: Readonly<Record<string, string>> = {
  "20003": "Permission Denied",
  "21211": "Invalid 'To' Phone Number",
  "21408": "Message blocked: permissions disabled for the destination region",
  "21606":
    "'From' number is not a valid message-capable Twilio number for this account",
  "21608":
    "Upgrade and create an approved primary compliance profile to reach unverified numbers",
  "21610": "Attempt to send to unsubscribed recipient",
  "21612":
    "Message cannot be sent with the current combination of 'To' and/or 'From' parameters",
  "21614": "'To' number is not a valid mobile number",
  "30001": "Queue overflow",
  "30002": "Account suspended",
  "30003": "Unreachable destination handset",
  "30004": "Message blocked",
  "30005": "Unknown destination handset",
  "30006": "Landline or unreachable carrier",
  "30007": "Message filtered",
  "30008": "Unknown error",
  "30032": "Toll-Free Number Has Not Been Verified",
  "30034": "US A2P 10DLC - Message from an Unregistered Number",
};

// A capital first, a full stop last, on one line.
const ONE_SENTENCE: RegExp = /^[A-Z][^\n]*\.$/;

describe("which codes are Twilio's", () => {
  test("five or six digits: Twilio's codes for SMS and its newer products", () => {
    for (const code of [
      "21211",
      "30003",
      "30034",
      "63016",
      "180017",
      "520058",
    ]) {
      expect({ code, isTwilio: isTwilioErrorCode(code) }).toEqual({
        code,
        isTwilio: true,
      });
    }
  });

  test("never the HTTP status a gateway answered, a network's code, or anything else the column can hold", () => {
    for (const code of [
      "500",
      "404",
      "200",
      "ECONNRESET",
      "ETIMEDOUT",
      "0",
      "1234",
      "1234567",
      "03003",
      "30003a",
      "30 003",
      "-30003",
      "3000.3",
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect({ code, isTwilio: isTwilioErrorCode(code) }).toEqual({
        code,
        isTwilio: false,
      });
    }
  });

  test("a code written with a space or a line end around it is still read", () => {
    expect(isTwilioErrorCode(" 30003 ")).toBe(true);
    expect(isTwilioErrorCode("30003\n")).toBe(true);
  });
});

describe("where each code opens", () => {
  test("Twilio's own page for the code", () => {
    expect(getTwilioErrorCodeUrl("30003")).toBe(
      "https://www.twilio.com/docs/api/errors/30003",
    );
    expect(getTwilioErrorCodeUrl(" 21211 ")).toBe(
      "https://www.twilio.com/docs/api/errors/21211",
    );
    // A code the log does not explain still opens its page.
    expect(getTwilioErrorCodeUrl("63016")).toBe(
      "https://www.twilio.com/docs/api/errors/63016",
    );
  });

  test("nowhere, for a code that is not Twilio's", () => {
    for (const code of ["500", "ECONNRESET", "", null, undefined]) {
      expect({ code, url: getTwilioErrorCodeUrl(code) }).toEqual({
        code,
        url: null,
      });
    }
  });
});

describe("what the common codes mean", () => {
  test("the codes an SMS most often fails with, each with Twilio's title checked beside it", () => {
    expect(Object.keys(TWILIO_ERROR_CODE_MEANINGS)).toEqual(
      Object.keys(TWILIO_TITLES),
    );
  });

  test("in the order of their numbers, which the docs page's table keeps", () => {
    const codes: Array<string> = Object.keys(TWILIO_ERROR_CODE_MEANINGS);

    expect(codes).toEqual(
      [...codes].sort((a: string, b: string): number => {
        return Number(a) - Number(b);
      }),
    );
  });

  test("each is a code of Twilio's, with a page to open", () => {
    for (const code of Object.keys(TWILIO_ERROR_CODE_MEANINGS)) {
      expect({ code, isTwilio: isTwilioErrorCode(code) }).toEqual({
        code,
        isTwilio: true,
      });
      expect(getTwilioErrorCodeUrl(code)).toBe(
        `https://www.twilio.com/docs/api/errors/${code}`,
      );
    }
  });

  test("each says it in one plain sentence, short enough for a line under the code", () => {
    for (const [code, meaning] of Object.entries(TWILIO_ERROR_CODE_MEANINGS)) {
      expect({ code, isSentence: ONE_SENTENCE.test(meaning) }).toEqual({
        code,
        isSentence: true,
      });
      expect({ code, isShort: meaning.length <= 90 }).toEqual({
        code,
        isShort: true,
      });
      // One sentence: no full stop before its last.
      expect({ code, sentences: meaning.slice(0, -1).includes(". ") }).toEqual({
        code,
        sentences: false,
      });
    }
  });

  test("no two codes say the same thing", () => {
    const meanings: Array<string> = Object.values(TWILIO_ERROR_CODE_MEANINGS);

    expect(new Set(meanings).size).toBe(meanings.length);
  });

  test("the four the docs named before say what they said: off or out of reach, a number that may no longer exist, a landline, filtered", () => {
    expect(getTwilioErrorCodeMeaning("30003")).toBe(
      "The phone is off or out of reach.",
    );
    expect(getTwilioErrorCodeMeaning("30005")).toBe(
      "The number is unknown and may no longer exist.",
    );
    expect(getTwilioErrorCodeMeaning("30006")).toBe(
      "The number cannot receive SMS, for example a landline.",
    );
    expect(getTwilioErrorCodeMeaning("30007")).toBe(
      "Twilio or the carrier filtered the SMS as spam.",
    );
  });

  test("a reply of STOP, and the US registration, keep Twilio's own words", () => {
    expect(getTwilioErrorCodeMeaning("21610")).toContain("STOP");
    expect(getTwilioErrorCodeMeaning("30034")).toContain("A2P 10DLC");
  });

  test("a code the log does not explain, and one that is not Twilio's, say nothing", () => {
    for (const code of ["63016", "99999", "500", "ECONNRESET", "", null]) {
      expect({ code, meaning: getTwilioErrorCodeMeaning(code) }).toEqual({
        code,
        meaning: null,
      });
    }
  });

  test("a name an object has is no code", () => {
    for (const code of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(getTwilioErrorCodeMeaning(code)).toBeNull();
      expect(getTwilioErrorCodeUrl(code)).toBeNull();
    }
  });
});
