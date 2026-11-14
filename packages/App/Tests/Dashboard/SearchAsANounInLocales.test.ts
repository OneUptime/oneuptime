import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { DataStoreFamily } from "Common/Types/DataSecurity/DataStoreKind";
import {
  LlmCallKind,
  LlmCallKindUtil,
} from "Common/Types/Telemetry/LlmCallKind";
import {
  DATA_SECURITY_CATALOG_TERMS,
  DATA_STORE_FAMILY_TITLES,
  getDataStoreFamilyTitle,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityCatalogTerms";
import { LLM_CALL_KIND_TITLES } from "../../FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationCopy";
import {
  SESSION_REPLAY_FILTER_FIELDS,
  SessionReplayFilterField,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFilterFields";

/*
 * "SEARCH" AS A NOUN HAS A KEY OF ITS OWN (#7108).
 *
 * The "Search" key is the Search button's, and every language words it as
 * the verb on that button: German "Suchen", French "Rechercher", Hindi
 * "खोजें". Three places used the same key for a thing, not an action -
 * Session Replay's filter for what a reader typed, an AI call that looks
 * something up, and a family of data stores (Elasticsearch, OpenSearch) -
 * and so read as a command in every language but English.
 *
 * Each now has a noun of its own: "Search query" (as Splunk's search
 * setting and a hunt's Search step already did, #6888), "Retrieval" beside
 * "Embedding" and "Tool", and "Search engine" beside "Database" and
 * "Warehouse". This suite holds every language to a noun there that is
 * not its Search button's word.
 */

interface Noun {
  // Where the noun is drawn.
  where: string;
  key: string;
}

function sessionReplaySearchField(): SessionReplayFilterField {
  const field: SessionReplayFilterField | undefined =
    SESSION_REPLAY_FILTER_FIELDS.find(
      (candidate: SessionReplayFilterField): boolean => {
        return candidate.field === "search";
      },
    );

  expect(field).toBeDefined();

  return field as SessionReplayFilterField;
}

const NOUNS: ReadonlyArray<Noun> = [
  {
    where: "Session Replay's filter for what a reader typed",
    key: sessionReplaySearchField().title as string,
  },
  {
    where: "an AI conversation's call that looks something up",
    key: LLM_CALL_KIND_TITLES[LlmCallKind.Retrieval],
  },
  {
    where: "a data store family (Elasticsearch, OpenSearch)",
    key: DATA_STORE_FAMILY_TITLES[DataStoreFamily.Search],
  },
];

const SEARCH: string = "Search";

// What is wrong with how `language` words `key` where a noun is drawn.
function nounProblems(language: string, key: string): Array<string> {
  const words: Record<string, string> = readDashboardLocale(language);
  const worded: string | undefined = words[key];
  const search: string | undefined = words[SEARCH];
  const problems: Array<string> = [];

  if (!isWordedInDashboardLocale(key, language)) {
    problems.push("not worded");
  }

  if (
    worded &&
    search &&
    worded.trim().toLowerCase() === search.trim().toLowerCase()
  ) {
    problems.push(`the Search button's word, ${search}`);
  }

  return problems;
}

describe("Search, where it names a thing", () => {
  test("each place draws a noun key, never the Search button's", () => {
    expect(
      NOUNS.map((noun: Noun): string => {
        return noun.key;
      }),
    ).toEqual(["Search query", "Retrieval", "Search engine"]);

    const english: Record<string, string> = readDashboardLocale("en");

    for (const noun of NOUNS) {
      expect({ where: noun.where, english: english[noun.key] }).toEqual({
        where: noun.where,
        english: noun.key,
      });
    }
  });

  test("no filter, call kind or store family is titled with the Search key", () => {
    expect(
      SESSION_REPLAY_FILTER_FIELDS.map(
        (field: SessionReplayFilterField): string => {
          return String(field.title);
        },
      ),
    ).not.toContain(SEARCH);
    expect(Object.values(LLM_CALL_KIND_TITLES)).not.toContain(SEARCH);
    expect(Object.values(DATA_STORE_FAMILY_TITLES)).not.toContain(SEARCH);
    expect(DATA_SECURITY_CATALOG_TERMS).not.toContain(SEARCH);
  });

  test("Common's own title for the call kind is the same noun", () => {
    expect(LlmCallKindUtil.getTitle(LlmCallKind.Retrieval)).toBe("Retrieval");

    for (const kind of Object.values(LlmCallKind)) {
      expect({ kind, title: LlmCallKindUtil.getTitle(kind) }).toEqual({
        kind,
        title: LLM_CALL_KIND_TITLES[kind],
      });
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each as a noun, not as its Search button",
    (language: string) => {
      for (const noun of NOUNS) {
        expect({
          language,
          where: noun.where,
          problems: nounProblems(language, noun.key),
        }).toEqual({ language, where: noun.where, problems: [] });
      }

      // And the three are three different things.
      const words: Record<string, string> = readDashboardLocale(language);
      const worded: Array<string> = NOUNS.map((noun: Noun): string => {
        return String(words[noun.key]);
      });

      expect(new Set(worded).size).toBe(NOUNS.length);
    },
  );

  // The check sees the verb: the Search key itself is flagged in every language.
  test("the check catches the Search button's word (negative control)", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect(nounProblems(language, SEARCH)).toContain(
        `the Search button's word, ${readDashboardLocale(language)[SEARCH]}`,
      );
    }

    expect(nounProblems("de", "A noun no locale has")).toEqual(["not worded"]);
  });

  test.each(["de", "fr", "hi", "ja", "ar"])(
    "%s: a store's family reads as the kind of store it is",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const title: string = getDataStoreFamilyTitle(
        dashboardTranslator(language),
        DataStoreFamily.Search,
      );

      expect(title).toBe(words["Search engine"]);
      expect(title).not.toBe(words[SEARCH]);
    },
  );

  test("a family the Dashboard does not know reads as stored, and none as nothing", () => {
    const de: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("de");

    expect(getDataStoreFamilyTitle(de, "Ledger")).toBe("Ledger");
    expect(getDataStoreFamilyTitle(de, undefined)).toBe("");
    expect(getDataStoreFamilyTitle(dashboardTranslator("en"), "Search")).toBe(
      "Search engine",
    );
  });

  test("German's words, as reviewed", () => {
    const de: Record<string, string> = readDashboardLocale("de");

    expect(de[SEARCH]).toBe("Suchen");
    expect(de["Search query"]).toBe("Suchabfrage");
    expect(de["Retrieval"]).toBe("Abruf");
    expect(de["Search engine"]).toBe("Suchmaschine");
  });
});
