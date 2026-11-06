import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudStreamKeyHashes,
  CloudStreamRefusalReason,
  getLiveCloudStreamKeyHashes,
  parseCloudStreamKey,
  readCloudStreamKeyHashes,
} from "../../../Types/CloudConnection/CloudStream";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import CloudConnectionService from "../../Services/CloudConnectionService";
import PayAsYouGoBillingService, {
  PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
} from "../../Services/PayAsYouGoBillingService";
import ProjectService from "../../Services/ProjectService";
import LlmConnectionPullRunner from "../LlmObservability/LlmConnectionPullRunner";
import logger from "../Logger";
import CloudStreamKeyedConnections from "./CloudStreamKeyedConnections";
import CloudStreamKeys from "./CloudStreamKeys";

/*
 * WHO A FIREHOSE DELIVERY IS FROM.
 *
 * Amazon Data Firehose sends the access key it was set up with in
 * X-Amz-Firehose-Access-Key. A stream key names its connection
 * (CloudStream.parseCloudStreamKey); the connection names its project and
 * the telemetry service its telemetry belongs to. So the project a
 * delivery is written to is the key's, and nothing the delivery's records
 * or its other headers say can change it.
 *
 * A key is taken when its SHA-256 matches the connection's current key, or
 * the key that one replaced while it still works, and the connection:
 *
 *   - is an AWS connection, and turned on;
 *   - belongs to a project whose plan includes telemetry, that a master
 *     admin has not blocked, and that may be billed for it - the same
 *     admission every ingestion key is held to.
 *
 * What a connection holds is cached for a minute in each process (and a
 * connection that is not there for 10 seconds), so a busy stream reads
 * Postgres once a minute; a new key or Stop streaming takes effect here at
 * once (forget) and everywhere within the minute. A key naming a
 * connection that holds no stream key is refused without a read at all
 * (CloudStreamKeyedConnections), so refused deliveries cost nothing, and a
 * wrong key is noted on its connection only while that connection holds a
 * key.
 */

const POSITIVE_TTL_MS: number = 60 * 1000;
const NEGATIVE_TTL_MS: number = 10 * 1000;
const MAX_CACHED_CONNECTIONS: number = 5000;

interface CachedStreamConnection {
  projectId: string;
  provider: string;
  isEnabled: boolean;
  serviceId: string | null;
  serviceName: string | null;
  keyHashes: CloudStreamKeyHashes;
  // Whether the project's plan includes telemetry: a reseller's may not.
  isTelemetryAllowed: boolean;
}

export interface CloudStreamAuthorized {
  isAuthorized: true;
  projectId: ObjectID;
  connectionId: ObjectID;
  // The connection's own telemetry service, which its metrics and logs belong to.
  serviceName: string;
}

export interface CloudStreamRefused {
  isAuthorized: false;
  reason: CloudStreamRefusalReason;
  // The HTTP status Firehose is answered with.
  status: number;
  message: string;
  // The connection the key names, when there is one: its summary records the refusal.
  connectionId?: ObjectID | undefined;
}

export type CloudStreamAuthentication =
  | CloudStreamAuthorized
  | CloudStreamRefused;

export const WRONG_STREAM_KEY_MESSAGE: string =
  "This is not the connection's stream key. In OneUptime, open Cloud > Connect, choose Stream metrics and logs on the connection, make a new key and run the command again.";
export const STREAM_CONNECTION_OFF_MESSAGE: string =
  "The OneUptime cloud connection this stream belongs to is turned off. Turn it on under Cloud > Connect.";
export const STREAM_NOT_ALLOWED_MESSAGE: string =
  "This OneUptime project's plan does not include telemetry.";
export const STREAM_PROJECT_BLOCKED_MESSAGE: string =
  "This OneUptime project is blocked, and takes no telemetry until it is unblocked.";

export default class CloudStreamAuthenticator {
  private static cache: InMemoryTTLCache<CachedStreamConnection | null> =
    new InMemoryTTLCache<CachedStreamConnection | null>(MAX_CACHED_CONNECTIONS);

  // A connection whose key or settings just changed is read again at once.
  public static forget(connectionId: ObjectID | string): void {
    CloudStreamAuthenticator.cache.delete(connectionId.toString());
  }

  public static async authenticate(data: {
    accessKey: unknown;
    now: Date;
  }): Promise<CloudStreamAuthentication> {
    const parsed: { connectionId: string; secret: string } | null =
      parseCloudStreamKey(data.accessKey);

    if (!parsed) {
      return CloudStreamAuthenticator.wrongKey(undefined);
    }

    const connectionId: ObjectID = new ObjectID(parsed.connectionId);
    const connection: CachedStreamConnection | null =
      await CloudStreamAuthenticator.read(connectionId, data.now);
    const liveHashes: Array<string> = connection
      ? getLiveCloudStreamKeyHashes({
          hashes: connection.keyHashes,
          now: data.now,
        })
      : [];

    if (
      !connection ||
      connection.provider !== CloudProvider.AWS ||
      !CloudStreamKeys.matchesAny((data.accessKey as string).trim(), liveHashes)
    ) {
      /*
       * A wrong key is noted on its connection only while the connection
       * holds a key: someone setting a stream up is then told why its
       * deliveries are refused. A connection that streams nothing - never
       * set up, or stopped - gets no note from whoever knows its id.
       */
      return CloudStreamAuthenticator.wrongKey(
        connection && liveHashes.length > 0 ? connectionId : undefined,
      );
    }

    if (!connection.isEnabled) {
      return {
        isAuthorized: false,
        reason: CloudStreamRefusalReason.TurnedOff,
        status: 403,
        message: STREAM_CONNECTION_OFF_MESSAGE,
        connectionId,
      };
    }

    const projectId: ObjectID = new ObjectID(connection.projectId);

    if (!connection.isTelemetryAllowed) {
      return {
        isAuthorized: false,
        reason: CloudStreamRefusalReason.NotAllowed,
        status: 403,
        message: STREAM_NOT_ALLOWED_MESSAGE,
        connectionId,
      };
    }

    // The admission every ingestion key is held to, on every delivery.
    if (await ProjectService.isProjectBlocked(projectId)) {
      return {
        isAuthorized: false,
        reason: CloudStreamRefusalReason.NotAllowed,
        status: 403,
        message: STREAM_PROJECT_BLOCKED_MESSAGE,
        connectionId,
      };
    }

    try {
      await PayAsYouGoBillingService.requirePayAsYouGo(projectId, {
        allowStaleDenial: true,
      });
    } catch (error) {
      if (!(error instanceof PaymentRequiredException)) {
        throw error;
      }

      return {
        isAuthorized: false,
        reason: CloudStreamRefusalReason.NotAllowed,
        status: 402,
        message: PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
        connectionId,
      };
    }

    const serviceName: string | null =
      connection.serviceName ||
      (await CloudStreamAuthenticator.ensureService(connectionId));

    if (!serviceName) {
      throw new Error(
        `Cloud connection ${connectionId.toString()} has no telemetry service to stream into.`,
      );
    }

    return {
      isAuthorized: true,
      projectId,
      connectionId,
      serviceName,
    };
  }

  private static wrongKey(
    connectionId: ObjectID | undefined,
  ): CloudStreamRefused {
    return {
      isAuthorized: false,
      reason: CloudStreamRefusalReason.WrongKey,
      status: 401,
      message: WRONG_STREAM_KEY_MESSAGE,
      connectionId,
    };
  }

  private static async read(
    connectionId: ObjectID,
    now: Date,
  ): Promise<CachedStreamConnection | null> {
    const cacheKey: string = connectionId.toString();
    const cached: CachedStreamConnection | null | undefined =
      CloudStreamAuthenticator.cache.get(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    /*
     * A connection that holds no stream key is refused without a read, and
     * kept out of the cache: invented ids never push a streaming
     * connection out of it (CloudStreamKeyedConnections).
     */
    if (!(await CloudStreamKeyedConnections.mayHoldKey(connectionId, now))) {
      return null;
    }

    const connection: CloudConnection | null =
      await CloudConnectionService.findOneById({
        id: connectionId,
        select: {
          _id: true,
          projectId: true,
          provider: true,
          isEnabled: true,
          serviceId: true,
          service: { name: true },
          streamKeyHashes: true,
        },
        props: { isRoot: true },
      });

    if (!connection || !connection.projectId) {
      CloudStreamAuthenticator.cache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const entry: CachedStreamConnection = {
      projectId: connection.projectId.toString(),
      provider: connection.provider || "",
      isEnabled: connection.isEnabled !== false,
      serviceId: connection.serviceId?.toString() || null,
      serviceName: connection.service?.name || null,
      keyHashes: readCloudStreamKeyHashes(connection.streamKeyHashes),
      isTelemetryAllowed: await LlmConnectionPullRunner.isTelemetryAllowed(
        connection.projectId,
      ).catch((error: unknown): boolean => {
        logger.warn(
          `Cloud stream ${connectionId.toString()}: whether its project may take telemetry could not be read; it is taken for now. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return true;
      }),
    };

    CloudStreamAuthenticator.cache.set(cacheKey, entry, POSITIVE_TTL_MS);

    return entry;
  }

  /*
   * A connection whose telemetry service is gone gets a new one, as its
   * next read would give it.
   */
  private static async ensureService(
    connectionId: ObjectID,
  ): Promise<string | null> {
    const connection: CloudConnection | null =
      await CloudConnectionService.findOneById({
        id: connectionId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          serviceId: true,
        },
        props: { isRoot: true },
      });

    if (!connection) {
      return null;
    }

    const service: { serviceId: ObjectID; serviceName: string } =
      await CloudConnectionService.ensureTelemetryService(connection);

    CloudStreamAuthenticator.forget(connectionId);

    return service.serviceName;
  }
}
