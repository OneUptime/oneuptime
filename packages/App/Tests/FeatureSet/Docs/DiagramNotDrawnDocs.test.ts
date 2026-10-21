import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * A docs diagram that cannot be drawn - it does not parse, or this server has
 * no mermaid build - keeps its source, under a short note saying so. The note
 * is in the reader's language: Head.ejs writes it into a meta tag, and the
 * page's diagram script reads it from there (a module script cannot read
 * anything from its own tag). How the page behaves is checked in a browser,
 * in packages/E2E/Diagrams.
 */

const DOCS_ROOT: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const HEAD: string = path.join(DOCS_ROOT, "Views", "Partials", "Head.ejs");
const KEY: string = "diagramNotDrawn";
const ENGLISH: string = "This diagram could not be drawn.";

type Locale = { ui: { [key: string]: string } };

const localeOf: (code: string) => Locale = (code: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(DOCS_ROOT, "Locales", `${code}.json`), "utf8"),
  ) as Locale;
};

const renderHead: (lang: string) => Promise<string> = async (
  lang: string,
): Promise<string> => {
  return (await ejs.renderFile(HEAD, {
    t: makeT(lang),
    lang: lang,
    enableGoogleTagManager: false,
  })) as string;
};

const META: RegExp =
  /<meta name="oneuptime-docs-diagram-not-drawn" content="([^"]*)">/;

describe("the note on a docs diagram that cannot be drawn", () => {
  it("is plain English in English", () => {
    expect(localeOf("en").ui[KEY]).toBe(ENGLISH);
  });

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((code: string): boolean => {
      return code !== "en";
    }).map((code: string) => {
      return [code];
    }),
  )("is translated in %s", (code: string) => {
    const note: string | undefined = localeOf(code).ui[KEY];

    expect(typeof note).toBe("string");
    expect((note || "").trim().length).toBeGreaterThan(5);
    expect(note).not.toBe(ENGLISH);
  });

  it("is written into the head of every docs page, in the page's language", async () => {
    for (const code of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const head: string = await renderHead(code);
      const match: RegExpMatchArray | null = head.match(META);

      expect([code, Boolean(match)]).toEqual([code, true]);
      expect([code, match?.[1]]).toEqual([
        code,
        ejs.escapeXML(localeOf(code).ui[KEY] as string),
      ]);
    }
  });

  it("is read from that meta tag by the diagram script, with English to fall back on", () => {
    const head: string = fs.readFileSync(HEAD, "utf8");

    expect(head).toContain('meta[name="oneuptime-docs-diagram-not-drawn"]');
    expect(head).toContain(JSON.stringify(ENGLISH).slice(1, -1));
  });
});
