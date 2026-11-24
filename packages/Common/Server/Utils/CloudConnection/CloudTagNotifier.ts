import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceOwnerTeam from "../../../Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "../../../Models/DatabaseModels/CloudResourceOwnerUser";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { getCloudProviderLabel } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudTagProblem,
  CloudTagSuggestionSource,
} from "../../../Types/Cloud/CloudRequiredTags";
import { getCloudResourceTypeDisplayName } from "../../../Types/Cloud/CloudResourceCatalog";
import { CloudTagMissingJSON } from "../../../Types/Cloud/CloudTagCoverage";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SafeHtml from "../../../Types/SafeHtml";
import DatabaseConfig from "../../DatabaseConfig";
import AccessTokenService from "../../Services/AccessTokenService";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateService from "../../Services/AlertStateService";
import CloudResourceOwnerTeamService from "../../Services/CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "../../Services/CloudResourceOwnerUserService";
import MailService from "../../Services/MailService";
import TeamMemberService from "../../Services/TeamMemberService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";

/*
 * TELLING PEOPLE ABOUT A NEW RESOURCE WITHOUT A REQUIRED TAG (#11012).
 *
 * Who is told, per resource:
 *
 *   - who created it, when its account's change log names a member of the
 *     project (CloudTagCreators);
 *   - its owners: the users and the members of the teams that own it
 *     (owner rules and teams);
 *   - with nobody of those, the project's owners: someone answers for a
 *     resource nobody owns.
 *
 * Each only when they may read the project's cloud resources: an email
 * names the resource, its account and its tags. Emails are English, as
 * every owner email is; one an hour lists everything new for its reader,
 * or - a project's choice - one for each resource (CloudTagSetting).
 *
 * An alert, when the project asks for one: one for each account a run
 * found new resources in, to the on-call policies it names, at its
 * severity (the project's least severe when it names none), never twice
 * for one account and hour (its fingerprint).
 */

// What the email and the alert say of one resource.
export interface CloudTagNotice {
  findingId: ObjectID;
  resourceId: ObjectID;
  resourceName: string;
  provider: string;
  type: string;
  accountRowId: ObjectID | null;
  accountName: string;
  creatorActor: string | null;
  creatorUserId: ObjectID | null;
  missing: Array<CloudTagMissingJSON>;
  declaredCode: string | null;
}

// A person told, with the resources told to them.
export interface CloudTagRecipient {
  userId: ObjectID;
  email: string;
  notices: Array<CloudTagNotice>;
}

// The most resources one email lists; the rest are on Cloud > Tags.
export const CLOUD_TAG_EMAIL_MAX_RESOURCES: number = 25;

const SUGGESTION_SOURCE_WORDS: Readonly<
  Record<CloudTagSuggestionSource, string>
> = {
  [CloudTagSuggestionSource.OwnerTeam]: "its owner team",
  [CloudTagSuggestionSource.Environment]: "its environment",
  [CloudTagSuggestionSource.Neighbours]: "the resources beside it",
  [CloudTagSuggestionSource.OnlyAllowedValue]: "the only value allowed",
};

function count(value: number, one: string, other: string): string {
  return `${value}${NO_BREAK_SPACE}${value === 1 ? one : other}`;
}

// What a resource is, in a line: "web-4 (EC2 Instance, AWS account prod)".
export function describeCloudTagResource(notice: CloudTagNotice): string {
  const type: string =
    getCloudResourceTypeDisplayName(notice.provider, notice.type) ||
    notice.type;
  const where: string = notice.accountName
    ? `${getCloudProviderLabel(notice.provider)} account ${notice.accountName}`
    : getCloudProviderLabel(notice.provider);

  return `${notice.resourceName} (${type}, ${where})`;
}

// What a resource lacks, in a line: "team (suggested: payments, from its owner team), env".
export function describeCloudTagMissing(
  missing: Array<CloudTagMissingJSON>,
): string {
  return missing
    .map((item: CloudTagMissingJSON): string => {
      const what: string =
        item.problem === CloudTagProblem.NotAllowed && item.value
          ? `${item.key} (has "${item.value}", which is not allowed)`
          : item.key;

      if (!item.suggestion) {
        return what;
      }

      return `${what}, suggested: ${item.suggestion.value} (from ${
        SUGGESTION_SOURCE_WORDS[item.suggestion.source]
      }${item.suggestion.detail ? `, ${item.suggestion.detail}` : ""})`;
    })
    .join("; ");
}

// The email's subject: the one resource it names, or how many.
export function getCloudTagEmailSubject(
  notices: Array<CloudTagNotice>,
): string {
  if (notices.length === 1) {
    return `A new cloud resource is missing required tags: ${notices[0]!.resourceName}`;
  }

  return `${count(notices.length, "new cloud resource is", "new cloud resources are")} missing required tags`;
}

// The email's body, as HTML: every value escaped.
export function getCloudTagEmailHtml(data: {
  notices: Array<CloudTagNotice>;
  tagsLink: URL | null;
}): string {
  const shown: Array<CloudTagNotice> = data.notices.slice(
    0,
    CLOUD_TAG_EMAIL_MAX_RESOURCES,
  );
  const paragraphs: Array<string> = [
    SafeHtml.escape(
      data.notices.length === 1
        ? "This cloud resource was created without the tags your project requires. Tag it, or the code that declares it, so what it costs is counted for the right team."
        : "These cloud resources were created without the tags your project requires. Tag each one, or the code that declares it, so what they cost is counted for the right team.",
    ),
  ];

  for (const notice of shown) {
    const lines: Array<string> = [
      `<b>${SafeHtml.escape(describeCloudTagResource(notice))}</b>`,
    ];

    if (notice.creatorActor) {
      lines.push(SafeHtml.escape(`Created by ${notice.creatorActor}.`));
    }

    lines.push(
      SafeHtml.escape(`Missing: ${describeCloudTagMissing(notice.missing)}.`),
    );

    if (notice.declaredCode) {
      lines.push(
        SafeHtml.escape(
          `Declared by ${notice.declaredCode}: add the tags there, or the next deploy takes them off again.`,
        ),
      );
    } else {
      for (const item of notice.missing) {
        if (item.command) {
          lines.push(
            `${SafeHtml.escape("To tag it:")} <code>${SafeHtml.escape(item.command)}</code>`,
          );
        }
      }
    }

    paragraphs.push(lines.join(" <br/> "));
  }

  if (data.notices.length > shown.length) {
    paragraphs.push(
      SafeHtml.escape(
        `And ${count(data.notices.length - shown.length, "more", "more")}.`,
      ),
    );
  }

  if (data.tagsLink) {
    const link: string = SafeHtml.escape(data.tagsLink.toString());

    paragraphs.push(
      `${SafeHtml.escape("Every resource without its tags is on Cloud, Tags:")} <br/> <a href="${link}">${link}</a>`,
    );
  }

  return paragraphs.join(" <br/><br/> ");
}

export default class CloudTagNotifier {
  // The users and the members of the teams that own each resource.
  private static async readOwners(data: {
    projectId: ObjectID;
    resourceIds: Array<ObjectID>;
  }): Promise<Map<string, Set<string>>> {
    const owners: Map<string, Set<string>> = new Map();
    const add: (resourceId: string, userId: string) => void = (
      resourceId: string,
      userId: string,
    ): void => {
      const users: Set<string> = owners.get(resourceId) || new Set<string>();
      users.add(userId);
      owners.set(resourceId, users);
    };

    if (data.resourceIds.length === 0) {
      return owners;
    }

    const [users, teams]: [
      Array<CloudResourceOwnerUser>,
      Array<CloudResourceOwnerTeam>,
    ] = await Promise.all([
      CloudResourceOwnerUserService.findBy({
        query: {
          projectId: data.projectId,
          cloudResourceId: QueryHelper.any(data.resourceIds),
        },
        select: { cloudResourceId: true, userId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      }),
      CloudResourceOwnerTeamService.findBy({
        query: {
          projectId: data.projectId,
          cloudResourceId: QueryHelper.any(data.resourceIds),
        },
        select: { cloudResourceId: true, teamId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      }),
    ]);

    for (const row of users) {
      if (row.cloudResourceId && row.userId) {
        add(row.cloudResourceId.toString(), row.userId.toString());
      }
    }

    const teamIds: Array<ObjectID> = Array.from(
      new Set(
        teams
          .map((row: CloudResourceOwnerTeam): string => {
            return row.teamId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    ).map((id: string): ObjectID => {
      return new ObjectID(id);
    });
    const members: Array<TeamMember> =
      teamIds.length > 0
        ? await TeamMemberService.findBy({
            query: {
              projectId: data.projectId,
              teamId: QueryHelper.any(teamIds),
              hasAcceptedInvitation: true,
            },
            select: { teamId: true, userId: true },
            skip: 0,
            limit: LIMIT_MAX,
            props: { isRoot: true },
          })
        : [];
    const membersOfTeam: Map<string, Array<string>> = new Map();

    for (const member of members) {
      const teamId: string = member.teamId?.toString() || "";
      const userId: string = member.userId?.toString() || "";

      if (teamId && userId) {
        membersOfTeam.set(teamId, [
          ...(membersOfTeam.get(teamId) || []),
          userId,
        ]);
      }
    }

    for (const row of teams) {
      const resourceId: string = row.cloudResourceId?.toString() || "";

      for (const userId of membersOfTeam.get(row.teamId?.toString() || "") ||
        []) {
        if (resourceId) {
          add(resourceId, userId);
        }
      }
    }

    return owners;
  }

  /*
   * The members who may be told: on the project, holding one of these
   * permissions (any, when none is named), and able to read its cloud
   * resources. Their email addresses, by user id.
   */
  private static async readTellable(data: {
    projectId: ObjectID;
    userIds?: Array<string> | undefined;
    mustHold?: Array<Permission> | undefined;
  }): Promise<Map<string, string>> {
    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        hasAcceptedInvitation: true,
        ...(data.userIds
          ? {
              userId: QueryHelper.any(
                data.userIds.map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
              ),
            }
          : {}),
      },
      select: { userId: true, user: { _id: true, email: true } },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    const tellable: Map<string, string> = new Map();
    const readPermissions: Array<Permission> =
      new CloudResource().getReadPermissions();

    for (const member of members) {
      const userId: string = member.userId?.toString() || "";
      const email: string = member.user?.email?.toString() || "";

      if (!userId || !email || tellable.has(userId)) {
        continue;
      }

      try {
        const props: DatabaseCommonInteractionProps =
          await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
            { userId: new ObjectID(userId), projectId: data.projectId },
          );

        if (
          CallerPermission.isProjectMember(props, data.projectId) &&
          CallerPermission.holdsAnyOf(props, readPermissions, {
            projectId: data.projectId,
          }) &&
          (!data.mustHold ||
            CallerPermission.holdsAnyOf(props, data.mustHold, {
              projectId: data.projectId,
            }))
        ) {
          tellable.set(userId, email);
        }
      } catch (error) {
        logger.error(
          `CloudTagNotifier: could not read user ${userId}'s permissions in project ${data.projectId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return tellable;
  }

  /*
   * Who is told of each resource, and what: its creator and owners who
   * may read the project's cloud resources, else the project's owners.
   */
  public static async getRecipients(data: {
    projectId: ObjectID;
    notices: Array<CloudTagNotice>;
  }): Promise<Array<CloudTagRecipient>> {
    const owners: Map<string, Set<string>> = await CloudTagNotifier.readOwners({
      projectId: data.projectId,
      resourceIds: data.notices.map((notice: CloudTagNotice): ObjectID => {
        return notice.resourceId;
      }),
    });
    const wanted: Map<string, Set<string>> = new Map();
    const everyone: Set<string> = new Set<string>();

    for (const notice of data.notices) {
      const users: Set<string> = new Set<string>(
        owners.get(notice.resourceId.toString()) || [],
      );

      if (notice.creatorUserId) {
        users.add(notice.creatorUserId.toString());
      }

      wanted.set(notice.findingId.toString(), users);

      for (const user of users) {
        everyone.add(user);
      }
    }

    const tellable: Map<string, string> =
      everyone.size > 0
        ? await CloudTagNotifier.readTellable({
            projectId: data.projectId,
            userIds: Array.from(everyone),
          })
        : new Map();
    let projectOwners: Map<string, string> | null = null;
    const byUser: Map<string, CloudTagRecipient> = new Map();

    for (const notice of data.notices) {
      let users: Array<string> = Array.from(
        wanted.get(notice.findingId.toString()) || [],
      ).filter((userId: string): boolean => {
        return tellable.has(userId);
      });
      let emails: Map<string, string> = tellable;

      // Nobody who made or owns it can be told: the project's owners are.
      if (users.length === 0) {
        if (!projectOwners) {
          projectOwners = await CloudTagNotifier.readTellable({
            projectId: data.projectId,
            mustHold: [Permission.ProjectOwner],
          });
        }

        users = Array.from(projectOwners.keys());
        emails = projectOwners;
      }

      for (const userId of users) {
        const email: string | undefined = emails.get(userId);

        if (!email) {
          continue;
        }

        const recipient: CloudTagRecipient = byUser.get(userId) || {
          userId: new ObjectID(userId),
          email,
          notices: [],
        };

        recipient.notices.push(notice);
        byUser.set(userId, recipient);
      }
    }

    return Array.from(byUser.values());
  }

  public static async getTagsLink(projectId: ObjectID): Promise<URL | null> {
    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

      return URL.fromString(dashboardUrl.toString()).addRoute(
        `/${projectId.toString()}/cloud/tags`,
      );
    } catch (error) {
      logger.error(error);
      return null;
    }
  }

  /*
   * Emails each recipient their resources: in one email, or - each
   * resource on its own - one email a resource. Returns the emails sent.
   */
  public static async email(data: {
    projectId: ObjectID;
    recipients: Array<CloudTagRecipient>;
    emailEachResource: boolean;
  }): Promise<number> {
    const tagsLink: URL | null = await CloudTagNotifier.getTagsLink(
      data.projectId,
    );
    let sent: number = 0;

    for (const recipient of data.recipients) {
      const batches: Array<Array<CloudTagNotice>> = data.emailEachResource
        ? recipient.notices.map((notice: CloudTagNotice) => {
            return [notice];
          })
        : [recipient.notices];

      for (const notices of batches) {
        if (notices.length === 0) {
          continue;
        }

        const subject: string = getCloudTagEmailSubject(notices);

        try {
          await MailService.sendMail(
            {
              toEmail: recipient.email as never,
              templateType: EmailTemplateType.SimpleMessage,
              vars: {
                subject,
                message: getCloudTagEmailHtml({ notices, tagsLink }),
              },
              subject,
              isSubjectLiteral: true,
            },
            { projectId: data.projectId, userId: recipient.userId },
          );
          sent++;
        } catch (error) {
          logger.error(
            `CloudTagNotifier: could not email user ${recipient.userId.toString()} of project ${data.projectId.toString()}:`,
          );
          logger.error(error);
        }
      }
    }

    return sent;
  }

  // The fingerprint of an account's alert for an hour: never raised twice.
  public static getAlertFingerprint(data: {
    accountRowId: string;
    now: Date;
  }): string {
    return `cloud-required-tags:${data.accountRowId}:${data.now
      .toISOString()
      .slice(0, 13)}`;
  }

  /*
   * One alert for each account of these resources, unless one of its
   * fingerprint is open already. Returns the alerts raised.
   */
  public static async raiseAlerts(data: {
    projectId: ObjectID;
    notices: Array<CloudTagNotice>;
    alertSeverityId: ObjectID | null;
    onCallDutyPolicyIds: Array<ObjectID>;
    now: Date;
  }): Promise<number> {
    const byAccount: Map<string, Array<CloudTagNotice>> = new Map();

    for (const notice of data.notices) {
      const key: string = notice.accountRowId?.toString() || "none";
      byAccount.set(key, [...(byAccount.get(key) || []), notice]);
    }

    let severityId: ObjectID | null = data.alertSeverityId;

    if (!severityId) {
      const severity: AlertSeverity | null =
        await AlertSeverityService.findOneBy({
          query: { projectId: data.projectId },
          select: { _id: true },
          sort: { order: SortOrder.Descending },
          props: { isRoot: true },
        });
      severityId = severity?.id || null;
    }

    if (!severityId) {
      logger.error(
        `CloudTagNotifier: project ${data.projectId.toString()} has no alert severity, so its alert could not be raised.`,
      );
      return 0;
    }

    let raised: number = 0;

    for (const [accountRowId, notices] of byAccount) {
      const fingerprint: string = CloudTagNotifier.getAlertFingerprint({
        accountRowId,
        now: data.now,
      });

      try {
        const open: Array<Alert> = await AlertService.findBy({
          query: {
            projectId: data.projectId,
            seriesFingerprint: fingerprint,
            currentAlertStateId: new Includes(
              await AlertStateService.getUnresolvedAlertStateIds(
                data.projectId,
              ),
            ),
          },
          select: { _id: true },
          skip: 0,
          limit: 1,
          props: { isRoot: true },
        });

        if (open.length > 0) {
          continue;
        }

        const accountName: string = notices[0]?.accountName || "";
        const alert: Alert = new Alert();
        alert.projectId = data.projectId;
        alert.title =
          notices.length === 1
            ? `A new cloud resource is missing required tags: ${notices[0]!.resourceName}`
            : `${count(notices.length, "new cloud resource is", "new cloud resources are")} missing required tags${accountName ? ` in ${accountName}` : ""}`;
        alert.description = notices
          .slice(0, CLOUD_TAG_EMAIL_MAX_RESOURCES)
          .map((notice: CloudTagNotice): string => {
            return `- ${describeCloudTagResource(notice)}${
              notice.creatorActor ? `, created by ${notice.creatorActor}` : ""
            }: missing ${describeCloudTagMissing(notice.missing)}.`;
          })
          .join("\n");
        alert.alertSeverityId = severityId;
        alert.seriesFingerprint = fingerprint;
        alert.isCreatedAutomatically = true;

        if (data.onCallDutyPolicyIds.length > 0) {
          alert.onCallDutyPolicies = data.onCallDutyPolicyIds.map(
            (id: ObjectID): OnCallDutyPolicy => {
              const stub: OnCallDutyPolicy = new OnCallDutyPolicy();
              stub.id = id;
              return stub;
            },
          );
        }

        await AlertService.create({ data: alert, props: { isRoot: true } });
        raised++;
      } catch (error) {
        logger.error(
          `CloudTagNotifier: an alert for project ${data.projectId.toString()} could not be raised:`,
        );
        logger.error(error);
      }
    }

    return raised;
  }
}
