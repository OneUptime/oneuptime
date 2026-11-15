import { getNumberLocale } from "Common/Types/DateLanguage";
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
  AIToolRefusal,
  FollowUpCheckActivity,
  isAIToolRefusal,
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
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { formatNameList, getListSeparator } from "../AiAccess/AiAccessModes";
import {
  EvidenceToolDescription,
  getKnownEvidenceTool,
} from "../../Utils/InvestigationEvidenceFormat";
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
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import { ActivityFeedRun, canRunHaveRunningSteps } from "./ActivityFeedRun";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  parseAIRunAttemptEnd,
} from "Common/Types/AI/AIRunAttempt";
import { describeAttemptEnd, formatAiRunTime } from "../AI/AiRunFailureWords";
import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";

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
 * by the cluster's Runner, or past the run's time limit or a cap the
 * project set — as a failed call, and a command a Runner took whose result
 * never came back as a failed call marked "result unknown". The three are
 * never confused for one another.
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
  /*
   * The run the events belong to (issue #6437). Its status says whether a
   * step can still be running: a run that is over, or that waits in the
   * queue, has none, whatever its events left open - an older run's last
   * "Thinking" spun forever. Its times head the feed (when it started, how
   * long it took). Omitted, as in Ask AI's answers, the events alone say.
   */
  run?: ActivityFeedRun | undefined;
  /*
   * Each step's time of day, its full date and time on hover, in the
   * reader's language and time zone. Defaults to false.
   */
  showStepTimes?: boolean | undefined;
}

type ActivityStepStatus = "running" | "done" | "failed" | "stopped";

interface ActivityStep {
  key: string;
  text: string;
  detail?: string | undefined;
  /*
   * "stopped": the step was open when its attempt or its run ended - it
   * neither finished nor failed (issue #6437).
   */
  status: ActivityStepStatus;
  /*
   * Distinguishes plain steps from executor log lines (ProgressLog),
   * executed actions (ActionExecuted) and how an attempt of the run ended
   * (AttemptEnded, RunFailed), so they can render differently.
   */
  kind?: "log" | "action" | "attemptEnd" | undefined;
  // When the step started: its first event's time.
  at?: Date | undefined;
  // The attempt of the run it belongs to, counted from 1.
  attempt?: number | undefined;
  // kind "attemptEnd": how the attempt ended.
  attemptEnd?: AIRunAttemptEnd | undefined;
  // Log severity for ProgressLog steps (Info/Warning/Error/…).
  severity?: string | undefined;
  /*
   * What the run read of the project's AI context, word for word: the
   * step's View opens it (AiContextActivityDialog).
   */
  aiContext?: AiContextActivity | undefined;
  /*
   * A failed call whose detail says the model tries another way ("did not
   * succeed - retrying differently"): a promise its attempt keeps only if
   * it goes on after it (settleRetryPromises).
   */
  promisesRetry?: boolean | undefined;
}

/*
 * What a step does, by the tool it runs: English keys, translated as the
 * steps are built. Every toolbox tool and every tool a run adds has one
 * (ActivityStepLabelsGuard), so a step never reads as a tool's own name
 * ("Running query_slos").
 */
export const friendlyToolNames: { [key: string]: string } = {
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
  query_network_transceivers: translationKey(
    "Reading a network device's optics",
  ),
  query_cloud_resource: translationKey("Reading a cloud resource's inventory"),
  query_cloud_accounts: translationKey("Listing the connected cloud accounts"),
  query_rum_applications: translationKey("Checking RUM applications"),
  query_rum_web_vitals: translationKey("Checking web vitals"),
  /*
   * The operational surface: who is on call, the runbooks, what customers
   * see, the error budgets, the platform's own automation.
   */
  query_scheduled_maintenance: translationKey("Checking scheduled maintenance"),
  query_on_call_policies: translationKey("Checking on-call policies"),
  get_on_call_status: translationKey("Checking who is on call"),
  query_on_call_pages: translationKey("Checking on-call pages"),
  query_status_pages: translationKey("Checking status pages"),
  query_status_page_announcements: translationKey(
    "Checking status page announcements",
  ),
  query_slos: translationKey("Checking SLOs"),
  // OneUptime itself: its docs, and the page a thing is done on (#6828).
  search_docs: translationKey("Searching the docs"),
  read_docs: translationKey("Reading the docs"),
  find_dashboard_page: translationKey("Finding the page in OneUptime"),
  query_runbooks: translationKey("Checking runbooks"),
  query_workflows: translationKey("Checking workflows"),
  find_workflow_components: translationKey("Looking up workflow steps"),
  check_workflow_draft: translationKey("Checking the workflow"),
  query_probes: translationKey("Checking probes"),
  query_teams: translationKey("Checking teams"),
  // Who a monitor's going down reaches, and where that breaks (#6810, #6829).
  who_is_told: translationKey("Checking who is told"),
  // Whether the project's setup tells the right people (#6812).
  get_setup_health: translationKey("Checking the setup health"),
  // OneUptime AI's own earlier work.
  get_ai_investigation: translationKey("Reading the AI investigation"),
  query_ai_insights: translationKey("Checking AI insights"),
  // Data Security: the stores, what to fix first, and who can reach what.
  query_data_stores: translationKey("Checking data stores"),
  get_data_table_freshness: translationKey("Checking whether a table is fresh"),
  get_data_table_lineage: translationKey("Reading a table's lineage"),
  query_data_security_issues: translationKey("Checking data security issues"),
  query_data_store_access: translationKey(
    "Checking who can reach a data store",
  ),
  // Continuous profiling, what a change shipped, and the code behind it.
  get_profile_hotspots: translationKey(
    "Reading where a service spends its time",
  ),
  compare_profiles: translationKey("Comparing profiles before and after"),
  get_profile_function: translationKey("Reading a function's profile"),
  get_change_details: translationKey("Reading what a change shipped"),
  list_code_repositories: translationKey("Listing code repositories"),
  find_code_for_exception: translationKey(
    "Finding the code behind an exception",
  ),
  search_code: translationKey("Searching code"),
  read_code_file: translationKey("Reading a code file"),
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
  create_workflow: translationKey("Creating workflow"),
  update_workflow: translationKey("Updating workflow"),
  acknowledge_incident: translationKey("Acknowledging incident"),
  resolve_incident: translationKey("Resolving incident"),
  // An alert raised from the conversation (#5301), as an incident is declared.
  create_alert: translationKey("Creating alert"),
  acknowledge_alert: translationKey("Acknowledging alert"),
  resolve_alert: translationKey("Resolving alert"),
  // What an incident or alert is about (#5293), never the tool's own name.
  add_incident_affected_resources: translationKey("Linking affected resources"),
  add_alert_affected_resources: translationKey("Linking affected resources"),
  // The other changes Ask AI makes, once allowed.
  change_incident_severity: translationKey("Changing the incident's severity"),
  create_incident_note: translationKey("Adding a note to the incident"),
  create_alert_note: translationKey("Adding a note to the alert"),
  post_incident_status_update: translationKey("Posting a status update"),
  page_on_call_policy: translationKey("Paging an on-call policy"),
  run_runbook: translationKey("Starting a runbook"),
  start_investigation: translationKey("Starting an AI investigation"),
  open_code_pull_request: translationKey("Opening a pull request"),
  commit_code_to_branch: translationKey("Committing code to a branch"),
  // Setting things up by conversation (#6829), once approved.
  set_up_website_monitoring: translationKey("Setting up monitoring"),
  set_up_paging: translationKey("Setting up paging"),
  publish_status_page: translationKey("Publishing a status page"),
  add_monitors_to_status_page: translationKey(
    "Adding monitors to a status page",
  ),
  // The rest of a long output a command printed.
  read_tool_output: translationKey("Reading the rest of an output"),
  run_kubectl: translationKey("Running kubectl on the cluster"),
  list_cluster_access: translationKey("Checking cluster access"),
  run_infrastructure_command: translationKey(
    "Running a command on the infrastructure",
  ),
  list_infrastructure_access: translationKey("Checking infrastructure access"),
  list_command_targets: translationKey("Listing where commands may run"),
  execute_remediation_command: translationKey("Applying a fix"),
  propose_remediation_commands: translationKey("Proposing a fix for approval"),
  roll_back_change: translationKey("Rolling back a change"),
  // Why a fix's round ends without a fix (RemediationRound, issue #6436).
  explain_no_fix: translationKey("Explaining why there is no fix"),
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
 * Why a refused call was not done, by what the server recorded
 * (AIToolRefusal): a refused call is never tried again, so its step never
 * says it is being retried.
 */
export const REFUSED_TOOL_CALL_DETAILS: { [key in AIToolRefusal]: string } = {
  [AIToolRefusal.Permission]: translationKey(
    "not done — your role does not allow it",
  ),
  [AIToolRefusal.TeamBlock]: translationKey(
    "not done — a team you belong to blocks it",
  ),
  [AIToolRefusal.Plan]: translationKey(
    "not done — the project's plan does not include it",
  ),
  [AIToolRefusal.NotAllowed]: translationKey(
    "not done — you are not allowed to do this",
  ),
  [AIToolRefusal.ProductOff]: translationKey(
    "not done — this product is switched off on this server",
  ),
};

/*
 * Whether a failed call's step says the model tries another way: a read
 * that failed - not a refused call, an action, or a command on a cluster or
 * an infrastructure resource, which say what became of them instead.
 */
export function isFailedToolCallRetried(event: AIRunEvent): boolean {
  return (
    !isAIToolRefusal(event.resultSummary?.refusal) &&
    event.toolName !== RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME &&
    event.toolName !== RUN_KUBECTL_TOOL_NAME &&
    event.resultSummary?.isAction !== true
  );
}

/*
 * The detail for a failed call. A refused call - the person may not make
 * it, a team blocks it, the plan does not include it - is never tried
 * again: it was not done, and the step says why. A failed action (a tool
 * that changes the project) was not done either, and the answer says why;
 * the model may well not try it again, so the step never promises it. A
 * failed kubectl call produced nothing to read: either it never reached the
 * cluster, or a Runner took it and never reported back, in which case it
 * may have run. Say which rather than implying it ran and will be retried.
 */
export function describeFailedToolCall(
  event: AIRunEvent,
  translator: Translator,
): string {
  const refusal: unknown = event.resultSummary?.refusal;

  if (isAIToolRefusal(refusal)) {
    return translator.translateText(
      REFUSED_TOOL_CALL_DETAILS[refusal],
    ) as string;
  }

  // The same three outcomes for a command on an infrastructure resource.
  if (event.toolName === RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME) {
    return translator.translateText(
      isInfrastructureResultUnknownMessage(event.resultSummary?.errorMessage)
        ? "no result came back — it may have run"
        : "did not run on the infrastructure",
    ) as string;
  }

  // An action that failed: not done, whatever the model does next.
  if (
    event.toolName !== RUN_KUBECTL_TOOL_NAME &&
    event.resultSummary?.isAction === true
  ) {
    return translator.translateText("not done") as string;
  }

  if (isFailedToolCallRetried(event)) {
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
 * the server records it in an investigation's activity): one noun for each
 * kind the server names (LINKED_INFRASTRUCTURE_KINDS), or a linked cloud
 * resource would read "Resource web-alb" - and one for an App Platforms
 * environment, which the server records as a kind of its own
 * (CLOUD_ENVIRONMENT_ACTIVITY_KIND): a place apps run, never "Cloud
 * resource checkout · us-east-1".
 */
export const LINKED_RESOURCE_KIND_NOUNS: { [kind: string]: string } = {
  Host: translationKey("Host"),
  NetworkDevice: translationKey("Network device"),
  DockerHost: translationKey("Docker host"),
  PodmanHost: translationKey("Podman host"),
  KubernetesCluster: translationKey("Kubernetes cluster"),
  DockerSwarmCluster: translationKey("Docker Swarm cluster"),
  ProxmoxCluster: translationKey("Proxmox cluster"),
  OpenStackCloud: translationKey("OpenStack cloud"),
  VMwareVCenter: translationKey("VMware vCenter"),
  CephCluster: translationKey("Ceph cluster"),
  StorageArray: translationKey("Storage array"),
  IoTFleet: translationKey("IoT fleet"),
  DatabaseServer: translationKey("Database"),
  CloudResource: translationKey("Cloud resource"),
  CloudEnvironment: translationKey("Cloud environment"),
  Service: translationKey("Service"),
};

// How many linked resources a line names before "and N more".
const NAMED_LINKED_RESOURCES: number = 3;

/*
 * "host web-1", in the reader's language. Always said inside a sentence -
 * "alerts on {{resources}}", "opened on {{resource}}" - so the kind is a
 * term cased for the middle of one, the reader's way: "host web-1 and
 * Docker host web-2", never a label's "Host web-1" beside "Docker host
 * web-2" (#7862); German keeps its nouns' capital ("Host web-1").
 */
function describeLinkedResource(
  resource: { kind: string; name: string },
  translator: Translator,
): string {
  const noun: string =
    LINKED_RESOURCE_KIND_NOUNS[resource.kind] || translationKey("Resource");

  return resource.name
    ? translator.translateTemplate("{{kind}} {{name}}", {
        kind: translatableTerm(noun, { inSentence: true }),
        name: resource.name,
      })
    : translator.translateTerm(noun, { inSentence: true });
}

/*
 * The linked resources a line names, in the language of the sentence they go
 * into: "host web-1 and Docker host web-1", "host a, Docker host b and
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
 * How long a step took, as its detail says it beside its rows: "0.6s" in
 * English, and in the reader's language its own way ("0,6 Sek.", "۰٫۶s"),
 * so "1.234 Zeilen · 0,6 Sek." writes its two figures alike. An engine
 * without Intl's unit style writes the English.
 */
export function formatStepDuration(
  durationInMs: number,
  language: string | undefined,
): string {
  const seconds: number = durationInMs / 1000;
  const english: string = `${seconds.toFixed(1)}s`;

  if (!language || language === "en" || language.startsWith("en-")) {
    return english;
  }

  try {
    const said: string = new Intl.NumberFormat(getNumberLocale(language), {
      style: "unit",
      unit: "second",
      unitDisplay: "narrow",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    } as Intl.NumberFormatOptions).format(seconds);
    const bare: string = seconds.toLocaleString(getNumberLocale(language), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

    // The unit style not known: the bare number alone would lose the unit.
    return said === bare ? english : said;
  } catch {
    return english;
  }
}

// An address an action's line carries, which makes the line its link.
const ACTION_LINK: RegExp = /https?:\/\/\S+/;

export function getActionStepLink(text: string): string | null {
  const match: RegExpMatchArray | null = text.match(ACTION_LINK);

  return match && match[0] ? match[0] : null;
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
  // The attempt the events belong to: each RunStarted after the first starts one.
  let attempt: number = 1;
  let hasRunStarted: boolean = false;

  /*
   * The steps an attempt left open when it ended - it failed, its server
   * stopped, or the run finished - end with it: they never ran on.
   */
  const settleOpenSteps: (status: ActivityStepStatus) => void = (
    status: ActivityStepStatus,
  ): void => {
    for (const step of steps) {
      if (step.status === "running") {
        step.status = status;
      }
    }
  };

  /*
   * A model call that answered is not a step of its own: the steps it
   * chose follow it, each with its time. Only a call still thinking, or
   * one that failed, is drawn.
   */
  const removeLastThinking: () => void = (): void => {
    for (let i: number = steps.length - 1; i >= 0; i--) {
      const step: ActivityStep = steps[i]!;
      if (step.status === "running" && step.text === thinking) {
        steps.splice(i, 1);
        return;
      }
    }
  };

  // The step completed, if one was open with that text.
  const completeLastRunning: (
    text: string | undefined,
    detail: string | undefined,
    failed: boolean,
  ) => ActivityStep | undefined = (
    text: string | undefined,
    detail: string | undefined,
    failed: boolean,
  ): ActivityStep | undefined => {
    for (let i: number = steps.length - 1; i >= 0; i--) {
      const step: ActivityStep = steps[i]!;
      if (step.status === "running" && (!text || step.text === text)) {
        step.status = failed ? "failed" : "done";
        step.detail = detail;
        return step;
      }
    }

    return undefined;
  };

  for (const event of events) {
    const key: string = event.id?.toString() || `${steps.length}`;
    const stepCountBefore: number = steps.length;

    switch (event.eventType) {
      case AIRunEventType.RunStarted:
        // Another attempt: what the last one left open ended with it.
        if (hasRunStarted) {
          settleOpenSteps("stopped");
          attempt++;
        }

        hasRunStarted = true;
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
        removeLastThinking();
        break;
      // The model call failed for good: its Thinking stops thinking.
      case AIRunEventType.LlmCallFailed:
        completeLastRunning(
          thinking,
          translator.translateText("failed") as string,
          true,
        );
        break;
      /*
       * An attempt ended without the run's answer: its open steps end with
       * it, and a line says how and when the next attempt starts.
       */
      case AIRunEventType.AttemptEnded:
      case AIRunEventType.RunFailed: {
        settleOpenSteps("stopped");

        const attemptEnd: AIRunAttemptEnd | null = parseAIRunAttemptEnd(
          event.resultSummary?.attemptEnd,
        );

        if (attemptEnd) {
          steps.push({
            key,
            text: describeAttemptEnd(attemptEnd, translator),
            status:
              event.eventType === AIRunEventType.RunFailed ? "failed" : "done",
            kind: "attemptEnd",
            attemptEnd,
          });
        }
        break;
      }
      case AIRunEventType.RunCompleted:
        settleOpenSteps("done");
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
          parts.push(formatStepDuration(durationInMs, translator.language));
        }
        completeLastRunning(
          friendlyToolName(event.toolName, translator),
          parts.join(" · ") || undefined,
          clusterOutcome?.isError === true,
        );
        break;
      }
      case AIRunEventType.ToolCallFailed: {
        const failedStep: ActivityStep | undefined = completeLastRunning(
          friendlyToolName(event.toolName, translator),
          describeFailedToolCall(event, translator),
          true,
        );

        if (failedStep && isFailedToolCallRetried(event)) {
          failedStep.promisesRetry = true;
        }
        break;
      }
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
        /*
         * What it did, in the words an evidence list uses for the same
         * tool - "Declared an incident" - never the tool's own name.
         */
        const done: EvidenceToolDescription | null = getKnownEvidenceTool(
          event.toolName,
        );

        if (!text && done) {
          text = translator.translateText(done.description) as string;
        }

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

    // When each new step started, and the attempt it belongs to.
    const at: Date | undefined = toDate(event.createdAt);

    for (let index: number = stepCountBefore; index < steps.length; index++) {
      const step: ActivityStep = steps[index]!;
      step.at = step.at || at;
      step.attempt = attempt;
    }
  }

  return steps;
}

// A time the server sent, as a Date: undefined for none, or for no time.
function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return isNaN(date.getTime()) ? undefined : date;
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
 * The one line an answer being written shows in Ask AI, in place of every
 * step narrated one by one: the step running now ("Searching logs"), or
 * "Thinking" between steps and before the first, and how many steps there
 * are so far - what the line opens into.
 */
export interface LiveActivity {
  text: string;
  stepCount: number;
}

export function describeLiveActivity(
  events: Array<AIRunEvent>,
  translator: Translator = getGlobalTranslator(),
): LiveActivity {
  const steps: Array<ActivityStep> = buildSteps(events, translator);
  const running: ActivityStep | undefined = [...steps]
    .reverse()
    .find((step: ActivityStep): boolean => {
      return step.status === "running";
    });

  return {
    text: running
      ? running.text
      : (translator.translateText("Thinking") as string),
    stepCount: steps.length,
  };
}

/*
 * One row of the feed: a step, or the same step done several times in a
 * row ("Searching code", twelve times over) drawn as one row that opens
 * into each of them (issue #6437).
 */
type ActivityRow =
  | { type: "step"; key: string; step: ActivityStep }
  | { type: "repeat"; key: string; steps: Array<ActivityStep> };

// Three or more of the same finished step in a row fold into one row.
export const MIN_REPEATED_STEPS: number = 3;

function isRepeatableStep(step: ActivityStep): boolean {
  return (
    (step.status === "done" || step.status === "failed") &&
    !step.kind &&
    !step.aiContext
  );
}

function groupRepeatedSteps(steps: Array<ActivityStep>): Array<ActivityRow> {
  const rows: Array<ActivityRow> = [];
  let index: number = 0;

  while (index < steps.length) {
    const step: ActivityStep = steps[index]!;
    let end: number = index + 1;

    if (isRepeatableStep(step)) {
      while (
        end < steps.length &&
        isRepeatableStep(steps[end]!) &&
        steps[end]!.text === step.text &&
        steps[end]!.status === step.status
      ) {
        end++;
      }
    }

    if (end - index >= MIN_REPEATED_STEPS) {
      rows.push({
        type: "repeat",
        key: `repeat-${step.key}`,
        steps: steps.slice(index, end),
      });
    } else {
      for (let i: number = index; i < end; i++) {
        rows.push({ type: "step", key: steps[i]!.key, step: steps[i]! });
      }
    }

    index = end;
  }

  return rows;
}

/*
 * The steps that did something, for "12 steps": the line saying how an
 * attempt ended is not one of them.
 */
function countWorkSteps(steps: Array<ActivityStep>): number {
  return steps.filter((step: ActivityStep): boolean => {
    return step.kind !== "attemptEnd";
  }).length;
}

// The steps of one attempt of the run, and how it ended when it did.
interface ActivityAttempt {
  number: number;
  steps: Array<ActivityStep>;
  end?: AIRunAttemptEnd | undefined;
}

/*
 * A failed call's "retrying differently" is a promise its attempt keeps by
 * going on: the last step of an attempt that ended - or of a run that is
 * over (canStepsRun false) - was never followed by another way, so it says
 * "failed", as a model call that failed does (issue #6437). The run's own
 * end line says why it stopped.
 */
function settleRetryPromises(
  steps: Array<ActivityStep>,
  canStepsRun: boolean,
  failedText: string,
): Array<ActivityStep> {
  const lastWorkStepIndexes: Map<number, number> = new Map<number, number>();
  const endedAttempts: Set<number> = new Set<number>();
  let latestAttempt: number = 1;

  steps.forEach((step: ActivityStep, index: number): void => {
    const attempt: number = step.attempt || 1;
    latestAttempt = Math.max(latestAttempt, attempt);

    if (step.kind === "attemptEnd") {
      endedAttempts.add(attempt);
      return;
    }

    // An executor's log line is not the model going on.
    if (step.kind !== "log") {
      lastWorkStepIndexes.set(attempt, index);
    }
  });

  return steps.map((step: ActivityStep, index: number): ActivityStep => {
    const attempt: number = step.attempt || 1;

    if (
      !step.promisesRetry ||
      lastWorkStepIndexes.get(attempt) !== index ||
      !(endedAttempts.has(attempt) || attempt < latestAttempt || !canStepsRun)
    ) {
      return step;
    }

    return { ...step, detail: failedText, promisesRetry: false };
  });
}

function groupAttempts(steps: Array<ActivityStep>): Array<ActivityAttempt> {
  const attempts: Array<ActivityAttempt> = [];

  for (const step of steps) {
    const number: number = step.attempt || 1;
    let attempt: ActivityAttempt | undefined = attempts[attempts.length - 1];

    if (!attempt || attempt.number !== number) {
      attempt = { number, steps: [] };
      attempts.push(attempt);
    }

    attempt.steps.push(step);

    if (step.kind === "attemptEnd" && step.attemptEnd) {
      attempt.end = step.attemptEnd;
    }
  }

  return attempts;
}

// How long something took, in the reader's language: "40 seconds", "6 minutes".
export function describeElapsedTime(
  milliseconds: number,
  translator: Translator,
): string {
  const seconds: number = Math.max(0, Math.round(milliseconds / 1000));

  if (seconds < 60) {
    return translator.translatePlural(
      { one: "{{count}} second", other: "{{count}} seconds" },
      seconds,
    );
  }

  const minutes: number = Math.round(seconds / 60);

  if (minutes < 60) {
    return translator.translatePlural(
      { one: "{{count}} minute", other: "{{count}} minutes" },
      minutes,
    );
  }

  return translator.translatePlural(
    { one: "{{count}} hour", other: "{{count}} hours" },
    Math.round(minutes / 60),
  );
}

// A step's time of day, and its full date and time for the hover.
function describeStepTime(date: Date): { short: string; full: string } {
  return {
    short: OneUptimeDate.getLocalTimeString(date, {
      includeSeconds: true,
      use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
    }),
    full: OneUptimeDate.getDateAsLocalShortDateTimeString(date, {
      includeSeconds: true,
    }),
  };
}

/*
 * The live "investigating…" feed: renders the run's real tool activity so
 * the user watches actual queries execute instead of a generic spinner.
 *
 * A long run reads as a story, not a wall (issue #6437): each step says
 * when it happened (showStepTimes), the same step done many times in a row
 * is one row that opens, only the latest steps show until "Show earlier
 * steps" is pressed, and a run tried more than once shows each attempt as
 * a group - the earlier ones folded, with how they ended. Nothing spins
 * once its run is over (run).
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
  /*
   * What the reader opened: earlier attempts, rows of a repeated step, and
   * the attempts whose earlier steps they asked to see.
   */
  const [openAttempts, setOpenAttempts] = useState<Array<number>>([]);
  const [openRepeats, setOpenRepeats] = useState<Array<string>>([]);
  const [attemptsShowingAll, setAttemptsShowingAll] = useState<Array<number>>(
    [],
  );

  const canStepsRun: boolean = canRunHaveRunningSteps(props.run);
  const steps: Array<ActivityStep> = settleRetryPromises(
    buildSteps(props.events, translator).map(
      (step: ActivityStep): ActivityStep => {
        // A run that is over, or waits in the queue, has no step running.
        return step.status === "running" && !canStepsRun
          ? { ...step, status: "stopped" }
          : step;
      },
    ),
    canStepsRun,
    translator.translateText("failed") as string,
  );
  const maxVisibleSteps: number = Math.max(props.maxVisibleSteps ?? 7, 1);
  const showLiveIndicator: boolean = props.showLiveIndicator ?? true;
  const attempts: Array<ActivityAttempt> = groupAttempts(steps);
  /*
   * How many attempts the run gets, as its attempts' ends say ("Attempt 2
   * of 3"). An older run's events do not say, and its attempts have no
   * "of".
   */
  const maxAttempts: number = Math.max(
    0,
    ...attempts.map((attempt: ActivityAttempt): number => {
      return attempt.end?.maxAttempts || 0;
    }),
  );

  const toggle: (
    list: Array<number | string>,
    value: number | string,
  ) => Array<number | string> = (
    list: Array<number | string>,
    value: number | string,
  ): Array<number | string> => {
    return list.includes(value)
      ? list.filter((item: number | string): boolean => {
          return item !== value;
        })
      : [...list, value];
  };

  type RenderStepIconFunction = (step: ActivityStep) => ReactElement;

  const renderStepIcon: RenderStepIconFunction = (
    step: ActivityStep,
  ): ReactElement => {
    if (step.status === "running") {
      return (
        <span className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600"></span>
      );
    }

    // A step its attempt or its run ended under: neither done nor failed.
    if (step.status === "stopped") {
      return (
        <Icon
          icon={IconProp.MinusCircle}
          className="h-3 w-3 flex-shrink-0 text-gray-400"
        />
      );
    }

    // How an attempt ended: tried again, picked up again, or given up.
    if (step.kind === "attemptEnd") {
      if (step.status === "failed") {
        return (
          <Icon
            icon={IconProp.Alert}
            className="h-3 w-3 flex-shrink-0 text-red-500"
          />
        );
      }

      return (
        <Icon
          icon={IconProp.ArrowPath}
          className="h-3 w-3 flex-shrink-0 text-amber-500"
        />
      );
    }

    /*
     * An action that ran: a line that carries an address opens it (a pull
     * request), so it is drawn as a link; any other - "Declared an
     * incident" - is a change that is done, never a link to nowhere.
     */
    if (step.kind === "action") {
      return getActionStepLink(step.text) ? (
        <Icon
          icon={IconProp.ExternalLink}
          className="h-3 w-3 flex-shrink-0 text-indigo-500"
        />
      ) : (
        <Icon
          icon={IconProp.CheckCircle}
          className="h-3 w-3 flex-shrink-0 text-emerald-500"
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
    if (step.kind === "attemptEnd") {
      return (
        <span
          data-testid="activity-attempt-end"
          className={`break-words ${
            step.status === "failed" ? "text-red-600" : "text-amber-700"
          }`}
        >
          {step.text}
        </span>
      );
    }

    if (step.kind === "action") {
      // A line that carries an address is its link (an opened pull request).
      const link: string | null = getActionStepLink(step.text);

      if (link) {
        return (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="break-words font-medium text-indigo-600 hover:underline"
          >
            {step.text}
          </a>
        );
      }

      /*
       * What it changed, in the words of a step that is done - set apart
       * from the reads around it by its weight, not by a link's colour.
       */
      return (
        <span
          data-testid="activity-step-action"
          className="break-words font-medium text-gray-700"
        >
          {step.text}
        </span>
      );
    }

    if (step.kind === "log") {
      /*
       * A log line is the server's own sentence, often English on a page in
       * another language - the line that a limit stopped the run, for one.
       * dir="auto" reads it in its own direction: on a right-to-left page an
       * English line keeps its full stop at its end, not before its first
       * word, and the line still starts beside its mark like every step.
       */
      if (step.severity === "Error" || step.severity === "Fatal") {
        return (
          <span dir="auto" className="break-words text-red-600">
            {step.text}
          </span>
        );
      }

      if (step.severity === "Warning") {
        return (
          <span dir="auto" className="break-words text-amber-600">
            {step.text}
          </span>
        );
      }

      return (
        <span dir="auto" className="break-words text-gray-500">
          {step.text}
        </span>
      );
    }

    return (
      <span
        className={
          step.status === "running"
            ? "font-medium text-gray-700"
            : step.status === "stopped"
              ? "text-gray-400"
              : "text-gray-500"
        }
      >
        {step.text}
        {step.status === "running" ? "…" : ""}
      </span>
    );
  };

  // A step's time of day, its full date and time on hover.
  const renderStepTime: (step: ActivityStep) => ReactElement = (
    step: ActivityStep,
  ): ReactElement => {
    if (!props.showStepTimes || !step.at) {
      return <></>;
    }

    const time: { short: string; full: string } = describeStepTime(step.at);

    return (
      <time
        dateTime={step.at.toISOString()}
        title={time.full}
        data-testid="activity-step-time"
        className="ms-auto flex-shrink-0 ps-3 tabular-nums text-gray-400"
      >
        {time.short}
      </time>
    );
  };

  const renderStepRow: (
    step: ActivityStep,
    extraDetail?: ReactElement,
  ) => ReactElement = (
    step: ActivityStep,
    extraDetail?: ReactElement,
  ): ReactElement => {
    const aiContext: AiContextActivity | undefined = step.aiContext;
    // The line's words, which its View is read with.
    const lineId: string = `${lineIdPrefix}-${step.key}`;
    // A step that ended under its attempt says so, unless it says more.
    const detail: string | undefined =
      step.detail ||
      (step.status === "stopped"
        ? (translator.translateText("did not finish") as string)
        : undefined);

    return (
      <div key={step.key} className="flex items-start gap-2 text-xs leading-4">
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
          {detail && (
            <>
              {" "}
              <span className="inline-block max-w-full text-gray-400">
                <InlineSeparator markOnly /> {detail}
              </span>
            </>
          )}
          {extraDetail || <></>}
          {aiContext ? (
            <>
              {" "}
              <span className="inline-block text-gray-400">
                <InlineSeparator markOnly />{" "}
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
        {renderStepTime(step)}
      </div>
    );
  };

  /*
   * The same step done several times in a row: its first time, how many
   * times, and a toggle that opens each of them under it.
   */
  const renderRepeatRow: (row: {
    key: string;
    steps: Array<ActivityStep>;
  }) => ReactElement = (row: {
    key: string;
    steps: Array<ActivityStep>;
  }): ReactElement => {
    const isOpen: boolean = openRepeats.includes(row.key);
    const listId: string = `${lineIdPrefix}-${row.key}`;
    const first: ActivityStep = row.steps[0]!;

    return (
      <div key={row.key} data-testid="activity-step-repeat">
        {renderStepRow(
          { ...first, detail: undefined, key: `${row.key}-first` },
          <>
            {" "}
            <button
              type="button"
              data-testid="activity-step-repeat-toggle"
              aria-expanded={isOpen}
              aria-controls={listId}
              className="inline-flex items-center gap-0.5 rounded text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={() => {
                setOpenRepeats(toggle(openRepeats, row.key) as Array<string>);
              }}
            >
              {translator.translatePlural(
                { one: "· {{count}} time", other: "· {{count}} times" },
                row.steps.length,
              )}
              <Icon
                icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
                className="h-3 w-3 flex-shrink-0"
              />
            </button>
          </>,
        )}
        <div
          id={listId}
          hidden={!isOpen}
          className="mt-1.5 space-y-1.5 ps-5"
          data-testid="activity-step-repeat-list"
        >
          {isOpen ? (
            row.steps.map((step: ActivityStep): ReactElement => {
              return renderStepRow(step);
            })
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  };

  /*
   * An attempt's steps: the latest ones, and "Show 40 earlier steps" for
   * the rest until the reader asks for them.
   */
  const renderAttemptSteps: (attempt: ActivityAttempt) => ReactElement = (
    attempt: ActivityAttempt,
  ): ReactElement => {
    const rows: Array<ActivityRow> = groupRepeatedSteps(attempt.steps);
    const isShowingAll: boolean = attemptsShowingAll.includes(attempt.number);
    const hiddenRowCount: number = isShowingAll
      ? 0
      : Math.max(0, rows.length - maxVisibleSteps);
    const hiddenStepCount: number = rows
      .slice(0, hiddenRowCount)
      .reduce((count: number, row: ActivityRow): number => {
        return count + (row.type === "repeat" ? row.steps.length : 1);
      }, 0);

    return (
      <div className="space-y-1.5">
        {hiddenStepCount > 0 ? (
          <button
            type="button"
            data-testid="activity-show-earlier"
            className="rounded text-xs font-medium leading-4 text-gray-500 hover:text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => {
              setAttemptsShowingAll([...attemptsShowingAll, attempt.number]);
            }}
          >
            {translator.translatePlural(
              {
                one: "Show {{count}} earlier step",
                other: "Show {{count}} earlier steps",
              },
              hiddenStepCount,
            )}
          </button>
        ) : (
          <></>
        )}
        {rows.slice(hiddenRowCount).map((row: ActivityRow): ReactElement => {
          return row.type === "repeat"
            ? renderRepeatRow(row)
            : renderStepRow(row.step);
        })}
      </div>
    );
  };

  /*
   * "Attempt 2 of 3", or "Attempt 2" when how many it gets is not known; its
   * numbers written as the row's step count is ("۲" in Persian).
   */
  const describeAttemptNumber: (number: number) => string = (
    number: number,
  ): string => {
    return maxAttempts >= number && maxAttempts > 1
      ? translator.translateTemplate("Attempt {{number}} of {{count}}", {
          number: translator.formatNumber(number),
          count: translator.formatNumber(maxAttempts),
        })
      : translator.translateTemplate("Attempt {{number}}", {
          number: translator.formatNumber(number),
        });
  };

  // How an earlier attempt ended, in a word or two after its number.
  const describeAttemptOutcome: (attempt: ActivityAttempt) => string = (
    attempt: ActivityAttempt,
  ): string => {
    if (attempt.end?.outcome === AIRunAttemptOutcome.HandedBack) {
      return translator.translateText(
        "paused when its server stopped",
      ) as string;
    }

    if (attempt.end?.outcome === AIRunAttemptOutcome.Stalled) {
      return translator.translateText("stopped answering") as string;
    }

    return translator.translateText("did not finish") as string;
  };

  // An earlier attempt: one row that opens into its steps.
  const renderEarlierAttempt: (attempt: ActivityAttempt) => ReactElement = (
    attempt: ActivityAttempt,
  ): ReactElement => {
    const isOpen: boolean = openAttempts.includes(attempt.number);
    const listId: string = `${lineIdPrefix}-attempt-${attempt.number}`;
    const startedAt: Date | undefined = attempt.steps[0]?.at;

    return (
      <div
        key={`attempt-${attempt.number}`}
        data-testid="activity-attempt"
        data-attempt={attempt.number}
      >
        <button
          type="button"
          data-testid="activity-attempt-toggle"
          aria-expanded={isOpen}
          aria-controls={listId}
          className="flex w-full items-start gap-2 rounded text-start text-xs leading-4 text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            setOpenAttempts(
              toggle(openAttempts, attempt.number) as Array<number>,
            );
          }}
        >
          <span className="flex h-4 flex-shrink-0 items-center">
            <Icon
              icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
              className="h-3 w-3 flex-shrink-0"
            />
          </span>
          <span className="min-w-0">
            <span className="font-medium text-gray-600">
              {describeAttemptNumber(attempt.number)}
            </span>{" "}
            {/*
              Each part whole, as a step's detail is: a phone breaks the
              row between them, never inside "17 steps" - and a part wider
              than the row still wraps inside itself.
            */}
            <span className="text-gray-400">
              <span className="inline-block max-w-full">
                <InlineSeparator markOnly /> {describeAttemptOutcome(attempt)}
              </span>{" "}
              <span className="inline-block max-w-full">
                <InlineSeparator markOnly />{" "}
                {translator.translatePlural(
                  { one: "{{count}} step", other: "{{count}} steps" },
                  countWorkSteps(attempt.steps),
                )}
              </span>
            </span>
          </span>
          {props.showStepTimes && startedAt ? (
            <time
              dateTime={startedAt.toISOString()}
              title={describeStepTime(startedAt).full}
              className="ms-auto flex-shrink-0 ps-3 tabular-nums text-gray-400"
            >
              {describeStepTime(startedAt).short}
            </time>
          ) : (
            <></>
          )}
        </button>
        <div id={listId} hidden={!isOpen} className="mt-1.5 ps-5">
          {isOpen ? renderAttemptSteps(attempt) : <></>}
        </div>
      </div>
    );
  };

  /*
   * When the run started and how long it ran, or has been running: the
   * line that answers "when did this happen?" before any step does.
   */
  const renderRunSummary: () => ReactElement = (): ReactElement => {
    if (!props.run || !props.showStepTimes) {
      return <></>;
    }

    const startedAt: Date | undefined =
      toDate(props.run.startedAt) ||
      steps[0]?.at ||
      toDate(props.run.createdAt);

    if (!startedAt) {
      return <></>;
    }

    const isToday: boolean = OneUptimeDate.areOnTheSameLocalDay(
      startedAt,
      OneUptimeDate.getCurrentDate(),
    );
    const started: string = isToday
      ? formatAiRunTime(startedAt)
      : OneUptimeDate.getDateAsLocalShortDateTimeString(startedAt);
    const completedAt: Date | undefined = toDate(props.run.completedAt);
    const parts: Array<string> = [
      translator.translateTemplate("Started {{time}}", { time: started }),
    ];

    /*
     * How long, put together in its sentence's language: a sentence still
     * English says "6 minutes", never "6 Minuten".
     */
    const elapsed: (milliseconds: number) => TemplateValue = (
      milliseconds: number,
    ): TemplateValue => {
      return composedValue((sentenceTranslator: Translator): string => {
        return describeElapsedTime(milliseconds, sentenceTranslator);
      });
    };

    if (completedAt) {
      parts.push(
        translator.translateTemplate("took {{duration}}", {
          duration: elapsed(completedAt.getTime() - startedAt.getTime()),
        }),
      );
    } else if (props.run.status === AIRunStatus.Running) {
      parts.push(
        translator.translateTemplate("running for {{duration}}", {
          duration: elapsed(
            OneUptimeDate.getCurrentDate().getTime() - startedAt.getTime(),
          ),
        }),
      );
    }

    parts.push(
      translator.translatePlural(
        { one: "{{count}} step", other: "{{count}} steps" },
        countWorkSteps(steps),
      ),
    );

    /*
     * In the steps' own size, and a shade darker than their details: it is
     * the line the list is read from. Each part keeps its words together,
     * as a step's detail does - a narrow card breaks the line between
     * them, never inside "6 steps" - and a part wider than the line still
     * wraps inside itself.
     */
    return (
      <p
        data-testid="activity-run-summary"
        className="text-xs leading-5 text-gray-500"
      >
        <time
          dateTime={startedAt.toISOString()}
          className="inline-block max-w-full"
        >
          {parts[0]}
        </time>
        {parts.slice(1).map((part: string, index: number): ReactElement => {
          return (
            <React.Fragment key={index}>
              {" "}
              <span className="inline-block max-w-full">
                <InlineSeparator markOnly /> {part}
              </span>
            </React.Fragment>
          );
        })}
      </p>
    );
  };

  const latestAttempt: ActivityAttempt | undefined =
    attempts[attempts.length - 1];

  const stepList: ReactElement =
    steps.length > 0 && latestAttempt ? (
      <div className="space-y-2">
        {renderRunSummary()}
        {attempts.length > 1 ? (
          <>
            {attempts
              .slice(0, -1)
              .map((attempt: ActivityAttempt): ReactElement => {
                return renderEarlierAttempt(attempt);
              })}
            <div
              data-testid="activity-attempt"
              data-attempt={latestAttempt.number}
              className="space-y-1.5"
            >
              <p
                data-testid="activity-attempt-title"
                className="text-xs font-medium leading-4 text-gray-600"
              >
                {describeAttemptNumber(latestAttempt.number)}
              </p>
              {renderAttemptSteps(latestAttempt)}
            </div>
          </>
        ) : (
          renderAttemptSteps(latestAttempt)
        )}
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

            {steps.length > 0 && (
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
