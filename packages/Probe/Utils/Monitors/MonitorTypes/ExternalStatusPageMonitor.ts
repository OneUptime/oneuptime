import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import MonitorStepExternalStatusPageMonitor, {
  MonitorStepExternalStatusPageMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import BadDataException from "Common/Types/Exception/BadDataException";
import EgressGuardException from "Common/Types/Exception/EgressGuardException";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import Headers from "Common/Types/API/Headers";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponseBodyReader from "Common/Utils/HTTPResponseBodyReader";
import HttpMonitorRequest, {
  HttpMonitorExecutionContext,
  PreparedHttpMonitorRequest,
  RedirectRequest,
} from "../HttpMonitorRequest";
import MonitorRetry from "../MonitorRetry";
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { XMLParser } from "fast-xml-parser";
import { withoutTrailingSlashes } from "Common/Utils/TrailingRuns";
import StatusPageSummaryUtil, {
  StatusPageSummary,
} from "Common/Types/StatusPage/StatusPageSummary";
import ExternalStatusPageReading, {
  AtlassianStatuspageUrls,
  ExternalStatusPageComponent,
  ExternalStatusPageContents,
  ExternalStatusPageIncident,
} from "Common/Utils/Monitor/ExternalStatusPageReading";
import ExternalStatusPageScope, {
  ExternalStatusPageScopeResult,
} from "Common/Utils/Monitor/ExternalStatusPageScope";
import ExternalStatusPageComponentNames from "Common/Utils/Monitor/ExternalStatusPageComponentNames";

/*
 * A OneUptime page's component's description when the page does not show
 * its status (read in ExternalStatusPageReading).
 */
export { EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN } from "Common/Utils/Monitor/ExternalStatusPageReading";

/*
 * Retries when neither the caller nor the step config sets one: three
 * attempts, the same as before retries were counted after the first attempt.
 */
const DEFAULT_RETRIES_WHEN_UNSET: number = 2;

/*
 * XML object graphs can be tens of times larger than the wire representation.
 * Status feeds are normally small, so keep a tighter streaming ceiling and
 * structural bounds before fast-xml-parser materializes attacker-controlled
 * nodes in the shared probe process.
 */
export const EXTERNAL_STATUS_PAGE_XML_MAX_RESPONSE_BYTES: number = 512 * 1024;
export const EXTERNAL_STATUS_PAGE_XML_MAX_ELEMENT_COUNT: number = 5000;
export const EXTERNAL_STATUS_PAGE_XML_MAX_DEPTH: number = 64;
const HTML_DOCTYPE_PATTERN: RegExp = /^<!doctype\s+html(?:\s|>)/i;

/*
 * Why a OneUptime status page could not be read, when that provider was
 * chosen (tryOneUptimeStatusPage): the page answered, and would not let this
 * probe in.
 */
export const EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE: string =
  "This status page is private: only people who sign in to it, or who know its password, can read it. Only a public status page can be watched.";

export const EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE: string =
  "This status page lets in only the IP addresses on its allowlist, and this probe's address is not one of them. Add the probe's address to the allowlist, or watch the page from a probe inside that network.";

/*
 * A feed's items of the last 24 hours count as active incidents
 * (isRecentFeedItem); an item dated up to 5 minutes ahead counts too.
 */
export const EXTERNAL_STATUS_PAGE_FEED_ACTIVE_WINDOW_IN_MS: number =
  24 * 60 * 60 * 1000;
export const EXTERNAL_STATUS_PAGE_FEED_CLOCK_SKEW_IN_MS: number = 5 * 60 * 1000;

export interface ExternalStatusPageQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
  executionContext?: HttpMonitorExecutionContext | undefined;
}

interface ExternalStatusPageQueryOptionsWithExecutionContext
  extends ExternalStatusPageQueryOptions {
  executionContext: HttpMonitorExecutionContext;
}

export default class ExternalStatusPageMonitorUtil {
  private static isTimeoutError(error: unknown): boolean {
    if (error instanceof TimeoutException) {
      return true;
    }

    const errorCode: unknown = (error as { code?: unknown })?.code;
    if (
      typeof errorCode === "string" &&
      ["ECONNABORTED", "ETIMEDOUT", "ERR_CANCELED"].includes(
        errorCode.toUpperCase(),
      )
    ) {
      return true;
    }

    const message: string = (
      error instanceof Error ? error.message : String(error)
    ).toLowerCase();

    return (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("etimeout") ||
      message.includes("econnaborted")
    );
  }

  private static isFailClosedError(error: unknown): boolean {
    return (
      error instanceof BadDataException ||
      ExternalStatusPageMonitorUtil.isTimeoutError(error)
    );
  }

  private static async readBudgetedResponseBody(
    response: AxiosResponse,
    executionContext: HttpMonitorExecutionContext,
    requestedResponseType: AxiosRequestConfig["responseType"] | undefined,
    maximumResponseBytes?: number | undefined,
  ): Promise<void> {
    const body: Buffer = await HTTPResponseBodyReader.read(response.data, {
      budget: executionContext.responseBodyBudget,
      statusCode: response.status,
      headers: response.headers,
      limitRedirectResponseBody: true,
      maximumResponseBytes: maximumResponseBytes,
      signal: executionContext.signal,
    });
    const text: string = HTTPResponseBodyReader.decodeUtf8(body);

    if (requestedResponseType === "text") {
      response.data = text;
      return;
    }

    if (!text) {
      response.data = "";
      return;
    }

    try {
      response.data = JSON.parse(text) as unknown;
    } catch {
      response.data = text;
    }
  }

  private static async guardedGet(
    initialUrl: string,
    options: {
      executionContext: HttpMonitorExecutionContext;
      headers?: Headers | undefined;
      responseType?: AxiosRequestConfig["responseType"] | undefined;
      validateStatus?: ((status: number) => boolean) | undefined;
      maximumResponseBytes?: number | undefined;
    },
  ): Promise<AxiosResponse> {
    let currentUrl: string = initialUrl;
    let currentHeaders: Headers = { ...(options.headers || {}) };
    let redirectsFollowed: number = 0;
    const finalStatusIsAccepted: (status: number) => boolean =
      options.validateStatus ||
      ((status: number): boolean => {
        return status >= 200 && status < 300;
      });

    while (true) {
      const requestUrl: string = currentUrl;
      const requestHeaders: Headers = currentHeaders;
      const prepared: PreparedHttpMonitorRequest =
        await options.executionContext.run(
          async (): Promise<PreparedHttpMonitorRequest> => {
            return await HttpMonitorRequest.prepare(requestUrl, {
              headers: requestHeaders,
            });
          },
        );
      const axiosOptions: AxiosRequestConfig = {
        timeout: options.executionContext.remainingTimeoutInMs(),
        headers: prepared.headers,
        validateStatus: (status: number): boolean => {
          return (
            [301, 302, 303, 307, 308].includes(status) ||
            finalStatusIsAccepted(status)
          );
        },
        maxRedirects: 0,
        proxy: false,
        /*
         * Axios must not pre-empt the streamed reader: its Node adapter drops
         * the chunk that crosses maxContentLength before our cumulative
         * budget can charge those already-received bytes.
         */
        maxContentLength: -1,
        maxBodyLength: prepared.maxBodyLength,
        responseType: "stream",
        signal: options.executionContext.signal,
      };

      if (prepared.httpAgent) {
        axiosOptions.httpAgent = prepared.httpAgent;
      }
      if (prepared.httpsAgent) {
        axiosOptions.httpsAgent = prepared.httpsAgent;
      }

      const response: AxiosResponse = await options.executionContext.run(
        async (): Promise<AxiosResponse> => {
          try {
            const axiosResponse: AxiosResponse = await axios.get(
              prepared.dispatchUrl,
              axiosOptions,
            );
            await ExternalStatusPageMonitorUtil.readBudgetedResponseBody(
              axiosResponse,
              options.executionContext,
              options.responseType,
              options.maximumResponseBytes,
            );
            return axiosResponse;
          } catch (error: unknown) {
            if (axios.isAxiosError(error) && error.response) {
              await ExternalStatusPageMonitorUtil.readBudgetedResponseBody(
                error.response,
                options.executionContext,
                options.responseType,
                options.maximumResponseBytes,
              );
            }
            throw error;
          }
        },
      );

      const responseHeaders: Headers = {};
      const location: unknown = response.headers?.["location"];
      if (typeof location === "string") {
        responseHeaders["location"] = location;
      }

      const redirect: RedirectRequest | null =
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: currentUrl,
          statusCode: response.status,
          responseHeaders: responseHeaders,
          currentMethod: HTTPMethod.GET,
          requestHeaders: currentHeaders,
          redirectsFollowed: redirectsFollowed,
        });

      if (!redirect) {
        if (!finalStatusIsAccepted(response.status)) {
          throw new AxiosError(
            `Request failed with status code ${response.status}`,
            AxiosError.ERR_BAD_RESPONSE,
            response.config,
            response.request,
            response,
          );
        }
        return response;
      }

      currentUrl = redirect.url;
      currentHeaders = redirect.headers;
      redirectsFollowed++;
    }
  }

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

    const ownsExecutionContext: boolean = !options.executionContext;
    if (!options.executionContext) {
      options.executionContext = new HttpMonitorExecutionContext(
        options.timeout ?? config.timeout ?? 10000,
      );
    }
    const executionContext: HttpMonitorExecutionContext =
      options.executionContext;
    const queryOptions: ExternalStatusPageQueryOptionsWithExecutionContext =
      options as ExternalStatusPageQueryOptionsWithExecutionContext;

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
          queryOptions,
        );

        if (!response) {
          response = await ExternalStatusPageMonitorUtil.tryAtlassianStatuspage(
            config,
            queryOptions,
          );
        }

        /*
         * A OneUptime status page, after the two providers most pages use,
         * so a check of one of theirs asks nothing more. Before the feed: a
         * OneUptime page serves /rss too, but its summary says what each
         * resource's status is and what is under maintenance, which the
         * feed cannot.
         */
        if (!response) {
          response = await ExternalStatusPageMonitorUtil.tryOneUptimeStatusPage(
            config,
            queryOptions,
            { isChosen: false },
          );
        }

        if (!response) {
          response = await ExternalStatusPageMonitorUtil.tryRssAtomFeed(
            config,
            queryOptions,
          );
        }
      } else if (
        provider === ExternalStatusPageProviderType.AtlassianStatuspage
      ) {
        response = await ExternalStatusPageMonitorUtil.tryAtlassianStatuspage(
          config,
          queryOptions,
        );
      } else if (provider === ExternalStatusPageProviderType.IncidentIo) {
        response = await ExternalStatusPageMonitorUtil.tryIncidentIo(
          config,
          queryOptions,
        );
      } else if (provider === ExternalStatusPageProviderType.OneUptime) {
        response = await ExternalStatusPageMonitorUtil.tryOneUptimeStatusPage(
          config,
          queryOptions,
          { isChosen: true },
        );
      } else if (
        provider === ExternalStatusPageProviderType.RSS ||
        provider === ExternalStatusPageProviderType.Atom
      ) {
        response = await ExternalStatusPageMonitorUtil.tryRssAtomFeed(
          config,
          queryOptions,
        );
      }

      if (!response) {
        // If all methods fail, just check if the URL is reachable
        response = await ExternalStatusPageMonitorUtil.tryBasicHttpCheck(
          config,
          queryOptions,
        );
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      if (response) {
        response.responseTimeInMs = responseTimeInMs;

        // Echo the resolved query scope so consumers (summary view, templates) can show what was queried.
        const componentNames: Array<string> =
          MonitorStepExternalStatusPageMonitorUtil.getComponentNames(config);

        response.componentGroupName = config.componentGroupName;
        response.componentName =
          config.componentName ||
          ExternalStatusPageComponentNames.toLegacyName(componentNames);
        response.componentNames = componentNames;

        /*
         * A page only the reachability check could read lists no
         * components: none of the chosen ones is on it.
         */
        if (
          componentNames.length > 0 &&
          !response.provider &&
          response.isOnline
        ) {
          response.unmatchedComponentNames = [...componentNames];
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

        /*
         * A basic HTTP fallback returns an offline result for 4xx/5xx
         * instead of throwing. It still consumes the same retry budget.
         */
        if (
          !response.isOnline &&
          MonitorRetry.canRetry({
            attemptNumber: options.currentRetryCount,
            retries: options.retry ?? config.retries,
            defaultRetries: DEFAULT_RETRIES_WHEN_UNSET,
          })
        ) {
          options.currentRetryCount++;
          executionContext.dispose();
          delete options.executionContext;
          await Sleep.sleep(1000);
          return await ExternalStatusPageMonitorUtil.fetch(config, options);
        }
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

      if (
        !(err instanceof BadDataException) &&
        MonitorRetry.canRetry({
          attemptNumber: options.currentRetryCount,
          retries: options.retry ?? config.retries,
          defaultRetries: DEFAULT_RETRIES_WHEN_UNSET,
        })
      ) {
        options.currentRetryCount++;
        /*
         * Provider subrequests share an attempt's deadline and body budget.
         * A retry starts a new attempt after the previous request is finished.
         */
        executionContext.dispose();
        delete options.executionContext;
        await Sleep.sleep(1000);
        return await ExternalStatusPageMonitorUtil.fetch(config, options);
      }

      /*
       * Check if the probe is online.
       *
       * An egress-guard refusal that is about REACHING the target (DNS, or an
       * address policy) is a network failure like any other and must not be
       * believed on its own — a probe whose own resolver has died would
       * otherwise report every status page as unreachable. It reaches this
       * catch as an EgressGuardException, which extends BadDataException and
       * so would fail closed here; the same carve-out is made in
       * WebsiteMonitor and ApiMonitor. A structurally invalid target still
       * fails closed, because that is the tenant's configuration.
       */
      const shouldVerifyProbeIsOnline: boolean =
        err instanceof EgressGuardException
          ? err.isTargetUnreachable()
          : !ExternalStatusPageMonitorUtil.isFailClosedError(err);

      if (shouldVerifyProbeIsOnline && !options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `ExternalStatusPageMonitor - Probe is not online. Cannot fetch ${options?.monitorId?.toString()} ${config.statusPageUrl} - ERROR: ${err}`,
          );
          return null;
        }
      }

      const isTimeout: boolean =
        ExternalStatusPageMonitorUtil.isTimeoutError(err);

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
    } finally {
      if (ownsExecutionContext) {
        executionContext.dispose();
        delete options.executionContext;
      }
    }
  }

  /*
   * Builds the final response for structured providers (Atlassian,
   * incident.io, OneUptime), applying the monitor's scope - its component
   * group and the components it chose (ExternalStatusPageScope). With a
   * scope, the active incident count and overall status are scoped to ONLY
   * the matching components, so a monitor of (for example) GitHub's Git
   * Operations and Pull Requests does not trip on an incident of Copilot
   * elsewhere on the same status page.
   */
  private static buildScopedResponse(input: {
    config: MonitorStepExternalStatusPageMonitor;
    provider: ExternalStatusPageProviderType;
    components: Array<ExternalStatusPageComponent>;
    incidents: Array<ExternalStatusPageIncident>;
    pageOverallStatus?: string | undefined;
    rawBody?: string | undefined;
  }): ExternalStatusPageMonitorResponse {
    const scope: ExternalStatusPageScopeResult = ExternalStatusPageScope.apply({
      components: input.components,
      incidents: input.incidents,
      componentGroupName: input.config.componentGroupName,
      componentNames: MonitorStepExternalStatusPageMonitorUtil.getComponentNames(
        input.config,
      ),
      pageOverallStatus: input.pageOverallStatus,
    });

    return {
      isOnline: true,
      overallStatus: scope.overallStatus,
      componentStatuses: scope.componentStatuses,
      activeIncidentCount: scope.activeIncidentCount,
      activeIncidentNames: scope.activeIncidentNames,
      incidentsOutsideScopeCount: scope.incidentsOutsideScopeCount,
      unmatchedComponentNames: scope.unmatchedComponentNames,
      responseTimeInMs: 0, // Will be overwritten by caller
      failureCause: "",
      provider: input.provider,
      rawBody: input.rawBody,
    };
  }

  private static async tryAtlassianStatuspage(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptionsWithExecutionContext,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      const urls: AtlassianStatuspageUrls =
        ExternalStatusPageReading.getAtlassianUrls(config.statusPageUrl);
      const baseUrl: string = withoutTrailingSlashes(config.statusPageUrl);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "OneUptime-Probe/1.0",
      };

      // Fetch status
      const statusResponse: AxiosResponse = await this.guardedGet(urls.status, {
        executionContext: options.executionContext,
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

      const pageOverallStatus: string | null =
        ExternalStatusPageReading.readAtlassianPageStatus(statusResponse.data);

      if (pageOverallStatus === null) {
        return null;
      }

      // Fetch components (with group headers so we can resolve group membership).
      let components: Array<ExternalStatusPageComponent> = [];
      try {
        const componentsResponse: AxiosResponse = await this.guardedGet(
          urls.components,
          {
            executionContext: options.executionContext,
            headers: headers,
          },
        );

        components =
          ExternalStatusPageReading.readAtlassianComponents(
            componentsResponse.data,
          ) || [];
      } catch (err) {
        if (ExternalStatusPageMonitorUtil.isFailClosedError(err)) {
          throw err;
        }
        logger.debug(
          `Failed to fetch Atlassian components for ${baseUrl}: ${err}`,
        );
        // Continue without component data
      }

      // Fetch unresolved (active) incidents.
      let incidents: Array<ExternalStatusPageIncident> = [];
      try {
        const incidentsResponse: AxiosResponse = await this.guardedGet(
          urls.unresolvedIncidents,
          {
            executionContext: options.executionContext,
            headers: headers,
          },
        );

        incidents = ExternalStatusPageReading.readAtlassianIncidents(
          incidentsResponse.data,
        );
      } catch (err) {
        if (ExternalStatusPageMonitorUtil.isFailClosedError(err)) {
          throw err;
        }
        logger.debug(
          `Failed to fetch Atlassian unresolved incidents for ${baseUrl}: ${err}`,
        );
        // Continue without incident data
      }

      return ExternalStatusPageMonitorUtil.buildScopedResponse({
        config: config,
        provider: ExternalStatusPageProviderType.AtlassianStatuspage,
        components: components,
        incidents: incidents,
        pageOverallStatus: pageOverallStatus,
        rawBody: JSON.stringify(statusResponse.data),
      });
    } catch (err) {
      if (ExternalStatusPageMonitorUtil.isFailClosedError(err)) {
        throw err;
      }
      logger.debug(
        `Atlassian Statuspage API failed for ${config.statusPageUrl}: ${err}`,
      );
      return null;
    }
  }

  private static async tryIncidentIo(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptionsWithExecutionContext,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      const apiUrl: string | null = ExternalStatusPageReading.getIncidentIoUrl(
        config.statusPageUrl,
      );

      if (!apiUrl) {
        return null;
      }

      const apiResponse: AxiosResponse = await this.guardedGet(apiUrl, {
        executionContext: options.executionContext,
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

      const contents: ExternalStatusPageContents | null =
        ExternalStatusPageReading.readIncidentIo(apiResponse.data);

      if (!contents) {
        return null;
      }

      return ExternalStatusPageMonitorUtil.buildScopedResponse({
        config: config,
        provider: ExternalStatusPageProviderType.IncidentIo,
        components: contents.components,
        incidents: contents.incidents,
        // incident.io has no page-level status field; always derive from components.
        pageOverallStatus: undefined,
        rawBody: JSON.stringify(apiResponse.data).slice(0, 100000),
      });
    } catch (err) {
      if (ExternalStatusPageMonitorUtil.isFailClosedError(err)) {
        throw err;
      }
      logger.debug(
        `incident.io status page API failed for ${config.statusPageUrl}: ${err}`,
      );
      return null;
    }
  }

  /*
   * A status page made with OneUptime, read through its summary
   * (Types/StatusPage/StatusPageSummary): each resource the page shows is a
   * component, by the name the page gives it, in the page's group; its
   * status is the value the page's status stands for
   * (ExternalStatusPageComponentStatusUtil) - under maintenance while a
   * scheduled maintenance event in progress affects it, whatever its
   * monitors' status. The summary holds only what the page shows anyone it
   * lets in, and nothing is asked of the page's project.
   *
   * A page that does not let this probe in - a private page (sign-in or
   * password), or one whose IP allowlist leaves the probe out - says so.
   * When the provider was chosen, that is the answer: the check fails with
   * why. Under Auto it is not taken as a sign of a OneUptime page, and the
   * next format is tried.
   */
  private static async tryOneUptimeStatusPage(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptionsWithExecutionContext,
    data: { isChosen: boolean },
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      const summaryUrl: string | null = StatusPageSummaryUtil.getSummaryUrl(
        config.statusPageUrl,
      );

      if (!summaryUrl) {
        return null;
      }

      const response: AxiosResponse = await this.guardedGet(summaryUrl, {
        executionContext: options.executionContext,
        headers: {
          Accept: "application/json",
          "User-Agent": "OneUptime-Probe/1.0",
        },
        validateStatus: (status: number) => {
          return status < 500;
        },
      });

      if (response.status === 401 && data.isChosen) {
        throw new BadDataException(
          EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
        );
      }

      if (response.status === 403 && data.isChosen) {
        throw new BadDataException(
          EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE,
        );
      }

      if (response.status !== 200) {
        return null;
      }

      const summary: StatusPageSummary | null = StatusPageSummaryUtil.fromJSON(
        response.data,
      );

      if (!summary) {
        return null;
      }

      const contents: ExternalStatusPageContents =
        ExternalStatusPageReading.readOneUptimeSummary(summary);

      return ExternalStatusPageMonitorUtil.buildScopedResponse({
        config: config,
        provider: ExternalStatusPageProviderType.OneUptime,
        components: contents.components,
        incidents: contents.incidents,
        /*
         * The page's banner names the worst status of its monitors, a
         * monitor under maintenance among them. Derived from the components
         * instead, as for incident.io, so maintenance reads as maintenance.
         */
        pageOverallStatus: undefined,
        rawBody: JSON.stringify(StatusPageSummaryUtil.toJSON(summary)).slice(
          0,
          100000,
        ),
      });
    } catch (err) {
      if (ExternalStatusPageMonitorUtil.isFailClosedError(err)) {
        throw err;
      }
      logger.debug(
        `OneUptime status page summary failed for ${config.statusPageUrl}: ${err}`,
      );
      return null;
    }
  }

  private static async tryRssAtomFeed(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptionsWithExecutionContext,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    try {
      const feedUrl: string = withoutTrailingSlashes(config.statusPageUrl);

      const response: AxiosResponse = await this.guardedGet(feedUrl, {
        executionContext: options.executionContext,
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml",
          "User-Agent": "OneUptime-Probe/1.0",
        },
        responseType: "text",
        maximumResponseBytes: EXTERNAL_STATUS_PAGE_XML_MAX_RESPONSE_BYTES,
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

      /*
       * Auto detection deliberately falls back to a basic reachability check
       * for an ordinary HTML status page. A standards-compliant page commonly
       * begins with <!DOCTYPE html>; treat that declaration as a strong HTML
       * signal before the XML safety check rejects declarations in real feed
       * documents. The body is never parsed in this branch.
       */
      if (ExternalStatusPageMonitorUtil.startsWithHtmlDoctype(trimmed)) {
        return null;
      }

      ExternalStatusPageMonitorUtil.assertXmlIsSafeToParse(body);

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
      if (ExternalStatusPageMonitorUtil.isFailClosedError(err)) {
        throw err;
      }
      logger.debug(
        `RSS/Atom feed parsing failed for ${config.statusPageUrl}: ${err}`,
      );
      return null;
    }
  }

  private static startsWithHtmlDoctype(body: string): boolean {
    let remaining: string = body.trimStart();

    /*
     * HTML documents may legally put comments or processing instructions
     * before their doctype. Skip only complete leading constructs; malformed
     * input continues into the fail-closed XML safety scanner below.
     */
    while (remaining.startsWith("<!--") || remaining.startsWith("<?")) {
      const terminator: string = remaining.startsWith("<!--") ? "-->" : "?>";
      const endIndex: number = remaining.indexOf(terminator);
      if (endIndex === -1) {
        return false;
      }
      remaining = remaining.slice(endIndex + terminator.length).trimStart();
    }

    return HTML_DOCTYPE_PATTERN.test(remaining);
  }

  private static assertXmlIsSafeToParse(body: string): void {
    let elementCount: number = 0;
    let depth: number = 0;
    let cursor: number = 0;

    while (cursor < body.length) {
      const tagStart: number = body.indexOf("<", cursor);
      if (tagStart === -1) {
        break;
      }

      if (body.startsWith("<!--", tagStart)) {
        const commentEnd: number = body.indexOf("-->", tagStart + 4);
        cursor = commentEnd === -1 ? body.length : commentEnd + 3;
        continue;
      }

      if (body.startsWith("<![CDATA[", tagStart)) {
        const cdataEnd: number = body.indexOf("]]>", tagStart + 9);
        cursor = cdataEnd === -1 ? body.length : cdataEnd + 3;
        continue;
      }

      if (body.startsWith("<?", tagStart)) {
        const instructionEnd: number = body.indexOf("?>", tagStart + 2);
        cursor = instructionEnd === -1 ? body.length : instructionEnd + 2;
        continue;
      }

      /*
       * Reject DTD/entity declarations rather than asking the parser to
       * interpret another attacker-controlled expansion mechanism.
       */
      if (body.startsWith("<!", tagStart)) {
        throw new BadDataException(
          "Remote XML response contains an unsupported declaration.",
        );
      }

      let tagEnd: number = -1;
      let quote: '"' | "'" | null = null;
      for (let index: number = tagStart + 1; index < body.length; index++) {
        const character: string = body[index]!;
        if (quote) {
          if (character === quote) {
            quote = null;
          }
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }
        if (character === ">") {
          tagEnd = index;
          break;
        }
      }
      if (tagEnd === -1) {
        break;
      }

      const tag: string = body.slice(tagStart + 1, tagEnd).trim();
      if (tag.startsWith("/")) {
        depth = Math.max(0, depth - 1);
      } else if (tag) {
        elementCount++;
        if (elementCount > EXTERNAL_STATUS_PAGE_XML_MAX_ELEMENT_COUNT) {
          throw new BadDataException(
            "Remote XML response exceeded the allowed element count.",
          );
        }

        if (!tag.endsWith("/")) {
          depth++;
          if (depth > EXTERNAL_STATUS_PAGE_XML_MAX_DEPTH) {
            throw new BadDataException(
              "Remote XML response exceeded the allowed nesting depth.",
            );
          }
        }
      }

      cursor = tagEnd + 1;
    }
  }

  /*
   * Whether a feed's item counts as an active incident: published - an
   * Atom entry, updated - in the last 24 hours. An item dated ahead has not
   * happened yet: a scheduled maintenance event a feed dates by its start
   * counts once it starts, not when it is announced. A few minutes ahead
   * still count, for a server clock that runs a little fast.
   */
  private static isRecentFeedItem(itemDate: Date, now: Date): boolean {
    const ageInMs: number = now.getTime() - itemDate.getTime();

    if (Number.isNaN(ageInMs)) {
      return false;
    }

    return (
      ageInMs >= -EXTERNAL_STATUS_PAGE_FEED_CLOCK_SKEW_IN_MS &&
      ageInMs <= EXTERNAL_STATUS_PAGE_FEED_ACTIVE_WINDOW_IN_MS
    );
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
    const componentNames: Array<string> =
      MonitorStepExternalStatusPageMonitorUtil.getComponentNames(config);
    const componentStatuses: Array<ExternalStatusPageComponentStatus> = [];
    let recentItemCount: number = 0;

    for (const item of items) {
      const pubDate: string = (item["pubDate"] as string) || "";
      if (pubDate) {
        const itemDate: Date = new Date(pubDate);
        if (ExternalStatusPageMonitorUtil.isRecentFeedItem(itemDate, now)) {
          recentItemCount++;
          const title: string = (item["title"] as string) || "Unknown";
          /*
           * Feeds carry no component-group data; honor the chosen
           * components only, looked for in the items' titles.
           */
          if (
            ExternalStatusPageMonitorUtil.isFeedItemInScope(
              title,
              componentNames,
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

    return ExternalStatusPageMonitorUtil.buildFeedResponse({
      provider: ExternalStatusPageProviderType.RSS,
      componentStatuses: componentStatuses,
      recentItemCount: recentItemCount,
      isScoped: componentNames.length > 0,
      rawBody: rawBody,
    });
  }

  /*
   * Whether a feed's item is in the monitor's scope: every item, with no
   * components chosen; else one whose title holds a chosen name
   * (ExternalStatusPageComponentNames.isFoundIn).
   */
  private static isFeedItemInScope(
    title: string,
    componentNames: Array<string>,
  ): boolean {
    if (componentNames.length === 0) {
      return true;
    }

    return componentNames.some((name: string): boolean => {
      return ExternalStatusPageComponentNames.isFoundIn(name, title);
    });
  }

  // What a check of a feed reports: each recent item in scope an incident.
  private static buildFeedResponse(data: {
    provider: ExternalStatusPageProviderType;
    componentStatuses: Array<ExternalStatusPageComponentStatus>;
    recentItemCount: number;
    isScoped: boolean;
    rawBody: string;
  }): ExternalStatusPageMonitorResponse {
    const activeIncidentCount: number = data.componentStatuses.length;
    const overallStatus: string =
      activeIncidentCount > 0 ? "degraded_performance" : "operational";

    return {
      isOnline: true,
      overallStatus: overallStatus,
      componentStatuses: data.componentStatuses,
      activeIncidentCount: activeIncidentCount,
      activeIncidentNames: ExternalStatusPageScope.getReportedNames(
        data.componentStatuses,
      ),
      incidentsOutsideScopeCount: data.isScoped
        ? data.recentItemCount - activeIncidentCount
        : 0,
      responseTimeInMs: 0,
      failureCause: "",
      provider: data.provider,
      rawBody: data.rawBody,
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
    const componentNames: Array<string> =
      MonitorStepExternalStatusPageMonitorUtil.getComponentNames(config);
    const componentStatuses: Array<ExternalStatusPageComponentStatus> = [];
    let recentItemCount: number = 0;

    for (const entry of entries) {
      const updated: string =
        (entry["updated"] as string) || (entry["published"] as string) || "";
      if (updated) {
        const entryDate: Date = new Date(updated);
        if (ExternalStatusPageMonitorUtil.isRecentFeedItem(entryDate, now)) {
          recentItemCount++;
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

          /*
           * Feeds carry no component-group data; honor the chosen
           * components only, looked for in the entries' titles.
           */
          if (
            ExternalStatusPageMonitorUtil.isFeedItemInScope(
              titleText,
              componentNames,
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

    return ExternalStatusPageMonitorUtil.buildFeedResponse({
      provider: ExternalStatusPageProviderType.Atom,
      componentStatuses: componentStatuses,
      recentItemCount: recentItemCount,
      isScoped: componentNames.length > 0,
      rawBody: rawBody,
    });
  }

  private static async tryBasicHttpCheck(
    config: MonitorStepExternalStatusPageMonitor,
    options: ExternalStatusPageQueryOptionsWithExecutionContext,
  ): Promise<ExternalStatusPageMonitorResponse> {
    const response: AxiosResponse = await this.guardedGet(
      config.statusPageUrl,
      {
        executionContext: options.executionContext,
        headers: {
          "User-Agent": "OneUptime-Probe/1.0",
        },
        validateStatus: () => {
          return true;
        },
      },
    );

    const isOnline: boolean = response.status >= 200 && response.status < 400;

    return {
      isOnline: isOnline,
      overallStatus: isOnline ? "reachable" : "unreachable",
      componentStatuses: [],
      activeIncidentCount: 0,
      responseTimeInMs: 0,
      failureCause: isOnline ? "" : `HTTP status ${response.status}`,
    };
  }
}
