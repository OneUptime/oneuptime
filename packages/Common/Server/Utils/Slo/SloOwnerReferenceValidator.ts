import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import QueryHelper from "../../Types/Database/QueryHelper";
import SloRecordReferenceValidator from "./SloRecordReferenceValidator";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * An SLO owner row names a user or a team, and nothing in the framework checks
 * either against the row's project: DatabaseService only stamps the row's own
 * projectId from the caller. Owners are who hears about an SLO, so a stranger
 * named as one is a leak in both directions:
 *
 * - SendOwnerAddedNotification emails every owner (and every member of an
 *   owner team) this project's SLO name, project name and link;
 * - ServiceLevelObjectiveService.findOwners reads owners by SLO id alone, so a
 *   burn rate rule with addSloOwnersAsOwners adds them to its alerts and
 *   incidents;
 * - the SLO feed names the user - email included when they are removed - and
 *   the team, read as root.
 *
 * Both checks read pinned to the row's project and select nothing but ids, so
 * a user or team from elsewhere is never loaded. An id from another project and
 * an id that matches nothing get the same answer, which echoes only the ids the
 * caller sent - never a name or an email.
 */

// Postgres renders a uuid lower-cased whatever case the payload used.
type NormalizeIdFunction = (id: string) => string;

const normalizeId: NormalizeIdFunction = (id: string): string => {
  return id.trim().toLowerCase();
};

type DescribeIdsFunction = (ids: Array<string>) => string;

const describeIds: DescribeIdsFunction = (ids: Array<string>): string => {
  return ids
    .map((id: string): string => {
      return `"${id}"`;
    })
    .join(", ");
};

// The ids a pinned lookup found, as the database returned them.
type FindIdsFunction = (lookupIds: Array<string>) => Promise<Array<string>>;

export default class SloOwnerReferenceValidator {
  /*
   * Team membership is what "in this project" means for a user, and it is
   * exactly the set the dashboard's owner picker offers (AddOwnerPopover lists
   * the project's TeamMember rows). Pending invitations count for that reason:
   * refusing a user the picker just offered would fail a save nobody could
   * explain. It is the rule ServiceLevelObjectiveBurnRateRuleService applies to
   * a burn rate rule's alert and incident owner users.
   */
  public static async validateUsersAreProjectMembers(data: {
    projectId: ObjectID | undefined;
    // The userId column and/or the user relation, in any shape a hook sees.
    users: unknown;
    // Used in the error message, e.g. "SLO owner user".
    subject: string;
  }): Promise<void> {
    const ids: Array<string> = SloRecordReferenceValidator.getReferencedIds(
      data.users,
    );

    if (ids.length === 0 || !data.projectId) {
      /*
       * Same rule as SloRecordReferenceValidator: with no project to compare
       * against the check is a no-op, and the required tenant column fails the
       * write instead.
       */
      return;
    }

    const projectId: ObjectID = data.projectId;

    const nonMemberIds: Array<string> =
      await SloOwnerReferenceValidator.getUnmatchedIds({
        ids: ids,
        findIds: async (lookupIds: Array<string>): Promise<Array<string>> => {
          const memberships: Array<TeamMember> = await TeamMemberService.findBy(
            {
              query: {
                // Pinned: a membership in another project is never read.
                projectId: projectId,
                userId: QueryHelper.any(lookupIds),
              },
              select: {
                userId: true,
              },
              // One row per team the user is in, so not one row per id.
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            },
          );

          return memberships.map((membership: TeamMember): string => {
            return membership.userId?.toString() || "";
          });
        },
      });

    if (nonMemberIds.length === 0) {
      return;
    }

    throw new BadDataException(
      nonMemberIds.length === 1
        ? `This ${data.subject} names a user who is not a member of this project: ${describeIds(nonMemberIds)}. Please pick a user from this project and try again.`
        : `This ${data.subject} names users who are not members of this project: ${describeIds(nonMemberIds)}. Please pick users from this project and try again.`,
    );
  }

  public static async validateTeamsBelongToProject(data: {
    projectId: ObjectID | undefined;
    // The teamId column and/or the team relation, in any shape a hook sees.
    teams: unknown;
    // Used in the error message, e.g. "SLO owner team".
    subject: string;
  }): Promise<void> {
    const ids: Array<string> = SloRecordReferenceValidator.getReferencedIds(
      data.teams,
    );

    if (ids.length === 0 || !data.projectId) {
      // Nothing to compare against, as above.
      return;
    }

    const projectId: ObjectID = data.projectId;

    const unknownTeamIds: Array<string> =
      await SloOwnerReferenceValidator.getUnmatchedIds({
        ids: ids,
        findIds: async (lookupIds: Array<string>): Promise<Array<string>> => {
          const teams: Array<Team> = await TeamService.findBy({
            query: {
              _id: QueryHelper.any(lookupIds),
              // Pinned: another project's team is never read.
              projectId: projectId,
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

          return teams.map((team: Team): string => {
            return team._id?.toString() || "";
          });
        },
      });

    if (unknownTeamIds.length === 0) {
      return;
    }

    throw new BadDataException(
      unknownTeamIds.length === 1
        ? `This ${data.subject} references a team that does not exist in this project: ${describeIds(unknownTeamIds)}. Please pick a team from this project and try again.`
        : `This ${data.subject} references teams that do not exist in this project: ${describeIds(unknownTeamIds)}. Please pick teams from this project and try again.`,
    );
  }

  /*
   * The requested ids the pinned lookup did not return, in the order and case
   * the caller sent them.
   */
  private static async getUnmatchedIds(data: {
    ids: Array<string>;
    findIds: FindIdsFunction;
  }): Promise<Array<string>> {
    /*
     * A malformed id would make Postgres reject the uuid cast and surface as an
     * opaque 500. It cannot match anything in this project either, so it gets
     * the same answer as a foreign id, without a query.
     */
    const lookupIds: Array<string> = data.ids.filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    const foundIds: Set<string> = new Set<string>();

    if (lookupIds.length > 0) {
      for (const foundId of await data.findIds(lookupIds)) {
        if (foundId) {
          foundIds.add(normalizeId(foundId));
        }
      }
    }

    return data.ids.filter((id: string): boolean => {
      return !foundIds.has(normalizeId(id));
    });
  }
}
