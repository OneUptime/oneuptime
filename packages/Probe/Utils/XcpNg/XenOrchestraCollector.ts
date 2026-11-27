import {
  OpenMetricsParseResult,
  OpenMetricsSample,
  parseOpenMetricsText,
} from "./OpenMetricsText";
import {
  ClassifiedXcpNgError,
  XcpNgCollectionError,
  XcpNgErrorContext,
  classifyXcpNgError,
} from "./XcpNgCollectionErrors";
import {
  XcpNgEndpoint,
  XcpNgTransport,
  XcpNgTransportHandle,
  createXcpNgTransport,
  resolveXcpNgAddress,
} from "./XcpNgHttp";
import XcpNgOtlpBuilder, { XcpNgOtlpBuildResult } from "./XcpNgOtlpBuilder";
import XenOrchestraEventsReader, {
  XO_EVENTS_READ_BUDGET_IN_MS,
} from "./XenOrchestraEventsReader";
import XenOrchestraClient, {
  XO_NO_CONNECTED_HOSTS,
  XenOrchestraPluginState,
} from "./XenOrchestraClient";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import XcpNgCollectionErrorCode from "Common/Types/XcpNg/XcpNgCollectionError";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgEventsJobState,
  XcpNgEventsReport,
} from "Common/Types/XcpNg/XcpNgPoolEvents";
import {
  XCP_NG_COLLECTION_MAX_PAYLOAD_BYTES,
  XcpNgApiTokenSummary,
  XcpNgCollectionJob,
  XcpNgCollectionReport,
  XcpNgCollectionSummary,
  XcpNgConnectionTestJob,
  XcpNgConnectionTestReport,
  XcpNgPoolSummary,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import XcpNgConnectionAddress, {
  XcpNgAddress,
  XcpNgAddressResult,
} from "Common/Utils/XcpNg/XcpNgConnectionAddress";

/*
 * One read, or one connection test, of a Xen Orchestra (#10996) - from the
 * address to the report, as VMwareCollector does for a vCenter:
 *
 *   1. the address is read as the server reads it and checked, with every
 *      address it resolves to, against the addresses a probe never connects
 *      to (SSRFProtection); the socket is pinned to those very addresses;
 *   2. Xen Orchestra is spoken to over a TLS connection verified before the
 *      first byte (VSphereTls), with the OpenMetrics plugin's secret;
 *   3. the scrape is turned into exactly what the XCP-ng Agent sends
 *      (XcpNgOtlpBuilder), and the API token - when one is saved - is
 *      checked at most once an hour: when it expires, and that it only
 *      reads;
 *   4. whatever went wrong becomes a code and an exact sentence
 *      (XcpNgCollectionErrors) - a report is always sent.
 *
 * The secrets never leave this module except to Xen Orchestra, and never
 * appear in a report or a log line.
 */

export const XO_MAX_COLLECTION_TIME_IN_MS: number = 5 * 60_000;
export const XO_TEST_TIME_IN_MS: number = 90_000;
export const XO_TOKEN_CHECK_INTERVAL_IN_MS: number = 60 * 60_000;
export const XO_ADDRESS_LABEL: string = "Xen Orchestra address";

export interface XenOrchestraCollectorDependencies {
  // The addresses an address may be connected to (validated).
  resolve: (url: string) => Promise<Array<string>>;
  createTransport: (data: {
    endpoint: XcpNgEndpoint;
    pinnedAddresses: Array<string>;
    trustedFingerprint: string | null;
  }) => XcpNgTransportHandle;
  now: () => Date;
  scopeVersion: string;
  // Overrides for tests.
  maxPayloadBytes?: number | undefined;
  collectionTimeoutInMs?: number | undefined;
  testTimeoutInMs?: number | undefined;
  tokenCheckIntervalInMs?: number | undefined;
}

export const DEFAULT_XEN_ORCHESTRA_DEPENDENCIES: XenOrchestraCollectorDependencies =
  {
    resolve: (url: string): Promise<Array<string>> => {
      return resolveXcpNgAddress(url, XO_ADDRESS_LABEL);
    },
    createTransport: (data: {
      endpoint: XcpNgEndpoint;
      pinnedAddresses: Array<string>;
      trustedFingerprint: string | null;
    }): XcpNgTransportHandle => {
      return createXcpNgTransport(data);
    },
    now: (): Date => {
      return new Date();
    },
    scopeVersion: AppVersion,
  };

/*
 * What a connection's previous reads left for the next one, in this
 * probe's memory only (a restart starts again, as the agent's collector
 * does): the series served without a timestamp, to mark one that is gone
 * stale; when each counter was first read; and the last check of the API
 * token, for the settings it was made with.
 */
interface ConnectionState {
  previousUntimedSeries: Map<string, OpenMetricsSample>;
  counterStartTimes: Map<string, number>;
  tokenCheck?:
    | {
        settingsVersion: number;
        checkedAtMs: number;
        summary: XcpNgApiTokenSummary;
      }
    | undefined;
}

const connectionStates: Map<string, ConnectionState> = new Map();

// Exported for tests.
export function resetXenOrchestraCollectorState(): void {
  connectionStates.clear();
}

function getState(connectionId: string): ConnectionState {
  let state: ConnectionState | undefined = connectionStates.get(connectionId);

  if (!state) {
    state = {
      previousUntimedSeries: new Map(),
      counterStartTimes: new Map(),
    };
    connectionStates.set(connectionId, state);
  }

  return state;
}

export function withDeadline<T>(
  promise: Promise<T>,
  timeoutInMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (error: Error) => void) => {
      timer = setTimeout(() => {
        reject(
          new XcpNgCollectionError(XcpNgCollectionErrorCode.TimedOut, message),
        );
      }, timeoutInMs);
    },
  );

  return Promise.race([promise, deadline]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

// "48 MiB", "2.5 MiB", "300 KiB" - for the sentences a person reads.
export function formatSize(bytes: number): string {
  const mebibytes: number = bytes / (1024 * 1024);

  if (mebibytes >= 10) {
    return `${Math.round(mebibytes)} MiB`;
  }

  if (mebibytes >= 1) {
    return `${mebibytes.toFixed(1)} MiB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/*
 * How long one read may take: its interval - the next one is due by then -
 * and never more than five minutes, so an address that stopped answering
 * frees the probe's slot.
 */
export function getCollectionBudgetInMs(intervalInMinutes: number): number {
  const minutes: number = Number.isFinite(intervalInMinutes)
    ? Math.max(intervalInMinutes, 1)
    : 1;

  return Math.min(minutes * 60_000, XO_MAX_COLLECTION_TIME_IN_MS);
}

function getErrorContext(address: XcpNgAddress): XcpNgErrorContext {
  return {
    host: address.host,
    port: address.port,
    what: "Xen Orchestra",
    addressLabel: XO_ADDRESS_LABEL,
  };
}

/*
 * The scrape, read: its samples - or the reason it holds none of a pool's.
 */
export function readScrape(data: {
  body: string;
  where: string;
}): OpenMetricsParseResult {
  const parsed: OpenMetricsParseResult = parseOpenMetricsText(data.body);
  const hasXcpSample: boolean = parsed.samples.some(
    (sample: OpenMetricsSample) => {
      return sample.name.startsWith("xcp_");
    },
  );

  if (!hasXcpSample) {
    if (data.body.includes(XO_NO_CONNECTED_HOSTS)) {
      throw new XcpNgCollectionError(
        XcpNgCollectionErrorCode.NoPools,
        `Xen Orchestra at ${data.where} is connected to no pool ("${XO_NO_CONNECTED_HOSTS}"). Add or reconnect your pools in Xen Orchestra.`,
      );
    }

    if (parsed.samples.length === 0 && parsed.invalidLineCount > 0) {
      throw new XcpNgCollectionError(
        XcpNgCollectionErrorCode.NotXenOrchestra,
        `${data.where} did not answer with OpenMetrics (it began "${parsed.firstInvalidLine || ""}"). Enter the address you open Xen Orchestra at.`,
      );
    }

    throw new XcpNgCollectionError(
      XcpNgCollectionErrorCode.NoPools,
      `Xen Orchestra at ${data.where} serves no XCP-ng series: it reports no connected pool.`,
    );
  }

  return parsed;
}

function describePools(pools: Array<XcpNgPoolSummary>): string {
  return pools
    .map((pool: XcpNgPoolSummary): string => {
      return pool.poolName || pool.poolId;
    })
    .join(", ");
}

export default class XenOrchestraCollector {
  public static async collect(
    job: XcpNgCollectionJob,
    dependencies: XenOrchestraCollectorDependencies = DEFAULT_XEN_ORCHESTRA_DEPENDENCIES,
  ): Promise<XcpNgCollectionReport> {
    const startedAt: Date = dependencies.now();
    const report: XcpNgCollectionReport = {
      xcpNgConnectionId: job.xcpNgConnectionId,
      settingsVersion: job.settingsVersion,
      collectedAt: startedAt.toISOString(),
      status: "Failed",
      durationInMs: 0,
    };

    const normalized: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
      job.address,
      XcpNgConnectionType.XenOrchestra,
    );

    if (!normalized.address) {
      report.errorCode = XcpNgCollectionErrorCode.InvalidAddress;
      report.errorMessage = normalized.error;
      return XenOrchestraCollector.finish(report, startedAt, dependencies);
    }

    const address: XcpNgAddress = normalized.address;
    const where: string = `${address.host}:${address.port}`;

    if (!job.openMetricsSecret) {
      report.errorCode = XcpNgCollectionErrorCode.WrongSecret;
      report.errorMessage =
        "No OpenMetrics secret is saved for this Xen Orchestra. Enter it on the connection's page.";
      return XenOrchestraCollector.finish(report, startedAt, dependencies);
    }

    const state: ConnectionState = getState(job.xcpNgConnectionId);
    let handle: XcpNgTransportHandle | null = null;

    const budgetInMs: number =
      dependencies.collectionTimeoutInMs ??
      getCollectionBudgetInMs(job.collectionIntervalInMinutes);
    const maxPayloadBytes: number =
      dependencies.maxPayloadBytes ?? XCP_NG_COLLECTION_MAX_PAYLOAD_BYTES;

    try {
      const pinnedAddresses: Array<string> = await dependencies.resolve(
        address.url,
      );

      handle = dependencies.createTransport({
        endpoint: { host: address.host, port: address.port },
        pinnedAddresses: pinnedAddresses,
        trustedFingerprint: job.trustedCertificateFingerprint || null,
      });

      const client: XenOrchestraClient = new XenOrchestraClient(
        handle.transport,
        { host: address.host, port: address.port },
      );

      const scrapeTimeMs: number = dependencies.now().getTime();

      const body: string = await withDeadline(
        client.readMetrics(job.openMetricsSecret),
        budgetInMs,
        `Reading Xen Orchestra at ${where} took longer than ${Math.round(
          budgetInMs / 1000,
        )} seconds. Collect it less often, or check Xen Orchestra's load.`,
      );

      const parsed: OpenMetricsParseResult = readScrape({
        body: body,
        where: where,
      });

      const built: XcpNgOtlpBuildResult = XcpNgOtlpBuilder.build({
        samples: parsed.samples,
        scrapeTimeMs: scrapeTimeMs,
        target: { host: address.host, port: address.port },
        scopeVersion: dependencies.scopeVersion,
        previousUntimedSeries: state.previousUntimedSeries,
        counterStartTimes: state.counterStartTimes,
      });

      const payloadBytes: number = Buffer.byteLength(
        JSON.stringify(built.resourceMetrics),
      );

      if (payloadBytes > maxPayloadBytes) {
        throw new XcpNgCollectionError(
          XcpNgCollectionErrorCode.PayloadTooLarge,
          `This Xen Orchestra's read is ${formatSize(
            payloadBytes,
          )} of metrics, more than the ${formatSize(
            maxPayloadBytes,
          )} one probe upload takes. Use the XCP-ng Agent for it.`,
        );
      }

      // Kept only for a read that is sent: the next one compares with it.
      state.previousUntimedSeries = built.untimedSeries;

      const warnings: Array<string> = [];

      if (parsed.invalidLineCount > 0) {
        warnings.push(
          `${parsed.invalidLineCount} line(s) of Xen Orchestra's answer were not OpenMetrics and were left out, the first: ${parsed.firstInvalidLine || ""}`,
        );
      }

      const summary: XcpNgCollectionSummary = {
        connectionType: XcpNgConnectionType.XenOrchestra,
        pools: XcpNgOtlpBuilder.summarizePools(parsed.samples),
        resourceCount: built.resourceCount,
        datapointCount: built.datapointCount,
        warnings: warnings,
      };

      if (job.apiToken) {
        summary.apiToken = await XenOrchestraCollector.checkTokenAtMostHourly({
          client: client,
          token: job.apiToken,
          state: state,
          settingsVersion: job.settingsVersion,
          dependencies: dependencies,
        });

        /*
         * The pools' alarms, HA, master, backups and patches (#10997), from
         * where the server says reading stands - over the same verified
         * connection, with the same token, only if it is read-only.
         */
        if (job.events) {
          report.events = await XenOrchestraCollector.readEvents({
            transport: handle.transport,
            where: where,
            token: job.apiToken,
            job: job,
            poolIds: summary.pools.map((pool: XcpNgPoolSummary): string => {
              return pool.poolId;
            }),
            tokenSummary: summary.apiToken,
            budgetInMs: Math.min(XO_EVENTS_READ_BUDGET_IN_MS, budgetInMs),
            dependencies: dependencies,
          });
          for (const warning of report.events.warnings) {
            warnings.push(warning);
          }
        }
      }

      report.status = "Succeeded";
      report.resourceMetrics = built.resourceMetrics;
      report.summary = summary;
    } catch (error) {
      const classified: ClassifiedXcpNgError = classifyXcpNgError(
        error,
        getErrorContext(address),
        job.trustedCertificateFingerprint,
      );

      report.status = "Failed";
      report.errorCode = classified.code;
      report.errorMessage = classified.message;

      if (classified.presentedCertificate) {
        report.presentedCertificate = classified.presentedCertificate;
      }
    } finally {
      handle?.close();
    }

    return XenOrchestraCollector.finish(report, startedAt, dependencies);
  }

  /*
   * The events read, which never fails the collection: the metrics already
   * came through, and whatever went wrong is said in the report's problems
   * - read again next time, from the same watermarks.
   */
  private static async readEvents(data: {
    transport: XcpNgTransport;
    where: string;
    token: string;
    job: XcpNgCollectionJob;
    poolIds: Array<string>;
    tokenSummary: XcpNgApiTokenSummary;
    budgetInMs: number;
    dependencies: XenOrchestraCollectorDependencies;
  }): Promise<XcpNgEventsReport> {
    try {
      return await XenOrchestraEventsReader.read({
        transport: data.transport,
        where: data.where,
        token: data.token,
        state: data.job.events as XcpNgEventsJobState,
        poolIds: data.poolIds,
        tokenSummary: data.tokenSummary,
        now: data.dependencies.now,
        budgetInMs: data.budgetInMs,
      });
    } catch (error) {
      const problem: string = `Reading alarms and backups from Xen Orchestra at ${data.where} failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      return {
        pools: [],
        problems: { messages: problem, backups: problem },
        warnings: [],
      };
    }
  }

  /*
   * The token is read at most once an hour - and at once when the
   * connection's settings change (a new token): between checks, the last
   * one is sent again, so the server keeps its expiry.
   */
  private static async checkTokenAtMostHourly(data: {
    client: XenOrchestraClient;
    token: string;
    state: ConnectionState;
    settingsVersion: number;
    dependencies: XenOrchestraCollectorDependencies;
  }): Promise<XcpNgApiTokenSummary> {
    const nowMs: number = data.dependencies.now().getTime();
    const interval: number =
      data.dependencies.tokenCheckIntervalInMs ?? XO_TOKEN_CHECK_INTERVAL_IN_MS;
    const last: ConnectionState["tokenCheck"] = data.state.tokenCheck;

    if (
      last &&
      last.settingsVersion === data.settingsVersion &&
      nowMs - last.checkedAtMs < interval
    ) {
      return last.summary;
    }

    let summary: XcpNgApiTokenSummary;

    try {
      summary = await data.client.readApiToken(data.token);
    } catch (error) {
      // The metrics came through; the token is checked again next time.
      return {
        errorCode: XcpNgCollectionErrorCode.ApiError,
        errorMessage: `The API token could not be checked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    data.state.tokenCheck = {
      settingsVersion: data.settingsVersion,
      checkedAtMs: nowMs,
      summary: summary,
    };

    return summary;
  }

  /*
   * A connection test: the plugin, the secret, the pools it sees, and - with
   * a token - that the token is read-only and reads alarms and backup logs.
   * Nothing is collected and nothing is kept.
   */
  public static async test(
    job: XcpNgConnectionTestJob,
    dependencies: XenOrchestraCollectorDependencies = DEFAULT_XEN_ORCHESTRA_DEPENDENCIES,
  ): Promise<XcpNgConnectionTestReport> {
    const startedAt: Date = dependencies.now();
    const report: XcpNgConnectionTestReport = {
      xcpNgConnectionTestId: job.xcpNgConnectionTestId,
      status: "Failed",
      durationInMs: 0,
    };

    const normalized: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
      job.address,
      XcpNgConnectionType.XenOrchestra,
    );

    if (!normalized.address) {
      report.errorCode = XcpNgCollectionErrorCode.InvalidAddress;
      report.errorMessage = normalized.error;
      return XenOrchestraCollector.finishTest(report, startedAt, dependencies);
    }

    const address: XcpNgAddress = normalized.address;
    const where: string = `${address.host}:${address.port}`;
    let handle: XcpNgTransportHandle | null = null;
    const summary: XcpNgCollectionSummary = {
      connectionType: XcpNgConnectionType.XenOrchestra,
      pools: [],
      warnings: [],
    };

    try {
      const pinnedAddresses: Array<string> = await dependencies.resolve(
        address.url,
      );

      handle = dependencies.createTransport({
        endpoint: { host: address.host, port: address.port },
        pinnedAddresses: pinnedAddresses,
        trustedFingerprint: job.trustedCertificateFingerprint || null,
      });

      const client: XenOrchestraClient = new XenOrchestraClient(
        handle.transport,
        { host: address.host, port: address.port },
      );

      const testTimeoutInMs: number =
        dependencies.testTimeoutInMs ?? XO_TEST_TIME_IN_MS;

      await withDeadline(
        XenOrchestraCollector.testWithClient({
          client: client,
          job: job,
          where: where,
          summary: summary,
        }),
        testTimeoutInMs,
        `Xen Orchestra at ${where} did not finish the test within ${Math.round(
          testTimeoutInMs / 1000,
        )} seconds.`,
      );

      report.status = "Succeeded";
      report.summary = summary;
    } catch (error) {
      const classified: ClassifiedXcpNgError = classifyXcpNgError(
        error,
        getErrorContext(address),
        job.trustedCertificateFingerprint,
      );

      report.status = "Failed";
      report.errorCode = classified.code;
      report.errorMessage = classified.message;

      if (classified.presentedCertificate) {
        report.presentedCertificate = classified.presentedCertificate;
      }

      // What was seen before the failure still tells the person something.
      if (summary.pools.length > 0 || summary.apiToken) {
        report.summary = summary;
      }
    } finally {
      handle?.close();
    }

    return XenOrchestraCollector.finishTest(report, startedAt, dependencies);
  }

  private static async testWithClient(data: {
    client: XenOrchestraClient;
    job: XcpNgConnectionTestJob;
    where: string;
    summary: XcpNgCollectionSummary;
  }): Promise<void> {
    const { client, job, where, summary } = data;

    try {
      await client.checkPluginAnswers();
    } catch (error) {
      /*
       * With a token that may read plugins, "not loaded" and "this Xen
       * Orchestra has no such plugin" (too old, or an Appliance without
       * Premium) are told apart.
       */
      if (
        error instanceof XcpNgCollectionError &&
        error.code === XcpNgCollectionErrorCode.PluginNotLoaded &&
        job.apiToken
      ) {
        const state: XenOrchestraPluginState | null =
          await client.readPluginState(job.apiToken);

        if (state === "missing") {
          throw new XcpNgCollectionError(
            XcpNgCollectionErrorCode.PluginUnavailable,
            `Xen Orchestra at ${where} has no OpenMetrics plugin to load: it needs Xen Orchestra 6.9 or later, and on the Xen Orchestra Appliance a Premium licence. Without one, connect each pool with XAPI instead.`,
          );
        }

        if (state === "not-loaded") {
          throw new XcpNgCollectionError(
            XcpNgCollectionErrorCode.PluginNotLoaded,
            `Xen Orchestra at ${where} has the OpenMetrics plugin, but it is not loaded. Load openmetrics under Settings, then Plugins, and turn on Auto-load so it comes back after a restart.`,
          );
        }
      }

      throw error;
    }

    if (!job.openMetricsSecret) {
      throw new XcpNgCollectionError(
        XcpNgCollectionErrorCode.WrongSecret,
        "Enter the OpenMetrics plugin's secret, from Settings, then Plugins, then openmetrics in Xen Orchestra.",
      );
    }

    const body: string = await client.readMetrics(job.openMetricsSecret);
    const parsed: OpenMetricsParseResult = readScrape({
      body: body,
      where: where,
    });

    summary.pools = XcpNgOtlpBuilder.summarizePools(parsed.samples);

    if (summary.pools.length === 0) {
      throw new XcpNgCollectionError(
        XcpNgCollectionErrorCode.NoPools,
        `Xen Orchestra at ${where} reports no pool.`,
      );
    }

    if (!job.apiToken) {
      summary.warnings.push(
        `Xen Orchestra answers with ${summary.pools.length} pool(s): ${describePools(
          summary.pools,
        )}. No API token was given: metrics need none; alarms and backups will.`,
      );
      return;
    }

    const token: XcpNgApiTokenSummary = await client.readApiToken(job.apiToken);
    summary.apiToken = token;

    if (token.errorCode) {
      throw new XcpNgCollectionError(
        token.errorCode,
        token.errorMessage || "The API token is not usable.",
      );
    }
  }

  private static finish(
    report: XcpNgCollectionReport,
    startedAt: Date,
    dependencies: XenOrchestraCollectorDependencies,
  ): XcpNgCollectionReport {
    report.durationInMs = Math.max(
      0,
      dependencies.now().getTime() - startedAt.getTime(),
    );
    return report;
  }

  private static finishTest(
    report: XcpNgConnectionTestReport,
    startedAt: Date,
    dependencies: XenOrchestraCollectorDependencies,
  ): XcpNgConnectionTestReport {
    report.durationInMs = Math.max(
      0,
      dependencies.now().getTime() - startedAt.getTime(),
    );
    return report;
  }
}
