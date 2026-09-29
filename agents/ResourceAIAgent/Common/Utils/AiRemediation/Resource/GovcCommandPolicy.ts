/*
 * The govc command policy: tiers the govc commands OneUptime AI composes for
 * a VMware vCenter (VMs, ESXi hosts, datastores, resource pools, events and
 * performance counters).
 *
 * Pure, total and fail-closed, like every tool policy in this directory:
 * the same evaluation runs where the AI composes a command, at the server's
 * enqueue chokepoint and inside the resource AI agent right before it
 * spawns govc (with no shell). Anything this module does not explicitly
 * model is Denied, with a reason that tells the model what IS allowed.
 *
 * How govc reads a command line (govc 0.53, Go's `flag` package), and so
 * how this policy reads it:
 *   - The first word after `govc` is the command (`vm.info`, `ls`, ...),
 *     matched exactly and case-sensitively. A flag before it is not a
 *     "global" flag — govc would look for a command named "-json" — so it
 *     is refused with a message that shows the right order.
 *   - Flags come next, and only before the first argument: Go stops
 *     parsing flags at the first word that is not one (or after `--`), so
 *     `govc vm.power web-01 -off` powers nothing off — it names two VMs.
 *     A word that starts with "-" after an argument is therefore refused
 *     rather than read as the flag the model meant.
 *   - `-flag` and `--flag` are the same flag; there are no clusters (`-lL`
 *     is one unknown flag named "lL"). A value flag takes `-flag=value` or
 *     the NEXT word whatever it is — so a value that looks like a flag is
 *     refused, and a denied flag can never hide as another flag's value. A
 *     switch takes `-flag`, `-flag=true` or `-flag=false` only (a separate
 *     "true" is an argument, exactly as govc reads it). Numbers are plain
 *     decimal: Go reads "010" as octal 8 and "0x10" as 16.
 *   - Every flag is looked up in the command's own table: an unknown flag
 *     is Denied, and each flag may be given once (the list flags govc
 *     appends to, such as `events -type`, excepted).
 *   - Two commands read past their first argument themselves: `find ROOT
 *     -KEY VALUE ...` (property filters, and govc applies ANY of its own
 *     flags written there — `-u` included — so only -type, -name and the
 *     allowlisted properties are accepted) and `object.collect OBJECT
 *     PROPERTY...`.
 *
 * Read (what an investigation may run): about, version, datacenter.info,
 * ls, find, vm.info, host.info, host.service.ls, host.date.info,
 * datastore.info, pool.info, events, tasks, metric.ls, metric.sample,
 * object.collect and tags.ls, each with a small flag table. Secrets are
 * kept out of reach on purpose:
 *   - `vm.info -e` prints a VM's extraConfig, where guestinfo.* keys
 *     (cloud-init user data, OVF environments, passwords) live, and
 *     `vm.info -json` / `host.info -json` load EVERY property of the object
 *     (extraConfig included) — all refused; the text form covers the
 *     useful state.
 *   - `object.collect` must name its properties, and each must be one of
 *     COLLECTABLE_PROPERTIES (runtime state, quick stats, health) — without
 *     a property it prints every property. `find` filters only on the same
 *     properties: a filter on anything else is an oracle that can test a
 *     secret's value one glob at a time.
 *   - Streaming (`events -f`, `tasks -f`, `object.collect -n/-wait`),
 *     program-spawning (`metric.sample -plot`) and file-reading
 *     (`object.collect -R`) flags are refused.
 *
 * SafeWrite (Automatic remediation runs it unattended) is exactly ONE named
 * VM with a reversible power operation:
 *   - `vm.power -on VM` (a guest shutdown undoes it);
 *   - `vm.power -r VM` — a graceful guest reboot through VMware Tools.
 * RiskyWrite (a human approves unless allowlisted or bypassed):
 * `vm.power -s` (guest shutdown), `-off`, `-reset`, `-suspend` (`-force`
 * only with -off or -reset: with -r or -s it falls back to a hard reset or
 * power-off when Tools is not running), any power operation on more than one
 * VM, and `host.maintenance.exit HOST`. RiskyWrite that ALWAYS needs a human
 * (requiresHuman): `vm.migrate` (vMotion / Storage vMotion) and
 * `host.maintenance.enter HOST` (every VM on the host must move).
 *
 * A write names its objects as arguments — a VM or host name, or an
 * inventory path, exactly as written (those are its targets, which the
 * agent's write scope compares with its globs). govc expands `*`, `?` and
 * `[...]` in a name to every object that matches, so a write's names are
 * refused unless they name exactly one object each (no wildcards, no
 * backslash, no `.`/`..` path segments). A bare name that several VMs share
 * is resolved by vCenter; the guides tell the model to prefer the path.
 *
 * Denied: everything else — the endpoint, credential, TLS, debug and dump
 * flags (-u, -k, -cert, -key, -tls-*, -vim-*, -persist-session, -debug,
 * -trace, -verbose, -dump, -xml, -h) on every command, and every command
 * that is not modelled: vm.destroy/create/clone/change/..., the console,
 * guest.* (in-guest exec), snapshots, devices and disks, datastore file
 * access, host add/remove/reboot/shutdown/esxcli, permissions, roles, SSO,
 * sessions, licenses, import/export/library, advanced options and `env`
 * (which prints the agent's password).
 *
 * Words that could fool a reader are refused before anything else: an
 * invisible or control character anywhere, and a dash look-alike (en dash,
 * minus sign, ...) at the start of a word, which govc would read as a name
 * where the model meant a flag.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only.
 */

import { MAX_COMMAND_LENGTH_CHARS } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  MAX_RESOURCE_COMMAND_TOKENS,
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";

const GOVC_PROGRAM: string = "govc";

// The most events, tasks or samples one read may ask for.
export const GOVC_MAX_RECORD_COUNT: number = 500;

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

/*
 * Characters a person reviewing the command could not see: C0 and C1
 * controls, the soft hyphen, zero-width and joiner characters, bidi marks,
 * overrides and isolates, word joiners and invisible operators, filler
 * characters, variation selectors, the BOM, interlinear annotation marks
 * and tag characters. Code-point ranges rather than a regex, so this source
 * file holds no invisible characters itself.
 */
const INVISIBLE_CODE_POINT_RANGES: ReadonlyArray<[number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfffb],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];

/*
 * Dashes that look like "-" but are not the ASCII hyphen-minus govc reads:
 * the hyphens and dashes U+2010-U+2015, the minus sign, the two- and
 * three-em dashes, and the small and fullwidth hyphen-minus.
 */
const DASH_LOOKALIKE_CODE_POINTS: ReadonlySet<number> = new Set<number>([
  0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0x2e3a, 0x2e3b,
  0xfe58, 0xfe63, 0xff0d,
]);

// A govc type name (VirtualMachine, HostSystem) or a find alias (m, h, s).
const TYPE_NAME_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

// An event type: VmPoweredOffEvent, or an extended one (com.vmware.vc.HA.X).
const EVENT_TYPE_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

// A performance interval: a name govc knows, or its length in seconds.
const INTERVAL_REGEX: RegExp =
  /^(?:real|day|week|month|year|0|[1-9][0-9]{0,5})$/;

// A plain decimal count (never octal or hex, which Go's flag package reads).
const DECIMAL_REGEX: RegExp = /^[1-9][0-9]*$/;

const MAX_DEPTH_REGEX: RegExp = /^(?:0|[1-9][0-9]?)$/;

// Characters govc expands in an inventory name (path.Match), and its escape.
const NAME_PATTERN_REGEX: RegExp = /[*?[\]\\]/;

// A vSphere property path: runtime.powerState, summary.quickStats.
const PROPERTY_PATH_REGEX: RegExp =
  /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;

function describeCodePoint(character: string): string {
  const code: number = character.codePointAt(0) || 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function isInvisibleCodePoint(code: number): boolean {
  return INVISIBLE_CODE_POINT_RANGES.some(
    (range: [number, number]): boolean => {
      return code >= range[0] && code <= range[1];
    },
  );
}

/*
 * Why this word is refused before any parsing, or null. The word itself is
 * not echoed when it holds an invisible character: the reason is shown on
 * approval cards, where a bidi override would garble it.
 */
function characterProblem(word: string): string | null {
  for (const character of word) {
    if (isInvisibleCodePoint(character.codePointAt(0) || 0)) {
      return `a word of the command contains an invisible or control character (${describeCodePoint(
        character,
      )}); type the command in plain characters`;
    }
  }

  const first: number = word.codePointAt(0) || 0;

  if (DASH_LOOKALIKE_CODE_POINTS.has(first)) {
    return `"${word}" starts with ${describeCodePoint(
      String.fromCodePoint(first),
    )}, not the ASCII "-": govc would read it as a name, not a flag; type a plain hyphen`;
  }

  return null;
}

// Does this word read as a flag to Go (as opposed to "-" or a name)?
function looksLikeFlag(word: string): boolean {
  return word.length >= 2 && word.charAt(0) === "-";
}

/*
 * Why a name is not exactly one inventory object, or null. Used for every
 * object a write names (its targets) and for the objects its flags name.
 */
function objectNameProblem(name: string): string | null {
  if (!name) {
    return "an empty name names no object";
  }

  if (name.trim() !== name) {
    return `"${name}" has leading or trailing spaces; write the name exactly`;
  }

  if (name.startsWith("-")) {
    return `"${name}" starts with "-", so govc would not read it as a name`;
  }

  if (NAME_PATTERN_REGEX.test(name)) {
    return `"${name}" is a pattern: govc expands * ? [ ] to every object that matches, so name exactly one object (no wildcards or backslashes)`;
  }

  const segments: Array<string> = name.split("/");

  for (let i: number = 0; i < segments.length; i++) {
    const segment: string = segments[i] || "";

    if (segment === "" && i === 0 && segments.length > 1) {
      // The leading "/" of an absolute inventory path.
      continue;
    }

    if (segment === "") {
      return `"${name}" has an empty path segment; write the VM or host name, or its full inventory path (/DATACENTER/vm/FOLDER/NAME)`;
    }

    if (segment === "." || segment === ".." || segment === "...") {
      return `"${name}" has a "${segment}" path segment; write the full inventory path (/DATACENTER/vm/FOLDER/NAME) or the plain name`;
    }
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * Flags
 * ---------------------------------------------------------------------------
 */

enum FlagKind {
  // `-flag`, `-flag=true`, `-flag=false`.
  Switch = "Switch",
  // `-flag value` or `-flag=value`.
  Value = "Value",
}

interface FlagRule {
  kind: FlagKind;
  // How the flag is written in usage lists: "-l", "-n N", "-dc DATACENTER".
  usage: string;
  // Why a Value flag's value is refused, or null.
  valueProblem?: ((value: string) => string | null) | undefined;
  // A list flag govc appends to (events -type): may be given more than once.
  repeatable?: boolean | undefined;
}

function switchFlag(name: string): FlagRule {
  return { kind: FlagKind.Switch, usage: `-${name}` };
}

function valueFlag(
  usage: string,
  valueProblem?: (value: string) => string | null,
  repeatable?: boolean,
): FlagRule {
  return { kind: FlagKind.Value, usage, valueProblem, repeatable };
}

function countProblem(value: string): string | null {
  if (!DECIMAL_REGEX.test(value) || Number(value) > GOVC_MAX_RECORD_COUNT) {
    return `"${value}" is not a whole number from 1 to ${GOVC_MAX_RECORD_COUNT}`;
  }

  return null;
}

function typeNameProblem(value: string): string | null {
  if (!TYPE_NAME_REGEX.test(value)) {
    return `"${value}" is not a type name (VirtualMachine, HostSystem, Datastore, or a find alias such as m, h, s)`;
  }

  return null;
}

function eventTypeProblem(value: string): string | null {
  if (!EVENT_TYPE_REGEX.test(value)) {
    return `"${value}" is not an event type name (such as VmPoweredOffEvent)`;
  }

  return null;
}

function intervalProblem(value: string): string | null {
  if (!INTERVAL_REGEX.test(value)) {
    return `"${value}" is not an interval (real, day, week, month, year, or its length in seconds such as 300)`;
  }

  return null;
}

function maxDepthProblem(value: string): string | null {
  if (!MAX_DEPTH_REGEX.test(value)) {
    return `"${value}" is not a depth from 0 to 99`;
  }

  return null;
}

const JSON_FLAG: [string, FlagRule] = ["json", switchFlag("json")];
const DATACENTER_FLAG: [string, FlagRule] = ["dc", valueFlag("-dc DATACENTER")];
// On a write the datacenter must be one object, like the targets.
const WRITE_DATACENTER_FLAG: [string, FlagRule] = [
  "dc",
  valueFlag("-dc DATACENTER", objectNameProblem),
];
const HOST_FLAG: [string, FlagRule] = ["host", valueFlag("-host HOST")];

function flagTable(
  entries: Array<[string, FlagRule]>,
): ReadonlyMap<string, FlagRule> {
  return new Map<string, FlagRule>(entries);
}

const CONNECTION_FLAG_REASON: string =
  "changes the vCenter endpoint, the credentials or the TLS trust govc connects with; the AI agent connects only with its own configuration";
const DEBUG_FLAG_REASON: string =
  "writes every vCenter request and response (session cookies included) to disk or stderr";
const DUMP_FLAG_REASON: string =
  "prints raw objects with every property (secrets included); use -json where the command allows it";
const PROTOCOL_FLAG_REASON: string =
  "changes the vSphere API protocol govc speaks";
const HELP_FLAG_REASON: string =
  "prints usage instead of running the command; run the command itself";

// Flags refused on every command, whatever its own table says.
const DENIED_FLAG_REASONS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["u", CONNECTION_FLAG_REASON],
  ["k", CONNECTION_FLAG_REASON],
  ["cert", CONNECTION_FLAG_REASON],
  ["key", CONNECTION_FLAG_REASON],
  ["tls-ca-certs", CONNECTION_FLAG_REASON],
  ["tls-known-hosts", CONNECTION_FLAG_REASON],
  ["tls-handshake-timeout", CONNECTION_FLAG_REASON],
  ["persist-session", "caches the vCenter session on disk"],
  ["vim-namespace", PROTOCOL_FLAG_REASON],
  ["vim-version", PROTOCOL_FLAG_REASON],
  ["debug", DEBUG_FLAG_REASON],
  ["trace", DEBUG_FLAG_REASON],
  ["verbose", DEBUG_FLAG_REASON],
  ["dump", DUMP_FLAG_REASON],
  ["xml", DUMP_FLAG_REASON],
  ["h", HELP_FLAG_REASON],
  ["help", HELP_FLAG_REASON],
]);

function globallyDeniedFlagReason(name: string): string | null {
  const reason: string | undefined = DENIED_FLAG_REASONS.get(name);

  if (reason !== undefined) {
    return reason;
  }

  return name.startsWith("debug.") ? DEBUG_FLAG_REASON : null;
}

const VM_SEARCH_FLAG_REASON: string =
  "name the VM as an argument (its name or inventory path) instead of with a -vm.* flag";
const HOST_SEARCH_FLAG_REASON: string =
  "name the host as the argument (its name or inventory path) instead of with a -host flag";

const VM_SEARCH_FLAGS: ReadonlyArray<string> = [
  "vm",
  "vm.dns",
  "vm.ip",
  "vm.ipath",
  "vm.path",
  "vm.uuid",
];

const HOST_SEARCH_FLAGS: ReadonlyArray<string> = [
  "host",
  "host.dns",
  "host.ip",
  "host.ipath",
  "host.uuid",
];

function refusals(
  entries: Array<[string, string]>,
  searchFlags: ReadonlyArray<string> = [],
  searchReason: string = "",
): ReadonlyMap<string, string> {
  const table: Map<string, string> = new Map<string, string>();

  for (const flag of searchFlags) {
    table.set(flag, searchReason);
  }

  for (const [name, reason] of entries) {
    table.set(name, reason);
  }

  return table;
}

/*
 * ---------------------------------------------------------------------------
 * Properties
 * ---------------------------------------------------------------------------
 */

/*
 * The properties object.collect may read and find may filter on: state,
 * health and load, never configuration (config.extraConfig holds guestinfo
 * secrets, and a VM's summary.config its free-text annotation).
 */
const COLLECTABLE_PROPERTY_NAMES: ReadonlySet<string> = new Set<string>([
  "name",
  "overallStatus",
  "summary.overallStatus",
  "triggeredAlarmState",
  "guest.toolsRunningStatus",
  "guest.guestState",
  "runtime",
  "summary.runtime",
  "summary.quickStats",
]);

const COLLECTABLE_PROPERTY_PREFIXES: ReadonlyArray<string> = [
  "runtime.",
  "summary.runtime.",
  "summary.quickStats.",
];

const COLLECTABLE_PROPERTY_LIST: string =
  "name, overallStatus, summary.overallStatus, triggeredAlarmState, guest.toolsRunningStatus, guest.guestState, runtime[.X], summary.runtime[.X] and summary.quickStats[.X]";

export function isCollectableGovcProperty(property: string): boolean {
  if (typeof property !== "string" || !PROPERTY_PATH_REGEX.test(property)) {
    return false;
  }

  if (COLLECTABLE_PROPERTY_NAMES.has(property)) {
    return true;
  }

  return COLLECTABLE_PROPERTY_PREFIXES.some((prefix: string): boolean => {
    return property.startsWith(prefix);
  });
}

/*
 * ---------------------------------------------------------------------------
 * Parsing (Go's flag package)
 * ---------------------------------------------------------------------------
 */

interface GovcCommandSpec {
  // What the command does, as its Read reason (reads) or for messages.
  summary: string;
  flags: ReadonlyMap<string, FlagRule>;
  // Flags the command has that this policy refuses, and why.
  refusedFlags?: ReadonlyMap<string, string> | undefined;
  minArguments: number;
  maxArguments: number;
  // "[PATH]...", "VM...", "no arguments".
  argumentsUsage: string;
  // A hint appended when an unknown flag is refused.
  unknownFlagHint?: ((name: string) => string | null) | undefined;
}

interface ParsedGovcArgs {
  // Every value each flag was given, in order; a switch as "true"/"false".
  values: Map<string, Array<string>>;
  positionals: Array<string>;
  // A "--" ended the flags.
  sawTerminator: boolean;
  problem: string | null;
}

function listFlags(spec: GovcCommandSpec): string {
  const usages: Array<string> = Array.from(spec.flags.values()).map(
    (rule: FlagRule): string => {
      return rule.usage;
    },
  );

  if (usages.length === 1) {
    return usages[0] || "";
  }

  return `${usages.slice(0, -1).join(", ")} and ${usages[usages.length - 1]}`;
}

function flagProblem(
  name: string,
  command: string,
  spec: GovcCommandSpec,
): string | null {
  const denied: string | null = globallyDeniedFlagReason(name);

  if (denied !== null) {
    return `-${name} is refused on every govc command: it ${denied}`;
  }

  const refused: string | undefined = spec.refusedFlags
    ? spec.refusedFlags.get(name)
    : undefined;

  if (refused !== undefined) {
    return `govc ${command} -${name} is refused: ${refused}`;
  }

  if (!spec.flags.has(name)) {
    const hint: string | null = spec.unknownFlagHint
      ? spec.unknownFlagHint(name)
      : null;

    return `-${name} is not a flag this policy allows for govc ${command}, which takes ${listFlags(
      spec,
    )}${hint ? `; ${hint}` : ""}`;
  }

  return null;
}

/*
 * Read the words after the command exactly the way Go's flag package does
 * (see the header), recording the first reason to refuse.
 */
function parseGovcArgs(
  words: Array<string>,
  command: string,
  spec: GovcCommandSpec,
): ParsedGovcArgs {
  const values: Map<string, Array<string>> = new Map<string, Array<string>>();
  const refuse: (problem: string) => ParsedGovcArgs = (
    problem: string,
  ): ParsedGovcArgs => {
    return { values, positionals: [], sawTerminator: false, problem };
  };

  let index: number = 0;
  let sawTerminator: boolean = false;

  while (index < words.length) {
    const word: string = words[index] || "";

    // "", "-" and anything not starting with "-" end the flags.
    if (!looksLikeFlag(word)) {
      break;
    }

    let minuses: number = 1;

    if (word.charAt(1) === "-") {
      minuses = 2;

      if (word.length === 2) {
        sawTerminator = true;
        index++;
        break;
      }
    }

    let name: string = word.slice(minuses);

    if (!name || name.startsWith("-") || name.startsWith("=")) {
      return refuse(`"${word}" is not valid flag syntax`);
    }

    let inlineValue: string | undefined = undefined;
    const equals: number = name.indexOf("=", 1);

    if (equals > 0) {
      inlineValue = name.slice(equals + 1);
      name = name.slice(0, equals);
    }

    const problem: string | null = flagProblem(name, command, spec);

    if (problem) {
      return refuse(problem);
    }

    const rule: FlagRule = spec.flags.get(name)!;
    const earlier: Array<string> | undefined = values.get(name);

    if (earlier && !rule.repeatable) {
      return refuse(
        `-${name} is given more than once; govc keeps only the last one, so give each flag once`,
      );
    }

    let value: string;

    if (rule.kind === FlagKind.Switch) {
      if (inlineValue === undefined) {
        value = "true";
      } else if (inlineValue === "true" || inlineValue === "false") {
        value = inlineValue;
      } else {
        return refuse(
          `-${name} is a switch: write -${name} (or -${name}=true / -${name}=false), not "${word}"`,
        );
      }

      index++;
    } else {
      if (inlineValue !== undefined) {
        value = inlineValue;
        index++;
      } else if (index + 1 < words.length) {
        value = words[index + 1] || "";
        index += 2;
      } else {
        return refuse(`-${name} needs a value: ${rule.usage}`);
      }

      if (!value) {
        return refuse(`-${name} needs a non-empty value: ${rule.usage}`);
      }

      if (looksLikeFlag(value)) {
        return refuse(
          `-${name} takes a value, but its value is "${value}", which looks like a flag (govc would read it as -${name}'s value); write ${rule.usage}`,
        );
      }

      const valueProblem: string | null = rule.valueProblem
        ? rule.valueProblem(value)
        : null;

      if (valueProblem) {
        return refuse(`the value of -${name}: ${valueProblem}`);
      }
    }

    values.set(name, [...(earlier || []), value]);
  }

  return {
    values,
    positionals: words.slice(index),
    sawTerminator,
    problem: null,
  };
}

// Is this switch on (given, and not =false)?
function isOn(parsed: ParsedGovcArgs, name: string): boolean {
  const given: Array<string> | undefined = parsed.values.get(name);
  return Boolean(given && given[given.length - 1] === "true");
}

function lastValue(parsed: ParsedGovcArgs, name: string): string | undefined {
  const given: Array<string> | undefined = parsed.values.get(name);
  return given && given.length > 0 ? given[given.length - 1] : undefined;
}

/*
 * Why a word that begins with "-" is refused as an argument: after the
 * first argument it is the flag the model put in the wrong place.
 */
function dashArgumentProblem(
  word: string,
  index: number,
  positionals: Array<string>,
  command: string,
): string {
  if (index > 0) {
    return `"${word}" comes after the argument "${positionals[0]}": govc reads flags only before the first argument, so it would take "${word}" as a name, not a flag; put every flag right after "govc ${command}"`;
  }

  return `the argument "${word}" starts with "-"; govc would not read it as a flag here, so write the name or path it stands for`;
}

function countProblemFor(
  count: number,
  command: string,
  spec: GovcCommandSpec,
): string | null {
  if (count < spec.minArguments) {
    return `govc ${command} needs ${spec.argumentsUsage}`;
  }

  if (count > spec.maxArguments) {
    return spec.maxArguments === 0
      ? `govc ${command} takes no arguments`
      : `govc ${command} takes at most ${spec.maxArguments} argument${
          spec.maxArguments === 1 ? "" : "s"
        }: ${spec.argumentsUsage}`;
  }

  return null;
}

// The arguments of an ordinary read: paths or names, globs allowed.
function readArgumentsProblem(
  parsed: ParsedGovcArgs,
  command: string,
  spec: GovcCommandSpec,
): string | null {
  const positionals: Array<string> = parsed.positionals;

  for (let i: number = 0; i < positionals.length; i++) {
    const word: string = positionals[i] || "";

    if (!word) {
      return "an empty argument names nothing";
    }

    if (word.startsWith("-")) {
      return dashArgumentProblem(word, i, positionals, command);
    }
  }

  return countProblemFor(positionals.length, command, spec);
}

/*
 * The objects a write names as its arguments: each exactly one object,
 * none twice.
 */
function targetArgumentsProblem(
  parsed: ParsedGovcArgs,
  command: string,
  spec: GovcCommandSpec,
): string | null {
  const positionals: Array<string> = parsed.positionals;
  const seen: Set<string> = new Set<string>();

  for (let i: number = 0; i < positionals.length; i++) {
    const word: string = positionals[i] || "";

    if (word.startsWith("-") && word.length > 1) {
      return dashArgumentProblem(word, i, positionals, command);
    }

    const problem: string | null = objectNameProblem(word);

    if (problem) {
      return problem;
    }

    if (seen.has(word)) {
      return `"${word}" is named twice; name each object once`;
    }

    seen.add(word);
  }

  return countProblemFor(positionals.length, command, spec);
}

/*
 * ---------------------------------------------------------------------------
 * Results
 * ---------------------------------------------------------------------------
 */

function allowedResult(data: {
  argv: Array<string>;
  command: string;
  tier: ResourceCommandTier;
  reason: string;
  targets: Array<string>;
  requiresHuman?: boolean;
}): ResourceCommandPolicyResult {
  const result: ResourceCommandPolicyResult = {
    tier: data.tier,
    reason: data.reason,
    program: GOVC_PROGRAM,
    args: data.argv.slice(1),
    verb: data.command,
    displayCommand: renderResourceDisplayCommand(data.argv),
    targets: data.targets,
  };

  if (data.requiresHuman === true) {
    result.requiresHuman = true;
  }

  return result;
}

// "one virtual machine (web-01)" / "2 virtual machines (web-01, web-02)".
function describeObjects(
  names: Array<string>,
  singular: string,
  plural: string,
): string {
  if (names.length === 1) {
    return `one ${singular} (${names[0]})`;
  }

  return `${names.length} ${plural} (${names.join(", ")})`;
}

/*
 * ---------------------------------------------------------------------------
 * Read commands
 * ---------------------------------------------------------------------------
 */

interface ReadCommand {
  spec: GovcCommandSpec;
  // Replaces readArgumentsProblem for commands that read their own arguments.
  argumentsProblem?:
    | ((parsed: ParsedGovcArgs, command: string) => string | null)
    | undefined;
}

const UNLIMITED: number = Number.MAX_SAFE_INTEGER;

/*
 * find ROOT -KEY VALUE ...: after ROOT govc reads the remaining words as
 * pairs itself, applies any of its own flags written there (so `-u` there
 * would switch the endpoint) and uses every other key as a property filter.
 */
function findArgumentsProblem(parsed: ParsedGovcArgs): string | null {
  const positionals: Array<string> = parsed.positionals;

  if (positionals.length === 0) {
    return null;
  }

  const root: string = positionals[0] || "";

  if (!root) {
    return "govc find needs a ROOT path such as . or /DATACENTER/vm, not an empty word";
  }

  if (root.startsWith("-")) {
    return `write the ROOT path (for example ".") before property filters: govc find . -type m -runtime.powerState poweredOff`;
  }

  const pairs: Array<string> = positionals.slice(1);

  if (pairs.length % 2 !== 0) {
    return `govc find reads the words after ROOT as -KEY VALUE pairs, and "${
      pairs[pairs.length - 1]
    }" has no value`;
  }

  const seen: Set<string> = new Set<string>();

  if (parsed.values.has("name")) {
    seen.add("name");
  }

  for (let i: number = 0; i < pairs.length; i += 2) {
    const key: string = pairs[i] || "";
    const value: string = pairs[i + 1] || "";

    if (!looksLikeFlag(key)) {
      return `after the ROOT path govc find reads only -KEY VALUE pairs, and "${key}" is not a -KEY: give one ROOT path, then filters such as -type m or -runtime.powerState poweredOff`;
    }

    const name: string = key.slice(1);
    const denied: string | null = globallyDeniedFlagReason(name);

    if (denied !== null) {
      return `-${name} is refused on every govc command (govc find applies it even after the ROOT path): it ${denied}`;
    }

    if (!value || looksLikeFlag(value)) {
      return `the filter -${name} needs a value, not "${value}"`;
    }

    if (name === "type") {
      const problem: string | null = typeNameProblem(value);

      if (problem) {
        return `the value of -type: ${problem}`;
      }

      continue;
    }

    if (name !== "name" && !isCollectableGovcProperty(name)) {
      return `"-${name}" after the ROOT path is not a filter this policy allows: govc find filters only on -type, -name and the properties ${COLLECTABLE_PROPERTY_LIST}`;
    }

    if (seen.has(name)) {
      return `-${name} is given more than once; govc keeps only the last one, so give each filter once`;
    }

    seen.add(name);
  }

  return null;
}

// object.collect OBJECT PROPERTY...: every property named and allowlisted.
function collectArgumentsProblem(parsed: ParsedGovcArgs): string | null {
  const positionals: Array<string> = parsed.positionals;
  const target: string = positionals[0] || "";

  if (positionals.length < 2) {
    return `govc object.collect needs an object and at least one property, such as govc object.collect -s /DATACENTER/vm/NAME runtime.powerState (without a property it prints every property, config.extraConfig included)`;
  }

  if (!target || target.startsWith("-")) {
    return `name the object as an inventory path or a managed object reference (VirtualMachine:vm-42), not "${target}"`;
  }

  for (const property of positionals.slice(1)) {
    if (property.startsWith("-")) {
      return `govc object.collect reads "${property}" after the object as a property filter, and this policy allows none there; filter with govc find ROOT -type m -runtime.powerState poweredOff, or put flags right after "govc object.collect"`;
    }

    if (!isCollectableGovcProperty(property)) {
      return `"${property}" is not a property this policy lets object.collect read (configuration such as config.extraConfig can hold secrets); collect only ${COLLECTABLE_PROPERTY_LIST}`;
    }
  }

  return null;
}

function findUnknownFlagHint(name: string): string | null {
  if (name.includes(".") || isCollectableGovcProperty(name)) {
    return "property filters go after the ROOT path: govc find . -type m -runtime.powerState poweredOff";
  }

  return null;
}

const READ_COMMANDS: ReadonlyMap<string, ReadCommand> = new Map<
  string,
  ReadCommand
>([
  [
    "about",
    {
      spec: {
        summary: "shows the vCenter's product, version and API version",
        flags: flagTable([JSON_FLAG, ["l", switchFlag("l")]]),
        minArguments: 0,
        maxArguments: 0,
        argumentsUsage: "no arguments",
      },
    },
  ],
  [
    "version",
    {
      spec: {
        summary: "shows the govc version",
        flags: flagTable([["l", switchFlag("l")]]),
        minArguments: 0,
        maxArguments: 0,
        argumentsUsage: "no arguments",
      },
    },
  ],
  [
    "datacenter.info",
    {
      spec: {
        summary:
          "shows datacenters with their host, cluster, VM, network and datastore counts",
        flags: flagTable([JSON_FLAG, DATACENTER_FLAG]),
        minArguments: 0,
        maxArguments: UNLIMITED,
        argumentsUsage: "[DATACENTER]...",
      },
    },
  ],
  [
    "ls",
    {
      spec: {
        summary: "lists inventory objects",
        flags: flagTable([
          JSON_FLAG,
          DATACENTER_FLAG,
          ["l", switchFlag("l")],
          ["L", switchFlag("L")],
          ["i", switchFlag("i")],
          ["t", valueFlag("-t TYPE", typeNameProblem)],
        ]),
        minArguments: 0,
        maxArguments: UNLIMITED,
        argumentsUsage: "[PATH]...",
      },
    },
  ],
  [
    "find",
    {
      spec: {
        summary: "searches the inventory",
        flags: flagTable([
          JSON_FLAG,
          DATACENTER_FLAG,
          ["l", switchFlag("l")],
          ["i", switchFlag("i")],
          ["type", valueFlag("-type TYPE", typeNameProblem, true)],
          ["name", valueFlag("-name NAME")],
          ["maxdepth", valueFlag("-maxdepth N", maxDepthProblem)],
        ]),
        minArguments: 0,
        maxArguments: UNLIMITED,
        argumentsUsage: "[ROOT] [-KEY VALUE]...",
        unknownFlagHint: findUnknownFlagHint,
      },
      argumentsProblem: findArgumentsProblem,
    },
  ],
  [
    "vm.info",
    {
      spec: {
        summary:
          "shows virtual machine state, host, guest OS, IP address and VMware Tools status",
        flags: flagTable([
          DATACENTER_FLAG,
          ["r", switchFlag("r")],
          ["g", switchFlag("g")],
          ["t", switchFlag("t")],
        ]),
        refusedFlags: refusals(
          [
            [
              "e",
              "it prints the VM's extraConfig, where guestinfo.* keys (cloud-init user data, passwords) live",
            ],
            [
              "json",
              "it loads EVERY property of the VM, config.extraConfig included; run govc vm.info without -json, or govc object.collect -s VM runtime.powerState",
            ],
            [
              "waitip",
              "it waits until the VM has an IP address and can block for the whole timeout",
            ],
          ],
          VM_SEARCH_FLAGS,
          VM_SEARCH_FLAG_REASON,
        ),
        minArguments: 1,
        maxArguments: UNLIMITED,
        argumentsUsage: "the VM to show: govc vm.info [-r] VM...",
      },
    },
  ],
  [
    "host.info",
    {
      spec: {
        summary:
          "shows ESXi host hardware, CPU and memory usage, and connection state",
        flags: flagTable([DATACENTER_FLAG, HOST_FLAG]),
        refusedFlags: refusals([
          [
            "json",
            "it loads EVERY property of the host, advanced settings included; run govc host.info without -json, or govc object.collect -s HOST runtime.connectionState",
          ],
        ]),
        minArguments: 0,
        maxArguments: UNLIMITED,
        argumentsUsage: "[HOST]...",
      },
    },
  ],
  [
    "host.service.ls",
    {
      spec: {
        summary: "lists an ESXi host's services and whether they are running",
        flags: flagTable([JSON_FLAG, DATACENTER_FLAG, HOST_FLAG]),
        minArguments: 0,
        maxArguments: 0,
        argumentsUsage: "no arguments (name the host with -host HOST)",
      },
    },
  ],
  [
    "host.date.info",
    {
      spec: {
        summary: "shows an ESXi host's clock and NTP configuration",
        flags: flagTable([JSON_FLAG, DATACENTER_FLAG, HOST_FLAG]),
        minArguments: 0,
        maxArguments: 0,
        argumentsUsage: "no arguments (name the host with -host HOST)",
      },
    },
  ],
  [
    "datastore.info",
    {
      spec: {
        summary: "shows datastore type, capacity and free space",
        flags: flagTable([JSON_FLAG, DATACENTER_FLAG]),
        minArguments: 0,
        maxArguments: UNLIMITED,
        argumentsUsage: "[DATASTORE]...",
      },
    },
  ],
  [
    "pool.info",
    {
      spec: {
        summary: "shows resource pool limits, reservations and usage",
        flags: flagTable([JSON_FLAG, DATACENTER_FLAG]),
        minArguments: 1,
        maxArguments: UNLIMITED,
        argumentsUsage: "the pool to show: govc pool.info POOL...",
      },
    },
  ],
  [
    "events",
    {
      spec: {
        summary: "lists recent vCenter events",
        flags: flagTable([
          JSON_FLAG,
          DATACENTER_FLAG,
          ["n", valueFlag("-n N", countProblem)],
          ["l", switchFlag("l")],
          ["type", valueFlag("-type EVENTTYPE", eventTypeProblem, true)],
        ]),
        refusedFlags: refusals([
          [
            "f",
            "it follows the event stream until the command times out; use -n N for the last N events",
          ],
        ]),
        minArguments: 0,
        maxArguments: UNLIMITED,
        argumentsUsage: "[PATH]...",
      },
    },
  ],
  [
    "tasks",
    {
      spec: {
        summary: "lists recent vCenter tasks",
        flags: flagTable([
          JSON_FLAG,
          DATACENTER_FLAG,
          ["n", valueFlag("-n N", countProblem)],
          ["l", switchFlag("l")],
        ]),
        refusedFlags: refusals([
          [
            "f",
            "it follows task updates until the command times out; use -n N for the last N tasks",
          ],
        ]),
        minArguments: 0,
        maxArguments: 1,
        argumentsUsage: "[PATH]",
      },
    },
  ],
  [
    "metric.ls",
    {
      spec: {
        summary: "lists the performance metrics an object has",
        flags: flagTable([
          JSON_FLAG,
          DATACENTER_FLAG,
          ["l", switchFlag("l")],
          ["L", switchFlag("L")],
          ["i", valueFlag("-i INTERVAL", intervalProblem)],
        ]),
        minArguments: 1,
        maxArguments: UNLIMITED,
        argumentsUsage: "the object whose metrics to list: govc metric.ls PATH",
      },
    },
  ],
  [
    "metric.sample",
    {
      spec: {
        summary: "samples performance metrics of an object",
        flags: flagTable([
          JSON_FLAG,
          DATACENTER_FLAG,
          ["n", valueFlag("-n N", countProblem)],
          ["i", valueFlag("-i INTERVAL", intervalProblem)],
          ["t", switchFlag("t")],
          ["instance", valueFlag("-instance INSTANCE")],
        ]),
        refusedFlags: refusals([
          ["plot", "it pipes the samples into gnuplot, another program"],
        ]),
        minArguments: 2,
        maxArguments: UNLIMITED,
        argumentsUsage:
          "an object and at least one metric: govc metric.sample PATH... METRIC... (such as cpu.usage.average)",
      },
    },
  ],
  [
    "object.collect",
    {
      spec: {
        summary: "reads allowlisted runtime and health properties of an object",
        flags: flagTable([
          JSON_FLAG,
          DATACENTER_FLAG,
          ["s", switchFlag("s")],
          ["type", valueFlag("-type TYPE", typeNameProblem, true)],
        ]),
        refusedFlags: refusals([
          ["n", "it waits for property updates until the command times out"],
          ["wait", "it waits for property updates until the command times out"],
          ["R", "it reads a request from a file"],
          ["O", "it prints a request instead of collecting"],
          ["o", "it prints an object's whole structure"],
        ]),
        minArguments: 2,
        maxArguments: UNLIMITED,
        argumentsUsage: "an object and at least one property",
      },
      argumentsProblem: collectArgumentsProblem,
    },
  ],
  [
    "tags.ls",
    {
      spec: {
        summary: "lists vCenter tags",
        flags: flagTable([JSON_FLAG, ["c", valueFlag("-c CATEGORY")]]),
        minArguments: 0,
        maxArguments: 0,
        argumentsUsage: "no arguments",
      },
    },
  ],
]);

/*
 * ---------------------------------------------------------------------------
 * Write commands
 * ---------------------------------------------------------------------------
 */

type WriteEvaluator = (
  argv: Array<string>,
  parsed: ParsedGovcArgs,
  command: string,
) => ResourceCommandPolicyResult;

interface WriteCommand {
  spec: GovcCommandSpec;
  evaluate: WriteEvaluator;
}

interface PowerOperation {
  flag: string;
  // One VM of this operation is SafeWrite.
  safe: boolean;
  // -force may go with it.
  allowsForce: boolean;
  describe: (what: string) => string;
}

const POWER_OPERATIONS: ReadonlyArray<PowerOperation> = [
  {
    flag: "on",
    safe: true,
    allowsForce: false,
    describe: (what: string): string => {
      return `powers on ${what}`;
    },
  },
  {
    flag: "r",
    safe: true,
    allowsForce: false,
    describe: (what: string): string => {
      return `reboots the guest OS of ${what} gracefully through VMware Tools`;
    },
  },
  {
    flag: "s",
    safe: false,
    allowsForce: false,
    describe: (what: string): string => {
      return `shuts down the guest OS of ${what} through VMware Tools; it stays off until someone powers it on`;
    },
  },
  {
    flag: "off",
    safe: false,
    allowsForce: true,
    describe: (what: string): string => {
      return `powers off ${what} at once, like pulling the plug: unsaved guest data is lost`;
    },
  },
  {
    flag: "reset",
    safe: false,
    allowsForce: true,
    describe: (what: string): string => {
      return `hard-resets ${what}, like pressing its reset button: unsaved guest data is lost`;
    },
  },
  {
    flag: "suspend",
    safe: false,
    allowsForce: false,
    describe: (what: string): string => {
      return `suspends ${what}: its guest stops running until someone resumes it`;
    },
  },
];

const POWER_OPERATION_CHOICES: string =
  "-on, -r (guest reboot), -s (guest shutdown), -off, -reset or -suspend";

function evaluatePower(
  argv: Array<string>,
  parsed: ParsedGovcArgs,
  command: string,
): ResourceCommandPolicyResult {
  const chosen: Array<PowerOperation> = POWER_OPERATIONS.filter(
    (operation: PowerOperation): boolean => {
      return isOn(parsed, operation.flag);
    },
  );

  if (chosen.length === 0) {
    return deniedResult(
      argv,
      `govc vm.power needs exactly one operation: ${POWER_OPERATION_CHOICES}`,
    );
  }

  if (chosen.length > 1) {
    return deniedResult(
      argv,
      `govc vm.power takes exactly one operation, not ${chosen
        .map((operation: PowerOperation): string => {
          return `-${operation.flag}`;
        })
        .join(" and ")}; run one command per operation`,
    );
  }

  const operation: PowerOperation = chosen[0]!;
  const force: boolean = isOn(parsed, "force");

  if (force && !operation.allowsForce) {
    return deniedResult(
      argv,
      `-force goes only with -off or -reset: with -${operation.flag} it ${
        operation.flag === "r" || operation.flag === "s"
          ? "falls back to a hard reset or power-off when VMware Tools is not running"
          : "ignores the VM's power state"
      }; drop -force`,
    );
  }

  const vms: Array<string> = parsed.positionals;
  const what: string = describeObjects(
    vms,
    "virtual machine",
    "virtual machines",
  );
  const safe: boolean = operation.safe && vms.length === 1;

  let reason: string = operation.describe(what);

  if (force) {
    reason += "; -force ignores an error about the VM's current power state";
  }

  if (operation.safe && !safe) {
    reason += "; a power operation on more than one VM needs approval";
  }

  return allowedResult({
    argv,
    command,
    tier: safe ? ResourceCommandTier.SafeWrite : ResourceCommandTier.RiskyWrite,
    reason,
    targets: vms.slice(),
  });
}

function evaluateMigrate(
  argv: Array<string>,
  parsed: ParsedGovcArgs,
  command: string,
): ResourceCommandPolicyResult {
  const destinations: Array<string> = [];
  const host: string | undefined = lastValue(parsed, "host");
  const pool: string | undefined = lastValue(parsed, "pool");
  const datastore: string | undefined = lastValue(parsed, "ds");

  if (host !== undefined) {
    destinations.push(`host ${host}`);
  }

  if (pool !== undefined) {
    destinations.push(`resource pool ${pool}`);
  }

  if (datastore !== undefined) {
    destinations.push(`datastore ${datastore}`);
  }

  if (destinations.length === 0) {
    return deniedResult(
      argv,
      "govc vm.migrate needs a destination: -host HOST, -pool POOL or -ds DATASTORE",
    );
  }

  const vms: Array<string> = parsed.positionals;

  return allowedResult({
    argv,
    command,
    tier: ResourceCommandTier.RiskyWrite,
    reason: `migrates ${describeObjects(
      vms,
      "virtual machine",
      "virtual machines",
    )} to ${destinations.join(
      ", ",
    )} (vMotion / Storage vMotion); moving a running VM always needs a human`,
    targets: vms.slice(),
    requiresHuman: true,
  });
}

function evaluateMaintenanceEnter(
  argv: Array<string>,
  parsed: ParsedGovcArgs,
  command: string,
): ResourceCommandPolicyResult {
  const host: string = parsed.positionals[0] || "";

  return allowedResult({
    argv,
    command,
    tier: ResourceCommandTier.RiskyWrite,
    reason: `puts the ESXi host ${host} into maintenance mode: every VM running on it must move off (or the task waits), so it always needs a human`,
    targets: [host],
    requiresHuman: true,
  });
}

function evaluateMaintenanceExit(
  argv: Array<string>,
  parsed: ParsedGovcArgs,
  command: string,
): ResourceCommandPolicyResult {
  const host: string = parsed.positionals[0] || "";

  return allowedResult({
    argv,
    command,
    tier: ResourceCommandTier.RiskyWrite,
    reason: `takes the ESXi host ${host} out of maintenance mode, so it runs virtual machines again`,
    targets: [host],
  });
}

const MAINTENANCE_REFUSALS: ReadonlyMap<string, string> = refusals(
  [
    [
      "evacuate",
      "evacuating powered-off VMs as well is not something this policy allows",
    ],
  ],
  HOST_SEARCH_FLAGS,
  HOST_SEARCH_FLAG_REASON,
);

const WRITE_COMMANDS: ReadonlyMap<string, WriteCommand> = new Map<
  string,
  WriteCommand
>([
  [
    "vm.power",
    {
      spec: {
        summary: "changes a virtual machine's power state",
        flags: flagTable([
          WRITE_DATACENTER_FLAG,
          ["on", switchFlag("on")],
          ["r", switchFlag("r")],
          ["s", switchFlag("s")],
          ["off", switchFlag("off")],
          ["reset", switchFlag("reset")],
          ["suspend", switchFlag("suspend")],
          ["force", switchFlag("force")],
        ]),
        refusedFlags: refusals(
          [
            [
              "standby",
              "guest standby is not an operation this policy allows; use -s (guest shutdown) or -suspend",
            ],
            [
              "M",
              "it powers VMs on through the datacenter as one batch; power on one VM per command",
            ],
            [
              "wait",
              "the command must wait for the operation, so its outcome is known",
            ],
          ],
          VM_SEARCH_FLAGS,
          VM_SEARCH_FLAG_REASON,
        ),
        minArguments: 1,
        maxArguments: UNLIMITED,
        argumentsUsage: "the VM to act on: govc vm.power -on VM",
      },
      evaluate: evaluatePower,
    },
  ],
  [
    "vm.migrate",
    {
      spec: {
        summary: "migrates virtual machines",
        flags: flagTable([
          WRITE_DATACENTER_FLAG,
          ["host", valueFlag("-host HOST", objectNameProblem)],
          ["pool", valueFlag("-pool POOL", objectNameProblem)],
          ["ds", valueFlag("-ds DATASTORE", objectNameProblem)],
        ]),
        refusedFlags: refusals([], VM_SEARCH_FLAGS, VM_SEARCH_FLAG_REASON),
        minArguments: 1,
        maxArguments: UNLIMITED,
        argumentsUsage: "the VM to move: govc vm.migrate -host HOST VM",
      },
      evaluate: evaluateMigrate,
    },
  ],
  [
    "host.maintenance.enter",
    {
      spec: {
        summary: "puts an ESXi host into maintenance mode",
        flags: flagTable([WRITE_DATACENTER_FLAG]),
        refusedFlags: MAINTENANCE_REFUSALS,
        minArguments: 1,
        maxArguments: 1,
        argumentsUsage:
          "exactly one host (one command per host): govc host.maintenance.enter HOST",
      },
      evaluate: evaluateMaintenanceEnter,
    },
  ],
  [
    "host.maintenance.exit",
    {
      spec: {
        summary: "takes an ESXi host out of maintenance mode",
        flags: flagTable([WRITE_DATACENTER_FLAG]),
        refusedFlags: MAINTENANCE_REFUSALS,
        minArguments: 1,
        maxArguments: 1,
        argumentsUsage:
          "exactly one host (one command per host): govc host.maintenance.exit HOST",
      },
      evaluate: evaluateMaintenanceExit,
    },
  ],
]);

/*
 * ---------------------------------------------------------------------------
 * Denied commands
 * ---------------------------------------------------------------------------
 */

interface DeniedCommandFamily {
  names: ReadonlyArray<string>;
  prefixes: ReadonlyArray<string>;
  reason: string;
}

// Commands a model reaches for, refused with a reason that names the risk.
const DENIED_COMMAND_FAMILIES: ReadonlyArray<DeniedCommandFamily> = [
  {
    names: ["env"],
    prefixes: [],
    reason:
      "it prints the agent's GOVC_* settings, its vCenter password included",
  },
  {
    names: [],
    prefixes: ["guest.", "vm.guest."],
    reason:
      "it runs programs, moves files or changes accounts inside a VM's guest OS",
  },
  {
    names: ["vm.console", "vm.keystrokes"],
    prefixes: ["vm.vnc."],
    reason: "it opens or types into a VM's console",
  },
  {
    names: [
      "vm.destroy",
      "vm.create",
      "vm.clone",
      "vm.instantclone",
      "vm.change",
      "vm.upgrade",
      "vm.register",
      "vm.unregister",
      "vm.markastemplate",
      "vm.markasvm",
      "vm.customize",
      "vm.question",
    ],
    prefixes: [
      "vm.disk.",
      "vm.network.",
      "vm.rdm.",
      "vm.option.",
      "vm.target.",
      "vm.dataset.",
      "vm.policy.",
    ],
    reason:
      "it creates, deletes, re-registers or reconfigures a virtual machine",
  },
  {
    names: [],
    prefixes: ["snapshot."],
    reason:
      "snapshot commands can revert or remove VM state and fill datastores",
  },
  {
    names: [],
    prefixes: ["device.", "disk."],
    reason: "it changes a VM's virtual hardware or disks",
  },
  {
    names: [],
    prefixes: ["datastore."],
    reason:
      "it browses, reads, writes or deletes datastore files (a VM's .vmx file holds its guestinfo secrets); only datastore.info is allowed",
  },
  {
    names: [
      "host.add",
      "host.remove",
      "host.shutdown",
      "host.reboot",
      "host.disconnect",
      "host.reconnect",
      "host.service",
      "host.date.change",
    ],
    prefixes: [
      "host.esxcli",
      "host.account.",
      "host.cert.",
      "host.option.",
      "host.portgroup.",
      "host.vswitch.",
      "host.vnic.",
      "host.storage.",
      "host.autostart.",
      "host.firewall",
    ],
    reason:
      "it adds, removes, restarts or reconfigures an ESXi host, or runs esxcli on it",
  },
  {
    names: [],
    prefixes: ["permissions.", "role.", "sso.", "session."],
    reason: "it changes or reveals who may do what in vCenter, or its sessions",
  },
  {
    names: [],
    prefixes: ["license."],
    reason: "it changes vCenter licensing",
  },
  {
    names: [],
    prefixes: ["import.", "export.", "library."],
    reason:
      "it moves VM images, OVFs or content-library items in or out of vCenter",
  },
  {
    names: ["option.set", "option.ls"],
    prefixes: [],
    reason:
      "it reads or changes vCenter advanced settings, which can hold credentials",
  },
  {
    names: [
      "object.destroy",
      "object.rename",
      "object.mv",
      "object.method",
      "object.reload",
      "object.save",
    ],
    prefixes: [],
    reason: "it deletes, renames, moves or calls methods on inventory objects",
  },
];

function deniedFamilyReason(command: string): string | null {
  for (const family of DENIED_COMMAND_FAMILIES) {
    if (
      family.names.includes(command) ||
      family.prefixes.some((prefix: string): boolean => {
        return command.startsWith(prefix);
      })
    ) {
      return family.reason;
    }
  }

  return null;
}

const ALLOWED_COMMANDS_SENTENCE: string = `read commands: ${Array.from(
  READ_COMMANDS.keys(),
).join(", ")}; changes: ${Array.from(WRITE_COMMANDS.keys()).join(", ")}`;

/*
 * ---------------------------------------------------------------------------
 * Evaluation
 * ---------------------------------------------------------------------------
 */

function evaluateGovcArgv(argv: Array<string>): ResourceCommandPolicyResult {
  if (!Array.isArray(argv) || argv.length === 0) {
    return deniedResult([], "Empty command.");
  }

  if (
    argv.some((word: unknown): boolean => {
      return typeof word !== "string";
    })
  ) {
    return deniedResult(argv, "Every word of the command must be a string.");
  }

  if (argv.length > MAX_RESOURCE_COMMAND_TOKENS) {
    return deniedResult(
      argv,
      `A command may have at most ${MAX_RESOURCE_COMMAND_TOKENS} words.`,
    );
  }

  const totalLength: number = argv.reduce(
    (sum: number, word: string): number => {
      return sum + word.length;
    },
    0,
  );

  if (totalLength > MAX_COMMAND_LENGTH_CHARS) {
    return deniedResult(
      argv,
      `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
    );
  }

  if (argv[0] !== GOVC_PROGRAM) {
    return deniedResult(
      argv,
      `the govc command policy covers only commands that start with "govc"`,
    );
  }

  const words: Array<string> = argv.slice(1);

  for (const word of words) {
    const problem: string | null = characterProblem(word);

    if (problem) {
      return deniedResult(argv, problem);
    }
  }

  const command: string | undefined = words[0];

  if (command === undefined || command === "") {
    return deniedResult(
      argv,
      `name a govc command after "govc" (for example govc about, govc ls /DATACENTER/vm or govc vm.info VM); ${ALLOWED_COMMANDS_SENTENCE}`,
    );
  }

  if (command.startsWith("-")) {
    const name: string = command.replace(/^-{1,2}/, "").split("=")[0] || "";
    const denied: string | null = globallyDeniedFlagReason(name);

    if (denied !== null) {
      return deniedResult(
        argv,
        `-${name} is refused on every govc command: it ${denied}`,
      );
    }

    return deniedResult(
      argv,
      `"${command}" comes before the command: govc takes the command first and its flags after it (govc ls -json /DATACENTER/vm, not govc -json ls /DATACENTER/vm)`,
    );
  }

  const rest: Array<string> = words.slice(1);
  const read: ReadCommand | undefined = READ_COMMANDS.get(command);

  if (read) {
    const parsed: ParsedGovcArgs = parseGovcArgs(rest, command, read.spec);

    if (parsed.problem) {
      return deniedResult(argv, parsed.problem);
    }

    const problem: string | null = read.argumentsProblem
      ? read.argumentsProblem(parsed, command)
      : readArgumentsProblem(parsed, command, read.spec);

    if (problem) {
      return deniedResult(argv, problem);
    }

    return allowedResult({
      argv,
      command,
      tier: ResourceCommandTier.Read,
      reason: read.spec.summary,
      targets: [],
    });
  }

  const write: WriteCommand | undefined = WRITE_COMMANDS.get(command);

  if (write) {
    const parsed: ParsedGovcArgs = parseGovcArgs(rest, command, write.spec);

    if (parsed.problem) {
      return deniedResult(argv, parsed.problem);
    }

    const problem: string | null = targetArgumentsProblem(
      parsed,
      command,
      write.spec,
    );

    if (problem) {
      return deniedResult(argv, problem);
    }

    return write.evaluate(argv, parsed, command);
  }

  const familyReason: string | null = deniedFamilyReason(command);

  if (familyReason !== null) {
    return deniedResult(
      argv,
      `govc ${command} is refused: ${familyReason}. This policy allows ${ALLOWED_COMMANDS_SENTENCE}`,
    );
  }

  const folded: string = command.toLowerCase();

  if (
    folded !== command &&
    (READ_COMMANDS.has(folded) || WRITE_COMMANDS.has(folded))
  ) {
    return deniedResult(
      argv,
      `govc command names are case-sensitive: write "${folded}", not "${command}"`,
    );
  }

  return deniedResult(
    argv,
    `"${command}" is not a govc command this policy allows; ${ALLOWED_COMMANDS_SENTENCE}`,
  );
}

const READ_COMMAND_GUIDE: string = [
  "- Order: `govc COMMAND [FLAGS] [ARGUMENTS]` — the command first, flags right after it, then names or paths (govc ignores flags written after an argument). Quote names with spaces.",
  "- `govc about` and `govc datacenter.info [DC]` — vCenter version and datacenters. Add `-json` where listed below; `-dc DATACENTER` picks the datacenter.",
  "- `govc ls [-l] [-L] [-i] [-t TYPE] [PATH]...` — browse the inventory: `/DC/vm`, `/DC/host`, `/DC/datastore`, `/DC/network` (-json ok).",
  `- \`govc find [-l] [-i] [-type T] [-name GLOB] [-maxdepth N] [ROOT] [-KEY VALUE]...\` — search (types: m VM, h host, s datastore, c cluster, p pool; -json ok). Filters after ROOT: -type, -name and the properties ${COLLECTABLE_PROPERTY_LIST}, e.g. \`govc find . -type m -runtime.powerState poweredOff\`.`,
  "- `govc vm.info [-r] [-t] VM...` — power state, host, guest OS, IP, VMware Tools (text only: -json and -e are refused because they include extraConfig).",
  "- `govc host.info [-host HOST] [HOST...]` (text only), `govc host.service.ls -host HOST`, `govc host.date.info -host HOST` — ESXi host state, services, clock.",
  "- `govc datastore.info [DS...]`, `govc pool.info POOL...` — capacity, free space, pool limits (-json ok).",
  `- \`govc events [-n N] [-l] [-type EVENTTYPE] [PATH...]\`, \`govc tasks [-n N] [-l] [PATH]\` — recent events and tasks, N up to ${GOVC_MAX_RECORD_COUNT} (no -f).`,
  `- \`govc metric.ls PATH\`, \`govc metric.sample [-n N] [-i real|day|week|month|year] [-instance X] [-t] PATH... METRIC...\` — e.g. \`govc metric.sample -n 12 /DC/vm/web-01 cpu.usage.average mem.usage.average\`.`,
  `- \`govc object.collect [-s] [-type T] OBJECT PROPERTY...\` — only ${COLLECTABLE_PROPERTY_LIST}, e.g. \`govc object.collect -s /DC/vm/web-01 runtime.powerState\`.`,
  "- `govc tags.ls [-c CATEGORY]`, `govc version`.",
  "- Refused: -u, -k, -cert, -key, -tls-*, -debug, -trace, -dump, -xml, -persist-session; guest.*, datastore file access, esxcli, env, option.ls, and every command not listed.",
].join("\n");

const WRITE_COMMAND_GUIDE: string = [
  "- `govc vm.power -on VM` and `govc vm.power -r VM` (graceful guest reboot through VMware Tools) on ONE VM: SafeWrite — runs unattended in Automatic mode.",
  "- `govc vm.power -s VM` (guest shutdown), `-off`, `-reset`, `-suspend` (`-force` only with -off or -reset), and any power operation on more than one VM: RiskyWrite — needs approval unless the resource's allowlist names it or approvals are bypassed.",
  "- `govc host.maintenance.exit HOST` (one host): RiskyWrite.",
  "- `govc vm.migrate -host HOST|-pool POOL|-ds DATASTORE VM...` and `govc host.maintenance.enter HOST`: RiskyWrite that always needs a human.",
  "- Name every VM or host exactly — its name or full inventory path (/DC/vm/FOLDER/NAME), no wildcards (* ? [ ]); prefer the path when names repeat. Flags go before the names; one operation per command.",
  "- Refused: vm.destroy/create/clone/change/upgrade/register/unregister, vm.console, snapshot.*, device.*, disk.*, guest.*, datastore.rm/upload/download/cp/mv, host.add/remove/reboot/shutdown/esxcli, permissions/role/sso/session, license, import/export/library, option.set.",
].join("\n");

const GovcCommandPolicy: ResourceToolPolicy = {
  name: "govc",
  programs: [GOVC_PROGRAM],
  readCommandGuide: READ_COMMAND_GUIDE,
  writeCommandGuide: WRITE_COMMAND_GUIDE,
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    try {
      return evaluateGovcArgv(argv);
    } catch {
      try {
        return deniedResult(
          argv,
          "the govc command policy could not evaluate this command",
        );
      } catch {
        return deniedResult(
          [],
          "the govc command policy could not evaluate this command",
        );
      }
    }
  },
};

export default GovcCommandPolicy;
