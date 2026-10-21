import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/McpOAuthClient";
import OneUptimeDate from "../../Types/Date";
import McpOAuthClientAuthMethod from "../../Types/Mcp/McpOAuthClientAuthMethod";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";
import McpOAuthSecret from "../Utils/Mcp/McpOAuthSecret";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface RegisteredMcpOAuthClient {
  client: Model;

  /*
   * The plaintext client secret, for a client that asked for one. This is the
   * only moment it exists outside the client: the row keeps its digest.
   */
  clientSecret: string | null;
}

/*
 * How stale `lastUsedAt` may get before it is written again. The column only
 * feeds a 90-day sweep, so day resolution is all it needs, and a client that
 * refreshes hourly should not cost a write an hour.
 */
const LAST_USED_WRITE_INTERVAL_IN_MS: number = 24 * 60 * 60 * 1000;

export class Service extends DatabaseService<Model> {
  /*
   * A registration nobody has used for this long is deleted. Refresh tokens
   * last 30 days, so a client idle for 90 cannot still hold a live one, and
   * the sweep strands no connected user. It is also what bounds the table:
   * registration is open to anyone who can reach the endpoint.
   */
  public static readonly UNUSED_CLIENT_RETENTION_IN_DAYS: number = 90;

  public constructor() {
    super(Model);

    this.hardDeleteItemsOlderThanInDays(
      "lastUsedAt",
      Service.UNUSED_CLIENT_RETENTION_IN_DAYS,
    );
  }

  @CaptureSpan()
  public async registerClient(data: {
    clientName: string;
    clientUri?: string | undefined;
    redirectUris: Array<string>;
    tokenEndpointAuthMethod: McpOAuthClientAuthMethod;
  }): Promise<RegisteredMcpOAuthClient> {
    const client: Model = new Model();

    client.clientName = data.clientName;
    client.redirectUris = data.redirectUris;
    client.tokenEndpointAuthMethod = data.tokenEndpointAuthMethod;
    client.lastUsedAt = OneUptimeDate.getCurrentDate();

    if (data.clientUri) {
      client.clientUri = data.clientUri;
    }

    let clientSecret: string | null = null;

    if (data.tokenEndpointAuthMethod !== McpOAuthClientAuthMethod.None) {
      clientSecret = McpOAuthSecret.mintClientSecret();
      client.clientSecretHash = McpOAuthSecret.hash(clientSecret);
    }

    const created: Model = await this.create({
      data: client,
      props: {
        isRoot: true,
      },
    });

    return {
      client: created,
      clientSecret,
    };
  }

  /*
   * The registration behind a client id, or null. A client id that is not a
   * UUID cannot be a row here - `_id` is a Postgres uuid column, so asking
   * would raise rather than answer - and is refused without a query.
   */
  @CaptureSpan()
  public async findRegisteredClient(clientId: string): Promise<Model | null> {
    if (!ObjectID.isValidUUID(clientId)) {
      return null;
    }

    return await this.findOneById({
      id: new ObjectID(clientId),
      select: {
        _id: true,
        clientName: true,
        clientUri: true,
        redirectUris: true,
        tokenEndpointAuthMethod: true,
        clientSecretHash: true,
        lastUsedAt: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Records that the client is still in use. Best effort and throttled: it
   * must never fail the token exchange it rides along with.
   */
  @CaptureSpan()
  public async touchLastUsed(client: Model): Promise<void> {
    if (!client.id) {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    if (
      client.lastUsedAt &&
      now.getTime() - new Date(client.lastUsedAt).getTime() <
        LAST_USED_WRITE_INTERVAL_IN_MS
    ) {
      return;
    }

    try {
      await this.updateColumnsByIdWithoutHooks({
        id: client.id,
        data: {
          lastUsedAt: now,
        },
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      logger.warn(
        "MCP OAuth: could not record when a client registration was last used.",
      );
      logger.warn(err);
    }
  }
}

export default new Service();
