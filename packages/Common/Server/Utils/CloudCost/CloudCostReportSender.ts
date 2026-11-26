import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import CloudCostReport from "../../../Models/DatabaseModels/CloudCostReport";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import {
  CLOUD_COST_REPORT_MAX_PEOPLE,
  CloudCostReportContent,
  CloudCostReportScope,
  CloudCostReportSkipReason,
} from "../../../Types/Cloud/CloudCostReport";
import {
  CloudCostReportText,
  CloudCostReportTextRow,
  CloudCostReportTextSection,
  REPORT_CSV_ATTACHED,
  REPORT_GROUP_SECTION,
  REPORT_WHY_ADDRESS,
  REPORT_WHY_GROUP,
  REPORT_WHY_MEMBER,
  writeCloudCostReport,
} from "../../../Types/Cloud/CloudCostReportWords";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import { EmailAttachment } from "../../../Types/Email/EmailAttachment";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { Translator } from "../../../Types/Translator";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import DatabaseConfig from "../../DatabaseConfig";
import AccessTokenService from "../../Services/AccessTokenService";
import CloudCostGroupService from "../../Services/CloudCostGroupService";
import CloudCostReportService, {
  Service as CloudCostReportServiceClass,
} from "../../Services/CloudCostReportService";
import MailService from "../../Services/MailService";
import ProjectService from "../../Services/ProjectService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import UserService from "../../Services/UserService";
import WorkspaceNotificationSummaryService, {
  MicrosoftTeamsTeamOfSummary,
  Service as WorkspaceNotificationSummaryServiceClass,
  WorkspaceSummaryChannelResult,
} from "../../Services/WorkspaceNotificationSummaryService";
import logger from "../Logger";
import UserLanguage from "../Notification/UserLanguage";
import CallerPermission from "../Permission/CallerPermission";
import { writeInLanguage } from "../ServerTranslation";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceUtil from "../Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../Workspace/WorkspaceBase";
import CloudCostReportBuilder from "./CloudCostReportBuilder";

/*
 * SENDING A SCHEDULED COST REPORT (#11009).
 *
 * Each person a report goes to - named on it, a member of a team named on
 * it, or a member of a cost group's team when a cost view's report sends
 * each group its section - gets it read with their own permissions, so it
 * holds only what they may read, and through their own notification
 * settings (SEND_CLOUD_COST_REPORT_NOTIFICATION): by email, with its CSV,
 * unless they choose otherwise. Someone who has left the project, or may
 * not read its cloud costs, gets nothing, and the report says so.
 *
 * Addresses outside the project and Slack and Microsoft Teams channels get
 * it read as the Cloud admin who set them (outsideRecipientsSetByUserId),
 * while that person may still send a report outside the project: an email
 * to each address (with the CSV), and a short message in each channel with
 * the total, its change and the way to Costs on the report's days.
 *
 * One person's failure is nobody else's: what was sent and what was not is
 * the send's result (CloudCostReportSendResult), kept on the report.
 */

export interface CloudCostReportSkip {
  // Who was left out: a person's name or email, an address, a channel.
  who: string;
  // Why, as a code the Reports page words (CloudCostReportSkipReason).
  reason: CloudCostReportSkipReason;
  // A channel's workspace's own words for it, when it said why.
  detail?: string | undefined;
}

export interface CloudCostReportSendResult {
  sentAt: string;
  // The days it covered.
  start?: string | undefined;
  lastDay?: string | undefined;
  people: number;
  groupSections: number;
  addresses: number;
  channels: number;
  skipped: Array<CloudCostReportSkip>;
  errors: Array<string>;
}

// Whether a send reached anyone.
export function isCloudCostReportDelivered(
  result: CloudCostReportSendResult,
): boolean {
  return (
    result.people + result.groupSections + result.addresses + result.channels >
    0
  );
}

interface Audience {
  user: User;
  // A cost view's group whose section the person is sent, alone.
  groupId?: ObjectID | undefined;
  groupName?: string | undefined;
}

const REPORT_SELECT: Record<string, unknown> = {
  _id: true,
  projectId: true,
  name: true,
  isEnabled: true,
  scope: true,
  cloudAccountId: true,
  cloudCostViewId: true,
  cloudCostGroupId: true,
  period: true,
  costBasis: true,
  isSentToGroupTeams: true,
  emailAddresses: true,
  slackChannelNames: true,
  microsoftTeamsChannelNames: true,
  microsoftTeamsTeamName: true,
  outsideRecipientsSetByUserId: true,
  recurringInterval: true,
  sendFirstReportAt: true,
  timezone: true,
  nextSendAt: true,
  createdByUserId: true,
  recipientUsers: { _id: true },
  recipientTeams: { _id: true },
};

function toBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export class CloudCostReportSender {
  public static async loadReport(
    reportId: ObjectID,
  ): Promise<CloudCostReport | null> {
    return await CloudCostReportService.findOneById({
      id: reportId,
      select: REPORT_SELECT as never,
      props: { isRoot: true },
    });
  }

  /*
   * Whether a person may be sent the report's figures: a member of its
   * project who may read its cloud costs, by the check their own reads go
   * through.
   */
  public static mayReadCosts(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): boolean {
    return (
      CallerPermission.isProjectMember(props, projectId) &&
      CallerPermission.holdsAnyOf(
        props,
        new CloudCost().getReadPermissions(),
        { projectId },
      )
    );
  }

  /*
   * Two people whose permissions in the project are the same read the same
   * figures: their report is worked out once.
   */
  public static getAccessKey(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): string {
    return JSON.stringify(
      props.userTenantAccessPermission?.[projectId.toString()]?.permissions ||
        [],
    );
  }

  /*
   * Sends the report: to everyone it names, or - for Send Me a Copy - to
   * one person alone, as they may read it. Never throws for one person's
   * or one channel's failure: the result says what became of each.
   */
  @CaptureSpan()
  public static async send(data: {
    reportId: ObjectID;
    at: Date;
    onlyToUserId?: ObjectID | undefined;
  }): Promise<CloudCostReportSendResult> {
    const result: CloudCostReportSendResult = {
      sentAt: data.at.toISOString(),
      people: 0,
      groupSections: 0,
      addresses: 0,
      channels: 0,
      skipped: [],
      errors: [],
    };

    const report: CloudCostReport | null = await this.loadReport(data.reportId);

    if (!report?.id || !report.projectId) {
      result.errors.push("The report was not found.");
      return result;
    }

    const projectId: ObjectID = report.projectId;
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { name: true },
      props: { isRoot: true },
    });
    const projectName: string = project?.name || "";
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
    const { window } = CloudCostReportBuilder.getWindows(report, data.at);

    result.start = window.start.toISOString().slice(0, 10);
    result.lastDay = window.lastDay.toISOString().slice(0, 10);

    const audiences: Array<Audience> = data.onlyToUserId
      ? await this.getUsers([data.onlyToUserId])
          .then((users: Array<User>): Array<Audience> => {
            return users.map((user: User): Audience => {
              return { user };
            });
          })
      : await this.getAudiences(report, result);

    // Each version of the report, once: by who may read what, and section.
    const built: Map<string, Promise<CloudCostReportContent>> = new Map();
    const buildFor: (data: {
      props: DatabaseCommonInteractionProps;
      groupId?: ObjectID | undefined;
    }) => Promise<CloudCostReportContent> = (build: {
      props: DatabaseCommonInteractionProps;
      groupId?: ObjectID | undefined;
    }): Promise<CloudCostReportContent> => {
      const key: string = `${this.getAccessKey(build.props, projectId)}|${
        build.groupId?.toString() || ""
      }`;
      let content: Promise<CloudCostReportContent> | undefined = built.get(key);

      if (!content) {
        content = CloudCostReportBuilder.build({
          report,
          projectId,
          projectName,
          props: build.props,
          at: data.at,
          groupId: build.groupId,
          dashboardUrl,
        });
        built.set(key, content);
      }

      return content;
    };

    for (const audience of audiences) {
      const who: string = audience.user.name?.toString() ||
        audience.user.email?.toString() ||
        audience.user.id?.toString() ||
        "";

      try {
        const props: DatabaseCommonInteractionProps =
          await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
            { userId: audience.user.id!, projectId },
          );

        if (!this.mayReadCosts(props, projectId)) {
          result.skipped.push({
            who,
            reason: CloudCostReportSkipReason.MayNotRead,
          });
          continue;
        }

        const content: CloudCostReportContent = await buildFor({
          props,
          groupId: audience.groupId,
        });

        await this.sendToPerson({
          report,
          projectId,
          projectName,
          user: audience.user,
          content,
          groupName: audience.groupName,
        });

        if (audience.groupId) {
          result.groupSections++;
        } else {
          result.people++;
        }
      } catch (error) {
        logger.error(
          `Cloud cost report ${report.id.toString()} could not be sent to user ${audience.user.id?.toString()}:`,
        );
        logger.error(error);
        result.errors.push(`${who}: ${(error as Error).message || error}`);
      }
    }

    if (!data.onlyToUserId) {
      await this.sendOutside({ report, projectId, projectName, buildFor, result });
    }

    return result;
  }

  /*
   * What the report says now, read as one person may read it: what the
   * Reports page previews, and what Send Me a Copy sends.
   */
  public static async readFor(data: {
    reportId: ObjectID;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    at: Date;
  }): Promise<CloudCostReportContent> {
    const report: CloudCostReport | null = await this.loadReport(data.reportId);

    if (!report?.id || report.projectId?.toString() !== data.projectId.toString()) {
      throw new BadDataException(
        "This report was not found. It may have been deleted.",
      );
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { name: true },
      props: { isRoot: true },
    });

    return await CloudCostReportBuilder.build({
      report,
      projectId: data.projectId,
      projectName: project?.name || "",
      props: data.props,
      at: data.at,
      dashboardUrl: await DatabaseConfig.getDashboardUrl(),
    });
  }

  /*
   * Send Me a Copy: the report as the person may read it, now, to the
   * address they sign in with - whatever their notification settings say,
   * since they asked for it.
   */
  @CaptureSpan()
  public static async sendCopy(data: {
    reportId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    at: Date;
  }): Promise<{ email: string }> {
    const user: User | null = await this.getUser(data.userId);

    if (!user?.email) {
      throw new BadDataException(
        "Your account has no email address to send the copy to.",
      );
    }

    const content: CloudCostReportContent = await this.readFor(data);
    const language: string = await UserLanguage.getLanguage(data.userId);
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { name: true },
      props: { isRoot: true },
    });
    const written: {
      text: CloudCostReportText;
      why: string;
      translator: Translator;
    } = writeInLanguage(language, (translator: Translator) => {
      return {
        text: writeCloudCostReport({ content, translator }),
        why: translator.translateTemplate(REPORT_WHY_MEMBER, {
          project: project?.name || "",
        }),
        translator,
      };
    });

    await MailService.sendMail(
      {
        ...this.getEmail({
          content,
          text: written.text,
          translator: written.translator,
          why: written.why,
          language,
        }),
        toEmail: new Email(user.email.toString()),
      },
      { projectId: data.projectId, userId: data.userId },
    );

    return { email: user.email.toString() };
  }

  // People by their IDs, with what a send needs of them.
  private static async getUsers(
    userIds: Array<ObjectID>,
  ): Promise<Array<User>> {
    const users: Array<User> = [];

    for (const userId of userIds) {
      const user: User | null = await this.getUser(userId);

      if (user) {
        users.push(user);
      }
    }

    return users;
  }

  private static async getUser(userId: ObjectID): Promise<User | null> {
    return await UserService.findOneById({
      id: userId,
      select: { _id: true, name: true, email: true, timezone: true },
      props: { isRoot: true },
    });
  }

  /*
   * Everyone the report goes to, each once: the people it names and the
   * members of the teams it names, then - for a cost view's report that
   * sends each group its section - the members of each group's team who
   * are not sent the whole report already. No more than a report reaches.
   */
  public static async getAudiences(
    report: CloudCostReport,
    result: CloudCostReportSendResult,
  ): Promise<Array<Audience>> {
    const audiences: Array<Audience> = [];
    const seen: Set<string> = new Set();
    const add: (audience: Audience) => void = (audience: Audience): void => {
      const key: string = audience.user.id?.toString() || "";

      if (!key || seen.has(key)) {
        return;
      }

      if (audiences.length >= CLOUD_COST_REPORT_MAX_PEOPLE) {
        result.skipped.push({
          who: audience.user.email?.toString() || key,
          reason: CloudCostReportSkipReason.TooManyPeople,
        });
        return;
      }

      seen.add(key);
      audiences.push(audience);
    };

    for (const user of await this.getUsers(
      (report.recipientUsers || [])
        .map((user: User): ObjectID | undefined => {
          return user.id || undefined;
        })
        .filter((id: ObjectID | undefined): boolean => {
          return Boolean(id);
        }) as Array<ObjectID>,
    )) {
      add({ user });
    }

    const teamIds: Array<ObjectID> = (report.recipientTeams || [])
      .map((team: Team): ObjectID | undefined => {
        return team.id || undefined;
      })
      .filter((id: ObjectID | undefined): boolean => {
        return Boolean(id);
      }) as Array<ObjectID>;

    if (teamIds.length > 0) {
      for (const user of await TeamMemberService.getUsersInTeams(teamIds, {
        acceptedOnly: true,
      })) {
        add({ user });
      }
    }

    if (
      report.scope === CloudCostReportScope.CostView &&
      report.isSentToGroupTeams &&
      report.cloudCostViewId
    ) {
      const groups: Array<CloudCostGroup> = await CloudCostGroupService.findBy({
        query: {
          projectId: report.projectId!,
          cloudCostViewId: report.cloudCostViewId,
        },
        select: { _id: true, name: true, teamId: true, isShared: true },
        skip: 0,
        limit: 500,
        props: { isRoot: true },
      });

      for (const group of groups) {
        if (!group.teamId || !group.id || group.isShared) {
          continue;
        }

        for (const user of await TeamMemberService.getUsersInTeams(
          [group.teamId],
          { acceptedOnly: true },
        )) {
          add({
            user,
            groupId: group.id,
            groupName: group.name || "",
          });
        }
      }
    }

    return audiences;
  }

  // The email a report goes out as, in the reader's words.
  public static getEmail(data: {
    content: CloudCostReportContent;
    text: CloudCostReportText;
    translator: Translator;
    why: string;
    language: string;
  }): EmailEnvelope {
    const attachments: Array<EmailAttachment> = data.content.csv
      ? [
          {
            fileName: data.content.csvFileName,
            mimeType: "text/csv",
            contentBase64: toBase64(data.content.csv),
          },
        ]
      : [];
    const report: JSONObject = {
      title: data.text.title,
      lead: data.text.lead,
      totalLabel: data.text.totalLabel,
      total: data.text.total,
      change: data.text.change || "",
      changeTone: data.text.changeTone,
      previous: data.text.previous,
      stats: data.text.stats.map((stat: CloudCostReportText["stats"][number]) => {
        return { label: stat.label, value: stat.value, hint: stat.hint || "" };
      }),
      hasStats: data.text.stats.length > 0,
      sections: data.text.sections.map(
        (section: CloudCostReportTextSection): JSONObject => {
          return {
            title: section.title,
            rows: section.rows.map((row: CloudCostReportTextRow): JSONObject => {
              return {
                name: row.name,
                value: row.value,
                hint: row.hint || "",
                isUp: row.tone === "up",
                isDown: row.tone === "down",
              };
            }),
          };
        },
      ),
      notes: [
        ...data.text.notes,
        ...(attachments.length > 0
          ? [
              data.translator.translateText(REPORT_CSV_ATTACHED) ||
                REPORT_CSV_ATTACHED,
            ]
          : []),
      ],
      buttonText: data.text.buttonText,
      why: data.why,
    };

    return {
      templateType: EmailTemplateType.CloudCostReport,
      vars: {
        report,
        costsUrl: data.text.costsUrl,
        reportName: data.text.title,
      },
      subject: data.text.subject,
      isSubjectLiteral: true,
      language: data.language,
      attachments,
    };
  }

  private static async sendToPerson(data: {
    report: CloudCostReport;
    projectId: ObjectID;
    projectName: string;
    user: User;
    content: CloudCostReportContent;
    groupName?: string | undefined;
  }): Promise<void> {
    const language: string = await UserLanguage.getLanguage(data.user.id);
    const { text, why, translator } = writeInLanguage(
      language,
      (
        translator: Translator,
      ): { text: CloudCostReportText; why: string; translator: Translator } => {
        const written: CloudCostReportText = writeCloudCostReport({
          content: data.content,
          translator,
        });

        if (data.groupName) {
          written.lead = `${translator.translateTemplate(REPORT_GROUP_SECTION, {
            name: data.groupName,
            report: data.content.reportName,
          })} ${written.lead}`;
        }

        return {
          text: written,
          why: data.groupName
            ? translator.translateTemplate(REPORT_WHY_GROUP, {
                name: data.groupName,
                project: data.projectName,
              })
            : translator.translateTemplate(REPORT_WHY_MEMBER, {
                project: data.projectName,
              }),
          translator,
        };
      },
    );

    await UserNotificationSettingService.addCloudCostReportNotificationSettings(
      data.user.id!,
      data.projectId,
    );

    const sms: SMSMessage = {
      message: `${text.shortText} ${text.costsUrl}`,
    };
    const call: CallRequestMessage = {
      data: [{ sayMessage: text.shortText }],
    };
    const push: PushNotificationMessage = {
      title: text.title,
      body: text.shortText,
      url: text.costsUrl,
      clickAction: text.costsUrl,
      tag: `cloud-cost-report-${data.report.id?.toString() || ""}`,
    };

    await UserNotificationSettingService.sendUserNotification({
      userId: data.user.id!,
      projectId: data.projectId,
      eventType: NotificationSettingEventType.SEND_CLOUD_COST_REPORT_NOTIFICATION,
      emailEnvelope: this.getEmail({
        content: data.content,
        text,
        translator,
        why,
        language,
      }),
      smsMessage: sms,
      callRequestMessage: call,
      pushNotificationMessage: push,
    });
  }

  /*
   * The addresses outside the project and the channels, read as the Cloud
   * admin who set them - while they may still send a report outside it.
   */
  private static async sendOutside(data: {
    report: CloudCostReport;
    projectId: ObjectID;
    projectName: string;
    buildFor: (build: {
      props: DatabaseCommonInteractionProps;
      groupId?: ObjectID | undefined;
    }) => Promise<CloudCostReportContent>;
    result: CloudCostReportSendResult;
  }): Promise<void> {
    const report: CloudCostReport = data.report;
    const addresses: Array<string> = report.emailAddresses || [];
    const slackChannels: Array<string> = report.slackChannelNames || [];
    const teamsChannels: Array<string> = report.microsoftTeamsChannelNames || [];

    if (
      addresses.length === 0 &&
      slackChannels.length === 0 &&
      teamsChannels.length === 0
    ) {
      return;
    }

    const everyone: Array<string> = [
      ...addresses,
      ...slackChannels,
      ...teamsChannels,
    ];
    const skipAll: (reason: CloudCostReportSkipReason) => void = (
      reason: CloudCostReportSkipReason,
    ): void => {
      for (const who of everyone) {
        data.result.skipped.push({ who, reason });
      }
    };

    if (!report.outsideRecipientsSetByUserId) {
      skipAll(CloudCostReportSkipReason.NoOutsideSetter);
      return;
    }

    const props: DatabaseCommonInteractionProps =
      await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
        {
          userId: report.outsideRecipientsSetByUserId,
          projectId: data.projectId,
        },
      );

    if (
      !CallerPermission.isProjectMember(props, data.projectId) ||
      !CloudCostReportServiceClass.maySendOutside(props, data.projectId) ||
      !this.mayReadCosts(props, data.projectId)
    ) {
      skipAll(CloudCostReportSkipReason.OutsideSetterMayNot);
      return;
    }

    let content: CloudCostReportContent;

    try {
      content = await data.buildFor({ props });
    } catch (error) {
      logger.error(error);
      data.result.errors.push(
        `The report for its addresses and channels could not be read: ${(error as Error).message || error}`,
      );
      return;
    }

    const language: string = await UserLanguage.getLanguage(
      report.outsideRecipientsSetByUserId,
    );

    const written: {
      text: CloudCostReportText;
      why: string;
      translator: Translator;
    } = writeInLanguage(language, (translator: Translator) => {
      return {
        text: writeCloudCostReport({ content, translator }),
        why: translator.translateTemplate(REPORT_WHY_ADDRESS, {
          project: data.projectName,
        }),
        translator,
      };
    });

    for (const address of addresses) {
      try {
        await MailService.sendMail(
          {
            ...this.getEmail({
              content,
              text: written.text,
              translator: written.translator,
              why: written.why,
              language,
            }),
            toEmail: new Email(address),
          },
          { projectId: data.projectId },
        );
        data.result.addresses++;
      } catch (error) {
        logger.error(error);
        data.result.errors.push(`${address}: ${(error as Error).message || error}`);
      }
    }

    const blocks: Array<WorkspaceMessageBlock> = this.getChatBlocks(written.text);

    for (const channelName of slackChannels) {
      await this.postInChannel({
        projectId: data.projectId,
        channelName,
        workspaceType: WorkspaceType.Slack,
        blocks,
        text: written.text.shortText,
        teamId: undefined,
        result: data.result,
      });
    }

    if (teamsChannels.length > 0) {
      const team: MicrosoftTeamsTeamOfSummary =
        await (
          WorkspaceNotificationSummaryService as WorkspaceNotificationSummaryServiceClass
        ).getMicrosoftTeamsTeamOfSummary({
          projectId: data.projectId,
          teamName: report.microsoftTeamsTeamName || "",
        } as unknown as WorkspaceNotificationSummary);

      for (const channelName of teamsChannels) {
        if (!team.teamId) {
          data.result.skipped.push({
            who: channelName,
            reason: CloudCostReportSkipReason.TeamsTeamUnknown,
            detail: team.notPostedReason,
          });
          continue;
        }

        await this.postInChannel({
          projectId: data.projectId,
          channelName,
          workspaceType: WorkspaceType.MicrosoftTeams,
          blocks,
          text: written.text.shortText,
          teamId: team.teamId,
          result: data.result,
        });
      }
    }
  }

  // The short message a channel is sent: the total, its change, and Costs.
  public static getChatBlocks(
    text: CloudCostReportText,
  ): Array<WorkspaceMessageBlock> {
    return [
      { _type: "WorkspacePayloadHeader", text: text.title } as WorkspaceMessageBlock,
      {
        _type: "WorkspacePayloadMarkdown",
        text: text.chatLines.join("\n"),
      } as WorkspaceMessageBlock,
      {
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: text.buttonText,
            value: "open-cloud-costs",
            actionId: "open-cloud-costs",
            url: URL.fromString(text.costsUrl),
            isPrimary: true,
          },
        ],
      } as WorkspaceMessageBlock,
    ];
  }

  private static async postInChannel(data: {
    projectId: ObjectID;
    channelName: string;
    workspaceType: WorkspaceType;
    blocks: Array<WorkspaceMessageBlock>;
    text: string;
    teamId: string | undefined;
    result: CloudCostReportSendResult;
  }): Promise<void> {
    try {
      const payload: WorkspaceMessagePayload = {
        _type: "WorkspaceMessagePayload",
        channelNames: [data.channelName],
        channelIds: [],
        messageBlocks: data.blocks,
        workspaceType: data.workspaceType,
        teamId: data.teamId,
        text: data.text,
      };
      const responses: Array<WorkspaceSendMessageResponse> =
        await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
          projectId: data.projectId,
          messagePayloadsByWorkspace: [payload],
        });
      const posted: WorkspaceSummaryChannelResult =
        WorkspaceNotificationSummaryServiceClass.getChannelResult({
          channelName: data.channelName,
          workspaceType: data.workspaceType,
          responses,
        });

      if (posted.isPosted) {
        data.result.channels++;
      } else {
        data.result.skipped.push({
          who: data.channelName,
          reason: CloudCostReportSkipReason.NotPosted,
          detail: posted.reason,
        });
      }
    } catch (error) {
      logger.error(error);
      data.result.errors.push(
        `${data.channelName}: ${(error as Error).message || error}`,
      );
    }
  }
}

export default CloudCostReportSender;
