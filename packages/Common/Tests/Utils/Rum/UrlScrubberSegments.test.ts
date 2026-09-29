import { describe, expect, it } from "@jest/globals";
import UrlScrubber from "../../../Utils/Rum/UrlScrubber";

/*
 * The parent UrlScrubber.test.ts drives the whole pipeline through the
 * public scrub()/getScrubbedPathname() facade. This suite pins the two
 * segment-level primitives directly — scrubPath() and scrubQuery() — so
 * that the branch behaviour each one owns (every redaction pattern and its
 * length boundary, the decode-before-match step, the empty/"/" short
 * circuits, and the allowlist rules) is exercised in isolation rather than
 * only as an emergent property of a full URL round-trip.
 *
 * Everything here is a pure function of its arguments: no network, no clock,
 * no randomness. scrubQuery takes a plain URLSearchParams built inline.
 */

const REDACTED: string = "[redacted]";

describe("UrlScrubber segment primitives", () => {
  describe("scrubPath", () => {
    describe("empty and boundary inputs", () => {
      it("normalises an empty path to a single slash", () => {
        /*
         * The `pathname || "/"` fallback: an empty string is not passed
         * through as-is, it is turned into the root path.
         */
        expect(UrlScrubber.scrubPath("")).toBe("/");
      });

      it("returns the root path unchanged", () => {
        expect(UrlScrubber.scrubPath("/")).toBe("/");
      });

      it("keeps a path whose segments are all ordinary route words", () => {
        expect(UrlScrubber.scrubPath("/blog/how-we-scaled-clickhouse")).toBe(
          "/blog/how-we-scaled-clickhouse",
        );
      });

      it("preserves the leading empty segment produced by the leading slash", () => {
        /*
         * "/orders/2".split("/") is ["", "orders", "2"]; the empty first
         * element must survive the map so the result stays absolute.
         */
        const scrubbed: string = UrlScrubber.scrubPath("/orders/2");

        expect(scrubbed).toBe("/orders/2");
        expect(scrubbed.startsWith("/")).toBe(true);
      });

      it("preserves a trailing slash and collapsed empty segments", () => {
        expect(UrlScrubber.scrubPath("/a//b/")).toBe("/a//b/");
      });

      it("handles a path that is a single identifier segment", () => {
        expect(
          UrlScrubber.scrubPath("/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f"),
        ).toBe(`/${REDACTED}`);
      });
    });

    describe("uuid segments", () => {
      it("redacts a canonical lowercase uuid while keeping the route shape", () => {
        expect(
          UrlScrubber.scrubPath(
            "/orders/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f/items",
          ),
        ).toBe(`/orders/${REDACTED}/items`);
      });

      it("redacts a uuid case-insensitively", () => {
        expect(
          UrlScrubber.scrubPath("/orders/3F1A9C7E-5B2D-4801-96A3-C9E7B1D5028F"),
        ).toBe(`/orders/${REDACTED}`);
      });

      it("does not treat a uuid-shaped-but-wrong-length string as a uuid", () => {
        /*
         * A truncated uuid (30 chars): it fails the anchored uuid pattern
         * and, being under the 32-char opaque-token threshold, escapes that
         * rule too, so it survives as ordinary route structure.
         */
        const almost: string = "3f1a9c7e-5b2d-4801-96a3-c9e7b1";

        expect(almost.length).toBeLessThan(32);
        expect(UrlScrubber.scrubPath(`/x/${almost}`)).toBe(`/x/${almost}`);
      });
    });

    describe("object id segments", () => {
      it("redacts a 24-character Mongo/BSON object id", () => {
        expect(UrlScrubber.scrubPath("/users/6512f3a9b7c4d2e108f5a3b9")).toBe(
          `/users/${REDACTED}`,
        );
      });

      it("keeps a 23-character hex string, one short of an object id", () => {
        const shortHex: string = "6512f3a9b7c4d2e108f5a3b";

        expect(UrlScrubber.scrubPath(`/users/${shortHex}`)).toBe(
          `/users/${shortHex}`,
        );
      });
    });

    describe("email segments", () => {
      it("redacts a plain email segment", () => {
        expect(UrlScrubber.scrubPath("/u/someone@example.com/profile")).toBe(
          `/u/${REDACTED}/profile`,
        );
      });

      it("redacts a percent-encoded email by decoding before matching", () => {
        /*
         * name%40example.com decodes to name@example.com; the decode step
         * is what lets the email pattern see it.
         */
        const scrubbed: string = UrlScrubber.scrubPath(
          "/u/someone%40example.com",
        );

        expect(scrubbed).toBe(`/u/${REDACTED}`);
        expect(scrubbed).not.toContain("%40");
        expect(scrubbed).not.toContain("someone");
      });

      it("keeps a segment that merely contains an at-sign but is not an address", () => {
        /*
         * A handle like "@acme" has no domain part, so the anchored email
         * pattern rejects it and it is treated as route structure.
         */
        expect(UrlScrubber.scrubPath("/team/@acme")).toBe("/team/@acme");
      });
    });

    describe("long digit-run segments", () => {
      it("redacts a run of 9 or more digits (card / phone / SSN shaped)", () => {
        expect(UrlScrubber.scrubPath("/account/4111111111111111")).toBe(
          `/account/${REDACTED}`,
        );
      });

      it("redacts at the 9-digit boundary", () => {
        expect(UrlScrubber.scrubPath("/n/123456789")).toBe(`/n/${REDACTED}`);
      });

      it("keeps an 8-digit run just under the boundary", () => {
        expect(UrlScrubber.scrubPath("/n/12345678")).toBe("/n/12345678");
      });

      it("keeps a short numeric id, which is route structure not PII", () => {
        expect(UrlScrubber.scrubPath("/page/2")).toBe("/page/2");
      });
    });

    describe("opaque token segments", () => {
      it("redacts a 32-or-longer high-entropy token", () => {
        expect(
          UrlScrubber.scrubPath(
            "/s/aVeryLongOpaqueSessionTokenValue1234567890",
          ),
        ).toBe(`/s/${REDACTED}`);
      });

      it("redacts exactly at the 32-character boundary", () => {
        const token: string = "a".repeat(32);

        expect(UrlScrubber.scrubPath(`/s/${token}`)).toBe(`/s/${REDACTED}`);
      });

      it("keeps a 31-character string just under the boundary", () => {
        const slug: string = "a".repeat(31);

        expect(UrlScrubber.scrubPath(`/s/${slug}`)).toBe(`/s/${slug}`);
      });

      it("keeps a long slug that carries a dot outside the token charset", () => {
        /*
         * The opaque-token charset is [A-Za-z0-9_-]; a dot disqualifies the
         * whole segment even when it is well over 32 characters, so a
         * dotted asset name survives.
         */
        const dotted: string = "this-is-a-fairly-long-report-name.2024.final";

        expect(UrlScrubber.scrubPath(`/files/${dotted}`)).toBe(
          `/files/${dotted}`,
        );
      });
    });

    describe("decode fallback and structure preservation", () => {
      it("never throws and leaves a malformed percent-escape segment intact", () => {
        /*
         * decodeURIComponent("%E0%A4%A") throws; the catch falls back to
         * matching the raw segment, which matches nothing, so the segment
         * is returned exactly as given rather than crashing the mapper.
         */
        const malformed: string = "%E0%A4%A";

        let scrubbed: string = "";

        expect((): void => {
          scrubbed = UrlScrubber.scrubPath(`/x/${malformed}`);
        }).not.toThrow();

        expect(scrubbed).toBe(`/x/${malformed}`);
      });

      it("returns the raw (still-encoded) form for a non-PII encoded segment", () => {
        /*
         * A kept segment is returned in its original encoded form, not the
         * decoded one: "caf%C3%A9" decodes to "café", matches no pattern,
         * and comes back byte-for-byte as it went in.
         */
        expect(UrlScrubber.scrubPath("/menu/caf%C3%A9")).toBe(
          "/menu/caf%C3%A9",
        );
      });

      it("redacts only the identifier segments in a mixed path", () => {
        const mixed: string =
          "/org/acme/users/6512f3a9b7c4d2e108f5a3b9/orders/2/token/" +
          "aVeryLongOpaqueSessionTokenValue1234567890";

        expect(UrlScrubber.scrubPath(mixed)).toBe(
          `/org/acme/users/${REDACTED}/orders/2/token/${REDACTED}`,
        );
      });

      it("redacts every identifier segment when a path is nothing but ids", () => {
        expect(
          UrlScrubber.scrubPath(
            "/6512f3a9b7c4d2e108f5a3b9/someone@example.com/123456789",
          ),
        ).toBe(`/${REDACTED}/${REDACTED}/${REDACTED}`);
      });
    });
  });

  describe("scrubQuery", () => {
    describe("empty / missing allowlist drops everything", () => {
      it("returns an empty string when the allowlist is undefined", () => {
        const params: URLSearchParams = new URLSearchParams(
          "plan=growth&coupon=SECRET50",
        );

        expect(UrlScrubber.scrubQuery(params)).toBe("");
      });

      it("returns an empty string when the allowlist is empty", () => {
        const params: URLSearchParams = new URLSearchParams("plan=growth");

        expect(UrlScrubber.scrubQuery(params, [])).toBe("");
      });

      it("returns an empty string when no parameter matches the allowlist", () => {
        const params: URLSearchParams = new URLSearchParams(
          "coupon=SECRET50&ref=twitter",
        );

        expect(UrlScrubber.scrubQuery(params, ["plan"])).toBe("");
      });

      it("returns an empty string for a query with no parameters at all", () => {
        expect(UrlScrubber.scrubQuery(new URLSearchParams(""), ["plan"])).toBe(
          "",
        );
      });
    });

    describe("allowlisted names are kept with redacted values", () => {
      it("keeps the name and redacts the value of an allowlisted parameter", () => {
        const params: URLSearchParams = new URLSearchParams(
          "plan=growth&coupon=SECRET50",
        );

        const scrubbed: string = UrlScrubber.scrubQuery(params, ["plan"]);

        expect(scrubbed).toBe(`plan=${REDACTED}`);
        expect(scrubbed).not.toContain("growth");
        expect(scrubbed).not.toContain("SECRET50");
        expect(scrubbed).not.toContain("coupon");
      });

      it("redacts the value regardless of how sensitive it looks", () => {
        const params: URLSearchParams = new URLSearchParams();
        params.append("token", "eyJhbGciOiJIUzI1NiJ9.payload.signature");

        const scrubbed: string = UrlScrubber.scrubQuery(params, ["token"]);

        expect(scrubbed).toBe(`token=${REDACTED}`);
        expect(scrubbed).not.toContain("eyJ");
      });

      it("keeps several allowlisted parameters joined by ampersands", () => {
        const params: URLSearchParams = new URLSearchParams(
          "plan=growth&ref=twitter&step=2",
        );

        expect(UrlScrubber.scrubQuery(params, ["plan", "step"])).toBe(
          `plan=${REDACTED}&step=${REDACTED}`,
        );
      });

      it("preserves the original query order of the kept parameters", () => {
        const params: URLSearchParams = new URLSearchParams(
          "step=2&plan=growth",
        );

        expect(UrlScrubber.scrubQuery(params, ["plan", "step"])).toBe(
          `step=${REDACTED}&plan=${REDACTED}`,
        );
      });
    });

    describe("case-insensitive matching", () => {
      it("matches an allowlist entry against a differently-cased parameter name", () => {
        const params: URLSearchParams = new URLSearchParams("Plan=growth");

        /*
         * The comparison lowercases both sides, but the emitted name keeps
         * the parameter's original casing.
         */
        expect(UrlScrubber.scrubQuery(params, ["plan"])).toBe(
          `Plan=${REDACTED}`,
        );
      });

      it("matches when the allowlist entry itself is upper-cased", () => {
        const params: URLSearchParams = new URLSearchParams("plan=growth");

        expect(UrlScrubber.scrubQuery(params, ["PLAN"])).toBe(
          `plan=${REDACTED}`,
        );
      });
    });

    describe("edge cases in parameter names", () => {
      it("emits one redacted entry per repeated occurrence of a key", () => {
        /*
         * URLSearchParams keeps duplicate keys, so forEach visits each one;
         * both are kept, and because the value is redacted the two entries
         * are identical.
         */
        const params: URLSearchParams = new URLSearchParams("a=1&a=2&b=3");

        expect(UrlScrubber.scrubQuery(params, ["a"])).toBe(
          `a=${REDACTED}&a=${REDACTED}`,
        );
      });

      it("percent-encodes an allowlisted key that contains a space", () => {
        const params: URLSearchParams = new URLSearchParams();
        params.append("user name", "jane");

        expect(UrlScrubber.scrubQuery(params, ["user name"])).toBe(
          `user%20name=${REDACTED}`,
        );
      });
    });
  });
});
