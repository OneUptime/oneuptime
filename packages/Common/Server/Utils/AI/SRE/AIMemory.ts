import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IncidentService from "../../../Services/IncidentService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";

/*
 * AI SRE — episodic memory (Phase 4, "I've seen this before").
 *
 * The first, no-new-storage cut of the recurrence short-circuit: instead of a
 * vector store, retrieve past RESOLVED incidents in the same project that share
 * monitors/labels with the current signal and carry a recorded root cause, then
 * feed a compact digest into the investigation so the agent can recognise a
 * recurrence and reference the prior fix.
 *
 * The full episodic store (pgvector embeddings over postmortems/runbooks + a
 * temporal knowledge graph) is the deferred, larger build — this delivers the
 * user-visible "this matches #123" behaviour on data we already own.
 */

// How many recent incidents to consider, and how many prior cases to surface.
const CANDIDATE_LIMIT: number = 30;
const MAX_CASES: number = 4;
const MAX_ROOT_CAUSE_CHARS: number = 300;

const SHARED_MONITOR_SCORE: number = 2;
const SHARED_LABEL_SCORE: number = 1;

export default class AIMemory {
  /*
   * Returns a markdown "past resolved incidents" section to append to the
   * investigation context, or an empty string when there is nothing useful.
   * Never throws — memory is a nice-to-have, not load-bearing.
   */
  @CaptureSpan()
  public static async getPriorSimilarIncidentsContext(data: {
    projectId: ObjectID;
    currentIncidentId: ObjectID;
    monitorNames: Array<string>;
    labelNames: Array<string>;
  }): Promise<string> {
    try {
      const candidates: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          incidentNumber: true,
          title: true,
          rootCause: true,
          createdAt: true,
          currentIncidentState: {
            isResolvedState: true,
          },
          monitors: {
            name: true,
          },
          labels: {
            name: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: CANDIDATE_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

      const currentIdString: string = data.currentIncidentId.toString();
      const monitorSet: Set<string> = new Set(
        data.monitorNames.map((n: string) => {
          return n.toLowerCase();
        }),
      );
      const labelSet: Set<string> = new Set(
        data.labelNames.map((n: string) => {
          return n.toLowerCase();
        }),
      );

      const scored: Array<{ incident: Incident; score: number }> = candidates
        .filter((incident: Incident) => {
          return (
            incident.id?.toString() !== currentIdString &&
            incident.currentIncidentState?.isResolvedState === true &&
            Boolean(incident.rootCause && incident.rootCause.trim().length > 0)
          );
        })
        .map((incident: Incident) => {
          let score: number = 0;

          for (const monitor of incident.monitors || []) {
            if (monitor.name && monitorSet.has(monitor.name.toLowerCase())) {
              score += SHARED_MONITOR_SCORE;
            }
          }

          for (const label of incident.labels || []) {
            if (label.name && labelSet.has(label.name.toLowerCase())) {
              score += SHARED_LABEL_SCORE;
            }
          }

          return { incident, score };
        });

      /*
       * Prefer cases that actually share a monitor/label; otherwise fall back to
       * the most recent resolved incidents (V8's sort is stable, keeping recency).
       */
      const relevant: Array<{ incident: Incident; score: number }> = scored
        .filter((item: { incident: Incident; score: number }) => {
          return item.score > 0;
        })
        .sort(
          (
            a: { incident: Incident; score: number },
            b: { incident: Incident; score: number },
          ) => {
            return b.score - a.score;
          },
        );

      const chosen: Array<{ incident: Incident; score: number }> = (
        relevant.length > 0 ? relevant : scored
      ).slice(0, MAX_CASES);

      if (chosen.length === 0) {
        return "";
      }

      let markdown: string =
        "\n\n# Past resolved incidents in this project (recurrence context)\n" +
        "If the current signal matches one of these, this may be a recurrence — say so explicitly and reference the incident number and how it was resolved.\n";

      for (const { incident } of chosen) {
        const rootCause: string = (incident.rootCause || "").trim();
        const shortRootCause: string =
          rootCause.length > MAX_ROOT_CAUSE_CHARS
            ? `${rootCause.substring(0, MAX_ROOT_CAUSE_CHARS)}…`
            : rootCause;

        markdown += `\n- **#${incident.incidentNumber} — ${incident.title || "Untitled"}**`;
        markdown += `\n  Previously resolved. Root cause: ${shortRootCause}`;

        const monitorNames: Array<string> = (incident.monitors || [])
          .map((m: Monitor) => {
            return m.name || "";
          })
          .filter(Boolean);

        if (monitorNames.length > 0) {
          markdown += `\n  Monitors: ${monitorNames.join(", ")}`;
        }
      }

      return markdown;
    } catch (error) {
      logger.error(`AI: failed to load recurrence context: ${error}`);
      return "";
    }
  }
}
