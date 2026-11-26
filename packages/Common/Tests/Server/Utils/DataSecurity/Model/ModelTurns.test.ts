import { describe, expect, test } from "@jest/globals";
import {
  ModelBudget,
  ModelStoreBudget,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  CONTENT_STORE_KEY,
  ModelScanContext,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelScan";
import {
  MODEL_TURN_STATE_KEY,
  ModelTurnTracker,
  readModelResumeAt,
  rotateForModel,
  withModelResumeAt,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelTurns";
import { JSONObject } from "../../../../../Types/JSON";
import FakeEntityRecognizer from "./FakeEntityRecognizer";

/*
 * EVERY TABLE AND OBJECT TAKES ITS TURN AT THE MODEL'S TIME (#10928).
 *
 * The turn itself: where a store's state says the model stopped, the order
 * that puts it first, and - followed through one scan - where the next one
 * starts: the first table the model did not read whole, the one after it
 * when it was the first the model started on, the first the scan never
 * reached, or nowhere when the model read everything.
 */

function modelOf(budget: ModelBudget): ModelScanContext {
  return { recognizer: new FakeEntityRecognizer(), budget };
}

// Pretend the model was handed `toRead` texts of a table and read `read` of them.
function hand(budget: ModelBudget, toRead: number, read: number): void {
  const store: ModelStoreBudget = budget.forStore(CONTENT_STORE_KEY);

  store.noteValues({ toRead, read });
}

describe("where a store's state says the model's turn starts", () => {
  test("a name kept as the state writes it", () => {
    const state: JSONObject = withModelResumeAt(
      { etags: { "a.csv": { etag: "1" } } },
      "public.orders",
    );

    expect(state).toEqual({
      etags: { "a.csv": { etag: "1" } },
      [MODEL_TURN_STATE_KEY]: { resumeAt: "public.orders" },
    });
    expect(readModelResumeAt(state)).toBe("public.orders");
  });

  test("none to start at the first: nothing kept, and an old turn taken out", () => {
    expect(withModelResumeAt(undefined, null)).toEqual({});
    expect(
      withModelResumeAt({ model: { resumeAt: "public.orders" }, x: 1 }, null),
    ).toEqual({ x: 1 });
    expect(readModelResumeAt(undefined)).toBeNull();
    expect(readModelResumeAt(null)).toBeNull();
    expect(readModelResumeAt({})).toBeNull();
  });

  test("anything else in the state is not a turn", () => {
    for (const state of [
      { model: "public.orders" },
      { model: ["public.orders"] },
      { model: { resumeAt: 42 } },
      { model: { resumeAt: "" } },
      { model: { resumeAt: "x".repeat(513) } },
    ]) {
      expect(readModelResumeAt(state as JSONObject)).toBeNull();
    }

    // Nor is a name too long to be one kept.
    expect(withModelResumeAt({}, "x".repeat(513))).toEqual({});
  });
});

describe("the order the model reads a store's tables in", () => {
  const TABLES: Array<string> = ["a.one", "a.two", "b.one", "b.two", "c.one"];

  function names(resumeAt: string | null): Array<string> {
    return rotateForModel(
      TABLES,
      (name: string): string => {
        return name;
      },
      resumeAt,
    );
  }

  test("from the one it stopped at, round to the one before it", () => {
    expect(names("b.one")).toEqual([
      "b.one",
      "b.two",
      "c.one",
      "a.one",
      "a.two",
    ]);
    expect(names("c.one")).toEqual([
      "c.one",
      "a.one",
      "a.two",
      "b.one",
      "b.two",
    ]);
  });

  test("from the first when there is no turn, or the turn is the first", () => {
    expect(names(null)).toEqual(TABLES);
    expect(names("a.one")).toEqual(TABLES);
  });

  test("a table gone since is resumed after where it was", () => {
    // "a.u" sorted after "a.two": the next scan starts at "b.one".
    expect(names("a.u")).toEqual(["b.one", "b.two", "c.one", "a.one", "a.two"]);
    expect(names("zz.last")).toEqual(TABLES);
  });

  test("every table once, whatever the turn", () => {
    for (const resumeAt of [null, ...TABLES, "a.u", "zz"]) {
      expect([...names(resumeAt)].sort()).toEqual([...TABLES].sort());
    }
  });

  test("one table, or none, is as it is", () => {
    expect(
      rotateForModel(
        ["only"],
        (name: string): string => {
          return name;
        },
        "only",
      ),
    ).toEqual(["only"]);
    expect(
      rotateForModel(
        [],
        (name: string): string => {
          return name;
        },
        "x",
      ),
    ).toEqual([]);
  });

  test("each scan's model starts where the last one stopped, so every table has its turn", () => {
    // Five tables, time for two a scan: in three scans every one is read.
    const read: Set<string> = new Set();
    let resumeAt: string | null = null;

    for (let scan: number = 0; scan < 3; scan++) {
      const order: Array<string> = names(resumeAt);

      read.add(order[0]!);
      read.add(order[1]!);
      resumeAt = order[2]!;
    }

    expect([...read].sort()).toEqual([...TABLES].sort());
  });
});

describe("one scan's model, followed through its tables", () => {
  test("off: nothing turns, and nothing is kept", () => {
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: undefined,
      previous: "public.orders",
    });

    turn.begin();
    expect(turn.end("public.orders", null)).toEqual({
      hadText: false,
      isReadWhole: true,
    });
    turn.notReached("public.users");
    expect(turn.isTurning).toBe(false);
    expect(turn.nextResumeAt).toBeNull();
  });

  test("everything read whole: the next scan starts at the first", () => {
    const budget: ModelBudget = ModelBudget.forScope("content");
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: modelOf(budget),
      previous: "public.b",
    });

    for (const [name, next] of [
      ["public.b", "public.c"],
      ["public.c", "public.a"],
      ["public.a", "public.b"],
    ]) {
      turn.begin();
      hand(budget, 3, 3);
      expect(turn.end(name!, next!)).toEqual({
        hadText: true,
        isReadWhole: true,
      });
    }

    expect(turn.nextResumeAt).toBeNull();
  });

  test("the first table the model did not read whole is where the next scan starts", () => {
    const budget: ModelBudget = ModelBudget.forScope("content");
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: modelOf(budget),
      previous: null,
    });

    turn.begin();
    hand(budget, 4, 4);
    turn.end("public.a", "public.b");
    turn.begin();
    expect(turn.end("public.empty", "public.b")).toEqual({
      hadText: false,
      isReadWhole: true,
    });
    turn.begin();
    hand(budget, 5, 2);
    expect(turn.end("public.b", "public.c")).toEqual({
      hadText: true,
      isReadWhole: false,
    });
    turn.begin();
    hand(budget, 3, 0);
    turn.end("public.c", "public.a");

    expect(turn.nextResumeAt).toBe("public.b");
  });

  test("the first table the model started on, and could not finish, passes its turn to the one after it", () => {
    const budget: ModelBudget = ModelBudget.forScope("content");
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: modelOf(budget),
      previous: "public.big",
    });

    turn.begin();
    // A table with no free text first: the model has not started yet.
    turn.end("public.ids", "public.big");
    turn.begin();
    hand(budget, 100, 40);
    turn.end("public.big", "public.next");
    turn.begin();
    hand(budget, 3, 0);
    turn.end("public.next", "public.ids");

    expect(turn.nextResumeAt).toBe("public.next");
  });

  test("a store of one table too big for a turn starts at it again", () => {
    const budget: ModelBudget = ModelBudget.forScope("content");
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: modelOf(budget),
      previous: null,
    });

    turn.begin();
    hand(budget, 100, 40);
    turn.end("public.only", null);

    expect(turn.nextResumeAt).toBe("public.only");
  });

  test("a table the scan never reached is where the next starts, if the model did not stop first", () => {
    const budget: ModelBudget = ModelBudget.forScope("content");
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: modelOf(budget),
      previous: null,
    });

    turn.begin();
    hand(budget, 2, 2);
    turn.end("public.a", "public.b");
    turn.notReached("public.b");
    turn.notReached("public.c");

    expect(turn.nextResumeAt).toBe("public.b");

    const stopped: ModelBudget = ModelBudget.forScope("content");
    const first: ModelTurnTracker = new ModelTurnTracker({
      model: modelOf(stopped),
      previous: null,
    });

    first.begin();
    hand(stopped, 2, 2);
    first.end("public.a", "public.b");
    first.begin();
    hand(stopped, 2, 1);
    first.end("public.b", "public.c");
    first.notReached("public.c");

    expect(first.nextResumeAt).toBe("public.b");
  });

  test("where the model could not run at all, the turn stays where it was", () => {
    const budget: ModelBudget = ModelBudget.forScope("content");
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: modelOf(budget),
      previous: "public.c",
    });

    turn.begin();
    budget
      .forStore(CONTENT_STORE_KEY)
      .noteUnavailable("the model could not start on this server", 3);
    turn.end("public.c", "public.a");

    expect(turn.nextResumeAt).toBe("public.c");
  });
});
