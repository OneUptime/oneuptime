import { JSONObject } from "../../JSON";
import MonitorType from "../MonitorType";
import SeriesLabelDisplay from "./SeriesLabelDisplay";

/*
 * The first three commands an on-call engineer would type.
 *
 * An alert that names the pod is a large improvement over one that does
 * not, but the next thing that happens is always the same: the engineer
 * opens a terminal and reconstructs `kubectl describe pod <pod> -n <ns>`
 * from the alert by hand. Since the alert already knows the pod, the
 * namespace and the node, it can just write the commands out.
 *
 * Rules this module holds itself to:
 *
 *   - Read-only. Every command here inspects; none mutates. An alert
 *     description is the last place to put a `kubectl delete` a tired
 *     engineer might paste without reading.
 *
 *   - Only commands whose arguments are fully known. A command is
 *     emitted only when every identifier it interpolates is present on
 *     the series, so nothing ever renders as `kubectl logs  -n `.
 *
 *   - Shell-safe. Label values come from telemetry - ultimately from
 *     whatever an agent, a Prometheus scrape or a user's own
 *     `oneuptime.captureMetric()` call chose to emit - so a value is
 *     single-quoted with embedded quotes escaped before it is ever
 *     placed in a command line. A label value of
 *     `web; rm -rf /` must render as an inert argument, not as a second
 *     command that a human is being invited to paste into a production
 *     shell.
 */

export interface SeriesDebugCommand {
  // One-line explanation of what the command answers.
  purpose: string;
  // The shell command, ready to paste.
  command: string;
}

/*
 * A conservative allowlist for values that need no quoting at all.
 * Everything else goes through single-quote escaping. Kubernetes object
 * names, container names, device paths and mountpoints all live inside
 * this set in practice, so the common case stays readable.
 */
const SafeUnquotedValue: RegExp = /^[A-Za-z0-9._/:@+-]+$/;

export default class SeriesDebugHints {
  /*
   * Quote a telemetry-supplied value for a shell command line.
   *
   * POSIX single quotes make everything literal, and the only character
   * that cannot appear inside them is the single quote itself - which is
   * why the escape is the usual close/escape/reopen dance rather than a
   * backslash.
   */
  public static quoteForShell(value: string): string {
    if (SafeUnquotedValue.test(value)) {
      return value;
    }

    return `'${value.split("'").join(`'\\''`)}'`;
  }

  private static kubernetesCommands(
    seriesLabels: JSONObject,
  ): Array<SeriesDebugCommand> {
    const commands: Array<SeriesDebugCommand> = [];

    const pod: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "k8s.pod.name",
    ]);
    const namespace: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "k8s.namespace.name",
    ]);
    const container: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "k8s.container.name",
    ]);
    const node: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "k8s.node.name",
    ]);
    const deployment: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "k8s.deployment.name",
    ]);
    const statefulSet: string = SeriesLabelDisplay.findLabelValue(
      seriesLabels,
      ["k8s.statefulset.name"],
    );
    const daemonSet: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "k8s.daemonset.name",
    ]);
    const job: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "k8s.job.name",
    ]);
    const hpa: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "k8s.hpa.name",
    ]);

    /*
     * `-n <ns>` is omitted rather than guessed when the series has no
     * namespace: kubectl then uses the caller's current context, which
     * is the correct fallback. Guessing "default" would send the
     * engineer to the wrong namespace and return "not found".
     */
    const namespaceFlag: string = namespace
      ? ` -n ${SeriesDebugHints.quoteForShell(namespace)}`
      : "";

    if (pod) {
      const quotedPod: string = SeriesDebugHints.quoteForShell(pod);

      commands.push({
        purpose: "Pod status, events, restart reasons and resource limits",
        command: `kubectl describe pod ${quotedPod}${namespaceFlag}`,
      });

      const containerFlag: string = container
        ? ` -c ${SeriesDebugHints.quoteForShell(container)}`
        : "";

      commands.push({
        purpose: "Recent logs from the container",
        command: `kubectl logs ${quotedPod}${containerFlag}${namespaceFlag} --tail=200`,
      });

      commands.push({
        purpose: "Logs from the previous crashed instance, if any",
        command: `kubectl logs ${quotedPod}${containerFlag}${namespaceFlag} --previous --tail=200`,
      });

      commands.push({
        purpose: "Live CPU / memory use per container in this pod",
        command: `kubectl top pod ${quotedPod}${namespaceFlag} --containers`,
      });
    }

    if (deployment) {
      commands.push({
        purpose: "Rollout status of the owning Deployment",
        command: `kubectl rollout status deployment/${SeriesDebugHints.quoteForShell(
          deployment,
        )}${namespaceFlag}`,
      });
    }

    if (statefulSet) {
      commands.push({
        purpose: "Rollout status of the owning StatefulSet",
        command: `kubectl rollout status statefulset/${SeriesDebugHints.quoteForShell(
          statefulSet,
        )}${namespaceFlag}`,
      });
    }

    if (daemonSet) {
      commands.push({
        purpose: "Per-node scheduling state of the DaemonSet",
        command: `kubectl describe daemonset ${SeriesDebugHints.quoteForShell(
          daemonSet,
        )}${namespaceFlag}`,
      });
    }

    if (job) {
      commands.push({
        purpose: "Job completion state and failure reason",
        command: `kubectl describe job ${SeriesDebugHints.quoteForShell(
          job,
        )}${namespaceFlag}`,
      });
    }

    if (hpa) {
      commands.push({
        purpose: "Autoscaler target metric and current/desired replicas",
        command: `kubectl describe hpa ${SeriesDebugHints.quoteForShell(
          hpa,
        )}${namespaceFlag}`,
      });
    }

    if (node) {
      const quotedNode: string = SeriesDebugHints.quoteForShell(node);

      commands.push({
        purpose: "Node conditions, pressure signals and allocatable capacity",
        command: `kubectl describe node ${quotedNode}`,
      });

      commands.push({
        purpose: "Everything scheduled on this node",
        command: `kubectl get pods --all-namespaces --field-selector spec.nodeName=${quotedNode} -o wide`,
      });
    }

    if (pod) {
      commands.push({
        purpose: "Kubernetes events for this object",
        command: `kubectl get events${namespaceFlag} --sort-by=.lastTimestamp --field-selector involvedObject.name=${SeriesDebugHints.quoteForShell(
          pod,
        )}`,
      });
    }

    return commands;
  }

  private static containerCommands(input: {
    seriesLabels: JSONObject;
    cli: string;
  }): Array<SeriesDebugCommand> {
    const container: string = SeriesLabelDisplay.findLabelValue(
      input.seriesLabels,
      ["container.name", "k8s.container.name"],
    );

    if (!container) {
      return [];
    }

    const quoted: string = SeriesDebugHints.quoteForShell(container);
    const cli: string = input.cli;

    return [
      {
        purpose: "Recent container logs",
        command: `${cli} logs --tail 200 ${quoted}`,
      },
      {
        purpose: "Live CPU / memory / IO for this container",
        command: `${cli} stats --no-stream ${quoted}`,
      },
      {
        purpose: "Exit code, restart count and OOM-kill flag",
        command: `${cli} inspect --format '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' ${quoted}`,
      },
      {
        purpose: "Processes running inside the container",
        command: `${cli} top ${quoted}`,
      },
    ];
  }

  private static dockerSwarmCommands(
    seriesLabels: JSONObject,
  ): Array<SeriesDebugCommand> {
    const commands: Array<SeriesDebugCommand> =
      SeriesDebugHints.containerCommands({
        seriesLabels,
        cli: "docker",
      });

    const service: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "docker.swarm.service.name",
    ]);

    if (service) {
      const quoted: string = SeriesDebugHints.quoteForShell(service);

      commands.push({
        purpose: "Task placement and failure reasons for the Swarm service",
        command: `docker service ps ${quoted} --no-trunc`,
      });
      commands.push({
        purpose: "Aggregated logs across every task of the service",
        command: `docker service logs --tail 200 ${quoted}`,
      });
    }

    return commands;
  }

  private static hostCommands(
    seriesLabels: JSONObject,
  ): Array<SeriesDebugCommand> {
    const commands: Array<SeriesDebugCommand> = [];

    const mountpoint: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "mountpoint",
      "diskPath",
      "disk.path",
    ]);

    if (mountpoint) {
      const quoted: string = SeriesDebugHints.quoteForShell(mountpoint);

      commands.push({
        purpose: "Free space and inode use on the affected mount",
        command: `df -h ${quoted} && df -i ${quoted}`,
      });
      commands.push({
        purpose: "Largest directories on the mount",
        command: `du -xh --max-depth=1 ${quoted} 2>/dev/null | sort -h | tail -20`,
      });
      commands.push({
        purpose: "Processes still holding deleted files open on the mount",
        command: `lsof +L1 ${quoted} 2>/dev/null | head -20`,
      });
    }

    const device: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "device",
      "system.device",
    ]);

    if (device) {
      commands.push({
        purpose: "Per-device IO utilization and queue depth",
        command: `iostat -x 1 3 ${SeriesDebugHints.quoteForShell(device)}`,
      });
    }

    const networkInterface: string = SeriesLabelDisplay.findLabelValue(
      seriesLabels,
      ["network.interface", "interfaceName"],
    );

    if (networkInterface) {
      commands.push({
        purpose: "Interface counters, errors and drops",
        command: `ip -s link show ${SeriesDebugHints.quoteForShell(
          networkInterface,
        )}`,
      });
    }

    return commands;
  }

  /**
   * Split the pve-exporter `id` label into (type, id).
   *
   * pve-exporter encodes every resource's identity in ONE datapoint
   * label - "node/pve1", "qemu/100", "lxc/101", "storage/pve1/local-lvm",
   * "cluster/production" - and that label is what the shipped Proxmox
   * templates group by, so it is also the only identity most Proxmox
   * alerts carry. The agent's transform derives `pve.type` / `pve.id`
   * from it (see ProxmoxAgent/otel-collector-config.yaml); those are
   * preferred when present, and this parse is the fallback for a series
   * that predates them or was built by hand.
   *
   * For a three-segment storage id the LAST segment is the storage name,
   * which is what `pvesm` takes.
   */
  private static parseProxmoxId(seriesLabels: JSONObject): {
    type: string;
    id: string;
  } {
    const declaredType: string = SeriesLabelDisplay.findLabelValue(
      seriesLabels,
      ["pve.type"],
    );
    const declaredId: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "pve.id",
    ]);

    if (declaredType && declaredId) {
      return { type: declaredType, id: declaredId };
    }

    const rawId: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "id",
    ]);

    if (!rawId.includes("/")) {
      return { type: declaredType, id: declaredId };
    }

    const segments: Array<string> = rawId.split("/");

    return {
      type: declaredType || segments[0] || "",
      id: declaredId || segments[segments.length - 1] || "",
    };
  }

  private static proxmoxCommands(
    seriesLabels: JSONObject,
  ): Array<SeriesDebugCommand> {
    const commands: Array<SeriesDebugCommand> = [];

    const parsed: { type: string; id: string } =
      SeriesDebugHints.parseProxmoxId(seriesLabels);

    const vmid: string =
      SeriesLabelDisplay.findLabelValue(seriesLabels, ["vmid"]) ||
      (parsed.type === "qemu" || parsed.type === "lxc" ? parsed.id : "");

    if (vmid) {
      const quoted: string = SeriesDebugHints.quoteForShell(vmid);

      /*
       * `qm` addresses VMs and `pct` addresses LXC containers. When the
       * series says which, only the right one is offered; when it does
       * not (a bare `vmid` label on a hand-built monitor), both are, and
       * the wrong one simply reports that no such guest exists.
       */
      if (parsed.type !== "lxc") {
        commands.push({
          purpose: "Current VM status and resource use",
          command: `qm status ${quoted} --verbose`,
        });
        commands.push({
          purpose: "The VM's configured limits",
          command: `qm config ${quoted}`,
        });
      }

      if (parsed.type !== "qemu") {
        commands.push({
          purpose: "Current LXC container status",
          command: `pct status ${quoted}`,
        });
        commands.push({
          purpose: "The container's configured limits",
          command: `pct config ${quoted}`,
        });
      }
    }

    const node: string =
      SeriesLabelDisplay.findLabelValue(seriesLabels, [
        "proxmox.node.name",
        "node",
      ]) || (parsed.type === "node" ? parsed.id : "");

    if (node) {
      commands.push({
        purpose: "Cluster membership and quorum",
        command: `pvecm status`,
      });
      commands.push({
        purpose: "Load, memory and uptime on the affected node",
        command: `pvesh get /nodes/${SeriesDebugHints.quoteForShell(
          node,
        )}/status`,
      });
    }

    const storage: string =
      SeriesLabelDisplay.findLabelValue(seriesLabels, ["storage"]) ||
      (parsed.type === "storage" ? parsed.id : "");

    if (storage) {
      commands.push({
        purpose: "Capacity and health of the affected storage",
        command: `pvesm status --storage ${SeriesDebugHints.quoteForShell(
          storage,
        )}`,
      });
    }

    /*
     * A cluster-scoped id ("cluster/production") and any id shape this
     * parse does not recognise still deserve a first command, and
     * cluster resource status is the one that is always correct.
     */
    if (commands.length === 0) {
      commands.push({
        purpose: "Status of every node, guest and storage in the cluster",
        command: `pvesh get /cluster/resources`,
      });
    }

    return commands;
  }

  private static cephCommands(
    seriesLabels: JSONObject,
  ): Array<SeriesDebugCommand> {
    const commands: Array<SeriesDebugCommand> = [
      {
        purpose: "Cluster health detail, including the reason for any warning",
        command: `ceph health detail`,
      },
    ];

    const daemon: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "ceph_daemon",
    ]);

    if (daemon) {
      const quoted: string = SeriesDebugHints.quoteForShell(daemon);

      commands.push({
        purpose: "State and recent history of the affected daemon",
        command: `ceph daemon ${quoted} status`,
      });
      commands.push({
        purpose: "Where the daemon sits in the CRUSH tree",
        command: `ceph osd tree`,
      });
    }

    const pool: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "pool_id",
      "pool",
    ]);

    if (pool) {
      commands.push({
        purpose: "Per-pool capacity and object counts",
        command: `ceph df detail`,
      });
    }

    return commands;
  }

  /*
   * The read-only commands worth running first for this monitor type
   * and this series, or [] when the series carries nothing to address.
   */
  public static getDebugCommands(input: {
    monitorType: MonitorType | undefined;
    seriesLabels: JSONObject | undefined;
  }): Array<SeriesDebugCommand> {
    const seriesLabels: JSONObject | undefined = input.seriesLabels;

    if (!seriesLabels || Object.keys(seriesLabels).length === 0) {
      return [];
    }

    switch (input.monitorType) {
      case MonitorType.Kubernetes:
        return SeriesDebugHints.kubernetesCommands(seriesLabels);

      case MonitorType.Docker:
        return SeriesDebugHints.containerCommands({
          seriesLabels,
          cli: "docker",
        });

      case MonitorType.Podman:
        return SeriesDebugHints.containerCommands({
          seriesLabels,
          cli: "podman",
        });

      case MonitorType.DockerSwarm:
        return SeriesDebugHints.dockerSwarmCommands(seriesLabels);

      case MonitorType.Host:
      case MonitorType.Server:
        return SeriesDebugHints.hostCommands(seriesLabels);

      case MonitorType.Proxmox:
        return SeriesDebugHints.proxmoxCommands(seriesLabels);

      case MonitorType.Ceph:
        return SeriesDebugHints.cephCommands(seriesLabels);

      /*
       * Metrics / IoT / RUM / Traces and friends deliberately return
       * nothing: their series identify an application-level entity
       * (a service, a device, a route), and there is no command that is
       * both universally correct and read-only for those. The resource
       * block still names the entity.
       */
      default:
        return [];
    }
  }

  /*
   * The commands rendered as a markdown block for an alert/incident
   * description, or "" when there is nothing to suggest - so callers
   * can concatenate unconditionally.
   */
  public static buildMarkdownBlock(input: {
    monitorType: MonitorType | undefined;
    seriesLabels: JSONObject | undefined;
    maxCommands?: number | undefined;
  }): string {
    const commands: Array<SeriesDebugCommand> =
      SeriesDebugHints.getDebugCommands({
        monitorType: input.monitorType,
        seriesLabels: input.seriesLabels,
      });

    if (commands.length === 0) {
      return "";
    }

    const maxCommands: number = input.maxCommands ?? 6;

    const lines: Array<string> = commands
      .slice(0, Math.max(maxCommands, 1))
      .map((command: SeriesDebugCommand) => {
        return `- ${command.purpose}:\n  \`\`\`\n  ${command.command}\n  \`\`\``;
      });

    return `**Start here**\n${lines.join("\n")}`;
  }
}
