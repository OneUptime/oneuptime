import DuplicateRowMerge, {
  ColumnsTakenTogether,
  DuplicateRowMergeOptions,
  DuplicateRowMergeResult,
} from "../../../../Server/Infrastructure/Postgres/DuplicateRowMerge";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import {
  HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY,
  HOST_TABLE_MERGES,
  MAX_ATTEMPTS,
  MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000,
  SET_BY_A_PERSON_TOGETHER,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806700000000-MergeDuplicateHostsAndAddUniqueHostIdentifier";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import Host from "../../../../Models/DatabaseModels/Host";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../../Models/DatabaseModels/Index";
import logger from "../../../../Server/Utils/Logger";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * MergeDuplicateHostsAndAddUniqueHostIdentifier (issue #5214), statement by
 * statement against a fake QueryRunner: for Docker hosts, Podman hosts and
 * hosts in turn, the duplicates a project has are merged, then the unique
 * index on ("projectId", LOWER("hostIdentifier")) among live rows is built
 * online - and, when a worker of the version before created a duplicate in
 * between (the build fails with unique_violation), merged and built again,
 * up to MAX_ATTEMPTS times. The entities declare each index by name with
 * synchronize: false, so no generated migration drops it.
 *
 * MergeDuplicateHostsAndAddUniqueHostIdentifierPostgres.test.ts runs it on
 * Postgres, on rows.
 */

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const EXPECTED_BUILDS: Array<string> = [
  `CREATE UNIQUE INDEX "IDX_docker_host_project_lower_host_identifier" ON "DockerHost" ("projectId", LOWER("hostIdentifier")) WHERE "deletedAt" IS NULL`,
  `CREATE UNIQUE INDEX "IDX_podman_host_project_lower_host_identifier" ON "PodmanHost" ("projectId", LOWER("hostIdentifier")) WHERE "deletedAt" IS NULL`,
  `CREATE UNIQUE INDEX "IDX_host_project_lower_host_identifier" ON "Host" ("projectId", LOWER("hostIdentifier")) WHERE "deletedAt" IS NULL`,
];

const NOTHING_MERGED: DuplicateRowMergeResult = {
  groupsMerged: 0,
  rowsMerged: 0,
  referencesMoved: 0,
  twinsDropped: 0,
};

const UNIQUE_VIOLATION: Error = Object.assign(
  new Error(
    'could not create unique index "IDX_docker_host_project_lower_host_identifier"',
  ),
  { code: "23505" },
);

let steps: Array<string>;
let buildFailures: Map<string, Array<unknown>>;

const runner: QueryRunner = {
  isTransactionActive: false,
  query: async (sql: string): Promise<void> => {
    steps.push(`query: ${sql}`);
  },
} as unknown as QueryRunner;

// Every column a merge takes together from one row.
function columnsTakenTogether(merge: DuplicateRowMergeOptions): Array<string> {
  return (merge.takenTogether || []).flatMap(
    (together: ColumnsTakenTogether): ReadonlyArray<string> => {
      return together.columns;
    },
  );
}

// The rule of SET_BY_A_PERSON_TOGETHER that takes this column.
function togetherRuleOf(column: string): ColumnsTakenTogether | undefined {
  return SET_BY_A_PERSON_TOGETHER.find(
    (together: ColumnsTakenTogether): boolean => {
      return together.columns.includes(column);
    },
  );
}

function timestampOf(migration: unknown): number {
  const match: RegExpMatchArray | null = (
    migration as { name: string }
  ).name.match(TRAILING_TIMESTAMP);
  return match ? Number(match[1]) : 0;
}

describe("MergeDuplicateHostsAndAddUniqueHostIdentifier", () => {
  beforeEach(() => {
    steps = [];
    buildFailures = new Map<string, Array<unknown>>();

    jest
      .spyOn(DuplicateRowMerge, "merge")
      .mockImplementation(
        async (
          _queryRunner: QueryRunner,
          options: DuplicateRowMergeOptions,
        ): Promise<DuplicateRowMergeResult> => {
          steps.push(`merge: ${options.table}`);
          return NOTHING_MERGED;
        },
      );
    jest
      .spyOn(OnlineDdl, "createIndex")
      .mockImplementation(async (_runner: QueryRunner, statement: string) => {
        steps.push(`build: ${statement}`);
        const failures: Array<unknown> = buildFailures.get(statement) || [];
        const failure: unknown = failures.shift();
        if (failure) {
          throw failure;
        }
      });
    jest
      .spyOn(OnlineDdl, "dropIndex")
      .mockImplementation(async (_runner: QueryRunner, statement: string) => {
        steps.push(`drop: ${statement}`);
      });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, with a timestamp of its own, after the migrations it was written against", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((migration: unknown): boolean => {
        return (
          migration ===
          MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000
        );
      }),
    ).toHaveLength(1);

    const timestamp: number = timestampOf(
      MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000,
    );

    expect(
      registered.filter((migration: unknown): boolean => {
        return timestampOf(migration) === timestamp;
      }),
    ).toHaveLength(1);

    // AddNetworkDeviceDiagnosticSnmpWalk1806600000000 was the newest then.
    expect(timestamp).toBeGreaterThan(1806600000000);
  });

  test("runs outside a transaction: the builds are online, each merge has one of its own", () => {
    const migration: MigrationInterface & { transaction?: boolean } =
      new MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000();

    expect(migration.transaction).toBe(false);
    expect(migration.name).toBe(
      "MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000",
    );
  });

  test("merges each table's duplicates, then builds its unique index online, table by table", async () => {
    await new MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000().up(
      runner,
    );

    expect(steps).toEqual([
      "merge: DockerHost",
      `build: ${EXPECTED_BUILDS[0]}`,
      "merge: PodmanHost",
      `build: ${EXPECTED_BUILDS[1]}`,
      "merge: Host",
      `build: ${EXPECTED_BUILDS[2]}`,
    ]);
  });

  test("a duplicate created while the index was being built is merged, and the index built again", async () => {
    buildFailures.set(EXPECTED_BUILDS[0]!, [
      UNIQUE_VIOLATION,
      UNIQUE_VIOLATION,
    ]);

    await new MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000().up(
      runner,
    );

    expect(steps.slice(0, 6)).toEqual([
      "merge: DockerHost",
      `build: ${EXPECTED_BUILDS[0]}`,
      "merge: DockerHost",
      `build: ${EXPECTED_BUILDS[0]}`,
      "merge: DockerHost",
      `build: ${EXPECTED_BUILDS[0]}`,
    ]);
    expect(steps).toContain(`build: ${EXPECTED_BUILDS[2]}`);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  test("a translated unique violation (driverError) counts too", async () => {
    buildFailures.set(EXPECTED_BUILDS[1]!, [
      Object.assign(new Error("query failed"), {
        driverError: { code: "23505" },
      }),
    ]);

    await new MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000().up(
      runner,
    );

    expect(
      steps.filter((step: string): boolean => {
        return step === "merge: PodmanHost";
      }),
    ).toHaveLength(2);
  });

  test(`after ${MAX_ATTEMPTS} attempts it gives up, saying why, rather than loop`, async () => {
    buildFailures.set(
      EXPECTED_BUILDS[2]!,
      Array.from({ length: MAX_ATTEMPTS }, (): Error => {
        return UNIQUE_VIOLATION;
      }),
    );

    await expect(
      new MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000().up(
        runner,
      ),
    ).rejects.toBe(UNIQUE_VIOLATION);

    expect(
      steps.filter((step: string): boolean => {
        return step === "merge: Host";
      }),
    ).toHaveLength(MAX_ATTEMPTS);
  });

  test("any other failure of a build is thrown at once, without merging again", async () => {
    const lockTimeout: Error = Object.assign(
      new Error("canceling statement due to lock timeout"),
      { code: "55P03" },
    );
    buildFailures.set(EXPECTED_BUILDS[0]!, [lockTimeout]);

    await expect(
      new MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000().up(
        runner,
      ),
    ).rejects.toBe(lockTimeout);

    expect(steps).toEqual([
      "merge: DockerHost",
      `build: ${EXPECTED_BUILDS[0]}`,
    ]);
  });

  test("down() drops the three indexes online; merged rows stay merged", async () => {
    await new MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000().down(
      runner,
    );

    expect(steps).toEqual([
      `drop: DROP INDEX "public"."IDX_host_project_lower_host_identifier"`,
      `drop: DROP INDEX "public"."IDX_podman_host_project_lower_host_identifier"`,
      `drop: DROP INDEX "public"."IDX_docker_host_project_lower_host_identifier"`,
    ]);
  });

  describe("what the merge compares and keeps", () => {
    test("duplicates are what the index compares: the project and the host name in any case, among live rows", () => {
      expect(
        HOST_TABLE_MERGES.map((merge: DuplicateRowMergeOptions): string => {
          return merge.table;
        }),
      ).toEqual(["DockerHost", "PodmanHost", "Host"]);

      for (const merge of HOST_TABLE_MERGES) {
        expect(merge.duplicateKey).toBe(`"projectId", LOWER("hostIdentifier")`);
        expect(merge.where).toBe(`"deletedAt" IS NULL`);
        expect(merge.latestBy).toBe("lastSeenAt");
        expect(merge.latestOf).toEqual(
          expect.arrayContaining([
            "lastSeenAt",
            "otelCollectorStatus",
            "agentVersion",
          ]),
        );
        // What a person set is never overwritten by what the agent reports.
        for (const column of merge.keptOrFirstOf) {
          expect(merge.latestOf).not.toContain(column);
        }
      }
    });

    test("never takes what makes the row itself - its id, project, name or identity - from a duplicate", () => {
      for (const merge of HOST_TABLE_MERGES) {
        for (const column of [
          "_id",
          "projectId",
          "name",
          "slug",
          "hostIdentifier",
          "createdAt",
          "createdByUserId",
        ]) {
          expect([
            merge.table,
            column,
            merge.latestOf.includes(column),
          ]).toEqual([merge.table, column, false]);
          expect([
            merge.table,
            column,
            merge.keptOrFirstOf.includes(column),
          ]).toEqual([merge.table, column, false]);
          expect([
            merge.table,
            column,
            columnsTakenTogether(merge).includes(column),
          ]).toEqual([merge.table, column, false]);
        }
      }
    });

    test("a column is taken by one rule only", () => {
      for (const merge of HOST_TABLE_MERGES) {
        const columns: Array<string> = [
          ...merge.latestOf,
          ...merge.keptOrFirstOf,
          ...columnsTakenTogether(merge),
        ];

        expect([merge.table, new Set(columns).size]).toEqual([
          merge.table,
          columns.length,
        ]);
      }
    });

    test("every host table takes the same columns together, from one copy each", () => {
      for (const merge of HOST_TABLE_MERGES) {
        expect([merge.table, merge.takenTogether]).toEqual([
          merge.table,
          SET_BY_A_PERSON_TOGETHER,
        ]);
      }
    });

    test("a host stays archived only if every copy was: the flag, with when and by whom, from a copy left on the list", () => {
      const archive: ColumnsTakenTogether | undefined =
        togetherRuleOf("isArchived");

      expect(archive).toEqual({
        columns: ["isArchived", "archivedAt", "archivedByUserId"],
        where: `member."isArchived" IS NOT TRUE`,
      });

      for (const merge of HOST_TABLE_MERGES) {
        // Never column by column: a copy's archivedAt without its flag.
        for (const column of archive!.columns) {
          expect([
            merge.table,
            column,
            merge.latestOf.includes(column),
          ]).toEqual([merge.table, column, false]);
          expect([
            merge.table,
            column,
            merge.keptOrFirstOf.includes(column),
          ]).toEqual([merge.table, column, false]);
        }
      }
    });

    test("the AI settings a person may change are taken together, from a copy an operator chose them for", () => {
      const ai: ColumnsTakenTogether | undefined = togetherRuleOf(
        "aiAccessConfiguredAt",
      );

      expect(ai).toBeDefined();
      expect(ai!.where).toBe(`member."aiAccessConfiguredAt" IS NOT NULL`);
      // When the operator chose them comes with them.
      expect(ai!.columns).toContain("aiAccessConfiguredAt");

      const modelsByTable: Map<string, BaseModel> = new Map<string, BaseModel>(
        Models.map((modelType: { new (): BaseModel }): [string, BaseModel] => {
          const model: BaseModel = new modelType();
          return [model.tableName || "", model];
        }),
      );

      for (const merge of HOST_TABLE_MERGES) {
        const model: BaseModel = modelsByTable.get(merge.table)!;

        // Every AI column a person may change, read from the model.
        const settings: Array<string> = model
          .getTableColumns()
          .columns.filter((column: string): boolean => {
            const update: Array<unknown> | undefined =
              model.getColumnAccessControlFor(column)?.update;

            return (
              (column.startsWith("ai") || column.startsWith("isAi")) &&
              Array.isArray(update) &&
              update.length > 0
            );
          });

        expect(settings).toEqual(
          expect.arrayContaining([
            "isAiInvestigationEnabled",
            "aiRemediationMode",
            "aiCommandAllowlist",
          ]),
        );

        for (const column of settings) {
          expect([merge.table, column, ai!.columns.includes(column)]).toEqual([
            merge.table,
            column,
            true,
          ]);
        }
      }
    });

    test("every column it takes is a column of the model", () => {
      const modelsByTable: Map<string, BaseModel> = new Map<string, BaseModel>(
        Models.map((modelType: { new (): BaseModel }): [string, BaseModel] => {
          const model: BaseModel = new modelType();
          return [model.tableName || "", model];
        }),
      );

      for (const merge of HOST_TABLE_MERGES) {
        const model: BaseModel = modelsByTable.get(merge.table)!;

        for (const column of [
          ...merge.latestOf,
          ...merge.keptOrFirstOf,
          ...columnsTakenTogether(merge),
          merge.latestBy,
        ]) {
          expect([
            merge.table,
            column,
            Boolean(model.getTableColumnMetadata(column)),
          ]).toEqual([merge.table, column, true]);
        }
      }
    });

    test("the ids kept without a foreign key name a column of a real model", () => {
      const modelsByTable: Map<string, BaseModel> = new Map<string, BaseModel>(
        Models.map((modelType: { new (): BaseModel }): [string, BaseModel] => {
          const model: BaseModel = new modelType();
          return [model.tableName || "", model];
        }),
      );

      expect(HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY.length).toBeGreaterThan(0);

      for (const entry of HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY) {
        const model: BaseModel | undefined = modelsByTable.get(entry.table);
        expect([entry.table, Boolean(model)]).toEqual([entry.table, true]);
        expect([
          entry.table,
          entry.column,
          Boolean(model!.getTableColumnMetadata(entry.column)),
        ]).toEqual([entry.table, entry.column, true]);
      }
    });
  });

  describe("the entities", () => {
    const indexOf: (
      target: { new (): BaseModel },
      name: string,
    ) => IndexMetadataArgs | undefined = (
      target: { new (): BaseModel },
      name: string,
    ): IndexMetadataArgs | undefined => {
      return getMetadataArgsStorage().indices.find(
        (index: IndexMetadataArgs): boolean => {
          return index.target === target && index.name === name;
        },
      );
    };

    test.each([
      [DockerHost, "IDX_docker_host_project_lower_host_identifier"],
      [PodmanHost, "IDX_podman_host_project_lower_host_identifier"],
      [Host, "IDX_host_project_lower_host_identifier"],
    ] as Array<[{ new (): BaseModel }, string]>)(
      "%p declares %s by name with synchronize: false, so no generated migration drops it",
      (target: { new (): BaseModel }, name: string) => {
        const index: IndexMetadataArgs | undefined = indexOf(target, name);

        expect(index).toBeDefined();
        expect(index!.synchronize).toBe(false);
        expect(index!.columns).toEqual(["projectId", "hostIdentifier"]);
      },
    );

    test("the names the entities declare are the indexes the migration builds", () => {
      for (const [index, build] of [
        ["IDX_docker_host_project_lower_host_identifier", EXPECTED_BUILDS[0]],
        ["IDX_podman_host_project_lower_host_identifier", EXPECTED_BUILDS[1]],
        ["IDX_host_project_lower_host_identifier", EXPECTED_BUILDS[2]],
      ] as Array<[string, string]>) {
        expect(build).toContain(`"${index}"`);
      }
    });
  });
});
