import PatternWorkScope, {
  RuleEvaluation,
  TelemetryBatch,
} from "../../../Server/Utils/PatternWorkScope";
import logger from "../../../Server/Utils/Logger";
import {
  getPatternWorkAllowance,
  getStoppedPatternQuestions,
  PatternWorkAllowance,
  RULE_EVALUATION_WORK,
  TELEMETRY_BATCH_WORK,
} from "../../../Utils/LinearRegExp/PatternWork";
import { getLinearRegExp } from "../../../Utils/LinearRegExp/PatternCache";
import { PatternWorkAllowanceSpentError } from "../../../Utils/LinearRegExp/PatternProblem";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * EACH PIECE OF WORK HAS ITS OWN ALLOWANCE, ACROSS ITS AWAITS.
 *
 * A rule engine reads a monitor between two rules, ingest yields to the
 * event loop between records, and other pieces of work run in between: the
 * allowance of a piece of work (Utils/LinearRegExp/PatternWork.ts) is kept
 * per asynchronous context (Server/Utils/PatternWorkScope.ts). These hold
 * that a question counts against the allowance of the piece of work it
 * belongs to, and no other - awaited or not, nested or side by side - and
 * that the decorators give each call of a marked method its own.
 * ---------------------------------------------------------------------------
 */

afterEach(() => {
  jest.restoreAllMocks();
});

// A turn of the event loop (Common's tests run in jsdom: no setImmediate).
function tick(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}

describe("PatternWorkScope.run", () => {
  test("outside any piece of work there is no allowance", () => {
    expect(PatternWorkScope.current()).toBeUndefined();
    expect(getPatternWorkAllowance()).toBeUndefined();
  });

  test("the matcher finds the allowance of the piece of work under way, synchronously", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1e9,
    });

    PatternWorkScope.run(allowance, (): void => {
      expect(PatternWorkScope.current()).toBe(allowance);
      expect(getPatternWorkAllowance()).toBe(allowance);

      getLinearRegExp("scope+sync").test("scope sync");
    });

    expect(allowance.usedWork).toBeGreaterThan(0);
    expect(PatternWorkScope.current()).toBeUndefined();
  });

  test("and after every await and timer inside it", async () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1e9,
    });
    const seen: Array<PatternWorkAllowance | undefined> = [];

    await PatternWorkScope.run(allowance, async (): Promise<void> => {
      seen.push(getPatternWorkAllowance());
      await tick();
      seen.push(getPatternWorkAllowance());
      await sleep(5);
      seen.push(getPatternWorkAllowance());
      await Promise.resolve();
      seen.push(getPatternWorkAllowance());
    });

    expect(seen).toEqual([allowance, allowance, allowance, allowance]);
  });

  test("a piece of work inside another has its own allowance, and the outer one is back when it ends", async () => {
    const outer: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1e9,
    });
    const inner: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1e9,
    });

    await PatternWorkScope.run(outer, async (): Promise<void> => {
      await PatternWorkScope.run(inner, async (): Promise<void> => {
        await tick();
        expect(PatternWorkScope.current()).toBe(inner);
        RulePatternMatchUtil.testRegex("inner+question", "inner question");
      });

      expect(PatternWorkScope.current()).toBe(outer);
    });

    expect(inner.usedWork).toBeGreaterThan(0);
    expect(outer.usedWork).toBe(0);
  });

  test("pieces of work side by side never count against each other, interleaved however they are", async () => {
    const spent: PatternWorkAllowance = new PatternWorkAllowance({ pool: 0 });
    const fresh: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 1e9,
    });

    spent.charge(1);

    const answers: Array<boolean> = await Promise.all([
      PatternWorkScope.run(spent, async (): Promise<boolean> => {
        await tick();
        return RulePatternMatchUtil.testRegex("^api-", "api-gateway");
      }),
      PatternWorkScope.run(fresh, async (): Promise<boolean> => {
        await tick();
        await sleep(2);
        return RulePatternMatchUtil.testRegex("^api-", "api-gateway");
      }),
    ]);

    // The spent one has no answer; the fresh one is not touched by it.
    expect(answers).toEqual([false, true]);
    expect(spent.stoppedQuestions).toBe(1);
    expect(fresh.stoppedQuestions).toBe(0);
  });

  test("stoppedQuestions reads the piece of work under way", async () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
    });

    allowance.charge(1);

    await PatternWorkScope.run(allowance, async (): Promise<void> => {
      expect(PatternWorkScope.stoppedQuestions()).toBe(0);
      RulePatternMatchUtil.testRegex("x", "x");
      await tick();
      expect(PatternWorkScope.stoppedQuestions()).toBe(1);
      expect(getStoppedPatternQuestions()).toBe(1);
    });
  });

  test("a record handed over outside any piece of work adds nothing anywhere", () => {
    expect((): void => {
      PatternWorkScope.handOverRecord({ body: "text" });
    }).not.toThrow();
  });

  test("a record handed over inside one adds its share when it is first asked about", () => {
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forTelemetryBatch();

    PatternWorkScope.run(allowance, (): void => {
      PatternWorkScope.handOverRecord({ body: "hello world" });
      expect(allowance.allowedWork).toBe(TELEMETRY_BATCH_WORK);

      getLinearRegExp("world").test("hello world");
    });

    expect(allowance.allowedWork).toBeGreaterThan(TELEMETRY_BATCH_WORK);
  });
});

/*
 * Methods marked as pieces of work, as the rule engines and the ingest
 * services mark theirs.
 */
class Engine {
  public seen: Array<PatternWorkAllowance | undefined> = [];

  @RuleEvaluation()
  public async evaluate(pattern: string, text: string): Promise<boolean> {
    this.seen.push(PatternWorkScope.current());
    await tick();
    this.seen.push(PatternWorkScope.current());
    return RulePatternMatchUtil.testRegex(pattern, text);
  }

  @RuleEvaluation()
  public evaluateSync(pattern: string, text: string): boolean {
    this.seen.push(PatternWorkScope.current());
    return RulePatternMatchUtil.testRegex(pattern, text);
  }

  @RuleEvaluation()
  public async fails(): Promise<void> {
    await tick();
    throw new Error("the evaluation failed");
  }

  @RuleEvaluation()
  public async spendsItAll(): Promise<boolean> {
    PatternWorkScope.current()!.charge(RULE_EVALUATION_WORK + 1);
    return RulePatternMatchUtil.testRegex("^x", "x");
  }

  @TelemetryBatch()
  public static async ingest(): Promise<PatternWorkAllowance | undefined> {
    await tick();
    return PatternWorkScope.current();
  }
}

describe("@RuleEvaluation() and @TelemetryBatch()", () => {
  test("each call of a marked method runs with an allowance of its own, of a rule evaluation's size", async () => {
    const engine: Engine = new Engine();

    await engine.evaluate("^prod-", "prod-db");
    await engine.evaluate("^prod-", "prod-db");

    const [first, firstAfterAwait, second] = engine.seen;

    expect(first).toBeInstanceOf(PatternWorkAllowance);
    expect(firstAfterAwait).toBe(first);
    expect(second).toBeInstanceOf(PatternWorkAllowance);
    expect(second).not.toBe(first);
    expect(first!.allowedWork).toBeGreaterThanOrEqual(RULE_EVALUATION_WORK);
    expect(first!.usedWork).toBeGreaterThan(0);
  });

  test("a synchronous marked method answers synchronously, with its own allowance", () => {
    const engine: Engine = new Engine();
    const answer: boolean = engine.evaluateSync("db", "a db host");

    expect(answer).toBe(true);
    expect(engine.seen[0]).toBeInstanceOf(PatternWorkAllowance);
    expect(PatternWorkScope.current()).toBeUndefined();
  });

  test("its answer and its failure pass through unchanged", async () => {
    const engine: Engine = new Engine();

    await expect(engine.evaluate("^api", "api-1")).resolves.toBe(true);
    await expect(engine.evaluate("^api", "web-1")).resolves.toBe(false);
    await expect(engine.fails()).rejects.toThrow("the evaluation failed");
  });

  test("a static method of an ingest service gets a batch's allowance", async () => {
    const allowance: PatternWorkAllowance | undefined = await Engine.ingest();

    expect(allowance).toBeInstanceOf(PatternWorkAllowance);
    expect(allowance!.allowedWork).toBe(TELEMETRY_BATCH_WORK);
  });

  test("a piece of work whose questions stopped says so once, when it ends", async () => {
    const warnings: Array<string> = [];

    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
      return undefined as never;
    });

    const engine: Engine = new Engine();

    await expect(engine.spendsItAll()).resolves.toBe(false);
    await engine.evaluate("^api", "api-1");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Engine.spendsItAll");
    expect(warnings[0]).toContain("1 pattern question(s) stopped");
  });

  test("a question the spent allowance stops throws its error inside the matcher, and the rule helper answers no", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
    });

    allowance.charge(1);

    PatternWorkScope.run(allowance, (): void => {
      let error: unknown = null;

      try {
        getLinearRegExp("abc").test("abc");
      } catch (thrown: unknown) {
        error = thrown;
      }

      expect(error).toBeInstanceOf(PatternWorkAllowanceSpentError);
      expect(RulePatternMatchUtil.testRegex("abc", "abc")).toBe(false);
      expect(RulePatternMatchUtil.matches("abc", "abc")).toBe(false);
    });
  });
});
