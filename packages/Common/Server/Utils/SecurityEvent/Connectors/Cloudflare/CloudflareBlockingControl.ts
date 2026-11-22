import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService, {
  Service as SecurityEventConnectionServiceType,
} from "../../../../Services/SecurityEventConnectionService";
import SecurityBlocklistJobs from "../../../SecurityBlocklist/SecurityBlocklistJobs";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityConnectorCheck } from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CloudflareBlockingSettings,
  readCloudflareBlockingSettings,
} from "../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import { SecurityConnectorSettings } from "../Types";
import CloudflareBlockDestinations, {
  CloudflareDestinationOptions,
} from "./CloudflareBlockDestination";
import CloudflareBlocking from "./CloudflareBlocking";
import CloudflareClient from "./CloudflareClient";
import CloudflareConnector from "./CloudflareConnector";

/*
 * TURNING BLOCKING AT CLOUDFLARE ON AND OFF (#10343), as the connection's
 * blocking routes do it (SecurityEventConnectionAPI). Blocking is a clear
 * opt-in, off by default: the connection reads with a read-only token until
 * a person turns it on, and only then is it asked for, and checked for, the
 * write permissions it needs.
 *
 *   check     how blocking would be set up, and whether the token - the
 *             stored one, or one pasted to replace it - holds each write
 *             permission it needs, asked without writing;
 *   turnOn    the same checks first: on only when every one passes. A token
 *             pasted is saved with the connection, the zones chosen kept
 *             (none: every zone the connection reads), and OneUptime sets
 *             Cloudflare up on the reconciler's next pass, queued at once.
 *             Turned on again, it changes the zones and sets them up;
 *   turnOff   off, asked whether to take OneUptime's lists and rules away
 *             from Cloudflare - which the reconciler then does, taking away
 *             only what OneUptime added - or to keep them;
 *   putBack   sets up again, in the zones named or every zone, what was
 *             turned off, deleted or changed at Cloudflare.
 *
 * The settings are the connection's blockingSettings, which only these
 * write, as OneUptime, for a caller the route has checked may change the
 * connection.
 */

// How long one request of a check may take: a check answers while the person waits.
export const CLOUDFLARE_BLOCKING_CHECK_TIMEOUT_IN_MS: number = 20 * 1000;

// Cloudflare zone ids: 32 lowercase hexadecimal characters.
const ZONE_ID: RegExp = /^[0-9a-f]{32}$/;

// The most zones blocking is on in: a connection reads 50 at most.
const MAX_BLOCK_ZONES: number = 50;

export interface CloudflareBlockingCheckResult {
  // Whether every check passed: only then is blocking turned on.
  isReady: boolean;
  checks: Array<SecurityConnectorCheck>;
}

function readZoneIds(value: JSONValue | undefined): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadDataException("Zones must be a list of Cloudflare zone IDs.");
  }

  const zoneIds: Array<string> = [];

  for (const item of value) {
    const zoneId: string = String(item || "")
      .trim()
      .toLowerCase();

    if (!ZONE_ID.test(zoneId)) {
      throw new BadDataException(
        "Each zone must be a Cloudflare zone ID: 32 letters and digits.",
      );
    }

    if (!zoneIds.includes(zoneId)) {
      zoneIds.push(zoneId);
    }
  }

  if (zoneIds.length > MAX_BLOCK_ZONES) {
    throw new BadDataException(
      `Blocking can be on in at most ${MAX_BLOCK_ZONES} zones of one connection.`,
    );
  }

  return zoneIds;
}

export default class CloudflareBlockingControl {
  /*
   * The connection, read as OneUptime once the route has checked it is the
   * caller's project's: a Cloudflare connection, with what blocking reads.
   */
  public static async loadConnection(
    connectionId: ObjectID,
  ): Promise<SecurityEventConnection> {
    const connection: SecurityEventConnection | null =
      await SecurityEventConnectionService.findOneById({
        id: connectionId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          config: true,
          secrets: true,
          alertingOnly: true,
          blockingSettings: true,
          blockingStatus: true,
        },
        props: { isRoot: true },
      });

    if (!connection || !connection.projectId) {
      throw new BadDataException("The connection no longer exists.");
    }

    if (connection.provider !== SecurityEventConnectorProvider.Cloudflare) {
      throw new BadDataException(
        "Blocking addresses is available on Cloudflare connections only.",
      );
    }

    return connection;
  }

  /*
   * The checks turning blocking on asks first: with the connection's stored
   * settings, the zones asked for and, when one is pasted, a new token.
   */
  public static async check(data: {
    connection: SecurityEventConnection;
    body: JSONObject;
  }): Promise<CloudflareBlockingCheckResult> {
    const settings: SecurityConnectorSettings = await this.settingsWith(
      data.connection,
      data.body,
    );
    const parsed: {
      apiToken: string;
      accountId: string;
      zoneIds: Array<string>;
    } = CloudflareConnector.parseSettings(settings, { requireAccount: true });
    const options: CloudflareDestinationOptions =
      CloudflareBlockDestinations.getOptionsForChecks();

    const blocking: CloudflareBlocking = new CloudflareBlocking({
      client: new CloudflareClient({
        apiToken: parsed.apiToken,
        transport:
          options.transport ||
          ((
            request: DataSourceHttpRequest,
          ): Promise<DataSourceHttpResponse> => {
            return DataSourceHttpFetch.fetch(request);
          }),
        requestTimeoutInMs: CLOUDFLARE_BLOCKING_CHECK_TIMEOUT_IN_MS,
        ...(options.sleep ? { sleep: options.sleep } : {}),
      }),
      scope: {
        projectId: data.connection.projectId!.toString(),
        accountId: parsed.accountId,
        readZoneIds: parsed.zoneIds,
        blockZoneIds: readZoneIds(data.body["zoneIds"]),
      },
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });

    const { checks } = await blocking.checkWriteAccess();

    return {
      isReady:
        checks.length > 0 &&
        checks.every((check: SecurityConnectorCheck): boolean => {
          return check.status === "pass";
        }),
      checks,
    };
  }

  /*
   * On, when every check passes: a pasted token saved with the connection
   * (through its own update, with the caller's props, so it is validated
   * and kept encrypted as Update credentials keeps it), the zones kept, and
   * a setup asked for and queued. Otherwise nothing changes, and the checks
   * say why.
   */
  public static async turnOn(data: {
    connection: SecurityEventConnection;
    body: JSONObject;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<CloudflareBlockingCheckResult> {
    const result: CloudflareBlockingCheckResult = await this.check(data);

    if (!result.isReady) {
      return result;
    }

    const apiToken: string = this.readNewToken(data.body);

    if (apiToken) {
      await SecurityEventConnectionService.updateOneById({
        id: data.connection.id!,
        data: { secrets: JSON.stringify({ apiToken }) },
        props: data.props,
      });
    }

    const previous: CloudflareBlockingSettings = readCloudflareBlockingSettings(
      data.connection.blockingSettings,
    );

    await this.writeSettings(data.connection, {
      isEnabled: true,
      zoneIds: readZoneIds(data.body["zoneIds"]),
      turnedOnAt:
        previous.isEnabled && previous.turnedOnAt
          ? previous.turnedOnAt
          : data.now.toISOString(),
      setupRequestedAt: data.now.toISOString(),
    });

    await SecurityBlocklistJobs.queueReconcile(data.connection.projectId!);

    return result;
  }

  /*
   * Off. With removeFromCloudflare, OneUptime takes its lists and rules
   * away on the reconciler's next pass (CloudflareBlockDestinations.settle);
   * without, they stay in Cloudflare as they are, blocking what they hold,
   * and nobody keeps them.
   */
  public static async turnOff(data: {
    connection: SecurityEventConnection;
    body: JSONObject;
    now: Date;
  }): Promise<void> {
    const removeFromCloudflare: JSONValue | undefined =
      data.body["removeFromCloudflare"];

    if (typeof removeFromCloudflare !== "boolean") {
      throw new BadDataException(
        "Say whether OneUptime removes its lists and rules from Cloudflare: removeFromCloudflare must be true or false.",
      );
    }

    const previous: CloudflareBlockingSettings = readCloudflareBlockingSettings(
      data.connection.blockingSettings,
    );

    await this.writeSettings(data.connection, {
      isEnabled: false,
      zoneIds: previous.zoneIds,
      ...(removeFromCloudflare
        ? { removalRequestedAt: data.now.toISOString() }
        : {}),
    });

    await SecurityBlocklistJobs.queueReconcile(data.connection.projectId!);
  }

  // Sets up again what changed at Cloudflare: in the zones named, or every zone blocking is on in.
  public static async putBack(data: {
    connection: SecurityEventConnection;
    body: JSONObject;
    now: Date;
  }): Promise<void> {
    const settings: CloudflareBlockingSettings = readCloudflareBlockingSettings(
      data.connection.blockingSettings,
    );

    if (!settings.isEnabled) {
      throw new BadDataException(
        "Blocking at Cloudflare is off for this connection. Turn it on to set it up.",
      );
    }

    const zoneIds: Array<string> = readZoneIds(data.body["zoneIds"]);

    await this.writeSettings(data.connection, {
      ...settings,
      setupRequestedAt: data.now.toISOString(),
      ...(zoneIds.length > 0 ? { setupZoneIds: zoneIds } : {}),
    });

    await SecurityBlocklistJobs.queueReconcile(data.connection.projectId!);
  }

  // A token pasted to replace the stored one, or "" to keep it.
  private static readNewToken(body: JSONObject): string {
    const secrets: JSONValue | undefined = body["secrets"];

    if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
      return "";
    }

    const apiToken: JSONValue | undefined = (secrets as JSONObject)["apiToken"];

    return typeof apiToken === "string" ? apiToken.trim() : "";
  }

  // The connection's settings, with a pasted token over the stored one, as a save would merge it.
  private static async settingsWith(
    connection: SecurityEventConnection,
    body: JSONObject,
  ): Promise<SecurityConnectorSettings> {
    const stored: SecurityConnectorSettings =
      await SecurityEventConnectionService.getConnectorSettings(connection);
    const apiToken: string = this.readNewToken(body);

    if (!apiToken) {
      return stored;
    }

    return {
      ...stored,
      secrets: SecurityEventConnectionServiceType.mergeSecrets({
        definition: SecurityEventConnectionServiceType.getDefinitionOrThrow(
          SecurityEventConnectorProvider.Cloudflare,
        ),
        stored: stored.secrets,
        provided: { apiToken },
      }),
    };
  }

  private static async writeSettings(
    connection: SecurityEventConnection,
    settings: CloudflareBlockingSettings,
  ): Promise<void> {
    await SecurityEventConnectionService.updateOneById({
      id: connection.id!,
      data: { blockingSettings: settings as never },
      props: { isRoot: true },
    });
  }
}
