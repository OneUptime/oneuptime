import {
  ClassSource,
  callArguments,
  methodText,
  readClassSource,
} from "../TestingUtils/ClassSource";
import { describe, expect, test } from "@jest/globals";
import path from "path";

/*
 * EVERY REPOSITORY WRITE OF A CREATE, UPDATE OR DELETE IS RECORDED AS THE
 * WRITE, AND EVERY ERROR HOOK IS TOLD WHICH STEP FAILED.
 *
 * DatabaseService hands a service's error hooks which step of a write failed
 * (Server/Utils/Database/WriteProgress): the repository's own statement - the
 * INSERT of a create, a row's UPDATE, the DELETE - or one around it: a
 * check, a hook, a helper. A statement around the write applied nothing of
 * it (StatementOutcome), so a hook holding a lock for the write gives it
 * back at once (SsoFailedWriteLocksGuard). A repository write run outside
 * WriteProgress.write would be told as one around the write - and its locks
 * given back while the write may still land. So:
 *
 *   - every repository write in create, update and delete runs through
 *     WriteProgress.write, a save() as one in a transaction of its own;
 *   - none of them reaches the repository another way (a repository kept
 *     in a variable, a transaction of their own);
 *   - every error hook is handed what that progress recorded.
 *
 * A new repository write in one of these methods goes through
 * `progress.write` too, or this fails.
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const DATABASE_SERVICE: ClassSource = readClassSource(
  path.join(COMMON_DIR, "Server", "Services", "DatabaseService.ts"),
);

// The repository calls that write.
const REPOSITORY_WRITE: RegExp =
  /\.getRepository\(\)\s*\.\s*(save|update|delete|insert|upsert|softDelete|softRemove|restore|recover|remove|increment|decrement|clear|query)\s*\(/g;

interface WritingMethod {
  method: string;
  // How the method reaches its WriteProgress.
  progress: string;
  // The error hook the method hands every failure to.
  errorHook: string;
}

const WRITING_METHODS: Array<WritingMethod> = [
  {
    method: "_create",
    progress: "handedBack.progress",
    errorHook: "onCreateError",
  },
  {
    method: "_updateBy",
    progress: "progress",
    errorHook: "onUpdateError",
  },
  {
    method: "hardDeleteBy",
    progress: "progress",
    errorHook: "onDeleteError",
  },
  {
    method: "_deleteBy",
    progress: "progress",
    errorHook: "onDeleteError",
  },
];

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function repositoryWritesIn(text: string): Array<string> {
  return Array.from(text.matchAll(REPOSITORY_WRITE)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe.each(WRITING_METHODS)(
  "DatabaseService.$method records its repository writes",
  (entry: WritingMethod) => {
    const text: string = methodText(DATABASE_SERVICE, entry.method);
    const recorded: Array<string> = callArguments(
      text,
      new RegExp(`${escaped(entry.progress)}\\.write`),
    );

    test("the method is there, and writes through the repository", () => {
      expect(text).not.toBe("");
      expect(repositoryWritesIn(text).length).toBeGreaterThan(0);
    });

    test("every repository write runs through WriteProgress.write", () => {
      expect(recorded.length).toBeGreaterThan(0);

      let recordedWrites: number = 0;

      for (const write of recorded) {
        const writes: number = repositoryWritesIn(write).length;

        // Each records a repository write - one, or one of two it chooses between.
        expect(writes).toBeGreaterThan(0);
        recordedWrites += writes;
      }

      // Every write call of the method - both branches of a choice count - is in one.
      expect(recordedWrites).toBe(repositoryWritesIn(text).length);
    });

    test("a save() is recorded as written in a transaction of its own, an update() or delete() as committed on its own", () => {
      for (const write of recorded) {
        const kinds: Set<string> = new Set(repositoryWritesIn(write));

        // One kind of write each.
        expect(kinds.size).toBe(1);
        expect(write).toMatch(
          kinds.has("save") ? /^\s*true\s*,/ : /^\s*false\s*,/,
        );
      }
    });

    test("no repository write reaches the database another way", () => {
      // A repository kept in a variable, or a transaction of the method's own.
      expect(text).not.toMatch(/[=]\s*this\.getRepository\(\)\s*;/);
      expect(text).not.toMatch(/\.executeTransaction\s*\(|\.transaction\s*\(/);
      expect(text).not.toMatch(/\.manager\b/);
    });

    test("its error hook is handed which step failed", () => {
      const scope: string =
        entry.method === "_create"
          ? methodText(DATABASE_SERVICE, "create")
          : text;
      const hookCalls: Array<string> = callArguments(
        scope,
        new RegExp(`this\\.${entry.errorHook}`),
      );

      expect(hookCalls).toHaveLength(1);
      expect(hookCalls[0]!).toMatch(
        new RegExp(
          `,\\s*${escaped(entry.progress)}\\.getFailedStatement\\(\\)\\s*,?\\s*$`,
        ),
      );
    });
  },
);

describe("every error hook DatabaseService declares takes which step failed", () => {
  test.each(["onCreateError", "onUpdateError", "onDeleteError"])(
    "%s",
    (hook: string) => {
      expect(methodText(DATABASE_SERVICE, hook)).toMatch(
        /_failedStatement\?: StatementContext \| undefined/,
      );
    },
  );

  test("and DatabaseService calls each from one place: the method that records the steps", () => {
    expect(
      callArguments(DATABASE_SERVICE.source, /this\.onCreateError/),
    ).toHaveLength(1);
    expect(
      callArguments(DATABASE_SERVICE.source, /this\.onUpdateError/),
    ).toHaveLength(1);
    expect(
      callArguments(DATABASE_SERVICE.source, /this\.onDeleteError/),
    ).toHaveLength(2);
  });
});
