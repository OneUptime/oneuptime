import Label from "Common/Models/DatabaseModels/Label";
import LabelService from "Common/Server/Services/LabelService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { getNaturalSortKey } from "Common/Utils/NaturalOrder";
import BackfillLabelNameSortKeys from "../../../FeatureSet/Workers/DataMigrations/BackfillLabelNameSortKeys";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * BackfillLabelNameSortKeys writes the sort key of every label made before
 * labels had one (Label.nameSortKey): labels are read in natural order by
 * it - numbered labels first, by their numbers, then the others
 * alphabetically (OneUptime issue #5183) - and a label without one is listed
 * after every label that has it.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts once, above the runbook
 *      moves that keep their places before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. it reads only labels without a key, as OneUptime, by id, a page at a
 *      time, each page after the last label of the one before (a label it
 *      writes leaves the query; one it could not write must not be read
 *      again forever);
 *   3. each label's key is getNaturalSortKey of its name, written with no
 *      hooks, its updatedAt left alone, and only while it still has that
 *      name - a label renamed meanwhile wrote its own key;
 *   4. one label it cannot write costs no other label its key, and does
 *      not fail the run, which would halt every migration after it;
 *   5. a failed read does fail it, so the runner tries again;
 *   6. a second run, with every key written, writes nothing; rollback
 *      changes nothing.
 */

const MIGRATION_NAME: string = "BackfillLabelNameSortKeys";

const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

type FindByArgs = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
  props: Record<string, unknown>;
};

type CompareAndSetArgs = {
  id: ObjectID;
  data: Record<string, unknown>;
  expectedData: Record<string, unknown>;
  skipUpdateDateColumn?: boolean;
};

interface StoredLabel {
  id: ObjectID;
  name: string;
  nameSortKey: string | null;
}

// The id a cursor query asks for labels after (QueryHelper.greaterThan).
function cursorOf(query: Record<string, unknown>): string | null {
  const operator:
    | { objectLiteralParameters?: Record<string, unknown> }
    | undefined = query["_id"] as
    | { objectLiteralParameters?: Record<string, unknown> }
    | undefined;

  if (!operator) {
    return null;
  }

  const values: Array<unknown> = Object.values(
    operator.objectLiteralParameters || {},
  );

  return values.length > 0 ? String(values[0]) : null;
}

describe("BackfillLabelNameSortKeys", () => {
  let table: Array<StoredLabel>;
  let findCalls: Array<FindByArgs>;
  let writes: Array<CompareAndSetArgs>;
  // Every write tried, the ones that threw included.
  let attempts: Array<string>;
  let infoLogs: Array<string>;
  let errorLogs: Array<string>;
  let failingIds: Set<string>;
  let renamedIds: Set<string>;

  function seed(names: Array<string>): Array<StoredLabel> {
    const rows: Array<StoredLabel> = names.map(
      (name: string, index: number): StoredLabel => {
        return {
          id: new ObjectID(
            `21000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          ),
          name: name,
          nameSortKey: null,
        };
      },
    );

    table.push(...rows);

    return rows;
  }

  beforeEach(() => {
    table = [];
    findCalls = [];
    writes = [];
    attempts = [];
    infoLogs = [];
    errorLogs = [];
    failingIds = new Set<string>();
    renamedIds = new Set<string>();

    jest
      .spyOn(LabelService, "findBy")
      .mockImplementation(async (input: unknown) => {
        const args: FindByArgs = input as FindByArgs;
        findCalls.push(args);

        const after: string | null = cursorOf(args.query);

        return table
          .filter((row: StoredLabel): boolean => {
            return (
              row.nameSortKey === null &&
              (after === null || row.id.toString() > after)
            );
          })
          .sort((first: StoredLabel, second: StoredLabel): number => {
            return first.id.toString() < second.id.toString() ? -1 : 1;
          })
          .slice(0, args.limit)
          .map((row: StoredLabel): Label => {
            const label: Label = new Label();
            label.id = row.id;
            label.name = row.name;
            return label;
          });
      });

    jest
      .spyOn(LabelService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation(async (input: unknown) => {
        const args: CompareAndSetArgs = input as CompareAndSetArgs;
        attempts.push(args.id.toString());

        if (failingIds.has(args.id.toString())) {
          throw new Error("row locked");
        }

        writes.push(args);

        if (renamedIds.has(args.id.toString())) {
          return false;
        }

        const row: StoredLabel | undefined = table.find(
          (candidate: StoredLabel): boolean => {
            return candidate.id.toString() === args.id.toString();
          },
        );

        if (!row || row.name !== args.expectedData["name"]) {
          return false;
        }

        row.nameSortKey = args.data["nameSortKey"] as string;

        return true;
      });

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errorLogs.push(String(message));
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(REGISTERED_MIGRATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    /*
     * Above the runbook moves, which keep their places right before the
     * last slot (their own suites assert each neighbour).
     */
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.indexOf("MoveRunbookApprovalsBeforeTheirSteps"),
    );
    expect(new BackfillLabelNameSortKeys().name).toBe(MIGRATION_NAME);
  });

  test("reads only the labels without a key, as OneUptime, by id", async () => {
    seed(["Production"]);

    await new BackfillLabelNameSortKeys().migrate();

    expect(findCalls.length).toBeGreaterThanOrEqual(1);

    for (const call of findCalls) {
      expect(Object.keys(call.query)).toContain("nameSortKey");
      expect(call.select).toEqual({ _id: true, name: true });
      expect(call.sort).toEqual({ _id: SortOrder.Ascending });
      expect(call.skip).toBe(0);
      expect(call.limit).toBe(LIMIT_MAX);
      expect(call.props).toEqual({ isRoot: true });
    }

    // The first page from the start, with no cursor.
    expect(cursorOf(findCalls[0]!.query)).toBeNull();
  });

  test("writes each label's key from its name, with no hooks, its updatedAt left alone, while it keeps that name", async () => {
    const rows: Array<StoredLabel> = seed([
      "4.Business System=Customer Mobile App",
      "Claude",
      "10.Owner=Platform",
      "2.SubCategory=Website",
    ]);

    await new BackfillLabelNameSortKeys().migrate();

    expect(writes).toHaveLength(rows.length);

    for (const write of writes) {
      const row: StoredLabel = rows.find((candidate: StoredLabel): boolean => {
        return candidate.id.toString() === write.id.toString();
      })!;

      expect(write.data).toEqual({ nameSortKey: getNaturalSortKey(row.name) });
      expect(write.expectedData).toEqual({ name: row.name });
      expect(write.skipUpdateDateColumn).toBe(true);
    }

    for (const row of rows) {
      expect(row.nameSortKey).toBe(getNaturalSortKey(row.name));
    }

    // Read back in the order the keys give: the issue's order.
    expect(
      [...rows]
        .sort((first: StoredLabel, second: StoredLabel): number => {
          return first.nameSortKey! < second.nameSortKey! ? -1 : 1;
        })
        .map((row: StoredLabel): string => {
          return row.name;
        }),
    ).toEqual([
      "2.SubCategory=Website",
      "4.Business System=Customer Mobile App",
      "10.Owner=Platform",
      "Claude",
    ]);

    expect(infoLogs.join("\n")).toContain(
      "wrote the sort key of 4 label(s); 0 renamed or deleted meanwhile; 0 could not be written.",
    );
  });

  test("pages through more labels than one read holds, each page after the last label of the one before", async () => {
    const names: Array<string> = [];

    for (let index: number = 0; index < LIMIT_MAX + 5; index++) {
      names.push(`label ${index}`);
    }

    const rows: Array<StoredLabel> = seed(names);

    await new BackfillLabelNameSortKeys().migrate();

    expect(writes).toHaveLength(rows.length);
    expect(findCalls).toHaveLength(2);
    expect(cursorOf(findCalls[1]!.query)).toBe(
      rows[LIMIT_MAX - 1]!.id.toString(),
    );
    expect(
      rows.every((row: StoredLabel): boolean => {
        return row.nameSortKey !== null;
      }),
    ).toBe(true);
  });

  test("a label renamed meanwhile keeps the key its rename wrote, and is not counted", async () => {
    const rows: Array<StoredLabel> = seed(["Production", "Payments"]);
    renamedIds.add(rows[0]!.id.toString());

    await new BackfillLabelNameSortKeys().migrate();

    expect(rows[0]!.nameSortKey).toBeNull();
    expect(rows[1]!.nameSortKey).toBe(getNaturalSortKey("Payments"));
    expect(infoLogs.join("\n")).toContain(
      "wrote the sort key of 1 label(s); 1 renamed or deleted meanwhile",
    );
  });

  test("one label that cannot be written costs no other label its key, and fails nothing", async () => {
    const rows: Array<StoredLabel> = seed(["a", "b", "c"]);
    failingIds.add(rows[1]!.id.toString());

    await expect(
      new BackfillLabelNameSortKeys().migrate(),
    ).resolves.toBeUndefined();

    expect(rows[0]!.nameSortKey).toBe(getNaturalSortKey("a"));
    expect(rows[1]!.nameSortKey).toBeNull();
    expect(rows[2]!.nameSortKey).toBe(getNaturalSortKey("c"));
    expect(errorLogs.join("\n")).toContain(
      `could not write the sort key of label ${rows[1]!.id.toString()}: row locked`,
    );
    expect(infoLogs.join("\n")).toContain("1 could not be written.");
  });

  test("a label it could not write is not read again and again: the cursor moves past it", async () => {
    const names: Array<string> = [];

    for (let index: number = 0; index < LIMIT_MAX + 2; index++) {
      names.push(`label ${index}`);
    }

    const rows: Array<StoredLabel> = seed(names);
    failingIds.add(rows[0]!.id.toString());

    await new BackfillLabelNameSortKeys().migrate();

    const tries: number = attempts.filter((id: string): boolean => {
      return id === rows[0]!.id.toString();
    }).length;

    // Tried once, never again: the next page starts after it.
    expect(tries).toBe(1);
    expect(rows[0]!.nameSortKey).toBeNull();
    expect(findCalls).toHaveLength(2);
    expect(errorLogs).toHaveLength(1);
  });

  test("a read that fails fails the run, so the runner tries again", async () => {
    seed(["Production"]);
    jest
      .spyOn(LabelService, "findBy")
      .mockRejectedValue(new Error("database unreachable"));

    await expect(new BackfillLabelNameSortKeys().migrate()).rejects.toThrow(
      "database unreachable",
    );
  });

  test("a second run finds every key written and writes nothing; rollback changes nothing", async () => {
    seed(["Production", "1. Category"]);

    await new BackfillLabelNameSortKeys().migrate();

    writes = [];
    await new BackfillLabelNameSortKeys().migrate();

    expect(writes).toEqual([]);

    await expect(
      new BackfillLabelNameSortKeys().rollback(),
    ).resolves.toBeUndefined();
  });
});
