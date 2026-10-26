import {
  describeClusterToolOutcome,
  ClusterToolOutcome,
  isClusterToolName,
  isInfrastructureResultUnknownMessage,
  isInfrastructureToolName,
  isKubectlResultUnknownMessage,
} from "../AI/ClusterToolFormat";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import {
  AIPromptOmissions,
  FollowUpCheckActivity,
  LinkedInfrastructureActivity,
  RecentChangesActivity,
} from "Common/Types/AI/AIChatTypes";
import { formatSize } from "Common/Utils/AI/PromptText";
import IconProp from "Common/Types/Icon/IconProp";
import { RUN_KUBECTL_TOOL_NAME } from "Common/Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import { RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME } from "Common/Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  composedValue,
  getGlobalTranslator,
  TemplateValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { formatNameList, getListSeparator } from "../AiAccess/AiAccessModes";
import {
  LlmProviderActivity,
  isLlmProviderActivityWarning,
} from "Common/Types/AI/LlmProviderChoice";
import { describeRuleLlmProviderActivity } from "../AI/RuleLlmProviderCopy";
import {
  AiContextActivity,
  isAiContextActivity,
} from "Common/Types/AI/AiContext";
import {
  describeAiContextActivity,
  describeAiContextActivityDetail,
  describeAiContextLeftOut,
} from "../AISettings/AiContextCopy";
import {
  AiContextActivityDialog,
  AiContextViewButton,
} from "../AI/AiContextActivityView";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

/*
 * The AI tools that reach a Kubernetes cluster rather than the project's
 * telemetry — their calls are never "telemetry queries". Defined with the
 * rest of the cluster-tool wording; re-exported for existing importers.
 */
export { CLUSTER_TOOL_NAMES, isClusterToolName } from "../AI/ClusterToolFormat";

/*
 * What an investigation's kubectl calls actually did, read from the run's
 * own events. The server records a command that reached kubectl as a
 * completed call (rowCount 1 when it succeeded, 0 when kubectl returned an
 * error), a command that never reached kubectl — refused, never picked up
 * by the cluster's Runner, or out of budget — as a failed call, and a
 * command a Runner took whose result never came back as a failed call
 * marked "result unknown". The three are never confused for one another.
 */
export interface KubectlActivitySummary {
  // run_kubectl calls that ran on the cluster.
  executed: number;
  // Of those, the ones kubectl completed without an error.
  succeeded: number;
  // run_kubectl calls that did not run at all.
  notRun: number;
  /*
   * run_kubectl calls a Runner took but never reported back on: they may
   * or may not have run. Absent (read as 0) from callers that predate it.
   */
  unknown?: number | undefined;
  /*
   * Every cluster tool call started (run_kubectl and list_cluster_access),
   * which the run's toolCallCount includes and "telemetry queries" must not.
   * The infrastructure tools' calls (run_infrastructure_command and
   * list_infrastructure_access) are counted here too, for the same reason.
   */
  clusterToolCalls: number;
  /*
   * What the run's infrastructure commands did, counted the same way as
   * its kubectl calls. Absent when the run made no infrastructure call.
   */
  infrastructure?: InfrastructureActivitySummary | undefined;
}

/*
 * What an investigation's commands on infrastructure resources (through
 * their AI agents) did, read from the run's events like its kubectl calls:
 * ran (and whether the command succeeded), never ran, or taken by an agent
 * that never reported back (result unknown).
 */
export interface InfrastructureActivitySummary {
  // run_infrastructure_command calls that ran on a resource.
  executed: number;
  // Of those, the ones that completed without an error.
  succeeded: number;
  // run_infrastructure_command calls that did not run at all.
  notRun: number;
  // Calls an agent took but never reported back on: they may have run.
  unknown: number;
}

/*
 * Counted over the latest attempt only (the events after the last
 * RunStarted), the same span the report, its evidence and the run's
 * counters describe: a retried run keeps its earlier attempts' events.
 */
export function summarizeKubectlActivity(
  events: Array<AIRunEvent>,
): KubectlActivitySummary {
  let latestRunStartedIndex: number = -1;
  events.forEach((event: AIRunEvent, index: number): void => {
    if (event.eventType === AIRunEventType.RunStarted) {
      latestRunStartedIndex = index;
    }
  });

  const summary: KubectlActivitySummary = {
    executed: 0,
    succeeded: 0,
    notRun: 0,
    unknown: 0,
    clusterToolCalls: 0,
  };

  const infrastructure: InfrastructureActivitySummary = {
    executed: 0,
    succeeded: 0,
    notRun: 0,
    unknown: 0,
  };
  let hasInfrastructureActivity: boolean = false;

  events.forEach((event: AIRunEvent, index: number): void => {
    if (index < latestRunStartedIndex) {
      return;
    }

    if (
      event.eventType === AIRunEventType.ToolCallStarted &&
      isClusterToolName(event.toolName)
    ) {
      summary.clusterToolCalls++;
      return;
    }

    if (isInfrastructureToolName(event.toolName)) {
      hasInfrastructureActivity = true;
      countInfrastructureEvent(event, summary, infrastructure);
      return;
    }

    if (event.toolName !== RUN_KUBECTL_TOOL_NAME) {
      return;
    }

    if (event.eventType === AIRunEventType.ToolCallCompleted) {
      summary.executed++;
      if ((event.resultSummary?.rowCount ?? 0) > 0) {
        summary.succeeded++;
      }
      return;
    }

    if (event.eventType === AIRunEventType.ToolCallFailed) {
      if (isKubectlResultUnknownMessage(event.resultSummary?.errorMessage)) {
        summary.unknown = (summary.unknown || 0) + 1;
      } else {
        summary.notRun++;
      }
    }
  });

  if (hasInfrastructureActivity) {
    summary.infrastructure = infrastructure;
  }

  return summary;
}

/*
 * One infrastructure tool event: a started call is a non-telemetry call;
 * a command's completion or failure says whether it ran.
 */
function countInfrastructureEvent(
  event: AIRunEvent,
  summary: KubectlActivitySummary,
  infrastructure: InfrastructureActivitySummary,
): void {
  if (event.eventType === AIRunEventType.ToolCallStarted) {
    summary.clusterToolCalls++;
    return;
  }

  if (event.toolName !== RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME) {
    return;
  }

  if (event.eventType === AIRunEventType.ToolCallCompleted) {
    infrastructure.executed++;
    if ((event.resultSummary?.rowCount ?? 0) > 0) {
      infrastructure.succeeded++;
    }
    return;
  }

  if (event.eventType === AIRunEventType.ToolCallFailed) {
    if (
      isInfrastructureResultUnknownMessage(event.resultSummary?.errorMessage)
    ) {
      infrastructure.unknown++;
    } else {
      infrastructure.notRun++;
    }
  }
}

export interface ComponentProps {
  events: Array<AIRunEvent>;
  /*
   * Header text above the steps, in English (translated here). Defaults to
   * the live "Investigating…" wording used by chat and the AI investigation
   * panel.
   */
  title?: string | undefined;
  // Show the pulsing "live" dot next to the title. Defaults to true.
  showLiveIndicator?: boolean | undefined;
  // How many trailing steps to show. Defaults to 7 (chat-panel sizing).
  maxVisibleSteps?: number | undefined;
  /*
   * Render only the steps — no assistant avatar, bubble, or title row. Use it
   * when the host already provides that framing (the AI investigation panel
   * puts the feed inside its own titled section); leaving the chrome on there
   * would stack a bordered bubble inside a bordered panel and repeat the
   * heading. Defaults to false, so the chat panel is unchanged.
   */
  hideChrome?: boolean | undefined;
}

interface ActivityStep {
  key: string;
  text: string;
  detail?: string | undefined;
  status: "running" | "done" | "failed";
  /*
   * Distinguishes plain steps from executor log lines (ProgressLog) and
   * executed actions (ActionExecuted) so they can render differently.
   */
  kind?: "log" | "action" | undefined;
  // Log severity for ProgressLog steps (Info/Warning/Error/…).
  severity?: string | undefined;
  /*
   * What the run read of the project's AI context, word for word: the
   * step's View opens it (AiContextActivityDialog).
   */
  aiContext?: AiContextActivity | undefined;
}

// English keys, translated as the steps are built.
const friendlyToolNames: { [key: string]: string } = {
  query_incidents: translationKey("Checking incidents"),
  query_alerts: translationKey("Checking alerts"),
  query_monitors: translationKey("Checking monitors"),
  top_exceptions: translationKey("Ranking exceptions"),
  search_logs: translationKey("Searching logs"),
  log_histogram: translationKey("Charting log volume"),
  query_metrics: translationKey("Aggregating metrics"),
  baseline_anomaly: translationKey("Comparing a metric with its baseline"),
  query_telemetry_resources: translationKey("Listing infrastructure resources"),
  query_resource_telemetry: translationKey("Reading a resource's telemetry"),
  query_containers: translationKey("Checking the host's containers"),
  /*
   * Security Events: the events, the cases, what threat intel knows and how
   * unusual an entity is - what a security case's triage reads.
   */
  search_security_events: translationKey("Searching security events"),
  security_event_summary: translationKey("Summarizing security events"),
  query_security_cases: translationKey("Reading security cases"),
  lookup_threat_intel: translationKey("Checking threat intel"),
  security_entity_activity: translationKey("Checking how unusual an entity is"),
  query_security_playbooks: translationKey("Listing playbooks"),
  add_security_case_note: translationKey("Adding a note to the case"),
  run_security_playbook: translationKey("Starting a playbook"),
  /*
   * What every investigation reads besides telemetry: past incidents like
   * this one, what changed just before it, and its own timeline.
   */
  search_incidents: translationKey("Searching past incidents"),
  recent_changes: translationKey("Checking recent changes"),
  get_incident_timeline: translationKey("Reading the incident timeline"),
  get_alert_timeline: translationKey("Reading the alert timeline"),
  query_traces: translationKey("Analyzing traces"),
  get_trace: translationKey("Reading trace"),
  lookup_context: translationKey("Resolving names"),
  create_incident: translationKey("Creating incident"),
  acknowledge_incident: translationKey("Acknowledging incident"),
  resolve_incident: translationKey("Resolving incident"),
  acknowledge_alert: translationKey("Acknowledging alert"),
  resolve_alert: translationKey("Resolving alert"),
  // What an incident or alert is about (#5293), never the tool's own name.
  add_incident_affected_resources: translationKey("Linking affected resources"),
  add_alert_affected_resources: translationKey("Linking affected resources"),
  run_kubectl: translationKey("Running kubectl on the cluster"),
  list_cluster_access: translationKey("Checking cluster access"),
  run_infrastructure_command: translationKey(
    "Running a command on the infrastructure",
  ),
  list_infrastructure_access: translationKey("Checking infrastructure access"),
  list_command_targets: translationKey("Listing where commands may run"),
  execute_remediation_command: translationKey("Applying a fix"),
  propose_remediation_commands: translationKey("Proposing a fix for approval"),
  // The project's external MCP servers (Settings → AI → External MCP Servers).
  [LIST_MCP_TOOLS_TOOL_NAME]: translationKey(
    "Listing the tools of your MCP servers",
  ),
  [CALL_MCP_TOOL_TOOL_NAME]: translationKey("Using a tool of an MCP server"),
};

function friendlyToolName(
  toolName: string | undefined,
  translator: Translator,
): string {
  const friendlyName: string | undefined = friendlyToolNames[toolName || ""];

  if (friendlyName) {
    return translator.translateText(friendlyName) as string;
  }

  return toolName
    ? translator.translateTemplate("Running {{tool}}", { tool: toolName })
    : (translator.translateText("Running query") as string);
}

/*
 * The detail for a failed call. A failed kubectl call produced nothing to
 * read: either it never reached the cluster, or a Runner took it and never
 * reported back, in which case it may have run. Say which rather than
 * implying it ran and will be retried.
 */
function describeFailedToolCall(
  event: AIRunEvent,
  translator: Translator,
): string {
  // The same three outcomes for a command on an infrastructure resource.
  if (event.toolName === RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME) {
    return translator.translateText(
      isInfrastructureResultUnknownMessage(event.resultSummary?.errorMessage)
        ? "no result came back — it may have run"
        : "did not run on the infrastructure",
    ) as string;
  }

  if (event.toolName !== RUN_KUBECTL_TOOL_NAME) {
    return translator.translateText(
      "did not succeed — retrying differently",
    ) as string;
  }

  return translator.translateText(
    isKubectlResultUnknownMessage(event.resultSummary?.errorMessage)
      ? "no result came back — it may have run"
      : "did not run on the cluster",
  ) as string;
}

/*
 * What an investigation left out of the incident's or alert's text before
 * the model read it (Common/Utils/AI/PromptText), one line per kind: the
 * images embedded in it - a synthetic monitor's screenshot - and the end of
 * a text too long for its field. Responders see why OneUptime AI says
 * nothing about a screenshot they can see.
 */
export function describePromptOmissions(
  omissions: AIPromptOmissions,
  translator: Translator = getGlobalTranslator(),
): Array<string> {
  const lines: Array<string> = [];

  if (omissions.imageCount > 0) {
    lines.push(
      translator.translatePlural(
        {
          one: "Left out {{count}} embedded image ({{size}}): AI reads text, not images",
          other:
            "Left out {{count}} embedded images ({{size}}): AI reads text, not images",
        },
        omissions.imageCount,
        { size: formatSize(omissions.imageBytes) },
      ),
    );
  }

  if (omissions.encodedDataCount > 0) {
    lines.push(
      translator.translateTemplate(
        "Left out {{size}} of encoded data: AI reads text only",
        { size: formatSize(omissions.encodedDataBytes) },
      ),
    );
  }

  if (omissions.shortenedTextCount > 0) {
    lines.push(
      translator.translatePlural(
        {
          one: "Shortened {{count}} long text: {{characters}} characters left out",
          other:
            "Shortened {{count}} long texts: {{characters}} characters left out",
        },
        omissions.shortenedTextCount,
        {
          characters: translator.formatNumber(omissions.omittedCharacterCount),
        },
      ),
    );
  }

  return lines;
}

/*
 * What a kind of linked resource is called (LinkedAffectedResourceType, as
 * the server records it in an investigation's activity).
 */
const LINKED_RESOURCE_KIND_NOUNS: { [kind: string]: string } = {
  Host: translationKey("Host"),
  DockerHost: translationKey("Docker host"),
  PodmanHost: translationKey("Podman host"),
  KubernetesCluster: translationKey("Kubernetes cluster"),
  DockerSwarmCluster: translationKey("Docker Swarm cluster"),
  ProxmoxCluster: translationKey("Proxmox cluster"),
  VMwareVCenter: translationKey("VMware vCenter"),
  CephCluster: translationKey("Ceph cluster"),
  StorageArray: translationKey("Storage array"),
  IoTFleet: translationKey("IoT fleet"),
  DatabaseServer: translationKey("Database"),
  Service: translationKey("Service"),
};

// How many linked resources a line names before "and N more".
const NAMED_LINKED_RESOURCES: number = 3;

// "Host web-1", in the reader's language.
function describeLinkedResource(
  resource: { kind: string; name: string },
  translator: Translator,
): string {
  const noun: string = translator.translateText(
    LINKED_RESOURCE_KIND_NOUNS[resource.kind] || translationKey("Resource"),
  ) as string;

  return resource.name
    ? translator.translateTemplate("{{kind}} {{name}}", {
        kind: noun,
        name: resource.name,
      })
    : noun;
}

/*
 * The linked resources a line names, in the language of the sentence they go
 * into: "Host web-1 and Docker host web-1", "Host a, Docker host b and
 * Kubernetes cluster c", or the first NAMED_LINKED_RESOURCES and "and 2
 * more". A composed value, so a sentence that is still English names them in
 * English too.
 */
function linkedResourceList(
  resources: Array<{ kind: string; name: string }>,
): TemplateValue {
  return composedValue((sentence: Translator): string => {
    const named: Array<string> = resources
      .slice(0, NAMED_LINKED_RESOURCES)
      .map((resource: { kind: string; name: string }): string => {
        return describeLinkedResource(resource, sentence);
      });
    const moreCount: number = resources.length - named.length;

    if (moreCount <= 0) {
      return formatNameList(named, "and", sentence);
    }

    return sentence.translatePlural(
      {
        one: "{{names}} and {{count}} more",
        other: "{{names}} and {{count}} more",
      },
      moreCount,
      // Listed the way their script lists: "a, b", "a、b", "a، b".
      { names: named.join(getListSeparator(named)) },
    );
  });
}

/*
 * What an investigation read about the infrastructure its incident or alert
 * is linked to - the hosts, container hosts, clusters, databases and
 * services its monitors watch - and the alerts on it (issue #4786): one
 * line, in the reader's language.
 */
export function describeLinkedInfrastructure(
  activity: LinkedInfrastructureActivity,
  translator: Translator = getGlobalTranslator(),
): string {
  const resources: TemplateValue = linkedResourceList(activity.resources || []);

  if (!activity.alertCount) {
    return translator.translateTemplate(
      "No open or recent alerts on {{resources}}",
      { resources },
    );
  }

  if (activity.hasMoreAlerts) {
    return translator.translateTemplate(
      "Read the {{count}} newest open or recent alerts on {{resources}}",
      {
        count: translator.formatNumber(activity.alertCount),
        resources,
      },
    );
  }

  return translator.translatePlural(
    {
      one: "Read {{count}} open or recent alert on {{resources}}",
      other: "Read {{count}} open or recent alerts on {{resources}}",
    },
    activity.alertCount,
    { resources },
  );
}

/*
 * What the starting context read about the changes recorded before the
 * subject, and how many of them its services' telemetry made suspects
 * (RecentChangesContext on the server, which writes the same in English).
 */
export function describeRecentChanges(
  activity: RecentChangesActivity,
  translator: Translator = getGlobalTranslator(),
): string {
  if (activity.suspectCount > 0) {
    return translator.translatePlural(
      {
        one: "Found {{count}} suspect among the recent changes",
        other: "Found {{count}} suspects among the recent changes",
      },
      activity.suspectCount,
    );
  }

  if (activity.changeCount > 0) {
    return translator.translatePlural(
      {
        one: "Read {{count}} recent change; no suspect",
        other: "Read {{count}} recent changes; no suspect",
      },
      activity.changeCount,
    );
  }

  return translator.translateText("No recent changes recorded") as string;
}

/*
 * Why an investigation checked its incident again (issue #4787): the alert
 * that opened on the incident's infrastructure after the first analysis.
 */
export function describeFollowUpCheck(
  activity: FollowUpCheckActivity,
  translator: Translator = getGlobalTranslator(),
): string {
  const alert: string = activity.alertNumberWithPrefix
    ? activity.alertNumberWithPrefix
    : activity.alertNumber !== undefined
      ? `#${activity.alertNumber}`
      : "";

  if (!activity.resourceKind) {
    return alert
      ? translator.translateTemplate(
          "Checking again: alert {{alert}} opened on this incident's infrastructure after the first analysis",
          { alert },
        )
      : (translator.translateText(
          "Checking again: an alert opened on this incident's infrastructure after the first analysis",
        ) as string);
  }

  // Built in the sentence's language, like the linked resources above.
  const resource: TemplateValue = composedValue(
    (sentence: Translator): string => {
      return describeLinkedResource(
        { kind: activity.resourceKind, name: activity.resourceName },
        sentence,
      );
    },
  );

  return alert
    ? translator.translateTemplate(
        "Checking again: alert {{alert}} opened on {{resource}} after the first analysis",
        { alert, resource },
      )
    : translator.translateTemplate(
        "Checking again: an alert opened on {{resource}} after the first analysis",
        { resource },
      );
}

/*
 * The steps the events draw, in the reader's language. A step is completed
 * by matching its text, which is always produced by the same translator.
 */
function buildSteps(
  events: Array<AIRunEvent>,
  translator: Translator = getGlobalTranslator(),
): Array<ActivityStep> {
  const steps: Array<ActivityStep> = [];
  const thinking: string = translator.translateText("Thinking") as string;

  const completeLastRunning: (
    text: string | undefined,
    detail: string | undefined,
    failed: boolean,
  ) => void = (
    text: string | undefined,
    detail: string | undefined,
    failed: boolean,
  ): void => {
    for (let i: number = steps.length - 1; i >= 0; i--) {
      const step: ActivityStep = steps[i]!;
      if (step.status === "running" && (!text || step.text === text)) {
        step.status = failed ? "failed" : "done";
        step.detail = detail;
        return;
      }
    }
  };

  for (const event of events) {
    const key: string = event.id?.toString() || `${steps.length}`;

    switch (event.eventType) {
      case AIRunEventType.RunStarted:
        steps.push({
          key,
          text: translator.translateText("Starting investigation") as string,
          status: "done",
        });
        break;
      case AIRunEventType.LlmCallStarted:
        steps.push({ key, text: thinking, status: "running" });
        break;
      case AIRunEventType.LlmCallCompleted:
        completeLastRunning(thinking, undefined, false);
        break;
      case AIRunEventType.ToolCallStarted:
        steps.push({
          key,
          text: friendlyToolName(event.toolName, translator),
          status: "running",
        });
        break;
      case AIRunEventType.ToolCallCompleted: {
        const rowCount: number | undefined = event.resultSummary?.rowCount;
        const durationInMs: number | undefined =
          event.resultSummary?.durationInMs;
        const parts: Array<string> = [];
        /*
         * A cluster tool call has no rows: a kubectl command's rowCount only
         * says whether kubectl completed (1) or ran and returned an error
         * (0), and a cluster listing's is how many clusters it listed.
         */
        const clusterOutcome: ClusterToolOutcome | null =
          describeClusterToolOutcome(event.toolName, rowCount, translator);
        if (clusterOutcome) {
          parts.push(clusterOutcome.detail);
        } else if (rowCount !== undefined) {
          parts.push(
            translator.translatePlural(
              { one: "{{count}} row", other: "{{count}} rows" },
              rowCount,
            ),
          );
        }
        if (durationInMs !== undefined) {
          parts.push(`${(durationInMs / 1000).toFixed(1)}s`);
        }
        completeLastRunning(
          friendlyToolName(event.toolName, translator),
          parts.join(" · ") || undefined,
          clusterOutcome?.isError === true,
        );
        break;
      }
      case AIRunEventType.ToolCallFailed:
        completeLastRunning(
          friendlyToolName(event.toolName, translator),
          describeFailedToolCall(event, translator),
          true,
        );
        break;
      /*
       * Plain progress lines from an external executor (e.g. the code-fix
       * agent container). The display text lives in resultSummary.message.
       */
      case AIRunEventType.ProgressLog: {
        /*
         * What an investigation left out of what the model read: drawn from
         * the counts, in the reader's language, not from the English line.
         */
        const omissions: AIPromptOmissions | undefined =
          event.resultSummary?.promptOmissions;

        if (omissions) {
          describePromptOmissions(omissions, translator).forEach(
            (text: string, index: number): void => {
              steps.push({
                key: `${key}-${index}`,
                text,
                status: "done",
                kind: "log",
              });
            },
          );
          break;
        }

        /*
         * What the starting context read about the linked infrastructure,
         * and why a follow-up check runs: drawn from the data, in the
         * reader's language, not from the English line.
         */
        const followUpCheck: FollowUpCheckActivity | undefined =
          event.resultSummary?.followUpCheck;

        if (followUpCheck) {
          steps.push({
            key,
            text: describeFollowUpCheck(followUpCheck, translator),
            status: "done",
            kind: "log",
          });
          break;
        }

        const linkedInfrastructure: LinkedInfrastructureActivity | undefined =
          event.resultSummary?.linkedInfrastructure;

        if (linkedInfrastructure) {
          steps.push({
            key,
            text: describeLinkedInfrastructure(
              linkedInfrastructure,
              translator,
            ),
            status: "done",
            kind: "log",
          });
          break;
        }

        const recentChanges: RecentChangesActivity | undefined =
          event.resultSummary?.recentChanges;

        if (recentChanges) {
          steps.push({
            key,
            text: describeRecentChanges(recentChanges, translator),
            status: "done",
            kind: "log",
          });
          break;
        }

        /*
         * What the run read of the AI context the project's team wrote
         * for OneUptime AI (issue #5198): one line, in the reader's
         * language, whose View opens the notes as the run read them - and
         * a warning when a rule's notes did not fit.
         */
        const aiContext: unknown = event.resultSummary?.aiContext;

        if (isAiContextActivity(aiContext)) {
          steps.push({
            key,
            text: describeAiContextActivity(aiContext, translator),
            detail: describeAiContextActivityDetail(aiContext, translator),
            status: "done",
            kind: "log",
            aiContext,
          });

          const leftOut: string | null = describeAiContextLeftOut(
            aiContext,
            translator,
          );

          if (leftOut) {
            steps.push({
              key: `${key}-left-out`,
              text: leftOut,
              status: "done",
              kind: "log",
              severity: "Warning",
            });
          }

          break;
        }

        /*
         * The LLM provider a run its rule picked one for used, or why it
         * used another: drawn from the data, in the reader's language.
         */
        const llmProvider: LlmProviderActivity | undefined =
          event.resultSummary?.llmProvider;

        if (llmProvider) {
          steps.push({
            key,
            text: describeRuleLlmProviderActivity(llmProvider, translator),
            status: "done",
            kind: "log",
            severity: isLlmProviderActivityWarning(llmProvider)
              ? "Warning"
              : undefined,
          });
          break;
        }

        const message: string | undefined = event.resultSummary?.message;
        if (message) {
          steps.push({
            key,
            text: message,
            status: "done",
            kind: "log",
            severity: event.resultSummary?.severity,
          });
        }
        break;
      }
      // A mutating action was executed — e.g. "Opened pull request: … — <url>".
      case AIRunEventType.ActionExecuted: {
        const message: string | undefined = event.resultSummary?.message;
        let text: string | undefined = message;

        if (!text) {
          text = event.toolName
            ? translator.translateTemplate("Executed {{tool}}", {
                tool: event.toolName,
              })
            : (translator.translateText("Executed action") as string);
        }

        steps.push({
          key,
          text: text,
          status: "done",
          kind: "action",
        });
        break;
      }
      default:
        break;
    }
  }

  return steps;
}

/*
 * Whether these events will actually draw any steps. Several event types
 * (RunCompleted, RunFailed, and the completion halves of LLM/tool calls)
 * only close a step that an earlier event opened, so a non-empty event list
 * can still render nothing — a run whose RunStarted failed to persist and
 * then failed outright is one real example. A host that frames the feed in
 * its own titled panel must ask this instead of counting raw events, or it
 * draws an empty box. Exported so the predicate has exactly one owner.
 */
export function hasRenderableActivity(events: Array<AIRunEvent>): boolean {
  return countActivitySteps(events) > 0;
}

/*
 * How many steps the feed draws for these events. Hosts label the feed with
 * this rather than the raw event count, which also counts the events that
 * only close a step.
 */
export function countActivitySteps(events: Array<AIRunEvent>): number {
  return buildSteps(events).length;
}

/*
 * The live "investigating…" feed: renders the run's real tool activity so
 * the user watches actual queries execute instead of a generic spinner.
 */
const ChatActivityFeed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const lineIdPrefix: string = useId();
  /*
   * The AI context a run read, while its dialog is open. Held here rather
   * than by the line's View: a live run shows only its latest steps, so the
   * line leaves the feed as steps come in, and the notes someone is reading
   * must not close under them when it does.
   */
  const [viewedAiContext, setViewedAiContext] =
    useState<AiContextActivity | null>(null);
  const steps: Array<ActivityStep> = buildSteps(props.events, translator);
  const maxVisibleSteps: number = props.maxVisibleSteps ?? 7;
  const hiddenStepCount: number = Math.max(0, steps.length - maxVisibleSteps);
  const visibleSteps: Array<ActivityStep> = steps.slice(-1 * maxVisibleSteps);
  const showLiveIndicator: boolean = props.showLiveIndicator ?? true;

  type RenderStepIconFunction = (step: ActivityStep) => ReactElement;

  const renderStepIcon: RenderStepIconFunction = (
    step: ActivityStep,
  ): ReactElement => {
    if (step.status === "running") {
      return (
        <span className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600"></span>
      );
    }

    if (step.kind === "action") {
      return (
        <Icon
          icon={IconProp.ExternalLink}
          className="h-3 w-3 flex-shrink-0 text-indigo-500"
        />
      );
    }

    if (step.kind === "log") {
      if (step.severity === "Error" || step.severity === "Fatal") {
        return (
          <Icon
            icon={IconProp.Alert}
            className="h-3 w-3 flex-shrink-0 text-red-500"
          />
        );
      }

      if (step.severity === "Warning") {
        return (
          <Icon
            icon={IconProp.Info}
            className="h-3 w-3 flex-shrink-0 text-amber-500"
          />
        );
      }

      /*
       * As wide as the other steps' 12px icons (3 + 6 + 3), so a log line's
       * words start where every other step's do.
       */
      return (
        <span className="mx-[3px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300"></span>
      );
    }

    if (step.status === "failed") {
      return (
        <Icon
          icon={IconProp.Info}
          className="h-3 w-3 flex-shrink-0 text-amber-500"
        />
      );
    }

    return (
      <Icon
        icon={IconProp.Check}
        className="h-3 w-3 flex-shrink-0 text-emerald-500"
      />
    );
  };

  /*
   * A step's mark, centred on the step's first line: a long step (the
   * linked infrastructure an investigation read, say) wraps, and its mark
   * stays beside the line it starts, as a list's bullet does.
   */
  const renderStepMark: RenderStepIconFunction = (
    step: ActivityStep,
  ): ReactElement => {
    return (
      <div
        className="flex h-4 flex-shrink-0 items-center"
        data-testid="activity-step-mark"
      >
        {renderStepIcon(step)}
      </div>
    );
  };

  type RenderStepTextFunction = (step: ActivityStep) => ReactElement;

  const renderStepText: RenderStepTextFunction = (
    step: ActivityStep,
  ): ReactElement => {
    if (step.kind === "action") {
      // Link-ish: if the message carries a URL, make the whole line a link.
      const urlMatch: RegExpMatchArray | null =
        step.text.match(/https?:\/\/\S+/);

      if (urlMatch && urlMatch[0]) {
        return (
          <a
            href={urlMatch[0]}
            target="_blank"
            rel="noreferrer"
            className="break-words font-medium text-indigo-600 hover:underline"
          >
            {step.text}
          </a>
        );
      }

      return (
        <span className="break-words font-medium text-indigo-600">
          {step.text}
        </span>
      );
    }

    if (step.kind === "log") {
      if (step.severity === "Error" || step.severity === "Fatal") {
        return <span className="break-words text-red-600">{step.text}</span>;
      }

      if (step.severity === "Warning") {
        return <span className="break-words text-amber-600">{step.text}</span>;
      }

      return <span className="break-words text-gray-500">{step.text}</span>;
    }

    return (
      <span
        className={
          step.status === "running"
            ? "font-medium text-gray-700"
            : "text-gray-500"
        }
      >
        {step.text}
        {step.status === "running" ? "…" : ""}
      </span>
    );
  };

  const stepList: ReactElement =
    visibleSteps.length > 0 ? (
      <div className="space-y-1.5">
        {hiddenStepCount > 0 && (
          <div className="text-[11px] text-gray-400">
            {translator.translatePlural(
              {
                one: "+ {{count}} earlier step",
                other: "+ {{count}} earlier steps",
              },
              hiddenStepCount,
            )}
          </div>
        )}
        {visibleSteps.map((step: ActivityStep) => {
          const aiContext: AiContextActivity | undefined = step.aiContext;
          // The line's words, which its View is read with.
          const lineId: string = `${lineIdPrefix}-${step.key}`;

          return (
            <div
              key={step.key}
              className="flex items-start gap-2 text-xs leading-4"
            >
              {renderStepMark(step)}
              {/*
                The words and their detail ("· 3 rows · 0.4s") flow as one
                line of text: a long step wraps, and its detail follows its
                last word - whole, or on the next line when it does not fit
                - instead of standing in a narrow column of its own.
              */}
              <div
                className="min-w-0"
                data-testid="activity-step-text"
                {...(aiContext ? { "data-ai-context": "true" } : {})}
              >
                {aiContext ? (
                  <span id={lineId}>{renderStepText(step)}</span>
                ) : (
                  renderStepText(step)
                )}
                {step.detail && (
                  <>
                    {" "}
                    <span className="inline-block max-w-full text-gray-400">
                      · {step.detail}
                    </span>
                  </>
                )}
                {aiContext ? (
                  <>
                    {" "}
                    <span className="inline-block text-gray-400">
                      ·{" "}
                      <AiContextViewButton
                        describedById={lineId}
                        onClick={() => {
                          setViewedAiContext(aiContext);
                        }}
                      />
                    </span>
                  </>
                ) : (
                  <></>
                )}
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <></>
    );

  // The notes a run read, open over the page until they are closed.
  const aiContextDialog: ReactElement = viewedAiContext ? (
    <AiContextActivityDialog
      activity={viewedAiContext}
      onClose={() => {
        setViewedAiContext(null);
      }}
    />
  ) : (
    <></>
  );

  if (props.hideChrome) {
    return (
      <>
        {stepList}
        {aiContextDialog}
      </>
    );
  }

  return (
    <>
      <div className="flex gap-3.5">
        <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900">
          <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5 text-white" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
            <div className="flex items-center gap-2">
              {showLiveIndicator ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gray-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-gray-500"></span>
                </span>
              ) : (
                <></>
              )}
              <span className="text-sm font-medium text-gray-700">
                {translator.translateText(props.title || "Investigating…")}
              </span>
            </div>

            {visibleSteps.length > 0 && (
              <div className="mt-3 border-t border-gray-200/70 pt-3">
                {stepList}
              </div>
            )}
          </div>
        </div>
      </div>
      {aiContextDialog}
    </>
  );
};

export default ChatActivityFeed;
