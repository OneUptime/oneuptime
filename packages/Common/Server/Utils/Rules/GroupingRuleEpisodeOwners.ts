import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../Models/DatabaseModels/Team";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import TeamMemberService from "../../Services/TeamMemberService";
import ProjectScopedReferenceValidator, {
  resolveReferenceId,
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
 * was sent the owner-added notification about it.
 *
 * Owners a rule sets follow the rule owners set by hand follow - the
 * episode's Owners page and the rule's own people picker offer only the
 * project's teams and members:
 *
 *   - a rule refuses, when it is saved, a team from another project or a
 *     user with no membership in the project - like every other list it
 *     saves (its monitors, labels, on-call policies, episode labels and
 *     roles) and its old default assignee pair. The rule services are
 *     ProjectReferencesServices (see ProjectReferenceCheck). An update
 *     checks only the ids it adds, so a rule that already names someone who
 *     has left can still be edited;
 *   - the engine, when it opens an episode, adds only the project's own
 *     teams (addOwnersToEpisode), and OwnerRuleAssignment.createOwner adds
 *     only users who are members by then. A rule can outlive a member who
 *     left, name someone whose invitation is still pending (they become an
 *     owner of the episodes opened once they have joined), or have been
 *     saved before the check above existed.
 *
 * The rule's old default assignee (defaultAssignToTeamId,
 * defaultAssignToUserId), which the engines still copy to the episode's
 * assignedToTeam and assignedToUser for API readers, is copied only while it
 * still names the project's own team and a member (getLegacyAssigneeInProject):
 * the engine writes nothing as root that it would not let a person write.
 *
 * Logs echo the ids the rule holds, never a name: resolving an id from
 * outside the project into a team would leak it.
 */

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

export interface LegacyAssigneeInProject {
  userId: ObjectID | null;
  teamId: ObjectID | null;
}

export default class GroupingRuleEpisodeOwners {
  /*
   * The project's own teams among `teamIds`, in the order given. One read,
   * pinned to the project (ProjectScopedReferenceValidator.keepIdsInProject),
   * so another project's team is never loaded.
   */
  public static async getTeamIdsInProject(data: {
    projectId: ObjectID;
    teamIds: Array<string>;
  }): Promise<Array<string>> {
    return await ProjectScopedReferenceValidator.keepIdsInProject({
      modelType: Team,
      projectId: data.projectId,
      ids: data.teamIds,
    });
  }

  /*
   * Makes the rule's people and teams owners of the episode it just opened,
   * as root. Each is added once. A user who is not a member by now is
   * skipped by createOwner, and a team from another project is skipped and
   * logged. One owner that cannot be added never stops the others: people
   * are added before the teams are looked up, and a failed lookup costs the
   * teams only. Resolves to the owners actually added.
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

    type AddOwnerFunction = <TOwner extends BaseModel>(owner: {
      ownerService: DatabaseService<TOwner>;
      ownerColumn: "userId" | "teamId";
      ownerId: string;
    }) => Promise<boolean>;

    const addOwner: AddOwnerFunction = async <TOwner extends BaseModel>(owner: {
      ownerService: DatabaseService<TOwner>;
      ownerColumn: "userId" | "teamId";
      ownerId: string;
    }): Promise<boolean> => {
      try {
        return await OwnerRuleAssignment.createOwner({
          ownerService: owner.ownerService,
          owner: OwnerRuleAssignment.buildOwner({
            ownerService: owner.ownerService,
            ownerColumn: owner.ownerColumn,
            ownerId: new ObjectID(owner.ownerId),
            resourceIdColumn: data.episodeIdColumn,
            resourceId: data.episodeId,
            projectId: data.projectId,
          }),
          props: {
            isRoot: true,
          },
        });
      } catch (error) {
        logger.error(
          `Error adding owner ${owner.ownerColumn === "userId" ? "user" : "team"} ${owner.ownerId} to episode ${data.episodeId.toString()}: ${error}`,
          logAttributes,
        );

        return false;
      }
    };

    for (const userId of uniqueIds(data.users)) {
      if (
        await addOwner({
          ownerService: data.ownerUserService,
          ownerColumn: "userId",
          ownerId: userId,
        })
      ) {
        added.userIds.push(new ObjectID(userId));
      }
    }

    const namedTeamIds: Array<string> = uniqueIds(data.teams);

    if (namedTeamIds.length === 0) {
      return added;
    }

    let teamIds: Array<string> = [];

    try {
      teamIds = await GroupingRuleEpisodeOwners.getTeamIdsInProject({
        projectId: data.projectId,
        teamIds: namedTeamIds,
      });
    } catch (error) {
      logger.error(
        `Error reading the teams grouping rule ${data.ruleName || ""} names, so no team was made an owner of episode ${data.episodeId.toString()}: ${error}`,
        logAttributes,
      );

      return added;
    }

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

    for (const teamId of teamIds) {
      if (
        await addOwner({
          ownerService: data.ownerTeamService,
          ownerColumn: "teamId",
          ownerId: teamId,
        })
      ) {
        added.teamIds.push(new ObjectID(teamId));
      }
    }

    return added;
  }

  /*
   * The rule's old default assignee, as the engine may copy it to a new
   * episode: the team while it is the project's, the user while they are a
   * member (accepted, as createOwner asks of an owner). Whatever else it
   * names - another project's team, someone who has left - is left off the
   * episode. Nothing shows the copy, so a failed lookup leaves both off
   * rather than fail the episode.
   */
  public static async getLegacyAssigneeInProject(data: {
    projectId: ObjectID;
    userId: unknown;
    teamId: unknown;
    ruleName?: string | undefined;
  }): Promise<LegacyAssigneeInProject> {
    const result: LegacyAssigneeInProject = { userId: null, teamId: null };
    const userId: string = resolveReferenceId(data.userId)?.toString() || "";
    const teamId: string = resolveReferenceId(data.teamId)?.toString() || "";

    if (!userId && !teamId) {
      return result;
    }

    try {
      const [teamIds, isMember]: [Array<string>, boolean] = await Promise.all([
        teamId
          ? GroupingRuleEpisodeOwners.getTeamIdsInProject({
              projectId: data.projectId,
              teamIds: [teamId],
            })
          : Promise.resolve([] as Array<string>),
        userId && ObjectID.isValidUUID(userId)
          ? TeamMemberService.isUserMemberOfProject({
              projectId: data.projectId,
              userId: new ObjectID(userId),
            })
          : Promise.resolve(false),
      ]);

      result.teamId = teamIds.length > 0 ? new ObjectID(teamId) : null;
      result.userId = isMember ? new ObjectID(userId) : null;
    } catch (error) {
      logger.error(
        `Error checking the default assignee of grouping rule ${data.ruleName || ""}; it was not copied to the episode: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }

    return result;
  }
}
