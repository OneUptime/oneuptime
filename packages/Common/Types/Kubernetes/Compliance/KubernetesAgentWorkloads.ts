import { isOneUptimeAgentObject } from "./KubernetesRbac";

/*
 * THE ONEUPTIME AGENT'S OWN WORKLOADS, AS THE COMPLIANCE PAGE SAYS THEM (#9929).
 *
 * The kubernetes-agent chart runs a few workloads that need what the Pod
 * Security Standards and the CIS benchmark fail on purpose: the node
 * collector mounts the node's /var/log/pods, /proc and /sys; the eBPF
 * instrumentation and the profiler run privileged in the node's process
 * namespace; kube-bench (#9873) runs as root there with read-only mounts of
 * the node's Kubernetes files. A person reading the Restricted score saw them
 * among the workloads to fix, with nothing to say they are OneUptime's or why.
 *
 * Each is told by its workload's labels: everything the chart makes carries
 * its chart and OneUptime (isOneUptimeAgentObject) and a component label of
 * its own (templates/*.yaml). Its finding says so, why it needs what it asks
 * for, and the value that removes it, and offers to accept the finding with
 * that reason filled in (#9874's acceptance). The agent's other workloads -
 * the metrics collector, the cost agent, the AI agent - need nothing a
 * control fails on, so theirs say only that they are the agent's own.
 *
 * Accepting each workload is what the page offers, not turning the agent's
 * namespace off for the framework, as Pod Security Admission exempts a
 * namespace: that would hide whatever else runs there, the agent's own
 * workloads that need nothing among them.
 */

// The chart's own label on each of its workloads.
export const ONEUPTIME_AGENT_COMPONENT_LABEL: string = "component";

// The agent's workloads the page says why of.
export enum OneUptimeAgentComponent {
  // The DaemonSet that tails pod logs and reads host metrics (component: log-collector).
  NodeCollector = "node-collector",
  // OpenTelemetry eBPF Instrumentation (component: ebpf-instrument).
  Ebpf = "ebpf",
  // The OpenTelemetry eBPF Profiler (component: profiling).
  Profiler = "profiler",
  // kube-bench, for the CIS benchmark's node controls (component: node-benchmark).
  NodeBenchmark = "node-benchmark",
  // Any other workload the chart made.
  Other = "other",
}

/*
 * The agent's component a workload is, by its labels and kind, or null for
 * a workload the chart did not make. The API-mode log tailer is a
 * Deployment labelled log-collector too, and reads no node file.
 */
export function getOneUptimeAgentComponent(workload: {
  kind: string;
  labels?: Record<string, string> | null | undefined;
}): OneUptimeAgentComponent | null {
  const labels: Record<string, string> = workload.labels || {};

  if (!isOneUptimeAgentObject({ name: "", labels })) {
    return null;
  }

  switch (labels[ONEUPTIME_AGENT_COMPONENT_LABEL]) {
    case "log-collector":
      return workload.kind === "DaemonSet"
        ? OneUptimeAgentComponent.NodeCollector
        : OneUptimeAgentComponent.Other;
    case "ebpf-instrument":
      return OneUptimeAgentComponent.Ebpf;
    case "profiling":
      return OneUptimeAgentComponent.Profiler;
    case "node-benchmark":
      return OneUptimeAgentComponent.NodeBenchmark;
    default:
      return OneUptimeAgentComponent.Other;
  }
}

// Marks a string as a key of the Dashboard's locales, as TranslateTemplate's translationKey does.
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export interface OneUptimeAgentComponentWords {
  /*
   * Whose it is and why it needs what the controls fail, in a sentence or
   * two, as the page says it and as an acceptance's reason is filled in.
   */
  why: string;
  // The value that removes it, in a sentence with {{setting}} drawn as code.
  turnOff: string;
  setting: string;
  // A second value, for the node collector's host metrics.
  secondTurnOff?: string | undefined;
  secondSetting?: string | undefined;
}

// Said of any workload of the agent's, before what it needs.
export const ONEUPTIME_AGENT_OWN_WORKLOAD: string = translationKey(
  "This workload is the OneUptime Kubernetes agent's own.",
);

export const ONEUPTIME_AGENT_COMPONENT_WORDS: Readonly<
  Partial<Record<OneUptimeAgentComponent, OneUptimeAgentComponentWords>>
> = {
  [OneUptimeAgentComponent.NodeCollector]: {
    why: translationKey(
      "The OneUptime Kubernetes agent's node collector reads pod logs from each node's /var/log/pods, and host metrics from its /proc and /sys, through read-only hostPath mounts.",
    ),
    turnOff: translationKey(
      "{{setting}} reads pod logs through the Kubernetes API instead.",
    ),
    setting: "--set logs.mode=api",
    secondTurnOff: translationKey("{{setting}} leaves out /proc and /sys."),
    secondSetting: "--set hostMetrics.enabled=false",
  },
  [OneUptimeAgentComponent.Ebpf]: {
    why: translationKey(
      "The OneUptime Kubernetes agent's eBPF instrumentation loads eBPF programs into each node's kernel to trace your services' requests without code changes, which takes a privileged container in the node's process namespace.",
    ),
    turnOff: translationKey("{{setting}} removes it."),
    setting: "--set ebpf.enabled=false",
  },
  [OneUptimeAgentComponent.Profiler]: {
    why: translationKey(
      "The OneUptime Kubernetes agent's profiler samples the stacks of every process on each node with eBPF, which takes a privileged container in the node's process namespace.",
    ),
    turnOff: translationKey("{{setting}} removes it."),
    setting: "--set profiling.enabled=false",
  },
  [OneUptimeAgentComponent.NodeBenchmark]: {
    why: translationKey(
      "The OneUptime Kubernetes agent's kube-bench reads each node's Kubernetes files and its processes' flags for the CIS benchmark's node controls, which takes root in the node's process namespace and read-only hostPath mounts.",
    ),
    turnOff: translationKey("{{setting}} removes it."),
    setting: "--set compliance.nodeBenchmark.enabled=false",
  },
};

// Whether the page can say why a component needs what the controls fail.
export function hasOneUptimeAgentReason(
  component: OneUptimeAgentComponent | null | undefined,
): boolean {
  return Boolean(component && ONEUPTIME_AGENT_COMPONENT_WORDS[component]);
}
