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
        UrlScrubber.scrub("https://app.example.com/users/6512f3a9b7c4d2e108f5a3b9"),
      ).toBe("https://app.example.com/users/[redacted]");
    });

    it("redacts an email in a path segment, percent-encoded or not", () => {
      expect(
        UrlScrubber.scrub("https://app.example.com/u/someone@example.com/profile"),
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
        UrlScrubber.scrub("https://app.example.com/blog/how-we-scaled-clickhouse"),
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
