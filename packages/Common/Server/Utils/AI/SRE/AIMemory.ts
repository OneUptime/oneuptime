import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
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
 *
 * An alert's investigation reads its own past the same way
 * (getPriorSimilarAlertsContext): the project's resolved alerts of the same
 * monitor - the same series of it first, the host, pod or queue it fired
 * for - or with its labels, each with its recorded root cause and the fix
 * OneUptime AI made for it when that fix was verified. Alerts recur far more
 * often than incidents, so an alert that shares nothing with this one is
 * never listed, and a past alert counts when either its cause or its fix is
 * known: an alert OneUptime AI fixed is often closed without a cause typed.
 * A private alert is never one of them, for the same reason.
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
// An alert of the same series of the same monitor: the same thing failing.
const SHARED_SERIES_SCORE: number = 2;
const MAX_ALERT_TITLE_CHARS: number = 200;

// The heading an alert's recurrence context opens with.
export const PAST_RESOLVED_ALERTS_HEADING: string =
  "# Past resolved alerts in this project (recurrence context)";

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
   * The alert twin of getPriorSimilarIncidentsContext: a markdown "past
   * resolved alerts" section for an alert's investigation, or an empty
   * string when nothing is worth saying. Only alerts that share something
   * with this one - its monitor (its series above all) or a label - and
   * whose cause or verified fix is known; never a private one, nor this
   * alert. Never throws: memory is a nice-to-have.
   */
  @CaptureSpan()
  public static async getPriorSimilarAlertsContext(data: {
    projectId: ObjectID;
    currentAlertId: ObjectID;
  }): Promise<string> {
    try {
      const current: Alert | null = await AlertService.findOneBy({
        query: {
          _id: data.currentAlertId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          monitorId: true,
          seriesFingerprint: true,
          labels: { name: true },
        },
        props: { isRoot: true },
      });

      if (!current) {
        return "";
      }

      const resolvedStateIds: Array<ObjectID> =
        await AlertStateService.getResolvedAlertStateIds(data.projectId);

      if (resolvedStateIds.length === 0) {
        return "";
      }

      const select: Record<string, unknown> = {
        _id: true,
        alertNumber: true,
        title: true,
        rootCause: true,
        createdAt: true,
        isPrivate: true,
        monitorId: true,
        seriesFingerprint: true,
        monitor: { name: true },
        labels: { name: true },
      };

      /*
       * The project's newest resolved alerts, and - an alert's own monitor
       * fires often - its monitor's newest resolved alerts, which a busy
       * project's newest would push out.
       */
      const [recent, sameMonitor]: [Array<Alert>, Array<Alert>] =
        await Promise.all([
          AlertService.findBy({
            query: {
              projectId: data.projectId,
              currentAlertStateId: QueryHelper.any(resolvedStateIds),
            },
            select: select as never,
            sort: { createdAt: SortOrder.Descending },
            limit: CANDIDATE_LIMIT,
            skip: 0,
            props: { isRoot: true },
          }),
          current.monitorId
            ? AlertService.findBy({
                query: {
                  projectId: data.projectId,
                  monitorId: current.monitorId,
                  currentAlertStateId: QueryHelper.any(resolvedStateIds),
                },
                select: select as never,
                sort: { createdAt: SortOrder.Descending },
                limit: CANDIDATE_LIMIT,
                skip: 0,
                props: { isRoot: true },
              })
            : Promise.resolve([]),
        ]);

      const currentIdString: string = data.currentAlertId
        .toString()
        .toLowerCase();
      const monitorIdString: string =
        current.monitorId?.toString().toLowerCase() || "";
      const labelSet: Set<string> = new Set(
        (current.labels || [])
          .map((label: Label): string => {
            return (label.name || "").toLowerCase();
          })
          .filter(Boolean),
      );

      const byId: Map<string, Alert> = new Map<string, Alert>();

      for (const alert of [...sameMonitor, ...recent]) {
        const id: string = alert.id?.toString().toLowerCase() || "";

        if (
          !id ||
          id === currentIdString ||
          alert.isPrivate === true ||
          byId.has(id)
        ) {
          continue;
        }

        byId.set(id, alert);
      }

      const scored: Array<{ alert: Alert; score: number }> = Array.from(
        byId.values(),
      )
        .map((alert: Alert) => {
          const isSameMonitor: boolean = Boolean(
            monitorIdString &&
              alert.monitorId?.toString().toLowerCase() === monitorIdString,
          );
          let score: number = isSameMonitor ? SHARED_MONITOR_SCORE : 0;

          if (
            isSameMonitor &&
            current.seriesFingerprint &&
            alert.seriesFingerprint === current.seriesFingerprint
          ) {
            score += SHARED_SERIES_SCORE;
          }

          for (const label of alert.labels || []) {
            if (label.name && labelSet.has(label.name.toLowerCase())) {
              score += SHARED_LABEL_SCORE;
            }
          }

          return { alert, score };
        })
        .filter((item: { alert: Alert; score: number }): boolean => {
          return item.score > 0;
        })
        // V8's sort is stable: the newest first among equals.
        .sort(
          (
            a: { alert: Alert; score: number },
            b: { alert: Alert; score: number },
          ): number => {
            return (
              b.score - a.score ||
              new Date(b.alert.createdAt || 0).getTime() -
                new Date(a.alert.createdAt || 0).getTime()
            );
          },
        );

      if (scored.length === 0) {
        return "";
      }

      const fixes: Map<string, string> = await AIMemory.readVerifiedAlertFixes({
        projectId: data.projectId,
        alertIds: scored
          .map((item: { alert: Alert }): ObjectID | undefined => {
            return item.alert.id || undefined;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          }),
      });

      const chosen: Array<{ alert: Alert; score: number }> = scored
        .filter((item: { alert: Alert }): boolean => {
          return (
            Boolean(item.alert.rootCause && item.alert.rootCause.trim()) ||
            fixes.has(item.alert.id?.toString().toLowerCase() || "")
          );
        })
        .slice(0, MAX_CASES);

      if (chosen.length === 0) {
        return "";
      }

      let markdown: string =
        `\n\n${PAST_RESOLVED_ALERTS_HEADING}\n` +
        "If the current alert matches one of these, this may be a recurrence — say so explicitly and reference that alert's number (alert #305) and how it was resolved. When OneUptime AI's fix of one was verified, say in the next steps whether the same fix applies now.\n";

      for (const { alert } of chosen) {
        const title: string = PromptText.field((alert.title || "").trim(), {
          maxLength: MAX_ALERT_TITLE_CHARS,
        });

        markdown += `\n- **Alert #${alert.alertNumber} — ${title || "Untitled"}**`;

        if (alert.rootCause && alert.rootCause.trim()) {
          markdown += `\n  Previously resolved. Root cause: ${PromptText.field(
            alert.rootCause.trim(),
            { maxLength: MAX_ROOT_CAUSE_CHARS },
          )}`;
        } else {
          markdown += "\n  Previously resolved. No root cause was recorded.";
        }

        if (alert.monitor?.name) {
          markdown += `\n  Monitor: ${PromptText.field(alert.monitor.name, {
            maxLength: MAX_ALERT_TITLE_CHARS,
          })}`;
        }

        if (
          current.seriesFingerprint &&
          alert.seriesFingerprint === current.seriesFingerprint &&
          monitorIdString &&
          alert.monitorId?.toString().toLowerCase() === monitorIdString
        ) {
          markdown +=
            "\n  The same monitor fired it for the same series as this alert.";
        }

        const fix: string | undefined = fixes.get(
          alert.id?.toString().toLowerCase() || "",
        );

        if (fix) {
          markdown += `\n  Fixed by OneUptime AI (verified): ${fix}`;
        }
      }

      return markdown;
    } catch (error) {
      logger.error(
        `AI: failed to load an alert's recurrence context: ${error}`,
      );
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
    return await AIMemory.readVerifiedFixesOf({
      projectId: data.projectId,
      column: "incidentId",
      ids: data.incidentIds,
    });
  }

  // The alert twin of readVerifiedFixes, by alert id (lower case).
  public static async readVerifiedAlertFixes(data: {
    projectId: ObjectID;
    alertIds: Array<ObjectID>;
  }): Promise<Map<string, string>> {
    return await AIMemory.readVerifiedFixesOf({
      projectId: data.projectId,
      column: "alertId",
      ids: data.alertIds,
    });
  }

  private static async readVerifiedFixesOf(data: {
    projectId: ObjectID;
    column: "incidentId" | "alertId";
    ids: Array<ObjectID>;
  }): Promise<Map<string, string>> {
    const fixes: Map<string, string> = new Map<string, string>();

    if (data.ids.length === 0) {
      return fixes;
    }

    try {
      const suggestions: Array<AutoRemediationSuggestion> =
        await AutoRemediationSuggestionService.findBy({
          query: {
            projectId: data.projectId,
            [data.column]: QueryHelper.any(data.ids),
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          } as never,
          select: {
            _id: true,
            incidentId: true,
            alertId: true,
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
        const key: string =
          suggestion[data.column]?.toString().toLowerCase() || "";

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
