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
  group_id?: string | null;
}

interface AtlassianComponentsResponse {
  components?: Array<AtlassianComponent>;
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
        // Auto-detect: try Atlassian first, then fall back to RSS/Atom
        response = await ExternalStatusPageMonitorUtil.tryAtlassianStatuspage(
          config,
          options,
        );

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

        // Filter by component name if specified
        if (config.componentName && response.componentStatuses.length > 0) {
          const filterName: string = config.componentName.toLowerCase();
          response.componentStatuses = response.componentStatuses.filter(
            (c: ExternalStatusPageComponentStatus) => {
              return c.name.toLowerCase().includes(filterName);
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

      // Fetch components
      const componentStatuses: Array<ExternalStatusPageComponentStatus> = [];
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
          for (const component of componentsData.components) {
            // Skip group headers (components with no group_id that are groups themselves)
            if (component.name && component.status) {
              componentStatuses.push({
                name: component.name,
                status: component.status,
                description: component.description || undefined,
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

      const overallStatus: string =
        statusData.status.description || statusData.status.indicator || "";

      return {
        isOnline: true,
        overallStatus: overallStatus,
        componentStatuses: componentStatuses,
        activeIncidentCount: 0, // Could be enhanced later with /api/v2/incidents/unresolved.json
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
