import ProjectReferencesService from "./ProjectReferencesService";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import Timezone from "../../Types/Timezone";
import DeleteBy from "../Types/Database/DeleteBy";
import logger from "../Utils/Logger";
import { OnCallShiftChangeReason } from "../Utils/OnCall/OnCallShiftChangeListeners";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../Utils/Markdown/FeedMarkdown";
import OnCallChatByWorkspace, {
  OnCallChatTextByWorkspaceType,
  OnCallChatWriter,
} from "../Utils/OnCall/OnCallChatByWorkspace";
import OnCallChatText from "../Utils/OnCall/OnCallChatText";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../Utils/TeamMember/PendingInviteeProfiles";
import WorkspaceMessageTime from "../Utils/Workspace/WorkspaceMessageTime";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import Permission, { UserPermission } from "../../Types/Permission";
import GlobalUserOverrideAccess, {
  GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
  GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
  GLOBAL_USER_OVERRIDE_EDIT_REFUSAL,
} from "../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import CreateScopeException from "../Types/Database/Permissions/CreateScopeException";
import CallerPermission from "../Utils/Permission/CallerPermission";
import { UserOverrideAddAccess } from "../../Types/OnCallDutyPolicy/UserOverrideAddAccess";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import CreateLimit from "../Types/Database/CreateLimit";
import UpdateLimit from "../Types/Database/UpdateLimit";
import User from "../../Models/DatabaseModels/User";
import UserOverrideOverlap, {
  USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
  UserOverrideSentence,
  UserOverrideTimes,
} from "../../Types/OnCallDutyPolicy/UserOverrideOverlap";
import UserOverrideEdit, {
  USER_OVERRIDE_ENDED_REFUSAL,
  UserOverrideTimesChange,
} from "../../Types/OnCallDutyPolicy/UserOverrideEdit";
import { fillTemplate } from "../../Types/Translator";
import UserOverrideTeamAccess, {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_COVER_REFUSAL,
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
  USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL,
  USER_OVERRIDE_TEAM_PERMISSION,
} from "../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import HeldPermissionsUtil, {
  HeldPermissions,
  TeamGrant,
  TeamGrants,
} from "../../Types/HeldPermissions";
import PropsHoldingOnly from "../Utils/Permission/PropsHoldingOnly";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import Query from "../../Types/BaseDatabase/Query";
import TeamMemberService from "./TeamMemberService";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Exception from "../../Types/Exception/Exception";
import {
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  MoreThan,
  Not,
} from "typeorm";

/*
 * The (project, overridden user, substitute) triple an override names; the
 * hooks capture it before an update / delete so the schedules of the OLD
 * users can be refreshed and re-versioned once the row has changed.
 */
interface OverrideUserPair {
  projectId: ObjectID;
  overrideUserId: ObjectID;
  routeAlertsToUserId?: ObjectID | undefined;
}

/*
 * An override as an edit found it, before the edit: what onUpdateSuccess
 * says changed in the policy's feed.
 */
interface OverrideBeforeEdit {
  id: string;
  projectId: ObjectID;
  onCallDutyPolicyId: ObjectID | null;
  overrideUserId: ObjectID;
  routeAlertsToUserId: ObjectID | null;
  startsAt: Date;
  endsAt: Date;
}

// What onBeforeUpdate hands onUpdateSuccess.
interface OverrideUpdateCarryForward {
  // The people the overrides named before the edit, for the roster refresh.
  pairs: Array<OverrideUserPair>;
  before: Array<OverrideBeforeEdit>;
}

// A write of overrides, as the team rule asks about it (checkTeamAccess).
type UserOverrideWrite = "create" | "update" | "delete";

/*
 * An override a write adds, edits or deletes, as the team rule weighs it:
 * the people it names - as saved, or as an add sends them - and where.
 */
interface OverrideNamingPeople {
  // Its id; null for one being added.
  id: string | null;
  // Its policy; null for a global override.
  onCallDutyPolicyId: string | null;
  awayUserId: string | null;
  // Null for a skip: the rotation covers.
  coverUserId: string | null;
}

// The key an override being added is asked about under.
const NEW_OVERRIDE_KEY: string = "new";

/*
 * The lock every add of an override, and every edit of its times, takes in
 * its project (ProjectLimitLock, through getCreateLimit and getUpdateLimit):
 * they are decided one after another, each with what the one before it
 * saved, so two that overlap cannot both be saved (UserOverrideOverlap).
 */
export const USER_OVERRIDE_TIMES_LIMIT_NAME: string = "user-override-times";

// What the overlap check reads of an override, through the lock's transaction.
const OVERLAP_COLUMNS: Record<string, boolean> = {
  _id: true,
  projectId: true,
  onCallDutyPolicyId: true,
  overrideUserId: true,
  routeAlertsToUserId: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
};

// An id the database handed back, as text: "" for none.
const idText: (value: unknown) => string = (value: unknown): string => {
  if (!value) {
    return "";
  }

  return value.toString();
};

/*
 * How many of the same person's overrides in the way the overlap check
 * reads, to name the one used first: more than one is in the way only where
 * overlaps were saved before the rule.
 */
const OVERLAP_CONFLICTS_READ: number = 50;

// An override the overlap check read, as UserOverrideOverlap weighs it.
const toOverlapTimes: (
  row: OnCallDutyPolicyUserOverride,
) => UserOverrideTimes = (
  row: OnCallDutyPolicyUserOverride,
): UserOverrideTimes => {
  return {
    id: idText(row._id) || null,
    overrideUserId: idText(row.overrideUserId),
    onCallDutyPolicyId: idText(row.onCallDutyPolicyId) || null,
    routeAlertsToUserId: idText(row.routeAlertsToUserId) || null,
    startsAt: OneUptimeDate.fromString(row.startsAt!),
    endsAt: OneUptimeDate.fromString(row.endsAt!),
    createdAt: row.createdAt ? OneUptimeDate.fromString(row.createdAt) : null,
  };
};

// An override an edit or a delete read, as the team rule weighs it.
const toOverrideNamingPeople: (
  row: OnCallDutyPolicyUserOverride,
) => OverrideNamingPeople = (
  row: OnCallDutyPolicyUserOverride,
): OverrideNamingPeople => {
  return {
    id: idText(row._id) || null,
    onCallDutyPolicyId:
      idText(row.onCallDutyPolicyId || row.onCallDutyPolicy?.id) || null,
    awayUserId: idText(row.overrideUserId || row.overrideUser?.id) || null,
    coverUserId:
      idText(row.routeAlertsToUserId || row.routeAlertsToUser?.id) || null,
  };
};

/*
 * The subset of OnCallDutyPolicyScheduleService the override hooks call.
 * Lazily required (see refreshRostersForOverrideUser) because that service
 * imports this one.
 */
interface ScheduleServiceForOverrides {
  refreshRostersForUserInProject: (d: {
    projectId: ObjectID;
    userId: ObjectID;
  }) => Promise<void>;
  getScheduleIdsForUsersInProject: (d: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }) => Promise<Array<ObjectID>>;
  propagateShiftConfigChange: (d: {
    scheduleIds: Array<ObjectID>;
    projectId?: ObjectID | null | undefined;
    userIds?: Array<ObjectID> | undefined;
    reason: OnCallShiftChangeReason;
  }) => Promise<void>;
}

export class Service extends ProjectReferencesService<OnCallDutyPolicyUserOverride> {
  public constructor() {
    super(OnCallDutyPolicyUserOverride);
  }

  private getScheduleService(): ScheduleServiceForOverrides {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("./OnCallDutyPolicyScheduleService").default;
  }

  /**
   * An override changes who is on call on every schedule that contains the
   * overridden user, and it changes the SUBSTITUTE's personal calendar too.
   * Find those schedules with the same layer-user query the roster refresh
   * uses (for every overridden user, old and new), then bump their
   * shiftConfigVersion, drop the feed caches — the substitutes' personal
   * caches included — and let the shift-change listeners re-plan reminders.
   * One call per project; best-effort, never throws into the CRUD path.
   */
  private async propagateShiftChangeForOverrides(
    pairs: Array<OverrideUserPair>,
  ): Promise<void> {
    const byProject: Map<
      string,
      {
        projectId: ObjectID;
        overrideUserIds: Array<ObjectID>;
        allUserIds: Array<ObjectID>;
      }
    > = new Map();

    for (const pair of pairs) {
      if (!pair.projectId || !pair.overrideUserId) {
        continue;
      }

      const key: string = pair.projectId.toString();
      const entry: {
        projectId: ObjectID;
        overrideUserIds: Array<ObjectID>;
        allUserIds: Array<ObjectID>;
      } = byProject.get(key) || {
        projectId: pair.projectId,
        overrideUserIds: [],
        allUserIds: [],
      };

      entry.overrideUserIds.push(pair.overrideUserId);
      entry.allUserIds.push(pair.overrideUserId);

      if (pair.routeAlertsToUserId) {
        entry.allUserIds.push(pair.routeAlertsToUserId);
      }

      byProject.set(key, entry);
    }

    for (const entry of byProject.values()) {
      try {
        const scheduleService: ScheduleServiceForOverrides =
          this.getScheduleService();

        const scheduleIds: Array<ObjectID> =
          await scheduleService.getScheduleIdsForUsersInProject({
            projectId: entry.projectId,
            userIds: entry.overrideUserIds,
          });

        await scheduleService.propagateShiftConfigChange({
          scheduleIds,
          projectId: entry.projectId,
          userIds: entry.allUserIds,
          reason: OnCallShiftChangeReason.OverrideChanged,
        });
      } catch (err) {
        logger.error(
          "Error propagating a user override change to the calendar feeds (best-effort).",
        );
        logger.error(err);
      }
    }
  }

  /**
   * Re-resolve the persisted roster of every schedule in the project that
   * contains the override user, so a created / updated / deleted override is
   * reflected in the dashboard roster, handoff notifications and on-call time
   * logs mid-period instead of only at the next natural handoff (audit F4).
   * Best-effort: never throws into the CRUD path. Lazy require avoids a static
   * circular import (OnCallDutyPolicyScheduleService imports this service).
   */
  private async refreshRostersForOverrideUser(data: {
    projectId: ObjectID | null | undefined;
    overrideUserId: ObjectID | null | undefined;
  }): Promise<void> {
    if (!data.projectId || !data.overrideUserId) {
      return;
    }

    try {
      const scheduleService: ScheduleServiceForOverrides =
        this.getScheduleService();

      await scheduleService.refreshRostersForUserInProject({
        projectId: data.projectId,
        userId: data.overrideUserId,
      });
    } catch (err) {
      logger.error(
        "Error refreshing rosters after a user override change (best-effort).",
      );
      logger.error(err);
    }
  }

  /*
   * A GLOBAL OVERRIDE TAKES A PERMISSION OVER THE WHOLE PROJECT
   * (GlobalUserOverrideAccess). An override that names no policy applies to
   * every on-call policy, another team's as much as the caller's own, so
   * adding, editing or deleting one takes the table's permission for it
   * held over the whole project - not limited to labels or to owned
   * policies, and not blocked for some labels (issue #5617). OneUptime
   * itself and a master admin add, edit and delete any: removing a member
   * who leaves deletes theirs.
   */
  private checkGlobalOverrideAccess(
    props: DatabaseCommonInteractionProps,
    action: "create" | "update" | "delete",
  ): void {
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    const model: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();

    let permissions: Array<Permission> = model.getDeletePermissions() || [];

    if (action === "create") {
      permissions = model.getCreatePermissions() || [];
    } else if (action === "update") {
      permissions = model.getUpdatePermissions() || [];
    }

    if (
      GlobalUserOverrideAccess.mayChange(
        CallerPermission.getHeld(props),
        permissions,
      )
    ) {
      return;
    }

    if (action === "create") {
      throw new CreateScopeException(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
    }

    if (action === "update") {
      throw new NotAuthorizedException(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
    }

    throw new NotAuthorizedException(GLOBAL_USER_OVERRIDE_DELETE_REFUSAL);
  }

  /*
   * USER OVERRIDES FOR THE PEOPLE OF ONE'S OWN TEAM (issue #9733,
   * Types/OnCallDutyPolicy/UserOverrideTeamAccess). Manage On-Call Policy
   * User Overrides for Own Team writes overrides as the table's other
   * permissions do, and only for the people of the teams that give it. Each
   * override a write adds, edits or deletes is refused when the caller
   * reaches it only through that permission and it names somebody - away or
   * covering, as saved, or as the edit leaves it - who is not an accepted
   * member of a team whose grant of it reaches the override.
   *
   * Asked of a caller who holds the team permission and no permission of
   * the write's list that reaches every person over the whole project:
   * anyone else writes as before. Such a permission narrowed to some labels,
   * or to owned policies, still reaches the overrides on those policies, so
   * the write's own checks are asked first with every row of the caller's
   * but the team permission's (PropsHoldingOnly.buildWithout): what those
   * reach is written as before. A team's grant over the whole project
   * reaches every override the write's checks let through; one narrowed to
   * labels or owned policies reaches no global override, and the overrides
   * on the policies it reaches - asked with the caller's rows less the
   * other teams' grants of it. A grant no team gives (an API key's) reaches
   * nobody.
   *
   * `getReached` is the write's own checks asked with fewer of the
   * caller's rows: the keys (getTeamCheckKey) of `overrides` a caller with
   * those rows may write. `sentAwayUserId` and `sentCoverUserId` are the
   * people an edit names instead - whoever covers from now on - held to
   * the same teams.
   */
  private async checkTeamAccess(data: {
    write: UserOverrideWrite;
    props: DatabaseCommonInteractionProps;
    overrides: Array<OverrideNamingPeople>;
    sentAwayUserId?: string | null | undefined;
    sentCoverUserId?: string | null | undefined;
    getReached: (props: DatabaseCommonInteractionProps) => Promise<Set<string>>;
  }): Promise<void> {
    const props: DatabaseCommonInteractionProps = data.props;
    const projectId: ObjectID | undefined = props.tenantId;

    if (
      props.isRoot ||
      props.isMasterAdmin ||
      !projectId ||
      data.overrides.length === 0
    ) {
      return;
    }

    const held: HeldPermissions = CallerPermission.getHeld(props);
    const modelPermissions: Array<Permission> = this.getWritePermissions(
      data.write,
    );

    if (
      !UserOverrideTeamAccess.holdsTeamPermission(held) ||
      UserOverrideTeamAccess.reachesEveryone(held, modelPermissions)
    ) {
      return;
    }

    // What the caller's other permissions reach on their own: as before.
    const reachedWithoutTeams: Set<string> =
      UserOverrideTeamAccess.holdsEveryonePermission(held, modelPermissions)
        ? await data.getReached(
            PropsHoldingOnly.buildWithout({
              databaseProps: props,
              projectId: projectId,
              isLeftOut: (row: UserPermission): boolean => {
                return row.permission === USER_OVERRIDE_TEAM_PERMISSION;
              },
            }),
          )
        : new Set<string>();

    const limited: Array<OverrideNamingPeople> = data.overrides.filter(
      (override: OverrideNamingPeople): boolean => {
        return !reachedWithoutTeams.has(this.getTeamCheckKey(override));
      },
    );

    if (limited.length === 0) {
      return;
    }

    const teamsByOverride: Map<
      string,
      Array<string>
    > = await this.getReachingTeams({
      props: props,
      projectId: projectId,
      overrides: limited,
      getReached: data.getReached,
    });

    // Every person named, and the teams of theirs among those.
    const people: Array<string> = [];

    for (const userId of [
      ...limited.flatMap((override: OverrideNamingPeople) => {
        return [override.awayUserId, override.coverUserId];
      }),
      data.sentAwayUserId,
      data.sentCoverUserId,
    ]) {
      const key: string = idText(userId).toLowerCase();

      if (key && !people.includes(key)) {
        people.push(key);
      }
    }

    const teamIds: Array<string> = Array.from(
      new Set(Array.from(teamsByOverride.values()).flat()),
    );

    const teamsOfPerson: Map<string, Set<string>> = await this.getTeamsOfPeople(
      {
        projectId: projectId,
        teamIds: teamIds,
        userIds: people,
      },
    );

    for (const override of limited) {
      const teams: Array<string> =
        teamsByOverride.get(this.getTeamCheckKey(override)) || [];

      if (teams.length === 0) {
        throw this.getTeamRefusal(
          data.write,
          USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL,
        );
      }

      // Nobody named (a skip's cover) is no one outside.
      const isInTeams: (userId: string | null | undefined) => boolean = (
        userId: string | null | undefined,
      ): boolean => {
        const key: string = idText(userId).toLowerCase();

        if (!key) {
          return true;
        }

        const ofPerson: Set<string> | undefined = teamsOfPerson.get(key);

        return Boolean(
          ofPerson &&
            teams.some((teamId: string): boolean => {
              return ofPerson.has(teamId);
            }),
        );
      };

      if (data.write === "create") {
        if (!isInTeams(override.awayUserId)) {
          throw this.getTeamRefusal(
            data.write,
            USER_OVERRIDE_TEAM_AWAY_REFUSAL,
          );
        }

        if (!isInTeams(override.coverUserId)) {
          throw this.getTeamRefusal(
            data.write,
            USER_OVERRIDE_TEAM_COVER_REFUSAL,
          );
        }

        continue;
      }

      // The override as saved names somebody else: it is not theirs to touch.
      if (!isInTeams(override.awayUserId) || !isInTeams(override.coverUserId)) {
        throw this.getTeamRefusal(
          data.write,
          data.write === "update"
            ? USER_OVERRIDE_TEAM_EDIT_REFUSAL
            : USER_OVERRIDE_TEAM_DELETE_REFUSAL,
        );
      }

      // Nor is the edit's: whoever it names instead.
      if (!isInTeams(data.sentAwayUserId)) {
        throw this.getTeamRefusal(data.write, USER_OVERRIDE_TEAM_AWAY_REFUSAL);
      }

      if (!isInTeams(data.sentCoverUserId)) {
        throw this.getTeamRefusal(data.write, USER_OVERRIDE_TEAM_COVER_REFUSAL);
      }
    }
  }

  // The table's permissions for a write: its create, update or delete list.
  private getWritePermissions(write: UserOverrideWrite): Array<Permission> {
    const model: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();

    if (write === "create") {
      return model.getCreatePermissions() || [];
    }

    if (write === "update") {
      return model.getUpdatePermissions() || [];
    }

    return model.getDeletePermissions() || [];
  }

  // What the team rule calls an override: its id, or NEW_OVERRIDE_KEY.
  private getTeamCheckKey(override: OverrideNamingPeople): string {
    return (override.id || NEW_OVERRIDE_KEY).toLowerCase();
  }

  /*
   * The teams whose grant of the team permission reaches each of
   * `overrides` (by getTeamCheckKey): one over the whole project reaches
   * every one of them; one narrowed to labels or owned policies, the ones
   * on the policies its rows reach - and no global override. In lower case.
   */
  private async getReachingTeams(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    overrides: Array<OverrideNamingPeople>;
    getReached: (props: DatabaseCommonInteractionProps) => Promise<Set<string>>;
  }): Promise<Map<string, Array<string>>> {
    const grants: TeamGrants = CallerPermission.getTeamGrants(
      data.props,
      USER_OVERRIDE_TEAM_PERMISSION,
    );

    const teamsByOverride: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const override of data.overrides) {
      teamsByOverride.set(this.getTeamCheckKey(override), []);
    }

    const onPolicies: Array<OverrideNamingPeople> = data.overrides.filter(
      (override: OverrideNamingPeople): boolean => {
        return Boolean(override.onCallDutyPolicyId);
      },
    );

    for (const grant of grants.teams) {
      let reached: Array<OverrideNamingPeople> = data.overrides;

      if (!grant.isProjectWide) {
        reached = await this.getReachedByNarrowGrant({
          grant: grant,
          props: data.props,
          projectId: data.projectId,
          overrides: onPolicies,
          getReached: data.getReached,
        });
      }

      for (const override of reached) {
        teamsByOverride.get(this.getTeamCheckKey(override))?.push(grant.teamId);
      }
    }

    return teamsByOverride;
  }

  /*
   * The overrides on a policy that one team's grant narrowed to labels or
   * owned policies reaches: the write's own checks, asked with the caller's
   * rows less the other teams' grants of the team permission. The rows of
   * the permissions that reach every person stay, so the policy is read as
   * the caller reads it; they reach none of these overrides on their own
   * (checkTeamAccess asked first), so whatever is reached, this team's
   * grant reaches.
   */
  private async getReachedByNarrowGrant(data: {
    grant: TeamGrant;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    overrides: Array<OverrideNamingPeople>;
    getReached: (props: DatabaseCommonInteractionProps) => Promise<Set<string>>;
  }): Promise<Array<OverrideNamingPeople>> {
    if (data.overrides.length === 0) {
      return [];
    }

    const reached: Set<string> = await data.getReached(
      PropsHoldingOnly.buildWithout({
        databaseProps: data.props,
        projectId: data.projectId,
        isLeftOut: (row: UserPermission): boolean => {
          return (
            row.permission === USER_OVERRIDE_TEAM_PERMISSION &&
            HeldPermissionsUtil.readTeamId(row.teamId) !== data.grant.teamId
          );
        },
      }),
    );

    return data.overrides.filter((override: OverrideNamingPeople): boolean => {
      return reached.has(this.getTeamCheckKey(override));
    });
  }

  /*
   * Of `userIds`, the teams among `teamIds` each is an accepted member of,
   * in the project - by lower-cased user id, the team ids lower-cased. A
   * pending invitation is no membership: it gives the team's permissions to
   * no one, and puts no one in the team's reach.
   */
  private async getTeamsOfPeople(data: {
    projectId: ObjectID;
    teamIds: Array<string>;
    userIds: Array<string>;
  }): Promise<Map<string, Set<string>>> {
    const teamsOfPerson: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    if (data.teamIds.length === 0 || data.userIds.length === 0) {
      return teamsOfPerson;
    }

    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        teamId: QueryHelper.any(data.teamIds),
        userId: QueryHelper.any(data.userIds),
        hasAcceptedInvitation: true,
      },
      select: {
        userId: true,
        teamId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const member of members) {
      const userId: string = idText(member.userId).toLowerCase();
      const teamId: string = idText(member.teamId).toLowerCase();

      if (!userId || !teamId || !data.teamIds.includes(teamId)) {
        continue;
      }

      const teams: Set<string> = teamsOfPerson.get(userId) || new Set<string>();
      teams.add(teamId);
      teamsOfPerson.set(userId, teams);
    }

    return teamsOfPerson;
  }

  /*
   * A refusal of the team rule: an add's is a create outside the caller's
   * reach (CreateScopeException), an edit's or a delete's a refused write.
   */
  private getTeamRefusal(write: UserOverrideWrite, message: string): Exception {
    if (write === "create") {
      return new CreateScopeException(message);
    }

    return new NotAuthorizedException(message);
  }

  /*
   * The overrides an update or a delete writes that a caller with `props`
   * may write, by the write's own checks: the query of the rows they may
   * update (with `updateData`) or delete, read as OneUptime, and - for a
   * global override - this service's rule that a global one takes a grant
   * over the whole project. None when the checks refuse them all.
   */
  private getRowsReach(data: {
    write: "update" | "delete";
    ids: Array<string>;
    updateData?: unknown;
  }): (props: DatabaseCommonInteractionProps) => Promise<Set<string>> {
    return async (
      props: DatabaseCommonInteractionProps,
    ): Promise<Set<string>> => {
      if (data.ids.length === 0) {
        return new Set<string>();
      }

      try {
        const query: Query<OnCallDutyPolicyUserOverride> = {
          _id: QueryHelper.any(data.ids),
        } as Query<OnCallDutyPolicyUserOverride>;

        const writable: Query<OnCallDutyPolicyUserOverride> =
          data.write === "update"
            ? await ModelPermission.getUpdatableQuery(
                this.modelType,
                query,
                props,
                data.updateData,
              )
            : await ModelPermission.checkDeleteQueryPermission(
                this.modelType,
                query,
                props,
              );

        const rows: Array<OnCallDutyPolicyUserOverride> = await this.findBy({
          query: writable,
          select: {
            _id: true,
            onCallDutyPolicyId: true,
          },
          skip: 0,
          limit: data.ids.length,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

        const mayChangeGlobal: boolean = GlobalUserOverrideAccess.mayChange(
          CallerPermission.getHeld(props),
          this.getWritePermissions(data.write),
        );

        return new Set<string>(
          rows
            .filter((row: OnCallDutyPolicyUserOverride): boolean => {
              return Boolean(row.onCallDutyPolicyId) || mayChangeGlobal;
            })
            .map((row: OnCallDutyPolicyUserOverride): string => {
              return idText(row._id).toLowerCase();
            }),
        );
      } catch (error) {
        if (this.isRefusal(error)) {
          return new Set<string>();
        }

        throw error;
      }
    };
  }

  // Whether `error` is a check's refusal, rather than something that went wrong.
  private isRefusal(error: unknown): boolean {
    return (
      error instanceof NotAuthorizedException ||
      error instanceof BadDataException ||
      error instanceof PaymentRequiredException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException
    );
  }

  /*
   * The people an override names, as a write reads them: under either name
   * of each column (`overrideUserId` or `overrideUser`), as text - null for
   * nobody. RelationIdUtil refuses one that names two people.
   */
  private readOverridePeople(
    data: Record<string, unknown>,
  ): Pick<OverrideNamingPeople, "awayUserId" | "coverUserId"> {
    const awayUserId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["overrideUserId", "overrideUser"],
      "Override User",
    );

    const coverUserId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["routeAlertsToUserId", "routeAlertsToUser"],
      "Route Alerts To User",
    );

    return {
      awayUserId: awayUserId ? awayUserId.toString() : null,
      coverUserId: coverUserId ? coverUserId.toString() : null,
    };
  }

  /*
   * END NOW (issue #7899): an override under way, ended at the server's own
   * now - the start of this minute, or now itself for one that started in
   * it (UserOverrideEdit.getEndNow) - so a caller whose clock is a minute
   * out still ends it. Read as the caller reads it, so one they may not read
   * is not found, then written as an edit of its end by them: the same
   * permission, the same rules, the same refusals, and the policy's feed and
   * the schedules told as for any edit of an override. One that has ended,
   * has not started or ends within this minute is refused, saying why
   * (UserOverrideEdit.getEndNowRefusal). Returns when it ends now.
   */
  @CaptureSpan()
  public async endNow(data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Date> {
    const override: OnCallDutyPolicyUserOverride | null =
      await this.findOneById({
        id: data.id,
        select: {
          _id: true,
          startsAt: true,
          endsAt: true,
        },
        props: data.props,
      });

    if (!override || !override.startsAt || !override.endsAt) {
      throw new NotFoundException(
        "This user override was not found. It may have been deleted: read the overrides again.",
      );
    }

    const saved: { startsAt: Date; endsAt: Date } = {
      startsAt: OneUptimeDate.fromString(override.startsAt),
      endsAt: OneUptimeDate.fromString(override.endsAt),
    };

    const now: Date = OneUptimeDate.getCurrentDate();

    const refusal: string | null = UserOverrideEdit.getEndNowRefusal(
      saved,
      now,
    );

    const endsAt: Date | null = UserOverrideEdit.getEndNow(saved, now);

    if (refusal || !endsAt) {
      throw new BadDataException(refusal || USER_OVERRIDE_ENDED_REFUSAL);
    }

    await this.updateOneById({
      id: data.id,
      data: {
        endsAt: endsAt,
      } as never,
      props: data.props,
    });

    return endsAt;
  }

  /*
   * WHERE THE CALLER MAY ADD AN OVERRIDE, ASKED WITHOUT ADDING ONE
   * (Types/OnCallDutyPolicy/UserOverrideAddAccess): on each of
   * `onCallDutyPolicyIds`, and globally. Each is asked by running a
   * create's own checks on an override the caller would add there
   * (DatabaseService.checkCallerMayCreate): the table's create permission
   * and the project's plan; the policy as one of the project's that the
   * caller may read (@CanAccessIfCanReadOn); and what their create
   * permission reaches - labels, the policies their team owns
   * (@OwnedThrough), a team's blocks with labels (CreateScopePermission).
   * Then the checks of its create hook: the policy held to the project
   * (ProjectReferencesService), which a master admin is held to as well,
   * and for a global override this service's own rule
   * (checkGlobalOverrideAccess). An override the checks refuse is one the
   * caller may not add; anything else that goes wrong is thrown, never read
   * as a refusal. Who is away and who covers decide none of it, so the
   * overrides asked about name nobody.
   */
  @CaptureSpan()
  public async getAddAccess(data: {
    onCallDutyPolicyIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<UserOverrideAddAccess> {
    const onCallDutyPolicyIds: Array<string> = [];

    for (const onCallDutyPolicyId of data.onCallDutyPolicyIds) {
      if (
        await this.mayCallerAdd({
          onCallDutyPolicyId: onCallDutyPolicyId,
          props: data.props,
        })
      ) {
        onCallDutyPolicyIds.push(onCallDutyPolicyId.toString());
      }
    }

    return {
      global: await this.mayCallerAdd({
        onCallDutyPolicyId: null,
        props: data.props,
      }),
      onCallDutyPolicyIds: onCallDutyPolicyIds,
    };
  }

  // Whether the caller may add an override on the policy, or a global one. See getAddAccess.
  private async mayCallerAdd(data: {
    onCallDutyPolicyId: ObjectID | null;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    try {
      await this.checkCallerMayCreate({
        data: this.getOverrideToAsk(data),
        props: data.props,
      });

      await super.onBeforeCreate({
        data: this.getOverrideToAsk(data),
        props: data.props,
      });

      if (!data.onCallDutyPolicyId) {
        this.checkGlobalOverrideAccess(data.props, "create");
      }

      return true;
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof BadDataException ||
        error instanceof PaymentRequiredException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        return false;
      }

      throw error;
    }
  }

  /*
   * An override as the shortcuts add one, for mayCallerAdd to ask about: in
   * the request's project, from now, on the policy or on none. A new one
   * for each check, as a check changes what it is handed.
   */
  private getOverrideToAsk(data: {
    onCallDutyPolicyId: ObjectID | null;
    props: DatabaseCommonInteractionProps;
  }): OnCallDutyPolicyUserOverride {
    const override: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();
    const now: Date = OneUptimeDate.getCurrentDate();

    if (data.props.tenantId) {
      override.projectId = data.props.tenantId;
    }

    if (data.onCallDutyPolicyId) {
      override.onCallDutyPolicyId = data.onCallDutyPolicyId;
    }

    override.startsAt = now;
    override.endsAt = OneUptimeDate.addRemoveHours(now, 1);

    return override;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<OnCallDutyPolicyUserOverride>,
  ): Promise<OnCreate<OnCallDutyPolicyUserOverride>> {
    await super.onBeforeCreate(createBy);

    // One that names no policy is global: it applies to every policy.
    const onCallDutyPolicyId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ["onCallDutyPolicyId", "onCallDutyPolicy"],
      "On-Call Policy",
    );

    if (!onCallDutyPolicyId) {
      this.checkGlobalOverrideAccess(createBy.props, "create");
    }

    if (!createBy.data.startsAt || !createBy.data.endsAt) {
      throw new BadDataException("Start time and end time are required");
    }

    /*
     * make sure start time is STRICTLY before end time. Using !isBefore (rather
     * than isAfter) also rejects equal start/end and same-second reversed
     * sub-second values, which the downstream event splitter would otherwise
     * turn into a zero-length / inverted substitution segment and a spurious
     * "you are next on-call" notification.
     */
    if (!OneUptimeDate.isBefore(createBy.data.startsAt, createBy.data.endsAt)) {
      throw new BadDataException("Start time must be before end time");
    }

    /*
     * make sure overrideUser and routealertsToUser are not the same - each
     * under either of its names (the two must agree)
     */
    const overrideUserId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ["overrideUserId", "overrideUser"],
      "Override User",
    );

    if (!overrideUserId) {
      throw new BadDataException("Override user is required");
    }

    /*
     * Who covers is optional. Without one the override is a skip: each of
     * the person's turns in a schedule goes to the next person in the
     * rotation who is not away (UserOverrideUtil.isSkip), and teams and
     * rules that name them do not page them until it ends.
     */
    const routeAlertsToUserId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ["routeAlertsToUserId", "routeAlertsToUser"],
      "Route Alerts To User",
    );

    /*
     * Ids are compared without case, as Postgres compares uuids: the same
     * person written twice in different case is still one person, and an
     * override from someone to themselves reroutes nothing.
     */
    if (
      routeAlertsToUserId &&
      overrideUserId.toString().toLowerCase() ===
        routeAlertsToUserId.toString().toLowerCase()
    ) {
      throw new BadDataException(
        "Override user and route alerts to user cannot be the same",
      );
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  /*
   * An add, once every permission check has let it through (the table, the
   * policy, its scope, the global rule): held to the team rule - who is
   * away and who covers, each in a team that lets the caller manage their
   * user overrides - for a caller who reaches every person through no
   * other permission (checkTeamAccess). Asked here, after the checks, so a
   * create the checks refuse says why in their words.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<OnCallDutyPolicyUserOverride>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);

    const record: Record<string, unknown> = onCreate.createBy
      .data as unknown as Record<string, unknown>;

    const onCallDutyPolicyId: ObjectID | null = RelationIdUtil.readConsistent(
      record,
      ["onCallDutyPolicyId", "onCallDutyPolicy"],
      "On-Call Policy",
    );

    await this.checkTeamAccess({
      write: "create",
      props: onCreate.createBy.props,
      overrides: [
        {
          id: null,
          onCallDutyPolicyId: onCallDutyPolicyId
            ? onCallDutyPolicyId.toString()
            : null,
          ...this.readOverridePeople(record),
        },
      ],
      getReached: async (
        props: DatabaseCommonInteractionProps,
      ): Promise<Set<string>> => {
        return (await this.mayCallerAdd({
          onCallDutyPolicyId: onCallDutyPolicyId,
          props: props,
        }))
          ? new Set<string>([NEW_OVERRIDE_KEY])
          : new Set<string>();
      },
    });
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<OnCallDutyPolicyUserOverride>,
    createdItem: OnCallDutyPolicyUserOverride,
  ): Promise<OnCallDutyPolicyUserOverride> {
    // add to on call feed.
    const onCallDutyPolicyId: ObjectID | undefined | null =
      createdItem.onCallDutyPolicyId || createdItem.onCallDutyPolicy?.id;

    const projectId: ObjectID | undefined | null =
      createdItem.projectId || createdItem.project?.id;

    const overrideUserId: ObjectID | undefined | null =
      createdItem.overrideUserId || createdItem.overrideUser?.id;

    const routeAlertsToUserId: ObjectID | undefined | null =
      createdItem.routeAlertsToUserId || createdItem.routeAlertsToUser?.id;

    if (onCallDutyPolicyId && projectId && overrideUserId) {
      const onCallPolicyName: string | null =
        await OnCallDutyPolicyService.getOnCallDutyPolicyName({
          onCallDutyPolicyId: onCallDutyPolicyId,
        });

      const overrideUserTimezone: Timezone | null =
        await UserService.getTimezoneForUser(overrideUserId);

      const routeAlertsToUserTimezone: Timezone | null = routeAlertsToUserId
        ? await UserService.getTimezoneForUser(routeAlertsToUserId)
        : null;

      const timezones: Timezone[] = [];
      if (overrideUserTimezone) {
        timezones.push(overrideUserTimezone);
      }

      if (routeAlertsToUserTimezone) {
        timezones.push(routeAlertsToUserTimezone);
      }

      const from: string =
        OneUptimeDate.getDateAsFormattedStringInMultipleTimezones({
          date: createdItem.startsAt!,
          timezones: timezones,
        });

      const until: string =
        OneUptimeDate.getDateAsFormattedStringInMultipleTimezones({
          date: createdItem.endsAt!,
          timezones: timezones,
        });

      /*
       * Every line names the person and their cover through one
       * OnCallChatByWorkspace: someone only invited by the name typed for
       * them, never their address (#10616).
       */
      const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
        projectId: projectId,
        onCallDutyPolicyId: onCallDutyPolicyId,
      });

      const overrideUserMarkdown: MarkdownText =
        await chat.nameIn(null)(overrideUserId);

      const policyLink: string = (
        await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
          projectId!,
          onCallDutyPolicyId!,
        )
      ).toString();

      const routeAlertsToUserMarkdown: MarkdownText | undefined =
        routeAlertsToUserId
          ? await chat.nameIn(null)(routeAlertsToUserId)
          : undefined;

      /*
       * With a cover, who gets the alerts. Without one - a skip - what
       * happens to the person's turns instead.
       */
      const what: MarkdownText = routeAlertsToUserMarkdown
        ? mdText`All alerts will be routed to **${routeAlertsToUserMarkdown}** from **${from}**  to **${until}**. `
        : mdText`Nobody is named to cover, so from **${from}** to **${until}** each of their turns goes to the next person in the rotation, and they are not paged.`;

      const chatPolicy: MarkdownText = OnCallChatText.policy({
        name: onCallPolicyName || "",
        link: policyLink,
      });

      /*
       * Each workspace's line names the person and their cover as it knows
       * them, as a hand-off's does (issue #7967).
       */
      const chatInfoByWorkspaceType: OnCallChatTextByWorkspaceType =
        createdItem.startsAt && createdItem.endsAt
          ? await chat.write(
              async (writer: OnCallChatWriter): Promise<MarkdownText> => {
                return OnCallChatText.overrideAdded({
                  policy: chatPolicy,
                  person: await writer.nameOf(overrideUserId),
                  cover: routeAlertsToUserId
                    ? await writer.nameOf(routeAlertsToUserId)
                    : undefined,
                  from: createdItem.startsAt!,
                  until: createdItem.endsAt!,
                  moment: writer.moment,
                });
              },
            )
          : {};

      await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
        onCallDutyPolicyId: onCallDutyPolicyId,
        projectId: projectId!,
        onCallDutyPolicyFeedEventType:
          OnCallDutyPolicyFeedEventType.UserOverrideAdded,
        displayColor: Gray500,
        feedInfoInMarkdown:
          mdText`🔁 Added a User Override Rule for user **${overrideUserMarkdown}** for the [On-Call Policy ${onCallPolicyName}](${policyLink}). ${what}`.toString(),
        /*
         * The channels hear it in a line, each moment in its reader's own
         * zone - not in the time zones of both people, line after line
         * (issue #7549).
         */
        chatInfoInMarkdown:
          createdItem.startsAt && createdItem.endsAt
            ? OnCallChatText.overrideAdded({
                policy: chatPolicy,
                person: overrideUserMarkdown,
                cover: routeAlertsToUserMarkdown,
                from: createdItem.startsAt,
                until: createdItem.endsAt,
                moment: (date: Date): MarkdownText => {
                  return WorkspaceMessageTime.dateAndTime(date);
                },
              }).toString()
            : undefined,
        chatInfoByWorkspaceType: chatInfoByWorkspaceType,

        userId: createdItem.createdByUserId! || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    }

    // Reflect the new override in the persisted roster immediately (audit F4).
    await this.refreshRostersForOverrideUser({
      projectId,
      overrideUserId,
    });

    if (projectId && overrideUserId) {
      await this.propagateShiftChangeForOverrides([
        {
          projectId,
          overrideUserId,
          routeAlertsToUserId: routeAlertsToUserId || undefined,
        },
      ]);
    }

    return createdItem;
  }

  /*
   * AN OVERRIDE MAY NOT OVERLAP ANOTHER OF THE SAME PERSON IN ITS SCOPE
   * (issue #7630, UserOverrideOverlap). An add is decided with its INSERT,
   * under the project's lock on override times, so two adds - or an add and
   * an edit - that would overlap cannot both pass, each checking before the
   * other has saved. Asked of every add.
   */
  protected override async getCreateLimit(
    createBy: CreateBy<OnCallDutyPolicyUserOverride>,
  ): Promise<CreateLimit | null> {
    const data: OnCallDutyPolicyUserOverride = createBy.data;
    const projectId: ObjectID | undefined | null =
      data.projectId || data.project?.id;
    const overrideUserId: ObjectID | undefined | null =
      data.overrideUserId || data.overrideUser?.id;

    if (!projectId || !overrideUserId || !data.startsAt || !data.endsAt) {
      return null;
    }

    const candidate: UserOverrideTimes = {
      overrideUserId: overrideUserId.toString(),
      onCallDutyPolicyId:
        idText(data.onCallDutyPolicyId || data.onCallDutyPolicy?.id) || null,
      routeAlertsToUserId:
        idText(data.routeAlertsToUserId || data.routeAlertsToUser?.id) || null,
      startsAt: OneUptimeDate.fromString(data.startsAt),
      endsAt: OneUptimeDate.fromString(data.endsAt),
    };

    return {
      limitName: USER_OVERRIDE_TIMES_LIMIT_NAME,
      projectId: projectId,
      check: async (manager: EntityManager): Promise<void> => {
        await this.refuseOverlap({
          manager: manager,
          projectId: projectId,
          candidate: candidate,
          props: createBy.props,
        });
      },
    };
  }

  /*
   * The same for an edit that moves an override's times: each override is
   * read again under the lock, with its start and end as the edit leaves
   * them, and written only when they come in order and overlap nothing.
   * An edit that leaves the times as they are cannot make an overlap, and
   * takes no lock. Nor can one that only shortens an override - ends it
   * now, or starts it later - so an overlap saved before the rule never
   * keeps it from being ended early (UserOverrideOverlap.addsTime); one
   * that adds time is held to all of its new times, as an add is.
   */
  protected override async getUpdateLimit(
    updateBy: UpdateBy<OnCallDutyPolicyUserOverride>,
  ): Promise<UpdateLimit | null> {
    const change: UserOverrideTimesChange = this.readTimesChange(updateBy);

    if (!change.startsAt && !change.endsAt) {
      return null;
    }

    return {
      limitName: USER_OVERRIDE_TIMES_LIMIT_NAME,
      check: async (manager: EntityManager, rowId: ObjectID): Promise<void> => {
        const rows: Array<OnCallDutyPolicyUserOverride> = await manager
          .getRepository<OnCallDutyPolicyUserOverride>(this.modelType.name)
          .find({
            where: {
              _id: rowId.toString(),
            } as FindOptionsWhere<OnCallDutyPolicyUserOverride>,
            select: OVERLAP_COLUMNS,
            take: 1,
          });

        const row: OnCallDutyPolicyUserOverride | undefined = rows[0];

        // Deleted since: the edit writes nothing.
        if (!row || !row.projectId || !row.overrideUserId) {
          return;
        }

        const candidate: UserOverrideTimes = {
          id: rowId.toString(),
          overrideUserId: row.overrideUserId.toString(),
          onCallDutyPolicyId: idText(row.onCallDutyPolicyId) || null,
          routeAlertsToUserId: idText(row.routeAlertsToUserId) || null,
          startsAt: change.startsAt || OneUptimeDate.fromString(row.startsAt!),
          endsAt: change.endsAt || OneUptimeDate.fromString(row.endsAt!),
        };

        if (!OneUptimeDate.isBefore(candidate.startsAt, candidate.endsAt)) {
          throw new BadDataException(
            "An override has to end after it starts. Pick an end time later than its start time.",
          );
        }

        // Only shortened: it cannot make an overlap.
        if (
          !UserOverrideOverlap.addsTime(
            {
              startsAt: OneUptimeDate.fromString(row.startsAt!),
              endsAt: OneUptimeDate.fromString(row.endsAt!),
            },
            candidate,
          )
        ) {
          return;
        }

        await this.refuseOverlap({
          manager: manager,
          projectId: row.projectId,
          candidate: candidate,
          props: updateBy.props,
        });
      },
    };
  }

  // The times an update writes, as dates; a time it leaves out stays.
  private readTimesChange(
    updateBy: UpdateBy<OnCallDutyPolicyUserOverride>,
  ): UserOverrideTimesChange {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;
    const change: UserOverrideTimesChange = {};

    if (data["startsAt"]) {
      change.startsAt = OneUptimeDate.fromString(data["startsAt"] as Date);
    }

    if (data["endsAt"]) {
      change.endsAt = OneUptimeDate.fromString(data["endsAt"] as Date);
    }

    return change;
  }

  /*
   * Refuses `candidate` - an override about to be added, or saved with new
   * times - when another override of the same person, in the same scope,
   * overlaps it. Read through `manager`: this runs in the write's own
   * transaction, under the lock (ProjectLimitLock), so the overrides read
   * are every one saved before it.
   */
  private async refuseOverlap(data: {
    manager: EntityManager;
    projectId: ObjectID;
    candidate: UserOverrideTimes;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const where: Record<string, unknown> = {
      projectId: data.projectId.toString(),
      overrideUserId: data.candidate.overrideUserId,
      onCallDutyPolicyId: data.candidate.onCallDutyPolicyId
        ? data.candidate.onCallDutyPolicyId
        : IsNull(),
      // Back to back is no overlap: one that ends as this one starts.
      startsAt: LessThan(data.candidate.endsAt),
      endsAt: MoreThan(data.candidate.startsAt),
    };

    if (data.candidate.id) {
      where["_id"] = Not(data.candidate.id);
    }

    const conflicts: Array<OnCallDutyPolicyUserOverride> = await data.manager
      .getRepository<OnCallDutyPolicyUserOverride>(this.modelType.name)
      .find({
        where: where as FindOptionsWhere<OnCallDutyPolicyUserOverride>,
        select: OVERLAP_COLUMNS,
        order: {
          startsAt: "ASC",
          createdAt: "ASC",
        },
        take: OVERLAP_CONFLICTS_READ,
      });

    /*
     * Named: the one used first where they overlap (compareUse) - one that
     * names who covers over a skip, then the one that starts first, then the
     * one added first - as the dialog's notice and the Overlaps marks name it.
     */
    const conflict: OnCallDutyPolicyUserOverride | undefined = [
      ...conflicts,
    ].sort(
      (
        a: OnCallDutyPolicyUserOverride,
        b: OnCallDutyPolicyUserOverride,
      ): number => {
        return UserOverrideOverlap.compareUse(
          toOverlapTimes(a),
          toOverlapTimes(b),
        );
      },
    )[0];

    if (!conflict) {
      return;
    }

    throw new BadDataException(
      await this.getOverlapRefusal({
        manager: data.manager,
        projectId: data.projectId,
        conflict: conflict,
        props: data.props,
      }),
    );
  }

  /*
   * The refusal of an override that overlaps `conflict`: who is away, who
   * covers them in it, and when - in the caller's own time zone, or in UTC
   * for a caller without one (an API key) - then what to do about it. Read
   * through the write's transaction, as refuseOverlap is.
   */
  private async getOverlapRefusal(data: {
    manager: EntityManager;
    projectId: ObjectID;
    conflict: OnCallDutyPolicyUserOverride;
    props: DatabaseCommonInteractionProps;
  }): Promise<string> {
    const awayUserId: string = idText(data.conflict.overrideUserId);
    const coverUserId: string = idText(data.conflict.routeAlertsToUserId);
    const callerId: string = idText(data.props.userId);

    const userIds: Array<string> = [awayUserId, coverUserId, callerId].filter(
      (id: string): boolean => {
        return Boolean(id);
      },
    );

    const users: Array<User> = await data.manager
      .getRepository<User>(User.name)
      .find({
        where: {
          _id: In(userIds),
        } as FindOptionsWhere<User>,
        select: {
          _id: true,
          name: true,
          email: true,
          timezone: true,
        },
      });

    const findUser: (id: string) => User | undefined = (
      id: string,
    ): User | undefined => {
      return users.find((user: User): boolean => {
        return Boolean(
          id && idText(user._id).toLowerCase() === id.toLowerCase(),
        );
      });
    };

    /*
     * Someone only invited to the project is named as the project knows
     * them - the name typed for them, else their address - never by their
     * account's own name, which it does not see until they join (#9823).
     * Read through the write's transaction too: one of its own would wait,
     * holding the lock, for a connection the writes queued behind the lock
     * hold.
     */
    const withheld: Map<string, WithheldProfile> =
      await PendingInviteeProfiles.readWithheldProfilesInProject({
        userIds: [awayUserId, coverUserId].filter((id: string): boolean => {
          return Boolean(id);
        }),
        projectId: data.projectId,
        manager: data.manager,
      });

    const nameOf: (id: string) => string = (id: string): string => {
      const user: User | undefined = findUser(id);

      return (
        PendingInviteeProfiles.getNameInProject({
          userId: id,
          name: user?.name,
          email: user?.email,
          withheld: withheld,
        }) || "Someone else"
      );
    };

    const timezone: Timezone =
      (callerId && findUser(callerId)?.timezone) || Timezone.UTC;

    const sentence: UserOverrideSentence =
      UserOverrideOverlap.getConflictSentence({
        conflict: {
          id: idText(data.conflict._id),
          overrideUserId: awayUserId,
          routeAlertsToUserId: coverUserId || null,
          onCallDutyPolicyId: idText(data.conflict.onCallDutyPolicyId) || null,
          startsAt: data.conflict.startsAt!,
          endsAt: data.conflict.endsAt!,
        },
        awayName: nameOf(awayUserId),
        coverName: coverUserId ? nameOf(coverUserId) : "",
        from: OneUptimeDate.getDateAsFormattedStringInTimezone({
          date: data.conflict.startsAt!,
          timezone: timezone,
        }),
        until: OneUptimeDate.getDateAsFormattedStringInTimezone({
          date: data.conflict.endsAt!,
          timezone: timezone,
        }),
      });

    return `${fillTemplate(sentence.template, sentence.values)} ${USER_OVERRIDE_CONFLICT_WHAT_TO_DO}`;
  }

  /*
   * AN OVERRIDE'S TIMES AND WHO COVERS CAN BE CHANGED (issue #7631,
   * UserOverrideEdit): who covers until it ends, its start until it
   * starts, its end until it ends, and a moved time never to the past. One
   * that has ended stays as it was. Who is away and its policy are never
   * changed (their columns take no update).
   *
   * Each override the edit changes is read as it is now - and the edit held
   * to them - to hold the edit to those rules, and so onUpdateSuccess can
   * refresh the schedules of the people they named before the edit (audit
   * M2) and say in the policy's feed what changed.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<OnCallDutyPolicyUserOverride>,
  ): Promise<OnUpdate<OnCallDutyPolicyUserOverride>> {
    await super.onBeforeUpdate(updateBy);

    const rows: Array<OnCallDutyPolicyUserOverride> =
      await this.findRowsAndHoldUpdateToThem(updateBy, {
        projectId: true,
        onCallDutyPolicyId: true,
        overrideUserId: true,
        routeAlertsToUserId: true,
        startsAt: true,
        endsAt: true,
      });

    // A global override among them: the edit takes a project-wide grant.
    if (
      rows.some((row: OnCallDutyPolicyUserOverride): boolean => {
        return !(row.onCallDutyPolicyId || row.onCallDutyPolicy?.id);
      })
    ) {
      this.checkGlobalOverrideAccess(updateBy.props, "update");
    }

    /*
     * The team rule (issue #9733): the people each override names, and
     * whoever the edit names instead - its new cover, and who is away,
     * which no edit changes (its column takes none).
     */
    const sent: Pick<OverrideNamingPeople, "awayUserId" | "coverUserId"> =
      this.readOverridePeople(
        (updateBy.data || {}) as unknown as Record<string, unknown>,
      );

    await this.checkTeamAccess({
      write: "update",
      props: updateBy.props,
      overrides: rows.map(toOverrideNamingPeople),
      sentAwayUserId: sent.awayUserId,
      sentCoverUserId: sent.coverUserId,
      getReached: this.getRowsReach({
        write: "update",
        ids: rows.map((row: OnCallDutyPolicyUserOverride): string => {
          return idText(row._id);
        }),
        updateData: updateBy.data,
      }),
    });

    this.checkEdit(updateBy, rows);

    const carryForward: OverrideUpdateCarryForward = {
      pairs: [],
      before: [],
    };

    for (const row of rows) {
      const projectId: ObjectID | undefined | null =
        row.projectId || row.project?.id;
      const overrideUserId: ObjectID | undefined | null =
        row.overrideUserId || row.overrideUser?.id;
      const routeAlertsToUserId: ObjectID | undefined | null =
        row.routeAlertsToUserId || row.routeAlertsToUser?.id;

      if (!projectId || !overrideUserId) {
        continue;
      }

      carryForward.pairs.push({
        projectId,
        overrideUserId,
        routeAlertsToUserId: routeAlertsToUserId || undefined,
      });

      if (row.id && row.startsAt && row.endsAt) {
        carryForward.before.push({
          id: row.id.toString(),
          projectId: projectId,
          onCallDutyPolicyId:
            row.onCallDutyPolicyId || row.onCallDutyPolicy?.id || null,
          overrideUserId: overrideUserId,
          routeAlertsToUserId: routeAlertsToUserId || null,
          startsAt: OneUptimeDate.fromString(row.startsAt),
          endsAt: OneUptimeDate.fromString(row.endsAt),
        });
      }
    }

    return {
      updateBy,
      carryForward: carryForward,
    };
  }

  /*
   * Holds an edit of `rows` to what may change (UserOverrideEdit), at the
   * minute it is made. A time sent back as it is - to the minute, for every
   * override the edit changes - is left as it was saved, so a form that
   * sends every field changes only what was changed in it.
   */
  private checkEdit(
    updateBy: UpdateBy<OnCallDutyPolicyUserOverride>,
    rows: Array<OnCallDutyPolicyUserOverride>,
  ): void {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;

    // A time can be moved, never taken away: an override has both.
    for (const key of ["startsAt", "endsAt"]) {
      if (key in data && data[key] !== undefined && !data[key]) {
        throw new BadDataException(
          "An override always has a start time and an end time, so neither can be removed. Pick another time instead.",
        );
      }
    }

    const change: UserOverrideTimesChange = this.readTimesChange(updateBy);
    const now: Date = OneUptimeDate.getCurrentDate();

    // Who covers, when the edit names somebody: never the person away.
    const coverUserId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["routeAlertsToUserId", "routeAlertsToUser"],
      "Route Alerts To User",
    );

    for (const row of rows) {
      if (!row.startsAt || !row.endsAt) {
        continue;
      }

      const saved: { startsAt: Date; endsAt: Date } = {
        startsAt: OneUptimeDate.fromString(row.startsAt),
        endsAt: OneUptimeDate.fromString(row.endsAt),
      };

      const refusal: string | null = UserOverrideEdit.getRefusal({
        saved: saved,
        change: change,
        now: now,
      });

      if (refusal) {
        throw new BadDataException(refusal);
      }

      // With the time the edit leaves as it is, as the add holds it.
      if (
        !OneUptimeDate.isBefore(
          change.startsAt || saved.startsAt,
          change.endsAt || saved.endsAt,
        )
      ) {
        throw new BadDataException(
          "An override has to end after it starts. Pick an end time later than its start time.",
        );
      }

      const overrideUserId: ObjectID | undefined | null =
        row.overrideUserId || row.overrideUser?.id;

      if (
        coverUserId &&
        overrideUserId &&
        coverUserId.toString().toLowerCase() ===
          overrideUserId.toString().toLowerCase()
      ) {
        throw new BadDataException(
          "The person who is away cannot cover for themselves. Pick someone else to cover, or nobody, to skip them in the rotation.",
        );
      }
    }

    for (const key of ["startsAt", "endsAt"] as const) {
      const sent: Date | undefined = change[key];

      if (
        sent &&
        rows.length > 0 &&
        rows.every((row: OnCallDutyPolicyUserOverride): boolean => {
          return Boolean(
            row[key] &&
              UserOverrideEdit.isSameMinute(
                sent,
                OneUptimeDate.fromString(row[key]!),
              ),
          );
        })
      ) {
        delete data[key];
      }
    }
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<OnCallDutyPolicyUserOverride>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<OnCallDutyPolicyUserOverride>> {
    /*
     * An override edit (times, route target, or the override user) must be
     * reflected in the persisted roster (audit F4). Refresh the schedules of
     * BOTH the NEW override user (post-update) and the OLD override user captured
     * in onBeforeUpdate, so a change of overrideUserId also restores the roster
     * of schedules that only contained the previous user (audit M2). Deduped so
     * an unchanged overrideUserId refreshes each schedule set only once.
     */
    const refreshed: Set<string> = new Set<string>();

    const refreshPair: (
      projectId: ObjectID | null | undefined,
      overrideUserId: ObjectID | null | undefined,
    ) => Promise<void> = async (
      projectId: ObjectID | null | undefined,
      overrideUserId: ObjectID | null | undefined,
    ): Promise<void> => {
      if (!projectId || !overrideUserId) {
        return;
      }
      const key: string = `${projectId.toString()}:${overrideUserId.toString()}`;
      if (refreshed.has(key)) {
        return;
      }
      refreshed.add(key);
      await this.refreshRostersForOverrideUser({ projectId, overrideUserId });
    };

    const carryForward: OverrideUpdateCarryForward = (onUpdate.carryForward as
      | OverrideUpdateCarryForward
      | undefined) || { pairs: [], before: [] };

    // OLD override users captured before the update.
    const previous: Array<OverrideUserPair> = carryForward.pairs || [];

    // Everyone the edit touched, old and new, for the feed / reminder pass.
    const affectedPairs: Array<OverrideUserPair> = [...previous];

    for (const entry of previous) {
      await refreshPair(entry.projectId, entry.overrideUserId);
    }

    // NEW override users (post-update).
    for (const id of updatedItemIds) {
      const item: OnCallDutyPolicyUserOverride | null = await this.findOneById({
        id: id,
        select: {
          projectId: true,
          onCallDutyPolicyId: true,
          overrideUserId: true,
          routeAlertsToUserId: true,
          startsAt: true,
          endsAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!item) {
        continue;
      }

      const newProjectId: ObjectID | undefined | null =
        item.projectId || item.project?.id;
      const newOverrideUserId: ObjectID | undefined | null =
        item.overrideUserId || item.overrideUser?.id;
      const newRouteAlertsToUserId: ObjectID | undefined | null =
        item.routeAlertsToUserId || item.routeAlertsToUser?.id;

      await refreshPair(newProjectId, newOverrideUserId);

      if (newProjectId && newOverrideUserId) {
        affectedPairs.push({
          projectId: newProjectId,
          overrideUserId: newOverrideUserId,
          routeAlertsToUserId: newRouteAlertsToUserId || undefined,
        });
      }

      const before: OverrideBeforeEdit | undefined = (
        carryForward.before || []
      ).find((entry: OverrideBeforeEdit): boolean => {
        return entry.id.toLowerCase() === id.toString().toLowerCase();
      });

      if (before) {
        await this.addChangedFeedItem({
          before: before,
          after: item,
          userId: onUpdate.updateBy.props.userId,
        });
      }
    }

    await this.propagateShiftChangeForOverrides(affectedPairs);

    return onUpdate;
  }

  /*
   * One entry in an on-call policy's feed - and one message in the chat
   * channels it posts to - for an edit of one of its overrides: what it is
   * now, then what changed and what it was. Global overrides belong to no
   * policy's feed, as when they are added and removed. An edit that changed
   * nothing says nothing. Best-effort: never throws into the edit.
   */
  private async addChangedFeedItem(data: {
    before: OverrideBeforeEdit;
    after: OnCallDutyPolicyUserOverride;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const before: OverrideBeforeEdit = data.before;
    const after: OnCallDutyPolicyUserOverride = data.after;

    const onCallDutyPolicyId: ObjectID | null = before.onCallDutyPolicyId;

    if (!onCallDutyPolicyId || !after.startsAt || !after.endsAt) {
      return;
    }

    const afterCoverId: string = idText(after.routeAlertsToUserId);
    const beforeCoverId: string = idText(before.routeAlertsToUserId);
    const afterStartsAt: Date = OneUptimeDate.fromString(after.startsAt);
    const afterEndsAt: Date = OneUptimeDate.fromString(after.endsAt);

    const isCoverChanged: boolean =
      afterCoverId.toLowerCase() !== beforeCoverId.toLowerCase();
    const isStartChanged: boolean =
      afterStartsAt.getTime() !== before.startsAt.getTime();
    const isEndChanged: boolean =
      afterEndsAt.getTime() !== before.endsAt.getTime();

    if (!isCoverChanged && !isStartChanged && !isEndChanged) {
      return;
    }

    try {
      const projectId: ObjectID = before.projectId;
      const overrideUserId: ObjectID = before.overrideUserId;

      const onCallPolicyName: string | null =
        await OnCallDutyPolicyService.getOnCallDutyPolicyName({
          onCallDutyPolicyId: onCallDutyPolicyId,
        });

      const timezones: Array<Timezone> = [];

      for (const userId of [overrideUserId.toString(), afterCoverId]) {
        if (!userId) {
          continue;
        }

        const timezone: Timezone | null = await UserService.getTimezoneForUser(
          new ObjectID(userId),
        );

        if (timezone) {
          timezones.push(timezone);
        }
      }

      const inTimezones: (date: Date) => string = (date: Date): string => {
        return OneUptimeDate.getDateAsFormattedStringInMultipleTimezones({
          date: date,
          timezones: timezones,
        });
      };

      /*
       * Every line names its people through one OnCallChatByWorkspace:
       * someone only invited by the name typed for them, never their
       * address (#10616).
       */
      const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
        projectId: projectId,
        onCallDutyPolicyId: onCallDutyPolicyId,
      });

      const personMarkdown: (userId: string) => Promise<MarkdownText> = async (
        userId: string,
      ): Promise<MarkdownText> => {
        return await chat.nameIn(null)(new ObjectID(userId));
      };

      const from: string = inTimezones(afterStartsAt);
      const until: string = inTimezones(afterEndsAt);

      const overrideUserMarkdown: MarkdownText = await personMarkdown(
        overrideUserId.toString(),
      );

      // Who covers now; none when their turns pass to the next person.
      const coverMarkdown: MarkdownText | undefined = afterCoverId
        ? await personMarkdown(afterCoverId)
        : undefined;

      // What it is now, as the add says it.
      const what: MarkdownText = coverMarkdown
        ? mdText`All alerts will be routed to **${coverMarkdown}** from **${from}** to **${until}**.`
        : mdText`Nobody is named to cover, so from **${from}** to **${until}** each of their turns goes to the next person in the rotation, and they are not paged.`;

      // And what it was.
      const changes: Array<MarkdownText> = [];

      if (isCoverChanged) {
        changes.push(
          beforeCoverId
            ? mdText`who covers (it was **${await personMarkdown(beforeCoverId)}**)`
            : mdText`who covers (it was the next person in the rotation)`,
        );
      }

      if (isStartChanged) {
        changes.push(
          mdText`when it starts (it was **${inTimezones(before.startsAt)}**)`,
        );
      }

      if (isEndChanged) {
        changes.push(
          mdText`when it ends (it was **${inTimezones(before.endsAt)}**)`,
        );
      }

      const policyLink: string = (
        await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
          projectId,
          onCallDutyPolicyId,
        )
      ).toString();

      const chatPolicy: MarkdownText = OnCallChatText.policy({
        name: onCallPolicyName || "",
        link: policyLink,
      });

      /*
       * Each workspace's line names the person and who covers now as it
       * knows them, as a hand-off's does (issue #7967).
       */
      const chatInfoByWorkspaceType: OnCallChatTextByWorkspaceType =
        await chat.write(
          async (writer: OnCallChatWriter): Promise<MarkdownText> => {
            return OnCallChatText.overrideChanged({
              policy: chatPolicy,
              person: await writer.nameOf(overrideUserId),
              cover: afterCoverId
                ? await writer.nameOf(new ObjectID(afterCoverId))
                : undefined,
              from: afterStartsAt,
              until: afterEndsAt,
              moment: writer.moment,
            });
          },
        );

      await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
        onCallDutyPolicyId: onCallDutyPolicyId,
        projectId: projectId,
        onCallDutyPolicyFeedEventType:
          OnCallDutyPolicyFeedEventType.UserOverrideChanged,
        displayColor: Gray500,
        feedInfoInMarkdown:
          mdText`✏️ Changed a User Override Rule for user **${overrideUserMarkdown}** for the [On-Call Policy ${onCallPolicyName}](${policyLink}). ${what} Changed: ${FeedMarkdown.join(changes, "; ")}.`.toString(),
        /*
         * The channels hear the override as it is now, in a line, each
         * moment in its reader's own zone, as they hear one added (issue
         * #7549). What it was stays in the policy's feed.
         */
        chatInfoInMarkdown: OnCallChatText.overrideChanged({
          policy: chatPolicy,
          person: overrideUserMarkdown,
          cover: coverMarkdown,
          from: afterStartsAt,
          until: afterEndsAt,
          moment: (date: Date): MarkdownText => {
            return WorkspaceMessageTime.dateAndTime(date);
          },
        }).toString(),
        chatInfoByWorkspaceType: chatInfoByWorkspaceType,
        userId: data.userId || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    } catch (err) {
      logger.error(
        "Error adding a user override change to the policy feed (best-effort).",
      );
      logger.error(err);
    }
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<OnCallDutyPolicyUserOverride>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<OnCallDutyPolicyUserOverride>> {
    /*
     * After an override is removed, recompute the roster so the original user
     * (or whoever the schedule now resolves to) is reflected immediately, rather
     * than waiting for the next natural handoff (audit F4). The affected
     * project/user pairs were captured in onBeforeDelete (the rows are gone now).
     */
    const affected: Array<OverrideUserPair> =
      (onDelete.carryForward as Array<OverrideUserPair>) || [];

    for (const entry of affected) {
      await this.refreshRostersForOverrideUser({
        projectId: entry.projectId,
        overrideUserId: entry.overrideUserId,
      });
    }

    await this.propagateShiftChangeForOverrides(affected);

    return onDelete;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<OnCallDutyPolicyUserOverride>,
  ): Promise<OnDelete<OnCallDutyPolicyUserOverride>> {
    // The overrides the delete removes, and the delete held to them.
    const itemsToDelete: OnCallDutyPolicyUserOverride[] =
      await this.findRowsAndHoldDeleteToThem(deleteBy, {
        onCallDutyPolicyId: true,
        projectId: true,
        overrideUserId: true,
        routeAlertsToUserId: true,
        startsAt: true,
        endsAt: true,
        createdByUserId: true,
      });

    // A global override among them: the delete takes a project-wide grant.
    if (
      itemsToDelete.some((item: OnCallDutyPolicyUserOverride): boolean => {
        return !(item.onCallDutyPolicyId || item.onCallDutyPolicy?.id);
      })
    ) {
      this.checkGlobalOverrideAccess(deleteBy.props, "delete");
    }

    /*
     * The team rule (issue #9733): the people each override names. Asked
     * before the feed says anything: a delete it refuses is never said.
     */
    await this.checkTeamAccess({
      write: "delete",
      props: deleteBy.props,
      overrides: itemsToDelete.map(toOverrideNamingPeople),
      getReached: this.getRowsReach({
        write: "delete",
        ids: itemsToDelete.map((item: OnCallDutyPolicyUserOverride): string => {
          return idText(item._id);
        }),
      }),
    });

    /*
     * Capture the project + override-user of each row being deleted so
     * onDeleteSuccess can refresh those schedules' rosters AFTER the rows are
     * gone (audit F4). Collected for global overrides too (no policy id).
     */
    const affectedRosters: Array<OverrideUserPair> = [];

    for (const item of itemsToDelete) {
      const onCallDutyPolicyId: ObjectID | undefined | null =
        item.onCallDutyPolicyId || item.onCallDutyPolicy?.id;

      const projectId: ObjectID | undefined | null =
        item.projectId || item.project?.id;

      const overrideUserId: ObjectID | undefined | null =
        item.overrideUserId || item.overrideUser?.id;

      const routeAlertsToUserId: ObjectID | undefined | null =
        item.routeAlertsToUserId || item.routeAlertsToUser?.id;

      if (projectId && overrideUserId) {
        affectedRosters.push({
          projectId,
          overrideUserId,
          routeAlertsToUserId: routeAlertsToUserId || undefined,
        });
      }

      if (onCallDutyPolicyId && projectId && overrideUserId) {
        const onCallPolicyName: string | null =
          await OnCallDutyPolicyService.getOnCallDutyPolicyName({
            onCallDutyPolicyId: onCallDutyPolicyId,
          });

        const overrideUserTimezone: Timezone | null =
          await UserService.getTimezoneForUser(overrideUserId);

        const routeAlertsToUserTimezone: Timezone | null = routeAlertsToUserId
          ? await UserService.getTimezoneForUser(routeAlertsToUserId)
          : null;

        const timezones: Timezone[] = [];
        if (overrideUserTimezone) {
          timezones.push(overrideUserTimezone);
        }

        if (routeAlertsToUserTimezone) {
          timezones.push(routeAlertsToUserTimezone);
        }

        const deleteByUserId: ObjectID | undefined | null =
          deleteBy.props.userId;

        /*
         * Every line names the person through one OnCallChatByWorkspace:
         * someone only invited by the name typed for them, never their
         * address (#10616).
         */
        const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
          projectId: projectId,
        });

        const overrideUserMarkdown: MarkdownText =
          await chat.nameIn(null)(overrideUserId);

        const policyLink: string = (
          await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
            projectId!,
            onCallDutyPolicyId!,
          )
        ).toString();

        const chatPolicy: MarkdownText = OnCallChatText.policy({
          name: onCallPolicyName || "",
          link: policyLink,
        });

        // Each workspace's line names the person as it knows them (#7967).
        const chatInfoByWorkspaceType: OnCallChatTextByWorkspaceType =
          await chat.write(
            async (writer: OnCallChatWriter): Promise<MarkdownText> => {
              return OnCallChatText.overrideRemoved({
                policy: chatPolicy,
                person: await writer.nameOf(overrideUserId),
              });
            },
          );

        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId!,
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.UserOverrideRemoved,
          displayColor: Gray500,
          feedInfoInMarkdown:
            mdText`❌ Removed a User Override Rule for user **${overrideUserMarkdown}** for the [On-Call Policy ${onCallPolicyName}](${policyLink}). All alerts will be routed back to **${overrideUserMarkdown}**`.toString(),
          chatInfoInMarkdown: OnCallChatText.overrideRemoved({
            policy: chatPolicy,
            person: overrideUserMarkdown,
          }).toString(),
          chatInfoByWorkspaceType: chatInfoByWorkspaceType,
          userId: deleteByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            leadWithAuthor: true,
          },
        });
      }
    }

    return {
      deleteBy,
      carryForward: affectedRosters,
    };
  }

  @CaptureSpan()
  public async getOnCallDutyPolicyUserOverrideLinkInDashboard(data: {
    projectId: ObjectID;
    onCallDutyPolicyId?: ObjectID | undefined; // if this is null then this is a global override
    onCallDutyPolicyUserOverrideId: ObjectID;
  }): Promise<URL> {
    const projectId: ObjectID = data.projectId;
    const onCallDutyPolicyId: ObjectID | undefined = data.onCallDutyPolicyId;
    const onCallDutyPolicyUserOverrideId: ObjectID =
      data.onCallDutyPolicyUserOverrideId;

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (!onCallDutyPolicyId) {
      return URL.fromString(dashboardUrl.toString()).addRoute(
        `/${projectId.toString()}/on-call-duty/user-overrides/${onCallDutyPolicyUserOverrideId.toString()}`,
      );
    }
    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/on-call-duty/policies/${onCallDutyPolicyId.toString()}/user-overrides/${onCallDutyPolicyUserOverrideId.toString()}`,
    );
  }
}
export default new Service();
