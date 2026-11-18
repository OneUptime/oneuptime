import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddSampleProject1809123500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123500000-AddSampleProject";
import { AddSampleProjectUserIndex1809123500001 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123500001-AddSampleProjectUserIndex";
import { MasterApiKeyHashedColumn1809180790100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180790100-MasterApiKeyHashedColumn";
import { RemoveSampleProject1809180800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180800000-RemoveSampleProject";
import { KeepSampleProjectColumns1809183500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183500000-KeepSampleProjectColumns";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import { getColumnAccessControlForAllColumns } from "../../../../Types/Database/AccessControl/ColumnAccessControl";
import { getTableColumn } from "../../../../Types/Database/TableColumn";
import logger from "../../../../Server/Utils/Logger";
import {
  DefaultNamingStrategy,
  MigrationInterface,
  QueryRunner,
} from "typeorm";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The sample project is removed (it was added by AddSampleProject and
 * AddSampleProjectUserIndex, issue #6808): its data now, its columns in a
 * later release (expand, then contract).
 *
 * RemoveSampleProject:
 *   - deletes every made-up person (User.sampleProjectId), then every sample
 *     project (Project.isSampleProject) and everything in it: with the code
 *     that kept a sample quiet gone, one left behind would notify, probe and
 *     bill, and its people would be counted users;
 *   - one row a statement, each within OnlineDdl's long limits: deleting a
 *     "User" row makes Postgres scan every column that references "User",
 *     about 12 s a person on OneUptime Cloud, and the one statement that
 *     deleted every sample (and, by cascade, every person) there ran out of
 *     the 30 s statement timeout at every attempt - the release's migrate
 *     Job failed and its pods never started;
 *   - drops no column: the pods of the release before keep serving while a
 *     release's migrations run, and they read both - every probe's claim of
 *     its monitors filters on Project.isSampleProject, every insert into
 *     "User" and "Project" names both. When 15.0.0 dropped them, no probe
 *     check ran from that moment until the last of those pods was gone.
 *
 * KeepSampleProjectColumns puts the columns, the index and the foreign key
 * back where 15.0.0 already dropped them, as the migrations that added them
 * made them, and changes nothing where they never went. The models keep
 * them, read and written by nobody, until a later release drops them.
 *
 * Statements are recorded against a fake QueryRunner, the online steps by
 * stubbing OnlineDdl; the schema drift check runs them on Postgres against
 * the models. The names are TypeORM's, worked out here as it works them out.
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const INDEX_NAME: string = naming.indexName("User", ["sampleProjectId"]);
const FOREIGN_KEY_NAME: string = naming.foreignKeyName(
  "User",
  ["sampleProjectId"],
  "Project",
  ["_id"],
);

const SELECT_PEOPLE: string = `SELECT "_id" FROM "User" WHERE "sampleProjectId" IS NOT NULL ORDER BY "_id"`;
const SELECT_SAMPLES: string = `SELECT "_id" FROM "Project" WHERE "isSampleProject" = true ORDER BY "_id"`;
const DELETE_PERSON: string = `DELETE FROM "User" WHERE "_id" = $1 AND "sampleProjectId" IS NOT NULL`;
const DELETE_SAMPLE: string = `DELETE FROM "Project" WHERE "_id" = $1 AND "isSampleProject" = true`;

// Made-up people and sample projects, as the selects above answer them.
const PEOPLE: Array<string> = [
  "11111111-0000-4000-8000-000000000001",
  "11111111-0000-4000-8000-000000000002",
  "11111111-0000-4000-8000-000000000003",
];
const SAMPLES: Array<string> = [
  "22222222-0000-4000-8000-000000000001",
  "22222222-0000-4000-8000-000000000002",
];

function longDelete(statement: string, id: string): string {
  return `OnlineDdl.runLongStatement: ${statement} ${JSON.stringify([id])}`;
}

// Every statement, in the order it ran; an online one names its step.
type Recorded = Array<string>;

async function record(data: {
  migration: MigrationInterface;
  direction: "up" | "down";
  // The columns the database still has, as hasColumn answers.
  columns?: Array<string>;
  // The made-up people and samples the database still has.
  people?: Array<string>;
  samples?: Array<string>;
}): Promise<Recorded> {
  const recorded: Recorded = [];

  for (const step of ["createIndex", "dropIndex", "addForeignKey"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      sql: string,
    ) => {
      recorded.push(`OnlineDdl.${step}: ${sql}`);
    }) as never);
  }

  jest.spyOn(OnlineDdl, "runLongStatement").mockImplementation((async (
    _runner: QueryRunner,
    sql: string,
    parameters: Array<unknown> = [],
  ): Promise<number> => {
    recorded.push(
      `OnlineDdl.runLongStatement: ${sql} ${JSON.stringify(parameters)}`,
    );
    return 1;
  }) as never);

  const columns: Array<string> = data.columns || [
    "Project.isSampleProject",
    "User.sampleProjectId",
  ];

  const runner: QueryRunner = {
    isTransactionActive: false,
    query: async (sql: string): Promise<unknown> => {
      recorded.push(sql);

      if (sql === SELECT_PEOPLE) {
        return (data.people || []).map((id: string) => {
          return { _id: id };
        });
      }

      if (sql === SELECT_SAMPLES) {
        return (data.samples || []).map((id: string) => {
          return { _id: id };
        });
      }

      return undefined;
    },
    hasColumn: async (table: string, column: string): Promise<boolean> => {
      return columns.includes(`${table}.${column}`);
    },
  } as unknown as QueryRunner;

  if (data.direction === "up") {
    await data.migration.up(runner);
  } else {
    await data.migration.down(runner);
  }

  return recorded;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RemoveSampleProject1809180800000", () => {
  test("runs outside a transaction: each delete commits as it ends", () => {
    expect(new RemoveSampleProject1809180800000().transaction).toBe(false);
  });

  test("deletes each made-up person, then each sample, one statement each, and nothing else", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      people: PEOPLE,
      samples: SAMPLES,
    });

    expect(recorded).toEqual([
      SELECT_PEOPLE,
      SELECT_SAMPLES,
      ...PEOPLE.map((id: string) => {
        return longDelete(DELETE_PERSON, id);
      }),
      ...SAMPLES.map((id: string) => {
        return longDelete(DELETE_SAMPLE, id);
      }),
    ]);
  });

  test("drops no column, key or index: the pods of the release before still read them", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      people: PEOPLE,
      samples: SAMPLES,
    });

    for (const statement of recorded) {
      expect(statement).not.toMatch(/\bDROP\b|\bALTER\b/);
    }
  });

  test("no delete runs under the pool's 30 s statement timeout: every one is a long statement of OnlineDdl's", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      people: PEOPLE,
      samples: SAMPLES,
    });

    const deletes: Array<string> = recorded.filter(
      (statement: string): boolean => {
        return statement.includes("DELETE");
      },
    );

    expect(deletes).toHaveLength(PEOPLE.length + SAMPLES.length);

    for (const statement of deletes) {
      expect(statement.startsWith("OnlineDdl.runLongStatement: ")).toBe(true);
    }
  });

  test("each statement deletes one row, by its id, and only while it is still a sample's", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      people: PEOPLE,
      samples: SAMPLES,
    });

    const prefix: string = "OnlineDdl.runLongStatement: ";
    const deletes: Array<{ sql: string; parameters: Array<unknown> }> = recorded
      .filter((statement: string): boolean => {
        return statement.startsWith(prefix);
      })
      .map((statement: string) => {
        const parametersAt: number = statement.lastIndexOf(" [");

        return {
          sql: statement.slice(prefix.length, parametersAt),
          parameters: JSON.parse(
            statement.slice(parametersAt + 1),
          ) as Array<unknown>,
        };
      });

    expect(deletes).toEqual([
      ...PEOPLE.map((id: string) => {
        return { sql: DELETE_PERSON, parameters: [id] };
      }),
      ...SAMPLES.map((id: string) => {
        return { sql: DELETE_SAMPLE, parameters: [id] };
      }),
    ]);

    // Still a sample's: a re-run, or a reused id, deletes nobody real.
    expect(DELETE_PERSON).toContain(`AND "sampleProjectId" IS NOT NULL`);
    expect(DELETE_SAMPLE).toContain(`AND "isSampleProject" = true`);
  });

  test("deletes the people before their samples, so no statement takes a sample's people with it", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      people: PEOPLE,
      samples: SAMPLES,
    });

    const lastPerson: number = recorded.lastIndexOf(
      longDelete(DELETE_PERSON, PEOPLE[PEOPLE.length - 1]!),
    );
    const firstSample: number = recorded.indexOf(
      longDelete(DELETE_SAMPLE, SAMPLES[0]!),
    );

    expect(lastPerson).toBeGreaterThanOrEqual(0);
    expect(lastPerson).toBeLessThan(firstSample);
  });

  test("with no sample and no made-up person left, it deletes nothing", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
    });

    expect(recorded).toEqual([SELECT_PEOPLE, SELECT_SAMPLES]);
  });

  test("says how many it is removing, since a large install takes minutes", async () => {
    const info: SpyInstance<typeof logger.info> = jest
      .spyOn(logger, "info")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      people: PEOPLE,
      samples: SAMPLES,
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toContain(
      "Removing 2 sample project(s) and 3 made-up person(s), one statement each",
    );
  });

  test("a failed delete stops the run there, and the next run finds what is left", async () => {
    const recorded: Recorded = [];

    jest.spyOn(OnlineDdl, "runLongStatement").mockImplementation((async (
      _runner: QueryRunner,
      sql: string,
      parameters: Array<unknown> = [],
    ): Promise<number> => {
      recorded.push(`${sql} ${JSON.stringify(parameters)}`);

      if (parameters[0] === PEOPLE[1]) {
        throw new Error("canceling statement due to statement timeout");
      }

      return 1;
    }) as never);

    const runner: QueryRunner = {
      isTransactionActive: false,
      query: async (sql: string): Promise<unknown> => {
        recorded.push(sql);

        if (sql === SELECT_PEOPLE) {
          return PEOPLE.map((id: string) => {
            return { _id: id };
          });
        }

        if (sql === SELECT_SAMPLES) {
          return SAMPLES.map((id: string) => {
            return { _id: id };
          });
        }

        return undefined;
      },
      hasColumn: async (): Promise<boolean> => {
        return true;
      },
    } as unknown as QueryRunner;

    await expect(
      new RemoveSampleProject1809180800000().up(runner),
    ).rejects.toThrow("canceling statement due to statement timeout");

    expect(recorded).not.toContain(
      `${DELETE_SAMPLE} ${JSON.stringify([SAMPLES[0]])}`,
    );
  });

  test("run again after a stop part way, it deletes only what is left, and fails on nothing gone", async () => {
    // Stopped part way through the people: the rest are still found.
    const partWay: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      people: [PEOPLE[2]!],
      samples: SAMPLES,
    });

    expect(
      partWay.filter((statement: string): boolean => {
        return statement.includes("DELETE");
      }),
    ).toEqual([
      longDelete(DELETE_PERSON, PEOPLE[2]!),
      ...SAMPLES.map((id: string) => {
        return longDelete(DELETE_SAMPLE, id);
      }),
    ]);

    // An install whose columns 15.0.0's version of this already dropped.
    const columnsGone: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      columns: [],
      people: PEOPLE,
      samples: SAMPLES,
    });

    expect(columnsGone).toEqual([]);
  });

  test("down changes nothing: the schema is as it was, and made-up samples are not put back", async () => {
    expect(
      await record({
        migration: new RemoveSampleProject1809180800000(),
        direction: "down",
      }),
    ).toEqual([]);
  });
});

describe("KeepSampleProjectColumns1809183500000", () => {
  test("runs outside a transaction, as an online index build and validation must", () => {
    expect(new KeepSampleProjectColumns1809183500000().transaction).toBe(false);
  });

  test("puts back the columns, the index and the key - each only if missing", async () => {
    const recorded: Recorded = await record({
      migration: new KeepSampleProjectColumns1809183500000(),
      direction: "up",
    });

    expect(recorded).toEqual([
      `ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "isSampleProject" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sampleProjectId" uuid`,
      `OnlineDdl.createIndex: CREATE INDEX "${INDEX_NAME}" ON "User" ("sampleProjectId") `,
      `OnlineDdl.addForeignKey: ALTER TABLE "User" ADD CONSTRAINT "${FOREIGN_KEY_NAME}" FOREIGN KEY ("sampleProjectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);
  });

  test("builds what the migrations that added the sample project built, by the same names", async () => {
    const added: Recorded = [
      ...(await record({
        migration: new AddSampleProject1809123500000(),
        direction: "up",
      })),
      ...(await record({
        migration: new AddSampleProjectUserIndex1809123500001(),
        direction: "up",
      })),
    ];

    const kept: Recorded = await record({
      migration: new KeepSampleProjectColumns1809183500000(),
      direction: "up",
    });

    expect(added).toEqual([
      `ALTER TABLE "Project" ADD "isSampleProject" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "User" ADD "sampleProjectId" uuid`,
      `OnlineDdl.createIndex: CREATE INDEX "${INDEX_NAME}" ON "User" ("sampleProjectId") `,
      `OnlineDdl.addForeignKey: ALTER TABLE "User" ADD CONSTRAINT "${FOREIGN_KEY_NAME}" FOREIGN KEY ("sampleProjectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);

    /*
     * The same, each column added only where it is missing (the online
     * index build and key are skipped by OnlineDdl when they are there).
     */
    expect(kept).toEqual(
      added.map((statement: string): string => {
        return statement.startsWith("ALTER TABLE") &&
          !statement.includes("ADD CONSTRAINT")
          ? statement.replace(" ADD ", " ADD COLUMN IF NOT EXISTS ")
          : statement;
      }),
    );
  });

  test("down changes nothing", async () => {
    expect(
      await record({
        migration: new KeepSampleProjectColumns1809183500000(),
        direction: "down",
      }),
    ).toEqual([]);
  });
});

describe("the models keep the columns for the release before, read and written by nobody", () => {
  test("Project.isSampleProject: a boolean, false by default", () => {
    const column: ReturnType<typeof getTableColumn> = getTableColumn(
      new Project(),
      "isSampleProject",
    );

    expect(column).toBeDefined();
    expect(column!.defaultValue).toBe(false);
    expect(column!.hideColumnInDocumentation).toBe(true);
  });

  test("User.sampleProjectId and its relation", () => {
    expect(getTableColumn(new User(), "sampleProjectId")).toBeDefined();
    expect(getTableColumn(new User(), "sampleProject")).toBeDefined();
    expect(
      getTableColumn(new User(), "sampleProjectId")!.hideColumnInDocumentation,
    ).toBe(true);
    expect(
      getTableColumn(new User(), "sampleProject")!.hideColumnInDocumentation,
    ).toBe(true);
  });

  test("nobody creates, reads or updates any of them through the API", () => {
    const projectAccess: ReturnType<
      typeof getColumnAccessControlForAllColumns
    > = getColumnAccessControlForAllColumns(new Project());
    const userAccess: ReturnType<typeof getColumnAccessControlForAllColumns> =
      getColumnAccessControlForAllColumns(new User());

    for (const access of [
      projectAccess["isSampleProject"],
      userAccess["sampleProjectId"],
      userAccess["sampleProject"],
    ]) {
      expect(access).toEqual({ create: [], read: [], update: [] });
    }
  });
});

describe("their place", () => {
  test("RemoveSampleProject: registered once, after the migrations that added the sample project and the one before it", () => {
    const migrations: Array<unknown> = SchemaMigrations as Array<unknown>;
    const removal: number = migrations.indexOf(
      RemoveSampleProject1809180800000,
    );

    expect(removal).toBeGreaterThan(
      migrations.indexOf(AddSampleProjectUserIndex1809123500001),
    );
    expect(removal).toBeGreaterThan(
      migrations.indexOf(MasterApiKeyHashedColumn1809180790100),
    );
    expect(
      migrations.filter((migration: unknown): boolean => {
        return migration === RemoveSampleProject1809180800000;
      }),
    ).toHaveLength(1);
  });

  test("KeepSampleProjectColumns: registered once, after RemoveSampleProject", () => {
    const migrations: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      migrations.indexOf(KeepSampleProjectColumns1809183500000),
    ).toBeGreaterThan(migrations.indexOf(RemoveSampleProject1809180800000));
    expect(
      migrations.filter((migration: unknown): boolean => {
        return migration === KeepSampleProjectColumns1809183500000;
      }),
    ).toHaveLength(1);
  });

  test("the migrations that added the sample project stay registered: installs have run them", () => {
    const migrations: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(migrations).toContain(AddSampleProject1809123500000);
    expect(migrations).toContain(AddSampleProjectUserIndex1809123500001);
  });
});
