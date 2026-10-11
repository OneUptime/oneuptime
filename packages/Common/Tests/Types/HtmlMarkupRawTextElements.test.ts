import removeHtmlMarkup, {
  HtmlMarkupReading,
  HtmlMarkupReplacer,
  replaceHtmlMarkup,
} from "../../Types/HtmlMarkup";
import { generatedTexts } from "./HtmlMarkupCases";
import { describe, expect, it } from "@jest/globals";
import { JSDOM } from "jsdom";

/*
 * Script and style elements hold code and rules, which a browser never
 * shows. A reader that quotes a page - the OAuth error's quote of a token
 * endpoint's answer - wants them out whole, and took them out with a
 * pattern run before the walk. A pattern cannot see where a comment or a
 * quoted attribute value is, nor which element it is inside: a "<script"
 * in a comment or an attribute, or inside a style element, started an
 * "element" that swallowed the page's own words, or cut a tag in half and
 * left its attribute text behind.
 *
 * rawTextElements makes them part of the walk: a start tag the walk finds
 * - and only one it finds - opens the element, which runs to the ">" of the
 * first end tag of the same name after it, and is markup whole. These
 * tests hold it to that:
 *
 *   - the element goes whole, start tag, what it holds and end tag, and the
 *     replacer is given all of it;
 *   - end and start tags are named as a browser names them;
 *   - a "<script" in a comment, in a quoted value or inside a style element
 *     starts nothing;
 *   - a start tag no end tag follows is an ordinary tag;
 *   - on pages a server writes, the text is what a browser shows;
 *   - text with no such element reads exactly as without the option;
 *   - it takes time that grows with the length of the text alone.
 */

const WHOLE: HtmlMarkupReading = { rawTextElements: true };
const WHOLE_AS_A_BROWSER: HtmlMarkupReading = {
  rawTextElements: true,
  lessThanAsText: true,
};

const NOTHING: HtmlMarkupReplacer = (): string => {
  return "";
};

function readWhole(html: string): string {
  return replaceHtmlMarkup(html, NOTHING, WHOLE);
}

// What a browser shows of a fragment: its text, without script and style.
function browserText(html: string): string {
  const fragment: DocumentFragment = JSDOM.fragment(html);

  fragment
    .querySelectorAll("script, style")
    .forEach((element: Element): void => {
      element.remove();
    });

  return fragment.textContent || "";
}

// A "<" that starts markup, as a browser reads one.
const MARKUP_START: RegExp = /<[A-Za-z/!?]/;
// A start tag of a raw text element, as a browser names one.
const RAW_TEXT_START: RegExp = /<(?:script|style)[\s/>]/i;

describe("replaceHtmlMarkup with rawTextElements", () => {
  it("gives the replacer the whole element, what it holds included", () => {
    const seen: Array<string> = [];
    const text: string = replaceHtmlMarkup(
      "<p>a</p><script>var b = '<p>';</script><p>c</p><style>p { x: 1 }</style>",
      (markup: string): string => {
        seen.push(markup);
        return "|";
      },
      WHOLE,
    );

    expect(seen).toEqual([
      "<p>",
      "</p>",
      "<script>var b = '<p>';</script>",
      "<p>",
      "</p>",
      "<style>p { x: 1 }</style>",
    ]);
    expect(text).toBe("|a|||c||");
  });

  it.each([
    ["an end tag with a space", "<script>a < b</script >after", "after"],
    ["an end tag in upper case", "<SCRIPT>x</SCRIPT>after", "after"],
    [
      "an end tag with more after its name",
      "<style>p{}</style foo>after",
      "after",
    ],
    ["an end tag closed by '/>'", "<script>x</script/>after", "after"],
    [
      "a start tag with attributes",
      '<script type="text/javascript">x</script>after',
      "after",
    ],
    ["a start tag closed by '/>'", "<script/>x</script>after", "after"],
    ["a start tag across lines", "<script\nsrc=x>y</script>after", "after"],
    [
      "a style with a media query",
      "<style media='(min-width: 1px)'>p{}</style>after",
      "after",
    ],
  ])(
    "takes out an element with %s",
    (_case: string, html: string, text: string) => {
      expect(readWhole(html)).toBe(text);
    },
  );

  it.each([
    ["a name that goes on", "<scripture>verse</scripture>", "verse"],
    ["a longer style name", "<styles>matter</styles>", "matter"],
    ["a name with a dash after it", "<script-x>y</script-x>", "y"],
    ["an end tag whose name goes on", "<script>x</scripts>y", "xy"],
  ])(
    "reads %s as ordinary tags",
    (_case: string, html: string, text: string) => {
      expect(readWhole(html)).toBe(text);
    },
  );

  it.each([
    [
      "a '<script' in a comment",
      "<!-- <script> -->visible<!-- </script> -->",
      "visible",
    ],
    [
      "a '<script' in a quoted value",
      "<p title='<script>'>visible</p></script>",
      "visible",
    ],
    [
      "a '<script' inside a style element",
      "<style>/*<script>*/</style>visible<script>y</script>",
      "visible",
    ],
    [
      "a '<style' inside a script element",
      "<script>var s = '<style>';</script>visible</style>",
      "visible",
    ],
  ])("starts nothing with %s", (_case: string, html: string, text: string) => {
    expect(readWhole(html)).toBe(text);
  });

  it.each([
    [
      "a start tag and no end tag",
      "<p>Error</p><script>var a = 1;",
      "Errorvar a = 1;",
    ],
    ["an end tag that never reaches its '>'", "<script>a</script", "a/script"],
    [
      "one that closes, then one that does not",
      "<script>a</script>x<script>b",
      "xb",
    ],
  ])(
    "reads %s as ordinary tags, what follows staying text",
    (_case: string, html: string, text: string) => {
      expect(readWhole(html)).toBe(text);
    },
  );

  it("reads a stray start tag before a real element to that element's end, as a browser does", () => {
    const html: string =
      "<h1>Denied</h1><script src=x <p>hidden</p><script>var cfg = {};</script><p>Try again</p>";

    expect(readWhole(html)).toBe("DeniedTry again");
    expect(readWhole(html)).toBe(browserText(html));
  });

  it("reads what a browser shows, on pages a server writes", () => {
    for (const page of [
      '<!DOCTYPE html><html><head><title>Sign in</title><script>window.cfg = {"a":"</p>"};</script><style>body { margin: 0 }</style></head><body><h1>Sign in</h1><p>Use your work account.</p></body></html>',
      '<html><head><style type="text/css">\n<!--\nbody{color:red}\n-->\n</style></head><body><div id="header"><h1>Server Error</h1></div></body></html>',
      '<html><head><script src="/a.js"></script><script>if (a < b && c > d) { go("<b>"); }</script></head><body><p>Bad <b>Gateway</b></p><!-- trace: 42 --></body></html>',
      "<SCRIPT>x()</SCRIPT ><STYLE>p{}</STYLE ><P>Upper case</P>",
    ]) {
      expect(readWhole(page)).toBe(browserText(page));
    }
  });

  describe("whatever it is given", () => {
    // Text made of what elements, tags, comments and quoted values are made of.
    const PIECES: Array<string> = [
      "<script>",
      "</script>",
      "<style>",
      "</style>",
      "<SCRIPT ",
      "</script ",
      "<p>",
      "</p>",
      "<!--",
      "-->",
      "<a title='",
      '"',
      "'",
      ">",
      "<",
      "x",
      " ",
      "=",
    ];
    const generated: Array<string> = generatedTexts(20000, 9241, PIECES);

    it("holds no '<' read as a browser reads it that starts markup", () => {
      expect(
        generated.filter((text: string): boolean => {
          return MARKUP_START.test(
            replaceHtmlMarkup(text, NOTHING, WHOLE_AS_A_BROWSER),
          );
        }),
      ).toEqual([]);
    });

    it("holds no '<' at all with the default reading of '<'", () => {
      expect(
        generated.filter((text: string): boolean => {
          return readWhole(text).includes("<");
        }),
      ).toEqual([]);
    });

    it("is read the same a second time", () => {
      expect(
        generated.filter((text: string): boolean => {
          const once: string = readWhole(text);
          return readWhole(once) !== once;
        }),
      ).toEqual([]);
    });

    it("reads text with no script or style start tag exactly as without the option", () => {
      const withoutElements: Array<string> = generated.filter(
        (text: string): boolean => {
          return !RAW_TEXT_START.test(text);
        },
      );

      expect(withoutElements.length).toBeGreaterThan(1000);

      for (const text of withoutElements) {
        expect(readWhole(text)).toBe(removeHtmlMarkup(text));
      }
    });
  });

  it("changes nothing without the option", () => {
    expect(replaceHtmlMarkup("<script>var a = 1;</script>b", NOTHING)).toBe(
      "var a = 1;b",
    );
    expect(removeHtmlMarkup("<style>p{}</style>b")).toBe("p{}b");
  });

  describe("time", () => {
    // Far above what these take, so a slow machine does not fail them.
    const LIMIT_IN_MS: number = 3000;

    it.each([
      ["start tags no end tag follows", "<script>".repeat(150000)],
      [
        "end tags that never reach their '>'",
        `<script>${"</script ".repeat(100000)}`,
      ],
      ["elements one after another", "<script>x</script>".repeat(60000)],
      ["style starts, then one end tag", `${"<style>".repeat(150000)}</style>`],
      [
        "elements of both kinds, nested in text",
        "a<style>b</style>c<script>d</script>".repeat(40000),
      ],
    ])("reads %s in linear time", (_case: string, html: string) => {
      const started: number = Date.now();
      const text: string = replaceHtmlMarkup(html, NOTHING, WHOLE_AS_A_BROWSER);

      expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);
      expect(text).not.toMatch(MARKUP_START);
    });
  });
});
