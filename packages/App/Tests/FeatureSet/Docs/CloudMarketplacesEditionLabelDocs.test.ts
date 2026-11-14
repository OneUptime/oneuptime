import { TRANSLATED_LANGUAGES, readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The cloud marketplaces guide names the two states the edition label shows
 * when a marketplace stops taking the usage reports, in its table and in
 * the titles of its troubleshooting sections. The label is drawn in the
 * Admin Dashboard's header (and the Dashboard's footer), which says it in
 * the reader's language since #6470, so each translation names a state as
 * the Admin Dashboard of its language draws it, and no longer in English.
 */

const PAGE: string = "installation/cloud-marketplaces";

const STATES: ReadonlyArray<string> = [
  "Enterprise Edition (Marketplace Reports Failing)",
  "Enterprise Edition (Marketplace Subscription Ended)",
];

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "../../../FeatureSet/AdminDashboard/src/Locales",
);

const adminWords: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(ADMIN_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const occurrences: (text: string, part: string) => number = (
  text: string,
  part: string,
): number => {
  return text.split(part).length - 1;
};

// Where a page names a state: in bold, and in a troubleshooting section's title.
const mentions: (
  page: string,
  state: string,
) => { bold: number; titles: number } = (
  page: string,
  state: string,
): { bold: number; titles: number } => {
  return {
    bold: occurrences(page, `**${state}**`),
    titles: page.split("\n").filter((line: string): boolean => {
      return line.startsWith(":::details ") && line.includes(state);
    }).length,
  };
};

describe("the cloud marketplaces guide's edition label states", () => {
  const english: string = readPage("en", PAGE);

  it("are what the Admin Dashboard draws, named in the table and the troubleshooting titles", () => {
    for (const state of STATES) {
      expect({ state, drawn: adminWords("en")[state] }).toEqual({
        state,
        drawn: state,
      });
      expect({ state, ...mentions(english, state) }).toEqual({
        state,
        bold: 1,
        titles: 1,
      });
    }
  });

  it.each(TRANSLATED_LANGUAGES)(
    "%s names each as its Admin Dashboard draws it",
    (language: string) => {
      const page: string = readPage(language, PAGE);
      const words: Record<string, unknown> = adminWords(language);

      for (const state of STATES) {
        const drawn: unknown = words[state];

        expect({ language, state, worded: drawn !== state }).toEqual({
          language,
          state,
          worded: true,
        });
        expect({
          language,
          state,
          ...mentions(page, drawn as string),
          english: occurrences(page, state),
        }).toEqual({ language, state, bold: 1, titles: 1, english: 0 });
      }
    },
  );
});
