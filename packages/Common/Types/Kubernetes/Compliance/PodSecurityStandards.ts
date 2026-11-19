import {
  APPARMOR_ANNOTATION_PREFIX,
  PodSecurity,
  PodSecurityContainer,
  PodSecurityContainerList,
} from "../KubernetesPodSecurity";
import { KubernetesComplianceDetail } from "./KubernetesComplianceFinding";
import { KubernetesVersion, isAtLeastMinor } from "./KubernetesVersion";

/*
 * THE POD SECURITY STANDARDS, AS KUBERNETES PUBLISHES THEM (#9627).
 *
 * https://kubernetes.io/docs/concepts/security/pod-security-standards/ - the
 * Baseline policy's twelve controls and the Restricted policy's six more,
 * each with exactly the fields and allowed values the standard lists, read
 * from what a pod says about itself (KubernetesPodSecurity):
 *
 *   - Every container counts: containers, initContainers and
 *     ephemeralContainers ("If any of the listed containers fails to meet
 *     the requirements, the entire pod will fail validation").
 *   - The standard of the cluster's version (KubernetesVersion): the safe
 *     sysctls grow with it, Host Probes / Lifecycle Hooks is a control from
 *     1.34, SELinux allows container_engine_t from 1.31, and the Restricted
 *     controls each start at the version the standard gives them.
 *   - Its exemptions: since 1.25 a Windows pod (spec.os.name: windows) is not
 *     held to Privilege Escalation, Seccomp or the Linux capabilities; since
 *     1.36, when user namespaces became generally available, a Linux pod in
 *     its own user namespace (spec.hostUsers: false) is not held to Running
 *     as Non-root or Running as Non-root user, and under Baseline not to its
 *     /proc mount type either.
 *
 * Pod Security Admission's own exemptions - usernames, runtime classes and
 * namespaces in the API server's configuration - are not visible from the
 * API; a namespace is exempted on the Compliance page instead.
 *
 * Pure: the server scores a cluster with it, and its tests pin every control.
 */

export enum PodSecurityLevel {
  Baseline = "Baseline",
  Restricted = "Restricted",
}

// Each control by its name in the standard; the names are stable keys.
export enum PodSecurityControl {
  HostProcess = "HostProcess",
  HostNamespaces = "Host Namespaces",
  PrivilegedContainers = "Privileged Containers",
  Capabilities = "Capabilities",
  HostPathVolumes = "HostPath Volumes",
  HostPorts = "Host Ports",
  HostProbes = "Host Probes / Lifecycle Hooks",
  AppArmor = "AppArmor",
  SELinux = "SELinux",
  ProcMount = "/proc Mount Type",
  Seccomp = "Seccomp",
  Sysctls = "Sysctls",
  VolumeTypes = "Volume Types",
  PrivilegeEscalation = "Privilege Escalation",
  RunningAsNonRoot = "Running as Non-root",
  RunningAsNonRootUser = "Running as Non-root user",
  // The Restricted policy's own Seccomp and Capabilities rows.
  SeccompRestricted = "Seccomp (Restricted)",
  CapabilitiesRestricted = "Capabilities (Restricted)",
}

// The Baseline policy's controls, in the standard's order.
export const BASELINE_CONTROLS: ReadonlyArray<PodSecurityControl> = [
  PodSecurityControl.HostProcess,
  PodSecurityControl.HostNamespaces,
  PodSecurityControl.PrivilegedContainers,
  PodSecurityControl.Capabilities,
  PodSecurityControl.HostPathVolumes,
  PodSecurityControl.HostPorts,
  PodSecurityControl.HostProbes,
  PodSecurityControl.AppArmor,
  PodSecurityControl.SELinux,
  PodSecurityControl.ProcMount,
  PodSecurityControl.Seccomp,
  PodSecurityControl.Sysctls,
];

// What the Restricted policy adds to "Everything from the Baseline policy".
export const RESTRICTED_ONLY_CONTROLS: ReadonlyArray<PodSecurityControl> = [
  PodSecurityControl.VolumeTypes,
  PodSecurityControl.PrivilegeEscalation,
  PodSecurityControl.RunningAsNonRoot,
  PodSecurityControl.RunningAsNonRootUser,
  PodSecurityControl.SeccompRestricted,
  PodSecurityControl.CapabilitiesRestricted,
];

// The minor version a control joined the standard in, where it was not in 1.0.
export const POD_SECURITY_CONTROL_SINCE: Readonly<
  Partial<Record<PodSecurityControl, number>>
> = {
  [PodSecurityControl.HostProbes]: 34,
  [PodSecurityControl.PrivilegeEscalation]: 8,
  [PodSecurityControl.SeccompRestricted]: 19,
  [PodSecurityControl.CapabilitiesRestricted]: 22,
  [PodSecurityControl.RunningAsNonRootUser]: 23,
};

// The capabilities Baseline lets a container add.
export const BASELINE_ALLOWED_CAPABILITIES: ReadonlySet<string> =
  new Set<string>([
    "AUDIT_WRITE",
    "CHOWN",
    "DAC_OVERRIDE",
    "FOWNER",
    "FSETID",
    "KILL",
    "MKNOD",
    "NET_BIND_SERVICE",
    "SETFCAP",
    "SETGID",
    "SETPCAP",
    "SETUID",
    "SYS_CHROOT",
  ]);

// The one capability Restricted lets a container add back after dropping ALL.
export const RESTRICTED_ALLOWED_CAPABILITY: string = "NET_BIND_SERVICE";

// The volume sources Restricted permits.
export const RESTRICTED_ALLOWED_VOLUME_TYPES: ReadonlySet<string> =
  new Set<string>([
    "configMap",
    "csi",
    "downwardAPI",
    "emptyDir",
    "ephemeral",
    "persistentVolumeClaim",
    "projected",
    "secret",
  ]);

// The SELinux types Baseline permits, and the minor version each was allowed from.
export const ALLOWED_SELINUX_TYPES: ReadonlyArray<{
  type: string;
  since: number;
}> = [
  { type: "container_t", since: 0 },
  { type: "container_init_t", since: 0 },
  { type: "container_kvm_t", since: 0 },
  { type: "container_engine_t", since: 31 },
];

// The safe sysctls, and the minor version each joined the list in.
export const SAFE_SYSCTLS: ReadonlyArray<{ name: string; since: number }> = [
  { name: "kernel.shm_rmid_forced", since: 0 },
  { name: "net.ipv4.ip_local_port_range", since: 0 },
  { name: "net.ipv4.ip_unprivileged_port_start", since: 0 },
  { name: "net.ipv4.tcp_syncookies", since: 0 },
  { name: "net.ipv4.ping_group_range", since: 0 },
  { name: "net.ipv4.ip_local_reserved_ports", since: 27 },
  { name: "net.ipv4.tcp_keepalive_time", since: 29 },
  { name: "net.ipv4.tcp_fin_timeout", since: 29 },
  { name: "net.ipv4.tcp_keepalive_intvl", since: 29 },
  { name: "net.ipv4.tcp_keepalive_probes", since: 29 },
  { name: "net.ipv4.tcp_rmem", since: 32 },
  { name: "net.ipv4.tcp_wmem", since: 32 },
  { name: "net.ipv4.tcp_slow_start_after_idle", since: 37 },
  { name: "net.ipv4.tcp_notsent_lowat", since: 37 },
];

// The profile types the AppArmor, Seccomp and Seccomp (Restricted) controls allow.
const RUNTIME_DEFAULT: string = "RuntimeDefault";
const LOCALHOST: string = "Localhost";
const ALLOWED_PROFILE_TYPES: ReadonlySet<string> = new Set<string>([
  RUNTIME_DEFAULT,
  LOCALHOST,
]);

// Since Kubernetes 1.25 a Windows pod is held to fewer Linux-only controls.
const WINDOWS_RELAXED_SINCE: number = 25;

// Since Kubernetes 1.36 a pod in its own user namespace is held to fewer controls.
const USER_NAMESPACE_RELAXED_SINCE: number = 36;

export interface PodSecurityOptions {
  level: PodSecurityLevel;
  version: KubernetesVersion;
}

// The controls of a level, as the standard of this version has them.
export function getPodSecurityControls(
  level: PodSecurityLevel,
  version: KubernetesVersion,
): Array<PodSecurityControl> {
  const controls: ReadonlyArray<PodSecurityControl> =
    level === PodSecurityLevel.Baseline
      ? BASELINE_CONTROLS
      : [...BASELINE_CONTROLS, ...RESTRICTED_ONLY_CONTROLS];

  return controls.filter((control: PodSecurityControl): boolean => {
    const since: number | undefined = POD_SECURITY_CONTROL_SINCE[control];

    return since === undefined || isAtLeastMinor(version, since);
  });
}

export function isSafeSysctl(
  name: string,
  version: KubernetesVersion,
): boolean {
  return SAFE_SYSCTLS.some((sysctl: { name: string; since: number }) => {
    return sysctl.name === name && isAtLeastMinor(version, sysctl.since);
  });
}

export function isAllowedSELinuxType(
  type: string,
  version: KubernetesVersion,
): boolean {
  return ALLOWED_SELINUX_TYPES.some(
    (allowed: { type: string; since: number }) => {
      return allowed.type === type && isAtLeastMinor(version, allowed.since);
    },
  );
}

// A Windows pod, which the Linux-only controls do not apply to (1.25+).
export function isWindowsPodRelaxed(
  pod: PodSecurity,
  version: KubernetesVersion,
): boolean {
  return (
    pod.osName === "windows" && isAtLeastMinor(version, WINDOWS_RELAXED_SINCE)
  );
}

// A Linux pod in its own user namespace, whose root is no root on the host (1.36+).
export function isInOwnUserNamespace(
  pod: PodSecurity,
  version: KubernetesVersion,
): boolean {
  return (
    pod.hostUsers === false &&
    pod.osName !== "windows" &&
    isAtLeastMinor(version, USER_NAMESPACE_RELAXED_SINCE)
  );
}

function containersIn(
  pod: PodSecurity,
  lists?: ReadonlyArray<PodSecurityContainerList>,
): Array<PodSecurityContainer> {
  return pod.containers.filter((container: PodSecurityContainer): boolean => {
    return !lists || lists.includes(container.list);
  });
}

// A field the standard allows only some values of, set to another.
function isSetTo(value: string | undefined): value is string {
  return typeof value === "string" && value !== "";
}

/*
 * ---------------------------------------------------------------------------
 * The Baseline controls
 * ---------------------------------------------------------------------------
 */

const HOST_PROCESS_FIELD: string = "securityContext.windowsOptions.hostProcess";

function checkHostProcess(pod: PodSecurity): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  if (pod.windowsHostProcess === true) {
    details.push({ field: HOST_PROCESS_FIELD, value: "true" });
  }

  for (const container of containersIn(pod)) {
    if (container.windowsHostProcess === true) {
      details.push({
        container: container.name,
        field: HOST_PROCESS_FIELD,
        value: "true",
      });
    }
  }

  return details;
}

function checkHostNamespaces(
  pod: PodSecurity,
): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  for (const field of ["hostNetwork", "hostPID", "hostIPC"] as const) {
    if (pod[field] === true) {
      details.push({ field, value: "true" });
    }
  }

  return details;
}

function checkPrivileged(pod: PodSecurity): Array<KubernetesComplianceDetail> {
  return containersIn(pod)
    .filter((container: PodSecurityContainer): boolean => {
      return container.privileged === true;
    })
    .map((container: PodSecurityContainer): KubernetesComplianceDetail => {
      return {
        container: container.name,
        field: "securityContext.privileged",
        value: "true",
      };
    });
}

function checkBaselineCapabilities(
  pod: PodSecurity,
): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  for (const container of containersIn(pod)) {
    const added: Array<string> = (container.capabilitiesAdd || []).filter(
      (capability: string): boolean => {
        return !BASELINE_ALLOWED_CAPABILITIES.has(capability);
      },
    );

    if (added.length > 0) {
      details.push({
        container: container.name,
        field: "securityContext.capabilities.add",
        value: added.join(", "),
      });
    }
  }

  return details;
}

function checkHostPathVolumes(
  pod: PodSecurity,
): Array<KubernetesComplianceDetail> {
  return pod.volumes
    .filter((volume: { type: string }): boolean => {
      return volume.type === "hostPath";
    })
    .map(
      (volume: {
        name: string;
        hostPath?: string | undefined;
      }): KubernetesComplianceDetail => {
        return {
          volume: volume.name,
          field: "hostPath",
          value: volume.hostPath || undefined,
        };
      },
    );
}

function checkHostPorts(pod: PodSecurity): Array<KubernetesComplianceDetail> {
  return containersIn(pod)
    .filter((container: PodSecurityContainer): boolean => {
      return (container.hostPorts || []).length > 0;
    })
    .map((container: PodSecurityContainer): KubernetesComplianceDetail => {
      return {
        container: container.name,
        field: "ports[*].hostPort",
        value: (container.hostPorts || []).join(", "),
      };
    });
}

function checkHostProbes(pod: PodSecurity): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  // The standard lists containers and initContainers: ephemeral ones have no probes.
  for (const container of containersIn(pod, ["containers", "initContainers"])) {
    for (const probe of container.probeHosts || []) {
      details.push({
        container: container.name,
        field: probe.field,
        value: probe.host,
      });
    }
  }

  return details;
}

const APPARMOR_FIELD: string = "securityContext.appArmorProfile.type";

function checkAppArmor(pod: PodSecurity): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  if (
    isSetTo(pod.appArmorProfileType) &&
    !ALLOWED_PROFILE_TYPES.has(pod.appArmorProfileType)
  ) {
    details.push({ field: APPARMOR_FIELD, value: pod.appArmorProfileType });
  }

  for (const container of containersIn(pod)) {
    if (
      isSetTo(container.appArmorProfileType) &&
      !ALLOWED_PROFILE_TYPES.has(container.appArmorProfileType)
    ) {
      details.push({
        container: container.name,
        field: APPARMOR_FIELD,
        value: container.appArmorProfileType,
      });
    }
  }

  // The annotation before the field: runtime/default or localhost/<profile>.
  for (const [container, profile] of Object.entries(
    pod.appArmorAnnotations || {},
  )) {
    if (
      isSetTo(profile) &&
      profile !== "runtime/default" &&
      !profile.startsWith("localhost/")
    ) {
      details.push({
        field: `metadata.annotations["${APPARMOR_ANNOTATION_PREFIX}${container}"]`,
        value: profile,
      });
    }
  }

  return details;
}

function seLinuxDetails(
  options: {
    seLinuxType?: string | undefined;
    seLinuxUser?: string | undefined;
    seLinuxRole?: string | undefined;
  },
  version: KubernetesVersion,
  container?: string | undefined,
): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  if (
    isSetTo(options.seLinuxType) &&
    !isAllowedSELinuxType(options.seLinuxType, version)
  ) {
    details.push({
      container,
      field: "securityContext.seLinuxOptions.type",
      value: options.seLinuxType,
    });
  }

  if (isSetTo(options.seLinuxUser)) {
    details.push({
      container,
      field: "securityContext.seLinuxOptions.user",
      value: options.seLinuxUser,
    });
  }

  if (isSetTo(options.seLinuxRole)) {
    details.push({
      container,
      field: "securityContext.seLinuxOptions.role",
      value: options.seLinuxRole,
    });
  }

  return details;
}

function checkSELinux(
  pod: PodSecurity,
  version: KubernetesVersion,
): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = seLinuxDetails(
    pod,
    version,
  );

  for (const container of containersIn(pod)) {
    details.push(...seLinuxDetails(container, version, container.name));
  }

  return details;
}

function checkProcMount(
  pod: PodSecurity,
  options: PodSecurityOptions,
): Array<KubernetesComplianceDetail> {
  // Under Baseline, a pod in its own user namespace may unmask /proc (1.36+).
  if (
    options.level === PodSecurityLevel.Baseline &&
    isInOwnUserNamespace(pod, options.version)
  ) {
    return [];
  }

  return containersIn(pod)
    .filter((container: PodSecurityContainer): boolean => {
      return isSetTo(container.procMount) && container.procMount !== "Default";
    })
    .map((container: PodSecurityContainer): KubernetesComplianceDetail => {
      return {
        container: container.name,
        field: "securityContext.procMount",
        value: container.procMount,
      };
    });
}

const SECCOMP_FIELD: string = "securityContext.seccompProfile.type";

function checkBaselineSeccomp(
  pod: PodSecurity,
): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  if (
    isSetTo(pod.seccompProfileType) &&
    !ALLOWED_PROFILE_TYPES.has(pod.seccompProfileType)
  ) {
    details.push({ field: SECCOMP_FIELD, value: pod.seccompProfileType });
  }

  for (const container of containersIn(pod)) {
    if (
      isSetTo(container.seccompProfileType) &&
      !ALLOWED_PROFILE_TYPES.has(container.seccompProfileType)
    ) {
      details.push({
        container: container.name,
        field: SECCOMP_FIELD,
        value: container.seccompProfileType,
      });
    }
  }

  return details;
}

function checkSysctls(
  pod: PodSecurity,
  version: KubernetesVersion,
): Array<KubernetesComplianceDetail> {
  const unsafe: Array<string> = (pod.sysctls || []).filter(
    (name: string): boolean => {
      return !isSafeSysctl(name, version);
    },
  );

  return unsafe.length > 0
    ? [{ field: "securityContext.sysctls", value: unsafe.join(", ") }]
    : [];
}

/*
 * ---------------------------------------------------------------------------
 * The Restricted controls
 * ---------------------------------------------------------------------------
 */

function checkVolumeTypes(pod: PodSecurity): Array<KubernetesComplianceDetail> {
  return pod.volumes
    .filter((volume: { type: string }): boolean => {
      return !RESTRICTED_ALLOWED_VOLUME_TYPES.has(volume.type);
    })
    .map(
      (volume: { name: string; type: string }): KubernetesComplianceDetail => {
        return { volume: volume.name, field: volume.type || "volumes[*]" };
      },
    );
}

function checkPrivilegeEscalation(
  pod: PodSecurity,
  version: KubernetesVersion,
): Array<KubernetesComplianceDetail> {
  if (isWindowsPodRelaxed(pod, version)) {
    return [];
  }

  return containersIn(pod)
    .filter((container: PodSecurityContainer): boolean => {
      return container.allowPrivilegeEscalation !== false;
    })
    .map((container: PodSecurityContainer): KubernetesComplianceDetail => {
      return container.allowPrivilegeEscalation === true
        ? {
            container: container.name,
            field: "securityContext.allowPrivilegeEscalation",
            value: "true",
          }
        : {
            container: container.name,
            field: "securityContext.allowPrivilegeEscalation",
            isNotSet: true,
          };
    });
}

const RUN_AS_NON_ROOT_FIELD: string = "securityContext.runAsNonRoot";

function checkRunningAsNonRoot(
  pod: PodSecurity,
  version: KubernetesVersion,
): Array<KubernetesComplianceDetail> {
  if (isInOwnUserNamespace(pod, version)) {
    return [];
  }

  const details: Array<KubernetesComplianceDetail> = [];

  if (pod.runAsNonRoot === false) {
    details.push({ field: RUN_AS_NON_ROOT_FIELD, value: "false" });
  }

  for (const container of containersIn(pod)) {
    if (container.runAsNonRoot === false) {
      details.push({
        container: container.name,
        field: RUN_AS_NON_ROOT_FIELD,
        value: "false",
      });
    } else if (
      container.runAsNonRoot === undefined &&
      pod.runAsNonRoot !== true
    ) {
      // A container may leave it unset only when the pod sets it to true.
      details.push({
        container: container.name,
        field: RUN_AS_NON_ROOT_FIELD,
        isNotSet: true,
      });
    }
  }

  return details;
}

const RUN_AS_USER_FIELD: string = "securityContext.runAsUser";

function checkRunningAsNonRootUser(
  pod: PodSecurity,
  version: KubernetesVersion,
): Array<KubernetesComplianceDetail> {
  if (isInOwnUserNamespace(pod, version)) {
    return [];
  }

  const details: Array<KubernetesComplianceDetail> = [];

  if (pod.runAsUser === 0) {
    details.push({ field: RUN_AS_USER_FIELD, value: "0" });
  }

  for (const container of containersIn(pod)) {
    if (container.runAsUser === 0) {
      details.push({
        container: container.name,
        field: RUN_AS_USER_FIELD,
        value: "0",
      });
    }
  }

  return details;
}

/*
 * Restricted's Seccomp: every container's profile set to RuntimeDefault or
 * Localhost, on the container or on the pod for the containers that leave
 * it unset; Unconfined anywhere fails.
 */
export function getSeccompRestrictedDetails(
  pod: PodSecurity,
): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];
  const isPodSet: boolean = ALLOWED_PROFILE_TYPES.has(
    pod.seccompProfileType || "",
  );

  if (isSetTo(pod.seccompProfileType) && !isPodSet) {
    details.push({ field: SECCOMP_FIELD, value: pod.seccompProfileType });
  }

  for (const container of containersIn(pod)) {
    if (isSetTo(container.seccompProfileType)) {
      if (!ALLOWED_PROFILE_TYPES.has(container.seccompProfileType)) {
        details.push({
          container: container.name,
          field: SECCOMP_FIELD,
          value: container.seccompProfileType,
        });
      }
    } else if (!isPodSet) {
      details.push({
        container: container.name,
        field: SECCOMP_FIELD,
        isNotSet: true,
      });
    }
  }

  return details;
}

function checkRestrictedSeccomp(
  pod: PodSecurity,
  version: KubernetesVersion,
): Array<KubernetesComplianceDetail> {
  return isWindowsPodRelaxed(pod, version)
    ? []
    : getSeccompRestrictedDetails(pod);
}

const CAPABILITIES_DROP_FIELD: string = "securityContext.capabilities.drop";
const CAPABILITIES_ADD_FIELD: string = "securityContext.capabilities.add";

function checkRestrictedCapabilities(
  pod: PodSecurity,
  version: KubernetesVersion,
): Array<KubernetesComplianceDetail> {
  if (isWindowsPodRelaxed(pod, version)) {
    return [];
  }

  const details: Array<KubernetesComplianceDetail> = [];

  for (const container of containersIn(pod)) {
    const dropped: Array<string> = container.capabilitiesDrop || [];

    if (!dropped.includes("ALL")) {
      details.push(
        dropped.length > 0
          ? {
              container: container.name,
              field: CAPABILITIES_DROP_FIELD,
              value: dropped.join(", "),
            }
          : {
              container: container.name,
              field: CAPABILITIES_DROP_FIELD,
              isNotSet: true,
            },
      );
    }

    const added: Array<string> = (container.capabilitiesAdd || []).filter(
      (capability: string): boolean => {
        return capability !== RESTRICTED_ALLOWED_CAPABILITY;
      },
    );

    if (added.length > 0) {
      details.push({
        container: container.name,
        field: CAPABILITIES_ADD_FIELD,
        value: added.join(", "),
      });
    }
  }

  return details;
}

/*
 * ---------------------------------------------------------------------------
 * A pod against a control, and a pod against a level
 * ---------------------------------------------------------------------------
 */

/*
 * What a pod fails one control by: nothing when it meets it, when the
 * control is not part of the level at that version, or when the pod is
 * exempt from it.
 */
export function checkPodSecurityControl(
  control: PodSecurityControl,
  pod: PodSecurity,
  options: PodSecurityOptions,
): Array<KubernetesComplianceDetail> {
  if (
    !getPodSecurityControls(options.level, options.version).includes(control)
  ) {
    return [];
  }

  switch (control) {
    case PodSecurityControl.HostProcess:
      return checkHostProcess(pod);
    case PodSecurityControl.HostNamespaces:
      return checkHostNamespaces(pod);
    case PodSecurityControl.PrivilegedContainers:
      return checkPrivileged(pod);
    case PodSecurityControl.Capabilities:
      return checkBaselineCapabilities(pod);
    case PodSecurityControl.HostPathVolumes:
      return checkHostPathVolumes(pod);
    case PodSecurityControl.HostPorts:
      return checkHostPorts(pod);
    case PodSecurityControl.HostProbes:
      return checkHostProbes(pod);
    case PodSecurityControl.AppArmor:
      return checkAppArmor(pod);
    case PodSecurityControl.SELinux:
      return checkSELinux(pod, options.version);
    case PodSecurityControl.ProcMount:
      return checkProcMount(pod, options);
    case PodSecurityControl.Seccomp:
      return checkBaselineSeccomp(pod);
    case PodSecurityControl.Sysctls:
      return checkSysctls(pod, options.version);
    case PodSecurityControl.VolumeTypes:
      return checkVolumeTypes(pod);
    case PodSecurityControl.PrivilegeEscalation:
      return checkPrivilegeEscalation(pod, options.version);
    case PodSecurityControl.RunningAsNonRoot:
      return checkRunningAsNonRoot(pod, options.version);
    case PodSecurityControl.RunningAsNonRootUser:
      return checkRunningAsNonRootUser(pod, options.version);
    case PodSecurityControl.SeccompRestricted:
      return checkRestrictedSeccomp(pod, options.version);
    case PodSecurityControl.CapabilitiesRestricted:
      return checkRestrictedCapabilities(pod, options.version);
    default:
      return [];
  }
}

export interface PodSecurityViolation {
  control: PodSecurityControl;
  details: Array<KubernetesComplianceDetail>;
}

// Every control of the level the pod fails, in the standard's order.
export function evaluatePodSecurity(
  pod: PodSecurity,
  options: PodSecurityOptions,
): Array<PodSecurityViolation> {
  const violations: Array<PodSecurityViolation> = [];

  for (const control of getPodSecurityControls(
    options.level,
    options.version,
  )) {
    const details: Array<KubernetesComplianceDetail> = checkPodSecurityControl(
      control,
      pod,
      options,
    );

    if (details.length > 0) {
      violations.push({ control, details });
    }
  }

  return violations;
}

export function meetsPodSecurityLevel(
  pod: PodSecurity,
  options: PodSecurityOptions,
): boolean {
  return evaluatePodSecurity(pod, options).length === 0;
}
