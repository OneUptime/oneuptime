// Must stay the first import: the client's URLs are built from HOST on load.
import "./DashboardHost";
import BaseAPI from "../../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { isEmptyErrorPhrase } from "../../../../Types/Exception/ErrorMessageRule";
import {
  getUnexplainedServerErrorMessage,
  readUnexplainedError,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
} from "../../../../Types/Exception/UnexplainedError";
import { describe, expect, test } from "@jest/globals";

/*
 * API.getFriendlyMessage is what about 2,000 places in the Dashboard,
 * Accounts and the Admin Dashboard show when something fails. It fell back
 * to "Server Error. Please try again" whenever nobody had put the failure
 * into words, and showed a TypeError's "Cannot read properties of
 * undefined" or "Request failed to https://.../api/monitor. Network Error"
 * as they were (#6836). Now every failure nobody explained gets one of four
 * sentences that say what happened and what to do next, and a failure on
 * the server keeps the reference it named.
 */

const friendly: (err: unknown) => string = (err: unknown): string => {
  return BaseAPI.getFriendlyMessage(err);
};

describe("a failure the server explained is shown as the server put it", () => {
  test("its message", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          400,
          { message: "A project with the same name already exists." },
          {},
        ),
      ),
    ).toBe("A project with the same name already exists.");
  });

  test("OneUptime's own exception thrown in the page", () => {
    expect(friendly(new BadDataException("Pick at least one probe."))).toBe(
      "Pick at least one probe.",
    );
  });

  test("a SyntaxError about what the person typed", () => {
    expect(
      friendly(
        new SyntaxError("Invalid regular expression: /(/: Unterminated group"),
      ),
    ).toBe("Invalid regular expression: /(/: Unterminated group");
  });

  test("a 504 the API answered with its own words (#4707)", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          504,
          { error: "This search took too long. Narrow the time range." },
          {},
        ),
      ),
    ).toBe("This search took too long. Narrow the time range.");
  });
});

describe("a failure on the server nobody explained", () => {
  test("keeps the reference the server named", () => {
    const message: string = friendly(
      new HTTPErrorResponse(
        500,
        {
          error: getUnexplainedServerErrorMessage("a1b2c3d4"),
          reference: "a1b2c3d4",
        },
        {},
      ),
    );

    expect(message).toBe(getUnexplainedServerErrorMessage("a1b2c3d4"));
    expect(readUnexplainedError(message)?.reference).toBe("a1b2c3d4");
  });

  test("builds the sentence from the reference, whatever words came with it", () => {
    expect(
      friendly(
        new HTTPErrorResponse(500, { message: "x", reference: "a1b2c3d4" }, {}),
      ),
    ).toBe(getUnexplainedServerErrorMessage("a1b2c3d4"));
  });

  test("ignores a reference that is not one", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          400,
          { message: "Promo code is invalid.", reference: "<b>hi</b>" },
          {},
        ),
      ),
    ).toBe("Promo code is invalid.");
  });

  test.each([
    [{ error: "Server Error" }],
    [{ message: "Internal Server Error" }],
    [{ error: "" }],
    [{}],
  ])(
    "an answer that says nothing (%j) says what to do next",
    (body: Record<string, string>) => {
      expect(friendly(new HTTPErrorResponse(500, body, {}))).toBe(
        UNEXPLAINED_ERROR_MESSAGES.server,
      );
    },
  );

  test("never 'Server Error. Please try again'", () => {
    expect(friendly(new HTTPErrorResponse(500, {}, {}))).not.toContain(
      "Server Error",
    );
  });

  test("an older server's bare 'Server Error', thrown again as an Error", () => {
    expect(friendly(new Error("Server Error"))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
    expect(friendly("Server Error")).toBe(UNEXPLAINED_ERROR_MESSAGES.server);
  });
});

describe("a server that did not answer", () => {
  test.each([502, 504])(
    "a gateway's %i page reads as the server being down",
    (status: number) => {
      const message: string = friendly(
        new HTTPErrorResponse(status, "<html>Bad Gateway</html>" as never, {}),
      );

      expect(message).toBe(SERVER_DOWN_MESSAGE);
      expect(readUnexplainedError(message)?.kind).toBe(
        UnexplainedErrorKind.ServerDown,
      );
    },
  );
});

describe("OneUptime that could not be reached at all", () => {
  test("a request with no answer: the browser's words and the URL stay out", () => {
    const message: string = friendly(
      new APIException(
        "Request failed to https://oneuptime.example.com/api/monitor. Network Error",
      ),
    );

    expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.unreachable);
    expect(message).not.toContain("https://");
  });

  test("the browser's own 'Network Error', thrown as an APIException", () => {
    expect(friendly(new APIException("Network Error"))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
    );
    expect(friendly(new APIException("Network Error."))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
    );
  });

  test("no response at all", () => {
    expect(
      friendly(new APIException("No response received from server.")),
    ).toBe(UNEXPLAINED_ERROR_MESSAGES.unreachable);
  });

  test.each([
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ])("fetch()'s TypeError %j", (words: string) => {
    expect(friendly(new TypeError(words))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
    );
  });

  test("an APIException with words of its own keeps them", () => {
    expect(
      friendly(new APIException("The LLM provider refused the key.")),
    ).toBe("The LLM provider refused the key.");
  });
});

describe("a page that failed", () => {
  test("a TypeError's words are a developer's, and stay out", () => {
    const message: string = friendly(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
    );

    expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
    expect(message).not.toContain("undefined");
  });

  test("a ReferenceError's too", () => {
    expect(friendly(new ReferenceError("project is not defined"))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.page,
    );
  });

  test("an error with no message", () => {
    expect(friendly(new Error(""))).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
  });

  test("an object with nothing to read, rather than its JSON", () => {
    expect(friendly({ status: 500, code: "E_X" })).toBe(
      UNEXPLAINED_ERROR_MESSAGES.page,
    );
  });

  test("an object that holds a message gives it", () => {
    expect(friendly({ error: "The key expired." })).toBe("The key expired.");
    expect(friendly({ message: "Server Error" })).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
  });

  test("nothing at all", () => {
    expect(friendly(undefined)).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
    expect(friendly(null)).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
    expect(friendly("")).toBe(UNEXPLAINED_ERROR_MESSAGES.server);
  });
});

describe("whatever failed, the answer is never an empty phrase", () => {
  test.each([
    new HTTPErrorResponse(500, {}, {}),
    new HTTPErrorResponse(500, { error: "Server Error" }, {}),
    new Error(""),
    new TypeError("x is not a function"),
    new APIException("Request failed to https://x/api. Network Error"),
    undefined,
    {},
    "",
  ])("%p", (err: unknown) => {
    expect(isEmptyErrorPhrase(friendly(err))).toBe(false);
  });
});
