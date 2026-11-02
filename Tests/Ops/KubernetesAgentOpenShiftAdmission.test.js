"use strict";

/**
 * OpenShift would admit every pod of the kubernetes-agent chart's OpenShift
 * presets.
 *
 * KinD has no SCCs, and `helm install` on OpenShift succeeds whatever the chart
 * renders: OpenShift refuses a pod later, one at a time, and the pod simply
 * never appears. So nothing but a real cluster would catch a pod that needs
 * more than it may have. This stands in for the SCC admission plugin: it renders
 * the chart with `helm template`, with every option on, takes every pod template
 * out of the render, and holds it to what OpenShift's SCCs say.
 *
 *   - openshift-restricted, for an admin who will not add an SCC: every pod runs
 *     under restricted-v2 and nothing else, and states what restricted-v2 asks
 *     for rather than leaving it to be filled in.
 *   - openshift: each pod is admitted under restricted-v2, or under an SCC of
 *     the chart's that its service account may use.
 *   - standard, to prove the check is not vacuous: it finds the pods the issue
 *     says OpenShift refuses there (#5477).
 *
 * The chart's helm-unittest suites (openshift-*_test.yaml) hold what the presets
 * render, field by field. This holds the whole render: a new workload, or a new
 * option that adds a volume, is checked without anyone remembering to.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHART_DIR = path.join(REPO_ROOT, "HelmChart/Public/kubernetes-agent");

// OpenShift's restricted-v2 SCC, as `oc get scc restricted-v2 -o yaml` prints it.
const RESTRICTED_V2 = {
  name: "restricted-v2",
  allowHostDirVolumePlugin: false,
  allowHostIPC: false,
  allowHostNetwork: false,
  allowHostPID: false,
  allowHostPorts: false,
  allowPrivilegeEscalation: false,
  allowPrivilegedContainer: false,
  allowedCapabilities: ["NET_BIND_SERVICE"],
  requiredDropCapabilities: ["ALL"],
  // MustRunAsRange: only IDs from the namespace's range, which no chart can
  // know, so a pinned ID is refused and an unset one is assigned.
  runAsUser: { type: "MustRunAsRange" },
  fsGroup: { type: "MustRunAs" },
  // MustRunAs: the namespace's level.
  seLinuxContext: { type: "MustRunAs" },
  seccompProfiles: ["runtime/default"],
  volumes: [
    "configMap",
    "csi",
    "downwardAPI",
    "emptyDir",
    "ephemeral",
    "persistentVolumeClaim",
    "projected",
    "secret",
  ],
};

// Every keyed field of a pod's `volumes` entry but its name, which is the
// volume's type: { name, secret: {...} } is a `secret` volume.
function volumeType(volume) {
  return Object.keys(volume).find((key) => {
    return key !== "name";
  });
}

// The containers of a pod, init containers included.
function containersOf(spec) {
  return [...(spec.initContainers || []), ...(spec.containers || [])];
}

// What a pod's seccomp profile comes to for one container: its own, or the pod's.
function seccompOf(spec, container) {
  return (
    ((container.securityContext || {}).seccompProfile || {}).type ||
    ((spec.securityContext || {}).seccompProfile || {}).type
  );
}

/*
 * Whether SELinux options a pod asks for are refused. MustRunAs takes the
 * options the SCC names (the chart's node collector SCC names spc_t) and, when
 * it names none, as restricted-v2 does, the namespace's: no chart can know
 * those, so any other is refused.
 */
function seLinuxRefused(options, scc) {
  if (!options || scc.seLinuxContext.type !== "MustRunAs") {
    return false;
  }

  const named = scc.seLinuxContext.seLinuxOptions || {};

  return Object.keys(options).some((key) => {
    return options[key] !== named[key];
  });
}

/**
 * Why an SCC refuses a pod, as its admission plugin would: an empty list means
 * it admits the pod. Like the plugin, this refuses what a pod asks for and
 * fills in what it leaves unset (a user ID from the namespace's range, dropped
 * capabilities, the runtime's seccomp profile).
 */
function refusals(spec, scc) {
  const found = [];
  const pod = spec.securityContext || {};
  const fixedIds = scc.runAsUser.type === "MustRunAsRange";

  if (spec.hostNetwork && !scc.allowHostNetwork) {
    found.push("hostNetwork");
  }
  if (spec.hostPID && !scc.allowHostPID) {
    found.push("hostPID");
  }
  if (spec.hostIPC && !scc.allowHostIPC) {
    found.push("hostIPC");
  }

  for (const volume of spec.volumes || []) {
    if (!scc.volumes.includes(volumeType(volume))) {
      found.push(`volume ${volume.name}: ${volumeType(volume)}`);
    }
  }

  if (fixedIds) {
    for (const field of ["runAsUser", "runAsGroup"]) {
      if (pod[field] !== undefined) {
        found.push(`pod ${field}: ${pod[field]}`);
      }
    }
  }
  if (scc.fsGroup.type === "MustRunAs" && pod.fsGroup !== undefined) {
    found.push(`pod fsGroup: ${pod.fsGroup}`);
  }
  if (seLinuxRefused(pod.seLinuxOptions, scc)) {
    found.push(`pod seLinuxOptions: ${pod.seLinuxOptions.type}`);
  }

  for (const container of containersOf(spec)) {
    const name = container.name;
    const context = container.securityContext || {};
    const added = (context.capabilities || {}).add || [];
    const seccomp = seccompOf(spec, container);

    if (context.privileged && !scc.allowPrivilegedContainer) {
      found.push(`${name}: privileged`);
    }
    if (context.allowPrivilegeEscalation && !scc.allowPrivilegeEscalation) {
      found.push(`${name}: allowPrivilegeEscalation`);
    }
    if (fixedIds) {
      for (const field of ["runAsUser", "runAsGroup"]) {
        if (context[field] !== undefined) {
          found.push(`${name}: ${field}: ${context[field]}`);
        }
      }
    }
    if (seLinuxRefused(context.seLinuxOptions, scc)) {
      found.push(`${name}: seLinuxOptions: ${context.seLinuxOptions.type}`);
    }
    for (const capability of added) {
      if (!scc.allowedCapabilities.includes(capability)) {
        found.push(`${name}: adds capability ${capability}`);
      }
    }
    if (
      seccomp &&
      seccomp !== "RuntimeDefault" &&
      !scc.seccompProfiles.includes("*")
    ) {
      found.push(`${name}: seccomp ${seccomp}`);
    }
    for (const port of container.ports || []) {
      if (port.hostPort && !scc.allowHostPorts) {
        found.push(`${name}: hostPort ${port.hostPort}`);
      }
    }
  }

  return found;
}

/**
 * What a pod leaves for restricted-v2 to fill in. An empty list means it states
 * all of it: it needs no mutation to be admitted, and the restricted Pod
 * Security Standard takes it as written.
 */
function leftUnstated(spec) {
  const found = [];
  const pod = spec.securityContext || {};

  for (const container of containersOf(spec)) {
    const name = container.name;
    const context = container.securityContext || {};

    if (context.runAsNonRoot !== true && pod.runAsNonRoot !== true) {
      found.push(`${name}: runAsNonRoot`);
    }
    if (context.allowPrivilegeEscalation !== false) {
      found.push(`${name}: allowPrivilegeEscalation: false`);
    }
    if (!((context.capabilities || {}).drop || []).includes("ALL")) {
      found.push(`${name}: capabilities drop ALL`);
    }
    if (seccompOf(spec, container) !== "RuntimeDefault") {
      found.push(`${name}: seccomp RuntimeDefault`);
    }
  }

  return found;
}

// Every option that adds a pod, a volume or a container.
const EVERY_OPTION = {
  clusterName: "prod-us",
  oneuptime: {
    url: "https://oneuptime.example.com",
    apiKey: "key-123",
    labels: { team: "platform" },
  },
  debug: { enabled: true },
  logs: { enabled: true, windowsPods: { enabled: true } },
  kubeStateMetrics: { enabled: true },
  cost: {
    enabled: true,
    agent: { enabled: true },
    metrics: { enabled: true },
    prometheus: { persistence: { enabled: true } },
    opencost: { customPricing: { enabled: true } },
  },
  ebpf: { enabled: true },
  profiling: { enabled: true },
  hostMetrics: { enabled: true },
  auditLogs: { enabled: true },
  csi: { enabled: true },
  coreDns: { enabled: true },
  serviceMesh: { enabled: true, provider: "istio" },
  controlPlane: {
    enabled: true,
    etcd: { clientCertSecret: "etcd-client-cert" },
  },
};

const WORKLOAD_KINDS = [
  "Deployment",
  "DaemonSet",
  "StatefulSet",
  "ReplicaSet",
  "Job",
];

const HELM_PROBE = spawnSync("helm", ["version", "--short"], {
  encoding: "utf8",
});
const HELM_MISSING = Boolean(HELM_PROBE.error) || HELM_PROBE.status !== 0;

if (HELM_MISSING && !process.env.CI) {
  // eslint-disable-next-line no-console
  console.warn(
    "OpenShift admission check skipped: helm is not on PATH (CI has it, see .github/workflows/test.ops.yaml).",
  );
}

const testWithHelm = HELM_MISSING && !process.env.CI ? test.skip : test;

function render(preset, overrides = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-admission-"));
  const values = path.join(dir, "values.json");

  try {
    fs.writeFileSync(values, JSON.stringify(EVERY_OPTION));

    const result = spawnSync(
      "helm",
      [
        "template",
        "agent",
        CHART_DIR,
        "--namespace",
        "oneuptime",
        "--values",
        values,
        "--set",
        `preset=${preset}`,
        ...overrides.flatMap((override) => {
          return ["--set", override];
        }),
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

    // Helm's stderr only on a failure: it also warns there, of a kubeconfig's mode.
    expect({
      preset,
      overrides,
      status: result.status,
      error: result.status === 0 ? "" : result.stderr,
    }).toEqual({ preset, overrides, status: 0, error: "" });

    return yaml.loadAll(result.stdout).filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// { "<Kind>/<name>": pod spec } of every workload in a render.
function podsOf(documents) {
  const pods = {};

  for (const document of documents) {
    if (WORKLOAD_KINDS.includes(document.kind)) {
      pods[`${document.kind}/${document.metadata.name}`] =
        document.spec.template.spec;
    }
    if (document.kind === "CronJob") {
      pods[`CronJob/${document.metadata.name}`] =
        document.spec.jobTemplate.spec.template.spec;
    }
    if (document.kind === "Pod") {
      pods[`Pod/${document.metadata.name}`] = document.spec;
    }
  }

  return pods;
}

// The SCCs the chart created, each with the service accounts that may use it.
function chartSccs(documents) {
  const roles = documents.filter((document) => {
    return document.kind === "Role";
  });
  const bindings = documents.filter((document) => {
    return document.kind === "RoleBinding";
  });

  return documents
    .filter((document) => {
      return document.kind === "SecurityContextConstraints";
    })
    .map((scc) => {
      const roleNames = roles
        .filter((role) => {
          return (role.rules || []).some((rule) => {
            return (
              (rule.resources || []).includes("securitycontextconstraints") &&
              (rule.verbs || []).includes("use") &&
              (rule.resourceNames || []).includes(scc.metadata.name)
            );
          });
        })
        .map((role) => {
          return role.metadata.name;
        });

      return {
        ...scc,
        name: scc.metadata.name,
        volumes: scc.volumes,
        serviceAccounts: bindings
          .filter((binding) => {
            return roleNames.includes(binding.roleRef.name);
          })
          .flatMap((binding) => {
            return binding.subjects.map((subject) => {
              return subject.name;
            });
          }),
        allowedCapabilities: scc.allowedCapabilities || [],
      };
    });
}

const RESTRICTED_RENDERS = [
  ["every option on", []],
  ["Linkerd instead of Istio", ["serviceMesh.provider=linkerd"]],
  // An explicit log mode wins over the preset, but brings no hostPath back.
  ["logs.mode=daemonset", ["logs.mode=daemonset"]],
  ["logs off", ["logs.enabled=false"]],
  [
    "a service account of your own",
    ["serviceAccount.create=false", "serviceAccount.name=my-agent"],
  ],
  ["write access for the AI agent", ["aiAgent.fixes=automatic"]],
];

describe("on the openshift-restricted preset", () => {
  describe.each(RESTRICTED_RENDERS)("with %s", (_name, overrides) => {
    testWithHelm(
      "restricted-v2 admits every pod, as the chart writes it",
      () => {
        const pods = podsOf(render("openshift-restricted", overrides));

        expect(Object.keys(pods).length).toBeGreaterThan(0);

        for (const [workload, spec] of Object.entries(pods)) {
          expect({ workload, refused: refusals(spec, RESTRICTED_V2) }).toEqual({
            workload,
            refused: [],
          });
        }
      },
    );

    testWithHelm("every pod states what restricted-v2 asks for", () => {
      const pods = podsOf(render("openshift-restricted", overrides));

      for (const [workload, spec] of Object.entries(pods)) {
        expect({ workload, unstated: leftUnstated(spec) }).toEqual({
          workload,
          unstated: [],
        });
      }
    });

    testWithHelm("no pod pins a user or group ID", () => {
      const rendered = yaml.dump(
        podsOf(render("openshift-restricted", overrides)),
      );

      expect(rendered).not.toMatch(/\b(runAsUser|runAsGroup|fsGroup):/);
    });

    testWithHelm("the chart creates no SCC, and asks for none", () => {
      const documents = render("openshift-restricted", overrides);

      expect(
        documents
          .filter((document) => {
            return document.kind === "SecurityContextConstraints";
          })
          .map((document) => {
            return document.metadata.name;
          }),
      ).toEqual([]);
      expect(yaml.dump(documents)).not.toContain("securitycontextconstraints");
    });
  });

  testWithHelm("it renders the workloads it should, and no more", () => {
    expect(Object.keys(podsOf(render("openshift-restricted"))).sort()).toEqual([
      "DaemonSet/agent-kubernetes-agent-logs",
      "Deployment/agent-kubernetes-agent",
      "Deployment/agent-kubernetes-agent-ai-agent",
      "Deployment/agent-kubernetes-agent-cost",
      "Deployment/agent-kubernetes-agent-cost-prometheus",
      "Deployment/agent-kubernetes-agent-kube-state-metrics",
      "Deployment/agent-kubernetes-agent-logs",
      "Deployment/agent-kubernetes-agent-opencost",
    ]);
  });

  testWithHelm(
    "a debug sidecar you give capabilities is refused, as you asked",
    () => {
      /*
       * values.yaml tells you how to grant the sidecar raw sockets. restricted-v2
       * refuses that, and the chart does not drop what you set.
       */
      const pods = podsOf(
        render("openshift-restricted", [
          "debug.securityContext.capabilities.add={NET_RAW}",
        ]),
      );

      expect(
        refusals(pods["Deployment/agent-kubernetes-agent"], RESTRICTED_V2),
      ).toEqual(["debug: adds capability NET_RAW"]);
    },
  );
});

describe("on the openshift preset", () => {
  testWithHelm(
    "every pod is admitted under restricted-v2 or an SCC its service account may use",
    () => {
      const documents = render("openshift");
      const sccs = chartSccs(documents);

      expect(
        sccs
          .map((scc) => {
            return `${scc.name}: ${scc.serviceAccounts.join(",")}`;
          })
          .sort(),
      ).toEqual([
        "agent-kubernetes-agent-ebpf: agent-kubernetes-agent-ebpf",
        "agent-kubernetes-agent-node-collector: agent-kubernetes-agent-node-collector",
      ]);

      for (const [workload, spec] of Object.entries(podsOf(documents))) {
        const candidates = [
          RESTRICTED_V2,
          ...sccs.filter((scc) => {
            return scc.serviceAccounts.includes(spec.serviceAccountName);
          }),
        ];
        const admittedBy = candidates.filter((scc) => {
          return refusals(spec, scc).length === 0;
        });

        expect({ workload, admitted: admittedBy.length > 0 }).toEqual({
          workload,
          admitted: true,
        });
      }
    },
  );

  testWithHelm("only the node pods need an SCC of the chart's", () => {
    const needMore = Object.entries(podsOf(render("openshift")))
      .filter(([, spec]) => {
        return refusals(spec, RESTRICTED_V2).length > 0;
      })
      .map(([workload]) => {
        return workload;
      })
      .sort();

    expect(needMore).toEqual([
      "DaemonSet/agent-kubernetes-agent-ebpf",
      "DaemonSet/agent-kubernetes-agent-logs",
      "DaemonSet/agent-kubernetes-agent-profiling",
    ]);
  });
});

/*
 * Docker runs the real collector, so that step only proves itself in CI. What
 * it renders is held here, where it runs everywhere: a render dropped from the
 * script would otherwise go unnoticed.
 */
describe("validate-collector-configs.sh runs the real collector over them", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "validate-collector-configs.sh"),
    "utf8",
  );

  test.each([
    ["openshift", ["--set preset=openshift"]],
    ["openshift-restricted", ["--set preset=openshift-restricted"]],
    [
      "openshift-control-plane",
      [
        "--set preset=openshift",
        "--set controlPlane.enabled=true",
        "--set controlPlane.etcd.clientCertSecret=etcd-client-cert",
        "--set controlPlane.scheduler.insecureSkipVerify=false",
        "--set controlPlane.controllerManager.insecureSkipVerify=false",
      ],
    ],
  ])("the %s render", (name, flags) => {
    const start = script.indexOf(`validate_openshift_render ${name} "`);

    expect(start).toBeGreaterThan(-1);

    const call = script.slice(start, script.indexOf("\n\n", start));

    for (const flag of flags) {
      expect(call).toContain(flag);
    }
  });

  test("both collectors of every render", () => {
    const body = script.slice(
      script.indexOf("validate_openshift_render() {"),
      script.indexOf("\n}\n\nvalidate_openshift_render "),
    );

    expect(body).toContain('"${WORK_DIR}/k8s-deployment-${name}.yaml"');
    expect(body).toContain('"${WORK_DIR}/k8s-daemonset-${name}.yaml"');
  });

  test("with the files those jobs name, which the receiver looks for when it loads them", () => {
    expect(script).toContain('"${SERVICE_ACCOUNT_DIR}/service-ca.crt":ro');
    expect(script).toContain(":/etc/oneuptime/etcd-client-cert:ro");
  });
});

describe("the check itself", () => {
  testWithHelm(
    "finds the pods OpenShift refuses on the standard preset",
    () => {
      // The issue's table, with logs.mode=api for the log tailer's Deployment.
      const pods = podsOf(render("standard", ["logs.mode=api"]));
      const refused = Object.entries(pods)
        .filter(([, spec]) => {
          return refusals(spec, RESTRICTED_V2).length > 0;
        })
        .map(([workload]) => {
          return workload;
        })
        .sort();

      expect(refused).toEqual([
        "DaemonSet/agent-kubernetes-agent-ebpf",
        "DaemonSet/agent-kubernetes-agent-logs",
        "DaemonSet/agent-kubernetes-agent-profiling",
        "Deployment/agent-kubernetes-agent-ai-agent",
        "Deployment/agent-kubernetes-agent-cost",
        "Deployment/agent-kubernetes-agent-cost-prometheus",
        "Deployment/agent-kubernetes-agent-kube-state-metrics",
        "Deployment/agent-kubernetes-agent-logs",
      ]);
    },
  );

  test("takes the SELinux options an SCC names, and refuses others", () => {
    const named = {
      ...RESTRICTED_V2,
      seLinuxContext: {
        type: "MustRunAs",
        seLinuxOptions: { type: "spc_t", level: "s0" },
      },
    };
    const asked = { securityContext: { seLinuxOptions: { type: "spc_t" } } };
    const other = { securityContext: { seLinuxOptions: { type: "other_t" } } };

    expect(refusals(asked, named)).toEqual([]);
    expect(refusals(other, named)).toEqual(["pod seLinuxOptions: other_t"]);
  });

  test.each([
    [
      "a hostPath volume",
      { volumes: [{ name: "x", hostPath: { path: "/" } }] },
      "volume x: hostPath",
    ],
    ["the host network", { hostNetwork: true }, "hostNetwork"],
    ["the host PID namespace", { hostPID: true }, "hostPID"],
    ["the host IPC namespace", { hostIPC: true }, "hostIPC"],
    [
      "a pinned user ID",
      { securityContext: { runAsUser: 1000 } },
      "pod runAsUser: 1000",
    ],
    [
      "a pinned group ID",
      { securityContext: { runAsGroup: 1000 } },
      "pod runAsGroup: 1000",
    ],
    [
      "a pinned fsGroup",
      { securityContext: { fsGroup: 65534 } },
      "pod fsGroup: 65534",
    ],
    [
      "SELinux options of its own",
      { securityContext: { seLinuxOptions: { type: "spc_t" } } },
      "pod seLinuxOptions: spc_t",
    ],
    [
      "a privileged container",
      { containers: [{ name: "c", securityContext: { privileged: true } }] },
      "c: privileged",
    ],
    [
      "privilege escalation",
      {
        containers: [
          { name: "c", securityContext: { allowPrivilegeEscalation: true } },
        ],
      },
      "c: allowPrivilegeEscalation",
    ],
    [
      "a container's pinned user ID",
      { containers: [{ name: "c", securityContext: { runAsUser: 0 } }] },
      "c: runAsUser: 0",
    ],
    [
      "an added capability",
      {
        containers: [
          {
            name: "c",
            securityContext: { capabilities: { add: ["SYS_ADMIN"] } },
          },
        ],
      },
      "c: adds capability SYS_ADMIN",
    ],
    [
      "another seccomp profile",
      {
        securityContext: { seccompProfile: { type: "Unconfined" } },
        containers: [{ name: "c" }],
      },
      "c: seccomp Unconfined",
    ],
    [
      "a host port",
      {
        containers: [
          { name: "c", ports: [{ containerPort: 80, hostPort: 80 }] },
        ],
      },
      "c: hostPort 80",
    ],
  ])("refuses %s", (_name, spec, reason) => {
    expect(refusals(spec, RESTRICTED_V2)).toEqual([reason]);
  });

  test("lets a pod add the one capability restricted-v2 allows", () => {
    expect(
      refusals(
        {
          containers: [
            {
              name: "c",
              securityContext: { capabilities: { add: ["NET_BIND_SERVICE"] } },
            },
          ],
        },
        RESTRICTED_V2,
      ),
    ).toEqual([]);
  });

  test("admits a bare pod, whose fields restricted-v2 fills in, and says what it left unstated", () => {
    const spec = {
      containers: [{ name: "c", image: "example" }],
      volumes: [{ name: "config", configMap: { name: "config" } }],
    };

    expect(refusals(spec, RESTRICTED_V2)).toEqual([]);
    expect(leftUnstated(spec)).toEqual([
      "c: runAsNonRoot",
      "c: allowPrivilegeEscalation: false",
      "c: capabilities drop ALL",
      "c: seccomp RuntimeDefault",
    ]);
  });
});
