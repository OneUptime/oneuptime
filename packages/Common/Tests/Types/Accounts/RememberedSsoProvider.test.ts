import RememberedSsoProviderUtil, {
  REMEMBERED_SSO_PROVIDER_KEY,
  RememberedSsoProvider,
} from "../../../Types/Accounts/RememberedSsoProvider";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PROJECT SSO PROVIDER THIS BROWSER LAST SIGNED IN WITH (#9986): what is
 * written to the browser, and what is read back from it.
 *
 * Only a project's own provider is kept, by its kind, its id and its
 * project's id - never an address, a name or anything the server said of an
 * account - and only a value of exactly that shape is ever read back.
 */

const PROVIDER: string = "33333333-3333-4333-8333-333333333333";
const PROJECT: string = "11111111-1111-4111-8111-111111111111";

describe("what is written", () => {
  test.each([SsoProviderType.ProjectSSO, SsoProviderType.ProjectOIDC])(
    "a project's %s provider: its kind and the two ids, and nothing else",
    (type: SsoProviderType) => {
      const value: string | null = RememberedSsoProviderUtil.toStoredValue({
        type: type,
        providerId: PROVIDER.toUpperCase(),
        projectId: PROJECT,
      });

      expect(JSON.parse(value!)).toEqual({
        v: 1,
        type: type,
        providerId: PROVIDER,
        projectId: PROJECT,
      });
    },
  );

  test.each([SsoProviderType.GlobalSSO, SsoProviderType.GlobalOIDC])(
    "an instance-wide %s provider is not remembered: the page lists those anyway",
    (type: SsoProviderType) => {
      expect(
        RememberedSsoProviderUtil.toStoredValue({
          type: type,
          providerId: PROVIDER,
          projectId: PROJECT,
        }),
      ).toBeNull();
    },
  );

  test.each([
    ["no project", { providerId: PROVIDER, projectId: undefined }],
    [
      "a project id that is not one",
      { providerId: PROVIDER, projectId: "acme" },
    ],
    [
      "a provider id that is not one",
      { providerId: "okta", projectId: PROJECT },
    ],
  ])(
    "%s: nothing is remembered",
    (
      _case: string,
      ids: { providerId: string; projectId: string | undefined },
    ) => {
      expect(
        RememberedSsoProviderUtil.toStoredValue({
          type: SsoProviderType.ProjectSSO,
          ...ids,
        }),
      ).toBeNull();
    },
  );

  test("the key names nobody: no user, project or id in it", () => {
    expect(REMEMBERED_SSO_PROVIDER_KEY).toBe("oneuptime-sign-in-sso-last-used");
    expect(REMEMBERED_SSO_PROVIDER_KEY).not.toMatch(
      /user[-_.]|token|email|session|project|password|[0-9a-f]{8}-/i,
    );
  });
});

describe("what is read back", () => {
  test("its own value, as it was written", () => {
    const read: RememberedSsoProvider | null =
      RememberedSsoProviderUtil.fromStoredValue(
        RememberedSsoProviderUtil.toStoredValue({
          type: SsoProviderType.ProjectOIDC,
          providerId: PROVIDER,
          projectId: PROJECT,
        }),
      );

    expect(read).toEqual({
      type: SsoProviderType.ProjectOIDC,
      providerId: PROVIDER,
      projectId: PROJECT,
    });
  });

  test.each([
    ["nothing", null],
    ["not text", 42],
    ["text that is not JSON", "okta"],
    ["a list", "[]"],
    ["an empty object", "{}"],
    [
      "another version",
      JSON.stringify({
        v: 2,
        type: SsoProviderType.ProjectSSO,
        providerId: PROVIDER,
        projectId: PROJECT,
      }),
    ],
    [
      "an instance-wide provider",
      JSON.stringify({
        v: 1,
        type: SsoProviderType.GlobalSSO,
        providerId: PROVIDER,
        projectId: PROJECT,
      }),
    ],
    [
      "a field more - an address",
      JSON.stringify({
        v: 1,
        type: SsoProviderType.ProjectSSO,
        providerId: PROVIDER,
        projectId: PROJECT,
        email: "grace@acme.com",
      }),
    ],
    [
      "a field less",
      JSON.stringify({
        v: 1,
        type: SsoProviderType.ProjectSSO,
        providerId: PROVIDER,
      }),
    ],
    [
      "ids that are not ids",
      JSON.stringify({
        v: 1,
        type: SsoProviderType.ProjectSSO,
        providerId: "../../admin",
        projectId: PROJECT,
      }),
    ],
    ["a value far too long", `{"v":1,"pad":"${"x".repeat(600)}"}`],
  ])("%s is no remembered provider", (_case: string, value: unknown) => {
    expect(RememberedSsoProviderUtil.fromStoredValue(value)).toBeNull();
  });
});
