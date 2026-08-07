/*
 * Filters pods by the operating system of the node they run on, resolved from
 * the node's `kubernetes.io/os` label (set by the kubelet on every node since
 * Kubernetes 1.14).
 *
 * Why this exists: the agent's DaemonSet collector is pinned to Linux nodes —
 * its images are linux-only — so on mixed-OS clusters, pods on Windows nodes
 * have no node-local collector to tail their logs. The chart's hybrid log mode
 * (`logs.windowsPods.enabled`) runs this tailer with NODE_OS_INCLUDE=windows:
 * it picks up exactly the pods the DaemonSet cannot reach, so the two
 * collectors partition pods by node OS and never ship the same line twice.
 *
 * The lookup is deliberately SYNCHRONOUS and cache-only: PodWatcher's informer
 * handlers must stay synchronous end-to-end, because an await between a pod
 * event and its stream bookkeeping lets a delete event interleave — and a
 * stream started for an already-deleted pod reconnects forever (LogStream
 * relies on PodWatcher.stop()). Unknown nodes answer "unknown"; the caller
 * parks the pod, calls resolve(), and re-processes once the OS is cached.
 *
 * Resolved OS values are cached forever: a node's OS cannot change in place
 * (the kubelet registers it once), so one GET per node name is enough. A node
 * genuinely missing the label caches as "" (permanently denied — such a node
 * predates Kubernetes 1.14 and cannot host pods this filter should match).
 * Failed lookups are NOT cached, so resolve() can be retried.
 *
 * Known limits of cache-forever, accepted deliberately: entries for nodes
 * that leave the cluster are never evicted (a few bytes per node name ever
 * seen), and a node deleted and recreated under the SAME name with a
 * DIFFERENT OS — a bare-metal reimage with a static hostname — keeps its
 * stale verdict until the tailer restarts, duplicating or missing that one
 * node's logs in the chart's hybrid mode until then.
 */

export type NodeOsReader = (nodeName: string) => Promise<string>;

export type NodeOsVerdict = "allowed" | "denied" | "unknown";

export default class NodeOsFilter {
  private readonly include: Array<string>;
  private readonly reader: NodeOsReader;
  private readonly cache: Map<string, string> = new Map();
  private readonly inflight: Map<string, Promise<boolean>> = new Map();

  public constructor(include: Array<string>, reader: NodeOsReader) {
    this.include = include
      .map((os: string): string => {
        return os.trim().toLowerCase();
      })
      .filter((os: string): boolean => {
        return os.length > 0;
      });
    this.reader = reader;
  }

  /*
   * An empty include list means "no OS filtering" — every pod is allowed and
   * lookup() never answers "unknown", so PodWatcher's parking path is never
   * taken and behavior is identical to a build without this filter.
   */
  public isActive(): boolean {
    return this.include.length > 0;
  }

  public lookup(nodeName: string): NodeOsVerdict {
    if (!this.isActive()) {
      return "allowed";
    }
    const os: string | undefined = this.cache.get(nodeName);
    if (os === undefined) {
      return "unknown";
    }
    return this.include.includes(os) ? "allowed" : "denied";
  }

  /*
   * Fetch and cache the node's OS. Resolves true once the OS is cached (from
   * this call or a concurrent one), false when the read failed — nothing is
   * cached then, so the caller may retry later. Never rejects; a reader that
   * wants the failure logged must do so itself before rethrowing (this module
   * stays dependency-free so its tests need no runtime config). Concurrent
   * calls for the same node share one read.
   */
  public resolve(nodeName: string): Promise<boolean> {
    if (this.cache.has(nodeName)) {
      return Promise.resolve(true);
    }
    let pending: Promise<boolean> | undefined = this.inflight.get(nodeName);
    if (!pending) {
      pending = this.reader(nodeName)
        .then((os: string): boolean => {
          this.cache.set(nodeName, os.trim().toLowerCase());
          return true;
        })
        .catch((): boolean => {
          return false;
        })
        .finally((): void => {
          this.inflight.delete(nodeName);
        });
      this.inflight.set(nodeName, pending);
    }
    return pending;
  }
}
