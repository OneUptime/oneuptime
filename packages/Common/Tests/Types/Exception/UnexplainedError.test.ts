import {
  isEmptyErrorPhrase,
  isErrorSentence,
} from "../../../Types/Exception/ErrorMessageRule";
import {
  ERROR_REFERENCE_FIELD,
  ERROR_REFERENCE_LENGTH,
  getUnexplainedServerErrorMessage,
  isErrorReference,
  readUnexplainedError,
  SERVER_DOWN_MESSAGE,
  toErrorReference,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import { describe, expect, test } from "@jest/globals";

/*
 * An error nobody explained (#6836) says what happened and what to do next,
 * and a failure on the server names a reference to its log lines. These are
 * the words that travel between the server, API.getFriendlyMessage and
 * ErrorExplanation, and the reference they carry.
 */

const REQUEST_ID: string = "1f0c9a2b-7d4e-4a1b-9c3d-5e6f7a8b9c0d";

describe("the reference", () => {
  test("is the first eight hex digits of the request's id", () => {
    expect(toErrorReference(REQUEST_ID)).toBe("1f0c9a2b");
    expect(toErrorReference(REQUEST_ID)).toHaveLength(ERROR_REFERENCE_LENGTH);
  });

  test("skips the dashes and lowers the case", () => {
    expect(toErrorReference("ABC-DEF12-345")).toBe("abcdef12");
  });

  test("is null without an id long enough to make one", () => {
    expect(toErrorReference(undefined)).toBeNull();
    expect(toErrorReference(null)).toBeNull();
    expect(toErrorReference("")).toBeNull();
    expect(toErrorReference("abc-12")).toBeNull();
    expect(toErrorReference("not hex at all")).toBeNull();
  });

  test("is recognised only as eight lower-case hex digits", () => {
    expect(isErrorReference("1f0c9a2b")).toBe(true);
    expect(isErrorReference("1F0C9A2B")).toBe(false);
    expect(isErrorReference("1f0c9a2")).toBe(false);
    expect(isErrorReference("1f0c9a2bc")).toBe(false);
    expect(isErrorReference("1f0c9a2g")).toBe(false);
    expect(isErrorReference(12345678)).toBe(false);
    expect(isErrorReference(undefined)).toBe(false);
  });

  test("travels in the error answer's reference field", () => {
    expect(ERROR_REFERENCE_FIELD).toBe("reference");
  });
});

describe("the server's answer", () => {
  test("names the reference when it has one, and says what to do next", () => {
    const message: string = getUnexplainedServerErrorMessage("1f0c9a2b");

    expect(message).toBe(
      "The server ran into a problem it could not explain, so this did not finish. Try again, and if it keeps failing, give this reference to your administrator or OneUptime support: 1f0c9a2b.",
    );
  });

  test("says to try again in a moment when it has none", () => {
    expect(getUnexplainedServerErrorMessage(null)).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
    expect(getUnexplainedServerErrorMessage("not-a-ref")).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
  });
});

describe("every sentence meets the rule it exists for", () => {
  const sentences: Array<string> = [
    getUnexplainedServerErrorMessage("1f0c9a2b"),
    UNEXPLAINED_ERROR_MESSAGES.server,
    UNEXPLAINED_ERROR_MESSAGES.unreachable,
    UNEXPLAINED_ERROR_MESSAGES.page,
    ...Object.values(UnexplainedErrorWords).filter((words: string) => {
      // The two that end in the reference, and the dialog title.
      return (
        !words.endsWith(":") &&
        words !== UnexplainedErrorWords.pageDidNotLoadTitle &&
        words !== UnexplainedErrorWords.openHealth
      );
    }),
  ];

  test.each(sentences)(
    "%j is a sentence, and not an empty phrase",
    (s: string) => {
      expect(isErrorSentence(s)).toBe(true);
      expect(isEmptyErrorPhrase(s)).toBe(false);
    },
  );

  test("none says Server Error or Something went wrong", () => {
    for (const s of sentences) {
      expect(s.toLowerCase()).not.toContain("server error");
      expect(s.toLowerCase()).not.toContain("something went wrong");
    }
  });

  test("the sentences that end in the reference end with a colon", () => {
    expect(
      UnexplainedErrorWords.serverNextWithReferenceCloud.endsWith(":"),
    ).toBe(true);
    expect(
      UnexplainedErrorWords.serverNextWithReferenceSelfHosted.endsWith(":"),
    ).toBe(true);
  });
});

describe("readUnexplainedError", () => {
  test("reads the server's answer back, with its reference", () => {
    expect(
      readUnexplainedError(getUnexplainedServerErrorMessage("1f0c9a2b")),
    ).toEqual({
      kind: UnexplainedErrorKind.ServerWithReference,
      reference: "1f0c9a2b",
    });
  });

  test("reads each of the other sentences as its kind", () => {
    expect(readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.server)).toEqual({
      kind: UnexplainedErrorKind.Server,
      reference: null,
    });
    expect(readUnexplainedError(SERVER_DOWN_MESSAGE)).toEqual({
      kind: UnexplainedErrorKind.ServerDown,
      reference: null,
    });
    expect(
      readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.unreachable),
    ).toEqual({ kind: UnexplainedErrorKind.Unreachable, reference: null });
    expect(readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.page)).toEqual({
      kind: UnexplainedErrorKind.Page,
      reference: null,
    });
  });

  test("forgives the space around a message", () => {
    expect(
      readUnexplainedError(` ${UNEXPLAINED_ERROR_MESSAGES.page}\n`),
    ).not.toBeNull();
  });

  test("leaves every message somebody put into words alone", () => {
    expect(readUnexplainedError("Promo code is invalid.")).toBeNull();
    expect(readUnexplainedError("Server Error")).toBeNull();
    expect(readUnexplainedError("")).toBeNull();
    expect(readUnexplainedError(undefined)).toBeNull();
    expect(readUnexplainedError(null)).toBeNull();
  });

  test("does not read a near miss as the server's answer", () => {
    const answer: string = getUnexplainedServerErrorMessage("1f0c9a2b");

    // A reference that is not one.
    expect(
      readUnexplainedError(answer.replace("1f0c9a2b", "1F0C9A2B")),
    ).toBeNull();
    expect(
      readUnexplainedError(answer.replace("1f0c9a2b", "1f0c9a2bff")),
    ).toBeNull();
    // The sentence quoted inside another.
    expect(
      readUnexplainedError(`The verification code was not sent. ${answer}`),
    ).toBeNull();
    // The sentence without its full stop.
    expect(readUnexplainedError(answer.slice(0, -1))).toBeNull();
  });
});
