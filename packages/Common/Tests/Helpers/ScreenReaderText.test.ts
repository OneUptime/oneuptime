import { describe, expect, test } from "@jest/globals";
import {
  screenReaderPieces,
  screenReaderText,
  timesSaid,
} from "./ScreenReaderText";

/*
 * The test helper that reads markup as a screen reader says it: the email
 * header tests (App EmailBrandingTemplates) hold the product's name to being
 * said once with it, so it must hide what aria-hidden hides, and only that.
 */
describe("ScreenReaderText", () => {
  test("says the text and the images' alt text, in order", () => {
    expect(
      screenReaderPieces(
        '<p>Before</p><img src="a.png" alt="A logo"><td>After</td>',
      ),
    ).toEqual(["Before", "A logo", "After"]);
  });

  test("aria-hidden hides an element and everything inside it", () => {
    const html: string =
      '<table><tr><td><img alt="OneUptime"></td><td aria-hidden="true">OneUptime <b>twice</b><img alt="x"></td><td>Next</td></tr></table>';

    expect(screenReaderPieces(html)).toEqual(["OneUptime", "Next"]);
    expect(timesSaid(html, "OneUptime")).toBe(1);
  });

  test('aria-hidden="false", or any other value, hides nothing', () => {
    expect(
      screenReaderPieces('<span aria-hidden="false">Shown</span>'),
    ).toEqual(["Shown"]);
    expect(screenReaderPieces("<span aria-hidden>Shown</span>")).toEqual([
      "Shown",
    ]);
    expect(
      screenReaderPieces('<span aria-hidden=" TRUE ">Hidden</span>'),
    ).toEqual([]);
  });

  test("an image with an empty alt, or none, or a presentational role is passed over", () => {
    expect(
      screenReaderPieces(
        '<img alt=""><img src="x.png"><img alt="Decoration" role="presentation"><img alt="None" role="none"><img alt="Said">',
      ),
    ).toEqual(["Said"]);
  });

  test("comments, Outlook's conditional ones, the head, styles and scripts say nothing", () => {
    expect(
      screenReaderPieces(
        "<!DOCTYPE html><html><head><title>Title</title><style>p { color: red; }</style></head><body><!-- note --><!--[if mso]><p>Outlook</p><![endif]--><script>var a = '<b>';</script><p>Body</p></body></html>",
      ),
    ).toEqual(["Body"]);
  });

  test("references are decoded once and whitespace is one space", () => {
    expect(
      screenReaderPieces("<p>  Acme &amp;amp;\n\n Co &lt;b&gt;  </p>"),
    ).toEqual(["Acme &amp; Co <b>"]);
  });

  test("an element that ends hides only what was inside it", () => {
    expect(
      screenReaderPieces(
        '<div aria-hidden="true"><p>Hidden<br><img alt="x"></p></div><p>Shown</p>',
      ),
    ).toEqual(["Shown"]);
    // A self-closing tag opens nothing.
    expect(
      screenReaderPieces('<span aria-hidden="true"/>Shown<span>Too</span>'),
    ).toEqual(["Shown", "Too"]);
  });

  test("an end tag closes every element left open inside it", () => {
    expect(
      screenReaderPieces(
        '<td aria-hidden="true"><span>Hidden<b>still</td><td>Shown</td>',
      ),
    ).toEqual(["Shown"]);
  });

  test("screenReaderText joins the pieces with a space; timesSaid counts every time", () => {
    const html: string = "<p>OneUptime and OneUptime</p><p>OneUptime</p>";

    expect(screenReaderText(html)).toBe("OneUptime and OneUptime OneUptime");
    expect(timesSaid(html, "OneUptime")).toBe(3);
    expect(timesSaid(html, "Acme")).toBe(0);
  });
});
