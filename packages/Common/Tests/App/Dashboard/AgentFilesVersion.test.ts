import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  AGENT_KINDS,
  AgentKind,
  AgentLatestVersionSource,
  CEPH_AGENT_VERSION,
  DATABASE_AGENT_VERSION,
  DOCKER_SWARM_AGENT_COLLECTOR_VERSION,
  DOCKER_SWARM_AGENT_VERSION,
  PROXMOX_AGENT_COLLECTOR_VERSION,
  PROXMOX_AGENT_VERSION,
  STORAGE_ARRAY_AGENT_COLLECTOR_VERSION,
  STORAGE_ARRAY_AGENT_VERSION,
  VMWARE_AGENT_VERSION,
  getAgentVersionState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import {
  INSTALL_SCRIPTS,
  INSTALL_SCRIPT_FILE,
  InstallScriptEntry,
  TROUBLESHOOT_SCRIPT_FILE,
} from "../../../Types/InstallScripts/InstallScripts";
import { AgentVersionStatus } from "../../../Utils/AgentVersionUtil";
import VersionUtil, { ParsedVersion } from "../../../Utils/VersionUtil";

/*
 * A PINNED-COLLECTOR AGENT'S FILES AND THE VERSION THEY REPORT MOVE TOGETHER.
 *
 * The Docker Swarm, Database, Proxmox, OpenStack, Ceph, VMware, Storage
 * Array and XCP-ng agents are the upstream OpenTelemetry Collector plus
 * OneUptime's files: a compose file, collector configs, a script. They
 * report a version, and the Dashboard puts a sign beside an agent that
 * reports less than this release's files do (AgentKind.ts). They used to
 * report the collector's version alone, so a change to the files that left
 * the collector where it was - #5076's CPU processors in the Swarm agent's
 * config, which fixed a flat CPU line - changed nothing they reported: every
 * Swarm kept the old config, and none showed a sign (the follow-up of
 * #5076).
 *
 * The version is the files' own now: the collector release they pin, with
 * its last number raised whenever the files change on the same collector.
 * This holds each agent's files to the version they report, by a digest of
 * what they run - comments and blank lines left out, so rewording a comment
 * is not a new agent. When a test here fails, the agent's files changed:
 * raise the agent's version (the constant in AgentKind.ts and the stamp in
 * its files), then pin the digest the failure prints. A collector bump
 * changes the files too, and its version starts again at the collector's.
 *
 * A pin names each file by its path in the repository, so a search for a
 * file a change touches finds this test. And it names every file the agent
 * runs: every file its install serves (Common/Types/InstallScripts) but the
 * scripts that install and diagnose it, its systemd units and OpenStack's
 * credential aids. The Storage Array agent's pin used to name only Pure
 * Storage's four files, so PowerStore's, ONTAP's and PowerScale's configs
 * changed outside any digest, and a second test here holds the two lists
 * together now (#11422).
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const TRAILING_WHITESPACE: RegExp = /\s+$/;

interface AgentFilesPin {
  kind: AgentKind;
  // The agent's folder under agents/.
  directory: string;
  /*
   * What the running agent is made of, each by its path in the repository
   * (agents/<directory>/...); a folder stands for every file in it.
   */
  files: Array<string>;
  // The version these files report.
  version: string;
  // The digest of these files as this version shipped them.
  digest: string;
}

const AGENT_FILES: Array<AgentFilesPin> = [
  {
    kind: AgentKind.DockerSwarmAgent,
    directory: "DockerSwarmAgent",
    files: [
      "agents/DockerSwarmAgent/docker-compose.yml",
      "agents/DockerSwarmAgent/otel-collector-config.yaml",
      "agents/DockerSwarmAgent/inventory-snapshot.sh",
    ],
    version: "0.165.1",
    digest: "f755745b739b42b607f26468e7845875241f78b173f75bb6ca0f78026262182f",
  },
  /*
   * 0.165.1: the compose file hands the AI agent beside the collector its
   * Data Observability settings (#11251).
   */
  {
    kind: AgentKind.DatabaseAgent,
    directory: "DatabaseAgent",
    files: [
      "agents/DatabaseAgent/docker-compose.yml",
      "agents/DatabaseAgent/configs",
    ],
    version: "0.165.1",
    digest: "039fd2c14810d1715f0745b79f8eaf139deef10ed21a57182bba8d3f43203df4",
  },
  {
    kind: AgentKind.ProxmoxAgent,
    directory: "ProxmoxAgent",
    files: [
      "agents/ProxmoxAgent/docker-compose.yml",
      "agents/ProxmoxAgent/otel-collector-config.yaml",
    ],
    version: "0.165.0",
    digest: "d74cf6d1bd7008db727eed8e24db2414fc55d8ae2e9b7488cec4d17a60cb027f",
  },
  /*
   * The logs and traces profiles' compose files and collector configs, on
   * the controllers, compute nodes and traced machines, joined the pin on
   * 0.165.0 itself: they are as 0.165.0 shipped them, each stamps it, and
   * the pin had named only the main collector's two files.
   */
  {
    kind: AgentKind.OpenStackAgent,
    directory: "OpenStackAgent",
    files: [
      "agents/OpenStackAgent/docker-compose.yml",
      "agents/OpenStackAgent/otel-collector-config.yaml",
      "agents/OpenStackAgent/docker-compose.logs.yml",
      "agents/OpenStackAgent/otel-collector-logs-files.yaml",
      "agents/OpenStackAgent/otel-collector-logs-journald.yaml",
      "agents/OpenStackAgent/docker-compose.traces.yml",
      "agents/OpenStackAgent/otel-collector-traces.yaml",
    ],
    version: "0.165.0",
    digest: "066474b59a54170ad7b713825a90f7273ba556d6c10127d3ae59b50ace348529",
  },
  {
    kind: AgentKind.CephAgent,
    directory: "CephAgent",
    files: [
      "agents/CephAgent/docker-compose.yml",
      "agents/CephAgent/otel-collector-config.yaml",
    ],
    version: "0.165.0",
    digest: "266612e94e52a236925092813d6de67f86d2e0ca539207de1154fecb659c04e3",
  },
  {
    kind: AgentKind.VMwareAgent,
    directory: "VMwareAgent",
    files: [
      "agents/VMwareAgent/docker-compose.yml",
      "agents/VMwareAgent/otel-collector-config.yaml",
    ],
    version: "0.165.0",
    digest: "b46cd85d6dd36b0f33a2387094b9f2b065978db1b56e83c4ac8778e0c0ae11db",
  },
  /*
   * 0.165.1: NetApp ONTAP, Dell PowerStore and Dell PowerScale beside Pure
   * Storage's three ways, and the collector's container name read from .env,
   * so a second agent on the same machine keeps a name of its own when it is
   * upgraded (#11168).
   */
  {
    kind: AgentKind.StorageArrayAgent,
    directory: "StorageArrayAgent",
    files: [
      "agents/StorageArrayAgent/docker-compose.yml",
      "agents/StorageArrayAgent/otel-collector-config.yaml",
      "agents/StorageArrayAgent/otel-collector-config.flasharray-exporter.yaml",
      "agents/StorageArrayAgent/otel-collector-config.flashblade.yaml",
      // NetApp ONTAP's collector and the Harvest poller it reads (#11189).
      "agents/StorageArrayAgent/otel-collector-config.netapp-ontap.yaml",
      "agents/StorageArrayAgent/netapp-harvest.yml",
      "agents/StorageArrayAgent/netapp-harvest-rest.yaml",
      "agents/StorageArrayAgent/netapp-harvest-keyperf.yaml",
      "agents/StorageArrayAgent/netapp-harvest-restperf.yaml",
      // Dell PowerStore's: Dell's exporter, built here, and its syslog (#11227).
      "agents/StorageArrayAgent/otel-collector-config.powerstore.yaml",
      "agents/StorageArrayAgent/powerstore-exporter.Dockerfile",
      "agents/StorageArrayAgent/powerstore-syslog.yaml",
      // Dell PowerScale's, over SNMP (#11233).
      "agents/StorageArrayAgent/otel-collector-config.powerscale.yaml",
    ],
    version: "0.165.1",
    digest: "bb81c6b9720516d41dd1f72cbb53ef71504c2e26791bd68c289abbfdcda896cc",
  },
  /*
   * Its files first ship in 18.0.0 (17.3.0 has no XCP-ng agent), so a change
   * before that release is still the files 0.165.0 ships as: XO_NAME's
   * default quiet when XO_ADDRESS is unset (Tests/Ops/ComposeQuietStart),
   * which a running agent reads the same, and the XCP-ng AI agent beside the
   * collector (#10998).
   */
  {
    kind: AgentKind.XcpNgAgent,
    directory: "XcpNgAgent",
    files: [
      "agents/XcpNgAgent/docker-compose.yml",
      "agents/XcpNgAgent/otel-collector-config.yaml",
    ],
    version: "0.165.0",
    digest: "9dd74fde038db1905332bad77727731fa9dea223de6e95911fa357aa3c9d5440",
  },
];

/*
 * The files an agent's install serves that the running agent is not made
 * of, so changing one is no new agent: the scripts that install, upgrade
 * and diagnose it (OpenStack's logs and traces profiles have installers of
 * their own), its systemd units, which only start the compose file or the
 * collector with the files above, and OpenStack's aids for whoever makes
 * its credential and lists its control plane, run once by hand.
 */
function isServedButNotRun(directory: string, file: string): boolean {
  if (
    file === INSTALL_SCRIPT_FILE ||
    file === TROUBLESHOOT_SCRIPT_FILE ||
    file.startsWith("systemd/")
  ) {
    return true;
  }
  if (directory === "OpenStackAgent") {
    return (
      file === "install-logs.sh" ||
      file === "install-traces.sh" ||
      file === "control-plane-targets.py" ||
      file.startsWith("access/")
    );
  }
  return false;
}

// The install that serves an agent's files: the entry of its folder.
function installOf(pin: AgentFilesPin): InstallScriptEntry | undefined {
  return INSTALL_SCRIPTS.find((entry: InstallScriptEntry): boolean => {
    return entry.sourceDirectory === `agents/${pin.directory}`;
  });
}

// A file's content as the agent runs it: no comment lines, no blank lines.
function withoutComments(text: string): string {
  return text
    .split("\n")
    .map((line: string): string => {
      return line.replace(TRAILING_WHITESPACE, "");
    })
    .filter((line: string): boolean => {
      return line.trim() !== "" && !line.trim().startsWith("#");
    })
    .join("\n");
}

/*
 * Every file a pin names, a folder expanded to its files, each relative to
 * the agent's folder, sorted. Relative, so the digest of a file is the same
 * whichever way a pin spells it.
 */
function filesOf(pin: AgentFilesPin): Array<string> {
  const files: Array<string> = [];
  const prefix: string = `agents/${pin.directory}/`;

  for (const entry of pin.files) {
    if (!entry.startsWith(prefix)) {
      throw new Error(
        `${entry} is not in agents/${pin.directory}: name each file of the pin by its path in the repository.`,
      );
    }
    const relative: string = entry.slice(prefix.length);
    const full: string = path.join(REPO_ROOT, entry);

    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        files.push(path.join(relative, name).split(path.sep).join("/"));
      }
    } else {
      files.push(relative);
    }
  }

  return files.sort();
}

function digestOf(pin: AgentFilesPin): string {
  const hash: crypto.Hash = crypto.createHash("sha256");

  for (const file of filesOf(pin)) {
    hash.update(`${file}\n`);
    hash.update(
      `${withoutComments(
        fs.readFileSync(
          path.join(REPO_ROOT, "agents", pin.directory, file),
          "utf8",
        ),
      )}\n`,
    );
  }

  return hash.digest("hex");
}

// A collector config an agent ships: otel-collector-config.yaml and kin.
const COLLECTOR_CONFIG_FILE: RegExp = /^otel-collector-config.*\.yaml$/;

// The version a config stamps as oneuptime.agent.version.
function stampOf(config: string): string | undefined {
  return config.match(
    /- key: oneuptime\.agent\.version\s+value: "([^"]+)"/,
  )?.[1];
}

describe("a pinned-collector agent's files report the version they shipped as", () => {
  test("every pinned-collector agent with files in the repository is pinned here", () => {
    const pinned: Array<AgentKind> = AGENT_FILES.map(
      (pin: AgentFilesPin): AgentKind => {
        return pin.kind;
      },
    );
    const pinnedCollectorKinds: Array<AgentKind> = (
      Object.keys(AGENT_KINDS) as Array<AgentKind>
    ).filter((kind: AgentKind): boolean => {
      return (
        AGENT_KINDS[kind].latestVersionSource ===
        AgentLatestVersionSource.PinnedCollector
      );
    });

    /*
     * The host collector is the one left out: its config is written by the
     * host guide in the Dashboard (Pages/Host/Utils/DocumentationMarkdown),
     * not shipped as files, and its version is also the collector release
     * every install method installs.
     */
    expect(pinned.sort()).toEqual(
      pinnedCollectorKinds
        .filter((kind: AgentKind): boolean => {
          return kind !== AgentKind.HostCollector;
        })
        .sort(),
    );
  });

  test.each(AGENT_FILES)(
    "agents/$directory: unchanged since version $version, or its version moved with them",
    (pin: AgentFilesPin) => {
      const digest: string = digestOf(pin);

      if (digest !== pin.digest) {
        throw new Error(
          `The files of agents/${pin.directory} changed since they shipped as version ${pin.version}. ` +
            `Agents already installed keep running the old files and report ${pin.version}, so OneUptime can only tell them to upgrade if the new files report a higher version: ` +
            `raise its version's last number in AgentKind.ts and in the version its files stamp (or start again at the collector's version for a new collector), ` +
            `then pin version and digest ${digest} here.`,
        );
      }

      expect(digest).toBe(pin.digest);
    },
  );

  test.each(AGENT_FILES)(
    "agents/$directory: every file its install serves is in the pin, or one the running agent is not made of",
    (pin: AgentFilesPin) => {
      const install: InstallScriptEntry | undefined = installOf(pin);
      expect(install).toBeDefined();

      const pinned: Array<string> = filesOf(pin);
      const outside: Array<string> = install!.files.filter(
        (file: string): boolean => {
          return (
            !pinned.includes(file) && !isServedButNotRun(pin.directory, file)
          );
        },
      );

      if (outside.length > 0) {
        throw new Error(
          `agents/${pin.directory}'s install serves ${outside.join(", ")}, which its pin here does not name, so a change there would never tell an installed agent to upgrade. ` +
            `Add each file the running agent is made of to the pin by its path in the repository (its digest changes, so raise its version too), and name a file it never runs in isServedButNotRun.`,
        );
      }

      expect(outside).toEqual([]);
    },
  );

  /*
   * A file the agent runs reaches an installed agent only by its install:
   * install.sh downloads what OneUptime serves, and so does the upgrade
   * dialog's Docker Compose tab (AgentUpgradeGuides).
   */
  test.each(AGENT_FILES)(
    "agents/$directory: every file in the pin is one its install serves, so an upgrade brings it",
    (pin: AgentFilesPin) => {
      const served: ReadonlyArray<string> = installOf(pin)?.files || [];

      expect(
        filesOf(pin).filter((file: string): boolean => {
          return !served.includes(file);
        }),
      ).toEqual([]);
    },
  );

  test.each(AGENT_FILES)(
    "agents/$directory reports what AgentKind calls its newest version",
    (pin: AgentFilesPin) => {
      expect(AGENT_KINDS[pin.kind].pinnedVersion).toBe(pin.version);
    },
  );

  test.each(AGENT_FILES)(
    "agents/$directory's version is a patch of the collector it pins, never below it",
    (pin: AgentFilesPin) => {
      const version: ParsedVersion | null = VersionUtil.parse(pin.version);
      const collector: ParsedVersion | null = VersionUtil.parse(
        AGENT_KINDS[pin.kind].collectorVersion,
      );

      expect(version).not.toBeNull();
      expect(collector).not.toBeNull();
      expect(version!.prerelease).toBeNull();
      expect([version!.major, version!.minor]).toEqual([
        collector!.major,
        collector!.minor,
      ]);
      expect(version!.patch).toBeGreaterThanOrEqual(collector!.patch);
    },
  );
});

/*
 * The case that started it: the Docker Swarm agent's CPU processors (#5076)
 * changed its config and not its collector (0.161.1). Then each task's
 * service and node on its metrics, and the Docker API version negotiated
 * with the daemon instead of a pinned 1.44, changed them again (0.161.2):
 * a Swarm on 0.161.1 sends no service or node, so a Docker Swarm monitor
 * filtered by either finds nothing there, and it must show a sign. Then
 * every inventory snapshot read again (a calm swarm's identical snapshot
 * was read once), each manager's reachability, each service's rolling update
 * and recent task failures, and the swarm's state as metrics (0.161.3): a
 * Swarm on 0.161.2 sends no node or replica series, so its Node Not Ready
 * and Service Replicas Mismatch alerts never fire, and it must show a sign.
 * Then each local volume's size and the disk it lives on (0.161.4, #9648):
 * a Swarm on 0.161.3 says Not reported for every volume, and must show a
 * sign.
 */
/*
 * Then collector 0.165.0 (#9828: 0.161.0's brotli is on CISA's list of
 * exploited vulnerabilities), and every pinned-collector agent's version
 * started again at the collector's. Any set of files of the 0.161 line runs
 * that collector, so it must show a sign.
 */
/*
 * Then each container line's level read in the formats programs write it
 * in, and a stderr line nothing reads left Unspecified (#10972); and each
 * log line's level stored as OneUptime's ingest stores its word (#11228),
 * the levels of more programs read (#11226), and log operators of your
 * own, checked before the agent starts (#11225) - 0.165.1 for both. A
 * Swarm on 0.165.0 still calls its INFO and WARN lines Errors and reads
 * none of those programs' levels, so it must show a sign.
 */
describe("the Docker Swarm agent after #5076's config change, the task labels and the swarm's state", () => {
  test("its files report 0.165.1 and run collector 0.165.0", () => {
    const compose: string = fs.readFileSync(
      path.join(REPO_ROOT, "agents", "DockerSwarmAgent", "docker-compose.yml"),
      "utf8",
    );

    expect(DOCKER_SWARM_AGENT_VERSION).toBe("0.165.1");
    expect(DOCKER_SWARM_AGENT_COLLECTOR_VERSION).toBe("0.165.0");
    expect(compose).toContain(
      `image: otel/opentelemetry-collector-contrib:${DOCKER_SWARM_AGENT_COLLECTOR_VERSION}`,
    );
    expect(compose).toContain(
      `- APP_VERSION=\${APP_VERSION:-${DOCKER_SWARM_AGENT_VERSION}}`,
    );
  });

  test("a Swarm on any set of files of the 0.161 line - 0.161.0 to 0.161.4 - or on 0.165.0's is told to upgrade", () => {
    for (const agentVersion of [
      "0.161.0",
      "0.161.1",
      "0.161.2",
      "0.161.3",
      "0.161.4",
      "0.165.0",
    ]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.DockerSwarmAgent,
          agentVersion: agentVersion,
          serverVersion: "14.0.95",
        }),
      ).toEqual({
        status: AgentVersionStatus.Outdated,
        latestVersion: "0.165.1",
      });
    }
  });

  test("a Swarm on the new files is up to date, whatever version OneUptime runs", () => {
    for (const serverVersion of ["14.0.95", "15.0.0", ""]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.DockerSwarmAgent,
          agentVersion: "0.165.1",
          serverVersion: serverVersion,
        }).status,
      ).toBe(AgentVersionStatus.UpToDate);
    }
  });

  test("the other pinned-collector agents' files changed with the collector alone: they report its version", () => {
    for (const version of [CEPH_AGENT_VERSION, VMWARE_AGENT_VERSION]) {
      expect(version).toBe("0.165.0");
    }
  });

  test("a Ceph or VMware agent on collector 0.161.0's files is told to upgrade", () => {
    for (const kind of [AgentKind.CephAgent, AgentKind.VMwareAgent]) {
      expect(
        getAgentVersionState({
          kind,
          agentVersion: "0.161.0",
          serverVersion: "15.0.0",
        }),
      ).toEqual({
        status: AgentVersionStatus.Outdated,
        latestVersion: "0.165.0",
      });
    }
  });
});

/*
 * The Proxmox agent's config changed on its collector twice: every node's
 * start-on-boot and replication read from the node itself, not from PVE_HOST
 * alone (#5428, 0.161.1); then the cluster read from the next node of
 * PVE_NODES whose API answers when PVE_HOST's goes down, picked by the
 * pve-api-failover container (#6844, 0.161.2). A cluster still running older
 * files goes blind when PVE_HOST's node does, so it must show a sign.
 */
describe("the Proxmox agent after #6844 reads the cluster from another node when PVE_HOST's goes down", () => {
  test("its files report 0.165.0 and run collector 0.165.0", () => {
    const compose: string = fs.readFileSync(
      path.join(REPO_ROOT, "agents", "ProxmoxAgent", "docker-compose.yml"),
      "utf8",
    );
    const config: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agents",
        "ProxmoxAgent",
        "otel-collector-config.yaml",
      ),
      "utf8",
    );

    expect(PROXMOX_AGENT_VERSION).toBe("0.165.0");
    expect(PROXMOX_AGENT_COLLECTOR_VERSION).toBe("0.165.0");
    expect(compose).toContain(
      `image: otel/opentelemetry-collector-contrib:${PROXMOX_AGENT_COLLECTOR_VERSION}`,
    );
    expect(config).toContain(
      `- key: oneuptime.agent.version
        value: "${PROXMOX_AGENT_VERSION}"`,
    );
  });

  test("a cluster on any files of the 0.161 line - 0.161.0 to 0.161.2 - is told to upgrade", () => {
    for (const agentVersion of ["0.161.0", "0.161.1", "0.161.2"]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.ProxmoxAgent,
          agentVersion,
          serverVersion: "14.0.99",
        }),
      ).toEqual({
        status: AgentVersionStatus.Outdated,
        latestVersion: "0.165.0",
      });
    }
  });

  test("a cluster on the new files is up to date, whatever version OneUptime runs", () => {
    for (const serverVersion of ["14.0.99", "15.0.0", ""]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.ProxmoxAgent,
          agentVersion: "0.165.0",
          serverVersion: serverVersion,
        }).status,
      ).toBe(AgentVersionStatus.UpToDate);
    }
  });
});

/*
 * The Database agent's PostgreSQL config gained SQL checks of its own on
 * the same collector - a restart, transaction ID wraparound, long
 * transactions and lock waits, which the postgresql receiver does not
 * report - so an agent still running the old files reads none of them and
 * must show a sign (0.161.1). Every engine's config stamps the agent's one
 * version. Then, on collector 0.165.0, the compose file passing Data
 * Observability's settings to the AI agent (0.165.1, #11251): an agent on
 * 0.165.0's files cannot turn it on, so it must show a sign.
 */
describe("the Database agent after its readings of Galera and Data Observability's settings", () => {
  test("its files report 0.165.1 and run collector 0.165.0", () => {
    expect(DATABASE_AGENT_VERSION).toBe("0.165.1");
    expect(AGENT_KINDS[AgentKind.DatabaseAgent].collectorVersion).toBe(
      "0.165.0",
    );
    expect(
      fs.readFileSync(
        path.join(REPO_ROOT, "agents", "DatabaseAgent", "docker-compose.yml"),
        "utf8",
      ),
    ).toContain("image: otel/opentelemetry-collector-contrib:0.165.0");
  });

  test("the compose file 0.165.1 is about hands the AI agent every Data Observability setting", () => {
    const compose: string = fs.readFileSync(
      path.join(REPO_ROOT, "agents", "DatabaseAgent", "docker-compose.yml"),
      "utf8",
    );

    for (const variable of [
      "ONEUPTIME_DATA_OBSERVABILITY",
      "ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME",
      "ONEUPTIME_DATA_OBSERVABILITY_DATABASE_PASSWORD",
      "ONEUPTIME_DATA_OBSERVABILITY_CHECKS",
      "ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME",
      "ONEUPTIME_DATA_OBSERVABILITY_CHECKS_PASSWORD",
      "ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL",
    ]) {
      expect(compose).toContain(`- ${variable}=\${${variable}:-}`);
    }
  });

  test("an agent on any files of the 0.161 line - 0.161.0 to 0.161.2 - or on 0.165.0's is told to upgrade", () => {
    for (const agentVersion of ["0.161.0", "0.161.1", "0.161.2", "0.165.0"]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.DatabaseAgent,
          agentVersion,
          serverVersion: "14.0.105",
        }),
      ).toEqual({
        status: AgentVersionStatus.Outdated,
        latestVersion: "0.165.1",
      });
    }
  });

  test("an agent on the new files is up to date, whatever version OneUptime runs", () => {
    for (const serverVersion of ["14.0.105", "15.0.0", ""]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.DatabaseAgent,
          agentVersion: "0.165.1",
          serverVersion: serverVersion,
        }).status,
      ).toBe(AgentVersionStatus.UpToDate);
    }
  });
});

/*
 * The Storage Array agent read Pure Storage alone on collector 0.165.0.
 * Then NetApp ONTAP (#11189), Dell PowerStore (#11227) and Dell PowerScale
 * (#11233) on the same collector (0.165.1): an agent on 0.165.0's files
 * runs none of their collectors, so it must show a sign. Every config of
 * every platform stamps the agent's one version.
 */
describe("the Storage Array agent after NetApp ONTAP, Dell PowerStore and Dell PowerScale", () => {
  test("its files report 0.165.1 and run collector 0.165.0", () => {
    expect(STORAGE_ARRAY_AGENT_VERSION).toBe("0.165.1");
    expect(STORAGE_ARRAY_AGENT_COLLECTOR_VERSION).toBe("0.165.0");
    expect(AGENT_KINDS[AgentKind.StorageArrayAgent].collectorVersion).toBe(
      STORAGE_ARRAY_AGENT_COLLECTOR_VERSION,
    );
    expect(
      fs.readFileSync(
        path.join(
          REPO_ROOT,
          "agents",
          "StorageArrayAgent",
          "docker-compose.yml",
        ),
        "utf8",
      ),
    ).toContain(
      `otel/opentelemetry-collector-contrib:${STORAGE_ARRAY_AGENT_COLLECTOR_VERSION}`,
    );
  });

  /*
   * Its configs were outside the pin until #11422, so the change went by
   * without a new version: every config stamps the one version, whichever
   * platform's runs.
   */
  test("every collector config it ships stamps 0.165.1, PowerStore's syslog collector's too", () => {
    const agentDirectory: string = path.join(
      REPO_ROOT,
      "agents",
      "StorageArrayAgent",
    );
    const configs: Array<string> = fs
      .readdirSync(agentDirectory)
      .filter((name: string): boolean => {
        return (
          COLLECTOR_CONFIG_FILE.test(name) || name === "powerstore-syslog.yaml"
        );
      })
      .sort();

    expect(configs).toEqual([
      "otel-collector-config.flasharray-exporter.yaml",
      "otel-collector-config.flashblade.yaml",
      "otel-collector-config.netapp-ontap.yaml",
      "otel-collector-config.powerscale.yaml",
      "otel-collector-config.powerstore.yaml",
      "otel-collector-config.yaml",
      "powerstore-syslog.yaml",
    ]);
    for (const name of configs) {
      expect({
        name,
        stamp: stampOf(
          fs.readFileSync(path.join(agentDirectory, name), "utf8"),
        ),
      }).toEqual({ name, stamp: STORAGE_ARRAY_AGENT_VERSION });
    }
  });

  test("an agent on collector 0.161.0's files or on 0.165.0's is told to upgrade", () => {
    for (const agentVersion of ["0.161.0", "0.165.0"]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.StorageArrayAgent,
          agentVersion,
          serverVersion: "18.0.0",
        }),
      ).toEqual({
        status: AgentVersionStatus.Outdated,
        latestVersion: "0.165.1",
      });
    }
  });

  test("an agent on the new files is up to date, whatever version OneUptime runs", () => {
    for (const serverVersion of ["17.3.0", "18.0.0", ""]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.StorageArrayAgent,
          agentVersion: "0.165.1",
          serverVersion: serverVersion,
        }).status,
      ).toBe(AgentVersionStatus.UpToDate);
    }
  });
});

describe("the digest reads what the agent runs, not how it is commented", () => {
  test("a comment or a blank line is not a change", () => {
    expect(withoutComments("a: 1\n# a comment\n\n  # indented\nb: 2  \n")).toBe(
      "a: 1\nb: 2",
    );
  });

  test("a changed value is", () => {
    expect(withoutComments("a: 1\n")).not.toBe(withoutComments("a: 2\n"));
  });
});
