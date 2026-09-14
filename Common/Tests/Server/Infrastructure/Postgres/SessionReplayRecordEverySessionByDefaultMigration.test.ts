import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { SessionReplayRecordEverySessionByDefault1791400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1791400000000-SessionReplayRecordEverySessionByDefault";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import SessionReplayCaptureTrigger from "../../../../Types/Rum/SessionReplayCaptureTrigger";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";

/*
 * The migration that makes session replay record every session rather than
 * only the ones that broke.
 *
 * The reported bug was not that playback was broken for unfailed sessions —
 * it was that they were never uploaded at all. `OnErrorOrFrustration` with
 * `sessionReplaySamplePercentage: 0` means the recorder buffers in memory and
 * posts nothing until an error, a 5xx or a frustration signal fires, so the
 * only rows that ever reached the session list carried one of those signals.
 * Everything else read as "Metadata only" or as no row at all, which is
 * indistinguishable from a feature that does not work.
 *
 * Three things are pinned here, and each of them is a silent regression if it
 * moves on its own:
 *
 *  1. THE ENTITY AND THE MIGRATION AGREE. A default lives in two places —
 *     the @Column decorator TypeORM generates DDL from, and the ALTER this
 *     migration runs on databases that already exist. If only one moves, a
 *     fresh install and an upgraded install disagree about what recording
 *     means, and the schema-drift job does not catch a DEFAULT that matches
 *     the entity it was generated from.
 *
 *  2. THE BACKFILL IS SCOPED TO ROWS STILL ON BOTH OLD DEFAULTS. An
 *     unscoped UPDATE would overwrite a deliberate configuration; scoping on
 *     only one of the two columns would catch an application whose operator
 *     had set the other on purpose. Requiring both is the closest a
 *     migration can get to "was never configured", and widening it later
 *     would quietly increase how much end-user data an install records.
 *
 *  3. down() REVERSES THE DEFAULTS AND NOT THE BACKFILL. Rows moved by the
 *     backfill are indistinguishable from ones an operator chose afterwards,
 *     so moving them back would silently stop recording sessions somebody is
 *     relying on being able to watch.
 */

const MIGRATION_PATH: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1791400000000-SessionReplayRecordEverySessionByDefault.ts",
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

function bodyOf(method: "up" | "down"): string {
  const start: number = SOURCE.indexOf(`public async ${method}(`);

  expect(start).toBeGreaterThan(-1);

  const end: number =
    method === "up" ? SOURCE.indexOf("public async down(") : SOURCE.length;

  return SOURCE.slice(start, end);
}

function statementsIn(body: string): Array<string> {
  return [...body.matchAll(/`([^`]+)`/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const UP_STATEMENTS: Array<string> = statementsIn(bodyOf("up"));
const DOWN_STATEMENTS: Array<string> = statementsIn(bodyOf("down"));

describe("SessionReplayRecordEverySessionByDefault migration", () => {
  test("it is registered in the schema migration list", () => {
    expect(SchemaMigrations).toContain(
      SessionReplayRecordEverySessionByDefault1791400000000,
    );
  });

  test("its class name matches its file name, so typeorm can find it", () => {
    expect(
      new SessionReplayRecordEverySessionByDefault1791400000000().name,
    ).toBe("SessionReplayRecordEverySessionByDefault1791400000000");
  });

  test("it moves both column defaults to always-on recording", () => {
    expect(UP_STATEMENTS).toContain(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayCaptureTrigger" SET DEFAULT 'Always'`,
    );
    expect(UP_STATEMENTS).toContain(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplaySamplePercentage" SET DEFAULT 100`,
    );
  });

  test("it backfills only rows still sitting on BOTH previous defaults", () => {
    const updates: Array<string> = UP_STATEMENTS.filter(
      (statement: string): boolean => {
        return statement.startsWith("UPDATE ");
      },
    );

    expect(updates).toHaveLength(1);

    const update: string = updates[0] as string;

    expect(update).toContain(`"sessionReplayCaptureTrigger" = 'Always'`);
    expect(update).toContain(`"sessionReplaySamplePercentage" = 100`);

    /*
     * The WHERE is the entire safety property. Both conditions, joined by
     * AND: an application whose operator chose Always, or dialled the
     * sample percentage anywhere off zero, is left exactly as configured.
     */
    const where: string = update.slice(update.indexOf(" WHERE "));

    expect(where).toContain(
      `"sessionReplayCaptureTrigger" = 'OnErrorOrFrustration'`,
    );
    expect(where).toContain(`"sessionReplaySamplePercentage" = 0`);
    expect(where).toContain(" AND ");
    expect(where).not.toContain(" OR ");
  });

  test("down() restores the defaults and leaves the backfilled rows alone", () => {
    expect(DOWN_STATEMENTS).toContain(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayCaptureTrigger" SET DEFAULT 'OnErrorOrFrustration'`,
    );
    expect(DOWN_STATEMENTS).toContain(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplaySamplePercentage" SET DEFAULT 0`,
    );

    expect(
      DOWN_STATEMENTS.some((statement: string): boolean => {
        return statement.startsWith("UPDATE ");
      }),
    ).toBe(false);
  });
});

describe("RumApplication session replay capture defaults", () => {
  test("a new application records every session from its first event", () => {
    const application: RumApplication = new RumApplication();

    const trigger: TableColumnMetadata = application.getTableColumnMetadata(
      "sessionReplayCaptureTrigger",
    );
    const sample: TableColumnMetadata = application.getTableColumnMetadata(
      "sessionReplaySamplePercentage",
    );

    expect(trigger.defaultValue).toBe(SessionReplayCaptureTrigger.Always);
    expect(sample.defaultValue).toBe(100);
  });

  /*
   * The dashboard form renders this enum straight into a dropdown, in
   * declaration order, so the first member is what a person reads as the
   * recommended answer. Keeping Always first is the difference between the
   * default being discoverable and being buried under the option that
   * records nothing for a healthy visit.
   */
  test("Always is the first capture trigger a person is offered", () => {
    expect(Object.values(SessionReplayCaptureTrigger)).toEqual([
      SessionReplayCaptureTrigger.Always,
      SessionReplayCaptureTrigger.OnErrorOrFrustration,
    ]);
  });
});
