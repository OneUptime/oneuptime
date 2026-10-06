import {
  KUBERNETES_AI_AGENT_COMPONENT,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import {
  AGENT_AI_FIXES_SETTING_VALUES,
  AgentAiFixesMode,
} from "Common/Types/AI/AgentAiSettings";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
} from "./DocumentationMarkdown";
import { formatNameList } from "../../../Components/AiAccess/AiAccessModes";
import {
  composedValue,
  translateTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The helm upgrades and the write-access copy the cluster's AI agent page
 * (Pages/Kubernetes/View/AI/Agent.tsx) shows, in a module of their own so
 * the docs suite (App/Tests/FeatureSet/Docs/KubernetesAiAccessDocs*.test.ts)
 * can hold them to the same rules as the docs pages — a refreshed chart
 * index before every upgrade, what write access to workloads amounts to,
 * that a listed namespace must already exist and how to reset the list.
 *
 * The notes are in the reader's language, each one whole key with the
 * commands and namespaces in {{placeholders}} (src/Locales/README.md).
 *
 * Import-clean on purpose (Common types, DocumentationMarkdown and the
 * shared AI access words only): App tests run without a browser, and the
 * page reaches RouteMap and Navigation, which read `window` at load.
 */

// "a, b and c" / "a, b or c", in the reader's language.
export { formatNameList };

// The example namespaces the scoped write-access command names.
export const AI_AGENT_EXAMPLE_WRITE_NAMESPACES: string = "{web,api}";

/*
 * The flag that puts aiAgent.remediation.namespaces back to cluster-wide
 * under `helm upgrade --reuse-values`, which every command here uses.
 *
 * Not `--set aiAgent.remediation.namespaces=null`. With --reuse-values Helm
 * coalesces the new overrides into the release's stored values, and that
 * coalescing deletes a null override whose key the stored values already
 * hold — so a stored [web, api] survives and the write role stays bound in
 * web and api alone. An empty JSON list is an ordinary value: it replaces
 * a stored list and passes the chart's schema. `--set-json` needs Helm
 * 3.10+. (Reproduced with the real helm binary against a stored release
 * for the aiAccess.* values this replaces; helm-unittest renders from
 * values files and cannot model --reuse-values.)
 */
export const AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG: string =
  "--set-json 'aiAgent.remediation.namespaces=[]'";

/*
 * What OneUptime AI may do on the cluster, as the chart's
 * aiAgent.investigation and aiAgent.fixes set it.
 */
export interface AiAgentChartSettings {
  investigation: boolean;
  fixes: AgentAiFixesMode;
}

/*
 * The settings the static commands (the docs, the chart README, the
 * write-access commands) turn fixes on with: investigation on, and a
 * person approving every fix.
 */
export const AI_AGENT_DEFAULT_FIXES_ON_SETTINGS: AiAgentChartSettings = {
  investigation: true,
  fixes: "RequireApproval",
};

// The two flags that set what AI may do, as one continued pair of lines.
export function getAiAgentSettingsFlags(
  settings: AiAgentChartSettings,
): string {
  return `--set aiAgent.investigation=${settings.investigation ? "true" : "false"} \\
  --set aiAgent.fixes=${AGENT_AI_FIXES_SETTING_VALUES[settings.fixes]}`;
}

export interface AiAgentHelmCommands {
  /*
   * Installs (or re-enables) the Kubernetes AI agent, read-only. The one
   * command the page shows when the agent is not installed, and to clusters
   * still on the previous in-cluster Runner: aiAgent.enabled=true is
   * harmless when the agent is already on, so nobody has to decide which
   * variant applies to them.
   */
  install: string;
  /*
   * Sets what AI may do and nothing else: the agent's write scope stays as
   * the release stores it (--reuse-values). What the "Change what AI may
   * do" dialog shows when no write access has to be granted (fixes off, or
   * an agent that may already write).
   */
  applySettings: string;
  /*
   * Write access, the recommended form: the settings, with the write role
   * bound only in the namespaces AI may fix, and no node operations. A
   * complete command of its own, never a line to append — a dropped last
   * line leaves a trailing backslash behind.
   */
  enableRemediationScoped: string;
  /*
   * Write access bound cluster-wide. It resets aiAgent.remediation.
   * namespaces with AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG: under
   * --reuse-values a list stored by an earlier scoped upgrade is kept when
   * the flag is left out, so without the reset this command would leave the
   * role bound only where that list says. Node operations keep the release's
   * setting (the chart's default is on).
   */
  enableRemediation: string;
}

/*
 * Every command starts with `helm repo update`: a cached chart index
 * resolves the old chart, whose values schema refuses aiAgent.* with
 * "Additional property aiAgent is not allowed" — which reads as "this
 * feature does not exist". Each command is complete on its own. No chart
 * version is named: published charts carry the OneUptime version.
 *
 * Every command that sets fixes names investigation too: a release that
 * names either one hands both to the agent, so an unnamed investigation
 * would quietly take the chart's default rather than what the cluster
 * has. aiAgent.fixes (any level but off) grants the write RBAC itself.
 */
export function getAiAgentHelmCommands(
  settings: AiAgentChartSettings = AI_AGENT_DEFAULT_FIXES_ON_SETTINGS,
): AiAgentHelmCommands {
  const install: string = `helm repo update
helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\
  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} --reuse-values \\
  --set aiAgent.enabled=true`;
  const settingsFlags: string = getAiAgentSettingsFlags(settings);

  return {
    install,
    applySettings: `${install} \\
  ${settingsFlags}`,
    enableRemediationScoped: `${install} \\
  ${settingsFlags} \\
  --set "aiAgent.remediation.namespaces=${AI_AGENT_EXAMPLE_WRITE_NAMESPACES}" \\
  --set aiAgent.remediation.nodeOperations=false`,
    enableRemediation: `${install} \\
  ${settingsFlags} \\
  ${AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG}`,
  };
}

/*
 * Where to look when the agent is offline. The namespace is the one the
 * agent last reported for its own pod (posture.podNamespace) when it did,
 * otherwise the install instructions' namespace.
 */
export function getAiAgentLogsCommand(namespace?: string | undefined): string {
  const podNamespace: string =
    typeof namespace === "string" && namespace.trim().length > 0
      ? namespace.trim()
      : KUBERNETES_AGENT_HELM_NAMESPACE;

  return `kubectl logs -n ${podNamespace} -l component=${KUBERNETES_AI_AGENT_COMPONENT} --tail=100`;
}

/*
 * What the page says under the recommended (scoped) command. The chart
 * creates one RoleBinding in each listed namespace and never creates a
 * namespace, so a missing one fails the whole upgrade — the collector
 * included. Under --reuse-values a stored list is kept when the flag is
 * left out, so going back to cluster-wide takes
 * AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG, never `=null`.
 */
export function getAiAgentScopedCommandNote(): string {
  return translateTemplate(
    "Replace {{exampleNamespaces}} with the namespaces AI may fix. Each one must already exist: the chart never creates a namespace, and a missing one fails the whole upgrade. A fix anywhere else is refused. To allow the whole cluster later, use {{clusterWideFlag}} (not =null, which Helm ignores with --reuse-values). nodeOperations=false keeps fixes off nodes; set it to true to allow cordon, uncordon, drain and taint (a drain, a taint or a node patch still waits for a person).",
    {
      exampleNamespaces: AI_AGENT_EXAMPLE_WRITE_NAMESPACES,
      clusterWideFlag: AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG,
    },
  );
}

// What the page says under the cluster-wide command.
export function getAiAgentClusterWideCommandNote(): string {
  return translateTemplate(
    "{{clusterWideFlag}} clears any namespace list stored on the release, so the agent may change every namespace (needs Helm 3.10 or later). Node operations keep the release's setting.",
    { clusterWideFlag: AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG },
  );
}

/*
 * What granting the agent write access amounts to, said wherever the page
 * offers it — the same disclosure the chart docs make: RBAC bounds WHERE
 * the agent may write, not what a write may do.
 */
export function getAiAgentWriteDisclosure(): string {
  return translateTemplate(
    "Write access lets the agent patch and update Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, Pods and HPAs, create Jobs and HPAs, and delete Pods and Jobs — and, unless aiAgent.remediation.nodeOperations=false, cordon, uncordon, drain and taint every node. In a namespace, that is equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets. Without aiAgent.remediation.namespaces it applies cluster-wide — {{protectedNamespaces}} and the agent's own namespace included. There OneUptime still holds the line: a change in {{anyProtectedNamespace}} always needs a person, and the agent never changes its own namespace.",
    {
      protectedNamespaces: composedValue((translator: Translator): string => {
        return formatNameList(PROTECTED_KUBERNETES_NAMESPACES, "and", translator);
      }),
      anyProtectedNamespace: composedValue(
        (translator: Translator): string => {
          return formatNameList(
            PROTECTED_KUBERNETES_NAMESPACES,
            "or",
            translator,
          );
        },
      ),
    },
  );
}
