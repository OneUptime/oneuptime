import { JSONObject } from "../../../../Types/JSON";
import { readPodSecurity } from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import { KubernetesComplianceDetail } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { KubernetesVersion } from "../../../../Types/Kubernetes/Compliance/KubernetesVersion";
import {
  BASELINE_CONTROLS,
  PodSecurityControl,
  PodSecurityLevel,
  PodSecurityViolation,
  RESTRICTED_ONLY_CONTROLS,
  checkPodSecurityControl,
  evaluatePodSecurity,
  getPodSecurityControls,
  isSafeSysctl,
  meetsPodSecurityLevel,
} from "../../../../Types/Kubernetes/Compliance/PodSecurityStandards";
import { describe, expect, test } from "@jest/globals";

/*
 * Every Pod Security Standards control (#9627), against pods as the agent
 * reports them: one that meets it, one that fails it and how, and each
 * exemption the standard makes - the Kubernetes version a control or a value
 * arrived in, Windows pods, and pods in their own user namespace - or, for a
 * control the standard makes none for, that the others' do not reach it.
 */

const V1_31: KubernetesVersion = { major: 1, minor: 31 };
const V1_33: KubernetesVersion = { major: 1, minor: 33 };
const V1_34: KubernetesVersion = { major: 1, minor: 34 };
const V1_35: KubernetesVersion = { major: 1, minor: 35 };
const V1_36: KubernetesVersion = { major: 1, minor: 36 };
const V1_37: KubernetesVersion = { major: 1, minor: 37 };

const BASELINE: PodSecurityLevel = PodSecurityLevel.Baseline;
const RESTRICTED: PodSecurityLevel = PodSecurityLevel.Restricted;

// What a pod with this spec (and these annotations) fails a control by.
function check(
  control: PodSecurityControl,
  spec: JSONObject,
  options: {
    level?: PodSecurityLevel;
    version?: KubernetesVersion;
    annotations?: Record<string, string>;
  } = {},
): Array<KubernetesComplianceDetail> {
  return checkPodSecurityControl(
    control,
    readPodSecurity(spec, options.annotations),
    {
      level: options.level || RESTRICTED,
      version: options.version || V1_37,
    },
  );
}

// A pod of one container, with a container security context.
function oneContainer(container: JSONObject, pod: JSONObject = {}): JSONObject {
  return {
    ...pod,
    containers: [{ name: "app", image: "ghcr.io/acme/app:1.0", ...container }],
  };
}

// A pod hardened to Restricted: it passes every control, at every level.
const HARDENED: JSONObject = {
  securityContext: {
    runAsNonRoot: true,
    runAsUser: 10001,
    seccompProfile: { type: "RuntimeDefault" },
  },
  containers: [
    {
      name: "api",
      image: "ghcr.io/acme/api:2.4.1",
      ports: [{ containerPort: 8080 }],
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"], add: ["NET_BIND_SERVICE"] },
        readOnlyRootFilesystem: true,
      },
      livenessProbe: { httpGet: { path: "/healthz", port: 8080 } },
    },
  ],
  initContainers: [
    {
      name: "migrate",
      image: "ghcr.io/acme/api:2.4.1",
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
      },
    },
  ],
  volumes: [
    { name: "tmp", emptyDir: {} },
    { name: "config", configMap: { name: "api" } },
    { name: "data", persistentVolumeClaim: { claimName: "api-data" } },
    {
      name: "kube-api-access-x8k2v",
      projected: { sources: [{ serviceAccountToken: { path: "token" } }] },
    },
  ],
};

// A Windows pod, as the standard reads spec.os.name.
const WINDOWS: JSONObject = { os: { name: "windows" } };

// A Linux pod in its own user namespace.
const OWN_USER_NAMESPACE: JSONObject = { hostUsers: false };

describe("the standard's controls", () => {
  test("Baseline has twelve controls and Restricted six more, in the standard's order", () => {
    expect(BASELINE_CONTROLS).toHaveLength(12);
    expect(RESTRICTED_ONLY_CONTROLS).toHaveLength(6);
    expect(getPodSecurityControls(BASELINE, V1_37)).toEqual([
      ...BASELINE_CONTROLS,
    ]);
    expect(getPodSecurityControls(RESTRICTED, V1_37)).toEqual([
      ...BASELINE_CONTROLS,
      ...RESTRICTED_ONLY_CONTROLS,
    ]);
  });

  test("Host Probes / Lifecycle Hooks is a control from Kubernetes 1.34", () => {
    expect(getPodSecurityControls(BASELINE, V1_33)).not.toContain(
      PodSecurityControl.HostProbes,
    );
    expect(getPodSecurityControls(BASELINE, V1_34)).toContain(
      PodSecurityControl.HostProbes,
    );
    expect(getPodSecurityControls(RESTRICTED, V1_33)).toHaveLength(17);
  });

  test("the Restricted controls start at the versions the standard gives them", () => {
    expect(
      getPodSecurityControls(RESTRICTED, { major: 1, minor: 22 }),
    ).not.toContain(PodSecurityControl.RunningAsNonRootUser);
    expect(
      getPodSecurityControls(RESTRICTED, { major: 1, minor: 21 }),
    ).not.toContain(PodSecurityControl.CapabilitiesRestricted);
    expect(
      getPodSecurityControls(RESTRICTED, { major: 1, minor: 18 }),
    ).not.toContain(PodSecurityControl.SeccompRestricted);
  });

  test("a pod hardened to Restricted meets both levels", () => {
    for (const level of [BASELINE, RESTRICTED]) {
      expect(
        evaluatePodSecurity(readPodSecurity(HARDENED), {
          level,
          version: V1_37,
        }),
      ).toEqual([]);
    }
  });
});

describe("HostProcess", () => {
  const control: PodSecurityControl = PodSecurityControl.HostProcess;

  test("passes a pod that sets hostProcess false, or not at all", () => {
    expect(
      check(control, {
        ...WINDOWS,
        securityContext: { windowsOptions: { hostProcess: false } },
        containers: [{ name: "w" }],
      }),
    ).toEqual([]);
    expect(check(control, HARDENED)).toEqual([]);
  });

  test("fails a HostProcess pod and each HostProcess container, ephemeral ones too", () => {
    expect(
      check(control, {
        ...WINDOWS,
        hostNetwork: true,
        securityContext: {
          windowsOptions: {
            hostProcess: true,
            runAsUserName: "NT AUTHORITY\\SYSTEM",
          },
        },
        containers: [{ name: "calico-node-windows" }],
        ephemeralContainers: [
          {
            name: "debugger",
            securityContext: { windowsOptions: { hostProcess: true } },
          },
        ],
      }),
    ).toEqual([
      { field: "securityContext.windowsOptions.hostProcess", value: "true" },
      {
        container: "debugger",
        field: "securityContext.windowsOptions.hostProcess",
        value: "true",
      },
    ]);
  });

  test("the Windows exemptions of the Linux-only controls do not reach it", () => {
    expect(
      check(
        control,
        oneContainer(
          { securityContext: { windowsOptions: { hostProcess: true } } },
          WINDOWS,
        ),
        { level: BASELINE },
      ),
    ).toHaveLength(1);
  });
});

describe("Host Namespaces", () => {
  const control: PodSecurityControl = PodSecurityControl.HostNamespaces;

  test("passes a pod that shares none of the host's namespaces", () => {
    expect(
      check(control, oneContainer({}, { hostNetwork: false, hostPID: false })),
    ).toEqual([]);
  });

  test("fails each namespace a pod shares with the host", () => {
    expect(
      check(
        control,
        oneContainer({}, { hostNetwork: true, hostPID: true, hostIPC: true }),
      ),
    ).toEqual([
      { field: "hostNetwork", value: "true" },
      { field: "hostPID", value: "true" },
      { field: "hostIPC", value: "true" },
    ]);
  });

  test("a pod in its own user namespace is still held to it", () => {
    expect(
      check(
        control,
        oneContainer({}, { ...OWN_USER_NAMESPACE, hostNetwork: true }),
        { level: BASELINE, version: V1_37 },
      ),
    ).toHaveLength(1);
  });
});

describe("Privileged Containers", () => {
  const control: PodSecurityControl = PodSecurityControl.PrivilegedContainers;

  test("passes containers that are not privileged", () => {
    expect(
      check(control, oneContainer({ securityContext: { privileged: false } })),
    ).toEqual([]);
  });

  test("fails kube-proxy's privileged container and a privileged init container", () => {
    expect(
      check(control, {
        hostNetwork: true,
        containers: [
          { name: "kube-proxy", securityContext: { privileged: true } },
        ],
        initContainers: [
          { name: "mount-cgroup", securityContext: { privileged: true } },
        ],
      }),
    ).toEqual([
      {
        container: "kube-proxy",
        field: "securityContext.privileged",
        value: "true",
      },
      {
        container: "mount-cgroup",
        field: "securityContext.privileged",
        value: "true",
      },
    ]);
  });

  test("a Windows pod or one in its own user namespace is still held to it", () => {
    for (const pod of [WINDOWS, OWN_USER_NAMESPACE]) {
      expect(
        check(
          control,
          oneContainer({ securityContext: { privileged: true } }, pod),
        ),
      ).toHaveLength(1);
    }
  });
});

describe("Capabilities (Baseline)", () => {
  const control: PodSecurityControl = PodSecurityControl.Capabilities;

  test("passes added capabilities from the allowed list", () => {
    expect(
      check(
        control,
        oneContainer({
          securityContext: {
            capabilities: { add: ["NET_BIND_SERVICE", "CHOWN", "SETUID"] },
          },
        }),
        { level: BASELINE },
      ),
    ).toEqual([]);
  });

  test("fails Cilium's agent by the capabilities beyond the list, and only those", () => {
    expect(
      check(
        control,
        oneContainer({
          name: "cilium-agent",
          securityContext: {
            capabilities: {
              add: ["CHOWN", "KILL", "NET_ADMIN", "NET_RAW", "SYS_ADMIN"],
              drop: ["ALL"],
            },
          },
        }),
        { level: BASELINE },
      ),
    ).toEqual([
      {
        container: "cilium-agent",
        field: "securityContext.capabilities.add",
        value: "NET_ADMIN, NET_RAW, SYS_ADMIN",
      },
    ]);
  });

  test("names a capability exactly as the standard does: CAP_ prefixed ones are not on its list", () => {
    expect(
      check(
        control,
        oneContainer({
          securityContext: { capabilities: { add: ["CAP_CHOWN"] } },
        }),
        { level: BASELINE },
      ),
    ).toHaveLength(1);
  });

  test("a Windows pod is still held to Baseline's capabilities", () => {
    expect(
      check(
        control,
        oneContainer(
          { securityContext: { capabilities: { add: ["SYS_ADMIN"] } } },
          WINDOWS,
        ),
        { level: BASELINE },
      ),
    ).toHaveLength(1);
  });
});

describe("HostPath Volumes", () => {
  const control: PodSecurityControl = PodSecurityControl.HostPathVolumes;

  test("passes a pod whose volumes are claims, ConfigMaps and emptyDirs", () => {
    expect(check(control, HARDENED)).toEqual([]);
  });

  test("fails each hostPath volume, with its path", () => {
    expect(
      check(control, {
        containers: [{ name: "fluent-bit" }],
        volumes: [
          { name: "varlog", hostPath: { path: "/var/log" } },
          {
            name: "machine-id",
            hostPath: { path: "/etc/machine-id", type: "File" },
          },
          { name: "config", configMap: { name: "fluent-bit" } },
        ],
      }),
    ).toEqual([
      { volume: "varlog", field: "hostPath", value: "/var/log" },
      { volume: "machine-id", field: "hostPath", value: "/etc/machine-id" },
    ]);
  });

  test("no exemption reaches it", () => {
    expect(
      check(control, {
        ...OWN_USER_NAMESPACE,
        ...WINDOWS,
        containers: [{ name: "c" }],
        volumes: [{ name: "host", hostPath: { path: "C:\\" } }],
      }),
    ).toHaveLength(1);
  });
});

describe("Host Ports", () => {
  const control: PodSecurityControl = PodSecurityControl.HostPorts;

  test("passes container ports with no host port, or host port 0", () => {
    expect(
      check(
        control,
        oneContainer({
          ports: [
            { containerPort: 8080 },
            { containerPort: 9090, hostPort: 0 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("fails a container that binds ports on the node", () => {
    expect(
      check(
        control,
        oneContainer({
          name: "ingress-nginx",
          ports: [
            { containerPort: 80, hostPort: 80 },
            { containerPort: 443, hostPort: 443 },
          ],
        }),
      ),
    ).toEqual([
      {
        container: "ingress-nginx",
        field: "ports[*].hostPort",
        value: "80, 443",
      },
    ]);
  });

  test("no exemption reaches it", () => {
    expect(
      check(
        control,
        oneContainer({ ports: [{ containerPort: 53, hostPort: 53 }] }, WINDOWS),
      ),
    ).toHaveLength(1);
  });
});

describe("Host Probes / Lifecycle Hooks", () => {
  const control: PodSecurityControl = PodSecurityControl.HostProbes;
  const probingTheNode: JSONObject = oneContainer({
    livenessProbe: {
      httpGet: { host: "127.0.0.1", path: "/healthz", port: 9879 },
    },
    lifecycle: { preStop: { tcpSocket: { host: "10.0.0.1", port: 22 } } },
  });

  test("passes probes and hooks that reach the pod itself", () => {
    expect(
      check(
        control,
        oneContainer({
          readinessProbe: { httpGet: { path: "/ready", port: 8080, host: "" } },
          startupProbe: { tcpSocket: { port: 8080 } },
        }),
        { version: V1_34 },
      ),
    ).toEqual([]);
  });

  test("fails each probe and hook that names a host, from Kubernetes 1.34", () => {
    expect(check(control, probingTheNode, { version: V1_34 })).toEqual([
      {
        container: "app",
        field: "livenessProbe.httpGet.host",
        value: "127.0.0.1",
      },
      {
        container: "app",
        field: "lifecycle.preStop.tcpSocket.host",
        value: "10.0.0.1",
      },
    ]);
  });

  test("is not part of the standard before 1.34, so a 1.33 cluster's probes pass", () => {
    expect(check(control, probingTheNode, { version: V1_33 })).toEqual([]);
    expect(
      evaluatePodSecurity(readPodSecurity(probingTheNode), {
        level: BASELINE,
        version: V1_33,
      }),
    ).toEqual([]);
  });

  test("reads the containers and init containers the standard lists", () => {
    expect(
      check(
        control,
        {
          containers: [{ name: "app" }],
          initContainers: [
            {
              name: "wait",
              startupProbe: { tcpSocket: { host: "db", port: 5432 } },
            },
          ],
        },
        { version: V1_37 },
      ),
    ).toEqual([
      { container: "wait", field: "startupProbe.tcpSocket.host", value: "db" },
    ]);
  });
});

describe("AppArmor", () => {
  const control: PodSecurityControl = PodSecurityControl.AppArmor;

  test("passes RuntimeDefault, Localhost, and the same in the annotation", () => {
    expect(
      check(
        control,
        oneContainer(
          {
            securityContext: {
              appArmorProfile: {
                type: "Localhost",
                localhostProfile: "k8s-nginx",
              },
            },
          },
          { securityContext: { appArmorProfile: { type: "RuntimeDefault" } } },
        ),
        {
          annotations: {
            "container.apparmor.security.beta.kubernetes.io/app":
              "localhost/k8s-nginx",
            "container.apparmor.security.beta.kubernetes.io/sidecar":
              "runtime/default",
          },
        },
      ),
    ).toEqual([]);
  });

  test("fails an Unconfined profile, set by the field or by the annotation", () => {
    expect(
      check(
        control,
        oneContainer({
          securityContext: { appArmorProfile: { type: "Unconfined" } },
        }),
        {
          annotations: {
            "container.apparmor.security.beta.kubernetes.io/app": "unconfined",
          },
        },
      ),
    ).toEqual([
      {
        container: "app",
        field: "securityContext.appArmorProfile.type",
        value: "Unconfined",
      },
      {
        field:
          'metadata.annotations["container.apparmor.security.beta.kubernetes.io/app"]',
        value: "unconfined",
      },
    ]);
  });

  test("no exemption reaches it", () => {
    expect(
      check(
        control,
        oneContainer(
          {},
          {
            ...OWN_USER_NAMESPACE,
            securityContext: { appArmorProfile: { type: "Unconfined" } },
          },
        ),
      ),
    ).toHaveLength(1);
  });
});

describe("SELinux", () => {
  const control: PodSecurityControl = PodSecurityControl.SELinux;

  test("passes the allowed types and a level", () => {
    expect(
      check(
        control,
        oneContainer(
          { securityContext: { seLinuxOptions: { type: "container_init_t" } } },
          {
            securityContext: {
              seLinuxOptions: { type: "container_t", level: "s0:c123,c456" },
            },
          },
        ),
      ),
    ).toEqual([]);
  });

  test("fails another type, and any user or role", () => {
    expect(
      check(
        control,
        oneContainer({
          name: "cilium-agent",
          securityContext: {
            seLinuxOptions: {
              level: "s0",
              type: "spc_t",
              user: "system_u",
              role: "system_r",
            },
          },
        }),
      ),
    ).toEqual([
      {
        container: "cilium-agent",
        field: "securityContext.seLinuxOptions.type",
        value: "spc_t",
      },
      {
        container: "cilium-agent",
        field: "securityContext.seLinuxOptions.user",
        value: "system_u",
      },
      {
        container: "cilium-agent",
        field: "securityContext.seLinuxOptions.role",
        value: "system_r",
      },
    ]);
  });

  test("allows container_engine_t from Kubernetes 1.31, and not before", () => {
    const engine: JSONObject = oneContainer(
      {},
      { securityContext: { seLinuxOptions: { type: "container_engine_t" } } },
    );

    expect(check(control, engine, { version: V1_31 })).toEqual([]);
    expect(
      check(control, engine, { version: { major: 1, minor: 30 } }),
    ).toEqual([
      {
        field: "securityContext.seLinuxOptions.type",
        value: "container_engine_t",
      },
    ]);
  });
});

describe("/proc Mount Type", () => {
  const control: PodSecurityControl = PodSecurityControl.ProcMount;
  const unmasked: JSONObject = oneContainer({
    securityContext: { procMount: "Unmasked" },
  });

  test("passes the default /proc mount", () => {
    expect(
      check(
        control,
        oneContainer({ securityContext: { procMount: "Default" } }),
      ),
    ).toEqual([]);
  });

  test("fails an unmasked /proc", () => {
    expect(check(control, unmasked, { level: BASELINE })).toEqual([
      {
        container: "app",
        field: "securityContext.procMount",
        value: "Unmasked",
      },
    ]);
  });

  test("Baseline lets a pod in its own user namespace unmask it from 1.36; Restricted never does", () => {
    const inOwnNamespace: JSONObject = { ...unmasked, ...OWN_USER_NAMESPACE };

    expect(
      check(control, inOwnNamespace, { level: BASELINE, version: V1_36 }),
    ).toEqual([]);
    expect(
      check(control, inOwnNamespace, { level: RESTRICTED, version: V1_36 }),
    ).toHaveLength(1);
    // Before user namespaces were generally available, nothing is relaxed.
    expect(
      check(control, inOwnNamespace, { level: BASELINE, version: V1_35 }),
    ).toHaveLength(1);
  });
});

describe("Seccomp (Baseline)", () => {
  const control: PodSecurityControl = PodSecurityControl.Seccomp;

  test("passes a pod that sets no profile, or an allowed one", () => {
    expect(check(control, oneContainer({}), { level: BASELINE })).toEqual([]);
    expect(
      check(
        control,
        oneContainer({
          securityContext: {
            seccompProfile: {
              type: "Localhost",
              localhostProfile: "profiles/audit.json",
            },
          },
        }),
        { level: BASELINE },
      ),
    ).toEqual([]);
  });

  test("fails an Unconfined profile, on the pod or a container", () => {
    expect(
      check(
        control,
        oneContainer(
          { securityContext: { seccompProfile: { type: "Unconfined" } } },
          { securityContext: { seccompProfile: { type: "Unconfined" } } },
        ),
        { level: BASELINE },
      ),
    ).toEqual([
      { field: "securityContext.seccompProfile.type", value: "Unconfined" },
      {
        container: "app",
        field: "securityContext.seccompProfile.type",
        value: "Unconfined",
      },
    ]);
  });

  test("Baseline's Seccomp holds a Windows pod too: only Restricted's is Linux-only", () => {
    expect(
      check(
        control,
        oneContainer(
          { securityContext: { seccompProfile: { type: "Unconfined" } } },
          WINDOWS,
        ),
        { level: BASELINE },
      ),
    ).toHaveLength(1);
  });
});

describe("Sysctls", () => {
  const control: PodSecurityControl = PodSecurityControl.Sysctls;

  function withSysctls(...names: Array<string>): JSONObject {
    return oneContainer(
      {},
      {
        securityContext: {
          sysctls: names.map((name: string) => {
            return { name, value: "1" };
          }),
        },
      },
    );
  }

  test("passes the safe sysctls", () => {
    expect(
      check(
        control,
        withSysctls(
          "net.ipv4.ip_unprivileged_port_start",
          "kernel.shm_rmid_forced",
        ),
      ),
    ).toEqual([]);
  });

  test("fails the ones that are not namespaced, or not isolated from other pods", () => {
    expect(
      check(
        control,
        withSysctls(
          "net.ipv4.tcp_syncookies",
          "kernel.msgmax",
          "vm.max_map_count",
        ),
      ),
    ).toEqual([
      {
        field: "securityContext.sysctls",
        value: "kernel.msgmax, vm.max_map_count",
      },
    ]);
  });

  test("takes each sysctl from the version it joined the safe list", () => {
    expect(
      isSafeSysctl("net.ipv4.tcp_keepalive_time", { major: 1, minor: 28 }),
    ).toBe(false);
    expect(
      isSafeSysctl("net.ipv4.tcp_keepalive_time", { major: 1, minor: 29 }),
    ).toBe(true);
    expect(
      isSafeSysctl("net.ipv4.ip_local_reserved_ports", { major: 1, minor: 26 }),
    ).toBe(false);
    expect(
      isSafeSysctl("net.ipv4.ip_local_reserved_ports", { major: 1, minor: 27 }),
    ).toBe(true);
    expect(isSafeSysctl("net.ipv4.tcp_rmem", V1_31)).toBe(false);
    expect(isSafeSysctl("net.ipv4.tcp_rmem", { major: 1, minor: 32 })).toBe(
      true,
    );
    expect(
      isSafeSysctl("net.ipv4.tcp_notsent_lowat", { major: 1, minor: 36 }),
    ).toBe(false);
    expect(isSafeSysctl("net.ipv4.tcp_notsent_lowat", V1_37)).toBe(true);
    expect(
      check(control, withSysctls("net.ipv4.tcp_wmem"), { version: V1_31 }),
    ).toHaveLength(1);
    expect(
      check(control, withSysctls("net.ipv4.tcp_wmem"), { version: V1_37 }),
    ).toEqual([]);
  });
});

describe("Volume Types (Restricted)", () => {
  const control: PodSecurityControl = PodSecurityControl.VolumeTypes;

  test("passes the eight volume sources the standard permits", () => {
    expect(
      check(control, {
        containers: [{ name: "c" }],
        volumes: [
          { name: "a", configMap: { name: "a" } },
          { name: "b", csi: { driver: "secrets-store.csi.k8s.io" } },
          { name: "c", downwardAPI: { items: [] } },
          { name: "d", emptyDir: { medium: "Memory" } },
          { name: "e", ephemeral: { volumeClaimTemplate: {} } },
          { name: "f", persistentVolumeClaim: { claimName: "f" } },
          { name: "g", projected: { sources: [] } },
          { name: "h", secret: { secretName: "h" } },
        ],
      }),
    ).toEqual([]);
  });

  test("fails every other source, a hostPath and an NFS share among them", () => {
    expect(
      check(control, {
        containers: [{ name: "c" }],
        volumes: [
          { name: "logs", hostPath: { path: "/var/log" } },
          { name: "share", nfs: { server: "10.0.0.5", path: "/exports" } },
          { name: "tmp", emptyDir: {} },
        ],
      }),
    ).toEqual([
      { volume: "logs", field: "hostPath" },
      { volume: "share", field: "nfs" },
    ]);
  });

  test("is not part of Baseline", () => {
    expect(
      check(
        control,
        {
          containers: [{ name: "c" }],
          volumes: [{ name: "share", nfs: { server: "s", path: "/" } }],
        },
        { level: BASELINE },
      ),
    ).toEqual([]);
  });
});

describe("Privilege Escalation (Restricted)", () => {
  const control: PodSecurityControl = PodSecurityControl.PrivilegeEscalation;

  test("passes containers that set allowPrivilegeEscalation to false", () => {
    expect(check(control, HARDENED)).toEqual([]);
  });

  test("fails a container that allows it, and one that does not say", () => {
    expect(
      check(control, {
        containers: [
          { name: "app", securityContext: { allowPrivilegeEscalation: true } },
          { name: "sidecar" },
        ],
      }),
    ).toEqual([
      {
        container: "app",
        field: "securityContext.allowPrivilegeEscalation",
        value: "true",
      },
      {
        container: "sidecar",
        field: "securityContext.allowPrivilegeEscalation",
        isNotSet: true,
      },
    ]);
  });

  test("exempts a Windows pod from 1.25", () => {
    expect(
      check(control, oneContainer({}, WINDOWS), { version: V1_31 }),
    ).toEqual([]);
    expect(
      check(control, oneContainer({}, WINDOWS), {
        version: { major: 1, minor: 24 },
      }),
    ).toHaveLength(1);
  });
});

describe("Running as Non-root (Restricted)", () => {
  const control: PodSecurityControl = PodSecurityControl.RunningAsNonRoot;

  test("passes runAsNonRoot on the pod, or on every container", () => {
    expect(check(control, HARDENED)).toEqual([]);
    expect(
      check(control, {
        containers: [
          { name: "a", securityContext: { runAsNonRoot: true } },
          { name: "b", securityContext: { runAsNonRoot: true } },
        ],
      }),
    ).toEqual([]);
  });

  test("fails a container that leaves it unset when the pod does not set it, and one that sets it false", () => {
    expect(
      check(control, {
        containers: [
          { name: "a", securityContext: { runAsNonRoot: true } },
          { name: "b" },
        ],
      }),
    ).toEqual([
      { container: "b", field: "securityContext.runAsNonRoot", isNotSet: true },
    ]);
    expect(
      check(control, {
        securityContext: { runAsNonRoot: true },
        containers: [{ name: "a", securityContext: { runAsNonRoot: false } }],
      }),
    ).toEqual([
      { container: "a", field: "securityContext.runAsNonRoot", value: "false" },
    ]);
  });

  test("fails a pod that sets it false, whatever its containers say", () => {
    expect(
      check(control, {
        securityContext: { runAsNonRoot: false },
        containers: [{ name: "a", securityContext: { runAsNonRoot: true } }],
      }),
    ).toEqual([{ field: "securityContext.runAsNonRoot", value: "false" }]);
  });

  test("exempts a pod in its own user namespace from 1.36, and a Windows pod not at all", () => {
    expect(
      check(control, oneContainer({}, OWN_USER_NAMESPACE), { version: V1_36 }),
    ).toEqual([]);
    expect(
      check(control, oneContainer({}, OWN_USER_NAMESPACE), { version: V1_35 }),
    ).toHaveLength(1);
    expect(check(control, oneContainer({}, WINDOWS))).toHaveLength(1);
  });
});

describe("Running as Non-root user (Restricted)", () => {
  const control: PodSecurityControl = PodSecurityControl.RunningAsNonRootUser;

  test("passes a non-zero user, or none", () => {
    expect(check(control, HARDENED)).toEqual([]);
    expect(check(control, oneContainer({}))).toEqual([]);
  });

  test("fails user 0, on the pod or a container", () => {
    expect(
      check(control, {
        securityContext: { runAsUser: 0 },
        containers: [{ name: "a", securityContext: { runAsUser: 0 } }],
      }),
    ).toEqual([
      { field: "securityContext.runAsUser", value: "0" },
      { container: "a", field: "securityContext.runAsUser", value: "0" },
    ]);
  });

  test("exempts a pod in its own user namespace from 1.36, whose root is no root on the node", () => {
    const rootInItsNamespace: JSONObject = oneContainer(
      { securityContext: { runAsUser: 0 } },
      OWN_USER_NAMESPACE,
    );

    expect(check(control, rootInItsNamespace, { version: V1_36 })).toEqual([]);
    expect(check(control, rootInItsNamespace, { version: V1_35 })).toHaveLength(
      1,
    );
  });
});

describe("Seccomp (Restricted)", () => {
  const control: PodSecurityControl = PodSecurityControl.SeccompRestricted;

  test("passes a profile on the pod, or on every container", () => {
    expect(check(control, HARDENED)).toEqual([]);
    expect(
      check(control, {
        containers: [
          {
            name: "a",
            securityContext: { seccompProfile: { type: "RuntimeDefault" } },
          },
          {
            name: "b",
            securityContext: {
              seccompProfile: { type: "Localhost", localhostProfile: "p.json" },
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  test("fails a pod that sets none, by each container that has none", () => {
    expect(
      check(control, {
        containers: [
          {
            name: "a",
            securityContext: { seccompProfile: { type: "RuntimeDefault" } },
          },
          { name: "b" },
        ],
      }),
    ).toEqual([
      {
        container: "b",
        field: "securityContext.seccompProfile.type",
        isNotSet: true,
      },
    ]);
  });

  test("fails Unconfined on a container even when the pod sets RuntimeDefault", () => {
    expect(
      check(control, {
        securityContext: { seccompProfile: { type: "RuntimeDefault" } },
        containers: [
          {
            name: "a",
            securityContext: { seccompProfile: { type: "Unconfined" } },
          },
        ],
      }),
    ).toEqual([
      {
        container: "a",
        field: "securityContext.seccompProfile.type",
        value: "Unconfined",
      },
    ]);
  });

  test("exempts a Windows pod from 1.25", () => {
    expect(check(control, oneContainer({}, WINDOWS))).toEqual([]);
  });
});

describe("Capabilities (Restricted)", () => {
  const control: PodSecurityControl = PodSecurityControl.CapabilitiesRestricted;

  test("passes containers that drop ALL and add back only NET_BIND_SERVICE", () => {
    expect(check(control, HARDENED)).toEqual([]);
  });

  test("fails a container that drops less than ALL, one that drops nothing, and one that adds more", () => {
    expect(
      check(control, {
        containers: [
          {
            name: "a",
            securityContext: { capabilities: { drop: ["NET_RAW"] } },
          },
          { name: "b" },
          {
            name: "c",
            securityContext: {
              capabilities: {
                drop: ["ALL"],
                add: ["NET_BIND_SERVICE", "NET_ADMIN"],
              },
            },
          },
        ],
      }),
    ).toEqual([
      {
        container: "a",
        field: "securityContext.capabilities.drop",
        value: "NET_RAW",
      },
      {
        container: "b",
        field: "securityContext.capabilities.drop",
        isNotSet: true,
      },
      {
        container: "c",
        field: "securityContext.capabilities.add",
        value: "NET_ADMIN",
      },
    ]);
  });

  test("exempts a Windows pod from 1.25", () => {
    expect(check(control, oneContainer({}, WINDOWS))).toEqual([]);
  });
});

describe("whole pods, as clusters run them", () => {
  function violated(
    spec: JSONObject,
    level: PodSecurityLevel,
    version: KubernetesVersion = V1_37,
  ): Array<PodSecurityControl> {
    return evaluatePodSecurity(readPodSecurity(spec), { level, version }).map(
      (violation: PodSecurityViolation): PodSecurityControl => {
        return violation.control;
      },
    );
  }

  test("kube-proxy fails Baseline by its host network, privilege and host paths", () => {
    const kubeProxy: JSONObject = {
      hostNetwork: true,
      containers: [
        {
          name: "kube-proxy",
          ports: [{ containerPort: 10249, hostPort: 10249 }],
          securityContext: { privileged: true },
        },
      ],
      volumes: [
        { name: "kube-proxy", configMap: { name: "kube-proxy" } },
        { name: "lib-modules", hostPath: { path: "/lib/modules" } },
      ],
    };

    expect(violated(kubeProxy, BASELINE)).toEqual([
      PodSecurityControl.HostNamespaces,
      PodSecurityControl.PrivilegedContainers,
      PodSecurityControl.HostPathVolumes,
      PodSecurityControl.HostPorts,
    ]);
  });

  test("an nginx Deployment with no security context meets Baseline and fails Restricted's container controls", () => {
    const nginx: JSONObject = {
      containers: [
        { name: "nginx", image: "nginx:1.27", ports: [{ containerPort: 80 }] },
      ],
    };

    expect(
      meetsPodSecurityLevel(readPodSecurity(nginx), {
        level: BASELINE,
        version: V1_37,
      }),
    ).toBe(true);
    expect(violated(nginx, RESTRICTED)).toEqual([
      PodSecurityControl.PrivilegeEscalation,
      PodSecurityControl.RunningAsNonRoot,
      PodSecurityControl.SeccompRestricted,
      PodSecurityControl.CapabilitiesRestricted,
    ]);
  });

  test("a Windows pod with no security context fails Restricted only by Running as Non-root", () => {
    expect(
      violated(
        { os: { name: "windows" }, containers: [{ name: "iis" }] },
        RESTRICTED,
      ),
    ).toEqual([PodSecurityControl.RunningAsNonRoot]);
  });
});
