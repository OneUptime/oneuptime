import TeamService from "Common/Server/Services/TeamService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import Team from "Common/Models/DatabaseModels/Team";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { isSameName } from "Common/Types/Database/UniqueName";
import ObjectID from "Common/Types/ObjectID";

/*
 * WHICH TEAM A PUSHED GROUP IS (#9743).
 *
 * A team's name is one team's in its project, compared as it reads
 * (Common/Types/Database/UniqueName, #9674): "engineering", "Engineering "
 * and "Engineering" are one name. SCIM looked a pushed group's team up by
 * the name exactly as written, so an identity provider that pushed
 * "Engineering" into a project that had "engineering" made a second team,
 * one every picker drew alike - and as OneUptime's own write, SCIM is never
 * refused a name, so nothing stopped it.
 *
 * A pushed group now takes the team whose name reads as the group's:
 *
 *   - Spelled exactly as the group is, it is the group: what an identity
 *     provider pushes again after a timeout, or after it lost the ids it
 *     kept (a reinstalled app, provisioning restarted).
 *   - Spelled another way, it is taken only while no identity provider
 *     holds it as a group already (Team.scimGroupLinkedAt) and it is a
 *     team people made, not one OneUptime keeps (Owners, Admin, Members,
 *     Unassigned: those are taken by their exact name only, as before).
 *     A team a provider holds already is another of its groups: two groups
 *     whose names read alike - Microsoft Entra ID lets two groups be called
 *     "Engineering" and "engineering" - each get a team of their own, and
 *     are never made one.
 *   - Of several, the one spelled exactly as the group comes first, then
 *     the oldest. The others are left as they are: no team is merged into
 *     another, and no member is moved.
 *
 * A team taken by its name in another spelling is renamed to the group's
 * spelling, the provider's name for it - so that when the provider pushes
 * it again, it finds it by its exact name.
 *
 * Every other flow finds a group by its id: a rename (PUT, PATCH) renames
 * that team, even to a name that reads like another team's - the provider
 * named it, and is never refused - and so never takes that other team. The
 * displayName filter (how Okta and Microsoft Entra ID look a group up
 * before they push it) answers by the same rule as a push, so the id a
 * provider keeps is the same either way.
 *
 * A team is held by a provider from the moment SCIM makes or takes it for a
 * pushed group, or the provider reads or changes it by its id, which only a
 * provider that holds it does: so teams pushed before this was kept are
 * known from the provider's next sync.
 */

// What SCIM reads of a team, to say it as a group and to match it.
export const SCIM_GROUP_SELECT: Select<Team> = {
  _id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  projectId: true,
  isTeamEditable: true,
  scimGroupLinkedAt: true,
};

// What a match reads of a team.
export interface ScimGroupCandidate {
  name?: string | undefined;
  createdAt?: Date | undefined;
  isTeamEditable?: boolean | undefined;
  scimGroupLinkedAt?: Date | undefined;
}

// Whether a team is the group `displayName` names, by the rule above.
export const isTeamOfPushedGroup: (data: {
  team: ScimGroupCandidate;
  displayName: string;
}) => boolean = (data: {
  team: ScimGroupCandidate;
  displayName: string;
}): boolean => {
  const name: string = data.team.name || "";

  if (!name || !data.displayName) {
    return false;
  }

  if (name === data.displayName) {
    return true;
  }

  return (
    isSameName(name, data.displayName) &&
    !data.team.scimGroupLinkedAt &&
    data.team.isTeamEditable !== false
  );
};

/*
 * The teams that are the group, in the order a push takes them: spelled
 * exactly as the group first, then the oldest.
 */
export const getTeamsOfPushedGroup: <T extends ScimGroupCandidate>(data: {
  teams: Array<T>;
  displayName: string;
}) => Array<T> = <T extends ScimGroupCandidate>(data: {
  teams: Array<T>;
  displayName: string;
}): Array<T> => {
  const createdAt: (team: T) => number = (team: T): number => {
    return team.createdAt ? new Date(team.createdAt).getTime() : 0;
  };

  return data.teams
    .filter((team: T): boolean => {
      return isTeamOfPushedGroup({ team, displayName: data.displayName });
    })
    .sort((left: T, right: T): number => {
      const leftIsExact: boolean = left.name === data.displayName;
      const rightIsExact: boolean = right.name === data.displayName;

      if (leftIsExact !== rightIsExact) {
        return leftIsExact ? -1 : 1;
      }

      return createdAt(left) - createdAt(right);
    });
};

// What a push did with a group: took a team, or makes one.
export interface PushedGroupTeam {
  team: Team;
  // Taken by its name in another spelling, and renamed to the group's.
  renamedFrom: string | null;
}

export default class SCIMGroupMatch {
  /*
   * The project's teams whose names read as `displayName`, oldest first,
   * as OneUptime: every one of them, held by a provider or not, so a
   * caller can say which it took and which it left.
   */
  public static async findTeamsNamedAlike(data: {
    projectId: ObjectID;
    displayName: string;
  }): Promise<Array<Team>> {
    return await TeamService.findBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameName(data.displayName),
      },
      select: SCIM_GROUP_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * The team a push of `displayName` takes, marked as the provider's group
   * and renamed to the group's spelling when it was taken by another; null
   * when there is none, and the push makes a team.
   */
  public static async takeTeamForPushedGroup(data: {
    projectId: ObjectID;
    displayName: string;
  }): Promise<PushedGroupTeam | null> {
    const team: Team | undefined = getTeamsOfPushedGroup({
      teams: await SCIMGroupMatch.findTeamsNamedAlike(data),
      displayName: data.displayName,
    })[0];

    if (!team) {
      return null;
    }

    const previousName: string = team.name || "";
    let renamedFrom: string | null = null;

    /*
     * The provider's spelling, so its next push finds the team by its exact
     * name. As a rename by the provider is (the PUT route's): OneUptime's
     * own write, never refused a name. Only a team people made is ever
     * taken in another spelling, so OneUptime's own teams are never renamed.
     * Never in the way of the push: the team is taken either way, and the
     * provider renames it on its next update.
     */
    if (previousName !== data.displayName) {
      try {
        await TeamService.updateOneById({
          id: team.id!,
          data: { name: data.displayName },
          props: { isRoot: true },
        });

        team.name = data.displayName;
        renamedFrom = previousName;
      } catch (error) {
        logger.error(
          `SCIM - could not rename team ${team.id?.toString()} to the pushed group's name: ${error}`,
        );
      }
    }

    await SCIMGroupMatch.markHeldByProvider(team);

    return { team: team, renamedFrom: renamedFrom };
  }

  /*
   * Notes that the provider holds `team` as a group, when nothing had: a
   * push that made or took it, or a read or a change of it by its id.
   * Bookkeeping only, so written without the team's hooks: Owners and
   * Admin, which no update may change, are marked too. Never in the way of
   * the request - a provider is never refused for this - so a failure is
   * logged and passed.
   */
  public static async markHeldByProvider(team: {
    id?: ObjectID | null | undefined;
    scimGroupLinkedAt?: Date | undefined;
  }): Promise<void> {
    if (!team.id || team.scimGroupLinkedAt) {
      return;
    }

    try {
      const now: Date = OneUptimeDate.getCurrentDate();

      await TeamService.updateOneById({
        id: team.id,
        data: { scimGroupLinkedAt: now },
        props: { isRoot: true, ignoreHooks: true },
      });

      team.scimGroupLinkedAt = now;
    } catch (error) {
      logger.error(
        `SCIM - could not note that the identity provider holds team ${team.id.toString()} as a group: ${error}`,
      );
    }
  }
}
