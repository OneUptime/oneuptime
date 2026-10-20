import {
  getPatternWorkAllowance,
  getStoppedPatternQuestions,
  MAX_GRANTED_TEXTS,
  noteQuestionStoppedOutsideAllowance,
  PatternWorkAllowance,
  patternWorkRefusesQuestions,
  providePatternWorkAllowance,
  QUESTION_WORK,
  RULE_EVALUATION_WORK,
  TELEMETRY_BATCH_WORK,
  TELEMETRY_WORK_PER_CHARACTER,
  TELEMETRY_WORK_PER_TEXT,
  WORK_PER_TEXT_CHARACTER,
} from "../../../Utils/LinearRegExp/PatternWork";
import {
  PatternWorkAllowanceSpentError,
  PatternWorkLimitError,
} from "../../../Utils/LinearRegExp/PatternProblem";
import { WORK_PER_CODE_UNIT } from "../../../Utils/LinearRegExp/Matcher";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * ONE ALLOWANCE OF WORK FOR EVERY QUESTION OF ONE PIECE OF WORK.
 *
 * The patterns a project writes are asked many questions for one piece of
 * work - its rules of one kind for one new resource, its filters, scrub
 * rules and grok processors for one batch of telemetry. Each question is
 * bounded on its own (Matcher.ts, WorkMeter); together they share one
 * allowance (PatternWork.ts). These hold the allowance itself: what it
 * starts with, what adds to it, what it counts, and that once it is spent
 * every question stops - cheaply, and counted as a question with no answer.
 * ---------------------------------------------------------------------------
 */

function spentErrorOf(work: () => void): unknown {
  try {
    work();
  } catch (error: unknown) {
    return error;
  }

  return null;
}

afterEach(() => {
  providePatternWorkAllowance((): PatternWorkAllowance | undefined => {
    return undefined;
  });
});

describe("what an allowance starts with", () => {
  test("a rule evaluation starts with its pool, and a text asked about adds what one pattern alone may take on it", () => {
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forRuleEvaluation();

    expect(allowance.allowedWork).toBe(RULE_EVALUATION_WORK);
    expect(allowance.usedWork).toBe(0);
    expect(allowance.isSpent).toBe(false);
    expect(allowance.stoppedQuestions).toBe(0);

    // The share a character adds is what one pattern alone may take on it.
    expect(WORK_PER_TEXT_CHARACTER).toBe(WORK_PER_CODE_UNIT);
  });

  test("a batch of telemetry starts with its pool, and records add their share", () => {
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forTelemetryBatch();

    expect(allowance.allowedWork).toBe(TELEMETRY_BATCH_WORK);
    expect(TELEMETRY_WORK_PER_CHARACTER).toBe(WORK_PER_CODE_UNIT);
  });

  test("the pools are about half a second of plain work for a rule evaluation, and a third of one for a batch", () => {
    /*
     * A visit or a character read takes about ten nanoseconds; these are
     * the sizes the docs and the save-time limits are written for.
     */
    expect(RULE_EVALUATION_WORK).toBe(64_000_000);
    expect(TELEMETRY_BATCH_WORK).toBe(32_000_000);
    expect(TELEMETRY_WORK_PER_TEXT).toBe(64 * QUESTION_WORK);
  });
});

describe("what it counts, and what happens when it is spent", () => {
  test("work within the allowance is counted and stops nothing", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1000,
    });

    allowance.spend(400);
    allowance.spend(600);

    expect(allowance.usedWork).toBe(1000);
    expect(allowance.isSpent).toBe(false);
    expect(allowance.stoppedQuestions).toBe(0);
  });

  test("work past it stops the question with the allowance's own error, a PatternWorkLimitError", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1000,
    });

    allowance.spend(1000);

    const error: unknown = spentErrorOf((): void => {
      allowance.spend(1);
    });

    expect(error).toBeInstanceOf(PatternWorkAllowanceSpentError);
    // Every caller that handles a question's own limit handles this one.
    expect(error).toBeInstanceOf(PatternWorkLimitError);
    expect(allowance.isSpent).toBe(true);
    expect(allowance.stoppedQuestions).toBe(1);
  });

  test("every question after that stops too, with the same error made once - no stack per question", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 10,
    });

    const first: unknown = spentErrorOf((): void => {
      allowance.spend(11);
    });
    const later: Array<unknown> = [];

    for (let question: number = 0; question < 1000; question++) {
      later.push(
        spentErrorOf((): void => {
          allowance.beforeQuestion("text");
        }),
      );
    }

    for (const error of later) {
      expect(error).toBe(first);
    }

    expect(allowance.stoppedQuestions).toBe(1001);
  });

  test("a compile is counted after it, and stops nothing midway; the next question pays for it", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 100,
    });

    allowance.charge(500);

    expect(allowance.usedWork).toBe(500);
    expect(allowance.isSpent).toBe(true);
    expect(allowance.stoppedQuestions).toBe(0);

    expect(
      spentErrorOf((): void => {
        allowance.beforeQuestion("a title");
      }),
    ).toBeInstanceOf(PatternWorkAllowanceSpentError);
    expect(allowance.stoppedQuestions).toBe(1);
  });

  test("nothing is compiled once it is spent", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 100,
    });

    allowance.beforeCompile();
    expect(allowance.stoppedQuestions).toBe(0);

    allowance.charge(101);

    expect(
      spentErrorOf((): void => {
        allowance.beforeCompile();
      }),
    ).toBeInstanceOf(PatternWorkAllowanceSpentError);
    expect(allowance.stoppedQuestions).toBe(1);
  });

  test("a question pays what any question costs before it reads", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1000,
    });

    allowance.beforeQuestion("abc");
    allowance.beforeQuestion("abc");

    expect(allowance.usedWork).toBe(2 * QUESTION_WORK);
  });

  test("a question that stops at its own limit is counted as one with no answer", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1000,
    });

    allowance.noteStopped();
    allowance.noteStopped();

    expect(allowance.stoppedQuestions).toBe(2);
    expect(allowance.isSpent).toBe(false);
  });
});

describe("texts a rule evaluation's questions read", () => {
  test("a text adds its share the first time it is asked about, and never again", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
      workPerCharacterOfTextAsked: 128,
    });
    const title: string = "Checkout API latency above threshold";

    allowance.grantText(title);
    allowance.grantText(title);
    allowance.beforeQuestion(title);

    expect(allowance.allowedWork).toBe(128 * title.length);

    allowance.grantText(`${title}!`);

    expect(allowance.allowedWork).toBe(128 * (2 * title.length + 1));
  });

  test("the same text in another string adds nothing again: texts are counted by what they say", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
      workPerCharacterOfTextAsked: 1,
    });

    allowance.grantText("db-01 is down");
    allowance.grantText(["db-01", "is", "down"].join(" "));

    expect(allowance.allowedWork).toBe("db-01 is down".length);
  });

  test("an empty text adds nothing", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 5,
      workPerCharacterOfTextAsked: 128,
    });

    allowance.grantText("");

    expect(allowance.allowedWork).toBe(5);
  });

  test("past a thousand distinct texts, texts add nothing: an evaluation reads a few", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
      workPerCharacterOfTextAsked: 1,
    });

    for (let index: number = 0; index < MAX_GRANTED_TEXTS + 500; index++) {
      allowance.grantText(`text ${index}`.padEnd(10, "x"));
    }

    expect(allowance.allowedWork).toBe(10 * MAX_GRANTED_TEXTS);
  });

  test("a batch of telemetry's texts add nothing when asked about: a scrub rule's replacement is a new text", () => {
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forTelemetryBatch();

    allowance.grantText("a".repeat(10_000));
    allowance.beforeQuestion("b".repeat(10_000));

    expect(allowance.allowedWork).toBe(TELEMETRY_BATCH_WORK);
  });
});

describe("records a batch of telemetry hands over", () => {
  function batch(): PatternWorkAllowance {
    return new PatternWorkAllowance({
      pool: 0,
      workPerRecordText: 2048,
      workPerRecordCharacter: 128,
    });
  }

  test("a record adds its share when the first question about it runs, for each string in it and each character", () => {
    const allowance: PatternWorkAllowance = batch();
    const row: Record<string, unknown> = {
      body: "GET /health 200",
      severityNumber: 9,
      attributes: {
        "http.method": "GET",
        "http.status": 200,
        tags: ["a", "bc"],
        nested: { deeper: "xyz", isTrue: true, nothing: null },
      },
    };

    allowance.handOver(row);

    // Handing over walks nothing.
    expect(allowance.allowedWork).toBe(0);

    try {
      allowance.beforeQuestion("GET /health 200");
    } catch {
      // The pool is empty: what matters here is what was added first.
    }

    const texts: number = 5;
    const characters: number =
      "GET /health 200".length + "GET".length + 1 + 2 + 3;

    expect(allowance.allowedWork).toBe(2048 * texts + 128 * characters);
  });

  test("a record is added once, however many questions are asked about it", () => {
    const allowance: PatternWorkAllowance = batch();

    allowance.handOver({ body: "hello" });
    allowance.beforeQuestion("hello");
    allowance.beforeQuestion("hello");
    allowance.beforeQuestion("other");

    expect(allowance.allowedWork).toBe(2048 + 128 * 5);
  });

  test("a step whose patterns are not asked adds nothing - and walks nothing", () => {
    const allowance: PatternWorkAllowance = batch();
    let walked: boolean = false;
    const record: Record<string, unknown> = {};

    Object.defineProperty(record, "body", {
      enumerable: true,
      get: (): string => {
        walked = true;
        return "text";
      },
    });

    allowance.handOver(record);
    allowance.handOver({ body: "next record" });

    expect(walked).toBe(false);

    allowance.beforeQuestion("next record");

    expect(walked).toBe(false);
    expect(allowance.allowedWork).toBe(2048 + 128 * "next record".length);
  });

  test("a text handed over on its own adds its share, as a session replay's texts are", () => {
    const allowance: PatternWorkAllowance = batch();

    allowance.handOver("a text of a page");
    allowance.beforeQuestion("a text of a page");

    expect(allowance.allowedWork).toBe(2048 + 128 * 16);
  });

  test("a record deeper than six levels adds what lies within them only", () => {
    const allowance: PatternWorkAllowance = batch();
    let deep: unknown = "hidden";

    for (let level: number = 0; level < 10; level++) {
      deep = { level: deep };
    }

    allowance.handOver({ shallow: "ab", deep: deep });
    allowance.beforeQuestion("ab");

    expect(allowance.allowedWork).toBe(2048 + 128 * 2);
  });

  test("a record of more values than are counted adds what the first of them say", () => {
    const allowance: PatternWorkAllowance = batch();
    const values: Array<string> = new Array<string>(200_000).fill("x");

    allowance.handOver({ values: values });
    allowance.beforeQuestion("x");

    // The record, its array and 99,998 of the strings are counted.
    expect(allowance.allowedWork).toBe(99_998 * (2048 + 128));
  });

  test("a spent batch takes the next record's share: each record may still be asked about", () => {
    const allowance: PatternWorkAllowance = batch();

    expect(allowance.refuses("first")).toBe(false);

    allowance.charge(10);
    expect(allowance.refuses("first")).toBe(true);
    expect(allowance.stoppedQuestions).toBe(1);

    allowance.handOver({ body: "second" });

    expect(allowance.refuses("second")).toBe(false);
    expect(allowance.stoppedQuestions).toBe(1);
  });
});

describe("refusing a question before looking its pattern up", () => {
  test("a question is refused once the allowance is spent, and counted as stopped", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 100,
    });

    expect(allowance.refuses("x")).toBe(false);

    allowance.charge(200);

    expect(allowance.refuses("x")).toBe(true);
    expect(allowance.refuses("x")).toBe(true);
    expect(allowance.stoppedQuestions).toBe(2);
  });

  test("a text not asked about before adds its share first, so a long new text is still read", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 100,
      workPerCharacterOfTextAsked: 128,
    });

    allowance.charge(200);

    expect(allowance.refuses("a long description of the incident")).toBe(
      false,
    );
  });
});

describe("the allowance of the piece of work under way", () => {
  test("without one installed there is none: a question has only its own limit", () => {
    expect(getPatternWorkAllowance()).toBeUndefined();
    expect(patternWorkRefusesQuestions("text")).toBe(false);
  });

  test("the installed one is the one questions count against", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1,
    });

    providePatternWorkAllowance((): PatternWorkAllowance => {
      return allowance;
    });

    expect(getPatternWorkAllowance()).toBe(allowance);

    allowance.charge(2);

    expect(patternWorkRefusesQuestions("text")).toBe(true);
    expect(getStoppedPatternQuestions()).toBe(1);
  });

  test("outside one, questions stopped at their own limit are counted for the whole process", () => {
    const before: number = getStoppedPatternQuestions();

    noteQuestionStoppedOutsideAllowance();
    noteQuestionStoppedOutsideAllowance();

    expect(getStoppedPatternQuestions()).toBe(before + 2);

    // Inside one, its own count is what is read.
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1,
    });

    providePatternWorkAllowance((): PatternWorkAllowance => {
      return allowance;
    });

    expect(getStoppedPatternQuestions()).toBe(0);
  });
});
