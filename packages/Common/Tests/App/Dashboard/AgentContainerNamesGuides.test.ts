import { describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import path from "path";
import {
  AgentContainerName,
  AgentContainerNames,
  getAgentContainerNameRows,
  getSecondAgentContainerName,
  getSeveralAgentsTopic,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/AgentContainerNames";
import {
  SetupGuideContent,
  SetupGuideTopic,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  CEPH_AGENT_CONTAINER,
  CEPH_AGENT_CONTAINER_NAMES,
  CEPH_AGENT_INSTALL_DIR,
  CEPH_AI_AGENT_CONTAINER,
  getCephSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  PROXMOX_AGENT_CONTAINER,
  PROXMOX_AGENT_CONTAINER_NAMES,
  PROXMOX_AGENT_INSTALL_DIR,
  PROXMOX_AI_AGENT_CONTAINER,
  PROXMOX_EXPORTER_CONTAINER,
  PROXMOX_FAILOVER_CONTAINER,
  getProxmoxSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  VMWARE_AGENT_CONTAINER,
  VMWARE_AGENT_CONTAINER_NAMES,
  VMWARE_AGENT_INSTALL_DIR,
  VMWARE_AI_AGENT_CONTAINER,
  getVMwareSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  OPENSTACK_AGENT_CONTAINER,
  OPENSTACK_AGENT_CONTAINER_NAMES,
  OPENSTACK_AGENT_INSTALL_DIR,
  OPENSTACK_AI_AGENT_CONTAINER,
  OPENSTACK_EXPORTER_CONTAINER,
  getOpenStackSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationMarkdown";
import { escapeRegExp } from "../../../Utils/RegExpEscape";

/*
 * THE SETUP GUIDES SAY HOW TO RUN A SECOND AGENT ON ONE MACHINE (#11434).
 *
 * The Ceph, Proxmox, VMware and OpenStack agents each run their containers
 * as `container_name: ${VARIABLE:-default}`, from .env, and their
 * install.sh names a second agent's containers after its folder. Each
 * guide's environment table lists every name, and an Advanced topic says
 * how to run a second agent - by the install script, a folder of its own;
 * with Docker Compose, the names in its .env - in the same words in the
 * four guides (Components/SetupGuide/AgentContainerNames). These hold each
 * guide's list of names to the compose file and install.sh it describes,
 * the names it gives a second agent to install.sh's own functions, run,
 * and each way through the guide to the words it should say.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const URL: string = "https://oneuptime.example.com";

type Method = "install-script" | "docker-compose";

interface Guide {
  name: string;
  agentDir: string;
  names: AgentContainerNames;
  // Each name's default, as the guide's other constants have it.
  containers: Array<string>;
  installDir: string;
  title: string;
  summary: string;
  guide: (method: Method) => SetupGuideContent;
}

const GUIDES: Array<Guide> = [
  {
    name: "Ceph",
    agentDir: "CephAgent",
    names: CEPH_AGENT_CONTAINER_NAMES,
    containers: [CEPH_AGENT_CONTAINER, CEPH_AI_AGENT_CONTAINER],
    installDir: CEPH_AGENT_INSTALL_DIR,
    title: "Monitoring several clusters",
    summary:
      "One agent per cluster, each in a folder of its own with container names of its own.",
    guide: (method: Method): SetupGuideContent => {
      return getCephSetupGuide({
        oneuptimeUrl: URL,
        apiKey: "key",
        hasApiKey: true,
        method,
      });
    },
  },
  {
    name: "Proxmox",
    agentDir: "ProxmoxAgent",
    names: PROXMOX_AGENT_CONTAINER_NAMES,
    containers: [
      PROXMOX_AGENT_CONTAINER,
      PROXMOX_FAILOVER_CONTAINER,
      PROXMOX_EXPORTER_CONTAINER,
      PROXMOX_AI_AGENT_CONTAINER,
    ],
    installDir: PROXMOX_AGENT_INSTALL_DIR,
    title: "Monitoring several clusters",
    summary:
      "One agent per cluster, each in a folder of its own with container names of its own.",
    guide: (method: Method): SetupGuideContent => {
      return getProxmoxSetupGuide({
        oneuptimeUrl: URL,
        apiKey: "key",
        hasApiKey: true,
        method,
      });
    },
  },
  {
    name: "VMware",
    agentDir: "VMwareAgent",
    names: VMWARE_AGENT_CONTAINER_NAMES,
    containers: [VMWARE_AGENT_CONTAINER, VMWARE_AI_AGENT_CONTAINER],
    installDir: VMWARE_AGENT_INSTALL_DIR,
    title: "Monitoring several vCenters",
    summary:
      "One agent per vCenter, each in a folder of its own with container names of its own.",
    guide: (method: Method): SetupGuideContent => {
      return getVMwareSetupGuide({
        oneuptimeUrl: URL,
        apiKey: "key",
        hasApiKey: true,
        method,
      });
    },
  },
  {
    name: "OpenStack",
    agentDir: "OpenStackAgent",
    names: OPENSTACK_AGENT_CONTAINER_NAMES,
    containers: [
      OPENSTACK_AGENT_CONTAINER,
      OPENSTACK_EXPORTER_CONTAINER,
      "oneuptime-openstack-quota-exporter",
      "oneuptime-openstack-database-exporter",
      "oneuptime-openstack-worker-state-exporter",
      OPENSTACK_AI_AGENT_CONTAINER,
    ],
    installDir: OPENSTACK_AGENT_INSTALL_DIR,
    title: "Monitoring several clouds",
    summary:
      "One agent per cloud, each in a folder of its own with container names of its own.",
    guide: (method: Method): SetupGuideContent => {
      return getOpenStackSetupGuide({
        oneuptimeUrl: URL,
        apiKey: "key",
        hasApiKey: true,
        method,
      });
    },
  },
];

const METHODS: Array<Method> = ["install-script", "docker-compose"];

function readAgentFile(guide: Guide, file: string): string {
  return fs.readFileSync(
    path.join(REPO_ROOT, "agents", guide.agentDir, file),
    "utf8",
  );
}

function topicTitled(
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): SetupGuideTopic | undefined {
  return (topics || []).find((topic: SetupGuideTopic): boolean => {
    return topic.title === title;
  });
}

/*
 * A row of the environment table for a container's name. Hoisted rather
 * than written inline in the `.test()` call below: eslint's wrap-regex and
 * prettier disagree about parentheses around a regex literal that a method
 * is called on.
 */
const NAME_ROW: RegExp = /^\| `[A-Z0-9_]+_CONTAINER_NAME` \|/;

// The environment table's rows for the names.
function nameRows(content: SetupGuideContent): Array<string> {
  const topic: SetupGuideTopic | undefined = topicTitled(
    content.advanced,
    "Environment variables",
  );
  expect(topic).toBeDefined();
  return (topic as SetupGuideTopic).markdown
    .split("\n")
    .filter((line: string): boolean => {
      return NAME_ROW.test(line);
    });
}

// The code blocks of one topic.
function codeBlocks(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The compose file's containers, each with the .env variable its name is read from, in order.
function composeNames(guide: Guide): Array<string> {
  return Array.from(
    readAgentFile(guide, "docker-compose.yml").matchAll(
      /^ {4}container_name: \$\{([A-Z0-9_]+):-([^}]+)\}$/gm,
    ),
  ).map((match: RegExpMatchArray): string => {
    return `${match[1]}=${match[2]}`;
  });
}

function shellFunction(script: string, name: string): string {
  const found: RegExpMatchArray | null = script.match(
    new RegExp(`^${escapeRegExp(name)}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, "m"),
  );
  expect({ name, defined: Boolean(found) }).toEqual({ name, defined: true });
  return (found as RegExpMatchArray)[0];
}

/*
 * The names install.sh gives the containers of an agent it installs into
 * `installDir`, by its own functions, run in bash with no .env.
 */
function namesInstallShGives(guide: Guide, installDir: string): Array<string> {
  const script: string = readAgentFile(guide, "install.sh");
  const program: string = [
    ...[
      "absolute_install_dir",
      "compose_project_name",
      "directory_container_name",
      "companion_container_name_for",
    ].map((name: string): string => {
      return shellFunction(script, name);
    }),
    'collector="$(directory_container_name)"',
    "printf '%s\\n' \"$collector\"",
    "while IFS='|' read -r variable service default role; do",
    '    [ -n "$variable" ] || continue',
    '    printf \'%s\\n\' "$(companion_container_name_for "$collector" "$default" "$role")"',
    'done <<< "$COMPANIONS"',
  ].join("\n");
  const run: SpawnSyncReturns<string> = spawnSync("bash", ["-c", program], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] || "/usr/bin:/bin",
      DEFAULT_CONTAINER_NAME: (
        script.match(/^DEFAULT_CONTAINER_NAME="([^"]+)"$/m) as RegExpMatchArray
      )[1] as string,
      INSTALL_DIR: installDir,
      ENV_FILE: "/nonexistent-oneuptime-agent/.env",
      COMPANIONS: (
        script.match(/^COMPANION_CONTAINERS="([^"]*)"$/m) as RegExpMatchArray
      )[1] as string,
    },
  });
  expect({ status: run.status, stderr: run.stderr }).toEqual({
    status: 0,
    stderr: "",
  });
  return run.stdout.split("\n").filter(Boolean);
}

describe.each(GUIDES)("the $name guide's container names", (guide: Guide) => {
  const collector: AgentContainerName = guide.names.names[0]!;

  test("are the compose file's, each read from .env, the collector's first", () => {
    expect(
      guide.names.names.map((name: AgentContainerName): string => {
        return `${name.variable}=${name.container}`;
      }),
    ).toEqual(composeNames(guide));
    expect(
      guide.names.names.map((name: AgentContainerName): string => {
        return name.container;
      }),
    ).toEqual(guide.containers);
    expect(collector.role).toBe("collector");
  });

  test("are in install.sh's order, and the folder is install.sh's", () => {
    const script: string = readAgentFile(guide, "install.sh");
    expect(collector.container).toBe(
      (
        script.match(/^DEFAULT_CONTAINER_NAME="([^"]+)"$/m) as RegExpMatchArray
      )[1],
    );
    const companions: Array<string> = (
      (
        script.match(/^COMPANION_CONTAINERS="([^"]*)"$/m) as RegExpMatchArray
      )[1] as string
    )
      .split("\n")
      .map((line: string): string => {
        const fields: Array<string> = line.split("|");
        return `${fields[0]}=${fields[2]}`;
      });
    expect(companions).toEqual(
      guide.names.names.slice(1).map((name: AgentContainerName): string => {
        return `${name.variable}=${name.container}`;
      }),
    );
    expect(guide.names.installDir).toBe(guide.installDir);
    expect(script).toMatch(
      new RegExp(
        `^(?:DEFAULT_)?INSTALL_DIR="(?:\\$\\{INSTALL_DIR:-)?${escapeRegExp(guide.installDir)}\\}?"$`,
        "m",
      ),
    );
  });

  test("a second agent's are the names install.sh gives its folder", () => {
    const folder: string = `${guide.names.installDir}-${guide.names.suffix}`;
    expect(namesInstallShGives(guide, folder)).toEqual(
      guide.names.names.map((name: AgentContainerName): string => {
        return getSecondAgentContainerName(name, guide.names.suffix);
      }),
    );
    // A first agent keeps every default.
    expect(namesInstallShGives(guide, guide.names.installDir)).toEqual(
      guide.containers,
    );
  });

  describe.each(METHODS)("with %s", (method: Method) => {
    const content: SetupGuideContent = guide.guide(method);
    const byInstallScript: boolean = method === "install-script";
    const topic: SetupGuideTopic | undefined = topicTitled(
      content.advanced,
      guide.title,
    );

    test("the environment table has a row for every name, with its default", () => {
      const rows: Array<string> = nameRows(content);
      expect(rows.length).toBe(guide.names.names.length);
      guide.names.names.forEach(
        (name: AgentContainerName, index: number): void => {
          expect(rows[index]).toContain(`| \`${name.variable}\` | No | `);
          expect(rows[index]).toContain(
            `The ${name.role}'s container name (default: \`${name.container}\`).`,
          );
        },
      );
      expect(getAgentContainerNameRows(guide.names, byInstallScript)).toBe(
        rows.join("\n"),
      );
    });

    test("the rows say what the install script does only where it is the way in", () => {
      const rows: string = nameRows(content).join("\n");
      if (byInstallScript) {
        expect(rows).toContain(
          "the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again",
        );
        for (const name of guide.names.names.slice(1)) {
          expect(rows).toContain(
            `(\`${getSecondAgentContainerName(name, guide.names.suffix)}\` beside \`${getSecondAgentContainerName(collector, guide.names.suffix)}\`)`,
          );
        }
      } else {
        expect(rows).not.toContain("install script");
        expect(rows).toContain("needs one of its own");
      }
    });

    test("an Advanced topic, before the upgrade, says how to run a second agent", () => {
      expect(topic).toBeDefined();
      const titles: Array<string> = (content.advanced || []).map(
        (candidate: SetupGuideTopic): string => {
          return candidate.title;
        },
      );
      expect(titles.indexOf(guide.title)).toBe(
        titles.indexOf("Upgrade or uninstall the agent") - 1,
      );
      expect((topic as SetupGuideTopic).summary).toBe(guide.summary);
      expect(
        getSeveralAgentsTopic(guide.names, byInstallScript, {
          title: guide.title,
          summary: guide.summary,
        }),
      ).toEqual(topic);
    });

    test("by the install script, a folder of its own, one value on the run line; with Compose, every name in .env", () => {
      const markdown: string = (topic as SetupGuideTopic).markdown;
      const blocks: Array<string> = codeBlocks(markdown);
      expect(blocks.length).toBe(1);
      if (byInstallScript) {
        expect(blocks[0]).toBe(
          `INSTALL_DIR=${guide.names.installDir}-${guide.names.suffix} bash install.sh`,
        );
        expect(markdown).toContain(
          `such as \`${getSecondAgentContainerName(collector, guide.names.suffix)}\`, unless you set their variables, such as \`${collector.variable}\``,
        );
        expect(markdown).toContain(
          "running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them",
        );
        expect(markdown).toContain(
          "so the script refuses a folder named like one that already runs an agent elsewhere",
        );
        expect(markdown).toContain(
          "Pass the folder to the diagnostic script with `-d`.",
        );
      } else {
        expect(blocks[0]).toBe(
          guide.names.names
            .map((name: AgentContainerName): string => {
              return `${name.variable}=${getSecondAgentContainerName(name, guide.names.suffix)}`;
            })
            .join("\n"),
        );
        expect(markdown).not.toContain("install script");
        expect(markdown).not.toContain("install.sh");
        expect(markdown).not.toContain(guide.names.installDir);
        expect(markdown).toContain(
          "Keep the names out of `docker-compose.yml`, which an upgrade replaces.",
        );
      }
      // Two containers cannot share a name, whichever way.
      expect(markdown).toContain("two containers cannot share a name");
      expect(markdown).toContain(
        `One agent reads one ${guide.names.noun}. For a second ${guide.names.noun}, `,
      );
    });

    test("the guide says it once", () => {
      const markdown: string = getSetupGuideMarkdown(content);
      expect(markdown.split(`### ${guide.title}\n`).length).toBe(2);
    });
  });
});

describe("the words are the four guides' own", () => {
  // A topic's words, with its noun and its code set aside.
  function words(markdown: string, noun: string): string {
    return markdown
      .replace(/```[^\n]*\n[\s\S]*?\n```/g, "```")
      .replace(/`[^`\n]+`/g, "`…`")
      .replace(new RegExp(`\\b${escapeRegExp(noun)}\\b`, "g"), "NOUN");
  }

  test.each(METHODS)(
    "with %s, each topic says the same, but for what one agent reads",
    (method: Method) => {
      const said: Array<string> = GUIDES.map((guide: Guide): string => {
        return words(
          (
            topicTitled(
              guide.guide(method).advanced,
              guide.title,
            ) as SetupGuideTopic
          ).markdown,
          guide.names.noun,
        );
      });
      expect(new Set(said).size).toBe(1);
    },
  );

  test("each title and summary is in the Dashboard's English locale", () => {
    const english: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/Dashboard/src/Locales/en.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    for (const guide of GUIDES) {
      expect(english[guide.title]).toBe(guide.title);
      expect(english[guide.summary]).toBe(guide.summary);
      // A summary is drawn as plain text.
      expect(guide.summary).not.toMatch(/[`*[\]]/);
    }
  });
});

describe("where no container runs", () => {
  test("VMware's install without Docker shows no name and no second agent's topic", () => {
    const content: SetupGuideContent = getVMwareSetupGuide({
      oneuptimeUrl: URL,
      apiKey: "key",
      hasApiKey: true,
      method: "linux-service",
    });
    expect(nameRows(content)).toEqual([]);
    expect(topicTitled(content.advanced, "Monitoring several vCenters")).toBe(
      undefined,
    );
    expect(getSetupGuideMarkdown(content)).not.toContain("_CONTAINER_NAME");
  });

  test("Proxmox's native push runs no agent, so it names no container", () => {
    const markdown: string = getSetupGuideMarkdown(
      getProxmoxSetupGuide({
        oneuptimeUrl: URL,
        apiKey: "key",
        hasApiKey: true,
        method: "native-push",
      }),
    );
    expect(markdown).not.toContain("_CONTAINER_NAME");
    expect(markdown).not.toContain("Monitoring several clusters");
  });

  test("a list of names with no collector is a mistake, said at once", () => {
    const none: AgentContainerNames = {
      names: [],
      noun: "cluster",
      installDir: "/opt/agent",
      suffix: "2",
    };
    expect(() => {
      return getAgentContainerNameRows(none, true);
    }).toThrow("An agent runs a collector at least");
    expect(() => {
      return getSeveralAgentsTopic(none, false, { title: "t", summary: "s" });
    }).toThrow("An agent runs a collector at least");
  });
});
