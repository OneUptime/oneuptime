import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionGap,
  AutoRemediationDecisionHelper,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionMonitor,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "Common/Types/AutoRemediation/AutoRemediationDecision";
import { KubernetesAiRemediationMode } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "Common/Types/ObjectID";
import {
  AI_RESOURCE_TYPE_INFO,
  isAiResourceType,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import {
  translatableTerm,
  translationKey,
  TranslatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT AUTO-REMEDIATION DID WITH AN INCIDENT OR ALERT, IN SENTENCES.
 *
 * The rule engine writes down, per fix path, what it did or why it did
 * nothing (Common/Types/AutoRemediation/AutoRemediationDecision). This turns
 * one such record into the lines the Remediation card shows: one sentence
 * each, a tone, the readiness gap's "why" and "what to do" where a cluster
 * or resource is blocked, and links to the page where it is fixed.
 *
 * Two entries are folded into one line: a signal linked to no Kubernetes
 * cluster and to no infrastructure resource reads as one sentence - the one
 * that answers "why did it not fix itself?" most often - with a link to each
 * of its monitors, where they can be linked to what they watch. A lane that
 * did not run because another lane took the signal says nothing: the line
 * of the lane that did act says it all.
 *
 * React-free, so App's tests can read it; RemediationSuggestionCard draws it.
 */

export type RemediationDecisionTone =
  | "acted"
  | "attention"
  | "info"
  | "waiting";

export interface RemediationDecisionLink {
  // Translated.
  text: string;
  route: Route;
}

export interface RemediationDecisionLine {
  key: string;
  tone: RemediationDecisionTone;
  // Translated.
  text: string;
  // A cluster's or resource's readiness gap, as its AI agent page words it.
  why?: string | undefined;
  whatToDo?: string | undefined;
  links: Array<RemediationDecisionLink>;
}

export interface RemediationDecision {
  stage: AutoRemediationDecisionStage;
  entries: Array<AutoRemediationDecisionEntry>;
}

export type RemediationDecisionSignal = "incident" | "alert";

// A stored decision as the card reads it.
export interface RemediationDecisionRow {
  stage?: string | undefined;
  entries?: unknown;
  createdAt?: Date | string | undefined;
}

/*
 * The decision the card shows: the newest Evaluated one, or - while
 * remediation still waits for the AI investigation - the newest
 * WaitingForInvestigation one. An evaluation always wins over a wait,
 * whatever their order: the investigation can settle (and its evaluation
 * be written) a moment before the create hook writes that it waits.
 */
export function pickRemediationDecision(
  rows: Array<RemediationDecisionRow>,
): RemediationDecision | null {
  const sorted: Array<RemediationDecisionRow> = [...rows].sort(
    (a: RemediationDecisionRow, b: RemediationDecisionRow): number => {
      return getTime(b.createdAt) - getTime(a.createdAt);
    },
  );

  const evaluated: RemediationDecisionRow | undefined = sorted.find(
    (row: RemediationDecisionRow): boolean => {
      return row.stage === AutoRemediationDecisionStage.Evaluated;
    },
  );

  if (evaluated) {
    return {
      stage: AutoRemediationDecisionStage.Evaluated,
      entries: AutoRemediationDecisionHelper.parseEntries(evaluated.entries),
    };
  }

  const waiting: RemediationDecisionRow | undefined = sorted.find(
    (row: RemediationDecisionRow): boolean => {
      return row.stage === AutoRemediationDecisionStage.WaitingForInvestigation;
    },
  );

  return waiting
    ? {
        stage: AutoRemediationDecisionStage.WaitingForInvestigation,
        entries: [],
      }
    : null;
}

function getTime(value: Date | string | undefined): number {
  if (!value) {
    return 0;
  }

  const time: number = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export const REMEDIATION_DECISION_HEADING: string = translationKey(
  "What auto-remediation did",
);

// Shown on the card when it holds a decision and no suggestion yet.
export const REMEDIATION_DECISION_CARD_DESCRIPTION: string = translationKey(
  "What OneUptime did to fix this automatically, or why it did nothing.",
);

const LINK_CLUSTER_AI_PAGE: string = translationKey(
  "Open the cluster's AI agent page",
);
const LINK_RESOURCE_AI_PAGE: string = translationKey("Open its AI agent page");
const LINK_INCIDENT_RULES: string = translationKey(
  "Incident Auto Remediation Rules",
);
const LINK_ALERT_RULES: string = translationKey("Alert Auto Remediation Rules");
const LINK_AI_FEATURES: string = translationKey("AI settings");
const LINK_INCIDENT_AI_SETTINGS: string = translationKey(
  "Incident AI settings",
);
const LINK_ALERT_AI_SETTINGS: string = translationKey("Alert AI settings");
const LINK_LLM_PROVIDERS: string = translationKey("LLM providers");
const LINK_MONITOR: string = translationKey("Link {{monitorName}}");
const UNNAMED_MONITOR: string = translationKey("the monitor");

// The AI agent page of each kind of infrastructure resource.
const RESOURCE_AI_AGENT_PAGES: Record<string, PageMap> = {
  DockerHost: PageMap.DOCKER_HOST_VIEW_AI_AGENT,
  PodmanHost: PageMap.PODMAN_HOST_VIEW_AI_AGENT,
  DockerSwarmCluster: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_AGENT,
  ProxmoxCluster: PageMap.PROXMOX_CLUSTER_VIEW_AI_AGENT,
  VMwareVCenter: PageMap.VMWARE_VCENTER_VIEW_AI_AGENT,
  CephCluster: PageMap.CEPH_CLUSTER_VIEW_AI_AGENT,
  DatabaseServer: PageMap.DATABASE_SERVER_VIEW_AI_AGENT,
  Host: PageMap.HOST_VIEW_AI_AGENT,
};

function translateText(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
}

function routeTo(page: PageMap, modelId?: string | undefined): Route | null {
  const route: Route | undefined = RouteMap[page] as Route | undefined;

  if (!route) {
    return null;
  }

  if (modelId === undefined) {
    return RouteUtil.populateRouteParams(route);
  }

  if (!ObjectID.isValidUUID(modelId)) {
    return null;
  }

  return RouteUtil.populateRouteParams(route, {
    modelId: new ObjectID(modelId),
  });
}

function link(
  translator: Translator,
  text: string,
  route: Route | null,
): Array<RemediationDecisionLink> {
  return route ? [{ text: translateText(translator, text), route }] : [];
}

function clusterLink(
  translator: Translator,
  entry: AutoRemediationDecisionEntry,
): Array<RemediationDecisionLink> {
  return link(
    translator,
    LINK_CLUSTER_AI_PAGE,
    entry.kubernetesClusterId
      ? routeTo(
          PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT,
          entry.kubernetesClusterId,
        )
      : null,
  );
}

function resourceLink(
  translator: Translator,
  entry: AutoRemediationDecisionEntry,
): Array<RemediationDecisionLink> {
  const page: PageMap | undefined = entry.resourceType
    ? RESOURCE_AI_AGENT_PAGES[entry.resourceType]
    : undefined;

  return link(
    translator,
    LINK_RESOURCE_AI_PAGE,
    page && entry.resourceId ? routeTo(page, entry.resourceId) : null,
  );
}

/*
 * The Auto Remediation Rules are under the AI settings page's More
 * settings (they had a page of their own), with the switch that turns
 * fixing on.
 */
function getAiSettingsPage(signal: RemediationDecisionSignal): PageMap {
  return signal === "incident"
    ? PageMap.INCIDENTS_SETTINGS_AI
    : PageMap.ALERTS_SETTINGS_AI;
}

function rulesLink(
  translator: Translator,
  signal: RemediationDecisionSignal,
): Array<RemediationDecisionLink> {
  return link(
    translator,
    signal === "incident" ? LINK_INCIDENT_RULES : LINK_ALERT_RULES,
    routeTo(getAiSettingsPage(signal)),
  );
}

function aiSettingsLink(
  translator: Translator,
  signal: RemediationDecisionSignal,
): Array<RemediationDecisionLink> {
  return link(
    translator,
    signal === "incident" ? LINK_INCIDENT_AI_SETTINGS : LINK_ALERT_AI_SETTINGS,
    routeTo(getAiSettingsPage(signal)),
  );
}

function monitorLinks(
  translator: Translator,
  monitors: Array<AutoRemediationDecisionMonitor>,
): Array<RemediationDecisionLink> {
  const links: Array<RemediationDecisionLink> = [];

  for (const monitor of monitors) {
    const route: Route | null = routeTo(PageMap.MONITOR_VIEW, monitor.id);

    if (!route) {
      continue;
    }

    links.push({
      text: translator.translateTemplate(LINK_MONITOR, {
        monitorName: monitor.name || translateText(translator, UNNAMED_MONITOR),
      }),
      route,
    });
  }

  return links;
}

function getSignalTerm(signal: RemediationDecisionSignal): TranslatableTerm {
  return translatableTerm(signal === "incident" ? "Incident" : "Alert", {
    inSentence: true,
  });
}

function getResourceKindTerm(
  entry: AutoRemediationDecisionEntry,
): TranslatableTerm {
  const displayName: string = isAiResourceType(entry.resourceType)
    ? AI_RESOURCE_TYPE_INFO[entry.resourceType].displayName
    : "Resource";

  return translatableTerm(displayName, { inSentence: true });
}

function getGapText(entry: AutoRemediationDecisionEntry): {
  why?: string | undefined;
  whatToDo?: string | undefined;
} {
  const gap: AutoRemediationDecisionGap | undefined = entry.gaps?.[0];

  if (!gap) {
    return {};
  }

  return {
    why: gap.description ? `${gap.title}. ${gap.description}` : gap.title,
    whatToDo: gap.nextStep || undefined,
  };
}

/*
 * The started round's sentence, by the fix mode it runs in. A round that
 * would have run on its own asks first when a matching Auto Remediation Rule
 * asks before fixing, and says which rule.
 */
function getClusterRoundStartedTemplate(
  mode: string | undefined,
  ruleName: string,
): string {
  if (ruleName) {
    return translationKey(
      'OneUptime AI is composing a fix for cluster "{{clusterName}}". Nothing runs until you approve it, because Auto Remediation Rule "{{ruleName}}" asks before fixing.',
    );
  }

  if (mode === KubernetesAiRemediationMode.BypassApproval) {
    return translationKey(
      'OneUptime AI is fixing cluster "{{clusterName}}". Approvals are bypassed on this cluster, so its fixes run on their own.',
    );
  }

  if (mode === KubernetesAiRemediationMode.Automatic) {
    return translationKey(
      'OneUptime AI is fixing cluster "{{clusterName}}". Safe fixes run on their own; a riskier one waits for your approval.',
    );
  }

  return translationKey(
    'OneUptime AI is composing a fix for cluster "{{clusterName}}". Nothing runs until you approve it.',
  );
}

function getResourceRoundStartedTemplate(
  mode: string | undefined,
  ruleName: string,
): string {
  if (ruleName) {
    return translationKey(
      'OneUptime AI is composing a fix for {{resourceKind}} "{{resourceName}}". Nothing runs until you approve it, because Auto Remediation Rule "{{ruleName}}" asks before fixing.',
    );
  }

  if (mode === KubernetesAiRemediationMode.BypassApproval) {
    return translationKey(
      'OneUptime AI is fixing {{resourceKind}} "{{resourceName}}". Approvals are bypassed on it, so its fixes run on their own.',
    );
  }

  if (mode === KubernetesAiRemediationMode.Automatic) {
    return translationKey(
      'OneUptime AI is fixing {{resourceKind}} "{{resourceName}}". Safe fixes run on their own; a riskier one waits for your approval.',
    );
  }

  return translationKey(
    'OneUptime AI is composing a fix for {{resourceKind}} "{{resourceName}}". Nothing runs until you approve it.',
  );
}

// Lanes that only say "another lane took this signal": never drawn.
const SILENT_REASONS: Array<AutoRemediationDecisionReason> = [
  AutoRemediationDecisionReason.ClusterSkippedForResourceRound,
  AutoRemediationDecisionReason.ResourceSkippedForClusterRound,
];

export function getRemediationDecisionLines(input: {
  decision: RemediationDecision;
  signal: RemediationDecisionSignal;
  translator: Translator;
}): Array<RemediationDecisionLine> {
  const { decision, signal, translator } = input;
  const signalTerm: TranslatableTerm = getSignalTerm(signal);

  if (decision.stage === AutoRemediationDecisionStage.WaitingForInvestigation) {
    return [
      {
        key: "waiting-for-investigation",
        tone: "waiting",
        text: translator.translateTemplate(
          "Auto-remediation runs once OneUptime AI has finished investigating this {{signal}}, so it can act on the root cause analysis.",
          { signal: signalTerm },
        ),
        links: [],
      },
    ];
  }

  const entries: Array<AutoRemediationDecisionEntry> = decision.entries;

  const hasLinkedCluster: boolean = entries.some(
    (entry: AutoRemediationDecisionEntry): boolean => {
      return (
        entry.lane === AutoRemediationDecisionLane.KubernetesCluster &&
        Boolean(entry.kubernetesClusterId)
      );
    },
  );
  const hasLinkedResource: boolean = entries.some(
    (entry: AutoRemediationDecisionEntry): boolean => {
      return (
        entry.lane === AutoRemediationDecisionLane.Resource &&
        Boolean(entry.resourceId)
      );
    },
  );
  const clusterNoneLinked: AutoRemediationDecisionEntry | undefined =
    entries.find((entry: AutoRemediationDecisionEntry): boolean => {
      return entry.reason === AutoRemediationDecisionReason.ClusterNoneLinked;
    });
  const resourceNoneLinked: AutoRemediationDecisionEntry | undefined =
    entries.find((entry: AutoRemediationDecisionEntry): boolean => {
      return entry.reason === AutoRemediationDecisionReason.ResourceNoneLinked;
    });
  const isLinkedToNothing: boolean = Boolean(
    clusterNoneLinked && resourceNoneLinked,
  );

  const lines: Array<RemediationDecisionLine> = [];
  let hasDrawnNothingLinked: boolean = false;

  entries.forEach((entry: AutoRemediationDecisionEntry, index: number) => {
    const key: string = `${entry.lane}-${entry.reason}-${index}`;

    if (SILENT_REASONS.includes(entry.reason)) {
      return;
    }

    const clusterName: string = entry.kubernetesClusterName || "";
    const resourceName: string = entry.resourceName || "";
    const ruleName: string = entry.ruleName || "";
    const runbookName: string = entry.runbookName || "";

    switch (entry.reason) {
      // --- Project ---
      case AutoRemediationDecisionReason.EnableAiOff:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            "Enable AI is off for this project, so nothing is fixed automatically: no cluster or resource fix and no Auto Remediation Rule runs.",
          ),
          links: link(
            translator,
            LINK_AI_FEATURES,
            routeTo(PageMap.SETTINGS_AI_FEATURES),
          ),
        });
        return;
      case AutoRemediationDecisionReason.RemediationOff:
        // A choice, not a fault: fixing starts off until a project turns it on.
        lines.push({
          key,
          tone: "info",
          text:
            signal === "incident"
              ? translator.translateTemplate(
                  '"Fix new incidents automatically" is off for this project, so OneUptime AI did not try to fix this incident.',
                )
              : translator.translateTemplate(
                  '"Fix new alerts automatically" is off for this project, so OneUptime AI did not try to fix this alert.',
                ),
          links: aiSettingsLink(translator, signal),
        });
        return;
      case AutoRemediationDecisionReason.SuggestionLimitReached:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            "This {{signal}} already has the most fixes one {{signal}} can get, so nothing more was tried.",
            { signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.EvaluationFailed:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            "Auto-remediation stopped on an error while checking this {{signal}}. What it did before the error is listed here.",
            { signal: signalTerm },
          ),
          links: [],
        });
        return;

      // --- Linked to nothing ---
      case AutoRemediationDecisionReason.ClusterNoneLinked:
      case AutoRemediationDecisionReason.ResourceNoneLinked: {
        if (isLinkedToNothing) {
          if (hasDrawnNothingLinked) {
            return;
          }

          hasDrawnNothingLinked = true;

          const monitors: Array<AutoRemediationDecisionMonitor> =
            clusterNoneLinked?.monitors?.length
              ? clusterNoneLinked.monitors
              : resourceNoneLinked?.monitors || [];

          lines.push({
            key: "linked-to-nothing",
            tone: "attention",
            text:
              monitors.length > 0
                ? translator.translateTemplate(
                    "This {{signal}} is not linked to a Kubernetes cluster or an infrastructure resource, so OneUptime AI had nothing it could fix. Link its monitor to the cluster, host, database or service it watches, and every {{signal}} it raises from then on will be linked to it.",
                    { signal: signalTerm },
                  )
                : translator.translateTemplate(
                    "This {{signal}} is not linked to a Kubernetes cluster or an infrastructure resource, so OneUptime AI had nothing it could fix.",
                    { signal: signalTerm },
                  ),
            links: monitorLinks(translator, monitors),
          });
          return;
        }

        // The other lane found what this signal is about: nothing to say.
        if (
          (entry.reason === AutoRemediationDecisionReason.ClusterNoneLinked &&
            hasLinkedResource) ||
          (entry.reason === AutoRemediationDecisionReason.ResourceNoneLinked &&
            hasLinkedCluster)
        ) {
          return;
        }

        lines.push({
          key,
          tone: "info",
          text:
            entry.reason === AutoRemediationDecisionReason.ClusterNoneLinked
              ? translator.translateTemplate(
                  "This {{signal}} is not linked to a Kubernetes cluster.",
                  { signal: signalTerm },
                )
              : translator.translateTemplate(
                  "This {{signal}} is not linked to an infrastructure resource with an AI agent.",
                  { signal: signalTerm },
                ),
          links: monitorLinks(translator, entry.monitors || []),
        });
        return;
      }

      // --- Kubernetes cluster ---
      case AutoRemediationDecisionReason.ClusterLookupFailed:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            "OneUptime AI could not check the Kubernetes clusters this {{signal}} is linked to.",
            { signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.ClusterFixesOff:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            'Fixes are off for cluster "{{clusterName}}", so OneUptime AI only investigates there.',
            { clusterName },
          ),
          links: clusterLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ClusterNotReady:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            'Fixes are on for cluster "{{clusterName}}", but OneUptime AI cannot apply them yet.',
            { clusterName },
          ),
          ...getGapText(entry),
          links: clusterLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ClusterAlreadyHasRound:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            'Cluster "{{clusterName}}" already has an AI fix for this {{signal}}.',
            { clusterName, signal: signalTerm },
          ),
          links: clusterLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ClusterRoundStarted:
        lines.push({
          key,
          tone: "acted",
          text: translator.translateTemplate(
            getClusterRoundStartedTemplate(entry.remediationMode, ruleName),
            { clusterName, ruleName },
          ),
          links: clusterLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ClusterRoundNotStarted:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            'OneUptime AI could not start a fix for cluster "{{clusterName}}". The daily AI budget may be used up.',
            { clusterName },
          ),
          links: clusterLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ClusterSkippedLimit:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            'Cluster "{{clusterName}}" was not tried: this {{signal}} already has the most fixes one {{signal}} can get.',
            { clusterName, signal: signalTerm },
          ),
          links: [],
        });
        return;

      // --- Infrastructure resource ---
      case AutoRemediationDecisionReason.ResourceSkippedForOtherRound:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            "Infrastructure resources were not tried: another AI fix already handles this {{signal}}.",
            { signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.ResourceSkippedLimit:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            "Infrastructure resources were not tried: this {{signal}} already has the most fixes one {{signal}} can get.",
            { signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.ResourceLookupFailed:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            "OneUptime AI could not check the infrastructure resources this {{signal}} is linked to.",
            { signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.ResourceFixesOff:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            'Fixes are off for {{resourceKind}} "{{resourceName}}", so OneUptime AI only investigates there.',
            { resourceKind: getResourceKindTerm(entry), resourceName },
          ),
          links: resourceLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ResourceNotReady:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            'Fixes are on for {{resourceKind}} "{{resourceName}}", but OneUptime AI cannot apply them yet.',
            { resourceKind: getResourceKindTerm(entry), resourceName },
          ),
          ...getGapText(entry),
          links: resourceLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ResourceRoundStarted:
        lines.push({
          key,
          tone: "acted",
          text: translator.translateTemplate(
            getResourceRoundStartedTemplate(entry.remediationMode, ruleName),
            {
              resourceKind: getResourceKindTerm(entry),
              resourceName,
              ruleName,
            },
          ),
          links: resourceLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ResourceRoundNotStarted:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            'OneUptime AI could not start a fix for {{resourceKind}} "{{resourceName}}". The daily AI budget may be used up.',
            { resourceKind: getResourceKindTerm(entry), resourceName },
          ),
          links: resourceLink(translator, entry),
        });
        return;
      case AutoRemediationDecisionReason.ResourceNotChosen:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            '{{resourceKind}} "{{resourceName}}" could be fixed too, but OneUptime AI fixes one resource per {{signal}}.',
            {
              resourceKind: translatableTerm(
                isAiResourceType(entry.resourceType)
                  ? AI_RESOURCE_TYPE_INFO[entry.resourceType].displayName
                  : "Resource",
              ),
              resourceName,
              signal: signalTerm,
            },
          ),
          links: resourceLink(translator, entry),
        });
        return;

      // --- Auto Remediation Rules ---
      case AutoRemediationDecisionReason.RulesSkippedLimit:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            "Auto Remediation Rules were not checked: this {{signal}} already has the most fixes one {{signal}} can get.",
            { signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.NoRulesConfigured:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            "No Auto Remediation Rule is set up for this kind of {{signal}}. A rule can propose or start a runbook when a matching one is created.",
            { signal: signalTerm },
          ),
          links: rulesLink(translator, signal),
        });
        return;
      case AutoRemediationDecisionReason.NoRuleMatched:
        lines.push({
          key,
          tone: "info",
          text: translator.translatePlural(
            {
              one: "The {{count}} Auto Remediation Rule set up did not match this {{signal}}.",
              other:
                "None of the {{count}} Auto Remediation Rules set up matched this {{signal}}.",
            },
            entry.rulesChecked || 0,
            { signal: signalTerm },
          ),
          links: rulesLink(translator, signal),
        });
        return;
      case AutoRemediationDecisionReason.NotMatchedByAnyRule:
        lines.push({
          key,
          tone: "info",
          text: translator.translatePlural(
            {
              one: "The {{count}} Auto Remediation Rule set up does not match this {{signal}}, so it was not fixed. With rules set up, only what matches one is fixed.",
              other:
                "None of the {{count}} Auto Remediation Rules set up match this {{signal}}, so it was not fixed. With rules set up, only what matches one is fixed.",
            },
            entry.rulesChecked || 0,
            { signal: signalTerm },
          ),
          links: rulesLink(translator, signal),
        });
        return;
      case AutoRemediationDecisionReason.NoAiFixRuleMatched:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            "No Auto Remediation Rule that matches this {{signal}} fixes with OneUptime AI, so OneUptime AI did not fix it on the clusters or hosts it is linked to.",
            { signal: signalTerm },
          ),
          links: rulesLink(translator, signal),
        });
        return;
      case AutoRemediationDecisionReason.RuleMatchedAiFix:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" matched, so OneUptime AI fixes this {{signal}} on what it is linked to.',
            { ruleName, signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleMatchedAiFixAsks:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" matched, so OneUptime AI fixes this {{signal}} on what it is linked to, and every fix waits for your approval.',
            { ruleName, signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleAlreadyProposed:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" already proposed a fix for this {{signal}}.',
            { ruleName, signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleSkippedNoLlmProvider:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" matched, but it uses AI and the project has no LLM provider.',
            { ruleName },
          ),
          links: link(
            translator,
            LINK_LLM_PROVIDERS,
            routeTo(PageMap.SETTINGS_AI_LLM_PROVIDERS),
          ),
        });
        return;
      case AutoRemediationDecisionReason.RuleAiComposingCommands:
        lines.push({
          key,
          tone: "acted",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" matched: OneUptime AI is composing the commands that fix this {{signal}}.',
            { ruleName, signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleAiPickingRunbook:
        lines.push({
          key,
          tone: "acted",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" matched: OneUptime AI is picking the runbook that fits this {{signal}}.',
            { ruleName, signal: signalTerm },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleAiRunNotStarted:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" matched, but its AI run could not start. The daily AI budget may be used up.',
            { ruleName },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleRunbookProposed:
        lines.push({
          key,
          tone: "acted",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" proposed runbook "{{runbookName}}". It starts when you approve it.',
            { ruleName, runbookName },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleRunbookProposedByCircuitBreaker:
        lines.push({
          key,
          tone: "acted",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" proposed runbook "{{runbookName}}" instead of starting it: the rule already started the most runbooks it may start in an hour.',
            { ruleName, runbookName },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleRunbookStarted:
        lines.push({
          key,
          tone: "acted",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" started runbook "{{runbookName}}".',
            { ruleName, runbookName },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleRunbookNotStarted:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" could not start runbook "{{runbookName}}". The runbook may be turned off or have no steps.',
            { ruleName, runbookName },
          ),
          links: [],
        });
        return;
      case AutoRemediationDecisionReason.RuleHasNoRunbooks:
        lines.push({
          key,
          tone: "attention",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" matched, but it has no runbook and does not use AI, so it did nothing.',
            { ruleName },
          ),
          links: rulesLink(translator, signal),
        });
        return;
      case AutoRemediationDecisionReason.RuleSkippedLimit:
        lines.push({
          key,
          tone: "info",
          text: translator.translateTemplate(
            'Rule "{{ruleName}}" matched, but this {{signal}} already has the most fixes one {{signal}} can get.',
            { ruleName, signal: signalTerm },
          ),
          links: [],
        });
        return;
      default:
        return;
    }
  });

  return lines;
}
