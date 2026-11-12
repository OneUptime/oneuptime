import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SEARCH_FIELD_TITLE,
  SEARCH_STEP_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import {
  ConnectorField,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE SEARCH A SPLUNK CONNECTION RUNS AND A HUNT KEEPS IS A NOUN (#6888).
 * Splunk Enterprise Security's search setting and a hunt's Search step and
 * field were titled with the "Search" key, which the Dashboard's languages
 * translate as the Search button's verb: German labelled the setting
 * "Suchen", French "Rechercher", Hindi "खोजें", where the setting holds a
 * search query. They are titled "Search query" now, a noun in each
 * language, and the button keeps its verb.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const SEARCH_QUERY: string = "Search query";
const SEARCH: string = "Search";

// Each language's reviewed words for a search query, the setting's title.
const REVIEWED: Record<string, string> = {
  de: "Suchabfrage",
  fr: "Requête de recherche",
  es: "Consulta de búsqueda",
  it: "Query di ricerca",
  pt: "Consulta de pesquisa",
  nl: "Zoekopdracht",
  da: "Søgeforespørgsel",
  no: "Søkespørring",
  sv: "Sökfråga",
  hi: "खोज क्वेरी",
  ru: "Поисковый запрос",
  ja: "検索クエリ",
  ko: "검색 쿼리",
  "zh-CN": "搜索查询",
  "zh-TW": "搜尋查詢",
  fa: "عبارت جستجو",
  ar: "استعلام البحث",
};

/*
 * The languages whose "Search" is the button's verb - an infinitive or an
 * imperative - which the setting must never be titled with.
 */
const SEARCH_IS_A_VERB: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "hi",
];

// What is wrong with how a locale titles the setting, if anything.
function searchQueryProblems(locale: Record<string, string>): Array<string> {
  const problems: Array<string> = [];
  const searchQuery: string | undefined = locale[SEARCH_QUERY];
  const search: string | undefined = locale[SEARCH];

  if (!searchQuery) {
    problems.push("not worded");
  } else if (searchQuery === ENGLISH[SEARCH_QUERY]) {
    problems.push("kept the English");
  } else if (search && searchQuery.toLowerCase() === search.toLowerCase()) {
    problems.push(`the Search button's word, ${search}`);
  }

  return problems;
}

function splunkSearchSetting(): ConnectorField {
  return getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
  ).configFields.find((field: ConnectorField): boolean => {
    return field.key === "searchString";
  }) as ConnectorField;
}

describe("a search query's title, in every language", () => {
  test("Splunk's search setting and a hunt's Search step and field are titled Search query, never the Search button's word", () => {
    expect(splunkSearchSetting().title).toBe(SEARCH_QUERY);
    expect(SEARCH_STEP_TITLE).toBe(SEARCH_QUERY);
    expect(SEARCH_FIELD_TITLE).toBe(SEARCH_QUERY);
    expect(ENGLISH[SEARCH_QUERY]).toBe(SEARCH_QUERY);
  });

  test("every Dashboard language has reviewed words for it", () => {
    expect(Object.keys(REVIEWED).sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words it as a noun, apart from the Search button",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      expect({ language, problems: searchQueryProblems(locale) }).toEqual({
        language,
        problems: [],
      });
      expect(locale[SEARCH_QUERY]).toBe(REVIEWED[language]);
    },
  );

  test("the languages whose Search is a verb keep it for the button, and the setting does not start with it", () => {
    for (const language of SEARCH_IS_A_VERB) {
      const locale: Record<string, string> = readLocale(language);
      const verb: string = locale[SEARCH] as string;
      const title: string = locale[SEARCH_QUERY] as string;

      expect({ language, verb: Boolean(verb) }).toEqual({
        language,
        verb: true,
      });
      expect({
        language,
        startsWithVerb: title
          .toLowerCase()
          .startsWith(`${verb.toLowerCase()} `),
      }).toEqual({ language, startsWithVerb: false });
    }
  });

  test("a locale that titled the setting with the button's verb, or kept the English, is caught", () => {
    const german: Record<string, string> = readLocale("de");

    expect(
      searchQueryProblems({
        ...german,
        [SEARCH_QUERY]: german[SEARCH] as string,
      }),
    ).toEqual(["the Search button's word, Suchen"]);
    expect(
      searchQueryProblems({ ...german, [SEARCH_QUERY]: "suchen" }),
    ).toEqual(["the Search button's word, Suchen"]);
    expect(
      searchQueryProblems({ ...german, [SEARCH_QUERY]: SEARCH_QUERY }),
    ).toEqual(["kept the English"]);

    const withoutIt: Record<string, string> = { ...german };
    delete withoutIt[SEARCH_QUERY];

    expect(searchQueryProblems(withoutIt)).toEqual(["not worded"]);
  });
});
