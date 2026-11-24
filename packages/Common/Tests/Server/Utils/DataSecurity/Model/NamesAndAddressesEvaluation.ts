import fs from "fs";
import path from "path";
import {
  RecognizedDataTypeId,
  RecognizedEntity,
} from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";

/*
 * HOW THE NAMES-AND-ADDRESSES MODEL IS SCORED.
 *
 * The test set (Tests/Utils/DataSecurity/Model/NamesAndAddressesTestSet.json)
 * marks each person's name [[N:...]] and street address [[A:...]] in a
 * sentence. A finding is right when it overlaps a marked span of its type; a
 * marked span is found when a finding of its type overlaps it. Precision is
 * right findings over all findings, recall found spans over all spans, per
 * language and over all of them - the measure the model was chosen by, and
 * the one the docs' table gives.
 */

export interface GoldSpan {
  start: number;
  end: number;
  dataTypeId: RecognizedDataTypeId;
}

export interface TestCase {
  language: string;
  text: string;
  gold: Array<GoldSpan>;
}

export interface TypeScore {
  precision: number;
  recall: number;
  findings: number;
  right: number;
  spans: number;
  found: number;
}

export type LanguageScores = Record<
  string,
  Record<RecognizedDataTypeId, TypeScore>
>;

const MARK: RegExp = /\[\[([NA]):(.+?)\]\]/g;

export const TEST_SET_PATH: string = path.join(
  __dirname,
  "../../../../Utils/DataSecurity/Model/NamesAndAddressesTestSet.json",
);

export function parseCase(language: string, marked: string): TestCase {
  let text: string = "";
  const gold: Array<GoldSpan> = [];
  let last: number = 0;

  for (const match of marked.matchAll(MARK)) {
    text += marked.slice(last, match.index);

    const start: number = text.length;

    text += match[2]!;
    gold.push({
      start,
      end: text.length,
      dataTypeId: match[1] === "N" ? "person-name" : "postal-address",
    });
    last = match.index! + match[0].length;
  }

  text += marked.slice(last);

  return { language, text, gold };
}

export function loadTestSet(): Array<TestCase> {
  const data: { cases: Array<{ language: string; text: string }> } = JSON.parse(
    fs.readFileSync(TEST_SET_PATH, "utf8"),
  );

  return data.cases.map(
    (item: { language: string; text: string }): TestCase => {
      return parseCase(item.language, item.text);
    },
  );
}

function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

function emptyScore(): TypeScore {
  return { precision: 0, recall: 0, findings: 0, right: 0, spans: 0, found: 0 };
}

export const SCORED_TYPES: ReadonlyArray<RecognizedDataTypeId> = [
  "person-name",
  "postal-address",
];

// Scores by language, and over all of them as "all".
export function scoreFindings(
  cases: ReadonlyArray<TestCase>,
  findings: ReadonlyArray<ReadonlyArray<RecognizedEntity>>,
): LanguageScores {
  const scores: LanguageScores = {};

  const scoreOf: (
    language: string,
    dataTypeId: RecognizedDataTypeId,
  ) => TypeScore = (
    language: string,
    dataTypeId: RecognizedDataTypeId,
  ): TypeScore => {
    if (!scores[language]) {
      scores[language] = {
        "person-name": emptyScore(),
        "postal-address": emptyScore(),
      };
    }

    return scores[language]![dataTypeId];
  };

  cases.forEach((testCase: TestCase, index: number): void => {
    const found: ReadonlyArray<RecognizedEntity> = findings[index] || [];

    for (const dataTypeId of SCORED_TYPES) {
      const gold: Array<GoldSpan> = testCase.gold.filter(
        (span: GoldSpan): boolean => {
          return span.dataTypeId === dataTypeId;
        },
      );
      const mine: Array<RecognizedEntity> = found.filter(
        (entity: RecognizedEntity): boolean => {
          return entity.dataTypeId === dataTypeId;
        },
      );

      for (const language of [testCase.language, "all"]) {
        const score: TypeScore = scoreOf(language, dataTypeId);

        score.spans += gold.length;
        score.findings += mine.length;
        score.right += mine.filter((entity: RecognizedEntity): boolean => {
          return gold.some((span: GoldSpan): boolean => {
            return overlaps(entity, span);
          });
        }).length;
        score.found += gold.filter((span: GoldSpan): boolean => {
          return mine.some((entity: RecognizedEntity): boolean => {
            return overlaps(entity, span);
          });
        }).length;
      }
    }
  });

  for (const byType of Object.values(scores)) {
    for (const score of Object.values(byType)) {
      score.precision = score.findings > 0 ? score.right / score.findings : 1;
      score.recall = score.spans > 0 ? score.found / score.spans : 1;
    }
  }

  return scores;
}

// Findings in the sentences that hold neither, per 1,000 such sentences.
export function falseFindingsPerThousandNegatives(
  cases: ReadonlyArray<TestCase>,
  findings: ReadonlyArray<ReadonlyArray<RecognizedEntity>>,
): number {
  let negatives: number = 0;
  let falseFindings: number = 0;

  cases.forEach((testCase: TestCase, index: number): void => {
    if (testCase.gold.length === 0) {
      negatives++;
      falseFindings += (findings[index] || []).length;
    }
  });

  return negatives > 0 ? (falseFindings / negatives) * 1000 : 0;
}
