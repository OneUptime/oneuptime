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
  UnexplainedErrorReader,
  UnexplainedErrorWords,
  getExplanationWords,
  readUnexplainedError,
} from "../../../../Types/Exception/UnexplainedError";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A PERSON READS WHEN THE APP ITSELF REFUSES A BODY (#8419, #8567).
 *
 * The App answers a body over its own 50 MB with 413 and
 * UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime. Before #8419 it answered
 * 500 with "The server ran into a problem it could not explain ... give
 * this reference", which the front ends drew as a failure to report. And
 * with the sentence #8437 gave a proxy's 413, a self-hosted master admin was
 * told to raise a proxy's limit that had refused nothing (#8567). These hold
 * that the App's answer reads back as its own kind, for every reader, and
 * that a proxy's 413 still reads as before.
 */

// The App's answer, as Response and the browser hand it to a page.
function appAnswer(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { error: message }, {});
}

// nginx's own page for a body past client_max_body_size.
const NGINX_413_PAGE: string =
  "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n";

const READERS: Array<[string, UnexplainedErrorReader]> = [
  ["a member on Cloud", { isCloud: true, isMasterAdmin: false }],
  ["a master admin on Cloud", { isCloud: true, isMasterAdmin: true }],
  [
    "a member of a self-hosted server",
    { isCloud: false, isMasterAdmin: false },
  ],
  [
    "a master admin of a self-hosted server",
    { isCloud: false, isMasterAdmin: true },
  ],
  [
    "a status page's visitor",
    { isCloud: false, isMasterAdmin: false, isVisitor: true },
  ],
];

describe("the App's own 413 reads as OneUptime's limit", () => {
  test("API.getFriendlyMessage keeps the sentence, which reads back as its own kind", () => {
    const message: string = BaseAPI.getFriendlyMessage(
      appAnswer(413, REQUEST_BODY_REFUSAL_MESSAGES.tooLargeForOneUptime),
    );

    expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime);
    expect(readUnexplainedError(message)).toEqual({
      kind: UnexplainedErrorKind.TooLargeForOneUptime,
      reference: null,
    });
  });

  test("a proxy's 413 page still reads as too large, the proxy's kind", () => {
    const message: string = BaseAPI.getFriendlyMessage(
      new HTTPErrorResponse(413, NGINX_413_PAGE as never, {}),
    );

    expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLarge);
    expect(readUnexplainedError(message)?.kind).toBe(
      UnexplainedErrorKind.TooLarge,
    );
  });

  test("the two read differently", () => {
    expect(UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime).not.toBe(
      UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    );
    expect(UnexplainedErrorKind.TooLargeForOneUptime).not.toBe(
      UnexplainedErrorKind.TooLarge,
    );
  });

  test("a form with too many fields is the API's own words, not a size", () => {
    const rule: { status: number; message: string } =
      REQUEST_BODY_REFUSALS["parameters.too.many"]!;
    const message: string = BaseAPI.getFriendlyMessage(
      appAnswer(rule.status, rule.message),
    );

    expect(message).toBe(REQUEST_BODY_REFUSAL_MESSAGES.tooManyFields);
    expect(readUnexplainedError(message)).toBeNull();
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
});

describe("the explanation each reader gets", () => {
  const ownLimit: UnexplainedError = readUnexplainedError(
    UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
  )!;
  const proxy: UnexplainedError = readUnexplainedError(
    UNEXPLAINED_ERROR_MESSAGES.tooLarge,
  )!;

  test.each(READERS)(
    "OneUptime's own limit, for %s: the 50 MB and to send less, with nowhere to look",
    (_who: string, reader: UnexplainedErrorReader) => {
      expect(getExplanationWords({ error: ownLimit, ...reader })).toEqual({
        why: UnexplainedErrorWords.tooLargeForOneUptimeWhy,
        next: UnexplainedErrorWords.tooLargeNext,
        whereToLook: null,
      });
    },
  );

  test("a self-hosted master admin is no longer sent to a proxy when OneUptime refused it (#8567)", () => {
    const own: UnexplainedErrorExplanation = getExplanationWords({
      error: ownLimit,
      isCloud: false,
      isMasterAdmin: true,
    });
    const fromProxy: UnexplainedErrorExplanation = getExplanationWords({
      error: proxy,
      isCloud: false,
      isMasterAdmin: true,
    });

    expect(own.whereToLook).toBeNull();
    expect(fromProxy.whereToLook).toBe(
      UnexplainedErrorWords.tooLargeWhereToLook,
    );
    expect(fromProxy.whereToLook).toMatch(/^If a proxy in front of OneUptime/);
  });

  test("the why names the 50 MB, and the message is the why and what to do", () => {
    expect(UnexplainedErrorWords.tooLargeForOneUptimeWhy).toBe(
      "What was sent is larger than the 50 MB OneUptime takes in one request.",
    );
    expect(UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime).toBe(
      `${UnexplainedErrorWords.tooLargeForOneUptimeWhy.replace(/\.$/, "")}, so this did not finish. ${UnexplainedErrorWords.tooLargeNext}`,
    );
  });

  test("nothing in it asks anyone to try again in a moment, to report a reference, or to change a proxy", () => {
    for (const words of [
      UnexplainedErrorWords.tooLargeForOneUptimeWhy,
      UnexplainedErrorWords.tooLargeNext,
      UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    ]) {
      expect(words).not.toMatch(/in a moment|reference|support|proxy/i);
    }
  });
});

describe("the App's other refusals are shown as it wrote them", () => {
  test.each(
    Object.entries(REQUEST_BODY_REFUSALS).filter(
      ([type]: [string, { status: number; message: string }]): boolean => {
        return type !== "entity.too.large";
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
