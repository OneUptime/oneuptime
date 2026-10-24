import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  MerakiRegionDefinition,
  getMerakiRegionOrDefault,
} from "../../../../Types/NetworkController/MerakiRegion";
import { MAX_READ_SUMMARY_WARNINGS } from "../../../../Types/NetworkController/NetworkControllerReadSummary";
import { NetworkTrafficUsageKind } from "../../../../Types/NetFlow/NetworkTrafficUsage";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  NetworkControllerAppliance,
  NetworkControllerPullState,
  NetworkControllerReadOptions,
  NetworkControllerReadResult,
  NetworkControllerSettings,
  NetworkTrafficUsageRecord,
  NetworkTrafficUsageWindowKey,
} from "../NetworkControllerTypes";
import MerakiApiClient, {
  MerakiBudgetSpent,
  MerakiList,
  MerakiPage,
  buildMerakiQuery,
} from "./MerakiApiClient";
import {
  TEXT_LIMITS,
  buildApplicationRecords,
  buildClientRecords,
  buildUplinkRecords,
  cleanText,
  readAppliances,
} from "./MerakiUsageRecords";

/*
 * ONE READ OF ONE MERAKI ORGANIZATION.
 *
 * What the Meraki dashboard API can tell, and how often it is asked
 * (OneUptime issue #5140 - the research is in the PR that added this):
 *
 *   1. the organization, its networks and its appliances (MX, Z): three
 *      listings of 1,000 a page, so 1,200 devices are a few calls;
 *   2. uplink usage, for EVERY appliance of the organization in one call
 *      (organizations/{id}/appliance/uplinks/usage/byNetwork, any window of
 *      up to 14 days in the last 30): read in five-minute windows, each
 *      ending five minutes ago - long enough for Meraki to have counted it -
 *      so the chart is five minutes fine and a read costs one call per
 *      window however many sites there are;
 *   3. per network, every two hours: traffic analytics (networks/{id}/
 *      traffic - application, destination, protocol, port, bytes, flows,
 *      clients - Meraki's own aggregates, two hours at least, only where
 *      traffic analysis is turned on) and client usage (networks/{id}/
 *      clients, 5,000 a page). A window starts where the network's last one
 *      ended and ends when it is asked for.
 *
 * None of it is flow records: the API never says who talked to whom.
 *
 * Incremental: the state says where the last uplink window and each
 * network's last analytics window ended. After a long pause at most a day
 * is read back, and the gap is said in the warnings, never filled with a
 * guess. Budgeted: a read stops at its request and time limits and the next
 * carries on - a large organization's networks are read over several
 * reads - and the client paces every request (MerakiApiClient). A network
 * that cannot be read is skipped with a warning and asked again next time;
 * a rate limit that outlasts its retries stops the read where it is, with
 * what it read kept; the organization itself not being readable, or the
 * key being refused, fails the read.
 */

export const UPLINK_WINDOW_MS: number = 5 * 60 * 1000;
// Uplink usage is read this long after it happens.
export const UPLINK_LAG_MS: number = 5 * 60 * 1000;
const HOUR_MS: number = 60 * 60 * 1000;
// A first read, or one after a long pause, starts at most this far back.
export const BACKFILL_MS: number = 24 * HOUR_MS;
// Uplink windows one read stores at most.
export const MAX_UPLINK_WINDOWS_PER_READ: number = 60;
// Meraki's traffic analytics cover at least this long.
export const ANALYTICS_WINDOW_MS: number = 2 * HOUR_MS;
// A network whose traffic analysis is off is asked again after this.
export const TRAFFIC_ANALYSIS_RETRY_MS: number = 24 * HOUR_MS;
export const LIST_PAGE_SIZE: number = 1000;
export const CLIENT_PAGE_SIZE: number = 5000;
export const MAX_LIST_PAGES: number = 50;
export const MAX_CLIENT_PAGES: number = 4;
// Networks in a row whose calls failed because Meraki is down: stop there.
export const MAX_UNAVAILABLE_NETWORKS_IN_A_ROW: number = 3;

export const STOPPED_ANSWERING_WARNING: string =
  "Meraki's API stopped answering part way through: the next read carries on where this one stopped.";
export const RATE_LIMITED_WARNING: string =
  "Meraki asked OneUptime to slow down during this read: the organization's API budget is shared with every application that reads it.";
export const NO_APPLIANCE_WARNING: string =
  "The organization has no MX or Z appliance, so there is no uplink usage to read: only applications and clients are shown.";
export const ANALYTICS_GAP_WARNING: string =
  "Some networks' applications and clients were not read for more than a day: only the last day is read back.";

/*
 * The product types whose networks carry traffic. A network of cameras,
 * sensors or Systems Manager alone has none to read.
 */
const TRAFFIC_PRODUCT_TYPES: ReadonlySet<string> = new Set<string>([
  "appliance",
  "switch",
  "wireless",
  "cellularGateway",
  "wirelessController",
  "campusGateway",
]);

export interface MerakiNetwork {
  id: string;
  name: string;
  hasTraffic: boolean;
}

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function iso(date: Date): string {
  return date.toISOString();
}

function toTime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

// The networks of an organization's listing, each with whether it carries traffic.
export function readNetworks(values: Array<unknown>): Array<MerakiNetwork> {
  const networks: Array<MerakiNetwork> = [];
  const seen: Set<string> = new Set();

  for (const value of values) {
    const network: JSONObject | null = asObject(value);

    if (!network) {
      continue;
    }

    const id: string = cleanText(network["id"], TEXT_LIMITS.networkId);

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);

    const productTypes: unknown = network["productTypes"];

    networks.push({
      id: id,
      name: cleanText(network["name"], TEXT_LIMITS.networkName),
      hasTraffic: Array.isArray(productTypes)
        ? productTypes.some((type: unknown): boolean => {
            return typeof type === "string" && TRAFFIC_PRODUCT_TYPES.has(type);
          })
        : true,
    });
  }

  return networks;
}

/*
 * The uplink windows a read covers: from where the last one ended (or a day
 * back, for a first read or after a long pause) to five minutes ago, in
 * hour-long windows while a whole hour is behind and five-minute windows
 * after that, each aligned to its own length, at most
 * MAX_UPLINK_WINDOWS_PER_READ. `gapFrom` is set when the cursor was further
 * back than a day: traffic before the new start is not read.
 */
export function planUplinkWindows(data: {
  cursor: string | undefined;
  now: Date;
}): {
  windows: Array<{ start: Date; end: Date }>;
  gapFrom: Date | null;
} {
  const latestEnd: number =
    Math.floor((data.now.getTime() - UPLINK_LAG_MS) / UPLINK_WINDOW_MS) *
    UPLINK_WINDOW_MS;
  const earliestStart: number =
    Math.floor((data.now.getTime() - BACKFILL_MS) / HOUR_MS) * HOUR_MS;

  const cursorTime: number | null = toTime(data.cursor);
  let start: number =
    cursorTime === null
      ? earliestStart
      : Math.floor(cursorTime / UPLINK_WINDOW_MS) * UPLINK_WINDOW_MS;
  let gapFrom: Date | null = null;

  if (start < earliestStart) {
    gapFrom = new Date(start);
    start = earliestStart;
  }

  const windows: Array<{ start: Date; end: Date }> = [];

  while (start < latestEnd && windows.length < MAX_UPLINK_WINDOWS_PER_READ) {
    const end: number =
      start % HOUR_MS === 0 && latestEnd - start >= HOUR_MS
        ? start + HOUR_MS
        : start + UPLINK_WINDOW_MS;

    windows.push({ start: new Date(start), end: new Date(end) });
    start = end;
  }

  return { windows, gapFrom };
}

/*
 * Where a network's next analytics window starts, and whether it is due:
 * two hours after the last one ended (a first one reads the last day).
 */
export function getAnalyticsStart(data: {
  cursor: string | undefined;
  now: Date;
}): { start: Date; isDue: boolean; hadGap: boolean } {
  const earliest: number = data.now.getTime() - BACKFILL_MS;
  const cursorTime: number | null = toTime(data.cursor);
  let start: number = cursorTime === null ? earliest : cursorTime;
  let hadGap: boolean = false;

  if (start < earliest) {
    start = earliest;
    hadGap = cursorTime !== null;
  }

  return {
    start: new Date(start),
    isDue: data.now.getTime() - start >= ANALYTICS_WINDOW_MS,
    hadGap,
  };
}

/*
 * Whether an answer to a network's traffic analytics means "traffic
 * analysis is off on this network": Meraki answers such a network with an
 * error naming traffic analysis.
 */
export function isTrafficAnalysisOff(error: unknown): boolean {
  if (!(error instanceof LlmProviderError)) {
    return false;
  }

  if (
    error.statusCode !== 400 &&
    error.statusCode !== 403 &&
    error.statusCode !== 404
  ) {
    return false;
  }

  return `${error.message} ${error.responseBody || ""}`
    .toLowerCase()
    .includes("traffic analysis");
}

function asProviderError(error: unknown, step: string): LlmProviderError {
  return error instanceof LlmProviderError
    ? error
    : LlmProviderError.from({ error, step, providerTitle: "Meraki" });
}

class Warnings {
  private readonly items: Array<string> = [];

  public add(text: string): void {
    if (
      !this.items.includes(text) &&
      this.items.length < MAX_READ_SUMMARY_WARNINGS
    ) {
      this.items.push(text);
    }
  }

  public list(): Array<string> {
    return [...this.items];
  }
}

// The read ends here, keeping what it read (a rate limit that outlasted its retries).
class StopRead extends Error {
  public constructor() {
    super("The read stops here.");
    this.name = "StopRead";
  }
}

// Meraki could not be reached for one network's call.
class NetworkUnavailable extends Error {
  public constructor() {
    super("Meraki could not be reached.");
    this.name = "NetworkUnavailable";
  }
}

// What one read is building as it goes.
interface ReadProgress {
  client: MerakiApiClient;
  clock: () => Date;
  now: Date;
  orgPath: string;
  state: NetworkControllerPullState;
  warnings: Warnings;
  records: Array<NetworkTrafficUsageRecord>;
  windows: Array<NetworkTrafficUsageWindowKey>;
  complete: boolean;
  uplinkWindows: number;
  newestUplinkAt: Date | undefined;
  analyticsNetworks: number;
  analyticsDue: number;
}

export default class MerakiTrafficReader {
  public static async read(
    settings: NetworkControllerSettings,
    options: NetworkControllerReadOptions,
  ): Promise<NetworkControllerReadResult> {
    const clock: () => Date =
      options.now ||
      ((): Date => {
        return new Date();
      });
    const now: Date = clock();
    const region: MerakiRegionDefinition = getMerakiRegionOrDefault(
      settings.config.region,
    );
    const organizationId: string = settings.config.organizationId;

    if (!organizationId) {
      throw new LlmProviderError({
        message:
          "The connection names no Meraki organization. Edit it and pick one.",
        kind: LlmConnectionFailureKind.Settings,
      });
    }

    const progress: ReadProgress = {
      client: new MerakiApiClient({
        apiKey: settings.apiKey,
        region,
        transport: options.transport,
        now: clock,
        sleep: options.sleep,
        maxRequests: options.maxRequests,
        deadlineMs: now.getTime() + options.maxDurationMs,
        requestTimeoutInMs: options.requestTimeoutInMs,
      }),
      clock,
      now,
      orgPath: `/organizations/${encodeURIComponent(organizationId)}`,
      state: {
        ...(options.state.uplinkCursor
          ? { uplinkCursor: options.state.uplinkCursor }
          : {}),
        analyticsCursors: { ...(options.state.analyticsCursors || {}) },
        trafficAnalysisOff: { ...(options.state.trafficAnalysisOff || {}) },
      },
      warnings: new Warnings(),
      records: [],
      windows: [],
      complete: true,
      uplinkWindows: 0,
      newestUplinkAt: undefined,
      analyticsNetworks: 0,
      analyticsDue: 0,
    };

    /*
     * 1. The organization, its networks and its appliances. A failure here
     * fails the read: without them nothing below can be read or named.
     */
    const organization: MerakiPage = await progress.client.get(
      progress.orgPath,
      "",
      "organization",
    );
    const organizationName: string = cleanText(
      asObject(organization.body)?.["name"],
      TEXT_LIMITS.networkName,
    );

    const networkList: MerakiList = await progress.client.getAll(
      `${progress.orgPath}/networks`,
      buildMerakiQuery([["perPage", LIST_PAGE_SIZE]]),
      "list of networks",
      MAX_LIST_PAGES,
    );
    const networks: Array<MerakiNetwork> = readNetworks(networkList.items);

    if (networkList.isTruncated) {
      progress.warnings.add(
        `The organization has more than ${(LIST_PAGE_SIZE * MAX_LIST_PAGES).toLocaleString("en-US")} networks: only the first ${(LIST_PAGE_SIZE * MAX_LIST_PAGES).toLocaleString("en-US")} are read.`,
      );
    }

    const deviceList: MerakiList = await progress.client.getAll(
      `${progress.orgPath}/devices`,
      buildMerakiQuery([
        ["perPage", LIST_PAGE_SIZE],
        ["productTypes[]", "appliance"],
      ]),
      "list of appliances",
      MAX_LIST_PAGES,
    );
    const appliances: Array<NetworkControllerAppliance> = readAppliances(
      deviceList.items,
    );

    try {
      // 2. Uplink usage, organization-wide, window by window.
      await MerakiTrafficReader.readUplinks(progress, {
        appliances,
        networkNames: new Map(
          networks.map((network: MerakiNetwork): [string, string] => {
            return [network.id, network.name];
          }),
        ),
      });

      // 3. Applications, destinations and clients, network by network.
      await MerakiTrafficReader.readAnalytics(progress, networks);
    } catch (error) {
      if (!(error instanceof MerakiBudgetSpent)) {
        throw error;
      }

      progress.complete = false;
    }

    MerakiTrafficReader.forgetGoneNetworks(progress.state, networks);

    const analysisOff: number = Object.keys(
      progress.state.trafficAnalysisOff || {},
    ).length;

    if (analysisOff > 0) {
      progress.warnings.add(
        `Traffic analysis is off on ${analysisOff} ${analysisOff === 1 ? "network" : "networks"}, so Meraki keeps no applications for ${analysisOff === 1 ? "it" : "them"}. Turn it on in the Meraki dashboard under Network-wide > General > Traffic analysis.`,
      );
    }

    if (appliances.length === 0) {
      progress.warnings.add(NO_APPLIANCE_WARNING);
    }

    const analyticsWaiting: number = Math.max(
      0,
      progress.analyticsDue - progress.analyticsNetworks,
    );

    if (analyticsWaiting > 0) {
      progress.complete = false;
    }

    if (progress.client.wasRateLimited()) {
      progress.warnings.add(RATE_LIMITED_WARNING);
    }

    return {
      organizationName,
      networkCount: networks.length,
      appliances,
      records: progress.records,
      windows: progress.windows,
      uplinkWindows: progress.uplinkWindows,
      ...(progress.newestUplinkAt
        ? { newestUplinkAt: progress.newestUplinkAt }
        : {}),
      analyticsNetworks: progress.analyticsNetworks,
      analyticsNetworksWaiting: analyticsWaiting,
      trafficAnalysisOffNetworks: analysisOff,
      requestCount: progress.client.getRequestCount(),
      wasRateLimited: progress.client.wasRateLimited(),
      warnings: progress.warnings.list(),
      complete: progress.complete,
      nextState: progress.state,
    };
  }

  /*
   * The organization's uplink windows, oldest first. A window that cannot
   * be read stops the uplinks for this read - the cursor stays before it,
   * so the next read asks for it again - and the networks are still read.
   */
  private static async readUplinks(
    progress: ReadProgress,
    data: {
      appliances: Array<NetworkControllerAppliance>;
      networkNames: Map<string, string>;
    },
  ): Promise<void> {
    const plan: ReturnType<typeof planUplinkWindows> = planUplinkWindows({
      cursor: progress.state.uplinkCursor,
      now: progress.now,
    });

    if (plan.gapFrom) {
      progress.warnings.add(
        `Uplink usage from ${iso(plan.gapFrom)} to ${iso(plan.windows[0]?.start || progress.now)} was not read: OneUptime reads at most a day back after a pause.`,
      );
    }

    if (plan.windows.length === 0) {
      return;
    }

    if (data.appliances.length === 0) {
      // No appliance, no uplink: nothing to read now, nor to read again.
      progress.state.uplinkCursor = iso(
        plan.windows[plan.windows.length - 1]!.end,
      );
      return;
    }

    const appliancesBySerial: Map<string, NetworkControllerAppliance> = new Map(
      data.appliances.map(
        (
          appliance: NetworkControllerAppliance,
        ): [string, NetworkControllerAppliance] => {
          return [appliance.serial, appliance];
        },
      ),
    );

    for (const window of plan.windows) {
      let page: MerakiPage;

      try {
        page = await progress.client.get(
          `${progress.orgPath}/appliance/uplinks/usage/byNetwork`,
          buildMerakiQuery([
            ["t0", iso(window.start)],
            ["t1", iso(window.end)],
          ]),
          "uplink usage",
        );
      } catch (error) {
        if (error instanceof MerakiBudgetSpent) {
          throw error;
        }

        const failure: LlmProviderError = asProviderError(
          error,
          "uplink usage",
        );

        if (failure.kind === LlmConnectionFailureKind.Authentication) {
          throw failure;
        }

        progress.warnings.add(
          failure.kind === LlmConnectionFailureKind.RateLimited
            ? RATE_LIMITED_WARNING
            : `Couldn't read the uplink usage: ${failure.message}`,
        );
        progress.complete = false;
        return;
      }

      progress.records.push(
        ...buildUplinkRecords({
          answer: Array.isArray(page.body) ? page.body : [],
          appliances: appliancesBySerial,
          networkNames: data.networkNames,
          windowStartAt: window.start,
          windowEndAt: window.end,
        }),
      );
      progress.windows.push({
        kind: NetworkTrafficUsageKind.Uplink,
        controllerNetworkId: "",
        windowStartAt: window.start,
      });
      progress.state.uplinkCursor = iso(window.end);
      progress.uplinkWindows++;
      progress.newestUplinkAt = window.end;
    }

    // More was behind than one read stores: the next one carries on soon.
    if (
      planUplinkWindows({
        cursor: progress.state.uplinkCursor,
        now: progress.now,
      }).windows.length > 0
    ) {
      progress.complete = false;
    }
  }

  // The networks whose analytics window is due, the longest-waiting first.
  private static async readAnalytics(
    progress: ReadProgress,
    networks: Array<MerakiNetwork>,
  ): Promise<void> {
    const due: Array<{ network: MerakiNetwork; start: Date }> = [];

    for (const network of networks) {
      if (!network.hasTraffic) {
        continue;
      }

      const next: ReturnType<typeof getAnalyticsStart> = getAnalyticsStart({
        cursor: progress.state.analyticsCursors?.[network.id],
        now: progress.now,
      });

      if (next.hadGap) {
        progress.warnings.add(ANALYTICS_GAP_WARNING);
      }

      if (next.isDue) {
        due.push({ network, start: next.start });
      }
    }

    due.sort(
      (
        a: { network: MerakiNetwork; start: Date },
        b: { network: MerakiNetwork; start: Date },
      ): number => {
        return a.start.getTime() - b.start.getTime();
      },
    );
    progress.analyticsDue = due.length;

    let unavailableInARow: number = 0;

    for (const { network, start } of due) {
      const outcome: "read" | "failed" | "stop" =
        await MerakiTrafficReader.readNetworkAnalytics(progress, {
          network,
          start,
        });

      if (outcome === "stop") {
        progress.complete = false;
        return;
      }

      unavailableInARow = outcome === "failed" ? unavailableInARow + 1 : 0;

      if (unavailableInARow >= MAX_UNAVAILABLE_NETWORKS_IN_A_ROW) {
        progress.warnings.add(STOPPED_ANSWERING_WARNING);
        progress.complete = false;
        return;
      }
    }
  }

  /*
   * One network's window: its traffic analytics (unless traffic analysis is
   * known to be off there), then its clients. Kept only when both answered:
   * "failed" when Meraki could not be reached (counted towards stopping),
   * "read" for a window stored - or skipped with a warning for any other
   * failure of this network alone - and "stop" when the read must end here.
   */
  private static async readNetworkAnalytics(
    progress: ReadProgress,
    data: { network: MerakiNetwork; start: Date },
  ): Promise<"read" | "failed" | "stop"> {
    const network: MerakiNetwork = data.network;
    const label: string = network.name || network.id;
    const offAt: number | null = toTime(
      progress.state.trafficAnalysisOff?.[network.id],
    );
    const isKnownOff: boolean =
      offAt !== null &&
      progress.now.getTime() - offAt < TRAFFIC_ANALYSIS_RETRY_MS;
    const windowEnd: Date = progress.clock();
    const networkRecords: Array<NetworkTrafficUsageRecord> = [];

    const step: (what: "applications" | "clients") => Promise<boolean> = async (
      what: "applications" | "clients",
    ): Promise<boolean> => {
      try {
        if (what === "applications") {
          const traffic: MerakiPage = await progress.client.get(
            `/networks/${encodeURIComponent(network.id)}/traffic`,
            buildMerakiQuery([["t0", iso(data.start)]]),
            `traffic analytics of network "${label}"`,
          );

          networkRecords.push(
            ...buildApplicationRecords({
              answer: Array.isArray(traffic.body) ? traffic.body : [],
              controllerNetworkId: network.id,
              controllerNetworkName: network.name,
              windowStartAt: data.start,
              windowEndAt: windowEnd,
            }),
          );

          if (progress.state.trafficAnalysisOff) {
            delete progress.state.trafficAnalysisOff[network.id];
          }

          return true;
        }

        const clients: MerakiList = await progress.client.getAll(
          `/networks/${encodeURIComponent(network.id)}/clients`,
          buildMerakiQuery([
            ["t0", iso(data.start)],
            ["perPage", CLIENT_PAGE_SIZE],
          ]),
          `clients of network "${label}"`,
          MAX_CLIENT_PAGES,
        );

        if (clients.isTruncated) {
          progress.warnings.add(
            `A network had more than ${(CLIENT_PAGE_SIZE * MAX_CLIENT_PAGES).toLocaleString("en-US")} clients in a window: the clients past them are left out of Top clients.`,
          );
        }

        networkRecords.push(
          ...buildClientRecords({
            answer: clients.items,
            controllerNetworkId: network.id,
            controllerNetworkName: network.name,
            windowStartAt: data.start,
            windowEndAt: windowEnd,
          }),
        );

        return true;
      } catch (error) {
        if (error instanceof MerakiBudgetSpent) {
          throw error;
        }

        if (what === "applications" && isTrafficAnalysisOff(error)) {
          progress.state.trafficAnalysisOff = {
            ...(progress.state.trafficAnalysisOff || {}),
            [network.id]: iso(progress.now),
          };

          return true;
        }

        const failure: LlmProviderError = asProviderError(error, what);

        if (failure.kind === LlmConnectionFailureKind.Authentication) {
          throw failure;
        }

        if (failure.kind === LlmConnectionFailureKind.RateLimited) {
          progress.warnings.add(RATE_LIMITED_WARNING);
          throw new StopRead();
        }

        progress.warnings.add(
          `Couldn't read the ${what} of network "${label}": ${failure.message}`,
        );

        if (failure.kind === LlmConnectionFailureKind.Unavailable) {
          throw new NetworkUnavailable();
        }

        return false;
      }
    };

    try {
      const appsRead: boolean = isKnownOff ? true : await step("applications");

      if (!appsRead || !(await step("clients"))) {
        // Asked again next read; nothing of the window is kept.
        return "read";
      }
    } catch (error) {
      if (error instanceof StopRead) {
        return "stop";
      }

      if (error instanceof NetworkUnavailable) {
        return "failed";
      }

      throw error;
    }

    progress.records.push(...networkRecords);
    progress.windows.push(
      {
        kind: NetworkTrafficUsageKind.Application,
        controllerNetworkId: network.id,
        windowStartAt: data.start,
      },
      {
        kind: NetworkTrafficUsageKind.Client,
        controllerNetworkId: network.id,
        windowStartAt: data.start,
      },
    );
    progress.state.analyticsCursors = {
      ...(progress.state.analyticsCursors || {}),
      [network.id]: iso(windowEnd),
    };
    progress.analyticsNetworks++;

    return "read";
  }

  // Networks that are gone from the organization keep no state.
  private static forgetGoneNetworks(
    state: NetworkControllerPullState,
    networks: Array<MerakiNetwork>,
  ): void {
    const known: Set<string> = new Set(
      networks.map((network: MerakiNetwork): string => {
        return network.id;
      }),
    );

    for (const key of ["analyticsCursors", "trafficAnalysisOff"] as const) {
      const map: Record<string, string> | undefined = state[key];

      if (!map) {
        continue;
      }

      for (const networkId of Object.keys(map)) {
        if (!known.has(networkId)) {
          delete map[networkId];
        }
      }
    }
  }
}
