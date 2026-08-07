import * as k8s from "@kubernetes/client-node";
import {
  AGENT_LABEL_SELECTOR,
  AGENT_NAMESPACE,
  NAMESPACE_EXCLUDE,
  NAMESPACE_INCLUDE,
  NODE_OS_INCLUDE,
} from "./Config";
import Logger from "./Logger";
import NamespaceFilter from "./NamespaceFilter";
import NodeOsFilter from "./NodeOsFilter";
import OTLPBatcher from "./OTLPBatcher";
import { LogStream, PodContext, StreamKey, makeStreamKey } from "./LogStream";

/*
 * Backoff before retrying a failed node-OS read. Pods on that node stay
 * parked (no streams) until the read succeeds, so this only delays pickup
 * on an unhealthy API — it never drops a pod.
 */
const NODE_OS_RETRY_MS: number = 30000;

type PodState = {
  pod: k8s.V1Pod;
  streams: Map<string, LogStream>;
};

const namespaceFilter: NamespaceFilter = new NamespaceFilter(
  NAMESPACE_INCLUDE,
  NAMESPACE_EXCLUDE,
);

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
  return labels["app.kubernetes.io/name"] || labels["app"] || fallback;
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
    /*
     * Stream logs once the container has at least started, even if it has
     * since terminated — the logs are still available until the pod is gone.
     */
    return (
      status.started === true ||
      Boolean(status.state?.running) ||
      Boolean(status.state?.terminated)
    );
  }
  return false;
};

export class PodWatcher {
  private readonly kubeConfig: k8s.KubeConfig;
  private readonly coreApi: k8s.CoreV1Api;
  private readonly batcher: OTLPBatcher;
  private readonly pods: Map<string, PodState> = new Map();
  private readonly nodeOsFilter: NodeOsFilter;
  /*
   * Pods seen before their node's OS is known, keyed node -> podUID -> pod.
   * Handler code must stay synchronous (an await between a pod event and its
   * stream bookkeeping lets a delete interleave, leaking a forever-
   * reconnecting stream), so unknown-OS pods are parked here and re-processed
   * from resolveNodeOs() once the lookup lands. handleDelete removes parked
   * pods too, which is what closes that race.
   */
  private readonly parkedByNode: Map<string, Map<string, k8s.V1Pod>> =
    new Map();
  private readonly resolvingNodes: Set<string> = new Set();
  private informer: k8s.Informer<k8s.V1Pod> | null = null;
  private stopped: boolean = false;

  public constructor(kubeConfig: k8s.KubeConfig, batcher: OTLPBatcher) {
    this.kubeConfig = kubeConfig;
    this.coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.batcher = batcher;
    this.nodeOsFilter = new NodeOsFilter(
      NODE_OS_INCLUDE,
      async (nodeName: string): Promise<string> => {
        try {
          const res: { body: k8s.V1Node } =
            await this.coreApi.readNode(nodeName);
          return res.body.metadata?.labels?.["kubernetes.io/os"] || "";
        } catch (err: unknown) {
          /*
           * NodeOsFilter swallows reader failures (returns unresolved), so
           * this is the only place the cause gets recorded.
           */
          Logger.warn("failed to read node OS; will retry", {
            node: nodeName,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
    );
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
      namespaceInclude: NAMESPACE_INCLUDE,
      namespaceExclude: NAMESPACE_EXCLUDE,
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
    this.parkedByNode.clear();
    this.resolvingNodes.clear();
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
    if (!namespaceFilter.isAllowed(namespace)) {
      return;
    }
    if (matchesAgentSelector(pod)) {
      // Don't tail our own pods — would create a feedback loop.
      return;
    }

    const nodeName: string = pod.spec?.nodeName || "";
    if (this.nodeOsFilter.isActive()) {
      if (!nodeName) {
        // Not scheduled yet — the update event on scheduling re-fires this.
        return;
      }
      const verdict: string = this.nodeOsFilter.lookup(nodeName);
      if (verdict === "denied") {
        return;
      }
      if (verdict === "unknown") {
        this.parkPod(nodeName, pod);
        return;
      }
    }

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
    /*
     * Also drop the pod from the parked set, so a pod deleted while its
     * node's OS was still resolving is never re-processed into live streams.
     * An inner map that empties is removed with it: the retry loop in
     * resolveNodeOs() keys on this map, and a node deleted from the cluster
     * (scale-down takes the node and its pods together) 404s on readNode
     * forever — a leftover empty entry would retry that read every 30s for
     * the life of the process.
     */
    for (const [nodeName, parked] of this.parkedByNode.entries()) {
      parked.delete(podUID);
      if (parked.size === 0) {
        this.parkedByNode.delete(nodeName);
      }
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

  private parkPod(nodeName: string, pod: k8s.V1Pod): void {
    const podUID: string | undefined = pod.metadata?.uid;
    if (!podUID) {
      return;
    }
    let parked: Map<string, k8s.V1Pod> | undefined =
      this.parkedByNode.get(nodeName);
    if (!parked) {
      parked = new Map();
      this.parkedByNode.set(nodeName, parked);
    }
    // Keep the freshest pod object; container statuses evolve while parked.
    parked.set(podUID, pod);
    this.resolveNodeOs(nodeName);
  }

  private resolveNodeOs(nodeName: string): void {
    if (this.resolvingNodes.has(nodeName)) {
      return;
    }
    this.resolvingNodes.add(nodeName);
    void this.nodeOsFilter.resolve(nodeName).then((resolved: boolean): void => {
      if (this.stopped) {
        return;
      }
      if (resolved) {
        this.resolvingNodes.delete(nodeName);
        const parked: Map<string, k8s.V1Pod> | undefined =
          this.parkedByNode.get(nodeName);
        this.parkedByNode.delete(nodeName);
        if (parked) {
          for (const pod of parked.values()) {
            // Re-enters synchronously; lookup() now answers from the cache.
            this.handleAddOrUpdate(pod);
          }
        }
        return;
      }
      /*
       * Node read failed (resolve() logged it). Hold resolvingNodes so new
       * pod events keep parking instead of re-firing reads, and retry after
       * a delay. unref() so a pending retry never holds the process open.
       */
      setTimeout((): void => {
        this.resolvingNodes.delete(nodeName);
        // Size check, not has(): only retry while pods actually wait.
        if (!this.stopped && (this.parkedByNode.get(nodeName)?.size ?? 0) > 0) {
          this.resolveNodeOs(nodeName);
        }
      }, NODE_OS_RETRY_MS).unref();
    });
  }
}
