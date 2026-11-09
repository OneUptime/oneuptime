import Model from "../../Models/DatabaseModels/PublicNoteApprovalStep";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { PublicNoteApprovalEventType } from "../../Types/StatusPage/PublicNoteApproval";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import PublicNoteApprovalPolicy, {
  PublicNoteApprovalPolicyMessages,
} from "../Utils/Notes/PublicNoteApprovalPolicy";
import type { PublicNoteApproverChange } from "../Utils/Notes/PublicNoteApproverChanges";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * A project's public note approval steps (PublicNoteApprovalStep). Every
 * step names somebody who can approve: a step with nobody on it would hold
 * every note forever. And while a project asks for approval, its last step
 * of that kind stays - turning approval off comes first.
 *
 * The people and teams a step names are the project's own: a person must be
 * a member of it (ProjectReferencesService checks every reference).
 *
 * Once steps are written - created, deleted, renamed, reordered, their people
 * or teams changed - the notes already waiting follow them, in the
 * background: whoever the step a note waits for now asks, and was not asked
 * about it yet, is asked (PublicNoteApproverChanges). Nothing of that ever
 * fails, or holds back, the save.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (
      !Object.values(PublicNoteApprovalEventType).includes(
        createBy.data.eventType as PublicNoteApprovalEventType,
      )
    ) {
      throw new BadDataException(
        "Say whose public notes the step approves: Incident or ScheduledMaintenance.",
      );
    }

    if (
      this.countOf(createBy.data.approverUsers) === 0 &&
      this.countOf(createBy.data.approverTeams) === 0
    ) {
      throw new BadDataException(
        PublicNoteApprovalPolicyMessages.stepNeedsApprover,
      );
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const projectId: ObjectID | undefined =
      createdItem.projectId || onCreate.createBy.data.projectId;
    const eventType: PublicNoteApprovalEventType | undefined =
      createdItem.eventType || onCreate.createBy.data.eventType;

    if (projectId && eventType) {
      Service.followUpWaitingNotes((changes: ApproverChanges): void => {
        changes.afterStepsChanged([{ projectId, eventType }]);
      });
    }

    return createdItem;
  }

  /*
   * An update that writes a step's people or teams leaves somebody on it:
   * what it writes, and for the list it leaves alone, what the step has -
   * read for the steps the update writes, the ones its caller may write,
   * with the update held to them, so every step written is a step checked.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const writesUsers: boolean = updateBy.data.approverUsers !== undefined;
    const writesTeams: boolean = updateBy.data.approverTeams !== undefined;

    if (!writesUsers && !writesTeams) {
      return { updateBy, carryForward: null };
    }

    const steps: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        approverUsers: {
          _id: true,
        },
        approverTeams: {
          _id: true,
        },
      },
    );

    for (const step of steps) {
      const users: number = writesUsers
        ? this.countOf(updateBy.data.approverUsers as Array<User> | null)
        : this.countOf(step.approverUsers);
      const teams: number = writesTeams
        ? this.countOf(updateBy.data.approverTeams as Array<Team> | null)
        : this.countOf(step.approverTeams);

      if (users === 0 && teams === 0) {
        throw new BadDataException(
          PublicNoteApprovalPolicyMessages.stepNeedsApprover,
        );
      }
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Whatever an update wrote - a name, the order, the people or teams - the
   * notes waiting for its steps' kinds follow it; which projects and kinds
   * those are is read in the background.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (updatedItemIds.length > 0) {
      Service.followUpWaitingNotes((changes: ApproverChanges): void => {
        changes.afterStepsUpdated(updatedItemIds);
      });
    }

    return onUpdate;
  }

  /*
   * While a project asks for its notes of a kind to be approved, a delete
   * that would leave that kind with no step is refused. The projects and
   * kinds of the steps it deletes are carried to onDeleteSuccess, whose
   * waiting notes follow the steps left.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const deleting: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        eventType: true,
      },
    );

    const checked: Set<string> = new Set<string>();

    for (const step of deleting) {
      if (!step.projectId || !step.eventType) {
        continue;
      }

      const key: string = `${step.projectId.toString()}:${step.eventType}`;

      if (checked.has(key)) {
        continue;
      }

      checked.add(key);

      if (
        !(await PublicNoteApprovalPolicy.isRequired({
          projectId: step.projectId,
          eventType: step.eventType,
        }))
      ) {
        continue;
      }

      const deletingIds: Set<string> = new Set<string>(
        deleting
          .filter((other: Model): boolean => {
            return (
              other.projectId?.toString() === step.projectId?.toString() &&
              other.eventType === step.eventType
            );
          })
          .map((other: Model): string => {
            return other.id?.toString() || "";
          }),
      );

      const remaining: number = (
        await PublicNoteApprovalPolicy.getSteps({
          projectId: step.projectId,
          eventType: step.eventType,
        })
      ).filter((rule: { id: string }): boolean => {
        return !deletingIds.has(rule.id);
      }).length;

      if (remaining === 0) {
        throw new BadDataException(
          PublicNoteApprovalPolicyMessages.lastStepWhileOn,
        );
      }
    }

    return {
      deleteBy,
      carryForward: {
        publicNoteApproverChanges: Service.getChanges(deleting),
      },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const changes: Array<PublicNoteApproverChange> =
      (
        onDelete.carryForward as
          | { publicNoteApproverChanges?: Array<PublicNoteApproverChange> }
          | null
          | undefined
      )?.publicNoteApproverChanges || [];

    if (itemIdsBeforeDelete.length > 0 && changes.length > 0) {
      Service.followUpWaitingNotes((approverChanges: ApproverChanges): void => {
        approverChanges.afterStepsChanged(changes);
      });
    }

    return onDelete;
  }

  // The projects and kinds of these steps, each once.
  private static getChanges(
    steps: Array<Model>,
  ): Array<PublicNoteApproverChange> {
    const changes: Map<string, PublicNoteApproverChange> = new Map();

    for (const step of steps) {
      if (!step.projectId || !step.eventType) {
        continue;
      }

      changes.set(
        `${step.projectId.toString().toLowerCase()}|${step.eventType}`,
        {
          projectId: step.projectId,
          eventType: step.eventType,
        },
      );
    }

    return Array.from(changes.values());
  }

  /*
   * Starts following up the notes waiting for the steps, in the background
   * (PublicNoteApproverChanges): required here, not imported - it reads the
   * notes' services and their engine, which read this service as they load
   * (PublicNoteApprovalPolicy). Never fails the save: what cannot even start
   * is logged.
   */
  private static followUpWaitingNotes(
    start: (changes: ApproverChanges) => void,
  ): void {
    try {
      start(
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../Utils/Notes/PublicNoteApproverChanges").default,
      );
    } catch (error) {
      logger.error(
        "Public note approval: could not start asking the new approvers of the public notes waiting for changed approval steps.",
      );
      logger.error(error);
    }
  }

  private countOf(
    records: Array<User> | Array<Team> | Array<ObjectID> | null | undefined,
  ): number {
    if (!Array.isArray(records)) {
      return 0;
    }

    return records.filter((record: unknown): boolean => {
      return Boolean(record);
    }).length;
  }
}

type ApproverChanges =
  typeof import("../Utils/Notes/PublicNoteApproverChanges").default;

export default new Service();
