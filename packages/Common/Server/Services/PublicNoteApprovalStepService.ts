import Model from "../../Models/DatabaseModels/PublicNoteApprovalStep";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { PublicNoteApprovalEventType } from "../../Types/StatusPage/PublicNoteApproval";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import PublicNoteApprovalPolicy, {
  PublicNoteApprovalPolicyMessages,
} from "../Utils/Notes/PublicNoteApprovalPolicy";
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

  /*
   * An update that writes a step's people or teams leaves somebody on it:
   * what it writes, and for the list it leaves alone, what the step has.
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

    const steps: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        approverUsers: {
          _id: true,
        },
        approverTeams: {
          _id: true,
        },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

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
   * While a project asks for its notes of a kind to be approved, a delete
   * that would leave that kind with no step is refused.
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

    return { deleteBy, carryForward: null };
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

export default new Service();
