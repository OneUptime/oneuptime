/*
 * WHAT A CHANGE TO AN OPENSTACK CLOUD TOUCHES, AS THE AGENT READ IT.
 *
 * The blast-radius guard: a person approving a change is told how many instances and
 * projects it touches, read from the cloud by the agent itself just before they were
 * asked, and never from what a language model wrote. `openstack dry-run <change>` prints
 * this, the agent prints it again in front of a change it makes, and OneUptime keeps it
 * on the plan's step (AiRemediationCommand.reach).
 *
 * It travels as lines of a command's output, each saying one thing, with the words
 * anyone can write (an instance's name, a host's disabled reason) last on their line.
 * The output is redacted twice on the way, on the agent and on the server, and a mask
 * may swallow a whole line's tail. On these lines that only ever costs a name, so a
 * tenant whose instance is called password=abc does not stop anyone proposing the
 * evacuation of the host it is on.
 *
 * Pure, and part of the import-closed policy directory the agent carries a copy of.
 * Parsers here read a line at a time with indexOf and split, so they stay linear on
 * long hostile input.
 */

export const OPENSTACK_REACH_LINE_PREFIX: string = "oneuptime-openstack-reach ";

// The most instances a reach lists: an evacuation names at most 50.
export const OPENSTACK_REACH_MAX_LISTED_INSTANCES: number = 60;
export const OPENSTACK_REACH_MAX_LISTED_PROJECTS: number = 50;
export const OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND: number = 20;
export const OPENSTACK_REACH_MAX_HOSTS: number = 20;
export const OPENSTACK_REACH_MAX_PROBLEMS: number = 10;

// The longest word from outside OneUptime a reach keeps.
const MAX_NAME_LENGTH: number = 80;
const MAX_ID_LENGTH: number = 64;
const MAX_STATUS_LENGTH: number = 32;
const MAX_HOST_LENGTH: number = 255;
const MAX_TEXT_LENGTH: number = 500;

export interface OpenStackReachInstance {
  id: string;
  name: string | null;
  projectId: string | null;
  // Keystone's name for the project, when the agent could read it.
  projectName: string | null;
  host: string | null;
  status: string | null;
}

export interface OpenStackReachProject {
  id: string;
  name: string | null;
  instanceCount: number;
}

export interface OpenStackReachHost {
  name: string;
  // nova-compute's state, up or down, when the agent could read it.
  state: string | null;
  // enabled or disabled.
  status: string | null;
  forcedDown: boolean | null;
  disabledReason: string | null;
}

// The network agent a change is about, as the agent read it.
export interface OpenStackReachAgent {
  id: string;
  binary: string | null;
  host: string | null;
}

export type OpenStackReachKind =
  // The instances listed are the ones it changes.
  | "changes"
  // It changes something on their host, and leaves them where they are.
  | "on-host";

export interface OpenStackChangeReach {
  // The change's route: "server evacuate".
  route: string;
  kind: OpenStackReachKind;
  // The real numbers, which the lists can be shorter than.
  instanceCount: number;
  projectCount: number;
  instances: Array<OpenStackReachInstance>;
  projects: Array<OpenStackReachProject>;
  hosts: Array<OpenStackReachHost>;
  // The network agent it changes, when that is what it changes.
  agent: OpenStackReachAgent | null;
  /*
   * What the host of an evacuation still holds that it does not name. A person
   * approving "evacuate this hypervisor" should see what stays dead.
   */
  leftBehindCount: number;
  leftBehind: Array<OpenStackReachInstance>;
  // False when a read failed or stopped at its limit: the numbers are "at least".
  isComplete: boolean;
  // What the agent could not read, in its own words.
  problems: Array<string>;
  // Why the agent would refuse the change if it ran it now, or null.
  wouldBeRefused: string | null;
}

function cut(value: unknown, length: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  // One line, so that nothing in it can start another.
  let flat: string = "";

  for (let i: number = 0; i < value.length && flat.length < length; i++) {
    const code: number = value.charCodeAt(i);

    flat += code < 32 || code === 127 ? " " : value.charAt(i);
  }

  const trimmed: string = flat.trim();

  return trimmed === "" ? null : trimmed;
}

function asWord(value: unknown, length: number): string | null {
  const text: string | null = cut(value, length);

  return text === null || text.includes(" ") ? null : text;
}

function asCount(value: unknown): number {
  const count: number = typeof value === "number" ? value : Number(value);

  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/*
 * What a project's and an instance's numbers come to, from what was read: the
 * projects by their IDs, most instances first, named where a name was read.
 */
export function buildOpenStackChangeReach(data: {
  route: string;
  kind: OpenStackReachKind;
  instances: ReadonlyArray<OpenStackReachInstance>;
  projectNames: ReadonlyMap<string, string>;
  hosts: ReadonlyArray<OpenStackReachHost>;
  agent?: OpenStackReachAgent | null | undefined;
  leftBehind: ReadonlyArray<OpenStackReachInstance>;
  isComplete: boolean;
  problems: ReadonlyArray<string>;
  wouldBeRefused: string | null;
}): OpenStackChangeReach {
  const counts: Map<string, number> = new Map<string, number>();

  for (const instance of data.instances) {
    if (instance.projectId) {
      counts.set(
        instance.projectId,
        (counts.get(instance.projectId) || 0) + 1,
      );
    }
  }

  const projects: Array<OpenStackReachProject> = Array.from(counts.entries())
    .map(([id, instanceCount]: [string, number]): OpenStackReachProject => {
      return { id, name: data.projectNames.get(id) || null, instanceCount };
    })
    .sort((a: OpenStackReachProject, b: OpenStackReachProject): number => {
      return b.instanceCount !== a.instanceCount
        ? b.instanceCount - a.instanceCount
        : a.id.localeCompare(b.id);
    });

  const named: (
    instance: OpenStackReachInstance,
  ) => OpenStackReachInstance = (
    instance: OpenStackReachInstance,
  ): OpenStackReachInstance => {
    return {
      ...instance,
      projectName:
        (instance.projectId && data.projectNames.get(instance.projectId)) ||
        instance.projectName,
    };
  };

  return {
    route: data.route,
    kind: data.kind,
    instanceCount: data.instances.length,
    projectCount: projects.length,
    instances: data.instances
      .slice(0, OPENSTACK_REACH_MAX_LISTED_INSTANCES)
      .map(named),
    projects: projects.slice(0, OPENSTACK_REACH_MAX_LISTED_PROJECTS),
    hosts: data.hosts.slice(0, OPENSTACK_REACH_MAX_HOSTS),
    agent: data.agent || null,
    leftBehindCount: data.leftBehind.length,
    leftBehind: data.leftBehind
      .slice(0, OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND)
      .map(named),
    isComplete: data.isComplete,
    problems: data.problems.slice(0, OPENSTACK_REACH_MAX_PROBLEMS),
    wouldBeRefused: data.wouldBeRefused,
  };
}

function orDash(value: string | null | undefined): string {
  return value ? value : "-";
}

function fromDash(value: string | undefined): string | null {
  return value === undefined || value === "-" ? null : value;
}

function instanceFields(instance: OpenStackReachInstance): string {
  return [
    instance.id,
    orDash(asWord(instance.projectId, MAX_ID_LENGTH)),
    orDash(asWord(instance.host, MAX_HOST_LENGTH)),
    orDash(asWord(instance.status, MAX_STATUS_LENGTH)),
    // Anyone's words, last on the line.
    orDash(cut(instance.projectName, MAX_NAME_LENGTH))
      .split(" ")
      .join(" "),
    orDash(cut(instance.name, MAX_NAME_LENGTH)),
  ].join(" ");
}

// A reach as the lines a command prints.
export function renderOpenStackChangeReach(
  reach: OpenStackChangeReach,
): string {
  const line: (text: string) => string = (text: string): string => {
    return `${OPENSTACK_REACH_LINE_PREFIX}${text}`;
  };

  return [
    line(`route ${reach.route}`),
    line(`kind ${reach.kind}`),
    line(`complete ${reach.isComplete ? "yes" : "no"}`),
    line(`instances ${reach.instanceCount}`),
    line(`projects ${reach.projectCount}`),
    line(`left-behind ${reach.leftBehindCount}`),
    ...reach.instances.map((instance: OpenStackReachInstance): string => {
      return line(`instance ${instanceFields(instance)}`);
    }),
    ...reach.leftBehind.map((instance: OpenStackReachInstance): string => {
      return line(`left-behind-instance ${instanceFields(instance)}`);
    }),
    ...reach.projects.map((project: OpenStackReachProject): string => {
      return line(
        `project ${project.id} ${project.instanceCount} ${orDash(
          cut(project.name, MAX_NAME_LENGTH),
        )}`,
      );
    }),
    ...reach.hosts.map((host: OpenStackReachHost): string => {
      return line(
        `host ${host.name} ${orDash(asWord(host.state, MAX_STATUS_LENGTH))} ${orDash(
          asWord(host.status, MAX_STATUS_LENGTH),
        )} ${
          host.forcedDown === null ? "-" : host.forcedDown ? "yes" : "no"
        } ${orDash(cut(host.disabledReason, MAX_NAME_LENGTH))}`,
      );
    }),
    ...(reach.agent
      ? [
          line(
            `agent ${reach.agent.id} ${orDash(
              asWord(reach.agent.host, MAX_HOST_LENGTH),
            )} ${orDash(asWord(reach.agent.binary, MAX_NAME_LENGTH))}`,
          ),
        ]
      : []),
    ...reach.problems.map((problem: string): string => {
      return line(`problem ${cut(problem, MAX_TEXT_LENGTH) || "-"}`);
    }),
    ...(reach.wouldBeRefused
      ? [line(`refused ${cut(reach.wouldBeRefused, MAX_TEXT_LENGTH) || "-"}`)]
      : []),
  ].join("\n");
}

function readInstanceFields(fields: string): OpenStackReachInstance | null {
  const words: Array<string> = fields.split(" ");
  const id: string | null = asWord(words[0], MAX_ID_LENGTH);

  if (!id || words.length < 6) {
    return null;
  }

  const projectName: string | null = fromDash(words[4]);

  return {
    id,
    projectId: fromDash(words[1]),
    host: fromDash(words[2]),
    status: fromDash(words[3]),
    projectName: projectName ? projectName.split(" ").join(" ") : null,
    name: fromDash(words.slice(5).join(" ")),
  };
}

/*
 * A reach from a command's output, or null when the output holds none: a reach
 * must at least say its route and kind, so a line that lost a mask's worth of its
 * tail costs a name and never invents a change.
 */
export function readOpenStackChangeReach(
  output: unknown,
): OpenStackChangeReach | null {
  if (typeof output !== "string" || !output.includes(OPENSTACK_REACH_LINE_PREFIX)) {
    return null;
  }

  let route: string | null = null;
  let kind: OpenStackReachKind | null = null;
  const reach: OpenStackChangeReach = {
    route: "",
    kind: "changes",
    instanceCount: 0,
    projectCount: 0,
    instances: [],
    projects: [],
    hosts: [],
    agent: null,
    leftBehindCount: 0,
    leftBehind: [],
    isComplete: false,
    problems: [],
    wouldBeRefused: null,
  };

  for (const raw of output.split("\n")) {
    if (!raw.startsWith(OPENSTACK_REACH_LINE_PREFIX)) {
      continue;
    }

    const body: string = raw.slice(OPENSTACK_REACH_LINE_PREFIX.length);
    const space: number = body.indexOf(" ");

    if (space <= 0) {
      continue;
    }

    const key: string = body.slice(0, space);
    const rest: string = body.slice(space + 1);

    switch (key) {
      case "route":
        route = cut(rest, MAX_NAME_LENGTH);
        break;
      case "kind":
        kind = rest === "changes" || rest === "on-host" ? rest : null;
        break;
      case "complete":
        reach.isComplete = rest === "yes";
        break;
      case "instances":
        reach.instanceCount = asCount(rest);
        break;
      case "projects":
        reach.projectCount = asCount(rest);
        break;
      case "left-behind":
        reach.leftBehindCount = asCount(rest);
        break;
      case "instance": {
        const instance: OpenStackReachInstance | null =
          readInstanceFields(rest);

        if (
          instance &&
          reach.instances.length < OPENSTACK_REACH_MAX_LISTED_INSTANCES
        ) {
          reach.instances.push(instance);
        }
        break;
      }
      case "left-behind-instance": {
        const instance: OpenStackReachInstance | null =
          readInstanceFields(rest);

        if (
          instance &&
          reach.leftBehind.length < OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND
        ) {
          reach.leftBehind.push(instance);
        }
        break;
      }
      case "project": {
        const words: Array<string> = rest.split(" ");
        const id: string | null = asWord(words[0], MAX_ID_LENGTH);

        if (
          id &&
          words.length >= 3 &&
          reach.projects.length < OPENSTACK_REACH_MAX_LISTED_PROJECTS
        ) {
          reach.projects.push({
            id,
            instanceCount: asCount(words[1]),
            name: fromDash(words.slice(2).join(" ")),
          });
        }
        break;
      }
      case "host": {
        const words: Array<string> = rest.split(" ");
        const name: string | null = asWord(words[0], MAX_HOST_LENGTH);

        if (
          name &&
          words.length >= 5 &&
          reach.hosts.length < OPENSTACK_REACH_MAX_HOSTS
        ) {
          reach.hosts.push({
            name,
            state: fromDash(words[1]),
            status: fromDash(words[2]),
            forcedDown:
              words[3] === "yes" ? true : words[3] === "no" ? false : null,
            disabledReason: fromDash(words.slice(4).join(" ")),
          });
        }
        break;
      }
      case "agent": {
        const words: Array<string> = rest.split(" ");
        const id: string | null = asWord(words[0], MAX_ID_LENGTH);

        if (id && words.length >= 3) {
          reach.agent = {
            id,
            host: fromDash(words[1]),
            binary: fromDash(words[2]),
          };
        }
        break;
      }
      case "problem": {
        const text: string | null = cut(rest, MAX_TEXT_LENGTH);

        if (text && reach.problems.length < OPENSTACK_REACH_MAX_PROBLEMS) {
          reach.problems.push(text);
        }
        break;
      }
      case "refused":
        reach.wouldBeRefused = cut(rest, MAX_TEXT_LENGTH);
        break;
      default:
        break;
    }
  }

  if (!route || !kind) {
    return null;
  }

  return { ...reach, route, kind };
}

/*
 * A reach kept on a stored plan, when well-formed; dropped otherwise. A fact a
 * person reads: what runs is decided again by the agent when it runs.
 */
export function parseStoredOpenStackChangeReach(
  value: unknown,
): OpenStackChangeReach | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const obj: Record<string, unknown> = value as Record<string, unknown>;
  const route: string | null = cut(obj["route"], MAX_NAME_LENGTH);
  const kind: unknown = obj["kind"];

  if (!route || (kind !== "changes" && kind !== "on-host")) {
    return null;
  }

  const instanceOf: (entry: unknown) => OpenStackReachInstance | null = (
    entry: unknown,
  ): OpenStackReachInstance | null => {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const row: Record<string, unknown> = entry as Record<string, unknown>;
    const id: string | null = asWord(row["id"], MAX_ID_LENGTH);

    return id
      ? {
          id,
          name: cut(row["name"], MAX_NAME_LENGTH),
          projectId: asWord(row["projectId"], MAX_ID_LENGTH),
          projectName: cut(row["projectName"], MAX_NAME_LENGTH),
          host: asWord(row["host"], MAX_HOST_LENGTH),
          status: asWord(row["status"], MAX_STATUS_LENGTH),
        }
      : null;
  };

  const instancesOf: (
    list: unknown,
    limit: number,
  ) => Array<OpenStackReachInstance> = (
    list: unknown,
    limit: number,
  ): Array<OpenStackReachInstance> => {
    return (Array.isArray(list) ? list.slice(0, limit) : [])
      .map(instanceOf)
      .filter(
        (
          instance: OpenStackReachInstance | null,
        ): instance is OpenStackReachInstance => {
          return instance !== null;
        },
      );
  };

  const projects: Array<OpenStackReachProject> = (
    Array.isArray(obj["projects"])
      ? obj["projects"].slice(0, OPENSTACK_REACH_MAX_LISTED_PROJECTS)
      : []
  )
    .map((entry: unknown): OpenStackReachProject | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const row: Record<string, unknown> = entry as Record<string, unknown>;
      const id: string | null = asWord(row["id"], MAX_ID_LENGTH);

      return id
        ? {
            id,
            name: cut(row["name"], MAX_NAME_LENGTH),
            instanceCount: asCount(row["instanceCount"]),
          }
        : null;
    })
    .filter(
      (project: OpenStackReachProject | null): project is OpenStackReachProject => {
        return project !== null;
      },
    );

  const hosts: Array<OpenStackReachHost> = (
    Array.isArray(obj["hosts"])
      ? obj["hosts"].slice(0, OPENSTACK_REACH_MAX_HOSTS)
      : []
  )
    .map((entry: unknown): OpenStackReachHost | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const row: Record<string, unknown> = entry as Record<string, unknown>;
      const name: string | null = asWord(row["name"], MAX_HOST_LENGTH);

      return name
        ? {
            name,
            state: asWord(row["state"], MAX_STATUS_LENGTH),
            status: asWord(row["status"], MAX_STATUS_LENGTH),
            forcedDown:
              typeof row["forcedDown"] === "boolean" ? row["forcedDown"] : null,
            disabledReason: cut(row["disabledReason"], MAX_NAME_LENGTH),
          }
        : null;
    })
    .filter((host: OpenStackReachHost | null): host is OpenStackReachHost => {
      return host !== null;
    });

  return {
    route,
    kind,
    instanceCount: asCount(obj["instanceCount"]),
    projectCount: asCount(obj["projectCount"]),
    instances: instancesOf(
      obj["instances"],
      OPENSTACK_REACH_MAX_LISTED_INSTANCES,
    ),
    projects,
    hosts,
    agent: ((): OpenStackReachAgent | null => {
      const row: unknown = obj["agent"];

      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return null;
      }

      const agent: Record<string, unknown> = row as Record<string, unknown>;
      const id: string | null = asWord(agent["id"], MAX_ID_LENGTH);

      return id
        ? {
            id,
            binary: asWord(agent["binary"], MAX_NAME_LENGTH),
            host: asWord(agent["host"], MAX_HOST_LENGTH),
          }
        : null;
    })(),
    leftBehindCount: asCount(obj["leftBehindCount"]),
    leftBehind: instancesOf(
      obj["leftBehind"],
      OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND,
    ),
    isComplete: obj["isComplete"] === true,
    problems: (Array.isArray(obj["problems"])
      ? obj["problems"].slice(0, OPENSTACK_REACH_MAX_PROBLEMS)
      : []
    )
      .map((problem: unknown): string | null => {
        return cut(problem, MAX_TEXT_LENGTH);
      })
      .filter((problem: string | null): problem is string => {
        return problem !== null;
      }),
    wouldBeRefused: cut(obj["wouldBeRefused"], MAX_TEXT_LENGTH),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/*
 * The one sentence about how much a change touches, with "at least" where a read
 * fell short: what a command prints above its lines, and what a proposal says.
 */
export function describeOpenStackChangeReachCounts(
  reach: OpenStackChangeReach,
): string {
  const atLeast: string = reach.isComplete ? "" : "at least ";
  const counts: string = `${atLeast}${plural(
    reach.instanceCount,
    "instance",
    "instances",
  )} in ${atLeast}${plural(reach.projectCount, "project", "projects")}`;

  return reach.kind === "changes"
    ? `This changes ${counts}.`
    : `This changes no instance, and the host it is about holds ${counts}.`;
}
