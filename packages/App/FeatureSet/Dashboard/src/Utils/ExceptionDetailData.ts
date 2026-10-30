import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import { SpanEvent } from "Common/Models/AnalyticsModels/Span";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import ExceptionDetailSection from "../Components/Exceptions/ExceptionDetailSection";
import { getGroupFingerprints } from "./ExceptionGroupFingerprints";

/*
 * What each exception detail page reads beyond the exception group itself.
 * Only the group read blocks the first paint; everything else loads in the
 * background behind its own section-level loader.
 */
export interface ExceptionDetailDataPlan {
  // The group's Service, for the header's Service cell (every page).
  loadServices: boolean;
  loadStackTrace: boolean;
  loadLatestOccurrence: boolean;
  resolveStackFrames: boolean;
  loadTraceBreadcrumbs: boolean;
  // The latest occurrence's attributes, for the Context page's Attributes card.
  loadOccurrenceAttributes: boolean;
  loadAIAssistance: boolean;
  // OneUptime AI's explanation kept on the exception (the Overview's card).
  loadAiExplanation: boolean;
  loadOccurrenceTrend: boolean;
  // Who resolved / archived the group, for the Settings status history.
  loadTriageHistory: boolean;
  // Resolve / archive buttons in the header (Settings has its own).
  showHeaderActions: boolean;
}

export function getExceptionDetailDataPlan(
  section: ExceptionDetailSection,
): ExceptionDetailDataPlan {
  return {
    loadServices: true,
    loadStackTrace: section === ExceptionDetailSection.StackTrace,
    loadLatestOccurrence:
      section === ExceptionDetailSection.Overview ||
      section === ExceptionDetailSection.StackTrace ||
      section === ExceptionDetailSection.Context ||
      section === ExceptionDetailSection.Logs,
    resolveStackFrames: section === ExceptionDetailSection.StackTrace,
    loadTraceBreadcrumbs: section === ExceptionDetailSection.Context,
    loadOccurrenceAttributes: section === ExceptionDetailSection.Context,
    loadAIAssistance: section === ExceptionDetailSection.AIAssistance,
    loadAiExplanation: section === ExceptionDetailSection.Overview,
    loadOccurrenceTrend: section === ExceptionDetailSection.Overview,
    loadTriageHistory: section === ExceptionDetailSection.Settings,
    showHeaderActions: section !== ExceptionDetailSection.Settings,
  };
}

// Structurally the BreadcrumbTimeline's BreadcrumbEvent.
export interface SpanBreadcrumbEvent {
  name: string;
  time: Date;
  timeUnixNano: number;
  attributes: JSONObject;
}

interface SpanWithEvents {
  events?: unknown;
}

/*
 * Flatten the span events of the latest occurrence's trace into breadcrumbs.
 * An event without a readable time is dropped rather than stamped "now",
 * which used to plant it after the exception on the timeline; a missing
 * timeUnixNano is derived from the time so ordering still works.
 */
export function buildBreadcrumbEventsFromSpans(
  spans: ReadonlyArray<SpanWithEvents> | null | undefined,
): Array<SpanBreadcrumbEvent> {
  const events: Array<SpanBreadcrumbEvent> = [];

  for (const span of spans || []) {
    if (!span || !Array.isArray(span.events)) {
      continue;
    }

    for (const rawEvent of span.events as Array<unknown>) {
      if (!rawEvent || typeof rawEvent !== "object") {
        continue;
      }

      const event: Partial<SpanEvent> = rawEvent as Partial<SpanEvent>;
      const time: Date | null =
        event.time instanceof Date
          ? event.time
          : event.time
            ? new Date(event.time as unknown as string)
            : typeof event.timeUnixNano === "number" && event.timeUnixNano > 0
              ? new Date(Math.floor(event.timeUnixNano / 1000000))
              : null;

      if (!time || Number.isNaN(time.getTime())) {
        continue;
      }

      events.push({
        name: event.name || "",
        time,
        timeUnixNano:
          typeof event.timeUnixNano === "number" && event.timeUnixNano > 0
            ? event.timeUnixNano
            : time.getTime() * 1000000,
        attributes:
          event.attributes && typeof event.attributes === "object"
            ? (event.attributes as JSONObject)
            : {},
      });
    }
  }

  return events;
}

export interface ExceptionOccurrenceQueryOptions {
  projectId: ObjectID;
  fingerprint: string;
  /*
   * The fingerprints of the exceptions merged into this one: their
   * occurrences keep their own fingerprint and are this exception's now.
   */
  mergedFingerprints?: ReadonlyArray<string> | undefined;
  primaryEntityId?: ObjectID | undefined;
}

export function buildExceptionOccurrenceQuery(
  options: ExceptionOccurrenceQueryOptions,
): Query<ExceptionInstance> {
  const fingerprints: Array<string> = getGroupFingerprints(options);

  return {
    projectId: options.projectId,
    fingerprint:
      fingerprints.length > 1 ? new Includes(fingerprints) : options.fingerprint,
    ...(options.primaryEntityId
      ? { primaryEntityId: options.primaryEntityId }
      : {}),
  };
}
