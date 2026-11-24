import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import ObjectID from "../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import SecurityLogSourceService from "../../Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../Services/SecurityTelemetrySourceService";
import logger from "../Logger";

/*
 * WHETHER SECURITY EVENTS READS A PROJECT'S LOGS, OR ITS TRACES.
 *
 *   - logs:   an enabled "Your logs" source (SecurityLogSource), which the
 *             log scan reads every minute (LogScan/SecurityLogScanner.ts);
 *   - traces: an enabled "Your OneUptime data" source of kind Traces
 *             (SecurityTelemetrySource), which the trace scan reads
 *             (TelemetryScan/TraceSecurityScan.ts) - or "Your logs" again:
 *             the log scan follows each event of a line written inside a
 *             traced request into its trace (RequestTrace/
 *             SecurityRequestTrace.ts), and takes the client's address
 *             from the span that answered it when the line names none.
 *
 * Asked by ingest, once a batch, for a project whose scrub rules hash IP
 * addresses: only then does the batch keep the addresses for Security
 * Events' address vault (AddressVault/SecurityAddressVaultWriter.ts,
 * #10395). So the answer is cached as ingest caches the scrub rules it
 * runs, for 60 seconds: a source turned on or off is followed within a
 * minute, and a busy project costs one read a minute, not one a batch.
 *
 * A read that fails answers "not read", for a few seconds: the batch keeps
 * no address, which is the private way to be wrong.
 */

export type SecurityEventsReadSignal = "log" | "trace";

// As long as ingest keeps the scrub rules it runs (LogScrubRuleService).
export const SECURITY_EVENTS_READS_CACHE_TTL_MS: number = 60 * 1000;

// How long a failed read's "not read" is kept, so an outage is not asked about every batch.
export const SECURITY_EVENTS_READS_FAILURE_TTL_MS: number = 10 * 1000;

const MAX_CACHED_PROJECTS: number = 10_000;

const cache: InMemoryTTLCache<boolean> = new InMemoryTTLCache<boolean>(
  MAX_CACHED_PROJECTS,
);

export default class SecurityEventsReadTelemetry {
  /*
   * Whether Security Events reads this project's logs ("log") or its traces
   * ("trace") - cached for SECURITY_EVENTS_READS_CACHE_TTL_MS. Never throws.
   */
  public static async readsProjectTelemetry(data: {
    projectId: ObjectID;
    signal: SecurityEventsReadSignal;
  }): Promise<boolean> {
    const key: string = `${data.projectId.toString()}:${data.signal}`;
    const cached: boolean | undefined = cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    try {
      const reads: boolean =
        data.signal === "log"
          ? await this.readsLogs(data.projectId)
          : await this.readsTraces(data.projectId);

      cache.set(key, reads, SECURITY_EVENTS_READS_CACHE_TTL_MS);

      return reads;
    } catch (error) {
      logger.warn(
        `SecurityEventsReadTelemetry: could not read whether Security Events reads the ${data.signal}s of project ${data.projectId.toString()}; its hashed addresses are not kept for Security Events for now.`,
      );
      logger.warn(error);

      cache.set(key, false, SECURITY_EVENTS_READS_FAILURE_TTL_MS);

      return false;
    }
  }

  // Forget every answer, so a test reads the sources it set up.
  public static clearCache(): void {
    cache.clear();
  }

  private static async readsLogs(projectId: ObjectID): Promise<boolean> {
    const source: SecurityLogSource | null =
      await SecurityLogSourceService.findOneBy({
        query: { projectId, isEnabled: true },
        select: { _id: true },
        props: { isRoot: true },
      });

    return Boolean(source);
  }

  // The trace scan's source, else the log scan's, which follows lines into their traces.
  private static async readsTraces(projectId: ObjectID): Promise<boolean> {
    const source: SecurityTelemetrySource | null =
      await SecurityTelemetrySourceService.findOneBy({
        query: {
          projectId,
          kind: SecurityTelemetrySourceKind.Traces,
          isEnabled: true,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

    return Boolean(source) || (await this.readsLogs(projectId));
  }
}
