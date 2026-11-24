import ProjectSsoSignInConfirmation, {
  PROJECT_SSO_NEW_ACCOUNT_PURPOSE,
  ProjectSsoKind,
  ProjectSsoNewAccountClaims,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import OnCallPageLinkToken from "Common/Server/Utils/OnCall/OnCallPageLinkToken";
import logger from "Common/Server/Utils/Logger";
import Email from "Common/Types/Email";
import JsonWebTokenPurpose from "Common/Types/JsonWebTokenPurpose";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE LINK A PROJECT'S SSO EMAILS AN ADDRESS WITH NO ACCOUNT IS A KIND OF
 * TOKEN OF ITS OWN (#9824), WITH REAL SIGNATURES.
 *
 * Every token OneUptime signs is signed with the same key, so the
 * signature says only that this server made it. The link for an address no
 * account uses yet (ProjectSsoSignInConfirmation.getNewAccountToken) is read
 * as raw claims, by a purpose of its own, which TokenPurposeGuard lists with
 * that reason. That holds only while the link and a person's token never
 * stand in for each other:
 *
 *   - no reader of a person's token (JSONWebToken.decode, for every kind it
 *     reads, and the two sign-out readers) takes the link: it names no
 *     session, and says a purpose none of theirs says;
 *   - the link's reader takes none of theirs, nor any other token this
 *     server signs with the link's claims and another purpose, or none.
 *
 * The confirmation suite (ProjectSsoSignInConfirmation.test.ts) stands in
 * for JSONWebToken. This one signs and verifies for real, with the key a
 * test process makes for itself (TokenSigningKey).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const PROVIDER_ID: ObjectID = ObjectID.generate();
const ADDRESS: string = "newcomer@acme.example";

const LINK_CLAIMS: ProjectSsoNewAccountClaims = {
  email: new Email(ADDRESS),
  name: "New Comer",
  kind: ProjectSsoKind.SAML,
  projectId: PROJECT_ID,
  providerId: PROVIDER_ID,
};

type ReadLinkFunction = (
  account: string,
) => ReturnType<typeof ProjectSsoSignInConfirmation.readNewAccountToken>;

const readLink: ReadLinkFunction = (
  account: string,
): ReturnType<typeof ProjectSsoSignInConfirmation.readNewAccountToken> => {
  return ProjectSsoSignInConfirmation.readNewAccountToken({
    account,
    kind: ProjectSsoKind.SAML,
    projectId: PROJECT_ID.toString(),
    providerId: PROVIDER_ID.toString(),
  });
};

// The readers of a person's token, each by the kind it reads.
const PERSON_TOKEN_KINDS: Array<JsonWebTokenPurpose> = [
  JsonWebTokenPurpose.UserSession,
  JsonWebTokenPurpose.SsoSignIn,
  JsonWebTokenPurpose.StatusPageSession,
];

// Tokens of every other kind this server signs, for the same person and place.
const OTHER_TOKENS: Array<[string, () => string]> = [
  [
    "a session's access token",
    (): string => {
      return JSONWebToken.signUserLoginToken({
        tokenData: {
          userId: ObjectID.generate(),
          email: new Email(ADDRESS),
          name: new Name("New Comer"),
          timezone: null,
          isMasterAdmin: false,
          isGlobalLogin: false,
          sessionId: ObjectID.generate(),
        },
        expiresInSeconds: 15 * 60,
      });
    },
  ],
  [
    "an SSO sign-in through this very provider",
    (): string => {
      return JSONWebToken.sign({
        data: {
          userId: ObjectID.generate(),
          email: new Email(ADDRESS),
          name: new Name("New Comer"),
          projectId: PROJECT_ID,
          isMasterAdmin: false,
          ssoProviderId: PROVIDER_ID,
          ssoProviderType: SsoProviderType.ProjectSSO,
        },
        expiresInSeconds: 30 * 24 * 60 * 60,
        purpose: JsonWebTokenPurpose.SsoSignIn,
      });
    },
  ],
  [
    "a status page reader's session",
    (): string => {
      return JSONWebToken.sign({
        data: {
          userId: ObjectID.generate(),
          email: new Email(ADDRESS),
          statusPageId: ObjectID.generate(),
          sessionId: ObjectID.generate(),
        },
        expiresInSeconds: 15 * 60,
        purpose: JsonWebTokenPurpose.StatusPageSession,
      });
    },
  ],
  [
    "a browser's sign-out cookie",
    (): string => {
      return JSONWebToken.signSessionSignOutToken({
        userId: ObjectID.generate(),
        sessionId: ObjectID.generate(),
        expiresInSeconds: 60 * 60,
      });
    },
  ],
  [
    "an on-call page link",
    (): string => {
      return OnCallPageLinkToken.sign({
        userOnCallLogTimelineId: ObjectID.generate(),
      });
    },
  ],
  [
    "the link's own claims with another purpose",
    (): string => {
      return JSONWebToken.signJsonPayload(
        {
          purpose: "on-call-page",
          email: ADDRESS,
          name: "New Comer",
          kind: ProjectSsoKind.SAML,
          projectId: PROJECT_ID.toString(),
          providerId: PROVIDER_ID.toString(),
        },
        60 * 60,
      );
    },
  ],
  [
    "the link's own claims with no purpose",
    (): string => {
      return JSONWebToken.signJsonPayload(
        {
          email: ADDRESS,
          name: "New Comer",
          kind: ProjectSsoKind.SAML,
          projectId: PROJECT_ID.toString(),
          providerId: PROVIDER_ID.toString(),
        },
        60 * 60,
      );
    },
  ],
  [
    "the link's own claims signed as a person's token would be, which drops a purpose it is handed",
    (): string => {
      return JSONWebToken.sign({
        data: {
          purpose: PROJECT_SSO_NEW_ACCOUNT_PURPOSE,
          email: new Email(ADDRESS),
          name: new Name("New Comer"),
          kind: ProjectSsoKind.SAML,
          projectId: PROJECT_ID,
          providerId: PROVIDER_ID,
        } as never,
        expiresInSeconds: 60 * 60,
      });
    },
  ],
];

describe("the link a project's SSO emails an address with no account", () => {
  // decode logs what it refuses; nothing here needs the noise.
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  test("is read back by its own reader, as what it says", () => {
    const read: ReturnType<typeof readLink> = readLink(
      ProjectSsoSignInConfirmation.getNewAccountToken(LINK_CLAIMS),
    );

    expect(read).not.toBeNull();
    expect(read!.email.toString()).toBe(ADDRESS);
    expect(read!.name).toBe("New Comer");
    expect(read!.isExpired).toBe(false);
  });

  test.each(PERSON_TOKEN_KINDS)(
    "is never taken as a person's token (%s)",
    (kind: JsonWebTokenPurpose) => {
      const link: string =
        ProjectSsoSignInConfirmation.getNewAccountToken(LINK_CLAIMS);

      expect(() => {
        return JSONWebToken.decode(link, kind);
      }).toThrow();
    },
  );

  test("is never taken as a browser's sign-out cookie", () => {
    const link: string =
      ProjectSsoSignInConfirmation.getNewAccountToken(LINK_CLAIMS);

    expect(() => {
      return JSONWebToken.decodeSessionToSignOut(link);
    }).toThrow();
    expect(() => {
      return JSONWebToken.decodeStatusPageSessionToSignOut(link);
    }).toThrow();
  });

  test.each(OTHER_TOKENS)(
    "its reader refuses %s",
    (_name: string, sign: () => string) => {
      expect(readLink(sign())).toBeNull();
    },
  );

  test("says the purpose no person's token says", () => {
    expect(
      Object.values(JsonWebTokenPurpose as Record<string, string>),
    ).not.toContain(PROJECT_SSO_NEW_ACCOUNT_PURPOSE);
  });
});
