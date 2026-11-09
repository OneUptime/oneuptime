import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PublicNoteApprovalStep from "../../../Models/DatabaseModels/PublicNoteApprovalStep";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  PublicNoteApprovalEventType,
  PublicNoteApprovalStatus,
} from "../../../Types/StatusPage/PublicNoteApproval";
import IncidentEpisodePublicNoteService from "../../Services/IncidentEpisodePublicNoteService";
import IncidentPublicNoteService from "../../Services/IncidentPublicNoteService";
import PublicNoteApprovalStepService from "../../Services/PublicNoteApprovalStepService";
import ScheduledMaintenancePublicNoteService from "../../Services/ScheduledMaintenancePublicNoteService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspacePublicNoteApprovalMessages from "../Workspace/WorkspacePublicNoteApprovalMessages";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteKind,
} from "./PublicNoteApprovalEngine";

/*
 * WHEN WHO APPROVES PUBLIC NOTES CHANGES WHILE NOTES WAIT (#6353).
 *
 * A note waits for one of its project's approval steps, and the step's
 * approvers are asked when the note is sent and when the step before it is
 * approved (PublicNoteApprovalEngine). Who approves can change in between:
 *
 *  - a project admin changes the approval steps of a kind - adds, deletes,
 *    reorders or renames a step, or changes the people and teams it names
 *    (PublicNoteApprovalStepService);
 *  - somebody joins a team, or leaves one (TeamMemberService): a team a step
 *    names approves through its members as they are now.
 *
 * Then each note of the project of that kind that waits - an incident's and
 * an episode's for Incident, a scheduled maintenance event's for
 * ScheduledMaintenance - is followed up (PublicNoteApprovalEngine.followUp):
 * its chat copies that no longer ask what is true say what happened, and
 * whoever the step it waits for now asks, and was not asked about it yet, is
 * asked - by their notification settings, with Approve and Reject in chat.
 *
 *  - Never on the save's way: a pass runs in the background once the write
 *    is done, nothing of it reaches the save, and what it cannot do is
 *    logged.
 *  - Bounded: a pass follows up the MAX_NOTES_PER_PASS waiting notes of the
 *    project and kind changed most recently, one at a time. A burst of saves
 *    runs at most two passes of a project and kind at once in a process -
 *    the one running, and one more that reads everything afresh once it is
 *    done.
 *  - Each person is asked once, whatever runs at once and wherever: what
 *    decides is the record of whom each step asked (PublicNoteApprovalRequests),
 *    not the timing.
 */

// A project's notes of one kind of approval: what a pass follows up.
export interface PublicNoteApproverChange {
  projectId: ObjectID;
  eventType: PublicNoteApprovalEventType;
}

// One waiting note a pass found, of its kind.
interface WaitingNote {
  kind: PublicNoteKind;
  id: ObjectID;
  updatedAt: number;
}

// A pass of a project and kind, running or asked for again while it ran.
interface Pass {
  isAskedAgain: boolean;
}

export default class PublicNoteApproverChanges {
  // The waiting notes a pass follows up at most: the ones changed most recently.
  public static readonly MAX_NOTES_PER_PASS: number = 50;

  // The passes running, by project and kind.
  private static passes: Map<string, Pass> = new Map<string, Pass>();

  // Everything running in the background, for settle.
  private static running: Set<Promise<void>> = new Set<Promise<void>>();

  // ---------- what starts a pass ----------

  /*
   * A project's approval steps of a kind were written - a step created or
   * deleted: its waiting notes are followed up, in the background.
   */
  public static afterStepsChanged(
    changes: ReadonlyArray<PublicNoteApproverChange>,
  ): void {
    for (const change of changes) {
      this.schedule(change);
    }
  }

  /*
   * These steps were written - renamed, reordered, their people or teams
   * changed: their projects' waiting notes of their kinds are followed up.
   * The steps are read in the background, never on the save's way.
   */
  public static afterStepsUpdated(stepIds: ReadonlyArray<ObjectID>): void {
    if (stepIds.length === 0) {
      return;
    }

    this.inBackground(
      "follow up the public notes waiting for approval steps that changed",
      async (): Promise<void> => {
        const steps: Array<PublicNoteApprovalStep> =
          await PublicNoteApprovalStepService.findBy({
            query: {
              _id: QueryHelper.any([...stepIds]),
            },
            select: {
              projectId: true,
              eventType: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
              isRoot: true,
            },
          });

        this.afterStepsChanged(
          steps
            .filter((step: PublicNoteApprovalStep): boolean => {
              return Boolean(
                step.projectId &&
                  step.eventType &&
                  Object.values(PublicNoteApprovalEventType).includes(
                    step.eventType,
                  ),
              );
            })
            .map(
              (step: PublicNoteApprovalStep): PublicNoteApproverChange => {
                return {
                  projectId: step.projectId!,
                  eventType: step.eventType!,
                };
              },
            ),
        );
      },
    );
  }

  /*
   * Somebody joined a team of these projects, or left one: a step that
   * names the team asks its members as they are now. Every kind's waiting
   * notes are followed up, in the background.
   */
  public static afterTeamMembersChanged(
    projectIds: ReadonlyArray<ObjectID>,
  ): void {
    for (const projectId of projectIds) {
      for (const eventType of Object.values(PublicNoteApprovalEventType)) {
        this.schedule({ projectId, eventType });
      }
    }
  }

  /*
   * Waits for every pass started so far, and for what they start - the
   * chat copies replaced, the copies kept as they are sent: what a test, or
   * a process about to stop, waits on.
   */
  public static async settle(): Promise<void> {
    do {
      while (this.running.size > 0) {
        await Promise.all(Array.from(this.running));
      }

      await WorkspacePublicNoteApprovalMessages.settle();
    } while (this.running.size > 0);
  }

  // ---------- a pass ----------

  /*
   * Follows up the waiting notes of a project's kind: the ones changed most
   * recently, at most MAX_NOTES_PER_PASS of them, one at a time. A note
   * that cannot be followed up is logged, and the others go on. How many
   * were followed up.
   */
  @CaptureSpan()
  public static async followUpProject(
    change: PublicNoteApproverChange,
  ): Promise<number> {
    const waiting: Array<WaitingNote> = await this.findWaitingNotes(change);

    let followedUp: number = 0;

    for (const note of waiting) {
      try {
        await PublicNoteApprovalEngine.followUp({
          host: this.getHost(note.kind),
          noteId: note.id,
        });
        followedUp++;
      } catch (error) {
        logger.error(
          "Public note approval: could not ask the new approvers of a waiting public note.",
          { projectId: change.projectId.toString() },
        );
        logger.error(error, { projectId: change.projectId.toString() });
      }
    }

    return followedUp;
  }

  /*
   * The project's notes of the kind that wait for approval - a new note or
   * an edit of a published one - the ones changed most recently first, at
   * most MAX_NOTES_PER_PASS. Whether each still waits, and for which step,
   * the engine reads as it follows it up.
   */
  @CaptureSpan()
  public static async findWaitingNotes(
    change: PublicNoteApproverChange,
  ): Promise<Array<WaitingNote>> {
    const found: Array<WaitingNote> = [];

    for (const kind of this.getKinds(change.eventType)) {
      const notes: Array<BaseModel> = await this.getHost(
        kind,
      ).service.findBy({
        query: {
          projectId: change.projectId,
          approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
        } as Query<BaseModel>,
        select: {
          _id: true,
          updatedAt: true,
        } as Select<BaseModel>,
        sort: {
          updatedAt: SortOrder.Descending,
        } as Sort<BaseModel>,
        skip: 0,
        // One more than a pass takes: what says there were more.
        limit: this.MAX_NOTES_PER_PASS + 1,
        props: {
          isRoot: true,
        },
      });

      for (const note of notes) {
        const id: string = (note.id || note._id || "").toString();

        if (!id) {
          continue;
        }

        found.push({
          kind: kind,
          id: new ObjectID(id),
          updatedAt: note.updatedAt ? new Date(note.updatedAt).getTime() : 0,
        });
      }
    }

    found.sort((a: WaitingNote, b: WaitingNote): number => {
      return b.updatedAt - a.updatedAt;
    });

    if (found.length > this.MAX_NOTES_PER_PASS) {
      logger.warn(
        `Public note approval: more than ${this.MAX_NOTES_PER_PASS} public notes wait for approval in the project, so only the ${this.MAX_NOTES_PER_PASS} changed most recently were followed up after their approvers changed.`,
        { projectId: change.projectId.toString() },
      );
    }

    return found.slice(0, this.MAX_NOTES_PER_PASS);
  }

  // ---------- notes that waited before requests were kept ----------

  /*
   * Every note, of every project, that waits for approval now: the people
   * the step it waits for asks are taken as asked about it, without asking
   * them (PublicNoteApprovalEngine.recordAsAsked) - so the first change of
   * who approves a note that waited before OneUptime kept whom it asked asks
   * only those who are new. Idempotent: a request recorded already is
   * recorded once. A note that cannot be recorded is logged, and the others
   * go on. How many requests were recorded.
   */
  @CaptureSpan()
  public static async recordWaitingNotesAsAsked(options?: {
    batchSize?: number | undefined;
  }): Promise<number> {
    const batchSize: number = Math.max(
      1,
      Math.floor(options?.batchSize || 100),
    );

    let recorded: number = 0;

    for (const kind of Object.values(PublicNoteKind)) {
      const host: PublicNoteApprovalHost<BaseModel> = this.getHost(kind);

      for (let skip: number = 0; ; skip += batchSize) {
        const notes: Array<BaseModel> = await host.service.findBy({
          query: {
            approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
          } as Query<BaseModel>,
          select: {
            _id: true,
          } as Select<BaseModel>,
          sort: {
            _id: SortOrder.Ascending,
          } as Sort<BaseModel>,
          skip: skip,
          limit: batchSize,
          props: {
            isRoot: true,
          },
        });

        for (const note of notes) {
          const id: string = (note.id || note._id || "").toString();

          if (!id) {
            continue;
          }

          try {
            recorded += await PublicNoteApprovalEngine.recordAsAsked({
              host: host,
              noteId: new ObjectID(id),
            });
          } catch (error) {
            logger.error(
              `Public note approval: could not record who was asked about the waiting public note ${id}.`,
            );
            logger.error(error);
          }
        }

        if (notes.length < batchSize) {
          break;
        }
      }
    }

    return recorded;
  }

  // ---------- helpers ----------

  // The kinds of note a kind of approval steps governs.
  public static getKinds(
    eventType: PublicNoteApprovalEventType,
  ): Array<PublicNoteKind> {
    switch (eventType) {
      case PublicNoteApprovalEventType.Incident:
        return [PublicNoteKind.Incident, PublicNoteKind.IncidentEpisode];
      case PublicNoteApprovalEventType.ScheduledMaintenance:
        return [PublicNoteKind.ScheduledMaintenance];
    }
  }

  // What the engine knows of a kind of note: the note service's own.
  public static getHost(kind: PublicNoteKind): PublicNoteApprovalHost<BaseModel> {
    switch (kind) {
      case PublicNoteKind.Incident:
        return IncidentPublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
      case PublicNoteKind.IncidentEpisode:
        return IncidentEpisodePublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
      case PublicNoteKind.ScheduledMaintenance:
        return ScheduledMaintenancePublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
    }
  }

  /*
   * A pass of the project's kind, in the background: one is started when
   * none runs; while one runs, it is asked to run once more when it is done,
   * reading everything afresh - however many saves came meanwhile.
   */
  private static schedule(change: PublicNoteApproverChange): void {
    const key: string = `${change.projectId.toString().toLowerCase()}|${change.eventType}`;
    const running: Pass | undefined = this.passes.get(key);

    if (running) {
      running.isAskedAgain = true;
      return;
    }

    const pass: Pass = { isAskedAgain: false };
    this.passes.set(key, pass);

    this.inBackground(
      "follow up the public notes waiting for approval after their approvers changed",
      async (): Promise<void> => {
        try {
          do {
            pass.isAskedAgain = false;

            try {
              await this.followUpProject(change);
            } catch (error) {
              logger.error(
                "Public note approval: could not follow up the public notes waiting for approval after their approvers changed.",
                { projectId: change.projectId.toString() },
              );
              logger.error(error, { projectId: change.projectId.toString() });
            }
          } while (pass.isAskedAgain);
        } finally {
          this.passes.delete(key);
        }
      },
    );
  }

  /*
   * Runs `work` in the background: the caller goes on at once, and nothing
   * of `work` - not its first read, not a failure - reaches it. A failure is
   * logged.
   */
  private static inBackground(
    what: string,
    work: () => Promise<unknown>,
  ): void {
    const run: Promise<void> = Promise.resolve()
      .then(work)
      .then(
        (): void => {
          return undefined;
        },
        (error: unknown): void => {
          logger.error(`Public note approval: could not ${what}.`);
          logger.error(error);
        },
      );

    this.running.add(run);

    void run.then((): void => {
      this.running.delete(run);
    });
  }
}
