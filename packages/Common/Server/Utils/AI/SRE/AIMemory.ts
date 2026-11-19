import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AIRunService from "../../../Services/AIRunService";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";
import PromptText from "../../../../Utils/AI/PromptText";
import MeaningMatch, {
  MeaningScore,
  MeaningTerms,
} from "../../../../Utils/AI/MeaningMatch";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunType from "../../../../Types/AI/AIRunType";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import ServiceKnowledge, { NamedService } from "./ServiceKnowledge";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import ReadAudiencePermission from "../../../Types/Database/Permissions/ReadAudiencePermission";
import MemoryReads, { MemoryReader } from "./MemoryReader";

/*
 * AI SRE — episodic memory (Phase 4, "I've seen this before").
 *
 * The no-new-storage cut of the recurrence short-circuit: retrieve past
 * RESOLVED incidents in the same project that look like the current signal
 * and carry a known cause, then feed a compact digest into the
 * investigation so the agent can recognise a recurrence and reference the
 * prior fix.
 *
 * A past incident looks like this one when it shares something with it - a
 * monitor, a service, a label - or when its words say the same thing
 * happened (recall by meaning, issue #6798): its title and cause are matched
 * against this incident's title and description by MeaningMatch, so "Checkout
 * returns 503s" recalls "payments: too many connections to Postgres" though
 * they share no monitor. Each one listed says what it has in common with
 * this incident, so the reader can weigh the match. When nothing matches,
 * the project's most recent resolved incidents are listed instead, and say
 * that nothing in them matched.
 *
 * A cause is known when it was recorded, or when OneUptime AI's analysis of
 * the incident was confirmed by a person (the investigation's human verdict,
 * its TL;DR): what the team confirmed is remembered, what it rejected is
 * not. Embeddings in a vector store would need a Postgres extension on
 * every install and an embeddings API every AI provider does not have;
 * MeaningMatch runs anywhere on data we already own.
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
 * for - or with its labels or services, or whose words match its own, each
 * with its known cause and the fix OneUptime AI made for it when that fix
 * was verified. Alerts recur far more often than incidents, so an alert that
 * matches nothing is never listed, and a past alert counts when either its
 * cause or its fix is known: an alert OneUptime AI fixed is often closed
 * without a cause typed. A private alert is never one of them, for the same
 * reason.
 *
 * Both end with what OneUptime AI has learned about the services the
 * subject is on (ServiceKnowledge): the failures each keeps having, with the
 * fixes that worked.
 *
 * Every read is made for the subject's readers (readAudience, #9576): a
 * past incident or alert set apart by an owner or a label from somebody who
 * reads this report - and its fix, its analysis - is never one of them, nor
 * counted, wherever some role reads incidents or alerts only by owner or
 * label (ReadAudiencePermission).
 */

// How many recent incidents (or alerts) to consider, and how many to surface.
const CANDIDATE_LIMIT: number = 200;
const SAME_MONITOR_CANDIDATE_LIMIT: number = 30;
const MAX_CASES: number = 4;
const MAX_ROOT_CAUSE_CHARS: number = 300;

// What a past incident's fix line holds, at most.
const MAX_FIX_COMMANDS: number = 3;
const MAX_FIX_COMMAND_CHARS: number = 200;
const MAX_FIXES_READ: number = 20;

// The most confirmed analyses read at once.
const MAX_ANALYSES_READ: number = 200;

const SHARED_MONITOR_SCORE: number = 2;
const SHARED_LABEL_SCORE: number = 1;
const SHARED_SERVICE_SCORE: number = 2;
// An alert of the same series of the same monitor: the same thing failing.
const SHARED_SERIES_SCORE: number = 2;
/*
 * What a perfect match by meaning adds to the score: as much as a shared
 * monitor, so it ranks the cases that share nothing, and breaks ties among
 * the ones that share the same, without outranking the same series.
 */
const MEANING_SCORE_WEIGHT: number = 2;
const MAX_ALERT_TITLE_CHARS: number = 200;
const MAX_NAME_CHARS: number = 120;

// The heading an alert's recurrence context opens with.
export const PAST_RESOLVED_ALERTS_HEADING: string =
  "# Past resolved alerts in this project (recurrence context)";

// The heading an incident's recurrence context opens with.
export const PAST_RESOLVED_INCIDENTS_HEADING: string =
  "# Past resolved incidents in this project (recurrence context)";

// What a past case says its cause is when OneUptime AI's analysis is.
const CONFIRMED_ANALYSIS_LABEL: string =
  "Root cause (OneUptime AI's analysis, confirmed by your team)";

// The kinds of subject OneUptime AI investigates and remembers.
export type MemorySubjectKind = "incident" | "alert";

/*
 * How OneUptime AI fixed a record, when its fix was verified: the line a
 * prompt reads (describeFix), and what a page draws in the reader's
 * language - the runbook it started, or the commands of its plan that ran.
 */
export interface VerifiedFix {
  text: string;
  runbookName: string | null;
  commands: Array<string>;
}

// What a past case shares with the subject, for its "Matched on" line.
interface MatchReasons {
  structuralScore: number;
  reasons: Array<string>;
  meaning: MeaningScore | null;
}

export default class AIMemory {
  /*
   * Returns a markdown "past resolved incidents" section - and what is
   * known about the incident's services - to append to the investigation
   * context, or an empty string when there is nothing useful. Never throws
   * — memory is a nice-to-have, not load-bearing.
   */
  @CaptureSpan()
  public static async getPriorSimilarIncidentsContext(data: {
    projectId: ObjectID;
    currentIncidentId: ObjectID;
    monitorNames: Array<string>;
    labelNames: Array<string>;
    // What the incident says happened, for the match by meaning.
    title?: string | undefined;
    description?: string | undefined;
    // Everyone who may see the incident: what every one of them may read.
    readAudience: ReadAudience;
  }): Promise<string> {
    let services: Array<NamedService> = [];
    let recurrence: string = "";

    try {
      services = await ServiceKnowledge.readServicesOfIncident({
        projectId: data.projectId,
        incidentId: data.currentIncidentId,
        readAudience: data.readAudience,
      });

      recurrence = await AIMemory.buildIncidentRecurrence({
        ...data,
        services,
      });
    } catch (error) {
      logger.error(`AI: failed to load recurrence context: ${error}`);
    }

    return (
      recurrence +
      (await ServiceKnowledge.getContextSection({
        projectId: data.projectId,
        services,
        excludeIncidentId: data.currentIncidentId,
        readAudience: data.readAudience,
      }))
    );
  }

  /*
   * The alert twin of getPriorSimilarIncidentsContext: a markdown "past
   * resolved alerts" section for an alert's investigation - and what is
   * known about its services - or an empty string when nothing is worth
   * saying. Only alerts that share something with this one - its monitor
   * (its series above all), a label or a service - or whose words match its
   * own, and whose cause or verified fix is known; never a private one, nor
   * this alert. Never throws: memory is a nice-to-have.
   */
  @CaptureSpan()
  public static async getPriorSimilarAlertsContext(data: {
    projectId: ObjectID;
    currentAlertId: ObjectID;
    // Everyone who may see the alert: what every one of them may read.
    readAudience: ReadAudience;
  }): Promise<string> {
    let services: Array<NamedService> = [];
    let recurrence: string = "";

    try {
      const current: Alert | null = await AlertService.findOneBy({
        query: {
          _id: data.currentAlertId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          monitorId: true,
          seriesFingerprint: true,
          labels: { name: true },
          services: { _id: true, name: true },
        },
        props: ReadAudiencePermission.getReadProps(data.readAudience),
      });

      if (!current) {
        return "";
      }

      services = await ServiceKnowledge.readServicesOfAlert({
        projectId: data.projectId,
        services: current.services,
        monitorId: current.monitorId,
        readAudience: data.readAudience,
      });

      recurrence = await AIMemory.buildAlertRecurrence({
        projectId: data.projectId,
        currentAlertId: data.currentAlertId,
        current,
        services,
        readAudience: data.readAudience,
      });
    } catch (error) {
      logger.error(
        `AI: failed to load an alert's recurrence context: ${error}`,
      );
    }

    return (
      recurrence +
      (await ServiceKnowledge.getContextSection({
        projectId: data.projectId,
        services,
        excludeAlertId: data.currentAlertId,
        readAudience: data.readAudience,
      }))
    );
  }

  /*
   * OneUptime AI's analysis of each of `ids`, by id (lower case), where a
   * person confirmed it: the TL;DR of its newest investigation whose human
   * verdict is Confirmed. Empty when none was, or on any error - what is
   * remembered stands without it.
   */
  public static async readConfirmedAnalyses(
    data: {
      projectId: ObjectID;
      kind: MemorySubjectKind;
      ids: Array<ObjectID>;
    } & MemoryReader,
  ): Promise<Map<string, string>> {
    const analyses: Map<string, string> = new Map<string, string>();

    if (data.ids.length === 0) {
      return analyses;
    }

    const column: "triggeredByIncidentId" | "triggeredByAlertId" =
      data.kind === "incident" ? "triggeredByIncidentId" : "triggeredByAlertId";

    try {
      const runs: Array<AIRun> = await MemoryReads.orNothing(() => {
        return AIRunService.findBy({
          query: {
            projectId: data.projectId,
            [column]: QueryHelper.any(data.ids),
            runType: AIRunType.Investigation,
            humanVerdict: AIRunHumanVerdict.Confirmed,
            analysisTldr: QueryHelper.notNull(),
          } as never,
          select: {
            _id: true,
            triggeredByIncidentId: true,
            triggeredByAlertId: true,
            analysisTldr: true,
            createdAt: true,
          },
          sort: { createdAt: SortOrder.Descending },
          limit: MAX_ANALYSES_READ,
          skip: 0,
          props: MemoryReads.propsOf(data),
        });
      });

      for (const run of runs) {
        const key: string = run[column]?.toString().toLowerCase() || "";
        const tldr: string = (run.analysisTldr || "").trim();

        // The newest confirmed analysis of each speaks for it.
        if (!key || !tldr || analyses.has(key)) {
          continue;
        }

        analyses.set(key, tldr);
      }
    } catch (error) {
      logger.error(`AI: failed to load confirmed analyses: ${error}`);
    }

    return analyses;
  }

  /*
   * How OneUptime AI fixed each of `incidentIds`, by incident id (lower
   * case), when its fix was verified: the runbook it started, or the
   * commands of its plan that ran. Empty when nothing was, or on any error -
   * the recurrence context stands without it.
   */
  public static async readVerifiedFixes(
    data: {
      projectId: ObjectID;
      incidentIds: Array<ObjectID>;
    } & MemoryReader,
  ): Promise<Map<string, string>> {
    return AIMemory.textsOf(
      await AIMemory.readVerifiedFixDetails({
        ...MemoryReads.readerOf(data),
        projectId: data.projectId,
        kind: "incident",
        ids: data.incidentIds,
      }),
    );
  }

  // The alert twin of readVerifiedFixes, by alert id (lower case).
  public static async readVerifiedAlertFixes(
    data: {
      projectId: ObjectID;
      alertIds: Array<ObjectID>;
    } & MemoryReader,
  ): Promise<Map<string, string>> {
    return AIMemory.textsOf(
      await AIMemory.readVerifiedFixDetails({
        ...MemoryReads.readerOf(data),
        projectId: data.projectId,
        kind: "alert",
        ids: data.alertIds,
      }),
    );
  }

  /*
   * How OneUptime AI fixed each of `ids` - incidents or alerts - by id
   * (lower case), when its fix was verified: the line a prompt reads, and
   * the runbook or the commands a page draws. Empty when nothing was, or
   * on any error.
   */
  public static async readVerifiedFixDetails(
    data: {
      projectId: ObjectID;
      kind: MemorySubjectKind;
      ids: Array<ObjectID>;
    } & MemoryReader,
  ): Promise<Map<string, VerifiedFix>> {
    return await AIMemory.readVerifiedFixesOf({
      ...MemoryReads.readerOf(data),
      projectId: data.projectId,
      column: data.kind === "incident" ? "incidentId" : "alertId",
      ids: data.ids,
    });
  }

  // One fix in a line: its runbook, or the commands of its plan that ran.
  public static describeFix(
    suggestion: AutoRemediationSuggestion,
  ): string | null {
    return AIMemory.describeFixDetails(suggestion)?.text || null;
  }

  /*
   * One fix: its runbook, or the commands of its plan that ran - in a line
   * for a prompt, and apart for a page. Null when it ran neither.
   */
  public static describeFixDetails(
    suggestion: AutoRemediationSuggestion,
  ): VerifiedFix | null {
    if (
      suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
    ) {
      const plan: AiRemediationCommandPlan | null =
        AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);
      const commands: Array<string> = (plan?.commands || [])
        .filter((command: AiRemediationCommand): boolean => {
          return (
            command.execution?.status ===
            AiRemediationCommandExecutionStatus.Succeeded
          );
        })
        .slice(0, MAX_FIX_COMMANDS)
        .map((command: AiRemediationCommand): string => {
          return PromptText.field(command.command, {
            maxLength: MAX_FIX_COMMAND_CHARS,
          });
        });

      if (commands.length === 0) {
        return null;
      }

      return {
        text: `ran ${commands
          .map((command: string): string => {
            return `\`${command.split("`").join("'")}\``;
          })
          .join("; ")}`,
        runbookName: null,
        commands,
      };
    }

    if (
      suggestion.suggestionType === AutoRemediationSuggestionType.Runbook &&
      suggestion.runbookNameSnapshot
    ) {
      const runbookName: string = PromptText.field(
        suggestion.runbookNameSnapshot,
        { maxLength: 120 },
      );

      return {
        text: `ran the runbook "${runbookName}"`,
        runbookName,
        commands: [],
      };
    }

    return null;
  }

  /*
   * The "Matched on" line of a past case: what it shares with the subject,
   * then the words that say the same thing happened. Null when it shares
   * nothing.
   */
  public static describeMatch(match: MatchReasons): string | null {
    const parts: Array<string> = [...match.reasons];

    if (
      match.meaning &&
      MeaningMatch.isMatch(match.meaning) &&
      match.meaning.sharedTerms.length > 0
    ) {
      parts.push(
        `what happened reads alike (${match.meaning.sharedTerms
          .map((term: string): string => {
            return PromptText.field(term, { maxLength: 60 });
          })
          .join(", ")})`,
      );
    }

    return parts.length > 0 ? `Matched on: ${parts.join("; ")}` : null;
  }

  private static async buildIncidentRecurrence(data: {
    projectId: ObjectID;
    currentIncidentId: ObjectID;
    monitorNames: Array<string>;
    labelNames: Array<string>;
    title?: string | undefined;
    description?: string | undefined;
    services: Array<NamedService>;
    readAudience: ReadAudience;
  }): Promise<string> {
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
        services: {
          _id: true,
          name: true,
        },
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: CANDIDATE_LIMIT,
      skip: 0,
      props: ReadAudiencePermission.getReadProps(data.readAudience),
    });

    const currentIdString: string = data.currentIncidentId.toString();

    const eligible: Array<Incident> = candidates.filter(
      (incident: Incident): boolean => {
        return (
          incident.id?.toString() !== currentIdString &&
          incident.isPrivate !== true
        );
      },
    );

    // A cause no one recorded may be OneUptime AI's analysis, confirmed.
    const analyses: Map<string, string> = await AIMemory.readConfirmedAnalyses({
      projectId: data.projectId,
      readAudience: data.readAudience,
      kind: "incident",
      ids: eligible
        .filter((incident: Incident): boolean => {
          return !incident.rootCause?.trim();
        })
        .map((incident: Incident): ObjectID | undefined => {
          return incident.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    });

    const known: Array<{
      incident: Incident;
      cause: string;
      isConfirmedAnalysis: boolean;
    }> = [];

    for (const incident of eligible) {
      const recorded: string = incident.rootCause?.trim() || "";
      const analysis: string =
        analyses.get(incident.id?.toString().toLowerCase() || "") || "";

      if (recorded || analysis) {
        known.push({
          incident,
          cause: recorded || analysis,
          isConfirmedAnalysis: !recorded,
        });
      }
    }

    if (known.length === 0) {
      return "";
    }

    const monitorSet: Set<string> = AIMemory.lowerCased(data.monitorNames);
    const labelSet: Set<string> = AIMemory.lowerCased(data.labelNames);
    const serviceIdSet: Set<string> = new Set<string>(
      data.services.map((service: NamedService): string => {
        return service.id;
      }),
    );

    const meaning: Array<MeaningScore | null> = AIMemory.rankByMeaning(
      `${data.title || ""}\n${data.description || ""}`,
      known.map((item: { incident: Incident; cause: string }): string => {
        return `${item.incident.title || ""}\n${item.cause}`;
      }),
    );

    const scored: Array<{
      incident: Incident;
      cause: string;
      isConfirmedAnalysis: boolean;
      match: MatchReasons;
      score: number;
    }> = known.map(
      (
        item: {
          incident: Incident;
          cause: string;
          isConfirmedAnalysis: boolean;
        },
        index: number,
      ) => {
        const reasons: Array<string> = [];
        let structuralScore: number = 0;

        for (const monitor of item.incident.monitors || []) {
          if (monitor.name && monitorSet.has(monitor.name.toLowerCase())) {
            structuralScore += SHARED_MONITOR_SCORE;
            reasons.push(
              `the same monitor (${PromptText.field(monitor.name, { maxLength: MAX_NAME_CHARS })})`,
            );
          }
        }

        for (const service of item.incident.services || []) {
          if (
            service.id &&
            serviceIdSet.has(service.id.toString().toLowerCase())
          ) {
            structuralScore += SHARED_SERVICE_SCORE;
            reasons.push(
              `the same service (${PromptText.field(service.name || "", { maxLength: MAX_NAME_CHARS })})`,
            );
          }
        }

        for (const label of item.incident.labels || []) {
          if (label.name && labelSet.has(label.name.toLowerCase())) {
            structuralScore += SHARED_LABEL_SCORE;
            reasons.push(
              `a shared label (${PromptText.field(label.name, { maxLength: MAX_NAME_CHARS })})`,
            );
          }
        }

        const match: MatchReasons = {
          structuralScore,
          reasons,
          meaning: meaning[index] || null,
        };

        return {
          ...item,
          match,
          score: AIMemory.score(match),
        };
      },
    );

    /*
     * Prefer cases that share something or read alike; otherwise fall back
     * to the most recent resolved incidents (V8's sort is stable, keeping
     * recency among equals).
     */
    const relevant: typeof scored = scored
      .filter((item: { match: MatchReasons }): boolean => {
        return AIMemory.isRelevant(item.match);
      })
      .sort((a: { score: number }, b: { score: number }): number => {
        return b.score - a.score;
      });

    const isFallback: boolean = relevant.length === 0;
    const chosen: typeof scored = (isFallback ? scored : relevant).slice(
      0,
      MAX_CASES,
    );

    const fixes: Map<string, string> = await AIMemory.readVerifiedFixes({
      projectId: data.projectId,
      readAudience: data.readAudience,
      incidentIds: chosen
        .map((item: { incident: Incident }): ObjectID | undefined => {
          return item.incident.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    });

    let markdown: string =
      `\n\n${PAST_RESOLVED_INCIDENTS_HEADING}\n` +
      "If the current signal matches one of these, this may be a recurrence — say so explicitly and reference the incident number and how it was resolved. When OneUptime AI's fix of one was verified, say in the next steps whether the same fix applies now. Each says what it has in common with this incident; a match by meaning alone is a lead to check, not proof.\n";

    for (const item of chosen) {
      const incident: Incident = item.incident;
      // A past incident's screenshot is a note here too, not its base64.
      const shortRootCause: string = PromptText.field(item.cause, {
        maxLength: MAX_ROOT_CAUSE_CHARS,
      });

      markdown += `\n- **#${incident.incidentNumber} — ${incident.title || "Untitled"}**`;
      markdown += `\n  Previously resolved. ${
        item.isConfirmedAnalysis ? CONFIRMED_ANALYSIS_LABEL : "Root cause"
      }: ${shortRootCause}`;

      const monitorNames: Array<string> = (incident.monitors || [])
        .map((m: Monitor) => {
          return m.name || "";
        })
        .filter(Boolean);

      if (monitorNames.length > 0) {
        markdown += `\n  Monitors: ${monitorNames.join(", ")}`;
      }

      if (isFallback) {
        markdown +=
          "\n  Nothing in it matched this incident: it is one of the project's most recent resolved incidents.";
      } else {
        const matchedOn: string | null = AIMemory.describeMatch(item.match);

        if (matchedOn) {
          markdown += `\n  ${matchedOn}`;
        }
      }

      const fix: string | undefined = fixes.get(
        incident.id?.toString().toLowerCase() || "",
      );

      if (fix) {
        markdown += `\n  Fixed by OneUptime AI (verified): ${fix}`;
      }
    }

    return markdown;
  }

  private static async buildAlertRecurrence(data: {
    projectId: ObjectID;
    currentAlertId: ObjectID;
    current: Alert;
    services: Array<NamedService>;
    readAudience: ReadAudience;
  }): Promise<string> {
    const current: Alert = data.current;

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
      services: { _id: true, name: true },
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
          props: ReadAudiencePermission.getReadProps(data.readAudience),
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
              limit: SAME_MONITOR_CANDIDATE_LIMIT,
              skip: 0,
              props: ReadAudiencePermission.getReadProps(data.readAudience),
            })
          : Promise.resolve([]),
      ]);

    const currentIdString: string = data.currentAlertId
      .toString()
      .toLowerCase();
    const monitorIdString: string =
      current.monitorId?.toString().toLowerCase() || "";
    const labelSet: Set<string> = AIMemory.lowerCased(
      (current.labels || []).map((label: Label): string => {
        return label.name || "";
      }),
    );
    const serviceIdSet: Set<string> = new Set<string>(
      data.services.map((service: NamedService): string => {
        return service.id;
      }),
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

    const alerts: Array<Alert> = Array.from(byId.values());

    // A cause no one recorded may be OneUptime AI's analysis, confirmed.
    const analyses: Map<string, string> = await AIMemory.readConfirmedAnalyses({
      projectId: data.projectId,
      readAudience: data.readAudience,
      kind: "alert",
      ids: alerts
        .filter((alert: Alert): boolean => {
          return !alert.rootCause?.trim();
        })
        .map((alert: Alert): ObjectID | undefined => {
          return alert.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    });

    const causeOf: (alert: Alert) => string = (alert: Alert): string => {
      return (
        alert.rootCause?.trim() ||
        analyses.get(alert.id?.toString().toLowerCase() || "") ||
        ""
      );
    };

    const meaning: Array<MeaningScore | null> = AIMemory.rankByMeaning(
      `${current.title || ""}\n${current.description || ""}`,
      alerts.map((alert: Alert): string => {
        return `${alert.title || ""}\n${causeOf(alert)}`;
      }),
    );

    const scored: Array<{ alert: Alert; match: MatchReasons; score: number }> =
      alerts
        .map((alert: Alert, index: number) => {
          const reasons: Array<string> = [];
          const isSameMonitor: boolean = Boolean(
            monitorIdString &&
              alert.monitorId?.toString().toLowerCase() === monitorIdString,
          );
          let structuralScore: number = isSameMonitor
            ? SHARED_MONITOR_SCORE
            : 0;

          if (
            isSameMonitor &&
            current.seriesFingerprint &&
            alert.seriesFingerprint === current.seriesFingerprint
          ) {
            structuralScore += SHARED_SERIES_SCORE;
            reasons.push("the same monitor and series");
          } else if (isSameMonitor) {
            reasons.push("the same monitor");
          }

          for (const service of alert.services || []) {
            if (
              service.id &&
              serviceIdSet.has(service.id.toString().toLowerCase())
            ) {
              structuralScore += SHARED_SERVICE_SCORE;
              reasons.push(
                `the same service (${PromptText.field(service.name || "", { maxLength: MAX_NAME_CHARS })})`,
              );
            }
          }

          for (const label of alert.labels || []) {
            if (label.name && labelSet.has(label.name.toLowerCase())) {
              structuralScore += SHARED_LABEL_SCORE;
              reasons.push(
                `a shared label (${PromptText.field(label.name, { maxLength: MAX_NAME_CHARS })})`,
              );
            }
          }

          const match: MatchReasons = {
            structuralScore,
            reasons,
            meaning: meaning[index] || null,
          };

          return { alert, match, score: AIMemory.score(match) };
        })
        .filter((item: { match: MatchReasons }): boolean => {
          return AIMemory.isRelevant(item.match);
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
      readAudience: data.readAudience,
      alertIds: scored
        .map((item: { alert: Alert }): ObjectID | undefined => {
          return item.alert.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    });

    const chosen: typeof scored = scored
      .filter((item: { alert: Alert }): boolean => {
        return (
          Boolean(causeOf(item.alert)) ||
          fixes.has(item.alert.id?.toString().toLowerCase() || "")
        );
      })
      .slice(0, MAX_CASES);

    if (chosen.length === 0) {
      return "";
    }

    let markdown: string =
      `\n\n${PAST_RESOLVED_ALERTS_HEADING}\n` +
      "If the current alert matches one of these, this may be a recurrence — say so explicitly and reference that alert's number (alert #305) and how it was resolved. When OneUptime AI's fix of one was verified, say in the next steps whether the same fix applies now. Each says what it has in common with this alert; a match by meaning alone is a lead to check, not proof.\n";

    for (const { alert, match } of chosen) {
      const title: string = PromptText.field((alert.title || "").trim(), {
        maxLength: MAX_ALERT_TITLE_CHARS,
      });

      markdown += `\n- **Alert #${alert.alertNumber} — ${title || "Untitled"}**`;

      const recorded: string = alert.rootCause?.trim() || "";
      const cause: string = causeOf(alert);

      if (cause) {
        markdown += `\n  Previously resolved. ${
          recorded ? "Root cause" : CONFIRMED_ANALYSIS_LABEL
        }: ${PromptText.field(cause, { maxLength: MAX_ROOT_CAUSE_CHARS })}`;
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

      const matchedOn: string | null = AIMemory.describeMatch(match);

      if (matchedOn) {
        markdown += `\n  ${matchedOn}`;
      }

      const fix: string | undefined = fixes.get(
        alert.id?.toString().toLowerCase() || "",
      );

      if (fix) {
        markdown += `\n  Fixed by OneUptime AI (verified): ${fix}`;
      }
    }

    return markdown;
  }

  /*
   * How close each of `documents` reads to `query`, in order; all null when
   * the query says nothing a match could be made on.
   */
  private static rankByMeaning(
    query: string,
    documents: Array<string>,
  ): Array<MeaningScore | null> {
    const queryTerms: MeaningTerms = MeaningMatch.read(query);

    if (queryTerms.weights.size === 0 || documents.length === 0) {
      return documents.map((): null => {
        return null;
      });
    }

    return MeaningMatch.rank({
      query: queryTerms,
      documents: documents.map((document: string): MeaningTerms => {
        return MeaningMatch.read(document);
      }),
    });
  }

  // A past case is worth listing when it shares something or reads alike.
  private static isRelevant(match: MatchReasons): boolean {
    return (
      match.structuralScore > 0 ||
      Boolean(match.meaning && MeaningMatch.isMatch(match.meaning))
    );
  }

  private static score(match: MatchReasons): number {
    return (
      match.structuralScore +
      (match.meaning && MeaningMatch.isMatch(match.meaning)
        ? MEANING_SCORE_WEIGHT * match.meaning.similarity
        : 0)
    );
  }

  // The line each fix reads as in a prompt, by the same key.
  private static textsOf(
    fixes: Map<string, VerifiedFix>,
  ): Map<string, string> {
    const texts: Map<string, string> = new Map<string, string>();

    for (const [key, fix] of fixes) {
      texts.set(key, fix.text);
    }

    return texts;
  }

  private static lowerCased(names: Array<string>): Set<string> {
    return new Set<string>(
      names
        .map((name: string): string => {
          return name.toLowerCase();
        })
        .filter(Boolean),
    );
  }

  private static async readVerifiedFixesOf(
    data: {
      projectId: ObjectID;
      column: "incidentId" | "alertId";
      ids: Array<ObjectID>;
    } & MemoryReader,
  ): Promise<Map<string, VerifiedFix>> {
    const fixes: Map<string, VerifiedFix> = new Map<string, VerifiedFix>();

    if (data.ids.length === 0) {
      return fixes;
    }

    try {
      const suggestions: Array<AutoRemediationSuggestion> =
        await MemoryReads.orNothing(() => {
          return AutoRemediationSuggestionService.findBy({
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
            props: MemoryReads.propsOf(data),
          });
        });

      for (const suggestion of suggestions) {
        const key: string =
          suggestion[data.column]?.toString().toLowerCase() || "";

        // The newest verified fix of each incident speaks for it.
        if (!key || fixes.has(key)) {
          continue;
        }

        const described: VerifiedFix | null =
          AIMemory.describeFixDetails(suggestion);

        if (described) {
          fixes.set(key, described);
        }
      }
    } catch (error) {
      logger.error(`AI: failed to load past incidents' fixes: ${error}`);
    }

    return fixes;
  }
}
