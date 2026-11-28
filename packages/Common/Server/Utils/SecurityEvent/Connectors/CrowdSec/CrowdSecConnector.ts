import BadDataException from "../../../../../Types/Exception/BadDataException";
import { SecurityConnectorCheck } from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
  isBlockingTurnedOn,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "../../../../../Utils/SecurityCase/SecurityConnectionMatch";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import { redactLogString } from "../../../LogRedaction";
import ConnectorErrorMessage from "../../ConnectorErrorMessage";
import CrowdSecLapiClient, {
  CrowdSecAllowlist,
  CrowdSecHeldDecision,
  normalizeLapiUrl,
} from "../../Response/CrowdSecLapiClient";
import {
  BLOCK_CHECK_KEY,
  withBlockingCheck,
} from "../BlockingConnectionChecks";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  ConnectorTestOptions,
  ConnectorTransport,
  SecurityConnectorSettings,
  SecurityEventConnector,
  makeCheck,
  readSettingString,
} from "../Types";

/*
 * THE CROWDSEC CONNECTION (#11158).
 *
 * CrowdSec sends its alerts to OneUptime - its http notification plugin
 * posts each one to the ingest endpoint, naming the connection - so
 * nothing here polls: fetchEvents refuses, and the poller never asks
 * (the catalog's alertsArePushed). What the connection holds of its own is
 * the Local API (LAPI) a project blocks through, optionally: its URL, and
 * the machine OneUptime signs in as with its password, all three or none.
 *
 * Test connection checks the LAPI side, in dependency order, each later
 * check skipped when an earlier one fails, so the report names one cause:
 *
 *   Reach the Local API   GET /health, which needs no sign-in: whether
 *                         OneUptime gets to LAPI at all. Warns when it is
 *                         reached over http across a network: the machine's
 *                         password would cross it unencrypted;
 *   Sign in               POST /v1/watchers/login as the machine;
 *   Read the allowlists   CrowdSec's own allowlists, which OneUptime never
 *                         bans an address of;
 *   Block with CrowdSec   with blocking on: OneUptime's bans in force, read
 *                         as the reconciler reads them. Nothing is written.
 *
 * A connection that only receives alerts has no LAPI to test, and says so.
 */

export const CROWDSEC_REACH_CHECK_NAME: string = "Reach CrowdSec's Local API";
export const CROWDSEC_SIGN_IN_CHECK_NAME: string = "Sign in to the Local API";
export const CROWDSEC_ALLOWLISTS_CHECK_NAME: string =
  "Read CrowdSec's allowlists";
export const CROWDSEC_BLOCK_CHECK_NAME: string = "Block with CrowdSec";

// The machine IDs LAPI makes: a name, or a TLS machine's cn@address.
const MACHINE_ID_PATTERN: RegExp = /^[^\s/]{1,255}$/;

export interface CrowdSecLapiSettings {
  lapiUrl: string;
  machineId: string;
  password: string;
}

function errorText(error: unknown): string {
  return redactLogString(
    ConnectorErrorMessage.toMessage(error, { truncate: false }),
  );
}

// Whether http to this LAPI crosses a network: anything but loopback, a private address or localhost.
export function isLapiReachedInTheClear(lapiUrl: string): boolean {
  const url: URL = new URL(lapiUrl);

  if (url.protocol !== "http:") {
    return false;
  }

  const host: string = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) {
    return false;
  }

  const scope: SecurityAddressScope | null = getSecurityAddressScope(host);

  return (
    scope !== SecurityAddressScope.Private &&
    scope !== SecurityAddressScope.Local
  );
}

export default class CrowdSecConnector implements SecurityEventConnector {
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.CrowdSec;

  private transport: ConnectorTransport;

  public constructor(transport?: ConnectorTransport | undefined) {
    this.transport =
      transport ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });
  }

  private static getDefinition(): SecurityEventConnectorDefinition {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.CrowdSec,
      );

    if (!definition) {
      throw new BadDataException(
        "CrowdSec is missing from the connector catalog.",
      );
    }

    return definition;
  }

  private static fieldTitle(key: string): string {
    const definition: SecurityEventConnectorDefinition = this.getDefinition();
    const field: { title: string } | undefined = [
      ...definition.configFields,
      ...definition.secretFields,
    ].find((candidate: { key: string }): boolean => {
      return candidate.key === key;
    });

    return field?.title || key;
  }

  /*
   * The LAPI settings, when all three are given; null when none is. Some
   * of them, or blocking turned on without them, is refused with what is
   * missing.
   */
  public static readLapiSettings(
    settings: SecurityConnectorSettings,
  ): CrowdSecLapiSettings | null {
    const lapiUrl: string = readSettingString(settings.config, "lapiUrl");
    const machineId: string = readSettingString(settings.config, "machineId");
    const password: string = readSettingString(settings.secrets, "password");
    const isBlocking: boolean = isBlockingTurnedOn(settings.config);

    if (!lapiUrl && !machineId && !password) {
      if (isBlocking) {
        throw new BadDataException(
          `To block addresses with CrowdSec, give its ${this.fieldTitle("lapiUrl")}, a ${this.fieldTitle("machineId")} and its ${this.fieldTitle("password")}.`,
        );
      }

      return null;
    }

    const missing: Array<string> = [];

    if (!lapiUrl) {
      missing.push(this.fieldTitle("lapiUrl"));
    }

    if (!machineId) {
      missing.push(this.fieldTitle("machineId"));
    }

    if (!password) {
      missing.push(this.fieldTitle("password"));
    }

    if (missing.length > 0) {
      throw new BadDataException(
        `CrowdSec's Local API needs its URL, a machine ID and its password together. Missing: ${missing.join(", ")}.`,
      );
    }

    if (!MACHINE_ID_PATTERN.test(machineId)) {
      throw new BadDataException(
        `${this.fieldTitle("machineId")} must be a machine's ID as cscli machines list shows it, without spaces or slashes.`,
      );
    }

    return { lapiUrl: normalizeLapiUrl(lapiUrl), machineId, password };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    if (settings.provider !== this.provider) {
      throw new BadDataException(
        `Settings are for provider "${String(settings.provider)}", not CrowdSec.`,
      );
    }

    CrowdSecConnector.readLapiSettings(settings);
  }

  public buildClient(lapi: CrowdSecLapiSettings): CrowdSecLapiClient {
    return new CrowdSecLapiClient({
      lapiUrl: lapi.lapiUrl,
      machineId: lapi.machineId,
      password: lapi.password,
      transport: this.transport,
    });
  }

  public async testConnection(
    settings: SecurityConnectorSettings,
    _options: ConnectorTestOptions,
  ): Promise<Array<SecurityConnectorCheck>> {
    let lapi: CrowdSecLapiSettings | null = null;
    const startedAtMs: number = Date.now();

    try {
      lapi = CrowdSecConnector.readLapiSettings(settings);
    } catch (error) {
      return [
        makeCheck({
          key: "reachability",
          name: CROWDSEC_REACH_CHECK_NAME,
          status: "fail",
          startedAtMs,
          message: errorText(error),
        }),
      ];
    }

    if (!lapi) {
      return [
        makeCheck({
          key: "reachability",
          name: CROWDSEC_REACH_CHECK_NAME,
          status: "skip",
          startedAtMs,
          message:
            "No Local API is set, so this connection only receives CrowdSec's alerts. Give its Local API URL, a machine ID and its password to block addresses in CrowdSec.",
        }),
      ];
    }

    const client: CrowdSecLapiClient = this.buildClient(lapi);
    const checks: Array<SecurityConnectorCheck> = [];

    checks.push(await this.reachCheck(client, lapi));

    if (checks[0]?.status === "fail") {
      checks.push(
        makeCheck({
          key: "authentication",
          name: CROWDSEC_SIGN_IN_CHECK_NAME,
          status: "skip",
          startedAtMs: Date.now(),
          message: "Skipped because the Local API could not be reached.",
        }),
      );

      return await withBlockingCheck({
        settings,
        checks,
        name: CROWDSEC_BLOCK_CHECK_NAME,
        check: async (): Promise<SecurityConnectorCheck> => {
          return this.blockCheck(client);
        },
      });
    }

    const signInStartedAtMs: number = Date.now();

    try {
      await client.login();
      checks.push(
        makeCheck({
          key: "authentication",
          name: CROWDSEC_SIGN_IN_CHECK_NAME,
          status: "pass",
          startedAtMs: signInStartedAtMs,
          message: `Signed in as the machine ${lapi.machineId}.`,
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: CROWDSEC_SIGN_IN_CHECK_NAME,
          status: "fail",
          startedAtMs: signInStartedAtMs,
          message: errorText(error),
        }),
      );

      return await withBlockingCheck({
        settings,
        checks,
        name: CROWDSEC_BLOCK_CHECK_NAME,
        check: async (): Promise<SecurityConnectorCheck> => {
          return this.blockCheck(client);
        },
      });
    }

    checks.push(await this.allowlistsCheck(client));

    return await withBlockingCheck({
      settings,
      checks,
      name: CROWDSEC_BLOCK_CHECK_NAME,
      check: async (): Promise<SecurityConnectorCheck> => {
        return this.blockCheck(client);
      },
    });
  }

  public async fetchEvents(
    _settings: SecurityConnectorSettings,
    _window: ConnectorFetchWindow,
    _options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    throw new BadDataException(
      "CrowdSec sends its alerts to OneUptime through its notification plugin, so there is nothing to poll.",
    );
  }

  private async reachCheck(
    client: CrowdSecLapiClient,
    lapi: CrowdSecLapiSettings,
  ): Promise<SecurityConnectorCheck> {
    const startedAtMs: number = Date.now();

    try {
      await client.readHealth();
    } catch (error) {
      return makeCheck({
        key: "reachability",
        name: CROWDSEC_REACH_CHECK_NAME,
        status: "fail",
        startedAtMs,
        message: errorText(error),
        remediation:
          "LAPI listens on 127.0.0.1:8080 unless told otherwise. Make it reachable from OneUptime: set api.server.listen_uri in CrowdSec's config.yaml, serve it over TLS or behind an https proxy, and let OneUptime's addresses through your firewall.",
      });
    }

    if (isLapiReachedInTheClear(lapi.lapiUrl)) {
      return makeCheck({
        key: "reachability",
        name: CROWDSEC_REACH_CHECK_NAME,
        status: "warn",
        startedAtMs,
        message: `${client.getBaseUrl()} answers over http, so the machine's password crosses the network unencrypted.`,
        remediation:
          "Serve the Local API over TLS (api.server.tls in CrowdSec's config.yaml) or put an https proxy in front of it, unless it is on a network only you use.",
      });
    }

    return makeCheck({
      key: "reachability",
      name: CROWDSEC_REACH_CHECK_NAME,
      status: "pass",
      startedAtMs,
      message: `${client.getBaseUrl()} answers.`,
    });
  }

  private async allowlistsCheck(
    client: CrowdSecLapiClient,
  ): Promise<SecurityConnectorCheck> {
    const startedAtMs: number = Date.now();

    try {
      const lists: Array<CrowdSecAllowlist> = await client.readAllowlists();
      const entries: number = lists.reduce(
        (total: number, list: CrowdSecAllowlist): number => {
          return total + list.values.length;
        },
        0,
      );

      return makeCheck({
        key: "allowlists",
        name: CROWDSEC_ALLOWLISTS_CHECK_NAME,
        status: "pass",
        startedAtMs,
        message:
          lists.length === 0
            ? "CrowdSec has no allowlist, or is older than 1.6.8, which has none."
            : `CrowdSec has ${lists.length.toLocaleString("en-US")} ${lists.length === 1 ? "allowlist" : "allowlists"} holding ${entries.toLocaleString("en-US")} ${entries === 1 ? "address or range" : "addresses and ranges"}. OneUptime never bans one of them.`,
      });
    } catch (error) {
      return makeCheck({
        key: "allowlists",
        name: CROWDSEC_ALLOWLISTS_CHECK_NAME,
        status: "fail",
        startedAtMs,
        message: errorText(error),
        remediation:
          "OneUptime bans nothing in CrowdSec while it cannot read its allowlists. Check that the machine is allowed to read them.",
      });
    }
  }

  private async blockCheck(
    client: CrowdSecLapiClient,
  ): Promise<SecurityConnectorCheck> {
    const startedAtMs: number = Date.now();

    try {
      const held: Array<CrowdSecHeldDecision> = await client.listOwnBans(null);

      return makeCheck({
        key: BLOCK_CHECK_KEY,
        name: CROWDSEC_BLOCK_CHECK_NAME,
        status: "pass",
        startedAtMs,
        message: `OneUptime can ban addresses as this machine, and reads its bans back. It has ${held.length.toLocaleString("en-US")} ${held.length === 1 ? "ban" : "bans"} in force on this Local API. Nothing was changed.`,
        details: { bansInForce: held.length },
      });
    } catch (error) {
      return makeCheck({
        key: BLOCK_CHECK_KEY,
        name: CROWDSEC_BLOCK_CHECK_NAME,
        status: "fail",
        startedAtMs,
        message: errorText(error),
      });
    }
  }
}
