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

interface AtlassianIncident {
  id?: string;
  name?: string;
  status?: string;
  components?: Array<AtlassianComponent>;
}

interface AtlassianIncidentsResponse {
  incidents?: Array<AtlassianIncident>;
}

// incident.io status page (e.g. status.openai.com) — the page's own proxy API.

interface IncidentIoComponent {
  id?: string;
  name?: string;
}

interface IncidentIoAffectedComponent {
  component_id?: string;
  status?: string;
}

interface IncidentIoStructureGroupComponent {
  component_id?: string;
  name?: string;
}

interface IncidentIoStructureItem {
  group?: {
    id?: string;
    name?: string;
    components?: Array<IncidentIoStructureGroupComponent>;
  };
  component?: {
    component_id?: string;
    name?: string;
  };
}

interface IncidentIoIncident {
  id?: string;
  name?: string;
  status?: string;
  affected_components?: Array<IncidentIoAffectedComponent>;
}

interface IncidentIoSummaryResponse {
  summary?: {
    components?: Array<IncidentIoComponent>;
    affected_components?: Array<IncidentIoAffectedComponent>;
    ongoing_incidents?: Array<IncidentIoIncident>;
    structure?: {
      items?: Array<IncidentIoStructureItem>;
    };
  };
}

/*
 * A component as resolved by a provider parser, before it is mapped onto
 * the public ExternalStatusPageComponentStatus type. Carries the provider
 * component id so active incidents can be scoped to the filtered set.
 */
interface ResolvedComponent {
  id?: string | undefined;
  name: string;
  status: string;
  description?: string | undefined;
  groupName?: string | undefined;
}

/*
 * Worst-first ordering of non-operational component statuses, used to derive
 * an overall status from a set of components. "operational" is intentionally
 * absent — it is the healthy baseline, not a severity.
 */
const COMPONENT_STATUS_SEVERITY: Array<string> = [
  "major_outage",
  "partial_outage",
  "degraded_performance",
  "under_maintenance",
  "maintenance",
];

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
        // Auto-detect: try Atlassian, then incident.io, then fall back to RSS/Atom
        response = await ExternalStatusPageMonitorUtil.tryAtlassianStatuspage(
          config,
          options,
        );

        if (!response) {
          response = await ExternalStatusPageMonitorUtil.tryIncidentIo(
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

        /*
         * Narrow the reported component statuses to the configured group
         * and/or component. The provider parsers already scope the active
         * incident count and overall status to the same filter, so the
         * whole response reflects only what the user asked to track
         * (e.g. just the "APIs" group on status.openai.com).
         */
        if (
          ExternalStatusPageMonitorUtil.hasComponentFilter(config) &&
          response.componentStatuses.length > 0
        ) {
          response.componentStatuses = response.componentStatuses.filter(
            (c: ExternalStatusPageComponentStatus) => {
              return ExternalStatusPageMonitorUtil.componentMatchesFilter(
                config,
                c.name,
                c.groupName,
              );
            },
          );
        }

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

  private static async tryAtlassianStatuspage(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptions,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      const baseUrl: string = config.statusPageUrl.replace(/\/+$/, "");

      // Fetch status
      const statusUrl: string = `${baseUrl}/api/v2/status.json`;
      const statusResponse: AxiosResponse = await axios.get(statusUrl, {
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

      // Fetch components (leaf components plus the groups they belong to).
      const resolvedComponents: Array<ResolvedComponent> = [];
      try {
        const componentsUrl: string = `${baseUrl}/api/v2/components.json`;
        const componentsResponse: AxiosResponse = await axios.get(
          componentsUrl,
          {
            timeout: config.timeout || options.timeout || 10000,
            headers: {
              Accept: "application/json",
              "User-Agent": "OneUptime-Probe/1.0",
            },
          },
        );

        const componentsData: AtlassianComponentsResponse =
          componentsResponse.data as AtlassianComponentsResponse;

        if (componentsData?.components) {
          // First pass: map group id -> group name (group headers).
          const groupIdToName: Record<string, string> = {};
          for (const component of componentsData.components) {
            if (component.group === true && component.id && component.name) {
              groupIdToName[component.id] = component.name;
            }
          }

          // Second pass: collect leaf components with their group name.
          for (const component of componentsData.components) {
            // Skip group headers — they are surfaced as the groupName below.
            if (component.group === true) {
              continue;
            }

            if (component.name && component.status) {
              resolvedComponents.push({
                id: component.id,
                name: component.name,
                status: component.status,
                description: component.description || undefined,
                groupName: component.group_id
                  ? groupIdToName[component.group_id]
                  : undefined,
              });
            }
          }
        }
      } catch (err) {
        logger.debug(
          `Failed to fetch Atlassian components for ${baseUrl}: ${err}`,
        );
        // Continue without component data
      }

      // Fetch unresolved incidents so active incident criteria are meaningful.
      const incidentAffectedComponentIds: Array<Array<string>> = [];
      try {
        const incidentsUrl: string = `${baseUrl}/api/v2/incidents/unresolved.json`;
        const incidentsResponse: AxiosResponse = await axios.get(incidentsUrl, {
          timeout: config.timeout || options.timeout || 10000,
          headers: {
            Accept: "application/json",
            "User-Agent": "OneUptime-Probe/1.0",
          },
          validateStatus: (status: number) => {
            return status < 500;
          },
        });

        const incidentsData: AtlassianIncidentsResponse =
          incidentsResponse.data as AtlassianIncidentsResponse;

        if (incidentsData?.incidents) {
          for (const incident of incidentsData.incidents) {
            incidentAffectedComponentIds.push(
              (incident.components || [])
                .map((c: AtlassianComponent) => {
                  return c.id || "";
                })
                .filter((id: string) => {
                  return Boolean(id);
                }),
            );
          }
        }
      } catch (err) {
        logger.debug(
          `Failed to fetch Atlassian incidents for ${baseUrl}: ${err}`,
        );
        // Continue without incident data
      }

      const activeIncidentCount: number =
        ExternalStatusPageMonitorUtil.countScopedIncidents({
          config,
          components: resolvedComponents,
          incidentAffectedComponentIds,
        });

      const overallStatus: string =
        ExternalStatusPageMonitorUtil.deriveOverallStatus({
          config,
          components: resolvedComponents,
          fallback:
            statusData.status.description || statusData.status.indicator || "",
        });

      return {
        isOnline: true,
        overallStatus: overallStatus,
        componentStatuses:
          ExternalStatusPageMonitorUtil.toComponentStatuses(resolvedComponents),
        activeIncidentCount: activeIncidentCount,
        responseTimeInMs: 0, // Will be overwritten by caller
        failureCause: "",
        rawBody: JSON.stringify(statusData),
      };
    } catch (err) {
      logger.debug(
        `Atlassian Statuspage API failed for ${config.statusPageUrl}: ${err}`,
      );
      return null;
    }
  }

  /*
   * incident.io-powered status pages (e.g. status.openai.com) expose the
   * same JSON the page itself renders from at `<origin>/proxy/<hostname>`.
   * The payload lists every component, the currently affected components,
   * the ongoing incidents, and a group structure — which lets us scope
   * monitoring to a single group (e.g. "APIs") or a component within it.
   */
  private static async tryIncidentIo(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptions,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      let parsedUrl: globalThis.URL;
      try {
        const lowerCaseUrl: string = config.statusPageUrl.toLowerCase();
        const hasProtocol: boolean =
          lowerCaseUrl.startsWith("http://") ||
          lowerCaseUrl.startsWith("https://");
        const normalizedUrl: string = hasProtocol
          ? config.statusPageUrl
          : `https://${config.statusPageUrl}`;
        parsedUrl = new URL(normalizedUrl);
      } catch (err) {
        logger.debug(
          `incident.io: could not parse status page URL ${config.statusPageUrl}: ${err}`,
        );
        return null;
      }

      const proxyUrl: string = `${parsedUrl.origin}/proxy/${parsedUrl.hostname}`;

      const proxyResponse: AxiosResponse = await axios.get(proxyUrl, {
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
        proxyResponse.status === 404 ||
        proxyResponse.status === 403 ||
        proxyResponse.status === 401
      ) {
        return null;
      }

      const data: IncidentIoSummaryResponse =
        proxyResponse.data as IncidentIoSummaryResponse;

      const summary: IncidentIoSummaryResponse["summary"] | undefined =
        data?.summary;

      // Not an incident.io page if the summary envelope is missing.
      if (!summary || !Array.isArray(summary.components)) {
        return null;
      }

      // component id -> name
      const componentIdToName: Record<string, string> = {};
      for (const component of summary.components) {
        if (component.id && component.name) {
          componentIdToName[component.id] = component.name;
        }
      }

      // component id -> group name, derived from the page structure.
      const componentIdToGroupName: Record<string, string> = {};
      for (const item of summary.structure?.items || []) {
        const groupName: string | undefined = item.group?.name;
        if (groupName && item.group?.components) {
          for (const groupComponent of item.group.components) {
            if (groupComponent.component_id) {
              componentIdToGroupName[groupComponent.component_id] = groupName;
            }
          }
        }
      }

      // component id -> current status (anything not affected is operational).
      const componentIdToStatus: Record<string, string> = {};
      for (const affected of summary.affected_components || []) {
        if (affected.component_id && affected.status) {
          componentIdToStatus[affected.component_id] = affected.status;
        }
      }

      const resolvedComponents: Array<ResolvedComponent> = [];
      for (const component of summary.components) {
        if (!component.id || !component.name) {
          continue;
        }

        resolvedComponents.push({
          id: component.id,
          name: component.name,
          status: componentIdToStatus[component.id] || "operational",
          groupName: componentIdToGroupName[component.id],
        });
      }

      const incidentAffectedComponentIds: Array<Array<string>> = (
        summary.ongoing_incidents || []
      ).map((incident: IncidentIoIncident) => {
        return (incident.affected_components || [])
          .map((c: IncidentIoAffectedComponent) => {
            return c.component_id || "";
          })
          .filter((id: string) => {
            return Boolean(id);
          });
      });

      const activeIncidentCount: number =
        ExternalStatusPageMonitorUtil.countScopedIncidents({
          config,
          components: resolvedComponents,
          incidentAffectedComponentIds,
        });

      const overallStatus: string =
        ExternalStatusPageMonitorUtil.deriveOverallStatus({
          config,
          components: resolvedComponents,
          fallback: "operational",
        });

      return {
        isOnline: true,
        overallStatus: overallStatus,
        componentStatuses:
          ExternalStatusPageMonitorUtil.toComponentStatuses(resolvedComponents),
        activeIncidentCount: activeIncidentCount,
        responseTimeInMs: 0, // Will be overwritten by caller
        failureCause: "",
        rawBody: JSON.stringify(summary),
      };
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
        );
      }

      // Try Atom format
      if (parsed["feed"]) {
        return ExternalStatusPageMonitorUtil.parseAtomFeed(
          parsed["feed"] as Record<string, unknown>,
          body,
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
    let activeIncidentCount: number = 0;
    const componentStatuses: Array<ExternalStatusPageComponentStatus> = [];

    for (const item of items) {
      const pubDate: string = (item["pubDate"] as string) || "";
      if (pubDate) {
        const itemDate: Date = new Date(pubDate);
        const hoursDiff: number =
          (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60);
        if (hoursDiff <= 24) {
          activeIncidentCount++;
          componentStatuses.push({
            name: (item["title"] as string) || "Unknown",
            status: "incident",
            description: (item["description"] as string) || undefined,
          });
        }
      }
    }

    const overallStatus: string =
      activeIncidentCount > 0 ? "degraded" : "operational";

    return {
      isOnline: true,
      overallStatus: overallStatus,
      componentStatuses: componentStatuses,
      activeIncidentCount: activeIncidentCount,
      responseTimeInMs: 0,
      failureCause: "",
      rawBody: rawBody,
    };
  }

  private static parseAtomFeed(
    feed: Record<string, unknown>,
    rawBody: string,
  ): ExternalStatusPageMonitorResponse {
    const entries: Array<Record<string, unknown>> = Array.isArray(feed["entry"])
      ? (feed["entry"] as Array<Record<string, unknown>>)
      : feed["entry"]
        ? [feed["entry"] as Record<string, unknown>]
        : [];

    // Count active incidents (recent entries — entries updated in the last 24 hours)
    const now: Date = new Date();
    let activeIncidentCount: number = 0;
    const componentStatuses: Array<ExternalStatusPageComponentStatus> = [];

    for (const entry of entries) {
      const updated: string =
        (entry["updated"] as string) || (entry["published"] as string) || "";
      if (updated) {
        const entryDate: Date = new Date(updated);
        const hoursDiff: number =
          (now.getTime() - entryDate.getTime()) / (1000 * 60 * 60);
        if (hoursDiff <= 24) {
          activeIncidentCount++;
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

          componentStatuses.push({
            name: titleText,
            status: "incident",
            description: contentText || undefined,
          });
        }
      }
    }

    const overallStatus: string =
      activeIncidentCount > 0 ? "degraded" : "operational";

    return {
      isOnline: true,
      overallStatus: overallStatus,
      componentStatuses: componentStatuses,
      activeIncidentCount: activeIncidentCount,
      responseTimeInMs: 0,
      failureCause: "",
      rawBody: rawBody,
    };
  }

  // Whether a group and/or component filter is configured.
  public static hasComponentFilter(
    config: MonitorStepExternalStatusPageMonitor,
  ): boolean {
    return Boolean(config.componentGroupName || config.componentName);
  }

  /*
   * Case-insensitive substring match of a component (and its group) against
   * the configured group/component filter. Both must match when both are set
   * — this is what lets the user target a sub-set within a group.
   */
  public static componentMatchesFilter(
    config: MonitorStepExternalStatusPageMonitor,
    componentName: string,
    groupName?: string | undefined,
  ): boolean {
    if (config.componentGroupName) {
      const filterGroup: string = config.componentGroupName.toLowerCase();
      if (!(groupName || "").toLowerCase().includes(filterGroup)) {
        return false;
      }
    }

    if (config.componentName) {
      const filterName: string = config.componentName.toLowerCase();
      if (!componentName.toLowerCase().includes(filterName)) {
        return false;
      }
    }

    return true;
  }

  /*
   * Count active incidents. When a group/component filter is configured,
   * only incidents that affect an in-scope component are counted — so a
   * monitor watching the "APIs" group does not fire on an unrelated
   * ChatGPT incident.
   */
  private static countScopedIncidents(input: {
    config: MonitorStepExternalStatusPageMonitor;
    components: Array<ResolvedComponent>;
    incidentAffectedComponentIds: Array<Array<string>>;
  }): number {
    if (!ExternalStatusPageMonitorUtil.hasComponentFilter(input.config)) {
      return input.incidentAffectedComponentIds.length;
    }

    const inScopeComponentIds: Set<string> = new Set<string>(
      input.components
        .filter((c: ResolvedComponent) => {
          return ExternalStatusPageMonitorUtil.componentMatchesFilter(
            input.config,
            c.name,
            c.groupName,
          );
        })
        .map((c: ResolvedComponent) => {
          return c.id || "";
        })
        .filter((id: string) => {
          return Boolean(id);
        }),
    );

    return input.incidentAffectedComponentIds.filter(
      (affectedIds: Array<string>) => {
        return affectedIds.some((id: string) => {
          return inScopeComponentIds.has(id);
        });
      },
    ).length;
  }

  /*
   * Derive an overall status from the (optionally filtered) components by
   * picking the worst component status. Falls back to the provider's own
   * overall indicator (or "operational") when no component is impacted.
   */
  private static deriveOverallStatus(input: {
    config: MonitorStepExternalStatusPageMonitor;
    components: Array<ResolvedComponent>;
    fallback: string;
  }): string {
    const scopedComponents: Array<ResolvedComponent> =
      ExternalStatusPageMonitorUtil.hasComponentFilter(input.config)
        ? input.components.filter((c: ResolvedComponent) => {
            return ExternalStatusPageMonitorUtil.componentMatchesFilter(
              input.config,
              c.name,
              c.groupName,
            );
          })
        : input.components;

    let worstStatus: string | undefined = undefined;
    let worstRank: number = Number.MAX_SAFE_INTEGER;

    for (const component of scopedComponents) {
      const normalized: string = (component.status || "").toLowerCase();
      const rank: number = COMPONENT_STATUS_SEVERITY.indexOf(normalized);

      // Only non-operational statuses are ranked (operational => rank -1).
      if (rank >= 0 && rank < worstRank) {
        worstRank = rank;
        worstStatus = component.status;
      }
    }

    // Something in scope is impacted — report the worst of it.
    if (worstStatus) {
      return worstStatus;
    }

    /*
     * Everything in scope is operational. When the user scoped to a group/
     * component, report "operational" for that scope rather than leaking
     * the page-level status of unrelated parts of the status page.
     */
    if (ExternalStatusPageMonitorUtil.hasComponentFilter(input.config)) {
      return "operational";
    }

    return input.fallback || "operational";
  }

  // Map internal components onto the public component status type.
  private static toComponentStatuses(
    components: Array<ResolvedComponent>,
  ): Array<ExternalStatusPageComponentStatus> {
    return components.map((component: ResolvedComponent) => {
      return {
        name: component.name,
        status: component.status,
        description: component.description,
        groupName: component.groupName,
      };
    });
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
