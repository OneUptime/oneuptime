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

    /*
     * #8384: the React Native recorder names every screen
     * "app://<app id>/<route>". URL.origin is the string "null" for a scheme
     * the URL standard gives no origin, and the result was built from it, so
     * the ingest stored every mobile page as "null/<route>": the app lost,
     * and User Flows drew each screen as "/null/...".
     */
    describe("a scheme with no origin", () => {
      it("keeps a mobile app's scheme and app id, and scrubs its route", () => {
        expect(
          UrlScrubber.scrub("app://com.example.shop/Checkout/42", []),
        ).toBe("app://com.example.shop/Checkout/42");
        expect(
          UrlScrubber.scrub(
            "app://com.example.shop/u/someone@example.com/orders/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f?token=abc#x",
            [],
          ),
        ).toBe("app://com.example.shop/u/[redacted]/orders/[redacted]");
        expect(UrlScrubber.scrub("app://com.example.shop", [])).toBe(
          "app://com.example.shop/",
        );
        expect(
          UrlScrubber.scrub("chrome-extension://abcdefghij/popup.html"),
        ).toBe("chrome-extension://abcdefghij/popup.html");
      });

      it("never writes the origin's 'null' into what it keeps", () => {
        for (const url of [
          "app://com.example.shop/Checkout/42",
          "app://com.example.shop",
          "myapp:/Checkout",
          "file:///index.html",
          "data:text/plain,hello",
          "mailto:someone@example.com",
          "about:blank",
          "javascript:alert(1)",
        ]) {
          const scrubbed: string = UrlScrubber.scrub(url, []);

          expect([url, scrubbed.startsWith("null")]).toEqual([url, false]);
          expect([
            url,
            UrlScrubber.getScrubbedPage(url).includes("null"),
          ]).toEqual([url, false]);
        }
      });

      it("drops a user name and password, as an origin does, and keeps a port", () => {
        expect(
          UrlScrubber.scrub("app://user:secret@com.example.shop/Checkout", []),
        ).toBe("app://com.example.shop/Checkout");
        expect(
          UrlScrubber.scrub("app://com.example.shop:8081/Checkout", []),
        ).toBe("app://com.example.shop:8081/Checkout");
      });

      it("keeps the app id as written, and tells two apps apart", () => {
        const first: string = UrlScrubber.scrub(
          "app://com.example.shop/Home",
          [],
        );
        const second: string = UrlScrubber.scrub(
          "app://com.example.admin/Home",
          [],
        );

        expect(first).toBe("app://com.example.shop/Home");
        expect(second).toBe("app://com.example.admin/Home");
        expect(UrlScrubber.scrub("app://Com.Example.Shop/Home", [])).toBe(
          "app://Com.Example.Shop/Home",
        );
      });

      it("keeps a path from the root with the scheme alone when there is no host", () => {
        expect(UrlScrubber.scrub("myapp:/Checkout/42", [])).toBe(
          "myapp:/Checkout/42",
        );
        expect(UrlScrubber.scrub("file:///Users/me/index.html", [])).toBe(
          "file:/Users/me/index.html",
        );
      });

      /*
       * An address with no path from the root is no page, and can be
       * content: a data: URL is its own body. Nothing of it is kept but its
       * scheme.
       */
      it("redacts what an address with no path from the root holds", () => {
        expect(
          UrlScrubber.scrub("data:text/plain,someone@example.com", []),
        ).toBe("data:[redacted]");
        expect(
          UrlScrubber.scrub(
            "data:application/json;base64,eyJlbWFpbCI6InNvbWVvbmVAZXhhbXBsZS5jb20ifQ==",
            [],
          ),
        ).toBe("data:[redacted]");
        expect(UrlScrubber.scrub("mailto:someone@example.com", [])).toBe(
          "mailto:[redacted]",
        );
        expect(UrlScrubber.scrub("about:blank", [])).toBe("about:[redacted]");
      });

      it("keeps what it keeps when it runs over its own output", () => {
        for (const url of [
          "app://com.example.shop/Checkout/42?x=1",
          "app://user:secret@com.example.shop:8081/u/someone@example.com",
          "app://com.example.shop",
          "myapp:/Checkout",
          "file:///Users/me/index.html",
          "data:text/plain,hello",
          "mailto:someone@example.com",
        ]) {
          const once: string = UrlScrubber.scrub(url, []);

          expect([url, UrlScrubber.scrub(once, [])]).toEqual([url, once]);
        }
      });

      it("names a mobile screen's page by its route", () => {
        expect(
          UrlScrubber.getScrubbedPage("app://com.example.shop/Checkout/42"),
        ).toBe("/Checkout/42");
        expect(
          UrlScrubber.getScrubbedPage(
            "app://com.example.shop/u/someone@example.com",
          ),
        ).toBe("/u/[redacted]");
      });

      it("leaves an address with an origin as it was", () => {
        expect(
          UrlScrubber.scrub("https://user:secret@shop.example.com:443/a", []),
        ).toBe("https://shop.example.com/a");
        expect(UrlScrubber.scrub("http://shop.example.com:8080/a", [])).toBe(
          "http://shop.example.com:8080/a",
        );
        expect(
          UrlScrubber.scrub(
            "blob:https://shop.example.com/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
            [],
          ),
        ).not.toContain("3f1a9c7e");
      });
    });

    /*
     * #8385: the token rule's characters hold no dot, so a JSON Web Token -
     * three base64url parts joined by dots - was kept whole, and an address
     * an application escaped twice read, decoded once, as no address.
     */
    describe("secrets the path rule used to keep", () => {
      const JWT: string =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

      it("redacts a JSON Web Token in a path, and in a hash router's route", () => {
        expect(
          UrlScrubber.scrub(`https://shop.example.com/auth/callback/${JWT}`),
        ).toBe("https://shop.example.com/auth/callback/[redacted]");
        expect(
          UrlScrubber.scrub(`https://shop.example.com/#/verify/${JWT}?next=1`),
        ).toBe("https://shop.example.com/#/verify/[redacted]");
        expect(
          UrlScrubber.scrub(`app://com.example.shop/session/${JWT}`, []),
        ).toBe("app://com.example.shop/session/[redacted]");
      });

      it("redacts an email an application escaped twice", () => {
        expect(
          UrlScrubber.scrub(
            "https://shop.example.com/users/someone%2540example.com/orders",
          ),
        ).toBe("https://shop.example.com/users/[redacted]/orders");
        expect(
          UrlScrubber.getScrubbedPage(
            "https://shop.example.com/#!/u/someone%2540example.com",
          ),
        ).toBe("/#!/u/[redacted]");
      });

      it("keeps a file name, a version and a word that only look dotted", () => {
        for (const url of [
          "https://shop.example.com/files/report-2026-11-15.pdf",
          "https://shop.example.com/docs/v14.2.0/notes.html",
          "https://shop.example.com/eyJ/eyJsb2.png",
          "https://shop.example.com/sale/50%2525-off",
        ]) {
          expect(UrlScrubber.scrub(url)).toBe(url);
        }
      });
    });
  });

  /*
   * #8195: the spelling a page pattern is compared in. A person writes the
   * page as the address bar shows it ("/café"), and the browser's path
   * escapes it ("/caf%C3%A9", or "/caf%c3%a9", "/cafe%CC%81" from a link).
   */
  describe("normalizePathSpelling, as read", () => {
    it("decodes the words, in every spelling, and composes them", () => {
      for (const path of [
        "/caf%C3%A9",
        "/caf%c3%a9",
        "/cafe%CC%81",
        "/cafe%cc%81",
        "/café",
        `/cafe${String.fromCharCode(0x301)}`,
      ]) {
        expect([path, UrlScrubber.normalizePathSpelling(path, true)]).toEqual([
          path,
          "/café",
        ]);
      }

      expect(
        UrlScrubber.normalizePathSpelling(
          "/%D8%A7%D9%84%D8%B3%D9%84%D8%A9/men%c3%bc",
          true,
        ),
      ).toBe("/السلة/menü");
    });

    it("keeps every other escape an escape, in upper-case hex", () => {
      expect(UrlScrubber.normalizePathSpelling("/a%2fb", true)).toBe("/a%2Fb");
      expect(UrlScrubber.normalizePathSpelling("/100%25/x%20y", true)).toBe(
        "/100%25/x%20y",
      );
      // Bytes that are not UTF-8, and a character NFC writes in ASCII.
      expect(UrlScrubber.normalizePathSpelling("/%e9t%e9", true)).toBe(
        "/%E9t%E9",
      );
      expect(UrlScrubber.normalizePathSpelling("/%e2%84%aa", true)).toBe(
        "/%E2%84%AA",
      );
    });

    it("leaves a path with nothing to settle as it is, and is stable", () => {
      expect(UrlScrubber.normalizePathSpelling("/Cart/42", true)).toBe(
        "/Cart/42",
      );

      for (const path of ["/caf%c3%a9/a%2fb", "/cafe%CC%81", "/%e9"]) {
        const once: string = UrlScrubber.normalizePathSpelling(path, true);

        expect(UrlScrubber.normalizePathSpelling(once, true)).toBe(once);
      }
    });

    it("does not change the spelling the scrubber stores", () => {
      expect(UrlScrubber.normalizePathSpelling("/caf%c3%a9")).toBe(
        "/caf%C3%A9",
      );
      expect(UrlScrubber.normalizePathSpelling("/café")).toBe("/caf%C3%A9");
    });
  });

  describe("getScrubbedPage", () => {
    it("returns just the scrubbed path", () => {
      expect(
        UrlScrubber.getScrubbedPage(
          "https://app.example.com/orders/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f?x=1",
        ),
      ).toBe("/orders/[redacted]");
    });

    it("is stable across reloads of the same page with different queries", () => {
      /*
       * Refresh-rage detection compares pages across reloads, so a
       * changing query string must not make two reloads of the same page
       * look like two different pages.
       */
      const first: string = UrlScrubber.getScrubbedPage(
        "https://app.example.com/checkout?attempt=1",
      );
      const second: string = UrlScrubber.getScrubbedPage(
        "https://app.example.com/checkout?attempt=2",
      );

      expect(first).toBe(second);
    });

    /*
     * #8015: every route of a hash-routed app has the path "/", so the path
     * alone made loads of #/a and #/b one page: the refresh-rage log
     * counted them as reloads, and the support bundle lost the route.
     */
    describe("a hash router's route", () => {
      it("is part of the page, scrubbed as scrub keeps it", () => {
        expect(
          UrlScrubber.getScrubbedPage(
            "https://shop.example.com/#/orders/123456789012?token=abc",
          ),
        ).toBe("/#/orders/[redacted]");
        expect(
          UrlScrubber.getScrubbedPage(
            "https://shop.example.com/app/#!/u/someone@example.com",
          ),
        ).toBe("/app/#!/u/[redacted]");
        expect(UrlScrubber.getScrubbedPage("https://shop.example.com/#/")).toBe(
          "/#/",
        );
      });

      it("tells one route from another, and a route from the page's own path", () => {
        const pages: Array<string> = [
          "https://shop.example.com/#/a",
          "https://shop.example.com/#/b",
          "https://shop.example.com/#!/a",
          "https://shop.example.com/a",
          "https://shop.example.com/",
        ].map((url: string): string => {
          return UrlScrubber.getScrubbedPage(url);
        });

        expect(pages).toEqual(["/#/a", "/#/b", "/#!/a", "/a", "/"]);
      });

      it("is one page whatever the route's query or the origin", () => {
        for (const url of [
          "https://shop.example.com/#/a?attempt=1",
          "https://shop.example.com/#/a?attempt=2",
          "https://shop.example.com/?x=1#/a",
          "https://other.example.com/#/a",
          "/#/a",
        ]) {
          expect([url, UrlScrubber.getScrubbedPage(url)]).toEqual([
            url,
            "/#/a",
          ]);
        }
      });

      it("drops a fragment that is not a route, as scrub does", () => {
        for (const url of [
          "https://shop.example.com/pricing#plans",
          "https://shop.example.com/pricing#faq",
          "https://shop.example.com/pricing#!plans",
          "https://shop.example.com/pricing#access_token=abc",
          "https://shop.example.com/pricing#",
        ]) {
          expect([url, UrlScrubber.getScrubbedPage(url)]).toEqual([
            url,
            "/pricing",
          ]);
        }
      });

      it("writes the route in its one spelling", () => {
        for (const url of [
          "https://shop.example.com/#/caf%C3%A9",
          "https://shop.example.com/#/caf%c3%a9",
          "https://shop.example.com/#/cafe%CC%81",
        ]) {
          expect([url, UrlScrubber.getScrubbedPage(url)]).toEqual([
            url,
            "/#/caf%C3%A9",
          ]);
        }
      });

      it("reads its own output as the same page", () => {
        for (const url of [
          "https://shop.example.com/#/orders/123456789012?token=abc",
          "https://shop.example.com/app/#!/caf%c3%a9",
          "https://shop.example.com/pricing#plans",
        ]) {
          const page: string = UrlScrubber.getScrubbedPage(url);

          expect(UrlScrubber.getScrubbedPage(page)).toBe(page);
        }
      });
    });

    it("fails closed on what it cannot read", () => {
      expect(UrlScrubber.getScrubbedPage("")).toBe("[redacted]");
      expect(UrlScrubber.getScrubbedPage("http://[::1")).toBe("[redacted]");
    });
  });
});
