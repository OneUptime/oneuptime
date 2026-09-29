/*
 * The docker CLI grammar the docker-engine and docker-swarm command
 * policies share (DockerEngineCommandPolicy, DockerSwarmCommandPolicy):
 * how the docker CLI (docker 29.x, cobra + pflag) finds the command in an
 * argv and parses its flags, the engine's read commands both profiles
 * allow, the commands neither ever allows, and the value checks every
 * command uses.
 *
 * The agent spawns the docker CLI with the argv this grammar read, so the
 * grammar has to see the SAME command, flags and positionals docker will
 * see — otherwise a denied flag or a second container could hide inside
 * what we took for a flag value. The rules, which parseDockerFlags()
 * mirrors exactly (pflag's parseLongArg / parseSingleShortArg):
 *
 *   - The command is picked before any flag is read. docker's global flags
 *     (-H/--host, -c/--context, --config, --tls*, -D/--debug,
 *     -l/--log-level, -v/--version) exist ONLY before the command, and are
 *     exactly what would point the CLI at another engine or another
 *     credential store, so ANY word that starts with "-" before the
 *     command (and, for a command group such as `docker container`, before
 *     its subcommand) is refused. After the command, a global flag is just
 *     a flag that command does not have.
 *   - "--flag=value" carries its value inline. "--flag value" takes the next
 *     word ONLY when the flag takes a value — whatever that word looks like
 *     ("--since -f" is a since of "-f"). A switch never takes the next word:
 *     "--all true" is the switch plus a positional "true". A switch may be
 *     written "--all=false"; its value is read like Go's strconv.ParseBool.
 *   - "-abc" is a cluster of one-letter flags read letter by letter: each
 *     switch letter is followed by another letter, until a letter that
 *     takes a value, whose value is "=x" ("-n=5"), the rest of the word
 *     ("-n5") or, when nothing is left, the next word ("-n 5").
 *   - "--" ends the flags; every word after it is positional. So does the
 *     first positional for a command that stops reading flags there
 *     (docker top: everything after the container is a ps option).
 *   - Flag names are case-sensitive and never normalized ("--no_trunc" is
 *     not "--no-trunc"); a flag the command does not have is an error.
 *
 * On top of the CLI's own rules, fail-closed ones: a flag this grammar does
 * not list for the command is Denied (unknown means we cannot know what it
 * does, or which word it swallows); a flag written twice is Denied unless
 * docker appends its values (--filter), since pflag keeps the LAST value
 * and "--no-stream --no-stream=false" would stream; a value that must be a
 * number, a duration or a name is checked against exactly that; and a
 * container, image, network, volume, service, node or stack is only ever
 * a word docker itself would accept as one ([A-Za-z0-9][A-Za-z0-9_.-]*),
 * so a unicode dash, a quote or a template can never pose as one.
 *
 * `--format` is limited to "json" (and "table" for list commands): a Go
 * template can print a container's environment unlabelled, where the
 * output redactor could not recognise it.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set
 * only, and nothing from Node.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { MAX_COMMAND_LENGTH_CHARS } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import {
  MAX_RESOURCE_COMMAND_TOKENS,
  ResourceCommandPolicyResult,
  deniedResult,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";

// ---- Flags ------------------------------------------------------------------

export enum DockerFlagKind {
  // A switch: never takes the next word ("-a", "--all", "--all=false").
  Bool = "Bool",
  // Always takes a value: "-n 5", "-n5", "-n=5", "--last 5", "--last=5".
  Value = "Value",
}

export interface DockerFlagSpec {
  // The long name, without dashes: "all", "tail", "no-stream".
  name: string;
  // The one-letter shorthand the real CLI defines for it, if any.
  shorthand?: string | undefined;
  kind: DockerFlagKind;
  // Other long spellings the CLI accepts for the same flag ("time" for "timeout").
  aliases?: ReadonlyArray<string> | undefined;
  // docker appends every use (--filter); any other flag may be given once.
  repeatable?: boolean | undefined;
  /*
   * Set when docker has the flag but OneUptime AI may never use it: the
   * tail of the reason, after "the --x flag ".
   */
  refusal?: string | undefined;
}

export interface DockerParsedArgs {
  positionals: Array<string>;
  /*
   * Each flag's values in the order given, keyed by its long name. A
   * switch's value is "true" or "false" (after ParseBool).
   */
  values: Map<string, Array<string>>;
  // The first problem: an unknown or refused flag, bad syntax, a missing value, a repeat.
  problem?: string | undefined;
}

/*
 * The long and short spellings of docker's global flags, which never follow
 * the command. Used only to explain a refusal better.
 */
const GLOBAL_LONG_FLAGS: Set<string> = new Set<string>([
  "host",
  "context",
  "config",
  "tls",
  "tlscacert",
  "tlscert",
  "tlskey",
  "tlsverify",
  "debug",
  "log-level",
  "version",
]);

const GLOBAL_SHORT_FLAGS: Set<string> = new Set<string>([
  "H",
  "c",
  "D",
  "l",
  "v",
]);

export const DOCKER_GLOBAL_FLAG_RULE: string =
  "docker's global flags (-H/--host, -c/--context, --config, --tls*, -D/--debug, -l/--log-level) are never allowed: the agent always talks to its own engine with its own settings";

// Go's strconv.ParseBool, which pflag reads a switch's "=value" with.
const GO_TRUE_WORDS: Set<string> = new Set<string>([
  "1",
  "t",
  "T",
  "TRUE",
  "true",
  "True",
]);

const GO_FALSE_WORDS: Set<string> = new Set<string>([
  "0",
  "f",
  "F",
  "FALSE",
  "false",
  "False",
]);

function parseGoBool(value: string): boolean | null {
  if (GO_TRUE_WORDS.has(value)) {
    return true;
  }

  if (GO_FALSE_WORDS.has(value)) {
    return false;
  }

  return null;
}

function findLongFlag(
  flags: ReadonlyArray<DockerFlagSpec>,
  name: string,
): DockerFlagSpec | undefined {
  return flags.find((flag: DockerFlagSpec): boolean => {
    return (
      flag.name === name ||
      (Array.isArray(flag.aliases) && flag.aliases.includes(name))
    );
  });
}

function findShortFlag(
  flags: ReadonlyArray<DockerFlagSpec>,
  letter: string,
): DockerFlagSpec | undefined {
  return flags.find((flag: DockerFlagSpec): boolean => {
    return flag.shorthand !== undefined && flag.shorthand === letter;
  });
}

// "-a/--all, --no-trunc, -f/--filter KEY=VALUE" — the flags a command allows.
export function describeAllowedDockerFlags(
  flags: ReadonlyArray<DockerFlagSpec>,
): string {
  const allowed: Array<string> = flags
    .filter((flag: DockerFlagSpec): boolean => {
      return !flag.refusal;
    })
    .map((flag: DockerFlagSpec): string => {
      const long: string = `--${flag.name}`;
      const written: string = flag.shorthand
        ? `-${flag.shorthand}/${long}`
        : long;
      return flag.kind === DockerFlagKind.Value ? `${written} VALUE` : written;
    });

  return allowed.length > 0 ? allowed.join(", ") : "none";
}

function describeUnknownFlag(data: {
  shown: string;
  bareName: string;
  isShort: boolean;
  command: string;
  flags: ReadonlyArray<DockerFlagSpec>;
}): string {
  const isGlobal: boolean = data.isShort
    ? GLOBAL_SHORT_FLAGS.has(data.bareName)
    : GLOBAL_LONG_FLAGS.has(data.bareName) ||
      data.bareName.startsWith("tls");

  const allowed: string = `flags ${data.command} allows: ${describeAllowedDockerFlags(
    data.flags,
  )}`;

  if (isGlobal) {
    return `the ${data.shown} flag is not allowed: ${DOCKER_GLOBAL_FLAG_RULE} (${allowed})`;
  }

  return `the ${data.shown} flag is not one OneUptime AI may use with ${data.command} (${allowed})`;
}

/*
 * Parse the words after the command path exactly the way pflag would (see
 * the header). Stops at the first problem; a caller must refuse the
 * command when `problem` is set.
 */
export function parseDockerFlags(data: {
  words: Array<string>;
  flags: ReadonlyArray<DockerFlagSpec>;
  // For messages: "docker logs", "docker service update".
  command: string;
  // false for a command that stops reading flags at its first positional.
  interspersed: boolean;
}): DockerParsedArgs {
  const words: Array<string> = data.words;
  const positionals: Array<string> = [];
  const values: Map<string, Array<string>> = new Map<string, Array<string>>();
  let flagsEnded: boolean = false;

  const fail: (problem: string) => DockerParsedArgs = (
    problem: string,
  ): DockerParsedArgs => {
    return { positionals, values, problem };
  };

  // Records one value; returns why it cannot be recorded, or null.
  const record: (
    flag: DockerFlagSpec,
    rawValue: string,
    shown: string,
  ) => string | null = (
    flag: DockerFlagSpec,
    rawValue: string,
    shown: string,
  ): string | null => {
    let value: string = rawValue;

    if (flag.kind === DockerFlagKind.Bool) {
      const parsed: boolean | null = parseGoBool(rawValue);

      if (parsed === null) {
        return `the ${shown} flag is a switch: write it alone (or =true / =false), not with "${rawValue}"`;
      }

      value = parsed ? "true" : "false";
    }

    const existing: Array<string> | undefined = values.get(flag.name);

    if (existing && !flag.repeatable) {
      return `the ${shown} flag is given more than once: docker keeps only the last value, so write it once`;
    }

    if (existing) {
      existing.push(value);
    } else {
      values.set(flag.name, [value]);
    }

    return null;
  };

  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index] || "";

    // pflag: "", "-" and anything not starting with "-" are positionals.
    if (flagsEnded || word.length < 2 || !word.startsWith("-")) {
      positionals.push(word);

      if (!data.interspersed) {
        flagsEnded = true;
      }

      continue;
    }

    if (word === "--") {
      flagsEnded = true;
      continue;
    }

    if (word.startsWith("--")) {
      const body: string = word.slice(2);

      if (body.startsWith("-") || body.startsWith("=")) {
        return fail(`"${word}" is not valid flag syntax`);
      }

      const equals: number = body.indexOf("=");
      const name: string = equals >= 0 ? body.slice(0, equals) : body;
      const shown: string = `--${name}`;
      const flag: DockerFlagSpec | undefined = findLongFlag(data.flags, name);

      if (!flag) {
        return fail(
          describeUnknownFlag({
            shown,
            bareName: name,
            isShort: false,
            command: data.command,
            flags: data.flags,
          }),
        );
      }

      if (flag.refusal) {
        return fail(`the ${shown} flag ${flag.refusal}`);
      }

      let value: string;

      if (equals >= 0) {
        value = body.slice(equals + 1);
      } else if (flag.kind === DockerFlagKind.Bool) {
        value = "true";
      } else if (index + 1 < words.length) {
        value = words[index + 1] || "";
        index++;
      } else {
        return fail(`the ${shown} flag needs a value`);
      }

      const problem: string | null = record(flag, value, shown);

      if (problem) {
        return fail(problem);
      }

      continue;
    }

    // "-abc": a cluster of one-letter flags, read letter by letter like pflag.
    let rest: string = word.slice(1);

    while (rest.length > 0) {
      const letter: string = rest.charAt(0);
      const shown: string =
        word === `-${letter}` || word.startsWith(`-${letter}=`)
          ? `-${letter}`
          : `-${letter} (in "${word}")`;
      const flag: DockerFlagSpec | undefined = findShortFlag(
        data.flags,
        letter,
      );

      if (!flag) {
        return fail(
          describeUnknownFlag({
            shown,
            bareName: letter,
            isShort: true,
            command: data.command,
            flags: data.flags,
          }),
        );
      }

      if (flag.refusal) {
        return fail(`the ${shown} flag ${flag.refusal}`);
      }

      let value: string;

      if (rest.length > 2 && rest.charAt(1) === "=") {
        // "-n=5" (and "-a=false")
        value = rest.slice(2);
        rest = "";
      } else if (flag.kind === DockerFlagKind.Bool) {
        // "-aq": the next letter is another flag.
        value = "true";
        rest = rest.slice(1);
      } else if (rest.length > 1) {
        // "-n5"
        value = rest.slice(1);
        rest = "";
      } else if (index + 1 < words.length) {
        // "-n 5"
        value = words[index + 1] || "";
        index++;
        rest = "";
      } else {
        return fail(`the ${shown} flag needs a value`);
      }

      const problem: string | null = record(flag, value, shown);

      if (problem) {
        return fail(problem);
      }
    }
  }

  return { positionals, values };
}

// Every value a flag was given, by its long name.
export function dockerFlagValues(
  parsed: DockerParsedArgs,
  name: string,
): Array<string> {
  return parsed.values.get(name) || [];
}

// The flag's value (flags other than --filter are given at most once).
export function dockerFlagValue(
  parsed: DockerParsedArgs,
  name: string,
): string | undefined {
  const all: Array<string> = dockerFlagValues(parsed, name);
  return all.length > 0 ? all[all.length - 1] : undefined;
}

export function isDockerFlagGiven(
  parsed: DockerParsedArgs,
  name: string,
): boolean {
  return dockerFlagValues(parsed, name).length > 0;
}

// A switch that is on: given, and not "=false".
export function isDockerSwitchOn(
  parsed: DockerParsedArgs,
  name: string,
): boolean {
  return dockerFlagValue(parsed, name) === "true";
}

// ---- Values -----------------------------------------------------------------

/*
 * A container, network, volume, service, task, node or stack: a name docker
 * accepts, or an id (or a hex prefix of one). ASCII only, so a unicode dash
 * or a look-alike letter never passes for a name — or for a flag.
 */
const DOCKER_OBJECT_NAME_REGEX: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;

/*
 * An image reference: [registry[:port]/]repository[:tag][@digest]. Checked
 * loosely (docker checks the rest); never a flag, a space or a template.
 */
const DOCKER_IMAGE_REFERENCE_REGEX: RegExp =
  /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,254}$/;

export function isDockerObjectName(word: string): boolean {
  return typeof word === "string" && DOCKER_OBJECT_NAME_REGEX.test(word);
}

export function isDockerImageReference(word: string): boolean {
  return typeof word === "string" && DOCKER_IMAGE_REFERENCE_REGEX.test(word);
}

// Why one of these words is not a name of this kind, or null when all are.
export function findBadDockerName(
  words: Array<string>,
  kind: string,
  isValid: (word: string) => boolean = isDockerObjectName,
): string | null {
  for (const word of words) {
    if (!isValid(word)) {
      return `"${word}" is not a ${kind} name or id docker accepts (letters, digits, "_", "." and "-", starting with a letter or digit)`;
    }
  }

  return null;
}

// A whole number 0..max written in plain digits (no sign, no spaces), or null.
export function parseDockerCount(value: string, max: number): number | null {
  if (typeof value !== "string" || !/^[0-9]{1,9}$/.test(value)) {
    return null;
  }

  const count: number = Number(value);
  return count <= max ? count : null;
}

// A Go duration, as docker reads --since 30m: "90s", "1h30m", "1.5h".
const GO_DURATION_REGEX: RegExp =
  /^(?:[0-9]{1,9}(?:\.[0-9]{1,9})?(?:ns|us|ms|s|m|h)){1,6}$/;

// An RFC 3339 date or date-time docker's --since/--until accepts.
const DATE_TIME_REGEX: RegExp =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,9})?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?$/;

// A Unix timestamp in seconds (2001 onwards), optionally with a fraction.
const UNIX_TIME_REGEX: RegExp = /^[0-9]{10}(?:\.[0-9]{1,9})?$/;

/*
 * A --since / --until value: a relative duration ("30m", "2h"), an RFC 3339
 * date or date-time, or a Unix timestamp. Never empty — docker reads an
 * empty --since as no bound at all — and never "0" (the epoch).
 */
export function isDockerTimeValue(value: string): boolean {
  if (typeof value !== "string" || !value || value.length > 64) {
    return false;
  }

  return (
    GO_DURATION_REGEX.test(value) ||
    DATE_TIME_REGEX.test(value) ||
    UNIX_TIME_REGEX.test(value)
  );
}

export function isGoDuration(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    (value === "0" || GO_DURATION_REGEX.test(value))
  );
}

/*
 * A memory size as docker reads --memory / --limit-memory (units.RAMInBytes):
 * digits, an optional fraction, an optional k/m/g/t (with an optional "i")
 * and an optional "b": "512m", "1g", "1.5GiB", "536870912".
 */
const MEMORY_SIZE_REGEX: RegExp =
  /^[0-9]{1,15}(?:\.[0-9]{1,6})?(?:[kKmMgGtT][iI]?)?[bB]?$/;

export function isDockerMemorySize(value: string): boolean {
  return typeof value === "string" && MEMORY_SIZE_REGEX.test(value);
}

// A number of CPUs as docker reads --cpus / --limit-cpu: "0.5", "2", "1.25".
const CPU_COUNT_REGEX: RegExp = /^[0-9]{1,4}(?:\.[0-9]{1,3})?$/;

export function isDockerCpuCount(value: string): boolean {
  return typeof value === "string" && CPU_COUNT_REGEX.test(value);
}

// "--filter KEY=VALUE", as docker's filter parser requires.
const DOCKER_FILTER_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9_.-]{0,63}=/;

// Why a --filter value is unusable, or null when every one is KEY=VALUE.
export function findBadDockerFilter(parsed: DockerParsedArgs): string | null {
  for (const filter of dockerFlagValues(parsed, "filter")) {
    if (!DOCKER_FILTER_REGEX.test(filter) || filter.length > 256) {
      return `--filter takes KEY=VALUE (e.g. --filter status=exited or --filter name=web), not "${filter}"`;
    }
  }

  return null;
}

// Why --format is unusable, or null when it is absent or one of `allowed`.
export function findBadDockerFormat(
  parsed: DockerParsedArgs,
  allowed: ReadonlyArray<string>,
): string | null {
  const format: string | undefined = dockerFlagValue(parsed, "format");

  if (format === undefined || allowed.includes(format)) {
    return null;
  }

  const choices: string = allowed
    .map((choice: string): string => {
      return `"${choice}"`;
    })
    .join(" or ");

  return `--format may only be ${choices} (or left out), not "${format}": Go templates are not allowed, since one can print a container's environment unlabelled`;
}

// ---- Command paths ----------------------------------------------------------

/*
 * The command groups whose subcommands this grammar reads one by one, with
 * every alias docker accepts for a subcommand mapped to its canonical name
 * (`docker container list` and `docker container ps` are `container ls`).
 * A subcommand not listed is looked up as written and refused.
 */
const SUBCOMMAND_GROUPS: ReadonlyMap<
  string,
  ReadonlyMap<string, string>
> = new Map<string, ReadonlyMap<string, string>>([
  [
    "container",
    new Map<string, string>([
      ["ls", "ls"],
      ["list", "ls"],
      ["ps", "ls"],
      ["inspect", "inspect"],
      ["logs", "logs"],
      ["stats", "stats"],
      ["top", "top"],
      ["port", "port"],
      ["diff", "diff"],
      ["restart", "restart"],
      ["start", "start"],
      ["unpause", "unpause"],
      ["stop", "stop"],
      ["kill", "kill"],
      ["pause", "pause"],
      ["update", "update"],
      ["rm", "rm"],
      ["remove", "rm"],
    ]),
  ],
  [
    "image",
    new Map<string, string>([
      ["ls", "ls"],
      ["list", "ls"],
      ["inspect", "inspect"],
      ["rm", "rm"],
      ["remove", "rm"],
      ["rmi", "rm"],
    ]),
  ],
  [
    "network",
    new Map<string, string>([
      ["ls", "ls"],
      ["list", "ls"],
      ["inspect", "inspect"],
      ["rm", "rm"],
      ["remove", "rm"],
    ]),
  ],
  [
    "volume",
    new Map<string, string>([
      ["ls", "ls"],
      ["list", "ls"],
      ["inspect", "inspect"],
      ["rm", "rm"],
      ["remove", "rm"],
    ]),
  ],
  [
    "system",
    new Map<string, string>([
      ["df", "df"],
      ["info", "info"],
      ["events", "events"],
    ]),
  ],
  [
    "service",
    new Map<string, string>([
      ["ls", "ls"],
      ["list", "ls"],
      ["ps", "ps"],
      ["inspect", "inspect"],
      ["logs", "logs"],
      ["update", "update"],
      ["rollback", "rollback"],
      ["scale", "scale"],
      ["rm", "rm"],
      ["remove", "rm"],
    ]),
  ],
  [
    "node",
    new Map<string, string>([
      ["ls", "ls"],
      ["list", "ls"],
      ["ps", "ps"],
      ["inspect", "inspect"],
      ["update", "update"],
      ["rm", "rm"],
      ["remove", "rm"],
    ]),
  ],
  [
    "stack",
    new Map<string, string>([
      ["ls", "ls"],
      ["list", "ls"],
      ["ps", "ps"],
      ["services", "services"],
      ["deploy", "deploy"],
      ["up", "deploy"],
      ["rm", "rm"],
      ["remove", "rm"],
      ["down", "rm"],
    ]),
  ],
]);

export interface DockerCommandPath {
  /*
   * The canonical command path: "ps", "container ls", "service update" —
   * or the group alone ("container") when no subcommand was written.
   */
  path: string;
  // The command group ("container"), when the command is in one.
  group?: string | undefined;
  // How the command was written, for messages: "container list".
  written: string;
  // The words after the command path, for the flag parser.
  rest: Array<string>;
  // Set when no command can be read: a flag before it, or a group with no subcommand.
  problem?: string | undefined;
}

/*
 * Find the command in an argv whose first word is "docker": the word after
 * it, and for a command group the word after that. Refuses a flag in front
 * of either (see the header: that is where docker's global flags live).
 */
export function resolveDockerCommandPath(
  words: Array<string>,
): DockerCommandPath {
  const first: string | undefined = words[1];

  if (first === undefined) {
    return {
      path: "",
      written: "",
      rest: [],
      problem:
        'a docker command must name what to run after "docker" (e.g. docker ps)',
    };
  }

  if (first.startsWith("-") && first.length > 1) {
    return {
      path: "",
      written: first,
      rest: words.slice(2),
      problem: `"${first}" comes before the docker command: ${DOCKER_GLOBAL_FLAG_RULE}. Write the command right after "docker" (e.g. docker ps)`,
    };
  }

  const group: ReadonlyMap<string, string> | undefined =
    SUBCOMMAND_GROUPS.get(first);

  if (!group) {
    return { path: first, written: first, rest: words.slice(2) };
  }

  const second: string | undefined = words[2];

  if (second === undefined) {
    return {
      path: first,
      group: first,
      written: first,
      rest: [],
      problem: `docker ${first} needs a subcommand (e.g. docker ${first} ls)`,
    };
  }

  if (second.startsWith("-") && second.length > 1) {
    return {
      path: first,
      group: first,
      written: `${first} ${second}`,
      rest: words.slice(3),
      problem: `"${second}" comes before the docker ${first} subcommand: write the subcommand right after "docker ${first}" and its flags after it (e.g. docker ${first} ls)`,
    };
  }

  return {
    path: `${first} ${group.get(second) || second}`,
    group: first,
    written: `${first} ${second}`,
    rest: words.slice(3),
  };
}

// ---- Commands and profiles --------------------------------------------------

// What a command's judge says about one parsed command.
export interface DockerJudgement {
  tier: ResourceCommandTier;
  reason: string;
  // The objects a write changes, as written. Ignored for reads.
  targets?: Array<string> | undefined;
  requiresHuman?: boolean | undefined;
}

export interface DockerCommandSpec {
  // The audit label: the canonical command path ("ps", "container ls", "service update").
  verb: string;
  flags: ReadonlyArray<DockerFlagSpec>;
  // false for a command that stops reading flags at its first positional (docker top).
  interspersed?: boolean | undefined;
  judge(parsed: DockerParsedArgs, command: string): DockerJudgement;
}

export interface DockerProfile {
  // The tool policy's name: "docker-engine", "docker-swarm".
  name: string;
  // "a Docker or Podman host", "a Docker Swarm cluster".
  resourceDescription: string;
  // Every command the profile allows, by canonical path.
  commands: ReadonlyMap<string, DockerCommandSpec>;
  /*
   * Commands the profile knows and refuses (by canonical path, or by group
   * for a whole group), with why — the tail after "it ". Consulted before
   * DOCKER_COMMAND_REFUSALS.
   */
  refusals: ReadonlyMap<string, string>;
  // Appended to every command-level refusal: what the model may run instead.
  allowedSummary: string;
}

export function readJudgement(reason: string): DockerJudgement {
  return { tier: ResourceCommandTier.Read, reason };
}

export function deniedJudgement(reason: string): DockerJudgement {
  return { tier: ResourceCommandTier.Denied, reason };
}

// The names a write lists, each once, in the order written.
export function uniqueDockerTargets(words: Array<string>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const targets: Array<string> = [];

  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      targets.push(word);
    }
  }

  return targets;
}

/*
 * Commands neither profile ever runs, with why (the tail after "it "): by
 * canonical path, and by group for a group no subcommand of which is
 * allowed. A profile's own refusals come first.
 */
export const DOCKER_COMMAND_REFUSALS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["exec", "runs a program inside a container"],
  ["container exec", "runs a program inside a container"],
  [
    "run",
    "creates and starts a new container, with any image, mounts and privileges",
  ],
  [
    "container run",
    "creates and starts a new container, with any image, mounts and privileges",
  ],
  [
    "create",
    "creates a new container, with any image, mounts and privileges",
  ],
  [
    "container create",
    "creates a new container, with any image, mounts and privileges",
  ],
  ["cp", "copies files into or out of a container"],
  ["container cp", "copies files into or out of a container"],
  ["attach", "attaches to a container's terminal and input"],
  ["container attach", "attaches to a container's terminal and input"],
  ["rm", "deletes containers"],
  ["container rm", "deletes containers"],
  ["rmi", "deletes images"],
  ["image rm", "deletes images"],
  ["container prune", "deletes every stopped container"],
  ["image prune", "deletes images in bulk"],
  ["network prune", "deletes every unused network"],
  ["volume prune", "deletes volumes and the data in them"],
  ["system prune", "deletes containers, networks, images and caches in bulk"],
  ["build", "builds images from files on the host"],
  ["image build", "builds images from files on the host"],
  ["buildx", "builds images or manages the build cache"],
  ["builder", "builds images or manages the build cache"],
  ["bake", "builds images from files on the host"],
  ["push", "uploads images to a registry"],
  ["image push", "uploads images to a registry"],
  ["pull", "downloads images from a registry"],
  ["image pull", "downloads images from a registry"],
  ["login", "handles registry credentials"],
  ["logout", "handles registry credentials"],
  ["save", "copies images out of the engine"],
  ["image save", "copies images out of the engine"],
  ["load", "loads images into the engine"],
  ["image load", "loads images into the engine"],
  ["export", "copies a container's filesystem out of the engine"],
  ["container export", "copies a container's filesystem out of the engine"],
  ["import", "creates an image from a filesystem archive"],
  ["image import", "creates an image from a filesystem archive"],
  ["commit", "turns a container's filesystem into a new image"],
  ["container commit", "turns a container's filesystem into a new image"],
  ["rename", "renames a container, which breaks whatever finds it by name"],
  [
    "container rename",
    "renames a container, which breaks whatever finds it by name",
  ],
  ["wait", "blocks until a container stops"],
  ["container wait", "blocks until a container stops"],
  [
    "history",
    "prints an image's build steps, which can carry build arguments with secrets",
  ],
  [
    "image history",
    "prints an image's build steps, which can carry build arguments with secrets",
  ],
  ["tag", "retags images"],
  ["image tag", "retags images"],
  ["search", "queries a registry"],
  [
    "plugin",
    "installs, enables or reconfigures engine plugins, which run with full privileges",
  ],
  ["secret", "reads or changes swarm secrets"],
  ["config", "reads or changes swarm configs, whose contents it prints"],
  ["swarm", "changes swarm membership, join tokens or unlock keys"],
  ["context", "switches the engine the docker CLI talks to"],
  ["trust", "signs or revokes image trust data"],
  ["manifest", "creates or pushes image manifests"],
  [
    "compose",
    "is not shipped with the agent (it creates, recreates and removes containers from a project file)",
  ],
  ["checkpoint", "checkpoints or restores containers"],
  ["network create", "changes container networking"],
  ["network rm", "changes container networking"],
  ["network connect", "changes container networking"],
  ["network disconnect", "changes container networking"],
  ["volume create", "creates or changes volumes"],
  ["volume update", "creates or changes volumes"],
  ["volume rm", "deletes volumes and the data in them"],
  ["system dial-stdio", "opens a raw connection to the engine's API"],
  [
    "service create",
    "creates a new service, with any image, mounts and privileges",
  ],
  ["service rm", "deletes a service and all of its tasks"],
  ["stack deploy", "creates or replaces a whole stack from a compose file"],
  ["stack rm", "deletes a whole stack"],
  ["stack config", "renders a stack's compose files, environment included"],
  ["node rm", "removes a node from the swarm"],
  ["node promote", "changes which nodes manage the swarm (its Raft quorum)"],
  ["node demote", "changes which nodes manage the swarm (its Raft quorum)"],
]);

/*
 * Evaluate one argv (program included) against a profile. Total — any
 * input, any shape — and fail-closed: a command, subcommand, flag or value
 * the profile does not model is Denied with a reason that says what IS
 * allowed.
 */
export function evaluateDockerArgv(
  profile: DockerProfile,
  argv: unknown,
): ResourceCommandPolicyResult {
  const words: Array<string> = Array.isArray(argv)
    ? argv.filter((word: unknown): word is string => {
        return typeof word === "string";
      })
    : [];

  if (!Array.isArray(argv) || words.length === 0) {
    return deniedResult(words, "Empty command.");
  }

  if (words.length !== argv.length) {
    return deniedResult(words, "Every word of the command must be a string.");
  }

  if (words[0] !== "docker") {
    return deniedResult(
      words,
      `the ${profile.name} command policy covers the docker CLI only: start the command with "docker"`,
    );
  }

  // The dispatcher's bounds, again: this policy never relies on a caller.
  if (words.length > MAX_RESOURCE_COMMAND_TOKENS) {
    return deniedResult(
      words,
      `A command may have at most ${MAX_RESOURCE_COMMAND_TOKENS} words.`,
    );
  }

  if (words.join(" ").length > MAX_COMMAND_LENGTH_CHARS) {
    return deniedResult(
      words,
      `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
    );
  }

  const deny: (reason: string, verb: string) => ResourceCommandPolicyResult = (
    reason: string,
    verb: string,
  ): ResourceCommandPolicyResult => {
    return { ...deniedResult(words, reason), verb };
  };

  const resolved: DockerCommandPath = resolveDockerCommandPath(words);
  const spec: DockerCommandSpec | undefined = resolved.problem
    ? undefined
    : profile.commands.get(resolved.path);

  if (!spec) {
    const refusal: string | undefined = resolved.path
      ? profile.refusals.get(resolved.path) ||
        (resolved.group ? profile.refusals.get(resolved.group) : undefined) ||
        DOCKER_COMMAND_REFUSALS.get(resolved.path) ||
        (resolved.group
          ? DOCKER_COMMAND_REFUSALS.get(resolved.group)
          : undefined)
      : undefined;

    let reason: string;

    if (refusal) {
      // With a problem, only the group was read: name the group alone.
      reason = `docker ${
        resolved.problem ? resolved.path : resolved.written
      } is never allowed for ${profile.resourceDescription}: it ${refusal}`;
    } else if (resolved.problem) {
      reason = resolved.problem;
    } else {
      const lowered: string = resolved.written.toLowerCase();
      const hint: string =
        lowered !== resolved.written &&
        (profile.commands.has(lowered) ||
          profile.commands.has(resolved.path.toLowerCase()))
          ? " (docker commands are lowercase)"
          : "";

      reason = `docker ${resolved.written} is not a docker command OneUptime AI may run${hint}`;
    }

    return deny(`${reason}. ${profile.allowedSummary}`, "");
  }

  const command: string = `docker ${resolved.written}`;
  const parsed: DockerParsedArgs = parseDockerFlags({
    words: resolved.rest,
    flags: spec.flags,
    command,
    interspersed: spec.interspersed !== false,
  });

  if (parsed.problem) {
    return deny(`${command}: ${parsed.problem}`, spec.verb);
  }

  const judgement: DockerJudgement = spec.judge(parsed, command);

  const isWrite: boolean =
    judgement.tier === ResourceCommandTier.SafeWrite ||
    judgement.tier === ResourceCommandTier.RiskyWrite;

  // Denied, and anything that is not a tier at all, never runs.
  if (!isWrite && judgement.tier !== ResourceCommandTier.Read) {
    return deny(`${command}: ${judgement.reason}`, spec.verb);
  }

  const result: ResourceCommandPolicyResult = {
    tier: judgement.tier,
    reason: judgement.reason,
    program: "docker",
    args: words.slice(1),
    verb: spec.verb,
    displayCommand: renderResourceDisplayCommand(words),
    targets: isWrite ? uniqueDockerTargets(judgement.targets || []) : [],
  };

  if (isWrite && judgement.requiresHuman === true) {
    result.requiresHuman = true;
  }

  return result;
}

// A total wrapper: a bug in a judge is a Denied, never an exception.
export function evaluateDockerArgvSafely(
  profile: DockerProfile,
  argv: unknown,
): ResourceCommandPolicyResult {
  try {
    return evaluateDockerArgv(profile, argv);
  } catch {
    const words: Array<string> = Array.isArray(argv)
      ? argv.filter((word: unknown): word is string => {
          return typeof word === "string";
        })
      : [];

    return deniedResult(
      words,
      `the ${profile.name} command policy could not evaluate this command`,
    );
  }
}

// ---- The engine's read commands (both profiles) -----------------------------

const FILTER_FLAG: DockerFlagSpec = {
  name: "filter",
  shorthand: "f",
  kind: DockerFlagKind.Value,
  repeatable: true,
};

const FORMAT_FLAG: DockerFlagSpec = {
  name: "format",
  kind: DockerFlagKind.Value,
};

// inspect, info and version spell --format with -f.
const FORMAT_FLAG_WITH_SHORTHAND: DockerFlagSpec = {
  name: "format",
  shorthand: "f",
  kind: DockerFlagKind.Value,
};

const QUIET_FLAG: DockerFlagSpec = {
  name: "quiet",
  shorthand: "q",
  kind: DockerFlagKind.Bool,
};

const NO_TRUNC_FLAG: DockerFlagSpec = {
  name: "no-trunc",
  kind: DockerFlagKind.Bool,
};

export const DOCKER_FILTER_FLAG: DockerFlagSpec = FILTER_FLAG;
export const DOCKER_FORMAT_FLAG: DockerFlagSpec = FORMAT_FLAG;
export const DOCKER_FORMAT_FLAG_WITH_SHORTHAND: DockerFlagSpec =
  FORMAT_FLAG_WITH_SHORTHAND;
export const DOCKER_QUIET_FLAG: DockerFlagSpec = QUIET_FLAG;
export const DOCKER_NO_TRUNC_FLAG: DockerFlagSpec = NO_TRUNC_FLAG;

export const DOCKER_FOLLOW_REFUSAL: string =
  "is never allowed: it streams the log until the command is killed. Read a bounded slice with --tail N (N up to 2000) or --since 30m instead";

// The most log lines one command may ask for.
export const DOCKER_MAX_LOG_TAIL_LINES: number = 2000;

// The flags `docker logs` and `docker service logs` share.
export const DOCKER_LOG_FLAGS: ReadonlyArray<DockerFlagSpec> = [
  { name: "details", kind: DockerFlagKind.Bool },
  {
    name: "follow",
    shorthand: "f",
    kind: DockerFlagKind.Bool,
    refusal: DOCKER_FOLLOW_REFUSAL,
  },
  { name: "since", kind: DockerFlagKind.Value },
  { name: "tail", shorthand: "n", kind: DockerFlagKind.Value },
  { name: "timestamps", shorthand: "t", kind: DockerFlagKind.Bool },
];

/*
 * Why a logs command does not read a bounded slice, or null when it does:
 * --tail N with N up to DOCKER_MAX_LOG_TAIL_LINES, or --since; --until (for
 * docker logs) a time too.
 */
export function findUnboundedLogProblem(
  parsed: DockerParsedArgs,
  command: string,
): string | null {
  const tail: string | undefined = dockerFlagValue(parsed, "tail");
  const since: string | undefined = dockerFlagValue(parsed, "since");
  const until: string | undefined = dockerFlagValue(parsed, "until");

  if (
    tail !== undefined &&
    parseDockerCount(tail, DOCKER_MAX_LOG_TAIL_LINES) === null
  ) {
    return `--tail takes a number of lines from 0 to ${DOCKER_MAX_LOG_TAIL_LINES}, not "${tail}"`;
  }

  if (since !== undefined && !isDockerTimeValue(since)) {
    return `--since takes a duration (30m, 2h), an RFC 3339 time or a Unix timestamp, not "${since}"`;
  }

  if (until !== undefined && !isDockerTimeValue(until)) {
    return `--until takes a duration (5m), an RFC 3339 time or a Unix timestamp, not "${until}"`;
  }

  if (tail === undefined && since === undefined) {
    return `${command} needs --tail N (N up to ${DOCKER_MAX_LOG_TAIL_LINES}) or --since (e.g. --since 30m), so it reads a bounded slice of the log`;
  }

  return null;
}

function judgeContainerList(parsed: DockerParsedArgs): DockerJudgement {
  if (parsed.positionals.length > 0) {
    return deniedJudgement(
      `it takes no container names (got "${parsed.positionals[0]}"); narrow it with --filter name=NAME instead`,
    );
  }

  const last: string | undefined = dockerFlagValue(parsed, "last");

  if (last !== undefined && parseDockerCount(last, 100000) === null) {
    return deniedJudgement(`-n/--last takes a number, not "${last}"`);
  }

  const problem: string | null =
    findBadDockerFilter(parsed) ||
    findBadDockerFormat(parsed, ["json", "table"]);

  return problem
    ? deniedJudgement(problem)
    : readJudgement("lists containers; it changes nothing");
}

const CONTAINER_LIST_SPEC: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [
      { name: "all", shorthand: "a", kind: DockerFlagKind.Bool },
      FILTER_FLAG,
      FORMAT_FLAG,
      { name: "last", shorthand: "n", kind: DockerFlagKind.Value },
      { name: "latest", shorthand: "l", kind: DockerFlagKind.Bool },
      NO_TRUNC_FLAG,
      QUIET_FLAG,
      { name: "size", shorthand: "s", kind: DockerFlagKind.Bool },
    ],
    judge: judgeContainerList,
  };
};

// The object kinds `docker inspect --type` may name.
export const DOCKER_INSPECT_TYPES: ReadonlyArray<string> = [
  "container",
  "image",
  "network",
  "volume",
];

function judgeInspectOf(
  kind: string,
  parsed: DockerParsedArgs,
): DockerJudgement {
  if (parsed.positionals.length === 0) {
    return deniedJudgement(`it needs at least one ${kind} name or id`);
  }

  const problem: string | null =
    findBadDockerName(
      parsed.positionals,
      kind,
      kind === "image" ? isDockerImageReference : isDockerObjectName,
    ) || findBadDockerFormat(parsed, ["json"]);

  return problem
    ? deniedJudgement(problem)
    : readJudgement(
        `shows each ${kind}'s configuration and state (environment values are redacted); it changes nothing`,
      );
}

const INSPECT_SPEC: DockerCommandSpec = {
  verb: "inspect",
  flags: [
    FORMAT_FLAG_WITH_SHORTHAND,
    { name: "size", shorthand: "s", kind: DockerFlagKind.Bool },
    { name: "type", kind: DockerFlagKind.Value },
  ],
  judge(parsed: DockerParsedArgs): DockerJudgement {
    const type: string | undefined = dockerFlagValue(parsed, "type");

    if (type === undefined || !DOCKER_INSPECT_TYPES.includes(type)) {
      return deniedJudgement(
        `it needs --type ${DOCKER_INSPECT_TYPES.join("|")}${
          type === undefined ? "" : ` (not "${type}")`
        }: without it docker also matches swarm configs and secrets by name, and prints a config's contents. Or use docker container inspect NAME`,
      );
    }

    return judgeInspectOf(type, parsed);
  },
};

const inspectSpecFor: (
  kind: string,
  extraFlags: ReadonlyArray<DockerFlagSpec>,
) => DockerCommandSpec = (
  kind: string,
  extraFlags: ReadonlyArray<DockerFlagSpec>,
): DockerCommandSpec => {
  return {
    verb: `${kind} inspect`,
    flags: [FORMAT_FLAG_WITH_SHORTHAND, ...extraFlags],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      return judgeInspectOf(kind, parsed);
    },
  };
};

const LOGS_SPEC: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [...DOCKER_LOG_FLAGS, { name: "until", kind: DockerFlagKind.Value }],
    judge(parsed: DockerParsedArgs, command: string): DockerJudgement {
      if (parsed.positionals.length !== 1) {
        return deniedJudgement(
          `it reads exactly one container's log (got ${parsed.positionals.length} names)`,
        );
      }

      const problem: string | null =
        findBadDockerName(parsed.positionals, "container") ||
        findUnboundedLogProblem(parsed, command);

      return problem
        ? deniedJudgement(problem)
        : readJudgement(
            "reads a bounded slice of one container's log; it changes nothing",
          );
    },
  };
};

const STATS_SPEC: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [
      { name: "all", shorthand: "a", kind: DockerFlagKind.Bool },
      FORMAT_FLAG,
      { name: "no-stream", kind: DockerFlagKind.Bool },
      NO_TRUNC_FLAG,
    ],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      if (!isDockerSwitchOn(parsed, "no-stream")) {
        return deniedJudgement(
          "it needs --no-stream: without it docker stats streams until the command is killed",
        );
      }

      const problem: string | null =
        findBadDockerName(parsed.positionals, "container") ||
        findBadDockerFormat(parsed, ["json", "table"]);

      return problem
        ? deniedJudgement(problem)
        : readJudgement(
            "takes one snapshot of container resource usage; it changes nothing",
          );
    },
  };
};

const TOP_SPEC: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [],
    // docker top CONTAINER [ps OPTIONS]: every word after the container goes to ps.
    interspersed: false,
    judge(parsed: DockerParsedArgs): DockerJudgement {
      if (parsed.positionals.length !== 1) {
        return deniedJudgement(
          "it takes exactly one container and no ps options (write docker top NAME)",
        );
      }

      const problem: string | null = findBadDockerName(
        parsed.positionals,
        "container",
      );

      return problem
        ? deniedJudgement(problem)
        : readJudgement(
            "lists the processes running in one container; it changes nothing",
          );
    },
  };
};

const EVENTS_SPEC: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [
      FILTER_FLAG,
      FORMAT_FLAG,
      { name: "since", kind: DockerFlagKind.Value },
      { name: "until", kind: DockerFlagKind.Value },
    ],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      if (parsed.positionals.length > 0) {
        return deniedJudgement(
          `it takes no names (got "${parsed.positionals[0]}"); narrow it with --filter KEY=VALUE`,
        );
      }

      const since: string | undefined = dockerFlagValue(parsed, "since");
      const until: string | undefined = dockerFlagValue(parsed, "until");

      if (since === undefined || until === undefined) {
        return deniedJudgement(
          "it needs both --since and --until (e.g. --since 30m --until 0s): without --until docker events streams until the command is killed",
        );
      }

      if (!isDockerTimeValue(since) || !isDockerTimeValue(until)) {
        return deniedJudgement(
          `--since and --until take a duration (30m, 0s), an RFC 3339 time or a Unix timestamp, not "${
            isDockerTimeValue(since) ? until : since
          }"`,
        );
      }

      const problem: string | null =
        findBadDockerFilter(parsed) || findBadDockerFormat(parsed, ["json"]);

      return problem
        ? deniedJudgement(problem)
        : readJudgement(
            "lists the engine's events in a closed time window; it changes nothing",
          );
    },
  };
};

/*
 * A read command that takes no positionals: its flags, and the --format
 * values it accepts (--filter values are checked when it has --filter).
 */
export const dockerNoArgumentReadSpec: (
  verb: string,
  reason: string,
  flags: ReadonlyArray<DockerFlagSpec>,
  formats: ReadonlyArray<string>,
) => DockerCommandSpec = (
  verb: string,
  reason: string,
  flags: ReadonlyArray<DockerFlagSpec>,
  formats: ReadonlyArray<string>,
): DockerCommandSpec => {
  return {
    verb,
    flags,
    judge(parsed: DockerParsedArgs): DockerJudgement {
      if (parsed.positionals.length > 0) {
        return deniedJudgement(
          `it takes no arguments (got "${parsed.positionals[0]}")`,
        );
      }

      const problem: string | null =
        findBadDockerFilter(parsed) || findBadDockerFormat(parsed, formats);

      return problem ? deniedJudgement(problem) : readJudgement(reason);
    },
  };
};

const INFO_REASON: string =
  "shows the engine's configuration and health; it changes nothing";

const IMAGES_SPEC: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [
      { name: "all", shorthand: "a", kind: DockerFlagKind.Bool },
      { name: "digests", kind: DockerFlagKind.Bool },
      FILTER_FLAG,
      FORMAT_FLAG,
      NO_TRUNC_FLAG,
      QUIET_FLAG,
    ],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      if (parsed.positionals.length > 1) {
        return deniedJudgement(
          "it takes at most one REPOSITORY[:TAG] to list",
        );
      }

      const problem: string | null =
        findBadDockerName(parsed.positionals, "image", isDockerImageReference) ||
        findBadDockerFilter(parsed) ||
        findBadDockerFormat(parsed, ["json", "table"]);

      return problem
        ? deniedJudgement(problem)
        : readJudgement("lists images; it changes nothing");
    },
  };
};

const PORT_SPEC: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      const container: string | undefined = parsed.positionals[0];
      const port: string | undefined = parsed.positionals[1];

      if (container === undefined || parsed.positionals.length > 2) {
        return deniedJudgement(
          "it takes one container and, optionally, one PORT[/PROTOCOL] (write docker port NAME 80/tcp)",
        );
      }

      if (
        port !== undefined &&
        !/^[0-9]{1,5}(?:\/(?:tcp|udp|sctp))?$/.test(port)
      ) {
        return deniedJudgement(
          `"${port}" is not a PORT[/PROTOCOL] (e.g. 80 or 53/udp)`,
        );
      }

      const problem: string | null = findBadDockerName([container], "container");

      return problem
        ? deniedJudgement(problem)
        : readJudgement(
            "lists one container's published ports; it changes nothing",
          );
    },
  };
};

const DIFF_SPEC: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      if (parsed.positionals.length !== 1) {
        return deniedJudgement("it takes exactly one container");
      }

      const problem: string | null = findBadDockerName(
        parsed.positionals,
        "container",
      );

      return problem
        ? deniedJudgement(problem)
        : readJudgement(
            "lists the files changed in one container's filesystem; it changes nothing",
          );
    },
  };
};

/*
 * The engine's read commands, by canonical path. Both profiles allow all of
 * them (the swarm agent runs on a manager node, whose engine is a Docker
 * engine like any other).
 */
export const DOCKER_ENGINE_READ_COMMANDS: ReadonlyMap<
  string,
  DockerCommandSpec
> = new Map<string, DockerCommandSpec>([
  ["ps", CONTAINER_LIST_SPEC("ps")],
  ["container ls", CONTAINER_LIST_SPEC("container ls")],
  ["inspect", INSPECT_SPEC],
  [
    "container inspect",
    inspectSpecFor("container", [
      { name: "size", shorthand: "s", kind: DockerFlagKind.Bool },
    ]),
  ],
  ["image inspect", inspectSpecFor("image", [])],
  [
    "network inspect",
    inspectSpecFor("network", [
      { name: "verbose", shorthand: "v", kind: DockerFlagKind.Bool },
    ]),
  ],
  ["volume inspect", inspectSpecFor("volume", [])],
  ["logs", LOGS_SPEC("logs")],
  ["container logs", LOGS_SPEC("container logs")],
  ["stats", STATS_SPEC("stats")],
  ["container stats", STATS_SPEC("container stats")],
  ["top", TOP_SPEC("top")],
  ["container top", TOP_SPEC("container top")],
  ["events", EVENTS_SPEC("events")],
  ["system events", EVENTS_SPEC("system events")],
  [
    "info",
    dockerNoArgumentReadSpec(
      "info",
      INFO_REASON,
      [FORMAT_FLAG_WITH_SHORTHAND],
      ["json"],
    ),
  ],
  [
    "system info",
    dockerNoArgumentReadSpec(
      "system info",
      INFO_REASON,
      [FORMAT_FLAG_WITH_SHORTHAND],
      ["json"],
    ),
  ],
  [
    "version",
    dockerNoArgumentReadSpec(
      "version",
      "shows the docker client and engine versions; it changes nothing",
      [FORMAT_FLAG_WITH_SHORTHAND],
      ["json"],
    ),
  ],
  [
    "system df",
    dockerNoArgumentReadSpec(
      "system df",
      "shows the engine's disk usage; it changes nothing",
      [
        FORMAT_FLAG,
        { name: "verbose", shorthand: "v", kind: DockerFlagKind.Bool },
      ],
      ["json", "table"],
    ),
  ],
  ["images", IMAGES_SPEC("images")],
  ["image ls", IMAGES_SPEC("image ls")],
  [
    "network ls",
    dockerNoArgumentReadSpec(
      "network ls",
      "lists networks; it changes nothing",
      [FILTER_FLAG, FORMAT_FLAG, NO_TRUNC_FLAG, QUIET_FLAG],
      ["json", "table"],
    ),
  ],
  [
    "volume ls",
    dockerNoArgumentReadSpec(
      "volume ls",
      "lists volumes; it changes nothing",
      [FILTER_FLAG, FORMAT_FLAG, QUIET_FLAG],
      ["json", "table"],
    ),
  ],
  ["port", PORT_SPEC("port")],
  ["container port", PORT_SPEC("container port")],
  ["diff", DIFF_SPEC("diff")],
  ["container diff", DIFF_SPEC("container diff")],
]);

/*
 * The engine's write commands, by canonical path — the docker-engine
 * profile allows them; the docker-swarm profile refuses every one (see
 * DockerSwarmCommandPolicy).
 */
export const DOCKER_ENGINE_WRITE_PATHS: ReadonlyArray<string> = [
  "restart",
  "container restart",
  "start",
  "container start",
  "unpause",
  "container unpause",
  "stop",
  "container stop",
  "kill",
  "container kill",
  "pause",
  "container pause",
  "update",
  "container update",
];

// The command groups only a swarm manager runs.
export const DOCKER_SWARM_GROUPS: ReadonlyArray<string> = [
  "service",
  "node",
  "stack",
];

// Merge command tables; a later table never overrides an earlier path.
export function mergeDockerCommands(
  ...tables: Array<ReadonlyMap<string, DockerCommandSpec>>
): ReadonlyMap<string, DockerCommandSpec> {
  const merged: Map<string, DockerCommandSpec> = new Map<
    string,
    DockerCommandSpec
  >();

  for (const table of tables) {
    table.forEach((spec: DockerCommandSpec, path: string): void => {
      if (!merged.has(path)) {
        merged.set(path, spec);
      }
    });
  }

  return merged;
}
