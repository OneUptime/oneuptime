import UserSessionService, {
  SessionIdentityProviderSignOut,
  SessionSignedInThroughSamlProvider,
} from "../../../Server/Services/UserSessionService";
import EncryptedColumnValue from "../../../Server/Utils/Database/EncryptedColumnValue";
import Encryption from "../../../Server/Utils/Encryption";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  IdentityProviderSignOutRecord,
  SamlIdentityProviderSignOutRecord,
} from "../../../Types/SSO/IdentityProviderSignOut";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * WHAT A SESSION KEEPS TO SIGN ITS PERSON OUT OF THEIR IDENTITY PROVIDER TOO
 * (#9535), AND WHO MAY SEE IT.
 *
 * A browser sign-in through an OpenID Connect provider whose "Sign out of
 * the identity provider too" switch is on keeps the provider, its
 * end_session_endpoint and the sign-in's ID token with the session
 * (UserSession.identityProviderSignOut). The ID token is the
 * id_token_hint of the logout request, and it stays on the server:
 *
 *   - encrypted at rest, and nobody reads or writes it through the API;
 *   - read by the sign-out, from the live session it is about to end;
 *   - cleared once the sign-out has used it.
 *
 * No database: create, findOneBy and the repository are stubbed.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a");
const SESSION_ID: ObjectID = new ObjectID(
  "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b",
);

const RECORD: IdentityProviderSignOutRecord = {
  providerType: SsoProviderType.ProjectOIDC,
  providerId: "7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c",
  endSessionEndpoint:
    "https://idp.example.com/realms/acme/protocol/openid-connect/logout",
  idToken: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln",
};

// What a SAML sign-in through a provider that signs people out keeps (#9603).
const SAML_RECORD: SamlIdentityProviderSignOutRecord = {
  providerType: SsoProviderType.GlobalSSO,
  providerId: "7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d",
  nameId: "night.shift@example.com",
  nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
  sessionIndex: "_be9967abd904ddcae3c0eb4189adbe3f71e327cf93",
};

beforeEach(() => {
  installFakeEnterpriseModule({ userSessionLengths: null });
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("the column", () => {
  const metadata: () => TableColumnMetadata = (): TableColumnMetadata => {
    return new UserSession().getTableColumnMetadata("identityProviderSignOut");
  };

  test("keeps the ID token, a SAML Name ID and session index encrypted at rest, and the rest as written", () => {
    expect(metadata().encrypted).toBe(true);
    expect(metadata().encryptedFields).toEqual([
      "idToken",
      "nameId",
      "sessionIndex",
    ]);
  });

  test("a SAML record is stored with its Name ID and session index as ciphertext, and read back whole (#9603)", async () => {
    const stored: JSONObject = (await EncryptedColumnValue.encrypt(
      metadata(),
      { ...SAML_RECORD },
    )) as JSONObject;

    expect(Encryption.looksEncrypted(stored["nameId"] as string)).toBe(true);
    expect(Encryption.looksEncrypted(stored["sessionIndex"] as string)).toBe(
      true,
    );
    expect(JSON.stringify(stored)).not.toContain(SAML_RECORD.nameId);
    expect(JSON.stringify(stored)).not.toContain(SAML_RECORD.sessionIndex);

    // Which provider, and how the Name ID reads, are no secret.
    expect(stored["providerType"]).toBe(SAML_RECORD.providerType);
    expect(stored["providerId"]).toBe(SAML_RECORD.providerId);
    expect(stored["nameIdFormat"]).toBe(SAML_RECORD.nameIdFormat);

    await expect(
      EncryptedColumnValue.decrypt(metadata(), stored),
    ).resolves.toEqual(SAML_RECORD);
  });

  test("an OIDC record is still stored with its ID token alone as ciphertext", async () => {
    const stored: JSONObject = (await EncryptedColumnValue.encrypt(
      metadata(),
      { ...RECORD },
    )) as JSONObject;

    expect(
      Encryption.looksEncrypted(stored["idToken"] as string),
    ).toBe(true);
    expect(stored["endSessionEndpoint"]).toBe(
      (RECORD as { endSessionEndpoint: string }).endSessionEndpoint,
    );
    expect(stored).not.toHaveProperty("nameId");
  });

  test("is read and written through the API by nobody, not even the session's own person", () => {
    const model: UserSession = new UserSession();

    expect(model.getColumnAccessControlFor("identityProviderSignOut")).toEqual({
      create: [],
      read: [],
      update: [],
    });
    expect(
      model
        .getColumnAccessControlFor("identityProviderSignOut")
        ?.read?.includes(Permission.CurrentUser),
    ).toBe(false);
  });

  test("is left out of the API's documentation", () => {
    expect(metadata().hideColumnInDocumentation).toBe(true);
  });
});

describe("a sign-in", () => {
  let create: jest.SpyInstance;

  beforeEach(() => {
    create = jest
      .spyOn(UserSessionService, "create")
      .mockImplementation((async (data: { data: UserSession }) => {
        data.data.id = SESSION_ID;
        return data.data;
      }) as never);
  });

  function written(): UserSession {
    return (create.mock.calls[0]![0] as unknown as { data: UserSession }).data;
  }

  test("through a provider that signs people out keeps what that takes with the session", async () => {
    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: false,
      identityProviderSignOut: RECORD,
    });

    expect(written().identityProviderSignOut).toEqual(RECORD);
  });

  test("keeps it only whole: nothing else rides along", async () => {
    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: false,
      identityProviderSignOut: {
        ...RECORD,
        accessToken: "never-kept",
      } as unknown as IdentityProviderSignOutRecord,
    });

    expect(written().identityProviderSignOut).toEqual(RECORD);
  });

  test("keeps nothing of a record that is not one", async () => {
    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: false,
      identityProviderSignOut: {
        ...RECORD,
        endSessionEndpoint: "javascript:alert(1)",
      },
    });

    expect(written().identityProviderSignOut).toBeUndefined();
  });

  test("through a SAML provider that signs people out keeps the Name ID and session index with the session", async () => {
    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: false,
      identityProviderSignOut: SAML_RECORD,
    });

    expect(written().identityProviderSignOut).toEqual(SAML_RECORD);
    expect(JSON.stringify(written().additionalInfo)).not.toContain(
      SAML_RECORD.sessionIndex,
    );
  });

  test("keeps nothing of a SAML record that names no one", async () => {
    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: false,
      identityProviderSignOut: { ...SAML_RECORD, nameId: "" },
    });

    expect(written().identityProviderSignOut).toBeUndefined();
  });

  test("anywhere else keeps nothing", async () => {
    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: true,
    });

    expect(written().identityProviderSignOut).toBeUndefined();
  });

  // The record is the session's own column, never its additionalInfo, which the person's sessions list once read.
  test("never puts the ID token in the session's additional info", async () => {
    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: false,
      identityProviderSignOut: RECORD,
    });

    expect(JSON.stringify(written().additionalInfo)).not.toContain(
      RECORD.idToken,
    );
  });
});

describe("a sign-out reads it from the live session it is about to end", () => {
  let findOneBy: jest.SpyInstance;

  beforeEach(() => {
    findOneBy = jest
      .spyOn(UserSessionService, "findOneBy")
      .mockImplementation((async () => {
        const session: UserSession = new UserSession();
        session.id = SESSION_ID;
        session.identityProviderSignOut = {
          ...RECORD,
        } as unknown as JSONObject;
        return session;
      }) as never);
  });

  test("by its refresh token, hashed as the session keeps it, among live sessions only", async () => {
    const found: SessionIdentityProviderSignOut | null =
      await UserSessionService.findIdentityProviderSignOut({
        refreshToken: "the-refresh-token",
      });

    expect(found).toEqual({ sessionId: SESSION_ID, record: RECORD });

    const query: Record<string, unknown> = (
      findOneBy.mock.calls[0]![0] as unknown as {
        query: Record<string, unknown>;
      }
    ).query;

    expect((query["refreshToken"] as HashedString).toString()).toBe(
      await HashedString.hashValue("the-refresh-token", EncryptionSecret),
    );
    expect(query["isRevoked"]).toBe(false);
  });

  test("by its id and its person's, among live sessions only", async () => {
    await UserSessionService.findIdentityProviderSignOut({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(findOneBy).toHaveBeenCalledWith({
      query: { _id: SESSION_ID, userId: USER_ID, isRevoked: false },
      select: { _id: true, identityProviderSignOut: true },
      props: { isRoot: true },
    });
  });

  test("is null for a session that kept nothing", async () => {
    findOneBy.mockImplementation((async () => {
      const session: UserSession = new UserSession();
      session.id = SESSION_ID;
      return session;
    }) as never);

    await expect(
      UserSessionService.findIdentityProviderSignOut({
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).resolves.toBeNull();
  });

  test("is null for no live session", async () => {
    findOneBy.mockResolvedValue(null as never);

    await expect(
      UserSessionService.findIdentityProviderSignOut({
        refreshToken: "a-refresh-token-of-an-ended-session",
      }),
    ).resolves.toBeNull();
  });
});

describe("once a sign-out has used it", () => {
  test("it is cleared from the session, by a write of that column alone", async () => {
    const update: jest.Mock = jest.fn(async () => {
      return { affected: 1 };
    });

    jest
      .spyOn(UserSessionService, "getRepository")
      .mockReturnValue({ update } as never);

    await UserSessionService.forgetIdentityProviderSignOut(SESSION_ID);

    expect(update).toHaveBeenCalledWith(
      { _id: SESSION_ID.toString() },
      { identityProviderSignOut: null },
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * AN IDENTITY PROVIDER'S OWN SIGN-OUT ENDS ONLY THE SESSIONS IT GAVE (#9603).
 *
 * A SAML identity provider's LogoutRequest names a person; of their live
 * sessions, only those a sign-in through that very provider gave - which
 * kept a record of it - are the provider's to end. A sign-in through
 * another provider, another kind of provider, or none, is never one.
 * ---------------------------------------------------------------------------
 */
describe("the live sessions a SAML provider gave a person", () => {
  function sessionKeeping(
    id: string,
    record: IdentityProviderSignOutRecord | null,
  ): UserSession {
    const session: UserSession = new UserSession();
    session.id = new ObjectID(id);
    session.identityProviderSignOut = record
      ? ({ ...record } as unknown as JSONObject)
      : undefined;
    return session;
  }

  test("are the person's live sessions that kept this provider's record, and no other", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(UserSessionService, "findBy")
      .mockResolvedValue([
        sessionKeeping("1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a", SAML_RECORD),
        sessionKeeping("2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a", {
          ...SAML_RECORD,
          providerId: "9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e",
        }),
        sessionKeeping("3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a", {
          ...SAML_RECORD,
          providerType: SsoProviderType.ProjectSSO,
        }),
        sessionKeeping("4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a", RECORD),
        sessionKeeping("5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a", null),
      ] as never);

    const found: Array<SessionSignedInThroughSamlProvider> =
      await UserSessionService.findLiveSessionsSignedInThroughSamlProvider({
        userId: USER_ID,
        providerType: SsoProviderType.GlobalSSO,
        // In another case, as an id may be written.
        providerId: new ObjectID(SAML_RECORD.providerId.toUpperCase()),
      });

    expect(found).toEqual([
      {
        sessionId: new ObjectID("1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a"),
        record: SAML_RECORD,
      },
    ]);

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as unknown as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      }
    ).query;

    expect(query["userId"]).toEqual(USER_ID);
    expect(query["isRevoked"]).toBe(false);
    expect(
      (findBy.mock.calls[0]![0] as unknown as { props: { isRoot: boolean } })
        .props.isRoot,
    ).toBe(true);
  });

  test("are none for a person with no live session", async () => {
    jest.spyOn(UserSessionService, "findBy").mockResolvedValue([] as never);

    await expect(
      UserSessionService.findLiveSessionsSignedInThroughSamlProvider({
        userId: USER_ID,
        providerType: SsoProviderType.GlobalSSO,
        providerId: new ObjectID(SAML_RECORD.providerId),
      }),
    ).resolves.toEqual([]);
  });
});
