/**
 * What OneUptimeApiService presents to the OneUptime API for each kind of
 * credential.
 *
 * An API key is an API credential and is forwarded as it came. An OAuth
 * access token is not: the MCP server is the only thing that accepts it, and
 * what the API is shown instead is a delegation token the MCP server mints
 * for that one call. These tests run the real API client against a small
 * local HTTP server and read the headers that actually went over the wire.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

jest.mock("../Utils/MCPLogger");

import OneUptimeApiService, {
  OneUptimeApiError,
} from "../Services/OneUptimeApiService";
import McpCredentialUtil, {
  McpCredential,
  McpCredentialInput,
} from "../Types/McpCredential";
import ModelType from "../Types/ModelType";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpDelegationToken, {
  McpDelegationClaims,
} from "Common/Server/Utils/Mcp/McpDelegationToken";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import Email from "Common/Types/Email";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";

interface ReceivedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

const API_KEY: string = "3b241101-e2bb-4255-8caf-4136c566a962";
const RECORD_ID: string = "550e8400-e29b-41d4-a716-446655440000";
const DELEGATION_HEADER: string = "x-oneuptime-mcp-delegation";

const USER_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const GRANT_ID: ObjectID = ObjectID.generate();
const CLIENT_ID: string = "https://client.example/oauth/client.json";

function oauthCredential(scopes: Array<McpOAuthScope>): McpCredential {
  const grant: McpOAuthGrant = new McpOAuthGrant();

  grant._id = GRANT_ID.toString();
  grant.projectId = PROJECT_ID;
  grant.userId = USER_ID;
  grant.clientId = CLIENT_ID;
  grant.name = "Claude";
  grant.scope = scopes.join(" ");

  return McpCredentialUtil.fromPrincipal({
    grant,
    user: {
      id: USER_ID,
      email: new Email("member@example.com"),
      name: "A Member",
      isMasterAdmin: true,
    },
    scopes,
  });
}

describe("OneUptimeApiService and the credential it is given", () => {
  let server: http.Server;
  let received: Array<ReceivedRequest>;
  // What the pretend API answers next: [status, body].
  let nextResponse: [number, unknown];

  beforeAll(async () => {
    server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse): void => {
        let raw: string = "";

        req.setEncoding("utf8");
        req.on("data", (chunk: string): void => {
          raw += chunk;
        });
        req.on("end", (): void => {
          received.push({
            method: req.method || "",
            path: req.url || "",
            headers: req.headers,
            body: raw ? JSON.parse(raw) : null,
          });

          res.statusCode = nextResponse[0];
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(nextResponse[1]));
        });
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", (): void => {
        resolve();
      });
    });

    OneUptimeApiService.initialize({
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
      server.closeAllConnections();
    });
  });

  beforeEach(() => {
    received = [];
    nextResponse = [200, { data: [], count: 0, skip: 0, limit: 10 }];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function list(credential: McpCredentialInput): Promise<unknown> {
    return OneUptimeApiService.executeOperation(
      "Incident",
      OneUptimeOperation.List,
      ModelType.Database,
      "/incident",
      {},
      credential,
    );
  }

  describe("an API key", () => {
    it.each<[string, McpCredentialInput]>([
      ["as a bare string", API_KEY],
      ["as an API key credential", McpCredentialUtil.fromApiKey(API_KEY)],
    ])(
      "%s is sent in the APIKey header, and nothing is delegated",
      async (_label: string, credential: McpCredentialInput) => {
        await list(credential);

        expect(received).toHaveLength(1);
        expect(received[0]!.method).toBe("POST");
        expect(received[0]!.path).toBe("/api/incident/get-list");
        expect(received[0]!.headers["apikey"]).toBe(API_KEY);
        expect(DELEGATION_HEADER in received[0]!.headers).toBe(false);
        expect("authorization" in received[0]!.headers).toBe(false);
      },
    );

    it("is sent the same way by the workflow tools' API calls, for every method", async () => {
      for (const method of ["POST", "PUT", "DELETE"] as const) {
        nextResponse = [200, { _id: RECORD_ID }];

        await OneUptimeApiService.makeAuthenticatedApiCall({
          method,
          path: "/api/incident-state-timeline",
          body: { data: { incidentId: RECORD_ID } },
          credential: API_KEY,
        });
      }

      expect(
        received.map((request: ReceivedRequest): string => {
          return request.method;
        }),
      ).toEqual(["POST", "PUT", "DELETE"]);

      for (const request of received) {
        expect(request.headers["apikey"]).toBe(API_KEY);
        expect(DELEGATION_HEADER in request.headers).toBe(false);
      }
    });
  });

  describe("an OAuth credential", () => {
    const READ_WRITE: McpCredential = oauthCredential([
      McpOAuthScope.Read,
      McpOAuthScope.Write,
    ]);
    const READ_ONLY: McpCredential = oauthCredential([McpOAuthScope.Read]);

    it("is presented as a delegation token - and ONLY that: no API key header, no Authorization header", async () => {
      await list(READ_WRITE);

      expect(received).toHaveLength(1);

      const headers: http.IncomingHttpHeaders = received[0]!.headers;

      expect(typeof headers[DELEGATION_HEADER]).toBe("string");
      expect("apikey" in headers).toBe(false);
      expect("authorization" in headers).toBe(false);
      expect("cookie" in headers).toBe(false);
    });

    it("names the member, the project, the grant and the client", async () => {
      await list(READ_WRITE);

      const claims: McpDelegationClaims | null = McpDelegationToken.verify(
        received[0]!.headers[DELEGATION_HEADER],
      );

      expect(claims).not.toBeNull();
      expect(claims!.userId.toString()).toBe(USER_ID.toString());
      expect(claims!.userEmail.toString()).toBe("member@example.com");
      expect(claims!.userName).toBe("A Member");
      expect(claims!.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(claims!.grantId.toString()).toBe(GRANT_ID.toString());
      expect(claims!.clientId).toBe(CLIENT_ID);
      expect(claims!.clientName).toBe("Claude");
    });

    it("says whether the grant may write, so the API can refuse a write the MCP server let through", async () => {
      await list(READ_WRITE);
      await list(READ_ONLY);

      expect(
        McpDelegationToken.verify(received[0]!.headers[DELEGATION_HEADER])!
          .canWrite,
      ).toBe(true);
      expect(
        McpDelegationToken.verify(received[1]!.headers[DELEGATION_HEADER])!
          .canWrite,
      ).toBe(false);
    });

    it("treats write-only as able to write, and offline_access alone as not", async () => {
      await list(oauthCredential([McpOAuthScope.Write]));
      await list(oauthCredential([McpOAuthScope.OfflineAccess]));

      expect(
        McpDelegationToken.verify(received[0]!.headers[DELEGATION_HEADER])!
          .canWrite,
      ).toBe(true);
      expect(
        McpDelegationToken.verify(received[1]!.headers[DELEGATION_HEADER])!
          .canWrite,
      ).toBe(false);
    });

    it("carries no master-admin authority, even for a member who is one", async () => {
      // The principal above has isMasterAdmin: true.
      await list(READ_WRITE);

      const token: string = received[0]!.headers[DELEGATION_HEADER] as string;
      const envelope: { c: Record<string, unknown> } = JSON.parse(
        Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
      );

      expect(Object.keys(envelope.c).sort()).toEqual(
        ["ci", "cn", "e", "g", "n", "p", "u", "w"].sort(),
      );
    });

    it("is minted afresh for every call, never cached on the credential", async () => {
      const sign: jest.SpyInstance = jest.spyOn(
        McpDelegationToken,
        "sign",
      ) as unknown as jest.SpyInstance;

      await list(READ_WRITE);
      await list(READ_WRITE);
      await OneUptimeApiService.makeAuthenticatedApiCall({
        method: "POST",
        path: "/api/project/get-list",
        credential: READ_WRITE,
      });

      expect(sign).toHaveBeenCalledTimes(3);
      expect(received).toHaveLength(3);
    });

    it("is what the workflow tools' API calls present too, for every method", async () => {
      for (const method of ["POST", "PUT", "DELETE"] as const) {
        nextResponse = [200, { _id: RECORD_ID }];

        await OneUptimeApiService.makeAuthenticatedApiCall({
          method,
          path: "/api/incident-state-timeline",
          body: { data: { incidentId: RECORD_ID } },
          credential: READ_WRITE,
        });
      }

      expect(received).toHaveLength(3);

      for (const request of received) {
        expect(
          McpDelegationToken.verify(request.headers[DELEGATION_HEADER]),
        ).not.toBeNull();
        expect("apikey" in request.headers).toBe(false);
      }
    });

    it("is used for every operation a generated tool performs", async () => {
      const operations: Array<[OneUptimeOperation, Record<string, unknown>]> = [
        [OneUptimeOperation.List, {}],
        [OneUptimeOperation.Count, {}],
        [OneUptimeOperation.Read, { id: RECORD_ID }],
        [OneUptimeOperation.Create, { title: "x" }],
        [OneUptimeOperation.Update, { id: RECORD_ID, title: "y" }],
        [OneUptimeOperation.Delete, { id: RECORD_ID }],
      ];

      for (const [operation, args] of operations) {
        nextResponse = [200, { _id: RECORD_ID }];

        await OneUptimeApiService.executeOperation(
          "Incident",
          operation,
          ModelType.Database,
          "/incident",
          args,
          READ_WRITE,
        );
      }

      expect(received).toHaveLength(operations.length);

      for (const request of received) {
        expect(
          McpDelegationToken.verify(request.headers[DELEGATION_HEADER]),
        ).not.toBeNull();
        expect("apikey" in request.headers).toBe(false);
      }
    });

    it("has no way to forward the client's access token: the credential does not hold one", async () => {
      const accessToken: string = McpOAuthSecret.mint(
        McpOAuthTokenType.AccessToken,
      );

      await list(READ_WRITE);

      // Nothing the service was given, and nothing it sent, contains a token.
      expect(JSON.stringify(READ_WRITE)).not.toContain("oumcp_at_");
      expect(JSON.stringify(received[0])).not.toContain("oumcp_at_");
      expect(accessToken.startsWith("oumcp_at_")).toBe(true);
    });

    it("surfaces the API's refusal with its status, so the agent is told why", async () => {
      nextResponse = [
        403,
        { message: "You do not have permissions to read Incident." },
      ];

      const failure: unknown = await list(READ_WRITE).catch(
        (err: unknown): unknown => {
          return err;
        },
      );

      expect(failure).toBeInstanceOf(OneUptimeApiError);
      expect((failure as OneUptimeApiError).statusCode).toBe(403);
      expect((failure as OneUptimeApiError).message).toContain(
        "You do not have permissions to read Incident.",
      );
    });
  });

  describe("no credential", () => {
    it.each<[string, McpCredentialInput]>([
      ["an empty string", ""],
      ["undefined", undefined],
      ["the 'none' credential", McpCredentialUtil.none()],
    ])(
      "(%s) is refused before any request is made",
      async (_label: string, credential: McpCredentialInput) => {
        await expect(list(credential)).rejects.toThrow(
          "API key is required. Please provide x-api-key header in your request.",
        );

        await expect(
          OneUptimeApiService.makeAuthenticatedApiCall({
            method: "POST",
            path: "/api/project/get-list",
            credential,
          }),
        ).rejects.toThrow(/API key is required/);

        expect(received).toEqual([]);
      },
    );
  });
});
