import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import {
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_LINES,
  AI_ACTION_TITLES,
  AIActionSentence,
  aiActionList,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
  AIToolRefusal,
} from "../../../../Types/AI/AIChatTypes";
import { AI_TOOL_CITATIONS } from "../../../../Types/AI/AIReadTableWords";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import Email from "../../../../Types/Email";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  InviteTeam,
  InviteTeamPermissionRow,
  pickDefaultInviteTeam,
} from "../../../../Types/Team/DefaultInviteTeamRule";
import TeamMemberService, {
  SCIM_PUSH_GROUPS_INVITE_MESSAGE,
} from "../../../Services/TeamMemberService";
import TeamPermissionService from "../../../Services/TeamPermissionService";
import TeamService from "../../../Services/TeamService";
import logger from "../../Logger";
import ServerSendingStatus from "../../ServerSending/ServerSendingStatus";
import { citationSentence } from "./ReadTableWords";
import {
  MAX_SETUP_NAMES,
  SETUP_PLAN_ORDER,
  addMemberUsers,
  plainName,
} from "./SetupPlan";
import {
  ObservabilityTool,
  PreparedMutation,
  SetupActionRefusal,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import WidgetBuilder from "./WidgetBuilder";

/*
 * INVITE PEOPLE TO THE PROJECT FROM A SENTENCE (#7242).
 *
 * "Add ana@acme.com to the project and page her too" is one plan: the
 * invitation, then the policy that pages her once she joins (set_up_paging
 * and add_to_on_call_policy name an address this plan invites; it runs
 * first, setupAction.planOrder). The invitation is the one Users' Invite
 * User makes for the same answers - and the guided on-call setup's "Invite
 * by email" (#7150):
 *
 *   - on the team Invite User starts on: the project's members team, when
 *     the person may hand it on (pickDefaultInviteTeam, the rule every
 *     invitation follows);
 *   - by address, through TeamMemberService.create as the person, which
 *     makes every check it makes there - who may invite to the team, the
 *     plan's seats and people, SCIM Push Groups, how often one address may
 *     be mailed - and emails the invitation;
 *   - said before the card: an address that is not one, someone in the
 *     project already, no team the person may hand on, SCIM and the seats
 *     (TeamMemberService.getInvitationRefusal) - and, on a server that
 *     cannot send email, that no email goes (the invite dialogs' own
 *     sentence).
 *
 * People, teams and the project's settings are always on: the action is
 * of no one product.
 */

const NO_TEAM_TO_INVITE_TO: string =
  "Nothing proposed: no team could be picked for them - the project's members team, which Invite User starts on, is not one the person may hand on. Tell them to invite people from Users, where they choose the team, and end with that page's citation (find_dashboard_page \"Users\").";

// The addresses a call names, and what it names that is not one.
export interface InviteEmails {
  // Each address once, in lower case, at most MAX_SETUP_NAMES.
  emails: Array<string>;
  notEmails: Array<string>;
}

export function readInviteEmails(args: JSONObject): InviteEmails {
  const read: InviteEmails = { emails: [], notEmails: [] };

  for (const value of ToolArgs.getStringArray(args, "emails") || []) {
    const text: string = value.trim().toLowerCase();

    if (!text) {
      continue;
    }

    if (!Email.isValid(text)) {
      if (!read.notEmails.includes(value.trim())) {
        read.notEmails.push(value.trim());
      }
      continue;
    }

    if (!read.emails.includes(text)) {
      read.emails.push(text);
    }

    if (read.emails.length >= MAX_SETUP_NAMES) {
      break;
    }
  }

  return read;
}

/*
 * The team an invitation starts on, as Invite User picks it
 * (pickDefaultInviteTeam): read as the person - the project's teams, the
 * ones they may hand on (TeamPermissionService.findTeamsCallerCannotGrant)
 * and their permission rows. Null when none can be picked.
 */
export async function findInviteTeam(
  ctx: ToolContext,
): Promise<InviteTeam | null> {
  const teams: Array<Team> = await TeamService.findBy({
    query: { projectId: ctx.projectId },
    select: { _id: true, name: true, createdAt: true },
    sort: { createdAt: SortOrder.Ascending },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: ctx.props,
  });

  const teamIds: Array<ObjectID> = teams
    .filter((team: Team): boolean => {
      return Boolean(team.id);
    })
    .map((team: Team): ObjectID => {
      return team.id!;
    });

  const [refused, rows]: [Array<ObjectID>, Array<TeamPermission>] =
    await Promise.all([
      TeamPermissionService.findTeamsCallerCannotGrant({
        teamIds: teamIds,
        projectId: ctx.projectId,
        props: ctx.props,
      }),
      TeamPermissionService.findBy({
        query: { projectId: ctx.projectId },
        select: {
          _id: true,
          teamId: true,
          permission: true,
          isBlockPermission: true,
          scope: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: ctx.props,
      }),
    ]);

  const refusedIds: Set<string> = new Set<string>(
    refused.map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    }),
  );

  return pickDefaultInviteTeam({
    teams: teams
      .filter((team: Team): boolean => {
        return (
          Boolean(team.id) && !refusedIds.has(team.id!.toString().toLowerCase())
        );
      })
      .map((team: Team): InviteTeam => {
        return { id: team.id!.toString(), name: team.name || "" };
      }),
    permissionRows: rows
      .filter((row: TeamPermission): boolean => {
        return Boolean(row.teamId && row.permission);
      })
      .map((row: TeamPermission): InviteTeamPermissionRow => {
        return {
          teamId: row.teamId!.toString(),
          permission: row.permission as Permission,
          isBlockPermission: Boolean(row.isBlockPermission),
          scope: row.scope,
        };
      }),
    // Every team left is one the person may hand on.
    canGrantAll: (): boolean => {
      return true;
    },
  });
}

/*
 * The addresses among these that have a membership in the project
 * already, accepted or not, as the person reads the project's people:
 * inviting them again changes nothing.
 */
async function readAddressesInProject(
  ctx: ToolContext,
  emails: ReadonlyArray<string>,
): Promise<Array<string>> {
  if (emails.length === 0) {
    return [];
  }

  // The project's memberships the person may read, accepted or not.
  const memberships: Array<TeamMember> = await TeamMemberService.findBy({
    query: { projectId: ctx.projectId },
    select: { _id: true, userId: true },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: ctx.props,
  });

  await addMemberUsers(ctx, memberships);

  const inProject: Array<string> = [];

  for (const membership of memberships) {
    const email: string = (membership.user?.email?.toString() || "")
      .trim()
      .toLowerCase();

    if (email && emails.includes(email) && !inProject.includes(email)) {
      inProject.push(email);
    }
  }

  return inProject;
}

// Whether this server can send the invitation email; true when it cannot be told.
async function canSendInvitationEmail(): Promise<boolean> {
  try {
    return await ServerSendingStatus.canSendEmailPublicly();
  } catch {
    return true;
  }
}

// The Users page, where an invitation is seen, sent again or its link read.
const USERS_PAGE: AIChatCitationTarget = {
  type: AIChatCitationTargetType.DashboardPage,
  params: { path: "/dashboard/:projectId/users", title: "Users" },
};

// What a prepared call runs with: the addresses to invite and the team.
export interface PreparedInvitation {
  emails: Array<string>;
  teamId: string;
  teamName: string;
}

export function readPreparedInvitation(args: JSONObject): PreparedInvitation {
  const teamId: string = ToolArgs.getString(args, "teamId") || "";

  return {
    emails: readInviteEmails(args).emails,
    teamId: ObjectID.isValidUUID(teamId) ? teamId : "",
    teamName: ToolArgs.getString(args, "teamName") || "",
  };
}

export const InvitePeopleTool: ObservabilityTool = {
  name: "invite_people",
  description:
    "Invite people to this project by email, as Users' Invite User does: each joins the team Invite User starts on (the project's members team) and is emailed an invitation to accept. Use it for 'invite ana@acme.com', 'add ana@acme.com to the project'. To page someone invited in the same answer, name their address in set_up_paging's alsoPage or add_to_on_call_policy's: they are paged once they join. It always shows the person an approval card, in every mode.",
  inputSchema: {
    type: "object",
    properties: {
      emails: {
        type: "array",
        items: { type: "string" },
        description: "The email addresses to invite, as the person gave them.",
      },
    },
    required: ["emails"],
  },
  // Inviting is a membership's create: Invite User's own permission.
  get requiredPermissions(): Array<Permission> {
    return new TeamMember().getCreatePermissions();
  },
  isMutation: true,
  setupAction: { planOrder: SETUP_PLAN_ORDER.invitation },
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    const emails: Array<string> = readInviteEmails(args).emails;

    return emails.length > 0
      ? aiActionSentence(AI_ACTION_TITLES.invitePeople, {
          people: aiActionList(emails.map(plainName)),
        })
      : aiActionSentence(AI_ACTION_TITLES.invitePeopleUnnamed);
  },
  /*
   * The team written out by id - what the card named is what runs - and
   * the addresses to invite: those not in the project already. The card
   * says the team, the email each gets (or that none goes), and who is
   * left out because they are in the project already.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const asked: InviteEmails = readInviteEmails(args);

    if (asked.emails.length === 0) {
      return { arguments: args };
    }

    try {
      const [team, inProject, canEmail]: [
        InviteTeam | null,
        Array<string>,
        boolean,
      ] = await Promise.all([
        findInviteTeam(ctx),
        readAddressesInProject(ctx, asked.emails),
        canSendInvitationEmail(),
      ]);
      const toInvite: Array<string> = asked.emails.filter(
        (email: string): boolean => {
          return !inProject.includes(email);
        },
      );
      const description: Array<AIActionSentence> = [];

      if (team && toInvite.length > 0) {
        if (canEmail) {
          description.push(
            aiActionSentence(AI_ACTION_LINES.invitationsToTeam, {
              team: team.name,
            }),
          );
        } else {
          description.push(
            aiActionSentence(AI_ACTION_LINES.invitationsJoinTeam, {
              team: team.name,
            }),
            aiActionSentence(AI_ACTION_LINES.invitationsWithoutEmail),
          );
        }
      }

      if (inProject.length > 0) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.alreadyInProject, {
            names: aiActionList(inProject.map(plainName)),
          }),
        );
      }

      return {
        arguments: {
          ...args,
          emails: toInvite,
          ...(team ? { teamId: team.id, teamName: team.name } : {}),
        },
        title: aiActionSentence(AI_ACTION_TITLES.invitePeople, {
          people: aiActionList(
            (toInvite.length > 0 ? toInvite : asked.emails).map(plainName),
          ),
        }),
        namedArguments: ["emails"],
        description: description,
        describedArguments: ["teamId", "teamName"],
      };
    } catch (error) {
      logger.debug(
        `invite_people could not read the project's teams: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { arguments: args };
    }
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    const asked: InviteEmails = readInviteEmails(args);

    if (asked.notEmails.length > 0 || asked.emails.length === 0) {
      return {
        toldModel: `Nothing proposed: ${
          asked.notEmails.length > 0
            ? `${asked.notEmails
                .map((value: string): string => {
                  return `"${value}"`;
                })
                .join(
                  ", ",
                )} ${asked.notEmails.length === 1 ? "is not an email address" : "are not email addresses"}`
            : "no email address was given"
        }. People are invited by their email address: ask for it, and propose it again.`,
      };
    }

    const invitation: PreparedInvitation = readPreparedInvitation(args);

    if (!invitation.teamId) {
      return { toldModel: NO_TEAM_TO_INVITE_TO };
    }

    try {
      const refusal: string | null =
        await TeamMemberService.getInvitationRefusal({
          projectId: ctx.projectId,
          props: ctx.props,
          emails: invitation.emails,
        });

      if (refusal) {
        return {
          toldModel: `Nothing proposed: the project does not allow it now. ${refusal} Tell the person what is needed, in these words.`,
          /*
           * The seats are the plan's; SCIM is how the project manages its
           * people, which no plan changes.
           */
          ...(refusal === SCIM_PUSH_GROUPS_INVITE_MESSAGE
            ? {}
            : { refusal: AIToolRefusal.Plan }),
        };
      }
    } catch {
      // Unreadable now: inviting says why.
    }

    return null;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const invitation: PreparedInvitation = readPreparedInvitation(args);

    if (invitation.emails.length === 0) {
      throw new BadDataException(
        "Nobody was invited: no email address was given, or everyone named is in the project already.",
      );
    }

    if (!invitation.teamId) {
      throw new BadDataException(NO_TEAM_TO_INVITE_TO);
    }

    const invited: Array<string> = [];
    const failed: Array<{ email: string; reason: string }> = [];

    /*
     * Users' Invite User for each address, as the person: the same create,
     * on the same team, with every check it makes and the email it sends.
     */
    for (const email of invitation.emails) {
      const member: TeamMember = new TeamMember();
      member.projectId = ctx.projectId;
      member.teamId = new ObjectID(invitation.teamId);

      try {
        await TeamMemberService.create({
          data: member,
          miscDataProps: { email: email },
          props: ctx.props,
        });
        invited.push(email);
      } catch (error) {
        failed.push({
          email: email,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (invited.length === 0) {
      throw new BadDataException(
        `Nobody was invited, as each invitation was refused (${failed
          .map((failure: { email: string; reason: string }): string => {
            return `${failure.email}: ${failure.reason.replace(/\.$/, "")}`;
          })
          .join("; ")}).`,
      );
    }

    const canEmail: boolean = await canSendInvitationEmail();

    return {
      dataForLlm: `Invited ${invited.join(", ")} to this project, on the ${invitation.teamName} team.${
        canEmail
          ? " Each is emailed an invitation to accept."
          : " This server cannot send email yet, so no invitation email went: the invitations are created, and the server's admin can set up email, or share each invitation's link from Users."
      } Until they accept, they are not paged: a policy that pages them reaches them once they join.${
        failed.length > 0
          ? ` Not invited: ${failed
              .map((failure: { email: string; reason: string }): string => {
                return `${failure.email} (${failure.reason})`;
              })
              .join("; ")}. Say exactly who was not invited, and why.`
          : ""
      }`,
      rowCount: invited.length,
      ...citationSentence(AI_TOOL_CITATIONS.invitedPeople, {
        team: invitation.teamName,
      }),
      citationTarget: USERS_PAGE,
      redactionCount: 0,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "People invited",
        heading: invited.join(", "),
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.invitation),
          line: [
            aiActionSentence(
              canEmail
                ? AI_ACTION_CARD_LINES.invitedToTeam
                : AI_ACTION_CARD_LINES.invitedToTeamWithoutEmail,
              { team: invitation.teamName },
            ),
          ],
        },
        link: USERS_PAGE,
      }),
    };
  },
};
