/**
 * Discovery document tests.
 *
 * An MCP client is configured with the MCP URL and nothing else; everything
 * it then does is read out of these two documents. So they are pinned field
 * by field: a client switches on these exact strings, and a field that is
 * wrong here is a client that cannot sign anybody in.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import Metadata, {
  AUTHORIZATION_SERVER_WELL_KNOWN_SUFFIX,
  PROTECTED_RESOURCE_WELL_KNOWN_SUFFIX,
} from "../../OAuth/Metadata";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import { JSONObject } from "Common/Types/JSON";
import { McpOAuthScopeUtil } from "Common/Types/Mcp/McpOAuthScope";

describe("Metadata", () => {
  let documentsEnabledSpy: jest.SpyInstance;

  beforeEach(() => {
    documentsEnabledSpy = jest.spyOn(
      McpOAuthConfig,
      "isClientIdMetadataDocumentEnabled",
    ) as unknown as jest.SpyInstance;
    documentsEnabledSpy.mockReturnValue(true);
  });

  afterEach(() => {
    documentsEnabledSpy.mockRestore();
  });

  describe("protected resource metadata (RFC 9728)", () => {
    it("is exactly this document", () => {
      const origin: string = McpOAuthConfig.getOrigin();

      expect(Metadata.getProtectedResourceMetadata()).toEqual({
        resource: `${origin}/mcp`,
        authorization_servers: [`${origin}/mcp`],
        scopes_supported: ["mcp:read", "mcp:write"],
        bearer_methods_supported: ["header"],
        resource_name: "OneUptime MCP Server",
        resource_documentation: `${origin}/docs/ai/mcp-server`,
      });
    });

    it("names the MCP endpoint as the resource", () => {
      const metadata: JSONObject = Metadata.getProtectedResourceMetadata();

      expect(metadata["resource"]).toBe(McpOAuthConfig.getResource());
      expect(String(metadata["resource"]).endsWith("/mcp")).toBe(true);
      expect(McpOAuthConfig.isThisResource(metadata["resource"])).toBe(true);
    });

    it("names one authorization server: this one", () => {
      expect(
        Metadata.getProtectedResourceMetadata()["authorization_servers"],
      ).toEqual([McpOAuthConfig.getIssuer()]);
    });

    it("does not list offline_access as something the resource requires", () => {
      const scopes: Array<string> = Metadata.getProtectedResourceMetadata()[
        "scopes_supported"
      ] as Array<string>;

      expect(scopes).toEqual(["mcp:read", "mcp:write"]);
      expect(scopes).not.toContain("offline_access");
    });

    it("accepts tokens in the Authorization header and nowhere else", () => {
      expect(
        Metadata.getProtectedResourceMetadata()["bearer_methods_supported"],
      ).toEqual(["header"]);
    });

    it("is unaffected by the metadata document switch", () => {
      const enabled: JSONObject = Metadata.getProtectedResourceMetadata();

      documentsEnabledSpy.mockReturnValue(false);

      expect(Metadata.getProtectedResourceMetadata()).toEqual(enabled);
    });

    it("builds a fresh document each time", () => {
      const first: JSONObject = Metadata.getProtectedResourceMetadata();

      (first["authorization_servers"] as Array<string>).push(
        "https://evil.example/mcp",
      );
      first["resource"] = "https://evil.example/mcp";

      const second: JSONObject = Metadata.getProtectedResourceMetadata();

      expect(second["resource"]).toBe(McpOAuthConfig.getResource());
      expect(second["authorization_servers"]).toEqual([
        McpOAuthConfig.getIssuer(),
      ]);
    });
  });

  describe("authorization server metadata (RFC 8414)", () => {
    it("is exactly this document", () => {
      const origin: string = McpOAuthConfig.getOrigin();

      expect(Metadata.getAuthorizationServerMetadata()).toEqual({
        issuer: `${origin}/mcp`,
        authorization_endpoint: `${origin}/mcp/oauth/authorize`,
        token_endpoint: `${origin}/mcp/oauth/token`,
        registration_endpoint: `${origin}/mcp/oauth/register`,
        revocation_endpoint: `${origin}/mcp/oauth/revoke`,
        scopes_supported: ["mcp:read", "mcp:write", "offline_access"],
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: [
          "none",
          "client_secret_post",
          "client_secret_basic",
        ],
        revocation_endpoint_auth_methods_supported: [
          "none",
          "client_secret_post",
          "client_secret_basic",
        ],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        service_documentation: `${origin}/docs/ai/mcp-server`,
        client_id_metadata_document_supported: true,
      });
    });

    it("has an issuer that is the resource: one URL for both", () => {
      const authorizationServer: JSONObject =
        Metadata.getAuthorizationServerMetadata();
      const resource: JSONObject = Metadata.getProtectedResourceMetadata();

      expect(authorizationServer["issuer"]).toBe(resource["resource"]);
      expect(resource["authorization_servers"]).toEqual([
        authorizationServer["issuer"],
      ]);
    });

    it("has an issuer with no query, fragment or trailing slash", () => {
      const issuer: string = String(
        Metadata.getAuthorizationServerMetadata()["issuer"],
      );

      expect(issuer).not.toContain("?");
      expect(issuer).not.toContain("#");
      expect(issuer.endsWith("/")).toBe(false);
      expect(new URL(issuer).pathname).toBe("/mcp");
    });

    it("puts every endpoint under the issuer", () => {
      const metadata: JSONObject = Metadata.getAuthorizationServerMetadata();
      const issuer: string = String(metadata["issuer"]);

      for (const field of [
        "authorization_endpoint",
        "token_endpoint",
        "registration_endpoint",
        "revocation_endpoint",
      ]) {
        expect(String(metadata[field]).startsWith(`${issuer}/oauth/`)).toBe(
          true,
        );
      }
    });

    it("offers S256 and never plain", () => {
      const methods: Array<string> = Metadata.getAuthorizationServerMetadata()[
        "code_challenge_methods_supported"
      ] as Array<string>;

      expect(methods).toEqual(["S256"]);
      expect(methods).not.toContain("plain");
    });

    it("lists `none` first among the token endpoint authentication methods", () => {
      /*
       * Some clients (Claude among them) use a Client ID Metadata Document
       * only when they see `none` here, and public clients are the norm.
       */
      const methods: Array<string> = Metadata.getAuthorizationServerMetadata()[
        "token_endpoint_auth_methods_supported"
      ] as Array<string>;

      expect(methods[0]).toBe("none");
      expect(methods).toContain("client_secret_post");
      expect(methods).toContain("client_secret_basic");
      expect(methods).toHaveLength(3);
    });

    it("offers the authorization code flow, with refresh, and no other", () => {
      const metadata: JSONObject = Metadata.getAuthorizationServerMetadata();

      expect(metadata["response_types_supported"]).toEqual(["code"]);
      expect(metadata["grant_types_supported"]).toEqual([
        "authorization_code",
        "refresh_token",
      ]);
      expect(metadata["grant_types_supported"]).not.toContain("implicit");
      expect(metadata["grant_types_supported"]).not.toContain(
        "client_credentials",
      );
      expect(metadata["grant_types_supported"]).not.toContain("password");
    });

    it("says every authorization response names the issuer (RFC 9207)", () => {
      expect(
        Metadata.getAuthorizationServerMetadata()[
          "authorization_response_iss_parameter_supported"
        ],
      ).toBe(true);
    });

    it("offers offline_access here, where a client asks for it", () => {
      expect(
        Metadata.getAuthorizationServerMetadata()["scopes_supported"],
      ).toEqual(["mcp:read", "mcp:write", "offline_access"]);
    });

    it("advertises metadata documents when the instance can fetch them", () => {
      expect(
        Metadata.getAuthorizationServerMetadata()[
          "client_id_metadata_document_supported"
        ],
      ).toBe(true);
    });

    it("leaves the field out altogether when metadata documents are switched off", () => {
      documentsEnabledSpy.mockReturnValue(false);

      const metadata: JSONObject = Metadata.getAuthorizationServerMetadata();

      // Absent, not false: a client that sees it absent registers itself.
      expect("client_id_metadata_document_supported" in metadata).toBe(false);
      // Dynamic registration is still on offer.
      expect(metadata["registration_endpoint"]).toBe(
        McpOAuthConfig.getRegistrationEndpoint(),
      );
    });

    it("changes nothing else when metadata documents are switched off", () => {
      const enabled: JSONObject = Metadata.getAuthorizationServerMetadata();

      documentsEnabledSpy.mockReturnValue(false);

      const disabled: JSONObject = Metadata.getAuthorizationServerMetadata();

      delete enabled["client_id_metadata_document_supported"];

      expect(disabled).toEqual(enabled);
    });

    it("is plain JSON", () => {
      const metadata: JSONObject = Metadata.getAuthorizationServerMetadata();

      expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
    });
  });

  describe("where the documents are served", () => {
    it("exposes the two well-known suffixes", () => {
      expect(PROTECTED_RESOURCE_WELL_KNOWN_SUFFIX).toBe(
        "/.well-known/oauth-protected-resource",
      );
      expect(AUTHORIZATION_SERVER_WELL_KNOWN_SUFFIX).toBe(
        "/.well-known/oauth-authorization-server",
      );
    });

    it("serves the protected resource metadata at the three places a client looks", () => {
      expect(Metadata.getProtectedResourceMetadataPaths()).toEqual([
        "/mcp/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-protected-resource",
      ]);
    });

    it("serves the authorization server metadata at the three places a client looks", () => {
      expect(Metadata.getAuthorizationServerMetadataPaths()).toEqual([
        "/.well-known/oauth-authorization-server/mcp",
        "/mcp/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server",
      ]);
    });

    it("serves the URL a challenge points at", () => {
      const challengeUrl: URL = new URL(
        McpOAuthConfig.getProtectedResourceMetadataUrl(),
      );

      expect(Metadata.getProtectedResourceMetadataPaths()).toContain(
        challengeUrl.pathname,
      );
    });

    it("serves the path RFC 8414 derives from an issuer that has a path", () => {
      // "/.well-known/oauth-authorization-server" inserted before the path.
      const issuer: URL = new URL(McpOAuthConfig.getIssuer());

      expect(Metadata.getAuthorizationServerMetadataPaths()).toContain(
        `/.well-known/oauth-authorization-server${issuer.pathname}`,
      );
    });

    it("serves the path RFC 9728 derives from a resource that has a path", () => {
      const resource: URL = new URL(McpOAuthConfig.getResource());

      expect(Metadata.getProtectedResourceMetadataPaths()).toContain(
        `/.well-known/oauth-protected-resource${resource.pathname}`,
      );
    });
  });
});

describe("the scope list in an answer belongs to that answer", () => {
  /*
   * The documents are built on every request. If one handed out the shared
   * ACCESS_SCOPES array, anything that changed its copy - a serializer, a
   * caller appending a scope - would change every later answer and the
   * constant the authorization checks read.
   */
  it("changing one protected resource document does not change the next, or the constant", () => {
    const before: Array<string> = [...McpOAuthScopeUtil.ACCESS_SCOPES];

    const first: JSONObject = Metadata.getProtectedResourceMetadata();

    (first["scopes_supported"] as Array<string>).push("admin");
    (first["scopes_supported"] as Array<string>).shift();

    expect(Metadata.getProtectedResourceMetadata()["scopes_supported"]).toEqual(
      before,
    );
    expect(McpOAuthScopeUtil.ACCESS_SCOPES).toEqual(before);
    expect(first["scopes_supported"]).not.toBe(McpOAuthScopeUtil.ACCESS_SCOPES);
  });

  it("changing one authorization server document does not change the next", () => {
    const first: JSONObject = Metadata.getAuthorizationServerMetadata();
    const expected: Array<string> = [
      ...(first["scopes_supported"] as Array<string>),
    ];

    (first["scopes_supported"] as Array<string>).push("admin");
    (first["token_endpoint_auth_methods_supported"] as Array<string>).length =
      0;

    const second: JSONObject = Metadata.getAuthorizationServerMetadata();

    expect(second["scopes_supported"]).toEqual(expected);
    expect(
      (second["token_endpoint_auth_methods_supported"] as Array<string>)[0],
    ).toBe("none");
  });
});
