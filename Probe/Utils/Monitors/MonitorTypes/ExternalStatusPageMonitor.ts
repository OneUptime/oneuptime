import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import axios, { AxiosResponse } from "axios";
import { XMLParser } from "fast-xml-parser";

export interface ExternalStatusPageQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

// Normalized component, before scoping is applied. Shared across structured providers.
interface RawExternalComponent {
  name: string;
  status: string;
  description?: string | undefined;
  groupName?: string | undefined;
}

// Normalized active incident, before scoping is applied.
interface RawExternalIncident {
  name: string;
  affectedComponentNames: Array<string>;
}

interface AtlassianStatusResponse {
  page?: {
    id?: string;
    name?: string;
    url?: string;
  };
  status?: {
    indicator?: string;
    description?: string;
  };
}

interface AtlassianComponent {
  id?: string;
  name?: string;
  status?: string;
  description?: string;
  group?: boolean;
  group_id?: string | null;
}

interface AtlassianComponentsResponse {
  components?: Array<AtlassianComponent>;
}

interface AtlassianIncidentComponent {
  id?: string;
  name?: string;
}

interface AtlassianIncident {
  id?: string;
  name?: string;
  status?: string;
  components?: Array<AtlassianIncidentComponent>;
}

interface AtlassianUnresolvedIncidentsResponse {
  incidents?: Array<AtlassianIncident>;
}

interface IncidentIoComponentRef {
  component_id?: string;
  name?: string;
}

interface IncidentIoAffectedComponent {
  component_id?: string;
  status?: string;
}

interface IncidentIoGroup {
  id?: string;
  name?: string;
  components?: Array<IncidentIoComponentRef>;
}

interface IncidentIoStructureItem {
  group?: IncidentIoGroup;
  component?: IncidentIoComponentRef;
}

interface IncidentIoIncident {
  id?: string;
  name?: string;
  status?: string;
  affected_components?: Array<IncidentIoAffectedComponent>;
}

interface IncidentIoSummaryComponent {
  id?: string;
  name?: string;
}

interface IncidentIoStructure {
  items?: Array<IncidentIoStructureItem>;
}

interface IncidentIoSummary {
  components?: Array<IncidentIoSummaryComponent>;
  affected_components?: Array<IncidentIoAffectedComponent>;
  ongoing_incidents?: Array<IncidentIoIncident>;
  structure?: IncidentIoStructure;
}

interface IncidentIoResponse {
  summary?: IncidentIoSummary;
  affected_components?: Array<IncidentIoAffectedComponent>;
  ongoing_incidents?: Array<IncidentIoIncident>;
  structure?: IncidentIoStructure;
}

export default class ExternalStatusPageMonitorUtil {
  public static async fetch(
    config: MonitorStepExternalStatusPageMonitor,
    options?: ExternalStatusPageQueryOptions,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options?.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    if (!options.attempts) {
      options.attempts = [];
    }

    logger.debug(
      `External Status Page Query: ${options?.monitorId?.toString()} ${config.statusPageUrl} - Retry: ${options?.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();
    const attemptedAt: Date = new Date();

    try {
      let response: ExternalStatusPageMonitorResponse | null = null;

      const provider: ExternalStatusPageProviderType = config.provider;

      if (provider === ExternalStatusPageProviderType.Auto) {
        /*
         * Auto-detect: try incident.io first, then Atlassian, then RSS/Atom.
         * incident.io must be tried first because some incident.io pages (e.g.
         * status.openai.com) also serve an Atlassian-compatible /api/v2/status.json
         * shim that exposes neither component groups nor an unresolved-incidents
         * endpoint — so Atlassian detection would "win" but return degraded data.
         * A genuine Atlassian page 404s the incident.io proxy endpoint and falls
         * through to the Atlassian branch below.
         */
        response = await ExternalStatusPageMonitorUtil.tryIncidentIo(
          config,
          options,
        );

        if (!response) {
          response = await ExternalStatusPageMonitorUtil.tryAtlassianStatuspage(
            config,
            options,
          );
        }

        if (!response) {
          response = await ExternalStatusPageMonitorUtil.tryRssAtomFeed(
            config,
            options,
          );
        }
      } else if (
        provider === ExternalStatusPageProviderType.AtlassianStatuspage
      ) {
        response = await ExternalStatusPageMonitorUtil.tryAtlassianStatuspage(
          config,
          options,
        );
      } else if (provider === ExternalStatusPageProviderType.IncidentIo) {
        response = await ExternalStatusPageMonitorUtil.tryIncidentIo(
          config,
          options,
        );
      } else if (
        provider === ExternalStatusPageProviderType.RSS ||
        provider === ExternalStatusPageProviderType.Atom
      ) {
        response = await ExternalStatusPageMonitorUtil.tryRssAtomFeed(
          config,
          options,
        );
      }

      if (!response) {
        // If all methods fail, just check if the URL is reachable
        response = await ExternalStatusPageMonitorUtil.tryBasicHttpCheck(
          config,
          options,
        );
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      if (response) {
        response.responseTimeInMs = responseTimeInMs;

        // Echo the resolved query scope so consumers (summary view, templates) can show what was queried.
        response.componentGroupName = config.componentGroupName;
        response.componentName = config.componentName;

        const responseReceivedAt: Date = new Date();
        options.attempts.push({
          attemptNumber: options.currentRetryCount,
          attemptedAt,
          responseReceivedAt,
          responseTimeInMs,
          isOnline: response.isOnline,
          failureCause: response.isOnline ? undefined : response.failureCause,
        });

        response.probeAttempts = options.attempts;
        response.totalAttempts = options.attempts.length;
      }

      logger.debug(
        `External Status Page Query success: ${options?.monitorId?.toString()} ${config.statusPageUrl} - Response Time: ${responseTimeInMs}ms`,
      );

      return response;
    } catch (err: unknown) {
      logger.debug(
        `External Status Page Query error: ${options?.monitorId?.toString()} ${config.statusPageUrl}`,
      );
      logger.debug(err);

      if (!options) {
        options = {};
      }

      if (!options.currentRetryCount) {
        options.currentRetryCount = 0;
      }

      if (!options.attempts) {
        options.attempts = [];
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      const responseReceivedAt: Date = new Date();
      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs,
        isOnline: false,
        failureCause: (err as Error).message || (err as Error).toString(),
      });

      if (options.currentRetryCount < (options.retry || config.retries || 3)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await ExternalStatusPageMonitorUtil.fetch(config, options);
      }

      // Check if the probe is online
      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `ExternalStatusPageMonitor - Probe is not online. Cannot fetch ${options?.monitorId?.toString()} ${config.statusPageUrl} - ERROR: ${err}`,
          );
          return null;
        }
      }

      const isTimeout: boolean =
        (err as Error).message?.toLowerCase().includes("timeout") ||
        (err as Error).message?.toLowerCase().includes("timed out") ||
        (err as Error).message?.toLowerCase().includes("etimeout") ||
        (err as Error).message?.toLowerCase().includes("econnaborted");

      if (isTimeout) {
        return {
          isOnline: false,
          isTimeout: true,
          overallStatus: "unknown",
          componentStatuses: [],
          activeIncidentCount: 0,
          responseTimeInMs: responseTimeInMs,
          failureCause:
            "Request was tried " +
            options.currentRetryCount +
            " times and it timed out.",
          probeAttempts: options.attempts,
          totalAttempts: options.attempts.length,
        };
      }

      return {
        isOnline: false,
        isTimeout: false,
        overallStatus: "unknown",
        componentStatuses: [],
        activeIncidentCount: 0,
        responseTimeInMs: responseTimeInMs,
        failureCause: (err as Error).message || (err as Error).toString(),
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    }
  }

  /*
   * Ranking of status vocabulary (higher = worse). Covers both Atlassian Statuspage
   * and incident.io component status strings.
   */
  private static getStatusRank(status: string): number {
    switch ((status || "").toLowerCase()) {
      case "operational":
        return 0;
      case "under_maintenance":
      case "maintenance":
        return 1;
      case "degraded_performance":
      case "degraded":
        return 2;
      case "partial_outage":
        return 3;
      case "major_outage":
      case "full_outage":
      case "critical":
        return 4;
      default:
        // Any unknown, non-operational status is treated as a degradation.
        return 2;
    }
  }

  private static matchesFilter(
    value: string | undefined,
    filter: string | undefined,
  ): boolean {
    if (!filter) {
      return true; // no filter -> everything matches
    }

    if (!value) {
      return false;
    }

    return value.toLowerCase().includes(filter.toLowerCase());
  }

  /*
   * Derives an overall status from the (already scoped) component list. Returns a
   * standard status string (e.g. "operational", "degraded_performance",
   * "major_outage") so it is comparable in monitor criteria.
   */
  private static deriveOverallStatus(
    components: Array<RawExternalComponent>,
    scopedIncidentCount: number,
  ): string {
    let worstStatus: string = "operational";
    let worstRank: number = 0;

    for (const component of components) {
      const rank: number = ExternalStatusPageMonitorUtil.getStatusRank(
        component.status,
      );
      if (rank > worstRank) {
        worstRank = rank;
        worstStatus = component.status;
      }
    }

    if (worstRank === 0 && scopedIncidentCount > 0) {
      // No component is explicitly degraded, but there is an active incident in scope.
      return "degraded_performance";
    }

    return worstStatus;
  }

  /*
   * Builds the final response for structured providers (Atlassian, incident.io),
   * applying the configured component-group and component-name scoping. When a
   * group/component filter is set, the active incident count and overall status are
   * scoped to ONLY the matching components, so a monitor on (for example) the "APIs"
   * group does not trip on an unrelated incident elsewhere on the same status page.
   */
  private static buildScopedResponse(input: {
    config: MonitorStepExternalStatusPageMonitor;
    provider: ExternalStatusPageProviderType;
    components: Array<RawExternalComponent>;
    incidents: Array<RawExternalIncident>;
    pageOverallStatus?: string | undefined;
    rawBody?: string | undefined;
  }): ExternalStatusPageMonitorResponse {
    const groupFilter: string | undefined = input.config.componentGroupName;
    const nameFilter: string | undefined = input.config.componentName;
    const isScoped: boolean = Boolean(groupFilter) || Boolean(nameFilter);

    const targetedComponents: Array<RawExternalComponent> =
      input.components.filter((component: RawExternalComponent) => {
        return (
          ExternalStatusPageMonitorUtil.matchesFilter(
            component.groupName,
            groupFilter,
          ) &&
          ExternalStatusPageMonitorUtil.matchesFilter(
            component.name,
            nameFilter,
          )
        );
      });

    const targetedNames: Set<string> = new Set(
      targetedComponents.map((component: RawExternalComponent) => {
        return component.name.toLowerCase();
      }),
    );

    let activeIncidentCount: number;
    if (!isScoped) {
      activeIncidentCount = input.incidents.length;
    } else {
      activeIncidentCount = input.incidents.filter(
        (incident: RawExternalIncident) => {
          return incident.affectedComponentNames.some((name: string) => {
            return targetedNames.has(name.toLowerCase());
          });
        },
      ).length;
    }

    const componentStatuses: Array<ExternalStatusPageComponentStatus> =
      targetedComponents.map((component: RawExternalComponent) => {
        return {
          name: component.name,
          status: component.status,
          description: component.description,
          groupName: component.groupName,
        };
      });

    let overallStatus: string;
    if (!isScoped && input.pageOverallStatus) {
      // Unscoped: prefer the provider's own page-level status when available.
      overallStatus = input.pageOverallStatus;
    } else {
      overallStatus = ExternalStatusPageMonitorUtil.deriveOverallStatus(
        targetedComponents,
        activeIncidentCount,
      );
    }

    return {
      isOnline: true,
      overallStatus: overallStatus,
      componentStatuses: componentStatuses,
      activeIncidentCount: activeIncidentCount,
      responseTimeInMs: 0, // Will be overwritten by caller
      failureCause: "",
      provider: input.provider,
      rawBody: input.rawBody,
    };
  }

  private static async tryAtlassianStatuspage(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptions,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      const baseUrl: string = config.statusPageUrl.replace(/\/+$/, "");
      const timeout: number = config.timeout || options.timeout || 10000;
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "OneUptime-Probe/1.0",
      };

      // Fetch status
      const statusUrl: string = `${baseUrl}/api/v2/status.json`;
      const statusResponse: AxiosResponse = await axios.get(statusUrl, {
        timeout: timeout,
        headers: headers,
        validateStatus: (status: number) => {
          return status < 500;
        },
      });

      if (
        statusResponse.status === 404 ||
        statusResponse.status === 403 ||
        statusResponse.status === 401
      ) {
        return null;
      }

      const statusData: AtlassianStatusResponse =
        statusResponse.data as AtlassianStatusResponse;

      if (!statusData?.status?.indicator) {
        return null;
      }

      // Fetch components (with group headers so we can resolve group membership).
      const components: Array<RawExternalComponent> = [];
      try {
        const componentsUrl: string = `${baseUrl}/api/v2/components.json`;
        const componentsResponse: AxiosResponse = await axios.get(
          componentsUrl,
          {
            timeout: timeout,
            headers: headers,
          },
        );

        const componentsData: AtlassianComponentsResponse =
          componentsResponse.data as AtlassianComponentsResponse;

        const allComponents: Array<AtlassianComponent> =
          componentsData?.components || [];

        // First pass: map group id -> group name (a "group" is a component with group === true).
        const groupIdToName: Record<string, string> = {};
        for (const component of allComponents) {
          if (component.group === true && component.id && component.name) {
            groupIdToName[component.id] = component.name;
          }
        }

        // Second pass: collect leaf components (skip group headers).
        for (const component of allComponents) {
          if (component.group === true) {
            continue;
          }

          if (component.name && component.status) {
            components.push({
              name: component.name,
              status: component.status,
              description: component.description || undefined,
              groupName: component.group_id
                ? groupIdToName[component.group_id]
                : undefined,
            });
          }
        }
      } catch (err) {
        logger.debug(
          `Failed to fetch Atlassian components for ${baseUrl}: ${err}`,
        );
        // Continue without component data
      }

      // Fetch unresolved (active) incidents.
      const incidents: Array<RawExternalIncident> = [];
      try {
        const incidentsUrl: string = `${baseUrl}/api/v2/incidents/unresolved.json`;
        const incidentsResponse: AxiosResponse = await axios.get(incidentsUrl, {
          timeout: timeout,
          headers: headers,
        });

        const incidentsData: AtlassianUnresolvedIncidentsResponse =
          incidentsResponse.data as AtlassianUnresolvedIncidentsResponse;

        for (const incident of incidentsData?.incidents || []) {
          incidents.push({
            name: incident.name || "Unknown incident",
            affectedComponentNames: (incident.components || [])
              .map((component: AtlassianIncidentComponent) => {
                return component.name || "";
              })
              .filter((name: string) => {
                return Boolean(name);
              }),
          });
        }
      } catch (err) {
        logger.debug(
          `Failed to fetch Atlassian unresolved incidents for ${baseUrl}: ${err}`,
        );
        // Continue without incident data
      }

      const pageOverallStatus: string =
        statusData.status.description || statusData.status.indicator || "";

      return ExternalStatusPageMonitorUtil.buildScopedResponse({
        config: config,
        provider: ExternalStatusPageProviderType.AtlassianStatuspage,
        components: components,
        incidents: incidents,
        pageOverallStatus: pageOverallStatus,
        rawBody: JSON.stringify(statusData),
      });
    } catch (err) {
      logger.debug(
        `Atlassian Statuspage API failed for ${config.statusPageUrl}: ${err}`,
      );
      return null;
    }
  }

  private static async tryIncidentIo(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptions,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      const rawUrl: string = config.statusPageUrl.startsWith("http")
        ? config.statusPageUrl
        : `https://${config.statusPageUrl}`;

      const parsedUrl: URL = new URL(rawUrl);
      const host: string = parsedUrl.hostname;
      const origin: string = `${parsedUrl.protocol}//${parsedUrl.host}`;

      // incident.io status pages expose their data via a proxy endpoint keyed by host.
      const apiUrl: string = `${origin}/proxy/${host}`;

      const apiResponse: AxiosResponse = await axios.get(apiUrl, {
        timeout: config.timeout || options.timeout || 10000,
        headers: {
          Accept: "application/json",
          "User-Agent": "OneUptime-Probe/1.0",
        },
        validateStatus: (status: number) => {
          return status < 500;
        },
      });

      if (
        apiResponse.status === 404 ||
        apiResponse.status === 403 ||
        apiResponse.status === 401
      ) {
        return null;
      }

      const data: IncidentIoResponse = apiResponse.data as IncidentIoResponse;

      if (!data || typeof data !== "object") {
        return null;
      }

      const summary: IncidentIoSummary = data.summary || {};
      /*
       * The proxy endpoint nests everything under `summary`, but be tolerant of a
       * flattened (top-level) shape too.
       */
      const structureItems: Array<IncidentIoStructureItem> =
        (data.structure || summary.structure)?.items || [];

      // Verify this actually looks like an incident.io status page.
      const looksLikeIncidentIo: boolean =
        structureItems.length > 0 ||
        Array.isArray(summary.components) ||
        Array.isArray(data.ongoing_incidents) ||
        Array.isArray(summary.ongoing_incidents);

      if (!looksLikeIncidentIo) {
        return null;
      }

      // Build a component_id -> { name, groupName, status } map.
      const componentMap: Record<string, RawExternalComponent> = {};

      const ensureComponent: (
        id: string | undefined,
        name?: string | undefined,
      ) => RawExternalComponent | null = (
        id?: string,
        name?: string,
      ): RawExternalComponent | null => {
        if (!id) {
          return null;
        }
        if (!componentMap[id]) {
          componentMap[id] = {
            name: name || id,
            status: "operational",
            groupName: undefined,
          };
        } else if (name && componentMap[id].name === id) {
          componentMap[id].name = name;
        }
        return componentMap[id] || null;
      };

      // Flat component list from the summary.
      for (const component of summary.components || []) {
        ensureComponent(component.id, component.name);
      }

      // Group membership + any components only present in the structure.
      for (const item of structureItems) {
        if (item.group && Array.isArray(item.group.components)) {
          const groupName: string | undefined = item.group.name;
          for (const ref of item.group.components) {
            const entry: RawExternalComponent | null = ensureComponent(
              ref.component_id,
              ref.name,
            );
            if (entry) {
              entry.groupName = groupName;
            }
          }
        } else if (item.component) {
          ensureComponent(item.component.component_id, item.component.name);
        }
      }

      // Apply current non-operational statuses.
      const affectedComponents: Array<IncidentIoAffectedComponent> =
        data.affected_components || summary.affected_components || [];
      for (const affected of affectedComponents) {
        const entry: RawExternalComponent | null = ensureComponent(
          affected.component_id,
        );
        if (entry && affected.status) {
          entry.status = affected.status;
        }
      }

      const components: Array<RawExternalComponent> =
        Object.values(componentMap);

      // Active incidents.
      const ongoingIncidents: Array<IncidentIoIncident> =
        data.ongoing_incidents || summary.ongoing_incidents || [];
      const incidents: Array<RawExternalIncident> = ongoingIncidents.map(
        (incident: IncidentIoIncident) => {
          return {
            name: incident.name || "Unknown incident",
            affectedComponentNames: (incident.affected_components || [])
              .map((affected: IncidentIoAffectedComponent) => {
                return affected.component_id
                  ? componentMap[affected.component_id]?.name || ""
                  : "";
              })
              .filter((name: string) => {
                return Boolean(name);
              }),
          };
        },
      );

      return ExternalStatusPageMonitorUtil.buildScopedResponse({
        config: config,
        provider: ExternalStatusPageProviderType.IncidentIo,
        components: components,
        incidents: incidents,
        // incident.io has no page-level status field; always derive from components.
        pageOverallStatus: undefined,
        rawBody: JSON.stringify(data).slice(0, 100000),
      });
    } catch (err) {
      logger.debug(
        `incident.io status page API failed for ${config.statusPageUrl}: ${err}`,
      );
      return null;
    }
  }

  private static async tryRssAtomFeed(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptions,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      const feedUrl: string = config.statusPageUrl.replace(/\/+$/, "");

      const response: AxiosResponse = await axios.get(feedUrl, {
        timeout: config.timeout || options.timeout || 10000,
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml",
          "User-Agent": "OneUptime-Probe/1.0",
        },
        responseType: "text",
      });

      const body: string = response.data as string;

      if (!body || typeof body !== "string") {
        return null;
      }

      // Check if it looks like XML
      const trimmed: string = body.trim();
      if (!trimmed.startsWith("<")) {
        return null;
      }

      const parser: XMLParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
      });

      const parsed: Record<string, unknown> = parser.parse(body) as Record<
        string,
        unknown
      >;

      // Try RSS format
      if (parsed["rss"]) {
        return ExternalStatusPageMonitorUtil.parseRssFeed(
          parsed["rss"] as Record<string, unknown>,
          body,
          config,
        );
      }

      // Try Atom format
      if (parsed["feed"]) {
        return ExternalStatusPageMonitorUtil.parseAtomFeed(
          parsed["feed"] as Record<string, unknown>,
          body,
          config,
        );
      }

      return null;
    } catch (err) {
      logger.debug(
        `RSS/Atom feed parsing failed for ${config.statusPageUrl}: ${err}`,
      );
      return null;
    }
  }

  private static parseRssFeed(
    rss: Record<string, unknown>,
    rawBody: string,
    config: MonitorStepExternalStatusPageMonitor,
  ): ExternalStatusPageMonitorResponse {
    const channel: Record<string, unknown> =
      (rss["channel"] as Record<string, unknown>) || {};
    const items: Array<Record<string, unknown>> = Array.isArray(channel["item"])
      ? (channel["item"] as Array<Record<string, unknown>>)
      : channel["item"]
        ? [channel["item"] as Record<string, unknown>]
        : [];

    // Count active incidents (recent items — items published in the last 24 hours)
    const now: Date = new Date();
    const componentStatuses: Array<ExternalStatusPageComponentStatus> = [];

    for (const item of items) {
      const pubDate: string = (item["pubDate"] as string) || "";
      if (pubDate) {
        const itemDate: Date = new Date(pubDate);
        const hoursDiff: number =
          (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60);
        if (hoursDiff <= 24) {
          const title: string = (item["title"] as string) || "Unknown";
          // Feeds carry no component-group data; honor the component-name filter only.
          if (
            ExternalStatusPageMonitorUtil.matchesFilter(
              title,
              config.componentName,
            )
          ) {
            componentStatuses.push({
              name: title,
              status: "incident",
              description: (item["description"] as string) || undefined,
            });
          }
        }
      }
    }

    const activeIncidentCount: number = componentStatuses.length;
    const overallStatus: string =
      activeIncidentCount > 0 ? "degraded_performance" : "operational";

    return {
      isOnline: true,
      overallStatus: overallStatus,
      componentStatuses: componentStatuses,
      activeIncidentCount: activeIncidentCount,
      responseTimeInMs: 0,
      failureCause: "",
      provider: ExternalStatusPageProviderType.RSS,
      rawBody: rawBody,
    };
  }

  private static parseAtomFeed(
    feed: Record<string, unknown>,
    rawBody: string,
    config: MonitorStepExternalStatusPageMonitor,
  ): ExternalStatusPageMonitorResponse {
    const entries: Array<Record<string, unknown>> = Array.isArray(feed["entry"])
      ? (feed["entry"] as Array<Record<string, unknown>>)
      : feed["entry"]
        ? [feed["entry"] as Record<string, unknown>]
        : [];

    // Count active incidents (recent entries — entries updated in the last 24 hours)
    const now: Date = new Date();
    const componentStatuses: Array<ExternalStatusPageComponentStatus> = [];

    for (const entry of entries) {
      const updated: string =
        (entry["updated"] as string) || (entry["published"] as string) || "";
      if (updated) {
        const entryDate: Date = new Date(updated);
        const hoursDiff: number =
          (now.getTime() - entryDate.getTime()) / (1000 * 60 * 60);
        if (hoursDiff <= 24) {
          const title: string | Record<string, unknown> =
            (entry["title"] as string | Record<string, unknown>) || "Unknown";
          const titleText: string =
            typeof title === "string"
              ? title
              : (title["#text"] as string) || "Unknown";
          const content: string | Record<string, unknown> =
            (entry["content"] as string | Record<string, unknown>) ||
            (entry["summary"] as string | Record<string, unknown>) ||
            "";
          const contentText: string =
            typeof content === "string"
              ? content
              : (content["#text"] as string) || "";

          // Feeds carry no component-group data; honor the component-name filter only.
          if (
            ExternalStatusPageMonitorUtil.matchesFilter(
              titleText,
              config.componentName,
            )
          ) {
            componentStatuses.push({
              name: titleText,
              status: "incident",
              description: contentText || undefined,
            });
          }
        }
      }
    }

    const activeIncidentCount: number = componentStatuses.length;
    const overallStatus: string =
      activeIncidentCount > 0 ? "degraded_performance" : "operational";

    return {
      isOnline: true,
      overallStatus: overallStatus,
      componentStatuses: componentStatuses,
      activeIncidentCount: activeIncidentCount,
      responseTimeInMs: 0,
      failureCause: "",
      provider: ExternalStatusPageProviderType.Atom,
      rawBody: rawBody,
    };
  }

  private static async tryBasicHttpCheck(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptions,
  ): Promise<ExternalStatusPageMonitorResponse> {
    try {
      const response: AxiosResponse = await axios.get(config.statusPageUrl, {
        timeout: config.timeout || options.timeout || 10000,
        headers: {
          "User-Agent": "OneUptime-Probe/1.0",
        },
        validateStatus: () => {
          return true;
        },
      });

      const isOnline: boolean = response.status >= 200 && response.status < 400;

      return {
        isOnline: isOnline,
        overallStatus: isOnline ? "reachable" : "unreachable",
        componentStatuses: [],
        activeIncidentCount: 0,
        responseTimeInMs: 0,
        failureCause: isOnline ? "" : `HTTP status ${response.status}`,
      };
    } catch (err) {
      return {
        isOnline: false,
        overallStatus: "unreachable",
        componentStatuses: [],
        activeIncidentCount: 0,
        responseTimeInMs: 0,
        failureCause: (err as Error).message || (err as Error).toString(),
      };
    }
  }
}
