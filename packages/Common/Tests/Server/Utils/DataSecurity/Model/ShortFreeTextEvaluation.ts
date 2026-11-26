import fs from "fs";
import path from "path";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import { getHintedDataTypeIds } from "../../../../../Utils/DataSecurity/FieldNameHints";
import {
  RecognizedDataTypeId,
  RecognizedEntity,
} from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../../../Utils/DataSecurity/TextScanner";
import {
  GoldSpan,
  parseCase,
  SCORED_TYPES,
  TestCase,
} from "./NamesAndAddressesEvaluation";

/*
 * HOW THE MODEL IS SCORED ON SHORT VALUES (#10927).
 *
 * The short set (Tests/Utils/DataSecurity/Model/ShortFreeTextTestSet.json)
 * is columns of a database in seven languages: catalog-like ones - product
 * names, titles, labels, job titles, store names - where a brand's, a
 * character's or a street's name is no finding, and short note ones with
 * the people's names [[N:...]] and street addresses [[A:...]] they hold
 * marked. A rule says which columns the model reads; of those, a value's
 * findings are what the scanner makes of what the model found in it -
 * Medium or above, not a test value, the column's name as its context -
 * and a finding is right when it overlaps a marked span of its type, as
 * the long set is scored. Precision and recall by language and over all
 * seven; false findings per 1,000 read values that hold neither.
 */

export interface ShortField {
  language: string;
  name: string;
  kind: "catalog" | "notes";
  values: Array<string>;
}

export const SHORT_SET_PATH: string = path.join(
  __dirname,
  "../../../../Utils/DataSecurity/Model/ShortFreeTextTestSet.json",
);

export function loadShortFreeTextSet(): Array<ShortField> {
  return (
    JSON.parse(fs.readFileSync(SHORT_SET_PATH, "utf8")) as {
      fields: Array<ShortField>;
    }
  ).fields;
}

// A field's values with their marks taken out, and where the marks were.
export function casesOf(field: ShortField): Array<TestCase> {
  return field.values.map((value: string): TestCase => {
    return parseCase(field.language, value);
  });
}

export interface ShortTypeScore {
  findings: number;
  right: number;
  spans: number;
  found: number;
  precision: number;
  recall: number;
}

export interface ShortScores {
  languages: Record<string, Record<RecognizedDataTypeId, ShortTypeScore>>;
  fieldsRead: number;
  catalogValuesRead: number;
  catalogFalseFindings: number;
  negatives: number;
  falseFindings: number;
  falseFindingsPerThousandNegatives: number;
}

function emptyScore(): ShortTypeScore {
  return {
    findings: 0,
    right: 0,
    spans: 0,
    found: 0,
    precision: 1,
    recall: 1,
  };
}

function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

// The findings the scanner makes of what the model found in a value of a field.
export function findingsOf(
  fieldName: string,
  text: string,
  entities: ReadonlyArray<RecognizedEntity>,
): Array<TextMatch> {
  return findSensitiveValues(
    text,
    { detectors: [], hintedDataTypeIds: getHintedDataTypeIds(fieldName) },
    entities,
  ).filter((match: TextMatch): boolean => {
    return (
      match.fromModel === true &&
      !match.isTestValue &&
      match.confidence !== DataConfidence.Low
    );
  });
}

export function scoreShortFields(data: {
  fields: ReadonlyArray<ShortField>;
  // Whether the rule has the model read this field.
  isRead: (field: ShortField, texts: Array<string>) => boolean;
  // What the model found in a text it read.
  entitiesOf: (text: string) => ReadonlyArray<RecognizedEntity>;
}): ShortScores {
  const scores: ShortScores = {
    languages: {},
    fieldsRead: 0,
    catalogValuesRead: 0,
    catalogFalseFindings: 0,
    negatives: 0,
    falseFindings: 0,
    falseFindingsPerThousandNegatives: 0,
  };

  const scoreOf: (
    language: string,
    dataTypeId: RecognizedDataTypeId,
  ) => ShortTypeScore = (
    language: string,
    dataTypeId: RecognizedDataTypeId,
  ): ShortTypeScore => {
    if (!scores.languages[language]) {
      scores.languages[language] = {
        "person-name": emptyScore(),
        "postal-address": emptyScore(),
      };
    }

    return scores.languages[language]![dataTypeId];
  };

  for (const field of data.fields) {
    const cases: Array<TestCase> = casesOf(field);
    const isRead: boolean = data.isRead(
      field,
      cases.map((testCase: TestCase): string => {
        return testCase.text;
      }),
    );

    if (isRead) {
      scores.fieldsRead++;
    }

    for (const testCase of cases) {
      const matches: Array<TextMatch> = isRead
        ? findingsOf(field.name, testCase.text, data.entitiesOf(testCase.text))
        : [];

      if (isRead && field.kind === "catalog") {
        scores.catalogValuesRead++;
        scores.catalogFalseFindings += matches.length;
      }

      if (isRead && testCase.gold.length === 0) {
        scores.negatives++;
        scores.falseFindings += matches.length;
      }

      for (const dataTypeId of SCORED_TYPES) {
        const gold: Array<GoldSpan> = testCase.gold.filter(
          (span: GoldSpan): boolean => {
            return span.dataTypeId === dataTypeId;
          },
        );
        const mine: Array<TextMatch> = matches.filter(
          (match: TextMatch): boolean => {
            return match.dataTypeId === dataTypeId;
          },
        );

        for (const language of [field.language, "all"]) {
          const score: ShortTypeScore = scoreOf(language, dataTypeId);

          score.spans += gold.length;
          score.findings += mine.length;
          score.right += mine.filter((match: TextMatch): boolean => {
            return gold.some((span: GoldSpan): boolean => {
              return overlaps(match, span);
            });
          }).length;
          score.found += gold.filter((span: GoldSpan): boolean => {
            return mine.some((match: TextMatch): boolean => {
              return overlaps(match, span);
            });
          }).length;
        }
      }
    }
  }

  for (const byType of Object.values(scores.languages)) {
    for (const score of Object.values(byType)) {
      score.precision = score.findings > 0 ? score.right / score.findings : 1;
      score.recall = score.spans > 0 ? score.found / score.spans : 1;
    }
  }

  scores.falseFindingsPerThousandNegatives =
    scores.negatives > 0 ? (scores.falseFindings / scores.negatives) * 1000 : 0;

  return scores;
}

// Average words of a field's values: the rule the issue suggested reads four or more.
export function averageWords(texts: ReadonlyArray<string>): number {
  if (texts.length === 0) {
    return 0;
  }

  return (
    texts.reduce((sum: number, text: string): number => {
      return sum + text.trim().split(/\s+/).length;
    }, 0) / texts.length
  );
}
