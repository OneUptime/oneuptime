import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";

/*
 * ---------------------------------------------------------------------------
 * THE ACCOUNTS, INVITATIONS, LINKS AND CONSENTS AN INVITATION'S SSO SIGN-IN
 * READS AND WRITES (#9898), IN MEMORY.
 *
 * Stand-ins for the services the sign-up page's single sign-on and a
 * project's SSO callback share: UserService, TeamMemberService,
 * EmailVerificationTokenService (under the real UserRegistrationToken, so a
 * link is live, spent, expired or another address's exactly as the server
 * decides it) and UserProjectSsoConsentService, whose consent counts only
 * while its person is a member of the project, as the real one's does.
 * Each answers the calls those paths make, the way the real service does,
 * and every write is kept, in order, so a suite can see what a request
 * wrote - and that a refused one wrote nothing.
 * ---------------------------------------------------------------------------
 */

export interface WorldUser {
  id: string;
  email: string;
  // A password: the account has signed up, and no link can claim it.
  hasPassword: boolean;
  isBlocked: boolean;
  isMasterAdmin: boolean;
  isEmailVerified: boolean;
}

export interface WorldMembership {
  id: string;
  userId: string;
  projectId: string;
  hasAcceptedInvitation: boolean;
  invitationAcceptedAt: Date | null;
}

export interface WorldLink {
  rowId: string;
  userId: string;
  // The address the link was mailed to.
  email: string;
  token: string;
  expires: Date;
}

export interface WorldConsent {
  userId: string;
  projectId: string;
}

export interface WorldWrite {
  what:
    | "spent a link"
    | "minted a link"
    | "accepted invitations"
    | "updated an account"
    | "recorded a consent";
  detail: Record<string, unknown>;
}

const sameId: (a: unknown, b: unknown) => boolean = (
  a: unknown,
  b: unknown,
): boolean => {
  return String(a).toLowerCase() === String(b).toLowerCase();
};

// Lets the other side of a race run between any two reads, as a database does.
const aTurn: () => Promise<void> = (): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setImmediate(resolve);
  });
};

class InvitedSsoSignInWorld {
  public users: Array<WorldUser> = [];
  public memberships: Array<WorldMembership> = [];
  public links: Array<WorldLink> = [];
  public consents: Array<WorldConsent> = [];
  public writes: Array<WorldWrite> = [];

  // Set to have the next acceptance find nothing: an invitation removed meanwhile.
  public removeInvitationsBeforeTheNextAcceptance: boolean = false;

  public reset(): void {
    this.users = [];
    this.memberships = [];
    this.links = [];
    this.consents = [];
    this.writes = [];
    this.removeInvitationsBeforeTheNextAcceptance = false;
  }

  public seedUser(data: Partial<WorldUser> & { email: string }): WorldUser {
    const user: WorldUser = {
      id: data.id || ObjectID.generate().toString(),
      email: new Email(data.email).toString(),
      hasPassword: data.hasPassword ?? false,
      isBlocked: data.isBlocked ?? false,
      isMasterAdmin: data.isMasterAdmin ?? false,
      isEmailVerified: data.isEmailVerified ?? false,
    };

    this.users.push(user);

    return user;
  }

  public seedMembership(data: {
    userId: string;
    projectId: string;
    hasAcceptedInvitation?: boolean;
  }): WorldMembership {
    const membership: WorldMembership = {
      id: ObjectID.generate().toString(),
      userId: data.userId,
      projectId: data.projectId,
      hasAcceptedInvitation: data.hasAcceptedInvitation ?? false,
      invitationAcceptedAt: data.hasAcceptedInvitation
        ? OneUptimeDate.getCurrentDate()
        : null,
    };

    this.memberships.push(membership);

    return membership;
  }

  // A registration link, as an invitation email carries it.
  public seedLink(data: {
    userId: string;
    email: string;
    token?: string;
    expires?: Date;
  }): WorldLink {
    const link: WorldLink = {
      rowId: ObjectID.generate().toString(),
      userId: data.userId,
      email: new Email(data.email).toString(),
      token: data.token || ObjectID.generate().toString(),
      expires: data.expires || OneUptimeDate.getSomeDaysAfter(7),
    };

    this.links.push(link);

    return link;
  }

  public userByEmail(email: string): WorldUser | undefined {
    return this.users.find((user: WorldUser): boolean => {
      return user.email === new Email(email).toString();
    });
  }

  public userById(id: unknown): WorldUser | undefined {
    return this.users.find((user: WorldUser): boolean => {
      return sameId(user.id, id);
    });
  }

  public linkByToken(token: string): WorldLink | undefined {
    return this.links.find((link: WorldLink): boolean => {
      return sameId(link.token, token);
    });
  }

  public hasConsentRow(userId: string, projectId: string): boolean {
    return this.consents.some((consent: WorldConsent): boolean => {
      return (
        sameId(consent.userId, userId) && sameId(consent.projectId, projectId)
      );
    });
  }

  public isMemberOf(userId: unknown, projectId: unknown): boolean {
    return this.memberships.some((membership: WorldMembership): boolean => {
      return (
        sameId(membership.userId, userId) &&
        sameId(membership.projectId, projectId) &&
        membership.hasAcceptedInvitation
      );
    });
  }

  public toUser(row: WorldUser): User {
    const user: User = new User();
    user._id = row.id;
    user.email = new Email(row.email);
    user.isBlocked = row.isBlocked;
    user.isMasterAdmin = row.isMasterAdmin;
    user.isEmailVerified = row.isEmailVerified;

    if (row.hasPassword) {
      user.password = new HashedString("scrypt$set-by-its-person", true);
    }

    return user;
  }
}

export const invitedSsoWorld: InvitedSsoSignInWorld =
  new InvitedSsoSignInWorld();

const world: InvitedSsoSignInWorld = invitedSsoWorld;

export const fakeUserService: {
  findOneBy: (data: { query: { email?: Email } }) => Promise<User | null>;
  findOneById: (data: { id: ObjectID }) => Promise<User | null>;
  updateOneById: (data: {
    id: ObjectID;
    data: Record<string, unknown>;
  }) => Promise<number>;
} = {
  findOneBy: async (data: {
    query: { email?: Email };
  }): Promise<User | null> => {
    await aTurn();

    const row: WorldUser | undefined = data.query.email
      ? world.userByEmail(data.query.email.toString())
      : undefined;

    return row ? world.toUser(row) : null;
  },
  findOneById: async (data: { id: ObjectID }): Promise<User | null> => {
    await aTurn();

    const row: WorldUser | undefined = world.userById(data.id);

    return row ? world.toUser(row) : null;
  },
  updateOneById: async (data: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): Promise<number> => {
    await aTurn();

    const row: WorldUser | undefined = world.userById(data.id);

    if (!row) {
      return 0;
    }

    if (data.data["isEmailVerified"] !== undefined) {
      row.isEmailVerified = Boolean(data.data["isEmailVerified"]);
    }

    world.writes.push({
      what: "updated an account",
      detail: { userId: row.id, data: { ...data.data } },
    });

    return 1;
  },
};

interface MembershipQuery {
  userId?: ObjectID;
  projectId?: ObjectID;
  hasAcceptedInvitation?: boolean;
}

const matchesMembership: (
  membership: WorldMembership,
  query: MembershipQuery,
) => boolean = (
  membership: WorldMembership,
  query: MembershipQuery,
): boolean => {
  return (
    (query.userId === undefined || sameId(membership.userId, query.userId)) &&
    (query.projectId === undefined ||
      sameId(membership.projectId, query.projectId)) &&
    (query.hasAcceptedInvitation === undefined ||
      membership.hasAcceptedInvitation === query.hasAcceptedInvitation)
  );
};

export const fakeTeamMemberService: {
  countBy: (data: { query: MembershipQuery }) => Promise<PositiveNumber>;
  updateBy: (data: {
    query: MembershipQuery;
    data: { hasAcceptedInvitation?: boolean; invitationAcceptedAt?: Date };
  }) => Promise<number>;
  findBy: () => Promise<Array<unknown>>;
} = {
  countBy: async (data: {
    query: MembershipQuery;
  }): Promise<PositiveNumber> => {
    await aTurn();

    return new PositiveNumber(
      world.memberships.filter((membership: WorldMembership): boolean => {
        return matchesMembership(membership, data.query);
      }).length,
    );
  },
  updateBy: async (data: {
    query: MembershipQuery;
    data: { hasAcceptedInvitation?: boolean; invitationAcceptedAt?: Date };
  }): Promise<number> => {
    await aTurn();

    if (world.removeInvitationsBeforeTheNextAcceptance) {
      world.removeInvitationsBeforeTheNextAcceptance = false;
      world.memberships = world.memberships.filter(
        (membership: WorldMembership): boolean => {
          return membership.hasAcceptedInvitation;
        },
      );
    }

    const rows: Array<WorldMembership> = world.memberships.filter(
      (membership: WorldMembership): boolean => {
        return matchesMembership(membership, data.query);
      },
    );

    for (const row of rows) {
      if (data.data.hasAcceptedInvitation !== undefined) {
        row.hasAcceptedInvitation = data.data.hasAcceptedInvitation;
      }

      if (data.data.invitationAcceptedAt !== undefined) {
        row.invitationAcceptedAt = data.data.invitationAcceptedAt;
      }
    }

    if (rows.length > 0) {
      world.writes.push({
        what: "accepted invitations",
        detail: {
          userId: String(data.query.userId),
          projectId: String(data.query.projectId),
          count: rows.length,
        },
      });
    }

    return rows.length;
  },
  findBy: async (): Promise<Array<unknown>> => {
    await aTurn();
    return [];
  },
};

export const fakeEmailVerificationTokenService: {
  findOneBy: (data: {
    query: { token?: ObjectID };
  }) => Promise<EmailVerificationToken | null>;
  deleteOneBy: (data: { query: { _id?: string } }) => Promise<number>;
  create: (data: { data: EmailVerificationToken }) => Promise<void>;
} = {
  findOneBy: async (data: {
    query: { token?: ObjectID };
  }): Promise<EmailVerificationToken | null> => {
    await aTurn();

    const link: WorldLink | undefined = data.query.token
      ? world.linkByToken(data.query.token.toString())
      : undefined;

    if (!link) {
      return null;
    }

    const row: EmailVerificationToken = new EmailVerificationToken();
    row._id = link.rowId;
    row.userId = new ObjectID(link.userId);
    row.email = new Email(link.email);
    row.token = new ObjectID(link.token);
    row.expires = link.expires;

    return row;
  },
  deleteOneBy: async (data: { query: { _id?: string } }): Promise<number> => {
    await aTurn();

    const before: number = world.links.length;

    world.links = world.links.filter((link: WorldLink): boolean => {
      return !sameId(link.rowId, data.query._id);
    });

    const deleted: number = before - world.links.length;

    if (deleted > 0) {
      world.writes.push({
        what: "spent a link",
        detail: { rowId: String(data.query._id) },
      });
    }

    return deleted;
  },
  // A confirmation email's link, as a stopped sign-in mails one.
  create: async (data: { data: EmailVerificationToken }): Promise<void> => {
    await aTurn();

    world.writes.push({
      what: "minted a link",
      detail: { userId: String(data.data.userId) },
    });
  },
};

export const fakeUserProjectSsoConsentService: {
  hasConsent: (data: {
    userId: ObjectID;
    projectId: ObjectID;
  }) => Promise<boolean>;
  recordConsent: (data: {
    userId: ObjectID;
    projectId: ObjectID;
  }) => Promise<void>;
} = {
  // Only while its person is in the project (ProjectMembership.userIdWhileMember).
  hasConsent: async (data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> => {
    await aTurn();

    return (
      world.hasConsentRow(data.userId.toString(), data.projectId.toString()) &&
      world.isMemberOf(data.userId, data.projectId)
    );
  },
  recordConsent: async (data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> => {
    await aTurn();

    if (
      world.hasConsentRow(data.userId.toString(), data.projectId.toString())
    ) {
      return;
    }

    world.consents.push({
      userId: data.userId.toString(),
      projectId: data.projectId.toString(),
    });
    world.writes.push({
      what: "recorded a consent",
      detail: {
        userId: data.userId.toString(),
        projectId: data.projectId.toString(),
      },
    });
  },
};
