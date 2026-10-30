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
  STORAGE_ARRAY_AGENT_VERSION,
  VMWARE_AGENT_VERSION,
  getAgentVersionState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import { AgentVersionStatus } from "../../../Utils/AgentVersionUtil";
import VersionUtil, { ParsedVersion } from "../../../Utils/VersionUtil";

/*
 * A PINNED-COLLECTOR AGENT'S FILES AND THE VERSION THEY REPORT MOVE TOGETHER.
 *
 * The Docker Swarm, Database, Proxmox, Ceph, VMware and Storage Array agents
 * are the upstream OpenTelemetry Collector plus OneUptime's files: a
 * compose file, collector configs, a script. They report a version, and the
 * Dashboard puts a sign beside an agent that reports less than this
 * release's files do (AgentKind.ts). They used to report the collector's
 * version alone, so a change to the files that left the collector where it
 * was - #5076's CPU processors in the Swarm agent's config, which fixed a
 * flat CPU line - changed nothing they reported: every Swarm kept the old
 * config, and none showed a sign (the follow-up of #5076).
 *
 * The version is the files' own now: the collector release they pin, with
 * its last number raised whenever the files change on the same collector.
 * This holds each agent's files to the version they report, by a digest of
 * what they run - comments and blank lines left out, so rewording a comment
 * is not a new agent. When a test here fails, the agent's files changed:
 * raise the agent's version (the constant in AgentKind.ts and the stamp in
 * its files), then pin the digest the failure prints. A collector bump
 * changes the files too, and its version starts again at the collector's.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const TRAILING_WHITESPACE: RegExp = /\s+$/;

interface AgentFilesPin {
  kind: AgentKind;
  // The agent's folder under agents/.
  directory: string;
  // What the running agent is made of; a folder stands for every file in it.
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
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "inventory-snapshot.sh",
    ],
    version: "0.161.2",
    digest: "1f389375b7e78a1cc1d5dd42de8ad03c068121c2d435917ae7304966f69c2c99",
  },
  {
    kind: AgentKind.DatabaseAgent,
    directory: "DatabaseAgent",
    files: ["docker-compose.yml", "configs"],
    version: "0.161.0",
    digest: "23a1aef320358ef7c4fbfd362204ffdd5949e7617c2f1991989f0ac6dda3089f",
  },
  {
    kind: AgentKind.ProxmoxAgent,
    directory: "ProxmoxAgent",
    files: ["docker-compose.yml", "otel-collector-config.yaml"],
    version: "0.161.1",
    digest: "a39519614da2bc1e9da3d965fed377f97edec04bb97d507679ca0538cf915346",
  },
  {
    kind: AgentKind.CephAgent,
    directory: "CephAgent",
    files: ["docker-compose.yml", "otel-collector-config.yaml"],
    version: "0.161.0",
    digest: "020316dd186b9b7f3f7263e7d863808875d4f60113fc4bc78d1927ea0aca525e",
  },
  {
    kind: AgentKind.VMwareAgent,
    directory: "VMwareAgent",
    files: ["docker-compose.yml", "otel-collector-config.yaml"],
    version: "0.161.0",
    digest: "5083cf4a60e17103b0abbacdc26000ab6c501d2583da467679801b80dbd3d0ee",
  },
  {
    kind: AgentKind.StorageArrayAgent,
    directory: "StorageArrayAgent",
    files: [
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "otel-collector-config.flasharray-exporter.yaml",
      "otel-collector-config.flashblade.yaml",
    ],
    version: "0.161.0",
    digest: "2855f53f08c537dae86615db898248693a41c70b19f654077ed4f2ba506850e3",
  },
];

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

// Every file a pin names, a folder expanded to its files, sorted.
function filesOf(pin: AgentFilesPin): Array<string> {
  const files: Array<string> = [];

  for (const entry of pin.files) {
    const full: string = path.join(REPO_ROOT, "agents", pin.directory, entry);

    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        files.push(path.join(entry, name).split(path.sep).join("/"));
      }
    } else {
      files.push(entry);
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
 * filtered by either finds nothing there, and it must show a sign.
 */
describe("the Docker Swarm agent after #5076's config change and the task labels", () => {
  test("its files report 0.161.2 and still run collector 0.161.0", () => {
    const compose: string = fs.readFileSync(
      path.join(REPO_ROOT, "agents", "DockerSwarmAgent", "docker-compose.yml"),
      "utf8",
    );

    expect(DOCKER_SWARM_AGENT_VERSION).toBe("0.161.2");
    expect(DOCKER_SWARM_AGENT_COLLECTOR_VERSION).toBe("0.161.0");
    expect(compose).toContain(
      `image: otel/opentelemetry-collector-contrib:${DOCKER_SWARM_AGENT_COLLECTOR_VERSION}`,
    );
    expect(compose).toContain(
      `- APP_VERSION=\${APP_VERSION:-${DOCKER_SWARM_AGENT_VERSION}}`,
    );
  });

  test("a Swarm on either older set of files - 0.161.0 or 0.161.1 - is told to upgrade", () => {
    for (const agentVersion of ["0.161.0", "0.161.1"]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.DockerSwarmAgent,
          agentVersion: agentVersion,
          serverVersion: "14.0.95",
        }),
      ).toEqual({
        status: AgentVersionStatus.Outdated,
        latestVersion: "0.161.2",
      });
    }
  });

  test("a Swarm on the new files is up to date, whatever version OneUptime runs", () => {
    for (const serverVersion of ["14.0.95", "15.0.0", ""]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.DockerSwarmAgent,
          agentVersion: "0.161.2",
          serverVersion: serverVersion,
        }).status,
      ).toBe(AgentVersionStatus.UpToDate);
    }
  });

  test("the other pinned-collector agents' files did not change: they report their collector's version", () => {
    for (const version of [
      DATABASE_AGENT_VERSION,
      CEPH_AGENT_VERSION,
      VMWARE_AGENT_VERSION,
      STORAGE_ARRAY_AGENT_VERSION,
    ]) {
      expect(version).toBe("0.161.0");
    }
  });
});

/*
 * The Proxmox agent's config changed on its collector too (#5428): every
 * node's start-on-boot and replication are read from the node itself, not
 * from PVE_HOST alone, so a cluster still running the old files reads them
 * for one node and must show a sign (0.161.1).
 */
describe("the Proxmox agent after #5428 read every node", () => {
  test("its files report 0.161.1 and still run collector 0.161.0", () => {
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

    expect(PROXMOX_AGENT_VERSION).toBe("0.161.1");
    expect(PROXMOX_AGENT_COLLECTOR_VERSION).toBe("0.161.0");
    expect(compose).toContain(
      `image: otel/opentelemetry-collector-contrib:${PROXMOX_AGENT_COLLECTOR_VERSION}`,
    );
    expect(config).toContain(
      `- key: oneuptime.agent.version
        value: "${PROXMOX_AGENT_VERSION}"`,
    );
  });

  test("a cluster on the older files - 0.161.0 - is told to upgrade", () => {
    expect(
      getAgentVersionState({
        kind: AgentKind.ProxmoxAgent,
        agentVersion: "0.161.0",
        serverVersion: "14.0.99",
      }),
    ).toEqual({
      status: AgentVersionStatus.Outdated,
      latestVersion: "0.161.1",
    });
  });

  test("a cluster on the new files is up to date, whatever version OneUptime runs", () => {
    for (const serverVersion of ["14.0.99", "15.0.0", ""]) {
      expect(
        getAgentVersionState({
          kind: AgentKind.ProxmoxAgent,
          agentVersion: "0.161.1",
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
