import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsInstalledTeam,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserGroup from "../../../../Models/DatabaseModels/WorkspaceUserGroup";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import {
  isValidSlackUserGroupHandle,
  MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
  readSlackUserGroupHandle,
  readWorkspaceUserGroupSyncState,
  SLACK_USER_GROUP_NAME_MAX_LENGTH,
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupConnectRequest,
  WorkspaceUserGroupLeftOut,
  WorkspaceUserGroupLeftOutView,
  WorkspaceUserGroupMember,
  WorkspaceUserGroupPersonView,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupScheduleView,
  WorkspaceUserGroupSyncState,
  WorkspaceUserGroupTeam,
  WorkspaceUserGroupView,
} from "../../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../../Types/Workspace/WorkspaceType";
import OnCallDutyPolicyScheduleService from "../../../Services/OnCallDutyPolicyScheduleService";
import UserService from "../../../Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserGroupService from "../../../Services/WorkspaceUserGroupService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsRosterMember,
} from "../MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsTags, {
  MicrosoftTeamsTagInfo,
} from "../MicrosoftTeams/MicrosoftTeamsTags";
import SlackUserGroups, {
  SLACK_USER_GROUP_DESCRIPTION,
  SlackUserGroupInfo,
} from "../Slack/SlackUserGroups";
import { WorkspaceUserGroupError } from "./WorkspaceUserGroupProvider";
import WorkspaceUserGroupSync from "./WorkspaceUserGroupSync";

/*
 * WHAT THE SCHEDULE PAGE'S USER GROUP CARD ASKS OF THE SERVER
 * (WorkspaceUserGroupAPI): the groups that follow a schedule, drawn as they
 * are; the user groups and tags the workspace has, for the Connect form;
 * connecting one - picked, or made new - and disconnecting it; and Try
 * again.
 *
 * Everything a person asks is read and written with their own permissions
 * in their own project: a schedule they may not read, or a group, is
 * answered like one that is not there. What OneUptime reads to draw it -
 * names of the people on call, the workspace - it reads itself, once the
 * person may read the group.
 */

// The words a person is told when connecting cannot go ahead.
export const NOT_FOUND_SCHEDULE_MESSAGE: string =
  "This on-call schedule was not found in this project, or you do not have access to it.";

export const NOT_FOUND_GROUP_MESSAGE: string =
  "This user group was not found in this project, or you do not have access to it.";

export default class WorkspaceUserGroupManager {
  /*
   * The groups that follow a schedule, each as the card draws it - this
   * schedule first among the ones it follows, the people on call in each,
   * who is in the group and who is left out, and how its last sync went.
   */
  @CaptureSpan()
  public static async getViewsForSchedule(data: {
    scheduleId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<WorkspaceUserGroupView>> {
    await WorkspaceUserGroupManager.getReadableSchedule(data);

    const groups: Array<WorkspaceUserGroup> =
      await WorkspaceUserGroupService.findBy({
        query: {
          projectId: data.projectId,
          onCallDutyPolicySchedules: QueryHelper.inRelationArray([
            data.scheduleId,
          ]),
        } as never,
        select: {
          _id: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props,
      });

    const views: Array<WorkspaceUserGroupView> = [];

    for (const group of groups) {
      if (!group.id) {
        continue;
      }

      const view: WorkspaceUserGroupView | null =
        await WorkspaceUserGroupManager.getView({
          workspaceUserGroupId: group.id,
          scheduleId: data.scheduleId,
          projectId: data.projectId,
          props: data.props,
        });

      if (view) {
        views.push(view);
      }
    }

    // Slack first, then Microsoft Teams - the order every list of them uses.
    const order: Array<WorkspaceType> = [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ];

    return views.sort(
      (a: WorkspaceUserGroupView, b: WorkspaceUserGroupView): number => {
        return (
          order.indexOf(a.workspaceType) - order.indexOf(b.workspaceType) ||
          (a.handle || a.name).localeCompare(b.handle || b.name)
        );
      },
    );
  }

  /*
   * One group as the card draws it, for a person who may read it; null when
   * they may not, or it is gone.
   */
  @CaptureSpan()
  public static async getView(data: {
    workspaceUserGroupId: ObjectID;
    scheduleId: ObjectID | null;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceUserGroupView | null> {
    const readable: WorkspaceUserGroup | null =
      await WorkspaceUserGroupService.findOneBy({
        query: {
          _id: data.workspaceUserGroupId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        props: data.props,
      });

    if (!readable) {
      return null;
    }

    // Read as OneUptime now the person may read it: its schedules' people.
    const group: WorkspaceUserGroup | null =
      await WorkspaceUserGroupService.findOneById({
        id: data.workspaceUserGroupId,
        select: {
          _id: true,
          projectId: true,
          workspaceType: true,
          workspaceGroupId: true,
          workspaceTeamId: true,
          name: true,
          handle: true,
          syncState: true,
          syncedAt: true,
          onCallDutyPolicySchedules: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!group || !group.workspaceType) {
      return null;
    }

    const scheduleIds: Array<ObjectID> = (group.onCallDutyPolicySchedules || [])
      .map((schedule: OnCallDutyPolicySchedule): ObjectID | undefined => {
        return schedule.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    /*
     * The schedules as the person may read them: one they may not is left
     * out of the card, not named.
     */
    const schedules: Array<OnCallDutyPolicySchedule> =
      scheduleIds.length > 0
        ? await OnCallDutyPolicyScheduleService.findBy({
            query: {
              _id: QueryHelper.any(scheduleIds),
              projectId: data.projectId,
            },
            select: {
              _id: true,
              name: true,
              currentUserIdOnRoster: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: data.props,
          })
        : [];

    const state: WorkspaceUserGroupSyncState | null =
      readWorkspaceUserGroupSyncState(group.syncState);

    const userIds: Array<string> = [
      ...schedules
        .map((schedule: OnCallDutyPolicySchedule): string => {
          return schedule.currentUserIdOnRoster?.toString() || "";
        })
        .filter(Boolean),
      ...(state?.members || []).map(
        (member: WorkspaceUserGroupMember): string => {
          return member.userId;
        },
      ),
      ...(state?.leftOut || []).map(
        (person: WorkspaceUserGroupLeftOut): string => {
          return person.userId;
        },
      ),
    ];

    const people: Map<string, WorkspaceUserGroupPersonView> =
      await WorkspaceUserGroupManager.getPeople(userIds);

    const personOf: (userId: string) => WorkspaceUserGroupPersonView = (
      userId: string,
    ): WorkspaceUserGroupPersonView => {
      return (
        people.get(userId.toLowerCase()) || {
          userId: userId,
          name: "",
          email: "",
        }
      );
    };

    const scheduleViews: Array<WorkspaceUserGroupScheduleView> = schedules
      .map((schedule: OnCallDutyPolicySchedule) => {
        const onCallUserId: string =
          schedule.currentUserIdOnRoster?.toString() || "";

        return {
          scheduleId: schedule.id?.toString() || "",
          name: schedule.name?.toString() || "",
          onCallNow: onCallUserId ? personOf(onCallUserId) : null,
        };
      })
      .sort(
        (
          a: WorkspaceUserGroupScheduleView,
          b: WorkspaceUserGroupScheduleView,
        ): number => {
          const thisSchedule: string = data.scheduleId?.toString() || "";

          if (a.scheduleId === thisSchedule) {
            return -1;
          }

          if (b.scheduleId === thisSchedule) {
            return 1;
          }

          return a.name.localeCompare(b.name);
        },
      );

    return {
      workspaceUserGroupId: group.id!.toString(),
      workspaceType: group.workspaceType,
      name: group.name || "",
      handle: group.handle || null,
      teamName:
        group.workspaceType === WorkspaceType.MicrosoftTeams
          ? await WorkspaceUserGroupManager.getTeamName({
              projectId: data.projectId,
              teamId: group.workspaceTeamId || "",
            })
          : null,
      schedules: scheduleViews,
      members: (state?.members || []).map(
        (member: WorkspaceUserGroupMember): WorkspaceUserGroupPersonView => {
          return personOf(member.userId);
        },
      ),
      leftOut: (state?.leftOut || []).map(
        (person: WorkspaceUserGroupLeftOut): WorkspaceUserGroupLeftOutView => {
          return {
            ...personOf(person.userId),
            reason: person.reason,
          };
        },
      ),
      isTurnedOff: state?.isTurnedOff || false,
      problem: state?.problem || null,
      problemDetail: state?.problemDetail || null,
      syncedAt: group.syncedAt ? group.syncedAt.toISOString() : null,
      checkedAt: state?.checkedAt || null,
    };
  }

  /*
   * What the Connect form offers for a schedule. Slack: the workspace's user
   * groups, each saying who is in it now and which schedules it follows
   * already. Microsoft Teams: the teams OneUptime's app is in and, once one
   * is picked, its tags.
   */
  @CaptureSpan()
  public static async getAvailable(data: {
    workspaceType: WorkspaceType;
    projectId: ObjectID;
    teamId?: string | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    groups: Array<WorkspaceAvailableUserGroup>;
    teams: Array<WorkspaceUserGroupTeam>;
  }> {
    const projectAuth: WorkspaceProjectAuthToken =
      await WorkspaceUserGroupManager.getConnection({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      });

    const linked: Array<WorkspaceUserGroup> =
      await WorkspaceUserGroupService.findBy({
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
        },
        select: {
          _id: true,
          workspaceGroupId: true,
          onCallDutyPolicySchedules: {
            _id: true,
            name: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props,
      });

    const linkedOf: (
      workspaceGroupId: string,
    ) => WorkspaceUserGroup | undefined = (
      workspaceGroupId: string,
    ): WorkspaceUserGroup | undefined => {
      return linked.find((group: WorkspaceUserGroup): boolean => {
        return group.workspaceGroupId === workspaceGroupId;
      });
    };

    const toAvailable: (data: {
      workspaceGroupId: string;
      name: string;
      handle: string | null;
      userCount: number | null;
      isTurnedOff: boolean;
    }) => WorkspaceAvailableUserGroup = (available: {
      workspaceGroupId: string;
      name: string;
      handle: string | null;
      userCount: number | null;
      isTurnedOff: boolean;
    }): WorkspaceAvailableUserGroup => {
      const link: WorkspaceUserGroup | undefined = linkedOf(
        available.workspaceGroupId,
      );

      return {
        ...available,
        workspaceUserGroupId: link?.id?.toString() || null,
        followsScheduleNames: (link?.onCallDutyPolicySchedules || [])
          .map((schedule: OnCallDutyPolicySchedule): string => {
            return schedule.name?.toString() || "";
          })
          .filter(Boolean)
          .sort(),
      };
    };

    if (data.workspaceType === WorkspaceType.Slack) {
      const groups: Array<SlackUserGroupInfo> =
        await WorkspaceUserGroupManager.askWorkspace(data.workspaceType, () => {
          return SlackUserGroups.list({
            authToken: projectAuth.authToken || "",
            teamId: projectAuth.workspaceProjectId || "",
          });
        });

      return {
        groups: groups
          .map((group: SlackUserGroupInfo): WorkspaceAvailableUserGroup => {
            return toAvailable({
              workspaceGroupId: group.id,
              name: group.name,
              handle: group.handle || null,
              userCount: group.userCount,
              isTurnedOff: group.isTurnedOff,
            });
          })
          .sort(
            (
              a: WorkspaceAvailableUserGroup,
              b: WorkspaceAvailableUserGroup,
            ): number => {
              return (a.handle || a.name).localeCompare(b.handle || b.name);
            },
          ),
        teams: [],
      };
    }

    const teams: Array<WorkspaceUserGroupTeam> =
      WorkspaceUserGroupManager.getInstalledTeams(projectAuth);

    const teamId: string = (data.teamId || "").trim();

    if (!teamId) {
      return { groups: [], teams: teams };
    }

    if (
      !teams.some((team: WorkspaceUserGroupTeam): boolean => {
        return team.teamId === teamId;
      })
    ) {
      throw new BadDataException(WorkspaceUserGroupManager.getTeamGoneText());
    }

    const accessToken: string = await WorkspaceUserGroupManager.getGraphToken({
      projectId: data.projectId,
      projectAuth: projectAuth,
    });

    const tags: Array<MicrosoftTeamsTagInfo> =
      await WorkspaceUserGroupManager.askWorkspace(data.workspaceType, () => {
        return MicrosoftTeamsTags.list({
          accessToken: accessToken,
          teamId: teamId,
        });
      });

    return {
      groups: tags
        .map((tag: MicrosoftTeamsTagInfo): WorkspaceAvailableUserGroup => {
          return toAvailable({
            workspaceGroupId: tag.id,
            name: tag.name,
            handle: null,
            userCount: tag.memberCount,
            isTurnedOff: false,
          });
        })
        .sort(
          (
            a: WorkspaceAvailableUserGroup,
            b: WorkspaceAvailableUserGroup,
          ): number => {
            return a.name.localeCompare(b.name);
          },
        ),
      teams: teams,
    };
  }

  /*
   * CONNECTING A GROUP TO A SCHEDULE.
   *
   * The group is one the workspace has - picked by its id, or made now:
   * a Slack user group with the name and handle typed, a Teams tag by its
   * name in a team (the team's tag of that name when it has one). It then
   * follows the schedule: the record that keeps it in step already gains
   * the schedule, or a new record is made. It is looked at at once, and
   * the card is answered with it as it is then.
   */
  @CaptureSpan()
  public static async connect(data: {
    request: WorkspaceUserGroupConnectRequest;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceUserGroupView> {
    const request: WorkspaceUserGroupConnectRequest = data.request;

    if (
      request.workspaceType !== WorkspaceType.Slack &&
      request.workspaceType !== WorkspaceType.MicrosoftTeams
    ) {
      throw new BadDataException("Pick Slack or Microsoft Teams.");
    }

    if (
      !request.onCallDutyPolicyScheduleId ||
      !ObjectID.isValidUUID(request.onCallDutyPolicyScheduleId)
    ) {
      throw new BadDataException("Pick the on-call schedule to connect.");
    }

    const scheduleId: ObjectID = new ObjectID(
      request.onCallDutyPolicyScheduleId,
    );

    const schedule: OnCallDutyPolicySchedule =
      await WorkspaceUserGroupManager.getReadableSchedule({
        scheduleId: scheduleId,
        projectId: data.projectId,
        props: data.props,
      });

    const projectAuth: WorkspaceProjectAuthToken =
      await WorkspaceUserGroupManager.getConnection({
        projectId: data.projectId,
        workspaceType: request.workspaceType,
      });

    const picked: {
      workspaceGroupId: string;
      workspaceTeamId: string | null;
      name: string;
      handle: string | null;
    } =
      request.workspaceType === WorkspaceType.Slack
        ? await WorkspaceUserGroupManager.pickSlackGroup({
            request: request,
            projectAuth: projectAuth,
          })
        : await WorkspaceUserGroupManager.pickTeamsTag({
            request: request,
            projectAuth: projectAuth,
            projectId: data.projectId,
            schedule: schedule,
          });

    const existing: WorkspaceUserGroup | null =
      await WorkspaceUserGroupService.findOneBy({
        query: {
          projectId: data.projectId,
          workspaceType: request.workspaceType,
          workspaceGroupId: picked.workspaceGroupId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    let groupId: ObjectID;

    if (existing && existing.id) {
      const scheduleIds: Array<ObjectID> =
        await WorkspaceUserGroupManager.getScheduleIds(existing.id);

      const isFollowing: boolean = scheduleIds.some(
        (id: ObjectID): boolean => {
          return id.toString() === scheduleId.toString();
        },
      );

      if (!isFollowing) {
        await WorkspaceUserGroupService.updateOneById({
          id: existing.id,
          data: {
            onCallDutyPolicySchedules: [...scheduleIds, scheduleId].map(
              (id: ObjectID): OnCallDutyPolicySchedule => {
                const model: OnCallDutyPolicySchedule =
                  new OnCallDutyPolicySchedule();
                model.id = id;
                return model;
              },
            ),
          } as never,
          props: data.props,
        });
      }

      groupId = existing.id;
    } else {
      const model: WorkspaceUserGroup = new WorkspaceUserGroup();
      model.projectId = data.projectId;
      model.workspaceType = request.workspaceType;
      model.workspaceGroupId = picked.workspaceGroupId;

      if (picked.workspaceTeamId) {
        model.workspaceTeamId = picked.workspaceTeamId;
      }

      model.name = picked.name;

      if (picked.handle) {
        model.handle = picked.handle;
      }

      const linkedSchedule: OnCallDutyPolicySchedule =
        new OnCallDutyPolicySchedule();
      linkedSchedule.id = scheduleId;
      model.onCallDutyPolicySchedules = [linkedSchedule];

      const created: WorkspaceUserGroup = await WorkspaceUserGroupService.create(
        {
          data: model,
          props: data.props,
        },
      );

      groupId = created.id!;
    }

    await WorkspaceUserGroupSync.syncNow(groupId);

    const view: WorkspaceUserGroupView | null =
      await WorkspaceUserGroupManager.getView({
        workspaceUserGroupId: groupId,
        scheduleId: scheduleId,
        projectId: data.projectId,
        props: data.props,
      });

    if (!view) {
      throw new NotFoundException(NOT_FOUND_GROUP_MESSAGE);
    }

    return view;
  }

  /*
   * A group stops following a schedule. One that follows no other is no
   * longer kept in step: OneUptime forgets it, and leaves it in the
   * workspace as it is.
   */
  @CaptureSpan()
  public static async disconnect(data: {
    workspaceUserGroupId: ObjectID;
    scheduleId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    await WorkspaceUserGroupManager.getReadableGroup(data);

    const scheduleIds: Array<ObjectID> =
      await WorkspaceUserGroupManager.getScheduleIds(data.workspaceUserGroupId);

    const remaining: Array<ObjectID> = scheduleIds.filter(
      (id: ObjectID): boolean => {
        return id.toString() !== data.scheduleId.toString();
      },
    );

    if (remaining.length === scheduleIds.length) {
      return;
    }

    if (remaining.length === 0) {
      await WorkspaceUserGroupService.deleteOneBy({
        query: {
          _id: data.workspaceUserGroupId,
          projectId: data.projectId,
        },
        props: data.props,
      });
      return;
    }

    await WorkspaceUserGroupService.updateOneById({
      id: data.workspaceUserGroupId,
      data: {
        onCallDutyPolicySchedules: remaining.map(
          (id: ObjectID): OnCallDutyPolicySchedule => {
            const model: OnCallDutyPolicySchedule =
              new OnCallDutyPolicySchedule();
            model.id = id;
            return model;
          },
        ),
      } as never,
      props: data.props,
    });
  }

  // Try again: the group looked at now, for someone who may change it.
  @CaptureSpan()
  public static async syncAgain(data: {
    workspaceUserGroupId: ObjectID;
    scheduleId: ObjectID | null;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceUserGroupView> {
    await WorkspaceUserGroupManager.getReadableGroup(data);

    await WorkspaceUserGroupSync.syncNow(data.workspaceUserGroupId);

    const view: WorkspaceUserGroupView | null =
      await WorkspaceUserGroupManager.getView(data);

    if (!view) {
      throw new NotFoundException(NOT_FOUND_GROUP_MESSAGE);
    }

    return view;
  }

  /*
   * The words for a refusal of the workspace while connecting, for the
   * person at the form: what it means and what to do.
   */
  public static getConnectErrorText(data: {
    workspaceType: WorkspaceType;
    error: WorkspaceUserGroupError;
    handle?: string | undefined;
    name?: string | undefined;
  }): string {
    const productName: string = ProductBrandingText.getProductName();
    const workspace: string = getWorkspaceTypeDisplayName(data.workspaceType);
    const detail: string = data.error.detail || "";

    if (data.workspaceType === WorkspaceType.Slack) {
      if (detail === "handle_already_exists") {
        return `Slack already uses @${data.handle || ""} for a person, a channel or another user group. Pick another handle.`;
      }

      if (detail === "name_already_exists") {
        return `Your Slack workspace has a user group called ${data.name || ""} already. Pick it from the list, or choose another name.`;
      }

      if (detail === "bad_handle" || detail === "forbidden_handle") {
        return `Slack doesn't accept @${data.handle || ""} as a handle. Use lower-case letters, numbers and hyphens.`;
      }

      if (detail === "name_too_long") {
        return "That name is too long for Slack. Choose a shorter one.";
      }
    }

    switch (data.error.problem) {
      case WorkspaceUserGroupProblem.NotConnected:
        return `${workspace} is not connected to this project any more. Connect it again in Project Settings > Workspace > ${workspace}.`;
      case WorkspaceUserGroupProblem.PaidPlanNeeded:
        return "User groups need a paid Slack plan. Upgrade your Slack workspace to use them.";
      case WorkspaceUserGroupProblem.MissingScope:
        return `${productName}'s Slack app isn't allowed to manage user groups yet. Reconnect Slack in Project Settings > Workspace > Slack to allow it.`;
      case WorkspaceUserGroupProblem.AdminsOnly:
        return "Slack lets only workspace owners and admins manage user groups in your workspace. Ask a Slack admin to let everyone manage user groups (in Slack's admin settings, Permissions > User Groups), then try again.";
      case WorkspaceUserGroupProblem.MissingPermission:
        return `${productName} isn't allowed to manage tags in your Microsoft 365 tenant yet. A Microsoft 365 admin can allow it with Grant Admin Consent, in Project Settings > Workspace > Microsoft Teams.`;
      case WorkspaceUserGroupProblem.TeamGone:
        return WorkspaceUserGroupManager.getTeamGoneText();
      case WorkspaceUserGroupProblem.Gone:
        return data.workspaceType === WorkspaceType.Slack
          ? "This user group is not in your Slack workspace any more. Pick another one."
          : "This tag is not in the team any more. Pick another one.";
      case WorkspaceUserGroupProblem.Unavailable:
        return `${workspace} didn't answer. Try again in a minute.`;
      default:
        return detail
          ? `${workspace} refused: ${detail}.`
          : `${workspace} refused the change.`;
    }
  }

  private static getTeamGoneText(): string {
    return `${ProductBrandingText.getProductName()}'s app isn't in this team. Add it to the team in Microsoft Teams first, or pick another team.`;
  }

  // Asks the workspace; a refusal comes back in words for the person.
  private static async askWorkspace<T>(
    workspaceType: WorkspaceType,
    ask: () => Promise<T>,
    context?: { handle?: string | undefined; name?: string | undefined },
  ): Promise<T> {
    try {
      return await ask();
    } catch (err) {
      const error: WorkspaceUserGroupError | null =
        WorkspaceUserGroupError.read(err);

      if (!error) {
        throw err;
      }

      throw new BadDataException(
        WorkspaceUserGroupManager.getConnectErrorText({
          workspaceType: workspaceType,
          error: error,
          handle: context?.handle,
          name: context?.name,
        }),
      );
    }
  }

  // A Slack user group to connect: the one picked, or a new one.
  private static async pickSlackGroup(data: {
    request: WorkspaceUserGroupConnectRequest;
    projectAuth: WorkspaceProjectAuthToken;
  }): Promise<{
    workspaceGroupId: string;
    workspaceTeamId: string | null;
    name: string;
    handle: string | null;
  }> {
    const authToken: string = data.projectAuth.authToken || "";
    const teamId: string = data.projectAuth.workspaceProjectId || "";

    const newName: string = (data.request.newGroupName || "").trim();
    const newHandle: string = readSlackUserGroupHandle(
      data.request.newGroupHandle || "",
    );

    if (!data.request.workspaceGroupId) {
      if (!newName) {
        throw new BadDataException("Give the new user group a name.");
      }

      if (newName.length > SLACK_USER_GROUP_NAME_MAX_LENGTH) {
        throw new BadDataException(
          `A user group's name holds ${SLACK_USER_GROUP_NAME_MAX_LENGTH} characters at most.`,
        );
      }

      if (!isValidSlackUserGroupHandle(newHandle)) {
        throw new BadDataException(
          "Give the new user group a handle of lower-case letters, numbers and hyphens, such as payments-oncall.",
        );
      }

      const created: SlackUserGroupInfo =
        await WorkspaceUserGroupManager.askWorkspace(
          WorkspaceType.Slack,
          () => {
            return SlackUserGroups.create({
              authToken: authToken,
              teamId: teamId,
              name: newName,
              handle: newHandle,
              description: SLACK_USER_GROUP_DESCRIPTION(
                ProductBrandingText.getProductName(),
              ),
            });
          },
          { handle: newHandle, name: newName },
        );

      return {
        workspaceGroupId: created.id,
        workspaceTeamId: null,
        name: created.name || newName,
        handle: created.handle || newHandle,
      };
    }

    const groups: Array<SlackUserGroupInfo> =
      await WorkspaceUserGroupManager.askWorkspace(WorkspaceType.Slack, () => {
        return SlackUserGroups.list({ authToken: authToken, teamId: teamId });
      });

    const group: SlackUserGroupInfo | undefined = groups.find(
      (candidate: SlackUserGroupInfo): boolean => {
        return candidate.id === data.request.workspaceGroupId;
      },
    );

    if (!group) {
      throw new BadDataException(
        "This user group is not in your Slack workspace any more. Pick another one.",
      );
    }

    /*
     * A group turned off in Slack is picked to be kept in step: connecting
     * it turns it back on, as the form says. Turned off later by somebody,
     * it is left off (the card says so).
     */
    if (group.isTurnedOff) {
      await WorkspaceUserGroupManager.askWorkspace(WorkspaceType.Slack, () => {
        return SlackUserGroups.turnOn({
          authToken: authToken,
          teamId: teamId,
          groupId: group.id,
        });
      });
    }

    return {
      workspaceGroupId: group.id,
      workspaceTeamId: null,
      name: group.name,
      handle: group.handle || null,
    };
  }

  /*
   * A Microsoft Teams tag to connect: the one picked, the team's tag of the
   * name typed, or a new one made with the people on call now - Teams
   * makes no empty tag.
   */
  private static async pickTeamsTag(data: {
    request: WorkspaceUserGroupConnectRequest;
    projectAuth: WorkspaceProjectAuthToken;
    projectId: ObjectID;
    schedule: OnCallDutyPolicySchedule;
  }): Promise<{
    workspaceGroupId: string;
    workspaceTeamId: string | null;
    name: string;
    handle: string | null;
  }> {
    const teamId: string = (data.request.workspaceTeamId || "").trim();

    if (!teamId) {
      throw new BadDataException("Pick the team the tag is in.");
    }

    const isInstalled: boolean = WorkspaceUserGroupManager.getInstalledTeams(
      data.projectAuth,
    ).some((team: WorkspaceUserGroupTeam): boolean => {
      return team.teamId === teamId;
    });

    if (!isInstalled) {
      throw new BadDataException(WorkspaceUserGroupManager.getTeamGoneText());
    }

    const accessToken: string = await WorkspaceUserGroupManager.getGraphToken({
      projectId: data.projectId,
      projectAuth: data.projectAuth,
    });

    const tags: Array<MicrosoftTeamsTagInfo> =
      await WorkspaceUserGroupManager.askWorkspace(
        WorkspaceType.MicrosoftTeams,
        () => {
          return MicrosoftTeamsTags.list({
            accessToken: accessToken,
            teamId: teamId,
          });
        },
      );

    if (data.request.workspaceGroupId) {
      const tag: MicrosoftTeamsTagInfo | undefined = tags.find(
        (candidate: MicrosoftTeamsTagInfo): boolean => {
          return candidate.id === data.request.workspaceGroupId;
        },
      );

      if (!tag) {
        throw new BadDataException(
          "This tag is not in the team any more. Pick another one.",
        );
      }

      return {
        workspaceGroupId: tag.id,
        workspaceTeamId: teamId,
        name: tag.name,
        handle: null,
      };
    }

    const tagName: string = (data.request.tagName || "").trim();

    if (!tagName) {
      throw new BadDataException("Give the tag a name.");
    }

    if (tagName.length > MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH) {
      throw new BadDataException(
        `A tag's name holds ${MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH} characters at most.`,
      );
    }

    const sameName: MicrosoftTeamsTagInfo | undefined = tags.find(
      (candidate: MicrosoftTeamsTagInfo): boolean => {
        return (
          candidate.name.trim().toLowerCase() === tagName.toLowerCase()
        );
      },
    );

    if (sameName) {
      return {
        workspaceGroupId: sameName.id,
        workspaceTeamId: teamId,
        name: sameName.name,
        handle: null,
      };
    }

    // A new tag starts with whoever from the team is on call now.
    const onCallUserId: ObjectID | undefined =
      data.schedule.currentUserIdOnRoster;

    let firstMember: string | null = null;

    if (onCallUserId) {
      const people: Array<{
        userId: ObjectID;
        email: string;
        connectedWorkspaceUserId: string | null;
      }> = await WorkspaceUserGroupSync.getPeopleOnCall({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        schedules: [data.schedule],
      });

      const roster: Array<MicrosoftTeamsRosterMember> | null =
        await WorkspaceUserGroupManager.askWorkspace(
          WorkspaceType.MicrosoftTeams,
          async () => {
            try {
              return await MicrosoftTeamsUtil.getTeamRoster({
                projectId: data.projectId,
                teamId: teamId,
              });
            } catch {
              throw new WorkspaceUserGroupError({
                problem: WorkspaceUserGroupProblem.Unavailable,
              });
            }
          },
        );

      for (const person of people) {
        const found: MicrosoftTeamsRosterMember | null = roster
          ? MicrosoftTeamsTags.findPerson({ roster: roster, person: person })
          : null;

        if (found) {
          firstMember = found.aadObjectId;
          break;
        }
      }
    }

    if (!firstMember) {
      throw new BadDataException(
        "Microsoft Teams makes no empty tag, and nobody on call in this schedule now is a member of this team. Pick a tag the team has, or connect a new one once somebody from the team is on call.",
      );
    }

    const made: MicrosoftTeamsTagInfo =
      await WorkspaceUserGroupManager.askWorkspace(
        WorkspaceType.MicrosoftTeams,
        () => {
          return MicrosoftTeamsTags.create({
            accessToken: accessToken,
            teamId: teamId,
            name: tagName,
            aadObjectIds: [firstMember!],
          });
        },
      );

    return {
      workspaceGroupId: made.id,
      workspaceTeamId: teamId,
      name: made.name || tagName,
      handle: null,
    };
  }

  // The schedule, as the person may read it; refused like a missing one.
  private static async getReadableSchedule(data: {
    scheduleId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<OnCallDutyPolicySchedule> {
    const schedule: OnCallDutyPolicySchedule | null =
      await OnCallDutyPolicyScheduleService.findOneBy({
        query: {
          _id: data.scheduleId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          projectId: true,
          currentUserIdOnRoster: true,
        },
        props: data.props,
      });

    if (!schedule) {
      throw new NotFoundException(NOT_FOUND_SCHEDULE_MESSAGE);
    }

    return schedule;
  }

  // The group, as the person may read it; refused like a missing one.
  private static async getReadableGroup(data: {
    workspaceUserGroupId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceUserGroup> {
    const group: WorkspaceUserGroup | null =
      await WorkspaceUserGroupService.findOneBy({
        query: {
          _id: data.workspaceUserGroupId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        props: data.props,
      });

    if (!group) {
      throw new NotFoundException(NOT_FOUND_GROUP_MESSAGE);
    }

    return group;
  }

  // Every schedule a group follows, read as OneUptime.
  private static async getScheduleIds(
    workspaceUserGroupId: ObjectID,
  ): Promise<Array<ObjectID>> {
    const group: WorkspaceUserGroup | null =
      await WorkspaceUserGroupService.findOneById({
        id: workspaceUserGroupId,
        select: {
          onCallDutyPolicySchedules: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    return (group?.onCallDutyPolicySchedules || [])
      .map((schedule: OnCallDutyPolicySchedule): ObjectID | undefined => {
        return schedule.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });
  }

  // The project's connection to a workspace, or the words to connect it.
  private static async getConnection(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<WorkspaceProjectAuthToken> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      });

    if (!projectAuth || !projectAuth.authToken) {
      const workspace: string = getWorkspaceTypeDisplayName(data.workspaceType);

      throw new BadDataException(
        `${workspace} is not connected to this project. Connect it in Project Settings > Workspace > ${workspace} first.`,
      );
    }

    return projectAuth;
  }

  // A Microsoft Graph token for the project's tenant.
  private static async getGraphToken(data: {
    projectId: ObjectID;
    projectAuth: WorkspaceProjectAuthToken;
  }): Promise<string> {
    try {
      return await MicrosoftTeamsUtil.getValidAccessToken({
        authToken: data.projectAuth.authToken || "",
        projectId: data.projectId,
      });
    } catch {
      throw new BadDataException(
        WorkspaceUserGroupManager.getConnectErrorText({
          workspaceType: WorkspaceType.MicrosoftTeams,
          error: new WorkspaceUserGroupError({
            problem: WorkspaceUserGroupProblem.NotConnected,
          }),
        }),
      );
    }
  }

  // The teams OneUptime's app is in: where its bot can read who is in them.
  public static getInstalledTeams(
    projectAuth: WorkspaceProjectAuthToken,
  ): Array<WorkspaceUserGroupTeam> {
    const miscData: MicrosoftTeamsMiscData | undefined =
      projectAuth.miscData as MicrosoftTeamsMiscData | undefined;

    const installed: Record<string, MicrosoftTeamsInstalledTeam> =
      MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId(
        miscData?.installedTeams,
      );

    return Object.entries(installed)
      .map(
        ([teamId, team]: [
          string,
          MicrosoftTeamsInstalledTeam,
        ]): WorkspaceUserGroupTeam => {
          return {
            teamId: teamId,
            name:
              team.name ||
              miscData?.availableTeams?.[teamId]?.name ||
              "Unnamed team",
          };
        },
      )
      .sort((a: WorkspaceUserGroupTeam, b: WorkspaceUserGroupTeam): number => {
        return a.name.localeCompare(b.name);
      });
  }

  private static async getTeamName(data: {
    projectId: ObjectID;
    teamId: string;
  }): Promise<string | null> {
    if (!data.teamId) {
      return null;
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    const miscData: MicrosoftTeamsMiscData | undefined =
      projectAuth?.miscData as MicrosoftTeamsMiscData | undefined;

    const installed: MicrosoftTeamsInstalledTeam | undefined =
      MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId(
        miscData?.installedTeams,
      )[data.teamId];

    return (
      installed?.name || miscData?.availableTeams?.[data.teamId]?.name || null
    );
  }

  // Names and email addresses of people, by their lower-cased id.
  private static async getPeople(
    userIds: Array<string>,
  ): Promise<Map<string, WorkspaceUserGroupPersonView>> {
    const ids: Array<ObjectID> = Array.from(
      new Set<string>(
        userIds
          .map((id: string): string => {
            return id.toLowerCase();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    ).map((id: string): ObjectID => {
      return new ObjectID(id);
    });

    const people: Map<string, WorkspaceUserGroupPersonView> = new Map<
      string,
      WorkspaceUserGroupPersonView
    >();

    if (ids.length === 0) {
      return people;
    }

    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(ids),
      },
      select: {
        _id: true,
        name: true,
        email: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      if (!user.id) {
        continue;
      }

      people.set(user.id.toString().toLowerCase(), {
        userId: user.id.toString(),
        name: user.name?.toString() || "",
        email: user.email?.toString() || "",
      });
    }

    return people;
  }
}
