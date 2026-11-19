/*
 * WHAT A POD SAYS ABOUT ITS OWN SECURITY (#9627).
 *
 * The Kubernetes agent sends every pod whole (its k8sobjects pull), but the
 * inventory keeps a pod's spec as the pages read it - its containers, their
 * images, ports and environment - and dropped everything a security review
 * reads: the security contexts, the host namespaces, the token automounting,
 * the ephemeral containers, the secrets a container reads into its
 * environment. So the cluster's Compliance page had nothing to score.
 *
 * readPodSecurity keeps exactly those fields, as one small block on the
 * pod's stored spec (spec.security), with the names Kubernetes gives them:
 * what the Pod Security Standards and the CIS Kubernetes Benchmark's pod
 * controls read, and nothing else. A field the pod does not set is left out,
 * so a pod that sets nothing adds a few bytes.
 *
 * A pod stored before this has no block, and reads as not evaluated until
 * the agent's next pull rewrites it (toPodSecurity). Pure: the ingest, the
 * server's scoring and their tests read it.
 */

// Raised when the block changes shape, so a reader can tell an old one apart.
export const POD_SECURITY_BLOCK_VERSION: number = 1;

// The most entries of one list a block keeps: a pod is never this large.
const MAX_LIST_LENGTH: number = 100;

// The three lists a pod's containers are in, as Kubernetes names them.
export type PodSecurityContainerList =
  | "containers"
  | "initContainers"
  | "ephemeralContainers";

export const POD_SECURITY_CONTAINER_LISTS: ReadonlyArray<PodSecurityContainerList> =
  ["containers", "initContainers", "ephemeralContainers"];

// A probe or a lifecycle hook that names a host: where, and the host.
export interface PodSecurityProbeHost {
  // The field, from the container: "livenessProbe.httpGet.host".
  field: string;
  host: string;
}

// A secret a container reads into one environment variable.
export interface PodSecuritySecretEnv {
  variable: string;
  secret: string;
}

export interface PodSecurityContainer {
  name: string;
  list: PodSecurityContainerList;
  // securityContext, as Kubernetes names its fields.
  privileged?: boolean | undefined;
  allowPrivilegeEscalation?: boolean | undefined;
  capabilitiesAdd?: Array<string> | undefined;
  capabilitiesDrop?: Array<string> | undefined;
  runAsNonRoot?: boolean | undefined;
  runAsUser?: number | undefined;
  seccompProfileType?: string | undefined;
  appArmorProfileType?: string | undefined;
  seLinuxType?: string | undefined;
  seLinuxUser?: string | undefined;
  seLinuxRole?: string | undefined;
  procMount?: string | undefined;
  readOnlyRootFilesystem?: boolean | undefined;
  windowsHostProcess?: boolean | undefined;
  // ports[*].hostPort, those that are set and not 0.
  hostPorts?: Array<number> | undefined;
  // Probes and lifecycle hooks that name a host.
  probeHosts?: Array<PodSecurityProbeHost> | undefined;
  // env[*].valueFrom.secretKeyRef
  secretEnv?: Array<PodSecuritySecretEnv> | undefined;
  // envFrom[*].secretRef.name
  secretEnvFrom?: Array<string> | undefined;
}

export interface PodSecurityVolume {
  name: string;
  // The volume's source, as its spec names it: hostPath, configMap, nfs...
  type: string;
  // A hostPath volume's path.
  hostPath?: string | undefined;
}

export interface PodSecurity {
  version: number;
  hostNetwork?: boolean | undefined;
  hostPID?: boolean | undefined;
  hostIPC?: boolean | undefined;
  hostUsers?: boolean | undefined;
  // spec.os.name: "linux", "windows", or unset.
  osName?: string | undefined;
  automountServiceAccountToken?: boolean | undefined;
  runtimeClassName?: string | undefined;
  // The pod's own securityContext.
  runAsNonRoot?: boolean | undefined;
  runAsUser?: number | undefined;
  seccompProfileType?: string | undefined;
  appArmorProfileType?: string | undefined;
  seLinuxType?: string | undefined;
  seLinuxUser?: string | undefined;
  seLinuxRole?: string | undefined;
  // securityContext.sysctls[*].name
  sysctls?: Array<string> | undefined;
  windowsHostProcess?: boolean | undefined;
  /*
   * metadata.annotations["container.apparmor.security.beta.kubernetes.io/<container>"],
   * by container: the AppArmor profile as Kubernetes set it before the field.
   */
  appArmorAnnotations?: Record<string, string> | undefined;
  containers: Array<PodSecurityContainer>;
  volumes: Array<PodSecurityVolume>;
}

export const APPARMOR_ANNOTATION_PREFIX: string =
  "container.apparmor.security.beta.kubernetes.io/";

// The probes and hooks whose host the standards read, as fields of a container.
const PROBE_HOST_FIELDS: ReadonlyArray<Array<string>> = [
  ["livenessProbe", "httpGet"],
  ["livenessProbe", "tcpSocket"],
  ["readinessProbe", "httpGet"],
  ["readinessProbe", "tcpSocket"],
  ["startupProbe", "httpGet"],
  ["startupProbe", "tcpSocket"],
  ["lifecycle", "postStart", "httpGet"],
  ["lifecycle", "postStart", "tcpSocket"],
  ["lifecycle", "preStop", "httpGet"],
  ["lifecycle", "preStop", "tcpSocket"],
];

type Plain = Record<string, unknown>;

function asObject(value: unknown): Plain {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Plain)
    : {};
}

function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

// A boolean as the wire sends it: true or false, or the strings of them.
function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

const INTEGER_TEXT: RegExp = /^-?[0-9]+$/;

// A whole number as the wire sends it: a number, or its digits.
function readInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && INTEGER_TEXT.test(value.trim())) {
    const parsed: number = parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readTextList(value: unknown): Array<string> | undefined {
  const items: Array<string> = asArray(value)
    .filter((item: unknown): item is string => {
      return typeof item === "string";
    })
    .slice(0, MAX_LIST_LENGTH);

  return items.length > 0 ? items : undefined;
}

// Leaves out what is not set, so a stored block holds only what a pod says.
function withoutUnset<T>(value: T): T {
  const result: Plain = {};

  for (const [key, field] of Object.entries(value as Plain)) {
    if (field !== undefined) {
      result[key] = field;
    }
  }

  return result as T;
}

// What a securityContext says, pod's or container's, by the block's names.
interface SecurityContextFields {
  runAsNonRoot?: boolean | undefined;
  runAsUser?: number | undefined;
  seccompProfileType?: string | undefined;
  appArmorProfileType?: string | undefined;
  seLinuxType?: string | undefined;
  seLinuxUser?: string | undefined;
  seLinuxRole?: string | undefined;
  windowsHostProcess?: boolean | undefined;
}

function readSecurityContextFields(context: Plain): SecurityContextFields {
  const seLinux: Plain = asObject(context["seLinuxOptions"]);

  return {
    runAsNonRoot: readBoolean(context["runAsNonRoot"]),
    runAsUser: readInteger(context["runAsUser"]),
    seccompProfileType: readText(asObject(context["seccompProfile"])["type"]),
    appArmorProfileType: readText(asObject(context["appArmorProfile"])["type"]),
    seLinuxType: readText(seLinux["type"]),
    seLinuxUser: readText(seLinux["user"]),
    seLinuxRole: readText(seLinux["role"]),
    windowsHostProcess: readBoolean(
      asObject(context["windowsOptions"])["hostProcess"],
    ),
  };
}

function readProbeHosts(container: Plain): Array<PodSecurityProbeHost> {
  const hosts: Array<PodSecurityProbeHost> = [];

  for (const path of PROBE_HOST_FIELDS) {
    let node: Plain = container;

    for (const key of path) {
      node = asObject(node[key]);
    }

    const host: string | undefined = readText(node["host"]);

    if (host) {
      hosts.push({ field: `${path.join(".")}.host`, host });
    }
  }

  return hosts;
}

function readContainer(
  value: unknown,
  list: PodSecurityContainerList,
): PodSecurityContainer | null {
  const container: Plain = asObject(value);
  const name: string | undefined = readText(container["name"]);

  if (!name) {
    return null;
  }

  const context: Plain = asObject(container["securityContext"]);
  const capabilities: Plain = asObject(context["capabilities"]);
  const hostPorts: Array<number> = asArray(container["ports"])
    .map((port: unknown): number | undefined => {
      return readInteger(asObject(port)["hostPort"]);
    })
    .filter((port: number | undefined): port is number => {
      return port !== undefined && port !== 0;
    })
    .slice(0, MAX_LIST_LENGTH);
  const secretEnv: Array<PodSecuritySecretEnv> = [];

  for (const variable of asArray(container["env"])) {
    const entry: Plain = asObject(variable);
    const secretRef: Plain = asObject(
      asObject(entry["valueFrom"])["secretKeyRef"],
    );
    const secret: string | undefined = readText(secretRef["name"]);
    const variableName: string | undefined = readText(entry["name"]);

    if (secret && variableName && secretEnv.length < MAX_LIST_LENGTH) {
      secretEnv.push({ variable: variableName, secret });
    }
  }

  const secretEnvFrom: Array<string> = asArray(container["envFrom"])
    .map((source: unknown): string | undefined => {
      return readText(asObject(asObject(source)["secretRef"])["name"]);
    })
    .filter((secret: string | undefined): secret is string => {
      return Boolean(secret);
    })
    .slice(0, MAX_LIST_LENGTH);
  const probeHosts: Array<PodSecurityProbeHost> = readProbeHosts(container);
  const fields: SecurityContextFields = readSecurityContextFields(context);

  return withoutUnset<PodSecurityContainer>({
    name,
    list,
    privileged: readBoolean(context["privileged"]),
    allowPrivilegeEscalation: readBoolean(context["allowPrivilegeEscalation"]),
    capabilitiesAdd: readTextList(capabilities["add"]),
    capabilitiesDrop: readTextList(capabilities["drop"]),
    runAsNonRoot: fields.runAsNonRoot,
    runAsUser: fields.runAsUser,
    seccompProfileType: fields.seccompProfileType,
    appArmorProfileType: fields.appArmorProfileType,
    seLinuxType: fields.seLinuxType,
    seLinuxUser: fields.seLinuxUser,
    seLinuxRole: fields.seLinuxRole,
    procMount: readText(context["procMount"]),
    readOnlyRootFilesystem: readBoolean(context["readOnlyRootFilesystem"]),
    windowsHostProcess: fields.windowsHostProcess,
    hostPorts: hostPorts.length > 0 ? hostPorts : undefined,
    probeHosts: probeHosts.length > 0 ? probeHosts : undefined,
    secretEnv: secretEnv.length > 0 ? secretEnv : undefined,
    secretEnvFrom: secretEnvFrom.length > 0 ? secretEnvFrom : undefined,
  });
}

function readVolume(value: unknown): PodSecurityVolume | null {
  const volume: Plain = asObject(value);
  const name: string | undefined = readText(volume["name"]);

  if (!name) {
    return null;
  }

  // A volume has one source besides its name: the key that names it.
  const type: string =
    Object.keys(volume).find((key: string): boolean => {
      return key !== "name" && volume[key] !== null;
    }) || "";

  return withoutUnset<PodSecurityVolume>({
    name,
    type,
    hostPath:
      type === "hostPath"
        ? readText(asObject(volume["hostPath"])["path"])
        : undefined,
  });
}

/*
 * The block, from a pod's spec as plain JSON (the agent's object, converted
 * from its OTLP encoding) and its annotations.
 */
export function readPodSecurity(
  specValue: unknown,
  annotations?: Record<string, string> | null | undefined,
): PodSecurity {
  const spec: Plain = asObject(specValue);
  const context: Plain = asObject(spec["securityContext"]);
  const fields: SecurityContextFields = readSecurityContextFields(context);
  const containers: Array<PodSecurityContainer> = [];

  for (const list of POD_SECURITY_CONTAINER_LISTS) {
    for (const value of asArray(spec[list])) {
      const container: PodSecurityContainer | null = readContainer(value, list);

      if (container && containers.length < MAX_LIST_LENGTH) {
        containers.push(container);
      }
    }
  }

  const volumes: Array<PodSecurityVolume> = asArray(spec["volumes"])
    .map(readVolume)
    .filter((volume: PodSecurityVolume | null): volume is PodSecurityVolume => {
      return Boolean(volume);
    })
    .slice(0, MAX_LIST_LENGTH);
  const sysctls: Array<string> = asArray(context["sysctls"])
    .map((sysctl: unknown): string | undefined => {
      return readText(asObject(sysctl)["name"]);
    })
    .filter((name: string | undefined): name is string => {
      return Boolean(name);
    })
    .slice(0, MAX_LIST_LENGTH);
  const appArmorAnnotations: Record<string, string> = {};

  for (const [key, value] of Object.entries(annotations || {})) {
    if (
      key.startsWith(APPARMOR_ANNOTATION_PREFIX) &&
      typeof value === "string"
    ) {
      appArmorAnnotations[key.substring(APPARMOR_ANNOTATION_PREFIX.length)] =
        value;
    }
  }

  return withoutUnset<PodSecurity>({
    version: POD_SECURITY_BLOCK_VERSION,
    hostNetwork: readBoolean(spec["hostNetwork"]),
    hostPID: readBoolean(spec["hostPID"]),
    hostIPC: readBoolean(spec["hostIPC"]),
    hostUsers: readBoolean(spec["hostUsers"]),
    osName: readText(asObject(spec["os"])["name"]),
    automountServiceAccountToken: readBoolean(
      spec["automountServiceAccountToken"],
    ),
    runtimeClassName: readText(spec["runtimeClassName"]),
    runAsNonRoot: fields.runAsNonRoot,
    runAsUser: fields.runAsUser,
    seccompProfileType: fields.seccompProfileType,
    appArmorProfileType: fields.appArmorProfileType,
    seLinuxType: fields.seLinuxType,
    seLinuxUser: fields.seLinuxUser,
    seLinuxRole: fields.seLinuxRole,
    sysctls: sysctls.length > 0 ? sysctls : undefined,
    windowsHostProcess: fields.windowsHostProcess,
    appArmorAnnotations:
      Object.keys(appArmorAnnotations).length > 0
        ? appArmorAnnotations
        : undefined,
    containers,
    volumes,
  });
}

/*
 * ---------------------------------------------------------------------------
 * A stored block, read back
 * ---------------------------------------------------------------------------
 */

function readStoredHostPorts(value: unknown): Array<number> | undefined {
  const ports: Array<number> = asArray(value)
    .map(readInteger)
    .filter((port: number | undefined): port is number => {
      return port !== undefined && port !== 0;
    });

  return ports.length > 0 ? ports : undefined;
}

function readStoredProbeHosts(
  value: unknown,
): Array<PodSecurityProbeHost> | undefined {
  const hosts: Array<PodSecurityProbeHost> = [];

  for (const item of asArray(value)) {
    const entry: Plain = asObject(item);
    const field: string | undefined = readText(entry["field"]);
    const host: string | undefined = readText(entry["host"]);

    if (field && host) {
      hosts.push({ field, host });
    }
  }

  return hosts.length > 0 ? hosts : undefined;
}

function readStoredSecretEnv(
  value: unknown,
): Array<PodSecuritySecretEnv> | undefined {
  const variables: Array<PodSecuritySecretEnv> = [];

  for (const item of asArray(value)) {
    const entry: Plain = asObject(item);
    const variable: string | undefined = readText(entry["variable"]);
    const secret: string | undefined = readText(entry["secret"]);

    if (variable && secret) {
      variables.push({ variable, secret });
    }
  }

  return variables.length > 0 ? variables : undefined;
}

function readStoredContainer(value: unknown): PodSecurityContainer | null {
  const container: Plain = asObject(value);
  const name: string | undefined = readText(container["name"]);
  const list: PodSecurityContainerList | undefined =
    POD_SECURITY_CONTAINER_LISTS.find(
      (each: PodSecurityContainerList): boolean => {
        return each === container["list"];
      },
    );

  if (!name || !list) {
    return null;
  }

  return withoutUnset<PodSecurityContainer>({
    name,
    list,
    privileged: readBoolean(container["privileged"]),
    allowPrivilegeEscalation: readBoolean(
      container["allowPrivilegeEscalation"],
    ),
    capabilitiesAdd: readTextList(container["capabilitiesAdd"]),
    capabilitiesDrop: readTextList(container["capabilitiesDrop"]),
    runAsNonRoot: readBoolean(container["runAsNonRoot"]),
    runAsUser: readInteger(container["runAsUser"]),
    seccompProfileType: readText(container["seccompProfileType"]),
    appArmorProfileType: readText(container["appArmorProfileType"]),
    seLinuxType: readText(container["seLinuxType"]),
    seLinuxUser: readText(container["seLinuxUser"]),
    seLinuxRole: readText(container["seLinuxRole"]),
    procMount: readText(container["procMount"]),
    readOnlyRootFilesystem: readBoolean(container["readOnlyRootFilesystem"]),
    windowsHostProcess: readBoolean(container["windowsHostProcess"]),
    hostPorts: readStoredHostPorts(container["hostPorts"]),
    probeHosts: readStoredProbeHosts(container["probeHosts"]),
    secretEnv: readStoredSecretEnv(container["secretEnv"]),
    secretEnvFrom: readTextList(container["secretEnvFrom"]),
  });
}

function readStoredVolume(value: unknown): PodSecurityVolume | null {
  const volume: Plain = asObject(value);
  const name: string | undefined = readText(volume["name"]);
  const type: string | undefined = readText(volume["type"]);

  if (!name || type === undefined) {
    return null;
  }

  return withoutUnset<PodSecurityVolume>({
    name,
    type,
    hostPath: readText(volume["hostPath"]),
  });
}

/*
 * A stored block read back, defensively: the version this server knows, and
 * every field of the type it should be; anything else is null, and the pod
 * reads as not evaluated rather than as one that sets nothing.
 */
export function toPodSecurity(value: unknown): PodSecurity | null {
  const block: Plain = asObject(value);

  if (
    block["version"] !== POD_SECURITY_BLOCK_VERSION ||
    !Array.isArray(block["containers"]) ||
    !Array.isArray(block["volumes"])
  ) {
    return null;
  }

  const containers: Array<PodSecurityContainer> = asArray(block["containers"])
    .map(readStoredContainer)
    .filter(
      (
        container: PodSecurityContainer | null,
      ): container is PodSecurityContainer => {
        return Boolean(container);
      },
    );
  const volumes: Array<PodSecurityVolume> = asArray(block["volumes"])
    .map(readStoredVolume)
    .filter((volume: PodSecurityVolume | null): volume is PodSecurityVolume => {
      return Boolean(volume);
    });
  const annotations: Record<string, string> = {};

  for (const [container, profile] of Object.entries(
    asObject(block["appArmorAnnotations"]),
  )) {
    if (typeof profile === "string") {
      annotations[container] = profile;
    }
  }

  return withoutUnset<PodSecurity>({
    version: POD_SECURITY_BLOCK_VERSION,
    hostNetwork: readBoolean(block["hostNetwork"]),
    hostPID: readBoolean(block["hostPID"]),
    hostIPC: readBoolean(block["hostIPC"]),
    hostUsers: readBoolean(block["hostUsers"]),
    osName: readText(block["osName"]),
    automountServiceAccountToken: readBoolean(
      block["automountServiceAccountToken"],
    ),
    runtimeClassName: readText(block["runtimeClassName"]),
    runAsNonRoot: readBoolean(block["runAsNonRoot"]),
    runAsUser: readInteger(block["runAsUser"]),
    seccompProfileType: readText(block["seccompProfileType"]),
    appArmorProfileType: readText(block["appArmorProfileType"]),
    seLinuxType: readText(block["seLinuxType"]),
    seLinuxUser: readText(block["seLinuxUser"]),
    seLinuxRole: readText(block["seLinuxRole"]),
    sysctls: readTextList(block["sysctls"]),
    windowsHostProcess: readBoolean(block["windowsHostProcess"]),
    appArmorAnnotations:
      Object.keys(annotations).length > 0 ? annotations : undefined,
    containers,
    volumes,
  });
}
