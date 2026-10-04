import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import UpdateBy from "../../Types/Database/UpdateBy";
import ProjectScopedReferenceValidator, {
  HeldRelationIds,
  resolveReferenceIds,
} from "../Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Logger";
import OwnerRuleAssignment, { OwnersToAssign } from "./OwnerRuleAssignment";

/*
 * An incident or alert grouping rule names people and teams -
 * episodeOwnerUsers and episodeOwnerTeams, its Episode Owners - who become
 * owners of every episode it opens: listed on the episode's Owners page and
 * notified like any owner. The engines open those episodes as root, so
 * nothing between the rule and the owner rows asked who those people and
 * teams were. A team from another project, written to a rule through the
 * API, became an owner of this project's episode, and each of its members
 * was told about it.
 *
 * Owners a rule sets follow the rule owners set by hand follow - the
 * episode's Owners page and the rule's own people picker offer only the
 * project's teams and members:
 *
 *   - a rule refuses, when it is saved, a team from another project or a
 *     user with no membership in the project (validateOwnersOnCreate and
 *     validateOwnersOnUpdate). An update checks only the owners it adds, so
 *     a rule that already names someone who has left can still be edited;
 *   - the engine, when it opens an episode, adds only the project's own
 *     teams (addOwnersToEpisode), and OwnerRuleAssignment.createOwner adds
 *     only users who are still members. A rule can outlive a member who
 *     left, or have been saved before the check above existed.
 *
 * Errors echo the ids the caller sent, never a name: resolving an id from
 * outside the project into a team or a person would leak it.
 */

export const EPISODE_OWNER_USERS_COLUMN: string = "episodeOwnerUsers";
export const EPISODE_OWNER_TEAMS_COLUMN: string = "episodeOwnerTeams";

// Postgres renders a uuid lower-cased, whatever case the payload used.
type NormalizeIdFunction = (id: string) => string;

const normalizeId: NormalizeIdFunction = (id: string): string => {
  return id.trim().toLowerCase();
};

/*
 * The ids a list names, each once in any case, in the order given. The list
 * reaches the code as related rows (a rule read from the database, or one
 * built from an API payload), { _id } objects, ObjectIDs or plain strings.
 */
type UniqueIdsFunction = (value: unknown) => Array<string>;

const uniqueIds: UniqueIdsFunction = (value: unknown): Array<string> => {
  const seen: Set<string> = new Set<string>();
  const ids: Array<string> = [];

  for (const id of resolveReferenceIds(value)) {
    const text: string = id.toString().trim();

    if (!text || seen.has(normalizeId(text))) {
      continue;
    }

    seen.add(normalizeId(text));
    ids.push(text);
  }

  return ids;
};

type DescribeIdsFunction = (ids: Array<string>) => string;

const describeIds: DescribeIdsFunction = (ids: Array<string>): string => {
  return ids
    .map((id: string): string => {
      return `"${id}"`;
    })
    .join(", ");
};

/*
 * A malformed id would fail Postgres' uuid cast and surface as an opaque
 * error. It cannot name anything in the project either, so it is simply
 * never found.
 */
type LookupIdsFunction = (ids: Array<string>) => Array<string>;

const lookupIdsOf: LookupIdsFunction = (ids: Array<string>): Array<string> => {
  return ids.filter((id: string): boolean => {
    return ObjectID.isValidUUID(id);
  });
};

export default class GroupingRuleEpisodeOwners {
  /*
   * The project's own teams among `teamIds`, in the order given. One read,
   * pinned to the project, so another project's team is never loaded.
   */
  public static async getTeamIdsInProject(data: {
    projectId: ObjectID;
    teamIds: Array<string>;
  }): Promise<Array<string>> {
    const lookupIds: Array<string> = lookupIdsOf(data.teamIds);

    if (lookupIds.length === 0) {
      return [];
    }

    const teams: Array<Team> = await TeamService.findBy({
      query: {
        _id: QueryHelper.any(lookupIds),
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      limit: lookupIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const found: Set<string> = new Set<string>(
      teams.map((team: Team): string => {
        return normalizeId(team._id?.toString() || "");
      }),
    );

    return data.teamIds.filter((id: string): boolean => {
      return found.has(normalizeId(id));
    });
  }

  /*
   * The users among `userIds` the project has a membership for, in the order
   * given: what the owner picker offers (it lists the project's TeamMember
   * rows), pending invitations included - refusing someone the picker just
   * offered would fail a save nobody could explain. The engine is stricter
   * when it adds them (OwnerRuleAssignment.createOwner): an invitation has
   * to have been accepted by then.
   */
  public static async getUserIdsInProject(data: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<Array<string>> {
    const lookupIds: Array<string> = lookupIdsOf(data.userIds);

    if (lookupIds.length === 0) {
      return [];
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: QueryHelper.any(lookupIds),
      },
      select: {
        userId: true,
      },
      // One row per team a user is in, so not one row per id.
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const found: Set<string> = new Set<string>(
      memberships.map((membership: TeamMember): string => {
        return normalizeId(membership.userId?.toString() || "");
      }),
    );

    return data.userIds.filter((id: string): boolean => {
      return found.has(normalizeId(id));
    });
  }

  /*
   * A rule being created: every owner it names must be the project's. A
   * write with no project to compare against (a root write without one) is
   * left to the required project column to refuse.
   */
  public static async validateOwnersOnCreate(data: {
    projectId: ObjectID | undefined;
    // The rule being written, in any shape a create hook sees it.
    rule: unknown;
    // Used in the error message: "incident grouping rule".
    subject: string;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const rule: Dictionary<unknown> = (data.rule || {}) as Dictionary<unknown>;

    await GroupingRuleEpisodeOwners.assertOwnersInProject({
      projectId: data.projectId,
      userIds: uniqueIds(rule[EPISODE_OWNER_USERS_COLUMN]),
      teamIds: uniqueIds(rule[EPISODE_OWNER_TEAMS_COLUMN]),
      subject: data.subject,
    });
  }

  /*
   * A rule being updated: the owners the update adds must be the project's.
   * Owners every rule the update matches already names are left alone - the
   * dashboard sends the whole list back on every save, and a member who has
   * since left the project must not lock the rule against editing (the
   * engine skips them anyway). An empty list only removes owners.
   *
   * Hooks run before the tenant narrows the query, so what the matched rules
   * hold is read per project (ProjectScopedReferenceValidator.
   * getHeldRelationIds) and only the caller's project is used; a root update
   * with no tenant is checked against each matched rule's own project.
   */
  public static async validateOwnersOnUpdate<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
    subject: string;
  }): Promise<void> {
    const payload: Dictionary<unknown> = (data.updateBy.data ||
      {}) as unknown as Dictionary<unknown>;

    const userIds: Array<string> = uniqueIds(
      payload[EPISODE_OWNER_USERS_COLUMN],
    );
    const teamIds: Array<string> = uniqueIds(
      payload[EPISODE_OWNER_TEAMS_COLUMN],
    );

    if (userIds.length === 0 && teamIds.length === 0) {
      return;
    }

    const columns: Array<string> = [];

    if (userIds.length > 0) {
      columns.push(EPISODE_OWNER_USERS_COLUMN);
    }

    if (teamIds.length > 0) {
      columns.push(EPISODE_OWNER_TEAMS_COLUMN);
    }

    const heldIds: HeldRelationIds =
      await ProjectScopedReferenceValidator.getHeldRelationIds({
        service: data.service as unknown as DatabaseService<BaseModel>,
        query: data.updateBy.query as unknown as Query<BaseModel>,
        columns: columns,
      });

    const projectIds: Array<string> = data.updateBy.props.tenantId
      ? [data.updateBy.props.tenantId.toString()]
      : Array.from(heldIds.keys());

    for (const projectId of projectIds) {
      const held: Dictionary<Set<string>> =
        heldIds.get(normalizeId(projectId)) || {};

      const isHeld: (column: string, id: string) => boolean = (
        column: string,
        id: string,
      ): boolean => {
        return Boolean(held[column]?.has(normalizeId(id)));
      };

      await GroupingRuleEpisodeOwners.assertOwnersInProject({
        projectId: new ObjectID(projectId),
        userIds: userIds.filter((id: string): boolean => {
          return !isHeld(EPISODE_OWNER_USERS_COLUMN, id);
        }),
        teamIds: teamIds.filter((id: string): boolean => {
          return !isHeld(EPISODE_OWNER_TEAMS_COLUMN, id);
        }),
        subject: data.subject,
      });
    }
  }

  /*
   * Makes the rule's people and teams owners of the episode it just opened,
   * as root. Each is added once. A team from another project is skipped and
   * logged; a user who is no longer a member is skipped by createOwner; one
   * owner that cannot be added never stops the others. Resolves to the
   * owners actually added.
   */
  public static async addOwnersToEpisode<
    TOwnerUser extends BaseModel,
    TOwnerTeam extends BaseModel,
  >(data: {
    projectId: ObjectID;
    episodeId: ObjectID;
    // The owner rows' column holding the episode id: "incidentEpisodeId".
    episodeIdColumn: string;
    ownerUserService: DatabaseService<TOwnerUser>;
    ownerTeamService: DatabaseService<TOwnerTeam>;
    // The rule's episodeOwnerUsers and episodeOwnerTeams.
    users: unknown;
    teams: unknown;
    // For the log: the rule's name, or its id.
    ruleName?: string | undefined;
  }): Promise<OwnersToAssign> {
    const added: OwnersToAssign = { userIds: [], teamIds: [] };
    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
    };

    const userIds: Array<string> = uniqueIds(data.users);
    const namedTeamIds: Array<string> = uniqueIds(data.teams);

    const teamIds: Array<string> =
      namedTeamIds.length > 0
        ? await GroupingRuleEpisodeOwners.getTeamIdsInProject({
            projectId: data.projectId,
            teamIds: namedTeamIds,
          })
        : [];

    const skippedTeamIds: Array<string> = namedTeamIds.filter(
      (id: string): boolean => {
        return !teamIds.includes(id);
      },
    );

    if (skippedTeamIds.length > 0) {
      logger.warn(
        `Grouping rule ${data.ruleName || ""} names teams that are not in this project; they were not made owners of episode ${data.episodeId.toString()}: ${describeIds(skippedTeamIds)}`,
        logAttributes,
      );
    }

    for (const userId of userIds) {
      try {
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: data.ownerUserService,
            owner: GroupingRuleEpisodeOwners.buildOwner({
              ownerService: data.ownerUserService,
              ownerColumn: "userId",
              ownerId: userId,
              episodeIdColumn: data.episodeIdColumn,
              episodeId: data.episodeId,
              projectId: data.projectId,
            }),
            props: {
              isRoot: true,
            },
          })
        ) {
          added.userIds.push(new ObjectID(userId));
        }
      } catch (error) {
        logger.error(
          `Error adding owner user ${userId} to episode ${data.episodeId.toString()}: ${error}`,
          logAttributes,
        );
      }
    }

    for (const teamId of teamIds) {
      try {
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: data.ownerTeamService,
            owner: GroupingRuleEpisodeOwners.buildOwner({
              ownerService: data.ownerTeamService,
              ownerColumn: "teamId",
              ownerId: teamId,
              episodeIdColumn: data.episodeIdColumn,
              episodeId: data.episodeId,
              projectId: data.projectId,
            }),
            props: {
              isRoot: true,
            },
          })
        ) {
          added.teamIds.push(new ObjectID(teamId));
        }
      } catch (error) {
        logger.error(
          `Error adding owner team ${teamId} to episode ${data.episodeId.toString()}: ${error}`,
          logAttributes,
        );
      }
    }

    return added;
  }

  private static async assertOwnersInProject(data: {
    projectId: ObjectID;
    userIds: Array<string>;
    teamIds: Array<string>;
    subject: string;
  }): Promise<void> {
    const teamsInProject: Set<string> = new Set<string>(
      (
        await GroupingRuleEpisodeOwners.getTeamIdsInProject({
          projectId: data.projectId,
          teamIds: data.teamIds,
        })
      ).map(normalizeId),
    );

    const usersInProject: Set<string> = new Set<string>(
      (
        await GroupingRuleEpisodeOwners.getUserIdsInProject({
          projectId: data.projectId,
          userIds: data.userIds,
        })
      ).map(normalizeId),
    );

    const foreignTeamIds: Array<string> = data.teamIds.filter(
      (id: string): boolean => {
        return !teamsInProject.has(normalizeId(id));
      },
    );

    const foreignUserIds: Array<string> = data.userIds.filter(
      (id: string): boolean => {
        return !usersInProject.has(normalizeId(id));
      },
    );

    const clauses: Array<string> = [];

    if (foreignTeamIds.length > 0) {
      clauses.push(
        foreignTeamIds.length === 1
          ? `names a team that is not in this project: ${describeIds(foreignTeamIds)}.`
          : `names teams that are not in this project: ${describeIds(foreignTeamIds)}.`,
      );
    }

    if (foreignUserIds.length > 0) {
      clauses.push(
        foreignUserIds.length === 1
          ? `names a user who is not a member of this project: ${describeIds(foreignUserIds)}.`
          : `names users who are not members of this project: ${describeIds(foreignUserIds)}.`,
      );
    }

    if (clauses.length === 0) {
      return;
    }

    throw new BadDataException(
      `This ${data.subject} ${clauses.join(" It also ")} Please pick episode owners from this project and try again.`,
    );
  }

  private static buildOwner<TOwner extends BaseModel>(data: {
    ownerService: DatabaseService<TOwner>;
    ownerColumn: "userId" | "teamId";
    ownerId: string;
    episodeIdColumn: string;
    episodeId: ObjectID;
    projectId: ObjectID;
  }): TOwner {
    const owner: TOwner = new data.ownerService.modelType();

    owner.setColumnValue("projectId", data.projectId);
    owner.setColumnValue(data.episodeIdColumn, data.episodeId);
    owner.setColumnValue(data.ownerColumn, new ObjectID(data.ownerId));

    return owner;
  }
}
