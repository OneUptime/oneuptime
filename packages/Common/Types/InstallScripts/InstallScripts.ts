/*
 * The install scripts every OneUptime serves itself, and the files they
 * download.
 *
 * An agent's install command names the OneUptime the reader uses:
 *
 *   curl -fsSL https://oneuptime.com/install/proxmox-agent -o install.sh
 *
 * and a self-hosted OneUptime answers the same address on its own host. The
 * App image carries each entry's folder from the repository
 * (packages/App/Dockerfile.tpl copies it to /usr/src/<sourceDirectory>), and
 * the App serves the files from there (FeatureSet/Install), so a script and
 * every file it downloads are always those of the release the reader runs,
 * never GitHub's master branch. The script downloads its files from
 * <ONEUPTIME_URL>/install/<name>/<file>: the OneUptime it reports to.
 *
 *   /install/<name>          the entry's install script
 *   /install/<name>/<file>   one of its files (the script among them)
 *
 * Only the names and files listed here are served: a request names an entry
 * and a file by its exact text, never a path on disk. Plain values on
 * purpose, so the App, the Dashboard, the docs and the tests read the same
 * ones. A new install script (the CLI's, say) is an entry here, a COPY in
 * the App's Dockerfile and its folder in the repository.
 */

// Where every OneUptime serves them.
export const INSTALL_SCRIPTS_ROUTE: string = "/install";

export enum InstallScriptName {
  CephAgent = "ceph-agent",
  DatabaseAgent = "database-agent",
  DockerSwarmAgent = "docker-swarm-agent",
  HostAiAgent = "host-ai-agent",
  KubernetesAgent = "kubernetes-agent",
  ProxmoxAgent = "proxmox-agent",
  StorageArrayAgent = "storage-array-agent",
  VMwareAgent = "vmware-agent",
}

export interface InstallScriptEntry {
  // The address's last part: /install/<name>.
  name: InstallScriptName;
  // What it installs, as people call it.
  title: string;
  /*
   * The folder in the repository the files come from, relative to its root
   * (agents/ProxmoxAgent). The App image holds it at /usr/src/<folder>.
   */
  sourceDirectory: string;
  /*
   * The script /install/<name> answers with, one of `files`. Null for an
   * entry that only serves files: the Kubernetes agent installs with Helm,
   * and serves its diagnostic script.
   */
  script: string | null;
  // Every file /install/<name>/<file> answers with, relative to the folder.
  files: ReadonlyArray<string>;
}

// The script every agent here installs with, in its folder.
export const INSTALL_SCRIPT_FILE: string = "install.sh";

// The diagnostic script of the agents that have one, in their folder.
export const TROUBLESHOOT_SCRIPT_FILE: string = "troubleshoot.sh";

export const INSTALL_SCRIPTS: ReadonlyArray<InstallScriptEntry> = [
  {
    name: InstallScriptName.CephAgent,
    title: "Ceph agent",
    sourceDirectory: "agents/CephAgent",
    script: INSTALL_SCRIPT_FILE,
    files: [
      INSTALL_SCRIPT_FILE,
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "systemd/oneuptime-ceph-agent.service",
      TROUBLESHOOT_SCRIPT_FILE,
    ],
  },
  {
    name: InstallScriptName.DatabaseAgent,
    title: "Database agent",
    sourceDirectory: "agents/DatabaseAgent",
    script: INSTALL_SCRIPT_FILE,
    files: [
      INSTALL_SCRIPT_FILE,
      "docker-compose.yml",
      "configs/elasticsearch.yaml",
      "configs/memcached.yaml",
      "configs/mongodb.yaml",
      "configs/mysql.yaml",
      "configs/oracledb.yaml",
      "configs/postgresql.yaml",
      "configs/redis.yaml",
      "configs/sqlserver.yaml",
      "systemd/oneuptime-database-agent.service",
      TROUBLESHOOT_SCRIPT_FILE,
    ],
  },
  {
    name: InstallScriptName.DockerSwarmAgent,
    title: "Docker Swarm agent",
    sourceDirectory: "agents/DockerSwarmAgent",
    script: INSTALL_SCRIPT_FILE,
    files: [
      INSTALL_SCRIPT_FILE,
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "inventory-snapshot.sh",
      "systemd/oneuptime-docker-swarm-agent.service",
      TROUBLESHOOT_SCRIPT_FILE,
    ],
  },
  {
    name: InstallScriptName.HostAiAgent,
    title: "Host AI agent",
    sourceDirectory: "agents/HostAIAgent",
    script: INSTALL_SCRIPT_FILE,
    files: [
      INSTALL_SCRIPT_FILE,
      "docker-compose.yml",
      "systemd/oneuptime-host-ai-agent.service",
    ],
  },
  {
    name: InstallScriptName.KubernetesAgent,
    title: "Kubernetes agent",
    sourceDirectory: "HelmChart/Public/kubernetes-agent",
    script: null,
    files: [TROUBLESHOOT_SCRIPT_FILE],
  },
  {
    name: InstallScriptName.ProxmoxAgent,
    title: "Proxmox agent",
    sourceDirectory: "agents/ProxmoxAgent",
    script: INSTALL_SCRIPT_FILE,
    files: [
      INSTALL_SCRIPT_FILE,
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "systemd/oneuptime-proxmox-agent.service",
      TROUBLESHOOT_SCRIPT_FILE,
    ],
  },
  {
    name: InstallScriptName.StorageArrayAgent,
    title: "Storage Array agent",
    sourceDirectory: "agents/StorageArrayAgent",
    script: INSTALL_SCRIPT_FILE,
    files: [
      INSTALL_SCRIPT_FILE,
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "otel-collector-config.flasharray-exporter.yaml",
      "otel-collector-config.flashblade.yaml",
      "systemd/oneuptime-storage-array-agent.service",
      TROUBLESHOOT_SCRIPT_FILE,
    ],
  },
  {
    name: InstallScriptName.VMwareAgent,
    title: "VMware agent",
    sourceDirectory: "agents/VMwareAgent",
    script: INSTALL_SCRIPT_FILE,
    files: [
      INSTALL_SCRIPT_FILE,
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "systemd/oneuptime-vmware-agent.service",
      "systemd/oneuptime-vmware-agent-native.service",
      TROUBLESHOOT_SCRIPT_FILE,
    ],
  },
];

// The entry an address names, or null for a name that is none of them.
export function getInstallScriptEntry(
  name: string | null | undefined,
): InstallScriptEntry | null {
  return (
    INSTALL_SCRIPTS.find((entry: InstallScriptEntry): boolean => {
      return entry.name === name;
    }) || null
  );
}

/*
 * The file of an entry an address names, exactly as the entry lists it, or
 * null. Compared as text: "../x", "configs/../docker-compose.yml" or an
 * absolute path is no file of any entry, so it is never read.
 */
export function getInstallScriptFile(
  entry: InstallScriptEntry,
  file: string | null | undefined,
): string | null {
  return (
    entry.files.find((listed: string): boolean => {
      return listed === file;
    }) || null
  );
}

/*
 * A OneUptime URL without the slashes it may end with:
 * "https://oneuptime.com/" is "https://oneuptime.com". A URL with a path
 * keeps it, so the scripts are found under it.
 */
export function trimOneUptimeUrl(oneuptimeUrl: string): string {
  const trimmed: string = oneuptimeUrl.trim();
  let end: number = trimmed.length;

  while (end > 0 && trimmed.charAt(end - 1) === "/") {
    end--;
  }

  return trimmed.substring(0, end);
}

// https://oneuptime.com/install/proxmox-agent: the entry's install script.
export function getInstallScriptUrl(
  oneuptimeUrl: string,
  name: InstallScriptName,
): string {
  return `${trimOneUptimeUrl(oneuptimeUrl)}${INSTALL_SCRIPTS_ROUTE}/${name}`;
}

// https://oneuptime.com/install/proxmox-agent/docker-compose.yml.
export function getInstallFileUrl(
  oneuptimeUrl: string,
  name: InstallScriptName,
  file: string,
): string {
  return `${getInstallScriptUrl(oneuptimeUrl, name)}/${file}`;
}
