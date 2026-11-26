import { beforeEach, describe, expect, test } from "@jest/globals";
import GlobalSsoProvisioning, {
  GlobalSsoAttachments,
  GlobalSsoNewcomerRefusal,
  GlobalSsoProviderType,
} from "../../../FeatureSet/Identity/Utils/GlobalSsoProvisioning";
import SsoTeamMembership, {
  SsoTeamMembershipOutcome,
} from "../../../FeatureSet/Identity/Utils/SsoTeamMembership";
import Team from "Common/Models/DatabaseModels/Team";
import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";

/*
 * ---------------------------------------------------------------------------
 * WHOM THE SERVER'S OWN SINGLE SIGN-ON GIVES AN ACCOUNT, AND WHICH PROJECTS
 * IT ADDS PEOPLE TO (#11149) - Utils/GlobalSsoProvisioning, which both of
 * its callbacks ask (SAML and OpenID Connect), with the services stood in.
 *
 * SsoAutoProvisioningPostgres.test.ts runs the same rules through whole
 * sign-ins against Postgres; these pin each of them on its own, for both
 * protocols: which attachments people join, whom an account is made for
 * and why not, what the server's log says, who joins what, and when
 * "Attached projects only" leaves nobody a project.
 * ---------------------------------------------------------------------------
 */

const oidcAttachmentsFindBy: jest.Mock = jest.fn();
const oidcAttachmentsCountBy: jest.Mock = jest.fn();
const samlAttachmentsFindBy: jest.Mock = jest.fn();
const samlAttachmentsCountBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/GlobalOidcProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return oidcAttachmentsFindBy(...args);
      },
      countBy: (...args: Array<unknown>): unknown => {
        return oidcAttachmentsCountBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/GlobalSsoProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return samlAttachmentsFindBy(...args);
      },
      countBy: (...args: Array<unknown>): unknown => {
        return samlAttachmentsCountBy(...args);
      },
    },
  };
});

const teamMemberCountBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      countBy: (...args: Array<unknown>): unknown => {
        return teamMemberCountBy(...args);
      },
    },
  };
});

const PROVIDER_ID: ObjectID = new ObjectID(
  "11149000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("11149000-0000-4000-8000-000000000002");
const PLATFORM: ObjectID = new ObjectID("11149000-0000-4000-8000-000000000003");
const PAYMENTS: ObjectID = new ObjectID("11149000-0000-4000-8000-000000000004");
const PLATFORM_MEMBERS: ObjectID = new ObjectID(
  "11149000-0000-4000-8000-000000000005",
);
const PAYMENTS_MEMBERS: ObjectID = new ObjectID(
  "11149000-0000-4000-8000-000000000006",
);
const PAYMENTS_OWNERS: ObjectID = new ObjectID(
  "11149000-0000-4000-8000-000000000007",
);

// Which project each team is a team of.
const TEAM_PROJECTS: Record<string, string> = {
  [PLATFORM_MEMBERS.toString()]: PLATFORM.toString(),
  [PAYMENTS_MEMBERS.toString()]: PAYMENTS.toString(),
  [PAYMENTS_OWNERS.toString()]: PAYMENTS.toString(),
};

interface ProtocolCase {
  name: string;
  providerType: GlobalSsoProviderType;
  providerColumn: string;
  findBy: jest.Mock;
  countBy: jest.Mock;
  otherFindBy: jest.Mock;
}

const PROTOCOLS: Array<ProtocolCase> = [
  {
    name: "OpenID Connect",
    providerType: SsoProviderType.GlobalOIDC,
    providerColumn: "globalOidcId",
    findBy: oidcAttachmentsFindBy,
    countBy: oidcAttachmentsCountBy,
    otherFindBy: samlAttachmentsFindBy,
  },
  {
    name: "SAML",
    providerType: SsoProviderType.GlobalSSO,
    providerColumn: "globalSsoId",
    findBy: samlAttachmentsFindBy,
    countBy: samlAttachmentsCountBy,
    otherFindBy: oidcAttachmentsFindBy,
  },
];

// An attachment as its service reads it: its project and its teams.
function attachment(
  projectId: ObjectID,
  teams: Array<ObjectID>,
): Record<string, unknown> {
  return {
    projectId: projectId,
    teams: teams.map((id: ObjectID): Team => {
      return new Team(id);
    }),
  };
}

function idsOf(teams: Array<Team>): Array<string> {
  return teams.map((team: Team): string => {
    return team.id!.toString();
  });
}

const REQUEST: ExpressRequest = {
  headers: {},
  socket: { remoteAddress: "203.0.113.7" },
  get: (): undefined => {
    return undefined;
  },
} as unknown as ExpressRequest;

let getProjectTeams: jest.SpiedFunction<
  typeof SsoTeamMembership.getProjectTeams
>;
let addToTeams: jest.SpiedFunction<typeof SsoTeamMembership.addToTeams>;
let info: jest.SpiedFunction<typeof logger.info>;
let warn: jest.SpiedFunction<typeof logger.warn>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();

  // A team is its project's when the fixture says so.
  getProjectTeams = jest
    .spyOn(SsoTeamMembership, "getProjectTeams")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        teams: Array<Team> | null | undefined;
      }): Promise<Array<Team>> => {
        return (data.teams || []).filter((team: Team): boolean => {
          return (
            TEAM_PROJECTS[team.id!.toString()] === data.projectId.toString()
          );
        });
      },
    );

  addToTeams = jest
    .spyOn(SsoTeamMembership, "addToTeams")
    .mockResolvedValue(SsoTeamMembershipOutcome.Added);

  info = jest.spyOn(logger, "info").mockImplementation((): never => {
    return undefined as never;
  });
  warn = jest.spyOn(logger, "warn").mockImplementation((): never => {
    return undefined as never;
  });

  teamMemberCountBy.mockResolvedValue(new PositiveNumber(0));
});

describe("GlobalSsoProvisioning.readAttachments", () => {
  describe.each(PROTOCOLS)("$name", (protocol: ProtocolCase) => {
    test("reads the provider's attachments that are on, by its own column, as OneUptime's own read", async () => {
      protocol.findBy.mockResolvedValue([]);

      await GlobalSsoProvisioning.readAttachments({
        providerType: protocol.providerType,
        providerId: PROVIDER_ID,
      });

      expect(protocol.findBy).toHaveBeenCalledTimes(1);
      expect(protocol.otherFindBy).not.toHaveBeenCalled();

      const findBy: Record<string, unknown> = protocol.findBy.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(findBy["query"]).toEqual({
        [protocol.providerColumn]: PROVIDER_ID,
        isEnabled: true,
      });
      expect(findBy["select"]).toEqual({
        projectId: true,
        teams: { _id: true },
      });
      expect(findBy["props"]).toEqual({ isRoot: true });
    });

    test("nothing attached: default-all, no project, nobody joins anything", async () => {
      protocol.findBy.mockResolvedValue([]);

      await expect(
        GlobalSsoProvisioning.readAttachments({
          providerType: protocol.providerType,
          providerId: PROVIDER_ID,
        }),
      ).resolves.toEqual({
        isDefaultAllMode: true,
        attachedProjectIds: [],
        joinableProjects: [],
      });
      expect(getProjectTeams).not.toHaveBeenCalled();
    });

    test("people join an attached project only in its own teams; one with none of its own is attached, and joins nobody", async () => {
      protocol.findBy.mockResolvedValue([
        attachment(PLATFORM, [PLATFORM_MEMBERS, PAYMENTS_OWNERS]),
        attachment(PAYMENTS, []),
      ]);

      const read: GlobalSsoAttachments =
        await GlobalSsoProvisioning.readAttachments({
          providerType: protocol.providerType,
          providerId: PROVIDER_ID,
        });

      expect(read.isDefaultAllMode).toBe(false);
      expect(read.attachedProjectIds).toEqual([PLATFORM, PAYMENTS]);
      expect(read.joinableProjects).toHaveLength(1);
      expect(read.joinableProjects[0]!.projectId).toEqual(PLATFORM);
      expect(idsOf(read.joinableProjects[0]!.teams)).toEqual([
        PLATFORM_MEMBERS.toString(),
      ]);

      // The teams are read only for an attachment that names some.
      expect(getProjectTeams).toHaveBeenCalledTimes(1);

      // Payments' owners on Platform's attachment: said, by ids alone.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(
        `attached to project ${PLATFORM.toString()} with 1 team(s) that are not teams of that project`,
      );
    });

    test("an attachment naming only another project's team joins nobody", async () => {
      protocol.findBy.mockResolvedValue([
        attachment(PLATFORM, [PAYMENTS_OWNERS]),
      ]);

      const read: GlobalSsoAttachments =
        await GlobalSsoProvisioning.readAttachments({
          providerType: protocol.providerType,
          providerId: PROVIDER_ID,
        });

      expect(read.attachedProjectIds).toEqual([PLATFORM]);
      expect(read.joinableProjects).toEqual([]);
    });
  });
});

describe("GlobalSsoProvisioning.getNewcomerRefusal", () => {
  const nothingAttached: GlobalSsoAttachments = {
    isDefaultAllMode: true,
    attachedProjectIds: [],
    joinableProjects: [],
  };

  const attachedWithoutTeams: GlobalSsoAttachments = {
    isDefaultAllMode: false,
    attachedProjectIds: [PLATFORM],
    joinableProjects: [],
  };

  const attachedWithTeams: GlobalSsoAttachments = {
    isDefaultAllMode: false,
    attachedProjectIds: [PLATFORM],
    joinableProjects: [
      { projectId: PLATFORM, teams: [new Team(PLATFORM_MEMBERS)] },
    ],
  };

  test.each([
    // The reported case: "Get one on their first sign-in", nothing attached.
    [false, nothingAttached, GlobalSsoNewcomerRefusal.NoProjectAttached],
    [undefined, nothingAttached, GlobalSsoNewcomerRefusal.NoProjectAttached],
    [
      false,
      attachedWithoutTeams,
      GlobalSsoNewcomerRefusal.NoAttachedProjectHasTeams,
    ],
    [false, attachedWithTeams, null],
    [undefined, attachedWithTeams, null],
    // "Must be invited first" wins, whatever is attached.
    [true, nothingAttached, GlobalSsoNewcomerRefusal.InviteFirst],
    [true, attachedWithoutTeams, GlobalSsoNewcomerRefusal.InviteFirst],
    [true, attachedWithTeams, GlobalSsoNewcomerRefusal.InviteFirst],
  ])(
    "disableSignUpWithSso %s: %#",
    (
      disableSignUpWithSso: boolean | undefined,
      attachments: GlobalSsoAttachments,
      refusal: GlobalSsoNewcomerRefusal | null,
    ) => {
      expect(
        GlobalSsoProvisioning.getNewcomerRefusal({
          disableSignUpWithSso: disableSignUpWithSso,
          attachments: attachments,
        }),
      ).toBe(refusal);
    },
  );
});

describe("GlobalSsoProvisioning.logNewcomerTurnedAway", () => {
  test.each([
    [
      GlobalSsoNewcomerRefusal.NoProjectAttached,
      "no project is attached to it, and people get an account only by joining an attached project",
    ],
    [
      GlobalSsoNewcomerRefusal.NoAttachedProjectHasTeams,
      "none of its attached projects has teams of that project for people to join",
    ],
    [
      GlobalSsoNewcomerRefusal.InviteFirst,
      'its "People without an account" is "Must be invited first"',
    ],
  ])(
    "%s: says why, and what would let them in, naming the provider and nobody else",
    (refusal: GlobalSsoNewcomerRefusal, why: string) => {
      for (const protocol of PROTOCOLS) {
        info.mockClear();

        GlobalSsoProvisioning.logNewcomerTurnedAway({
          req: REQUEST,
          providerType: protocol.providerType,
          providerId: PROVIDER_ID,
          providerName: "Contoso Entra ID",
          refusal: refusal,
        });

        expect(info).toHaveBeenCalledTimes(1);

        const line: string = String(info.mock.calls[0]![0]);

        expect(line).toContain(
          `The server's ${protocol.name} provider "Contoso Entra ID" (${PROVIDER_ID.toString()}) turned away someone with no account, without making one: ${why}`,
        );
        expect(line.toLowerCase()).toContain("invite them to a project first");

        if (refusal !== GlobalSsoNewcomerRefusal.InviteFirst) {
          expect(line).toContain("Attached Projects");
        }
      }
    },
  );
});

describe("GlobalSsoProvisioning.addToAttachedProjects", () => {
  const twoProjects: GlobalSsoAttachments = {
    isDefaultAllMode: false,
    attachedProjectIds: [PLATFORM, PAYMENTS],
    joinableProjects: [
      { projectId: PLATFORM, teams: [new Team(PLATFORM_MEMBERS)] },
      { projectId: PAYMENTS, teams: [new Team(PAYMENTS_MEMBERS)] },
    ],
  };

  test("joins each project they are not in yet, in its teams, and leaves a project they are in as it is", async () => {
    // A member of Platform already.
    teamMemberCountBy.mockImplementation(
      (countBy: {
        query: Record<string, unknown>;
      }): Promise<PositiveNumber> => {
        return Promise.resolve(
          new PositiveNumber(
            String(countBy.query["projectId"]) === PLATFORM.toString() ? 1 : 0,
          ),
        );
      },
    );

    await GlobalSsoProvisioning.addToAttachedProjects({
      req: REQUEST,
      providerType: SsoProviderType.GlobalOIDC,
      attachments: twoProjects,
      userId: USER_ID,
    });

    expect(addToTeams).toHaveBeenCalledTimes(1);

    const added: Parameters<typeof SsoTeamMembership.addToTeams>[0] =
      addToTeams.mock.calls[0]![0];

    expect(added.projectId).toEqual(PAYMENTS);
    expect(added.userId).toEqual(USER_ID);
    expect(idsOf(added.teams!)).toEqual([PAYMENTS_MEMBERS.toString()]);
  });

  test("a project with no room is left out and logged, by ids, and the others are still joined", async () => {
    addToTeams.mockResolvedValueOnce(SsoTeamMembershipOutcome.NoRoom);

    await GlobalSsoProvisioning.addToAttachedProjects({
      req: REQUEST,
      providerType: SsoProviderType.GlobalSSO,
      attachments: twoProjects,
      userId: USER_ID,
    });

    expect(addToTeams).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toBe(
      `The server's SAML provider did not add user ${USER_ID.toString()} to project ${PLATFORM.toString()}: it has no room for another person.`,
    );
  });

  test("nothing attached: nobody is added to anything", async () => {
    await GlobalSsoProvisioning.addToAttachedProjects({
      req: REQUEST,
      providerType: SsoProviderType.GlobalOIDC,
      attachments: {
        isDefaultAllMode: true,
        attachedProjectIds: [],
        joinableProjects: [],
      },
      userId: USER_ID,
    });

    expect(teamMemberCountBy).not.toHaveBeenCalled();
    expect(addToTeams).not.toHaveBeenCalled();
  });
});

describe("GlobalSsoProvisioning.isSignInRestrictedFromEveryProject", () => {
  describe.each(PROTOCOLS)("$name", (protocol: ProtocolCase) => {
    const nothingOn: GlobalSsoAttachments = {
      isDefaultAllMode: true,
      attachedProjectIds: [],
      joinableProjects: [],
    };

    test("no attachment at all: the sign-in counts in every project", async () => {
      protocol.countBy.mockResolvedValue(new PositiveNumber(0));

      await expect(
        GlobalSsoProvisioning.isSignInRestrictedFromEveryProject({
          providerType: protocol.providerType,
          providerId: PROVIDER_ID,
          attachments: nothingOn,
          userId: USER_ID,
        }),
      ).resolves.toBe(false);

      // Every row, on or off.
      expect(
        (protocol.countBy.mock.calls[0]![0] as Record<string, unknown>)[
          "query"
        ],
      ).toEqual({ [protocol.providerColumn]: PROVIDER_ID });
    });

    test("attachments, every one of them off: the sign-in counts in no project, as every request reads it", async () => {
      protocol.countBy.mockResolvedValue(new PositiveNumber(2));

      await expect(
        GlobalSsoProvisioning.isSignInRestrictedFromEveryProject({
          providerType: protocol.providerType,
          providerId: PROVIDER_ID,
          attachments: nothingOn,
          userId: USER_ID,
        }),
      ).resolves.toBe(true);
    });

    test("attached projects: restricted unless they are in one of them", async () => {
      const attached: GlobalSsoAttachments = {
        isDefaultAllMode: false,
        attachedProjectIds: [PLATFORM],
        joinableProjects: [],
      };

      for (const [memberships, restricted] of [
        [0, true],
        [1, false],
      ] as Array<[number, boolean]>) {
        teamMemberCountBy.mockResolvedValueOnce(
          new PositiveNumber(memberships),
        );

        await expect(
          GlobalSsoProvisioning.isSignInRestrictedFromEveryProject({
            providerType: protocol.providerType,
            providerId: PROVIDER_ID,
            attachments: attached,
            userId: USER_ID,
          }),
        ).resolves.toBe(restricted);
      }

      // Never the attachments' rows: the ones on are known.
      expect(protocol.countBy).not.toHaveBeenCalled();
    });
  });
});
