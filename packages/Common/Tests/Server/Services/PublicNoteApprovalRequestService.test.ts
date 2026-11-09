import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { PublicNoteApprovalRequestKind } from "../../../Models/DatabaseModels/PublicNoteApprovalRequest";
import PublicNoteApprovalRequestService, {
  PublicNoteApprovalRequestNoteColumn,
} from "../../../Server/Services/PublicNoteApprovalRequestService";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * WRITING EACH REQUEST ONCE (#6353): PublicNoteApprovalRequestService.
 *
 * A claim is one INSERT of the person's requests for the step, each written
 * unless the unique index holds it already (ON CONFLICT DO NOTHING), handing
 * back the kinds it wrote: so of two claims at once each request goes to one
 * of them, and what one call claims is never split with another. The note's
 * column goes into the statement only as one of the three it can be; every
 * value goes in as a parameter. (PublicNoteApprovalRequestPostgres runs the
 * statement against a database.)
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const BOB: ObjectID = new ObjectID("b2b2b2b2-0000-4000-8000-000000000002");

type Query = (sql: string, parameters: Array<unknown>) => Promise<unknown>;

function captureQueries(answer: unknown): Array<[string, Array<unknown>]> {
  const queries: Array<[string, Array<unknown>]> = [];
  const query: Query = async (
    sql: string,
    parameters: Array<unknown>,
  ): Promise<unknown> => {
    queries.push([sql, parameters]);
    return answer;
  };

  jest
    .spyOn(PublicNoteApprovalRequestService, "getRepository")
    .mockReturnValue({ manager: { query } } as never);

  return queries;
}

const BOTH: Array<{
  kind: PublicNoteApprovalRequestKind;
  isFinal: boolean;
  isAskedAgain: boolean;
}> = [
  {
    kind: PublicNoteApprovalRequestKind.Notifications,
    isFinal: false,
    isAskedAgain: true,
  },
  {
    kind: PublicNoteApprovalRequestKind.Chat,
    isFinal: true,
    isAskedAgain: false,
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("claim", () => {
  test("one statement for every request of the claim, each written unless it is there, handing back what it wrote", async () => {
    const queries: Array<[string, Array<unknown>]> = captureQueries([
      { kind: "Chat" },
    ]);

    const written: Array<PublicNoteApprovalRequestKind> =
      await PublicNoteApprovalRequestService.claim({
        projectId: PROJECT_ID,
        noteColumn: "incidentEpisodePublicNoteId",
        noteId: NOTE_ID,
        userId: BOB,
        submittedAt: "2026-11-09T09:00:00.000Z",
        stepId: "5e000000-0000-4000-8000-0000000000a1",
        rows: BOTH,
      });

    expect(written).toEqual([PublicNoteApprovalRequestKind.Chat]);
    expect(queries).toHaveLength(1);

    const [sql, parameters] = queries[0]!;
    const flat: string = sql.replace(/\s+/g, " ");

    expect(flat).toContain(
      `INSERT INTO "PublicNoteApprovalRequest" ("projectId", "userId", "noteId", "incidentEpisodePublicNoteId", "submittedAt", "stepId", "kind", "isFinal", "isAskedAgain", "version")`,
    );
    expect(flat).toContain(
      "VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, 1), ($1, $2, $3, $3, $4, $5, $9, $10, $11, 1)",
    );
    expect(flat).toContain("ON CONFLICT DO NOTHING");
    expect(flat).toContain(`RETURNING "kind"`);
    expect(parameters).toEqual([
      PROJECT_ID.toString(),
      BOB.toString(),
      NOTE_ID.toString(),
      "2026-11-09T09:00:00.000Z",
      "5e000000-0000-4000-8000-0000000000a1",
      "Notifications",
      false,
      true,
      "Chat",
      true,
      false,
    ]);
  });

  test("a value never goes into the statement as text", async () => {
    const queries: Array<[string, Array<unknown>]> = captureQueries([]);
    const hostile: string = `'); DROP TABLE "Project"; --`;

    await PublicNoteApprovalRequestService.claim({
      projectId: PROJECT_ID,
      noteColumn: "incidentPublicNoteId",
      noteId: NOTE_ID,
      userId: BOB,
      submittedAt: hostile,
      stepId: hostile,
      rows: BOTH,
    });

    expect(queries[0]![0]).not.toContain("DROP TABLE");
    expect(queries[0]![1]).toContain(hostile);
  });

  test("a column that is not one of the three is refused before anything is written", async () => {
    const queries: Array<[string, Array<unknown>]> = captureQueries([]);

    await expect(
      PublicNoteApprovalRequestService.claim({
        projectId: PROJECT_ID,
        noteColumn: `"projectId") VALUES (1); --` as PublicNoteApprovalRequestNoteColumn,
        noteId: NOTE_ID,
        userId: BOB,
        submittedAt: "x",
        stepId: "y",
        rows: BOTH,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(queries).toHaveLength(0);
  });

  test("nothing to claim writes nothing", async () => {
    const queries: Array<[string, Array<unknown>]> = captureQueries([]);

    await expect(
      PublicNoteApprovalRequestService.claim({
        projectId: PROJECT_ID,
        noteColumn: "incidentPublicNoteId",
        noteId: NOTE_ID,
        userId: BOB,
        submittedAt: "x",
        stepId: "y",
        rows: [],
      }),
    ).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  test("hands back only kinds it knows, whatever the database says", async () => {
    captureQueries([{ kind: "Chat" }, { kind: "Pigeon" }, { kind: "" }]);

    await expect(
      PublicNoteApprovalRequestService.claim({
        projectId: PROJECT_ID,
        noteColumn: "scheduledMaintenancePublicNoteId",
        noteId: NOTE_ID,
        userId: BOB,
        submittedAt: "x",
        stepId: "y",
        rows: BOTH,
      }),
    ).resolves.toEqual([PublicNoteApprovalRequestKind.Chat]);
  });

  test("a failure is thrown: the caller decides whether to ask anyway", async () => {
    jest.spyOn(PublicNoteApprovalRequestService, "getRepository").mockReturnValue({
      manager: {
        query: async (): Promise<never> => {
          throw new Error("insert or update violates foreign key constraint");
        },
      },
    } as never);

    await expect(
      PublicNoteApprovalRequestService.claim({
        projectId: PROJECT_ID,
        noteColumn: "incidentPublicNoteId",
        noteId: NOTE_ID,
        userId: BOB,
        submittedAt: "x",
        stepId: "y",
        rows: BOTH,
      }),
    ).rejects.toThrow("foreign key");
  });
});

describe("findForStep and release", () => {
  test("findForStep reads one step of one round of the note, of the project, as OneUptime", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(PublicNoteApprovalRequestService, "findBy")
      .mockResolvedValue([] as never);

    await PublicNoteApprovalRequestService.findForStep({
      projectId: PROJECT_ID,
      noteId: NOTE_ID,
      submittedAt: "2026-11-09T09:00:00.000Z",
      stepId: "s1",
    });

    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        noteId: NOTE_ID,
        submittedAt: "2026-11-09T09:00:00.000Z",
        stepId: "s1",
      },
      props: { isRoot: true },
    });
  });

  test("release deletes each of the requests named, of those people, of that step, with no hooks", async () => {
    const deleteBy: jest.SpyInstance = jest
      .spyOn(PublicNoteApprovalRequestService, "deleteBy")
      .mockResolvedValue(1 as never);

    await expect(
      PublicNoteApprovalRequestService.release({
        projectId: PROJECT_ID,
        noteId: NOTE_ID,
        submittedAt: "2026-11-09T09:00:00.000Z",
        stepId: "s1",
        userIds: [BOB],
        rows: BOTH,
      }),
    ).resolves.toBe(2);

    expect(deleteBy).toHaveBeenCalledTimes(2);

    for (const [index, row] of BOTH.entries()) {
      expect(deleteBy.mock.calls[index]![0]).toMatchObject({
        query: {
          projectId: PROJECT_ID,
          noteId: NOTE_ID,
          submittedAt: "2026-11-09T09:00:00.000Z",
          stepId: "s1",
          kind: row.kind,
          isFinal: row.isFinal,
          isAskedAgain: row.isAskedAgain,
        },
        props: { isRoot: true, ignoreHooks: true },
      });
    }
  });

  test("release of nobody deletes nothing", async () => {
    const deleteBy: jest.SpyInstance = jest.spyOn(
      PublicNoteApprovalRequestService,
      "deleteBy",
    );

    await expect(
      PublicNoteApprovalRequestService.release({
        projectId: PROJECT_ID,
        noteId: NOTE_ID,
        submittedAt: "x",
        stepId: "y",
        userIds: [],
        rows: BOTH,
      }),
    ).resolves.toBe(0);
    expect(deleteBy).not.toHaveBeenCalled();
  });
});
