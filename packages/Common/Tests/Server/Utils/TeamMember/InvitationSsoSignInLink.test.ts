import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN INVITATION'S SINGLE-USE LINK TO ITS PROJECT'S SINGLE SIGN-ON, FOR
 * SOMEONE WHO HAS SIGNED UP (#10178, Server/Utils/TeamMember
 * /InvitationSsoSignInLink).
 *
 * The link itself - signed for its purpose, its token and its project, and
 * nothing else; its page; the token minted for the account and the invited
 * address, as long-lived as an invitation's sign-up link - and the
 * invitation email that carries it, built after the invitation's request
 * (InvitationWorld): only on OneUptime Cloud, only for someone who has
 * signed up and whose sign-in the project's single sign-on manages, only
 * while there is something to accept, and with nothing in the project's
 * email log to say whether it was carried. Spending it is the Identity
 * service's (App Tests/FeatureSet/Identity/InvitationSsoSignInOneTrip).
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import crypto from "crypto";
import EmailVerificationToken from "../../../../Models/DatabaseModels/EmailVerificationToken";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import Redis from "../../../../Server/Infrastructure/Redis";
import EmailVerificationTokenService from "../../../../Server/Services/EmailVerificationTokenService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceClass,
} from "../../../../Server/Services/TeamMemberService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import InvitationSsoSignInLink, {
  INVITATION_SSO_SIGN_IN_EXPIRY_IN_DAYS,
  INVITATION_SSO_SIGN_IN_PURPOSE,
} from "../../../../Server/Utils/TeamMember/InvitationSsoSignInLink";
import TokenSigningKey from "../../../../Server/Utils/TokenSigningKey";
import { REGISTRATION_TOKEN_EXPIRY_IN_DAYS } from "../../../../Server/Utils/UserRegistrationToken";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import {
  INVITATION_SSO_SIGNATURE_PARAMETER,
  INVITATION_SSO_TOKEN_PARAMETER,
  readInvitationSsoSignInLink,
} from "../../../../Types/Accounts/InvitationSsoSignIn";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import Email from "../../../../Types/Email";
import EmailMessage from "../../../../Types/Email/EmailMessage";
import ObjectID from "../../../../Types/ObjectID";
import { SsoManagedBy } from "../../../../Types/SSO/SsoManagedSignIn";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import InvitationWorld, {
  WorldAccount,
} from "../../TestingUtils/InvitationWorld";
import FakeCounterRedis from "../../TestingUtils/Redis/FakeCounterRedis";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10178000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10178000-0000-4000-8000-000000000002",
);
const TOKEN: string = "10178000-0000-4000-8000-00000000000a";
const ADDRESS: string = "grace@company.example";

const HOST: Hostname = new Hostname("oneuptime.test");

describe("the link's signature", () => {
  const signature: string = InvitationSsoSignInLink.getSignature({
    token: TOKEN,
    projectId: PROJECT_ID.toString(),
  });

  test("is the server's HMAC of this purpose, the token and the project", () => {
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(
      crypto
        .createHmac("sha256", TokenSigningKey.get())
        .update(
          [INVITATION_SSO_SIGN_IN_PURPOSE, TOKEN, PROJECT_ID.toString()].join(
            ":",
          ),
        )
        .digest("hex"),
    );
  });

  test("checks out for its own token and project", () => {
    expect(
      InvitationSsoSignInLink.isSignatureValid({
        token: TOKEN,
        signature: signature,
        projectId: PROJECT_ID.toString(),
      }),
    ).toBe(true);

    // The same ids in capitals are the same ids.
    expect(
      InvitationSsoSignInLink.isSignatureValid({
        token: TOKEN.toUpperCase(),
        signature: signature,
        projectId: PROJECT_ID.toString().toUpperCase(),
      }),
    ).toBe(true);
  });

  test("opens no other project's single sign-on, and no other token", () => {
    expect(
      InvitationSsoSignInLink.isSignatureValid({
        token: TOKEN,
        signature: signature,
        projectId: OTHER_PROJECT_ID.toString(),
      }),
    ).toBe(false);
    expect(
      InvitationSsoSignInLink.isSignatureValid({
        token: ObjectID.generate().toString(),
        signature: signature,
        projectId: PROJECT_ID.toString(),
      }),
    ).toBe(false);
  });

  test.each([
    ["no signature", ""],
    [
      "one character changed",
      `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`,
    ],
    ["one character short", signature.slice(0, -1)],
    ["one character long", `${signature}0`],
    ["in capitals", signature.toUpperCase()],
    [
      "a stopped sign-in's confirmation link's, for the same token and project",
      crypto
        .createHmac("sha256", TokenSigningKey.get())
        .update(
          [
            "project-sso-sign-in-confirmation",
            TOKEN,
            "saml",
            PROJECT_ID.toString(),
            ObjectID.generate().toString(),
          ].join(":"),
        )
        .digest("hex"),
    ],
    [
      "one made with another key",
      crypto
        .createHmac("sha256", "another-installation's-key")
        .update(
          [INVITATION_SSO_SIGN_IN_PURPOSE, TOKEN, PROJECT_ID.toString()].join(
            ":",
          ),
        )
        .digest("hex"),
    ],
  ])("is refused: %s", (_label: string, supplied: string) => {
    expect(
      InvitationSsoSignInLink.isSignatureValid({
        token: TOKEN,
        signature: supplied,
        projectId: PROJECT_ID.toString(),
      }),
    ).toBe(false);
  });
});

describe("the page it opens", () => {
  test("the project's own SSO page, with the link in its query", () => {
    const page: string = InvitationSsoSignInLink.getPageUrl({
      host: HOST,
      httpProtocol: Protocol.HTTPS,
      projectId: PROJECT_ID,
      link: { token: TOKEN, signature: "ab".repeat(32) },
    });

    expect(page).toBe(
      `https://oneuptime.test/accounts/sso/${PROJECT_ID.toString()}?${INVITATION_SSO_TOKEN_PARAMETER}=${TOKEN}&${INVITATION_SSO_SIGNATURE_PARAMETER}=${"ab".repeat(32)}`,
    );

    // The page reads it back as it was written.
    expect(readInvitationSsoSignInLink(new URL(page).search)).toEqual({
      token: TOKEN,
      signature: "ab".repeat(32),
    });
  });

  test("without a link, the page alone", () => {
    expect(
      InvitationSsoSignInLink.getPageUrl({
        host: HOST,
        httpProtocol: Protocol.HTTP,
        projectId: PROJECT_ID,
      }),
    ).toBe(`http://oneuptime.test/accounts/sso/${PROJECT_ID.toString()}`);
  });

  test.each([
    ["no query", ""],
    ["a token alone", `?${INVITATION_SSO_TOKEN_PARAMETER}=${TOKEN}`],
    ["a signature alone", `?${INVITATION_SSO_SIGNATURE_PARAMETER}=abc`],
    [
      "both empty",
      `?${INVITATION_SSO_TOKEN_PARAMETER}=&${INVITATION_SSO_SIGNATURE_PARAMETER}=`,
    ],
  ])("a page opened with %s has no link", (_label: string, search: string) => {
    expect(readInvitationSsoSignInLink(search)).toBeNull();
  });
});

describe("minting it", () => {
  let created: Array<EmailVerificationToken>;

  beforeEach(() => {
    created = [];
    jest
      .spyOn(EmailVerificationTokenService, "create")
      .mockImplementation((async (args: unknown) => {
        const row: EmailVerificationToken = (
          args as { data: EmailVerificationToken }
        ).data;
        created.push(row);
        return row;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a token for the account and the invited address, as long-lived as an invitation's sign-up link, signed for the project", async () => {
    const userId: ObjectID = ObjectID.generate();

    const page: string = await InvitationSsoSignInLink.mint({
      userId: userId,
      email: new Email(ADDRESS),
      projectId: PROJECT_ID,
      host: HOST,
      httpProtocol: Protocol.HTTPS,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.userId?.toString()).toBe(userId.toString());
    expect(created[0]!.email?.toString()).toBe(ADDRESS);
    expect(INVITATION_SSO_SIGN_IN_EXPIRY_IN_DAYS).toBe(
      REGISTRATION_TOKEN_EXPIRY_IN_DAYS,
    );

    const lifetimeInDays: number =
      (new Date(created[0]!.expires!).getTime() -
        OneUptimeDate.getCurrentDate().getTime()) /
      (24 * 60 * 60 * 1000);

    expect(lifetimeInDays).toBeGreaterThan(
      REGISTRATION_TOKEN_EXPIRY_IN_DAYS - 0.01,
    );
    expect(lifetimeInDays).toBeLessThanOrEqual(
      REGISTRATION_TOKEN_EXPIRY_IN_DAYS,
    );

    const link: { token: string; signature: string } | null =
      readInvitationSsoSignInLink(new URL(page).search);

    expect(link?.token).toBe(created[0]!.token!.toString());
    expect(
      InvitationSsoSignInLink.isSignatureValid({
        token: link!.token,
        signature: link!.signature,
        projectId: PROJECT_ID.toString(),
      }),
    ).toBe(true);
  });

  test("each is its own: two links, two tokens", async () => {
    const mint: () => Promise<string> = (): Promise<string> => {
      return InvitationSsoSignInLink.mint({
        userId: ObjectID.generate(),
        email: new Email(ADDRESS),
        projectId: PROJECT_ID,
        host: HOST,
        httpProtocol: Protocol.HTTPS,
      });
    };

    expect(await mint()).not.toBe(await mint());
    expect(created[0]!.token!.toString()).not.toBe(
      created[1]!.token!.toString(),
    );
  });
});

describe("the invitation email that carries it", () => {
  const INVITER_ID: ObjectID = new ObjectID(
    "10178000-0000-4000-8000-000000000003",
  );

  let world: InvitationWorld;
  let managedBy: SsoManagedBy | null;

  beforeEach(() => {
    jest.clearAllMocks();

    const redis: FakeCounterRedis = new FakeCounterRedis();
    (Redis.getClient as unknown as MockedFn).mockReturnValue(redis);
    (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);

    world = new InvitationWorld();
    world.install();
    setTestBillingEnabled(true);

    managedBy = SsoManagedBy.Projects;
    jest
      .spyOn(TeamMemberServiceClass, "readInvitationSsoManagedBy")
      .mockImplementation(async (): Promise<SsoManagedBy | null> => {
        return managedBy;
      });
  });

  afterEach(() => {
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  function invite(data: { isAccepted?: boolean } = {}): CreateBy<TeamMember> {
    const member: TeamMember = new TeamMember();
    member.projectId = PROJECT_ID;
    member.teamId = ObjectID.generate();

    if (data.isAccepted) {
      member.hasAcceptedInvitation = true;
    }

    return {
      data: member,
      props: (data.isAccepted
        ? { userId: INVITER_ID, isMasterAdmin: true }
        : {
            userId: INVITER_ID,
            tenantId: PROJECT_ID,
          }) as DatabaseCommonInteractionProps,
      miscDataProps: { email: ADDRESS },
    } as CreateBy<TeamMember>;
  }

  function sent(): EmailMessage {
    expect(world.mails).toHaveLength(1);
    return world.mails[0]!;
  }

  test("someone who has signed up, on OneUptime Cloud: Sign In with SSO opens the project's page with a link of their own", async () => {
    const grace: WorldAccount = world.seedAccount({
      email: ADDRESS,
      hasSignedUp: true,
    });

    await world.create(invite());

    const email: EmailMessage = sent();
    const page: string = email.vars["ssoSignInLink"] as string;

    expect(email.vars["isSsoSignIn"]).toBe("true");
    expect(
      page.startsWith(
        `https://oneuptime.test/accounts/sso/${PROJECT_ID.toString()}?`,
      ),
    ).toBe(true);

    // Minted after the answer, for this account and this address alone.
    expect(world.callsBeforeAnswer()).not.toContain(
      "EmailVerificationTokenService.create",
    );
    expect(world.tokensMinted).toHaveLength(1);
    expect(world.tokensMinted[0]!.userId?.toString()).toBe(grace.id.toString());
    expect(world.tokensMinted[0]!.email?.toString()).toBe(ADDRESS);

    const link: { token: string; signature: string } | null =
      readInvitationSsoSignInLink(new URL(page).search);

    expect(link?.token).toBe(world.tokensMinted[0]!.token!.toString());
    expect(
      InvitationSsoSignInLink.isSignatureValid({
        token: link!.token,
        signature: link!.signature,
        projectId: PROJECT_ID.toString(),
      }),
    ).toBe(true);
  });

  test("on a self-hosted server, which asks no mailbox: the project's page, and no link", async () => {
    setTestBillingEnabled(false);
    world.seedAccount({ email: ADDRESS, hasSignedUp: true });

    await world.create(invite());

    expect(sent().vars["ssoSignInLink"]).toBe(
      `https://oneuptime.test/accounts/sso/${PROJECT_ID.toString()}`,
    );
    expect(world.tokensMinted).toHaveLength(0);
  });

  test("accepted for them, with nothing to accept: the project's page, and no link", async () => {
    world.seedAccount({ email: ADDRESS, hasSignedUp: true });

    await world.create(invite({ isAccepted: true }));

    expect(sent().vars["ssoSignInLink"]).toBe(
      `https://oneuptime.test/accounts/sso/${PROJECT_ID.toString()}`,
    );
    expect(world.tokensMinted).toHaveLength(0);
  });

  test("a server that requires single sign-on: Sign in with SSO, as before, and no link", async () => {
    managedBy = SsoManagedBy.Server;
    world.seedAccount({ email: ADDRESS, hasSignedUp: true });

    await world.create(invite());

    expect(sent().vars["ssoSignInLink"]).toBe(
      "https://oneuptime.test/accounts/sso",
    );
    expect(world.tokensMinted).toHaveLength(0);
  });

  test("a project whose single sign-on does not manage their sign-in: an ordinary invitation, and no spare key", async () => {
    managedBy = null;
    world.seedAccount({ email: ADDRESS, hasSignedUp: true });

    await world.create(invite());

    expect(sent().vars["isSsoSignIn"]).toBe("false");
    expect(world.tokensMinted).toHaveLength(0);
  });

  test("someone who has not signed up: the sign-up page's link, as #9898 made it, and only its token", async () => {
    world.seedAccount({ email: ADDRESS, hasSignedUp: false });

    await world.create(invite());

    const email: EmailMessage = sent();

    expect(email.vars["ssoSignInLink"]).toBe(email.vars["registerLink"]);
    expect(email.vars["ssoSignInLink"]).toContain("/accounts/register");
    expect(world.tokensMinted).toHaveLength(1);
  });

  test("the project's email log cannot tell whether the invitation carried a link: the same subject and template either way", async () => {
    const logged: (
      isManaged: boolean,
    ) => Promise<Record<string, unknown>> = async (
      isManaged: boolean,
    ): Promise<Record<string, unknown>> => {
      world.accounts = [];
      world.memberships = [];
      world.mails = [];
      managedBy = isManaged ? SsoManagedBy.Projects : null;
      world.seedAccount({ email: ADDRESS, hasSignedUp: true });

      await world.create(invite());

      const email: EmailMessage = sent();

      return {
        projectLogSubject: email.projectLogSubject,
        templateType: email.templateType,
        toEmail: email.toEmail.toString(),
      };
    };

    expect(await logged(true)).toEqual(await logged(false));
  });

  test("Resend Invitation sends a new link, as it sends a new sign-up link", async () => {
    const grace: WorldAccount = world.seedAccount({
      email: ADDRESS,
      hasSignedUp: true,
    });

    await world.create(invite());
    await world.resend({
      projectId: PROJECT_ID,
      userId: grace.id,
      props: {
        userId: INVITER_ID,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps,
    });

    expect(world.mails).toHaveLength(2);
    expect(world.tokensMinted).toHaveLength(2);
    expect(world.mails[1]!.vars["ssoSignInLink"]).toContain(
      world.tokensMinted[1]!.token!.toString(),
    );
  });

  test("the service hands no link to anyone but the email: the create's answer carries none", async () => {
    world.seedAccount({ email: ADDRESS, hasSignedUp: true });

    const created: TeamMember = await world.create(invite());

    expect(JSON.stringify(created)).not.toContain(
      world.tokensMinted[0]!.token!.toString(),
    );
    expect(TeamMemberService).toBeDefined();
  });
});
