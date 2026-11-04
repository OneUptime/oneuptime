import { JSONObject } from "../../JSON";
import MonitorType from "../MonitorType";
import SeriesLabelDisplay from "./SeriesLabelDisplay";

import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
// Any run of line breaks inside one command.
const COMMAND_LINE_BREAK_PATTERN: RegExp = /[\r\n]+/g;

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

    /*
     * A node's own alert (Node Not Ready): its state and Swarm's message
     * about it, and what Swarm runs there. A task's alert names the node it
     * runs on too, and its container's commands come first above.
     */
    const node: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "docker.swarm.node.name",
    ]);

    if (node) {
      const quoted: string = SeriesDebugHints.quoteForShell(node);

      commands.push({
        purpose: "The node's state, availability and Swarm's message about it",
        command: `docker node inspect ${quoted} --pretty`,
      });
      commands.push({
        purpose: "The tasks Swarm placed on the node",
        command: `docker node ps ${quoted} --no-trunc`,
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

    const unit: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "systemd.unit.name",
    ]);

    if (unit) {
      const quoted: string = SeriesDebugHints.quoteForShell(unit);

      commands.push({
        purpose: "The unit's state, and why it stopped",
        command: `systemctl status ${quoted} --no-pager`,
      });
      commands.push({
        purpose: "The unit's last 50 log lines",
        command: `journalctl -u ${quoted} -n 50 --no-pager`,
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

  /*
   * The `openstack` CLI for the part a series names, with the labels the shipped
   * templates group by. Every command reads and none changes anything.
   *
   * It runs against one region at a time, so a series that names its region asks
   * that one: a host name can repeat between regions, and the shell's OS_REGION_NAME
   * may be another's. That is a global option, so it comes before the command.
   *
   * Each host name is the one that command takes. Nova's workers say the short host
   * name, which is what `--host` matches; hypervisors and Placement say the full
   * name, which is what `hypervisor show` finds and `--host` does not. And the
   * `status` label's word says whose it is: Nova writes its statuses in capitals,
   * Cinder in lower case.
   */
  private static openstackCommands(
    seriesLabels: JSONObject,
  ): Array<SeriesDebugCommand> {
    const commands: Array<SeriesDebugCommand> = [];

    const label: (key: string) => string = (key: string): string => {
      return SeriesLabelDisplay.findLabelValue(seriesLabels, [key]);
    };
    const quoted: (value: string) => string = (value: string): string => {
      return SeriesDebugHints.quoteForShell(value);
    };

    const region: string = label("openstack.region.name");
    const cli: string = region
      ? `openstack --os-region-name ${quoted(region)}`
      : "openstack";

    const host: string = label("hostname");
    const binary: string = label("service");

    if (binary) {
      const hostFlag: string = host ? ` --host ${quoted(host)}` : "";

      if (binary.startsWith("nova-")) {
        commands.push({
          purpose: "The worker's state, and why it was disabled if it was",
          command: `${cli} compute service list${hostFlag} --service ${quoted(binary)} --long`,
        });

        if (host && binary === "nova-compute") {
          commands.push({
            purpose: "The instances Nova has on this host",
            command: `${cli} server list --all-projects --host ${quoted(host)}`,
          });
          commands.push({
            purpose: "This host's hypervisor, and whether Nova can reach it",
            command: `${cli} hypervisor list --matching ${quoted(host)} --long`,
          });
        }
      } else if (binary.startsWith("cinder-")) {
        commands.push({
          purpose: "The service's state, and why it was disabled if it was",
          command: `${cli} volume service list${hostFlag} --service ${quoted(binary)} --long`,
        });
        commands.push({
          purpose: "How full the storage pools behind it are",
          command: `${cli} volume backend pool list --long`,
        });
      } else {
        commands.push({
          purpose: "The agents on this host, and which of them are alive",
          command: `${cli} network agent list${hostFlag} --long`,
        });
      }
    } else if (host) {
      commands.push({
        purpose: "What the hypervisor has, and what Nova has promised on it",
        command: `${cli} hypervisor show ${quoted(host)}`,
      });
    }

    const instance: string = label("uuid");

    if (instance) {
      commands.push({
        purpose: "The instance's status, host and any fault Nova recorded",
        command: `${cli} server show ${quoted(instance)}`,
      });
      commands.push({
        purpose: "What was done to the instance, and which step failed",
        command: `${cli} server event list ${quoted(instance)} --long`,
      });
    }

    const router: string = label("router_id");

    if (router) {
      commands.push({
        purpose: "The router's status and its external gateway",
        command: `${cli} router show ${quoted(router)}`,
      });
      commands.push({
        purpose: "Which L3 agents hold the router, and which is active",
        command: `${cli} network agent list --router ${quoted(router)} --long`,
      });
    }

    const network: string = label("network_id");

    if (network) {
      commands.push({
        purpose: "How many addresses each of the network's subnets has left",
        command: `${cli} ip availability show ${quoted(network)}`,
      });
      commands.push({
        purpose: "The floating IPs taken from it, and the spare ones to release",
        command: `${cli} floating ip list --network ${quoted(network)} --long`,
      });
    }

    /*
     * `id` and `name` mean something else on every series, so only the labels that
     * are on a volume or a pool's series alone say that is what this one is.
     */
    if (Object.prototype.hasOwnProperty.call(seriesLabels, "volume_type")) {
      const volume: string = label("id");

      if (volume) {
        commands.push({
          purpose: "The volume's status, and what it is attached to",
          command: `${cli} volume show ${quoted(volume)}`,
        });
      }
    }

    if (label("volume_backend_name")) {
      commands.push({
        purpose: "How full each storage pool is, and what its backend reports",
        command: `${cli} volume backend pool list --long`,
      });
      commands.push({
        purpose: "Whether the cinder-volume behind the pool is up",
        command: `${cli} volume service list --service cinder-volume --long`,
      });
    }

    const project: string = label("tenant_id");

    if (project) {
      commands.push({
        purpose: "What the project has used of each quota",
        command: `${cli} limits show --absolute --project ${quoted(project)}`,
      });
      commands.push({
        purpose: "The project's quotas",
        command: `${cli} quota show ${quoted(project)}`,
      });
    }

    const status: string = label("status");

    if (status && status === status.toUpperCase()) {
      commands.push({
        purpose: "The instances in this status, across every project",
        command: `${cli} server list --all-projects --status ${quoted(status)} --long`,
      });
    } else if (status) {
      commands.push({
        purpose: "The volumes in this status, across every project",
        command: `${cli} volume list --all-projects --status ${quoted(status)} --long`,
      });
    }

    if (commands.length > 0) {
      return commands;
    }

    return SeriesDebugHints.openstackServiceCommands({
      cli,
      serviceType: label("openstack_service"),
    });
  }

  // What a whole API, or a count the exporter only keeps per region, is about.
  private static openstackServiceCommands(input: {
    cli: string;
    serviceType: string;
  }): Array<SeriesDebugCommand> {
    const cli: string = input.cli;

    switch (input.serviceType) {
      case "identity":
        return [
          {
            purpose: "Whether Keystone gives this credential a token",
            command: `${cli} token issue`,
          },
        ];
      case "compute":
        return [
          {
            purpose: "Whether Nova's API answers, and the state of its workers",
            command: `${cli} compute service list --long`,
          },
        ];
      case "network":
        return [
          {
            purpose: "Whether Neutron's API answers, and which agents are alive",
            command: `${cli} network agent list --long`,
          },
          {
            purpose: "Each router's status",
            command: `${cli} router list --long`,
          },
          {
            purpose: "Each floating IP's status, and what it is attached to",
            command: `${cli} floating ip list --long`,
          },
        ];
      case "volume":
        return [
          {
            purpose: "Whether Cinder's API answers, and the state of its services",
            command: `${cli} volume service list --long`,
          },
        ];
      case "image":
        return [
          {
            purpose: "Whether Glance's API answers",
            command: `${cli} image list --limit 1`,
          },
        ];
      default:
        /*
         * Placement has no commands of its own without the osc-placement plugin,
         * and any series nothing above recognises still deserves a first command:
         * where this region's APIs are.
         */
        return [
          {
            purpose: "Where this region publishes its APIs",
            command:
              input.serviceType === "placement"
                ? `${cli} endpoint list --service placement`
                : `${cli} endpoint list`,
          },
        ];
    }
  }

  /**
   * govc (the vSphere CLI from the govmomi project) against the vCenter
   * the agent scrapes. Every command below is an `info` / `usage` /
   * `ls` read; govc takes its endpoint and read-only credentials from
   * GOVC_URL / GOVC_USERNAME / GOVC_PASSWORD, so nothing here needs a
   * host argument.
   *
   * Identity comes from the OTel `vcenter` receiver's RESOURCE
   * attributes, which arrive `resource.`-prefixed; findLabelValue checks
   * both spellings. Most specific object first, so the first command an
   * engineer sees is about the thing that breached.
   */
  private static vmwareCommands(
    seriesLabels: JSONObject,
  ): Array<SeriesDebugCommand> {
    const commands: Array<SeriesDebugCommand> = [];

    const vm: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "vcenter.vm.name",
    ]);
    const vmTemplate: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "vcenter.vm_template.name",
    ]);
    const host: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "vcenter.host.name",
    ]);
    const datastore: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "vcenter.datastore.name",
    ]);
    const cluster: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "vcenter.cluster.name",
    ]);
    const datacenter: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "vcenter.datacenter.name",
    ]);
    const resourcePoolPath: string = SeriesLabelDisplay.findLabelValue(
      seriesLabels,
      ["vcenter.resource_pool.inventory_path"],
    );
    const vcenter: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "vmware.vcenter.name",
    ]);

    if (vm) {
      const quoted: string = SeriesDebugHints.quoteForShell(vm);

      commands.push({
        purpose:
          "Power state, host, resource pool, datastores and networks of the VM",
        command: `govc vm.info -r ${quoted}`,
      });
      commands.push({
        purpose:
          "The VM's virtual disks and NICs (for a per-object latency or drop)",
        command: `govc device.info -vm ${quoted}`,
      });
    }

    if (vmTemplate) {
      commands.push({
        purpose: "Datastore placement and size of the VM template",
        command: `govc vm.info -r ${SeriesDebugHints.quoteForShell(
          vmTemplate,
        )}`,
      });
    }

    if (host) {
      const quoted: string = SeriesDebugHints.quoteForShell(host);

      commands.push({
        purpose:
          "Connection state, CPU/memory usage, uptime and VM count of the ESXi host",
        command: `govc host.info ${quoted}`,
      });
      /*
       * esxtop is the host-local view: per-VM %RDY, ballooning, swapping
       * and per-NIC/per-disk counters that vCenter only rolls up. Run over
       * SSH on the host itself; it is interactive and read-only.
       */
      commands.push({
        purpose:
          "Live per-VM CPU ready, memory and disk/network counters on the host (over SSH; c/m/d/n switch views)",
        command: `esxtop`,
      });
    }

    if (datastore) {
      commands.push({
        purpose:
          "Capacity, free space, type and the hosts mounting the datastore",
        command: `govc datastore.info ${SeriesDebugHints.quoteForShell(
          datastore,
        )}`,
      });
    }

    if (cluster) {
      const quotedCluster: string = SeriesDebugHints.quoteForShell(cluster);

      commands.push({
        purpose: "Effective vs. total CPU and memory of the cluster",
        command: `govc cluster.usage ${quotedCluster}`,
      });

      /*
       * The host folder path needs the datacenter; without it govc's
       * default datacenter applies and a multi-DC vCenter would list the
       * wrong cluster, so the listing is only offered when both are known.
       */
      if (datacenter) {
        commands.push({
          purpose:
            "The hosts in the cluster with their connection and power state",
          command: `govc ls -l /${SeriesDebugHints.quoteForShell(
            datacenter,
          )}/host/${quotedCluster}`,
        });
      }
    }

    if (resourcePoolPath) {
      commands.push({
        purpose:
          "Reservation, limit, shares and current usage of the resource pool",
        command: `govc pool.info ${SeriesDebugHints.quoteForShell(
          resourcePoolPath,
        )}`,
      });
    }

    if (datacenter) {
      commands.push({
        purpose: "Host, VM, cluster and datastore counts for the datacenter",
        command: `govc datacenter.info ${SeriesDebugHints.quoteForShell(
          datacenter,
        )}`,
      });
    }

    /*
     * A series that names only the vCenter (an ungrouped monitor whose
     * labels happen to carry the agent's identity attribute) still gets a
     * first command: is the endpoint even answering, and as what?
     */
    if (commands.length === 0 && vcenter) {
      commands.push({
        purpose: "vCenter / ESXi version and whether the SDK endpoint answers",
        command: `govc about`,
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
   * Purity//FA CLI, run over SSH on the FlashArray's management address.
   *
   * Only the labels that exist on FlashArray series alone are addressed:
   * `host`, `component_name` and `local_pod`. `name` is deliberately not —
   * it names a volume, a pod or a directory on a FlashArray and a file
   * system, bucket or blade on a FlashBlade (a different CLI), and the
   * series labels cannot say which.
   */
  private static storageArrayCommands(
    seriesLabels: JSONObject,
  ): Array<SeriesDebugCommand> {
    const commands: Array<SeriesDebugCommand> = [];

    const component: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "component_name",
    ]);

    if (component) {
      commands.push({
        purpose: "Status and details of the hardware component",
        command: `purehw list ${SeriesDebugHints.quoteForShell(component)}`,
      });
    }

    const host: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "host",
    ]);

    if (host) {
      commands.push({
        purpose: "The volumes connected to the host",
        command: `purehost list --connect ${SeriesDebugHints.quoteForShell(
          host,
        )}`,
      });
    }

    const pod: string = SeriesLabelDisplay.findLabelValue(seriesLabels, [
      "local_pod",
    ]);

    if (pod) {
      commands.push({
        purpose: "Status and lag of every pod replica link",
        command: `purepod replica-link list`,
      });
    }

    /*
     * The array's own explanation comes first once there is something to
     * explain: the open alerts usually name the cause outright.
     */
    if (commands.length > 0) {
      commands.unshift({
        purpose: "Alerts open on the FlashArray",
        command: `purealert list --filter "state='open'"`,
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

      case MonitorType.OpenStack:
        return SeriesDebugHints.openstackCommands(seriesLabels);

      case MonitorType.VMware:
        return SeriesDebugHints.vmwareCommands(seriesLabels);

      case MonitorType.Ceph:
        return SeriesDebugHints.cephCommands(seriesLabels);

      case MonitorType.StorageArray:
        return SeriesDebugHints.storageArrayCommands(seriesLabels);

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
   *
   * Each command names values from the telemetry (quoteForShell), and sits
   * on one line of its fenced block: a line break in a value would end the
   * list item and its block, so it becomes a space. mdText places the
   * command as code: the fence is longer than any in it, and a chat mention
   * or Slack link in a value is broken - Slack reads both even inside code.
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

    const lines: Array<MarkdownText> = commands
      .slice(0, Math.max(maxCommands, 1))
      .map((command: SeriesDebugCommand): MarkdownText => {
        // One line, so a label value cannot end the list item or its block.
        const commandLine: string = command.command.replace(
          COMMAND_LINE_BREAK_PATTERN,
          " ",
        );

        return mdText`- ${command.purpose}:\n  \`\`\`\n  ${commandLine}\n  \`\`\``;
      });

    return mdText`**Start here**\n${FeedMarkdown.join(lines, "\n")}`.toString();
  }
}
