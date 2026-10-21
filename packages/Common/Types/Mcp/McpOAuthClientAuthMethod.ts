/*
 * How a registered MCP client proves itself at the token endpoint
 * (RFC 7591 `token_endpoint_auth_method`).
 *
 * Almost every MCP client is a public client: a desktop app, a CLI or a hosted
 * agent that cannot keep a secret per installation, so it authenticates with
 * PKCE alone (`none`). The two secret-based methods exist for the clients that
 * ask for them when they register; a client identified by a Client ID Metadata
 * Document is always public.
 */
enum McpOAuthClientAuthMethod {
  None = "none",
  ClientSecretPost = "client_secret_post",
  ClientSecretBasic = "client_secret_basic",
}

export default McpOAuthClientAuthMethod;
