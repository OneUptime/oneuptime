import { describe, expect, test } from "@jest/globals";
import cors from "cors";
import CorsOptions from "../../../Server/Utils/CorsOptions";

/*
 * A REAL preflight through the real cors middleware.
 *
 * The test this replaces read StartServer.ts as text and asserted it
 * CONTAINED "x-oneuptime-token", the app-identifier header name and
 * "Access-Control-Max-Age" - all three of which also appear in the
 * explanatory comment block directly above the code, so it passed with the
 * header edits reverted and only the prose kept. It also proved nothing
 * about the preflight, which never reaches setDefaultHeaders at all: cors
 * 2.8.5 defaults preflightContinue to false, so it answers OPTIONS itself
 * and calls res.end() before any later middleware runs.
 */

interface CorsProbeResult {
  headers: Record<string, string>;
  nextCalled: boolean;
}

function runCors(method: string): CorsProbeResult {
  const headers: Record<string, string> = {};

  const req: unknown = {
    method: method,
    headers: {
      origin: "https://shop.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, x-oneuptime-token",
    },
  };

  let nextCalled: boolean = false;

  const res: unknown = {
    statusCode: 200,
    setHeader: (name: string, value: string | Array<string>): void => {
      headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
    },
    getHeader: (name: string): string | undefined => {
      return headers[name];
    },
    end: (): void => {
      /* Preflight short-circuit. */
    },
  };

  cors(CorsOptions)(
    req as never,
    res as never,
    ((): void => {
      nextCalled = true;
    }) as never,
  );

  return { headers: headers, nextCalled: nextCalled };
}

describe("CORS preflight and exposed headers", () => {
  test("a preflight carries Access-Control-Max-Age", () => {
    /*
     * Without it the browser falls back to its own default preflight cache
     * (5 seconds in Chrome), which would preflight very nearly every replay
     * chunk flush - doubling the request count on the highest-volume browser
     * endpoint we have.
     */
    const result: CorsProbeResult = runCors("OPTIONS");

    expect(result.headers["Access-Control-Max-Age"]).toBe("86400");
  });

  test("a preflight is answered by cors itself, never by a later middleware", () => {
    const result: CorsProbeResult = runCors("OPTIONS");

    /*
     * This is precisely why Max-Age has to be a cors OPTION and not a header
     * written in setDefaultHeaders, which is registered after cors.
     */
    expect(result.nextCalled).toBe(false);
  });

  test("the replay stand-down headers are exposed to a cross-origin recorder", () => {
    const result: CorsProbeResult = runCors("POST");

    const exposed: string = (
      result.headers["Access-Control-Expose-Headers"] || ""
    ).toLowerCase();

    /*
     * Only the CORS-safelisted response headers are readable from another
     * origin, and the recorder runs on the customer's own origin. Without
     * these three it sees a bodyless 204 with no directive (removing the only
     * fast path for the kill switch) and a 429 with no Retry-After.
     */
    expect(exposed).toContain("x-oneuptime-replay-directive");
    expect(exposed).toContain("x-oneuptime-replay-config-epoch");
    expect(exposed).toContain("retry-after");
  });

  test("allowedHeaders is left to the cors default, which reflects the request", () => {
    const result: CorsProbeResult = runCors("OPTIONS");

    /*
     * Pinning an explicit list would silently break the first client that
     * starts sending a new header. Reflection cannot go stale.
     */
    expect(result.headers["Access-Control-Allow-Headers"]).toBe(
      "content-type, x-oneuptime-token",
    );
  });
});
