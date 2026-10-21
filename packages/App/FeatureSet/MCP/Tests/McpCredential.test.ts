/**
 * MCP credential tests.
 *
 * What an MCP request arrived with, and what that turns into when a tool has
 * to call the OneUptime API. The property that matters most is the last one:
 * an API key is forwarded as it came, but an OAuth sign-in is NEVER forwarded
 * - the API is shown a short-lived delegation token naming the member, the
 * project, the grant and whether the grant may write, and nothing else.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import McpCredentialUtil, {
  McpCredential,
  McpCredentialType,
} from "../Types/McpCredential";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpDelegationToken, {
  McpDelegationClaims,
} from "Common/Server/Utils/Mcp/McpDelegationToken";
import { McpOAuthPrincipal } from "Common/Server/Utils/Mcp/McpOAuthGrantAccess";
import Headers from "Common/Types/API/Headers";
import Email from "Common/Types/Email";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";

const API_KEY: string = "8b2f6d1e-5c1a-4f0b-9f3e-2d7a6c4b1e90";

const USER_ID: string = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID: string = "44444444-4444-4444-8444-444444444444";
const GRANT_ID: string = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID: string = "https://client.example/oauth/metadata.json";

const DELEGATION_HEADER: string = "x-oneuptime-mcp-delegation";
const NOW: Date = new Date("2026-10-01T12:00:00.000Z");

const READ_AND_WRITE: Array<McpOAuthScope> = [
  McpOAuthScope.Read,
  McpOAuthScope.Write,
];

function principal(
  scopes: Array<McpOAuthScope>,
  overrides?: { isMasterAdmin?: boolean; userName?: string },
): McpOAuthPrincipal {
  const grant: McpOAuthGrant = new McpOAuthGrant();

  grant._id = GRANT_ID;
  grant.userId = new ObjectID(USER_ID);
  grant.projectId = new ObjectID(PROJECT_ID);
  grant.clientId = CLIENT_ID;
  grant.name = "Example Client";
  grant.scope = scopes.join(" ");

  return {
    grant,
    user: {
      id: new ObjectID(USER_ID),
      email: new Email("member@example.com"),
      name: overrides?.userName ?? "A Member",
      isMasterAdmin: overrides?.isMasterAdmin ?? false,
    },
    scopes,
  };
}

function delegationTokenOf(headers: Headers): string {
  const token: unknown = headers[DELEGATION_HEADER];

  if (typeof token !== "string") {
    throw new Error("Expected a delegation token header.");
  }

  return token;
}

// The claims as they are written into the token, before they are read back.
function rawClaimsOf(token: string): Record<string, unknown> {
  const payload: Record<string, unknown> = JSON.parse(
    Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
  );

  return payload["c"] as Record<string, unknown>;
}

describe("McpCredentialUtil", () => {
  it("names the three kinds of credential", () => {
    expect(McpCredentialType.None).toBe("none");
    expect(McpCredentialType.ApiKey).toBe("api-key");
    expect(McpCredentialType.OAuth).toBe("oauth");
  });

  describe("none / fromApiKey / fromPrincipal", () => {
    it("builds the absence of a credential", () => {
      expect(McpCredentialUtil.none()).toEqual({ type: "none" });
    });

    it("builds an API key credential", () => {
      expect(McpCredentialUtil.fromApiKey(API_KEY)).toEqual({
        type: "api-key",
        apiKey: API_KEY,
      });
    });

    it("reads an empty API key as no credential", () => {
      expect(McpCredentialUtil.fromApiKey("")).toEqual({ type: "none" });
    });

    it("keeps an API key exactly as it came", () => {
      expect(McpCredentialUtil.fromApiKey("  spaced key  ")).toEqual({
        type: "api-key",
        apiKey: "  spaced key  ",
      });
    });

    it("builds an OAuth credential around the principal it was given", () => {
      const signedIn: McpOAuthPrincipal = principal(READ_AND_WRITE);
      const credential: McpCredential =
        McpCredentialUtil.fromPrincipal(signedIn);

      expect(credential.type).toBe("oauth");
      expect((credential as { principal: McpOAuthPrincipal }).principal).toBe(
        signedIn,
      );
    });
  });

  describe("from", () => {
    it("reads undefined as no credential", () => {
      expect(McpCredentialUtil.from(undefined)).toEqual({ type: "none" });
    });

    it("reads null as no credential", () => {
      expect(McpCredentialUtil.from(null as unknown as undefined)).toEqual({
        type: "none",
      });
    });

    it("reads an empty string as no credential", () => {
      expect(McpCredentialUtil.from("")).toEqual({ type: "none" });
    });

    it("reads a bare string as an API key, as the tool layer always passed it", () => {
      expect(McpCredentialUtil.from(API_KEY)).toEqual({
        type: "api-key",
        apiKey: API_KEY,
      });
    });

    it("reads a string as an API key even when it looks like an OAuth token", () => {
      // Telling the two apart is the request gate's job, done before this.
      expect(McpCredentialUtil.from("oumcp_at_looks-like-a-token").type).toBe(
        "api-key",
      );
    });

    it("returns a credential object unchanged", () => {
      const apiKey: McpCredential = McpCredentialUtil.fromApiKey(API_KEY);
      const oauth: McpCredential = McpCredentialUtil.fromPrincipal(
        principal(READ_AND_WRITE),
      );
      const none: McpCredential = McpCredentialUtil.none();

      expect(McpCredentialUtil.from(apiKey)).toBe(apiKey);
      expect(McpCredentialUtil.from(oauth)).toBe(oauth);
      expect(McpCredentialUtil.from(none)).toBe(none);
    });
  });

  describe("isPresent", () => {
    it.each([
      ["undefined", undefined],
      ["an empty string", ""],
      ["the none credential", McpCredentialUtil.none()],
    ])(
      "is false for %s",
      (_name: string, input: McpCredential | string | undefined) => {
        expect(McpCredentialUtil.isPresent(input)).toBe(false);
      },
    );

    it("is true for an API key, as a string or as a credential", () => {
      expect(McpCredentialUtil.isPresent(API_KEY)).toBe(true);
      expect(
        McpCredentialUtil.isPresent(McpCredentialUtil.fromApiKey(API_KEY)),
      ).toBe(true);
    });

    it("is true for an OAuth sign-in, whatever its scopes", () => {
      expect(
        McpCredentialUtil.isPresent(
          McpCredentialUtil.fromPrincipal(principal([])),
        ),
      ).toBe(true);
      expect(
        McpCredentialUtil.isPresent(
          McpCredentialUtil.fromPrincipal(principal([McpOAuthScope.Read])),
        ),
      ).toBe(true);
    });
  });

  describe("isOAuth", () => {
    it("is true only for an OAuth sign-in", () => {
      expect(
        McpCredentialUtil.isOAuth(
          McpCredentialUtil.fromPrincipal(principal(READ_AND_WRITE)),
        ),
      ).toBe(true);
      expect(McpCredentialUtil.isOAuth(API_KEY)).toBe(false);
      expect(
        McpCredentialUtil.isOAuth(McpCredentialUtil.fromApiKey(API_KEY)),
      ).toBe(false);
      expect(McpCredentialUtil.isOAuth(McpCredentialUtil.none())).toBe(false);
      expect(McpCredentialUtil.isOAuth(undefined)).toBe(false);
      expect(McpCredentialUtil.isOAuth("")).toBe(false);
    });
  });

  describe("getScopes", () => {
    it("returns the scopes an OAuth sign-in carries", () => {
      expect(
        McpCredentialUtil.getScopes(
          McpCredentialUtil.fromPrincipal(principal(READ_AND_WRITE)),
        ),
      ).toEqual(["mcp:read", "mcp:write"]);
      expect(
        McpCredentialUtil.getScopes(
          McpCredentialUtil.fromPrincipal(principal([McpOAuthScope.Read])),
        ),
      ).toEqual(["mcp:read"]);
    });

    it("is empty for an API key, which is not scoped", () => {
      expect(McpCredentialUtil.getScopes(API_KEY)).toEqual([]);
      expect(
        McpCredentialUtil.getScopes(McpCredentialUtil.fromApiKey(API_KEY)),
      ).toEqual([]);
    });

    it("is empty for no credential", () => {
      expect(McpCredentialUtil.getScopes(undefined)).toEqual([]);
      expect(McpCredentialUtil.getScopes(McpCredentialUtil.none())).toEqual([]);
    });
  });

  describe("canWrite", () => {
    it("never says no to an API key: what a key may do is its permissions' business", () => {
      expect(McpCredentialUtil.canWrite(API_KEY)).toBe(true);
      expect(
        McpCredentialUtil.canWrite(McpCredentialUtil.fromApiKey(API_KEY)),
      ).toBe(true);
    });

    it("does not say no to an absent credential either: that is refused elsewhere, as missing", () => {
      expect(McpCredentialUtil.canWrite(undefined)).toBe(true);
      expect(McpCredentialUtil.canWrite("")).toBe(true);
      expect(McpCredentialUtil.canWrite(McpCredentialUtil.none())).toBe(true);
    });

    it.each([
      ["read and write", READ_AND_WRITE, true],
      ["write alone", [McpOAuthScope.Write], true],
      [
        "read, write and offline_access",
        [McpOAuthScope.Read, McpOAuthScope.Write, McpOAuthScope.OfflineAccess],
        true,
      ],
      ["read alone", [McpOAuthScope.Read], false],
      [
        "read and offline_access",
        [McpOAuthScope.Read, McpOAuthScope.OfflineAccess],
        false,
      ],
      ["offline_access alone", [McpOAuthScope.OfflineAccess], false],
      ["no scopes at all", [], false],
    ])(
      "follows the scope of an OAuth sign-in: %s",
      (_name: string, scopes: Array<McpOAuthScope>, expected: boolean) => {
        expect(
          McpCredentialUtil.canWrite(
            McpCredentialUtil.fromPrincipal(principal(scopes)),
          ),
        ).toBe(expected);
      },
    );
  });

  describe("getApiHeaders", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    describe("for an API key", () => {
      it("forwards the key as it came, in the APIKey header and nothing else", () => {
        expect(McpCredentialUtil.getApiHeaders(API_KEY)).toEqual({
          APIKey: API_KEY,
        });
        expect(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromApiKey(API_KEY),
          ),
        ).toEqual({ APIKey: API_KEY });
      });

      it("sends no delegation token", () => {
        expect(
          DELEGATION_HEADER in McpCredentialUtil.getApiHeaders(API_KEY),
        ).toBe(false);
      });
    });

    describe("for no credential", () => {
      it.each([
        ["undefined", undefined],
        ["an empty string", ""],
        ["the none credential", McpCredentialUtil.none()],
      ])(
        "sends no authentication header at all for %s",
        (_name: string, input: McpCredential | string | undefined) => {
          expect(McpCredentialUtil.getApiHeaders(input)).toEqual({});
        },
      );
    });

    describe("for an OAuth sign-in", () => {
      beforeEach(() => {
        /*
         * Only Date is faked: it is the one clock a token reads, and the
         * rest (`performance` above all) cannot be replaced on this runtime.
         */
        jest.useFakeTimers({
          doNotFake: [
            "nextTick",
            "performance",
            "hrtime",
            "queueMicrotask",
            "requestAnimationFrame",
            "cancelAnimationFrame",
            "requestIdleCallback",
            "cancelIdleCallback",
            "setImmediate",
            "clearImmediate",
            "setInterval",
            "clearInterval",
            "setTimeout",
            "clearTimeout",
          ],
          now: NOW,
        });
      });

      it("sends exactly one header: the delegation token", () => {
        const headers: Headers = McpCredentialUtil.getApiHeaders(
          McpCredentialUtil.fromPrincipal(principal(READ_AND_WRITE)),
        );

        expect(Object.keys(headers)).toEqual([DELEGATION_HEADER]);
        expect(McpDelegationToken.HEADER_NAME).toBe(DELEGATION_HEADER);
      });

      it("never sends an API key header, in any spelling", () => {
        const headers: Headers = McpCredentialUtil.getApiHeaders(
          McpCredentialUtil.fromPrincipal(principal(READ_AND_WRITE)),
        );

        const names: Array<string> = Object.keys(headers).map(
          (name: string): string => {
            return name.toLowerCase();
          },
        );

        expect(names).not.toContain("apikey");
        expect(names).not.toContain("x-api-key");
        expect(names).not.toContain("authorization");
      });

      it("sends a token the API will verify, naming the member, the project, the grant and the client", () => {
        const token: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(principal(READ_AND_WRITE)),
          ),
        );

        const claims: McpDelegationClaims | null =
          McpDelegationToken.verify(token);

        expect(claims).not.toBeNull();
        expect(claims!.userId.toString()).toBe(USER_ID);
        expect(claims!.userEmail.toString()).toBe("member@example.com");
        expect(claims!.userName).toBe("A Member");
        expect(claims!.projectId.toString()).toBe(PROJECT_ID);
        expect(claims!.grantId.toString()).toBe(GRANT_ID);
        expect(claims!.clientId).toBe(CLIENT_ID);
        expect(claims!.clientName).toBe("Example Client");
        expect(claims!.canWrite).toBe(true);
      });

      it.each([
        ["read and write", READ_AND_WRITE, true],
        ["write alone", [McpOAuthScope.Write], true],
        ["read alone", [McpOAuthScope.Read], false],
        [
          "read and offline_access",
          [McpOAuthScope.Read, McpOAuthScope.OfflineAccess],
          false,
        ],
        ["no scopes at all", [], false],
      ])(
        "tells the API whether the grant may write: %s",
        (_name: string, scopes: Array<McpOAuthScope>, expected: boolean) => {
          const token: string = delegationTokenOf(
            McpCredentialUtil.getApiHeaders(
              McpCredentialUtil.fromPrincipal(principal(scopes)),
            ),
          );

          expect(McpDelegationToken.verify(token)!.canWrite).toBe(expected);
          // Written as a boolean, so "missing" can never read as "may write".
          expect(rawClaimsOf(token)["w"]).toBe(expected);
        },
      );

      it("carries nothing but those claims: no permissions, and no master-admin authority", () => {
        const token: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(
              principal(READ_AND_WRITE, { isMasterAdmin: true }),
            ),
          ),
        );

        expect(Object.keys(rawClaimsOf(token)).sort()).toEqual([
          "ci",
          "cn",
          "e",
          "g",
          "n",
          "p",
          "u",
          "w",
        ]);
        expect(Object.keys(McpDelegationToken.verify(token)!).sort()).toEqual([
          "canWrite",
          "clientId",
          "clientName",
          "grantId",
          "projectId",
          "userEmail",
          "userId",
          "userName",
        ]);
      });

      it("is the same token for a master admin as for anybody else", () => {
        const ordinary: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(principal(READ_AND_WRITE)),
          ),
        );
        const masterAdmin: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(
              principal(READ_AND_WRITE, { isMasterAdmin: true }),
            ),
          ),
        );

        expect(masterAdmin).toBe(ordinary);
      });

      it("is not a JWT, so it can never be read as a dashboard session", () => {
        const token: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(principal(READ_AND_WRITE)),
          ),
        );

        expect(token.startsWith("v1.")).toBe(true);
        expect(token.startsWith("eyJ")).toBe(false);
        // A JWT's first segment is a JSON header; this one is a version tag.
        expect(token.split(".")[0]).toBe("v1");
      });

      it("is not the client's access token, which this layer never even holds", () => {
        const credential: McpCredential = McpCredentialUtil.fromPrincipal(
          principal(READ_AND_WRITE),
        );
        const token: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(credential),
        );

        expect(token).not.toContain("oumcp_at_");
        expect(JSON.stringify(credential)).not.toContain("oumcp_at_");
      });

      it("is good for one minute and no longer", () => {
        const token: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(principal(READ_AND_WRITE)),
          ),
        );

        expect(
          McpDelegationToken.verify(token, new Date(NOW.getTime() + 59_999)),
        ).not.toBeNull();
        expect(
          McpDelegationToken.verify(token, new Date(NOW.getTime() + 60_000)),
        ).toBeNull();
      });

      it("mints a fresh token for each call, so a long-running tool never presents a stale one", () => {
        const credential: McpCredential = McpCredentialUtil.fromPrincipal(
          principal(READ_AND_WRITE),
        );

        const first: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(credential),
        );

        // The tool has been running for two minutes.
        const later: Date = new Date(NOW.getTime() + 2 * 60 * 1000);

        jest.setSystemTime(later);

        const second: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(credential),
        );

        expect(second).not.toBe(first);
        expect(McpDelegationToken.verify(first, later)).toBeNull();
        expect(McpDelegationToken.verify(second, later)).not.toBeNull();
      });

      it("returns a new headers object for each call", () => {
        const credential: McpCredential = McpCredentialUtil.fromPrincipal(
          principal(READ_AND_WRITE),
        );
        const first: Headers = McpCredentialUtil.getApiHeaders(credential);

        first["APIKey"] = "smuggled";

        expect(McpCredentialUtil.getApiHeaders(credential)).not.toHaveProperty(
          "APIKey",
        );
      });

      it("signs for a member with no name on their account", () => {
        const token: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(
              principal(READ_AND_WRITE, { userName: "" }),
            ),
          ),
        );

        expect(McpDelegationToken.verify(token)!.userName).toBe("");
      });

      it("signs for a grant whose client has no name", () => {
        const signedIn: McpOAuthPrincipal = principal(READ_AND_WRITE);

        delete signedIn.grant.name;

        const token: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(signedIn),
          ),
        );

        expect(McpDelegationToken.verify(token)!.clientName).toBe("");
      });

      it("names the grant's project, never one the caller could choose", () => {
        const signedIn: McpOAuthPrincipal = principal(READ_AND_WRITE);
        const otherProject: string = "55555555-5555-4555-8555-555555555555";

        signedIn.grant.projectId = new ObjectID(otherProject);

        const token: string = delegationTokenOf(
          McpCredentialUtil.getApiHeaders(
            McpCredentialUtil.fromPrincipal(signedIn),
          ),
        );

        expect(McpDelegationToken.verify(token)!.projectId.toString()).toBe(
          otherProject,
        );
      });
    });
  });
});
