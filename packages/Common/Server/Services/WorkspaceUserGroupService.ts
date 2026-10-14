import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/WorkspaceUserGroup";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import {
  MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
  SLACK_USER_GROUP_NAME_MAX_LENGTH,
} from "../../Types/Workspace/WorkspaceUserGroup";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WorkspaceUserGroupSync from "../Utils/Workspace/UserGroups/WorkspaceUserGroupSync";

/*
 * On-call user groups (WorkspaceUserGroup): a Slack user group or a
 * Microsoft Teams tag that follows on-call schedules. This service holds
 * the rules of the record; WorkspaceUserGroupSync keeps the group in step.
 *
 * - A group follows at least one schedule, every one of them in its project
 *   (ProjectReferencesService checks the list).
 * - A project links a workspace's group once: a second schedule is added to
 *   the record that keeps it in step already.
 * - A new or changed record is looked at straight away: the group takes the
 *   people on call in its schedules.
 */
export const NO_SCHEDULE_MESSAGE: string =
  "A user group follows at least one on-call schedule. To stop OneUptime from updating it, delete it instead.";

export const ALREADY_LINKED_MESSAGE: string =
  "This user group already follows on-call schedules in this project. Add the schedule to it instead.";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * What a new record must be, before anything it names is looked up: the
   * workspace, the group's id there, a Microsoft Teams tag's team, and at
   * least one schedule.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    const data: Model = createBy.data;

    if (
      data.workspaceType !== WorkspaceType.Slack &&
      data.workspaceType !== WorkspaceType.MicrosoftTeams
    ) {
      throw new BadDataException(
        "Workspace Type must be Slack or MicrosoftTeams.",
      );
    }

    const groupId: string = (data.workspaceGroupId || "").trim();

    if (!groupId) {
      throw new BadDataException(
        "Workspace Group ID is required: the id of the Slack user group or the Microsoft Teams tag.",
      );
    }

    data.workspaceGroupId = groupId;

    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      const teamId: string = (data.workspaceTeamId || "").trim();

      if (!teamId) {
        throw new BadDataException(
          "Workspace Team ID is required for a Microsoft Teams tag: the team the tag is in.",
        );
      }

      data.workspaceTeamId = teamId;
    }

    const name: string = (data.name || "").trim();

    if (name) {
      data.name = name.substring(
        0,
        data.workspaceType === WorkspaceType.MicrosoftTeams
          ? MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH
          : SLACK_USER_GROUP_NAME_MAX_LENGTH,
      );
    }

    if (!this.namesASchedule(data.onCallDutyPolicySchedules)) {
      throw new BadDataException(NO_SCHEDULE_MESSAGE);
    }
  }

  // An update may change the schedules, never down to none.
  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const schedules: unknown = (
      updateBy.data as unknown as Record<string, unknown>
    )["onCallDutyPolicySchedules"];

    if (schedules !== undefined && !this.namesASchedule(schedules)) {
      throw new BadDataException(NO_SCHEDULE_MESSAGE);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);

    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    if (projectId) {
      const existing: Model | null = await this.findOneBy({
        query: {
          projectId: projectId,
          workspaceType: createBy.data.workspaceType!,
          workspaceGroupId: createBy.data.workspaceGroupId!,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (existing) {
        throw new BadDataException(ALREADY_LINKED_MESSAGE);
      }
    }

    return onCreate;
  }

  // A new group takes the people on call in its schedules at once.
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.id) {
      WorkspaceUserGroupSync.requestSync([createdItem.id]).catch(
        (err: unknown) => {
          logger.error(err);
        },
      );
    }

    return createdItem;
  }

  // A group whose schedules changed takes their people at once.
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const schedules: unknown = (
      onUpdate.updateBy.data as unknown as Record<string, unknown>
    )["onCallDutyPolicySchedules"];

    if (schedules !== undefined && updatedItemIds.length > 0) {
      WorkspaceUserGroupSync.requestSync(updatedItemIds).catch(
        (err: unknown) => {
          logger.error(err);
        },
      );
    }

    return onUpdate;
  }

  /*
   * The groups that follow any of these schedules, as OneUptime reads them
   * (root): their ids.
   */
  @CaptureSpan()
  public async findIdsFollowingSchedules(
    scheduleIds: Array<ObjectID>,
  ): Promise<Array<ObjectID>> {
    if (scheduleIds.length === 0) {
      return [];
    }

    const groups: Array<Model> = await this.findBy({
      query: {
        onCallDutyPolicySchedules: QueryHelper.inRelationArray(scheduleIds),
      } as never,
      select: {
        _id: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return groups
      .map((group: Model): ObjectID | undefined => {
        return group.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });
  }

  // Whether a list of schedules, as a write sends it, names one at least.
  private namesASchedule(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }

    return value.some((schedule: unknown): boolean => {
      if (schedule instanceof ObjectID) {
        return Boolean(schedule.toString());
      }

      if (typeof schedule === "string") {
        return Boolean(schedule.trim());
      }

      const id: unknown =
        (schedule as OnCallDutyPolicySchedule | null)?.id ||
        (schedule as { _id?: unknown } | null)?._id;

      return Boolean(id && String(id).trim());
    });
  }
}

export default new Service();
