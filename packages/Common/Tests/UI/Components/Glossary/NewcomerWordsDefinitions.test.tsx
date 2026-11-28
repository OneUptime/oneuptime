import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// The docs read their pages from this checkout, as the docs suites do.
jest.mock("../../../../../App/FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(
    __dirname,
    "../../../../../App/FeatureSet/Docs",
  );

  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, unknown>;

const LOCALES: Record<string, Locale> = Object.fromEntries(
  ["en", "de", "fa", "ja", "ar"].map((code: string): [string, Locale] => {
    return [
      code,
      JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
      ) as Locale,
    ];
  }),
);

let language: string = "en";

// The Dashboard's own locale files answer react-i18next, as a reader's would.
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const flat: unknown = LOCALES[language]![key];
          if (typeof flat === "string") {
            return flat;
          }
          return (
            (options as { defaultValue?: string } | undefined)?.defaultValue ??
            key
          );
        },
        i18n: { resolvedLanguage: language, language: language },
      };
    },
  };
});

import DocsGlossaryData, {
  DocsGlossary,
  DocsGlossaryEntry,
} from "../../../../../App/FeatureSet/Docs/Utils/Glossary";
import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import { getDocsLanguageFor } from "../../../../Types/Docs/DocsLanguage";
import Card from "../../../../UI/Components/Card/Card";
import {
  DEFINED_TERM_DEFINITION_TEST_ID,
  DEFINED_TERM_TEST_ID,
} from "../../../../UI/Components/Glossary/DefinedTerm";
import { DOCS_URL } from "../../../../UI/Config";
import {
  clearGlossaryReads,
  shortenDefinition,
} from "../../../../UI/Utils/Glossary";

/*
 * THE NEXT WORDS NEWCOMERS MEET, DEFINED IN THEIR LANGUAGE (#6935).
 *
 * Monitor status, status page, subscriber, maintenance and team were marked
 * where a newcomer first meets them, and a telemetry monitor's When to
 * alert says what criteria are: each list's title (a card's or a table's
 * titleGlossaryTerm), as its page draws it. Each definition is the docs'
 * Glossary entry, read from /docs/glossary/<lang>.json - served here as the
 * docs serve it, from this checkout's Glossary pages - in the reader's
 * language: German and Japanese, Persian from the right, and Arabic, which
 * the docs have no copy of, in English inside its page.
 * GlossaryDefinitionsInProduct (App) holds every docs language to having
 * each, word for word.
 */

const WORDS_NEWCOMERS_MEET: ReadonlyArray<[GlossaryTerm, string]> = [
  [GlossaryTerm.MonitorStatus, "Monitor Statuses"],
  [GlossaryTerm.StatusPage, "Status Pages"],
  [GlossaryTerm.Subscriber, "Email Subscribers"],
  [GlossaryTerm.ScheduledMaintenance, "Maintenance Events"],
  [GlossaryTerm.Team, "Teams"],
  [GlossaryTerm.Criteria, "When to alert"],
];

const READERS: ReadonlyArray<string> = ["de", "ja", "fa", "ar"];

const DOCS: string = DOCS_URL.toString();

// What the docs serve, by its address: built once per docs language.
const served: Map<string, DocsGlossary> = new Map();

beforeAll(async () => {
  for (const reader of [...READERS, "en"]) {
    const docsLanguage: string = getDocsLanguageFor(reader);

    if (!served.has(`${DOCS}/glossary/${docsLanguage}.json`)) {
      served.set(
        `${DOCS}/glossary/${docsLanguage}.json`,
        await DocsGlossaryData.build(docsLanguage),
      );
    }
  }
});

const originalFetch: unknown = (globalThis as Record<string, unknown>)["fetch"];

beforeEach(() => {
  language = "en";
  clearGlossaryReads();
  (globalThis as Record<string, unknown>)["fetch"] = (
    url: string,
  ): Promise<unknown> => {
    const glossary: DocsGlossary | undefined = served.get(url);

    return Promise.resolve({
      ok: Boolean(glossary),
      status: glossary ? 200 : 404,
      json: (): Promise<unknown> => {
        // As JSON travels.
        return Promise.resolve(JSON.parse(JSON.stringify(glossary || {})));
      },
    });
  };
});

afterEach(() => {
  cleanup();
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
});

const entryOf: (term: GlossaryTerm, reader: string) => DocsGlossaryEntry = (
  term: GlossaryTerm,
  reader: string,
): DocsGlossaryEntry => {
  const glossary: DocsGlossary = served.get(
    `${DOCS}/glossary/${getDocsLanguageFor(reader)}.json`,
  )!;

  return glossary.entries.find((entry: DocsGlossaryEntry): boolean => {
    return entry.id === term;
  })!;
};

describe.each(READERS)("for a reader of %s", (reader: string) => {
  test.each(WORDS_NEWCOMERS_MEET)(
    "%s: the title's word opens the Glossary's own definition, in the reader's language",
    async (term: GlossaryTerm, title: string) => {
      language = reader;

      render(<Card title={title} titleGlossaryTerm={term} />);

      const heading: HTMLElement = screen.getByTestId("card-details-heading");
      const word: HTMLElement = within(heading).getByTestId(
        DEFINED_TERM_TEST_ID,
      );

      // The title in the reader's words, drawn as the defined term.
      expect(word).toHaveAttribute("data-glossary-term", term);
      expect(word).toHaveTextContent(LOCALES[reader]![title] as string);

      // Its file arrives (LazyDefinedTerm), and the definition opens.
      await waitFor(() => {
        expect(
          within(heading).getByTestId(DEFINED_TERM_TEST_ID),
        ).toHaveAttribute("aria-expanded");
      });
      fireEvent.click(within(heading).getByTestId(DEFINED_TERM_TEST_ID));

      const definition: HTMLElement = await waitFor((): HTMLElement => {
        return screen.getByTestId(DEFINED_TERM_DEFINITION_TEST_ID);
      });
      const entry: DocsGlossaryEntry = entryOf(term, reader);
      const shown: HTMLElement = definition.parentElement as HTMLElement;

      // The Glossary's words, as the docs serve them, whole: a sentence or two.
      expect(definition).toHaveTextContent(entry.definition);
      expect(shortenDefinition(entry.definition)).toBe(entry.definition);
      expect(within(shown).getByText(entry.term)).toBeInTheDocument();

      // In its own language: Arabic reads the English entry, left to right.
      expect(shown).toHaveAttribute("lang", getDocsLanguageFor(reader));
      expect(shown).toHaveAttribute("dir", reader === "fa" ? "rtl" : "ltr");

      if (reader !== "ar") {
        expect(entry.definition).not.toBe(entryOf(term, "en").definition);
      } else {
        expect(entry.definition).toBe(entryOf(term, "en").definition);
      }
    },
  );
});
