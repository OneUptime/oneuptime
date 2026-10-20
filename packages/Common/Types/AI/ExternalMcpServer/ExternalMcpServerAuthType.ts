/*
 * How OneUptime signs in to an external MCP server
 * (Models/DatabaseModels/ExternalMcpServer).
 *
 *   - None: the server needs no sign-in (it sits inside the network, or it
 *     signs requests some other way);
 *   - BearerToken: an API token, sent as `Authorization: Bearer <token>` -
 *     what most hosted MCP servers hand out (GitHub, Linear, Grafana, ...);
 *   - Headers: one or more headers of the server's own, such as
 *     `X-API-Key` or Datadog's `DD-API-KEY` and `DD-APPLICATION-KEY`;
 *   - OAuthClientCredentials: OAuth 2.0 client credentials. OneUptime asks
 *     the token URL for a token with a client ID and secret and sends it as
 *     a bearer token, getting a new one before it expires - Microsoft Entra
 *     ID in front of an Azure MCP server, Amazon Cognito in front of an AWS
 *     gateway, Okta, Auth0 or Keycloak.
 *
 * Every secret (the token, the header values, the client secret) is
 * written, never read back: nobody can read it through the API.
 *
 * Shared by the server and the Dashboard, so it imports nothing.
 */
enum ExternalMcpServerAuthType {
  None = "None",
  BearerToken = "BearerToken",
  Headers = "Headers",
  OAuthClientCredentials = "OAuthClientCredentials",
}

export default ExternalMcpServerAuthType;

export const EXTERNAL_MCP_SERVER_AUTH_TYPES: Array<ExternalMcpServerAuthType> =
  [
    ExternalMcpServerAuthType.None,
    ExternalMcpServerAuthType.BearerToken,
    ExternalMcpServerAuthType.Headers,
    ExternalMcpServerAuthType.OAuthClientCredentials,
  ];

// Whether a value is one of the sign-in kinds above.
export function isExternalMcpServerAuthType(
  value: unknown,
): value is ExternalMcpServerAuthType {
  return (
    typeof value === "string" &&
    EXTERNAL_MCP_SERVER_AUTH_TYPES.includes(value as ExternalMcpServerAuthType)
  );
}

/*
 * The sign-in a record uses: what it says, or None for a record written
 * without one (the column's default).
 */
export function readExternalMcpServerAuthType(
  value: unknown,
): ExternalMcpServerAuthType {
  return isExternalMcpServerAuthType(value)
    ? value
    : ExternalMcpServerAuthType.None;
}
