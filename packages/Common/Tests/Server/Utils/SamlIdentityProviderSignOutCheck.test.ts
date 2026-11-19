import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import IdentityProviderSignOutCheck, {
  NO_SINGLE_LOGOUT_URL_MESSAGE,
} from "../../../Server/Utils/IdentityProviderSignOutCheck";
import DatabaseService from "../../../Server/Services/DatabaseService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalSsoProviderChanges from "../../../Server/Utils/GlobalSsoProviderChanges";
import ProjectSsoProviderChanges from "../../../Server/Utils/ProjectSsoProviderChanges";
import GlobalSSO from "../../../Models/DatabaseModels/GlobalSso";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * A SAML PROVIDER SIGNS PEOPLE OUT OF ITSELF ONLY WITH A SIGN OUT URL
 * (#9603).
 *
 * OneUptime reads no SAML metadata, so where an identity provider signs
 * people out - its SingleLogoutService - is the provider's Sign Out URL,
 * which the admin enters. "Sign out of the identity provider too" without
 * one could only fail later, quietly, at someone's sign-out, so turning it
 * on without one is refused, and so is clearing the URL of a provider that
 * has it on - in words the provider form shows. Turning it off never is.
 * Nothing is fetched. The database is a stand-in.
 * ---------------------------------------------------------------------------
 */

const PROVIDER_ID: string = "8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d";
const SIGN_OUT_URL: string =
  "https://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/saml2";

function storedProvider(data: {
  signOutOfIdentityProvider: boolean;
  singleLogoutURL?: string | null;
}): GlobalSSO {
  const provider: GlobalSSO = new GlobalSSO();
  provider._id = PROVIDER_ID;
  provider.signOutOfIdentityProvider = data.signOutOfIdentityProvider;

  if (data.singleLogoutURL) {
    provider.singleLogoutURL = URL.fromString(data.singleLogoutURL);
  }

  return provider;
}

function updateOf(data: Record<string, unknown>): UpdateBy<GlobalSSO> {
  return {
    query: { _id: PROVIDER_ID } as unknown as UpdateBy<GlobalSSO>["query"],
    data: data as unknown as UpdateBy<GlobalSSO>["data"],
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IdentityProviderSignOutCheck.beforeSamlProviderCreate", () => {
  test("a provider created with the switch off needs no Sign Out URL", () => {
    expect(() => {
      IdentityProviderSignOutCheck.beforeSamlProviderCreate({
        signOutOfIdentityProvider: false,
      });
    }).not.toThrow();

    expect(() => {
      IdentityProviderSignOutCheck.beforeSamlProviderCreate({});
    }).not.toThrow();

    expect(() => {
      IdentityProviderSignOutCheck.beforeSamlProviderCreate(undefined);
    }).not.toThrow();
  });

  test("a provider created with the switch on and a Sign Out URL saves, as text or as a URL column holds it", () => {
    for (const singleLogoutURL of [
      SIGN_OUT_URL,
      URL.fromString(SIGN_OUT_URL),
      // An identity provider on the installation's own network.
      "http://keycloak.internal:8080/realms/acme/protocol/saml",
    ]) {
      expect(() => {
        IdentityProviderSignOutCheck.beforeSamlProviderCreate({
          signOutOfIdentityProvider: true,
          singleLogoutURL: singleLogoutURL,
        });
      }).not.toThrow();
    }
  });

  test.each([
    ["no Sign Out URL", undefined],
    ["an empty one", ""],
    ["one of spaces", "   "],
    ["a javascript: address", "javascript:alert(document.cookie)"],
    ["a relative path", "/saml/slo"],
    ["one with a user name and password", "https://user:secret@idp.example.com/slo"],
  ])(
    "a provider created with the switch on and %s is refused, saying what to do",
    (_: string, singleLogoutURL: string | undefined) => {
      expect(() => {
        IdentityProviderSignOutCheck.beforeSamlProviderCreate({
          signOutOfIdentityProvider: true,
          singleLogoutURL: singleLogoutURL,
        });
      }).toThrow(new BadDataException(NO_SINGLE_LOGOUT_URL_MESSAGE));
    },
  );

  test("says why, and what to do next, in sentences that name the form's fields", () => {
    expect(NO_SINGLE_LOGOUT_URL_MESSAGE).toMatch(/^[A-Z].*\.$/);
    expect(NO_SINGLE_LOGOUT_URL_MESSAGE).toContain("Sign Out URL");
    expect(NO_SINGLE_LOGOUT_URL_MESSAGE).toContain(
      "Sign Out of the Identity Provider Too",
    );
  });
});

describe("IdentityProviderSignOutCheck.beforeSamlProviderUpdate", () => {
  /*
   * The providers the update reaches, read with the update held to them
   * (DatabaseService.findRowsAndHoldUpdateToThem).
   */
  function stored(
    ...providers: Array<GlobalSSO>
  ): { service: DatabaseService<GlobalSSO>; read: jest.Mock } {
    const read: jest.Mock = jest.fn(async () => {
      return providers;
    });

    return {
      service: {
        findRowsAndHoldUpdateToThem: read,
      } as unknown as DatabaseService<GlobalSSO>,
      read,
    };
  }

  async function update(
    data: Record<string, unknown>,
    ...providers: Array<GlobalSSO>
  ): Promise<jest.Mock> {
    const { service, read } = stored(...providers);

    await IdentityProviderSignOutCheck.beforeSamlProviderUpdate<GlobalSSO>({
      service,
      updateBy: updateOf(data),
    });

    return read;
  }

  test("a save that touches neither the switch nor the Sign Out URL reads nothing", async () => {
    const read: jest.Mock = await update(
      { name: "Okta" },
      storedProvider({ signOutOfIdentityProvider: true }),
    );

    expect(read).not.toHaveBeenCalled();
  });

  test("turning the switch off always saves, and reads nothing - whatever else it writes", async () => {
    const read: jest.Mock = await update(
      { signOutOfIdentityProvider: false, singleLogoutURL: null },
      storedProvider({ signOutOfIdentityProvider: true }),
    );

    expect(read).not.toHaveBeenCalled();
  });

  test("turning it on reads the providers it reaches, with the update held to them", async () => {
    const read: jest.Mock = await update(
      { signOutOfIdentityProvider: true },
      storedProvider({
        signOutOfIdentityProvider: false,
        singleLogoutURL: SIGN_OUT_URL,
      }),
    );

    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![1]).toEqual({
      _id: true,
      singleLogoutURL: true,
      signOutOfIdentityProvider: true,
    });
  });

  test("turning it on for a provider without a Sign Out URL is refused", async () => {
    await expect(
      update(
        { signOutOfIdentityProvider: true },
        storedProvider({ signOutOfIdentityProvider: false }),
      ),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);
  });

  test("turning it on with a Sign Out URL in the same save saves", async () => {
    await expect(
      update(
        { signOutOfIdentityProvider: true, singleLogoutURL: SIGN_OUT_URL },
        storedProvider({ signOutOfIdentityProvider: false }),
      ),
    ).resolves.toBeDefined();
  });

  test("turning it on while clearing the Sign Out URL is refused", async () => {
    await expect(
      update(
        { signOutOfIdentityProvider: true, singleLogoutURL: null },
        storedProvider({
          signOutOfIdentityProvider: false,
          singleLogoutURL: SIGN_OUT_URL,
        }),
      ),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);
  });

  test("an edit that sends everything back as it was saves", async () => {
    await expect(
      update(
        { signOutOfIdentityProvider: true, singleLogoutURL: SIGN_OUT_URL },
        storedProvider({
          signOutOfIdentityProvider: true,
          singleLogoutURL: SIGN_OUT_URL,
        }),
      ),
    ).resolves.toBeDefined();
  });

  test("clearing the Sign Out URL of a provider that has it on is refused", async () => {
    await expect(
      update(
        { singleLogoutURL: null },
        storedProvider({
          signOutOfIdentityProvider: true,
          singleLogoutURL: SIGN_OUT_URL,
        }),
      ),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);
  });

  test("changing it to an address no browser may be sent to, while on, is refused", async () => {
    await expect(
      update(
        { singleLogoutURL: "javascript:alert(1)" },
        storedProvider({
          signOutOfIdentityProvider: true,
          singleLogoutURL: SIGN_OUT_URL,
        }),
      ),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);
  });

  test("clearing it on a provider that has the switch off saves", async () => {
    await expect(
      update(
        { singleLogoutURL: null },
        storedProvider({
          signOutOfIdentityProvider: false,
          singleLogoutURL: SIGN_OUT_URL,
        }),
      ),
    ).resolves.toBeDefined();
  });

  test("an update that reaches several providers is refused for the one it would leave without a Sign Out URL", async () => {
    await expect(
      update(
        { signOutOfIdentityProvider: true },
        storedProvider({
          signOutOfIdentityProvider: false,
          singleLogoutURL: SIGN_OUT_URL,
        }),
        storedProvider({ signOutOfIdentityProvider: false }),
      ),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);
  });
});

/*
 * Both SAML provider services ask before anything is written, and before
 * the locks their other checks take: a refused switch leaves the provider
 * as it was.
 */
describe("the SAML provider services ask before a create or an update is written", () => {
  interface PermittedHooks<TModel extends DatabaseBaseModel> {
    onCreatePermitted: (onCreate: OnCreate<TModel>) => Promise<void>;
    onUpdatePermitted: (updateBy: UpdateBy<TModel>) => Promise<void>;
  }

  test("Global SSO: a create with the switch on and no Sign Out URL is refused", async () => {
    const created: GlobalSSO = new GlobalSSO();
    created.signOutOfIdentityProvider = true;

    await expect(
      (
        GlobalSsoService as unknown as PermittedHooks<GlobalSSO>
      ).onCreatePermitted({
        createBy: { data: created, props: { isRoot: true } },
        carryForward: null,
      }),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);
  });

  test("Global SSO: a create with the switch on and a Sign Out URL saves", async () => {
    const created: GlobalSSO = new GlobalSSO();
    created.signOutOfIdentityProvider = true;
    created.singleLogoutURL = URL.fromString(SIGN_OUT_URL);

    await expect(
      (
        GlobalSsoService as unknown as PermittedHooks<GlobalSSO>
      ).onCreatePermitted({
        createBy: { data: created, props: { isRoot: true } },
        carryForward: null,
      }),
    ).resolves.toBeUndefined();
  });

  test("Global SSO: an update that turns it on without a Sign Out URL is refused before the server's sign-in rules are locked", async () => {
    jest
      .spyOn(GlobalSsoService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([
        storedProvider({ signOutOfIdentityProvider: false }),
      ] as never);
    const lockTaken: jest.SpyInstance = jest
      .spyOn(GlobalSsoProviderChanges, "beforeProviderUpdate")
      .mockResolvedValue(undefined as never);

    await expect(
      (
        GlobalSsoService as unknown as PermittedHooks<GlobalSSO>
      ).onUpdatePermitted(updateOf({ signOutOfIdentityProvider: true })),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);

    expect(lockTaken).not.toHaveBeenCalled();
  });

  test("Project SSO: a create with the switch on and no Sign Out URL is refused", async () => {
    const created: ProjectSSO = new ProjectSSO();
    created.projectId = ObjectID.generate();
    created.signOutOfIdentityProvider = true;

    await expect(
      (
        ProjectSsoService as unknown as PermittedHooks<ProjectSSO>
      ).onCreatePermitted({
        createBy: { data: created, props: { isRoot: true } },
        carryForward: null,
      }),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);
  });

  test("Project SSO: an update that turns it on without a Sign Out URL is refused before the provider's write is held", async () => {
    jest
      .spyOn(ProjectSsoService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([
        storedProvider({ signOutOfIdentityProvider: false }),
      ] as never);
    const writeHeld: jest.SpyInstance = jest
      .spyOn(ProjectSsoProviderChanges, "beforeWrite")
      .mockResolvedValue(undefined as never);

    await expect(
      (
        ProjectSsoService as unknown as PermittedHooks<ProjectSSO>
      ).onUpdatePermitted(
        updateOf({
          signOutOfIdentityProvider: true,
        }) as unknown as UpdateBy<ProjectSSO>,
      ),
    ).rejects.toThrow(NO_SINGLE_LOGOUT_URL_MESSAGE);

    expect(writeHeld).not.toHaveBeenCalled();
  });

  test("Project SSO: one with a Sign Out URL saves, its other checks running as before", async () => {
    jest
      .spyOn(ProjectSsoService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([
        storedProvider({
          signOutOfIdentityProvider: false,
          singleLogoutURL: SIGN_OUT_URL,
        }),
      ] as never);
    const writeHeld: jest.SpyInstance = jest
      .spyOn(ProjectSsoProviderChanges, "beforeWrite")
      .mockResolvedValue(undefined as never);

    await (
      ProjectSsoService as unknown as PermittedHooks<ProjectSSO>
    ).onUpdatePermitted(
      updateOf({
        signOutOfIdentityProvider: true,
      }) as unknown as UpdateBy<ProjectSSO>,
    );

    expect(writeHeld).toHaveBeenCalledTimes(1);
  });
});
