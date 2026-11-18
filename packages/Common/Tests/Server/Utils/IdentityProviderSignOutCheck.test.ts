import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import DataSourceHttpFetch from "../../../Server/Utils/DataSource/HttpFetch";
import IdentityProviderSignOutCheck, {
  DISCOVERY_READ_TIMEOUT_IN_MS,
  DISCOVERY_UNREADABLE_MESSAGE,
  NO_END_SESSION_ENDPOINT_MESSAGE,
} from "../../../Server/Utils/IdentityProviderSignOutCheck";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import GlobalSsoProviderChanges from "../../../Server/Utils/GlobalSsoProviderChanges";
import ProjectSsoProviderChanges from "../../../Server/Utils/ProjectSsoProviderChanges";
import GlobalOIDC from "../../../Models/DatabaseModels/GlobalOidc";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * A PROVIDER THAT CANNOT SIGN PEOPLE OUT SAYS SO WHERE THE SWITCH IS TURNED
 * ON, NOT AT SOMEONE'S SIGN-OUT (#9535).
 *
 * "Sign out of the identity provider too" sends the browser to the
 * provider's end_session_endpoint, which its discovery document names - or,
 * like Google's, does not. Turning the switch on reads the document first and
 * refuses, in words the provider form shows, a provider without one. A save
 * that leaves the switch as it was reads nothing. The discovery read is
 * stubbed (DataSourceHttpFetch, the egress-guarded fetch every request to a
 * configured address goes through); so is the database.
 * ---------------------------------------------------------------------------
 */

const DISCOVERY_URL: string =
  "https://idp.example.com/.well-known/openid-configuration";
const OTHER_DISCOVERY_URL: string =
  "https://other-idp.example.com/.well-known/openid-configuration";

const PROVIDER_ID: string = "9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c";

type DiscoveryDocuments = Record<string, unknown>;

let fetch: jest.SpiedFunction<typeof DataSourceHttpFetch.fetch>;

// Each discovery URL answers with its document; anything else is unreachable.
function serveDiscovery(documents: DiscoveryDocuments): void {
  fetch.mockImplementation(async (request: { url: string }) => {
    if (!(request.url in documents)) {
      throw new Error(`connect ECONNREFUSED ${request.url}`);
    }

    const document: unknown = documents[request.url];

    return {
      statusCode: 200,
      bodyText:
        typeof document === "string" ? document : JSON.stringify(document),
      headers: {},
    } as never;
  });
}

const SIGNS_OUT: DiscoveryDocuments = {
  [DISCOVERY_URL]: {
    issuer: "https://idp.example.com",
    end_session_endpoint: "https://idp.example.com/oauth2/v1/logout",
  },
};

// Google publishes no end_session_endpoint.
const DOES_NOT_SIGN_OUT: DiscoveryDocuments = {
  [DISCOVERY_URL]: { issuer: "https://accounts.google.com" },
};

function storedProvider(data: {
  signOutOfIdentityProvider: boolean;
  discoveryURL?: string;
}): GlobalOIDC {
  const provider: GlobalOIDC = new GlobalOIDC();
  provider._id = PROVIDER_ID;
  provider.discoveryURL = URL.fromString(data.discoveryURL || DISCOVERY_URL);
  provider.signOutOfIdentityProvider = data.signOutOfIdentityProvider;
  return provider;
}

function updateOf(data: Record<string, unknown>): UpdateBy<GlobalOIDC> {
  return {
    query: { _id: PROVIDER_ID } as unknown as UpdateBy<GlobalOIDC>["query"],
    data: data as unknown as UpdateBy<GlobalOIDC>["data"],
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };
}

beforeEach(() => {
  fetch = jest.spyOn(DataSourceHttpFetch, "fetch");
  serveDiscovery(SIGNS_OUT);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IdentityProviderSignOutCheck.readEndSessionEndpoint", () => {
  test("reads the end_session_endpoint the discovery document names, through the egress-guarded fetch", async () => {
    await expect(
      IdentityProviderSignOutCheck.readEndSessionEndpoint(DISCOVERY_URL),
    ).resolves.toBe("https://idp.example.com/oauth2/v1/logout");

    expect(fetch).toHaveBeenCalledWith({
      method: "GET",
      url: DISCOVERY_URL,
      headers: { Accept: "application/json" },
      timeoutInMs: DISCOVERY_READ_TIMEOUT_IN_MS,
    });
  });

  test("is null for a document that names none", async () => {
    serveDiscovery(DOES_NOT_SIGN_OUT);

    await expect(
      IdentityProviderSignOutCheck.readEndSessionEndpoint(DISCOVERY_URL),
    ).resolves.toBeNull();
  });

  // Nobody is ever sent to an address of another scheme.
  test("is null for one that names an address nobody may be sent to", async () => {
    serveDiscovery({
      [DISCOVERY_URL]: { end_session_endpoint: "javascript:alert(1)" },
    });

    await expect(
      IdentityProviderSignOutCheck.readEndSessionEndpoint(DISCOVERY_URL),
    ).resolves.toBeNull();
  });

  test("throws for a document that is not a JSON object", async () => {
    serveDiscovery({ [DISCOVERY_URL]: "<html>Sign in</html>" });

    await expect(
      IdentityProviderSignOutCheck.readEndSessionEndpoint(DISCOVERY_URL),
    ).rejects.toThrow();
  });
});

describe("IdentityProviderSignOutCheck.assertProviderSignsOut", () => {
  test("lets a provider that signs people out through", async () => {
    await expect(
      IdentityProviderSignOutCheck.assertProviderSignsOut(DISCOVERY_URL),
    ).resolves.toBeUndefined();
  });

  test("reads a URL column's value as its address", async () => {
    await expect(
      IdentityProviderSignOutCheck.assertProviderSignsOut(
        URL.fromString(DISCOVERY_URL),
      ),
    ).resolves.toBeUndefined();
  });

  test("refuses one whose discovery document names no end_session_endpoint, saying what to do", async () => {
    serveDiscovery(DOES_NOT_SIGN_OUT);

    const refusal: Promise<void> =
      IdentityProviderSignOutCheck.assertProviderSignsOut(DISCOVERY_URL);

    await expect(refusal).rejects.toBeInstanceOf(BadDataException);
    await expect(refusal).rejects.toThrow(NO_END_SESSION_ENDPOINT_MESSAGE);
  });

  test("refuses one whose discovery document cannot be read", async () => {
    serveDiscovery({});

    await expect(
      IdentityProviderSignOutCheck.assertProviderSignsOut(DISCOVERY_URL),
    ).rejects.toThrow(DISCOVERY_UNREADABLE_MESSAGE);
  });

  test("refuses a provider with no discovery URL, reading nothing", async () => {
    await expect(
      IdentityProviderSignOutCheck.assertProviderSignsOut(undefined),
    ).rejects.toThrow(DISCOVERY_UNREADABLE_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();
  });

  // The words a person reads in the provider form.
  test("says why, and what to do next, in sentences", () => {
    for (const message of [
      NO_END_SESSION_ENDPOINT_MESSAGE,
      DISCOVERY_UNREADABLE_MESSAGE,
    ]) {
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).toContain("Sign out of the identity provider too");
    }
  });
});

describe("IdentityProviderSignOutCheck.beforeCreate", () => {
  test("asks the discovery document of a provider created with the switch on", async () => {
    serveDiscovery(DOES_NOT_SIGN_OUT);

    await expect(
      IdentityProviderSignOutCheck.beforeCreate({
        discoveryURL: DISCOVERY_URL,
        signOutOfIdentityProvider: true,
      }),
    ).rejects.toThrow(NO_END_SESSION_ENDPOINT_MESSAGE);
  });

  test.each([
    ["off", false],
    ["left out", undefined],
  ])(
    "reads nothing for a provider created with the switch %s",
    async (_: string, value: unknown) => {
      await IdentityProviderSignOutCheck.beforeCreate({
        discoveryURL: DISCOVERY_URL,
        signOutOfIdentityProvider: value,
      });

      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("IdentityProviderSignOutCheck.beforeUpdate", () => {
  let findBy: jest.SpiedFunction<typeof GlobalOidcService.findBy>;

  function providerIs(provider: GlobalOIDC): void {
    findBy.mockResolvedValue([provider] as never);
  }

  beforeEach(() => {
    findBy = jest.spyOn(GlobalOidcService, "findBy");
    providerIs(storedProvider({ signOutOfIdentityProvider: false }));
  });

  test("turning the switch on asks the provider's discovery document, read as it is stored", async () => {
    serveDiscovery(DOES_NOT_SIGN_OUT);

    await expect(
      IdentityProviderSignOutCheck.beforeUpdate({
        service: GlobalOidcService,
        updateBy: updateOf({ signOutOfIdentityProvider: true }),
      }),
    ).rejects.toThrow(NO_END_SESSION_ENDPOINT_MESSAGE);

    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: PROVIDER_ID },
        select: {
          _id: true,
          discoveryURL: true,
          signOutOfIdentityProvider: true,
        },
        props: { isRoot: true },
      }),
    );
  });

  test("turning it on for a provider that signs people out saves", async () => {
    await expect(
      IdentityProviderSignOutCheck.beforeUpdate({
        service: GlobalOidcService,
        updateBy: updateOf({ signOutOfIdentityProvider: true }),
      }),
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("turning it on with a new discovery URL asks the new one", async () => {
    serveDiscovery({
      ...DOES_NOT_SIGN_OUT,
      [OTHER_DISCOVERY_URL]: {
        end_session_endpoint: "https://other-idp.example.com/logout",
      },
    });

    await IdentityProviderSignOutCheck.beforeUpdate({
      service: GlobalOidcService,
      updateBy: updateOf({
        signOutOfIdentityProvider: true,
        discoveryURL: OTHER_DISCOVERY_URL,
      }),
    });

    expect(fetch.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as { url: string }).url;
    })).toEqual([OTHER_DISCOVERY_URL]);
  });

  /*
   * An edit form sends every field it shows: saving a renamed provider whose
   * switch is on already reads nothing, so a provider whose identity
   * provider is down for a moment can still be edited.
   */
  test("a save that sends the switch back on, with the same discovery URL, reads nothing", async () => {
    providerIs(storedProvider({ signOutOfIdentityProvider: true }));
    serveDiscovery({});

    await expect(
      IdentityProviderSignOutCheck.beforeUpdate({
        service: GlobalOidcService,
        updateBy: updateOf({
          name: "Okta (renamed)",
          signOutOfIdentityProvider: true,
          discoveryURL: DISCOVERY_URL,
        }),
      }),
    ).resolves.toBeUndefined();

    expect(fetch).not.toHaveBeenCalled();
  });

  test("moving a provider that has it on to another discovery URL asks the new one", async () => {
    providerIs(storedProvider({ signOutOfIdentityProvider: true }));
    serveDiscovery({ [OTHER_DISCOVERY_URL]: { issuer: "x" } });

    await expect(
      IdentityProviderSignOutCheck.beforeUpdate({
        service: GlobalOidcService,
        updateBy: updateOf({ discoveryURL: OTHER_DISCOVERY_URL }),
      }),
    ).rejects.toThrow(NO_END_SESSION_ENDPOINT_MESSAGE);
  });

  test("moving a provider that has it off to another discovery URL reads nothing", async () => {
    await IdentityProviderSignOutCheck.beforeUpdate({
      service: GlobalOidcService,
      updateBy: updateOf({ discoveryURL: OTHER_DISCOVERY_URL }),
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    ["turns the switch off", { signOutOfIdentityProvider: false }],
    [
      "turns it off and moves the discovery URL",
      { signOutOfIdentityProvider: false, discoveryURL: OTHER_DISCOVERY_URL },
    ],
    ["changes something else", { name: "Okta" }],
  ])("a save that %s reads nothing", async (_: string, data: object) => {
    providerIs(storedProvider({ signOutOfIdentityProvider: true }));

    await IdentityProviderSignOutCheck.beforeUpdate({
      service: GlobalOidcService,
      updateBy: updateOf(data as Record<string, unknown>),
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

/*
 * Both services ask before anything is written, and before the locks their
 * other checks take: a refused switch leaves the provider as it was.
 */
describe("the provider services ask before a create or an update is written", () => {
  interface PermittedHooks<TModel> {
    onCreatePermitted: (onCreate: OnCreate<TModel>) => Promise<void>;
    onUpdatePermitted: (updateBy: UpdateBy<TModel>) => Promise<void>;
  }

  test("Global OIDC: a create with the switch on is refused for a provider that cannot sign people out", async () => {
    serveDiscovery(DOES_NOT_SIGN_OUT);

    const created: GlobalOIDC = new GlobalOIDC();
    created.discoveryURL = URL.fromString(DISCOVERY_URL);
    created.signOutOfIdentityProvider = true;

    await expect(
      (
        GlobalOidcService as unknown as PermittedHooks<GlobalOIDC>
      ).onCreatePermitted({
        createBy: { data: created, props: { isRoot: true } },
        carryForward: null,
      }),
    ).rejects.toThrow(NO_END_SESSION_ENDPOINT_MESSAGE);
  });

  test("Global OIDC: an update that turns it on is refused before the server's sign-in rules are locked", async () => {
    serveDiscovery(DOES_NOT_SIGN_OUT);
    jest
      .spyOn(GlobalOidcService, "findBy")
      .mockResolvedValue([
        storedProvider({ signOutOfIdentityProvider: false }),
      ] as never);
    const lockTaken: jest.SpiedFunction<
      typeof GlobalSsoProviderChanges.beforeProviderUpdate
    > = jest
      .spyOn(GlobalSsoProviderChanges, "beforeProviderUpdate")
      .mockResolvedValue(undefined as never);

    await expect(
      (
        GlobalOidcService as unknown as PermittedHooks<GlobalOIDC>
      ).onUpdatePermitted(updateOf({ signOutOfIdentityProvider: true })),
    ).rejects.toThrow(NO_END_SESSION_ENDPOINT_MESSAGE);

    expect(lockTaken).not.toHaveBeenCalled();
  });

  test("Project OIDC: a create with the switch on is refused for a provider that cannot sign people out", async () => {
    serveDiscovery(DOES_NOT_SIGN_OUT);

    const created: ProjectOIDC = new ProjectOIDC();
    created.projectId = ObjectID.generate();
    created.discoveryURL = URL.fromString(DISCOVERY_URL);
    created.signOutOfIdentityProvider = true;

    await expect(
      (
        ProjectOidcService as unknown as PermittedHooks<ProjectOIDC>
      ).onCreatePermitted({
        createBy: { data: created, props: { isRoot: true } },
        carryForward: null,
      }),
    ).rejects.toThrow(NO_END_SESSION_ENDPOINT_MESSAGE);
  });

  test("Project OIDC: an update that turns it on is refused before the provider's write is held", async () => {
    serveDiscovery(DOES_NOT_SIGN_OUT);
    jest
      .spyOn(ProjectOidcService, "findBy")
      .mockResolvedValue([
        storedProvider({ signOutOfIdentityProvider: false }),
      ] as never);
    const writeHeld: jest.SpiedFunction<
      typeof ProjectSsoProviderChanges.beforeWrite
    > = jest
      .spyOn(ProjectSsoProviderChanges, "beforeWrite")
      .mockResolvedValue(undefined as never);

    await expect(
      (
        ProjectOidcService as unknown as PermittedHooks<ProjectOIDC>
      ).onUpdatePermitted(
        updateOf({
          signOutOfIdentityProvider: true,
        }) as unknown as UpdateBy<ProjectOIDC>,
      ),
    ).rejects.toThrow(NO_END_SESSION_ENDPOINT_MESSAGE);

    expect(writeHeld).not.toHaveBeenCalled();
  });

  test("a provider that signs people out saves, its other checks running as before", async () => {
    jest
      .spyOn(ProjectOidcService, "findBy")
      .mockResolvedValue([
        storedProvider({ signOutOfIdentityProvider: false }),
      ] as never);
    const writeHeld: jest.SpiedFunction<
      typeof ProjectSsoProviderChanges.beforeWrite
    > = jest
      .spyOn(ProjectSsoProviderChanges, "beforeWrite")
      .mockResolvedValue(undefined as never);

    await (
      ProjectOidcService as unknown as PermittedHooks<ProjectOIDC>
    ).onUpdatePermitted(
      updateOf({
        signOutOfIdentityProvider: true,
      }) as unknown as UpdateBy<ProjectOIDC>,
    );

    expect(writeHeld).toHaveBeenCalledTimes(1);
  });
});
