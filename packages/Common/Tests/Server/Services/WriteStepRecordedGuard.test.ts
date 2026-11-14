import {
  ClassSource,
  callArguments,
  methodText,
  readClassSource,
} from "../TestingUtils/ClassSource";
import { describe, expect, test } from "@jest/globals";
import path from "path";
import { escapeRegExp } from "../../../Utils/RegExpEscape";

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
 *     WriteProgress.write, a save() as one in a transaction of its own -
 *     and so is a row's UPDATE held to a rule its project's other records
 *     decide, which the rule's own transaction writes and commits
 *     (updateWithinUpdateLimit, below);
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

/*
 * A row's UPDATE held to a rule (DatabaseService.getUpdateLimit): written by
 * the helper, through the manager of the rule's transaction, and committed
 * with that transaction's COMMIT - a write in a transaction of its own.
 */
const UPDATE_WITHIN_UPDATE_LIMIT: RegExp =
  /\bthis\.updateWithinUpdateLimit\s*\(/g;

const UPDATE_IN_ITS_OWN_TRANSACTION: string = "updateWithinUpdateLimit";

function repositoryWritesIn(text: string): Array<string> {
  return [
    ...Array.from(text.matchAll(REPOSITORY_WRITE)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
    ...Array.from(text.matchAll(UPDATE_WITHIN_UPDATE_LIMIT)).map((): string => {
      return UPDATE_IN_ITS_OWN_TRANSACTION;
    }),
  ];
}

describe.each(WRITING_METHODS)(
  "DatabaseService.$method records its repository writes",
  (entry: WritingMethod) => {
    const text: string = methodText(DATABASE_SERVICE, entry.method);
    const recorded: Array<string> = callArguments(
      text,
      new RegExp(`${escapeRegExp(entry.progress)}\\.write`),
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
          kinds.has("save") || kinds.has(UPDATE_IN_ITS_OWN_TRANSACTION)
            ? /^\s*true\s*,/
            : /^\s*false\s*,/,
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
          `,\\s*${escapeRegExp(entry.progress)}\\.getFailedStatement\\(\\)\\s*,?\\s*$`,
        ),
      );
    });
  },
);

describe("a row's UPDATE held to a rule is written in the rule's transaction", () => {
  const text: string = methodText(DATABASE_SERVICE, "updateWithinUpdateLimit");

  test("an update is held to one only through the helper, recorded as a write in a transaction of its own", () => {
    const update: string = methodText(DATABASE_SERVICE, "_updateBy");

    expect(text).not.toBe("");
    expect(
      Array.from(update.matchAll(UPDATE_WITHIN_UPDATE_LIMIT)),
    ).toHaveLength(1);
    expect(update).toMatch(
      /progress\.write\(\s*true\s*,\s*async \(\): Promise<UpdateResult> => \{\s*return await this\.updateWithinUpdateLimit\(/,
    );
  });

  test("the helper takes the rule's lock, asks the rule, then writes the row - all through the transaction's manager", () => {
    const lock: number = text.indexOf("ProjectLimitLock.run(");
    const check: number = text.indexOf("data.updateLimit.check(manager");
    const write: number = text.search(
      /manager\s*\.getRepository<TBaseModel>\(this\.modelType\.name\)\s*\.update\(/,
    );

    expect(lock).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(lock);
    expect(write).toBeGreaterThan(check);

    // Never through a repository of the pool, outside the transaction and its lock.
    expect(text).not.toMatch(/this\.getRepository\(\)/);
  });
});

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
