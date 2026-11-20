import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  ConnectorFieldChoice,
  readConnectorFieldChoiceValues,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorFieldChoices";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CLOUDFLARE_MAX_ZONES_PER_CONNECTION,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { readEdgeSampleInterval } from "../../../../../Types/SecurityEvent/EdgeAction";
import CloudflareNormalizer, {
  CloudflareZoneContext,
} from "../../../../../Utils/SecurityEvent/Connectors/CloudflareNormalizer";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import lookupTable from "../../../../../Utils/LookupTable";
import { redactLogString } from "../../../LogRedaction";
import ConnectorErrorMessage from "../../ConnectorErrorMessage";
import {
  ConnectorFetchBudget,
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  ConnectorFieldChoicesOptions,
  ConnectorTestOptions,
  ConnectorTestResult,
  ConnectorTransport,
  SecurityConnectorSettings,
  SecurityEventConnector,
  attachConnectorFetchSummary,
  makeCheck,
  readSettingString,
} from "../Types";
import CloudflareClient, {
  CLOUDFLARE_DEFAULT_MAX_FIELDS,
  CLOUDFLARE_DEFAULT_MAX_PAGE_SIZE,
  CLOUDFLARE_MAX_ROWS_PER_PAGE,
  CLOUDFLARE_OPTIONAL_EVENT_FIELDS,
  CLOUDFLARE_REQUIRED_EVENT_FIELDS,
  CloudflareApiError,
  CloudflareDatasetSettings,
  CloudflareEventCount,
  CloudflareEventKey,
  CloudflareFailureKind,
  CloudflareSettingsReading,
  CloudflareTokenStatus,
  CloudflareZone,
  CloudflareZoneList,
} from "./CloudflareClient";

/*
 * Cloudflare connection: what Cloudflare's firewall did at the edge, read
 * with an API token that only reads.
 *
 * Settings are the catalog's keys: secrets.apiToken, config.accountId (the
 * account the zones belong to, picked from the accounts the token reads)
 * and config.zoneIds (the zones to read, comma-separated; empty means every
 * active zone of the account, including zones added later).
 *
 * The token needs two permissions, both read-only
 * (https://developers.cloudflare.com/fundamentals/api/reference/permissions/):
 * Zone > Zone > Read, to list the zones, and Zone > Analytics > Read on each
 * zone, to read its firewall events from the GraphQL Analytics API. Test
 * Connection asks for each in turn and names the one that is missing, and
 * the zones it is missing on. Blocking addresses at Cloudflare needs write
 * permissions; it is a separate opt-in, asked for when it is turned on.
 *
 * Each poll reads every zone's firewall events by their time at the edge
 * (CloudflareClient.listFirewallEvents), oldest first, one page per zone in
 * turn, so a busy zone cannot spend the run's budget before a quiet one has
 * been read. When a bound stops the read, the poll resumes from the oldest
 * last-read time of the zones it did not finish: every event before it has
 * been read in every zone. A zone the token may no longer read does not
 * hold the others up: its events in the window are named as not imported,
 * the run is Partial, and Import this time range recovers them once the
 * token reads the zone again.
 */

interface ParsedSettings {
  apiToken: string;
  accountId: string;
  zoneIds: Array<string>;
}

// One zone being read in a fetch.
interface ZoneRead {
  zone: CloudflareZone;
  context: CloudflareZoneContext;
  fields: Array<string>;
  pageSize: number;
  // The windows still to read, oldest first: the fetch's window, split where the plan's longest query is shorter.
  windows: Array<{ startTime: Date; endTime: Date }>;
  after: CloudflareEventKey | undefined;
  done: boolean;
  // The edge time of the last row read: every row before it in this zone has been read.
  lastEventTime: Date | undefined;
  eventsRead: number;
}

type StopReason = "requests" | "events" | "time" | "rate-limit";

// Cloudflare API tokens are 40 characters of letters, digits, - and _.
const API_TOKEN_REGEX: RegExp = /^[A-Za-z0-9_-]{30,200}$/;
// A Global API Key is 37 lowercase hexadecimal characters.
const GLOBAL_API_KEY_REGEX: RegExp = /^[0-9a-f]{37}$/;
// The header scheme pasted along with the token.
const BEARER_PREFIX_REGEX: RegExp = /^bearer\s/i;
// Account and zone IDs are 32 lowercase hexadecimal characters.
const CLOUDFLARE_ID_REGEX: RegExp = /^[0-9a-f]{32}$/;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const SECOND_IN_MS: number = 1000;
// A token that expires sooner than this is a warning, so it can be renewed in time.
const TOKEN_EXPIRY_WARNING_IN_MS: number = 14 * DAY_IN_MS;
// The most zone pages a fetch lists: a connection reads 50 zones at most.
const MAX_ZONE_PAGES_PER_FETCH: number = 4;
// The most zone pages the form's pickers list: 2,000 zones.
const MAX_ZONE_PAGES_FOR_CHOICES: number = 40;
// Normalization failures quoted into warnings before the rest are counted only.
const MAX_NORMALIZATION_WARNINGS: number = 5;
// Zones named in a sentence before "and N more".
const MAX_ZONES_NAMED: number = 5;
/*
 * How much earlier than the plan's reach a window may start: a query for
 * exactly the oldest second Cloudflare keeps is refused by the time it runs.
 */
const RETENTION_MARGIN_IN_MS: number = 5 * 60 * 1000;

// A plan's short id (a zone's plan.legacy_id), as people say the plan.
const PLAN_LABELS: ReadonlyMap<string, string> = lookupTable<string>({
  free: "Free",
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
});

// The permissions, as Cloudflare's token form names them.
export const CLOUDFLARE_ZONE_READ_PERMISSION: string = "Zone > Zone > Read";
export const CLOUDFLARE_ANALYTICS_READ_PERMISSION: string =
  "Zone > Analytics > Read";

export default class CloudflareConnector implements SecurityEventConnector {
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.Cloudflare;

  /*
   * Fifty zones, one query each per poll, a few pages for a busy one, and
   * the zone list and settings reads: well inside Cloudflare's 300 queries
   * in five minutes, and four minutes leave the import room inside the
   * worker's ten minute job.
   */
  public fetchBudget: ConnectorFetchBudget = {
    maxRequests: 120,
    maxEvents: 20000,
    maxDurationMs: 4 * 60 * 1000,
  };

  private transport: ConnectorTransport;
  private clientOptions: {
    baseUrl?: string | undefined;
    now?: (() => number) | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
  };

  public constructor(
    transport?: ConnectorTransport | undefined,
    clientOptions?:
      | {
          baseUrl?: string | undefined;
          now?: (() => number) | undefined;
          sleep?: ((ms: number) => Promise<void>) | undefined;
        }
      | undefined,
  ) {
    this.transport =
      transport ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });
    this.clientOptions = clientOptions || {};
  }

  private static getDefinition(): SecurityEventConnectorDefinition {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.Cloudflare,
      );

    if (!definition) {
      throw new BadDataException(
        "Cloudflare is missing from the connector catalog.",
      );
    }

    return definition;
  }

  // A field's title as the form shows it, read from the catalog.
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

  public static parseSettings(
    settings: SecurityConnectorSettings,
    options: { requireAccount: boolean },
  ): ParsedSettings {
    const apiToken: string = readSettingString(settings.secrets, "apiToken");
    const accountId: string = readSettingString(
      settings.config,
      "accountId",
    ).toLowerCase();
    const zoneIds: Array<string> = readConnectorFieldChoiceValues(
      readSettingString(settings.config, "zoneIds"),
    ).map((zoneId: string): string => {
      return zoneId.toLowerCase();
    });

    if (!apiToken) {
      throw new BadDataException(`${this.fieldTitle("apiToken")} is required.`);
    }

    if (BEARER_PREFIX_REGEX.test(apiToken)) {
      throw new BadDataException(
        `${this.fieldTitle("apiToken")} must be pasted without the 'Bearer' prefix.`,
      );
    }

    /*
     * A Global API Key reads and writes everything the user can, in every
     * account, and cannot be scoped or revoked on its own: the connection
     * takes an API token that only reads.
     */
    if (GLOBAL_API_KEY_REGEX.test(apiToken)) {
      throw new BadDataException(
        `${this.fieldTitle("apiToken")} looks like a Global API Key. Create an API token instead, with only ${CLOUDFLARE_ANALYTICS_READ_PERMISSION} and ${CLOUDFLARE_ZONE_READ_PERMISSION}.`,
      );
    }

    if (!API_TOKEN_REGEX.test(apiToken)) {
      throw new BadDataException(
        `${this.fieldTitle("apiToken")} must be the token value alone: letters, digits, - and _, without spaces.`,
      );
    }

    if (!accountId && options.requireAccount) {
      throw new BadDataException(`${this.fieldTitle("accountId")} is required.`);
    }

    if (accountId && !CLOUDFLARE_ID_REGEX.test(accountId)) {
      throw new BadDataException(
        `${this.fieldTitle("accountId")} must be a Cloudflare account ID: 32 letters and digits.`,
      );
    }

    for (const zoneId of zoneIds) {
      if (!CLOUDFLARE_ID_REGEX.test(zoneId)) {
        throw new BadDataException(
          `${this.fieldTitle("zoneIds")} must hold Cloudflare zone IDs (32 letters and digits each), separated by commas.`,
        );
      }
    }

    if (zoneIds.length > CLOUDFLARE_MAX_ZONES_PER_CONNECTION) {
      throw new BadDataException(
        `${this.fieldTitle("zoneIds")} can hold at most ${CLOUDFLARE_MAX_ZONES_PER_CONNECTION} zones. Add another connection for the rest.`,
      );
    }

    return { apiToken, accountId, zoneIds };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    CloudflareConnector.parseSettings(settings, { requireAccount: true });
  }

  private buildClient(
    apiToken: string,
    requestTimeoutInMs: number,
  ): CloudflareClient {
    return new CloudflareClient({
      apiToken,
      transport: this.transport,
      requestTimeoutInMs,
      ...this.clientOptions,
    });
  }

  /*
   * The accounts and zones the token reads, for the form's pickers. An
   * account is offered when the token reads a zone in it: the zones carry
   * their account, so listing them needs nothing beyond Zone > Zone > Read.
   */
  public async listFieldChoices(
    settings: SecurityConnectorSettings,
    options: ConnectorFieldChoicesOptions,
  ): Promise<Record<string, Array<ConnectorFieldChoice>>> {
    const parsed: ParsedSettings = CloudflareConnector.parseSettings(settings, {
      requireAccount: false,
    });
    const client: CloudflareClient = this.buildClient(
      parsed.apiToken,
      options.requestTimeoutInMs,
    );
    let list: CloudflareZoneList;

    try {
      list = await client.listZones({ maxPages: MAX_ZONE_PAGES_FOR_CHOICES });
    } catch (error) {
      throw new BadDataException(CloudflareConnector.choicesFailure(error));
    }

    if (list.zones.length === 0) {
      throw new BadDataException(
        `The API token reads no zone. Give it ${CLOUDFLARE_ZONE_READ_PERMISSION} and ${CLOUDFLARE_ANALYTICS_READ_PERMISSION} on the zones to import, then try again.`,
      );
    }

    const accounts: Map<string, ConnectorFieldChoice> = new Map<
      string,
      ConnectorFieldChoice
    >();
    const zones: Array<ConnectorFieldChoice> = [];

    for (const zone of list.zones) {
      if (zone.accountId && !accounts.has(zone.accountId)) {
        accounts.set(zone.accountId, {
          value: zone.accountId,
          label: zone.accountName || zone.accountId,
        });
      }

      const plan: string = CloudflareConnector.planLabel(zone);

      zones.push({
        value: zone.id,
        label: zone.name,
        ...(plan ? { description: plan } : {}),
        ...(zone.accountId ? { parentValue: zone.accountId } : {}),
      });
    }

    const byLabel: (a: ConnectorFieldChoice, b: ConnectorFieldChoice) => number = (
      a: ConnectorFieldChoice,
      b: ConnectorFieldChoice,
    ): number => {
      return a.label.localeCompare(b.label);
    };

    return {
      accountId: Array.from(accounts.values()).sort(byLabel),
      zoneIds: zones.sort(byLabel),
    };
  }

  private static choicesFailure(error: unknown): string {
    if (error instanceof CloudflareApiError) {
      if (error.kind === CloudflareFailureKind.InvalidToken) {
        return "Cloudflare did not accept the API token. Check that you pasted the whole token and that it is still active.";
      }

      if (error.kind === CloudflareFailureKind.MissingPermission) {
        return `The API token cannot list zones. Give it ${CLOUDFLARE_ZONE_READ_PERMISSION}, then try again.`;
      }

      if (error.kind === CloudflareFailureKind.RateLimited) {
        return "Cloudflare is rate limiting this token. Wait a few minutes and try again.";
      }
    }

    return `Cloudflare could not be read: ${CloudflareConnector.errorMessage(error)}`;
  }

  /*
   * Five provider checks, in dependency order, each later one skipped when
   * an earlier one fails, so the report names one cause, and names it as a
   * permission when that is what is missing.
   */
  public async testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<ConnectorTestResult> {
    const checks: Array<SecurityConnectorCheck> = [];
    const skipRest: (from: number, reason: string) => void = (
      from: number,
      reason: string,
    ): void => {
      const later: Array<[string, string]> = [
        ["authentication", "Verify the API token"],
        ["zones", "List the zones"],
        ["read-permission", "Read firewall events"],
        ["plan-limits", "What each zone's plan gives"],
        ["detections-available", "Firewall events available to import"],
      ];

      for (const [key, name] of later.slice(from)) {
        checks.push(CloudflareConnector.skipped(key, name, reason));
      }
    };

    let parsed: ParsedSettings;
    let startedAtMs: number = Date.now();

    try {
      parsed = CloudflareConnector.parseSettings(settings, {
        requireAccount: true,
      });
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Verify the API token",
          status: "fail",
          startedAtMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      skipRest(1, "Skipped because the configuration is invalid.");
      return { checks };
    }

    const client: CloudflareClient = this.buildClient(
      parsed.apiToken,
      options.requestTimeoutInMs,
    );

    // 1. The token: live, and not about to expire.
    try {
      const token: CloudflareTokenStatus = await client.verifyToken(
        parsed.accountId,
      );
      const expiresAtMs: number = token.expiresOn
        ? new Date(token.expiresOn).getTime()
        : Number.NaN;

      if (token.status !== "active") {
        checks.push(
          makeCheck({
            key: "authentication",
            name: "Verify the API token",
            status: "fail",
            startedAtMs,
            message: `Cloudflare knows the API token, but it is ${token.status}.`,
            remediation:
              "Create a new API token (or roll this one) in Cloudflare under My Profile > API Tokens, or the account's API Tokens, and paste it with Update credentials.",
          }),
        );
        skipRest(1, "Skipped because the API token is not active.");
        return { checks };
      }

      const expiresSoon: boolean =
        Number.isFinite(expiresAtMs) &&
        expiresAtMs - Date.now() < TOKEN_EXPIRY_WARNING_IN_MS;

      checks.push(
        makeCheck({
          key: "authentication",
          name: "Verify the API token",
          status: expiresSoon ? "warn" : "pass",
          startedAtMs,
          message: token.expiresOn
            ? `Cloudflare accepted the API token. It expires at ${new Date(expiresAtMs).toISOString()}.`
            : "Cloudflare accepted the API token. It does not expire.",
          ...(expiresSoon
            ? {
                remediation:
                  "Roll the token in Cloudflare before it expires, or create one without an end date, and paste it with Update credentials. An expired token stops every poll.",
              }
            : {}),
          details: { tokenOwner: token.owner },
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Verify the API token",
          status: "fail",
          startedAtMs,
          message: CloudflareConnector.errorMessage(error),
          remediation: CloudflareConnector.remediationFor(
            error,
            "authentication",
          ),
        }),
      );
      skipRest(1, "Skipped because the API token was not accepted.");
      return { checks };
    }

    // 2. Zone > Zone > Read: the zones of the account, and the ones chosen.
    startedAtMs = Date.now();
    let selected: Array<CloudflareZone>;

    try {
      const list: CloudflareZoneList = await client.listZones({
        accountId: parsed.accountId,
        maxPages: MAX_ZONE_PAGES_PER_FETCH,
      });
      const resolved: { zones: Array<CloudflareZone>; missing: Array<string> } =
        CloudflareConnector.selectZones(list, parsed);
      selected = resolved.zones;

      if (list.zones.length === 0) {
        checks.push(
          makeCheck({
            key: "zones",
            name: "List the zones",
            status: "fail",
            startedAtMs,
            message:
              "The API token reads no zone in this account. Either the token lacks Zone > Zone > Read, or its zone resources leave out every zone of the account.",
            remediation: `Edit the token in Cloudflare: give it ${CLOUDFLARE_ZONE_READ_PERMISSION} and ${CLOUDFLARE_ANALYTICS_READ_PERMISSION}, and under Zone Resources include the zones to import (or all zones of the account).`,
          }),
        );
        skipRest(2, "Skipped because no zone could be listed.");
        return { checks };
      }

      if (resolved.missing.length > 0) {
        checks.push(
          makeCheck({
            key: "zones",
            name: "List the zones",
            status: "fail",
            startedAtMs,
            message: `The API token no longer reads ${CloudflareConnector.countLabel(resolved.missing.length, "chosen zone")}: ${resolved.missing.join(", ")}. The zone was deleted, moved to another account, or left out of the token's zone resources.`,
            remediation: `Edit the connection and choose the zones again, or give the token ${CLOUDFLARE_ZONE_READ_PERMISSION} on these zones.`,
          }),
        );
        skipRest(2, "Skipped because a chosen zone could not be found.");
        return { checks };
      }

      if (selected.length > CLOUDFLARE_MAX_ZONES_PER_CONNECTION) {
        checks.push(
          makeCheck({
            key: "zones",
            name: "List the zones",
            status: "fail",
            startedAtMs,
            message: `The account has ${selected.length} active zones; one connection reads at most ${CLOUDFLARE_MAX_ZONES_PER_CONNECTION}.`,
            remediation: `Edit the connection and choose up to ${CLOUDFLARE_MAX_ZONES_PER_CONNECTION} zones, and add another connection for the rest.`,
          }),
        );
        skipRest(2, "Skipped because the connection names too many zones.");
        return { checks };
      }

      if (selected.length === 0) {
        checks.push(
          makeCheck({
            key: "zones",
            name: "List the zones",
            status: "fail",
            startedAtMs,
            message:
              "The account has no active zone: Cloudflare acts on requests to a zone only once its nameservers point at Cloudflare.",
            remediation:
              "Finish adding a zone in Cloudflare, or choose another account.",
          }),
        );
        skipRest(2, "Skipped because there is no zone to read.");
        return { checks };
      }

      checks.push(
        makeCheck({
          key: "zones",
          name: "List the zones",
          status: "pass",
          startedAtMs,
          message: `The API token reads ${CloudflareConnector.countLabel(selected.length, "zone")}${parsed.zoneIds.length ? "" : " (every active zone of the account)"}: ${CloudflareConnector.nameZones(selected)}.`,
          details: {
            zoneCount: selected.length,
            readsEveryZone: parsed.zoneIds.length === 0,
          },
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "zones",
          name: "List the zones",
          status: "fail",
          startedAtMs,
          message: CloudflareConnector.errorMessage(error),
          remediation: CloudflareConnector.remediationFor(error, "zones"),
        }),
      );
      skipRest(2, "Skipped because the zones could not be listed.");
      return { checks };
    }

    // 3. Zone > Analytics > Read on every zone, and 4. what each plan gives.
    startedAtMs = Date.now();
    let readable: Array<{
      zone: CloudflareZone;
      settings: CloudflareDatasetSettings;
    }>;

    try {
      const reading: CloudflareSettingsReading =
        await client.readDatasetSettings(
          selected.map((zone: CloudflareZone): string => {
            return zone.id;
          }),
        );
      const refused: Array<CloudflareZone> = selected.filter(
        (zone: CloudflareZone): boolean => {
          return reading.unauthorizedZoneTags.includes(zone.id);
        },
      );

      if (refused.length > 0) {
        checks.push(
          makeCheck({
            key: "read-permission",
            name: "Read firewall events",
            status: "fail",
            startedAtMs,
            message: `The API token cannot read the analytics of ${CloudflareConnector.nameZones(refused)}: it lacks ${CLOUDFLARE_ANALYTICS_READ_PERMISSION} there.`,
            remediation: `Edit the token in Cloudflare and give it ${CLOUDFLARE_ANALYTICS_READ_PERMISSION} on ${refused.length === 1 ? "this zone" : "these zones"}, or choose only the zones it can read.`,
            details: {
              missingPermission: CLOUDFLARE_ANALYTICS_READ_PERMISSION,
              zones: refused.map((zone: CloudflareZone): string => {
                return zone.name;
              }),
            },
          }),
        );
        skipRest(3, "Skipped because a zone's firewall events could not be read.");
        return { checks };
      }

      readable = selected.map((zone: CloudflareZone) => {
        return {
          zone,
          settings:
            reading.settings.find(
              (candidate: CloudflareDatasetSettings): boolean => {
                return candidate.zoneTag === zone.id;
              },
            ) || CloudflareConnector.unknownSettings(zone.id),
        };
      });

      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read firewall events",
          status: "pass",
          startedAtMs,
          message: `The API token reads the firewall events of ${selected.length === 1 ? "the zone" : `all ${selected.length} zones`} through the GraphQL Analytics API.`,
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read firewall events",
          status: "fail",
          startedAtMs,
          message: CloudflareConnector.errorMessage(error),
          remediation: CloudflareConnector.remediationFor(
            error,
            "read-permission",
          ),
        }),
      );
      skipRest(3, "Skipped because firewall events could not be read.");
      return { checks };
    }

    startedAtMs = Date.now();
    const notOffered: Array<CloudflareZone> = readable
      .filter((entry: { settings: CloudflareDatasetSettings }): boolean => {
        return !entry.settings.enabled;
      })
      .map((entry: { zone: CloudflareZone }): CloudflareZone => {
        return entry.zone;
      });
    const plans: Array<JSONObject> = readable.map(
      (entry: {
        zone: CloudflareZone;
        settings: CloudflareDatasetSettings;
      }): JSONObject => {
        return CloudflareConnector.describePlan(entry.zone, entry.settings);
      },
    );

    checks.push(
      makeCheck({
        key: "plan-limits",
        name: "What each zone's plan gives",
        status: notOffered.length ? "warn" : "pass",
        startedAtMs,
        message: notOffered.length
          ? `Cloudflare does not offer firewall events through its API for ${CloudflareConnector.nameZones(notOffered)} on ${notOffered.length === 1 ? "its plan" : "their plans"}. ${CloudflareConnector.planSentence(plans)}`
          : CloudflareConnector.planSentence(plans),
        ...(notOffered.length
          ? {
              remediation:
                "Those zones are skipped until Cloudflare offers their firewall events. Every plan has had them for 31 days; check the zone's plan in Cloudflare.",
            }
          : {}),
        details: { zones: plans },
      }),
    );

    if (options.skipAvailability) {
      return { checks };
    }

    // 5. About how many requests the firewall acted on, last 24 hours and 7 days.
    startedAtMs = Date.now();

    try {
      const offered: Array<{
        zone: CloudflareZone;
        settings: CloudflareDatasetSettings;
      }> = readable.filter(
        (entry: { settings: CloudflareDatasetSettings }): boolean => {
          return entry.settings.enabled;
        },
      );
      const zoneTags: Array<string> = offered.map(
        (entry: { zone: CloudflareZone }): string => {
          return entry.zone.id;
        },
      );
      const now: Date = new Date();
      // A plan whose longest query or reach is shorter than a week counts as far as it reaches.
      const weekMs: number = Math.min(
        7 * DAY_IN_MS,
        ...offered.map(
          (entry: { settings: CloudflareDatasetSettings }): number => {
            return CloudflareConnector.reachInMs(entry.settings);
          },
        ),
      );
      const last24h: Array<CloudflareEventCount> = zoneTags.length
        ? await client.countFirewallEvents({
            zoneTags,
            startTime: new Date(now.getTime() - DAY_IN_MS),
            endTime: now,
          })
        : [];
      const lastWeek: Array<CloudflareEventCount> = zoneTags.length
        ? await client.countFirewallEvents({
            zoneTags,
            startTime: new Date(now.getTime() - weekMs),
            endTime: now,
          })
        : [];
      const total24h: number = CloudflareConnector.sumCounts(last24h);
      const totalWeek: number = CloudflareConnector.sumCounts(lastWeek);
      const weekLabel: string =
        weekMs >= 7 * DAY_IN_MS
          ? "the last 7 days"
          : `the last ${Math.max(1, Math.round(weekMs / DAY_IN_MS))} days`;
      const nothing: boolean = total24h === 0 && totalWeek === 0;

      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Firewall events available to import",
          status: nothing ? "warn" : "pass",
          startedAtMs,
          message: nothing
            ? `Cloudflare's firewall acted on no request in ${selected.length === 1 ? "this zone" : "these zones"} in ${weekLabel}. Polling imports firewall events as they happen.`
            : `About ${total24h} firewall events in the last 24 hours and about ${totalWeek} in ${weekLabel}. Cloudflare samples busy zones, so these counts are estimates.`,
          ...(nothing
            ? {
                remediation:
                  "A zone behind Cloudflare usually sees a blocked or challenged request every day. Check that the zone's traffic goes through Cloudflare (its DNS records are proxied), and that the WAF's rules are on.",
              }
            : {}),
          details: {
            aboutLast24h: total24h,
            aboutLast7d: totalWeek,
          },
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Firewall events available to import",
          status: "fail",
          startedAtMs,
          message: CloudflareConnector.errorMessage(error),
          remediation: CloudflareConnector.remediationFor(
            error,
            "detections-available",
          ),
        }),
      );
    }

    return { checks };
  }

  /*
   * Read every chosen zone's firewall events in the window, oldest first,
   * one page per zone in turn, within the run's bounds. See the top of this
   * file for how a stopped read resumes and what an unreadable zone does.
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const parsed: ParsedSettings = CloudflareConnector.parseSettings(settings, {
      requireAccount: true,
    });
    const client: CloudflareClient = this.buildClient(
      parsed.apiToken,
      options.requestTimeoutInMs,
    );
    const startedAtMs: number = Date.now();
    const deadlineMs: number | undefined =
      options.maxDurationMs !== undefined
        ? startedAtMs + options.maxDurationMs
        : undefined;

    const result: ConnectorFetchResult = {
      events: [],
      fetchedCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      complete: true,
      requestCount: 0,
      warnings: [],
      samples: [],
      checks: [],
    };
    let letThroughWithoutAttack: number = 0;
    let sampledEvents: number = 0;
    let estimatedRequests: number = 0;

    try {
      // The zones: the chosen ones, or every active zone of the account.
      const list: CloudflareZoneList = await client.listZones({
        accountId: parsed.accountId,
        maxPages: MAX_ZONE_PAGES_PER_FETCH,
      });
      const resolved: { zones: Array<CloudflareZone>; missing: Array<string> } =
        CloudflareConnector.selectZones(list, parsed);

      if (resolved.zones.length > CLOUDFLARE_MAX_ZONES_PER_CONNECTION) {
        throw new BadDataException(
          `The account has ${resolved.zones.length} active zones; one Cloudflare connection reads at most ${CLOUDFLARE_MAX_ZONES_PER_CONNECTION}. Edit the connection and choose up to ${CLOUDFLARE_MAX_ZONES_PER_CONNECTION} zones, and add another connection for the rest.`,
        );
      }

      if (resolved.zones.length === 0) {
        throw new BadDataException(
          resolved.missing.length
            ? `The API token no longer reads the chosen zones (${resolved.missing.join(", ")}). Edit the connection and choose the zones again, or give the token ${CLOUDFLARE_ZONE_READ_PERMISSION} on them.`
            : "The API token reads no active zone in this account. Edit the connection, or give the token Zone > Zone > Read on the account's zones.",
        );
      }

      if (resolved.missing.length > 0) {
        result.complete = false;
        result.warnings.push(
          `The API token no longer reads ${CloudflareConnector.countLabel(resolved.missing.length, "chosen zone")} (${resolved.missing.join(", ")}); their firewall events were not imported. Edit the connection and choose the zones again.`,
        );
      }

      // What each zone's plan allows, and which zones the token may read.
      const reading: CloudflareSettingsReading =
        await client.readDatasetSettings(
          resolved.zones.map((zone: CloudflareZone): string => {
            return zone.id;
          }),
        );
      const refused: Array<CloudflareZone> = [];
      const notOffered: Array<CloudflareZone> = [];
      const reads: Array<ZoneRead> = [];

      for (const zone of resolved.zones) {
        if (reading.unauthorizedZoneTags.includes(zone.id)) {
          refused.push(zone);
          continue;
        }

        const zoneSettings: CloudflareDatasetSettings =
          reading.settings.find(
            (candidate: CloudflareDatasetSettings): boolean => {
              return candidate.zoneTag === zone.id;
            },
          ) || CloudflareConnector.unknownSettings(zone.id);

        if (!zoneSettings.enabled) {
          notOffered.push(zone);
          continue;
        }

        const zoneRead: ZoneRead | null = CloudflareConnector.planZoneRead({
          zone,
          settings: zoneSettings,
          window,
          maxEvents: options.maxEvents,
          warnings: result.warnings,
        });

        if (zoneRead) {
          reads.push(zoneRead);
        }
      }

      if (reads.length === 0 && refused.length > 0) {
        throw new CloudflareApiError({
          message: `The API token cannot read the analytics of ${CloudflareConnector.nameZones(refused)}: it lacks ${CLOUDFLARE_ANALYTICS_READ_PERMISSION}. Give it that permission on the zones to import.`,
          kind: CloudflareFailureKind.MissingPermission,
          statusCode: 403,
          unauthorizedZoneTags: refused.map((zone: CloudflareZone): string => {
            return zone.id;
          }),
        });
      }

      if (notOffered.length > 0) {
        result.checks!.push(
          makeCheck({
            key: "plan-limits",
            name: "Zones whose plan has no firewall events",
            status: "warn",
            startedAtMs,
            message: `Cloudflare does not offer firewall events through its API for ${CloudflareConnector.nameZones(notOffered)}; ${notOffered.length === 1 ? "it was" : "they were"} skipped.`,
            remediation:
              "Every plan has had firewall events for 31 days; check the zone's plan in Cloudflare.",
          }),
        );
      }

      // One page per zone in turn, until every zone is read or a bound stops the run.
      let stopReason: StopReason | undefined = undefined;
      let rateLimitWaitInMs: number | undefined = undefined;
      const seenUids: Set<string> = new Set<string>();

      pages: for (;;) {
        const pending: Array<ZoneRead> = reads.filter(
          (zoneRead: ZoneRead): boolean => {
            return !zoneRead.done;
          },
        );

        if (pending.length === 0) {
          break;
        }

        for (const zoneRead of pending) {
          if (client.getRequestCount() >= options.maxRequests) {
            stopReason = "requests";
            break pages;
          }

          if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
            stopReason = "time";
            break pages;
          }

          const current: { startTime: Date; endTime: Date } =
            zoneRead.windows[0]!;
          let rows: Array<JSONObject>;

          try {
            rows = await client.listFirewallEvents({
              zoneTag: zoneRead.zone.id,
              startTime: current.startTime,
              endTime: current.endTime,
              limit: zoneRead.pageSize,
              fields: zoneRead.fields,
              after: zoneRead.after,
            });
          } catch (error) {
            if (
              error instanceof CloudflareApiError &&
              error.kind === CloudflareFailureKind.RateLimited
            ) {
              stopReason = "rate-limit";
              rateLimitWaitInMs = error.waitInMs;
              break pages;
            }

            // A zone that stopped being readable mid-run does not stop the rest.
            if (
              error instanceof CloudflareApiError &&
              error.kind === CloudflareFailureKind.MissingPermission
            ) {
              zoneRead.done = true;
              refused.push(zoneRead.zone);
              continue;
            }

            throw error;
          }

          let reachedEventBound: boolean = false;

          for (const row of rows) {
            if (!CloudflareNormalizer.isRecognized(row)) {
              result.rejectedCount += 1;
              continue;
            }

            const uid: string = CloudflareNormalizer.eventUid(
              row,
              zoneRead.context,
            );

            if (seenUids.has(uid)) {
              continue;
            }

            if (result.fetchedCount >= options.maxEvents) {
              reachedEventBound = true;
              break;
            }

            seenUids.add(uid);
            result.fetchedCount += 1;
            zoneRead.eventsRead += 1;

            const edgeTime: Date = new Date(String(row["datetime"]));

            if (!Number.isNaN(edgeTime.getTime())) {
              zoneRead.lastEventTime = edgeTime;
            }

            const sampleInterval: number = readEdgeSampleInterval(
              row["sampleInterval"],
            );
            estimatedRequests += sampleInterval;

            if (sampleInterval > 1) {
              sampledEvents += 1;
            }

            if (!CloudflareNormalizer.isSecurityRelevant(row)) {
              letThroughWithoutAttack += 1;
              continue;
            }

            this.collect(row, zoneRead.context, result, options.sampleLimit);
          }

          if (reachedEventBound) {
            stopReason = "events";
            break pages;
          }

          const lastRow: JSONObject | undefined = rows[rows.length - 1];
          const key: CloudflareEventKey | null = lastRow
            ? CloudflareClient.readEventKey(lastRow)
            : null;
          const madeNoProgress: boolean = Boolean(
            key &&
              zoneRead.after &&
              key.datetime === zoneRead.after.datetime &&
              key.rayName === zoneRead.after.rayName &&
              key.matchIndex === zoneRead.after.matchIndex,
          );

          if (madeNoProgress) {
            /*
             * Cloudflare answered the same last row as the page before: the
             * "after" filter did not move the read on. Stop this zone rather
             * than ask for the same page forever, and say so.
             */
            result.warnings.push(
              `Cloudflare returned the same page of ${zoneRead.zone.name}'s firewall events twice; the rest of its window was not read.`,
            );
            zoneRead.done = true;
            result.complete = false;
            continue;
          }

          if (rows.length < zoneRead.pageSize || !key) {
            // This window is read: on to the zone's next one, if its plan split the window.
            zoneRead.windows.shift();
            zoneRead.after = undefined;

            if (zoneRead.windows.length === 0) {
              zoneRead.done = true;
            }

            continue;
          }

          zoneRead.after = key;
        }
      }

      result.requestCount = client.getRequestCount();

      if (refused.length > 0) {
        result.checks!.push(
          makeCheck({
            key: "read-permission",
            name: "Read firewall events",
            status: "warn",
            startedAtMs,
            message: `The API token cannot read the analytics of ${CloudflareConnector.nameZones(refused)}; ${refused.length === 1 ? "its" : "their"} firewall events in this window were not imported.`,
            remediation: `Give the token ${CLOUDFLARE_ANALYTICS_READ_PERMISSION} on ${refused.length === 1 ? "this zone" : "these zones"}, then use Import this time range to recover the window.`,
          }),
        );
        result.warnings.push(
          `The API token cannot read the analytics of ${CloudflareConnector.nameZones(refused)} (it lacks ${CLOUDFLARE_ANALYTICS_READ_PERMISSION}); firewall events from ${window.startTime.toISOString()} to ${window.endTime.toISOString()} there were not imported. Give the token that permission, then use Import this time range to recover them.`,
        );
      }

      if (stopReason) {
        result.complete = false;
        const unfinished: Array<ZoneRead> = reads.filter(
          (zoneRead: ZoneRead): boolean => {
            return !zoneRead.done;
          },
        );
        const resumeAfter: Date | undefined =
          CloudflareConnector.oldestProgress(unfinished);

        if (stopReason === "rate-limit" && !resumeAfter) {
          /*
           * Stopped by Cloudflare's rate limit before every zone was read
           * once: nothing to resume from. A failed run holds the cursor, and
           * the next poll asks again once the limit has passed.
           */
          throw new CloudflareApiError({
            message: `Cloudflare's rate limit stopped the read before every zone was read${rateLimitWaitInMs ? ` (Cloudflare asked to wait ${Math.ceil(rateLimitWaitInMs / SECOND_IN_MS)} seconds)` : ""}. The next poll reads the same window again.`,
            kind: CloudflareFailureKind.RateLimited,
            statusCode: 429,
            waitInMs: rateLimitWaitInMs,
          });
        }

        result.resumeAfter = resumeAfter;
        result.warnings.push(
          `${CloudflareConnector.stopSentence(stopReason, options, rateLimitWaitInMs)} ${resumeAfter ? `Every zone was read up to ${resumeAfter.toISOString()}.` : "Not every zone could be read once, so no resume point is reported."}`,
        );
      } else if (refused.length > 0) {
        /*
         * Every readable zone was read to the window's end; only the zones
         * the token may not read are missing. The run is Partial and says
         * so in Last Error, and polling moves on past the window rather than
         * hold every other zone's events behind a permission only a person
         * can grant.
         */
        result.complete = false;
        result.resumeAfter = window.endTime;
      } else if (!result.complete && resolved.missing.length > 0) {
        result.resumeAfter = window.endTime;
      }

      if (letThroughWithoutAttack > 0) {
        result.checks!.push(
          makeCheck({
            key: "let-through",
            name: "Requests your own rules let through",
            status: "pass",
            startedAtMs,
            message: `${letThroughWithoutAttack} requests that a skip or allow rule of yours let through carried no attack, and were left out.`,
          }),
        );
      }

      result.details = {
        accountId: parsed.accountId,
        readsEveryZone: parsed.zoneIds.length === 0,
        zones: reads.map((zoneRead: ZoneRead): JSONObject => {
          return {
            id: zoneRead.zone.id,
            name: zoneRead.zone.name,
            plan: CloudflareConnector.planLabel(zoneRead.zone),
            eventsRead: zoneRead.eventsRead,
            isRead: zoneRead.done,
          };
        }),
        unreadableZones: refused.map((zone: CloudflareZone): string => {
          return zone.name;
        }),
        zonesWithoutFirewallEvents: notOffered.map(
          (zone: CloudflareZone): string => {
            return zone.name;
          },
        ),
        letThroughWithoutAttack,
        sampledEvents,
        estimatedRequests,
      };

      return result;
    } catch (error) {
      throw attachConnectorFetchSummary(error, {
        warnings: result.warnings,
        requestCount: client.getRequestCount(),
        fetchedCount: result.fetchedCount,
        details: { letThroughWithoutAttack, sampledEvents, estimatedRequests },
      });
    }
  }

  /*
   * How one zone is read: its fields and page size by what its plan allows,
   * and the window split where the plan's longest query is shorter, started
   * no earlier than the plan keeps events. Null for a zone none of the
   * window reaches.
   */
  private static planZoneRead(data: {
    zone: CloudflareZone;
    settings: CloudflareDatasetSettings;
    window: ConnectorFetchWindow;
    maxEvents: number;
    warnings: Array<string>;
  }): ZoneRead | null {
    const { zone, settings, window } = data;
    const nowMs: number = Date.now();
    let startMs: number = window.startTime.getTime();
    const endMs: number = Math.min(window.endTime.getTime(), nowMs);

    if (settings.notOlderThanSeconds) {
      const oldestMs: number =
        nowMs - settings.notOlderThanSeconds * SECOND_IN_MS +
        RETENTION_MARGIN_IN_MS;

      if (startMs < oldestMs) {
        data.warnings.push(
          `Cloudflare keeps ${zone.name}'s firewall events for ${CloudflareConnector.describeSeconds(settings.notOlderThanSeconds)}; the part of the window before ${new Date(oldestMs).toISOString()} could not be read there.`,
        );
        startMs = oldestMs;
      }
    }

    if (startMs >= endMs) {
      return null;
    }

    const maxWindowMs: number = settings.maxDurationSeconds
      ? settings.maxDurationSeconds * SECOND_IN_MS
      : endMs - startMs;
    const windows: Array<{ startTime: Date; endTime: Date }> = [];

    for (let from: number = startMs; from < endMs; from += maxWindowMs) {
      windows.push({
        startTime: new Date(from),
        endTime: new Date(Math.min(endMs, from + maxWindowMs)),
      });
    }

    return {
      zone,
      context: { zoneTag: zone.id, zoneName: zone.name },
      fields: CloudflareConnector.fieldsFor(settings),
      pageSize: Math.max(
        1,
        Math.min(
          CLOUDFLARE_MAX_ROWS_PER_PAGE,
          settings.maxPageSize || CLOUDFLARE_DEFAULT_MAX_PAGE_SIZE,
          Math.max(1, Math.trunc(data.maxEvents)),
        ),
      ),
      windows,
      after: undefined,
      done: false,
      lastEventTime: undefined,
      eventsRead: 0,
    };
  }

  /*
   * The fields a zone's plan lets a query read, most needed first, as many
   * as one query may name.
   */
  public static fieldsFor(settings: CloudflareDatasetSettings): Array<string> {
    const available: Set<string> | null = settings.availableFields
      ? new Set<string>(settings.availableFields)
      : null;
    const max: number =
      settings.maxNumberOfFields || CLOUDFLARE_DEFAULT_MAX_FIELDS;

    return [
      ...CLOUDFLARE_REQUIRED_EVENT_FIELDS,
      ...CLOUDFLARE_OPTIONAL_EVENT_FIELDS,
    ]
      .filter((field: string): boolean => {
        return !available || available.has(field);
      })
      .slice(0, max);
  }

  // The zones a fetch or a test reads: the chosen ones, or every active zone.
  public static selectZones(
    list: CloudflareZoneList,
    parsed: ParsedSettings,
  ): { zones: Array<CloudflareZone>; missing: Array<string> } {
    if (parsed.zoneIds.length === 0) {
      return {
        zones: list.zones.filter((zone: CloudflareZone): boolean => {
          return zone.status === "" || zone.status === "active";
        }),
        missing: [],
      };
    }

    const zones: Array<CloudflareZone> = [];
    const missing: Array<string> = [];

    for (const zoneId of parsed.zoneIds) {
      const zone: CloudflareZone | undefined = list.zones.find(
        (candidate: CloudflareZone): boolean => {
          return candidate.id === zoneId;
        },
      );

      if (zone) {
        zones.push(zone);
      } else {
        missing.push(zoneId);
      }
    }

    return { zones, missing };
  }

  // The oldest edge time every unfinished zone was read to, or undefined when one read nothing.
  private static oldestProgress(
    unfinished: Array<ZoneRead>,
  ): Date | undefined {
    let oldest: Date | undefined = undefined;

    for (const zoneRead of unfinished) {
      if (!zoneRead.lastEventTime) {
        return undefined;
      }

      if (!oldest || zoneRead.lastEventTime.getTime() < oldest.getTime()) {
        oldest = zoneRead.lastEventTime;
      }
    }

    return oldest;
  }

  private static stopSentence(
    reason: StopReason,
    options: ConnectorFetchOptions,
    rateLimitWaitInMs: number | undefined,
  ): string {
    switch (reason) {
      case "requests":
        return `Stopped after ${options.maxRequests} requests with firewall events still unread.`;
      case "events":
        return `Stopped after reading ${options.maxEvents} firewall events; the window holds more.`;
      case "time":
        return `Stopped after ${Math.round((options.maxDurationMs || 0) / SECOND_IN_MS)} seconds with firewall events still unread.`;
      case "rate-limit":
        return `Cloudflare's rate limit stopped the read${rateLimitWaitInMs ? ` (it asked to wait ${Math.ceil(rateLimitWaitInMs / SECOND_IN_MS)} seconds)` : ""}.`;
    }
  }

  private collect(
    raw: JSONObject,
    zone: CloudflareZoneContext,
    result: ConnectorFetchResult,
    sampleLimit: number,
  ): void {
    let normalized: NormalizedSecurityEvent;

    try {
      normalized = CloudflareNormalizer.normalize(raw, zone);
    } catch (error) {
      result.failedCount += 1;

      if (result.warnings.length < MAX_NORMALIZATION_WARNINGS) {
        result.warnings.push(
          `Firewall event ${String(raw["rayName"] || "(no Ray ID)")} could not be normalized: ${redactLogString(ConnectorErrorMessage.toMessage(error))}`,
        );
      }

      return;
    }

    result.events.push(normalized);

    if (result.samples.length < sampleLimit) {
      const sample: SecurityConnectorSample = {
        id: normalized.eventUid,
        title: normalized.message,
        severity: normalized.severityName,
        createdTime: normalized.time.toISOString(),
        eventTime: normalized.time.toISOString(),
      };
      result.samples.push(sample);
    }
  }

  private static unknownSettings(zoneTag: string): CloudflareDatasetSettings {
    return {
      zoneTag,
      // A zone the settings node said nothing about is read as every plan allows.
      enabled: true,
      maxDurationSeconds: null,
      maxPageSize: null,
      notOlderThanSeconds: null,
      maxNumberOfFields: null,
      availableFields: null,
    };
  }

  // How long a plan lets a query reach back and span, the shorter of the two.
  private static reachInMs(settings: CloudflareDatasetSettings): number {
    const reaches: Array<number> = [
      settings.notOlderThanSeconds,
      settings.maxDurationSeconds,
    ]
      .filter((value: number | null): value is number => {
        return typeof value === "number" && value > 0;
      })
      .map((seconds: number): number => {
        return seconds * SECOND_IN_MS - RETENTION_MARGIN_IN_MS;
      });

    return reaches.length ? Math.min(...reaches) : 7 * DAY_IN_MS;
  }

  // A plan's reach in days, or in hours when it is shorter than a day.
  private static describeSeconds(seconds: number): string {
    if (seconds >= 86400) {
      const days: number = Math.round(seconds / 86400);
      return `${days} day${days === 1 ? "" : "s"}`;
    }

    const hours: number = Math.max(1, Math.round(seconds / 3600));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  // A zone's plan as people say it: Free, Pro, Business, Enterprise.
  public static planLabel(zone: CloudflareZone): string {
    return (
      PLAN_LABELS.get(zone.planLegacyId.toLowerCase()) ||
      zone.planName.replace(/\s+Website$/i, "").trim()
    );
  }

  // What one zone's plan gives of the firewall events dataset, for the report and the page.
  public static describePlan(
    zone: CloudflareZone,
    settings: CloudflareDatasetSettings,
  ): JSONObject {
    return {
      zone: zone.name,
      plan: CloudflareConnector.planLabel(zone),
      firewallEvents: settings.enabled,
      ...(settings.notOlderThanSeconds
        ? {
            keepsDays: Math.round(settings.notOlderThanSeconds / 86400),
          }
        : {}),
      ...(settings.maxDurationSeconds
        ? {
            queryReachesDays:
              Math.round((settings.maxDurationSeconds / 86400) * 10) / 10,
          }
        : {}),
      ...(settings.maxPageSize ? { maxPageSize: settings.maxPageSize } : {}),
    };
  }

  // One sentence for what the plans give, grouped where zones' plans give the same.
  private static planSentence(plans: Array<JSONObject>): string {
    const groups: Map<string, Array<string>> = new Map<string, Array<string>>();

    for (const plan of plans) {
      if (plan["firewallEvents"] !== true) {
        continue;
      }

      const parts: Array<string> = [];

      if (typeof plan["keepsDays"] === "number") {
        parts.push(`firewall events for ${plan["keepsDays"]} days`);
      }

      if (typeof plan["queryReachesDays"] === "number") {
        parts.push(`up to ${plan["queryReachesDays"]} days a query`);
      }

      const key: string = `${plan["plan"] || "Unknown"}|${parts.join(", ") || "firewall events"}`;
      const zones: Array<string> = groups.get(key) || [];
      zones.push(String(plan["zone"]));
      groups.set(key, zones);
    }

    const sentences: Array<string> = [];

    for (const [key, zones] of groups.entries()) {
      const [plan, gives] = key.split("|");
      sentences.push(
        `${CloudflareConnector.nameList(zones)} (${plan}): ${gives}.`,
      );
    }

    return sentences.join(" ") || "Cloudflare gave no plan limits.";
  }

  private static sumCounts(counts: Array<CloudflareEventCount>): number {
    let total: number = 0;

    for (const count of counts) {
      total += count.count;
    }

    return Math.round(total);
  }

  private static nameZones(zones: Array<CloudflareZone>): string {
    return CloudflareConnector.nameList(
      zones.map((zone: CloudflareZone): string => {
        return zone.name;
      }),
    );
  }

  private static nameList(names: Array<string>): string {
    if (names.length <= MAX_ZONES_NAMED) {
      return names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : names.join("");
    }

    return `${names.slice(0, MAX_ZONES_NAMED).join(", ")} and ${names.length - MAX_ZONES_NAMED} more`;
  }

  private static countLabel(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  private static skipped(
    key: string,
    name: string,
    message: string,
  ): SecurityConnectorCheck {
    return makeCheck({
      key,
      name,
      status: "skip",
      startedAtMs: Date.now(),
      message,
    });
  }

  private static errorMessage(error: unknown): string {
    return redactLogString(
      ConnectorErrorMessage.toMessage(error, { truncate: false }),
    );
  }

  /*
   * Remediation by what went wrong, and where: a refusal after the token was
   * accepted is a missing permission, and names it.
   */
  private static remediationFor(
    error: unknown,
    step: "authentication" | "zones" | "read-permission" | "detections-available",
  ): string {
    const kind: CloudflareFailureKind | undefined =
      error instanceof CloudflareApiError ? error.kind : undefined;

    if (kind === CloudflareFailureKind.InvalidToken) {
      return "Cloudflare did not accept the API token. Check that you pasted the whole token (not a Global API Key), that it is active and has not expired, and that its IP filtering lets OneUptime's addresses in. Then paste it with Update credentials.";
    }

    if (kind === CloudflareFailureKind.MissingPermission) {
      if (step === "zones" || step === "authentication") {
        return `Edit the token in Cloudflare and give it ${CLOUDFLARE_ZONE_READ_PERMISSION}, with the zones to import under Zone Resources.`;
      }

      return `Edit the token in Cloudflare and give it ${CLOUDFLARE_ANALYTICS_READ_PERMISSION} on the zones to import.`;
    }

    if (kind === CloudflareFailureKind.RateLimited) {
      return "Cloudflare is rate limiting this token: its REST API allows 1,200 requests and its GraphQL Analytics API 300 queries in five minutes, for everything the token's user runs. Wait a few minutes and test again; scheduled polls retry on their own.";
    }

    if (kind === CloudflareFailureKind.Unavailable) {
      return "Cloudflare failed for now. Test again in a few minutes; if it persists, check cloudflarestatus.com.";
    }

    if (kind === CloudflareFailureKind.Unreachable) {
      return "OneUptime could not get an answer from api.cloudflare.com. Check that the OneUptime API and worker processes can reach it over HTTPS, through any proxy in between.";
    }

    if (step === "detections-available") {
      return "Counting firewall events failed after they could be read. Test again; scheduled polls do not depend on this count.";
    }

    return "Cloudflare refused the request. Copy the message for support: the request is built by OneUptime, not from your settings.";
  }
}
