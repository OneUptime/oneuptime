/**
 * Client ID Metadata Documents published by real MCP clients.
 *
 * Each `document` is the JSON served at its `clientId` URL, copied as fetched
 * on 2026-10-01 (ChatGPT's on 2026-11-17) - including the fields this server
 * does not use (`logo_uri`, `application_type`, `jwks_uri`) and the grant
 * types and authentication methods it does not offer (device code, JWT
 * bearer, `private_key_jwt`), because tolerating those is part of what is
 * being pinned.
 *
 * `requestedAtRuntime` are redirect URIs the client really sends when it
 * starts authorization; `neverRequested` are near misses that must not match.
 *
 * This is a fixture, not a test: the ClientMetadata, ClientIdMetadataDocument
 * and RedirectUri suites import it.
 */

export interface RealWorldClientFixture {
  name: string;
  clientId: string;
  document: Record<string, unknown>;

  // What ClientMetadata.parseMetadataDocument should make of the document.
  expected: {
    clientName: string;
    clientUri: string;
    redirectUris: Array<string>;
  };

  requestedAtRuntime: Array<string>;
  neverRequested: Array<string>;
}

export const VS_CODE: RealWorldClientFixture = {
  name: "VS Code",
  clientId: "https://vscode.dev/oauth/client-metadata.json",
  document: {
    client_name: "Visual Studio Code",
    logo_uri: "https://code.visualstudio.com/assets/branding/code-stable.png",
    grant_types: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:device_code",
    ],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
    client_id: "https://vscode.dev/oauth/client-metadata.json",
    client_uri: "https://vscode.dev/product",
    redirect_uris: ["http://127.0.0.1:33418/", "https://vscode.dev/redirect"],
  },
  expected: {
    clientName: "Visual Studio Code",
    clientUri: "https://vscode.dev/product",
    redirectUris: ["http://127.0.0.1:33418/", "https://vscode.dev/redirect"],
  },
  requestedAtRuntime: [
    // The registered port, another port the OS handed out, and the web redirect.
    "http://127.0.0.1:33418/",
    "http://127.0.0.1:51234/",
    "https://vscode.dev/redirect",
  ],
  neverRequested: [
    "http://localhost:33418/",
    "http://127.0.0.1:33418/other",
    "https://vscode.dev/redirect/",
    "https://vscode.dev:8443/redirect",
    "https://insiders.vscode.dev/redirect",
  ],
};

export const CLAUDE: RealWorldClientFixture = {
  name: "Claude (web and desktop)",
  clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  document: {
    client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    grant_types: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    ],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  expected: {
    clientName: "Claude",
    // Normalised: the URL parser writes the root path out.
    clientUri: "https://claude.ai/",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  },
  requestedAtRuntime: ["https://claude.ai/api/mcp/auth_callback"],
  neverRequested: [
    "https://claude.ai/api/mcp/other_callback",
    "https://claude.ai/api/mcp/auth_callback/",
    "https://claude.ai:8443/api/mcp/auth_callback",
    "http://claude.ai/api/mcp/auth_callback",
    "https://claude.ai.evil.example/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback?next=https://evil.example",
  ],
};

export const CLAUDE_CODE: RealWorldClientFixture = {
  name: "Claude Code",
  clientId: "https://claude.ai/oauth/claude-code-client-metadata",
  document: {
    client_id: "https://claude.ai/oauth/claude-code-client-metadata",
    client_name: "Claude Code",
    client_uri: "https://claude.ai",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  expected: {
    clientName: "Claude Code",
    clientUri: "https://claude.ai/",
    redirectUris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  },
  requestedAtRuntime: [
    /*
     * The registered URIs carry no port. Claude Code listens on whichever
     * port the operating system gives it, so it is the port-agnostic loopback
     * rule that makes it work at all.
     */
    "http://localhost:53124/callback",
    "http://127.0.0.1:53124/callback",
    "http://localhost:1/callback",
    "http://127.0.0.1:65535/callback",
  ],
  neverRequested: [
    "http://localhost:1234/other",
    "https://localhost:1234/callback",
    "http://[::1]:1234/callback",
    "http://localhost.evil.example:1234/callback",
    "http://localhost:1234/callback?next=1",
    "http://localhost:1234/callback/",
  ],
};

/*
 * ChatGPT, and OpenAI's plugin portal, which connects a plugin's server with
 * the same client. This is ChatGPT's stable document, the one it uses with a
 * server that sends `iss` in its authorization responses (RFC 9207), as this
 * one does.
 *
 * It names "private_key_jwt" as its token_endpoint_auth_method but lists
 * "none" among the methods it can use, and uses one the server offers.
 * Reading only the single field refused ChatGPT outright: the portal's
 * Connect landed on "client_metadata_invalid".
 */
export const CHATGPT: RealWorldClientFixture = {
  name: "ChatGPT",
  clientId: "https://chatgpt.com/oauth/client.json",
  document: {
    client_id: "https://chatgpt.com/oauth/client.json",
    client_uri: "https://chatgpt.com/",
    redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    grant_types: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    ],
    response_types: ["code"],
    client_name: "ChatGPT",
    logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: "https://chatgpt.com/oauth/jwks.json",
  },
  expected: {
    clientName: "ChatGPT",
    clientUri: "https://chatgpt.com/",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  },
  requestedAtRuntime: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  neverRequested: [
    "https://chatgpt.com/connector_platform_oauth_redirect/",
    "https://chatgpt.com/connector/oauth/abc123",
    "http://chatgpt.com/connector_platform_oauth_redirect",
    "https://chatgpt.com:8443/connector_platform_oauth_redirect",
    "https://chatgpt.com.evil.example/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector_platform_oauth_redirect?next=https://evil.example",
  ],
};

export const REAL_WORLD_CLIENTS: Array<RealWorldClientFixture> = [
  VS_CODE,
  CLAUDE,
  CLAUDE_CODE,
  CHATGPT,
];
