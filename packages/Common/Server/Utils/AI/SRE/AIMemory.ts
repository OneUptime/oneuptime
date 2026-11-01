import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";
import PromptText from "../../../../Utils/AI/PromptText";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";

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
 *
 * Each past incident also says how OneUptime AI fixed it, when a fix of its
 * was verified - the runbook it started or the commands it ran - so a
 * recurrence names the fix that worked last time, not only the cause. A
 * private incident is never one of them: its title and root cause would
 * reach this incident's report, which everyone who can see this one reads.
 */

// How many recent incidents to consider, and how many prior cases to surface.
const CANDIDATE_LIMIT: number = 30;
const MAX_CASES: number = 4;
const MAX_ROOT_CAUSE_CHARS: number = 300;

// What a past incident's fix line holds, at most.
const MAX_FIX_COMMANDS: number = 3;
const MAX_FIX_COMMAND_CHARS: number = 200;
const MAX_FIXES_READ: number = 20;

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
      /*
       * The project's resolved incidents (Common/Utils/ResolvedState): in
       * its resolved state, or a state placed after it.
       */
      const candidates: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: data.projectId,
          currentIncidentStateId: QueryHelper.any(
            await IncidentStateService.getResolvedIncidentStateIds(
              data.projectId,
            ),
          ),
        },
        select: {
          _id: true,
          incidentNumber: true,
          title: true,
          rootCause: true,
          createdAt: true,
          isPrivate: true,
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
            incident.isPrivate !== true &&
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

      const fixes: Map<string, string> = await AIMemory.readVerifiedFixes({
        projectId: data.projectId,
        incidentIds: chosen
          .map((item: { incident: Incident }): ObjectID | undefined => {
            return item.incident.id || undefined;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          }),
      });

      let markdown: string =
        "\n\n# Past resolved incidents in this project (recurrence context)\n" +
        "If the current signal matches one of these, this may be a recurrence — say so explicitly and reference the incident number and how it was resolved. When OneUptime AI's fix of one was verified, say in the next steps whether the same fix applies now.\n";

      for (const { incident } of chosen) {
        // A past incident's screenshot is a note here too, not its base64.
        const shortRootCause: string = PromptText.field(
          (incident.rootCause || "").trim(),
          { maxLength: MAX_ROOT_CAUSE_CHARS },
        );

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

        const fix: string | undefined = fixes.get(
          incident.id?.toString().toLowerCase() || "",
        );

        if (fix) {
          markdown += `\n  Fixed by OneUptime AI (verified): ${fix}`;
        }
      }

      return markdown;
    } catch (error) {
      logger.error(`AI: failed to load recurrence context: ${error}`);
      return "";
    }
  }

  /*
   * How OneUptime AI fixed each of `incidentIds`, by incident id (lower
   * case), when its fix was verified: the runbook it started, or the
   * commands of its plan that ran. Empty when nothing was, or on any error -
   * the recurrence context stands without it.
   */
  public static async readVerifiedFixes(data: {
    projectId: ObjectID;
    incidentIds: Array<ObjectID>;
  }): Promise<Map<string, string>> {
    const fixes: Map<string, string> = new Map<string, string>();

    if (data.incidentIds.length === 0) {
      return fixes;
    }

    try {
      const suggestions: Array<AutoRemediationSuggestion> =
        await AutoRemediationSuggestionService.findBy({
          query: {
            projectId: data.projectId,
            incidentId: QueryHelper.any(data.incidentIds),
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          },
          select: {
            _id: true,
            incidentId: true,
            suggestionType: true,
            runbookNameSnapshot: true,
            commandPlan: true,
            createdAt: true,
          },
          sort: { createdAt: SortOrder.Descending },
          limit: MAX_FIXES_READ,
          skip: 0,
          props: { isRoot: true },
        });

      for (const suggestion of suggestions) {
        const key: string = suggestion.incidentId?.toString().toLowerCase() || "";

        // The newest verified fix of each incident speaks for it.
        if (!key || fixes.has(key)) {
          continue;
        }

        const described: string | null = AIMemory.describeFix(suggestion);

        if (described) {
          fixes.set(key, described);
        }
      }
    } catch (error) {
      logger.error(`AI: failed to load past incidents' fixes: ${error}`);
    }

    return fixes;
  }

  // One fix in a line: its runbook, or the commands of its plan that ran.
  public static describeFix(
    suggestion: AutoRemediationSuggestion,
  ): string | null {
    if (
      suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
    ) {
      const plan: AiRemediationCommandPlan | null =
        AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);
      const ran: Array<string> = (plan?.commands || [])
        .filter((command: AiRemediationCommand): boolean => {
          return (
            command.execution?.status ===
            AiRemediationCommandExecutionStatus.Succeeded
          );
        })
        .slice(0, MAX_FIX_COMMANDS)
        .map((command: AiRemediationCommand): string => {
          return `\`${PromptText.field(command.command, {
            maxLength: MAX_FIX_COMMAND_CHARS,
          })
            .split("`")
            .join("'")}\``;
        });

      return ran.length > 0 ? `ran ${ran.join("; ")}` : null;
    }

    if (
      suggestion.suggestionType === AutoRemediationSuggestionType.Runbook &&
      suggestion.runbookNameSnapshot
    ) {
      return `ran the runbook "${PromptText.field(suggestion.runbookNameSnapshot, { maxLength: 120 })}"`;
    }

    return null;
  }
}
