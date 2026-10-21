import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/McpOAuthGrant";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import McpOAuthScope, {
  McpOAuthScopeUtil,
} from "../../Types/Mcp/McpOAuthScope";
import ObjectID from "../../Types/ObjectID";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import UserType from "../../Types/UserType";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface McpOAuthGrantSsoEvidence {
  ssoProviderType: SsoProviderType;
  ssoProviderId: ObjectID | null;
  expiresAt: Date;
  /*
   * When the sign-in was copied onto the grant: the grant's creation. The
   * sign-in it copies was given no later than this, which is what a
   * project's own provider is asked about (it vouches only for sign-ins
   * given after it was last turned off). Absent on evidence not yet saved.
   */
  capturedAt?: Date | undefined;
}

/*
 * How stale `lastUsedAt` may get before it is written again. It answers "is
 * this client still in use", so a few minutes of resolution is plenty and a
 * busy agent does not cost a write per tool call.
 */
const LAST_USED_WRITE_INTERVAL_IN_MS: number = 5 * 60 * 1000;

export class Service extends DatabaseService<Model> {
  /*
   * A grant is deleted a day after `expiresAt` passes. That one rule removes
   * both kinds of leftover: an approval the client never collected (its
   * expiry is the authorization code's, minutes after it was written) and a
   * client that was abandoned without being revoked (its expiry stopped
   * sliding when it stopped refreshing).
   */
  public static readonly EXPIRED_GRANT_RETENTION_IN_DAYS: number = 1;

  public constructor() {
    super(Model);

    this.hardDeleteItemsOlderThanInDays(
      "expiresAt",
      Service.EXPIRED_GRANT_RETENTION_IN_DAYS,
    );
  }

  /*
   * Record that a member approved a client, before the client has collected
   * its tokens.
   *
   * Written as root because nothing may create a grant through the CRUD API
   * (the table's create list is empty) - the consent endpoint is the one
   * writer, and it has done its own checks by the time it calls this. The
   * props still NAME the member, so the audit trail attributes the entry to
   * the person who pressed Authorize rather than to "System".
   */
  @CaptureSpan()
  public async createPendingGrant(data: {
    projectId: ObjectID;
    userId: ObjectID;
    clientId: string;
    clientName: string;
    scopes: Array<McpOAuthScope>;
    resource: string;
    expiresAt: Date;
    ssoEvidence: McpOAuthGrantSsoEvidence | null;
  }): Promise<Model> {
    const grant: Model = new Model();

    grant.projectId = data.projectId;
    grant.userId = data.userId;
    grant.clientId = data.clientId;
    grant.name = data.clientName;
    grant.scope = McpOAuthScopeUtil.toString(
      McpOAuthScopeUtil.normalize(data.scopes),
    );
    grant.resource = data.resource;
    grant.expiresAt = data.expiresAt;

    if (data.ssoEvidence) {
      grant.ssoProviderType = data.ssoEvidence.ssoProviderType;
      grant.ssoExpiresAt = data.ssoEvidence.expiresAt;

      if (data.ssoEvidence.ssoProviderId) {
        grant.ssoProviderId = data.ssoEvidence.ssoProviderId;
      }
    }

    return await this.create({
      data: grant,
      props: {
        isRoot: true,
        userId: data.userId,
        userType: UserType.User,
        tenantId: data.projectId,
      },
    });
  }

  /*
   * Everything the token endpoint and the MCP endpoint need to decide whether
   * a grant may be used, in one read.
   */
  @CaptureSpan()
  public async findGrant(grantId: ObjectID): Promise<Model | null> {
    return await this.findOneById({
      id: grantId,
      select: {
        _id: true,
        projectId: true,
        userId: true,
        clientId: true,
        name: true,
        scope: true,
        resource: true,
        activatedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
        ssoProviderType: true,
        ssoProviderId: true,
        ssoExpiresAt: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The client has exchanged its code: the grant is live, and good until the
   * refresh token it was just given expires.
   */
  @CaptureSpan()
  public async activate(data: {
    grantId: ObjectID;
    expiresAt: Date;
    now?: Date | undefined;
  }): Promise<void> {
    await this.updateColumnsByIdWithoutHooks({
      id: data.grantId,
      data: {
        activatedAt: data.now || OneUptimeDate.getCurrentDate(),
        expiresAt: data.expiresAt,
      },
      skipUpdateDateColumn: true,
    });
  }

  // The client refreshed: slide the expiry out to its new refresh token's.
  @CaptureSpan()
  public async extend(data: {
    grantId: ObjectID;
    expiresAt: Date;
  }): Promise<void> {
    await this.updateColumnsByIdWithoutHooks({
      id: data.grantId,
      data: {
        expiresAt: data.expiresAt,
      },
      skipUpdateDateColumn: true,
    });
  }

  /*
   * Revoke: delete the grant, and with it (the foreign key cascades) every
   * code, access token and refresh token issued under it. `props` decides who
   * the audit trail says did it - the member through their client, or nobody
   * at all when the server revokes a grant whose secret was replayed.
   */
  @CaptureSpan()
  public async revoke(data: {
    grantId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    await this.deleteOneBy({
      query: {
        _id: data.grantId,
      },
      props: data.props,
    });
  }

  /*
   * The server revoking a grant on its own initiative, because something that
   * should have been presented once was presented twice. Logged, since from
   * the member's side the client simply stops working.
   */
  @CaptureSpan()
  public async revokeBecauseCredentialWasReplayed(data: {
    grantId: ObjectID;
    credential: string;
  }): Promise<void> {
    logger.warn(
      `MCP OAuth: revoking grant ${data.grantId.toString()} because a spent ${data.credential} was presented again.`,
    );

    await this.revoke({
      grantId: data.grantId,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * A registered client that authorizes again for the same member and project
   * is the same installation reconnecting - a registration's client id is
   * unique to it - so the grants it held before are replaced rather than left
   * to pile up until they expire. Never called for a client identified by a
   * metadata document: that id is shared by every installation of the client,
   * and replacing would sign a member's laptop out when they connect their
   * desktop.
   */
  @CaptureSpan()
  public async revokeEarlierGrantsOfClient(data: {
    userId: ObjectID;
    projectId: ObjectID;
    clientId: string;
    exceptGrantId: ObjectID;
  }): Promise<void> {
    await this.deleteBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
        clientId: data.clientId,
        _id: QueryHelper.notEquals(data.exceptGrantId),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Records that the client made a request. Best effort and throttled: it
   * must never fail the request it rides along with.
   */
  @CaptureSpan()
  public async touchLastUsed(
    grant: Model,
    now?: Date | undefined,
  ): Promise<void> {
    if (!grant.id) {
      return;
    }

    const currentDate: Date = now || OneUptimeDate.getCurrentDate();

    if (
      grant.lastUsedAt &&
      currentDate.getTime() - new Date(grant.lastUsedAt).getTime() <
        LAST_USED_WRITE_INTERVAL_IN_MS
    ) {
      return;
    }

    try {
      await this.updateColumnsByIdWithoutHooks({
        id: grant.id,
        data: {
          lastUsedAt: currentDate,
        },
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      logger.warn("MCP OAuth: could not record when a grant was last used.");
      logger.warn(err);
    }
  }
}

export default new Service();
