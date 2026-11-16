import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  TranslateFn,
  makeT,
} from "../../../FeatureSet/APIReference/Utils/I18n";
import { PAGE_FIXTURES, PageFixture, renderPage } from "./ReferenceFixtures";
import Alert from "Common/Models/DatabaseModels/Alert";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import SortValidator from "Common/Server/Types/Database/Permissions/SortValidator";
import BadDataException from "Common/Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE API REFERENCE SAYS HOW TO SORT BY A RELATED RECORD (#8141).
 *
 * `sort: { incidentSeverity: "DESC" }` failed a list with a 500. The server
 * refuses it now, as bad data that says which field to send, and the
 * reference says so before anyone sends it: the Data Types page's Sort
 * section shows a sort through a relation ({ relation: { field: "ASC" } }),
 * says why a relation given only a direction and a relation of many
 * records are refused, and says how to put records with no value last.
 * The model page's sort row links to that section - it linked to Select.
 *
 * Held here in every language the reference is offered in, and against the
 * server: every sort the page shows is one the server takes, and the ones
 * it warns about, the server refuses.
 */

const REFERENCE_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "APIReference",
);

const CODE_EXAMPLES: string = path.join(REFERENCE_ROOT, "CodeExamples");

const readExample: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(CODE_EXAMPLES, "DataTypes", name), "utf8");
};

// The Data Types page, with the sort examples the service reads.
const DATA_TYPES_PAGE: PageFixture = {
  page: "data-types",
  slug: "data-types",
  pageData: {
    ...Object.fromEntries(
      [
        "select",
        "equalTo",
        "notEqualTo",
        "isNull",
        "notNull",
        "greaterThan",
        "greaterThanOrEqual",
        "lessThan",
        "lessThanOrEqual",
        "includes",
      ].map((sample: string): [string, string] => {
        return [`${sample}Code`, '{ "query": {} }'];
      }),
    ),
    sortCode: readExample("Sort.md"),
    sortThroughRelationCode: readExample("SortThroughRelation.md"),
  },
};

// The JSON a string shows as code: every <code>{ ... }</code> in it, parsed.
const codeSamplesOf: (text: string) => Array<unknown> = (
  text: string,
): Array<unknown> => {
  return Array.from(text.matchAll(/<code>(\{[^<]*\})<\/code>/g)).map(
    (match: RegExpMatchArray): unknown => {
      return JSON.parse(match[1]!);
    },
  );
};

// The text of every <code> in a string, as written.
const codeTextsOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(text.matchAll(/<code>([^<]*)<\/code>/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
};

const refusalOf: (
  modelType: { new (): BaseModel },
  sort: unknown,
) => BadDataException | null = (
  modelType: { new (): BaseModel },
  sort: unknown,
): BadDataException | null => {
  try {
    SortValidator.checkSort({
      modelType: modelType,
      sort: sort,
      props: { isRoot: true },
    });

    return null;
  } catch (error) {
    if (error instanceof BadDataException) {
      return error;
    }

    throw error;
  }
};

const ENGLISH: TranslateFn = makeT("en");

describe.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
  "the Data Types page in %s",
  (language: string) => {
    const t: TranslateFn = makeT(language);

    test("has a part on sorting by a related record, after Sort and before Query", async () => {
      const html: string = await renderPage(DATA_TYPES_PAGE, {
        lang: language,
      });

      const sort: number = html.indexOf('id="sort"');
      const relation: number = html.indexOf('id="sort-by-a-related-record"');
      const queries: number = html.indexOf('id="queries"');

      expect(sort).toBeGreaterThan(-1);
      expect(relation).toBeGreaterThan(sort);
      expect(queries).toBeGreaterThan(relation);
    });

    test("draws its examples as code, not as tags", async () => {
      const html: string = await renderPage(DATA_TYPES_PAGE, {
        lang: language,
      });

      expect(html).toContain(
        '<code>{ "incidentSeverity": { "order": "ASC" } }</code>',
      );
      expect(html).toContain(
        '<code>{ "direction": "DESC", "nulls": "LAST" }</code>',
      );
      expect(html).not.toContain("&lt;code&gt;");
    });

    test("shows the example request body of a sort through a relation", async () => {
      const html: string = await renderPage(DATA_TYPES_PAGE, {
        lang: language,
      });

      expect(html).toContain(
        t("pages.dataTypesGuide.exampleSortThroughRelationTitle"),
      );
      // The code block escapes the JSON's quotes.
      expect(html).toContain("&#34;incidentSeverity&#34;: {");
    });

    test("no longer says a sort's field is retrieved when a boolean is true - that is Select's", () => {
      expect(t("pages.dataTypesGuide.sortDescription")).not.toEqual(
        expect.stringContaining("true"),
      );
    });

    test("shows exactly the code English shows: a translation names no other field", () => {
      for (const key of [
        "pages.dataTypesGuide.sortDescription",
        "pages.dataTypesGuide.sortThroughRelationBody",
      ]) {
        expect([key, codeTextsOf(t(key))]).toEqual([
          key,
          codeTextsOf(ENGLISH(key)),
        ]);
      }
    });

    test("the model page's sort row links to the Sort section, in words that say sort", async () => {
      const html: string = await renderPage(PAGE_FIXTURES["model"]!, {
        lang: language,
      });

      expect(html).toContain(
        `href="/reference/${language}/data-types#sort">${t("pages.model.checkSortLink")}</a>`,
      );
      // Select's row still links to Select.
      expect(html).toContain(
        `href="/reference/${language}/data-types#select">${t("pages.model.checkSelectLink")}</a>`,
      );
      expect(t("pages.model.checkSortLink")).not.toBe(
        t("pages.model.checkSelectLink"),
      );
    });
  },
);

describe("every sort the reference shows is what the server does", () => {
  test("the example request body sorts incidents through their severity, and by a date with no value last", () => {
    const body: { sort: unknown } = JSON.parse(
      readExample("SortThroughRelation.md"),
    );

    expect(body.sort).toEqual({
      incidentSeverity: { order: "ASC" },
      declaredAt: { direction: "DESC", nulls: "LAST" },
    });
    expect(refusalOf(Incident, body.sort)).toBeNull();
  });

  test("the sorts the text says work, work - and the one it says is refused, is", () => {
    const [bySeverity, byMonitorName, severityAlone] = codeSamplesOf(
      ENGLISH("pages.dataTypesGuide.sortThroughRelationBody"),
    );

    expect(bySeverity).toEqual({ incidentSeverity: { order: "ASC" } });
    expect(refusalOf(Incident, bySeverity)).toBeNull();

    expect(byMonitorName).toEqual({ monitor: { name: "ASC" } });
    expect(refusalOf(Alert, byMonitorName)).toBeNull();

    expect(severityAlone).toEqual({ incidentSeverity: "DESC" });
    expect(refusalOf(Incident, severityAlone)).toBeInstanceOf(BadDataException);
  });

  test("a relation of many records, which the text says cannot sort a list, cannot", () => {
    expect(
      codeTextsOf(ENGLISH("pages.dataTypesGuide.sortThroughRelationBody")),
    ).toContain("labels");
    expect(refusalOf(Incident, { labels: { name: "ASC" } })).toBeInstanceOf(
      BadDataException,
    );
  });

  test("the order that puts records with no value last is one a field takes", () => {
    const [nullsLast] = codeSamplesOf(
      ENGLISH("pages.dataTypesGuide.sortDescription"),
    );

    expect(nullsLast).toEqual({ direction: "DESC", nulls: "LAST" });
    expect(refusalOf(Incident, { declaredAt: nullsLast })).toBeNull();
  });

  test("the plain example sorts by a field and a direction", () => {
    expect(readExample("Sort.md")).toContain('"name": "ASC"');
  });
});
