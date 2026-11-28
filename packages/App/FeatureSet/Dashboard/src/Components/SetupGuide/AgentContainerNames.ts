import { SetupGuideTopic, codeBlock } from "./SetupGuide";

/*
 * A second agent of one kind on the same machine (#11434). Docker gives a
 * name to one container at a time, so an agent's docker-compose.yml runs
 * each of its containers as `container_name: ${VARIABLE:-default}`, read
 * from that agent's .env. Its install.sh names a new agent's containers
 * after its folder unless they are set (the collector's
 * <default>-<suffix>, each container beside it <its default>-<suffix>),
 * keeps them in .env on every re-run, keeps a name once edited into
 * docker-compose.yml, and refuses a folder named like one that already
 * runs an agent: Docker Compose names a project after its folder alone.
 *
 * The Ceph, Proxmox, VMware and OpenStack guides say so in the same words,
 * from these: their environment tables' rows for the names, and a topic on
 * monitoring several of what one agent reads.
 */
export interface AgentContainerName {
  // The .env setting docker-compose.yml reads the name from.
  variable: string;
  // The name a first agent's container runs under: the variable's default.
  container: string;
  // What runs in it, as the guide's rows say it: "collector", "AI agent".
  role: string;
}

export interface AgentContainerNames {
  // The collector's first, then each container that runs beside it.
  names: Array<AgentContainerName>;
  // What one agent reads, as the guide says it: "cluster", "vCenter", "cloud".
  noun: string;
  // The folder install.sh installs into by default.
  installDir: string;
  // The guide's second agent's folder is `<installDir>-<suffix>`.
  suffix: string;
}

// What the topic is called, and its line while folded: each guide's own words.
export interface SeveralAgentsTopicTitle {
  title: string;
  summary: string;
}

function collectorOf(names: AgentContainerNames): AgentContainerName {
  const collector: AgentContainerName | undefined = names.names[0];
  if (!collector) {
    throw new Error("An agent runs a collector at least");
  }
  return collector;
}

/*
 * The name install.sh gives a container of the agent it installs into
 * `<installDir>-<suffix>`: that folder's Compose project is named after it,
 * which starts with the collector's default, so the collector is named
 * after the project and every other container after its own default, with
 * the same suffix (install.sh's directory_container_name and
 * companion_container_name_for).
 */
export function getSecondAgentContainerName(
  name: AgentContainerName,
  suffix: string,
): string {
  return `${name.container}-${suffix}`;
}

/*
 * The rows of the guide's environment table for the names. Through the
 * install script, which names a second agent's containers itself, they say
 * how; with Docker Compose, that a second agent needs names of its own.
 */
export function getAgentContainerNameRows(
  names: AgentContainerNames,
  byInstallScript: boolean,
): string {
  const collector: AgentContainerName = collectorOf(names);
  return names.names
    .map((name: AgentContainerName): string => {
      const what: string = `The ${name.role}'s container name (default: \`${name.container}\`).`;
      if (!byInstallScript) {
        return `| \`${name.variable}\` | No | ${what} A second ${names.noun}'s agent on the same machine needs one of its own |`;
      }
      if (name === collector) {
        return `| \`${name.variable}\` | No | ${what} A second ${names.noun}'s agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |`;
      }
      return `| \`${name.variable}\` | No | ${what} The install script names a second ${names.noun}'s ${name.role} after its collector (\`${getSecondAgentContainerName(name, names.suffix)}\` beside \`${getSecondAgentContainerName(collector, names.suffix)}\`) unless you set it, and keeps it when you run the script again |`;
    })
    .join("\n");
}

/*
 * How to run a second agent beside the first. Through the install script:
 * the folder, and what the script does with the names. With Docker
 * Compose: the names, in the second agent's .env, never in
 * docker-compose.yml, which an upgrade downloads again.
 */
export function getSeveralAgentsTopic(
  names: AgentContainerNames,
  byInstallScript: boolean,
  titled: SeveralAgentsTopicTitle,
): SetupGuideTopic {
  const collector: AgentContainerName = collectorOf(names);
  const noun: string = names.noun;

  if (!byInstallScript) {
    const env: string = names.names
      .map((name: AgentContainerName): string => {
        return `${name.variable}=${getSecondAgentContainerName(name, names.suffix)}`;
      })
      .join("\n");

    return {
      title: titled.title,
      summary: titled.summary,
      markdown: `One agent reads one ${noun}. For a second ${noun}, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's \`.env\`:

${codeBlock("bash", env)}

Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of \`docker-compose.yml\`, which an upgrade replaces.`,
    };
  }

  return {
    title: titled.title,
    summary: titled.summary,
    markdown: `One agent reads one ${noun}. For a second ${noun}, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:

${codeBlock("bash", `INSTALL_DIR=${names.installDir}-${names.suffix} bash install.sh`)}

The script names the containers after the folder, such as \`${getSecondAgentContainerName(collector, names.suffix)}\`, unless you set their variables, such as \`${collector.variable}\`. It keeps the names in that agent's \`.env\`, so running the script again with the same \`INSTALL_DIR\` to upgrade the agent keeps them, and an agent whose \`container_name\` you once edited in \`docker-compose.yml\` keeps that name.

Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with \`-d\`.`,
  };
}
