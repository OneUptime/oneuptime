import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import TeamService from "../../../Services/TeamService";
import TeamMemberService from "../../../Services/TeamMemberService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the Team model class is fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Team().getReadPermissions();
    }
    return cachedReadPermissions;
  };

/*
 * Members are surfaced by display name, not email: the serializer redacts
 * every email before the payload reaches the LLM, so a name is the only
 * identifier the model can actually read back to the user.
 */
function displayNameOf(user: User | undefined | null): string {
  const displayName: string = user?.name?.toString().trim() || "";
  if (displayName.length > 0) {
    return displayName;
  }
  return user?.id ? user.id.toString() : "Unknown user";
}

export const QueryTeamsTool: ObservabilityTool = {
  name: "query_teams",
  description:
    "Query the teams in this project. Without arguments it lists every team with its id, name, description and member count. Pass teamId to see one team's members by display name (and whether an invite is still pending). Use this to answer 'who is on the platform team?' or 'which team should own this?' — team names here match the ownerTeams shown by query_incidents and the escalation teams shown by query_on_call_policies.",
  inputSchema: {
    type: "object",
    properties: {
      teamId: {
        type: "string",
        description:
          "Get one team by its ID — returns the team plus its members by name. Find the id by calling this tool without arguments first.",
      },
      limit: {
        type: "number",
        description: "List mode: maximum teams to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "List mode: how many teams to skip, for paging through a long list (default 0).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const teamId: ObjectID | undefined = ToolArgs.getObjectID(args, "teamId");

    if (teamId) {
      const team: Team | null = await TeamService.findOneById({
        id: teamId,
        select: {
          _id: true,
          name: true,
          description: true,
          createdAt: true,
        },
        props: ctx.props,
      });

      if (!team) {
        const serialized: SerializedResult = ToolResultSerializer.serializeRows(
          [],
        );

        return {
          dataForLlm: serialized.text,
          rowCount: serialized.rowCount,
          citationLabel: `Team ${teamId.toString()}`,
          citationTarget: {
            type: AIChatCitationTargetType.Teams,
          },
          redactionCount: serialized.redactionCount,
          isTruncated: serialized.isTruncated,
        };
      }

      /*
       * Membership lives in the TeamMember join table, not as a relation on
       * Team. projectId is pinned to the tenant from ctx because teamId is an
       * untrusted model argument.
       */
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          teamId: teamId,
          projectId: ctx.projectId,
        },
        select: {
          _id: true,
          hasAcceptedInvitation: true,
          user: {
            _id: true,
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: ctx.props,
      });

      const memberRows: Array<JSONObject> = members.map(
        (member: TeamMember) => {
          return {
            section: "member",
            name: displayNameOf(member.user),
            email: member.user?.email?.toString(),
            status:
              member.hasAcceptedInvitation === false
                ? "invited (not yet accepted)"
                : "member",
          };
        },
      );

      const rows: Array<JSONObject> = [
        {
          section: "team",
          id: team.id?.toString(),
          name: team.name,
          description: team.description,
          memberCount: memberRows.length,
          createdAt: team.createdAt,
        },
        ...memberRows,
      ];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      const memberLabel: string = `${memberRows.length} member${
        memberRows.length === 1 ? "" : "s"
      }`;

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Team "${team.name}" (${memberLabel})`,
        citationTarget: {
          type: AIChatCitationTargetType.Teams,
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          memberRows.length > 0
            ? WidgetBuilder.table({
                title: `Team: ${team.name}`,
                description: team.description,
                columns: [
                  { key: "name", title: "Member", type: "text" },
                  { key: "email", title: "Email", type: "text" },
                  { key: "status", title: "Status", type: "text" },
                ],
                rows: memberRows,
                link: { type: AIChatCitationTargetType.Teams },
              })
            : WidgetBuilder.resourceCard({
                title: "Team",
                resourceType: "Team",
                heading: team.name || "Team",
                subheading: "No members",
                fields: [
                  { label: "Description", value: team.description || "—" },
                  { label: "Members", value: "0" },
                ],
                link: { type: AIChatCitationTargetType.Teams },
              }),
      };
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    const teams: Array<Team> = await TeamService.findBy({
      query: {},
      select: {
        _id: true,
        name: true,
        description: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: limit,
      skip: skip,
      props: ctx.props,
    });

    const totalCountPositive: PositiveNumber = await TeamService.countBy({
      query: {},
      props: ctx.props,
    });
    const totalCount: number = totalCountPositive.toNumber();

    /*
     * Member counts come from one scoped fetch of the join rows for this page
     * of teams (counted in memory), not one countBy per team. projectId is
     * pinned to the tenant so the join fetch can never cross projects.
     */
    const teamIds: Array<ObjectID> = teams
      .map((team: Team) => {
        return team.id;
      })
      .filter((id: ObjectID | null | undefined): id is ObjectID => {
        return Boolean(id);
      });

    const memberCountByTeamId: Map<string, number> = new Map<string, number>();

    if (teamIds.length > 0) {
      const memberLinks: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          teamId: QueryHelper.any(teamIds),
          projectId: ctx.projectId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: ctx.props,
      });

      for (const link of memberLinks) {
        const key: string = link.teamId?.toString() || "";
        if (!key) {
          continue;
        }
        memberCountByTeamId.set(key, (memberCountByTeamId.get(key) || 0) + 1);
      }
    }

    const rows: Array<JSONObject> = teams.map((team: Team) => {
      return {
        id: team.id?.toString(),
        name: team.name,
        description: team.description,
        memberCount: memberCountByTeamId.get(team.id?.toString() || "") || 0,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    // Tell the model it is looking at one page of a longer list.
    const isPaged: boolean = rows.length > 0 && totalCount > rows.length;
    const pagingPrefix: string = isPaged
      ? `Showing rows ${skip + 1}–${skip + rows.length} of ${totalCount} total. Pass skip to page further.\n`
      : "";

    return {
      dataForLlm: `${pagingPrefix}${serialized.text}`,
      rowCount: serialized.rowCount,
      citationLabel: isPaged
        ? `Teams (${rows.length} of ${totalCount})`
        : `Teams (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Teams,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Teams (${rows.length})`,
              description: isPaged
                ? `Showing ${rows.length} of ${totalCount} teams`
                : undefined,
              columns: [
                { key: "name", title: "Name", type: "text" },
                { key: "memberCount", title: "Members", type: "number" },
                { key: "description", title: "Description", type: "text" },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.Teams },
            })
          : undefined,
    };
  },
};
