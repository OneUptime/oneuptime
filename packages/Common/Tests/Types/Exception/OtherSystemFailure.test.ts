import {
  getOtherSystemDetailsAnswer,
  getOtherSystemFailureMessage,
  MAX_OTHER_SYSTEM_DETAILS_LENGTH,
  OTHER_SYSTEM_DETAILS_FIELD,
  readOtherSystemDetails,
  toOtherSystemDetails,
} from "../../../Types/Exception/OtherSystemFailure";
import OtherSystemFailureException from "../../../Types/Exception/OtherSystemFailureException";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadDataExceptionWithDetails, {
  getErrorDetails,
} from "../../../Types/Exception/BadDataExceptionWithDetails";
import { meetsErrorMessageRule } from "../../../Types/Exception/ErrorMessageRule";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * ANOTHER SYSTEM'S FAILURE, IN ONEUPTIME'S WORDS FIRST (#7268).
 *
 * The shape every surface shares: OneUptime's sentence is the error's
 * message - what happened, then what to do next - and the other system's own
 * words travel beside it in the answer's otherSystemDetails field, for the
 * page to fold under Details. These pin the sentence, the field, how the
 * words are kept (trimmed, cut, none when they only repeat the sentence) and
 * how a page reads them back from an error answer.
 */

const SMTP_FAILURE: {
  whatHappened: string;
  whatToDo: string;
  details: string;
} = {
  whatHappened: "The test email was not sent.",
  whatToDo: "Check the SMTP config's host, port, username and password.",
  details: "Invalid login: 535-5.7.8 Username and Password not accepted.",
};

describe("the sentence a person reads first", () => {
  test("is what happened, then what to do next, as one message that meets the rule", () => {
    const message: string = getOtherSystemFailureMessage(SMTP_FAILURE);

    expect(message).toBe(
      "The test email was not sent. Check the SMTP config's host, port, username and password.",
    );
    expect(meetsErrorMessageRule(message)).toBe(true);
  });

  test("never holds the other system's words", () => {
    expect(getOtherSystemFailureMessage(SMTP_FAILURE)).not.toContain("535");
  });

  test("leaves out an empty part and the spaces around each", () => {
    expect(
      getOtherSystemFailureMessage({
        whatHappened: "  The test SMS was not sent. ",
        whatToDo: "",
      }),
    ).toBe("The test SMS was not sent.");
  });
});

describe("the other system's words, as they are kept", () => {
  test("are kept as the system gave them, trimmed", () => {
    expect(toOtherSystemDetails("  connect ECONNREFUSED 10.0.0.1:25\n")).toBe(
      "connect ECONNREFUSED 10.0.0.1:25",
    );
  });

  test("are read out of an Error, and an object is kept as its JSON", () => {
    expect(toOtherSystemDetails(new Error("getaddrinfo ENOTFOUND"))).toBe(
      "getaddrinfo ENOTFOUND",
    );
    expect(toOtherSystemDetails({ error: "invalid_auth" })).toBe(
      '{"error":"invalid_auth"}',
    );
  });

  test("are none when the system said nothing", () => {
    for (const nothing of [undefined, null, "", "   ", new Error("")]) {
      expect(toOtherSystemDetails(nothing)).toBeUndefined();
    }
  });

  test("are none when they only say again what OneUptime's sentence says", () => {
    expect(
      toOtherSystemDetails(
        " The test email was not sent. ",
        "The test email was not sent.",
      ),
    ).toBeUndefined();
  });

  test("words longer than the limit are cut, say so, and keep their start", () => {
    const words: string = "x".repeat(MAX_OTHER_SYSTEM_DETAILS_LENGTH + 10);
    const kept: string = toOtherSystemDetails(words) as string;

    expect(kept).toHaveLength(MAX_OTHER_SYSTEM_DETAILS_LENGTH);
    expect(kept.endsWith("…")).toBe(true);
    expect(words.startsWith(kept.slice(0, -1))).toBe(true);
  });

  test("whatever their length, the words kept are never longer than the limit and start as the system's did", () => {
    const random: SeededRandom = seededRandom(7268);
    const alphabet: string = "abc ÄÖ مرحبا 你好\n\t.:-";

    for (let run: number = 0; run < 300; run++) {
      const length: number = random(MAX_OTHER_SYSTEM_DETAILS_LENGTH * 2);
      let words: string = "";

      for (let index: number = 0; index < length; index++) {
        words += alphabet[random(alphabet.length)];
      }

      const kept: string | undefined = toOtherSystemDetails(words);

      if (!words.trim()) {
        expect(kept).toBeUndefined();
        continue;
      }

      expect(kept).toBeDefined();
      expect((kept as string).length).toBeLessThanOrEqual(
        MAX_OTHER_SYSTEM_DETAILS_LENGTH,
      );
      expect(
        words.trim().startsWith((kept as string).replace(/…$/, "")),
      ).toBe(true);
    }
  });
});

describe("the answer's field", () => {
  test("is otherSystemDetails, and is left out when there are no words", () => {
    expect(OTHER_SYSTEM_DETAILS_FIELD).toBe("otherSystemDetails");
    expect(getOtherSystemDetailsAnswer("550 mailbox unavailable")).toEqual({
      otherSystemDetails: "550 mailbox unavailable",
    });
    expect(getOtherSystemDetailsAnswer(undefined)).toEqual({});
  });
});

describe("OtherSystemFailureException", () => {
  test("is a 400 whose message is OneUptime's sentence, with the system's words beside it", () => {
    const error: OtherSystemFailureException = new OtherSystemFailureException(
      SMTP_FAILURE,
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error).toBeInstanceOf(BadDataExceptionWithDetails);
    expect(error.code).toBe(ExceptionCode.BadDataException);
    expect(error.message).toBe(getOtherSystemFailureMessage(SMTP_FAILURE));
    expect(error.otherSystemDetails).toBe(SMTP_FAILURE.details);
    // What Response.sendErrorResponse sends beside the message.
    expect(getErrorDetails(error)).toEqual({
      otherSystemDetails: SMTP_FAILURE.details,
    });
  });

  test("with no words of the system's, it adds nothing beside its message", () => {
    const error: OtherSystemFailureException = new OtherSystemFailureException(
      {
        whatHappened: SMTP_FAILURE.whatHappened,
        whatToDo: SMTP_FAILURE.whatToDo,
      },
    );

    expect(error.otherSystemDetails).toBeUndefined();
    expect(getErrorDetails(error)).toEqual({});
  });
});

describe("a page reads the words back", () => {
  const body: JSONObject = {
    message: getOtherSystemFailureMessage(SMTP_FAILURE),
    otherSystemDetails: SMTP_FAILURE.details,
  };

  test("from an error answer, as API.post hands it", () => {
    const response: HTTPErrorResponse = new HTTPErrorResponse(400, body, {});

    expect(response.message).toBe(body["message"]);
    expect(readOtherSystemDetails(response)).toBe(SMTP_FAILURE.details);
  });

  test("from a body, as a route that answers ok false sends it", () => {
    expect(
      readOtherSystemDetails({
        ok: false,
        statusMessage: "The test message was not sent.",
        otherSystemDetails: "channel_not_found",
      }),
    ).toBe("channel_not_found");
  });

  test("and finds none in an answer without them, or in no answer at all", () => {
    for (const answer of [
      undefined,
      null,
      "The test email was not sent.",
      new Error("Network Error"),
      new HTTPErrorResponse(500, { message: "Server failed." }, {}),
      { otherSystemDetails: "   " },
      { otherSystemDetails: 42 },
    ]) {
      expect(readOtherSystemDetails(answer)).toBeNull();
    }
  });
});
