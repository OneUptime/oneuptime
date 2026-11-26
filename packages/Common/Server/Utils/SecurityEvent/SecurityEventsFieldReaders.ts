import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import ObjectID from "../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  SecurityEventsFieldReads,
  SecurityEventsTelemetrySource,
  TelemetryFieldSignal,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import {
  CompiledScrubRuleReading,
  findSecurityEventsLosses,
} from "../../../Utils/Telemetry/ScrubRuleFieldReads";
import SecurityLogSourceService from "../../Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../Services/SecurityTelemetrySourceService";
import logger from "../Logger";

/*
 * WHICH OF SECURITY EVENTS' SCANS READ A PROJECT'S LOGS OR SPANS, AND WHAT
 * A SCRUB RULE TAKES FROM THEM (#10433).
 *
 * Security Events is the one reader of a log's or a span's fields that is
 * no saved query: its scans read the records themselves, every minute.
 *
 *   - logs:  "Your logs" (an enabled SecurityLogSource) reads every line;
 *   - spans: the Traces source (an enabled SecurityTelemetrySource of kind
 *            Traces) reads every request's span, and "Your logs" follows a
 *            line written in a request into its span for the client's
 *            address (SecurityEventsReadTelemetry, which ingest asks with a
 *            cache; this answers a person, so it reads the sources now).
 *
 * What a rule takes from them is decided by what it hides
 * (Utils/Telemetry/ScrubRuleFieldReads.findSecurityEventsLosses). #10396
 * asks the same to know when Scrub It should hash an address rather than
 * redact it: where Security Events reads the address and would lose it.
 */

export interface SecurityEventsSources {
  // False when the sources could not be read just now: nothing is known.
  isChecked: boolean;
  sources: Array<SecurityEventsTelemetrySource>;
}

// The scans that read a project's logs, or its spans.
export async function findSecurityEventsSources(data: {
  projectId: ObjectID;
  signal: TelemetryFieldSignal;
}): Promise<SecurityEventsSources> {
  try {
    const [logSource, traceSource]: [
      SecurityLogSource | null,
      SecurityTelemetrySource | null,
    ] = await Promise.all([
      SecurityLogSourceService.findOneBy({
        query: { projectId: data.projectId, isEnabled: true },
        select: { _id: true },
        props: { isRoot: true },
      }),
      data.signal === "trace"
        ? SecurityTelemetrySourceService.findOneBy({
            query: {
              projectId: data.projectId,
              kind: SecurityTelemetrySourceKind.Traces,
              isEnabled: true,
            },
            select: { _id: true },
            props: { isRoot: true },
          })
        : Promise.resolve(null),
    ]);
    const sources: Array<SecurityEventsTelemetrySource> = [];

    if (logSource) {
      sources.push(SecurityEventsTelemetrySource.Logs);
    }

    if (traceSource) {
      sources.push(SecurityEventsTelemetrySource.Traces);
    }

    return { isChecked: true, sources };
  } catch (error) {
    logger.warn(
      `SecurityEventsFieldReaders: could not read whether Security Events reads the ${data.signal}s of project ${data.projectId.toString()}:`,
    );
    logger.warn(error);

    return { isChecked: false, sources: [] };
  }
}

/*
 * What Security Events reads of a scrub rule's records, and what the rule
 * would take from it: nothing when no scan reads them, or the rule hides
 * nothing they name an attack by.
 */
export async function findSecurityEventsFieldReads(data: {
  projectId: ObjectID;
  rule: CompiledScrubRuleReading;
}): Promise<SecurityEventsFieldReads> {
  const read: SecurityEventsSources = await findSecurityEventsSources({
    projectId: data.projectId,
    signal: data.rule.rule.signal,
  });

  return {
    isChecked: read.isChecked,
    sources: read.sources,
    loses: findSecurityEventsLosses(data.rule, read.sources),
  };
}
