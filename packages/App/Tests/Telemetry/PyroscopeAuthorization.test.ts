import {
  EXPLICIT_INGEST_TOKEN_HEADERS,
  extractIngestTokenFromAuthorizationHeader,
  mapAuthorizationToIngestToken,
} from "../../FeatureSet/Telemetry/Utils/PyroscopeAuthorization";
import { ExpressRequest } from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";
import { describe, expect, test } from "@jest/globals";

/*
 * Pyroscope clients carry the ingestion key in an Authorization header, and
 * the scheme depends on the client and its version. pyroscope-dotnet 1.5+
 * removed PYROSCOPE_AUTH_TOKEN (Bearer) and only sends Basic auth, as do
 * current pyroscope-rs based SDKs; the Bearer-only mapping answered every
 * one of their uploads 401 "Missing ingestion token" - logged by the .NET
 * SDK at Debug only, so the user saw nothing.
 */

const KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_KEY: string = "3f1d4b8e-2a6c-4e0f-9b7d-5c8a1e2f3d4b";

function basic(credentials: string): string {
  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

function requestWith(headers: Dictionary<string>): ExpressRequest {
  return { headers: { ...headers } } as unknown as ExpressRequest;
}

describe("extractIngestTokenFromAuthorizationHeader", () => {
  test.each([
    ["Bearer (Go, Java, Node, .NET <= 1.4)", `Bearer ${KEY}`],
    ["lower-case bearer", `bearer ${KEY}`],
    ["upper-case BEARER", `BEARER ${KEY}`],
    ["extra whitespace", `  Bearer   ${KEY}  `],
  ])("%s", (_label: string, header: string) => {
    expect(extractIngestTokenFromAuthorizationHeader(header)).toBe(KEY);
  });

  test("Bearer passes a non-UUID token through for TelemetryIngest to judge", () => {
    expect(extractIngestTokenFromAuthorizationHeader("Bearer not-a-key")).toBe(
      "not-a-key",
    );
  });

  test(".NET 1.5+ with PYROSCOPE_BASIC_AUTH_USER / _PASSWORD: the key is the password", () => {
    expect(
      extractIngestTokenFromAuthorizationHeader(basic(`oneuptime:${KEY}`)),
    ).toBe(KEY);
  });

  test("the key in the user half with a placeholder password is found too", () => {
    // The .NET SDK sends Basic only when BOTH halves are set.
    expect(extractIngestTokenFromAuthorizationHeader(basic(`${KEY}:x`))).toBe(
      KEY,
    );
  });

  test("an empty user half is fine", () => {
    expect(extractIngestTokenFromAuthorizationHeader(basic(`:${KEY}`))).toBe(
      KEY,
    );
  });

  test("an empty password half falls back to the user half", () => {
    expect(extractIngestTokenFromAuthorizationHeader(basic(`${KEY}:`))).toBe(
      KEY,
    );
  });

  test("URL userinfo with only a user (https://KEY@host/pyroscope)", () => {
    expect(extractIngestTokenFromAuthorizationHeader(basic(KEY))).toBe(KEY);
  });

  test("a password containing a colon stays whole", () => {
    expect(
      extractIngestTokenFromAuthorizationHeader(basic("user:pa:ss:word")),
    ).toBe("pa:ss:word");
  });

  test("when neither half is a key, the password is handed over to be rejected", () => {
    expect(
      extractIngestTokenFromAuthorizationHeader(basic("user:wrong-password")),
    ).toBe("wrong-password");
  });

  test("when both halves are keys, the password wins", () => {
    expect(
      extractIngestTokenFromAuthorizationHeader(basic(`${OTHER_KEY}:${KEY}`)),
    ).toBe(KEY);
  });

  test("lower-case basic scheme", () => {
    expect(
      extractIngestTokenFromAuthorizationHeader(
        `basic ${Buffer.from(`u:${KEY}`).toString("base64")}`,
      ),
    ).toBe(KEY);
  });

  test.each([
    ["undefined", undefined],
    ["empty", ""],
    ["scheme only", "Bearer"],
    ["scheme and spaces", "Bearer    "],
    ["unknown scheme", `Token ${KEY}`],
    ["Digest", `Digest username="${KEY}"`],
    ["Basic with empty credentials", basic(":")],
    ["Basic with whitespace credentials", basic(" : ")],
  ])("%s yields no token", (_label: string, header: string | undefined) => {
    expect(extractIngestTokenFromAuthorizationHeader(header)).toBeUndefined();
  });

  test("garbage base64 does not throw", () => {
    expect(() => {
      return extractIngestTokenFromAuthorizationHeader("Basic ###%%%");
    }).not.toThrow();
  });
});

describe("mapAuthorizationToIngestToken", () => {
  test("copies a Bearer key into x-oneuptime-token", () => {
    const req: ExpressRequest = requestWith({
      authorization: `Bearer ${KEY}`,
    });

    mapAuthorizationToIngestToken(req);

    expect(req.headers["x-oneuptime-token"]).toBe(KEY);
  });

  test("copies a Basic key into x-oneuptime-token", () => {
    const req: ExpressRequest = requestWith({
      authorization: basic(`oneuptime:${KEY}`),
    });

    mapAuthorizationToIngestToken(req);

    expect(req.headers["x-oneuptime-token"]).toBe(KEY);
  });

  test("does nothing without an Authorization header", () => {
    const req: ExpressRequest = requestWith({});

    mapAuthorizationToIngestToken(req);

    expect(req.headers["x-oneuptime-token"]).toBeUndefined();
  });

  /*
   * TelemetryIngest reads x-oneuptime-token FIRST. Writing the Authorization
   * credential into it when the caller named its key in either of the other
   * two headers would shadow that key - with an auth proxy's Basic login, or
   * with a different project's key. The Bearer-only mapping had this bug for
   * the two secondary headers already.
   */
  test.each(
    EXPLICIT_INGEST_TOKEN_HEADERS.map((header: string) => {
      return [header];
    }),
  )("never overrides an explicit %s", (header: string) => {
    for (const authorization of [
      `Bearer ${OTHER_KEY}`,
      basic(`proxy-user:${OTHER_KEY}`),
    ]) {
      const req: ExpressRequest = requestWith({
        [header]: KEY,
        authorization: authorization,
      });

      mapAuthorizationToIngestToken(req);

      expect(req.headers[header]).toBe(KEY);

      if (header === "x-oneuptime-token") {
        expect(req.headers["x-oneuptime-token"]).toBe(KEY);
      } else {
        expect(req.headers["x-oneuptime-token"]).toBeUndefined();
      }
    }
  });

  test("an empty explicit header does not count as a key", () => {
    const req: ExpressRequest = requestWith({
      "x-oneuptime-token": "   ",
      authorization: `Bearer ${KEY}`,
    });

    mapAuthorizationToIngestToken(req);

    expect(req.headers["x-oneuptime-token"]).toBe(KEY);
  });
});
