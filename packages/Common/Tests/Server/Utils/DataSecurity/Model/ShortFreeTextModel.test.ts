import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { EntityRecognizer } from "../../../../../Server/Utils/DataSecurity/Model/EntityRecognizer";
import { ModelBudget } from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  closeNameAddressRecognizer,
  getNameAddressRecognizer,
  RecognizerAvailability,
} from "../../../../../Server/Utils/DataSecurity/Model/NameAddressRecognizer";
import {
  getValuesForModel,
  isReadByModel,
} from "../../../../../Utils/DataSecurity/FieldClassifier";
import { RecognizedEntity } from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";
import { fetchModelIntoCache } from "./ModelCache";
import { SCORED_TYPES } from "./NamesAndAddressesEvaluation";
import {
  averageWords,
  casesOf,
  loadShortFreeTextSet,
  ShortField,
  ShortScores,
  scoreShortFields,
} from "./ShortFreeTextEvaluation";

/*
 * THE REAL MODEL ON SHORT VALUES (#10927).
 *
 * A column of short notes - "Called Jonas Becker about the late invoice" -
 * averages less than the 80 characters the model's free text was, and was
 * never read. Before the rule was widened, it was measured on short,
 * catalog-like values in seven languages, where a brand's or a character's
 * name the model reads as a person's would be a Medium finding: the rule
 * the issue suggested, fields of four or more words, reads product names
 * and titles and makes a false name of "Ralph Lauren" and "Tom Sawyer".
 * The rule chosen reads a short field when its name says a person wrote
 * free text in it (FreeTextFieldNames). These hold it to what was
 * measured (ShortFreeTextBaseline.json) and to the bar the model was
 * chosen by in #10373: precision of at least 0.90 over all languages and
 * 0.85 in each, recall of at least 0.70, at most 20 false findings per
 * 1,000 values that hold neither. A change that lowers one fails.
 */

interface Scores {
  precision: number;
  recall: number;
}

interface RuleBaseline {
  fieldsRead: number;
  catalogValuesRead: number;
  falseFindingsPerThousandNegatives: number;
  languages: Record<string, Record<string, Scores>>;
}

const BASELINE: {
  namedForFreeText: RuleBaseline;
  atLeastFourWords: RuleBaseline & { catalogFalseFindings: number };
} = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ShortFreeTextBaseline.json"), "utf8"),
);

const LANGUAGES: Array<string> = ["en", "es", "de", "fr", "it", "pt", "nl"];

let found: Map<string, Array<RecognizedEntity>> = new Map();

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

beforeAll(async () => {
  const directory: string = await fetchModelIntoCache();

  await closeNameAddressRecognizer();

  const availability: RecognizerAvailability = await getNameAddressRecognizer({
    directory,
  });

  if (!("recognizer" in availability)) {
    throw new Error(`The model did not load: ${availability.reason}`);
  }

  const recognizer: EntityRecognizer = availability.recognizer;
  const texts: Array<string> = loadShortFreeTextSet().flatMap(
    (field: ShortField): Array<string> => {
      return casesOf(field).map((testCase: { text: string }): string => {
        return testCase.text;
      });
    },
  );

  // Every value once: each rule is scored on what the model found in it.
  found = await recognizer.recognize(
    texts,
    new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs: 1e9 }).forStore(
      "short",
    ),
  );
}, 600000);

afterAll(async () => {
  await closeNameAddressRecognizer();
});

function entitiesOf(text: string): ReadonlyArray<RecognizedEntity> {
  return found.get(text) || [];
}

// The scanner's own rule: what it hands the model of each field.
function scoreChosenRule(): ShortScores {
  return scoreShortFields({
    fields: loadShortFreeTextSet(),
    isRead: (field: ShortField, texts: Array<string>): boolean => {
      return isReadByModel(texts, {}, field.name);
    },
    entitiesOf,
  });
}

describe("the names-and-addresses model on short values", () => {
  test("reads every short note column of the seven languages, and no catalog column", () => {
    const fields: Array<ShortField> = loadShortFreeTextSet();

    for (const field of fields) {
      const texts: Array<string> = casesOf(field).map(
        (testCase: { text: string }): string => {
          return testCase.text;
        },
      );

      expect({
        field: `${field.language}:${field.name}`,
        read: getValuesForModel(texts, { fieldPath: field.name }).length > 0,
      }).toEqual({
        field: `${field.language}:${field.name}`,
        read: field.kind === "notes",
      });
    }
  });

  test("holds its precision and recall per language at what was measured, and the bar", () => {
    const scores: ShortScores = scoreChosenRule();
    const baseline: RuleBaseline = BASELINE.namedForFreeText;

    expect(scores.catalogValuesRead).toBe(0);
    expect(scores.fieldsRead).toBe(baseline.fieldsRead);

    for (const language of [...LANGUAGES, "all"]) {
      for (const dataTypeId of SCORED_TYPES) {
        const measured: Scores = {
          precision: round(scores.languages[language]![dataTypeId].precision),
          recall: round(scores.languages[language]![dataTypeId].recall),
        };
        const floor: Scores = baseline.languages[language]![dataTypeId]!;

        expect({ language, dataTypeId, ...measured }).toEqual({
          language,
          dataTypeId,
          precision: Math.max(measured.precision, floor.precision),
          recall: Math.max(measured.recall, floor.recall),
        });
        // The bar the model was chosen by: 0.85 in each language, 0.90 over all.
        expect({
          language,
          dataTypeId,
          meetsBar:
            measured.precision >= (language === "all" ? 0.9 : 0.85) &&
            measured.recall >= 0.7,
        }).toEqual({ language, dataTypeId, meetsBar: true });
      }
    }

    expect(scores.falseFindingsPerThousandNegatives).toBeLessThanOrEqual(
      Math.min(20, baseline.falseFindingsPerThousandNegatives),
    );
  });

  test("the rule the issue suggested, four or more words, is what was measured: it reads catalogs, and falls below the bar", () => {
    const scores: ShortScores = scoreShortFields({
      fields: loadShortFreeTextSet(),
      isRead: (_field: ShortField, texts: Array<string>): boolean => {
        return averageWords(texts) >= 4;
      },
      entitiesOf,
    });
    const measured: RuleBaseline & { catalogFalseFindings: number } =
      BASELINE.atLeastFourWords;

    expect({
      catalogValuesRead: scores.catalogValuesRead,
      catalogFalseFindings: scores.catalogFalseFindings,
      falseFindingsPerThousandNegatives:
        Math.round(scores.falseFindingsPerThousandNegatives * 10) / 10,
      namesPrecision: round(scores.languages["all"]!["person-name"].precision),
    }).toEqual({
      catalogValuesRead: measured.catalogValuesRead,
      catalogFalseFindings: measured.catalogFalseFindings,
      falseFindingsPerThousandNegatives:
        measured.falseFindingsPerThousandNegatives,
      namesPrecision: measured.languages["all"]!["person-name"]!.precision,
    });
  });
});
