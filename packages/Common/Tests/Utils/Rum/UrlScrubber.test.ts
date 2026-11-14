import UrlScrubber from "../../../Utils/Rum/UrlScrubber";

describe("UrlScrubber", () => {
  describe("scrub", () => {
    it("keeps origin and path and drops the query string", () => {
      expect(UrlScrubber.scrub("https://app.example.com/checkout?step=2")).toBe(
        "https://app.example.com/checkout",
      );
    });

    it("drops the fragment", () => {
      expect(
        UrlScrubber.scrub("https://app.example.com/settings#access-token=abc"),
      ).toBe("https://app.example.com/settings");
    });

    /*
     * #7878: a hash router keeps the whole route in the fragment. The
     * recorder kept it and the ingest's own scrub dropped it again, so a
     * hash-routed app was stored as one page per session.
     */
    describe("a hash router's route", () => {
      it("keeps the route, scrubbed as a path is, without its query", () => {
        expect(
          UrlScrubber.scrub(
            "https://x.example/#/orders/123456789012?token=abc",
          ),
        ).toBe("https://x.example/#/orders/[redacted]");
        expect(
          UrlScrubber.scrub("https://x.example/app/#/u/someone@example.com"),
        ).toBe("https://x.example/app/#/u/[redacted]");
      });

      it("keeps the hashbang form as written", () => {
        expect(UrlScrubber.scrub("https://x.example/#!/a")).toBe(
          "https://x.example/#!/a",
        );
        expect(UrlScrubber.scrub("https://x.example/#!/a/b?c=d")).toBe(
          "https://x.example/#!/a/b",
        );
      });

      it("still drops an anchor and a token in the fragment", () => {
        expect(UrlScrubber.scrub("https://x.example/pricing#pricing")).toBe(
          "https://x.example/pricing",
        );
        expect(
          UrlScrubber.scrub("https://x.example/callback#access_token=abc"),
        ).toBe("https://x.example/callback");
        expect(UrlScrubber.scrub("https://x.example/a#!b")).toBe(
          "https://x.example/a",
        );
        expect(UrlScrubber.scrub("https://x.example/a#")).toBe(
          "https://x.example/a",
        );
      });

      it("puts the route after a kept query and in a relative URL", () => {
        expect(
          UrlScrubber.scrub("https://x.example/?plan=pro#/pricing?x=1", [
            "plan",
          ]),
        ).toBe("https://x.example/?plan=[redacted]#/pricing");
        expect(UrlScrubber.scrub("/app?x=1#/orders/42")).toBe(
          "/app#/orders/42",
        );
      });

      /*
       * The ingest scrubs what the recorder already scrubbed: running it
       * again must keep the route it kept, or the server undoes it.
       */
      it("keeps what it keeps when it runs over its own output", () => {
        for (const url of [
          "https://x.example/#/orders/123456789012?token=abc",
          "https://x.example/#!/u/someone@example.com/edit",
          "https://x.example/app/#/caf%C3%A9",
          "https://x.example/#/",
        ]) {
          const once: string = UrlScrubber.scrub(url);

          expect(once).toContain("#");
          expect(UrlScrubber.scrub(once)).toBe(once);
        }
      });

      it("reads a route's path without its query, and nothing else as a route", () => {
        expect(UrlScrubber.getHashRoute("#/orders/42?tab=open")).toBe(
          "/orders/42",
        );
        expect(UrlScrubber.getHashRoute("#!/orders")).toBe("/orders");
        expect(UrlScrubber.getHashRoute("#/")).toBe("/");
        expect(UrlScrubber.getHashRoute("#pricing")).toBeNull();
        expect(UrlScrubber.getHashRoute("#!pricing")).toBeNull();
        expect(UrlScrubber.getHashRoute("")).toBeNull();
        expect(UrlScrubber.scrubHashRoute("#pricing")).toBe("");
        expect(UrlScrubber.scrubHashRoute("#!/a/123456789012?b=c")).toBe(
          "#!/a/[redacted]",
        );
      });
    });

    /*
     * #7877: the URL parser keeps an escape as written, so one page reached
     * as "/caf%c3%a9" (lower-case hex) or "/cafe%CC%81" (its accent
     * decomposed) was stored apart from "/caf%C3%A9", and User Flows drew
     * two or three rows, each named "/café". The scrubber stores one
     * spelling.
     */
    describe("one spelling for a path", () => {
      const COMBINING_ACUTE: string = String.fromCharCode(0x301);
      const COMBINING_DOT_ABOVE: string = String.fromCharCode(0x307);

      it("writes escapes in upper-case hex and accents composed", () => {
        for (const url of [
          "https://x.example/caf%C3%A9",
          "https://x.example/caf%c3%a9",
          "https://x.example/cafe%CC%81",
          "https://x.example/cafe%cc%81",
          `https://x.example/cafe${COMBINING_ACUTE}`,
          "https://x.example/café",
        ]) {
          expect(UrlScrubber.scrub(url)).toBe("https://x.example/caf%C3%A9");
        }

        // In every segment, in a hash router's route and in a relative URL.
        expect(
          UrlScrubber.scrub("https://x.example/caf%c3%a9/men%c3%bc?x=1"),
        ).toBe("https://x.example/caf%C3%A9/men%C3%BC");
        expect(UrlScrubber.scrub("https://x.example/#/cafe%CC%81")).toBe(
          "https://x.example/#/caf%C3%A9",
        );
        expect(UrlScrubber.scrub("/caf%c3%a9")).toBe("/caf%C3%A9");

        // A sign or an emoji too, and a sign and its overlay compose ("∄").
        expect(UrlScrubber.normalizePathSpelling("/a%e2%88%95b")).toBe(
          "/a%E2%88%95b",
        );
        expect(UrlScrubber.normalizePathSpelling("/%f0%9f%98%80")).toBe(
          "/%F0%9F%98%80",
        );
        expect(UrlScrubber.normalizePathSpelling("/a%E2%88%83%CC%B8")).toBe(
          "/a%E2%88%84",
        );
      });

      it("keeps what can name another page as written, in upper-case hex", () => {
        // An escaped "/" is not a separator: "/a%2Fb" is not "/a/b".
        expect(UrlScrubber.scrub("https://x.example/a%2fb")).toBe(
          "https://x.example/a%2Fb",
        );
        expect(UrlScrubber.scrub("https://x.example/a/b")).toBe(
          "https://x.example/a/b",
        );
        // Case outside an escape is the page's own.
        expect(UrlScrubber.scrub("https://x.example/Cart")).toBe(
          "https://x.example/Cart",
        );

        for (const path of [
          // A separator, a query, a fragment, an escape.
          "/a%2Fb",
          "/a%3Fb",
          "/a%23b",
          "/100%25",
          // Any other ASCII character.
          "/%41",
          "/a%20b",
          // The three characters NFC would make ";", "`" and "K".
          "/a%CD%BEb",
          "/a%E1%BF%AFb",
          "/%E2%84%AA",
          // Not UTF-8: a lone "%", cut short, written too long, a surrogate.
          "/100%",
          "/%E0%A4",
          "/%C0%AF",
          "/%ED%A0%80",
        ]) {
          expect(UrlScrubber.normalizePathSpelling(path)).toBe(path);
          expect(UrlScrubber.normalizePathSpelling(path.toLowerCase())).toBe(
            path,
          );
        }
      });

      it("never composes an accent with an escape kept as written", () => {
        // "F" and U+0307 compose to U+1E1E, which would break the "%2F".
        expect(UrlScrubber.normalizePathSpelling("/%2F%CC%87")).toBe(
          "/%2F%CC%87",
        );
        expect(
          UrlScrubber.normalizePathSpelling(`/%2f${COMBINING_DOT_ABOVE}`),
        ).toBe("/%2F%CC%87");
        // An "N" written escaped keeps its tilde apart; one written plainly takes it.
        expect(UrlScrubber.normalizePathSpelling("/%4E%CC%83")).toBe(
          "/%4E%CC%83",
        );
        expect(UrlScrubber.normalizePathSpelling("/N%CC%83")).toBe("/%C3%91");
      });

      it("writes what the URL parser writes, and changes nothing when run again", () => {
        // Hangul written as its letters' parts is one syllable.
        expect(
          UrlScrubber.normalizePathSpelling("/%E1%84%92%E1%85%A1%E1%86%AB"),
        ).toBe("/%ED%95%9C");

        for (const path of [
          "/caf%c3%a9",
          "/cafe%CC%81/men%c3%bc",
          `/cafe${COMBINING_ACUTE}`,
          "/a%2fb%cc%81",
          "/%E1%84%92%E1%85%A1%E1%86%AB",
          "/%d8%a7%d9%84%d8%b3%d9%84%d8%a9",
          "/a=%CC%B8",
          "/a%e2%88%83%cc%b8",
          "/%e2%84%aa",
          "/x%e0%a4/caf%C3%A9",
        ]) {
          const once: string = UrlScrubber.normalizePathSpelling(path);

          expect([path, UrlScrubber.normalizePathSpelling(once)]).toEqual([
            path,
            once,
          ]);
          expect([path, new URL(once, "https://x.example").pathname]).toEqual([
            path,
            once,
          ]);
        }
      });

      it("leaves a path with nothing to settle as it is", () => {
        expect(UrlScrubber.normalizePathSpelling("/orders/42")).toBe(
          "/orders/42",
        );
        expect(UrlScrubber.normalizePathSpelling("/")).toBe("/");
        expect(UrlScrubber.normalizePathSpelling("")).toBe("");
      });
    });

    it("redacts a password reset token carried in the query string", () => {
      /*
       * The motivating case: this URL in a session list would hand a
       * live account-takeover token to anyone who can read the list.
       */
      const scrubbed: string = UrlScrubber.scrub(
        "https://app.example.com/reset-password?token=eyJhbGciOiJIUzI1NiJ9.abc.def",
      );

      expect(scrubbed).toBe("https://app.example.com/reset-password");
      expect(scrubbed).not.toContain("eyJ");
    });

    it("redacts an email address in the query string", () => {
      const scrubbed: string = UrlScrubber.scrub(
        "https://app.example.com/invite?email=someone@example.com",
      );

      expect(scrubbed).not.toContain("someone@example.com");
      expect(scrubbed).not.toContain("%40");
    });

    it("redacts a uuid path segment but keeps the route shape", () => {
      expect(
        UrlScrubber.scrub(
          "https://app.example.com/orders/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f/items",
        ),
      ).toBe("https://app.example.com/orders/[redacted]/items");
    });

    it("redacts a 24-character object id path segment", () => {
      expect(
        UrlScrubber.scrub(
          "https://app.example.com/users/6512f3a9b7c4d2e108f5a3b9",
        ),
      ).toBe("https://app.example.com/users/[redacted]");
    });

    it("redacts an email in a path segment, percent-encoded or not", () => {
      expect(
        UrlScrubber.scrub(
          "https://app.example.com/u/someone@example.com/profile",
        ),
      ).toBe("https://app.example.com/u/[redacted]/profile");

      expect(
        UrlScrubber.scrub("https://app.example.com/u/someone%40example.com"),
      ).toBe("https://app.example.com/u/[redacted]");
    });

    it("redacts long digit runs that could be a card or phone number", () => {
      expect(
        UrlScrubber.scrub("https://app.example.com/account/4111111111111111"),
      ).toBe("https://app.example.com/account/[redacted]");
    });

    it("keeps short numeric ids, which are route structure rather than PII", () => {
      expect(UrlScrubber.scrub("https://app.example.com/page/2")).toBe(
        "https://app.example.com/page/2",
      );
    });

    it("redacts long opaque tokens but keeps ordinary slugs", () => {
      expect(
        UrlScrubber.scrub(
          "https://app.example.com/s/aVeryLongOpaqueSessionTokenValue1234567890",
        ),
      ).toBe("https://app.example.com/s/[redacted]");

      expect(
        UrlScrubber.scrub(
          "https://app.example.com/blog/how-we-scaled-clickhouse",
        ),
      ).toBe("https://app.example.com/blog/how-we-scaled-clickhouse");
    });

    it("keeps an allowlisted parameter name but redacts its value", () => {
      const scrubbed: string = UrlScrubber.scrub(
        "https://app.example.com/pricing?plan=growth&coupon=SECRET50",
        ["plan"],
      );

      expect(scrubbed).toBe("https://app.example.com/pricing?plan=[redacted]");
      expect(scrubbed).not.toContain("growth");
      expect(scrubbed).not.toContain("SECRET50");
    });

    it("matches allowlisted parameter names case-insensitively", () => {
      expect(
        UrlScrubber.scrub("https://app.example.com/x?Plan=growth", ["plan"]),
      ).toBe("https://app.example.com/x?Plan=[redacted]");
    });

    it("preserves relative URLs as relative", () => {
      expect(UrlScrubber.scrub("/checkout/step-2?coupon=abc")).toBe(
        "/checkout/step-2",
      );
    });

    it("returns an empty string for empty input", () => {
      expect(UrlScrubber.scrub("")).toBe("");
    });

    it("fails closed on an unparseable URL rather than passing it through", () => {
      /*
       * The important property is that nothing unscrubbed escapes. A URL
       * we cannot parse is a URL we cannot prove is safe.
       */
      const scrubbed: string = UrlScrubber.scrub("ht!tp:// not a url ??");

      expect(scrubbed).not.toContain("not a url");
    });

    it("never throws for hostile input", () => {
      const inputs: Array<string> = [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "//",
        "?",
        "#",
        "https://",
        "%%%%",
        "/%E0%A4%A",
      ];

      for (const input of inputs) {
        expect((): string => {
          return UrlScrubber.scrub(input);
        }).not.toThrow();
      }
    });
  });

  describe("getScrubbedPathname", () => {
    it("returns just the scrubbed path", () => {
      expect(
        UrlScrubber.getScrubbedPathname(
          "https://app.example.com/orders/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f?x=1",
        ),
      ).toBe("/orders/[redacted]");
    });

    it("is stable across reloads of the same page with different queries", () => {
      /*
       * Refresh-rage detection compares pathnames across reloads, so a
       * changing query string must not make two reloads of the same page
       * look like two different pages.
       */
      const first: string = UrlScrubber.getScrubbedPathname(
        "https://app.example.com/checkout?attempt=1",
      );
      const second: string = UrlScrubber.getScrubbedPathname(
        "https://app.example.com/checkout?attempt=2",
      );

      expect(first).toBe(second);
    });
  });
});
