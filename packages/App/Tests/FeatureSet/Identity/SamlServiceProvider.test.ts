import SamlServiceProviders, {
  SamlServiceProvider,
} from "../../../FeatureSet/Identity/Utils/SamlServiceProvider";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * What OneUptime tells an identity provider about each kind of SAML provider
 * - the Entity ID and the Reply URL an admin copies into it - and how an
 * address a response carries is compared with them.
 *
 * The values have to be exactly what the Dashboard and the Admin Dashboard
 * show (SamlSignInRoutesGuard.test.ts reads their source for that), because
 * identity providers write back what they were given: anything else and
 * every sign-in through the provider is refused.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
    Host: "status.acme.example:8443",
    HttpProtocol: "https://",
  };
});

const SERVER: string = "https://status.acme.example:8443";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID: string = "22222222-2222-4222-8222-222222222222";
const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";

describe("the values each kind of provider is known by", () => {
  test("a project's SAML provider", () => {
    expect(
      SamlServiceProviders.forProjectSso({
        projectId: PROJECT_ID,
        projectSsoId: PROVIDER_ID,
      }),
    ).toEqual({
      entityId: `${SERVER}/${PROJECT_ID}/${PROVIDER_ID}`,
      replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
      serverAddress: SERVER,
    });
  });

  test("a status page's SAML provider", () => {
    expect(
      SamlServiceProviders.forStatusPageSso({
        statusPageId: STATUS_PAGE_ID,
        statusPageSsoId: PROVIDER_ID,
      }),
    ).toEqual({
      entityId: `${SERVER}/${STATUS_PAGE_ID}/${PROVIDER_ID}`,
      replyUrl: `${SERVER}/identity/status-page-idp-login/${STATUS_PAGE_ID}/${PROVIDER_ID}`,
      serverAddress: SERVER,
    });
  });

  test("an instance-wide (Global SSO) SAML provider", () => {
    expect(
      SamlServiceProviders.forGlobalSso({ globalSsoId: PROVIDER_ID }),
    ).toEqual({
      entityId: `${SERVER}/global-sso/${PROVIDER_ID}`,
      replyUrl: `${SERVER}/identity/global-idp-login/${PROVIDER_ID}`,
      serverAddress: SERVER,
    });
  });

  test("takes ObjectIDs as well as strings", () => {
    const fromIds: SamlServiceProvider = SamlServiceProviders.forProjectSso({
      projectId: new ObjectID(PROJECT_ID),
      projectSsoId: new ObjectID(PROVIDER_ID),
    });

    expect(fromIds).toEqual(
      SamlServiceProviders.forProjectSso({
        projectId: PROJECT_ID,
        projectSsoId: PROVIDER_ID,
      }),
    );
  });

  /*
   * Each kind has a Reply URL path of its own, so even with the very same ids
   * a response sent to one kind is never taken at another: the Recipient
   * check tells them apart.
   */
  test("no two kinds of provider share a Reply URL, even with the same ids", () => {
    const replyUrls: Array<string> = [
      SamlServiceProviders.forProjectSso({
        projectId: PROJECT_ID,
        projectSsoId: PROVIDER_ID,
      }).replyUrl,
      SamlServiceProviders.forStatusPageSso({
        statusPageId: PROJECT_ID,
        statusPageSsoId: PROVIDER_ID,
      }).replyUrl,
      SamlServiceProviders.forGlobalSso({ globalSsoId: PROVIDER_ID }).replyUrl,
    ];

    for (const first of replyUrls) {
      for (const second of replyUrls) {
        expect(SamlServiceProviders.isSameAddress(first, second)).toBe(
          first === second,
        );
      }
    }
  });

  /*
   * A project provider and a status page provider are told apart in their
   * Entity IDs by their ids alone - random uuids, which do not repeat. Were
   * they ever the same, the Reply URL above would still keep them apart.
   */
  test("project and status page Entity IDs differ only by their ids", () => {
    expect(
      SamlServiceProviders.forProjectSso({
        projectId: PROJECT_ID,
        projectSsoId: PROVIDER_ID,
      }).entityId,
    ).toBe(
      SamlServiceProviders.forStatusPageSso({
        statusPageId: PROJECT_ID,
        statusPageSsoId: PROVIDER_ID,
      }).entityId,
    );
  });
});

describe("isSameAddress", () => {
  const EXPECTED: string = `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROVIDER_ID}`;

  test.each([
    ["the address itself", EXPECTED],
    ["with a trailing slash", `${EXPECTED}/`],
    ["with several trailing slashes", `${EXPECTED}///`],
    ["over http", EXPECTED.replace("https://", "http://")],
    ["with the scheme in capitals", EXPECTED.replace("https://", "HTTPS://")],
    [
      "with the host in capitals",
      EXPECTED.replace("status.acme.example", "STATUS.ACME.EXAMPLE"),
    ],
    ["with the path in capitals", EXPECTED.toUpperCase()],
    ["with a query string", `${EXPECTED}?source=idp`],
    ["with a fragment", `${EXPECTED}#done`],
    ["surrounded by whitespace", `  ${EXPECTED}\n`],
  ])("matches %s", (_label: string, candidate: string) => {
    expect(SamlServiceProviders.isSameAddress(candidate, EXPECTED)).toBe(true);
  });

  test.each([
    ["another host", EXPECTED.replace("status.acme.example", "evil.example")],
    [
      "a host that only starts the same",
      EXPECTED.replace("status.acme.example", "status.acme.example.evil.net"),
    ],
    ["another port", EXPECTED.replace(":8443", ":9443")],
    ["no port, where one is expected", EXPECTED.replace(":8443", "")],
    ["another path", EXPECTED.replace("idp-login", "global-idp-login")],
    ["a longer path", `${EXPECTED}/extra`],
    ["a shorter path", EXPECTED.substring(0, EXPECTED.lastIndexOf("/"))],
    ["a path with one character more", `${EXPECTED}0`],
    [
      "user information before the host",
      EXPECTED.replace("https://", "https://user@"),
    ],
    [
      "a password before the host",
      EXPECTED.replace("https://", "https://user:secret@"),
    ],
    ["another scheme", EXPECTED.replace("https://", "ftp://")],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", `/identity/idp-login/${PROJECT_ID}/${PROVIDER_ID}`],
    ["a bare host", "status.acme.example:8443"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a URN", `urn:oneuptime:${PROJECT_ID}`],
  ])("does not match %s", (_label: string, candidate: string) => {
    expect(SamlServiceProviders.isSameAddress(candidate, EXPECTED)).toBe(false);
  });

  test("an address too long to be one OneUptime gave names nothing", () => {
    const long: string = `${EXPECTED}/${"a".repeat(2100)}`;

    expect(SamlServiceProviders.isSameAddress(long, long)).toBe(false);
  });

  test("a value that is not a string names nothing", () => {
    expect(
      SamlServiceProviders.isSameAddress(
        undefined as unknown as string,
        EXPECTED,
      ),
    ).toBe(false);
    expect(
      SamlServiceProviders.isSameAddress(EXPECTED, null as unknown as string),
    ).toBe(false);
  });

  test("an international host matches its punycode spelling", () => {
    expect(
      SamlServiceProviders.isSameAddress(
        "https://bücher.example/identity/idp-login/a/b",
        "https://xn--bcher-kva.example/identity/idp-login/a/b",
      ),
    ).toBe(true);
  });

  test("compares a path of 2,000 slashes quickly", () => {
    const slashes: string = `${EXPECTED}${"/".repeat(1900)}`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(SamlServiceProviders.isSameAddress(slashes, EXPECTED)).toBe(
          true,
        );
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});
