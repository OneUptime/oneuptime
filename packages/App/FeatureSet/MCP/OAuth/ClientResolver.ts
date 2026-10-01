/**
 * Client resolution
 *
 * Turns a `client_id` into the client it names, whichever of the two ways the
 * client chose to identify itself:
 *
 *   a UUID       -> a client that registered here (McpOAuthClient)
 *   an https URL -> a Client ID Metadata Document, fetched from that URL
 *
 * The two cannot be confused - one is a UUID and the other is not - so the
 * shape of the id alone decides which lookup runs, and a value that is
 * neither costs nothing at all.
 */

import ClientIdMetadataDocument from "./ClientIdMetadataDocument";
import { McpOAuthClientKind, ResolvedMcpOAuthClient } from "./ClientMetadata";
import McpOAuthClient from "Common/Models/DatabaseModels/McpOAuthClient";
import McpOAuthClientService from "Common/Server/Services/McpOAuthClientService";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";
import ObjectID from "Common/Types/ObjectID";

export default class ClientResolver {
  /*
   * The client, or null when there is no such client. Throws McpOAuthError
   * only for a metadata document that exists as a client id but could not be
   * read or is not valid - the caller reports that differently from "unknown
   * client", because the fix is the client's (or the operator's), not the
   * user's.
   */
  public static async resolve(
    clientId: unknown,
  ): Promise<ResolvedMcpOAuthClient | null> {
    if (typeof clientId !== "string" || !clientId) {
      return null;
    }

    if (ObjectID.isValidUUID(clientId)) {
      return ClientResolver.resolveRegisteredClient(clientId);
    }

    if (
      McpOAuthConfig.isClientIdMetadataDocumentEnabled() &&
      ClientIdMetadataDocument.isMetadataDocumentUrl(clientId)
    ) {
      return await ClientIdMetadataDocument.resolve(clientId);
    }

    return null;
  }

  /*
   * Records that a registered client is still in use, so its registration is
   * not swept. A no-op for a metadata document client, which has no row.
   */
  public static async touch(client: ResolvedMcpOAuthClient): Promise<void> {
    if (client.kind !== McpOAuthClientKind.Registered) {
      return;
    }

    /*
     * touchLastUsed needs the id and the value it is throttling against, both
     * of which the resolved client already carries - no second read.
     */
    const registered: McpOAuthClient = new McpOAuthClient();
    registered._id = client.clientId;

    if (client.lastUsedAt) {
      registered.lastUsedAt = client.lastUsedAt;
    }

    await McpOAuthClientService.touchLastUsed(registered);
  }

  private static async resolveRegisteredClient(
    clientId: string,
  ): Promise<ResolvedMcpOAuthClient | null> {
    const registered: McpOAuthClient | null =
      await McpOAuthClientService.findRegisteredClient(clientId);

    if (!registered || !registered.id) {
      return null;
    }

    return {
      clientId: registered.id.toString(),
      kind: McpOAuthClientKind.Registered,
      clientName: registered.clientName || "",
      ...(registered.clientUri ? { clientUri: registered.clientUri } : {}),
      redirectUris: Array.isArray(registered.redirectUris)
        ? registered.redirectUris
        : [],
      /*
       * Every registration stores its method. Should a row ever turn up
       * without one, a client that was issued a secret is still held to it:
       * the missing value must not read as "public".
       */
      tokenEndpointAuthMethod:
        registered.tokenEndpointAuthMethod ||
        (registered.clientSecretHash
          ? McpOAuthClientAuthMethod.ClientSecretBasic
          : McpOAuthClientAuthMethod.None),
      ...(registered.clientSecretHash
        ? { clientSecretHash: registered.clientSecretHash }
        : {}),
      ...(registered.lastUsedAt ? { lastUsedAt: registered.lastUsedAt } : {}),
    };
  }
}
