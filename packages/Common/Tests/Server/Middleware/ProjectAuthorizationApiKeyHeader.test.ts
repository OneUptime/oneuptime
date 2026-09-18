import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import { ExpressRequest } from "../../../Server/Utils/Express";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The `apikey` request header, from raw string to resolved key.
 *
 * A caller sent a real project API key and got back
 * HTTP 401 "A user should be logged in to read record of Log Pipeline."
 * (issue #3004; issue #1754 was the same string on a different model). The
 * model was innocent and RBAC was fine — the request simply never reached the
 * API-key branch, because `hasApiKey` used to be `Boolean(getApiKey(req))`.
 * Anything the key parser could not turn into an ObjectID — an empty value
 * from an unset shell variable, a stray quote, duplicate headers — looked
 * exactly like a request that had sent no header at all, so the caller fell
 * through to the anonymous path and was told to log in.
 *
 * The fix splits presence from usability:
 *   hasApiKey  -> was the header sent?    (claims the request)
 *   getApiKey  -> is it a usable key?     (null unless it is UUID-shaped)
 * Those two deliberately DISAGREE for every present-but-unusable value, and
 * that disagreement is what turns the misleading 401 into `Invalid API Key`.
 *
 * getApiKey's UUID check also keeps malformed values out of the `apiKey`
 * Postgres `uuid` column, where they raised a raw QueryFailedError — not a
 * OneUptime Exception, so it escaped the error translator and answered 500.
 */

type ApiKeyHeaderValue = string | Array<string> | undefined;

type RequestWithApiKeyHeaderFunction = (
  apiKeyHeader: ApiKeyHeaderValue,
) => ExpressRequest;

const requestWithApiKeyHeader: RequestWithApiKeyHeaderFunction = (
  apiKeyHeader: ApiKeyHeaderValue,
): ExpressRequest => {
  return {
    headers: { apikey: apiKeyHeader },
  } as unknown as ExpressRequest;
};

const VALID_UUID: string = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_VALID_UUID: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NIL_UUID: string = "00000000-0000-0000-0000-000000000000";

/*
 * Every value a caller can put in the header that is NOT a usable key but IS
 * unmistakably an attempt to authenticate by key. Each of these produced the
 * misleading "should be logged in" 401 before the fix.
 *
 * Typed as `string | Array<string>` rather than ApiKeyHeaderValue on purpose:
 * `undefined` means the header was never sent, which is the one shape that
 * belongs in the "absent" block. Letting it into this list would quietly make
 * the presence assertions below contradictory.
 */
const PRESENT_BUT_UNUSABLE_HEADERS: Array<[string, string | Array<string>]> = [
  // The literal #3004 shape: `-H "ApiKey: $ONEUPTIME_API_KEY"` with the variable unset.
  ["empty string", ""],
  ["spaces only", "   "],
  ["a single tab", "\t"],
  ["a newline", "\n"],
  ["mixed whitespace", " \t\n "],
  ["arbitrary garbage", "garbage"],
  ["a hyphenated non-uuid", "not-a-uuid"],
  ["a bare number", "12345"],
  /*
   * The rest of the unset-credential family, all seen in the wild alongside
   * the empty string. A shell that does not expand the variable sends its
   * name; a JS client that does `ApiKey: String(process.env.KEY)` sends the
   * literal "undefined". Each is a caller who meant to send a key, so each
   * must be claimed by the API-key branch rather than treated as anonymous.
   */
  ["an unexpanded shell variable", "$ONEUPTIME_API_KEY"],
  ["the literal string undefined", "undefined"],
  ["the literal string null", "null"],
  // A caller who pasted an Authorization-header value into the apikey header.
  ["a uuid with a Bearer prefix", `Bearer ${VALID_UUID}`],
  ["a uuid missing a segment", "550e8400-e29b-41d4-446655440000"],
  ["a uuid with an extra segment", "550e8400-e29b-41d4-a716-a716-446655440000"],
  [
    "a uuid containing a non-hex character",
    "550e8400-e29b-41d4-a716-44665544000g",
  ],
  ["a uuid with a short segment", "550e840-e29b-41d4-a716-446655440000"],
  ["a uuid with no hyphens", "550e8400e29b41d4a716446655440000"],
  ["a uuid wrapped in braces", "{550e8400-e29b-41d4-a716-446655440000}"],
  ["a uuid with trailing text", `${VALID_UUID}extra`],
  ["a quoted uuid", `"${VALID_UUID}"`],
  ["a bare SQL injection attempt", "' OR 1=1 --"],
  ["a uuid with SQL appended", `${VALID_UUID}'; DROP TABLE "ApiKey"; --`],
  ["a very long value", "a".repeat(8192)],
  ["a very long digit string", "9".repeat(4096)],
  /*
   * Node collapses duplicate `apikey` headers into an array, which the raw
   * reader joins with "," — a shape no uuid column will ever accept. The old
   * getApiKey handed that comma-joined string straight to the query layer,
   * where Postgres answered 22P02 and the caller got a 500.
   */
  ["duplicate headers joined by node", [VALID_UUID, SECOND_VALID_UUID]],
  ["duplicate empty headers", ["", ""]],
];

/*
 * Values that are UUID-shaped, so getApiKey resolves them. Shape is all that
 * is checked here — whether the key exists or is still live is ApiKeyService's
 * job, and answering `Invalid API Key` for an unknown-but-well-formed key is
 * the same 400 either way.
 */
const RESOLVABLE_HEADERS: Array<[string, string | Array<string>, string]> = [
  ["a lowercase uuid", VALID_UUID, VALID_UUID],
  [
    "an uppercase uuid (the regex is case-insensitive)",
    VALID_UUID.toUpperCase(),
    VALID_UUID.toUpperCase(),
  ],
  [
    "a mixed-case uuid",
    "550E8400-e29b-41D4-a716-446655440000",
    "550E8400-e29b-41D4-a716-446655440000",
  ],
  ["a uuid padded with spaces", `  ${VALID_UUID}  `, VALID_UUID],
  ["a uuid padded with a tab and a newline", `\t${VALID_UUID}\n`, VALID_UUID],
  // Shape, not liveness: the nil uuid is well-formed, so it reaches the lookup.
  ["the nil uuid", NIL_UUID, NIL_UUID],
  // Not a v4 uuid — the regex is version-agnostic on purpose.
  [
    "a v1-shaped uuid",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  ],
  /*
   * The other half of the array case, and the one that pins HOW arrays are
   * handled. A one-element array is what Node hands over when a proxy rebuilds
   * a single header; joining it yields the key unchanged, so it must resolve.
   * Rejecting every array outright would pass the two-element test below and
   * fail this one; taking rawHeader[0] instead of joining would pass this one
   * and silently authenticate with the first of two conflicting keys.
   */
  ["a single-element duplicate header array", [VALID_UUID], VALID_UUID],
];

describe("ProjectMiddleware apikey header handling", () => {
  describe("header genuinely absent", () => {
    /*
     * The only shape that may reach the anonymous path. Answering true here
     * would claim every unauthenticated browser request as an API-key request
     * and break session auth outright.
     */
    test("no headers object at all", () => {
      const req: ExpressRequest = {} as unknown as ExpressRequest;

      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(false);
      expect(ProjectMiddleware.getApiKey(req)).toBeNull();
    });

    test("empty headers object", () => {
      const req: ExpressRequest = { headers: {} } as unknown as ExpressRequest;

      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(false);
      expect(ProjectMiddleware.getApiKey(req)).toBeNull();
    });

    test("apikey explicitly undefined", () => {
      const req: ExpressRequest = requestWithApiKeyHeader(undefined);

      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(false);
      expect(ProjectMiddleware.getApiKey(req)).toBeNull();
    });

    // Other headers present must not be mistaken for an apikey header.
    test("only unrelated headers present", () => {
      const req: ExpressRequest = {
        headers: { tenantid: VALID_UUID, "content-type": "application/json" },
      } as unknown as ExpressRequest;

      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(false);
      expect(ProjectMiddleware.getApiKey(req)).toBeNull();
    });
  });

  describe("hasApiKey is presence, not usability", () => {
    /*
     * This is the #3004 fix. Each of these used to answer false, which sent
     * the request down the anonymous path and produced a 401 about being
     * logged in. They must all answer true so the request is claimed by the
     * API-key branch and fails as `Invalid API Key` (400) instead.
     */
    test.each(PRESENT_BUT_UNUSABLE_HEADERS)(
      "returns true for %s",
      (_description: string, headerValue: string | Array<string>) => {
        expect(
          ProjectMiddleware.hasApiKey(requestWithApiKeyHeader(headerValue)),
        ).toStrictEqual(true);
      },
    );

    test.each(RESOLVABLE_HEADERS)(
      "returns true for %s",
      (_description: string, headerValue: string | Array<string>) => {
        expect(
          ProjectMiddleware.hasApiKey(requestWithApiKeyHeader(headerValue)),
        ).toStrictEqual(true);
      },
    );
  });

  describe("getApiKey rejects anything that is not uuid-shaped", () => {
    /*
     * `ApiKey.apiKey` is a Postgres uuid column. Before the shape check these
     * values were passed straight into the query and raised a raw
     * QueryFailedError (22P02), which is not a OneUptime Exception and so
     * escaped the error translator as an HTTP 500 on a malformed request.
     */
    test.each(PRESENT_BUT_UNUSABLE_HEADERS)(
      "returns null for %s",
      (_description: string, headerValue: string | Array<string>) => {
        expect(
          ProjectMiddleware.getApiKey(requestWithApiKeyHeader(headerValue)),
        ).toBeNull();
      },
    );
  });

  describe("getApiKey resolves uuid-shaped values", () => {
    test.each(RESOLVABLE_HEADERS)(
      "resolves %s",
      (
        _description: string,
        headerValue: string | Array<string>,
        expectedValue: string,
      ) => {
        const apiKey: ObjectID | null = ProjectMiddleware.getApiKey(
          requestWithApiKeyHeader(headerValue),
        );

        expect(apiKey).toBeInstanceOf(ObjectID);
        /*
         * The value must survive verbatim apart from trimming — lower-casing
         * or otherwise normalising it here would stop the key matching the row
         * that was actually issued.
         */
        expect(apiKey?.toString()).toStrictEqual(expectedValue);
      },
    );

    // Padding is stripped, so a copy-pasted key with stray spaces still works.
    test("a padded uuid resolves to the same key as the unpadded one", () => {
      const padded: ObjectID | null = ProjectMiddleware.getApiKey(
        requestWithApiKeyHeader(`   ${VALID_UUID} \t`),
      );
      const unpadded: ObjectID | null = ProjectMiddleware.getApiKey(
        requestWithApiKeyHeader(VALID_UUID),
      );

      expect(padded).not.toBeNull();
      expect(unpadded).not.toBeNull();
      expect(padded!.equals(unpadded!)).toStrictEqual(true);
    });
  });

  /*
   * The invariant the whole fix rests on.
   *
   * hasApiKey used to be `Boolean(this.getApiKey(req))`, i.e. the two always
   * agreed. Making them agree again — by deriving hasApiKey from getApiKey, or
   * by having getApiKey fall back to a non-null ObjectID for unusable input —
   * reintroduces #3004: getUserMiddleware would stop routing these requests
   * into the API-key branch and they would once again die on the anonymous
   * path with a 401 about logging in.
   */
  test("for present-but-unusable headers hasApiKey and getApiKey deliberately disagree", () => {
    const disagreements: Array<string> = [];

    for (const [description, headerValue] of PRESENT_BUT_UNUSABLE_HEADERS) {
      const req: ExpressRequest = requestWithApiKeyHeader(headerValue);

      if (
        ProjectMiddleware.hasApiKey(req) === true &&
        ProjectMiddleware.getApiKey(req) === null
      ) {
        continue;
      }

      disagreements.push(description);
    }

    expect(disagreements).toEqual([]);
    // Guard against the list itself being emptied and the assertion going vacuous.
    expect(PRESENT_BUT_UNUSABLE_HEADERS.length).toBeGreaterThan(10);
  });

  /*
   * The converse: when the header IS usable the two agree, and when it is
   * absent they agree the other way. Only the middle case is asymmetric.
   */
  test("hasApiKey and getApiKey agree for usable and for absent headers", () => {
    for (const [, headerValue] of RESOLVABLE_HEADERS) {
      const req: ExpressRequest = requestWithApiKeyHeader(headerValue);

      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(true);
      expect(ProjectMiddleware.getApiKey(req)).not.toBeNull();
    }

    const absent: ExpressRequest = requestWithApiKeyHeader(undefined);

    expect(ProjectMiddleware.hasApiKey(absent)).toStrictEqual(false);
    expect(ProjectMiddleware.getApiKey(absent)).toBeNull();
  });

  describe("reading the header does not mutate the request", () => {
    // Trimming must be local: express handlers downstream still read req.headers.
    test("the raw header value is left exactly as it arrived", () => {
      const req: ExpressRequest = requestWithApiKeyHeader(`  ${VALID_UUID}  `);

      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(true);
      expect(ProjectMiddleware.getApiKey(req)?.toString()).toStrictEqual(
        VALID_UUID,
      );

      // The trim happened on a local copy, not on the header itself.
      expect(req.headers["apikey"]).toStrictEqual(`  ${VALID_UUID}  `);
    });

    /*
     * Reading the header is side-effect free, so the answer cannot depend on
     * how many middlewares asked. getUserMiddleware calls hasApiKey and then
     * isValidProjectIdAndApiKeyMiddleware calls both again on the same request.
     */
    test("repeated reads of the same request give the same answer", () => {
      const req: ExpressRequest = requestWithApiKeyHeader(VALID_UUID);

      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(true);
      expect(ProjectMiddleware.getApiKey(req)?.toString()).toStrictEqual(
        VALID_UUID,
      );
      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(true);
      expect(ProjectMiddleware.getApiKey(req)?.toString()).toStrictEqual(
        VALID_UUID,
      );

      const unusable: ExpressRequest = requestWithApiKeyHeader("");

      expect(ProjectMiddleware.hasApiKey(unusable)).toStrictEqual(true);
      expect(ProjectMiddleware.getApiKey(unusable)).toBeNull();
      expect(ProjectMiddleware.hasApiKey(unusable)).toStrictEqual(true);
      expect(ProjectMiddleware.getApiKey(unusable)).toBeNull();
    });

    test("duplicate headers are left as an array on the request", () => {
      const req: ExpressRequest = requestWithApiKeyHeader([
        VALID_UUID,
        SECOND_VALID_UUID,
      ]);

      expect(ProjectMiddleware.hasApiKey(req)).toStrictEqual(true);
      expect(ProjectMiddleware.getApiKey(req)).toBeNull();
      expect(req.headers["apikey"]).toEqual([VALID_UUID, SECOND_VALID_UUID]);
    });
  });
});
