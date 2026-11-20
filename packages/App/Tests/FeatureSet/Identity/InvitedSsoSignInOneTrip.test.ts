import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import {
  fakeTeamMemberService,
  fakeUserService,
  invitedSsoWorld,
  WorldLink,
  WorldUser,
  WorldWrite,
} from "./InvitedSsoSignInWorld";
import SignUpInvitationUtil, {
  SignUpInvitationSsoOutcome,
} from "../../../FeatureSet/Identity/Utils/SignUpInvitation";
import ProjectSsoSignInConfirmation, {
  ProjectSsoKind,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation";
import ProjectSsoSignInGate, {
  ProjectSsoGateDecision,
  ProjectSsoGateOutcome,
  ProjectSsoGateReason,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInGate";
import UserRegistrationToken from "Common/Server/Utils/UserRegistrationToken";
import logger from "Common/Server/Utils/Logger";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import {
  SIGN_UP_INVITATION_ROUTE,
  SIGN_UP_INVITATION_SSO_ROUTE,
} from "Common/Types/Accounts/SignUpInvitation";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { SsoSignInProvider } from "Common/Types/SSO/SignInMethods";
import { SsoManagedBy } from "Common/Types/SSO/SsoManagedSignIn";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * AN INVITATION'S LINK CONFIRMS ITS PROJECT'S SINGLE SIGN-ON: ONE TRIP ON
 * ONEUPTIME CLOUD (#9898).
 *
 * On OneUptime Cloud a project's SAML or OIDC provider signs someone in only
 * once they have confirmed it from their mailbox: the project's admins
 * configure it, and could assert any address. Someone invited into a project
 * whose people sign in with SSO opened their invitation's sign-up page,
 * picked the provider, went through it, was told to check their email,
 * confirmed, and went through the provider again.
 *
 * The invitation's link carries a registration token that went only to the
 * invited mailbox, so it proves the mailbox exactly as the confirmation
 * email's link does. The page now sends it as the person picks a provider
 * (POST /identity/sign-up-invitation/sso), and on OneUptime Cloud the server
 * takes it as that confirmation: the token spent, the invitation accepted,
 * the address verified and the consent recorded. The provider's answer then
 * signs them in the first time.
 *
 * Driven here: the real route, behind the real limiter on a counter store
 * that counts as Redis does; the real SignUpInvitationUtil, the real
 * UserRegistrationToken and the real gate both callbacks ask
 * (ProjectSsoSignInGate.decide); over accounts, invitations, links and
 * consents held in memory (InvitedSsoSignInWorld) that answer as the
 * services do. Held:
 *
 *   - with the address's live link, each write happens once, in order, and
 *     the provider's answer is a sign-in, with no confirmation email;
 *   - without it, the provider's answer is "Check your email" and the
 *     confirmation email goes out, as it always did;
 *   - every refusal - a wrong, spent or expired link, another address's, an
 *     account that has signed up, is blocked or is an administrator's, a
 *     project with no invitation waiting, one that does not manage sign-in
 *     with SSO or has no provider of its own, a self-hosted server - writes
 *     nothing and leaves a live link live;
 *   - two asks racing on one link write once;
 *   - every ask is answered alike, status, body and headers, and one
 *     without the live link reads no account;
 *   - it counts on the invitation answer's limiter bucket.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

const redisClient: FakeCounterRedis = new FakeCounterRedis();

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return redisClient;
      },
      isConnected: (): boolean => {
        return true;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
    getClientIp: (): string => {
      return "127.0.0.1";
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  const world: typeof import("./InvitedSsoSignInWorld") = jest.requireActual(
    "./InvitedSsoSignInWorld",
  ) as typeof import("./InvitedSsoSignInWorld");

  return { __esModule: true, default: world.fakeUserService };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  const world: typeof import("./InvitedSsoSignInWorld") = jest.requireActual(
    "./InvitedSsoSignInWorld",
  ) as typeof import("./InvitedSsoSignInWorld");

  return { __esModule: true, default: world.fakeTeamMemberService };
});

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  const world: typeof import("./InvitedSsoSignInWorld") = jest.requireActual(
    "./InvitedSsoSignInWorld",
  ) as typeof import("./InvitedSsoSignInWorld");

  return { __esModule: true, default: world.fakeEmailVerificationTokenService };
});

jest.mock("Common/Server/Services/UserProjectSsoConsentService", () => {
  const world: typeof import("./InvitedSsoSignInWorld") = jest.requireActual(
    "./InvitedSsoSignInWorld",
  ) as typeof import("./InvitedSsoSignInWorld");

  return { __esModule: true, default: world.fakeUserProjectSsoConsentService };
});

const refreshUserAllPermissions: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshUserAllPermissions: (...args: Array<unknown>): unknown => {
        return refreshUserAllPermissions(...args);
      },
    },
  };
});

// Why SSO would manage the person's sign-in once they join (SsoManagedSignIn).
let managedBy: SsoManagedBy | null = SsoManagedBy.Projects;
const getManagedByOnceIn: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/SsoManagedSignIn", () => {
  return {
    __esModule: true,
    default: {
      getManagedByOnceIn: (...args: Array<unknown>): unknown => {
        return getManagedByOnceIn(...args);
      },
    },
  };
});

// The providers that sign people in to the project (SsoSignInMethods).
let projectProviders: Array<SsoSignInProvider> = [];

jest.mock("Common/Server/Utils/SsoSignInMethods", () => {
  return {
    __esModule: true,
    default: {
      getProjectSignInMethods: (): Promise<unknown> => {
        return Promise.resolve({ ssoProviders: projectProviders });
      },
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const ADDRESS: string = "grace@walk.example";
const WALK_CO: string = "75100000-0000-4000-8000-000000000001";
const GLOBEX: string = "75100000-0000-4000-8000-000000000002";
const OKTA: SsoSignInProvider = {
  type: SsoProviderType.ProjectSSO,
  id: "75200000-0000-4000-8000-000000000001",
  name: "Okta",
  description: "",
};
const ENTRA: SsoSignInProvider = {
  type: SsoProviderType.ProjectOIDC,
  id: "75200000-0000-4000-8000-000000000002",
  name: "Entra ID",
  description: "",
};
const INSTANCE_WIDE: SsoSignInProvider = {
  type: SsoProviderType.GlobalSSO,
  id: "75200000-0000-4000-8000-000000000003",
  name: "Company SSO",
  description: "",
};

// The confirmation emails a stopped sign-in sends: counted, never sent.
let requestConfirmation: jest.SpiedFunction<
  typeof ProjectSsoSignInConfirmation.requestConfirmation
>;
let requestConfirmationForNewAccount: jest.SpiedFunction<
  typeof ProjectSsoSignInConfirmation.requestConfirmationForNewAccount
>;

// Grace, invited to Walk Co twice over (two of its teams), never signed up.
let grace: WorldUser;
let link: WorldLink;

beforeEach(() => {
  invitedSsoWorld.reset();
  redisClient.reset();
  setTestBillingEnabled(true);
  managedBy = SsoManagedBy.Projects;
  projectProviders = [OKTA];
  refreshUserAllPermissions.mockReset();
  refreshUserAllPermissions.mockResolvedValue(undefined);
  getManagedByOnceIn.mockReset();
  getManagedByOnceIn.mockImplementation((): Promise<SsoManagedBy | null> => {
    return Promise.resolve(managedBy);
  });
  (logger.info as jest.Mock).mockClear();
  (logger.error as jest.Mock).mockClear();

  requestConfirmation = jest
    .spyOn(ProjectSsoSignInConfirmation, "requestConfirmation")
    .mockResolvedValue(undefined);
  requestConfirmationForNewAccount = jest
    .spyOn(ProjectSsoSignInConfirmation, "requestConfirmationForNewAccount")
    .mockResolvedValue(undefined);

  grace = invitedSsoWorld.seedUser({ email: ADDRESS });
  invitedSsoWorld.seedMembership({ userId: grace.id, projectId: WALK_CO });
  invitedSsoWorld.seedMembership({ userId: grace.id, projectId: WALK_CO });
  link = invitedSsoWorld.seedLink({ userId: grace.id, email: ADDRESS });
});

afterEach(async () => {
  await ProjectSsoSignInGate.waitForBackgroundWork();
  jest.restoreAllMocks();
});

// The page's ask, as it sends it.
const ask: (overrides?: {
  email?: unknown;
  token?: unknown;
  projectId?: unknown;
}) => Promise<SignUpInvitationSsoOutcome> = (overrides?: {
  email?: unknown;
  token?: unknown;
  projectId?: unknown;
}): Promise<SignUpInvitationSsoOutcome> => {
  return SignUpInvitationUtil.confirmSsoSignIn({
    email: overrides && "email" in overrides ? overrides.email : ADDRESS,
    token: overrides && "token" in overrides ? overrides.token : link.token,
    projectId:
      overrides && "projectId" in overrides ? overrides.projectId : WALK_CO,
  });
};

// What the project's provider's answer does next, on either callback.
const providerAnswers: (
  kind?: ProjectSsoKind,
) => Promise<ProjectSsoGateDecision> = async (
  kind: ProjectSsoKind = ProjectSsoKind.SAML,
): Promise<ProjectSsoGateDecision> => {
  const decision: ProjectSsoGateDecision = await ProjectSsoSignInGate.decide({
    email: new Email(ADDRESS),
    name: new Name("Grace Member"),
    projectId: new ObjectID(WALK_CO),
    kind: kind,
    providerId: new ObjectID(kind === ProjectSsoKind.SAML ? OKTA.id : ENTRA.id),
  });

  await ProjectSsoSignInGate.waitForBackgroundWork();

  return decision;
};

const isLinkLive: (data?: {
  token?: string;
  email?: string;
}) => Promise<boolean> = (data?: {
  token?: string;
  email?: string;
}): Promise<boolean> => {
  return UserRegistrationToken.isRegistrationTokenLive({
    token: new ObjectID(data?.token || link.token),
    email: new Email(data?.email || ADDRESS),
  });
};

const whatWasWritten: () => Array<string> = (): Array<string> => {
  return invitedSsoWorld.writes.map((write: WorldWrite): string => {
    return write.what;
  });
};

describe("on OneUptime Cloud, with the address's live link", () => {
  test("the link confirms the project's single sign-on: each write once, in order", async () => {
    await expect(ask()).resolves.toBe(SignUpInvitationSsoOutcome.Confirmed);

    expect(whatWasWritten()).toEqual([
      "spent a link",
      "accepted invitations",
      "updated an account",
      "recorded a consent",
    ]);

    // Both of Walk Co's invitations accepted, as joining the project accepts them.
    expect(invitedSsoWorld.writes[1]!.detail).toEqual({
      userId: grace.id,
      projectId: WALK_CO,
      count: 2,
    });
    // The address verified: the spent link proved the mailbox.
    expect(invitedSsoWorld.writes[2]!.detail).toEqual({
      userId: grace.id,
      data: { isEmailVerified: true },
    });
    expect(invitedSsoWorld.consents).toEqual([
      { userId: grace.id, projectId: WALK_CO },
    ]);
    expect(refreshUserAllPermissions).toHaveBeenCalledTimes(1);
    expect(String(refreshUserAllPermissions.mock.calls[0]![0])).toBe(grace.id);

    // The link is spent: it confirms nothing again.
    await expect(isLinkLive()).resolves.toBe(false);
  });

  test("the provider's answer then signs them in, the first time, with no email", async () => {
    await ask();

    const decision: ProjectSsoGateDecision = await providerAnswers();

    expect(decision.outcome).toBe(ProjectSsoGateOutcome.SignIn);
    expect(decision.reason).toBeNull();
    expect(decision.user?.id?.toString()).toBe(grace.id);
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(requestConfirmationForNewAccount).not.toHaveBeenCalled();
  });

  test.each([
    ["SAML", ProjectSsoKind.SAML],
    ["OpenID Connect", ProjectSsoKind.OIDC],
  ])(
    "through the project's %s provider alike",
    async (_kind: string, kind: ProjectSsoKind) => {
      projectProviders = [OKTA, ENTRA];

      await ask();

      expect((await providerAnswers(kind)).outcome).toBe(
        ProjectSsoGateOutcome.SignIn,
      );
    },
  );

  test("without the link, the provider's answer asks the mailbox, as it always did", async () => {
    const decision: ProjectSsoGateDecision = await providerAnswers();

    expect(decision.outcome).toBe(ProjectSsoGateOutcome.CheckEmail);
    expect(decision.reason).toBe(ProjectSsoGateReason.NotConfirmed);
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(
      String(
        (requestConfirmation.mock.calls[0]![0] as { user: { id: ObjectID } })
          .user.id,
      ),
    ).toBe(grace.id);
    // And the link is still the person's, to sign up with.
    await expect(isLinkLive()).resolves.toBe(true);
  });

  test("an address verified already is not written again", async () => {
    grace.isEmailVerified = true;

    await expect(ask()).resolves.toBe(SignUpInvitationSsoOutcome.Confirmed);

    expect(whatWasWritten()).toEqual([
      "spent a link",
      "accepted invitations",
      "recorded a consent",
    ]);
  });

  test("a second ask with the same link writes nothing more", async () => {
    await ask();
    const written: Array<string> = whatWasWritten();

    await expect(ask()).resolves.toBe(SignUpInvitationSsoOutcome.LinkNotLive);

    expect(whatWasWritten()).toEqual(written);
  });

  test("two asks racing on one link: one confirms, the other writes nothing", async () => {
    const outcomes: Array<SignUpInvitationSsoOutcome> = await Promise.all([
      ask(),
      ask(),
    ]);

    const confirmed: Array<SignUpInvitationSsoOutcome> = outcomes.filter(
      (outcome: SignUpInvitationSsoOutcome): boolean => {
        return outcome === SignUpInvitationSsoOutcome.Confirmed;
      },
    );
    const lost: Array<SignUpInvitationSsoOutcome> = outcomes.filter(
      (outcome: SignUpInvitationSsoOutcome): boolean => {
        return outcome !== SignUpInvitationSsoOutcome.Confirmed;
      },
    );

    expect(confirmed).toHaveLength(1);
    // Spent by the other first: found spent already, or spent between its reads and its spend.
    expect([
      SignUpInvitationSsoOutcome.LinkSpentMeanwhile,
      SignUpInvitationSsoOutcome.LinkNotLive,
    ]).toContain(lost[0]);
    expect(whatWasWritten()).toEqual([
      "spent a link",
      "accepted invitations",
      "updated an account",
      "recorded a consent",
    ]);
    expect(refreshUserAllPermissions).toHaveBeenCalledTimes(1);
  });

  test("an invitation removed between the reads and the writes: no consent, and the mailbox is asked", async () => {
    invitedSsoWorld.removeInvitationsBeforeTheNextAcceptance = true;

    await expect(ask()).resolves.toBe(SignUpInvitationSsoOutcome.NotJoined);

    // The link was spent and proved the mailbox; nobody joined, so nothing was consented to.
    expect(whatWasWritten()).toEqual(["spent a link", "updated an account"]);
    expect(invitedSsoWorld.consents).toEqual([]);
    expect(refreshUserAllPermissions).not.toHaveBeenCalled();
  });

  test("a write that fails is no error to the page: what it got to stays, and the mailbox is asked", async () => {
    refreshUserAllPermissions.mockRejectedValue(new Error("Redis went away."));

    await expect(ask()).resolves.toBe(SignUpInvitationSsoOutcome.Failed);
    expect(logger.error).toHaveBeenCalled();
  });

  test("the reads it asks the rule and the providers with", async () => {
    await ask();

    expect(getManagedByOnceIn).toHaveBeenCalledTimes(1);

    const asked: {
      userId: ObjectID;
      isMasterAdmin: boolean;
      joiningProjectId: ObjectID;
    } = getManagedByOnceIn.mock.calls[0]![0] as {
      userId: ObjectID;
      isMasterAdmin: boolean;
      joiningProjectId: ObjectID;
    };

    expect(asked.userId.toString()).toBe(grace.id);
    expect(asked.isMasterAdmin).toBe(false);
    expect(asked.joiningProjectId.toString()).toBe(WALK_CO);
  });

  test("logs what came of it by project and account, never by address", async () => {
    await ask();
    await ask({ token: ObjectID.generate().toString() });

    const logged: string = JSON.stringify(
      (logger.info as jest.Mock).mock.calls,
    );

    expect(logged).toContain(WALK_CO);
    expect(logged).toContain(SignUpInvitationSsoOutcome.LinkNotLive);
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain(link.token);
  });
});

describe("every other ask writes nothing, and a live link stays live", () => {
  interface Refusal {
    label: string;
    arrange: () => void | Promise<void>;
    ask: () => Promise<SignUpInvitationSsoOutcome>;
    outcome: SignUpInvitationSsoOutcome;
    // Whether the address's own link is still live afterwards (it was live before).
    linkStaysLive: boolean;
  }

  const refusals: Array<Refusal> = [
    {
      label: "a link that is no link of this server's",
      arrange: (): void => {},
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({ token: ObjectID.generate().toString() });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotLive,
      linkStaysLive: true,
    },
    {
      label: "a link spent already, by a sign-up",
      arrange: async (): Promise<void> => {
        await UserRegistrationToken.consumeRegistrationToken({
          token: new ObjectID(link.token),
          email: new Email(ADDRESS),
        });
        invitedSsoWorld.writes = [];
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotLive,
      linkStaysLive: false,
    },
    {
      label: "a link that has expired",
      arrange: (): void => {
        link.expires = OneUptimeDate.getSomeHoursAgo(1);
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotLive,
      linkStaysLive: false,
    },
    {
      label: "another address's link",
      arrange: (): void => {
        const ada: WorldUser = invitedSsoWorld.seedUser({
          email: "ada@walk.example",
        });
        invitedSsoWorld.seedLink({
          userId: ada.id,
          email: "ada@walk.example",
          token: "75300000-0000-4000-8000-000000000001",
        });
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({ token: "75300000-0000-4000-8000-000000000001" });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotLive,
      linkStaysLive: true,
    },
    {
      label: "an account that has signed up already",
      arrange: (): void => {
        grace.hasPassword = true;
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NoAccountToClaim,
      linkStaysLive: true,
    },
    {
      label: "an account the address no longer belongs to",
      arrange: (): void => {
        invitedSsoWorld.users = [];
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NoAccountToClaim,
      linkStaysLive: true,
    },
    {
      label: "a blocked account",
      arrange: (): void => {
        grace.isBlocked = true;
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.Blocked,
      linkStaysLive: true,
    },
    {
      label: "a OneUptime administrator's account",
      arrange: (): void => {
        grace.isMasterAdmin = true;
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.Administrator,
      linkStaysLive: true,
    },
    {
      label: "a project with no invitation waiting for the account",
      arrange: (): void => {
        invitedSsoWorld.seedMembership({ userId: grace.id, projectId: GLOBEX });
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({ projectId: "75100000-0000-4000-8000-000000000009" });
      },
      outcome: SignUpInvitationSsoOutcome.NoInvitationWaiting,
      linkStaysLive: true,
    },
    {
      label: "a project whose invitation was accepted for them already",
      arrange: (): void => {
        for (const membership of invitedSsoWorld.memberships) {
          membership.hasAcceptedInvitation = true;
        }
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NoInvitationWaiting,
      linkStaysLive: true,
    },
    {
      label:
        "a project that does not manage sign-in with SSO, or someone also in one that does not",
      arrange: (): void => {
        managedBy = null;
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NotManagedBySso,
      linkStaysLive: true,
    },
    {
      label:
        "a server that requires SSO for everyone: its own providers, which ask no mailbox",
      arrange: (): void => {
        managedBy = SsoManagedBy.Server;
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NotManagedBySso,
      linkStaysLive: true,
    },
    {
      label: "a project with no provider of its own turned on",
      arrange: (): void => {
        projectProviders = [];
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NoProjectProvider,
      linkStaysLive: true,
    },
    {
      label:
        "a project signed in to only by an instance-wide provider, which asks no mailbox",
      arrange: (): void => {
        projectProviders = [INSTANCE_WIDE];
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NoProjectProvider,
      linkStaysLive: true,
    },
    {
      label:
        "a self-hosted server, which signs people in without asking the mailbox",
      arrange: (): void => {
        setTestBillingEnabled(false);
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NotNeeded,
      linkStaysLive: true,
    },
  ];

  test.each(refusals)(
    "$label: nothing is written",
    async ({ arrange, ask: refusedAsk, outcome, linkStaysLive }: Refusal) => {
      await arrange();

      await expect(refusedAsk()).resolves.toBe(outcome);

      expect(whatWasWritten()).toEqual([]);
      expect(invitedSsoWorld.consents).toEqual([]);
      expect(refreshUserAllPermissions).not.toHaveBeenCalled();
      await expect(isLinkLive()).resolves.toBe(linkStaysLive);
    },
  );

  test.each(
    refusals.filter((refusal: Refusal): boolean => {
      return refusal.outcome !== SignUpInvitationSsoOutcome.NotNeeded;
    }),
  )(
    "$label: the provider's answer still asks the mailbox",
    async ({ arrange, ask: refusedAsk }: Refusal) => {
      await arrange();
      await refusedAsk();

      expect((await providerAnswers()).outcome).toBe(
        ProjectSsoGateOutcome.CheckEmail,
      );
    },
  );

  test.each([
    ["no address", { email: undefined }],
    ["an address that is not one", { email: "grace" }],
    ["an address that is not text", { email: 42 }],
    ["no token", { token: undefined }],
    ["a token that is not one", { token: "not-a-token" }],
    ["a token that is not text", { token: { $ne: null } }],
    ["no project", { projectId: undefined }],
    ["a project that is not one", { projectId: "walk-co" }],
    ["a project that is not text", { projectId: { $ne: null } }],
  ])(
    "%s: nothing is read, nothing is written",
    async (_case: string, overrides: Record<string, unknown>) => {
      const findUser: jest.SpiedFunction<typeof fakeUserService.findOneBy> =
        jest.spyOn(fakeUserService, "findOneBy");

      await expect(ask(overrides)).resolves.toBe(
        SignUpInvitationSsoOutcome.NotAsked,
      );

      expect(findUser).not.toHaveBeenCalled();
      expect(whatWasWritten()).toEqual([]);
      await expect(isLinkLive()).resolves.toBe(true);
    },
  );

  test("an ask without the address's live link reads no account, so its time says nothing of one", async () => {
    const findUser: jest.SpiedFunction<typeof fakeUserService.findOneBy> =
      jest.spyOn(fakeUserService, "findOneBy");
    const countMemberships: jest.SpiedFunction<
      typeof fakeTeamMemberService.countBy
    > = jest.spyOn(fakeTeamMemberService, "countBy");

    for (const token of [
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
    ]) {
      await ask({ token: token });
      await ask({ email: "nobody@walk.example", token: token });
    }

    await ask({ email: "nobody@walk.example", token: link.token });

    expect(findUser).not.toHaveBeenCalled();
    expect(countMemberships).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The route: behind the invitation answer's limiter, and one answer for all.
 * ---------------------------------------------------------------------------
 */

const REAL_CLIENT_IP: string = "203.0.113.9";

interface RouteResult {
  reachedHandler: boolean;
  error: Exception | null;
  // Every call the response was answered with, in order.
  answer: JSONObject;
}

const callRoute: (
  route: string,
  body: unknown,
  from?: string,
) => Promise<RouteResult> = async (
  route: string,
  body: unknown,
  from: string = REAL_CLIENT_IP,
): Promise<RouteResult> => {
  const handlers: Array<RouteHandler> = mockRouter.matchAll("post", route);
  const req: ExpressRequest = buildRequest(body, {
    headers: { "x-forwarded-for": from },
    socketAddress: from,
  });
  const res: ExpressResponse = buildResponse();

  // Whether the step just run went on to the next one, and what it failed with.
  const state: { error: Exception | null; wentOn: boolean } = {
    error: null,
    wentOn: false,
  };

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      state.error = err;
      return;
    }

    state.wentOn = true;
  }) as unknown as NextFunction;

  let reachedHandler: boolean = false;

  for (let index: number = 0; index < handlers.length; index++) {
    state.wentOn = false;

    if (index === handlers.length - 1) {
      reachedHandler = true;
    }

    await handlers[index]!(req, res, next);

    if (!state.wentOn) {
      break;
    }
  }

  const error: Exception | null = state.error;

  const calls: (name: string) => Array<unknown> = (
    name: string,
  ): Array<unknown> => {
    return (
      (res as unknown as Record<string, jest.Mock>)[name]?.mock.calls || []
    );
  };

  return {
    reachedHandler: reachedHandler,
    error: error,
    answer: JSON.parse(
      JSON.stringify({
        status: calls("status"),
        headers: calls("setHeader"),
        send: calls("send"),
        json: calls("json"),
      }),
    ) as JSONObject,
  };
};

describe(`POST ${SIGN_UP_INVITATION_SSO_ROUTE}`, () => {
  test("sits behind a limiter, in front of its handler", () => {
    expect(
      mockRouter.matchAll("post", SIGN_UP_INVITATION_SSO_ROUTE).length,
    ).toBe(2);
  });

  test("hands the page's address, token and project to the confirmation", async () => {
    const result: RouteResult = await callRoute(SIGN_UP_INVITATION_SSO_ROUTE, {
      email: ADDRESS,
      token: link.token,
      projectId: WALK_CO,
    });

    expect(result.reachedHandler).toBe(true);
    expect(result.error).toBeNull();
    expect(invitedSsoWorld.consents).toEqual([
      { userId: grace.id, projectId: WALK_CO },
    ]);
    expect((await providerAnswers()).outcome).toBe(
      ProjectSsoGateOutcome.SignIn,
    );
  });

  test("answers every ask alike - status, body and headers - and never caches", async () => {
    const answers: Array<{ label: string; answer: JSONObject }> = [];

    const record: (
      label: string,
      body: unknown,
      arrange?: () => void,
    ) => Promise<void> = async (
      label: string,
      body: unknown,
      arrange?: () => void,
    ): Promise<void> => {
      invitedSsoWorld.reset();
      grace = invitedSsoWorld.seedUser({ email: ADDRESS });
      invitedSsoWorld.seedMembership({ userId: grace.id, projectId: WALK_CO });
      link = invitedSsoWorld.seedLink({ userId: grace.id, email: ADDRESS });
      setTestBillingEnabled(true);
      managedBy = SsoManagedBy.Projects;
      projectProviders = [OKTA];
      arrange?.();

      const result: RouteResult = await callRoute(
        SIGN_UP_INVITATION_SSO_ROUTE,
        typeof body === "function" ? (body as () => unknown)() : body,
      );

      expect({ label, error: result.error }).toEqual({ label, error: null });
      answers.push({ label: label, answer: result.answer });
    };

    const good: () => JSONObject = (): JSONObject => {
      return { email: ADDRESS, token: link.token, projectId: WALK_CO };
    };

    await record("a confirmation", good);
    await record("a link that is no link of this server's", {
      email: ADDRESS,
      token: ObjectID.generate().toString(),
      projectId: WALK_CO,
    });
    await record("an address with no account", {
      email: "nobody@walk.example",
      token: ObjectID.generate().toString(),
      projectId: WALK_CO,
    });
    await record("an account that has signed up", good, (): void => {
      grace.hasPassword = true;
    });
    await record("a blocked account", good, (): void => {
      grace.isBlocked = true;
    });
    await record("an administrator's account", good, (): void => {
      grace.isMasterAdmin = true;
    });
    await record("a project with nothing waiting", (): JSONObject => {
      return { ...good(), projectId: GLOBEX };
    });
    await record(
      "a project SSO does not manage sign-in for",
      good,
      (): void => {
        managedBy = null;
      },
    );
    await record("a self-hosted server", good, (): void => {
      setTestBillingEnabled(false);
    });
    await record("a body of another shape", { email: ["x"], token: 7 });
    await record("no body at all", undefined);
    await record("a failure", good, (): void => {
      refreshUserAllPermissions.mockRejectedValueOnce(new Error("Redis down"));
    });

    const first: JSONObject = answers[0]!.answer;

    expect(first).toEqual({
      status: [[200]],
      headers: [
        ["Cache-Control", "no-store, no-cache, must-revalidate"],
        ["Pragma", "no-cache"],
        ["Expires", "0"],
      ],
      send: [[{}]],
      json: [],
    });

    for (const { label, answer } of answers) {
      expect({ label, answer }).toEqual({ label, answer: first });
    }
  });

  /*
   * The same page asks both routes, with the same token, so they count
   * together: a hundred and fifty a quarter hour from one address, as the
   * invitation answer's bucket (SIGN_UP_INVITATION_BUCKET) allows.
   */
  test("counts on the invitation answer's bucket, with the invitation answer", async () => {
    const LIMIT: number = 150;
    const body: JSONObject = {
      email: "someone@walk.example",
      token: "not-a-token",
      projectId: WALK_CO,
    };

    for (let index: number = 0; index < LIMIT; index++) {
      const route: string =
        index % 2 === 0
          ? SIGN_UP_INVITATION_SSO_ROUTE
          : SIGN_UP_INVITATION_ROUTE;

      expect((await callRoute(route, body)).reachedHandler).toBe(true);
    }

    for (const key of Array.from(redisClient.counters.keys())) {
      expect(key.startsWith("identity:rl:sign-up-invitation:")).toBe(true);
    }

    const refused: RouteResult = await callRoute(
      SIGN_UP_INVITATION_SSO_ROUTE,
      body,
    );

    expect(refused.reachedHandler).toBe(false);
    expect(refused.answer["status"]).toEqual([
      [ExceptionCode.TooManyRequestsException],
    ]);

    // Another address has an allowance of its own.
    expect(
      (await callRoute(SIGN_UP_INVITATION_SSO_ROUTE, body, "198.51.100.77"))
        .reachedHandler,
    ).toBe(true);
  });
});
