import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertService from "../../Services/AlertService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentService from "../../Services/IncidentService";
import MonitorService from "../../Services/MonitorService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import ProjectService from "../../Services/ProjectService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../Services/WorkspaceUserAuthTokenService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";

/*
 * WHICH ONEUPTIME PROJECT A SLACK OR MICROSOFT TEAMS REQUEST IS ABOUT.
 *
 * One Slack workspace, or one Microsoft 365 organization, can be connected
 * to more than one OneUptime project: a company with a production and a
 * non-production project connects both to the same Slack. Every request
 * the chat sends - a button pressed, a form submitted, a command, a
 * message to the app - names the workspace (Slack's team id, Microsoft's
 * tenant id) and never the project.
 *
 * Slack read it in whichever of the workspace's connections the database
 * happened to return first. An incident's Acknowledge and Resolve, pressed
 * in the incident's own channel by its commander, were read in the other
 * project, where the incident is not: "the incident was not found in this
 * project, or you do not have access to it". A command from a member
 * connected in only the other project asked them to connect their account
 * again. Microsoft Teams refused every request of such an organization.
 *
 * Now the project is told apart by what the request carries, the most
 * specific first:
 *
 *   1. only one project is connected: that one;
 *   2. the record it names - the incident, alert, episode or maintenance
 *      event a button, a menu item or a form is about, by the id OneUptime
 *      wrote on it - is a record of one of them: that record's project;
 *   3. the project the form, card or Home it came from was drawn for,
 *      which OneUptime writes on it;
 *   4. the channel it was made in: a record's own channel, or one only one
 *      of the projects posts to;
 *   5. the person: the one project their chat account is connected in as
 *      a member of it.
 *
 * What none of these tells is not guessed: the request is ambiguous, and
 * the person is told why and how to say which (getAmbiguousAnswer) - in
 * Slack, asked which, with a button for each project they are in, and the
 * request made again in the one they choose (SlackProjectChoice). The
 * project told apart decides only where the request is read: what it may
 * do there, it does as the member the chat account is connected to in that
 * project, held to their own permissions (WorkspaceActionAuthorization) -
 * so a record of a project somebody is not in is refused to them as it
 * always was.
 */

// What told the project apart (WorkspaceProjectResolution.decidedBy).
export enum WorkspaceProjectEvidence {
  OnlyProject = "OnlyProject",
  Record = "Record",
  DrawnFor = "DrawnFor",
  Channel = "Channel",
  Person = "Person",
}

// What a request carries that can tell its project apart.
export interface WorkspaceProjectClues {
  /*
   * The values a press carries that can be a record's id: a button's or a
   * menu item's value, the value a form was opened with.
   */
  recordIds?: Array<string | undefined> | undefined;
  // The project the form, card or Home it came from was drawn for.
  drawnForProjectId?: string | ObjectID | undefined;
  // The channel (Slack) or the channel of the conversation (Teams) it was made in.
  channelId?: string | undefined;
  // The person's chat account: a Slack user id, a Microsoft Entra object id.
  workspaceUserId?: string | undefined;
}

/*
 * How somebody whose request could be about more than one project makes it
 * again where it can be told apart (getAmbiguousAnswer): the same again, in
 * a channel of the project they mean - a command, a button; asked again
 * there, for a question to OneUptime AI; or, for a Slack shortcut from the
 * shortcuts menu, which never says where it was used, the command that does
 * the same, there.
 */
export enum WorkspaceAmbiguousRetryKind {
  Again = "Again",
  Question = "Question",
  Command = "Command",
}

export interface WorkspaceAmbiguousRetry {
  kind: WorkspaceAmbiguousRetryKind;
  // For Command: the command to use instead, "/oneuptime incident".
  command?: string | undefined;
}

// A project somebody can choose for their request, with its name.
export interface WorkspaceProjectChoice {
  projectId: ObjectID;
  name: string;
}

export interface WorkspaceProjectResolution {
  // The connection of the project the request is about; null for none.
  projectAuth: WorkspaceProjectAuthToken | null;
  // Every project connected to the workspace, one connection each, oldest first.
  connections: Array<WorkspaceProjectAuthToken>;
  // Several are connected, and nothing the request carries tells which.
  isAmbiguous: boolean;
  decidedBy: WorkspaceProjectEvidence | null;
  /*
   * When the person was asked (5 above): the projects of `connections` they
   * are connected in as a member, and whether they are connected in any.
   */
  memberProjectIds: Array<ObjectID>;
  isPersonConnected: boolean;
}

/*
 * The records a button, a menu item or a form names by its id, in the order
 * the chats' buttons name them most - the incident first.
 */
const RECORD_SERVICES: ReadonlyArray<() => DatabaseService<DatabaseBaseModel>> =
  [
    () => {
      return IncidentService as unknown as DatabaseService<DatabaseBaseModel>;
    },
    () => {
      return AlertService as unknown as DatabaseService<DatabaseBaseModel>;
    },
    () => {
      return IncidentEpisodeService as unknown as DatabaseService<DatabaseBaseModel>;
    },
    () => {
      return AlertEpisodeService as unknown as DatabaseService<DatabaseBaseModel>;
    },
    () => {
      return ScheduledMaintenanceService as unknown as DatabaseService<DatabaseBaseModel>;
    },
    () => {
      return MonitorService as unknown as DatabaseService<DatabaseBaseModel>;
    },
    () => {
      return OnCallDutyPolicyService as unknown as DatabaseService<DatabaseBaseModel>;
    },
  ];

// The records a channel can be made for (postUpdatesToWorkspaceChannels).
const CHANNEL_RECORD_SERVICES: ReadonlyArray<
  () => DatabaseService<DatabaseBaseModel>
> = RECORD_SERVICES.slice(0, 5);

// How many records owning one channel are read: one is the usual.
const CHANNEL_OWNERS_READ_LIMIT: number = 20;

export default class WorkspaceProjectResolver {
  /*
   * Every project connected to the workspace, one connection each (a
   * project connected twice is one project), oldest connection first, so
   * whatever is listed is listed in the same order every time.
   */
  @CaptureSpan()
  public static async findConnections(data: {
    workspaceType: WorkspaceType;
    workspaceId: string;
  }): Promise<Array<WorkspaceProjectAuthToken>> {
    if (!data.workspaceId) {
      return [];
    }

    const rows: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: data.workspaceType,
          workspaceProjectId: data.workspaceId,
        },
        select: {
          _id: true,
          projectId: true,
          authToken: true,
          workspaceProjectId: true,
          miscData: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const seen: Set<string> = new Set<string>();
    const connections: Array<WorkspaceProjectAuthToken> = [];

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      const key: string = row.projectId.toString().toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      connections.push(row);
    }

    return connections;
  }

  /*
   * The project a request is about, told apart by what it carries (see the
   * header). Reads only what it needs: nothing more than the connections
   * for a workspace connected to one project.
   */
  @CaptureSpan()
  public static async resolve(data: {
    workspaceType: WorkspaceType;
    workspaceId: string;
    clues?: WorkspaceProjectClues | undefined;
  }): Promise<WorkspaceProjectResolution> {
    const connections: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectResolver.findConnections({
        workspaceType: data.workspaceType,
        workspaceId: data.workspaceId,
      });

    return await WorkspaceProjectResolver.resolveAmong({
      workspaceType: data.workspaceType,
      connections: connections,
      clues: data.clues || {},
    });
  }

  /*
   * resolve, among connections already read: for a caller that reads them
   * itself, Microsoft Teams' tenant resolution among them.
   */
  @CaptureSpan()
  public static async resolveAmong(data: {
    workspaceType: WorkspaceType;
    connections: Array<WorkspaceProjectAuthToken>;
    clues: WorkspaceProjectClues;
  }): Promise<WorkspaceProjectResolution> {
    const { connections, clues } = data;

    const decided: (
      projectId: ObjectID,
      evidence: WorkspaceProjectEvidence,
      person?: { memberProjectIds: Array<ObjectID>; isConnected: boolean },
    ) => WorkspaceProjectResolution = (
      projectId: ObjectID,
      evidence: WorkspaceProjectEvidence,
      person?: { memberProjectIds: Array<ObjectID>; isConnected: boolean },
    ): WorkspaceProjectResolution => {
      return {
        projectAuth: WorkspaceProjectResolver.connectionOf(
          connections,
          projectId,
        )!,
        connections: connections,
        isAmbiguous: false,
        decidedBy: evidence,
        memberProjectIds: person?.memberProjectIds || [],
        isPersonConnected: person?.isConnected || false,
      };
    };

    if (connections.length === 0) {
      return {
        projectAuth: null,
        connections: [],
        isAmbiguous: false,
        decidedBy: null,
        memberProjectIds: [],
        isPersonConnected: false,
      };
    }

    if (connections.length === 1) {
      return decided(
        connections[0]!.projectId!,
        WorkspaceProjectEvidence.OnlyProject,
      );
    }

    const projectIds: Array<ObjectID> = connections.map(
      (connection: WorkspaceProjectAuthToken): ObjectID => {
        return connection.projectId!;
      },
    );

    // 2. The record the press names.
    const recordProjectId: ObjectID | null =
      await WorkspaceProjectResolver.findProjectOfRecord({
        recordIds: clues.recordIds || [],
        projectIds: projectIds,
      });

    if (recordProjectId) {
      return decided(recordProjectId, WorkspaceProjectEvidence.Record);
    }

    // 3. The project its form, card or Home was drawn for.
    const drawnFor: string = (clues.drawnForProjectId || "").toString();

    if (
      drawnFor &&
      WorkspaceProjectResolver.connectionOf(connections, drawnFor)
    ) {
      return decided(new ObjectID(drawnFor), WorkspaceProjectEvidence.DrawnFor);
    }

    // 4. The channel it was made in.
    if (clues.channelId) {
      const channelProjectIds: Array<ObjectID> =
        await WorkspaceProjectResolver.findProjectsOfChannel({
          workspaceType: data.workspaceType,
          channelId: clues.channelId,
          projectIds: projectIds,
        });

      if (channelProjectIds.length === 1) {
        return decided(channelProjectIds[0]!, WorkspaceProjectEvidence.Channel);
      }
    }

    // 5. The person.
    const person: {
      linkedProjectIds: Array<ObjectID>;
      memberProjectIds: Array<ObjectID>;
    } = clues.workspaceUserId
      ? await WorkspaceProjectResolver.findProjectsOfPerson({
          workspaceType: data.workspaceType,
          workspaceUserId: clues.workspaceUserId,
          projectIds: projectIds,
        })
      : { linkedProjectIds: [], memberProjectIds: [] };

    const personFacts: {
      memberProjectIds: Array<ObjectID>;
      isConnected: boolean;
    } = {
      memberProjectIds: person.memberProjectIds,
      isConnected: person.linkedProjectIds.length > 0,
    };

    if (person.memberProjectIds.length === 1) {
      return decided(
        person.memberProjectIds[0]!,
        WorkspaceProjectEvidence.Person,
        personFacts,
      );
    }

    /*
     * Connected only where they are no longer a member: read there, where
     * they are told so (WorkspaceActionAuthorization's refusal), as they
     * were before.
     */
    if (
      person.memberProjectIds.length === 0 &&
      person.linkedProjectIds.length > 0
    ) {
      return decided(
        person.linkedProjectIds[0]!,
        WorkspaceProjectEvidence.Person,
        personFacts,
      );
    }

    return {
      projectAuth: null,
      connections: connections,
      isAmbiguous: true,
      decidedBy: null,
      memberProjectIds: person.memberProjectIds,
      isPersonConnected: personFacts.isConnected,
    };
  }

  /*
   * The connection a place that shows one person one project - the app's
   * Home, its welcome - shows them: the project told apart, or, when they
   * are a member of several, the first of those (in the order the projects
   * were connected), which such a place names. Null when it is none of
   * these: several projects are connected, and the person is connected in
   * none of them.
   */
  public static getPersonProject(
    resolution: WorkspaceProjectResolution,
  ): WorkspaceProjectAuthToken | null {
    if (resolution.projectAuth) {
      return resolution.projectAuth;
    }

    const firstProjectId: ObjectID | undefined = resolution.memberProjectIds[0];

    return firstProjectId
      ? WorkspaceProjectResolver.connectionOf(
          resolution.connections,
          firstProjectId,
        ) || null
      : null;
  }

  /*
   * The project of the first of `recordIds` that is a record - an incident,
   * an alert, an episode, a scheduled maintenance event, a monitor or an
   * on-call policy - of one of `projectIds`, read as OneUptime: which
   * project a press is about, never what the record holds. Null for none.
   * Values that are not ids are passed over without a read.
   */
  @CaptureSpan()
  public static async findProjectOfRecord(data: {
    recordIds: Array<string | undefined>;
    projectIds: Array<ObjectID>;
  }): Promise<ObjectID | null> {
    const ids: Array<string> = Array.from(
      new Set<string>(
        data.recordIds
          .map((id: string | undefined): string => {
            return (id || "").trim().toLowerCase();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    );

    if (ids.length === 0 || data.projectIds.length === 0) {
      return null;
    }

    for (const id of ids) {
      const found: Array<DatabaseBaseModel | null> = await Promise.all(
        RECORD_SERVICES.map(
          async (
            service: () => DatabaseService<DatabaseBaseModel>,
          ): Promise<DatabaseBaseModel | null> => {
            return await service().findOneBy({
              query: {
                _id: id,
                projectId: QueryHelper.any(data.projectIds),
              } as Query<DatabaseBaseModel>,
              select: {
                _id: true,
                projectId: true,
              } as Select<DatabaseBaseModel>,
              props: {
                isRoot: true,
              },
            });
          },
        ),
      );

      const record: DatabaseBaseModel | undefined = found.find(
        (row: DatabaseBaseModel | null): boolean => {
          return Boolean(WorkspaceProjectResolver.projectIdOf(row));
        },
      ) as DatabaseBaseModel | undefined;

      const projectId: ObjectID | null =
        WorkspaceProjectResolver.projectIdOf(record);

      if (projectId) {
        return projectId;
      }
    }

    return null;
  }

  /*
   * The projects of `projectIds` a channel belongs to: the project of a
   * record whose own channel it is, or else each project that has posted
   * to it (the workspace notification log). One project is an answer; none,
   * or several - a channel two projects post to - is not.
   */
  @CaptureSpan()
  public static async findProjectsOfChannel(data: {
    workspaceType: WorkspaceType;
    channelId: string;
    projectIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    if (!data.channelId || data.projectIds.length === 0) {
      return [];
    }

    const owners: Array<Array<DatabaseBaseModel>> = await Promise.all(
      CHANNEL_RECORD_SERVICES.map(
        async (
          service: () => DatabaseService<DatabaseBaseModel>,
        ): Promise<Array<DatabaseBaseModel>> => {
          return await service().findBy({
            query: {
              projectId: QueryHelper.any(data.projectIds),
              postUpdatesToWorkspaceChannels: QueryHelper.jsonContains([
                { id: data.channelId },
              ]),
            } as Query<DatabaseBaseModel>,
            select: {
              _id: true,
              projectId: true,
            } as Select<DatabaseBaseModel>,
            limit: CHANNEL_OWNERS_READ_LIMIT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });
        },
      ),
    );

    const ownerProjectIds: Array<ObjectID> = WorkspaceProjectResolver.distinct(
      owners.flat().map((row: DatabaseBaseModel): ObjectID | null => {
        return WorkspaceProjectResolver.projectIdOf(row);
      }),
    );

    if (ownerProjectIds.length > 0) {
      return ownerProjectIds;
    }

    const posted: Array<ObjectID | null> = await Promise.all(
      data.projectIds.map(
        async (projectId: ObjectID): Promise<ObjectID | null> => {
          const log: WorkspaceNotificationLog | null =
            await WorkspaceNotificationLogService.findOneBy({
              query: {
                projectId: projectId,
                workspaceType: data.workspaceType,
                channelId: data.channelId,
              },
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
              },
            });

          return log ? projectId : null;
        },
      ),
    );

    return WorkspaceProjectResolver.distinct(posted);
  }

  /*
   * The projects of `projectIds` a chat account is connected in, and those
   * of them where it is connected to a current member (membership read
   * from TeamMember, as every chat action reads it).
   */
  @CaptureSpan()
  public static async findProjectsOfPerson(data: {
    workspaceType: WorkspaceType;
    workspaceUserId: string;
    projectIds: Array<ObjectID>;
  }): Promise<{
    linkedProjectIds: Array<ObjectID>;
    memberProjectIds: Array<ObjectID>;
  }> {
    if (!data.workspaceUserId || data.projectIds.length === 0) {
      return { linkedProjectIds: [], memberProjectIds: [] };
    }

    const links: Array<WorkspaceUserAuthToken> =
      await WorkspaceUserAuthTokenService.findBy({
        query: {
          workspaceUserId: data.workspaceUserId,
          workspaceType: data.workspaceType,
          projectId: QueryHelper.any(data.projectIds),
        },
        select: {
          projectId: true,
          userId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // In the order the projects were connected.
    const linked: Array<WorkspaceUserAuthToken> = data.projectIds
      .map((projectId: ObjectID): WorkspaceUserAuthToken | undefined => {
        return links.find((link: WorkspaceUserAuthToken): boolean => {
          return (
            Boolean(link.userId) &&
            WorkspaceProjectResolver.isSameId(link.projectId, projectId)
          );
        });
      })
      .filter((link: WorkspaceUserAuthToken | undefined): boolean => {
        return Boolean(link);
      }) as Array<WorkspaceUserAuthToken>;

    const isMember: Array<boolean> = await Promise.all(
      linked.map(async (link: WorkspaceUserAuthToken): Promise<boolean> => {
        return await WorkspaceActionAuthorization.isProjectMember({
          userId: link.userId!,
          projectId: link.projectId!,
        });
      }),
    );

    return {
      linkedProjectIds: linked.map((link: WorkspaceUserAuthToken) => {
        return link.projectId!;
      }),
      memberProjectIds: linked
        .filter((_link: WorkspaceUserAuthToken, index: number): boolean => {
          return isMember[index]!;
        })
        .map((link: WorkspaceUserAuthToken): ObjectID => {
          return link.projectId!;
        }),
    };
  }

  /*
   * What a person whose request could be about more than one project is
   * told, where they made it: that the workspace is connected to more than
   * one project, and how to say which - from a channel of the project they
   * mean when they are in several (named: they are a member of each), or to
   * connect their account first when it is connected in none. `retry` says
   * how they make the request again there (a question is asked again, a
   * Slack shortcut becomes its command); trying it again by default.
   * Microsoft Teams' bot speaks as itself ("I"), as all its answers do.
   */
  @CaptureSpan()
  public static async getAmbiguousAnswer(data: {
    workspaceType: WorkspaceType;
    resolution: WorkspaceProjectResolution;
    retry?: WorkspaceAmbiguousRetry | undefined;
  }): Promise<WorkspaceAnswer> {
    const productName: string = ProductBrandingText.getProductName();
    const isTeams: boolean =
      data.workspaceType === WorkspaceType.MicrosoftTeams;

    const lead: string = WorkspaceProjectResolver.getAmbiguousLead(
      data.workspaceType,
    );

    if (!data.resolution.isPersonConnected) {
      const workspaceName: string = isTeams ? "Microsoft Teams" : "Slack";
      const markdown: MarkdownText = mdText`${lead}, and your ${workspaceName} account isn't connected in any of them yet. In ${productName}, open the project you use and connect your account under **User Settings → Workspace → ${workspaceName}**, then try again.`;

      return {
        markdown: markdown.toString(),
        text: `${lead}, and your ${workspaceName} account isn't connected in any of them yet. In ${productName}, open the project you use and connect your account under User Settings → Workspace → ${workspaceName}, then try again.`,
      };
    }

    const names: Array<string> = await WorkspaceProjectResolver.getProjectNames(
      data.resolution.memberProjectIds,
    );

    const notSure: string = isTeams
      ? "so I can't tell which one you mean here."
      : `so ${productName} can't tell which one you mean here.`;

    if (names.length < 2) {
      const again: { markdown: MarkdownText; text: string } =
        WorkspaceProjectResolver.getRetryPhrase({
          retry: data.retry,
          isSentenceStart: true,
        });

      return {
        markdown: mdText`${lead}, ${notSure} ${again.markdown}`.toString(),
        text: `${lead}, ${notSure} ${again.text}`,
      };
    }

    const again: { markdown: MarkdownText; text: string } =
      WorkspaceProjectResolver.getRetryPhrase({
        retry: data.retry,
        isSentenceStart: false,
      });
    const bold: Array<MarkdownText> = names.map(
      (name: string): MarkdownText => {
        return mdText`**${name}**`;
      },
    );
    const boldList: MarkdownText = mdText`${FeedMarkdown.join(bold.slice(0, -1), ", ")} and ${bold[bold.length - 1]!}`;
    const plainList: string = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;

    return {
      markdown:
        mdText`${lead}, ${notSure} You're in ${boldList}: ${again.markdown}`.toString(),
      text: `${lead}, ${notSure} You're in ${plainList}: ${again.text}`,
    };
  }

  /*
   * How an answer to a request that could be about more than one project
   * starts, without its full stop: "This Slack workspace is connected to
   * more than one OneUptime project". Microsoft Teams' is a literal its docs
   * quote (TEAMS_AMBIGUOUS_LEAD).
   */
  public static getAmbiguousLead(workspaceType: WorkspaceType): string {
    if (workspaceType === WorkspaceType.MicrosoftTeams) {
      return WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD;
    }

    return `This Slack workspace is connected to more than one ${ProductBrandingText.getProductName()} project`;
  }

  /*
   * The projects somebody can choose among, named, in the order given -
   * the order the projects were connected. Null when any of them cannot be
   * named (not found, or no name), or none can be read: a choice is offered
   * only with every button named.
   */
  @CaptureSpan()
  public static async getProjectChoices(
    projectIds: Array<ObjectID>,
  ): Promise<Array<WorkspaceProjectChoice> | null> {
    if (projectIds.length === 0) {
      return null;
    }

    const names: Array<string | null> =
      await WorkspaceProjectResolver.readProjectNames(projectIds);

    if (
      names.some((name: string | null): boolean => {
        return !name;
      })
    ) {
      return null;
    }

    return projectIds.map(
      (projectId: ObjectID, index: number): WorkspaceProjectChoice => {
        return { projectId: projectId, name: names[index]! };
      },
    );
  }

  /*
   * How the ambiguous answer ends: where and how to make the request again
   * (WorkspaceAmbiguousRetry) - "try it again in a channel of the project
   * you mean, such as one of its incident channels." A shortcut, which no
   * channel can tell apart, is pointed to its command instead.
   */
  private static getRetryPhrase(data: {
    retry: WorkspaceAmbiguousRetry | undefined;
    isSentenceStart: boolean;
  }): { markdown: MarkdownText; text: string } {
    const where: string =
      "in a channel of the project you mean, such as one of its incident channels.";
    const kind: WorkspaceAmbiguousRetryKind =
      data.retry?.kind || WorkspaceAmbiguousRetryKind.Again;

    if (kind === WorkspaceAmbiguousRetryKind.Command && data.retry?.command) {
      const verb: string = data.isSentenceStart ? "Use" : "use";

      return {
        markdown: mdText`${verb} **${data.retry.command}** in a channel of the project you mean instead.`,
        text: `${verb} ${data.retry.command} in a channel of the project you mean instead.`,
      };
    }

    const lead: string =
      kind === WorkspaceAmbiguousRetryKind.Question
        ? "ask again"
        : "try it again";
    const phrase: string = `${data.isSentenceStart ? lead.charAt(0).toUpperCase() + lead.substring(1) : lead} ${where}`;

    return {
      markdown: mdText`${phrase}`,
      text: phrase,
    };
  }

  /*
   * The name of `projectId`, when the workspace is connected to more than
   * one project: what a Connect prompt names, so somebody whose account is
   * connected in another of them sees why they are asked again, and where.
   * Null for a workspace connected to one project, and when the name cannot
   * be read - the prompt stands without it. Never throws.
   */
  @CaptureSpan()
  public static async getSharedWorkspaceProjectName(data: {
    workspaceType: WorkspaceType;
    workspaceId: string | undefined;
    projectId: ObjectID;
  }): Promise<string | null> {
    if (!data.workspaceId) {
      return null;
    }

    try {
      const connections: Array<WorkspaceProjectAuthToken> =
        await WorkspaceProjectResolver.findConnections({
          workspaceType: data.workspaceType,
          workspaceId: data.workspaceId,
        });

      if (connections.length < 2) {
        return null;
      }

      const names: Array<string> =
        await WorkspaceProjectResolver.getProjectNames([data.projectId]);

      return names[0] || null;
    } catch (err) {
      logger.debug(
        "Could not tell whether a workspace is connected to more than one project.",
      );
      logger.debug(err);
      return null;
    }
  }

  /*
   * How Microsoft Teams' answer to such a request starts: its troubleshooting
   * entry in the docs is headed with these words (InstallIntegrationsDocsFacts).
   */
  public static readonly TEAMS_AMBIGUOUS_LEAD: string =
    "This Microsoft 365 organization is connected to more than one OneUptime project";

  // The names of `projectIds`, in that order; a project not found is left out.
  private static async getProjectNames(
    projectIds: Array<ObjectID>,
  ): Promise<Array<string>> {
    return (await WorkspaceProjectResolver.readProjectNames(projectIds)).filter(
      (name: string | null): boolean => {
        return Boolean(name);
      },
    ) as Array<string>;
  }

  /*
   * The name of each of `projectIds`, in that order: null for a project not
   * found or without a name, and for every one when they cannot be read.
   * Never throws: what is answered with them stands without them.
   */
  private static async readProjectNames(
    projectIds: Array<ObjectID>,
  ): Promise<Array<string | null>> {
    if (projectIds.length === 0) {
      return [];
    }

    try {
      const projects: Array<Project> = await ProjectService.findBy({
        query: {
          _id: QueryHelper.any(projectIds),
        },
        select: {
          _id: true,
          name: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      return projectIds.map((projectId: ObjectID): string | null => {
        const project: Project | undefined = projects.find(
          (candidate: Project): boolean => {
            return WorkspaceProjectResolver.isSameId(candidate.id, projectId);
          },
        );

        return (project?.name || "").trim() || null;
      });
    } catch (err) {
      logger.debug("Could not read the names of the projects a person is in.");
      logger.debug(err);
      return projectIds.map((): null => {
        return null;
      });
    }
  }

  private static connectionOf(
    connections: Array<WorkspaceProjectAuthToken>,
    projectId: ObjectID | string,
  ): WorkspaceProjectAuthToken | undefined {
    return connections.find(
      (connection: WorkspaceProjectAuthToken): boolean => {
        return WorkspaceProjectResolver.isSameId(
          connection.projectId,
          projectId,
        );
      },
    );
  }

  private static projectIdOf(
    row: DatabaseBaseModel | null | undefined,
  ): ObjectID | null {
    const projectId: unknown = (
      row as unknown as { projectId?: ObjectID | string } | null | undefined
    )?.projectId;

    if (!projectId) {
      return null;
    }

    return projectId instanceof ObjectID
      ? projectId
      : new ObjectID(projectId.toString());
  }

  private static distinct(projectIds: Array<ObjectID | null>): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const result: Array<ObjectID> = [];

    for (const projectId of projectIds) {
      if (!projectId) {
        continue;
      }

      const key: string = projectId.toString().toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        result.push(projectId);
      }
    }

    return result;
  }

  private static isSameId(
    a: ObjectID | string | null | undefined,
    b: ObjectID | string | null | undefined,
  ): boolean {
    if (!a || !b) {
      return false;
    }

    return a.toString().toLowerCase() === b.toString().toLowerCase();
  }
}
