import SafeHtml from "../../Types/SafeHtml";
import { describe, expect, test } from "@jest/globals";

/*
 * SafeHtml marks a value that is already HTML. Everything else that meets an
 * email body is plain text and is escaped, so these tests pin both halves:
 * the escaping itself, and that only a real SafeHtml is recognised as HTML.
 */

describe("SafeHtml.escape", () => {
  test("escapes the five characters that break out of HTML text or attributes", () => {
    expect(SafeHtml.escape(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  test("escapes the ampersand first, so the other entities are not escaped twice", () => {
    expect(SafeHtml.escape("<")).toBe("&lt;");
    expect(SafeHtml.escape("&lt;")).toBe("&amp;lt;");
  });

  test("leaves ordinary text alone, including non-Latin text and emoji", () => {
    for (const text of [
      "Checkout API is degraded",
      "Zahlungen fallen aus – Region Süd",
      "決済が失敗しています",
      "🚨 Outage",
      "",
    ]) {
      expect(SafeHtml.escape(text)).toBe(text);
    }
  });

  test("a script tag reads as text", () => {
    expect(SafeHtml.escape("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });
});

describe("SafeHtml values", () => {
  test("fromTrustedHtml keeps the markup as it is", () => {
    const html: SafeHtml = SafeHtml.fromTrustedHtml(
      "<p>Failover <strong>done</strong></p>",
    );

    expect(html.toHtml()).toBe("<p>Failover <strong>done</strong></p>");
    expect(html.toString()).toBe("<p>Failover <strong>done</strong></p>");
    expect(`${html}`).toBe("<p>Failover <strong>done</strong></p>");
  });

  test("fromPlainText escapes", () => {
    expect(SafeHtml.fromPlainText(`Tom & "Jerry" <b>`).toHtml()).toBe(
      "Tom &amp; &quot;Jerry&quot; &lt;b&gt;",
    );
  });

  test("a missing value is empty, never the text 'undefined' or 'null'", () => {
    expect(SafeHtml.fromTrustedHtml(undefined).toHtml()).toBe("");
    expect(SafeHtml.fromTrustedHtml(null).toHtml()).toBe("");
    expect(SafeHtml.fromPlainText(undefined).toHtml()).toBe("");
    expect(SafeHtml.fromPlainText(null).toHtml()).toBe("");
  });

  test("isSafeHtml recognises only SafeHtml values", () => {
    expect(SafeHtml.isSafeHtml(SafeHtml.fromTrustedHtml("<b>x</b>"))).toBe(
      true,
    );
    expect(SafeHtml.isSafeHtml(SafeHtml.fromPlainText("x"))).toBe(true);

    for (const value of [
      "<b>x</b>",
      "",
      undefined,
      null,
      0,
      {},
      { html: "<b>x</b>" },
      {
        toHtml: (): string => {
          return "<b>x</b>";
        },
      },
      ["<b>x</b>"],
    ]) {
      expect(SafeHtml.isSafeHtml(value)).toBe(false);
    }
  });

  /*
   * An object that went through JSON (a job payload, a queue) is no longer a
   * SafeHtml, and must not be mistaken for one: it would be escaped, or
   * dropped, but never inserted as HTML.
   */
  test("a value that went through JSON is not HTML any more", () => {
    const roundTripped: unknown = JSON.parse(
      JSON.stringify(SafeHtml.fromTrustedHtml("<b>x</b>")),
    );

    expect(SafeHtml.isSafeHtml(roundTripped)).toBe(false);
  });
});
