import Entities from "../../../Models/DatabaseModels/Index";
import File from "../../../Models/DatabaseModels/File";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import FileOwnership from "../../../Server/Utils/File/FileOwnership";
import ObjectID from "../../../Types/ObjectID";
import { PublicNoteApprovalStatus } from "../../../Types/StatusPage/PublicNoteApproval";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * AN EDIT OF A PUBLIC NOTE IS WRITTEN ONLY AT THE VERSION IT WAS WORKED OUT
 * FROM (issue #5720), against a migrated Postgres, through the production
 * IncidentPublicNoteService.
 *
 * Public note approval works out what an edit of a note writes from the note
 * as it reads it, and names that note's version in the update's query
 * (PublicNoteApprovalEngine.holdToVersionRead). DatabaseService writes such a
 * query as a compare-and-set: a plain UPDATE asks for the version itself,
 * and a row written through save() - the Dashboard's edit of a note waiting
 * for approval always sends its files, a many-to-many list - is locked in
 * save()'s own transaction while it still holds the version, and saved
 * there (saveRowAtVersion). So the last approval of a note, written between
 * an edit's read and its save, is never overwritten by the edit: the edit
 * writes nothing, its text and its files alike.
 *
 * Opt in with RUN_POSTGRES_PUBLIC_NOTE_APPROVAL_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_PUBLIC_NOTE_APPROVAL_TESTS=true \
 *   PUBLIC_NOTE_APPROVAL_TEST_DATABASE_HOST=127.0.0.1 \
 *   PUBLIC_NOTE_APPROVAL_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/PublicNoteEditHeldToVersionPostgres.test.ts
 *
 * The tables it writes are cloned, structure only (LIKE ... INCLUDING ALL),
 * into a uniquely named schema that search_path puts first; no row is
 * written outside it, and it is dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PUBLIC_NOTE_APPROVAL_TESTS"] === "true"
    ? describe
    : describe.skip;

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

const TABLES: Array<string> = [
  "Project",
  "Incident",
  "File",
  "IncidentPublicNote",
  "IncidentPublicNoteFile",
];

const WAITING_TEXT: string = "We are looking into it.";
const EDITED_TEXT: string = "We found the cause: a database failover.";

interface NoteRow {
  note: string;
  version: number;
  isPublished: boolean;
  approvalStatus: string | null;
}

describePostgres(
  "an edit of a public note held to a version, against Postgres",
  () => {
    const schema: string = `public_note_edit_version_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();

    let database: DataSource;
    let noteId: ObjectID;
    let fileId: ObjectID;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PUBLIC_NOTE_APPROVAL_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["PUBLIC_NOTE_APPROVAL_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PUBLIC_NOTE_APPROVAL_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // What the write sets off around it: not what these tests are about.
      jest
        .spyOn(IncidentPublicNoteService, "onTriggerWorkflow")
        .mockResolvedValue();
      jest
        .spyOn(IncidentPublicNoteService, "onTriggerRealtime")
        .mockResolvedValue();
      jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue();
    });

    beforeEach(async () => {
      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
          .reverse()
          .join("; "),
      );

      noteId = ObjectID.generate();
      fileId = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version")
       VALUES ($1, 'Public note edit test', $2, 1)`,
        [projectId.toString(), `edit-${projectId.toString()}`],
      );
      await database.query(
        `INSERT INTO "${schema}"."Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "version")
       VALUES ($1, $2, 'Checkout is down', $3, $4, $5, 1)`,
        [
          incidentId.toString(),
          projectId.toString(),
          `incident-${incidentId.toString()}`,
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."File" ("_id", "projectId", "name", "file", "fileType", "slug", "version")
       VALUES ($1, $2, 'failover.png', $3, 'image/png', $4, 1)`,
        [
          fileId.toString(),
          projectId.toString(),
          Buffer.from("png"),
          `file-${fileId.toString()}`,
        ],
      );
      // A note waiting for approval, at version 1.
      await database.query(
        `INSERT INTO "${schema}"."IncidentPublicNote"
       ("_id", "projectId", "incidentId", "note", "isPublished", "approvalStatus", "version")
       VALUES ($1, $2, $3, $4, false, $5, 1)`,
        [
          noteId.toString(),
          projectId.toString(),
          incidentId.toString(),
          WAITING_TEXT,
          PublicNoteApprovalStatus.WaitingForApproval,
        ],
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function storedNote(): Promise<NoteRow | null> {
      const rows: Array<NoteRow> = await database.query(
        `SELECT "note", "version", "isPublished", "approvalStatus"
       FROM "${schema}"."IncidentPublicNote" WHERE "_id" = $1`,
        [noteId.toString()],
      );
      return rows[0] || null;
    }

    async function storedFileIds(): Promise<Array<string>> {
      const rows: Array<{ fileId: string }> = await database.query(
        `SELECT "fileId" FROM "${schema}"."IncidentPublicNoteFile"
       WHERE "incidentPublicNoteId" = $1`,
        [noteId.toString()],
      );
      return rows.map((row: { fileId: string }): string => {
        return row.fileId;
      });
    }

    function attachment(): File {
      const file: File = new File();
      file._id = fileId.toString();
      return file;
    }

    // The last approval publishing the note, as the engine writes it (writeOnce).
    async function approveAndPublish(): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."IncidentPublicNote"
       SET "isPublished" = true, "approvalStatus" = $2, "version" = "version" + 1
       WHERE "_id" = $1`,
        [noteId.toString(), PublicNoteApprovalStatus.Approved],
      );
    }

    /*
     * Lands `write` between the update's read of its rows and its write of
     * them: the file check runs on the rows read, right before they are
     * written.
     */
    function landBetweenReadAndWrite(write: () => Promise<void>): void {
      jest
        .spyOn(FileOwnership, "assertOwned")
        .mockImplementationOnce(async (): Promise<void> => {
          await write();
        });
    }

    async function edit(data: {
      version?: number;
      withFiles: boolean;
    }): Promise<number> {
      return await IncidentPublicNoteService.updateOneBy({
        query: {
          _id: noteId.toString(),
          ...(data.version !== undefined ? { version: data.version } : {}),
        } as never,
        data: {
          note: EDITED_TEXT,
          ...(data.withFiles ? { attachments: [attachment()] } : {}),
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    test("an edit with its files is written at the version its query names", async () => {
      await expect(edit({ version: 1, withFiles: true })).resolves.toBe(1);

      expect(await storedNote()).toMatchObject({
        note: EDITED_TEXT,
        isPublished: false,
      });
      expect(await storedFileIds()).toEqual([fileId.toString()]);
    });

    test("an edit of a note that moved past the version writes nothing: not its text, not its files", async () => {
      await approveAndPublish();

      await expect(edit({ version: 1, withFiles: true })).resolves.toBe(0);

      expect(await storedNote()).toEqual({
        note: WAITING_TEXT,
        version: 2,
        isPublished: true,
        approvalStatus: PublicNoteApprovalStatus.Approved,
      });
      expect(await storedFileIds()).toEqual([]);
    });

    test("an approval landing between an edit's read and its save stands, and the edit with its files writes nothing", async () => {
      landBetweenReadAndWrite(approveAndPublish);

      await expect(edit({ version: 1, withFiles: true })).resolves.toBe(0);

      // Published as approved: the edit's words and files are not on it.
      expect(await storedNote()).toEqual({
        note: WAITING_TEXT,
        version: 2,
        isPublished: true,
        approvalStatus: PublicNoteApprovalStatus.Approved,
      });
      expect(await storedFileIds()).toEqual([]);
    });

    test("an edit of the text alone is held the same way, in its UPDATE", async () => {
      landBetweenReadAndWrite(approveAndPublish);

      await expect(edit({ version: 1, withFiles: false })).resolves.toBe(0);

      expect(await storedNote()).toMatchObject({
        note: WAITING_TEXT,
        isPublished: true,
      });
    });

    test("a note deleted between an edit's read and its save is not written back", async () => {
      landBetweenReadAndWrite(async (): Promise<void> => {
        await database.query(
          `DELETE FROM "${schema}"."IncidentPublicNote" WHERE "_id" = $1`,
          [noteId.toString()],
        );
      });

      await expect(edit({ version: 1, withFiles: true })).resolves.toBe(0);

      expect(await storedNote()).toBeNull();
      expect(await storedFileIds()).toEqual([]);
    });

    test("an edit whose query names no version is written as it always was", async () => {
      landBetweenReadAndWrite(approveAndPublish);

      await expect(edit({ withFiles: true })).resolves.toBe(1);

      expect(await storedNote()).toMatchObject({ note: EDITED_TEXT });
      expect(await storedFileIds()).toEqual([fileId.toString()]);
    });
  },
);
