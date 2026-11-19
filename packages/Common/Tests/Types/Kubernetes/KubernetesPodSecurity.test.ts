import { JSONObject } from "../../../Types/JSON";
import {
  ExtractedInventoryRecord,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  KubernetesPodObject,
  parsePodObject,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import {
  POD_SECURITY_BLOCK_VERSION,
  PodSecurity,
  PodSecurityContainer,
  readPodSecurity,
  toPodSecurity,
} from "../../../Types/Kubernetes/KubernetesPodSecurity";
import { describe, expect, test } from "@jest/globals";

/*
 * The block a pod's stored spec keeps about its own security (#9627): what
 * the Pod Security Standards and the CIS Kubernetes Benchmark's pod controls
 * read, from specs as the agent pulls them.
 */

// kube-proxy, as kubeadm deploys it: privileged, on the host's network.
const KUBE_PROXY_SPEC: JSONObject = {
  containers: [
    {
      name: "kube-proxy",
      image: "registry.k8s.io/kube-proxy:v1.31.2",
      command: [
        "/usr/local/bin/kube-proxy",
        "--config=/var/lib/kube-proxy/config.conf",
      ],
      securityContext: { privileged: true },
      volumeMounts: [
        { name: "kube-proxy", mountPath: "/var/lib/kube-proxy" },
        { name: "xtables-lock", mountPath: "/run/xtables.lock" },
      ],
    },
  ],
  hostNetwork: true,
  priorityClassName: "system-node-critical",
  serviceAccountName: "kube-proxy",
  volumes: [
    { name: "kube-proxy", configMap: { name: "kube-proxy" } },
    {
      name: "xtables-lock",
      hostPath: { path: "/run/xtables.lock", type: "FileOrCreate" },
    },
    { name: "lib-modules", hostPath: { path: "/lib/modules", type: "" } },
    {
      name: "kube-api-access-7xk2p",
      projected: {
        sources: [
          { serviceAccountToken: { expirationSeconds: 3607, path: "token" } },
        ],
      },
    },
  ],
};

// A Cilium agent: added capabilities, an SELinux type, an init container.
const CILIUM_SPEC: JSONObject = {
  hostNetwork: true,
  automountServiceAccountToken: true,
  containers: [
    {
      name: "cilium-agent",
      image: "quay.io/cilium/cilium:v1.16.3",
      ports: [
        { containerPort: 9962, hostPort: 9962, name: "prometheus" },
        { containerPort: 4244, hostPort: 0, name: "hubble" },
      ],
      securityContext: {
        seLinuxOptions: { level: "s0", type: "spc_t" },
        capabilities: {
          add: ["CHOWN", "KILL", "NET_ADMIN", "NET_RAW", "SYS_ADMIN"],
          drop: ["ALL"],
        },
      },
      livenessProbe: {
        httpGet: { host: "127.0.0.1", path: "/healthz", port: 9879 },
      },
      readinessProbe: {
        httpGet: { host: "127.0.0.1", path: "/healthz", port: 9879 },
      },
    },
  ],
  initContainers: [
    {
      name: "mount-cgroup",
      image: "quay.io/cilium/cilium:v1.16.3",
      securityContext: { privileged: true },
    },
  ],
  volumes: [{ name: "cilium-run", hostPath: { path: "/var/run/cilium" } }],
};

// An application hardened to the Restricted standard.
const HARDENED_API_SPEC: JSONObject = {
  securityContext: {
    runAsNonRoot: true,
    runAsUser: 10001,
    seccompProfile: { type: "RuntimeDefault" },
  },
  automountServiceAccountToken: false,
  containers: [
    {
      name: "api",
      image: "ghcr.io/acme/api:2.4.1",
      ports: [{ containerPort: 8080, name: "http", protocol: "TCP" }],
      env: [
        { name: "PORT", value: "8080" },
        {
          name: "DB_PASSWORD",
          valueFrom: { secretKeyRef: { name: "api-db", key: "password" } },
        },
        {
          name: "POD_IP",
          valueFrom: { fieldRef: { fieldPath: "status.podIP" } },
        },
      ],
      envFrom: [
        { secretRef: { name: "api-env" } },
        { configMapRef: { name: "api-config" } },
      ],
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
        readOnlyRootFilesystem: true,
      },
      livenessProbe: { httpGet: { path: "/healthz", port: 8080 } },
    },
  ],
  volumes: [{ name: "tmp", emptyDir: {} }],
};

function containerNamed(
  security: PodSecurity,
  name: string,
): PodSecurityContainer {
  const container: PodSecurityContainer | undefined = security.containers.find(
    (each: PodSecurityContainer): boolean => {
      return each.name === name;
    },
  );

  if (!container) {
    throw new Error(`No container ${name}`);
  }

  return container;
}

describe("readPodSecurity", () => {
  test("keeps kube-proxy's privileged container, its host network and its hostPath volumes", () => {
    const security: PodSecurity = readPodSecurity(KUBE_PROXY_SPEC);

    expect(security.version).toBe(POD_SECURITY_BLOCK_VERSION);
    expect(security.hostNetwork).toBe(true);
    expect(security.hostPID).toBeUndefined();
    expect(containerNamed(security, "kube-proxy")).toEqual({
      name: "kube-proxy",
      list: "containers",
      privileged: true,
    });
    expect(security.volumes).toEqual([
      { name: "kube-proxy", type: "configMap" },
      {
        name: "xtables-lock",
        type: "hostPath",
        hostPath: "/run/xtables.lock",
      },
      { name: "lib-modules", type: "hostPath", hostPath: "/lib/modules" },
      { name: "kube-api-access-7xk2p", type: "projected" },
    ]);
  });

  test("keeps added capabilities, SELinux options, host ports and probe hosts, and every list's containers", () => {
    const security: PodSecurity = readPodSecurity(CILIUM_SPEC);
    const agent: PodSecurityContainer = containerNamed(
      security,
      "cilium-agent",
    );

    expect(agent.capabilitiesAdd).toEqual([
      "CHOWN",
      "KILL",
      "NET_ADMIN",
      "NET_RAW",
      "SYS_ADMIN",
    ]);
    expect(agent.capabilitiesDrop).toEqual(["ALL"]);
    expect(agent.seLinuxType).toBe("spc_t");
    expect(agent.seLinuxUser).toBeUndefined();
    // hostPort 0 is no host port.
    expect(agent.hostPorts).toEqual([9962]);
    expect(agent.probeHosts).toEqual([
      { field: "livenessProbe.httpGet.host", host: "127.0.0.1" },
      { field: "readinessProbe.httpGet.host", host: "127.0.0.1" },
    ]);
    expect(containerNamed(security, "mount-cgroup")).toEqual({
      name: "mount-cgroup",
      list: "initContainers",
      privileged: true,
    });
    expect(security.automountServiceAccountToken).toBe(true);
  });

  test("keeps the pod's own security context and every container's", () => {
    const security: PodSecurity = readPodSecurity(HARDENED_API_SPEC);
    const api: PodSecurityContainer = containerNamed(security, "api");

    expect(security.runAsNonRoot).toBe(true);
    expect(security.runAsUser).toBe(10001);
    expect(security.seccompProfileType).toBe("RuntimeDefault");
    expect(security.automountServiceAccountToken).toBe(false);
    expect(api.allowPrivilegeEscalation).toBe(false);
    expect(api.capabilitiesDrop).toEqual(["ALL"]);
    expect(api.readOnlyRootFilesystem).toBe(true);
    // A probe on the pod's own address names no host.
    expect(api.probeHosts).toBeUndefined();
    expect(api.hostPorts).toBeUndefined();
  });

  test("keeps the secrets a container reads into its environment, and no value", () => {
    const security: PodSecurity = readPodSecurity(HARDENED_API_SPEC);
    const api: PodSecurityContainer = containerNamed(security, "api");

    expect(api.secretEnv).toEqual([
      { variable: "DB_PASSWORD", secret: "api-db" },
    ]);
    expect(api.secretEnvFrom).toEqual(["api-env"]);
    // A plain value, a field reference and a ConfigMap are not secrets.
    expect(JSON.stringify(security)).not.toContain('8080"');
    expect(JSON.stringify(security)).not.toContain("api-config");
    expect(JSON.stringify(security)).not.toContain("status.podIP");
  });

  test("keeps an ephemeral container, a Windows pod's HostProcess and a pod's own user namespace", () => {
    const security: PodSecurity = readPodSecurity({
      os: { name: "windows" },
      hostUsers: false,
      securityContext: {
        windowsOptions: {
          hostProcess: true,
          runAsUserName: "NT AUTHORITY\\SYSTEM",
        },
      },
      containers: [{ name: "agent", image: "mcr.microsoft.com/agent:1" }],
      ephemeralContainers: [
        {
          name: "debugger-x7k",
          image: "busybox",
          securityContext: { windowsOptions: { hostProcess: true } },
        },
      ],
    });

    expect(security.osName).toBe("windows");
    expect(security.hostUsers).toBe(false);
    expect(security.windowsHostProcess).toBe(true);
    expect(containerNamed(security, "debugger-x7k")).toEqual({
      name: "debugger-x7k",
      list: "ephemeralContainers",
      windowsHostProcess: true,
    });
  });

  test("keeps sysctls by name, /proc mounts, AppArmor fields and annotations", () => {
    const security: PodSecurity = readPodSecurity(
      {
        securityContext: {
          sysctls: [
            { name: "net.ipv4.tcp_keepalive_time", value: "600" },
            { name: "kernel.msgmax", value: "65536" },
          ],
          appArmorProfile: { type: "Unconfined" },
        },
        containers: [
          {
            name: "app",
            securityContext: {
              procMount: "Unmasked",
              appArmorProfile: { type: "Localhost", localhostProfile: "k8s" },
            },
          },
        ],
      },
      {
        "container.apparmor.security.beta.kubernetes.io/app": "unconfined",
        "kubectl.kubernetes.io/restartedAt": "2026-11-01T10:00:00Z",
      },
    );

    expect(security.sysctls).toEqual([
      "net.ipv4.tcp_keepalive_time",
      "kernel.msgmax",
    ]);
    expect(security.appArmorProfileType).toBe("Unconfined");
    expect(containerNamed(security, "app").procMount).toBe("Unmasked");
    expect(containerNamed(security, "app").appArmorProfileType).toBe(
      "Localhost",
    );
    expect(security.appArmorAnnotations).toEqual({ app: "unconfined" });
  });

  test("leaves out what a pod does not set, so a plain pod's block is small", () => {
    const security: PodSecurity = readPodSecurity({
      containers: [{ name: "web", image: "nginx:1.27" }],
    });

    expect(security).toEqual({
      version: POD_SECURITY_BLOCK_VERSION,
      containers: [{ name: "web", list: "containers" }],
      volumes: [],
    });
  });

  test("reads booleans and numbers sent as text, and ignores what is not one", () => {
    const security: PodSecurity = readPodSecurity({
      hostPID: "true",
      securityContext: { runAsUser: "0", runAsNonRoot: "yes" },
      containers: [
        { name: "c", securityContext: { privileged: "false" } },
        { image: "no-name" },
      ],
    });

    expect(security.hostPID).toBe(true);
    expect(security.runAsUser).toBe(0);
    expect(security.runAsNonRoot).toBeUndefined();
    expect(security.containers).toEqual([
      { name: "c", list: "containers", privileged: false },
    ]);
  });

  test("reads nothing from what is not a spec", () => {
    for (const value of [null, undefined, "spec", 42, []]) {
      expect(readPodSecurity(value)).toEqual({
        version: POD_SECURITY_BLOCK_VERSION,
        containers: [],
        volumes: [],
      });
    }
  });
});

describe("toPodSecurity", () => {
  test("reads a stored block back as it was written", () => {
    for (const spec of [KUBE_PROXY_SPEC, CILIUM_SPEC, HARDENED_API_SPEC]) {
      const written: PodSecurity = readPodSecurity(spec);
      const stored: unknown = JSON.parse(JSON.stringify(written));

      expect(toPodSecurity(stored)).toEqual(written);
    }
  });

  test("is null for a pod stored before the block, or one of another version", () => {
    expect(toPodSecurity(undefined)).toBeNull();
    expect(toPodSecurity(null)).toBeNull();
    expect(toPodSecurity({ containers: [], volumes: [] })).toBeNull();
    expect(
      toPodSecurity({ version: 99, containers: [], volumes: [] }),
    ).toBeNull();
    expect(
      toPodSecurity({ version: POD_SECURITY_BLOCK_VERSION, containers: {} }),
    ).toBeNull();
  });

  test("drops a container or a volume that is not the shape it should be", () => {
    expect(
      toPodSecurity({
        version: POD_SECURITY_BLOCK_VERSION,
        privileged: true,
        containers: [
          { name: "ok", list: "initContainers", privileged: "true" },
          { name: "bad-list", list: "sidecars" },
          { list: "containers" },
          "text",
        ],
        volumes: [{ name: "v", type: "hostPath", hostPath: "/" }, { name: 1 }],
      }),
    ).toEqual({
      version: POD_SECURITY_BLOCK_VERSION,
      containers: [{ name: "ok", list: "initContainers", privileged: true }],
      volumes: [{ name: "v", type: "hostPath", hostPath: "/" }],
    });
  });
});

/*
 * --- The OTLP encoding the agent sends a pod in, as the parser tests build it.
 */

function kv(entries: Array<[string, JSONObject]>): JSONObject {
  return {
    values: entries.map(([key, value]: [string, JSONObject]) => {
      return { key, value };
    }),
  };
}

function str(value: string): JSONObject {
  return { stringValue: value };
}

function bool(value: boolean): JSONObject {
  return { boolValue: value };
}

function int(value: number): JSONObject {
  // The OTLP JSON encoding writes a 64-bit integer as text.
  return { intValue: String(value) };
}

function obj(kvList: JSONObject): JSONObject {
  return { kvlistValue: kvList };
}

function arr(items: Array<JSONObject>): JSONObject {
  return { arrayValue: { values: items } };
}

const PRIVILEGED_POD_BODY: JSONObject = kv([
  ["kind", str("Pod")],
  [
    "metadata",
    obj(
      kv([
        ["name", str("node-exporter-9fz2k")],
        ["namespace", str("monitoring")],
        ["uid", str("7a4e-11")],
      ]),
    ),
  ],
  [
    "spec",
    obj(
      kv([
        ["hostPID", bool(true)],
        ["hostNetwork", bool(true)],
        ["securityContext", obj(kv([["runAsUser", int(0)]]))],
        [
          "containers",
          arr([
            obj(
              kv([
                ["name", str("node-exporter")],
                ["image", str("quay.io/prometheus/node-exporter:v1.8.2")],
                [
                  "ports",
                  arr([
                    obj(
                      kv([
                        ["containerPort", int(9100)],
                        ["hostPort", int(9100)],
                      ]),
                    ),
                  ]),
                ],
                [
                  "securityContext",
                  obj(
                    kv([
                      ["readOnlyRootFilesystem", bool(true)],
                      [
                        "capabilities",
                        obj(kv([["add", arr([str("SYS_TIME")])]])),
                      ],
                    ]),
                  ),
                ],
              ]),
            ),
          ]),
        ],
        [
          "volumes",
          arr([
            obj(
              kv([
                ["name", str("root")],
                ["hostPath", obj(kv([["path", str("/")]]))],
              ]),
            ),
          ]),
        ],
      ]),
    ),
  ],
]);

describe("a pod as the agent sends it", () => {
  test("parsePodObject keeps the block on the pod's spec, from the OTLP encoding", () => {
    const pod: KubernetesPodObject | null = parsePodObject(PRIVILEGED_POD_BODY);

    expect(pod?.spec.security).toEqual({
      version: POD_SECURITY_BLOCK_VERSION,
      hostNetwork: true,
      hostPID: true,
      runAsUser: 0,
      containers: [
        {
          name: "node-exporter",
          list: "containers",
          capabilitiesAdd: ["SYS_TIME"],
          readOnlyRootFilesystem: true,
          hostPorts: [9100],
        },
      ],
      volumes: [{ name: "root", type: "hostPath", hostPath: "/" }],
    });
    // What the pages read stays as it was.
    expect(pod?.spec.containers[0]?.name).toBe("node-exporter");
    expect(pod?.spec.volumes).toEqual([
      { name: "root", type: "hostPath", source: "/" },
    ]);
  });

  test("the inventory row keeps the block, so the Compliance page can read it", () => {
    const record: ExtractedInventoryRecord | null = extractInventoryResource({
      resourceType: "pods",
      logBody: JSON.stringify({ kvlistValue: PRIVILEGED_POD_BODY }),
      lastSeenAt: new Date("2026-11-19T10:00:00.000Z"),
    });
    const spec: JSONObject = (record?.resource.spec || {}) as JSONObject;

    expect(toPodSecurity(spec["security"])?.hostPID).toBe(true);
    expect(toPodSecurity(spec["security"])?.containers).toHaveLength(1);
  });

  test("a pod sent with no spec gets no block: it is not evaluated, rather than read as setting nothing", () => {
    const pod: KubernetesPodObject | null = parsePodObject(
      kv([["metadata", obj(kv([["name", str("bare")]]))]]),
    );

    expect(pod?.spec.security).toBeUndefined();
    expect(JSON.parse(JSON.stringify(pod?.spec))).not.toHaveProperty(
      "security",
    );
  });
});
