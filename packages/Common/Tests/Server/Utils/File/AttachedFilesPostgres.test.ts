import Entities from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService, {
  Service as ScheduledMaintenanceServiceClass,
} from "../../../../Server/Services/ScheduledMaintenanceService";
import StatusPageAnnouncementService from "../../../../Server/Services/StatusPageAnnouncementService";
import DeleteBy from "../../../../Server/Types/Database/DeleteBy";
import logger from "../../../../Server/Utils/Logger";
import OlderRowsPurge from "../../../../Server/Utils/Retention/OlderRowsPurge";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * THE FILES ATTACHED TO A SCHEDULED MAINTENANCE EVENT, ITS NOTES AND A
 * STATUS PAGE ANNOUNCEMENT GO WITH THEM (issue #8895), against a migrated
 * Postgres: the real services' deletes - a person's (deleteBy) and a
 * retention purge's (hardDeleteBy) - over rows written as the product
 * writes them, and the database's own cascades. Before #8895 every File
 * these listed stayed in the database, unreachable, for good. What is
 * pinned is what is left after the delete:
 *
 *   - deleting an event deletes the files of its internal and public notes;
 *     deleting a note deletes its own files, and the event's other notes
 *     keep theirs; deleting an announcement deletes its files;
 *   - a file something else still uses stays: another event's note, a
 *     status page's logo; and so does a file uploaded in no project;
 *   - the purge by age (OlderRowsPurge: ScheduledMaintenanceService keeps
 *     events three years where billing is on) takes an event's files with
 *     it, and leaves a newer event's.
 *
 * Opt in with RUN_POSTGRES_ATTACHED_FILES_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_ATTACHED_FILES_TESTS=true \
 *   ATTACHED_FILES_TEST_DATABASE_HOST=127.0.0.1 \
 *   ATTACHED_FILES_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/File/AttachedFilesPostgres.test.ts
 *
 * Every row is written under projects of the test's own, deleted afterwards
 * - the files first, as a file names its project with no foreign key.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_ATTACHED_FILES_TESTS"] === "true"
    ? describe
    : describe.skip;

const DAY_MS: number = 24 * 60 * 60 * 1000;

describePostgres(
  "the files attached to scheduled maintenance and announcements, on a migrated Postgres",
  () => {
    let database: DataSource;
    const projects: Array<string> = [];

    const id: () => string = (): string => {
      return ObjectID.generate().toString();
    };

    const daysAgo: (days: number) => Date = (days: number): Date => {
      return new Date(Date.now() - days * DAY_MS);
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["ATTACHED_FILES_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["ATTACHED_FILES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["ATTACHED_FILES_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
      });
      await database.initialize();
    });

    beforeEach(() => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Workflows run elsewhere.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      for (const silenced of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, silenced).mockImplementation((): void => {
          return undefined;
        });
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        if (projects.length > 0) {
          // Files name their project with no foreign key, so they go first.
          await database.query(
            `DELETE FROM "File" WHERE "projectId" = ANY($1)`,
            [projects],
          );
          await database.query(`DELETE FROM "Project" WHERE "_id" = ANY($1)`, [
            projects,
          ]);
        }
        await database.destroy();
      }
    });

    interface SeededProject {
      projectId: string;
      scheduledStateId: string;
    }

    async function seedProject(): Promise<SeededProject> {
      const projectId: string = id();
      projects.push(projectId);

      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'Attached files test',$2,1)`,
        [projectId, `attached-files-${projectId}`],
      );

      const scheduledStateId: string = id();

      await database.query(
        `INSERT INTO "ScheduledMaintenanceState" ("_id","projectId","name","slug","color","order","version","isScheduledState") VALUES ($1,$2,'Scheduled',$3,'#000000',1,1,true)`,
        [scheduledStateId, projectId, `scheduled-${scheduledStateId}`],
      );

      return { projectId, scheduledStateId };
    }

    function rootProps(project: SeededProject): DatabaseCommonInteractionProps {
      return { isRoot: true, tenantId: new ObjectID(project.projectId) };
    }

    // A file uploaded in the project, or in none.
    async function addFile(project: SeededProject | null): Promise<string> {
      const fileId: string = id();

      await database.query(
        `INSERT INTO "File" ("_id","version","file","name","fileType","slug","projectId") VALUES ($1,1,$2,'maintenance-plan.pdf','application/pdf',$3,$4)`,
        [
          fileId,
          Buffer.from("%PDF-1.7\n"),
          `maintenance-plan-${fileId}`,
          project?.projectId || null,
        ],
      );

      return fileId;
    }

    async function addEvent(
      project: SeededProject,
      createdDaysAgo: number = 1,
    ): Promise<string> {
      const eventId: string = id();

      await database.query(
        `INSERT INTO "ScheduledMaintenance" ("_id","projectId","title","slug","currentScheduledMaintenanceStateId","startsAt","endsAt","version","createdAt") VALUES ($1,$2,'Database upgrade',$3,$4,$5,$6,1,$7)`,
        [
          eventId,
          project.projectId,
          `database-upgrade-${eventId}`,
          project.scheduledStateId,
          daysAgo(createdDaysAgo - 1),
          daysAgo(createdDaysAgo - 2),
          daysAgo(createdDaysAgo),
        ],
      );

      return eventId;
    }

    async function addNote(data: {
      noteTable:
        | "ScheduledMaintenanceInternalNote"
        | "ScheduledMaintenancePublicNote";
      project: SeededProject;
      eventId: string;
      fileIds: Array<string>;
    }): Promise<string> {
      const noteId: string = id();
      const joinColumn: string = `${data.noteTable.charAt(0).toLowerCase()}${data.noteTable.slice(1)}Id`;

      await database.query(
        `INSERT INTO "${data.noteTable}" ("_id","projectId","scheduledMaintenanceId","note","version") VALUES ($1,$2,$3,'The plan is attached.',1)`,
        [noteId, data.project.projectId, data.eventId],
      );

      for (const fileId of data.fileIds) {
        await database.query(
          `INSERT INTO "${data.noteTable}File" ("${joinColumn}","fileId") VALUES ($1,$2)`,
          [noteId, fileId],
        );
      }

      return noteId;
    }

    async function addAnnouncement(data: {
      project: SeededProject;
      fileIds: Array<string>;
    }): Promise<string> {
      const announcementId: string = id();

      await database.query(
        `INSERT INTO "StatusPageAnnouncement" ("_id","projectId","title","showAnnouncementAt","description","version") VALUES ($1,$2,'New status page',$3,'See the attached guide.',1)`,
        [announcementId, data.project.projectId, daysAgo(1)],
      );

      for (const fileId of data.fileIds) {
        await database.query(
          `INSERT INTO "StatusPageAnnouncementFile" ("statusPageAnnouncementId","fileId") VALUES ($1,$2)`,
          [announcementId, fileId],
        );
      }

      return announcementId;
    }

    async function exists(table: string, rowId: string): Promise<boolean> {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count" FROM "${table}" WHERE "_id" = $1`,
        [rowId],
      );

      return Number(rows[0]?.count) === 1;
    }

    async function countWhere(
      table: string,
      column: string,
      value: string,
    ): Promise<number> {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count" FROM "${table}" WHERE "${column}" = $1`,
        [value],
      );

      return Number(rows[0]?.count);
    }

    test("the join tables the delete reads are the migrated ones, each emptied with its note or announcement", async () => {
      const rows: Array<{ table: string; definition: string }> =
        await database.query(
          `SELECT t.relname AS "table", pg_get_constraintdef(c.oid) AS "definition"
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
            WHERE c.contype = 'f'
              AND t.relname = ANY($1)
            ORDER BY 1, 2`,
          [
            [
              "ScheduledMaintenanceInternalNoteFile",
              "ScheduledMaintenancePublicNoteFile",
              "StatusPageAnnouncementFile",
            ],
          ],
        );

      // Each lists Files, and goes with its owner: the delete reads them before.
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            table: "ScheduledMaintenanceInternalNoteFile",
            definition: expect.stringMatching(
              /^FOREIGN KEY \("scheduledMaintenanceInternalNoteId"\) REFERENCES "ScheduledMaintenanceInternalNote"\(_id\) ON UPDATE CASCADE ON DELETE CASCADE$/,
            ),
          },
          {
            table: "ScheduledMaintenancePublicNoteFile",
            definition: expect.stringMatching(
              /^FOREIGN KEY \("scheduledMaintenancePublicNoteId"\) REFERENCES "ScheduledMaintenancePublicNote"\(_id\) ON UPDATE CASCADE ON DELETE CASCADE$/,
            ),
          },
          {
            table: "StatusPageAnnouncementFile",
            definition: expect.stringMatching(
              /^FOREIGN KEY \("statusPageAnnouncementId"\) REFERENCES "StatusPageAnnouncement"\(_id\) ON UPDATE CASCADE ON DELETE CASCADE$/,
            ),
          },
        ]),
      );

      const notesCascade: Array<{ table: string }> = await database.query(
        `SELECT t.relname AS "table"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_class r ON r.oid = c.confrelid
          WHERE c.contype = 'f'
            AND r.relname = 'ScheduledMaintenance'
            AND t.relname IN ('ScheduledMaintenanceInternalNote', 'ScheduledMaintenancePublicNote')
            AND c.confdeltype = 'c'
          ORDER BY 1`,
      );

      expect(notesCascade).toEqual([
        { table: "ScheduledMaintenanceInternalNote" },
        { table: "ScheduledMaintenancePublicNote" },
      ]);
    });

    test("deleting an event deletes the files of its internal and public notes; a file another event's note still holds stays", async () => {
      const project: SeededProject = await seedProject();
      const event: string = await addEvent(project);
      const otherEvent: string = await addEvent(project);

      const internalFile: string = await addFile(project);
      const publicFile: string = await addFile(project);
      const sharedFile: string = await addFile(project);
      const otherEventsFile: string = await addFile(project);

      await addNote({
        noteTable: "ScheduledMaintenanceInternalNote",
        project,
        eventId: event,
        fileIds: [internalFile, sharedFile],
      });
      await addNote({
        noteTable: "ScheduledMaintenancePublicNote",
        project,
        eventId: event,
        fileIds: [publicFile],
      });
      await addNote({
        noteTable: "ScheduledMaintenancePublicNote",
        project,
        eventId: otherEvent,
        fileIds: [sharedFile, otherEventsFile],
      });

      expect(
        await ScheduledMaintenanceService.deleteOneById({
          id: new ObjectID(event),
          props: rootProps(project),
        }),
      ).toBe(1);

      expect(await exists("ScheduledMaintenance", event)).toBe(false);
      expect(
        await countWhere(
          "ScheduledMaintenanceInternalNote",
          "scheduledMaintenanceId",
          event,
        ),
      ).toBe(0);
      expect(await exists("File", internalFile)).toBe(false);
      expect(await exists("File", publicFile)).toBe(false);
      // Another event's note still lists it.
      expect(await exists("File", sharedFile)).toBe(true);
      expect(await exists("File", otherEventsFile)).toBe(true);
      expect(
        await countWhere(
          "ScheduledMaintenancePublicNoteFile",
          "fileId",
          sharedFile,
        ),
      ).toBe(1);
      expect(await exists("ScheduledMaintenance", otherEvent)).toBe(true);
    });

    test("a retention purge's hard delete of an event deletes its notes' files too", async () => {
      const project: SeededProject = await seedProject();
      const event: string = await addEvent(project);
      const internalFile: string = await addFile(project);
      const publicFile: string = await addFile(project);

      await addNote({
        noteTable: "ScheduledMaintenanceInternalNote",
        project,
        eventId: event,
        fileIds: [internalFile],
      });
      await addNote({
        noteTable: "ScheduledMaintenancePublicNote",
        project,
        eventId: event,
        fileIds: [publicFile],
      });

      expect(
        await ScheduledMaintenanceService.hardDeleteBy({
          query: { _id: event },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).toBe(1);

      expect(await exists("ScheduledMaintenance", event)).toBe(false);
      expect(await exists("File", internalFile)).toBe(false);
      expect(await exists("File", publicFile)).toBe(false);
    });

    test.each([
      ["ScheduledMaintenanceInternalNote" as const],
      ["ScheduledMaintenancePublicNote" as const],
    ])(
      "deleting a %s deletes its own files; the event and its other notes keep theirs",
      async (
        noteTable:
          | "ScheduledMaintenanceInternalNote"
          | "ScheduledMaintenancePublicNote",
      ) => {
        const project: SeededProject = await seedProject();
        const event: string = await addEvent(project);
        const noteFile: string = await addFile(project);
        const otherNoteFile: string = await addFile(project);

        const note: string = await addNote({
          noteTable,
          project,
          eventId: event,
          fileIds: [noteFile],
        });
        await addNote({
          noteTable,
          project,
          eventId: event,
          fileIds: [otherNoteFile],
        });

        const service: DatabaseService<BaseModel> = (noteTable ===
        "ScheduledMaintenanceInternalNote"
          ? ScheduledMaintenanceInternalNoteService
          : ScheduledMaintenancePublicNoteService) as unknown as DatabaseService<BaseModel>;

        expect(
          await service.deleteOneById({
            id: new ObjectID(note),
            props: rootProps(project),
          }),
        ).toBe(1);

        expect(await exists(noteTable, note)).toBe(false);
        expect(await exists("File", noteFile)).toBe(false);
        expect(await exists("File", otherNoteFile)).toBe(true);
        expect(await exists("ScheduledMaintenance", event)).toBe(true);
      },
    );

    test("deleting an announcement deletes its files; one a status page still uses as its logo stays", async () => {
      const project: SeededProject = await seedProject();
      const guide: string = await addFile(project);
      const logo: string = await addFile(project);
      const statusPageId: string = id();

      await database.query(
        `INSERT INTO "StatusPage" ("_id","projectId","name","slug","version","logoFileId") VALUES ($1,$2,'Acme Status',$3,1,$4)`,
        [statusPageId, project.projectId, `status-${statusPageId}`, logo],
      );

      const announcement: string = await addAnnouncement({
        project,
        fileIds: [guide, logo],
      });

      expect(
        await StatusPageAnnouncementService.deleteOneById({
          id: new ObjectID(announcement),
          props: rootProps(project),
        }),
      ).toBe(1);

      expect(await exists("StatusPageAnnouncement", announcement)).toBe(false);
      expect(await exists("File", guide)).toBe(false);
      expect(await exists("File", logo)).toBe(true);
      expect(await exists("StatusPage", statusPageId)).toBe(true);
    });

    test("a retention purge's hard delete of an announcement deletes its files too", async () => {
      const project: SeededProject = await seedProject();
      const guide: string = await addFile(project);
      const announcement: string = await addAnnouncement({
        project,
        fileIds: [guide],
      });

      expect(
        await StatusPageAnnouncementService.hardDeleteBy({
          query: { _id: announcement },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).toBe(1);

      expect(await exists("StatusPageAnnouncement", announcement)).toBe(false);
      expect(await exists("File", guide)).toBe(false);
    });

    test("a file uploaded in no project is never deleted, though a deleted announcement listed it", async () => {
      const project: SeededProject = await seedProject();
      const noProjectsFile: string = await addFile(null);
      const announcement: string = await addAnnouncement({
        project,
        fileIds: [noProjectsFile],
      });

      try {
        await StatusPageAnnouncementService.deleteOneById({
          id: new ObjectID(announcement),
          props: rootProps(project),
        });

        expect(await exists("StatusPageAnnouncement", announcement)).toBe(
          false,
        );
        expect(await exists("File", noProjectsFile)).toBe(true);
      } finally {
        await database.query(`DELETE FROM "File" WHERE "_id" = $1`, [
          noProjectsFile,
        ]);
      }
    });

    test("the files of an event and an announcement that stay are never touched", async () => {
      const project: SeededProject = await seedProject();
      const kept: string = await addEvent(project);
      const gone: string = await addEvent(project);
      const keptFile: string = await addFile(project);
      const announcementFile: string = await addFile(project);

      await addNote({
        noteTable: "ScheduledMaintenanceInternalNote",
        project,
        eventId: kept,
        fileIds: [keptFile],
      });
      await addAnnouncement({ project, fileIds: [announcementFile] });

      await ScheduledMaintenanceService.deleteOneById({
        id: new ObjectID(gone),
        props: rootProps(project),
      });

      expect(await exists("ScheduledMaintenance", gone)).toBe(false);
      expect(await exists("File", keptFile)).toBe(true);
      expect(await exists("File", announcementFile)).toBe(true);
    });

    /*
     * The purge by age (#8894) over the real ScheduledMaintenanceService, as
     * OneUptime Cloud runs it: events kept three years. Held to this
     * suite's project, as the purge itself is to no project.
     */
    test("the purge by age takes an event older than its table keeps it with its notes' files, and leaves a newer one's", async () => {
      const project: SeededProject = await seedProject();
      const old: string = await addEvent(project, 3 * 365 + 10);
      const recent: string = await addEvent(project, 30);
      const oldFile: string = await addFile(project);
      const recentFile: string = await addFile(project);

      await addNote({
        noteTable: "ScheduledMaintenancePublicNote",
        project,
        eventId: old,
        fileIds: [oldFile],
      });
      await addNote({
        noteTable: "ScheduledMaintenanceInternalNote",
        project,
        eventId: recent,
        fileIds: [recentFile],
      });

      class EventsOfThisSuite extends ScheduledMaintenanceServiceClass {
        public constructor() {
          super();
          this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);
        }

        public override async hardDeleteBy(
          deleteBy: DeleteBy<ScheduledMaintenance>,
        ): Promise<number> {
          return await super.hardDeleteBy({
            ...deleteBy,
            query: {
              ...deleteBy.query,
              projectId: new ObjectID(project.projectId),
            },
          });
        }
      }

      const events: EventsOfThisSuite = new EventsOfThisSuite();

      expect(
        await OlderRowsPurge.run({
          services: [events],
        }),
      ).toEqual({
        tables: 1,
        purged: 1,
        purgedTables: [{ table: "ScheduledMaintenance", purged: 1 }],
        failedTables: 0,
        isCutShort: false,
      });

      expect(await exists("ScheduledMaintenance", old)).toBe(false);
      expect(await exists("File", oldFile)).toBe(false);
      expect(await exists("ScheduledMaintenance", recent)).toBe(true);
      expect(await exists("File", recentFile)).toBe(true);
    });
  },
);
