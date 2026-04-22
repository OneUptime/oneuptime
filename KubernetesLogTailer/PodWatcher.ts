import * as k8s from "@kubernetes/client-node";
import {
  AGENT_LABEL_SELECTOR,
  AGENT_NAMESPACE,
  NAMESPACE_EXCLUDE,
  NAMESPACE_INCLUDE,
} from "./Config";
import Logger from "./Logger";
import OTLPBatcher from "./OTLPBatcher";
import { LogStream, PodContext, StreamKey, makeStreamKey } from "./LogStream";

type PodState = {
  pod: k8s.V1Pod;
  streams: Map<string, LogStream>;
};

const includeSet: Set<string> = new Set(NAMESPACE_INCLUDE);
const excludeSet: Set<string> = new Set(NAMESPACE_EXCLUDE);

const isNamespaceAllowed: (namespace: string) => boolean = (
  namespace: string,
): boolean => {
  if (includeSet.size > 0 && !includeSet.has(namespace)) {
    return false;
  }
  if (excludeSet.has(namespace)) {
    return false;
  }
  return true;
};

const matchesAgentSelector: (pod: k8s.V1Pod) => boolean = (
  pod: k8s.V1Pod,
): boolean => {
  if (AGENT_NAMESPACE && pod.metadata?.namespace !== AGENT_NAMESPACE) {
    return false;
  }
  const labels: Record<string, string> = pod.metadata?.labels || {};
  const pairs: Array<string> = AGENT_LABEL_SELECTOR.split(",")
    .map((s: string): string => {
      return s.trim();
    })
    .filter((s: string): boolean => {
      return s.length > 0;
    });
  if (pairs.length === 0) {
    return false;
  }
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (!key) {
      return false;
    }
    if (value === undefined) {
      if (!(key in labels)) {
        return false;
      }
    } else if (labels[key] !== value) {
      return false;
    }
  }
  return true;
};

const deriveServiceName: (pod: k8s.V1Pod, fallback: string) => string = (
  pod: k8s.V1Pod,
  fallback: string,
): string => {
  const owners: Array<k8s.V1OwnerReference> =
    pod.metadata?.ownerReferences || [];
  for (const owner of owners) {
    if (owner.kind === "ReplicaSet" && owner.name) {
      // Strip the trailing -xxxxxxx hash that replicaset names append.
      return owner.name.replace(/-[a-f0-9]{6,10}$/, "");
    }
    if (
      owner.kind === "StatefulSet" ||
      owner.kind === "DaemonSet" ||
      owner.kind === "Job" ||
      owner.kind === "CronJob"
    ) {
      return owner.name || fallback;
    }
  }
  const labels: Record<string, string> = pod.metadata?.labels || {};
  return (
    labels["app.kubernetes.io/name"] ||
    labels["app"] ||
    fallback
  );
};

const collectContainers: (pod: k8s.V1Pod) => Array<string> = (
  pod: k8s.V1Pod,
): Array<string> => {
  const names: Array<string> = [];
  for (const c of pod.spec?.containers || []) {
    if (c.name) {
      names.push(c.name);
    }
  }
  for (const c of pod.spec?.initContainers || []) {
    if (c.name) {
      names.push(c.name);
    }
  }
  for (const c of pod.spec?.ephemeralContainers || []) {
    if (c.name) {
      names.push(c.name);
    }
  }
  return names;
};

const isContainerStartedOrRunning: (
  pod: k8s.V1Pod,
  containerName: string,
) => boolean = (pod: k8s.V1Pod, containerName: string): boolean => {
  const allStatuses: Array<k8s.V1ContainerStatus> = [
    ...(pod.status?.containerStatuses || []),
    ...(pod.status?.initContainerStatuses || []),
    ...(pod.status?.ephemeralContainerStatuses || []),
  ];
  for (const status of allStatuses) {
    if (status.name !== containerName) {
      continue;
    }
    // Stream logs once the container has at least started, even if it has
    // since terminated — the logs are still available until the pod is gone.
    return (
      status.started === true ||
      !!status.state?.running ||
      !!status.state?.terminated
    );
  }
  return false;
};

export class PodWatcher {
  private readonly kubeConfig: k8s.KubeConfig;
  private readonly coreApi: k8s.CoreV1Api;
  private readonly batcher: OTLPBatcher;
  private readonly pods: Map<string, PodState> = new Map();
  private informer: k8s.Informer<k8s.V1Pod> | null = null;
  private stopped: boolean = false;

  public constructor(kubeConfig: k8s.KubeConfig, batcher: OTLPBatcher) {
    this.kubeConfig = kubeConfig;
    this.coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.batcher = batcher;
  }

  public async start(): Promise<void> {
    const listFn: k8s.ListPromise<k8s.V1Pod> = ((): Promise<{
      response: import("http").IncomingMessage;
      body: k8s.V1PodList;
    }> => {
      return this.coreApi.listPodForAllNamespaces();
    }) as k8s.ListPromise<k8s.V1Pod>;
    this.informer = k8s.makeInformer<k8s.V1Pod>(
      this.kubeConfig,
      "/api/v1/pods",
      listFn,
    );

    this.informer.on("add", (pod: k8s.V1Pod): void => {
      this.handleAddOrUpdate(pod);
    });
    this.informer.on("update", (pod: k8s.V1Pod): void => {
      this.handleAddOrUpdate(pod);
    });
    this.informer.on("delete", (pod: k8s.V1Pod): void => {
      this.handleDelete(pod);
    });
    this.informer.on("error", (err: unknown): void => {
      const msg: string = err instanceof Error ? err.message : String(err);
      Logger.warn("pod informer error; will be restarted by client", {
        error: msg,
      });
    });

    await this.informer.start();
    Logger.info("pod watcher started", {
      namespaceInclude: Array.from(includeSet),
      namespaceExclude: Array.from(excludeSet),
    });
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.informer) {
      await this.informer.stop();
    }
    for (const state of this.pods.values()) {
      for (const stream of state.streams.values()) {
        stream.stop();
      }
    }
    this.pods.clear();
  }

  public activeStreamCount(): number {
    let count: number = 0;
    for (const state of this.pods.values()) {
      count += state.streams.size;
    }
    return count;
  }

  private handleAddOrUpdate(pod: k8s.V1Pod): void {
    if (this.stopped) {
      return;
    }
    const namespace: string | undefined = pod.metadata?.namespace;
    const podName: string | undefined = pod.metadata?.name;
    const podUID: string | undefined = pod.metadata?.uid;
    if (!namespace || !podName || !podUID) {
      return;
    }
    if (!isNamespaceAllowed(namespace)) {
      return;
    }
    if (matchesAgentSelector(pod)) {
      // Don't tail our own pods — would create a feedback loop.
      return;
    }

    const nodeName: string = pod.spec?.nodeName || "";
    const labels: Record<string, string> = pod.metadata?.labels || {};
    const serviceName: string = deriveServiceName(pod, podName);

    let state: PodState | undefined = this.pods.get(podUID);
    if (!state) {
      state = { pod, streams: new Map() };
      this.pods.set(podUID, state);
    } else {
      state.pod = pod;
    }

    const desiredContainers: Array<string> = collectContainers(pod);
    for (const containerName of desiredContainers) {
      if (!isContainerStartedOrRunning(pod, containerName)) {
        continue;
      }
      const key: StreamKey = makeStreamKey({
        namespace,
        podUID,
        containerName,
      });
      if (state.streams.has(key)) {
        continue;
      }
      const context: PodContext = {
        namespace,
        podName,
        podUID,
        containerName,
        nodeName,
        labels,
        serviceName,
      };
      const stream: LogStream = new LogStream(
        this.kubeConfig,
        context,
        this.batcher,
      );
      state.streams.set(key, stream);
      stream.start();
      Logger.debug("started log stream", { key });
    }
  }

  private handleDelete(pod: k8s.V1Pod): void {
    const podUID: string | undefined = pod.metadata?.uid;
    if (!podUID) {
      return;
    }
    const state: PodState | undefined = this.pods.get(podUID);
    if (!state) {
      return;
    }
    for (const [key, stream] of state.streams.entries()) {
      stream.stop();
      Logger.debug("stopped log stream", { key });
    }
    this.pods.delete(podUID);
  }
}
