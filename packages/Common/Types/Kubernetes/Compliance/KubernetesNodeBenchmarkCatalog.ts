import {
  NodeBenchmarkFamily,
  getNodeBenchmarkRequirement,
  readNodeBenchmarkRequirement,
  sortCheckIds,
} from "../KubernetesNodeBenchmark";

/*
 * THE CIS BENCHMARKS' NODE AND CONTROL PLANE CONTROLS, AS KUBE-BENCH READS
 * THEM (#9873).
 *
 * Each control a supported benchmark scores - kube-bench marks it automated -
 * with a short title of OneUptime's own and how to fix it in a line, never
 * the benchmark's text, which CIS licenses for non-commercial use; each
 * keeps the benchmark's number. The checks are named by what they check, so
 * the managed platforms' benchmarks (CIS Amazon EKS, GKE and AKS Benchmarks)
 * share the generic benchmark's words where they check the same thing, and
 * keep a fix of their own where their files live elsewhere.
 *
 * A fix is a sentence with what to set or run in it, drawn as code in every
 * language: "Set {{setting}} in the API server's manifest on each control
 * plane node." with `--profiling=false`. Paths are kubeadm's on the generic
 * benchmark, each platform's own on its benchmark's.
 *
 * Only the words the file marks are translated (the Dashboard's i18n reads
 * this file for them).
 */

// Marks a string as a key of the Dashboard's locales, as TranslateTemplate's translationKey does.
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * ---------------------------------------------------------------------------
 * How each is fixed: a sentence with what to set in it
 * ---------------------------------------------------------------------------
 */

// Each takes {{setting}}, or {{value}} and {{flag}}, drawn as code.
const FIX: Readonly<Record<string, string>> = {
  apiServerSet: translationKey(
    "Set {{setting}} in the API server's manifest on each control plane node.",
  ),
  apiServerRemove: translationKey(
    "Remove {{setting}} from the API server's manifest on each control plane node.",
  ),
  apiServerAdd: translationKey(
    "Add {{value}} to the API server's {{flag}} on each control plane node.",
  ),
  apiServerLeaveOut: translationKey(
    "Leave {{value}} out of the API server's {{flag}} on each control plane node.",
  ),
  controllerManagerSet: translationKey(
    "Set {{setting}} in the controller manager's manifest on each control plane node.",
  ),
  controllerManagerLeaveOut: translationKey(
    "Leave {{value}} out of the controller manager's {{flag}} on each control plane node.",
  ),
  schedulerSet: translationKey(
    "Set {{setting}} in the scheduler's manifest on each control plane node.",
  ),
  etcdSet: translationKey(
    "Set {{setting}} in etcd's manifest on each node that runs it.",
  ),
  kubeletSet: translationKey(
    "Set {{setting}} in the kubelet's configuration file on each node, then restart the kubelet.",
  ),
  kubeProxySet: translationKey(
    "Set {{setting}} in kube-proxy's configuration, then restart its pods.",
  ),
  controlPlaneFile: translationKey(
    "Run {{setting}} on each control plane node.",
  ),
  nodeFile: translationKey("Run {{setting}} on each node."),
};

export interface NodeBenchmarkFix {
  // A sentence of FIX's, in the reader's language.
  template: string;
  // What it says to set or run, as written: drawn as code.
  slots: Record<string, string>;
}

export interface NodeBenchmarkCheckWords {
  title: string;
  fix: NodeBenchmarkFix;
}

function set(template: string, setting: string): NodeBenchmarkFix {
  return { template, slots: { setting } };
}

function valueOf(
  template: string,
  value: string,
  flag: string,
): NodeBenchmarkFix {
  return { template, slots: { value, flag } };
}

/*
 * ---------------------------------------------------------------------------
 * The checks, by what they check
 * ---------------------------------------------------------------------------
 */

const PERMISSIONS_600: string = "chmod 600";
const OWNED_BY_ROOT: string = "chown root:root";

function controlPlaneFile(
  title: string,
  command: string,
  path: string,
): NodeBenchmarkCheckWords {
  return { title, fix: set(FIX["controlPlaneFile"]!, `${command} ${path}`) };
}

function nodeFile(
  title: string,
  command: string,
  path: string,
): NodeBenchmarkCheckWords {
  return { title, fix: set(FIX["nodeFile"]!, `${command} ${path}`) };
}

const KUBELET_KUBECONFIG_600: string = translationKey(
  "Kubelet kubeconfig: permissions 600 or stricter",
);
const KUBELET_KUBECONFIG_644: string = translationKey(
  "Kubelet kubeconfig: permissions 644 or stricter",
);
const KUBELET_KUBECONFIG_OWNER: string = translationKey(
  "Kubelet kubeconfig owned by root:root",
);
const KUBELET_CONFIG_600: string = translationKey(
  "Kubelet configuration file: permissions 600 or stricter",
);
const KUBELET_CONFIG_644: string = translationKey(
  "Kubelet configuration file: permissions 644 or stricter",
);
const KUBELET_CONFIG_OWNER: string = translationKey(
  "Kubelet configuration file owned by root:root",
);

const KUBELET_CHECKS: Readonly<Record<string, NodeBenchmarkCheckWords>> = {
  anonymousAuth: {
    title: translationKey("Kubelet: anonymous requests refused"),
    fix: set(FIX["kubeletSet"]!, "authentication.anonymous.enabled: false"),
  },
  authorizationMode: {
    title: translationKey("Kubelet: no AlwaysAllow authorization"),
    fix: set(FIX["kubeletSet"]!, "authorization.mode: Webhook"),
  },
  clientCa: {
    title: translationKey("Kubelet: client CA"),
    fix: set(FIX["kubeletSet"]!, "authentication.x509.clientCAFile: <CA file>"),
  },
  readOnlyPort: {
    title: translationKey("Kubelet: read-only port closed"),
    fix: set(FIX["kubeletSet"]!, "readOnlyPort: 0"),
  },
  streamingIdleTimeout: {
    title: translationKey("Kubelet: idle streaming connections time out"),
    fix: set(FIX["kubeletSet"]!, "streamingConnectionIdleTimeout: 4h0m0s"),
  },
  iptablesUtilChains: {
    title: translationKey("Kubelet manages its iptables chains"),
    fix: set(FIX["kubeletSet"]!, "makeIPTablesUtilChains: true"),
  },
  eventRecordQps: {
    title: translationKey("Kubelet: every event recorded"),
    fix: set(FIX["kubeletSet"]!, "eventRecordQPS: 0"),
  },
  rotateCertificates: {
    title: translationKey("Kubelet: client certificates rotated"),
    fix: set(FIX["kubeletSet"]!, "rotateCertificates: true"),
  },
  rotateServerCertificates: {
    title: translationKey("Kubelet: serving certificates rotated"),
    fix: set(
      FIX["kubeletSet"]!,
      "featureGates.RotateKubeletServerCertificate: true",
    ),
  },
};

/*
 * The generic CIS Kubernetes Benchmark's (cis-1.12, cis-1.11): sections 1
 * to 4, as kube-bench numbers them, and as OneUptime's CIS Kubernetes
 * Benchmark v2.0 does.
 */
const CIS_CHECKS: Readonly<Record<string, NodeBenchmarkCheckWords>> = {
  "1.1.1": controlPlaneFile(
    translationKey("API server manifest: permissions 600 or stricter"),
    PERMISSIONS_600,
    "/etc/kubernetes/manifests/kube-apiserver.yaml",
  ),
  "1.1.2": controlPlaneFile(
    translationKey("API server manifest owned by root:root"),
    OWNED_BY_ROOT,
    "/etc/kubernetes/manifests/kube-apiserver.yaml",
  ),
  "1.1.3": controlPlaneFile(
    translationKey("Controller manager manifest: permissions 600 or stricter"),
    PERMISSIONS_600,
    "/etc/kubernetes/manifests/kube-controller-manager.yaml",
  ),
  "1.1.4": controlPlaneFile(
    translationKey("Controller manager manifest owned by root:root"),
    OWNED_BY_ROOT,
    "/etc/kubernetes/manifests/kube-controller-manager.yaml",
  ),
  "1.1.5": controlPlaneFile(
    translationKey("Scheduler manifest: permissions 600 or stricter"),
    PERMISSIONS_600,
    "/etc/kubernetes/manifests/kube-scheduler.yaml",
  ),
  "1.1.6": controlPlaneFile(
    translationKey("Scheduler manifest owned by root:root"),
    OWNED_BY_ROOT,
    "/etc/kubernetes/manifests/kube-scheduler.yaml",
  ),
  "1.1.7": controlPlaneFile(
    translationKey("etcd manifest: permissions 600 or stricter"),
    PERMISSIONS_600,
    "/etc/kubernetes/manifests/etcd.yaml",
  ),
  "1.1.8": controlPlaneFile(
    translationKey("etcd manifest owned by root:root"),
    OWNED_BY_ROOT,
    "/etc/kubernetes/manifests/etcd.yaml",
  ),
  "1.1.11": controlPlaneFile(
    translationKey("etcd data directory: permissions 700 or stricter"),
    "chmod 700",
    "/var/lib/etcd",
  ),
  "1.1.12": controlPlaneFile(
    translationKey("etcd data directory owned by etcd:etcd"),
    "chown etcd:etcd",
    "/var/lib/etcd",
  ),
  "1.1.13": controlPlaneFile(
    translationKey(
      "admin.conf and super-admin.conf: permissions 600 or stricter",
    ),
    PERMISSIONS_600,
    "/etc/kubernetes/admin.conf /etc/kubernetes/super-admin.conf",
  ),
  "1.1.14": controlPlaneFile(
    translationKey("admin.conf and super-admin.conf owned by root:root"),
    OWNED_BY_ROOT,
    "/etc/kubernetes/admin.conf /etc/kubernetes/super-admin.conf",
  ),
  "1.1.15": controlPlaneFile(
    translationKey("Scheduler kubeconfig: permissions 600 or stricter"),
    PERMISSIONS_600,
    "/etc/kubernetes/scheduler.conf",
  ),
  "1.1.16": controlPlaneFile(
    translationKey("Scheduler kubeconfig owned by root:root"),
    OWNED_BY_ROOT,
    "/etc/kubernetes/scheduler.conf",
  ),
  "1.1.17": controlPlaneFile(
    translationKey(
      "Controller manager kubeconfig: permissions 600 or stricter",
    ),
    PERMISSIONS_600,
    "/etc/kubernetes/controller-manager.conf",
  ),
  "1.1.18": controlPlaneFile(
    translationKey("Controller manager kubeconfig owned by root:root"),
    OWNED_BY_ROOT,
    "/etc/kubernetes/controller-manager.conf",
  ),
  "1.1.19": controlPlaneFile(
    translationKey("Kubernetes PKI directory and files owned by root:root"),
    "chown -R root:root",
    "/etc/kubernetes/pki/",
  ),
  "1.2.2": {
    title: translationKey("API server: no static token file"),
    fix: set(FIX["apiServerRemove"]!, "--token-auth-file"),
  },
  "1.2.4": {
    title: translationKey("API server: kubelet client certificate and key"),
    fix: set(
      FIX["apiServerSet"]!,
      "--kubelet-client-certificate=<file> --kubelet-client-key=<file>",
    ),
  },
  "1.2.5": {
    title: translationKey("API server verifies kubelets' serving certificates"),
    fix: set(FIX["apiServerSet"]!, "--kubelet-certificate-authority=<CA file>"),
  },
  "1.2.6": {
    title: translationKey("API server: no AlwaysAllow authorization"),
    fix: valueOf(
      FIX["apiServerLeaveOut"]!,
      "AlwaysAllow",
      "--authorization-mode",
    ),
  },
  "1.2.7": {
    title: translationKey("API server: Node authorization"),
    fix: valueOf(FIX["apiServerAdd"]!, "Node", "--authorization-mode"),
  },
  "1.2.8": {
    title: translationKey("API server: RBAC authorization"),
    fix: valueOf(FIX["apiServerAdd"]!, "RBAC", "--authorization-mode"),
  },
  "1.2.10": {
    title: translationKey("Admission plugin AlwaysAdmit off"),
    fix: valueOf(
      FIX["apiServerLeaveOut"]!,
      "AlwaysAdmit",
      "--enable-admission-plugins",
    ),
  },
  "1.2.12": {
    title: translationKey("Admission plugin ServiceAccount on"),
    fix: valueOf(
      FIX["apiServerLeaveOut"]!,
      "ServiceAccount",
      "--disable-admission-plugins",
    ),
  },
  "1.2.13": {
    title: translationKey("Admission plugin NamespaceLifecycle on"),
    fix: valueOf(
      FIX["apiServerLeaveOut"]!,
      "NamespaceLifecycle",
      "--disable-admission-plugins",
    ),
  },
  "1.2.14": {
    title: translationKey("Admission plugin NodeRestriction on"),
    fix: valueOf(
      FIX["apiServerAdd"]!,
      "NodeRestriction",
      "--enable-admission-plugins",
    ),
  },
  "1.2.15": {
    title: translationKey("API server: profiling off"),
    fix: set(FIX["apiServerSet"]!, "--profiling=false"),
  },
  "1.2.16": {
    title: translationKey("API server: audit log"),
    fix: set(FIX["apiServerSet"]!, "--audit-log-path=<file>"),
  },
  "1.2.17": {
    title: translationKey("API server: audit logs kept 30 days or more"),
    fix: set(FIX["apiServerSet"]!, "--audit-log-maxage=30"),
  },
  "1.2.18": {
    title: translationKey("API server: 10 audit log files or more kept"),
    fix: set(FIX["apiServerSet"]!, "--audit-log-maxbackup=10"),
  },
  "1.2.19": {
    title: translationKey(
      "API server: audit log files rotated at 100 MB or more",
    ),
    fix: set(FIX["apiServerSet"]!, "--audit-log-maxsize=100"),
  },
  "1.2.21": {
    title: translationKey(
      "API server checks service account tokens against etcd",
    ),
    fix: set(FIX["apiServerSet"]!, "--service-account-lookup=true"),
  },
  "1.2.22": {
    title: translationKey("API server: service account key file"),
    fix: set(FIX["apiServerSet"]!, "--service-account-key-file=<file>"),
  },
  "1.2.23": {
    title: translationKey("API server: client certificate for etcd"),
    fix: set(
      FIX["apiServerSet"]!,
      "--etcd-certfile=<file> --etcd-keyfile=<file>",
    ),
  },
  "1.2.24": {
    title: translationKey("API server: TLS certificate and key"),
    fix: set(
      FIX["apiServerSet"]!,
      "--tls-cert-file=<file> --tls-private-key-file=<file>",
    ),
  },
  "1.2.25": {
    title: translationKey("API server: client CA"),
    fix: set(FIX["apiServerSet"]!, "--client-ca-file=<CA file>"),
  },
  "1.2.26": {
    title: translationKey("API server verifies etcd's certificate"),
    fix: set(FIX["apiServerSet"]!, "--etcd-cafile=<CA file>"),
  },
  "1.2.30": {
    title: translationKey("API server: service account tokens not extended"),
    fix: set(
      FIX["apiServerSet"]!,
      "--service-account-extend-token-expiration=false",
    ),
  },
  "1.3.2": {
    title: translationKey("Controller manager: profiling off"),
    fix: set(FIX["controllerManagerSet"]!, "--profiling=false"),
  },
  "1.3.3": {
    title: translationKey(
      "Controller manager: a service account per controller",
    ),
    fix: set(
      FIX["controllerManagerSet"]!,
      "--use-service-account-credentials=true",
    ),
  },
  "1.3.4": {
    title: translationKey("Controller manager: service account private key"),
    fix: set(
      FIX["controllerManagerSet"]!,
      "--service-account-private-key-file=<file>",
    ),
  },
  "1.3.5": {
    title: translationKey("Controller manager: root CA for service accounts"),
    fix: set(FIX["controllerManagerSet"]!, "--root-ca-file=<CA file>"),
  },
  "1.3.6": {
    title: translationKey(
      "Controller manager: kubelet serving certificates rotated",
    ),
    fix: valueOf(
      FIX["controllerManagerLeaveOut"]!,
      "RotateKubeletServerCertificate=false",
      "--feature-gates",
    ),
  },
  "1.3.7": {
    title: translationKey("Controller manager bound to localhost"),
    fix: set(FIX["controllerManagerSet"]!, "--bind-address=127.0.0.1"),
  },
  "1.4.1": {
    title: translationKey("Scheduler: profiling off"),
    fix: set(FIX["schedulerSet"]!, "--profiling=false"),
  },
  "1.4.2": {
    title: translationKey("Scheduler bound to localhost"),
    fix: set(FIX["schedulerSet"]!, "--bind-address=127.0.0.1"),
  },
  "2.1": {
    title: translationKey("etcd: TLS certificate and key"),
    fix: set(FIX["etcdSet"]!, "--cert-file=<file> --key-file=<file>"),
  },
  "2.2": {
    title: translationKey("etcd: client certificates required"),
    fix: set(FIX["etcdSet"]!, "--client-cert-auth=true"),
  },
  "2.3": {
    title: translationKey("etcd: no self-signed TLS"),
    fix: set(FIX["etcdSet"]!, "--auto-tls=false"),
  },
  "2.4": {
    title: translationKey("etcd: peer TLS certificate and key"),
    fix: set(FIX["etcdSet"]!, "--peer-cert-file=<file> --peer-key-file=<file>"),
  },
  "2.5": {
    title: translationKey("etcd: peer certificates required"),
    fix: set(FIX["etcdSet"]!, "--peer-client-cert-auth=true"),
  },
  "2.6": {
    title: translationKey("etcd: no self-signed peer TLS"),
    fix: set(FIX["etcdSet"]!, "--peer-auto-tls=false"),
  },
  "4.1.1": nodeFile(
    translationKey("Kubelet service file: permissions 600 or stricter"),
    PERMISSIONS_600,
    "/etc/systemd/system/kubelet.service.d/10-kubeadm.conf",
  ),
  "4.1.2": nodeFile(
    translationKey("Kubelet service file owned by root:root"),
    OWNED_BY_ROOT,
    "/etc/systemd/system/kubelet.service.d/10-kubeadm.conf",
  ),
  "4.1.5": nodeFile(
    KUBELET_KUBECONFIG_600,
    PERMISSIONS_600,
    "/etc/kubernetes/kubelet.conf",
  ),
  "4.1.6": nodeFile(
    KUBELET_KUBECONFIG_OWNER,
    OWNED_BY_ROOT,
    "/etc/kubernetes/kubelet.conf",
  ),
  "4.1.9": nodeFile(
    KUBELET_CONFIG_600,
    PERMISSIONS_600,
    "/var/lib/kubelet/config.yaml",
  ),
  "4.1.10": nodeFile(
    KUBELET_CONFIG_OWNER,
    OWNED_BY_ROOT,
    "/var/lib/kubelet/config.yaml",
  ),
  "4.2.1": KUBELET_CHECKS["anonymousAuth"]!,
  "4.2.2": KUBELET_CHECKS["authorizationMode"]!,
  "4.2.3": KUBELET_CHECKS["clientCa"]!,
  "4.2.6": KUBELET_CHECKS["iptablesUtilChains"]!,
  "4.2.10": KUBELET_CHECKS["rotateCertificates"]!,
  "4.3.1": {
    title: translationKey("kube-proxy metrics bound to localhost"),
    fix: set(FIX["kubeProxySet"]!, "metricsBindAddress: 127.0.0.1:10249"),
  },
};

/*
 * A managed platform's worker node section: the kubelet's files where that
 * platform's nodes keep them, and the kubelet's configuration.
 */
function managedNodeChecks(paths: {
  kubeconfig: string;
  config: string;
}): Record<string, NodeBenchmarkCheckWords> {
  return {
    "3.1.1": nodeFile(KUBELET_KUBECONFIG_644, "chmod 644", paths.kubeconfig),
    "3.1.2": nodeFile(
      KUBELET_KUBECONFIG_OWNER,
      OWNED_BY_ROOT,
      paths.kubeconfig,
    ),
    "3.1.3": nodeFile(KUBELET_CONFIG_644, "chmod 644", paths.config),
    "3.1.4": nodeFile(KUBELET_CONFIG_OWNER, OWNED_BY_ROOT, paths.config),
    "3.2.1": KUBELET_CHECKS["anonymousAuth"]!,
    "3.2.2": KUBELET_CHECKS["authorizationMode"]!,
    "3.2.3": KUBELET_CHECKS["clientCa"]!,
    "3.2.4": KUBELET_CHECKS["readOnlyPort"]!,
    "3.2.5": KUBELET_CHECKS["streamingIdleTimeout"]!,
    "3.2.6": KUBELET_CHECKS["iptablesUtilChains"]!,
    "3.2.7": KUBELET_CHECKS["eventRecordQps"]!,
    "3.2.8": KUBELET_CHECKS["rotateCertificates"]!,
    "3.2.9": KUBELET_CHECKS["rotateServerCertificates"]!,
  };
}

const EKS_CHECKS: Readonly<Record<string, NodeBenchmarkCheckWords>> =
  managedNodeChecks({
    kubeconfig: "/var/lib/kubelet/kubeconfig",
    config: "/etc/kubernetes/kubelet/config.json",
  });

const AKS_CHECKS: Readonly<Record<string, NodeBenchmarkCheckWords>> =
  managedNodeChecks({
    kubeconfig: "/var/lib/kubelet/kubeconfig",
    config: "/etc/default/kubeletconfig.json",
  });

// The CIS GKE Benchmark scores the kubelet's files on the node; GKE sets the rest.
const GKE_CHECKS: Readonly<Record<string, NodeBenchmarkCheckWords>> =
  ((): Record<string, NodeBenchmarkCheckWords> => {
    const all: Record<string, NodeBenchmarkCheckWords> = managedNodeChecks({
      kubeconfig: "/var/lib/kubelet/kubeconfig",
      config: "/home/kubernetes/kubelet-config.yaml",
    });

    return {
      "3.1.1": all["3.1.1"]!,
      "3.1.2": all["3.1.2"]!,
      "3.1.3": all["3.1.3"]!,
      "3.1.4": all["3.1.4"]!,
    };
  })();

const CHECKS_BY_FAMILY: Readonly<
  Record<NodeBenchmarkFamily, Readonly<Record<string, NodeBenchmarkCheckWords>>>
> = {
  [NodeBenchmarkFamily.Cis]: CIS_CHECKS,
  [NodeBenchmarkFamily.Eks]: EKS_CHECKS,
  [NodeBenchmarkFamily.Gke]: GKE_CHECKS,
  [NodeBenchmarkFamily.Aks]: AKS_CHECKS,
};

/*
 * ---------------------------------------------------------------------------
 * Sections: what each looks at
 * ---------------------------------------------------------------------------
 */

export interface NodeBenchmarkSection {
  // The section's number: "1.1", "4.2", "3.1".
  id: string;
  // What its controls look at, in a sentence: each of its controls says it.
  description: string;
  // Read on a control plane node: the API server's, etcd's and their files.
  isControlPlane: boolean;
}

const CIS_SECTIONS: ReadonlyArray<NodeBenchmarkSection> = [
  {
    id: "1.1",
    description: translationKey(
      "The control plane's manifests, kubeconfig files and certificates, on each control plane node.",
    ),
    isControlPlane: true,
  },
  {
    id: "1.2",
    description: translationKey(
      "The API server's flags, as it runs on each control plane node.",
    ),
    isControlPlane: true,
  },
  {
    id: "1.3",
    description: translationKey(
      "The controller manager's flags, as it runs on each control plane node.",
    ),
    isControlPlane: true,
  },
  {
    id: "1.4",
    description: translationKey(
      "The scheduler's flags, as it runs on each control plane node.",
    ),
    isControlPlane: true,
  },
  {
    id: "2",
    description: translationKey(
      "etcd's flags, as it runs on each node that runs it.",
    ),
    isControlPlane: true,
  },
  {
    id: "4.1",
    description: translationKey(
      "The kubelet's service, kubeconfig and configuration files, on each node.",
    ),
    isControlPlane: false,
  },
  {
    id: "4.2",
    description: translationKey(
      "The kubelet's configuration and flags, on each node.",
    ),
    isControlPlane: false,
  },
  {
    id: "4.3",
    description: translationKey("kube-proxy's configuration, on each node."),
    isControlPlane: false,
  },
];

const MANAGED_SECTIONS: ReadonlyArray<NodeBenchmarkSection> = [
  {
    id: "3.1",
    description: translationKey(
      "The kubelet's kubeconfig and configuration files, on each worker node.",
    ),
    isControlPlane: false,
  },
  {
    id: "3.2",
    description: translationKey(
      "The kubelet's configuration and flags, on each worker node.",
    ),
    isControlPlane: false,
  },
];

export function getNodeBenchmarkSections(
  family: NodeBenchmarkFamily,
): ReadonlyArray<NodeBenchmarkSection> {
  return family === NodeBenchmarkFamily.Cis ? CIS_SECTIONS : MANAGED_SECTIONS;
}

// The section a check is in: the longest section number its own begins with.
export function getNodeBenchmarkSection(
  family: NodeBenchmarkFamily,
  checkId: string,
): NodeBenchmarkSection | null {
  let found: NodeBenchmarkSection | null = null;

  for (const section of getNodeBenchmarkSections(family)) {
    if (
      checkId.startsWith(`${section.id}.`) &&
      (!found || section.id.length > found.id.length)
    ) {
      found = section;
    }
  }

  return found;
}

/*
 * ---------------------------------------------------------------------------
 * A control as the page reads it
 * ---------------------------------------------------------------------------
 */

export interface NodeBenchmarkControlInfo {
  family: NodeBenchmarkFamily;
  // The benchmark's own number: "1.2.15", "3.2.1".
  checkId: string;
  // The requirement it is scored under: "1.2.15", "EKS 3.2.1".
  requirement: string;
  title: string;
  description: string;
  fix: NodeBenchmarkFix;
  isControlPlane: boolean;
}

// A check kube-bench scored that this catalog does not name: its number, no fix.
const UNNAMED_TITLE: string = translationKey("Checked by kube-bench");

const UNNAMED_DESCRIPTION: string = translationKey(
  "A control of the benchmark kube-bench ran, which OneUptime does not describe yet.",
);

export function getNodeBenchmarkControlInfo(
  family: NodeBenchmarkFamily,
  checkId: string,
): NodeBenchmarkControlInfo {
  const words: NodeBenchmarkCheckWords | undefined =
    CHECKS_BY_FAMILY[family][checkId];
  const section: NodeBenchmarkSection | null = getNodeBenchmarkSection(
    family,
    checkId,
  );

  return {
    family,
    checkId,
    requirement: getNodeBenchmarkRequirement(family, checkId),
    title: words?.title || UNNAMED_TITLE,
    description: words ? section?.description || "" : UNNAMED_DESCRIPTION,
    fix: words?.fix || { template: "", slots: {} },
    isControlPlane: Boolean(section?.isControlPlane),
  };
}

// The info of a requirement a node control is scored under, or null for any other.
export function findNodeBenchmarkControlInfo(
  requirement: string,
): NodeBenchmarkControlInfo | null {
  const named: { family: NodeBenchmarkFamily; checkId: string } | null =
    readNodeBenchmarkRequirement(requirement);

  return named
    ? getNodeBenchmarkControlInfo(named.family, named.checkId)
    : null;
}

// Every check a family's benchmark scores that this catalog names, in its order.
export function getNamedNodeBenchmarkChecks(
  family: NodeBenchmarkFamily,
): Array<string> {
  return sortCheckIds(Object.keys(CHECKS_BY_FAMILY[family]));
}

// Every translated word of a fix, for the guards that read this file.
export const NODE_BENCHMARK_FIX_TEMPLATES: ReadonlyArray<string> =
  Object.values(FIX);
