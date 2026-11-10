import Entities from "../../../Models/DatabaseModels/Index";
import { PublicNoteApprovalRequestKind } from "../../../Models/DatabaseModels/PublicNoteApprovalRequest";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import PublicNoteApprovalRequestService, {
  PublicNoteApprovalRequestRow,
} from "../../../Server/Services/PublicNoteApprovalRequestService";
import ObjectID from "../../../Types/ObjectID";
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
 * EACH REQUEST TO APPROVE A PUBLIC NOTE IS WRITTEN ONCE (#6353), against a
 * migrated Postgres, through the production PublicNoteApprovalRequestService.
 *
 * Whom a step of a note asked is decided by what the table holds, never by
 * timing: a claim writes the person's requests for the step in one INSERT
 * ... ON CONFLICT DO NOTHING over the unique index, and hands back what it
 * wrote. So of many claims at once - passes of several processes, a save
 * and a decision - each request goes to exactly one, and a person is asked
 * by each kind of message once.
 *
 * Opt in with RUN_POSTGRES_PUBLIC_NOTE_APPROVAL_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_PUBLIC_NOTE_APPROVAL_TESTS=true \
 *   PUBLIC_NOTE_APPROVAL_TEST_DATABASE_HOST=127.0.0.1 \
 *   PUBLIC_NOTE_APPROVAL_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/PublicNoteApprovalRequestPostgres.test.ts
 *
 * The table is cloned, structure and indexes (LIKE ... INCLUDING ALL), into
 * a uniquely named schema that search_path puts first; no row is written
 * outside it, and it is dropped afterwards.
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

const TABLE: string = "PublicNoteApprovalRequest";

const SUBMITTED_AT: string = "2026-11-09T09:00:00.000Z";
const STEP_ID: string = "5e000000-0000-4000-8000-0000000000a1";

function rows(data: {
  isFinal: boolean;
  isAskedAgain?: boolean;
}): Array<PublicNoteApprovalRequestRow> {
  return [
    {
      kind: PublicNoteApprovalRequestKind.Notifications,
      isFinal: false,
      isAskedAgain: Boolean(data.isAskedAgain),
    },
    {
      kind: PublicNoteApprovalRequestKind.Chat,
      isFinal: data.isFinal,
      isAskedAgain: false,
    },
  ];
}

describePostgres("requests to approve a public note, against Postgres", () => {
  const schema: string = `public_note_approval_request_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectId: ObjectID = ObjectID.generate();
  const noteId: ObjectID = ObjectID.generate();
  const bob: ObjectID = ObjectID.generate();
  const carol: ObjectID = ObjectID.generate();

  let database: DataSource;

  async function claim(data: {
    userId: ObjectID;
    rows: Array<PublicNoteApprovalRequestRow>;
    stepId?: string;
  }): Promise<Array<PublicNoteApprovalRequestKind>> {
    return await PublicNoteApprovalRequestService.claim({
      projectId,
      noteColumn: "incidentPublicNoteId",
      noteId,
      userId: data.userId,
      submittedAt: SUBMITTED_AT,
      stepId: data.stepId || STEP_ID,
      rows: data.rows,
    });
  }

  async function count(): Promise<number> {
    const result: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS "count" FROM "${schema}"."${TABLE}"`,
    );
    return Number(result[0]?.count || 0);
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["PUBLIC_NOTE_APPROVAL_TEST_DATABASE_HOST"] || "localhost",
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
      // Room for the claims made at once below.
      extra: { options: `-c search_path=${schema},public`, max: 25 },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("the table's unique index holds a request once", async () => {
    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
      [schema, TABLE],
    );

    expect(
      indexes.some((index: { indexdef: string }): boolean => {
        return (
          index.indexdef.startsWith("CREATE UNIQUE INDEX") &&
          index.indexdef.includes(
            `("noteId", "submittedAt", "stepId", kind, "isFinal", "isAskedAgain", "userId")`,
          )
        );
      }),
    ).toBe(true);
  });

  test("a first claim writes both requests; the same claim again writes none", async () => {
    await expect(
      claim({ userId: bob, rows: rows({ isFinal: false }) }),
    ).resolves.toEqual([
      PublicNoteApprovalRequestKind.Notifications,
      PublicNoteApprovalRequestKind.Chat,
    ]);
    await expect(
      claim({ userId: bob, rows: rows({ isFinal: false }) }),
    ).resolves.toEqual([]);
    expect(await count()).toBe(2);

    const stored: Array<Record<string, unknown>> = await database.query(
      `SELECT "projectId", "userId", "noteId", "incidentPublicNoteId", "submittedAt", "stepId", kind, "isFinal", "isAskedAgain", version FROM "${schema}"."${TABLE}" ORDER BY kind`,
    );

    expect(stored).toEqual([
      {
        projectId: projectId.toString(),
        userId: bob.toString(),
        noteId: noteId.toString(),
        incidentPublicNoteId: noteId.toString(),
        submittedAt: SUBMITTED_AT,
        stepId: STEP_ID,
        kind: "Chat",
        isFinal: false,
        isAskedAgain: false,
        version: 1,
      },
      {
        projectId: projectId.toString(),
        userId: bob.toString(),
        noteId: noteId.toString(),
        incidentPublicNoteId: noteId.toString(),
        submittedAt: SUBMITTED_AT,
        stepId: STEP_ID,
        kind: "Notifications",
        isFinal: false,
        isAskedAgain: false,
        version: 1,
      },
    ]);
  });

  test("the step's message changing - now the last step - claims the chat alone", async () => {
    await claim({ userId: bob, rows: rows({ isFinal: false }) });

    await expect(
      claim({ userId: bob, rows: rows({ isFinal: true }) }),
    ).resolves.toEqual([PublicNoteApprovalRequestKind.Chat]);
  });

  test("the step asked again claims the notifications alone, its message being the last step's already", async () => {
    await claim({ userId: bob, rows: rows({ isFinal: true }) });

    await expect(
      claim({
        userId: bob,
        rows: rows({ isFinal: true, isAskedAgain: true }),
      }),
    ).resolves.toEqual([PublicNoteApprovalRequestKind.Notifications]);
  });

  test("another person, or another step, claims its own", async () => {
    await claim({ userId: bob, rows: rows({ isFinal: false }) });

    await expect(
      claim({ userId: carol, rows: rows({ isFinal: false }) }),
    ).resolves.toHaveLength(2);
    await expect(
      claim({
        userId: bob,
        rows: rows({ isFinal: false }),
        stepId: "5e000000-0000-4000-8000-0000000000a2",
      }),
    ).resolves.toHaveLength(2);
  });

  test("twenty claims of the same person at once: each request goes to exactly one of them", async () => {
    const claimed: Array<Array<PublicNoteApprovalRequestKind>> =
      await Promise.all(
        Array.from({ length: 20 }, () => {
          return claim({ userId: bob, rows: rows({ isFinal: false }) });
        }),
      );

    const notifications: number = claimed.filter(
      (kinds: Array<PublicNoteApprovalRequestKind>): boolean => {
        return kinds.includes(PublicNoteApprovalRequestKind.Notifications);
      },
    ).length;
    const chats: number = claimed.filter(
      (kinds: Array<PublicNoteApprovalRequestKind>): boolean => {
        return kinds.includes(PublicNoteApprovalRequestKind.Chat);
      },
    ).length;

    expect(notifications).toBe(1);
    expect(chats).toBe(1);
    // One statement: never the notifications to one claim and the chat to another.
    expect(
      claimed.filter((kinds: Array<PublicNoteApprovalRequestKind>): boolean => {
        return kinds.length === 1;
      }),
    ).toEqual([]);
    expect(await count()).toBe(2);
  });

  test("claims of the chat alone at once, as two processes re-ask a changed message: one wins", async () => {
    await claim({ userId: bob, rows: rows({ isFinal: false }) });

    const claimed: Array<Array<PublicNoteApprovalRequestKind>> =
      await Promise.all(
        Array.from({ length: 10 }, () => {
          return claim({ userId: bob, rows: rows({ isFinal: true }) });
        }),
      );

    expect(
      claimed.filter((kinds: Array<PublicNoteApprovalRequestKind>): boolean => {
        return kinds.length > 0;
      }),
    ).toEqual([[PublicNoteApprovalRequestKind.Chat]]);
  });

  test("a request taken back can be claimed again; the other one stays", async () => {
    await claim({ userId: bob, rows: rows({ isFinal: false }) });

    await PublicNoteApprovalRequestService.release({
      projectId,
      noteId,
      submittedAt: SUBMITTED_AT,
      stepId: STEP_ID,
      userIds: [bob],
      rows: [
        {
          kind: PublicNoteApprovalRequestKind.Chat,
          isFinal: false,
          isAskedAgain: false,
        },
      ],
    });

    expect(await count()).toBe(1);
    await expect(
      claim({ userId: bob, rows: rows({ isFinal: false }) }),
    ).resolves.toEqual([PublicNoteApprovalRequestKind.Chat]);
  });

  test("findForStep reads one step of one round of the note", async () => {
    await claim({ userId: bob, rows: rows({ isFinal: false }) });
    await claim({
      userId: carol,
      rows: rows({ isFinal: false }),
      stepId: "5e000000-0000-4000-8000-0000000000a2",
    });

    const found: Array<{ userId?: ObjectID; kind?: string }> =
      await PublicNoteApprovalRequestService.findForStep({
        projectId,
        noteId,
        submittedAt: SUBMITTED_AT,
        stepId: STEP_ID,
      });

    expect(
      found
        .map((request: { userId?: ObjectID; kind?: string }): string => {
          return `${request.userId?.toString()}:${request.kind}`;
        })
        .sort(),
    ).toEqual([`${bob.toString()}:Chat`, `${bob.toString()}:Notifications`]);
  });
});
