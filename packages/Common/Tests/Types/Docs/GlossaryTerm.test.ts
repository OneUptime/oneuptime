import GlossaryTerm, {
  ALL_GLOSSARY_TERMS,
  GLOSSARY_DOCS_PAGE,
  getGlossaryTermPath,
} from "../../../Types/Docs/GlossaryTerm";
import { SUPPORTED_DOCS_LANGUAGES } from "../../../Types/Docs/DocsLanguage";
import { SUPPORTED_DASHBOARD_LANGUAGES } from "../../../Types/Dashboard/DashboardLanguage";
import { describe, expect, it } from "@jest/globals";

/*
 * How code links to a term of the docs' Glossary (#6818): by its id, the
 * English heading's anchor every language answers, at the Glossary in the
 * reader's language when the docs are written in it. The docs suite
 * GlossaryDocs (App) holds the Glossary page to these ids.
 */

// An anchor the docs make from an English heading: lower-case words and dashes.
const ENGLISH_ANCHOR: RegExp = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("GlossaryTerm", () => {
  it("is a list of anchors, each once", () => {
    expect(ALL_GLOSSARY_TERMS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(ALL_GLOSSARY_TERMS).size).toBe(ALL_GLOSSARY_TERMS.length);

    for (const term of ALL_GLOSSARY_TERMS) {
      expect({ term: term, anchor: ENGLISH_ANCHOR.test(term) }).toEqual({
        term: term,
        anchor: true,
      });
    }
  });

  it("starts with the loop every project runs", () => {
    expect(ALL_GLOSSARY_TERMS.slice(0, 4)).toEqual([
      GlossaryTerm.Project,
      GlossaryTerm.Account,
      GlossaryTerm.Team,
      GlossaryTerm.Monitor,
    ]);
    expect(ALL_GLOSSARY_TERMS.indexOf(GlossaryTerm.Incident)).toBeLessThan(
      ALL_GLOSSARY_TERMS.indexOf(GlossaryTerm.Exception),
    );
  });

  it("keeps the anchors the product links to", () => {
    // The ids a renamed heading must not move: links to them exist.
    expect(GlossaryTerm.OnCallPolicy).toBe("on-call-policy");
    expect(GlossaryTerm.IngestionKey).toBe("ingestion-key");
    expect(GlossaryTerm.APIKey).toBe("api-key");
    expect(GlossaryTerm.Service).toBe("service");
    expect(GlossaryTerm.Criteria).toBe("criteria");
  });
});

describe("getGlossaryTermPath", () => {
  it("opens the term on the Glossary in the reader's docs language", () => {
    expect(getGlossaryTermPath(GlossaryTerm.Monitor, "de")).toBe(
      "/docs/de/introduction/glossary#monitor",
    );
    expect(getGlossaryTermPath(GlossaryTerm.OnCallPolicy, "zh-TW")).toBe(
      "/docs/zh-TW/introduction/glossary#on-call-policy",
    );
    expect(getGlossaryTermPath(GlossaryTerm.IngestionKey, "fa")).toBe(
      "/docs/fa/introduction/glossary#ingestion-key",
    );
  });

  it("opens the English page without a language, or for one the docs are not written in", () => {
    expect(getGlossaryTermPath(GlossaryTerm.Monitor)).toBe(
      "/docs/en/introduction/glossary#monitor",
    );
    expect(getGlossaryTermPath(GlossaryTerm.Monitor, "")).toBe(
      "/docs/en/introduction/glossary#monitor",
    );
    expect(getGlossaryTermPath(GlossaryTerm.Monitor, "ar")).toBe(
      "/docs/en/introduction/glossary#monitor",
    );
    // A language code is matched as it is written.
    expect(getGlossaryTermPath(GlossaryTerm.Monitor, "DE")).toBe(
      "/docs/en/introduction/glossary#monitor",
    );
  });

  it("gives every Dashboard language a page: its own where the docs have it, else English", () => {
    const docsLanguages: Array<string> = SUPPORTED_DOCS_LANGUAGES.map(
      (language: { code: string }): string => {
        return language.code;
      },
    );

    for (const language of SUPPORTED_DASHBOARD_LANGUAGES) {
      const code: string = (language as { code: string }).code;
      const expected: string = docsLanguages.includes(code) ? code : "en";

      expect(getGlossaryTermPath(GlossaryTerm.Label, code)).toBe(
        `/docs/${expected}/${GLOSSARY_DOCS_PAGE}#label`,
      );
    }
  });
});
