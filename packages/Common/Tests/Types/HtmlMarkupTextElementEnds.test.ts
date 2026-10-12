import removeHtmlMarkup, {
  HtmlMarkupReading,
  HtmlMarkupReplacer,
  replaceHtmlMarkup,
} from "../../Types/HtmlMarkup";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { describe, expect, it } from "@jest/globals";

/*
 * Read with rawTextElements, a title, a textarea or an xmp holds text: what
 * is between its start tag and its end tag is read on its own, so nothing
 * in it - a "<script", a comment - runs past the end tag. Read as a browser
 * reads "<" (lessThanAsText), a "<" at the end of a text is text, and is
 * kept. So a "<" that ended an element's text was kept, the end tag was
 * taken out after it, and the "<" met whatever followed the end tag:
 * "<title>x<</title>b" read "x<b" - a "<" that starts markup, in text the
 * walk promises holds none. Without rawTextElements the same text reads
 * "xb": a run of "<" before markup goes.
 *
 * Now a run of "<" that ends an element's text goes, as a run before any
 * markup does. The Dynamics 365 templates read notes and case descriptions
 * with this reading, through their own copy of the walk (DynamicsNoteMarkup
 * and DynamicsCaseDescription hold the copy to this). These tests:
 *
 *   - pin what title, textarea and xmp text ending in "<" reads as now, and
 *     that a "<" anywhere else in it stays;
 *   - check that an element's text with no markup in it reads as it does
 *     without rawTextElements;
 *   - check that no reading leaves a "<" that starts markup, whatever it is
 *     given, and that the default reading of "<" is unchanged;
 *   - read long texts in time that grows with their length alone.
 */

const AS_A_BROWSER: HtmlMarkupReading = {
  lessThanAsText: true,
  rawTextElements: true,
};
const LESS_THAN_AS_TEXT: HtmlMarkupReading = { lessThanAsText: true };
const WHOLE: HtmlMarkupReading = { rawTextElements: true };

const NOTHING: HtmlMarkupReplacer = (): string => {
  return "";
};

// A "<" that starts markup, as a browser reads one.
const MARKUP_START: RegExp = /<[A-Za-z/!?]/;
// A run of "<" right before a text element's end tag.
const RUN_BEFORE_END_TAG: RegExp = /<<\/(?:title|textarea|xmp)/i;

function asABrowser(html: string): string {
  return replaceHtmlMarkup(html, NOTHING, AS_A_BROWSER);
}

describe("a title, textarea or xmp whose text ends in '<', read as a browser reads '<'", () => {
  it.each([
    ["a title", "<title>x<</title>b", "xb"],
    ["a run of '<'", "<textarea>a<<<</textarea>b", "ab"],
    ["only '<'", "<xmp><</xmp>c", "c"],
    ["upper-case names", "<TITLE>x<</TITLE>Body", "xBody"],
    ["an end tag with a space", "<title>x<</title >b", "xb"],
    ["a space after the end tag", "<title>x<</title> b", "x b"],
    ["after a tag that never ends", '<title><a b="<</title>c', 'a b="c'],
  ])(
    "%s: the run of '<' goes before the end tag",
    (_case: string, html: string, text: string) => {
      expect(asABrowser(html)).toBe(text);
      expect(asABrowser(html)).not.toMatch(MARKUP_START);
    },
  );

  it.each([
    ["before a space", "<title>x< </title>b", "x< b"],
    ["inside the text", "<title>a < b</title>c", "a < bc"],
    ["before a digit", "<textarea>p99<3s</textarea> ok", "p99<3s ok"],
  ])("a '<' %s stays, as text", (_case: string, html: string, text: string) => {
    expect(asABrowser(html)).toBe(text);
  });

  it("gives the replacer the start tag and the end tag, and nothing for the '<' that goes", () => {
    const seen: Array<string> = [];

    expect(
      replaceHtmlMarkup(
        "<title>x<<</title>b",
        (markup: string): string => {
          seen.push(markup);
          return "|";
        },
        AS_A_BROWSER,
      ),
    ).toBe("|x|b");
    expect(seen).toEqual(["<title>", "</title>"]);
  });

  it("changes nothing with the default reading of '<', which keeps no '<' at all", () => {
    expect(replaceHtmlMarkup("<title>x<</title>b", NOTHING, WHOLE)).toBe("xb");
    expect(removeHtmlMarkup("<title>x<</title>b")).toBe("xb");
  });
});

describe("an element's text with no markup in it", () => {
  /*
   * Elements whose text is numbers, words of other scripts, spaces and "<"
   * that start nothing - no "<" before an ASCII letter, which would start a
   * tag that a reading without rawTextElements runs past the end tag. Each
   * reads as it does without the option.
   */
  const ELEMENTS: Array<string> = ["title", "textarea", "xmp", "TITLE"];
  const BEFORE: Array<string> = ["", "<p>one</p>", "a<", "x "];
  const AFTER: Array<string> = ["", "b", " b", "<p>b</p>", "<br>c", "1"];
  const contents: Array<string> = generatedTexts(1200, 9973, [
    "1",
    " ",
    "<",
    "<<",
    ">",
    "é",
    "語",
    "-",
  ]);
  const texts: Array<string> = contents.map(
    (content: string, index: number): string => {
      const element: string = ELEMENTS[index % ELEMENTS.length]!;

      return `${BEFORE[index % BEFORE.length]}<${element}>${content}</${element}>${AFTER[index % AFTER.length]}`;
    },
  );

  it("reads as the reading without rawTextElements does", () => {
    expect(
      texts.filter((html: string): boolean => {
        return (
          asABrowser(html) !==
          replaceHtmlMarkup(html, NOTHING, LESS_THAN_AS_TEXT)
        );
      }),
    ).toEqual([]);
  });

  it("is held to many different texts, many ending in '<'", () => {
    expect(new Set(texts).size).toBeGreaterThan(1000);
    expect(
      contents.filter((content: string): boolean => {
        return content.endsWith("<");
      }).length,
    ).toBeGreaterThan(200);
  });
});

describe("whatever it is given", () => {
  // What elements, tags and runs of "<" are made of.
  const PIECES: Array<string> = [
    "<",
    "<<",
    "<title>",
    "</title>",
    "<TEXTAREA ",
    "</textarea>",
    "<xmp>",
    "</xmp >",
    "<script>",
    "</script>",
    "<!--",
    "-->",
    "<p>",
    ">",
    "a",
    "b",
    " ",
    '"',
    "=",
  ];
  const generated: Array<string> = generatedTexts(20000, 4421, PIECES, 14);

  it("holds no '<' read as a browser reads it that starts markup", () => {
    expect(
      generated.filter((html: string): boolean => {
        return MARKUP_START.test(asABrowser(html));
      }),
    ).toEqual([]);
  });

  it("holds no '<' at all with the default reading of '<'", () => {
    expect(
      generated.filter((html: string): boolean => {
        return replaceHtmlMarkup(html, NOTHING, WHOLE).includes("<");
      }),
    ).toEqual([]);
  });

  it("is held to many different texts, many with a run of '<' before an end tag", () => {
    expect(new Set(generated).size).toBeGreaterThan(15000);
    expect(
      generated.filter((html: string): boolean => {
        return RUN_BEFORE_END_TAG.test(html);
      }).length,
    ).toBeGreaterThan(200);
  });
});

describe("time", () => {
  const LIMIT_IN_MS: number = 3000;

  it.each([
    ["titles ending in '<'", "<title>a<<</title>b".repeat(60000)],
    ["one title of '<'", `<title>${"<".repeat(1000000)}</title>b`],
    ["textareas that never close", "<textarea><".repeat(100000)],
  ])("reads %s in linear time", (_case: string, html: string) => {
    const started: number = Date.now();
    const text: string = asABrowser(html);

    expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);
    expect(text).not.toMatch(MARKUP_START);
  });
});
