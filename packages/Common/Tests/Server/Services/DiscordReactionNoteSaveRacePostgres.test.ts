import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import type IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import WorkspaceReactionNote, {
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../Server/Utils/Workspace/WorkspaceReactionNote";
import ObjectID from "../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../Types/Workspace/WorkspaceNoteReaction";
import { DataSource } from "typeorm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Real-database race for the note save itself (HOM-43 review 4, defect c).
 * The unfenced saveNote is check-then-insert on a nonunique index: two
 * workers that both read hasNote=false both insert (Astra's exact boundary
 * — paused after hasNote, before the insert lands). The pause is produced
 * deterministically by deferring the first addNote call, so this is red on
 * the unfenced code and green once hasNote+addNote run under one advisory
 * xact lock keyed by project/resource/noteType/sourceMessageKey.
 *
 * Opt in with RUN_POSTGRES_DISCORD_OBSERVATION_TESTS=true against a
 * migrated Postgres (the parity runner sets this with PARITY_TEST_POSTGRES=1).
 */

const describePostgres = (
  process.env["RUN_POSTGRES_DISCORD_OBSERVATION_TESTS"] === "true"
    ? describe
    : describe.skip
) as typeof describe;

describePostgres(
  "WorkspaceReactionNote.saveNote double-insert race (real Postgres)",
  (): void => {
    let database: DataSource;
    let projectId: ObjectID;
    let incidentId: ObjectID;
    const userId: ObjectID = ObjectID.generate();
    const sourceMessageKey: string = "987000000000000001:987000000000000002";

    beforeAll(async (): Promise<void> => {
      database = new DataSource({
        type: "postgres",
        host: process.env["DATABASE_HOST"] || "postgres",
        port: Number(process.env["DATABASE_PORT"] || "5432"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database: process.env["DATABASE_NAME"] || "fixture",
        entities: Entities,
        synchronize: false,
      });
      await database.initialize();
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      projectId = ObjectID.generate();
      incidentId = ObjectID.generate();

      await database.query(
        `INSERT INTO "Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $3, 1) ON CONFLICT DO NOTHING`,
        [
          projectId.toString(),
          `save-race-p-${projectId}`,
          `save-race-s-${projectId}`,
        ],
      );
      const stateId: ObjectID = ObjectID.generate();
      const severityId: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "User" ("_id", "version", "email", "slug", "isEmailVerified", "twoFactorAuthEnabled", "isDisabled", "isMasterAdmin", "isBlocked", "enableTwoFactorAuth")
         VALUES ($1, 1, $2, $3, true, false, false, false, false, false)`,
        [
          userId.toString(),
          `save-race-${userId}@example.invalid`,
          `save-race-u-${userId}`,
        ],
      );
      await database.query(
        `INSERT INTO "IncidentState" ("_id", "version", "projectId", "name", "slug", "color", "isCreatedState", "isAcknowledgedState", "isResolvedState", "order")
         VALUES ($1, 1, $2, 'Created', $3, '#111111', true, false, false, 1)`,
        [stateId.toString(), projectId.toString(), `save-race-st-${stateId}`],
      );
      await database.query(
        `INSERT INTO "IncidentSeverity" ("_id", "version", "projectId", "name", "slug", "color", "order")
         VALUES ($1, 1, $2, 'Low', $3, '#888888', 1)`,
        [
          severityId.toString(),
          projectId.toString(),
          `save-race-sev-${severityId}`,
        ],
      );
      await database.query(
        `INSERT INTO "Incident" ("_id", "version", "projectId", "title", "slug",
          "currentIncidentStateId", "incidentSeverityId", "declaredAt")
         VALUES ($1, 1, $2, $3, $4, $5, $6, now())`,
        [
          incidentId.toString(),
          projectId.toString(),
          `save-race-${projectId}`,
          `save-race-i-${incidentId}`,
          stateId.toString(),
          severityId.toString(),
        ],
      );

      // The fence covers the note row; feed/notification fan-out is out of
      // scope for this race and is stubbed for isolation.
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(null as never);
    });

    beforeEach(async (): Promise<void> => {
      await database.query(
        `DELETE FROM "IncidentInternalNote" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
    });

    afterEach((): void => {
      // Note: PostgresAppInstance spies made in beforeAll are restored in
      // afterAll; restoring here would drop the DataSource for later tests.
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(
          `DELETE FROM "IncidentInternalNote" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        await database.query(`DELETE FROM "Incident" WHERE "_id" = $1`, [
          incidentId.toString(),
        ]);
        await database.query(`DELETE FROM "User" WHERE "_id" = $1`, [
          userId.toString(),
        ]);
        await database.query(
          `DELETE FROM "IncidentState" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        await database.query(
          `DELETE FROM "IncidentSeverity" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        await database.query(`DELETE FROM "Project" WHERE "_id" = $1`, [
          projectId.toString(),
        ]);
        await database.destroy();
      }
    });

    test("a worker paused between hasNote and insert cannot double-save (HOM-43 review 4c)", async (): Promise<void> => {
      let pausedArrived: (() => void) | null = null;
      const arrived: Promise<void> = new Promise<void>(
        (res: () => void): void => {
          pausedArrived = res;
        },
      );

      const realAddNote: (
        data: Parameters<typeof IncidentInternalNoteService.addNote>[0],
      ) => Promise<IncidentInternalNote> =
        IncidentInternalNoteService.addNote.bind(IncidentInternalNoteService);

      let firstCall: boolean = true;

      jest
        .spyOn(IncidentInternalNoteService, "addNote")
        .mockImplementation(
          async (
            data: Parameters<typeof IncidentInternalNoteService.addNote>[0],
          ): Promise<IncidentInternalNote> => {
            if (firstCall) {
              firstCall = false;
              // Worker A pauses INSIDE the critical section, exactly at
              // Astra's boundary: hasNote already returned false. The
              // pause is transient (300 ms): real contention windows are
              // milliseconds; a fence that survives this window with one
              // row is the production guarantee. The unfenced code lets
              // worker B complete its whole check-then-insert inside the
              // pause, which is the double insert.
              pausedArrived?.();
              await new Promise((res: (v: unknown) => void): void => {
                setTimeout(res, 300);
              });
            }
            return await realAddNote(data);
          },
        );

      const save: Promise<WorkspaceNoteSaveResult> =
        WorkspaceReactionNote.saveNote({
          resource: {
            resourceType: WorkspaceNoteResourceType.Incident,
            resourceId: incidentId,
            projectId: projectId,
          },
          noteType: WorkspaceNoteType.Private,
          userId: userId,
          note: "race note",
          sourceMessageKey: sourceMessageKey,
        });

      // Worker A is now paused after hasNote=false, before the insert.
      await arrived;

      // Worker B runs the whole save while A is paused. Fenced, B waits
      // at the advisory lock until A commits, then sees the note and
      // reports Duplicate. Unfenced, B inserts too.
      const second: WorkspaceNoteSaveResult =
        await WorkspaceReactionNote.saveNote({
          resource: {
            resourceType: WorkspaceNoteResourceType.Incident,
            resourceId: incidentId,
            projectId: projectId,
          },
          noteType: WorkspaceNoteType.Private,
          userId: userId,
          note: "race note",
          sourceMessageKey: sourceMessageKey,
        });

      // Release A; collect its result.
      const first: WorkspaceNoteSaveResult = await save;

      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*)::text as count FROM "IncidentInternalNote" WHERE "projectId" = $1 AND "incidentId" = $2 AND "postedFromSlackMessageId" = $3`,
        [projectId.toString(), incidentId.toString(), sourceMessageKey],
      );

      // Exactly one note row, and exactly one of the two workers saved it.
      expect(Number(rows[0]?.count)).toBe(1);
      expect(
        (first === WorkspaceNoteSaveResult.Saved ? 1 : 0) +
          (second === WorkspaceNoteSaveResult.Saved ? 1 : 0),
      ).toBe(1);
    });
  },
);
