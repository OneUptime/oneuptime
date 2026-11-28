import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { tabPanel } from "./DocsPageShape";
import { escapeRegExp } from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import path from "path";

/*
 * A SECOND CEPH, PROXMOX, VMWARE OR OPENSTACK AGENT ON ONE MACHINE (#11434).
 *
 * Each of the four agents' docker-compose.yml runs every container as
 * `container_name: ${VARIABLE:-default}`, read from that agent's .env, and
 * its install.sh names a new agent's containers after its folder, keeps the
 * names on every re-run and refuses a folder named like one that already
 * runs an agent. A reader who wants a second cluster, vCenter or cloud from
 * the same machine learns all that from the docs page and the README:
 * every name's variable and default in the environment table, the Docker
 * Compose .env example, a section of its own and the upgrade. These hold
 * each one to the files the agent ships - the names to the compose file,
 * the names a folder gets to install.sh's own functions, run - in English
 * and in every language the docs are read in.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);

const TRANSLATED_LANGUAGES: ReadonlyArray<string> =
  SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
    return language !== "en";
  });

interface Agent {
  name: string;
  // The docs page, from the content folder of a language, without .md.
  page: string;
  agentDir: string;
  // Where install.sh installs by default, and its systemd unit's name.
  installDir: string;
  unit: string;
  // The section on a second agent, and its anchor.
  heading: string;
  anchor: string;
  // The docs' second agent's folder is `<installDir>-<suffix>`.
  suffix: string;
  // The README section with its settings table.
  readmeSettings: string;
}

const AGENTS: ReadonlyArray<Agent> = [
  {
    name: "Ceph",
    page: "telemetry/ceph",
    agentDir: "CephAgent",
    installDir: "/opt/oneuptime-ceph-agent",
    unit: "oneuptime-ceph-agent",
    heading: "## Monitoring several clusters",
    anchor: "monitoring-several-clusters",
    suffix: "cluster2",
    readmeSettings: "## Environment Variables",
  },
  {
    name: "Proxmox",
    page: "telemetry/proxmox",
    agentDir: "ProxmoxAgent",
    installDir: "/opt/oneuptime-proxmox-agent",
    unit: "oneuptime-proxmox-agent",
    heading: "## Monitoring several clusters",
    anchor: "monitoring-several-clusters",
    suffix: "cluster2",
    readmeSettings: "## Environment Variables",
  },
  {
    name: "VMware",
    page: "telemetry/vmware",
    agentDir: "VMwareAgent",
    installDir: "/opt/oneuptime-vmware-agent",
    unit: "oneuptime-vmware-agent",
    heading: "## Monitoring several vCenters",
    anchor: "monitoring-several-vcenters",
    suffix: "vcenter2",
    readmeSettings: "## Environment Variables",
  },
  {
    name: "OpenStack",
    page: "telemetry/openstack",
    agentDir: "OpenStackAgent",
    installDir: "/opt/oneuptime-openstack-agent",
    unit: "oneuptime-openstack-agent",
    heading: "## Monitoring several clouds",
    anchor: "monitoring-several-clouds",
    suffix: "cloud2",
    readmeSettings: "## Settings",
  },
];

interface ContainerName {
  service: string;
  variable: string;
  container: string;
}

function readPage(relative: string, language: string = "en"): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${relative}.md`),
    "utf8",
  );
}

function readAgentFile(agent: Agent, file: string): string {
  return fs.readFileSync(
    path.join(REPO_ROOT, "agents", agent.agentDir, file),
    "utf8",
  );
}

/* The body of one "## Heading" section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/*
 * Hoisted rather than written inline in the `.test()` call below: eslint's
 * wrap-regex and prettier disagree about parentheses around a regex literal
 * that a method is called on.
 */
const HEADING_LINE: RegExp = /^#{1,6}\s/;

// The headings of a page, outside its code blocks: [line index, text].
function headings(markdown: string): Array<[number, string]> {
  const found: Array<[number, string]> = [];
  let inCode: boolean = false;

  markdown.split("\n").forEach((line: string, index: number): void => {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      return;
    }

    if (!inCode && HEADING_LINE.test(line)) {
      found.push([index, line]);
    }
  });

  return found;
}

// Every container of a compose file, with the .env variable its name is read from.
function containerNames(compose: string): Array<ContainerName> {
  const names: Array<ContainerName> = [];
  let service: string = "";

  for (const line of compose.split("\n")) {
    const serviceLine: RegExpMatchArray | null = line.match(
      /^ {2}([a-z0-9][a-z0-9-]*):\s*$/,
    );

    if (serviceLine) {
      service = serviceLine[1] as string;
      continue;
    }

    const nameLine: RegExpMatchArray | null = line.match(
      /^ {4}container_name:\s*(.+)$/,
    );

    if (nameLine) {
      const read: RegExpMatchArray | null = (nameLine[1] as string).match(
        /^\$\{([A-Z][A-Z0-9_]*):-([a-z0-9][a-z0-9_.-]*)\}$/,
      );

      // Every one from .env, with a first agent's name as its default.
      expect({
        service,
        containerName: nameLine[1],
        fromEnv: Boolean(read),
      }).toEqual({
        service,
        containerName: nameLine[1],
        fromEnv: true,
      });
      names.push({
        service,
        variable: (read as RegExpMatchArray)[1] as string,
        container: (read as RegExpMatchArray)[2] as string,
      });
    }
  }

  return names;
}

// One shell function of a script, as it is written there.
function shellFunction(script: string, name: string): string {
  const found: RegExpMatchArray | null = script.match(
    new RegExp(`^${escapeRegExp(name)}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, "m"),
  );

  expect({ name, defined: Boolean(found) }).toEqual({ name, defined: true });

  return (found as RegExpMatchArray)[0];
}

/*
 * The names install.sh gives the containers of an agent it installs into
 * `installDir`, by its own functions, run: the collector's after the
 * folder's Compose project, and each other one's beside it.
 */
function namesInstallShGives(agent: Agent, installDir: string): Array<string> {
  const script: string = readAgentFile(agent, "install.sh");
  const defaultName: string = (
    script.match(/^DEFAULT_CONTAINER_NAME="([^"]+)"$/m) as RegExpMatchArray
  )[1] as string;
  const companions: string = (
    script.match(/^COMPANION_CONTAINERS="([^"]*)"$/m) as RegExpMatchArray
  )[1] as string;
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
      DEFAULT_CONTAINER_NAME: defaultName,
      INSTALL_DIR: installDir,
      // No .env: a new agent's, which names no Compose project.
      ENV_FILE: "/nonexistent-oneuptime-agent/.env",
      COMPANIONS: companions,
    },
  });

  expect({ status: run.status, stderr: run.stderr }).toEqual({
    status: 0,
    stderr: "",
  });

  return run.stdout.split("\n").filter(Boolean);
}

function secondAgentDir(agent: Agent): string {
  return `${agent.installDir}-${agent.suffix}`;
}

// Each name, as the docs' second agent has it.
function secondAgentNames(
  names: Array<ContainerName>,
  agent: Agent,
): Array<string> {
  return names.map((name: ContainerName): string => {
    return `${name.container}-${agent.suffix}`;
  });
}

// The table rows of a section that document one variable.
function rowOf(markdown: string, variable: string): string {
  const rows: Array<string> = markdown
    .split("\n")
    .filter((line: string): boolean => {
      return new RegExp(`^\\|\\s*\`${escapeRegExp(variable)}\`\\s*\\|`).test(
        line,
      );
    });

  expect({ variable, rows: rows.length }).toEqual({ variable, rows: 1 });

  return rows[0] as string;
}

describe.each(AGENTS)("a second $name agent on one machine", (agent: Agent) => {
  const compose: string = readAgentFile(agent, "docker-compose.yml");
  const names: Array<ContainerName> = containerNames(compose);
  const page: string = readPage(agent.page);
  const several: string = section(page, agent.heading);
  const installCommand: string = `INSTALL_DIR=${secondAgentDir(agent)} bash install.sh`;

  it("runs every container under a name read from .env, the collector's first", () => {
    const script: string = readAgentFile(agent, "install.sh");
    const collector: ContainerName = names[0] as ContainerName;

    expect(collector.container).toBe(
      (
        script.match(/^DEFAULT_CONTAINER_NAME="([^"]+)"$/m) as RegExpMatchArray
      )[1],
    );
    expect(collector.service).toBe(
      (script.match(/^AGENT_SERVICE="([^"]+)"$/m) as RegExpMatchArray)[1],
    );
    // install.sh names the others from its own list, in the compose file's order.
    const companions: Array<string> = (
      (
        script.match(/^COMPANION_CONTAINERS="([^"]*)"$/m) as RegExpMatchArray
      )[1] as string
    )
      .split("\n")
      .map((line: string): string => {
        const [variable, service, container] = line.split("|");
        return `${variable}|${service}|${container}`;
      });
    expect(companions).toEqual(
      names.slice(1).map((name: ContainerName): string => {
        return `${name.variable}|${name.service}|${name.container}`;
      }),
    );
    // And writes each to .env, quoted as Compose reads it.
    for (const name of names) {
      expect(script).toContain(
        `${name.variable}=$(compose_env_quote "$${name.variable}")`,
      );
    }
  });

  it("the names the docs give a second agent are the ones install.sh gives its folder", () => {
    expect(namesInstallShGives(agent, secondAgentDir(agent))).toEqual(
      secondAgentNames(names, agent),
    );
    // A first agent, in the default folder, keeps every default.
    expect(namesInstallShGives(agent, agent.installDir)).toEqual(
      names.map((name: ContainerName): string => {
        return name.container;
      }),
    );
    // The default folder spelled with a slash at its end is the same one.
    expect(namesInstallShGives(agent, `${agent.installDir}/`)).toEqual(
      names.map((name: ContainerName): string => {
        return name.container;
      }),
    );
  });

  it("the environment table documents every name, with the compose file's default", () => {
    const table: string = section(page, "## Environment variables");

    for (const name of names) {
      expect(rowOf(table, name.variable)).toContain(
        `Defaults to \`${name.container}\``,
      );
    }
    // The collector's row sends the reader to the section.
    expect(rowOf(table, (names[0] as ContainerName).variable)).toContain(
      `(#${agent.anchor})`,
    );
    expect(slugifyMarkdownHeading(agent.heading.replace(/^#+\s*/, ""))).toBe(
      agent.anchor,
    );
  });

  it("the Docker Compose .env example sets every name to its default", () => {
    const quickStart: string = tabPanel(page, "Docker Compose");

    for (const name of names) {
      expect(quickStart).toContain(`\n${name.variable}=${name.container}\n`);
    }
  });

  it("the section installs a second agent into a folder of its own, and names what it is called", () => {
    expect(several).toContain(`\`\`\`bash\n${installCommand}\n\`\`\``);
    for (const second of secondAgentNames(names, agent)) {
      expect(several).toContain(`\`${second}\``);
    }
    expect(several).toContain(`\`${(names[0] as ContainerName).variable}\``);
    // Kept on every re-run, and once edited into docker-compose.yml.
    expect(several).toContain(
      "running the script again to upgrade the agent keeps them",
    );
    expect(several).toContain(
      "an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name",
    );
    // The folder's name, which Compose names the project after.
    expect(several).toContain(
      "the script refuses a folder named like one that already runs an agent elsewhere",
    );
    expect(several).toContain(
      "With Docker Compose, set the names in each agent's `.env` instead.",
    );
    // Never an edit of docker-compose.yml, which an upgrade replaces.
    expect(several).not.toMatch(/give (?:each|it) its own `container_name`/);
  });

  it("the section's systemd unit and diagnostic script take the second folder", () => {
    expect(readAgentFile(agent, `systemd/${agent.unit}.service`)).toContain(
      `WorkingDirectory=${agent.installDir}\n`,
    );
    expect(several).toContain(
      `The systemd unit assumes \`${agent.installDir}\`: for another folder, save it under another name, such as \`${agent.unit}-${agent.suffix}.service\`, and change its \`WorkingDirectory\`.`,
    );
    expect(several).toContain(
      "Pass the folder to the diagnostic script with `-d`.",
    );
    expect(readAgentFile(agent, "troubleshoot.sh")).toContain(
      '-d|--dir)      DIR="${2:-}"; shift 2 ;;',
    );
  });

  it("the upgrade says how to reach an agent outside the default folder", () => {
    expect(section(page, "## Upgrading the agent")).toContain(
      `An agent installed outside \`${agent.installDir}\` needs its folder, \`INSTALL_DIR=<folder> bash install.sh\`, and keeps its container names.`,
    );
  });

  it("the README says the same, with every name and default in its settings", () => {
    const readme: string = readAgentFile(agent, "README.md");
    const settings: string = section(readme, agent.readmeSettings);
    const readmeSection: string = section(readme, agent.heading);

    for (const name of names) {
      expect(rowOf(settings, name.variable)).toContain(
        `default: \`${name.container}\``,
      );
    }
    expect(readmeSection).toContain(`\`\`\`bash\n${installCommand}\n\`\`\``);
    for (const second of secondAgentNames(names, agent)) {
      expect(readmeSection).toContain(`\`${second}\``);
    }
    expect(readmeSection).not.toMatch(
      /give (?:each|it) its own `container_name`/,
    );
  });

  describe.each(TRANSLATED_LANGUAGES)("in %s", (language: string) => {
    const translated: string = readPage(agent.page, language);

    it("has the section at the English one's place, with the same install command", () => {
      const english: Array<[number, string]> = headings(page);
      const theirs: Array<[number, string]> = headings(translated);
      const at: number = english.findIndex(
        ([, line]: [number, string]): boolean => {
          return line === agent.heading;
        },
      );

      expect(theirs.length).toBe(english.length);
      expect((theirs[at] as [number, string])[0]).toBe(
        (english[at] as [number, string])[0],
      );

      const heading: string = (theirs[at] as [number, string])[1];
      expect(heading).not.toBe(agent.heading);
      expect(section(translated, heading)).toContain(
        `\`\`\`bash\n${installCommand}\n\`\`\``,
      );
    });

    it("documents every name, and its link reaches the section", () => {
      const at: number = headings(page).findIndex(
        ([, line]: [number, string]): boolean => {
          return line === agent.heading;
        },
      );
      const heading: string = (headings(translated)[at] as [number, string])[1];
      const anchor: string = slugifyMarkdownHeading(
        heading.replace(/^#+\s*/, ""),
      );

      for (const name of names) {
        expect(rowOf(translated, name.variable)).toContain(
          `\`${name.container}\``,
        );
      }
      expect(rowOf(translated, (names[0] as ContainerName).variable)).toContain(
        `(#${anchor})`,
      );
    });

    it("sets every name in its Docker Compose .env example", () => {
      for (const name of names) {
        expect(translated).toContain(`\n${name.variable}=${name.container}\n`);
      }
    });
  });
});

describe("what only the OpenStack agent has", () => {
  const agent: Agent = AGENTS.find((candidate: Agent): boolean => {
    return candidate.name === "OpenStack";
  }) as Agent;

  it("its logs and traces collectors read their names from .env too, and the page names both", () => {
    const page: string = readPage(agent.page);
    const logs: Array<ContainerName> = containerNames(
      readAgentFile(agent, "docker-compose.logs.yml"),
    );
    const traces: Array<ContainerName> = containerNames(
      readAgentFile(agent, "docker-compose.traces.yml"),
    );

    expect(logs).toEqual([
      {
        service: "oneuptime-openstack-logs",
        variable: "OPENSTACK_LOGS_CONTAINER_NAME",
        container: "oneuptime-openstack-logs",
      },
    ]);
    expect(
      traces.map((name: ContainerName): string => {
        return `${name.variable}:${name.container}`;
      }),
    ).toEqual(["OPENSTACK_TRACES_CONTAINER_NAME:oneuptime-openstack-traces"]);
    expect(section(page, agent.heading)).toContain(
      "`OPENSTACK_LOGS_CONTAINER_NAME` and `OPENSTACK_TRACES_CONTAINER_NAME`",
    );
    expect(rowOf(page, "OPENSTACK_LOGS_CONTAINER_NAME")).toContain(
      "Defaults to `oneuptime-openstack-logs`",
    );
    // Each script keeps its collector's name in .env, as install.sh does.
    expect(readAgentFile(agent, "install-logs.sh")).toContain(
      '\nOPENSTACK_LOGS_CONTAINER_NAME=$(compose_env_quote "$OPENSTACK_LOGS_CONTAINER_NAME")\n',
    );
    expect(readAgentFile(agent, "install-traces.sh")).toContain(
      'printf \'OPENSTACK_TRACES_CONTAINER_NAME=%s\\n\' "$(compose_env_quote "$OPENSTACK_TRACES_CONTAINER_NAME")"',
    );
  });
});

describe("what only the VMware agent has", () => {
  const agent: Agent = AGENTS.find((candidate: Agent): boolean => {
    return candidate.name === "VMware";
  }) as Agent;
  const several: string = section(readPage(agent.page), agent.heading);

  it("a second agent's syslog port is another one, as the compose file publishes it", () => {
    expect(readAgentFile(agent, "docker-compose.yml")).toContain(
      '    #   - "5514:5514/udp"\n',
    );
    expect(several).toContain("such as `5515:5514`");
    expect(several).toContain("](#optional-ship-esxi-syslog)");
    expect(
      headings(readPage(agent.page)).map(
        ([, line]: [number, string]): string => {
          return slugifyMarkdownHeading(line.replace(/^#+\s*/, ""));
        },
      ),
    ).toContain("optional-ship-esxi-syslog");
  });

  it("without Docker, a second agent is a second unit of its own folder and metrics port", () => {
    const unit: string = readAgentFile(
      agent,
      "systemd/oneuptime-vmware-agent-native.service",
    );

    expect(unit).toContain(`EnvironmentFile=${agent.installDir}/.env\n`);
    expect(unit).toMatch(
      new RegExp(
        `^ExecStart=${escapeRegExp(agent.installDir)}/otelcol-contrib `,
        "m",
      ),
    );
    expect(unit).toContain("port: 8890}");
    expect(several).toContain(
      "whose `EnvironmentFile` and `ExecStart` name its own folder, and whose collector reports its own metrics on another port than `8890`",
    );
  });
});
