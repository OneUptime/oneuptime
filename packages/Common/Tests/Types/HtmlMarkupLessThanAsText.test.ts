import removeHtmlMarkup, {
  HtmlMarkupReplacer,
  replaceHtmlMarkup,
} from "../../Types/HtmlMarkup";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import {
  MARKUP_ALPHABET,
  SINGLE_PASS_LEFTOVERS,
  WELL_FORMED_MARKUP,
} from "./HtmlMarkupCases";
import { describe, expect, it } from "@jest/globals";

/*
 * replaceHtmlMarkup reads every "<" as the start of markup by default,
 * which suits HTML a renderer or a chat client writes: a "<" that is text
 * is "&lt;" there. Text that may be plain - an OAuth error's description,
 * a note an integration wrote through an API - can hold a "<" that is
 * text: "expires_in must be < 3600". Read as markup, that "<" was dropped
 * and the sentence said the opposite.
 *
 * lessThanAsText reads a "<" as a browser does: it starts markup only
 * before an ASCII letter, "/", "!" or "?"; anywhere else it is text, and
 * kept. A run of "<" goes with the character after its last one: before
 * markup, the markup starts at the run's last "<" and the others go. These
 * tests hold it to that:
 *
 *   - a "<" a browser shows as text stays, exactly where it was;
 *   - markup comes out exactly as by default;
 *   - what it returns holds no "<" that starts markup, whatever it is
 *     given, and reading it again changes nothing;
 *   - it agrees with an independent reading - setting the text "<" aside
 *     before removeHtmlMarkup and putting it back after, as the docs search
 *     index does - on 20,000 generated texts;
 *   - it takes time that grows with the length of the text alone;
 *   - and without the option nothing changes.
 */

const AS_TEXT: { lessThanAsText: boolean } = { lessThanAsText: true };

const NOTHING: HtmlMarkupReplacer = (): string => {
  return "";
};

function readAsBrowser(html: string): string {
  return replaceHtmlMarkup(html, NOTHING, AS_TEXT);
}

// A "<" that starts markup: what nothing it returns may hold.
const MARKUP_START: RegExp = /<[A-Za-z/!?]/;

/*
 * The same reading, made another way: each run of "<" that a browser reads
 * as text is set aside as a private-use mark (which the walk reads as an
 * ordinary character), each run before markup is cut to its last "<", the
 * markup is taken out by removeHtmlMarkup, and the marks are put back.
 */
const TEXT_LESS_THAN_MARK: string = "\uE001";
const LESS_THAN_RUN: RegExp = /<+/g;
const STARTS_MARKUP: RegExp = /[A-Za-z/!?]/;

function setAsideReading(html: string): string {
  const marked: string = html.replace(
    LESS_THAN_RUN,
    (run: string, offset: number, whole: string): string => {
      return STARTS_MARKUP.test(whole.charAt(offset + run.length))
        ? "<"
        : TEXT_LESS_THAN_MARK.repeat(run.length);
    },
  );

  return removeHtmlMarkup(marked).split(TEXT_LESS_THAN_MARK).join("<");
}

describe("replaceHtmlMarkup with lessThanAsText", () => {
  it.each([
    ["a comparison", "expires_in must be < 3600", "expires_in must be < 3600"],
    ["comparisons with no space", "x <= 5 and 1<2", "x <= 5 and 1<2"],
    ["a heart", "Plain <3 text", "Plain <3 text"],
    ["a '<' at the end", "a <", "a <"],
    ["a run of text '<'", "<< 2 <<<", "<< 2 <<<"],
    ["arrows", "a <- b <-> c <=> d", "a <- b <-> c <=> d"],
    ["a '<' and a '>' with spaces", "a < b > c", "a < b > c"],
    ["a '<' before other scripts", "<é <語 <😀", "<é <語 <😀"],
    [
      "a '<' beside a tag, which still comes out",
      "1 < 2 <b>bold</b>",
      "1 < 2 bold",
    ],
  ])("keeps %s", (_case: string, text: string, read: string) => {
    expect(readAsBrowser(text)).toBe(read);
  });

  it.each([
    ["a tag pair", "<p>Restarted</p>", "Restarted"],
    ["an end tag", "a</b>c", "ac"],
    ["a comment", "a<!-- note -->b", "ab"],
    ["a declaration", "<!DOCTYPE html>text", "text"],
    ["a processing instruction", '<?xml version="1.0"?>text', "text"],
    ["a quoted value holding '>'", '<a title="a > b">link</a>', "link"],
  ])(
    "takes out %s, as by default",
    (_case: string, html: string, text: string) => {
      expect(readAsBrowser(html)).toBe(text);
      expect(removeHtmlMarkup(html)).toBe(text);
    },
  );

  it.each([
    ["a tag that never closes", "p99<threshold", "p99threshold"],
    ["an end tag that never closes", "a </b", "a /b"],
    ["a comment that never closes", "a <!-- note", "a !-- note"],
    ["a run before a tag", "<<b>x", "x"],
    ["a run before a tag that never closes", "<<<b", "b"],
    ["a run before a comment", "a<<!-- c -->b", "ab"],
    ["a run before a comment holding '>'", "<<!-- a > b -->c", "c"],
    ["a longer run before a comment", "x<<<!-- y > z -->w", "xw"],
  ])("reads %s as markup", (_case: string, html: string, text: string) => {
    expect(readAsBrowser(html)).toBe(text);
    expect(readAsBrowser(html)).not.toMatch(MARKUP_START);
  });

  it("asks the replacer only about markup, never about a '<' that is text", () => {
    const seen: Array<string> = [];
    const text: string = replaceHtmlMarkup(
      "x < y <br/> z <= 3 <!-- c --> <3",
      (markup: string): string => {
        seen.push(markup);
        return "|";
      },
      AS_TEXT,
    );

    expect(seen).toEqual(["<br/>", "<!-- c -->"]);
    expect(text).toBe("x < y | z <= 3 | <3");
  });

  it("gives the replacer markup from a run's last '<'", () => {
    const seen: Array<string> = [];

    replaceHtmlMarkup(
      "a<<br>b<<<!-- c > d -->e",
      (markup: string): string => {
        seen.push(markup);
        return "";
      },
      AS_TEXT,
    );

    expect(seen).toEqual(["<br>", "<!-- c > d -->"]);
  });

  describe("whatever it is given", () => {
    const generated: Array<string> = [
      ...SINGLE_PASS_LEFTOVERS,
      ...WELL_FORMED_MARKUP,
      ...generatedTexts(20000, 5821, MARKUP_ALPHABET),
    ];

    it("holds no '<' that starts markup", () => {
      expect(
        generated.filter((text: string): boolean => {
          return MARKUP_START.test(readAsBrowser(text));
        }),
      ).toEqual([]);
    });

    it("is read the same a second time", () => {
      expect(
        generated.filter((text: string): boolean => {
          const once: string = readAsBrowser(text);
          return readAsBrowser(once) !== once;
        }),
      ).toEqual([]);
    });

    it("keeps every character it does not take out, in order", () => {
      for (const text of generated.slice(0, 2000)) {
        let at: number = 0;

        for (const character of readAsBrowser(text)) {
          at = text.indexOf(character, at);
          expect(at).toBeGreaterThanOrEqual(0);
          at += character.length;
        }
      }
    });

    it("reads exactly as setting the text '<' aside before removeHtmlMarkup does", () => {
      const differences: Array<[string, string, string]> = [];

      for (const text of generated) {
        const read: string = readAsBrowser(text);
        const reference: string = setAsideReading(text);

        if (read !== reference) {
          differences.push([text, read, reference]);
        }
      }

      expect(differences.slice(0, 5)).toEqual([]);
    });

    it("reads text with no '<' a browser shows as text exactly as by default", () => {
      /*
       * Every "<" in it is alone, before what starts markup. (Before a run
       * of "<", the default reading starts markup at the run's first "<",
       * and a browser at its last.)
       */
      const withoutTextLessThan: Array<string> = generated.filter(
        (text: string): boolean => {
          return Array.from(text.matchAll(LESS_THAN_RUN)).every(
            (run: RegExpMatchArray): boolean => {
              return (
                run[0].length === 1 &&
                STARTS_MARKUP.test(text.charAt(run.index! + run[0].length))
              );
            },
          );
        },
      );

      expect(withoutTextLessThan.length).toBeGreaterThan(1000);
      expect(
        withoutTextLessThan.filter((text: string): boolean => {
          return readAsBrowser(text) !== removeHtmlMarkup(text);
        }),
      ).toEqual([]);
    });
  });

  describe("without the option", () => {
    it("reads every '<' as markup, as before", () => {
      expect(
        generatedTexts(5000, 7713, MARKUP_ALPHABET).filter(
          (text: string): boolean => {
            const removed: string = removeHtmlMarkup(text);

            return (
              replaceHtmlMarkup(text, NOTHING) !== removed ||
              replaceHtmlMarkup(text, NOTHING, {}) !== removed ||
              replaceHtmlMarkup(text, NOTHING, { lessThanAsText: false }) !==
                removed
            );
          },
        ),
      ).toEqual([]);

      expect(removeHtmlMarkup("expires_in must be < 3600")).toBe(
        "expires_in must be  3600",
      );
    });
  });

  describe("time", () => {
    // Far above what these take, so a slow machine does not fail them.
    const LIMIT_IN_MS: number = 3000;

    it.each([
      ["a run of text '<'", "<".repeat(300000)],
      ["a run of '<' before a tag that never closes", `${"<".repeat(300000)}a`],
      ["tags that never close", "<a".repeat(150000)],
      ["text '<' between tags", "1 < 2 <b>x</b> ".repeat(20000)],
      ["a run of '<' before an unclosed value", `${"<".repeat(300000)}a="`],
      ["comment openings", `${"<!--".repeat(100000)}>`],
    ])("reads %s in linear time", (_case: string, html: string) => {
      const started: number = Date.now();
      const read: string = readAsBrowser(html);

      expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);
      expect(read).not.toMatch(MARKUP_START);
    });
  });
});
