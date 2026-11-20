import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import {
  fakeEmailVerificationTokenService,
  fakeUserService,
  invitedSsoWorld,
  WorldLink,
  WorldUser,
  WorldWrite,
} from "./InvitedSsoSignInWorld";
import InvitationSsoSignIn from "../../../FeatureSet/Identity/Utils/InvitationSsoSignIn";
import { SignUpInvitationSsoOutcome } from "../../../FeatureSet/Identity/Utils/SignUpInvitation";
import ProjectSsoSignInConfirmation, {
  ProjectSsoKind,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation";
import ProjectSsoSignInGate, {
  ProjectSsoGateDecision,
  ProjectSsoGateOutcome,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInGate";
import InvitationSsoSignInLink from "Common/Server/Utils/TeamMember/InvitationSsoSignInLink";
import TokenSigningKey from "Common/Server/Utils/TokenSigningKey";
import logger from "Common/Server/Utils/Logger";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { INVITATION_SSO_SIGN_IN_ROUTE } from "Common/Types/Accounts/InvitationSsoSignIn";
import { SIGN_UP_INVITATION_ROUTE } from "Common/Types/Accounts/SignUpInvitation";
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
import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * AN INVITATION'S SINGLE-USE LINK CONFIRMS ITS PROJECT'S SINGLE SIGN-ON FOR
 * SOMEONE WHO HAS SIGNED UP: ONE TRIP ON ONEUPTIME CLOUD (#10178).
 *
 * #9898 gave someone invited with no account yet one trip through their
 * project's provider: their invitation's sign-up link proves the mailbox.
 * Someone who had signed up already was sent to sign in with SSO, and their
 * first trip stopped at "Check your email": a second email, Confirm Sign-In,
 * and a second trip. Their invitation now carries a single-use link of
 * their own (InvitationSsoSignInLink), which the project's SSO page sends
 * here as they pick a provider (POST /identity/invitation-sso-sign-in), and
 * the server takes it as that confirmation, with #9898's checks.
 *
 * Driven here: the real route, behind the real limiter on a counter store
 * that counts as Redis does; the real InvitationSsoSignIn, the real shared
 * checks and writes (SignUpInvitationUtil.confirmProjectSsoForAccount), the
 * real link signature (InvitationSsoSignInLink) and the real gate both
 * callbacks ask (ProjectSsoSignInGate.decide); over accounts, invitations,
 * link tokens and consents held in memory (InvitedSsoSignInWorld). Held:
 *
 *   - with the link, each write happens once, in order, and the provider's
 *     answer signs them in, with no confirmation email;
 *   - without it, "Check your email" and the confirmation email, as before;
 *   - every refusal - a spent, expired or forged link, another project's or
 *     another token's signature, an account that has moved address, is
 *     blocked or is an administrator's, a project with nothing waiting, one
 *     that does not manage sign-in with SSO or has no provider of its own, a
 *     self-hosted server - writes nothing and leaves a live link live;
 *   - an ask whose signature is not the server's reads nothing at all;
 *   - two asks racing on one link write once;
 *   - every ask is answered alike - status, body and headers - on the
 *     invitation answer's limiter bucket, and the log names projects only.
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

jest.mock("Common/Server/Utils/SsoManagedSignIn", () => {
  return {
    __esModule: true,
    default: {
      getManagedByOnceIn: (): Promise<unknown> => {
        return Promise.resolve(managedBy);
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
const WALK_CO: string = "10178aaa-0000-4000-8000-000000000001";
const GLOBEX: string = "10178aaa-0000-4000-8000-000000000002";
const OKTA: SsoSignInProvider = {
  type: SsoProviderType.ProjectSSO,
  id: "10178bbb-0000-4000-8000-000000000001",
  name: "Okta",
  description: "",
};
const ENTRA: SsoSignInProvider = {
  type: SsoProviderType.ProjectOIDC,
  id: "10178bbb-0000-4000-8000-000000000002",
  name: "Entra ID",
  description: "",
};
const INSTANCE_WIDE: SsoSignInProvider = {
  type: SsoProviderType.GlobalSSO,
  id: "10178bbb-0000-4000-8000-000000000003",
  name: "Company SSO",
  description: "",
};

// The confirmation emails a stopped sign-in sends: counted, never sent.
let requestConfirmation: jest.SpiedFunction<
  typeof ProjectSsoSignInConfirmation.requestConfirmation
>;

// Grace has signed up; Walk Co invited her twice over (two of its teams).
let grace: WorldUser;
let link: WorldLink;

function signatureOf(token: string, projectId: string = WALK_CO): string {
  return InvitationSsoSignInLink.getSignature({
    token: token,
    projectId: projectId,
  });
}

beforeEach(() => {
  invitedSsoWorld.reset();
  redisClient.reset();
  setTestBillingEnabled(true);
  managedBy = SsoManagedBy.Projects;
  projectProviders = [OKTA];
  refreshUserAllPermissions.mockReset();
  refreshUserAllPermissions.mockResolvedValue(undefined);
  (logger.info as jest.Mock).mockClear();
  (logger.error as jest.Mock).mockClear();

  requestConfirmation = jest
    .spyOn(ProjectSsoSignInConfirmation, "requestConfirmation")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectSsoSignInConfirmation, "requestConfirmationForNewAccount")
    .mockResolvedValue(undefined);

  grace = invitedSsoWorld.seedUser({
    email: ADDRESS,
    hasPassword: true,
    isEmailVerified: false,
  });
  invitedSsoWorld.seedMembership({ userId: grace.id, projectId: WALK_CO });
  invitedSsoWorld.seedMembership({ userId: grace.id, projectId: WALK_CO });
  link = invitedSsoWorld.seedLink({ userId: grace.id, email: ADDRESS });
});

afterEach(async () => {
  await ProjectSsoSignInGate.waitForBackgroundWork();
  jest.restoreAllMocks();
});

// The page's ask, as it sends it: the link's token and signature, and the project.
const ask: (overrides?: {
  token?: unknown;
  signature?: unknown;
  projectId?: unknown;
}) => Promise<SignUpInvitationSsoOutcome> = (overrides?: {
  token?: unknown;
  signature?: unknown;
  projectId?: unknown;
}): Promise<SignUpInvitationSsoOutcome> => {
  return InvitationSsoSignIn.confirm({
    token: overrides && "token" in overrides ? overrides.token : link.token,
    signature:
      overrides && "signature" in overrides
        ? overrides.signature
        : signatureOf(link.token),
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

const isLinkLive: () => boolean = (): boolean => {
  const row: WorldLink | undefined = invitedSsoWorld.linkByToken(link.token);

  return Boolean(row) && !OneUptimeDate.hasExpired(row!.expires);
};

const whatWasWritten: () => Array<string> = (): Array<string> => {
  return invitedSsoWorld.writes.map((write: WorldWrite): string => {
    return write.what;
  });
};

describe("on OneUptime Cloud, with the invitation's link", () => {
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

    // Spent: it confirms nothing again.
    expect(isLinkLive()).toBe(false);
    await expect(ask()).resolves.toBe(SignUpInvitationSsoOutcome.LinkNotLive);
  });

  test("a verified address is not written again", async () => {
    grace.isEmailVerified = true;

    await ask();

    expect(whatWasWritten()).toEqual([
      "spent a link",
      "accepted invitations",
      "recorded a consent",
    ]);
  });

  test("the provider's answer then signs them in, the first time, with no email", async () => {
    await ask();

    const decision: ProjectSsoGateDecision = await providerAnswers();

    expect(decision.outcome).toBe(ProjectSsoGateOutcome.SignIn);
    expect(decision.user?.id?.toString()).toBe(grace.id);
    expect(requestConfirmation).not.toHaveBeenCalled();
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
});

describe("without the link, as before", () => {
  test("their first trip through the provider asks the mailbox: Check your email, and the confirmation email", async () => {
    const decision: ProjectSsoGateDecision = await providerAnswers();

    expect(decision.outcome).not.toBe(ProjectSsoGateOutcome.SignIn);
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(invitedSsoWorld.consents).toEqual([]);
  });
});

describe("every other ask writes nothing, and a live link stays live", () => {
  interface Refusal {
    label: string;
    arrange: () => void | Promise<void>;
    ask: () => Promise<SignUpInvitationSsoOutcome>;
    outcome: SignUpInvitationSsoOutcome;
    linkStaysLive: boolean;
  }

  const refusals: Array<Refusal> = [
    {
      label: "a signature that is not the server's",
      arrange: (): void => {},
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({ signature: "0".repeat(64) });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotSigned,
      linkStaysLive: true,
    },
    {
      label: "another project's link, asked for this project",
      arrange: (): void => {},
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({ signature: signatureOf(link.token, GLOBEX) });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotSigned,
      linkStaysLive: true,
    },
    {
      label: "this project's link, asked for another project",
      arrange: (): void => {},
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({ projectId: GLOBEX });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotSigned,
      linkStaysLive: true,
    },
    {
      label: "another token's signature",
      arrange: (): void => {},
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({ signature: signatureOf(ObjectID.generate().toString()) });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotSigned,
      linkStaysLive: true,
    },
    {
      label:
        "a stopped sign-in's confirmation link's signature, for the same token",
      arrange: (): void => {},
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({
          signature: ProjectSsoSignInConfirmation.getSignature({
            token: link.token,
            kind: ProjectSsoKind.SAML,
            projectId: WALK_CO,
            providerId: OKTA.id,
          }),
        });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotSigned,
      linkStaysLive: true,
    },
    {
      label: "a signature made with another installation's key",
      arrange: (): void => {},
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask({
          signature: crypto
            .createHmac("sha256", `${TokenSigningKey.get()}-elsewhere`)
            .update(
              ["invitation-project-sso-sign-in", link.token, WALK_CO].join(":"),
            )
            .digest("hex"),
        });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotSigned,
      linkStaysLive: true,
    },
    {
      label: "a signed token no link has",
      arrange: (): void => {},
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        const token: string = ObjectID.generate().toString();
        return ask({ token: token, signature: signatureOf(token) });
      },
      outcome: SignUpInvitationSsoOutcome.LinkNotLive,
      linkStaysLive: true,
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
      label: "an account that has moved to another address since",
      arrange: (): void => {
        grace.email = "grace@elsewhere.example";
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.AccountMoved,
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
      label: "a project with no invitation waiting: joined already",
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
      label: "a project with no invitation waiting: removed",
      arrange: (): void => {
        invitedSsoWorld.memberships = [];
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NoInvitationWaiting,
      linkStaysLive: true,
    },
    {
      label: "a project whose single sign-on does not manage their sign-in",
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
      label: "a server that requires single sign-on, by its own providers",
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
        projectProviders = [INSTANCE_WIDE];
      },
      ask: (): Promise<SignUpInvitationSsoOutcome> => {
        return ask();
      },
      outcome: SignUpInvitationSsoOutcome.NoProjectProvider,
      linkStaysLive: true,
    },
    {
      label: "a self-hosted server, which asks no mailbox",
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

  test.each(
    refusals.map((refusal: Refusal): [string, Refusal] => {
      return [refusal.label, refusal];
    }),
  )("%s", async (_label: string, refusal: Refusal) => {
    await refusal.arrange();

    await expect(refusal.ask()).resolves.toBe(refusal.outcome);

    expect(whatWasWritten()).toEqual([]);
    expect(invitedSsoWorld.consents).toEqual([]);
    expect(refreshUserAllPermissions).not.toHaveBeenCalled();
    expect(isLinkLive()).toBe(refusal.linkStaysLive);
  });

  test("a registration link's token - the sign-up page's - is no link here, whatever is signed for it", async () => {
    // Signed for this purpose it would be the server's own: only mint signs so.
    const registrationToken: WorldLink = invitedSsoWorld.seedLink({
      userId: grace.id,
      email: ADDRESS,
    });

    await expect(
      ask({
        token: registrationToken.token,
        signature: ProjectSsoSignInConfirmation.getSignature({
          token: registrationToken.token,
          kind: ProjectSsoKind.OIDC,
          projectId: WALK_CO,
          providerId: ENTRA.id,
        }),
      }),
    ).resolves.toBe(SignUpInvitationSsoOutcome.LinkNotSigned);
    expect(whatWasWritten()).toEqual([]);
  });
});

describe("an ask without the server's signature reads nothing at all", () => {
  test.each([
    ["no fields", {}],
    ["a token that is no id", { token: "not-a-token" }],
    ["a signature that is no hex", { signature: "z".repeat(64) }],
    ["a signature one character short", { signature: "a".repeat(63) }],
    ["a project that is no id", { projectId: "walk-co" }],
    ["numbers", { token: 7, signature: 7, projectId: 7 }],
    ["lists", { token: ["x"], signature: ["y"], projectId: ["z"] }],
    ["a wrong signature", { signature: "a".repeat(64) }],
  ])("%s", async (_label: string, overrides: Record<string, unknown>) => {
    const linkReads: jest.SpiedFunction<
      typeof fakeEmailVerificationTokenService.findOneBy
    > = jest.spyOn(fakeEmailVerificationTokenService, "findOneBy");
    const accountReads: jest.SpiedFunction<typeof fakeUserService.findOneById> =
      jest.spyOn(fakeUserService, "findOneById");

    const outcome: SignUpInvitationSsoOutcome = await ("token" in overrides ||
    "signature" in overrides ||
    "projectId" in overrides
      ? ask(overrides)
      : InvitationSsoSignIn.confirm({
          token: undefined,
          signature: undefined,
          projectId: undefined,
        }));

    expect([
      SignUpInvitationSsoOutcome.LinkNotAsked,
      SignUpInvitationSsoOutcome.LinkNotSigned,
    ]).toContain(outcome);
    expect(linkReads).not.toHaveBeenCalled();
    expect(accountReads).not.toHaveBeenCalled();
    expect(whatWasWritten()).toEqual([]);
  });
});

describe("races and failures", () => {
  test("two asks racing on one link write once", async () => {
    const outcomes: Array<SignUpInvitationSsoOutcome> = await Promise.all([
      ask(),
      ask(),
    ]);

    expect(outcomes.sort()).toEqual(
      [
        SignUpInvitationSsoOutcome.Confirmed,
        SignUpInvitationSsoOutcome.LinkSpentMeanwhile,
      ].sort(),
    );
    expect(
      whatWasWritten().filter((what: string): boolean => {
        return what === "recorded a consent";
      }),
    ).toHaveLength(1);
  });

  test("an invitation removed between the reads and the writes records no consent", async () => {
    invitedSsoWorld.removeInvitationsBeforeTheNextAcceptance = true;

    await expect(ask()).resolves.toBe(SignUpInvitationSsoOutcome.NotJoined);
    expect(invitedSsoWorld.consents).toEqual([]);
  });

  test("a failure is no error: the page goes on to the provider", async () => {
    refreshUserAllPermissions.mockRejectedValueOnce(new Error("Redis down"));

    await expect(ask()).resolves.toBe(SignUpInvitationSsoOutcome.Failed);
  });

  test("the server's log names the project, never the address or the link", async () => {
    await ask({ signature: "0".repeat(64) });
    await ask();

    const logged: string = JSON.stringify(
      (logger.info as jest.Mock).mock.calls,
    );

    expect(logged).toContain(WALK_CO);
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain(link.token);
    expect(logged).not.toContain(signatureOf(link.token));
  });
});

const REAL_CLIENT_IP: string = "203.0.113.9";

interface RouteResult {
  reachedHandler: boolean;
  error: Exception | null;
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

  const calls: (name: string) => Array<unknown> = (
    name: string,
  ): Array<unknown> => {
    return (
      (res as unknown as Record<string, jest.Mock>)[name]?.mock.calls || []
    );
  };

  return {
    reachedHandler: reachedHandler,
    error: state.error,
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

describe(`POST ${INVITATION_SSO_SIGN_IN_ROUTE}`, () => {
  test("sits behind a limiter, in front of its handler", () => {
    expect(
      mockRouter.matchAll("post", INVITATION_SSO_SIGN_IN_ROUTE).length,
    ).toBe(2);
  });

  test("hands the page's link and project to the confirmation, and the provider then signs them in", async () => {
    const result: RouteResult = await callRoute(INVITATION_SSO_SIGN_IN_ROUTE, {
      token: link.token,
      signature: signatureOf(link.token),
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
      grace = invitedSsoWorld.seedUser({ email: ADDRESS, hasPassword: true });
      invitedSsoWorld.seedMembership({ userId: grace.id, projectId: WALK_CO });
      link = invitedSsoWorld.seedLink({ userId: grace.id, email: ADDRESS });
      setTestBillingEnabled(true);
      managedBy = SsoManagedBy.Projects;
      projectProviders = [OKTA];
      arrange?.();

      const result: RouteResult = await callRoute(
        INVITATION_SSO_SIGN_IN_ROUTE,
        typeof body === "function" ? (body as () => unknown)() : body,
      );

      expect({ label, error: result.error }).toEqual({ label, error: null });
      answers.push({ label: label, answer: result.answer });
    };

    const good: () => JSONObject = (): JSONObject => {
      return {
        token: link.token,
        signature: signatureOf(link.token),
        projectId: WALK_CO,
      };
    };

    await record("a confirmation", good);
    await record("a forged signature", (): JSONObject => {
      return { ...good(), signature: "0".repeat(64) };
    });
    await record("another project's link", (): JSONObject => {
      return { ...good(), projectId: GLOBEX };
    });
    await record("a signed token no link has", (): JSONObject => {
      const token: string = ObjectID.generate().toString();
      return {
        token: token,
        signature: signatureOf(token),
        projectId: WALK_CO,
      };
    });
    await record("an account that has moved address", good, (): void => {
      grace.email = "grace@elsewhere.example";
    });
    await record("a blocked account", good, (): void => {
      grace.isBlocked = true;
    });
    await record("an administrator's account", good, (): void => {
      grace.isMasterAdmin = true;
    });
    await record(
      "a project SSO does not manage sign-in for",
      good,
      (): void => {
        managedBy = null;
      },
    );
    await record("a project with no provider of its own", good, (): void => {
      projectProviders = [INSTANCE_WIDE];
    });
    await record("a self-hosted server", good, (): void => {
      setTestBillingEnabled(false);
    });
    await record("a body of another shape", { token: ["x"], signature: 7 });
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
   * The invitation answer's bucket (SIGN_UP_INVITATION_BUCKET), shared with
   * the sign-up page's asks: a hundred and fifty a quarter hour from one
   * address, whichever of the routes asks.
   */
  test("counts on the invitation answer's bucket, with the invitation answer", async () => {
    const LIMIT: number = 150;
    const body: JSONObject = {
      token: "not-a-token",
      signature: "not-a-signature",
      projectId: WALK_CO,
    };

    for (let index: number = 0; index < LIMIT; index++) {
      const route: string =
        index % 2 === 0
          ? INVITATION_SSO_SIGN_IN_ROUTE
          : SIGN_UP_INVITATION_ROUTE;

      expect((await callRoute(route, body)).reachedHandler).toBe(true);
    }

    for (const key of Array.from(redisClient.counters.keys())) {
      expect(key.startsWith("identity:rl:sign-up-invitation:")).toBe(true);
    }

    const refused: RouteResult = await callRoute(
      INVITATION_SSO_SIGN_IN_ROUTE,
      body,
    );

    expect(refused.reachedHandler).toBe(false);
    expect(refused.answer["status"]).toEqual([
      [ExceptionCode.TooManyRequestsException],
    ]);

    expect(
      (await callRoute(INVITATION_SSO_SIGN_IN_ROUTE, body, "198.51.100.77"))
        .reachedHandler,
    ).toBe(true);
  });
});
