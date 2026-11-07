import DuplicateRowMerge, {
  DuplicateRowMergeOptions,
  DuplicateRowMergeResult,
  describeDuplicateRowMerge,
} from "../../../../Server/Infrastructure/Postgres/DuplicateRowMerge";
import logger from "../../../../Server/Utils/Logger";
import { QueryRunner } from "typeorm";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What DuplicateRowMerge tells the operator in the upgrade's log, once per
 * table that had duplicates (MergeDuplicateHostsAndAddUniqueHostIdentifier,
 * issue #5214): how many duplicates merged into how many kept rows, how many
 * rows of other tables moved to a kept row, how many were dropped because a
 * kept row already had them - and, when there are any, how many of those
 * were merged into the kept row's copy first, so their counts stay (an
 * exception both copies of a host had: ExceptionTwinMerge). In plain words,
 * one row or many, and only what happened.
 *
 * MergeDuplicateHostsAndAddUniqueHostIdentifierPostgres.test.ts holds the
 * real migration's lines to what it did on Postgres.
 */

const KEPT_ID: string = "6f1c3a52-1d0e-4bb4-9a59-0b4c2f4a1e01";
const DUPLICATE_ID: string = "6f1c3a52-1d0e-4bb4-9a59-0b4c2f4a1e02";

// A table merged by name, with nothing referring to it.
const OPTIONS: DuplicateRowMergeOptions = {
  table: "Box",
  duplicateKey: `"projectId", LOWER("name")`,
  where: `"deletedAt" IS NULL`,
  columnsWithoutForeignKey: [],
  latestOf: ["status"],
  keptOrFirstOf: ["note"],
  latestBy: "lastSeenAt",
};

// What a run found: how many of each, everything else none.
function resultOf(
  counts: Partial<DuplicateRowMergeResult>,
): DuplicateRowMergeResult {
  return {
    groupsMerged: 1,
    rowsMerged: 1,
    referencesMoved: 0,
    twinsDropped: 0,
    twinsTakenIn: 0,
    ...counts,
  };
}

/*
 * A QueryRunner that answers the search for duplicates with `duplicates`
 * and every other statement - the catalog reads find nothing referring to
 * the table - with no rows.
 */
function runnerFinding(
  duplicates: Array<{ duplicateId: string; keptId: string }>,
): QueryRunner {
  return {
    isTransactionActive: false,
    query: async (sql: string): Promise<unknown> => {
      return sql.includes("first_value(") ? duplicates : [];
    },
    startTransaction: async (): Promise<void> => {
      return undefined;
    },
    commitTransaction: async (): Promise<void> => {
      return undefined;
    },
    rollbackTransaction: async (): Promise<void> => {
      return undefined;
    },
  } as unknown as QueryRunner;
}

describe("what the upgrade's log says a duplicate merge did", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a host made twice, with an exception both copies had: what merged, moved and was dropped, and the copies merged into the kept one first", () => {
    expect(
      describeDuplicateRowMerge(
        "Host",
        resultOf({ referencesMoved: 14, twinsDropped: 3, twinsTakenIn: 2 }),
      ),
    ).toBe(
      "Merged 1 duplicate Host row into 1 kept row: 14 referring rows moved, 3 dropped because a kept row already had them (2 of them merged into the kept row's copy first, with their counts).",
    );
  });

  test("dropped rows that count nothing - a label, a container both copies had - say nothing of counts", () => {
    expect(
      describeDuplicateRowMerge(
        "DockerHost",
        resultOf({
          groupsMerged: 2,
          rowsMerged: 3,
          referencesMoved: 23,
          twinsDropped: 4,
        }),
      ),
    ).toBe(
      "Merged 3 duplicate DockerHost rows into 2 kept rows: 23 referring rows moved, 4 dropped because a kept row already had them.",
    );
  });

  test("nothing dropped: the line ends at what moved", () => {
    expect(
      describeDuplicateRowMerge("PodmanHost", resultOf({ referencesMoved: 1 })),
    ).toBe(
      "Merged 1 duplicate PodmanHost row into 1 kept row: 1 referring row moved.",
    );
  });

  test("nothing referred to the duplicates: it says none moved, not 0", () => {
    expect(describeDuplicateRowMerge("Host", resultOf({}))).toBe(
      "Merged 1 duplicate Host row into 1 kept row: no referring rows moved.",
    );
  });

  test("one row or many, never 'row(s)', and never the code's own words for a dropped row", () => {
    const lines: Array<string> = [];

    for (const rowsMerged of [1, 2]) {
      for (const referencesMoved of [0, 1, 2]) {
        for (const twinsDropped of [0, 1, 2]) {
          for (const twinsTakenIn of [0, 1, 2].filter((count: number) => {
            return count <= twinsDropped;
          })) {
            lines.push(
              describeDuplicateRowMerge(
                "Host",
                resultOf({
                  groupsMerged: rowsMerged,
                  rowsMerged: rowsMerged,
                  referencesMoved: referencesMoved,
                  twinsDropped: twinsDropped,
                  twinsTakenIn: twinsTakenIn,
                }),
              ),
            );
          }
        }
      }
    }

    for (const line of lines) {
      expect([line, line.includes("(s)")]).toEqual([line, false]);
      expect([line, line.includes("twin")]).toEqual([line, false]);
      expect([line, line.includes("taken in")]).toEqual([line, false]);
      expect([line, line.includes(" 0 ")]).toEqual([line, false]);
      expect([line, line.includes(" 1 referring rows")]).toEqual([line, false]);
      expect([line, line.includes(" 2 referring row ")]).toEqual([line, false]);
      expect([line, line.endsWith(".")]).toEqual([line, true]);
    }
  });

  test("a merge logs that line once, when it merged something", async () => {
    const info: jest.SpyInstance = jest
      .spyOn(logger, "info")
      .mockImplementation((): void => {
        return undefined;
      });

    const result: DuplicateRowMergeResult = await DuplicateRowMerge.merge(
      runnerFinding([{ duplicateId: DUPLICATE_ID, keptId: KEPT_ID }]),
      OPTIONS,
    );

    expect(result).toEqual(resultOf({}));
    expect(info.mock.calls).toEqual([
      ["Merged 1 duplicate Box row into 1 kept row: no referring rows moved."],
    ]);
  });

  test("a table with no duplicates says nothing: most upgrades have none", async () => {
    const info: jest.SpyInstance = jest
      .spyOn(logger, "info")
      .mockImplementation((): void => {
        return undefined;
      });

    const result: DuplicateRowMergeResult = await DuplicateRowMerge.merge(
      runnerFinding([]),
      OPTIONS,
    );

    expect(result).toEqual(
      resultOf({ groupsMerged: 0, rowsMerged: 0, referencesMoved: 0 }),
    );
    expect(info).not.toHaveBeenCalled();
  });
});
