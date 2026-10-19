import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";

/*
 * The accounts, teams and memberships the project SCIM server reads and
 * writes, in memory, with fakes of the services it reads and writes them
 * through - enough of each service for every SCIM route. A suite mocks the
 * services with these and drives the real routers over HTTP:
 *
 *   jest.mock("Common/Server/Services/UserService", () => {
 *     const w = jest.requireActual("./InMemorySCIMWorld");
 *     return { __esModule: true, default: w.fakeUserService };
 *   });
 *
 * and the same for TeamMemberService, TeamService and
 * UserProjectSsoConsentService; scimWorld.reset() before each test.
 */

export interface WorldUser {
  id: string;
  email: string;
  name: string;
  isMasterAdmin: boolean;
}

export interface WorldMembership {
  id: string;
  projectId: string;
  userId: string;
  teamId: string;
  hasAcceptedInvitation: boolean;
  createdAt: Date;
}

export interface WorldTeam {
  id: string;
  projectId: string;
  name: string;
  isTeamDeleteable: boolean;
  createdAt: Date;
}

class InMemorySCIMWorld {
  public users: Array<WorldUser> = [];
  public memberships: Array<WorldMembership> = [];
  public teams: Array<WorldTeam> = [];
  public consents: Array<{ userId: string; projectId: string }> = [];

  private clock: number = Date.parse("2026-01-01T00:00:00.000Z");

  public reset(): void {
    this.users = [];
    this.memberships = [];
    this.teams = [];
    this.consents = [];
  }

  public tick(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }

  public seedUser(data: { email: string; name?: string }): string {
    const id: string = idOf(ObjectID.generate());
    this.users.push({
      id: id,
      email: data.email.toLowerCase(),
      name: data.name || data.email.split("@")[0]!,
      isMasterAdmin: false,
    });
    return id;
  }

  public seedTeam(data: { projectId: string; name: string }): string {
    const id: string = idOf(ObjectID.generate());
    this.teams.push({
      id: id,
      projectId: idOf(data.projectId),
      name: data.name,
      isTeamDeleteable: true,
      createdAt: this.tick(),
    });
    return id;
  }

  public seedMembership(data: {
    userId: string;
    projectId: string;
    teamId: string;
    accepted?: boolean;
  }): void {
    this.memberships.push({
      id: idOf(ObjectID.generate()),
      projectId: idOf(data.projectId),
      userId: idOf(data.userId),
      teamId: idOf(data.teamId),
      hasAcceptedInvitation: data.accepted !== false,
      createdAt: this.tick(),
    });
  }

  public userByEmail(email: string): WorldUser | undefined {
    return this.users.find((user: WorldUser): boolean => {
      return user.email === email.toLowerCase();
    });
  }

  public teamIdsOf(userId: string, projectId: string): Array<string> {
    return this.memberships
      .filter((row: WorldMembership): boolean => {
        return row.userId === idOf(userId) && row.projectId === idOf(projectId);
      })
      .map((row: WorldMembership): string => {
        return row.teamId;
      });
  }
}

export const scimWorld: InMemorySCIMWorld = new InMemorySCIMWorld();

export const idOf: (value: unknown) => string = (value: unknown): string => {
  return String(value).toLowerCase();
};

/*
 * A query value as the services receive it: an id (string or ObjectID), a
 * boolean, an Email, or a TypeORM Raw operator - QueryHelper.any's list of
 * ids, or findWithSameText's one lower-cased text.
 */
const matchesValue: (actual: unknown, expected: unknown) => boolean = (
  actual: unknown,
  expected: unknown,
): boolean => {
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    expected as { objectLiteralParameters?: Record<string, unknown> };

  if (
    operator &&
    typeof operator === "object" &&
    operator.objectLiteralParameters
  ) {
    const parameter: unknown = Object.values(
      operator.objectLiteralParameters,
    )[0];
    const values: Array<unknown> = Array.isArray(parameter)
      ? parameter
      : parameter === undefined
        ? []
        : [parameter];

    return values.map(idOf).includes(idOf(actual));
  }

  if (typeof expected === "boolean") {
    return Boolean(actual) === expected;
  }

  return idOf(actual) === idOf(expected);
};

const matchesQuery: (
  row: unknown,
  query: Record<string, unknown>,
) => boolean = (row: unknown, query: Record<string, unknown>): boolean => {
  const columns: Record<string, unknown> = row as Record<string, unknown>;

  return Object.entries(query).every(([key, expected]: [string, unknown]) => {
    return matchesValue(columns[key === "_id" ? "id" : key], expected);
  });
};

const toUser: (row: WorldUser) => User = (row: WorldUser): User => {
  const user: User = new User(new ObjectID(row.id));
  user.email = new Email(row.email);
  user.name = new Name(row.name);
  user.isMasterAdmin = row.isMasterAdmin;
  return user;
};

const toMember: (row: WorldMembership) => TeamMember = (
  row: WorldMembership,
): TeamMember => {
  const member: TeamMember = new TeamMember(new ObjectID(row.id));
  member.projectId = new ObjectID(row.projectId);
  member.userId = new ObjectID(row.userId);
  member.teamId = new ObjectID(row.teamId);
  member.hasAcceptedInvitation = row.hasAcceptedInvitation;
  member.createdAt = row.createdAt;

  const user: WorldUser | undefined = scimWorld.users.find(
    (item: WorldUser): boolean => {
      return item.id === row.userId;
    },
  );

  if (user) {
    member.user = toUser(user);
  }

  return member;
};

const toTeam: (row: WorldTeam) => Team = (row: WorldTeam): Team => {
  const team: Team = new Team(new ObjectID(row.id));
  team.projectId = new ObjectID(row.projectId);
  team.name = row.name;
  team.isTeamDeleteable = row.isTeamDeleteable;
  team.createdAt = row.createdAt;
  team.updatedAt = row.createdAt;
  return team;
};

type Query = { query: Record<string, unknown> };

export const fakeUserService: Record<string, unknown> = {
  findOneBy: async (args: Query): Promise<User | null> => {
    const row: WorldUser | undefined = scimWorld.users.find(
      (item: WorldUser): boolean => {
        return matchesQuery(item, args.query);
      },
    );
    return row ? toUser(row) : null;
  },
  findOneById: async (args: { id: unknown }): Promise<User | null> => {
    const row: WorldUser | undefined = scimWorld.users.find(
      (item: WorldUser): boolean => {
        return item.id === idOf(args.id);
      },
    );
    return row ? toUser(row) : null;
  },
  findBy: async (args: Query): Promise<Array<User>> => {
    return scimWorld.users
      .filter((item: WorldUser): boolean => {
        return matchesQuery(item, args.query);
      })
      .map(toUser);
  },
  createByEmail: async (args: { email: Email; name: Name }): Promise<User> => {
    const row: WorldUser = {
      id: idOf(ObjectID.generate()),
      email: args.email.toString(),
      name: args.name.toString(),
      isMasterAdmin: false,
    };
    scimWorld.users.push(row);
    return toUser(row);
  },
  updateOneById: async (args: {
    id: unknown;
    data: { email?: Email; name?: Name };
  }): Promise<void> => {
    const row: WorldUser | undefined = scimWorld.users.find(
      (item: WorldUser): boolean => {
        return item.id === idOf(args.id);
      },
    );

    if (row && args.data.email) {
      row.email = args.data.email.toString();
    }

    if (row && args.data.name) {
      row.name = args.data.name.toString();
    }
  },
};

export const fakeTeamMemberService: Record<string, unknown> = {
  findOneBy: async (args: Query): Promise<TeamMember | null> => {
    const row: WorldMembership | undefined = scimWorld.memberships.find(
      (item: WorldMembership): boolean => {
        return matchesQuery(item, args.query);
      },
    );
    return row ? toMember(row) : null;
  },
  findBy: async (args: Query): Promise<Array<TeamMember>> => {
    return scimWorld.memberships
      .filter((item: WorldMembership): boolean => {
        return matchesQuery(item, args.query);
      })
      .map(toMember);
  },
  create: async (args: { data: TeamMember }): Promise<TeamMember> => {
    const row: WorldMembership = {
      id: idOf(ObjectID.generate()),
      projectId: idOf(args.data.projectId),
      userId: idOf(args.data.userId),
      teamId: idOf(args.data.teamId),
      hasAcceptedInvitation: Boolean(args.data.hasAcceptedInvitation),
      createdAt: scimWorld.tick(),
    };

    // TeamMemberService's duplicate guard.
    if (
      scimWorld.memberships.some((item: WorldMembership): boolean => {
        return item.userId === row.userId && item.teamId === row.teamId;
      })
    ) {
      throw new BadRequestException("Already a member of this team");
    }

    scimWorld.memberships.push(row);
    return toMember(row);
  },
  deleteBy: async (args: Query): Promise<number> => {
    const before: number = scimWorld.memberships.length;

    scimWorld.memberships = scimWorld.memberships.filter(
      (item: WorldMembership): boolean => {
        return !matchesQuery(item, args.query);
      },
    );

    return before - scimWorld.memberships.length;
  },
};

export const fakeTeamService: Record<string, unknown> = {
  findOneBy: async (args: Query): Promise<Team | null> => {
    const row: WorldTeam | undefined = scimWorld.teams.find(
      (item: WorldTeam): boolean => {
        return matchesQuery(item, args.query);
      },
    );
    return row ? toTeam(row) : null;
  },
  findOneById: async (args: { id: unknown }): Promise<Team | null> => {
    const row: WorldTeam | undefined = scimWorld.teams.find(
      (item: WorldTeam): boolean => {
        return item.id === idOf(args.id);
      },
    );
    return row ? toTeam(row) : null;
  },
  findBy: async (args: Query): Promise<Array<Team>> => {
    return scimWorld.teams
      .filter((item: WorldTeam): boolean => {
        return matchesQuery(item, args.query);
      })
      .map(toTeam);
  },
  create: async (args: { data: Team }): Promise<Team> => {
    const row: WorldTeam = {
      id: idOf(ObjectID.generate()),
      projectId: idOf(args.data.projectId),
      name: args.data.name!,
      isTeamDeleteable: Boolean(args.data.isTeamDeleteable),
      createdAt: scimWorld.tick(),
    };
    scimWorld.teams.push(row);
    return toTeam(row);
  },
  updateOneById: async (args: {
    id: unknown;
    data: { name?: string };
  }): Promise<void> => {
    const row: WorldTeam | undefined = scimWorld.teams.find(
      (item: WorldTeam): boolean => {
        return item.id === idOf(args.id);
      },
    );

    if (row && args.data.name) {
      row.name = args.data.name;
    }
  },
  deleteBy: async (args: Query): Promise<number> => {
    const before: number = scimWorld.teams.length;

    scimWorld.teams = scimWorld.teams.filter((item: WorldTeam): boolean => {
      return !matchesQuery(item, args.query);
    });

    return before - scimWorld.teams.length;
  },
};

export const fakeUserProjectSsoConsentService: Record<string, unknown> = {
  hasConsent: async (args: {
    userId: unknown;
    projectId: unknown;
  }): Promise<boolean> => {
    return scimWorld.consents.some(
      (item: { userId: string; projectId: string }): boolean => {
        return (
          item.userId === idOf(args.userId) &&
          item.projectId === idOf(args.projectId)
        );
      },
    );
  },
};
