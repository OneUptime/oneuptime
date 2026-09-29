import TeamService from "../../../Server/Services/TeamService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Errors from "../../../Server/Utils/Errors";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import logger from "../../../Server/Utils/Logger";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * SCIM Push Groups team locks. While a project's SCIM configuration has Push
 * Groups on, its identity provider owns team membership, so OneUptime refuses
 * to create or delete teams, invite or remove members, and lifts the
 * "at least one member" guard (the IdP may empty a team).
 *
 * The locks follow the RUNTIME state of SCIM
 * (EnterpriseEdition.isFeatureActive(SCIM), through EditionEnforcement):
 *   - SCIM active (the Enterprise Edition with billing on, or with a license
 *     that covers SCIM - valid, grace, trial - or an unknown license state):
 *     locks ON, the identity provider owns the teams.
 *   - SCIM not active (the Community Edition, or an Enterprise install whose
 *     license lapsed): locks OFF. No SCIM endpoint answers the identity
 *     provider there, so a Push Groups setting left on would leave teams
 *     nobody can manage.
 * A license change applies to the next write, without a restart.
 *
 * Billing and the edition are pinned in every test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const INVITEE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const EDITION_CASES: Array<EditionStateCase> = createEditionStateCases();

const toMatrix: (
  cases: Array<EditionStateCase>,
) => Array<[string, EditionStateCase]> = (
  cases: Array<EditionStateCase>,
): Array<[string, EditionStateCase]> => {
  return cases.map(
    (editionCase: EditionStateCase): [string, EditionStateCase] => {
      return [editionCase.label, editionCase];
    },
  );
};

// Every state in which SCIM is active, so Push Groups locks the teams.
const LOCKED_MATRIX: Array<[string, EditionStateCase]> = toMatrix(
  EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
    return editionCase.isActive;
  }),
);

// The Community Edition and every lapsed Enterprise license: not locked.
const UNLOCKED_MATRIX: Array<[string, EditionStateCase]> = toMatrix(
  EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
    return !editionCase.isActive;
  }),
);

const userProps: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return { userId: USER_ID, tenantId: PROJECT_ID };
};

const buildTeam: () => Team = (): Team => {
  const team: Team = new Team();
  team._id = TEAM_ID.toString();
  team.name = "Backend";
  team.projectId = PROJECT_ID;
  team.isTeamDeleteable = true;
  return team;
};

const buildMember: (data: {
  shouldHaveAtLeastOneMember: boolean;
}) => TeamMember = (data: {
  shouldHaveAtLeastOneMember: boolean;
}): TeamMember => {
  const member: TeamMember = new TeamMember();
  member.userId = INVITEE_ID;
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;
  member.hasAcceptedInvitation = true;

  const team: Team = new Team();
  team._id = TEAM_ID.toString();
  team.shouldHaveAtLeastOneMember = data.shouldHaveAtLeastOneMember;
  member.team = team;

  return member;
};

let scimCount: SpyInstance;

describe("SCIM Push Groups team locks by edition", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();

    getJestSpyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    getJestSpyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    // Push Groups is ON for the project in every test below.
    scimCount = getJestSpyOn(ProjectSCIMService, "countBy").mockResolvedValue(
      new PositiveNumber(1),
    );
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("TeamService: creating and deleting teams", () => {
    const createTeam: (props: Record<string, unknown>) => Promise<unknown> = (
      props: Record<string, unknown>,
    ): Promise<unknown> => {
      const team: Team = new Team();
      team.projectId = PROJECT_ID;
      team.name = "Backend";

      return (TeamService as any).onBeforeCreate({
        data: team,
        props: props,
      });
    };

    const deleteTeam: (props: Record<string, unknown>) => Promise<unknown> = (
      props: Record<string, unknown>,
    ): Promise<unknown> => {
      return (TeamService as any).onBeforeDelete({
        query: { _id: TEAM_ID },
        props: props,
      });
    };

    let memberDelete: SpyInstance;

    beforeEach(() => {
      getJestSpyOn(TeamService, "findBy").mockResolvedValue([buildTeam()]);
      getJestSpyOn(
        ModelPermission,
        "checkDeleteQueryPermission",
      ).mockImplementation(
        async (_modelType: unknown, query: unknown): Promise<unknown> => {
          return query;
        },
      );
      memberDelete = getJestSpyOn(
        TeamMemberService,
        "deleteBy",
      ).mockResolvedValue(0);
    });

    test.each(LOCKED_MATRIX)(
      "SCIM active (%s): creating a team is locked",
      async (_label: string, editionCase: EditionStateCase) => {
        editionCase.apply();

        await expect(createTeam(userProps())).rejects.toThrow(
          "Cannot create teams while SCIM Push Groups is enabled for this project",
        );
      },
    );

    test.each(LOCKED_MATRIX)(
      "SCIM active (%s): deleting a team is locked before any member is removed",
      async (_label: string, editionCase: EditionStateCase) => {
        editionCase.apply();

        await expect(deleteTeam(userProps())).rejects.toThrow(
          "Cannot delete teams while SCIM Push Groups is enabled for this project",
        );
        expect(memberDelete).not.toHaveBeenCalled();
      },
    );

    test.each(UNLOCKED_MATRIX)(
      "SCIM not active (%s): creating a team is not locked and SCIM is not consulted",
      async (_label: string, editionCase: EditionStateCase) => {
        editionCase.apply();

        await expect(createTeam(userProps())).resolves.toEqual(
          expect.objectContaining({ carryForward: null }),
        );
        expect(scimCount).not.toHaveBeenCalled();
      },
    );

    test.each(UNLOCKED_MATRIX)(
      "SCIM not active (%s): deleting a team is not locked",
      async (_label: string, editionCase: EditionStateCase) => {
        editionCase.apply();

        await expect(deleteTeam(userProps())).resolves.toEqual(
          expect.objectContaining({ carryForward: null }),
        );
        expect(scimCount).not.toHaveBeenCalled();
        expect(memberDelete).toHaveBeenCalledTimes(1);
      },
    );

    test("internal root writes are never locked, on either edition", async () => {
      installFakeEnterpriseModule();

      await expect(createTeam({ isRoot: true })).resolves.toBeDefined();
      await expect(deleteTeam({ isRoot: true })).resolves.toBeDefined();
      expect(scimCount).not.toHaveBeenCalled();
    });

    test("with Push Groups off the Enterprise Edition does not lock either", async () => {
      installFakeEnterpriseModule();
      scimCount.mockResolvedValue(new PositiveNumber(0));

      await expect(createTeam(userProps())).resolves.toBeDefined();
      await expect(deleteTeam(userProps())).resolves.toBeDefined();
      expect(scimCount).toHaveBeenCalled();
    });
  });

  describe("TeamMemberService: inviting and removing members", () => {
    const inviteMember: (props: Record<string, unknown>) => Promise<unknown> = (
      props: Record<string, unknown>,
    ): Promise<unknown> => {
      const member: TeamMember = new TeamMember();
      member.projectId = PROJECT_ID;
      member.teamId = TEAM_ID;
      member.userId = INVITEE_ID;

      return (TeamMemberService as any).onBeforeCreate({
        data: member,
        props: props,
      });
    };

    const removeMember: (props: Record<string, unknown>) => Promise<unknown> = (
      props: Record<string, unknown>,
    ): Promise<unknown> => {
      return (TeamMemberService as any).onBeforeDelete({
        query: { teamId: TEAM_ID, userId: INVITEE_ID },
        props: props,
      });
    };

    let memberLookup: SpyInstance;

    beforeEach(() => {
      getJestSpyOn(TeamService, "findOneBy").mockResolvedValue(buildTeam());
      getJestSpyOn(
        TeamPermissionService,
        "assertCanGrantTeamPermissions",
      ).mockResolvedValue(undefined);
      // "Is this user already invited?" - no.
      getJestSpyOn(TeamMemberService, "findOneBy").mockResolvedValue(null);
      memberLookup = getJestSpyOn(
        TeamMemberService,
        "findBy",
      ).mockResolvedValue([buildMember({ shouldHaveAtLeastOneMember: false })]);
      getJestSpyOn(
        OnCallDutyPolicyTimeLogService,
        "endTimeForUser",
      ).mockResolvedValue(undefined);
      // The billing seat check (billing on) finds no seat limit.
      getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(null);
    });

    test.each(LOCKED_MATRIX)(
      "SCIM active (%s): inviting a member is locked",
      async (_label: string, editionCase: EditionStateCase) => {
        editionCase.apply();

        await expect(inviteMember(userProps())).rejects.toThrow(
          "Cannot invite team members while SCIM Push Groups is enabled for this project",
        );
      },
    );

    test.each(LOCKED_MATRIX)(
      "SCIM active (%s): removing a member is locked",
      async (_label: string, editionCase: EditionStateCase) => {
        editionCase.apply();

        await expect(removeMember(userProps())).rejects.toThrow(
          "Cannot delete team members while SCIM Push Groups is enabled for this project",
        );
      },
    );

    test.each(UNLOCKED_MATRIX)(
      "SCIM not active (%s): inviting a member is not locked",
      async (_label: string, editionCase: EditionStateCase) => {
        editionCase.apply();

        await expect(inviteMember(userProps())).resolves.toEqual(
          expect.objectContaining({ carryForward: null }),
        );
        expect(scimCount).not.toHaveBeenCalled();
      },
    );

    test.each(UNLOCKED_MATRIX)(
      "SCIM not active (%s): removing a member is not locked",
      async (_label: string, editionCase: EditionStateCase) => {
        editionCase.apply();

        await expect(removeMember(userProps())).resolves.toEqual(
          expect.objectContaining({ deleteBy: expect.anything() }),
        );
        expect(scimCount).not.toHaveBeenCalled();
      },
    );

    describe("the one-member guard", () => {
      beforeEach(() => {
        memberLookup.mockResolvedValue([
          buildMember({ shouldHaveAtLeastOneMember: true }),
        ]);
        // The member being removed is the team's last accepted member.
        getJestSpyOn(TeamMemberService, "countBy").mockResolvedValue(
          new PositiveNumber(1),
        );
      });

      test("is lifted while SCIM is active and Push Groups owns the team (the IdP may empty it)", async () => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus("grace"),
        });

        await expect(removeMember({ isRoot: true })).resolves.toBeDefined();
      });

      test("applies again once the license lapsed, because no IdP manages the team any more", async () => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus("expired"),
        });

        await expect(removeMember({ isRoot: true })).rejects.toThrow(
          Errors.TeamMemberService.ONE_MEMBER_REQUIRED,
        );
        expect(scimCount).not.toHaveBeenCalled();
      });

      test("applies on the Community Edition, where no IdP manages the team", async () => {
        await expect(removeMember({ isRoot: true })).rejects.toThrow(
          Errors.TeamMemberService.ONE_MEMBER_REQUIRED,
        );
        expect(scimCount).not.toHaveBeenCalled();
      });
    });

    test("internal root invites are never locked", async () => {
      installFakeEnterpriseModule();

      await expect(inviteMember({ isRoot: true })).resolves.toBeDefined();
    });

    test("the lock follows the license at write time: relaxed while lapsed, back after renewal", async () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid"),
      });

      await expect(inviteMember(userProps())).rejects.toThrow(
        "Cannot invite team members while SCIM Push Groups is enabled for this project",
      );

      fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));

      await expect(inviteMember(userProps())).resolves.toEqual(
        expect.objectContaining({ carryForward: null }),
      );

      fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

      await expect(inviteMember(userProps())).rejects.toThrow(
        "Cannot invite team members while SCIM Push Groups is enabled for this project",
      );
    });
  });
});
