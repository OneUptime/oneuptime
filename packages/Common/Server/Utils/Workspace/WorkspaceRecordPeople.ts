import IncidentEpisodeRoleMember from "../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import OnCallDutyPolicyOwnerTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { NotificationRuleInvitee } from "../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertService from "../../Services/AlertService";
import IncidentEpisodeRoleMemberService from "../../Services/IncidentEpisodeRoleMemberService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentMemberService from "../../Services/IncidentMemberService";
import IncidentService from "../../Services/IncidentService";
import MonitorService from "../../Services/MonitorService";
import OnCallDutyPolicyOwnerTeamService from "../../Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../Services/OnCallDutyPolicyOwnerUserService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * The record a rule's channel belongs to: one of these ids is set. (The
 * same shape as WorkspaceNotificationRuleService's NotificationFor.)
 */
export interface WorkspaceRecord {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  alertEpisodeId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
}

/*
 * THE PEOPLE A RECORD HAS NOW, BY THE KIND A RULE CAN ADD TO ITS CHANNEL
 * (NotificationRuleInvites).
 *
 * When a rule creates a record's channel, everybody the record has already -
 * owners added with it, the Incident Commander of an incident a rule creates
 * its channel for only once it is acknowledged, the people an on-call policy
 * paged before the channel existed - is added to it then. Whoever joins the
 * record later is added as they join (the owner, member and on-call
 * services). Between the two nobody is missed: the channel is stored on the
 * record before these are read, and each of those services reads the
 * record's channels after its person is stored.
 *
 * Read as OneUptime. The ids may name somebody who has left the project;
 * the invite narrows them to members.
 */
export default class WorkspaceRecordPeople {
  @CaptureSpan()
  public static async getUserIds(data: {
    record: WorkspaceRecord;
    invitee: NotificationRuleInvitee;
  }): Promise<Array<ObjectID>> {
    switch (data.invitee) {
      case NotificationRuleInvitee.Owners:
        return await WorkspaceRecordPeople.getOwnerUserIds(data.record);
      case NotificationRuleInvitee.IncidentRoles:
        return await WorkspaceRecordPeople.getRoleUserIds(data.record);
      case NotificationRuleInvitee.OnCallResponders:
        return await WorkspaceRecordPeople.getPagedUserIds(data.record);
      default:
        return [];
    }
  }

  // Its owner users and the members of its owner teams.
  private static async getOwnerUserIds(
    record: WorkspaceRecord,
  ): Promise<Array<ObjectID>> {
    let owners: Array<User> = [];

    if (record.incidentId) {
      owners = await IncidentService.findOwners(record.incidentId);
    } else if (record.alertId) {
      owners = await AlertService.findOwners(record.alertId);
    } else if (record.incidentEpisodeId) {
      owners = await IncidentEpisodeService.findOwners(
        record.incidentEpisodeId,
      );
    } else if (record.alertEpisodeId) {
      owners = await AlertEpisodeService.findOwners(record.alertEpisodeId);
    } else if (record.scheduledMaintenanceId) {
      owners = await ScheduledMaintenanceService.findOwners(
        record.scheduledMaintenanceId,
      );
    } else if (record.monitorId) {
      owners = await MonitorService.findOwners(record.monitorId);
    } else if (record.onCallDutyPolicyId) {
      return await WorkspaceRecordPeople.getOnCallPolicyOwnerUserIds(
        record.onCallDutyPolicyId,
      );
    }

    return WorkspaceRecordPeople.unique(
      owners.map((owner: User): ObjectID | undefined => {
        return owner.id || undefined;
      }),
    );
  }

  private static async getOnCallPolicyOwnerUserIds(
    onCallDutyPolicyId: ObjectID,
  ): Promise<Array<ObjectID>> {
    const ownerUsers: Array<OnCallDutyPolicyOwnerUser> =
      await OnCallDutyPolicyOwnerUserService.findBy({
        query: {
          onCallDutyPolicyId: onCallDutyPolicyId,
        },
        select: {
          userId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const ownerTeams: Array<OnCallDutyPolicyOwnerTeam> =
      await OnCallDutyPolicyOwnerTeamService.findBy({
        query: {
          onCallDutyPolicyId: onCallDutyPolicyId,
        },
        select: {
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const teamIds: Array<ObjectID> = ownerTeams
      .map((ownerTeam: OnCallDutyPolicyOwnerTeam): ObjectID | undefined => {
        return ownerTeam.teamId;
      })
      .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
        return Boolean(teamId);
      });

    const teamUsers: Array<User> =
      teamIds.length > 0
        ? await TeamMemberService.getUsersInTeams(teamIds)
        : [];

    return WorkspaceRecordPeople.unique([
      ...ownerUsers.map(
        (ownerUser: OnCallDutyPolicyOwnerUser): ObjectID | undefined => {
          return ownerUser.userId;
        },
      ),
      ...teamUsers.map((user: User): ObjectID | undefined => {
        return user.id || undefined;
      }),
    ]);
  }

  /*
   * The people given an incident role: an incident's members, and an
   * incident episode's role members.
   */
  private static async getRoleUserIds(
    record: WorkspaceRecord,
  ): Promise<Array<ObjectID>> {
    if (record.incidentId) {
      const members: Array<IncidentMember> = await IncidentMemberService.findBy(
        {
          query: {
            incidentId: record.incidentId,
          },
          select: {
            userId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        },
      );

      return WorkspaceRecordPeople.unique(
        members.map((member: IncidentMember): ObjectID | undefined => {
          return member.userId;
        }),
      );
    }

    if (record.incidentEpisodeId) {
      const members: Array<IncidentEpisodeRoleMember> =
        await IncidentEpisodeRoleMemberService.findBy({
          query: {
            incidentEpisodeId: record.incidentEpisodeId,
          },
          select: {
            userId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      return WorkspaceRecordPeople.unique(
        members.map(
          (member: IncidentEpisodeRoleMember): ObjectID | undefined => {
            return member.userId;
          },
        ),
      );
    }

    return [];
  }

  /*
   * The people an on-call policy has paged for the record so far: one
   * UserOnCallLog row per page (UserNotificationRuleService
   * .startUserNotificationRulesExecution).
   */
  private static async getPagedUserIds(
    record: WorkspaceRecord,
  ): Promise<Array<ObjectID>> {
    let query: Record<string, ObjectID> | null = null;

    if (record.incidentId) {
      query = { triggeredByIncidentId: record.incidentId };
    } else if (record.alertId) {
      query = { triggeredByAlertId: record.alertId };
    } else if (record.incidentEpisodeId) {
      query = { triggeredByIncidentEpisodeId: record.incidentEpisodeId };
    } else if (record.alertEpisodeId) {
      query = { triggeredByAlertEpisodeId: record.alertEpisodeId };
    }

    if (!query) {
      return [];
    }

    const pages: Array<UserOnCallLog> = await UserOnCallLogService.findBy({
      query: query,
      select: {
        userId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return WorkspaceRecordPeople.unique(
      pages.map((page: UserOnCallLog): ObjectID | undefined => {
        return page.userId;
      }),
    );
  }

  // Each person once, in the order first named.
  private static unique(
    userIds: Array<ObjectID | undefined | null>,
  ): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const result: Array<ObjectID> = [];

    for (const userId of userIds) {
      if (!userId) {
        continue;
      }

      const key: string = userId.toString().toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(new ObjectID(userId.toString()));
    }

    return result;
  }
}
