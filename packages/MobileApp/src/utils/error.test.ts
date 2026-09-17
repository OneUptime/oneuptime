import { AxiosError, type AxiosResponse } from "axios";
import { getFriendlyErrorMessage } from "./error";
import { describe, expect, test } from "@jest/globals";

/*
 * Every failure a responder sees is rendered from this function - a failed
 * acknowledge, a login against a mistyped server URL, a project list that would
 * not load. What it must never do is put axios' own words on screen: "Request
 * failed with status code 400" tells a responder nothing they can act on, while
 * the server's own "Monitor name already exists" tells them everything.
 *
 * The errors below are built with the REAL AxiosError class rather than a
 * hand-shaped object, because the whole first half of this function hangs off
 * recognising one. A fake carrying `isAxiosError: true` would pass whether or
 * not the type guard still matches what axios actually throws.
 */

function responseWith(status: number, data: unknown): AxiosResponse {
  return {
    status: status,
    statusText: "",
    data: data,
    headers: {},
    config: {},
  } as unknown as AxiosResponse;
}

function axiosErrorWithResponse(status: number, data: unknown): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    responseWith(status, data),
  );
}

function axiosErrorWithoutResponse(code?: string): AxiosError {
  return new AxiosError("Network Error", code);
}

describe("getFriendlyErrorMessage when the server never answered", () => {
  test("an aborted connection reads as a timeout, not as a server fault", () => {
    /*
     * ECONNABORTED is what axios reports when its own timeout fires. Blaming
     * the server sends a responder off checking a service that is fine; naming
     * the connection points them at the thing they can actually change.
     */
    const message: string = getFriendlyErrorMessage(
      axiosErrorWithoutResponse("ECONNABORTED"),
    );

    expect(message).toContain("timed out");
  });

  test("a socket-level timeout also reads as a timeout", () => {
    expect(
      getFriendlyErrorMessage(axiosErrorWithoutResponse("ETIMEDOUT")),
    ).toContain("timed out");
  });

  test("a network error names the internet connection and the server URL", () => {
    /*
     * On this app a wrong server URL is indistinguishable from being offline
     * at the transport layer, and self-hosted users mistype the URL constantly,
     * so both suspects have to be named.
     */
    const message: string = getFriendlyErrorMessage(
      axiosErrorWithoutResponse("ERR_NETWORK"),
    );

    expect(message).toContain("internet connection");
    expect(message).toContain("server URL");
  });

  test("an unrecognised failure with no response still blames the connection", () => {
    const message: string = getFriendlyErrorMessage(
      axiosErrorWithoutResponse("ERR_SOMETHING_NEW"),
    );

    expect(message).toContain("Could not connect to the server");
  });

  test("a failure with no code at all still blames the connection", () => {
    const message: string = getFriendlyErrorMessage(
      axiosErrorWithoutResponse(),
    );

    expect(message).toContain("Could not connect to the server");
  });

  test("never surfaces axios' own wording", () => {
    expect(
      getFriendlyErrorMessage(axiosErrorWithoutResponse("ERR_NETWORK")),
    ).not.toContain("Network Error");
  });
});

describe("getFriendlyErrorMessage reading the server's own message", () => {
  test("prefers the message field of the response body", () => {
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(400, {
          message: "Monitor name already exists",
        }),
      ),
    ).toBe("Monitor name already exists");
  });

  test("falls back to the data field when there is no message", () => {
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(400, { data: "Invalid probe key" }),
      ),
    ).toBe("Invalid probe key");
  });

  test("falls back to the error field when there is neither", () => {
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(400, { error: "invalid_grant" }),
      ),
    ).toBe("invalid_grant");
  });

  test("message wins when the body carries all three", () => {
    /*
     * The three fields are alternative shapes from different server versions,
     * not three parts of one message, so exactly one of them has to win and it
     * has to be the same one every time.
     */
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(400, {
          message: "Monitor name already exists",
          data: "duplicate",
          error: "bad_request",
        }),
      ),
    ).toBe("Monitor name already exists");
  });

  test("data wins over error when the message is absent", () => {
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(400, {
          data: "duplicate",
          error: "bad_request",
        }),
      ),
    ).toBe("duplicate");
  });

  test("an empty message is skipped rather than shown as blank text", () => {
    /*
     * An empty string would render as an alert with no body - the responder
     * sees that something failed and is told nothing about what.
     */
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(400, { message: "", data: "duplicate" }),
      ),
    ).toBe("duplicate");
  });

  test("a non-string message is ignored rather than stringified", () => {
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(400, { message: { nested: "object" } }),
      ),
    ).toBe("Server error (400). Please try again.");
  });

  test("a bare string body is used as the message", () => {
    expect(
      getFriendlyErrorMessage(axiosErrorWithResponse(400, "Bad request body")),
    ).toBe("Bad request body");
  });

  test("an empty string body falls through to the status message", () => {
    expect(getFriendlyErrorMessage(axiosErrorWithResponse(400, ""))).toBe(
      "Server error (400). Please try again.",
    );
  });

  test("a null body falls through to the status message", () => {
    expect(getFriendlyErrorMessage(axiosErrorWithResponse(400, null))).toBe(
      "Server error (400). Please try again.",
    );
  });

  test("a body in an unknown shape falls through to the status message", () => {
    /*
     * A proxy sitting in front of a self-hosted install answers in its own
     * shape, not OneUptime's. None of the three known fields is present, so the
     * status wording is what the responder gets - which is the point: better a
     * short sentence about the gateway than the proxy's own vocabulary.
     */
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(502, { html: "<html>Bad Gateway</html>" }),
      ),
    ).toContain("try again in a few minutes");
  });

  test("the server's message beats the status fallback even on a 500", () => {
    expect(
      getFriendlyErrorMessage(
        axiosErrorWithResponse(500, { message: "Probe queue is saturated" }),
      ),
    ).toBe("Probe queue is saturated");
  });
});

describe("getFriendlyErrorMessage falling back on the status code", () => {
  test("502 tells the responder to try again shortly", () => {
    expect(
      getFriendlyErrorMessage(axiosErrorWithResponse(502, null)),
    ).toContain("try again in a few minutes");
  });

  test("504 reads like 502, because both mean the gateway not the app", () => {
    expect(
      getFriendlyErrorMessage(axiosErrorWithResponse(504, null)),
    ).toContain("try again in a few minutes");
  });

  test("403 says it is a permission problem, not a broken app", () => {
    expect(
      getFriendlyErrorMessage(axiosErrorWithResponse(403, null)),
    ).toContain("do not have permission");
  });

  test("404 points at the server URL, the usual cause on a self-hosted install", () => {
    expect(
      getFriendlyErrorMessage(axiosErrorWithResponse(404, null)),
    ).toContain("server URL");
  });

  test("500 says the server is at fault so the responder stops retrying blind", () => {
    expect(
      getFriendlyErrorMessage(axiosErrorWithResponse(500, null)),
    ).toContain("Internal server error");
  });

  test("any other status still names the number, so it can be reported", () => {
    expect(getFriendlyErrorMessage(axiosErrorWithResponse(418, null))).toBe(
      "Server error (418). Please try again.",
    );
  });

  test("401 is not special-cased and falls through with its number", () => {
    expect(getFriendlyErrorMessage(axiosErrorWithResponse(401, null))).toBe(
      "Server error (401). Please try again.",
    );
  });
});

describe("getFriendlyErrorMessage on everything that is not an axios error", () => {
  test("uses the message of a plain Error", () => {
    expect(getFriendlyErrorMessage(new Error("Token has expired"))).toBe(
      "Token has expired",
    );
  });

  test("uses the message of an Error subclass", () => {
    expect(getFriendlyErrorMessage(new TypeError("x is not a function"))).toBe(
      "x is not a function",
    );
  });

  test("an Error with no message gets generic wording, never an empty alert", () => {
    expect(getFriendlyErrorMessage(new Error(""))).toBe(
      "An unexpected error occurred.",
    );
  });

  test("a thrown string is shown as-is", () => {
    expect(getFriendlyErrorMessage("Session expired")).toBe("Session expired");
  });

  test("an empty thrown string gets generic wording", () => {
    expect(getFriendlyErrorMessage("")).toBe(
      "An unknown error occurred. Please try again.",
    );
  });

  test("null gets generic wording rather than crashing the handler", () => {
    expect(getFriendlyErrorMessage(null)).toBe(
      "An unknown error occurred. Please try again.",
    );
  });

  test("undefined gets generic wording rather than crashing the handler", () => {
    expect(getFriendlyErrorMessage(undefined)).toBe(
      "An unknown error occurred. Please try again.",
    );
  });

  test("an object that is none of the known shapes gets generic wording", () => {
    expect(getFriendlyErrorMessage({ status: 500, detail: "nope" })).toBe(
      "An unexpected error occurred. Please try again.",
    );
  });

  test("an object marked as not an axios error is not read as one", () => {
    /*
     * The guard checks the flag's value, not merely the key's presence -
     * otherwise anything carrying `isAxiosError: false` would be taken apart as
     * though it had a response, and its `.response` would be read off
     * undefined.
     */
    expect(
      getFriendlyErrorMessage({
        isAxiosError: false,
        response: { status: 404, data: null },
      }),
    ).toBe("An unexpected error occurred. Please try again.");
  });

  test("a bare number gets generic wording", () => {
    expect(getFriendlyErrorMessage(500)).toBe(
      "An unexpected error occurred. Please try again.",
    );
  });

  test("always returns something a responder can read", () => {
    /*
     * The callers assign this straight into alert text, so an empty result is
     * a dialog with a title and nothing under it.
     */
    const inputs: unknown[] = [
      null,
      undefined,
      "",
      0,
      false,
      [],
      {},
      new Error(""),
      axiosErrorWithoutResponse(),
      axiosErrorWithResponse(400, {}),
    ];

    inputs.forEach((input: unknown): void => {
      expect(getFriendlyErrorMessage(input).length).toBeGreaterThan(0);
    });
  });
});
