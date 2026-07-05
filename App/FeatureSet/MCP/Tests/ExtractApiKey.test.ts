/**
 * extractApiKey header-parsing tests.
 *
 * Locks in the RFC 7235 behavior of the Authorization header handling: the
 * Bearer scheme is case-insensitive and whitespace-tolerant, and x-api-key
 * takes precedence over Authorization (per API_KEY_HEADERS order).
 */

import { describe, it, expect } from "@jest/globals";
import { extractApiKey } from "../Handlers/RouteHandler";
import { ExpressRequest } from "Common/Server/Utils/Express";

function makeRequest(headers: Record<string, string>): ExpressRequest {
  return { headers } as unknown as ExpressRequest;
}

describe("extractApiKey", () => {
  it("returns the x-api-key header value as-is", () => {
    expect(extractApiKey(makeRequest({ "x-api-key": "plain-key" }))).toBe(
      "plain-key",
    );
  });

  it("strips the Bearer scheme from the Authorization header", () => {
    expect(extractApiKey(makeRequest({ authorization: "Bearer abc" }))).toBe(
      "abc",
    );
  });

  it("accepts a lowercase bearer scheme", () => {
    expect(extractApiKey(makeRequest({ authorization: "bearer abc" }))).toBe(
      "abc",
    );
  });

  it("accepts an uppercase scheme with extra whitespace and trims the token", () => {
    expect(extractApiKey(makeRequest({ authorization: "BEARER  abc " }))).toBe(
      "abc",
    );
  });

  it("returns a schemeless Authorization value unchanged", () => {
    expect(extractApiKey(makeRequest({ authorization: "raw-token" }))).toBe(
      "raw-token",
    );
  });

  it("prefers x-api-key when both headers are present", () => {
    expect(
      extractApiKey(
        makeRequest({
          "x-api-key": "primary-key",
          authorization: "Bearer secondary-key",
        }),
      ),
    ).toBe("primary-key");
  });

  it("returns undefined when no API key header is present", () => {
    expect(extractApiKey(makeRequest({}))).toBeUndefined();
  });
});
