import DatabaseConfig from "../DatabaseConfig";
import BaseService from "./BaseService";
import MailService from "./MailService";
import OnCallDutyPolicyOwnerTeamService from "./OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "./OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ProjectService from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import UserService from "./UserService";
import InProcessMemo from "../Utils/InProcessMemo";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import URL from "../../Types/API/URL";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import OnCallDutyPolicyOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";

/**
 * What the paging path observed when it could not route a page the normal way.
 *
 * `fallbackChannelsUsed` is the whole story in one field: a non-empty array means the
 * fallback reached the responder on those channels and this is a "your configuration is
 * wrong, but nobody was dropped" warning; an empty array means the page was NOT delivered
 * to this responder at all and this is the last-resort alert that somebody has to read.
 */
export interface UndeliverablePageNotificationData {
  projectId: ObjectID;
  userId: ObjectID;
  ruleType: NotificationRuleType;
  /** Human-readable severity ("Sev4"), used verbatim in the copy. Escaped before interpolation. */
  severityName: string;
  /** The policy that was executing, when known. Its owners are the closest thing to a responsible party. */
  onCallDutyPolicyId?: ObjectID | undefined;
  /** Channel names the fallback actually used, e.g. ["Email", "Push"]. Empty means nothing was delivered. */
  fallbackChannelsUsed: Array<string>;
}

/*
 * One notification per (projectId, userId, ruleType) per 24 hours.
 *
 * The trigger for this service is an on-call page, and pages arrive in storms: a single
 * bad deploy can execute the same policy against the same responder hundreds of times in
 * an hour, and every one of those executions takes exactly the same "no matching rule"
 * branch. Without a window the fix for silent page loss would be a mail storm, which is
 * the same failure wearing better clothes — nobody reads the two hundredth copy either.
 */
const NOTIFICATION_WINDOW_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * Bounded so a large install cannot turn the throttle into a memory leak: the keys are
 * (project, user, ruleType) triples and a busy install has a lot of them. Eviction is
 * oldest-first, and an evicted key simply means one extra email — the durable project
 * flag below still catches the common case.
 */
const THROTTLE_MAX_ENTRIES: number = 10_000;

export class OnCallNotificationAlertingService extends BaseService {
  /*
   * The fine-grained half of the throttle: exact (projectId, userId, ruleType) semantics,
   * but only within one process.
   *
   * The durable half is Project.onCallFallbackUsedNotificationSentToOwners. A boolean
   * column cannot record WHEN it was set, so it cannot express a 24h window on its own —
   * it can only say "the owners have been told and nothing has cleared the flag yet".
   * The two are combined in shouldNotifyOwners below, and the combination is deliberately
   * biased towards sending: this whole phase exists because pages were being lost
   * silently, and an extra owner email is a much cheaper mistake than a missed one.
   */
  private ownerNotificationThrottle: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: NOTIFICATION_WINDOW_IN_MS,
      maxEntries: THROTTLE_MAX_ENTRIES,
    });

  /*
   * The user-facing mail has no durable flag of its own by design. Constraint: the new
   * project column throttles the OWNER mail, and reusing it here would let one responder's
   * quiet period suppress the owners' alert (and vice versa). A per-process window is
   * enough for the user mail because duplicates land in one person's inbox where they are
   * self-evidently the same message, rather than fanning out across every project owner.
   */
  private userNotificationThrottle: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: NOTIFICATION_WINDOW_IN_MS,
      maxEntries: THROTTLE_MAX_ENTRIES,
    });

  /**
   * Tell the people who can fix it that a page either fell back to a channel nobody chose,
   * or could not be delivered at all.
   *
   * Two audiences, notified independently so a failure to reach one never suppresses the
   * other:
   *  - the on-call policy's owners, falling back to the project's owners — they own the
   *    configuration that is wrong;
   *  - the responder themselves — they own the notification rules that are missing.
   *
   * This never throws. It is called from the on-call delivery path, where an exception
   * raised while explaining a delivery problem would turn a degraded page into a lost one.
   * Every failure is logged instead.
   */
  @CaptureSpan()
  public async notifyOfUndeliverablePage(
    data: UndeliverablePageNotificationData,
  ): Promise<void> {
    try {
      if (!data.projectId || !data.userId) {
        logger.error(
          "OnCallNotificationAlertingService.notifyOfUndeliverablePage called without a projectId or userId. Nobody can be told about this undeliverable page.",
        );
        return;
      }

      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          name: true,
          onCallFallbackUsedNotificationSentToOwners: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!project) {
        logger.error(
          `OnCallNotificationAlertingService: project ${data.projectId.toString()} not found, so nobody can be told that a page to user ${data.userId.toString()} was undeliverable.`,
        );
        return;
      }

      const user: User | null = await UserService.findOneById({
        id: data.userId,
        select: {
          _id: true,
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!user) {
        logger.error(
          `OnCallNotificationAlertingService: user ${data.userId.toString()} not found while reporting an undeliverable page in project ${data.projectId.toString()}.`,
        );
        return;
      }

      /*
       * Owners first. The responder is by definition the person whose notification setup
       * just failed to reach them, so they are the LESS reliable of the two audiences —
       * if the fallback delivered nothing, the user mail below may well go nowhere either.
       *
       * Each audience gets its own try/catch. A DB error while resolving the policy's
       * owners says nothing about whether the responder can be emailed, and letting it
       * cancel the second notification would make one broken lookup silence both halves
       * of the alert.
       */
      try {
        await this.notifyOwners({
          data: data,
          project: project,
          user: user,
        });
      } catch (err: unknown) {
        logger.error(
          `OnCallNotificationAlertingService: failed to notify the owners of an undeliverable page in project ${data.projectId.toString()}.`,
        );
        logger.error(err);
      }

      try {
        await this.notifyAffectedUser({
          data: data,
          project: project,
          user: user,
        });
      } catch (err: unknown) {
        logger.error(
          `OnCallNotificationAlertingService: failed to notify user ${data.userId.toString()} that their page in project ${data.projectId.toString()} was undeliverable.`,
        );
        logger.error(err);
      }
    } catch (err: unknown) {
      logger.error(
        "OnCallNotificationAlertingService.notifyOfUndeliverablePage failed. The page itself is unaffected; only the explanation was lost.",
      );
      logger.error(err);
    }
  }

  /*
   * Policy owners, then project owners. Not both: the policy owners are the specific,
   * accountable audience, and mailing the whole ownership chain on every fallback is how
   * owner notifications get filtered into a folder nobody opens.
   */
  private async notifyOwners(input: {
    data: UndeliverablePageNotificationData;
    project: Project;
    user: User;
  }): Promise<void> {
    const { data, project, user } = input;

    const throttleKey: string = this.getThrottleKey(data);

    const shouldNotify: boolean = await this.shouldNotifyOwners({
      project: project,
      throttleKey: throttleKey,
    });

    if (!shouldNotify) {
      logger.debug(
        `OnCallNotificationAlertingService: owner notification for ${throttleKey} suppressed by the ${NOTIFICATION_WINDOW_IN_MS / (60 * 60 * 1000)}h throttle.`,
      );
      return;
    }

    const subject: string = this.getOwnerEmailSubject({
      data: data,
      project: project,
    });

    const message: string = await this.getOwnerEmailMessageHtml({
      data: data,
      project: project,
      user: user,
    });

    const policyOwners: Array<User> = await this.findOnCallDutyPolicyOwners(
      data.onCallDutyPolicyId,
    );

    if (policyOwners.length > 0) {
      for (const owner of policyOwners) {
        await this.sendSimpleMessage({
          toUser: owner,
          projectId: data.projectId,
          subject: subject,
          message: message,
        });
      }
    } else {
      /*
       * getOwners returns [] whenever no team in the project holds
       * Permission.ProjectOwner, and sendEmailToProjectOwners then returns without
       * sending anything and without saying so. That silence is exactly the failure mode
       * this service exists to remove, so the emptiness is checked here and logged loudly:
       * an install with no owner team is one where the last-resort alert has nowhere to
       * go, and that is worth an error line in the logs even though nothing is broken
       * from the code's point of view.
       *
       * The extra getOwners call this costs is deliberate. Re-implementing the send here
       * to avoid it would fork the owner-mail path, and this runs at most once per
       * (project, user, ruleType) per day.
       */
      const projectOwners: Array<User> = await ProjectService.getOwners(
        data.projectId,
      );

      if (projectOwners.length === 0) {
        logger.error(
          `OnCallNotificationAlertingService: project ${data.projectId.toString()} has no on-call policy owners and no project owners, so there is nobody to tell that a page to ${user.email?.toString() || data.userId.toString()} was undeliverable. Grant Permission.ProjectOwner to a team so alerts like this one have a destination.`,
        );

        /*
         * Throttled like a successful send so a page storm produces one loud line per
         * (project, user, ruleType) per day rather than one per page — an error nobody
         * can find in the noise is not better than the silence it replaced. The durable
         * project flag is deliberately left alone: nothing was sent, so "the owners have
         * been told" must stay false.
         */
        this.ownerNotificationThrottle.set(throttleKey, true);
        return;
      }

      await ProjectService.sendEmailToProjectOwners(
        data.projectId,
        subject,
        message,
      );
    }

    this.ownerNotificationThrottle.set(throttleKey, true);

    await this.setOwnerNotificationFlag(data.projectId, true);
  }

  /*
   * The throttle decision, split out because the interaction between the in-process window
   * and the durable flag is the subtle part of this service.
   */
  private async shouldNotifyOwners(input: {
    project: Project;
    throttleKey: string;
  }): Promise<boolean> {
    const { project, throttleKey } = input;

    if (this.ownerNotificationThrottle.get(throttleKey)) {
      // This process mailed the owners about this exact triple inside the window.
      return false;
    }

    if (project.onCallFallbackUsedNotificationSentToOwners) {
      /*
       * Another pod — or this one before a restart — already mailed the owners, and
       * nothing has cleared the flag since. The column cannot tell us whether that was
       * two minutes or two weeks ago, so there is no way to evaluate the window from it.
       *
       * Re-arm rather than guess. This page stays quiet (the owners did hear about the
       * problem at some point) and the very next undeliverable page gets through, which
       * means an install can never be permanently silenced by a latch nobody clears.
       * The in-process key is deliberately NOT stamped here: stamping it would suppress
       * that next page too, and a 24h silence after a pod restart is the one outcome this
       * phase must not produce.
       *
       * The cost is bounded and known: across N pods this can produce up to one owner
       * email per pod per triple per day instead of exactly one. That is the honest limit
       * of what a project-scoped boolean can enforce, and it errs in the safe direction.
       */
      await this.setOwnerNotificationFlag(project.id!, false);
      return false;
    }

    return true;
  }

  private async setOwnerNotificationFlag(
    projectId: ObjectID,
    value: boolean,
  ): Promise<void> {
    await ProjectService.updateOneById({
      id: projectId,
      data: {
        onCallFallbackUsedNotificationSentToOwners: value,
      },
      props: {
        isRoot: true,
      },
    });
  }

  private async notifyAffectedUser(input: {
    data: UndeliverablePageNotificationData;
    project: Project;
    user: User;
  }): Promise<void> {
    const { data, project, user } = input;

    if (!user.email) {
      logger.error(
        `OnCallNotificationAlertingService: user ${data.userId.toString()} has no account email, so they cannot be told that their page in project ${data.projectId.toString()} was undeliverable.`,
      );
      return;
    }

    const throttleKey: string = this.getThrottleKey(data);

    if (this.userNotificationThrottle.get(throttleKey)) {
      logger.debug(
        `OnCallNotificationAlertingService: user notification for ${throttleKey} suppressed by the ${NOTIFICATION_WINDOW_IN_MS / (60 * 60 * 1000)}h throttle.`,
      );
      return;
    }

    const projectName: string = project.name || "your project";
    const severity: string = data.severityName || "this severity";
    const eventLabel: string = this.getRuleTypeLabel(data.ruleType);

    const rulesLink: URL = await this.getNotificationRulesLinkInDashboard(
      data.projectId,
      data.ruleType,
    );

    const subject: string =
      data.fallbackChannelsUsed.length > 0
        ? `You were paged in ${projectName} without a notification rule`
        : `A page in ${projectName} could not reach you`;

    /*
     * Same raw-HTML rule as the owner message: SimpleMessage.hbs renders `message`
     * through a triple stache, so the project and severity names are escaped here. The
     * channel list is generated by the fallback (["Email", "Push"]) rather than by a user,
     * but it is escaped too so that stays safe if the fallback ever learns to name a
     * channel after a user-supplied label.
     */
    const escapedLink: string = this.escapeHtml(rulesLink.toString());

    const lines: Array<string> = [];

    if (data.fallbackChannelsUsed.length > 0) {
      lines.push(
        `You were paged for a ${this.escapeHtml(severity)} ${this.escapeHtml(eventLabel)} in ${this.escapeHtml(projectName)}, but you have no notification rule configured for it. We reached you on your verified ${this.escapeHtml(this.formatChannelList(data.fallbackChannelsUsed))} instead.`,
      );
      lines.push(
        `That fallback is a safety net, not a setting — it ignores everything you may have configured about how and when you want to be reached.`,
      );
      lines.push(
        `Set up a rule so future pages arrive the way you want them to: <a href="${escapedLink}">${escapedLink}</a>`,
      );
    } else {
      lines.push(
        `You were paged for a ${this.escapeHtml(severity)} ${this.escapeHtml(eventLabel)} in ${this.escapeHtml(projectName)} and we could not deliver it. You have no notification rule for it and no verified notification method to fall back on, so nothing was sent anywhere.`,
      );
      lines.push(
        `Until you add a verified notification method and a rule, every page routed to you is lost: <a href="${escapedLink}">${escapedLink}</a>`,
      );
    }

    await this.sendSimpleMessage({
      toUser: user,
      projectId: data.projectId,
      subject: subject,
      message: lines.join("<br/><br/>"),
    });

    this.userNotificationThrottle.set(throttleKey, true);
  }

  private getOwnerEmailSubject(input: {
    data: UndeliverablePageNotificationData;
    project: Project;
  }): string {
    const { data, project } = input;

    const projectName: string = project.name || "your project";

    /*
     * The subject is rendered through {{title}} in EmailTitle.hbs, which Handlebars
     * escapes, and is also used verbatim as the SMTP subject header. Escaping it here
     * would double-escape the first and corrupt the second, so raw values belong here and
     * escaped values belong in the message body only.
     */
    return data.fallbackChannelsUsed.length > 0
      ? `On-call fallback used in ${projectName}`
      : `A page in ${projectName} reached nobody`;
  }

  private async getOwnerEmailMessageHtml(input: {
    data: UndeliverablePageNotificationData;
    project: Project;
    user: User;
  }): Promise<string> {
    const { data, project, user } = input;

    /*
     * Everything below is interpolated into ProjectService.sendEmailToProjectOwners, which
     * hands `message` to SimpleMessage.hbs where InfoBlock renders it through a triple
     * stache ({{{info}}}) — i.e. as RAW HTML. User names, project names and severity names
     * are all user-controlled strings, so every one of them is escaped on the way in.
     */
    const projectName: string = this.escapeHtml(project.name || "your project");
    const userName: string = this.escapeHtml(
      user.name?.toString() || user.email?.toString() || "A responder",
    );
    const userEmail: string = this.escapeHtml(user.email?.toString() || "");
    const severity: string = this.escapeHtml(
      data.severityName || "this severity",
    );
    const eventLabel: string = this.escapeHtml(
      this.getRuleTypeLabel(data.ruleType),
    );

    const lines: Array<string> = [];

    if (data.fallbackChannelsUsed.length > 0) {
      lines.push(
        `${userName}${userEmail ? ` (${userEmail})` : ""} was paged for a ${severity} ${eventLabel} in ${projectName}, but has no notification rule configured for it.`,
      );
      lines.push(
        `The page was delivered on their verified ${this.escapeHtml(this.formatChannelList(data.fallbackChannelsUsed))} as a fallback, so nobody was dropped this time.`,
      );
    } else {
      lines.push(
        `${userName}${userEmail ? ` (${userEmail})` : ""} was paged for a ${severity} ${eventLabel} in ${projectName} and the page could not be delivered.`,
      );
      lines.push(
        `They have no notification rule for it and no verified notification method to fall back on, so this page reached them on no channel at all. If they are the only responder on this escalation level, it reached nobody.`,
      );
    }

    if (data.onCallDutyPolicyId) {
      const policyName: string | null =
        await OnCallDutyPolicyService.getOnCallDutyPolicyName({
          onCallDutyPolicyId: data.onCallDutyPolicyId,
        });

      const policyLink: URL =
        await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
          data.projectId,
          data.onCallDutyPolicyId,
        );

      lines.push(
        `On-call policy: <a href="${this.escapeHtml(policyLink.toString())}">${this.escapeHtml(policyName || "View policy")}</a>`,
      );
    }

    lines.push(
      `Ask them to add a rule for ${severity} ${eventLabel} in User Settings &gt; On-Call Rules, or remove them from the escalation level if they are not meant to be paged for it.`,
    );

    return lines.join("<br/><br/>");
  }

  /*
   * The policy's own owners: direct owner users, plus every member of an owner team.
   * Returns [] when no policy id was supplied, which is the caller's signal to fall back
   * to the project owners.
   */
  private async findOnCallDutyPolicyOwners(
    onCallDutyPolicyId: ObjectID | undefined,
  ): Promise<Array<User>> {
    if (!onCallDutyPolicyId) {
      return [];
    }

    const ownerUsers: Array<OnCallDutyPolicyOwnerUser> =
      await OnCallDutyPolicyOwnerUserService.findBy({
        query: {
          onCallDutyPolicyId: onCallDutyPolicyId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            name: true,
            email: true,
          },
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
          _id: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> = [];
    const seenUserIds: Set<string> = new Set<string>();

    const addUser: (user: User | undefined) => void = (
      user: User | undefined,
    ): void => {
      if (!user || !user.id || !user.email) {
        return;
      }

      const key: string = user.id.toString();

      if (seenUserIds.has(key)) {
        return;
      }

      seenUserIds.add(key);
      users.push(user);
    };

    for (const ownerUser of ownerUsers) {
      addUser(ownerUser.user);
    }

    const teamIds: Array<ObjectID> = [];

    for (const ownerTeam of ownerTeams) {
      if (ownerTeam.teamId) {
        teamIds.push(ownerTeam.teamId);
      }
    }

    if (teamIds.length > 0) {
      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        addUser(teamUser);
      }
    }

    return users;
  }

  private async sendSimpleMessage(input: {
    toUser: User;
    projectId: ObjectID;
    subject: string;
    message: string;
  }): Promise<void> {
    const { toUser, projectId, subject, message } = input;

    if (!toUser.email) {
      return;
    }

    const vars: Dictionary<string> = {
      subject: subject,
      message: message,
    };

    try {
      await MailService.sendMail(
        {
          toEmail: toUser.email,
          templateType: EmailTemplateType.SimpleMessage,
          vars: vars,
          subject: subject,
        },
        {
          projectId: projectId,
          userId: toUser.id!,
        },
      );
    } catch (err: unknown) {
      /*
       * Swallowed on purpose: one unreachable recipient must not stop the rest of the
       * owner list from hearing about a page that reached nobody.
       */
      logger.error(
        `OnCallNotificationAlertingService: failed to email ${toUser.email.toString()} about an undeliverable on-call page.`,
      );
      logger.error(err);
    }
  }

  private getThrottleKey(data: UndeliverablePageNotificationData): string {
    return `${data.projectId.toString()}:${data.userId.toString()}:${data.ruleType}`;
  }

  /*
   * NotificationRuleType's values are already English sentences ("When incident on-call
   * policy is executed"), which read badly mid-sentence. These are the noun forms.
   */
  private getRuleTypeLabel(ruleType: NotificationRuleType): string {
    switch (ruleType) {
      case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT:
        return "incident";
      case NotificationRuleType.ON_CALL_EXECUTED_ALERT:
        return "alert";
      case NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE:
        return "alert episode";
      case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE:
        return "incident episode";
      case NotificationRuleType.WHEN_USER_GOES_ON_CALL:
        return "on-call shift start";
      case NotificationRuleType.WHEN_USER_GOES_OFF_CALL:
        return "on-call shift end";
      default:
        return "on-call notification";
    }
  }

  /*
   * The four severity-scoped rule types each have their own settings page, and sending
   * someone to the wrong one is how a "fix your rules" email gets ignored. The two shift
   * rule types are configured on the incident page alongside everything else.
   *
   * These path segments mirror UserSettingsRoutePath in the Dashboard's RouteMap. They are
   * duplicated rather than imported because Common/Server cannot reach App sources — the
   * same reason OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard spells its
   * route out by hand.
   */
  private getUserSettingsPathForRuleType(
    ruleType: NotificationRuleType,
  ): string {
    switch (ruleType) {
      case NotificationRuleType.ON_CALL_EXECUTED_ALERT:
        return "alert-on-call-rules";
      case NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE:
        return "alert-episode-on-call-rules";
      case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE:
        return "incident-episode-on-call-rules";
      case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT:
      case NotificationRuleType.WHEN_USER_GOES_ON_CALL:
      case NotificationRuleType.WHEN_USER_GOES_OFF_CALL:
        return "incident-on-call-rules";
      default:
        return "notification-methods";
    }
  }

  private async getNotificationRulesLinkInDashboard(
    projectId: ObjectID,
    ruleType: NotificationRuleType,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/user-settings/${this.getUserSettingsPathForRuleType(ruleType)}`,
    );
  }

  private formatChannelList(channels: Array<string>): string {
    if (channels.length === 0) {
      return "";
    }

    if (channels.length === 1) {
      return channels[0]!;
    }

    return `${channels.slice(0, -1).join(", ")} and ${channels[channels.length - 1]!}`;
  }

  /*
   * ProjectService.sendEmailToProjectOwners hands `message` to a triple-stache Handlebars
   * partial, so nothing between here and the recipient's inbox escapes anything. This is
   * the only escaping in that path.
   */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

export default new OnCallNotificationAlertingService();
