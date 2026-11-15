// Must stay the first import: the client's URLs are built from HOST on load.
import "./DashboardHost";
import BaseAPI from "../../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import {
  REQUEST_BODY_REFUSAL_MESSAGES,
  REQUEST_BODY_REFUSALS,
} from "../../../../Server/Utils/RequestBodyRefusal";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedError,
  UnexplainedErrorExplanation,
  UnexplainedErrorKind,
  UnexplainedErrorWords,
  getExplanationWords,
  readUnexplainedError,
} from "../../../../Types/Exception/UnexplainedError";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A PERSON READS WHEN THE APP ITSELF REFUSES A BODY (#8419).
 *
 * The App now answers a body over its 50 MB limit with 413 and
 * UNEXPLAINED_ERROR_MESSAGES.tooLarge, the sentence #8437 gave the front
 * ends for a proxy's 413 page. Before, it answered 500 with "The server ran
 * into a problem it could not explain ... give this reference", which the
 * front ends drew as a failure to report. These hold that the answer reads
 * back as too large, for every reader, with the words that are true when
 * OneUptime refused it rather than a proxy.
 */

// The App's answer, as Response and the browser hand it to a page.
function appAnswer(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { error: message }, {});
}

describe("the App's own 413 reads as too large", () => {
  test("API.getFriendlyMessage keeps the sentence, which reads back as too large", () => {
    const message: string = BaseAPI.getFriendlyMessage(
      appAnswer(413, REQUEST_BODY_REFUSAL_MESSAGES.tooLarge),
    );

    expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLarge);
    expect(readUnexplainedError(message)).toEqual({
      kind: UnexplainedErrorKind.TooLarge,
      reference: null,
    });
  });

  test("and so does a form with too many fields, also a 413", () => {
    const rule: { status: number; message: string } =
      REQUEST_BODY_REFUSALS["parameters.too.many"]!;

    expect(
      readUnexplainedError(
        BaseAPI.getFriendlyMessage(appAnswer(rule.status, rule.message)),
      )?.kind,
    ).toBe(UnexplainedErrorKind.TooLarge);
  });

  test("before, the 500 it answered read as a failure to report, with a reference", () => {
    const before: string = BaseAPI.getFriendlyMessage(
      new HTTPErrorResponse(
        500,
        {
          error:
            "The server ran into a problem it could not explain, so this did not finish. Try again, and if it keeps failing, give this reference to your administrator or OneUptime support: 4f1c2d3e.",
          reference: "4f1c2d3e",
        },
        {},
      ),
    );

    expect(readUnexplainedError(before)?.kind).toBe(
      UnexplainedErrorKind.ServerWithReference,
    );
  });

  describe("the explanation each reader gets", () => {
    const tooLarge: UnexplainedError = readUnexplainedError(
      UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    )!;

    test.each([
      ["a member on Cloud", { isCloud: true, isMasterAdmin: false }],
      ["a master admin on Cloud", { isCloud: true, isMasterAdmin: true }],
      [
        "a member of a self-hosted server",
        { isCloud: false, isMasterAdmin: false },
      ],
      [
        "a status page's visitor",
        { isCloud: false, isMasterAdmin: false, isVisitor: true },
      ],
    ])(
      "%s: what was too large and to send less, with nothing to report",
      (
        _who: string,
        reader: {
          isCloud: boolean;
          isMasterAdmin: boolean;
          isVisitor?: boolean;
        },
      ) => {
        const words: UnexplainedErrorExplanation = getExplanationWords({
          error: tooLarge,
          ...reader,
        });

        expect(words).toEqual({
          why: UnexplainedErrorWords.tooLargeWhy,
          next: UnexplainedErrorWords.tooLargeNext,
          whereToLook: null,
        });
      },
    );

    test("a self-hosted master admin is told OneUptime's own limit, beside the proxy's", () => {
      /*
       * The App refused it, not a proxy, so the line about a proxy is
       * conditional ("If a proxy ... refused it") and names the 50 MB that
       * OneUptime itself takes: true either way, and no OneUptime Health
       * link, which shows nothing about a body's size.
       */
      const words: UnexplainedErrorExplanation = getExplanationWords({
        error: tooLarge,
        isCloud: false,
        isMasterAdmin: true,
      });

      expect(words.whereToLook).toBe(UnexplainedErrorWords.tooLargeWhereToLook);
      expect(words.whereToLook).toMatch(/^If a proxy in front of OneUptime/);
      expect(words.whereToLook).toContain(
        "50 MB, as much as OneUptime itself takes",
      );
    });

    test("nothing in it asks anyone to try again in a moment, or to report a reference", () => {
      for (const words of [
        UnexplainedErrorWords.tooLargeWhy,
        UnexplainedErrorWords.tooLargeNext,
        UNEXPLAINED_ERROR_MESSAGES.tooLarge,
      ]) {
        expect(words).not.toMatch(/in a moment|reference|support/i);
      }
    });
  });
});

describe("the App's other refusals are shown as it wrote them", () => {
  test.each(
    Object.entries(REQUEST_BODY_REFUSALS).filter(
      ([, rule]: [string, { status: number; message: string }]): boolean => {
        return rule.status !== 413;
      },
    ),
  )("%s", (_type: string, rule: { status: number; message: string }) => {
    const message: string = BaseAPI.getFriendlyMessage(
      appAnswer(rule.status, rule.message),
    );

    expect(message).toBe(rule.message);
    // Not a failure nobody explained: it says what was wrong itself.
    expect(readUnexplainedError(message)).toBeNull();
  });
});
