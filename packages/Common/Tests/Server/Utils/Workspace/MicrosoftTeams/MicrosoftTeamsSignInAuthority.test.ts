import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsSignInAuthorityUtil, {
  MICROSOFT_ANY_ORGANIZATION,
  MicrosoftTeamsSignInAuthority,
  MicrosoftTeamsSignInAuthoritySource,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsSignInAuthority";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

// Microsoft Entra ID's sign-in of the commercial cloud, where no MICROSOFT_TEAMS_CLOUD is set.
const MICROSOFT_LOGIN_ORIGIN: string = "https://login.microsoftonline.com";

/*
 * Issue #5202: with the app registered for one organization, as the
 * self-hosted guide says, "Connect my account with Microsoft Teams" signed in
 * at Microsoft's `common` endpoint, which Microsoft refuses for such an app
 * (AADSTS50194). These pin where the sign-in goes instead, for every case:
 * the project's tenant, the tenant the app is registered in, and Microsoft's
 * endpoint for any organization only when nothing names a tenant - never
 * `common`.
 */

// The organization a self-hosted server serves, which its app is registered in.
const CONTOSO: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
// A customer of OneUptime Cloud, whose project is connected to Microsoft Teams.
const FABRIKAM: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
// The tenant OneUptime Cloud's multitenant app is registered in.
const ONEUPTIME_HOME: string = "4220aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const NOT_TENANTS: Array<[string, unknown]> = [
  ["Microsoft's endpoint for work, school and personal accounts", "common"],
  ["Microsoft's endpoint for any organization", "organizations"],
  ["Microsoft's endpoint for personal accounts", "consumers"],
  ["an upper-case endpoint word", "COMMON"],
  ["an empty string", ""],
  ["blanks", "   "],
  ["a path", "../../common"],
  ["a path inside a GUID", `${CONTOSO}/../common`],
  ["a query", `${CONTOSO}?x=1`],
  ["a single label", "contoso"],
  ["a GUID in braces", `{${CONTOSO}}`],
  ["a GUID with a missing digit", CONTOSO.slice(1)],
  ["a domain with a space", "contoso .onmicrosoft.com"],
  ["a domain with an empty label", "contoso..onmicrosoft.com"],
  ["a domain that starts with a dot", ".onmicrosoft.com"],
  ["a URL", "https://login.microsoftonline.com/common"],
  ["longer than any domain name", `${"a".repeat(250)}.com`],
  ["null", null],
  ["undefined", undefined],
  ["a number", 42],
  ["an object", { tenantId: CONTOSO }],
];

describe("what is a tenant", () => {
  test("a tenant id is a GUID, in either case", () => {
    expect(MicrosoftTeamsSignInAuthorityUtil.isTenantId(CONTOSO)).toBe(true);
    expect(
      MicrosoftTeamsSignInAuthorityUtil.isTenantId(CONTOSO.toUpperCase()),
    ).toBe(true);
  });

  test.each(NOT_TENANTS)(
    "%s is not a tenant id",
    (_label: string, value: unknown) => {
      expect(MicrosoftTeamsSignInAuthorityUtil.isTenantId(value)).toBe(false);
    },
  );

  test("a tenant domain name is a tenant, but not a tenant id", () => {
    expect(
      MicrosoftTeamsSignInAuthorityUtil.readTenant("contoso.onmicrosoft.com"),
    ).toBe("contoso.onmicrosoft.com");
    expect(
      MicrosoftTeamsSignInAuthorityUtil.isTenantId("contoso.onmicrosoft.com"),
    ).toBe(false);
  });

  test("a tenant is read trimmed and in lower case", () => {
    expect(
      MicrosoftTeamsSignInAuthorityUtil.readTenant(
        `  ${CONTOSO.toUpperCase()}\n`,
      ),
    ).toBe(CONTOSO);
    expect(
      MicrosoftTeamsSignInAuthorityUtil.readTenant(" Contoso.OnMicrosoft.com "),
    ).toBe("contoso.onmicrosoft.com");
  });

  test.each(NOT_TENANTS)(
    "%s is not a tenant",
    (_label: string, value: unknown) => {
      expect(MicrosoftTeamsSignInAuthorityUtil.readTenant(value)).toBeNull();
    },
  );

  test("a long hostile value is refused at once", () => {
    /*
     * Longer than a domain name can be, so no pattern even reads it - and
     * the domain pattern is linear anyway: a label's class has no dot.
     */
    const hostile: string = `${"a.".repeat(200000)}!`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(
          MicrosoftTeamsSignInAuthorityUtil.readTenant(hostile),
        ).toBeNull();
        expect(
          MicrosoftTeamsSignInAuthorityUtil.readTenant(
            `${"a.".repeat(125)}${"a".repeat(2)}!`,
          ),
        ).toBeNull();
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("where the sign-in goes", () => {
  test.each([
    [
      "self-hosted, single-tenant app, the project connected",
      { projectTenantId: CONTOSO, appTenantId: CONTOSO },
      {
        tenantId: CONTOSO,
        source: MicrosoftTeamsSignInAuthoritySource.ProjectTenant,
      },
    ],
    [
      "OneUptime Cloud, a customer's project connected to its own tenant",
      { projectTenantId: FABRIKAM, appTenantId: ONEUPTIME_HOME },
      {
        tenantId: FABRIKAM,
        source: MicrosoftTeamsSignInAuthoritySource.ProjectTenant,
      },
    ],
    [
      "a project connected, with no tenant configured for the app",
      { projectTenantId: FABRIKAM, appTenantId: null },
      {
        tenantId: FABRIKAM,
        source: MicrosoftTeamsSignInAuthoritySource.ProjectTenant,
      },
    ],
    [
      "a project not connected yet: the tenant the app is registered in",
      { projectTenantId: undefined, appTenantId: CONTOSO },
      {
        tenantId: CONTOSO,
        source: MicrosoftTeamsSignInAuthoritySource.AppTenant,
      },
    ],
    [
      "a project not connected yet, the app's tenant named by its domain",
      { projectTenantId: undefined, appTenantId: "Contoso.onmicrosoft.com" },
      {
        tenantId: "contoso.onmicrosoft.com",
        source: MicrosoftTeamsSignInAuthoritySource.AppTenant,
      },
    ],
    [
      "a project whose stored tenant is not one: the app's tenant",
      { projectTenantId: "not-a-tenant", appTenantId: CONTOSO },
      {
        tenantId: CONTOSO,
        source: MicrosoftTeamsSignInAuthoritySource.AppTenant,
      },
    ],
    [
      "nothing names a tenant: Microsoft's endpoint for any organization",
      { projectTenantId: undefined, appTenantId: null },
      {
        tenantId: undefined,
        source: MicrosoftTeamsSignInAuthoritySource.AnyOrganization,
      },
    ],
    [
      "the app's tenant set to common, which names no tenant",
      { projectTenantId: null, appTenantId: "common" },
      {
        tenantId: undefined,
        source: MicrosoftTeamsSignInAuthoritySource.AnyOrganization,
      },
    ],
    [
      "an upper-case project tenant",
      { projectTenantId: FABRIKAM.toUpperCase(), appTenantId: CONTOSO },
      {
        tenantId: FABRIKAM,
        source: MicrosoftTeamsSignInAuthoritySource.ProjectTenant,
      },
    ],
  ])(
    "%s",
    (
      _label: string,
      input: { projectTenantId: unknown; appTenantId: unknown },
      expected: MicrosoftTeamsSignInAuthority,
    ) => {
      expect(MicrosoftTeamsSignInAuthorityUtil.choose(input)).toEqual(expected);
    },
  );

  test("the authorize and token endpoints of a tenant are that tenant's", () => {
    expect(MicrosoftTeamsSignInAuthorityUtil.getAuthorizeUrl(CONTOSO)).toBe(
      `https://login.microsoftonline.com/${CONTOSO}/oauth2/v2.0/authorize`,
    );
    expect(MicrosoftTeamsSignInAuthorityUtil.getTokenUrl(CONTOSO)).toBe(
      `https://login.microsoftonline.com/${CONTOSO}/oauth2/v2.0/token`,
    );
  });

  test("a sign-in pinned to no tenant goes to Microsoft's endpoint for any organization, never common", () => {
    expect(MICROSOFT_ANY_ORGANIZATION).toBe("organizations");
    expect(MicrosoftTeamsSignInAuthorityUtil.getAuthorizeUrl(undefined)).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
    );
    expect(MicrosoftTeamsSignInAuthorityUtil.getTokenUrl(undefined)).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    );
  });

  test.each(
    NOT_TENANTS.filter(([, value]: [string, unknown]): boolean => {
      return typeof value === "string";
    }),
  )(
    "%s never becomes the authority: the endpoint for any organization does",
    (_label: string, value: unknown) => {
      const url: globalThis.URL = new globalThis.URL(
        MicrosoftTeamsSignInAuthorityUtil.getAuthorizeUrl(value as string),
      );

      expect(url.origin).toBe(MICROSOFT_LOGIN_ORIGIN);
      expect(url.pathname).toBe("/organizations/oauth2/v2.0/authorize");
      expect(url.search).toBe("");
    },
  );

  test("whatever is stored or configured, the sign-in goes to a real tenant or the endpoint for any organization - never common", () => {
    const inputs: Array<unknown> = [
      ...NOT_TENANTS.map(([, value]: [string, unknown]): unknown => {
        return value;
      }),
      CONTOSO,
      FABRIKAM,
      "contoso.onmicrosoft.com",
    ];
    const authorities: Set<string> = new Set<string>();

    for (const projectTenantId of inputs) {
      for (const appTenantId of inputs) {
        const authority: MicrosoftTeamsSignInAuthority =
          MicrosoftTeamsSignInAuthorityUtil.choose({
            projectTenantId,
            appTenantId,
          });

        for (const url of [
          MicrosoftTeamsSignInAuthorityUtil.getAuthorizeUrl(authority.tenantId),
          MicrosoftTeamsSignInAuthorityUtil.getTokenUrl(authority.tenantId),
        ]) {
          expect(new globalThis.URL(url).origin).toBe(MICROSOFT_LOGIN_ORIGIN);
          authorities.add(new globalThis.URL(url).pathname.split("/")[1]!);
        }
      }
    }

    expect(Array.from(authorities).sort()).toEqual(
      [CONTOSO, FABRIKAM, "contoso.onmicrosoft.com", "organizations"].sort(),
    );
  });

  test("the authority a sign-in was pinned to is the one its code is exchanged at", () => {
    for (const tenantId of [CONTOSO, FABRIKAM, undefined]) {
      const authorize: globalThis.URL = new globalThis.URL(
        MicrosoftTeamsSignInAuthorityUtil.getAuthorizeUrl(tenantId),
      );
      const token: globalThis.URL = new globalThis.URL(
        MicrosoftTeamsSignInAuthorityUtil.getTokenUrl(tenantId),
      );

      expect(token.pathname.split("/")[1]).toBe(
        authorize.pathname.split("/")[1],
      );
      expect(MicrosoftTeamsSignInAuthorityUtil.getAuthority(tenantId)).toBe(
        authorize.pathname.split("/")[1],
      );
    }
  });

  test("an ID token's issuer is its tenant's v2.0 authority", () => {
    expect(MicrosoftTeamsSignInAuthorityUtil.getIssuer(FABRIKAM)).toBe(
      `https://login.microsoftonline.com/${FABRIKAM}/v2.0`,
    );
  });
});

describe("a sign-in for another tenant than the project's", () => {
  test.each([
    ["the project's own tenant", CONTOSO, CONTOSO, false],
    ["its tenant in another case", CONTOSO.toUpperCase(), CONTOSO, false],
    ["another tenant", FABRIKAM, CONTOSO, true],
    ["a sign-in pinned to no tenant", undefined, CONTOSO, false],
    ["a project with no tenant", CONTOSO, undefined, false],
    ["a project whose stored tenant is not one", CONTOSO, "junk", false],
    [
      "a sign-in pinned to a domain, which may be the same tenant",
      "contoso.onmicrosoft.com",
      CONTOSO,
      false,
    ],
  ])(
    "%s",
    (
      _label: string,
      signedInTo: string | undefined,
      projectTenantId: string | undefined,
      expected: boolean,
    ) => {
      expect(
        MicrosoftTeamsSignInAuthorityUtil.isOtherTenant({
          signedInTo,
          projectTenantId,
        }),
      ).toBe(expected);
    },
  );
});
