import {
  nextInsertDedupToken,
  runWithInsertDedup,
} from "../../../../Server/Utils/AnalyticsDatabase/InsertDedupContext";
import { describe, expect, test } from "@jest/globals";

/*
 * InsertDedupContext hands out deterministic ClickHouse dedup tokens -
 * "<tokenBase>:<table>:<chunkIndex>" - within a runWithInsertDedup scope, so
 * a retried job re-issues byte-identical tokens. Outside a scope there are
 * none.
 */

function tick(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

describe("nextInsertDedupToken outside a scope", () => {
  test("is undefined", () => {
    expect(nextInsertDedupToken("Span")).toBeUndefined();
  });

  test("stays undefined however often it is asked", () => {
    nextInsertDedupToken("Span");
    nextInsertDedupToken("Span");

    expect(nextInsertDedupToken("Span")).toBeUndefined();
  });
});

describe("runWithInsertDedup", () => {
  test("returns what the function resolves to", async () => {
    const result: number = await runWithInsertDedup(
      "job",
      async (): Promise<number> => {
        return 42;
      },
    );

    expect(result).toBe(42);
  });

  test("passes on what the function rejects with", async () => {
    await expect(
      runWithInsertDedup("job", async (): Promise<void> => {
        throw new Error("insert failed");
      }),
    ).rejects.toThrow("insert failed");
  });

  test("numbers each table's chunks from zero, in order", async () => {
    const tokens: Array<string | undefined> = await runWithInsertDedup(
      "job-1",
      async (): Promise<Array<string | undefined>> => {
        return [
          nextInsertDedupToken("Span"),
          nextInsertDedupToken("Span"),
          nextInsertDedupToken("Span"),
        ];
      },
    );

    expect(tokens).toEqual(["job-1:Span:0", "job-1:Span:1", "job-1:Span:2"]);
  });

  test("keeps a separate counter per table", async () => {
    const tokens: Array<string | undefined> = await runWithInsertDedup(
      "job-2",
      async (): Promise<Array<string | undefined>> => {
        return [
          nextInsertDedupToken("Span"),
          nextInsertDedupToken("ExceptionInstance"),
          nextInsertDedupToken("Span"),
          nextInsertDedupToken("ExceptionInstance"),
          nextInsertDedupToken("Log"),
        ];
      },
    );

    expect(tokens).toEqual([
      "job-2:Span:0",
      "job-2:ExceptionInstance:0",
      "job-2:Span:1",
      "job-2:ExceptionInstance:1",
      "job-2:Log:0",
    ]);
  });

  test("a retry of the same job re-issues byte-identical tokens", async () => {
    const run: () => Promise<Array<string | undefined>> = (): Promise<
      Array<string | undefined>
    > => {
      return runWithInsertDedup(
        "job-retry",
        async (): Promise<Array<string | undefined>> => {
          return [
            nextInsertDedupToken("Span"),
            nextInsertDedupToken("Metric"),
            nextInsertDedupToken("Span"),
          ];
        },
      );
    };

    const firstAttempt: Array<string | undefined> = await run();
    const secondAttempt: Array<string | undefined> = await run();

    expect(secondAttempt).toEqual(firstAttempt);
  });

  test("the scope survives awaits inside the function", async () => {
    const tokens: Array<string | undefined> = await runWithInsertDedup(
      "job-async",
      async (): Promise<Array<string | undefined>> => {
        const first: string | undefined = nextInsertDedupToken("Span");
        await tick();
        const second: string | undefined = nextInsertDedupToken("Span");
        return [first, second];
      },
    );

    expect(tokens).toEqual(["job-async:Span:0", "job-async:Span:1"]);
  });

  test("concurrent scopes do not share counters", async () => {
    const [a, b]: [Array<string | undefined>, Array<string | undefined>] =
      await Promise.all([
        runWithInsertDedup(
          "job-a",
          async (): Promise<Array<string | undefined>> => {
            const first: string | undefined = nextInsertDedupToken("Span");
            await tick();
            const second: string | undefined = nextInsertDedupToken("Span");
            return [first, second];
          },
        ),
        runWithInsertDedup(
          "job-b",
          async (): Promise<Array<string | undefined>> => {
            const first: string | undefined = nextInsertDedupToken("Span");
            await tick();
            const second: string | undefined = nextInsertDedupToken("Span");
            return [first, second];
          },
        ),
      ]);

    expect(a).toEqual(["job-a:Span:0", "job-a:Span:1"]);
    expect(b).toEqual(["job-b:Span:0", "job-b:Span:1"]);
  });

  test("a nested scope starts its own counters and the outer one resumes after", async () => {
    const tokens: Array<string | undefined> = await runWithInsertDedup(
      "outer",
      async (): Promise<Array<string | undefined>> => {
        const before: string | undefined = nextInsertDedupToken("Span");

        const inner: Array<string | undefined> = await runWithInsertDedup(
          "inner",
          async (): Promise<Array<string | undefined>> => {
            return [nextInsertDedupToken("Span"), nextInsertDedupToken("Span")];
          },
        );

        const after: string | undefined = nextInsertDedupToken("Span");

        return [before, ...inner, after];
      },
    );

    expect(tokens).toEqual([
      "outer:Span:0",
      "inner:Span:0",
      "inner:Span:1",
      "outer:Span:1",
    ]);
  });

  test("leaves no scope behind once it has finished", async () => {
    await runWithInsertDedup("finished", async (): Promise<void> => {
      nextInsertDedupToken("Span");
    });

    expect(nextInsertDedupToken("Span")).toBeUndefined();
  });

  test("uses the token base and table name exactly as given", async () => {
    const token: string | undefined = await runWithInsertDedup(
      "queue:telemetry:123",
      async (): Promise<string | undefined> => {
        return nextInsertDedupToken("oneuptime.Span");
      },
    );

    expect(token).toBe("queue:telemetry:123:oneuptime.Span:0");
  });
});
