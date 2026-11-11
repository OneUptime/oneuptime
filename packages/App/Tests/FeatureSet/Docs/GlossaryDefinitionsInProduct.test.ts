import DocsGlossaryData, {
  DocsGlossary,
  DocsGlossaryEntry,
} from "../../../FeatureSet/Docs/Utils/Glossary";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import GlossaryTerm, {
  ALL_GLOSSARY_TERMS,
} from "Common/Types/Docs/GlossaryTerm";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

// The docs read their pages from this checkout, as the docs suites do.
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");

  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

/*
 * THE DEFINITIONS IN THE PRODUCT ARE THE GLOSSARY PAGE'S WORDS.
 *
 * A marked word in the Dashboard (DefinedTerm, #6819) shows its term's
 * entry from /docs/glossary/<lang>.json, which the docs read from the
 * Glossary page itself (Docs/Utils/Glossary, #6818). This follows that path
 * end to end, with the real pages of every docs language: what the docs
 * serve, read the way the Dashboard reads it (Common/UI/Utils/Glossary), is
 * the page's own definition - nothing copied, nothing reworded - and every
 * word the Dashboard marks has one, in every language.
 *
 * Common/UI/Utils/Glossary reads Common/UI/Config, which reads `window` as
 * it loads: it is imported once a bare one stands in.
 */

type GlossaryClient = typeof import("Common/UI/Utils/Glossary");

let client: GlossaryClient;

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

// Every term the Dashboard marks, by its GlossaryTerm name.
const markedTermNames: () => Set<string> = (): Set<string> => {
  const names: Set<string> = new Set();
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        const source: string = fs.readFileSync(full, "utf8");

        for (const match of source.matchAll(
          /(?:glossaryTerm|titleGlossaryTerm)(?::\s*|=\{\s*)GlossaryTerm\.(\w+)|<DefinedTerm\s+term=\{\s*GlossaryTerm\.(\w+)/g,
        )) {
          names.add((match[1] || match[2])!);
        }
      }
    }
  };

  walk(DASHBOARD_SRC);

  return names;
};

const MARKED: Array<GlossaryTerm> = Array.from(markedTermNames()).map(
  (name: string): GlossaryTerm => {
    return GlossaryTerm[name as keyof typeof GlossaryTerm];
  },
);

const glossaries: Map<string, DocsGlossary> = new Map();

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
  };

  client = await import("Common/UI/Utils/Glossary");

  for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
    glossaries.set(lang, await DocsGlossaryData.build(lang));
  }
});

describe("what the Dashboard marks", () => {
  it("is a set of Glossary terms the docs define", () => {
    expect(MARKED.length).toBeGreaterThanOrEqual(21);

    for (const term of MARKED) {
      expect({ term: term, known: ALL_GLOSSARY_TERMS.includes(term) }).toEqual(
        { term: term, known: true },
      );
    }
  });
});

describe.each(SUPPORTED_DOCS_LANGUAGE_CODES)("in %s", (lang: string) => {
  it("the docs serve this language's own Glossary, not English in its place", () => {
    expect(glossaries.get(lang)!.lang).toBe(lang);
  });

  it("the Dashboard reads every entry the docs serve, word for word", () => {
    const served: DocsGlossary = glossaries.get(lang)!;
    // The route's answer, as JSON travels.
    const loaded: ReturnType<GlossaryClient["readGlossaryData"]> =
      client.readGlossaryData(JSON.parse(JSON.stringify(served)));

    expect(loaded).not.toBeNull();
    expect(loaded!.language).toBe(lang);
    expect(loaded!.direction).toBe(lang === "fa" ? "rtl" : "ltr");

    for (const entry of served.entries) {
      expect(loaded!.definitions.get(entry.id)).toEqual({
        id: entry.id,
        term: entry.term,
        definition: entry.definition,
      });
    }
  });

  it("every word the Dashboard marks has a definition, and the popover shows the page's own words", () => {
    const byId: Map<string, DocsGlossaryEntry> = new Map(
      glossaries.get(lang)!.entries.map(
        (entry: DocsGlossaryEntry): [string, DocsGlossaryEntry] => {
          return [entry.id, entry];
        },
      ),
    );

    for (const term of MARKED) {
      const entry: DocsGlossaryEntry | undefined = byId.get(term);

      expect({ term: term, defined: Boolean(entry?.definition) }).toEqual({
        term: term,
        defined: true,
      });

      const shown: string = client.shortenDefinition(entry!.definition);

      // The popover's words are the page's words, from the start.
      expect(entry!.definition.startsWith(shown)).toBe(true);
      expect(shown.length).toBeGreaterThan(0);
    }
  });

  it("Read more opens the term on this language's Glossary page", () => {
    for (const term of MARKED) {
      expect(client.getGlossaryTermUrl(term, lang)).toMatch(
        new RegExp(`/docs/${lang}/introduction/glossary#${term}$`),
      );
    }
  });
});

describe("in English", () => {
  it("every marked definition fits the popover whole: three sentences at most", () => {
    const byId: Map<string, DocsGlossaryEntry> = new Map(
      glossaries.get("en")!.entries.map(
        (entry: DocsGlossaryEntry): [string, DocsGlossaryEntry] => {
          return [entry.id, entry];
        },
      ),
    );

    for (const term of MARKED) {
      const definition: string = byId.get(term)!.definition;

      expect({ term: term, shown: client.shortenDefinition(definition) }).toEqual(
        { term: term, shown: definition },
      );
    }
  });

  it("defines the layer of a schedule, the word #6819 added to the Glossary", () => {
    const layer: DocsGlossaryEntry | undefined = glossaries
      .get("en")!
      .entries.find((entry: DocsGlossaryEntry): boolean => {
        return entry.id === GlossaryTerm.Layer;
      });

    expect(layer?.term).toBe("Layer");
    expect(layer?.group).toBe("Start here");
    expect(layer?.definition).toContain("on-call schedule");
    expect(layer?.links).toEqual([
      {
        title: "On-Call Schedules",
        url: "/docs/en/on-call/schedules#layers",
      },
    ]);
  });
});
