import TeamComplianceSettingService from "./TeamComplianceSettingService";
import TeamMemberService from "./TeamMemberService";
import UserEmailService from "./UserEmailService";
import UserSmsService from "./UserSmsService";
import UserCallService from "./UserCallService";
import UserPushService from "./UserPushService";
import OnCallDutyPolicyUserOverrideService from "./OnCallDutyPolicyUserOverrideService";
import UserService from "./UserService";
import TeamService from "./TeamService";
import ObjectID from "../../Types/ObjectID";
import ComplianceRuleType from "../../Types/Team/ComplianceRuleType";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";

export interface UserComplianceStatus {
  userId: ObjectID;
  userName: string;
  userEmail: string;
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
    const team = await TeamService.findOneById({
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
    const complianceSettings = await TeamComplianceSettingService.findBy({
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
    const teamMembers = await TeamMemberService.findBy({
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

    const userIds = teamMembers.map((member) => member.userId!).filter(Boolean);

    // Get user details
    const users = await UserService.findBy({
      query: {
        _id: new Includes(userIds),
      },
      select: {
        name: true,
        email: true,
        _id: true,
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
      const complianceStatus = await this.checkUserCompliance(
        user.id!,
        projectId,
        complianceSettings.map((setting) => ({
          ruleType: setting.ruleType!,
          enabled: setting.enabled || false,
        })),
      );
      userComplianceStatuses.push({
        userId: user.id!,
        userName: user.name?.toString() || "Unknown User",
        userEmail: user.email?.toString() || "",
        ...complianceStatus,
      });
    }

    return {
      teamId: teamId,
      teamName: team.name || "Unknown Team",
      complianceSettings: complianceSettings.map((setting) => ({
        ruleType: setting.ruleType!,
        enabled: setting.enabled || false,
      })),
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
  ): Promise<{ isCompliant: boolean; nonCompliantRules: Array<{ ruleType: ComplianceRuleType; reason: string }> }> {
    const nonCompliantRules: Array<{ ruleType: ComplianceRuleType; reason: string }> = [];

    // Check each enabled compliance rule
    for (const setting of complianceSettings) {
      if (!setting.enabled) {
        continue;
      }

      const isCompliant = await this.checkRuleCompliance(
        userId,
        projectId,
        setting.ruleType,
      );

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
      case ComplianceRuleType.HasNotificationEmail:
        return await this.checkHasNotificationEmail(userId, projectId);

      case ComplianceRuleType.HasNotificationSMS:
        return await this.checkHasNotificationSMS(userId, projectId);

      case ComplianceRuleType.HasNotificationCall:
        return await this.checkHasNotificationCall(userId, projectId);

      case ComplianceRuleType.HasNotificationPush:
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
    const userEmails = await UserEmailService.findBy({
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

    const hasEmail = userEmails.length > 0;
    return {
      compliant: hasEmail,
      reason: hasEmail ? "" : "No verified email address configured for notifications",
    };
  }

  private static async checkHasNotificationSMS(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userSMS = await UserSmsService.findBy({
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

    const hasSMS = userSMS.length > 0;
    return {
      compliant: hasSMS,
      reason: hasSMS ? "" : "No verified phone number configured for SMS notifications",
    };
  }

  private static async checkHasNotificationCall(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userCalls = await UserCallService.findBy({
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

    const hasCall = userCalls.length > 0;
    return {
      compliant: hasCall,
      reason: hasCall ? "" : "No verified phone number configured for call notifications",
    };
  }

  private static async checkHasNotificationPush(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userPush = await UserPushService.findBy({
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

    const hasPush = userPush.length > 0;
    return {
      compliant: hasPush,
      reason: hasPush ? "" : "No verified push notification device configured",
    };
  }

  private static async checkHasIncidentOnCallRules(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    // Check if user has any on-call duty policy overrides
    const userOverrides = await OnCallDutyPolicyUserOverrideService.findBy({
      query: {
        overrideUserId: userId,
        projectId: projectId,
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

    const hasIncidentOnCallRules = userOverrides.length > 0;
    return {
      compliant: hasIncidentOnCallRules,
      reason: hasIncidentOnCallRules ? "" : "Not configured for incident on-call duties",
    };
  }

  private static async checkHasAlertOnCallRules(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    // Check if user has any on-call duty policy overrides
    const userOverrides = await OnCallDutyPolicyUserOverrideService.findBy({
      query: {
        overrideUserId: userId,
        projectId: projectId,
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

    const hasAlertOnCallRules = userOverrides.length > 0;
    return {
      compliant: hasAlertOnCallRules,
      reason: hasAlertOnCallRules ? "" : "Not configured for alert on-call duties",
    };
  }
}