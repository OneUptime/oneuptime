import RunnerService from "../../../Server/Services/RunnerService";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import { AddRunnerTakesCodeFixes1808872000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1808872000000-AddRunnerTakesCodeFixes";
import Migrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Version from "../../../Types/Version";
import { afterEach, describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * RUNNER.TAKESCODEFIXES - WHAT A RUNNER SAYS ABOUT AI CODE FIXES, STORED AS
 * IT SAYS IT.
 *
 * A Runner says on registration and every heartbeat whether it takes
 * OneUptime AI's code fixes (false while ONEUPTIME_RUNNER_ENABLE_CODE_FIXES
 * =false refuses them on its host). The heartbeat stores what it said - and
 * an empty value from a release that says nothing, so a Runner put back on
 * an older release is read by that release again
 * (Types/Runner/RunnerCodeFixes) - and nobody else writes the column.
 */

const RUNNER_ID: ObjectID = new ObjectID(
  "4f3e2d1c-0b0a-4999-8888-777766665555",
);

interface UpdateCall {
  id: ObjectID;
  data: JSONObject;
  props: { isRoot?: boolean };
}

function metadata(): TableColumnMetadata {
  return new Runner().getTableColumnMetadata("takesCodeFixes");
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === Runner && column.propertyName === "takesCodeFixes";
  });
}

describe("RunnerService.heartbeat stores what the Runner says about AI code fixes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function heartbeatWith(
    takesCodeFixes: boolean | null | undefined,
  ): Promise<UpdateCall> {
    const update: jest.SpyInstance = jest
      .spyOn(RunnerService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await RunnerService.heartbeat({
      agentId: RUNNER_ID,
      agentVersion: new Version("14.0.102"),
      ...(takesCodeFixes !== undefined ? { takesCodeFixes } : {}),
    });

    expect(update).toHaveBeenCalledTimes(1);

    return update.mock.calls[0]![0] as UpdateCall;
  }

  test.each([true, false])(
    "a Runner that says %s is stored as saying it, beside its heartbeat",
    async (takesCodeFixes: boolean) => {
      const call: UpdateCall = await heartbeatWith(takesCodeFixes);

      expect(call.id).toBe(RUNNER_ID);
      expect(call.data["takesCodeFixes"]).toBe(takesCodeFixes);
      expect(call.data["connectionStatus"]).toBe(
        RunnerConnectionStatus.Connected,
      );
      expect(call.data["lastAlive"]).toBeInstanceOf(Date);
      expect(call.props).toEqual({ isRoot: true });
    },
  );

  test("a Runner that says nothing is stored as saying nothing: empty, never what an earlier release said", async () => {
    const call: UpdateCall = await heartbeatWith(null);

    expect(Object.keys(call.data)).toContain("takesCodeFixes");
    expect(call.data["takesCodeFixes"]).toBeNull();
  });

  test("a caller that does not pass it leaves the column as it is", async () => {
    const call: UpdateCall = await heartbeatWith(undefined);

    expect(Object.keys(call.data)).not.toContain("takesCodeFixes");
  });
});

describe("Runner.takesCodeFixes, the column", () => {
  test("is an optional Boolean the Runner's own heartbeat writes: nobody creates or changes it", () => {
    expect(new Runner().getTableColumns().columns).toContain("takesCodeFixes");
    expect(metadata().type).toBe(TableColumnType.Boolean);
    expect(metadata().required).toBe(false);
    // No default: empty means the Runner said nothing.
    expect(metadata().defaultValue).toBeUndefined();
    expect(metadata().title).toBe("Takes AI Code Fixes");

    const access: ColumnAccessControl | null =
      new Runner().getColumnAccessControlFor("takesCodeFixes");

    expect(access?.create).toEqual([]);
    expect(access?.update).toEqual([]);
  });

  test("is read by whoever reads a Runner's other self-reported facts", () => {
    const runner: Runner = new Runner();

    expect(
      [...(runner.getColumnAccessControlFor("takesCodeFixes")?.read || [])]
        .map(String)
        .sort(),
    ).toEqual(
      [...(runner.getColumnAccessControlFor("agentVersion")?.read || [])]
        .map(String)
        .sort(),
    );
    expect(runner.getColumnAccessControlFor("takesCodeFixes")?.read).toContain(
      Permission.ReadRunner,
    );
  });

  test("says what it is in a line the API reference can carry", () => {
    const description: string = String(metadata().description);

    expect(description).toBe(
      "Whether this Runner takes OneUptime AI's code fixes, as it said on its last heartbeat. Empty for a Runner of a release that does not say.",
    );
    expect(description.length).toBeLessThanOrEqual(150);
  });

  test("is a nullable Postgres boolean with no default", () => {
    const column: ColumnMetadataArgs | undefined = typeOrmColumn();

    expect(column).toBeDefined();
    expect(column!.options.nullable).toBe(true);
    expect(column!.options.default).toBeUndefined();
    expect(column!.options.name).toBeUndefined();
  });
});

describe("the migration that adds it", () => {
  test("adds the one nullable boolean column, and takes it away again", async () => {
    const queries: Array<string> = [];
    const runner: QueryRunner = {
      query: async (sql: string): Promise<void> => {
        queries.push(sql);
      },
    } as unknown as QueryRunner;
    const migration: AddRunnerTakesCodeFixes1808872000000 =
      new AddRunnerTakesCodeFixes1808872000000();

    await migration.up(runner);
    expect(queries).toEqual([
      `ALTER TABLE "Runner" ADD "takesCodeFixes" boolean`,
    ]);

    queries.length = 0;
    await migration.down(runner);
    expect(queries).toEqual([
      `ALTER TABLE "Runner" DROP COLUMN "takesCodeFixes"`,
    ]);

    expect(migration.name).toBe("AddRunnerTakesCodeFixes1808872000000");
  });

  test("is registered, so it runs", () => {
    const names: Array<string> = Migrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(names).toContain("AddRunnerTakesCodeFixes1808872000000");
  });
});
