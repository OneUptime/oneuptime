import AccessTokenService from "../Services/AccessTokenService";
import AuditLogService from "../Services/AuditLogService";
import ProjectService from "../Services/ProjectService";
import TeamMemberService from "../Services/TeamMemberService";
import QueryHelper from "../Types/Database/QueryHelper";
import LocalSignInClearing, { CLEAR_BATCH_SIZE } from "./LocalSignInClearing";
import logger from "./Logger";
import CallerPermission, {
  PermissionCarrier,
} from "./Permission/CallerPermission";
import SignInSettingsClearedEmail, {
  SignInSettingsClearedEmailEvent,
} from "./SignInSettingsClearedEmail";
import Project from "../../Models/DatabaseModels/Project";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import { SignInSettingsClearedAuditEvent } from "../../Types/AuditLog/AuditLogSignInSettingsCleared";
import Dictionary from "../../Types/Dictionary";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import {
  CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
  CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
  hasLocalSignInSettings,
  LocalSignInSettings,
  PersonSavedSignInSettings,
} from "../../Types/SSO/LocalSignInClearing";
import { SignInSettingsClearedBy } from "../../Types/SSO/SignInSettingsClearedEmail";

/*
 * AN ORGANIZATION CLEARING THE SIGN-IN SETTINGS ITS PEOPLE SAVED BEFORE ITS
 * PROJECTS MANAGED SIGN-IN WITH SSO (issue #9820).
 *
 * A project that requires SSO can manage its people's sign-in with it
 * (Project.manageSignInWithSso, #9763): someone whose every project does so
 * gets no new password, passkey or second step. What they saved before is
 * kept, unused - and works again the day the switch or the requirement goes
 * off. On OneUptime Cloud only OneUptime's staff are master admins, so the
 * organization had no way to clear it (#9762 is a master admin's).
 *
 * THE DECISION: an organization may clear them, for exactly the people
 * whose whole OneUptime account it is responsible for, and nobody else. An
 * account can belong to several organizations, and one organization never
 * decides about a credential somebody uses for another's projects. So a
 * person's saved settings are cleared from a project's SSO page only when:
 *
 *   1. that project requires SSO and manages sign-in with it - otherwise
 *      their settings still sign them in there, and clearing them would be
 *      a lockout, not a tidy-up;
 *   2. the person is a member of it (an accepted invitation): somebody only
 *      invited has not joined the organization;
 *   3. EVERY project the person belongs to - an invitation not accepted yet
 *      included, as the rule that manages their sign-in counts it
 *      (SsoManagedSignIn) - requires SSO, manages sign-in with it, and is
 *      one the clearing person is a Project Owner of. "The same
 *      organization" is the projects an owner owns: OneUptime has no
 *      organization above projects, and owning every one of somebody's
 *      projects is the one thing that proves their whole account is that
 *      organization's. A single project anywhere else - another
 *      organization's, one they created, one they are only invited to, one
 *      the owner is merely an admin of - keeps their settings theirs;
 *   4. the person is not a master admin: a server's administrators are
 *      never an organization's to clear;
 *   5. the person is not the owner themselves: their own settings are in
 *      User Profile;
 *   6. they have anything saved at all.
 *
 * Who may ask: a signed-in Project Owner of that project, never an API key
 * and never by a master admin's standing (ProjectAPI's routes). What it
 * does is a master admin's clear of each such person, exactly
 * (LocalSignInClearing.clearPeople): the password and its links, every
 * passkey, security key, authenticator app and backup code, two-factor
 * authentication off, and the sessions not signed in with SSO ended. Each
 * person is recorded in the audit log of every project they are a member of
 * - every one of them the owner's - as the owner's Update of the User
 * (AuditLogService.recordSignInSettingsCleared), and emailed what was
 * removed, by "an owner of" the project, and how they sign in now
 * (SignInSettingsClearedEmail), in the background.
 *
 * The rule is read again for each batch, right before it is cleared - a
 * person who joined another organization's project a moment ago keeps
 * their settings - and the write that clears passwords leaves master admins
 * out once more. It cannot be undone, and the Dashboard asks first.
 *
 * ONE PERSON AT A TIME (#9993): the project's Users list asks which of the
 * people it shows the owner may clear (readSavedSettingsOfMembers), and
 * clears one of them (clearMember), under the same rule, read on every
 * request, and by the same batch of a bulk clear (clearBatch): the same
 * audit entry, the same email. The list names a person across the owner's
 * projects, which the count never does, so it names only members of this
 * project the Users list asked about - people the owner already sees there -
 * by their ids alone.
 */

// Who the rule reads a person's projects as.
interface PersonsProjects {
  userId: ObjectID;
  projectIds: Array<ObjectID>;
}

// What clearing a batch did: whom, how many sessions ended, and their emails.
interface ClearedBatch {
  clearedUserIds: Array<ObjectID>;
  sessionsEnded: number;
  // Resolves once their emails are queued, or after the queue's time limit.
  emailsQueued: Promise<void>;
}

export default class ProjectSignInClearing {
  /*
   * How many people this owner may clear from this project now. Nobody when
   * the project does not manage sign-in with SSO, or does not exist.
   */
  public static async countClearablePeople(data: {
    projectId: ObjectID;
    ownerUserId: ObjectID;
  }): Promise<number> {
    const project: Project | null = await ProjectSignInClearing.readProject(
      data.projectId,
    );

    if (!project || !ProjectSignInClearing.isManagingSignIn(project)) {
      return 0;
    }

    const members: Array<ObjectID> = await ProjectSignInClearing.readMemberIds(
      data.projectId,
      data.ownerUserId,
    );

    let count: number = 0;

    for (
      let start: number = 0;
      start < members.length;
      start += CLEAR_BATCH_SIZE
    ) {
      count += (
        await ProjectSignInClearing.findClearable({
          candidates: members.slice(start, start + CLEAR_BATCH_SIZE),
          ownerUserId: data.ownerUserId,
        })
      ).length;
    }

    return count;
  }

  /*
   * Clears the saved sign-in settings of everyone this owner may clear from
   * this project (see above), a batch at a time: how many people it
   * cleared. Refused while the project does not manage sign-in with SSO.
   */
  public static async clearForProject(data: {
    projectId: ObjectID;
    ownerUserId: ObjectID;
  }): Promise<number> {
    const project: Project | null = await ProjectSignInClearing.readProject(
      data.projectId,
    );

    if (!project) {
      throw new NotFoundException("Project not found.");
    }

    if (!ProjectSignInClearing.isManagingSignIn(project)) {
      throw new BadDataException(
        CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
      );
    }

    const members: Array<ObjectID> = await ProjectSignInClearing.readMemberIds(
      data.projectId,
      data.ownerUserId,
    );

    let peopleCleared: number = 0;
    let sessionsEnded: number = 0;
    // Each batch's emails, queued while the next batch is cleared.
    const emailsQueued: Array<Promise<void>> = [];

    for (
      let start: number = 0;
      start < members.length;
      start += CLEAR_BATCH_SIZE
    ) {
      // The rule, read again right before this batch is cleared.
      const clearable: Array<ObjectID> =
        await ProjectSignInClearing.findClearable({
          candidates: members.slice(start, start + CLEAR_BATCH_SIZE),
          ownerUserId: data.ownerUserId,
        });

      if (clearable.length === 0) {
        continue;
      }

      const batch: ClearedBatch = await ProjectSignInClearing.clearBatch({
        projectId: data.projectId,
        ownerUserId: data.ownerUserId,
        clearable: clearable,
      });

      sessionsEnded += batch.sessionsEnded;
      peopleCleared += batch.clearedUserIds.length;
      emailsQueued.push(batch.emailsQueued);
    }

    // Queued, each within EMAIL_ENQUEUE_TIMEOUT_IN_MS: never a failure.
    await Promise.all(emailsQueued);

    logger.info(
      `An owner (${data.ownerUserId.toString()}) of project ${data.projectId.toString()} cleared the saved sign-in settings of ${peopleCleared} of its people: ${sessionsEnded} session(s) ended.`,
    );

    return peopleCleared;
  }

  /*
   * Of the people the project's Users list shows (`userIds`), those this
   * owner may clear now, each with what they have saved - the list behind
   * the Members page's Clear Sign-In Settings (#9993). The count's rule,
   * exactly, and on top of it: only people asked about who are members of
   * this project, so the answer names nobody the owner does not already see
   * on its Users list. Nobody while the project does not manage sign-in
   * with SSO, or does not exist.
   */
  public static async readSavedSettingsOfMembers(data: {
    projectId: ObjectID;
    ownerUserId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<Array<PersonSavedSignInSettings>> {
    const project: Project | null = await ProjectSignInClearing.readProject(
      data.projectId,
    );

    if (!project || !ProjectSignInClearing.isManagingSignIn(project)) {
      return [];
    }

    const members: Array<ObjectID> =
      await ProjectSignInClearing.readMembersAmong({
        projectId: data.projectId,
        ownerUserId: data.ownerUserId,
        userIds: data.userIds,
      });

    const clearable: Array<ObjectID> = await ProjectSignInClearing.findClearable(
      {
        candidates: members,
        ownerUserId: data.ownerUserId,
      },
    );

    const people: Array<PersonSavedSignInSettings> = [];

    /*
     * Read as the clear reads them before it clears (readSettings), so what
     * the confirmation says will be removed is what the clear removes.
     */
    for (const userId of clearable) {
      const settings: LocalSignInSettings =
        await LocalSignInClearing.readSettings(userId);

      if (hasLocalSignInSettings(settings)) {
        people.push({
          userId: userId.toString().toLowerCase(),
          settings: settings,
        });
      }
    }

    return people;
  }

  /*
   * Clears one member's saved sign-in settings, for this owner (#9993):
   * exactly a bulk clear's batch of one (clearBatch) - the same rule, read
   * right before the write, the same audit entry in each of their projects
   * as the owner's, the same email - or refused, with the rule and never
   * which part of it, for anybody the owner may not clear. Answers how many
   * it cleared: one.
   */
  public static async clearMember(data: {
    projectId: ObjectID;
    ownerUserId: ObjectID;
    userId: ObjectID;
  }): Promise<number> {
    const project: Project | null = await ProjectSignInClearing.readProject(
      data.projectId,
    );

    if (!project) {
      throw new NotFoundException("Project not found.");
    }

    if (!ProjectSignInClearing.isManagingSignIn(project)) {
      throw new BadDataException(
        CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
      );
    }

    // A member of this project, not the owner: the rule's candidates.
    const members: Array<ObjectID> =
      await ProjectSignInClearing.readMembersAmong({
        projectId: data.projectId,
        ownerUserId: data.ownerUserId,
        userIds: [data.userId],
      });

    // The rule, read right before the clear.
    const clearable: Array<ObjectID> = await ProjectSignInClearing.findClearable(
      {
        candidates: members,
        ownerUserId: data.ownerUserId,
      },
    );

    if (clearable.length !== 1) {
      throw new BadDataException(
        CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
      );
    }

    const batch: ClearedBatch = await ProjectSignInClearing.clearBatch({
      projectId: data.projectId,
      ownerUserId: data.ownerUserId,
      clearable: clearable,
    });

    // Queued within EMAIL_ENQUEUE_TIMEOUT_IN_MS: never a failure.
    await batch.emailsQueued;

    // Made a master admin since the rule was read: nothing was cleared.
    if (batch.clearedUserIds.length === 0) {
      throw new BadDataException(
        CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
      );
    }

    logger.info(
      `An owner (${data.ownerUserId.toString()}) of project ${data.projectId.toString()} cleared the saved sign-in settings of user ${data.userId.toString()}: ${batch.sessionsEnded} session(s) ended.`,
    );

    return batch.clearedUserIds.length;
  }

  /*
   * Clears these people, whom the rule has just let through: what each has
   * read first, for the audit log and the email; then cleared as a master
   * admin's clear is (LocalSignInClearing.clearPeople), master admins left
   * out once more; each recorded in the audit log of every project they are
   * in as the owner's Update of the User, and emailed as cleared by an
   * owner of this project - by a job a worker sends (#9991), so the clear
   * never waits for an email, and a restart loses none. The project goes
   * by its id: its name is read when the email is written.
   */
  private static async clearBatch(data: {
    projectId: ObjectID;
    ownerUserId: ObjectID;
    clearable: Array<ObjectID>;
  }): Promise<ClearedBatch> {
    // Read before they are cleared, for the audit log and the emails.
    const settingsByUser: Map<string, LocalSignInSettings> = new Map();

    for (const userId of data.clearable) {
      settingsByUser.set(
        userId.toString(),
        await LocalSignInClearing.readSettings(userId),
      );
    }

    const result: { clearedUserIds: Array<ObjectID>; sessionsEnded: number } =
      await LocalSignInClearing.clearPeople({
        userIds: data.clearable,
        // Never a master admin: read again, and left out of the write.
        isMasterAdminIncluded: false,
      });

    await AuditLogService.recordSignInSettingsCleared(
      result.clearedUserIds.map(
        (userId: ObjectID): SignInSettingsClearedAuditEvent => {
          return {
            userId: userId,
            clearedByUserId: data.ownerUserId,
            cleared: settingsByUser.get(userId.toString())!,
          };
        },
      ),
    );

    const emailsQueued: Promise<void> = SignInSettingsClearedEmail.notify(
      result.clearedUserIds.map(
        (userId: ObjectID): SignInSettingsClearedEmailEvent => {
          return {
            userId: userId,
            cleared: settingsByUser.get(userId.toString())!,
            clearedBy: SignInSettingsClearedBy.ProjectOwner,
            projectId: data.projectId,
          };
        },
      ),
    );

    return {
      clearedUserIds: result.clearedUserIds,
      sessionsEnded: result.sessionsEnded,
      emailsQueued: emailsQueued,
    };
  }

  /*
   * Of these people, the members of this project - an accepted invitation:
   * somebody only invited has not joined - each once, the owner left out.
   * Never anybody the project's Users list does not show as a member.
   */
  private static async readMembersAmong(data: {
    projectId: ObjectID;
    ownerUserId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const ownerKey: string = data.ownerUserId.toString().toLowerCase();

    const asked: Array<ObjectID> = data.userIds.filter(
      (userId: ObjectID): boolean => {
        return userId.toString().toLowerCase() !== ownerKey;
      },
    );

    if (asked.length === 0) {
      return [];
    }

    const members: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (let start: number = 0; start < asked.length; start += LIMIT_MAX) {
      const batch: Array<ObjectID> = asked.slice(start, start + LIMIT_MAX);

      for (let skip: number = 0; ; skip += LIMIT_MAX) {
        const rows: Array<TeamMember> = await TeamMemberService.findBy({
          query: {
            projectId: data.projectId,
            userId: QueryHelper.any(batch),
            hasAcceptedInvitation: true,
          },
          select: {
            _id: true,
            userId: true,
          },
          limit: LIMIT_MAX,
          skip: skip,
          props: {
            isRoot: true,
          },
        });

        for (const row of rows) {
          if (!row.userId) {
            continue;
          }

          const key: string = row.userId.toString().toLowerCase();

          if (key !== ownerKey) {
            members.set(key, row.userId);
          }
        }

        if (rows.length < LIMIT_MAX) {
          break;
        }
      }
    }

    return Array.from(members.values());
  }

  /*
   * Of these members, those this owner may clear: not the owner, not a
   * master admin, with something saved, and every project of theirs one
   * that manages sign-in with SSO and that the owner owns.
   */
  public static async findClearable(data: {
    candidates: Array<ObjectID>;
    ownerUserId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const ownerKey: string = data.ownerUserId.toString().toLowerCase();

    const others: Array<ObjectID> = data.candidates.filter(
      (userId: ObjectID): boolean => {
        return userId.toString().toLowerCase() !== ownerKey;
      },
    );

    if (others.length === 0) {
      return [];
    }

    // Never a master admin, never a deleted account, only those with anything.
    const withSettings: Array<ObjectID> =
      await LocalSignInClearing.findPeopleWithSettings(others);

    if (withSettings.length === 0) {
      return [];
    }

    const persons: Array<PersonsProjects> =
      await ProjectSignInClearing.readProjectsOf(withSettings);

    const allProjectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const person of persons) {
      for (const projectId of person.projectIds) {
        allProjectIds.set(projectId.toString().toLowerCase(), projectId);
      }
    }

    const projectIds: Array<ObjectID> = Array.from(allProjectIds.values());

    const managing: Set<string> =
      await ProjectSignInClearing.readManagingProjects(projectIds);

    const owned: Set<string> = await ProjectSignInClearing.readOwnedProjects({
      ownerUserId: data.ownerUserId,
      projectIds: projectIds,
    });

    return persons
      .filter((person: PersonsProjects): boolean => {
        return (
          person.projectIds.length > 0 &&
          person.projectIds.every((projectId: ObjectID): boolean => {
            const key: string = projectId.toString().toLowerCase();
            return managing.has(key) && owned.has(key);
          })
        );
      })
      .map((person: PersonsProjects): ObjectID => {
        return person.userId;
      });
  }

  // Whether a project requires SSO and manages its people's sign-in with it.
  private static isManagingSignIn(project: Project): boolean {
    return (
      project.requireSsoForLogin === true &&
      project.manageSignInWithSso === true
    );
  }

  private static async readProject(
    projectId: ObjectID,
  ): Promise<Project | null> {
    // Its name is not read here: an email reads it when it is written (#9991).
    return await ProjectService.findOneById({
      id: projectId,
      select: {
        _id: true,
        requireSsoForLogin: true,
        manageSignInWithSso: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The project's members - accepted invitations only: somebody invited
   * has not joined - each once, the owner left out.
   */
  private static async readMemberIds(
    projectId: ObjectID,
    ownerUserId: ObjectID,
  ): Promise<Array<ObjectID>> {
    const members: Map<string, ObjectID> = new Map<string, ObjectID>();
    const ownerKey: string = ownerUserId.toString().toLowerCase();

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const rows: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          projectId: projectId,
          hasAcceptedInvitation: true,
        },
        select: {
          _id: true,
          userId: true,
        },
        limit: LIMIT_MAX,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        if (!row.userId) {
          continue;
        }

        const key: string = row.userId.toString().toLowerCase();

        if (key !== ownerKey) {
          members.set(key, row.userId);
        }
      }

      if (rows.length < LIMIT_MAX) {
        break;
      }
    }

    return Array.from(members.values());
  }

  /*
   * Every project each of these people belongs to - a membership or an
   * invitation not accepted yet, as the rule that manages their sign-in
   * counts them - each once.
   */
  private static async readProjectsOf(
    userIds: Array<ObjectID>,
  ): Promise<Array<PersonsProjects>> {
    const byUser: Map<string, PersonsProjects> = new Map();

    for (const userId of userIds) {
      byUser.set(userId.toString().toLowerCase(), {
        userId: userId,
        projectIds: [],
      });
    }

    const seen: Set<string> = new Set<string>();

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const rows: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          userId: QueryHelper.any(userIds),
        },
        select: {
          _id: true,
          userId: true,
          projectId: true,
        },
        limit: LIMIT_MAX,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        if (!row.userId || !row.projectId) {
          continue;
        }

        const person: PersonsProjects | undefined = byUser.get(
          row.userId.toString().toLowerCase(),
        );
        const key: string = `${row.userId.toString().toLowerCase()}:${row.projectId
          .toString()
          .toLowerCase()}`;

        if (!person || seen.has(key)) {
          continue;
        }

        seen.add(key);
        person.projectIds.push(row.projectId);
      }

      if (rows.length < LIMIT_MAX) {
        break;
      }
    }

    return Array.from(byUser.values());
  }

  /*
   * Of these projects, those that require SSO and manage sign-in with it,
   * by lower-cased id. A project that no longer exists is not one: it
   * manages nobody's sign-in, so a person with a membership left in one is
   * not cleared.
   */
  private static async readManagingProjects(
    projectIds: Array<ObjectID>,
  ): Promise<Set<string>> {
    const managing: Set<string> = new Set<string>();

    for (let start: number = 0; start < projectIds.length; start += LIMIT_MAX) {
      const batch: Array<ObjectID> = projectIds.slice(start, start + LIMIT_MAX);

      const projects: Array<Project> = await ProjectService.findBy({
        query: {
          _id: QueryHelper.any(batch),
        },
        select: {
          _id: true,
          requireSsoForLogin: true,
          manageSignInWithSso: true,
        },
        limit: batch.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const project of projects) {
        if (project.id && ProjectSignInClearing.isManagingSignIn(project)) {
          managing.add(project.id.toString().toLowerCase());
        }
      }
    }

    return managing;
  }

  /*
   * Of these projects, those the owner holds Project Owner in, by
   * lower-cased id: their permissions in each, read as every permission
   * check reads them (CallerPermission) - a team's block on Project Owner
   * is no grant of it. Never by master-admin standing.
   */
  private static async readOwnedProjects(data: {
    ownerUserId: ObjectID;
    projectIds: Array<ObjectID>;
  }): Promise<Set<string>> {
    const owned: Set<string> = new Set<string>();

    if (data.projectIds.length === 0) {
      return owned;
    }

    const globalPermission: UserGlobalAccessPermission | null =
      await AccessTokenService.getUserGlobalAccessPermission(data.ownerUserId);

    const permissions: Map<string, UserTenantAccessPermission | null> =
      await AccessTokenService.getUserTenantAccessPermissions(
        data.ownerUserId,
        data.projectIds,
        { userGlobalAccessPermission: globalPermission },
      );

    const userTenantAccessPermission: Dictionary<UserTenantAccessPermission> =
      {};

    for (const projectId of data.projectIds) {
      const permission: UserTenantAccessPermission | null | undefined =
        permissions.get(projectId.toString().toLowerCase());

      if (permission) {
        userTenantAccessPermission[projectId.toString()] = permission;
      }
    }

    const carrier: PermissionCarrier = {
      userTenantAccessPermission: userTenantAccessPermission,
      userGlobalAccessPermission: globalPermission || undefined,
    };

    for (const projectId of data.projectIds) {
      if (
        CallerPermission.holdsAnyOf(carrier, [Permission.ProjectOwner], {
          projectId: projectId,
        })
      ) {
        owned.add(projectId.toString().toLowerCase());
      }
    }

    return owned;
  }
}
