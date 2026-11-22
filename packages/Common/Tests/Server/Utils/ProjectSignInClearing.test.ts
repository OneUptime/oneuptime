jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneByID from "../../../Server/Types/Database/FindOneByID";
import LocalSignInClearing, {
  CLEAR_BATCH_SIZE,
} from "../../../Server/Utils/LocalSignInClearing";
import logger from "../../../Server/Utils/Logger";
import ProjectSignInClearing from "../../../Server/Utils/ProjectSignInClearing";
import SignInSettingsClearedEmail, {
  SignInSettingsClearedEmailEvent,
} from "../../../Server/Utils/SignInSettingsClearedEmail";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { SignInSettingsClearedAuditEvent } from "../../../Types/AuditLog/AuditLogSignInSettingsCleared";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
  CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
  LocalSignInSettings,
  PersonSavedSignInSettings,
} from "../../../Types/SSO/LocalSignInClearing";
import { SignInSettingsClearedBy } from "../../../Types/SSO/SignInSettingsClearedEmail";
import { getJestSpyOn } from "../../Spy";
import { readQueryValues } from "../TestingUtils/SsoManagedProjects";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AN ORGANIZATION CLEARING ITS PEOPLE'S SAVED SIGN-IN SETTINGS (#9820).
 *
 * The decision: a project's owner may clear the saved password, passkeys
 * and second steps of the project's people whose EVERY project - an
 * invitation not accepted yet included - manages sign-in with SSO and is a
 * project this owner owns. Nobody else, ever: a project of another
 * organization, one that keeps its own sign-in, one the owner is only an
 * admin of or is blocked from owning, keeps the person's settings theirs.
 * Never a master admin, never the owner, never somebody only invited.
 *
 * Each allowed and refused case below runs through the real rule
 * (ProjectSignInClearing.findClearable), over a small world of projects,
 * memberships, people and the owner's permissions; only the storage is
 * stood in. The clear itself is a master admin's clear of each person
 * (LocalSignInClearing.clearPeople, pinned in its own suite), recorded in
 * the audit log as the owner's and emailed as "an owner of" the project.
 */

const OWNER_ID: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000001");

interface WorldProject {
  id: ObjectID;
  name: string;
  requireSsoForLogin: boolean;
  manageSignInWithSso: boolean;
  isDeleted?: boolean;
}

interface WorldMembership {
  userId: ObjectID;
  projectId: ObjectID;
  hasAcceptedInvitation: boolean;
}

interface WorldPerson {
  isMasterAdmin: boolean;
  hasSettings: boolean;
}

let projects: Array<WorldProject>;
let memberships: Array<WorldMembership>;
let people: Map<string, WorldPerson>;
// The owner's permission rows, by project.
let ownerRows: Map<string, Array<UserPermission>>;

let clearPeople: jest.SpyInstance;
let recordCleared: jest.SpyInstance;
let notifyCleared: jest.SpyInstance;

const keyOf: (id: ObjectID | string) => string = (
  id: ObjectID | string,
): string => {
  return id.toString().toLowerCase();
};

const SETTINGS: LocalSignInSettings = {
  hasPassword: true,
  hasPasswordResetLink: false,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 1,
  passkeyAndSecurityKeyCount: 1,
  backupCodeCount: 10,
};

const project: (name: string, data?: Partial<WorldProject>) => WorldProject = (
  name: string,
  data?: Partial<WorldProject>,
): WorldProject => {
  const made: WorldProject = {
    id: ObjectID.generate(),
    name: name,
    requireSsoForLogin: true,
    manageSignInWithSso: true,
    ...data,
  };
  projects.push(made);
  return made;
};

// The owner is a Project Owner of it (or holds what is given instead).
const owns: (
  worldProject: WorldProject,
  permissions?: Array<Permission>,
  blocks?: Array<Permission>,
) => void = (
  worldProject: WorldProject,
  permissions: Array<Permission> = [Permission.ProjectOwner],
  blocks: Array<Permission> = [],
): void => {
  ownerRows.set(keyOf(worldProject.id), [
    ...permissions.map((permission: Permission): UserPermission => {
      return { _type: "UserPermission", permission, labelIds: [] };
    }),
    ...blocks.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ]);
};

const person: (data?: Partial<WorldPerson>) => ObjectID = (
  data?: Partial<WorldPerson>,
): ObjectID => {
  const id: ObjectID = ObjectID.generate();
  people.set(keyOf(id), {
    isMasterAdmin: false,
    hasSettings: true,
    ...data,
  });
  return id;
};

const joins: (
  userId: ObjectID,
  worldProject: WorldProject,
  data?: { isInvitationOnly?: boolean; teams?: number },
) => void = (
  userId: ObjectID,
  worldProject: WorldProject,
  data?: { isInvitationOnly?: boolean; teams?: number },
): void => {
  for (let team: number = 0; team < (data?.teams || 1); team++) {
    memberships.push({
      userId: userId,
      projectId: worldProject.id,
      hasAcceptedInvitation: !data?.isInvitationOnly,
    });
  }
};

beforeEach(() => {
  projects = [];
  memberships = [];
  people = new Map<string, WorldPerson>();
  ownerRows = new Map<string, Array<UserPermission>>();

  people.set(keyOf(OWNER_ID), { isMasterAdmin: false, hasSettings: true });

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(
    async (data: FindOneByID<Project>): Promise<Project | null> => {
      const found: WorldProject | undefined = projects.find(
        (worldProject: WorldProject): boolean => {
          return (
            !worldProject.isDeleted &&
            keyOf(worldProject.id) === keyOf(data.id as ObjectID)
          );
        },
      );

      if (!found) {
        return null;
      }

      const row: Project = new Project();
      row._id = found.id.toString();
      row.name = found.name;
      row.requireSsoForLogin = found.requireSsoForLogin;
      row.manageSignInWithSso = found.manageSignInWithSso;
      return row;
    },
  );

  getJestSpyOn(ProjectService, "findBy").mockImplementation(
    async (data: FindBy<Project>): Promise<Array<Project>> => {
      const asked: Array<string> = readQueryValues(
        (data.query as Record<string, unknown>)["_id"],
      );

      return projects
        .filter((worldProject: WorldProject): boolean => {
          return (
            !worldProject.isDeleted && asked.includes(keyOf(worldProject.id))
          );
        })
        .map((worldProject: WorldProject): Project => {
          const row: Project = new Project();
          row._id = worldProject.id.toString();
          row.requireSsoForLogin = worldProject.requireSsoForLogin;
          row.manageSignInWithSso = worldProject.manageSignInWithSso;
          return row;
        });
    },
  );

  // By project (its accepted members), or by people (every membership).
  getJestSpyOn(TeamMemberService, "findBy").mockImplementation(
    async (data: FindBy<TeamMember>): Promise<Array<TeamMember>> => {
      const query: Record<string, unknown> = data.query as Record<
        string,
        unknown
      >;

      const rows: Array<WorldMembership> = memberships.filter(
        (membership: WorldMembership): boolean => {
          // Only the people a query names, when it names some (#9993).
          if (
            query["userId"] !== undefined &&
            !readQueryValues(query["userId"]).includes(keyOf(membership.userId))
          ) {
            return false;
          }

          if (query["projectId"] !== undefined) {
            return (
              keyOf(membership.projectId) ===
                keyOf(query["projectId"] as ObjectID) &&
              (query["hasAcceptedInvitation"] === undefined ||
                membership.hasAcceptedInvitation ===
                  query["hasAcceptedInvitation"])
            );
          }

          return true;
        },
      );

      const skip: number = Number(data.skip || 0);
      const limit: number = Number(data.limit || rows.length);

      return rows
        .slice(skip, skip + limit)
        .map((membership: WorldMembership): TeamMember => {
          const row: TeamMember = new TeamMember();
          row._id = ObjectID.generate().toString();
          row.userId = membership.userId;
          row.projectId = membership.projectId;
          row.hasAcceptedInvitation = membership.hasAcceptedInvitation;
          return row;
        });
    },
  );

  // The query of who has anything saved, as LocalSignInClearing runs it.
  getJestSpyOn(
    LocalSignInClearing,
    "findPeopleWithSettings",
  ).mockImplementation(
    async (userIds: Array<ObjectID>): Promise<Array<ObjectID>> => {
      return userIds.filter((userId: ObjectID): boolean => {
        const stored: WorldPerson | undefined = people.get(keyOf(userId));
        return Boolean(stored) && !stored!.isMasterAdmin && stored!.hasSettings;
      });
    },
  );

  getJestSpyOn(LocalSignInClearing, "readSettings").mockResolvedValue(SETTINGS);

  clearPeople = getJestSpyOn(
    LocalSignInClearing,
    "clearPeople",
  ).mockImplementation(
    async (data: {
      userIds: Array<ObjectID>;
      isMasterAdminIncluded: boolean;
    }): Promise<{ clearedUserIds: Array<ObjectID>; sessionsEnded: number }> => {
      // As the real one: master admins left out, read again.
      const cleared: Array<ObjectID> = data.userIds.filter(
        (userId: ObjectID): boolean => {
          return !people.get(keyOf(userId))?.isMasterAdmin;
        },
      );
      return { clearedUserIds: cleared, sessionsEnded: cleared.length };
    },
  );

  getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockImplementation(
    async (userId: ObjectID): Promise<UserGlobalAccessPermission> => {
      return {
        _type: "UserGlobalAccessPermission",
        projectIds:
          keyOf(userId) === keyOf(OWNER_ID)
            ? Array.from(ownerRows.keys()).map((id: string): ObjectID => {
                return new ObjectID(id);
              })
            : [],
        globalPermissions: [],
      };
    },
  );

  getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermissions",
  ).mockImplementation(
    async (
      userId: ObjectID,
      projectIds: Array<ObjectID>,
    ): Promise<Map<string, UserTenantAccessPermission | null>> => {
      const answer: Map<string, UserTenantAccessPermission | null> = new Map();

      for (const projectId of projectIds) {
        const rows: Array<UserPermission> | undefined =
          keyOf(userId) === keyOf(OWNER_ID)
            ? ownerRows.get(keyOf(projectId))
            : undefined;

        answer.set(
          keyOf(projectId),
          rows
            ? {
                _type: "UserTenantAccessPermission",
                projectId: projectId,
                permissions: rows,
              }
            : null,
        );
      }

      return answer;
    },
  );

  recordCleared = getJestSpyOn(
    AuditLogService,
    "recordSignInSettingsCleared",
  ).mockResolvedValue(undefined);

  notifyCleared = getJestSpyOn(
    SignInSettingsClearedEmail,
    "notify",
  ).mockResolvedValue(undefined);

  getJestSpyOn(logger, "info").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const count: (worldProject: WorldProject) => Promise<number> = async (
  worldProject: WorldProject,
): Promise<number> => {
  return await ProjectSignInClearing.countClearablePeople({
    projectId: worldProject.id,
    ownerUserId: OWNER_ID,
  });
};

const clear: (worldProject: WorldProject) => Promise<number> = async (
  worldProject: WorldProject,
): Promise<number> => {
  return await ProjectSignInClearing.clearForProject({
    projectId: worldProject.id,
    ownerUserId: OWNER_ID,
  });
};

// Who was cleared, by every call, lower-cased.
const clearedIds: () => Array<string> = (): Array<string> => {
  return clearPeople.mock.calls.flatMap(
    (call: Array<unknown>): Array<string> => {
      return (call[0] as { userIds: Array<ObjectID> }).userIds.map(keyOf);
    },
  );
};

// An organization's project, owned by the owner, the owner a member of it.
const ownedProject: (name: string) => WorldProject = (
  name: string,
): WorldProject => {
  const made: WorldProject = project(name);
  owns(made);
  joins(OWNER_ID, made);
  return made;
};

describe("who an owner may clear: the allowed cases", () => {
  test("a person whose only project is this one, which manages sign-in and which the owner owns", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme);

    await expect(count(acme)).resolves.toBe(1);
    await expect(clear(acme)).resolves.toBe(1);
    expect(clearedIds()).toEqual([keyOf(alice)]);
  });

  test("a person in several projects, every one managing sign-in and owned by the owner", async () => {
    const production: WorldProject = ownedProject("Acme Production");
    const staging: WorldProject = ownedProject("Acme Staging");
    const alice: ObjectID = person();
    joins(alice, production);
    joins(alice, staging);

    await expect(count(production)).resolves.toBe(1);
    await expect(count(staging)).resolves.toBe(1);
  });

  test("an invitation not accepted yet to another of the owner's managing projects keeps them clearable", async () => {
    const production: WorldProject = ownedProject("Acme Production");
    const staging: WorldProject = ownedProject("Acme Staging");
    const alice: ObjectID = person();
    joins(alice, production);
    joins(alice, staging, { isInvitationOnly: true });

    await expect(count(production)).resolves.toBe(1);
  });

  test("several teams in one project are one person", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme, { teams: 3 });

    await expect(count(acme)).resolves.toBe(1);
    await clear(acme);
    expect(clearedIds()).toEqual([keyOf(alice)]);
  });

  test("everyone who qualifies is cleared, nobody who does not", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const other: WorldProject = project("Other Org");
    const alice: ObjectID = person();
    const bob: ObjectID = person();
    const carol: ObjectID = person();
    joins(alice, acme);
    joins(bob, acme);
    joins(carol, acme);
    joins(carol, other);

    await expect(clear(acme)).resolves.toBe(2);
    expect(clearedIds().sort()).toEqual([keyOf(alice), keyOf(bob)].sort());
  });
});

describe("who an owner may never clear: the refused cases", () => {
  let acme: WorldProject;

  beforeEach(() => {
    acme = ownedProject("Acme");
  });

  const expectNobody: () => Promise<void> = async (): Promise<void> => {
    await expect(count(acme)).resolves.toBe(0);
    await expect(clear(acme)).resolves.toBe(0);
    expect(clearPeople).not.toHaveBeenCalled();
    expect(recordCleared).not.toHaveBeenCalled();
    expect(notifyCleared).not.toHaveBeenCalled();
  };

  test("someone also in a project that does not require SSO: their password still signs them in there", async () => {
    const alice: ObjectID = person();
    joins(alice, acme);
    joins(
      alice,
      project("Side Project", {
        requireSsoForLogin: false,
        manageSignInWithSso: false,
      }),
    );

    await expectNobody();
  });

  test("someone also in a project that requires SSO but does not manage sign-in with it", async () => {
    const alice: ObjectID = person();
    const keepsItsOwn: WorldProject = project("Keeps Its Own", {
      manageSignInWithSso: false,
    });
    owns(keepsItsOwn);
    joins(alice, acme);
    joins(alice, keepsItsOwn);

    await expectNobody();
  });

  test("someone also in another organization's project that manages sign-in: not the owner's to decide", async () => {
    const alice: ObjectID = person();
    joins(alice, acme);
    joins(alice, project("Another Org")); // managing, but not owned

    await expectNobody();
  });

  test("someone only invited to another organization's project", async () => {
    const alice: ObjectID = person();
    joins(alice, acme);
    joins(alice, project("Another Org"), { isInvitationOnly: true });

    await expectNobody();
  });

  test("someone also in a project where the owner is only a Project Admin", async () => {
    const alice: ObjectID = person();
    const adminOnly: WorldProject = project("Admin Only");
    owns(adminOnly, [Permission.ProjectAdmin]);
    joins(alice, acme);
    joins(alice, adminOnly);

    await expectNobody();
  });

  test("someone also in a project where the owner's Project Owner is blocked by a team", async () => {
    const alice: ObjectID = person();
    const blocked: WorldProject = project("Blocked");
    owns(blocked, [Permission.ProjectOwner], [Permission.ProjectOwner]);
    joins(alice, acme);
    joins(alice, blocked);

    await expectNobody();
  });

  test("someone with a membership left in a project that no longer exists", async () => {
    const alice: ObjectID = person();
    const gone: WorldProject = project("Gone", { isDeleted: true });
    owns(gone);
    joins(alice, acme);
    joins(alice, gone);

    await expectNobody();
  });

  test("a master admin, whatever their projects", async () => {
    const admin: ObjectID = person({ isMasterAdmin: true });
    joins(admin, acme);

    await expectNobody();
  });

  test("the owner themselves: their own settings are in User Profile", async () => {
    // The owner is a member of Acme, with settings, and owns everything.
    await expectNobody();
  });

  test("the owner, whatever case their id is written in", async () => {
    const result: Array<ObjectID> = await ProjectSignInClearing.findClearable({
      candidates: [new ObjectID(OWNER_ID.toString().toUpperCase())],
      ownerUserId: OWNER_ID,
    });

    expect(result).toEqual([]);
  });

  test("someone with nothing saved: there is nothing to clear", async () => {
    const alice: ObjectID = person({ hasSettings: false });
    joins(alice, acme);

    await expectNobody();
  });

  test("someone only invited to this project: they have not joined the organization", async () => {
    const alice: ObjectID = person();
    joins(alice, acme, { isInvitationOnly: true });

    await expectNobody();
  });
});

describe("the project and the owner", () => {
  test("a project that does not require SSO counts nobody, and its clear is refused", async () => {
    const acme: WorldProject = project("Acme", {
      requireSsoForLogin: false,
      manageSignInWithSso: false,
    });
    owns(acme);
    joins(person(), acme);

    await expect(count(acme)).resolves.toBe(0);
    await expect(clear(acme)).rejects.toThrow(
      new BadDataException(CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE),
    );
    expect(clearPeople).not.toHaveBeenCalled();
  });

  test("a project that requires SSO but does not manage sign-in counts nobody, and its clear is refused", async () => {
    const acme: WorldProject = project("Acme", { manageSignInWithSso: false });
    owns(acme);
    joins(person(), acme);

    await expect(count(acme)).resolves.toBe(0);
    await expect(clear(acme)).rejects.toThrow(
      CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
    );
    expect(clearPeople).not.toHaveBeenCalled();
  });

  test("a project that does not exist counts nobody and is not found", async () => {
    const gone: WorldProject = project("Gone", { isDeleted: true });

    await expect(count(gone)).resolves.toBe(0);
    await expect(clear(gone)).rejects.toThrow(NotFoundException);
  });

  test("somebody who is not an owner of this very project clears nobody, whatever else they own", async () => {
    const acme: WorldProject = project("Acme");
    owns(acme, [Permission.ProjectAdmin]);
    joins(OWNER_ID, acme);
    joins(person(), acme);

    await expect(count(acme)).resolves.toBe(0);
    await expect(clear(acme)).resolves.toBe(0);
    expect(clearPeople).not.toHaveBeenCalled();
  });
});

describe("the clear", () => {
  test("is a master admin's clear of each person, never a master admin's own", async () => {
    const acme: WorldProject = ownedProject("Acme");
    joins(person(), acme);

    await clear(acme);

    expect(
      (clearPeople.mock.calls[0]![0] as { isMasterAdminIncluded: boolean })
        .isMasterAdminIncluded,
    ).toBe(false);
  });

  test("records one audit entry per person cleared, by the owner, naming what was removed", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    const bob: ObjectID = person();
    joins(alice, acme);
    joins(bob, acme);

    await clear(acme);

    expect(recordCleared).toHaveBeenCalledTimes(1);
    const events: Array<SignInSettingsClearedAuditEvent> = recordCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedAuditEvent>;

    expect(
      events
        .map((event: SignInSettingsClearedAuditEvent): string => {
          return keyOf(event.userId);
        })
        .sort(),
    ).toEqual([keyOf(alice), keyOf(bob)].sort());

    for (const event of events) {
      expect(keyOf(event.clearedByUserId)).toBe(keyOf(OWNER_ID));
      expect(event.cleared).toEqual(SETTINGS);
    }
  });

  test("emails each person cleared, as cleared by an owner of the project, named by its id (#9991)", async () => {
    const acme: WorldProject = ownedProject("Acme Production");
    const alice: ObjectID = person();
    joins(alice, acme);

    await expect(clear(acme)).resolves.toBe(1);

    expect(notifyCleared).toHaveBeenCalledTimes(1);
    const events: Array<SignInSettingsClearedEmailEvent> = notifyCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedEmailEvent>;

    // The project by its id: its name is read when the email is written.
    expect(events).toEqual([
      {
        userId: alice,
        cleared: SETTINGS,
        clearedBy: SignInSettingsClearedBy.ProjectOwner,
        projectId: acme.id,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("Acme Production");
    // Nothing about the owner who cleared them.
    expect(JSON.stringify(events)).not.toContain(OWNER_ID.toString());
  });

  test("answers once every batch's emails are queued: the queue's own time limit bounds the wait", async () => {
    const acme: WorldProject = ownedProject("Acme");
    joins(person(), acme);

    let isQueued: boolean = false;
    notifyCleared.mockImplementation(async (): Promise<void> => {
      await Promise.resolve();
      isQueued = true;
    });

    await expect(clear(acme)).resolves.toBe(1);
    expect(isQueued).toBe(true);
  });

  test("a master admin made one in the middle of a clear is neither recorded nor emailed", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    const promoted: ObjectID = person();
    joins(alice, acme);
    joins(promoted, acme);

    // Found clearable, then made a master admin before the write.
    clearPeople.mockImplementation(
      async (): Promise<{
        clearedUserIds: Array<ObjectID>;
        sessionsEnded: number;
      }> => {
        return { clearedUserIds: [alice], sessionsEnded: 1 };
      },
    );

    await expect(clear(acme)).resolves.toBe(1);

    const audited: Array<SignInSettingsClearedAuditEvent> = recordCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedAuditEvent>;
    const emailed: Array<SignInSettingsClearedEmailEvent> = notifyCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedEmailEvent>;

    expect(
      audited.map((event: SignInSettingsClearedAuditEvent): string => {
        return keyOf(event.userId);
      }),
    ).toEqual([keyOf(alice)]);
    expect(
      emailed.map((event: SignInSettingsClearedEmailEvent): string => {
        return keyOf(event.userId);
      }),
    ).toEqual([keyOf(alice)]);
  });

  test("reads the rule again right before clearing: someone who joined another organization since the count is not cleared", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme);

    await expect(count(acme)).resolves.toBe(1);

    // Between the count and the clear, Alice joins another organization.
    joins(alice, project("Another Org"));

    await expect(clear(acme)).resolves.toBe(0);
    expect(clearPeople).not.toHaveBeenCalled();
  });

  test("works through the project's people a batch at a time", async () => {
    const acme: WorldProject = ownedProject("Acme");

    for (let index: number = 0; index < CLEAR_BATCH_SIZE + 3; index++) {
      joins(person(), acme);
    }

    await expect(clear(acme)).resolves.toBe(CLEAR_BATCH_SIZE + 3);
    expect(clearPeople).toHaveBeenCalledTimes(2);
    expect(recordCleared).toHaveBeenCalledTimes(2);
    expect(notifyCleared).toHaveBeenCalledTimes(2);
  });

  test("says in the server's log which owner cleared how many, in which project", async () => {
    const acme: WorldProject = ownedProject("Acme");
    joins(person(), acme);

    await clear(acme);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(OWNER_ID.toString()),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(acme.id.toString()),
    );
  });
});

/*
 * ONE MEMBER AT A TIME, FROM THE PROJECT'S USERS LIST (#9993).
 *
 * The list of which members the owner may clear, and the clear of one of
 * them, hold the count's rule exactly - every allowed and refused case
 * above, case by case - and one more: the list names only members of this
 * project that the page asked about, so it names nobody the owner does not
 * already see on its Users list. The clear of one is the bulk clear's own
 * batch: the same audit entry, the same email.
 */

const listFor: (
  worldProject: WorldProject,
  asked: Array<ObjectID>,
) => Promise<Array<PersonSavedSignInSettings>> = async (
  worldProject: WorldProject,
  asked: Array<ObjectID>,
): Promise<Array<PersonSavedSignInSettings>> => {
  return await ProjectSignInClearing.readSavedSettingsOfMembers({
    projectId: worldProject.id,
    ownerUserId: OWNER_ID,
    userIds: asked,
  });
};

const listedIds: (
  worldProject: WorldProject,
  asked: Array<ObjectID>,
) => Promise<Array<string>> = async (
  worldProject: WorldProject,
  asked: Array<ObjectID>,
): Promise<Array<string>> => {
  return (await listFor(worldProject, asked)).map(
    (listed: PersonSavedSignInSettings): string => {
      return listed.userId;
    },
  );
};

const clearOne: (
  worldProject: WorldProject,
  userId: ObjectID,
) => Promise<number> = async (
  worldProject: WorldProject,
  userId: ObjectID,
): Promise<number> => {
  return await ProjectSignInClearing.clearMember({
    projectId: worldProject.id,
    ownerUserId: OWNER_ID,
    userId: userId,
  });
};

describe("one member at a time: who the list names, and who an owner may clear", () => {
  test("a member whose only project is this one, owned and managing sign-in: listed with what they have, and cleared", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme);

    await expect(listFor(acme, [alice])).resolves.toEqual([
      { userId: keyOf(alice), settings: SETTINGS },
    ]);
    await expect(clearOne(acme, alice)).resolves.toBe(1);
    expect(clearedIds()).toEqual([keyOf(alice)]);
  });

  test("a member of several of the owner's projects, every one managing sign-in", async () => {
    const production: WorldProject = ownedProject("Acme Production");
    const staging: WorldProject = ownedProject("Acme Staging");
    const alice: ObjectID = person();
    joins(alice, production);
    joins(alice, staging, { isInvitationOnly: true });

    await expect(listedIds(production, [alice])).resolves.toEqual([
      keyOf(alice),
    ]);
    await expect(clearOne(production, alice)).resolves.toBe(1);
  });

  test("only the people asked about: a clearable member the page did not show is never named", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    const bob: ObjectID = person();
    joins(alice, acme);
    joins(bob, acme);

    await expect(listedIds(acme, [alice])).resolves.toEqual([keyOf(alice)]);
  });

  test("only members of this project: somebody from another of the owner's projects, asked about here, is not named, nor cleared from here", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const staging: WorldProject = ownedProject("Acme Staging");
    const carol: ObjectID = person();
    joins(carol, staging);

    await expect(listedIds(acme, [carol])).resolves.toEqual([]);
    await expect(clearOne(acme, carol)).rejects.toThrow(
      new BadDataException(CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE),
    );
    // Listed and cleared from the project they are in.
    await expect(listedIds(staging, [carol])).resolves.toEqual([keyOf(carol)]);
  });

  test("a person nobody knows of, asked about by id, is nobody", async () => {
    const acme: WorldProject = ownedProject("Acme");

    await expect(listedIds(acme, [ObjectID.generate()])).resolves.toEqual([]);
  });

  test("nobody asked about is nobody, with nothing read", async () => {
    const acme: WorldProject = ownedProject("Acme");
    joins(person(), acme);

    await expect(listFor(acme, [])).resolves.toEqual([]);
    expect(LocalSignInClearing.readSettings).not.toHaveBeenCalled();
  });

  test("what the list says they have is what the clear reads before it clears them", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme);

    const own: LocalSignInSettings = {
      ...SETTINGS,
      hasPassword: false,
      hasPasswordResetLink: true,
      backupCodeCount: 3,
    };
    getJestSpyOn(LocalSignInClearing, "readSettings").mockResolvedValue(own);

    await expect(listFor(acme, [alice])).resolves.toEqual([
      { userId: keyOf(alice), settings: own },
    ]);
  });

  describe("the refused cases, each refused on the list and on the clear", () => {
    let acme: WorldProject;
    let alice: ObjectID;

    beforeEach(() => {
      acme = ownedProject("Acme");
      alice = person();
      joins(alice, acme);
    });

    const expectRefused: (who: ObjectID) => Promise<void> = async (
      who: ObjectID,
    ): Promise<void> => {
      await expect(listedIds(acme, [who])).resolves.toEqual([]);
      await expect(clearOne(acme, who)).rejects.toThrow(
        new BadDataException(CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE),
      );
      expect(clearPeople).not.toHaveBeenCalled();
      expect(recordCleared).not.toHaveBeenCalled();
      expect(notifyCleared).not.toHaveBeenCalled();
    };

    test("also in a project that does not require SSO", async () => {
      joins(
        alice,
        project("Side Project", {
          requireSsoForLogin: false,
          manageSignInWithSso: false,
        }),
      );

      await expectRefused(alice);
    });

    test("also in a project that requires SSO but does not manage sign-in with it, even the owner's", async () => {
      const keepsItsOwn: WorldProject = project("Keeps Its Own", {
        manageSignInWithSso: false,
      });
      owns(keepsItsOwn);
      joins(alice, keepsItsOwn);

      await expectRefused(alice);
    });

    test("also in another organization's project: the owner owns only some of their projects", async () => {
      joins(alice, project("Another Org"));

      await expectRefused(alice);
    });

    test("only invited to another organization's project", async () => {
      joins(alice, project("Another Org"), { isInvitationOnly: true });

      await expectRefused(alice);
    });

    test("also in a project the owner is only a Project Admin of", async () => {
      const adminOnly: WorldProject = project("Admin Only");
      owns(adminOnly, [Permission.ProjectAdmin]);
      joins(alice, adminOnly);

      await expectRefused(alice);
    });

    test("also in a project where a team blocks the owner's Project Owner", async () => {
      const blocked: WorldProject = project("Blocked");
      owns(blocked, [Permission.ProjectOwner], [Permission.ProjectOwner]);
      joins(alice, blocked);

      await expectRefused(alice);
    });

    test("a master admin, whatever their projects", async () => {
      const admin: ObjectID = person({ isMasterAdmin: true });
      joins(admin, acme);

      await expectRefused(admin);
    });

    test("the owner themselves, asked about by their own id, in any case", async () => {
      await expectRefused(OWNER_ID);
      await expectRefused(new ObjectID(OWNER_ID.toString().toUpperCase()));
    });

    test("somebody with nothing saved", async () => {
      const bob: ObjectID = person({ hasSettings: false });
      joins(bob, acme);

      await expectRefused(bob);
    });

    test("somebody only invited to this project", async () => {
      const bob: ObjectID = person();
      joins(bob, acme, { isInvitationOnly: true });

      await expectRefused(bob);
    });
  });

  test("somebody who is not an owner of this project lists nobody and clears nobody, whatever else they own", async () => {
    const acme: WorldProject = project("Acme");
    owns(acme, [Permission.ProjectAdmin]);
    joins(OWNER_ID, acme);
    const alice: ObjectID = person();
    joins(alice, acme);

    await expect(listedIds(acme, [alice])).resolves.toEqual([]);
    await expect(clearOne(acme, alice)).rejects.toThrow(
      CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
    );
    expect(clearPeople).not.toHaveBeenCalled();
  });

  test("a project that does not manage sign-in with SSO lists nobody, and its clear is refused", async () => {
    const acme: WorldProject = project("Acme", { manageSignInWithSso: false });
    owns(acme);
    const alice: ObjectID = person();
    joins(alice, acme);

    await expect(listFor(acme, [alice])).resolves.toEqual([]);
    await expect(clearOne(acme, alice)).rejects.toThrow(
      new BadDataException(CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE),
    );
    expect(clearPeople).not.toHaveBeenCalled();
  });

  test("a project that does not exist lists nobody, and is not found", async () => {
    const gone: WorldProject = project("Gone", { isDeleted: true });

    await expect(listFor(gone, [person()])).resolves.toEqual([]);
    await expect(clearOne(gone, person())).rejects.toThrow(NotFoundException);
  });

  test("the rule is read again right before the clear: somebody who joined another organization since the list is not cleared", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme);

    await expect(listedIds(acme, [alice])).resolves.toEqual([keyOf(alice)]);

    joins(alice, project("Another Org"));

    await expect(clearOne(acme, alice)).rejects.toThrow(
      CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
    );
    expect(clearPeople).not.toHaveBeenCalled();
  });

  test("somebody made a master admin between the rule and the write is not cleared, recorded or emailed, and the clear says so", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme);

    clearPeople.mockResolvedValue({ clearedUserIds: [], sessionsEnded: 0 });

    await expect(clearOne(acme, alice)).rejects.toThrow(
      CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
    );
    expect(
      (recordCleared.mock.calls[0]?.[0] as Array<unknown> | undefined) || [],
    ).toEqual([]);
    expect(
      (notifyCleared.mock.calls[0]?.[0] as Array<unknown> | undefined) || [],
    ).toEqual([]);
  });
});

describe("one member at a time: the clear is the bulk clear's, for one person", () => {
  test("a master admin's clear of exactly that person, never a master admin", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    const bob: ObjectID = person();
    joins(alice, acme);
    joins(bob, acme);

    await clearOne(acme, alice);

    expect(clearPeople).toHaveBeenCalledTimes(1);
    expect(clearPeople.mock.calls[0]![0]).toEqual({
      userIds: [alice],
      isMasterAdminIncluded: false,
    });
  });

  test("the same audit entry and the same email as a bulk clear's of that person", async () => {
    const acme: WorldProject = ownedProject("Acme Production");
    const alice: ObjectID = person();
    joins(alice, acme);

    await clearOne(acme, alice);
    const oneAudit: unknown = recordCleared.mock.calls[0]![0];
    const oneEmail: unknown = notifyCleared.mock.calls[0]![0];

    recordCleared.mockClear();
    notifyCleared.mockClear();

    await clear(acme);
    const bulkAudit: unknown = recordCleared.mock.calls[0]![0];
    const bulkEmail: unknown = notifyCleared.mock.calls[0]![0];

    expect(oneAudit).toEqual(bulkAudit);
    expect(oneEmail).toEqual(bulkEmail);
    expect(oneAudit).toEqual([
      { userId: alice, clearedByUserId: OWNER_ID, cleared: SETTINGS },
    ]);
    expect(oneEmail).toEqual([
      {
        userId: alice,
        cleared: SETTINGS,
        clearedBy: SignInSettingsClearedBy.ProjectOwner,
        projectId: acme.id,
      },
    ]);
  });

  test("what was there is read before it is cleared, for the entry and the email", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme);

    const order: Array<string> = [];
    getJestSpyOn(LocalSignInClearing, "readSettings").mockImplementation(
      async (): Promise<LocalSignInSettings> => {
        order.push("read");
        return SETTINGS;
      },
    );
    clearPeople.mockImplementation(
      async (): Promise<{
        clearedUserIds: Array<ObjectID>;
        sessionsEnded: number;
      }> => {
        order.push("clear");
        return { clearedUserIds: [alice], sessionsEnded: 1 };
      },
    );
    recordCleared.mockImplementation(async (): Promise<void> => {
      order.push("audit");
    });
    notifyCleared.mockImplementation(async (): Promise<void> => {
      order.push("email");
    });

    await clearOne(acme, alice);

    expect(order).toEqual(["read", "clear", "audit", "email"]);
  });

  test("says in the server's log which owner cleared whom, in which project", async () => {
    const acme: WorldProject = ownedProject("Acme");
    const alice: ObjectID = person();
    joins(alice, acme);

    await clearOne(acme, alice);

    const logged: string = (logger.info as unknown as jest.Mock).mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .join("\n");

    expect(logged).toContain(OWNER_ID.toString());
    expect(logged).toContain(alice.toString());
    expect(logged).toContain(acme.id.toString());
  });
});
