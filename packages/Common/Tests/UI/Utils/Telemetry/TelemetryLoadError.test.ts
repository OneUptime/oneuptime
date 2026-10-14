import { describe, expect, test } from "@jest/globals";
import TelemetryLoadErrorUtil, {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../../UI/Utils/Telemetry/TelemetryLoadError";
import API from "../../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../../Types/JSON";

/*
 * How a telemetry explorer reads a failed read (issue #4707).
 *
 * A search stopped at the query time limit used to reach the explorers as a
 * 500 "Server Error" — or, for the chart and the filter counts, as nothing at
 * all. The API now answers it with 504 and a sentence that says it took too
 * long; the explorers tell that apart from any other failure, and say each
 * in its own words. Pinned here:
 *
 *   - which answers are "this took too long" (504 from the API or from a
 *     proxy whose own timeout ran out first, 408 from an older server) and
 *     which are not;
 *   - the message carried with each, which is the API's own sentence and
 *     never a gateway's HTML page;
 *   - the API's general wording of a 502 / 504, which every other screen
 *     shows: a connection problem for a gateway's page, the API's sentence
 *     for its own JSON answer.
 */

const TIME_LIMIT_SENTENCE: string =
  "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

const CONNECTION_PROBLEM: string =
  "Error connecting to server. Please try again in few minutes.";

const GATEWAY_TIMEOUT_PAGE: string =
  "<html>\r\n<head><title>504 Gateway Time-out</title></head>\r\n<body>\r\n<center><h1>504 Gateway Time-out</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n";

// What the API's error handler answers a QueryTimeoutException with.
function apiTimeLimitAnswer(): HTTPErrorResponse {
  return new HTTPErrorResponse(504, { error: TIME_LIMIT_SENTENCE }, {});
}

/*
 * What axios hands over for a proxy's own 504: the page as a string, which
 * HTTPResponse keeps under `data`.
 */
function gatewayTimeoutPage(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    504,
    GATEWAY_TIMEOUT_PAGE as unknown as JSONObject,
    {},
  );
}

describe("TelemetryLoadErrorUtil.isTimedOut", () => {
  test.each([
    {
      answer: "the API's 504 for a read stopped at its time limit",
      status: 504,
    },
    { answer: "an older server's 408 for an exact count", status: 408 },
  ])("$answer is a search that took too long", ({ status }) => {
    expect(
      TelemetryLoadErrorUtil.isTimedOut(
        new HTTPErrorResponse(status, { error: TIME_LIMIT_SENTENCE }, {}),
      ),
    ).toBe(true);
  });

  test("a proxy's own 504 page is a search that took too long", () => {
    expect(TelemetryLoadErrorUtil.isTimedOut(gatewayTimeoutPage())).toBe(true);
  });

  test.each([
    { answer: "a 500", status: 500 },
    {
      answer: "a 502 from a gateway that could not reach the API",
      status: 502,
    },
    { answer: "a 400 for a bad query", status: 400 },
    { answer: "a 503", status: 503 },
  ])("$answer is not", ({ status }) => {
    expect(
      TelemetryLoadErrorUtil.isTimedOut(
        new HTTPErrorResponse(status, { error: "Something else" }, {}),
      ),
    ).toBe(false);
  });

  test.each([
    { answer: "an Error that mentions a timeout", error: new Error("timeout") },
    { answer: "a string", error: "504" },
    { answer: "a bare object with a 504 status", error: { statusCode: 504 } },
    { answer: "undefined", error: undefined },
    { answer: "null", error: null },
  ])("$answer is not: only an HTTP answer says so", ({ error }) => {
    expect(TelemetryLoadErrorUtil.isTimedOut(error)).toBe(false);
  });
});

describe("TelemetryLoadErrorUtil.fromError", () => {
  test("the API's 504 reads as timed out, carrying the API's sentence", () => {
    const error: TelemetryLoadError =
      TelemetryLoadErrorUtil.fromError(apiTimeLimitAnswer());

    expect(error).toEqual({
      kind: TelemetryLoadErrorKind.TimedOut,
      message: TIME_LIMIT_SENTENCE,
    });
  });

  test("a proxy's 504 page reads as timed out, and its HTML is never the message", () => {
    const error: TelemetryLoadError =
      TelemetryLoadErrorUtil.fromError(gatewayTimeoutPage());

    expect(error.kind).toBe(TelemetryLoadErrorKind.TimedOut);
    expect(error.message).toBe(CONNECTION_PROBLEM);
    expect(error.message).not.toContain("<");
  });

  test("a 408 from an older server reads as timed out", () => {
    expect(
      TelemetryLoadErrorUtil.fromError(
        new HTTPErrorResponse(408, { error: "Request Timeout" }, {}),
      ).kind,
    ).toBe(TelemetryLoadErrorKind.TimedOut);
  });

  test("any other failure reads as failed, in the server's words", () => {
    expect(
      TelemetryLoadErrorUtil.fromError(
        new HTTPErrorResponse(
          400,
          { error: "Invalid attribute key: http.route!" },
          {},
        ),
      ),
    ).toEqual({
      kind: TelemetryLoadErrorKind.Failed,
      message: "Invalid attribute key: http.route!",
    });
  });

  test("a failure with no words of its own still says something", () => {
    const error: TelemetryLoadError = TelemetryLoadErrorUtil.fromError(
      new HTTPErrorResponse(500, {}, {}),
    );

    expect(error.kind).toBe(TelemetryLoadErrorKind.Failed);
    expect(error.message).toBe("Server Error. Please try again");
  });

  test("a network failure reads as failed, with its message", () => {
    expect(
      TelemetryLoadErrorUtil.fromError(new Error("Network Error")),
    ).toEqual({
      kind: TelemetryLoadErrorKind.Failed,
      message: "Network Error",
    });
  });
});

describe("TelemetryLoadErrorUtil.fromMessage", () => {
  test("a plain message from an older caller reads as a failure", () => {
    expect(TelemetryLoadErrorUtil.fromMessage("Could not load.")).toEqual({
      kind: TelemetryLoadErrorKind.Failed,
      message: "Could not load.",
    });
  });
});

describe("API.getFriendlyMessage for a 502 or 504", () => {
  test("the API's own 504 says what happened: the read took too long", () => {
    expect(API.getFriendlyMessage(apiTimeLimitAnswer())).toBe(
      TIME_LIMIT_SENTENCE,
    );
  });

  test("an API 504 answered through Response.sendErrorResponse ({ message }) says so too", () => {
    expect(
      API.getFriendlyMessage(
        new HTTPErrorResponse(504, { message: TIME_LIMIT_SENTENCE }, {}),
      ),
    ).toBe(TIME_LIMIT_SENTENCE);
  });

  test("REGRESSION: a proxy's 504 page is a connection problem, not its HTML", () => {
    expect(API.getFriendlyMessage(gatewayTimeoutPage())).toBe(
      CONNECTION_PROBLEM,
    );
  });

  test("a 504 with no body is a connection problem", () => {
    expect(API.getFriendlyMessage(new HTTPErrorResponse(504, {}, {}))).toBe(
      CONNECTION_PROBLEM,
    );
  });

  test("a 504 with a blank message is a connection problem", () => {
    expect(
      API.getFriendlyMessage(new HTTPErrorResponse(504, { error: "  " }, {})),
    ).toBe(CONNECTION_PROBLEM);
  });

  test("a 502 is a connection problem whatever its body says", () => {
    expect(
      API.getFriendlyMessage(
        new HTTPErrorResponse(502, { message: "Bad Gateway" }, {}),
      ),
    ).toBe(CONNECTION_PROBLEM);
  });

  test("other statuses keep the server's message", () => {
    expect(
      API.getFriendlyMessage(
        new HTTPErrorResponse(500, { error: "Server Error" }, {}),
      ),
    ).toBe("Server Error");
  });
});
