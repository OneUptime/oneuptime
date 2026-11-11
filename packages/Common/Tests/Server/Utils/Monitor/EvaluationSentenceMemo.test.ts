import EvaluationSentenceMemo from "../../../../Server/Utils/Monitor/EvaluationSentenceMemo";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  translatableSentence,
} from "../../../../Types/Monitor/EvaluationSentence";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE MEMO OF WHICH SENTENCE A FINDING WAS FILLED FROM, AND ITS BOUND.
 *
 * Checkers return a finding's English; the memo keeps the sentence each
 * English was filled from, so the evaluator can store the sentence beside
 * the finding (issue #6542). It holds the newest MAX_REMEMBERED findings and
 * evicts the oldest through OldestKeyMap (OldestKeyEvictionGuard keeps
 * keys().next() eviction out of the product): these hold it to remembering,
 * finding, evicting the oldest first, keeping a finding that is written
 * again, and to its bound under churn.
 */

const MAX: number = EvaluationSentenceMemo.MAX_REMEMBERED;

// A finding of its own, numbered: "Response Time was 7 ms, ..."
function finding(index: number): EvaluationSentence {
  return translatableSentence(
    "{{value}} was {{index}}, above the {{threshold}} threshold.",
    {
      value: "Response Time",
      index: index,
      threshold: 100,
    },
  );
}

function englishOf(index: number): string {
  return englishOfEvaluationSentence(finding(index));
}

beforeEach(() => {
  EvaluationSentenceMemo.clear();
});

afterEach(() => {
  EvaluationSentenceMemo.clear();
});

describe("EvaluationSentenceMemo remembers each finding's sentence", () => {
  test("write returns the sentence's English and remembers the sentence under it", () => {
    const sentence: EvaluationSentence = finding(1);
    const english: string = EvaluationSentenceMemo.write(sentence);

    expect(english).toBe("Response Time was 1, above the 100 threshold.");
    expect(english).toBe(englishOfEvaluationSentence(sentence));
    expect(EvaluationSentenceMemo.find(english)).toEqual(sentence);
    expect(EvaluationSentenceMemo.size()).toBe(1);
  });

  test("a finding no helper wrote as a sentence is not found", () => {
    EvaluationSentenceMemo.write(finding(1));

    expect(
      EvaluationSentenceMemo.find("Response Time was 1 ms."),
    ).toBeUndefined();
    expect(EvaluationSentenceMemo.find("")).toBeUndefined();
    expect(EvaluationSentenceMemo.find(null)).toBeUndefined();
    expect(EvaluationSentenceMemo.find(undefined)).toBeUndefined();
  });

  test("an empty English is never remembered", () => {
    EvaluationSentenceMemo.remember("", finding(1));

    expect(EvaluationSentenceMemo.size()).toBe(0);
  });

  test("the same English written twice is one finding, filled from the newer sentence", () => {
    const first: EvaluationSentence = finding(1);
    const again: EvaluationSentence =
      translatableSentence("Request timed out.");

    EvaluationSentenceMemo.remember("Shared text", first);
    EvaluationSentenceMemo.remember("Shared text", again);

    expect(EvaluationSentenceMemo.size()).toBe(1);
    expect(EvaluationSentenceMemo.find("Shared text")).toEqual(again);
  });

  test("clear forgets every finding", () => {
    EvaluationSentenceMemo.write(finding(1));
    EvaluationSentenceMemo.write(finding(2));

    EvaluationSentenceMemo.clear();

    expect(EvaluationSentenceMemo.size()).toBe(0);
    expect(EvaluationSentenceMemo.find(englishOf(1))).toBeUndefined();
  });
});

describe("EvaluationSentenceMemo holds the newest MAX_REMEMBERED findings", () => {
  test("its bound is the documented 2,000 findings", () => {
    expect(MAX).toBe(2000);
  });

  test("a full memo keeps every finding it holds", () => {
    for (let index: number = 0; index < MAX; index++) {
      EvaluationSentenceMemo.write(finding(index));
    }

    expect(EvaluationSentenceMemo.size()).toBe(MAX);
    expect(EvaluationSentenceMemo.find(englishOf(0))).toEqual(finding(0));
    expect(EvaluationSentenceMemo.find(englishOf(MAX - 1))).toEqual(
      finding(MAX - 1),
    );
  });

  test("one more finding evicts the oldest, and only the oldest", () => {
    for (let index: number = 0; index <= MAX; index++) {
      EvaluationSentenceMemo.write(finding(index));
    }

    expect(EvaluationSentenceMemo.size()).toBe(MAX);
    expect(EvaluationSentenceMemo.find(englishOf(0))).toBeUndefined();
    expect(EvaluationSentenceMemo.find(englishOf(1))).toEqual(finding(1));
    expect(EvaluationSentenceMemo.find(englishOf(MAX))).toEqual(finding(MAX));
  });

  test("a finding written again moves to the newest end and outlives those written after it once", () => {
    for (let index: number = 0; index < MAX; index++) {
      EvaluationSentenceMemo.write(finding(index));
    }

    // Seen again on the next check: it is now the newest.
    EvaluationSentenceMemo.write(finding(0));

    // Room for one more, so the oldest now (finding 1) goes, not finding 0.
    EvaluationSentenceMemo.write(finding(MAX));

    expect(EvaluationSentenceMemo.size()).toBe(MAX);
    expect(EvaluationSentenceMemo.find(englishOf(0))).toEqual(finding(0));
    expect(EvaluationSentenceMemo.find(englishOf(1))).toBeUndefined();
    expect(EvaluationSentenceMemo.find(englishOf(2))).toEqual(finding(2));
  });

  test("under churn it evicts oldest first and stays at its bound", () => {
    const written: number = MAX * 5 + 17;

    for (let index: number = 0; index < written; index++) {
      EvaluationSentenceMemo.write(finding(index));

      expect(EvaluationSentenceMemo.size()).toBe(Math.min(index + 1, MAX));
    }

    // Exactly the newest MAX are left: the one before them is gone.
    expect(EvaluationSentenceMemo.find(englishOf(written - MAX - 1))).toBe(
      undefined,
    );
    expect(EvaluationSentenceMemo.find(englishOf(written - MAX))).toEqual(
      finding(written - MAX),
    );
    expect(EvaluationSentenceMemo.find(englishOf(written - 1))).toEqual(
      finding(written - 1),
    );
  });

  test("a finding kept alive on every check survives any churn around it", () => {
    const kept: EvaluationSentence = translatableSentence("Request timed out.");

    for (let index: number = 0; index < MAX * 3; index++) {
      EvaluationSentenceMemo.write(finding(index));

      if (index % (MAX / 4) === 0) {
        EvaluationSentenceMemo.write(kept);
      }
    }

    expect(EvaluationSentenceMemo.size()).toBe(MAX);
    expect(EvaluationSentenceMemo.find("Request timed out.")).toEqual(kept);
  });
});
