import DatabaseService from "./DatabaseService";
import Model, {
  PublicNoteApprovalRequestKind,
} from "../../Models/DatabaseModels/PublicNoteApprovalRequest";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The column that ties a request to its note, one per kind of note
 * (PublicNoteApprovalRequests.getNoteColumn).
 */
export type PublicNoteApprovalRequestNoteColumn =
  | "incidentPublicNoteId"
  | "incidentEpisodePublicNoteId"
  | "scheduledMaintenancePublicNoteId";

export const PUBLIC_NOTE_APPROVAL_REQUEST_NOTE_COLUMNS: ReadonlyArray<PublicNoteApprovalRequestNoteColumn> =
  [
    "incidentPublicNoteId",
    "incidentEpisodePublicNoteId",
    "scheduledMaintenancePublicNoteId",
  ];

// One request a person holds about a step of a round: how, and of which message.
export interface PublicNoteApprovalRequestRow {
  kind: PublicNoteApprovalRequestKind;
  isFinal: boolean;
  isAskedAgain: boolean;
}

// One step of one round of a note's approval, which requests are about.
export interface PublicNoteApprovalRequestStep {
  projectId: ObjectID;
  noteId: ObjectID;
  submittedAt: string;
  stepId: string;
}

/*
 * Who was asked to approve which step of a public note, and how
 * (PublicNoteApprovalRequest), as PublicNoteApprovalRequests claims, reads
 * and takes back requests. Only the server reads or writes a row.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Claims these requests of one person about one step: each row is written
   * unless it is there already, in one statement - so of two claims at once
   * each row goes to one of them, and what one call claims is never split
   * with another. The kinds this call wrote: what it may ask the person by.
   */
  @CaptureSpan()
  public async claim(
    data: PublicNoteApprovalRequestStep & {
      noteColumn: PublicNoteApprovalRequestNoteColumn;
      userId: ObjectID;
      rows: Array<PublicNoteApprovalRequestRow>;
    },
  ): Promise<Array<PublicNoteApprovalRequestKind>> {
    if (data.rows.length === 0) {
      return [];
    }

    // A column's name goes into the statement: only one of the three.
    if (!PUBLIC_NOTE_APPROVAL_REQUEST_NOTE_COLUMNS.includes(data.noteColumn)) {
      throw new BadDataException(
        `A public note approval request cannot name its note by ${String(data.noteColumn)}.`,
      );
    }

    const values: Array<unknown> = [
      data.projectId.toString(),
      data.userId.toString(),
      data.noteId.toString(),
      data.submittedAt,
      data.stepId,
    ];

    const tuples: Array<string> = data.rows.map(
      (row: PublicNoteApprovalRequestRow): string => {
        const first: number = values.length + 1;

        values.push(row.kind, row.isFinal, row.isAskedAgain);

        return [
          "($1, $2, $3, $3, $4, $5",
          `$${first}`,
          `$${first + 1}`,
          `$${first + 2}`,
          "1)",
        ].join(", ");
      },
    );

    const written: Array<{ kind: string }> | undefined =
      await this.getRepository().manager.query(
        `INSERT INTO "PublicNoteApprovalRequest" ("projectId", "userId", "noteId", "${data.noteColumn}", "submittedAt", "stepId", "kind", "isFinal", "isAskedAgain", "version")
         VALUES ${tuples.join(", ")}
         ON CONFLICT DO NOTHING
         RETURNING "kind"`,
        values,
      );

    return (written || [])
      .map((row: { kind: string }): string => {
        return row.kind;
      })
      .filter((kind: string): kind is PublicNoteApprovalRequestKind => {
        return (
          Object.values(PublicNoteApprovalRequestKind) as Array<string>
        ).includes(kind);
      });
  }

  // Every request about one step of one round of the note, whoever holds it.
  @CaptureSpan()
  public async findForStep(
    data: PublicNoteApprovalRequestStep,
  ): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: data.projectId,
        noteId: data.noteId,
        submittedAt: data.submittedAt,
        stepId: data.stepId,
      },
      select: {
        _id: true,
        userId: true,
        kind: true,
        isFinal: true,
        isAskedAgain: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Takes these requests of these people about one step out of the table:
   * they may be asked by them again. How many went.
   */
  @CaptureSpan()
  public async release(
    data: PublicNoteApprovalRequestStep & {
      userIds: Array<ObjectID>;
      rows: Array<PublicNoteApprovalRequestRow>;
    },
  ): Promise<number> {
    if (data.userIds.length === 0) {
      return 0;
    }

    let released: number = 0;

    for (const row of data.rows) {
      released += await this.deleteBy({
        query: {
          projectId: data.projectId,
          noteId: data.noteId,
          submittedAt: data.submittedAt,
          stepId: data.stepId,
          kind: row.kind,
          isFinal: row.isFinal,
          isAskedAgain: row.isAskedAgain,
          userId: QueryHelper.any(data.userIds),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }

    return released;
  }
}

export default new Service();
