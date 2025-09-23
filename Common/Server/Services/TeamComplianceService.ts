import TeamComplianceSettingService from "./TeamComplianceSettingService";
import TeamMemberService from "./TeamMemberService";
import UserEmailService from "./UserEmailService";
import UserSmsService from "./UserSmsService";
import UserCallService from "./UserCallService";
import UserPushService from "./UserPushService";
import IncidentSeverityService from "./IncidentSeverityService";
import AlertSeverityService from "./AlertSeverityService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserService from "./UserService";
import TeamService from "./TeamService";
import ObjectID from "../../Types/ObjectID";
import ComplianceRuleType from "../../Types/Team/ComplianceRuleType";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Team from "../../Models/DatabaseModels/Team";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";

export interface UserComplianceStatus {
  userId: ObjectID;
  userName: string;
  userEmail: string;
  userProfilePictureId?: ObjectID | undefined;
  isCompliant: boolean;
  nonCompliantRules: Array<{
    ruleType: ComplianceRuleType;
    reason: string;
  }>;
}

export interface TeamComplianceStatus {
  teamId: ObjectID;
  teamName: string;
  complianceSettings: Array<{
    ruleType: ComplianceRuleType;
    enabled: boolean;
  }>;
  userComplianceStatuses: Array<UserComplianceStatus>;
}

export default class TeamComplianceService {
  public static async getTeamComplianceStatus(
    teamId: ObjectID,
    projectId: ObjectID,
  ): Promise<TeamComplianceStatus> {
    // Get team details
    const team: Partial<Team> | null = await TeamService.findOneById({
      id: teamId,
      select: {
        name: true,
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!team) {
      throw new BadDataException("Team not found");
    }

    // Get compliance settings for this team
    const complianceSettings: Array<{
      ruleType?: ComplianceRuleType;
      enabled?: boolean;
    }> = await TeamComplianceSettingService.findBy({
      query: {
        teamId: teamId,
        projectId: projectId,
      },
      select: {
        ruleType: true,
        enabled: true,
      },
      limit: 100,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Get team members
    const teamMembers: Array<{ userId?: ObjectID; _id?: string }> =
      await TeamMemberService.findBy({
        query: {
          teamId: teamId,
          projectId: projectId,
        },
        select: {
          userId: true,
          _id: true,
        },
        limit: 100,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const userIds: Array<ObjectID> = teamMembers
      .map((member: { userId?: ObjectID; _id?: string }) => {
        return member.userId!;
      })
      .filter(Boolean);

    // Get user details
    const users: any = await UserService.findBy({
      query: {
        _id: new Includes(userIds),
      },
      select: {
        name: true,
        email: true,
        _id: true,
        profilePictureId: true,
      },
      limit: 100,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Check compliance for each user
    const userComplianceStatuses: Array<UserComplianceStatus> = [];

    for (const user of users) {
      const complianceStatus: {
        isCompliant: boolean;
        nonCompliantRules: Array<{
          ruleType: ComplianceRuleType;
          reason: string;
        }>;
      } = await this.checkUserCompliance(
        user.id!,
        projectId,
        complianceSettings.map(
          (setting: { ruleType?: ComplianceRuleType; enabled?: boolean }) => {
            return {
              ruleType: setting.ruleType!,
              enabled: setting.enabled || false,
            };
          },
        ),
      );
      userComplianceStatuses.push({
        userId: user.id!,
        userName: user.name?.toString() || "Unknown User",
        userEmail: user.email?.toString() || "",
        userProfilePictureId: user.profilePictureId,
        ...complianceStatus,
      });
    }

    return {
      teamId: teamId,
      teamName: team.name || "Unknown Team",
      complianceSettings: complianceSettings.map(
        (setting: { ruleType?: ComplianceRuleType; enabled?: boolean }) => {
          return {
            ruleType: setting.ruleType!,
            enabled: setting.enabled || false,
          };
        },
      ),
      userComplianceStatuses,
    };
  }

  private static async checkUserCompliance(
    userId: ObjectID,
    projectId: ObjectID,
    complianceSettings: Array<{
      ruleType: ComplianceRuleType;
      enabled: boolean;
    }>,
  ): Promise<{
    isCompliant: boolean;
    nonCompliantRules: Array<{ ruleType: ComplianceRuleType; reason: string }>;
  }> {
    const nonCompliantRules: Array<{
      ruleType: ComplianceRuleType;
      reason: string;
    }> = [];

    // Check each enabled compliance rule
    for (const setting of complianceSettings) {
      if (!setting.enabled) {
        continue;
      }

      const isCompliant: { compliant: boolean; reason: string } =
        await this.checkRuleCompliance(userId, projectId, setting.ruleType);

      if (!isCompliant.compliant) {
        nonCompliantRules.push({
          ruleType: setting.ruleType,
          reason: isCompliant.reason,
        });
      }
    }

    return {
      isCompliant: nonCompliantRules.length === 0,
      nonCompliantRules,
    };
  }

  private static async checkRuleCompliance(
    userId: ObjectID,
    projectId: ObjectID,
    ruleType: ComplianceRuleType,
  ): Promise<{ compliant: boolean; reason: string }> {
    switch (ruleType) {
      case ComplianceRuleType.HasNotificationEmailMethod:
        return await this.checkHasNotificationEmail(userId, projectId);

      case ComplianceRuleType.HasNotificationSMSMethod:
        return await this.checkHasNotificationSMS(userId, projectId);

      case ComplianceRuleType.HasNotificationCallMethod:
        return await this.checkHasNotificationCall(userId, projectId);

      case ComplianceRuleType.HasNotificationPushMethod:
        return await this.checkHasNotificationPush(userId, projectId);

      case ComplianceRuleType.HasIncidentOnCallRules:
        return await this.checkHasIncidentOnCallRules(userId, projectId);

      case ComplianceRuleType.HasAlertOnCallRules:
        return await this.checkHasAlertOnCallRules(userId, projectId);

      default:
        return { compliant: true, reason: "" };
    }
  }

  private static async checkHasNotificationEmail(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userEmails: Array<{ _id?: string }> = await UserEmailService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: 1,
      skip: 0,
    });

    const hasEmail: boolean = userEmails.length > 0;
    return {
      compliant: hasEmail,
      reason: hasEmail
        ? ""
        : "No verified email address configured for notifications",
    };
  }

  private static async checkHasNotificationSMS(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userSMS: Array<{ _id?: string }> = await UserSmsService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: 1,
      skip: 0,
    });

    const hasSMS: boolean = userSMS.length > 0;
    return {
      compliant: hasSMS,
      reason: hasSMS
        ? ""
        : "No verified phone number configured for SMS notifications",
    };
  }

  private static async checkHasNotificationCall(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userCalls: Array<{ _id?: string }> = await UserCallService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: 1,
      skip: 0,
    });

    const hasCall: boolean = userCalls.length > 0;
    return {
      compliant: hasCall,
      reason: hasCall
        ? ""
        : "No verified phone number configured for call notifications",
    };
  }

  private static async checkHasNotificationPush(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userPush: Array<{ _id?: string }> = await UserPushService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: 1,
      skip: 0,
    });

    const hasPush: boolean = userPush.length > 0;
    return {
      compliant: hasPush,
      reason: hasPush ? "" : "No verified push notification device configured",
    };
  }

  private static async checkHasIncidentOnCallRules(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    // Get all incident severities for the project
    const incidentSeverities: Array<Partial<IncidentSeverity>> =
      await IncidentSeverityService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    if (incidentSeverities.length === 0) {
      return { compliant: true, reason: "" }; // No incident severities configured
    }

    // Check if user has notification rules for all incident severities
    const severityIds: Array<string> = incidentSeverities.map(
      (severity: Partial<IncidentSeverity>) => {
        return severity._id!;
      },
    );
    const missingSeverities: Array<string> = [];

    for (const severityId of severityIds) {
      const notificationRules: Array<{
        _id?: string;
        userCallId?: ObjectID;
        userSmsId?: ObjectID;
        userEmailId?: ObjectID;
        userPushId?: ObjectID;
      }> = await UserNotificationRuleService.findBy({
        query: {
          userId: userId,
          projectId: projectId,
          incidentSeverityId: severityId,
        },
        select: {
          _id: true,
          userCallId: true,
          userSmsId: true,
          userEmailId: true,
          userPushId: true,
        },
        props: {
          isRoot: true,
        },
        limit: 1,
        skip: 0,
      });

      // Check if user has at least one notification method configured for this severity
      const hasNotificationMethod: boolean = notificationRules.some(
        (rule: {
          _id?: string;
          userCallId?: ObjectID;
          userSmsId?: ObjectID;
          userEmailId?: ObjectID;
          userPushId?: ObjectID;
        }) => {
          return (
            rule.userCallId ||
            rule.userSmsId ||
            rule.userEmailId ||
            rule.userPushId
          );
        },
      );

      if (!hasNotificationMethod) {
        const severity: Partial<IncidentSeverity> | undefined =
          incidentSeverities.find((s: Partial<IncidentSeverity>) => {
            return s._id?.toString() === severityId.toString();
          });
        const severityName: string = severity?.name || severityId.toString();
        missingSeverities.push(severityName);
      }
    }

    if (missingSeverities.length > 0) {
      return {
        compliant: false,
        reason: `Missing notification rules for incident severities: ${missingSeverities.join(", ")}`,
      };
    }

    return {
      compliant: true,
      reason: "",
    };
  }

  private static async checkHasAlertOnCallRules(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    // Get all alert severities for the project
    const alertSeverities: Array<Partial<AlertSeverity>> =
      await AlertSeverityService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
        limit: 100, // Assuming reasonable limit for severities
        skip: 0,
      });

    if (alertSeverities.length === 0) {
      return { compliant: true, reason: "" }; // No alert severities configured
    }

    // Check if user has notification rules for all alert severities
    const severityIds: Array<string> = alertSeverities.map(
      (severity: Partial<AlertSeverity>) => {
        return severity._id!;
      },
    );
    const missingSeverities: Array<string> = [];

    for (const severityId of severityIds) {
      const notificationRules: Array<{
        _id?: string;
        userCallId?: ObjectID;
        userSmsId?: ObjectID;
        userEmailId?: ObjectID;
        userPushId?: ObjectID;
      }> = await UserNotificationRuleService.findBy({
        query: {
          userId: userId,
          projectId: projectId,
          alertSeverityId: severityId,
        },
        select: {
          _id: true,
          userCallId: true,
          userSmsId: true,
          userEmailId: true,
          userPushId: true,
        },
        props: {
          isRoot: true,
        },
        limit: 1,
        skip: 0,
      });

      // Check if user has at least one notification method configured for this severity
      const hasNotificationMethod: boolean = notificationRules.some(
        (rule: {
          _id?: string;
          userCallId?: ObjectID;
          userSmsId?: ObjectID;
          userEmailId?: ObjectID;
          userPushId?: ObjectID;
        }) => {
          return (
            rule.userCallId ||
            rule.userSmsId ||
            rule.userEmailId ||
            rule.userPushId
          );
        },
      );

      if (!hasNotificationMethod) {
        const severity: Partial<AlertSeverity> | undefined =
          alertSeverities.find((s: Partial<AlertSeverity>) => {
            return s._id?.toString() === severityId.toString();
          });
        const severityName: string = severity?.name || severityId.toString();
        missingSeverities.push(severityName);
      }
    }

    if (missingSeverities.length > 0) {
      return {
        compliant: false,
        reason: `Missing notification rules for alert severities: ${missingSeverities.join(", ")}`,
      };
    }

    return {
      compliant: true,
      reason: "",
    };
  }
}
