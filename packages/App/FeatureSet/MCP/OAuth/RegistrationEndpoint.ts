/**
 * Dynamic client registration (POST /mcp/oauth/register, RFC 7591)
 *
 * How a client that has never seen this OneUptime instance introduces itself
 * and gets a client id, with no administrator involved. It is open to anyone
 * who can reach the endpoint, on purpose: a client has to be able to register
 * before anybody has signed in.
 *
 * What makes that safe is how little a registration is worth. It grants
 * nothing - a member still has to sign in and approve, looking at a consent
 * screen that says where the code will be sent - and it stores almost
 * nothing: a name, a home page and redirect URIs that have each been checked
 * (ClientMetadata, RedirectUri). The endpoint is rate limited, and
 * registrations nobody uses are swept.
 */

import ClientMetadata, { McpOAuthClientMetadata } from "./ClientMetadata";
import OAuthHttp from "./OAuthHttp";
import McpOAuthClientService, {
  RegisteredMcpOAuthClient,
} from "Common/Server/Services/McpOAuthClientService";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";

export default class RegistrationEndpoint {
  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Throws invalid_client_metadata / invalid_redirect_uri, answered 400.
    const metadata: McpOAuthClientMetadata =
      ClientMetadata.parseRegistrationRequest(req.body);

    const registered: RegisteredMcpOAuthClient =
      await McpOAuthClientService.registerClient(metadata);

    const createdAt: Date = registered.client.createdAt
      ? new Date(registered.client.createdAt)
      : new Date();

    const response: JSONObject = {
      client_id: registered.client.id!.toString(),
      client_id_issued_at: Math.floor(createdAt.getTime() / 1000),
      client_name: metadata.clientName,
      redirect_uris: metadata.redirectUris,
      token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
      /*
       * What was registered, which is not always what was asked for: this
       * server offers the one flow, so that is what every client gets.
       */
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };

    if (metadata.clientUri) {
      response["client_uri"] = metadata.clientUri;
    }

    if (registered.clientSecret) {
      response["client_secret"] = registered.clientSecret;
      // RFC 7591: required alongside a secret; 0 means it does not expire.
      response["client_secret_expires_at"] = 0;
    }

    OAuthHttp.sendJson(res, 201, response);
  }
}
