/**
 * Client resolution tests.
 *
 * A client id is either a UUID (a client that registered here) or an https
 * URL (a metadata document). These pin that the shape of the id alone picks
 * the lookup, that a value which is neither costs no lookup at all, and that
 * a registered row is read fail-closed.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import ClientIdMetadataDocument from "../../OAuth/ClientIdMetadataDocument";
import {
  McpOAuthClientKind,
  ResolvedMcpOAuthClient,
} from "../../OAuth/ClientMetadata";
import ClientResolver from "../../OAuth/ClientResolver";
import McpOAuthError, { McpOAuthErrorCode } from "../../OAuth/McpOAuthError";
import McpOAuthClient from "Common/Models/DatabaseModels/McpOAuthClient";
import McpOAuthClientService from "Common/Server/Services/McpOAuthClientService";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";

const REGISTERED_CLIENT_ID: string = "8b2f6d1e-5c1a-4f0b-9f3e-2d7a6c4b1e90";
const DOCUMENT_CLIENT_ID: string = "https://client.example/oauth/metadata.json";
const SECRET_HASH: string = "a".repeat(64);

function registeredRow(overrides?: Partial<McpOAuthClient>): McpOAuthClient {
  const row: McpOAuthClient = new McpOAuthClient();

  row._id = REGISTERED_CLIENT_ID;
  row.clientName = "Registered Client";
  row.redirectUris = ["http://127.0.0.1/callback"];
  row.tokenEndpointAuthMethod = McpOAuthClientAuthMethod.None;

  Object.assign(row, overrides || {});

  return row;
}

function documentClient(): ResolvedMcpOAuthClient {
  return {
    clientId: DOCUMENT_CLIENT_ID,
    kind: McpOAuthClientKind.MetadataDocument,
    clientName: "Document Client",
    redirectUris: ["https://client.example/callback"],
    tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
  };
}

describe("ClientResolver", () => {
  let findSpy: jest.SpyInstance;
  let touchSpy: jest.SpyInstance;
  let documentSpy: jest.SpyInstance;
  let documentsEnabledSpy: jest.SpyInstance;

  beforeEach(() => {
    findSpy = jest.spyOn(
      McpOAuthClientService,
      "findRegisteredClient",
    ) as unknown as jest.SpyInstance;
    findSpy.mockResolvedValue(null);

    touchSpy = jest.spyOn(
      McpOAuthClientService,
      "touchLastUsed",
    ) as unknown as jest.SpyInstance;
    touchSpy.mockResolvedValue(undefined);

    documentSpy = jest.spyOn(
      ClientIdMetadataDocument,
      "resolve",
    ) as unknown as jest.SpyInstance;
    documentSpy.mockResolvedValue(documentClient());

    documentsEnabledSpy = jest.spyOn(
      McpOAuthConfig,
      "isClientIdMetadataDocumentEnabled",
    ) as unknown as jest.SpyInstance;
    documentsEnabledSpy.mockReturnValue(true);
  });

  afterEach(() => {
    findSpy.mockRestore();
    touchSpy.mockRestore();
    documentSpy.mockRestore();
    documentsEnabledSpy.mockRestore();
  });

  describe("resolve: a UUID is a registered client", () => {
    it("looks the registration up and never fetches anything", async () => {
      findSpy.mockResolvedValue(registeredRow());

      const client: ResolvedMcpOAuthClient | null =
        await ClientResolver.resolve(REGISTERED_CLIENT_ID);

      expect(findSpy).toHaveBeenCalledTimes(1);
      expect(findSpy).toHaveBeenCalledWith(REGISTERED_CLIENT_ID);
      expect(documentSpy).not.toHaveBeenCalled();
      expect(client).toEqual({
        clientId: REGISTERED_CLIENT_ID,
        kind: McpOAuthClientKind.Registered,
        clientName: "Registered Client",
        redirectUris: ["http://127.0.0.1/callback"],
        tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
      });
    });

    it("is null for a UUID nobody registered, and still fetches nothing", async () => {
      expect(await ClientResolver.resolve(REGISTERED_CLIENT_ID)).toBeNull();
      expect(findSpy).toHaveBeenCalledTimes(1);
      expect(documentSpy).not.toHaveBeenCalled();
    });

    it("is null for a row that came back without an id", async () => {
      const row: McpOAuthClient = registeredRow();

      delete row._id;
      findSpy.mockResolvedValue(row);

      expect(await ClientResolver.resolve(REGISTERED_CLIENT_ID)).toBeNull();
    });

    it("carries everything a confidential client is authenticated with", async () => {
      const lastUsedAt: Date = new Date("2026-09-30T12:00:00.000Z");

      findSpy.mockResolvedValue(
        registeredRow({
          clientUri: "https://client.example/",
          redirectUris: [
            "https://client.example/callback",
            "http://localhost/callback",
          ],
          tokenEndpointAuthMethod: McpOAuthClientAuthMethod.ClientSecretPost,
          clientSecretHash: SECRET_HASH,
          lastUsedAt,
        }),
      );

      expect(await ClientResolver.resolve(REGISTERED_CLIENT_ID)).toEqual({
        clientId: REGISTERED_CLIENT_ID,
        kind: McpOAuthClientKind.Registered,
        clientName: "Registered Client",
        clientUri: "https://client.example/",
        redirectUris: [
          "https://client.example/callback",
          "http://localhost/callback",
        ],
        tokenEndpointAuthMethod: McpOAuthClientAuthMethod.ClientSecretPost,
        clientSecretHash: SECRET_HASH,
        lastUsedAt,
      });
    });

    it("leaves out what the row does not have", async () => {
      findSpy.mockResolvedValue(registeredRow());

      const client: ResolvedMcpOAuthClient | null =
        await ClientResolver.resolve(REGISTERED_CLIENT_ID);

      expect(client).not.toBeNull();
      expect("clientUri" in client!).toBe(false);
      expect("clientSecretHash" in client!).toBe(false);
      expect("lastUsedAt" in client!).toBe(false);
    });

    it("holds a row with a secret but no stored method to its secret", async () => {
      /*
       * Fail closed: a missing method must not read as "public", or a client
       * that was issued a secret could be impersonated without it.
       */
      const row: McpOAuthClient = registeredRow({
        clientSecretHash: SECRET_HASH,
      });

      delete row.tokenEndpointAuthMethod;
      findSpy.mockResolvedValue(row);

      const client: ResolvedMcpOAuthClient | null =
        await ClientResolver.resolve(REGISTERED_CLIENT_ID);

      expect(client!.tokenEndpointAuthMethod).toBe(
        McpOAuthClientAuthMethod.ClientSecretBasic,
      );
      expect(client!.tokenEndpointAuthMethod).not.toBe(
        McpOAuthClientAuthMethod.None,
      );
      expect(client!.clientSecretHash).toBe(SECRET_HASH);
    });

    it("reads a row with neither a method nor a secret as public", async () => {
      const row: McpOAuthClient = registeredRow();

      delete row.tokenEndpointAuthMethod;
      findSpy.mockResolvedValue(row);

      const client: ResolvedMcpOAuthClient | null =
        await ClientResolver.resolve(REGISTERED_CLIENT_ID);

      expect(client!.tokenEndpointAuthMethod).toBe(
        McpOAuthClientAuthMethod.None,
      );
    });

    it("keeps the stored method when there is one, secret or not", async () => {
      findSpy.mockResolvedValue(
        registeredRow({
          tokenEndpointAuthMethod: McpOAuthClientAuthMethod.ClientSecretPost,
          clientSecretHash: SECRET_HASH,
        }),
      );

      const client: ResolvedMcpOAuthClient | null =
        await ClientResolver.resolve(REGISTERED_CLIENT_ID);

      expect(client!.tokenEndpointAuthMethod).toBe(
        McpOAuthClientAuthMethod.ClientSecretPost,
      );
    });

    it("reads missing redirect URIs as none, so nothing can match", async () => {
      const row: McpOAuthClient = registeredRow();

      (row as unknown as { redirectUris: unknown }).redirectUris = {
        0: "https://evil.example/callback",
      };
      findSpy.mockResolvedValue(row);

      expect(
        (await ClientResolver.resolve(REGISTERED_CLIENT_ID))!.redirectUris,
      ).toEqual([]);

      delete row.redirectUris;

      expect(
        (await ClientResolver.resolve(REGISTERED_CLIENT_ID))!.redirectUris,
      ).toEqual([]);
    });

    it("reads a missing name as empty rather than inventing one", async () => {
      const row: McpOAuthClient = registeredRow();

      delete row.clientName;
      findSpy.mockResolvedValue(row);

      expect(
        (await ClientResolver.resolve(REGISTERED_CLIENT_ID))!.clientName,
      ).toBe("");
    });

    it("looks a UUID up as registered even when it is written in upper case", async () => {
      await ClientResolver.resolve(REGISTERED_CLIENT_ID.toUpperCase());

      expect(findSpy).toHaveBeenCalledTimes(1);
      expect(documentSpy).not.toHaveBeenCalled();
    });
  });

  describe("resolve: an https URL is a metadata document", () => {
    it("fetches the document and never touches the registrations", async () => {
      const client: ResolvedMcpOAuthClient | null =
        await ClientResolver.resolve(DOCUMENT_CLIENT_ID);

      expect(documentSpy).toHaveBeenCalledTimes(1);
      expect(documentSpy).toHaveBeenCalledWith(DOCUMENT_CLIENT_ID);
      expect(findSpy).not.toHaveBeenCalled();
      expect(client).toEqual(documentClient());
    });

    it("is null, with no fetch, when metadata documents are switched off", async () => {
      documentsEnabledSpy.mockReturnValue(false);

      expect(await ClientResolver.resolve(DOCUMENT_CLIENT_ID)).toBeNull();
      expect(documentSpy).not.toHaveBeenCalled();
      expect(findSpy).not.toHaveBeenCalled();
    });

    it("still resolves a registered client when metadata documents are switched off", async () => {
      documentsEnabledSpy.mockReturnValue(false);
      findSpy.mockResolvedValue(registeredRow());

      expect(
        (await ClientResolver.resolve(REGISTERED_CLIENT_ID))!.clientId,
      ).toBe(REGISTERED_CLIENT_ID);
    });

    it("lets a document that cannot be read surface as its own error", async () => {
      documentSpy.mockRejectedValue(
        new McpOAuthError(
          McpOAuthErrorCode.TemporarilyUnavailable,
          "The client metadata document could not be retrieved.",
        ),
      );

      await expect(
        ClientResolver.resolve(DOCUMENT_CLIENT_ID),
      ).rejects.toMatchObject({
        code: McpOAuthErrorCode.TemporarilyUnavailable,
      });
    });

    it("lets an invalid document surface as its own error", async () => {
      documentSpy.mockRejectedValue(
        new McpOAuthError(
          McpOAuthErrorCode.InvalidClientMetadata,
          "The client metadata document's client_id does not match the URL it was fetched from.",
        ),
      );

      await expect(
        ClientResolver.resolve(DOCUMENT_CLIENT_ID),
      ).rejects.toMatchObject({
        code: McpOAuthErrorCode.InvalidClientMetadata,
      });
    });
  });

  describe("resolve: anything else is nobody, and costs nothing", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an empty string", ""],
      ["a number", 42],
      ["a boolean", true],
      ["an array of ids", [REGISTERED_CLIENT_ID]],
      ["an object", { client_id: REGISTERED_CLIENT_ID }],
      ["a name", "claude-code"],
      ["a UUID with a suffix", `${REGISTERED_CLIENT_ID}-extra`],
      ["a UUID with surrounding spaces", ` ${REGISTERED_CLIENT_ID} `],
      ["a UUID without its dashes", REGISTERED_CLIENT_ID.replace(/-/g, "")],
      ["a plain http URL", "http://client.example/oauth/metadata.json"],
      ["an https origin with no path", "https://client.example/"],
      ["an https URL with a fragment", `${DOCUMENT_CLIENT_ID}#x`],
      ["an https URL with credentials", "https://u:p@client.example/meta"],
      ["an https URL with a dot segment", "https://client.example/a/../meta"],
      ["a private-use scheme", "cursor://client/metadata"],
      ["a javascript: URI", "javascript:alert(1)"],
    ])("is null for %s", async (_name: string, value: unknown) => {
      expect(await ClientResolver.resolve(value)).toBeNull();
      expect(findSpy).not.toHaveBeenCalled();
      expect(documentSpy).not.toHaveBeenCalled();
    });
  });

  describe("touch", () => {
    function registeredClient(
      overrides?: Partial<ResolvedMcpOAuthClient>,
    ): ResolvedMcpOAuthClient {
      return {
        clientId: REGISTERED_CLIENT_ID,
        kind: McpOAuthClientKind.Registered,
        clientName: "Registered Client",
        redirectUris: ["http://127.0.0.1/callback"],
        tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
        ...overrides,
      };
    }

    it("records use of a registered client, by id, without reading it again", async () => {
      await ClientResolver.touch(registeredClient());

      expect(touchSpy).toHaveBeenCalledTimes(1);
      expect(findSpy).not.toHaveBeenCalled();

      const row: McpOAuthClient = touchSpy.mock.calls[0]![0] as McpOAuthClient;

      expect(row).toBeInstanceOf(McpOAuthClient);
      expect(row.id!.toString()).toBe(REGISTERED_CLIENT_ID);
    });

    it("passes on when the client was last seen, which is what the write is throttled against", async () => {
      const lastUsedAt: Date = new Date("2026-09-30T12:00:00.000Z");

      await ClientResolver.touch(registeredClient({ lastUsedAt }));

      const row: McpOAuthClient = touchSpy.mock.calls[0]![0] as McpOAuthClient;

      expect(row.lastUsedAt).toBe(lastUsedAt);
    });

    it("passes no last-used time for a client that has none", async () => {
      await ClientResolver.touch(registeredClient());

      const row: McpOAuthClient = touchSpy.mock.calls[0]![0] as McpOAuthClient;

      expect(row.lastUsedAt).toBeUndefined();
    });

    it("does nothing for a metadata document client, which has no row", async () => {
      await ClientResolver.touch(documentClient());

      expect(touchSpy).not.toHaveBeenCalled();
    });

    it("lets a failed write reach the caller, who decides what it is worth", async () => {
      touchSpy.mockRejectedValue(new Error("database is down"));

      await expect(ClientResolver.touch(registeredClient())).rejects.toThrow(
        "database is down",
      );
    });
  });
});
