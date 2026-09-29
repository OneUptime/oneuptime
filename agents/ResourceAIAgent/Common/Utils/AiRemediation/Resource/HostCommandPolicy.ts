/*
 * The host command policy: tiers the host's own diagnostic CLIs, which a
 * Host AI agent runs through nsenter (`nsenter -t 1 -m -u -i -n -p --
 * PROGRAM ARGS`) from a privileged container that shares the host's pid
 * namespace — so every command acts on the host itself, as root.
 *
 * Programs are exact names (HOST_COMMAND_PROGRAMS), never paths, and every
 * command is an argv the agent spawns without a shell. What this policy
 * bounds is therefore each program's own vocabulary, and it reads that
 * vocabulary the way the program does:
 *   - getopt_long programs (systemctl, journalctl, df, free, uptime, ss,
 *     dmesg, lsblk, uname, top): flags anywhere (GNU permutes), clusters of
 *     short flags read letter by letter (`-rf` is -r then -f), a short
 *     flag's value attached (`-n50`, and `-n=50` is the value "=50", as
 *     getopt reads it) or in the next word, `--flag=value`, and "--" ends
 *     the flags. A flag that takes a value takes the next word exactly when
 *     the program would — journalctl's -n and -b only when that word parses
 *     as their value, top's -w only when it is a number — and a value that
 *     starts with "-" is refused unless the flag's values may (a relative
 *     time, a boot offset, a descending sort key), so a denied flag can
 *     never hide as another flag's value. getopt_long also accepts any
 *     unambiguous abbreviation of a long flag; this policy does not: a long
 *     flag is matched in full or refused, so no flag hides behind a prefix.
 *   - ip reads its own options by prefix (`-b` is -batch, `-n` is -netns)
 *     and only before the object; ps mixes UNIX (`-ef`), BSD (`aux`) and
 *     GNU (`--sort`) options; kill takes one signal and then pids. Each has
 *     its own reader below.
 *   - Unknown flags, unknown commands and anything not modelled are Denied,
 *     with a reason that names what IS allowed. Every word must be
 *     printable ASCII: a look-alike dash or letter is refused, not guessed.
 *
 * Tiers:
 *   - Read: systemctl status / is-active / is-failed / is-enabled /
 *     is-system-running / list-units / list-unit-files / list-timers /
 *     list-sockets / list-jobs / list-dependencies / show (only with -p and
 *     only SYSTEMCTL_SHOW_PROPERTIES — never Environment); journalctl
 *     bounded by -n (at most MAX_JOURNALCTL_LINES) or --since, never
 *     following; df, free, uptime, ps (never the BSD `e` that prints
 *     environments), top once in batch mode, ss, ip show/list and route get,
 *     dmesg without clearing or following, lsblk, cat of
 *     HOST_READABLE_FILES only, uname, hostnamectl and timedatectl status.
 *   - SafeWrite: restart, start, reload, try-restart, reload-or-restart or
 *     reset-failed of exactly ONE service, socket, timer or path unit — a
 *     reversible change to one named object.
 *   - RiskyWrite: stop of one unit; any of those verbs on several units;
 *     reset-failed with no unit (every failed unit); journalctl
 *     --vacuum-size / --vacuum-time / --vacuum-files (target "journal").
 *   - RiskyWrite + requiresHuman (never unattended, whatever the mode or
 *     allowlist): any write to a unit in PROTECTED_HOST_UNIT_PATTERNS (ssh,
 *     systemd-*, dbus, the network stack, getty, the container runtimes,
 *     the firewall, ...); start/stop/restart/reload of a target, mount,
 *     automount or swap unit (they fan out to other units or filesystems);
 *     and kill of a pid.
 *   - Denied: every other systemctl command (enable/disable/mask/edit/cat/
 *     daemon-reload/isolate/kill/set-property/the environment verbs/the
 *     power and run-state verbs, ...), writes to slices, scopes, devices,
 *     templates without an instance and the power or run-state units
 *     (reboot.target, rescue.target, systemd-poweroff.service, ...), the
 *     flags that reach another machine, root, image or user manager or that
 *     force a change, journalctl -f and every journal-maintenance flag but
 *     vacuum, kill of pid 1, pid 0 or a process group, and every other
 *     program.
 *
 * Targets (what the agent's protectedTargets and ONEUPTIME_AI_WRITE_TARGETS
 * globs are compared with) are canonical: a unit's full name as systemd
 * resolves it ("nginx" is nginx.service), "pid:N" for a process, and
 * "journal" for a vacuum.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  globMatchesTarget,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";

// The programs, in the order the Host entry of AI_RESOURCE_TYPE_INFO lists them.
export const HOST_COMMAND_PROGRAMS: ReadonlyArray<string> = [
  "systemctl",
  "journalctl",
  "df",
  "free",
  "uptime",
  "ps",
  "ss",
  "ip",
  "dmesg",
  "lsblk",
  "cat",
  "top",
  "uname",
  "hostnamectl",
  "timedatectl",
  "kill",
];

// The most journal lines one journalctl -n may ask for.
export const MAX_JOURNALCTL_LINES: number = 2000;

// The most journal lines systemctl status -n may append.
export const MAX_SYSTEMCTL_STATUS_LINES: number = 200;

// The widest top -w may make its output.
const MAX_TOP_WIDTH: number = 512;

// The largest pid Linux hands out (pid_max may be raised to 2^22).
const MAX_PID: number = 4194304;

/*
 * The only files cat reads: kernel counters and the OS release. Compared
 * exactly, so "/proc/../etc/shadow" or "/proc//loadavg" is not one of them.
 */
export const HOST_READABLE_FILES: ReadonlyArray<string> = [
  "/proc/loadavg",
  "/proc/meminfo",
  "/proc/uptime",
  "/proc/pressure/cpu",
  "/proc/pressure/memory",
  "/proc/pressure/io",
  "/proc/mdstat",
  "/proc/swaps",
  "/proc/mounts",
  "/proc/vmstat",
  "/proc/stat",
  "/proc/sys/fs/file-nr",
  "/proc/net/sockstat",
  "/etc/os-release",
];

/*
 * The unit properties systemctl show may print. Environment and
 * EnvironmentFiles (and every other property) are left out on purpose:
 * units keep secrets there.
 */
export const SYSTEMCTL_SHOW_PROPERTIES: ReadonlyArray<string> = [
  "ActiveState",
  "SubState",
  "LoadState",
  "Result",
  "NRestarts",
  "ExecMainStatus",
  "ExecMainCode",
  "MainPID",
  "ExecMainPID",
  "MemoryCurrent",
  "MemoryPeak",
  "CPUUsageNSec",
  "TasksCurrent",
  "ActiveEnterTimestamp",
  "InactiveEnterTimestamp",
  "StateChangeTimestamp",
  "UnitFileState",
  "FragmentPath",
  "Restart",
  "RestartUSec",
  "TimeoutStopUSec",
  "Description",
  "Id",
];

/*
 * Units a write never touches without a human, whatever the mode or the
 * allowlist: remote access, the service manager and its helpers, the
 * message bus and authorization, the network stack, consoles, the
 * container runtimes and node agents, the firewall, and user managers.
 * Globs over the unit's name without its type suffix, compared
 * case-insensitively (over-matching is the safe direction).
 */
export const PROTECTED_HOST_UNIT_PATTERNS: ReadonlyArray<string> = [
  "ssh",
  "ssh@*",
  "sshd",
  "sshd@*",
  "sshd-*",
  "systemd-*",
  "dbus*",
  "polkit*",
  "NetworkManager*",
  "networking",
  "network*",
  "getty@*",
  "serial-getty@*",
  "docker",
  "containerd",
  "podman*",
  "crio",
  "cri-o",
  "kubelet",
  "k3s*",
  "rke2*",
  "firewalld",
  "nftables",
  "iptables",
  "ip6tables",
  "ufw",
  "user@*",
  "user-runtime-dir@*",
];

/*
 * Units that power off, reboot, suspend or change the run state of the
 * whole host when started (reboot.target, rescue.target,
 * systemd-poweroff.service, ...). Every write to one is Denied: it is the
 * same change as the systemctl reboot/rescue/... verbs, reached another way.
 */
const HOST_STATE_UNIT_PATTERNS: ReadonlyArray<string> = [
  "poweroff",
  "reboot",
  "halt",
  "kexec",
  "shutdown",
  "suspend",
  "hibernate",
  "hybrid-sleep",
  "suspend-then-hibernate",
  "sleep",
  "soft-reboot",
  "rescue",
  "emergency",
  "exit",
  "ctrl-alt-del",
  "final",
  "umount",
  "default",
  "initrd*",
  "factory-reset",
  "systemd-poweroff",
  "systemd-reboot",
  "systemd-halt",
  "systemd-kexec",
  "systemd-suspend",
  "systemd-hibernate",
  "systemd-hybrid-sleep",
  "systemd-suspend-then-hibernate",
  "systemd-soft-reboot",
  "systemd-exit",
];

// The unit types systemd knows; a name without one of these is a service.
const SYSTEMD_UNIT_TYPES: ReadonlyArray<string> = [
  "service",
  "socket",
  "device",
  "mount",
  "automount",
  "swap",
  "target",
  "path",
  "timer",
  "slice",
  "scope",
];

// Unit types a start/stop/restart/reload fans out from: a human decides.
const FAN_OUT_UNIT_TYPES: ReadonlyArray<string> = [
  "target",
  "mount",
  "automount",
  "swap",
];

// Unit types no AI change ever acts on directly.
const UNWRITABLE_UNIT_TYPES: ReadonlyArray<string> = [
  "slice",
  "scope",
  "device",
];

// A unit name (no globs): letters, digits and @ _ . : \ -, not led by "-".
const UNIT_NAME_REGEX: RegExp = /^[A-Za-z0-9@_.:\\][A-Za-z0-9@_.:\\-]{0,255}$/;

// A unit pattern (list-units, journalctl -u): a unit name that may glob.
const UNIT_PATTERN_REGEX: RegExp =
  /^[A-Za-z0-9@_.:\\*?[\]][A-Za-z0-9@_.:\\*?[\]-]{0,255}$/;

const DIGITS_REGEX: RegExp = /^[0-9]+$/;

const LEADING_DIGIT_REGEX: RegExp = /^[0-9]/;

// Every word must be printable ASCII: no look-alike dashes or letters.
const PRINTABLE_ASCII_REGEX: RegExp = /^[\x20-\x7e]*$/;

/*
 * The canonical name of a unit as systemd resolves it: a name without a
 * known type suffix is a service ("nginx" -> nginx.service,
 * "nginx.foo" -> nginx.foo.service).
 */
export function canonicalSystemdUnitName(name: string): string {
  const dot: number = name.lastIndexOf(".");
  const suffix: string = dot >= 0 ? name.slice(dot + 1) : "";

  return SYSTEMD_UNIT_TYPES.includes(suffix) ? name : `${name}.service`;
}

function unitStem(canonicalName: string): string {
  return canonicalName.slice(0, canonicalName.lastIndexOf("."));
}

function unitType(canonicalName: string): string {
  return canonicalName.slice(canonicalName.lastIndexOf(".") + 1);
}

// The first pattern that names this unit stem, case-insensitively.
function matchingUnitPattern(
  patterns: ReadonlyArray<string>,
  stem: string,
): string | undefined {
  const folded: string = stem.toLowerCase();

  return patterns.find((pattern: string): boolean => {
    return globMatchesTarget(pattern.toLowerCase(), folded);
  });
}

// "a" -> a, ["a","b"] -> "a and b", ["a","b","c"] -> "a, b and c".
function joinWords(words: ReadonlyArray<string>): string {
  if (words.length <= 1) {
    return words[0] || "";
  }

  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/*
 * ---------------------------------------------------------------------------
 * What each program allows, appended to every refusal so the model learns
 * what it CAN run, not just what it cannot.
 * ---------------------------------------------------------------------------
 */

const SYSTEMCTL_ALLOWED: string =
  "systemctl reads with status, is-active, is-failed, is-enabled, is-system-running, list-units, list-unit-files, list-timers, list-sockets, list-jobs, list-dependencies and show UNIT -p PROPERTY, and changes units with restart, start, reload, try-restart, reload-or-restart, reset-failed and stop (flags: --no-pager, -l, -a, -q, -n N, -o short|cat|json, --plain, --no-legend, --failed, --state=S, --type=T, --reverse, --value)";

const JOURNALCTL_ALLOWED: string = `journalctl reads with -u UNIT, -t IDENTIFIER, -p PRIORITY, -g REGEX, -k, -b [BOOT], -S/--since and -U/--until TIME, -o short|short-iso|short-precise|short-monotonic|cat|json|with-unit, -r, -x, -q, --utc, --no-hostname and --no-pager, bounded by -n N (at most ${MAX_JOURNALCTL_LINES}) or --since; --list-boots and --disk-usage work too, and --vacuum-size=, --vacuum-time= and --vacuum-files= remove archived journal files (a change that needs approval)`;

const DF_ALLOWED: string =
  "df takes -h, -H, -i, -k, -T, -P, -a, -l, --total, -t TYPE, -x TYPE and absolute paths";

const FREE_ALLOWED: string =
  "free takes -b, -k, -m, -g, -h, -w, -t and --si and runs once (-s and -c would repeat until killed)";

const UPTIME_ALLOWED: string = "uptime takes -p and -s";

const PS_ALLOWED: string =
  "ps takes BSD options a, u, x, w, f and o FORMAT (ps aux, ps axo pid,comm), UNIX options -e, -A, -f, -F, -l, -H, -L, -T, -w, -o FORMAT, -p PID, -u USER and -C COMMAND, and --sort KEY, --no-headers and --forest";

const TOP_ALLOWED: string =
  "top runs once in batch mode — top -b -n 1 — optionally with -o FIELD, -c, -w N and -H";

const SS_ALLOWED: string =
  "ss takes -t, -u, -l, -n, -p, -a, -s, -x, -4, -6, -e, -i, -m, -o, -r and -H, plus a filter expression (state established, dport = :443, ...)";

const IP_ALLOWED: string =
  "ip takes -br, -s, -d, -j, -p, -4 and -6, then one of addr, link, route, neigh or rule followed by show, list, ls or nothing (with optional filters such as dev eth0), or route get ADDRESS";

const DMESG_ALLOWED: string = "dmesg takes -T, -t, -k, -x and -l LEVELS";

const LSBLK_ALLOWED: string =
  "lsblk takes -f, -o COLUMNS, -b, -p, -J, -d, -a, -l, -n and /dev device paths";

const CAT_ALLOWED: string = `cat takes no flags and reads only ${joinWords(
  HOST_READABLE_FILES,
)}`;

const UNAME_ALLOWED: string = "uname takes -a, -r, -s, -m, -n, -v and -o";

const HOSTNAMECTL_ALLOWED: string =
  "hostnamectl runs as `hostnamectl` or `hostnamectl status`, with no flags";

const TIMEDATECTL_ALLOWED: string =
  "timedatectl runs as `timedatectl`, `timedatectl status`, `timedatectl show` or `timedatectl timesync-status`, with no flags";

const KILL_ALLOWED: string =
  "kill takes at most one signal (-TERM, -15, -HUP, -INT, -KILL, -9 or -s NAME; TERM when omitted) and then one or more pids from 2 up";

/*
 * ---------------------------------------------------------------------------
 * A getopt_long reader, shared by the programs that parse with it.
 * ---------------------------------------------------------------------------
 */

enum FlagArity {
  // A switch: `-l`, `--no-pager`. `--flag=value` is an error to the program.
  None = "None",
  // Always takes a value: attached (`-uNAME`, `--unit=NAME`) or the next word.
  Required = "Required",
  /*
   * Takes an attached value; takes the NEXT word only when takesNextWord
   * says the program would (journalctl -n/-b, top -w).
   */
  Optional = "Optional",
}

interface FlagSpec {
  // Every spelling: ["-n", "--lines"].
  spellings: ReadonlyArray<string>;
  // What the flag is called in per-command tables: "lines".
  key: string;
  arity: FlagArity;
  takesNextWord?: ((word: string) => boolean) | undefined;
  // Why a value is refused ("must be ..."), or null when it is fine.
  checkValue?: ((value: string) => string | null) | undefined;
  // May be given more than once (journalctl -u a -u b). Switches always may.
  repeatable?: boolean | undefined;
  // A value may start with "-" (a relative time, a boot offset, a sort key).
  valueMayStartWithDash?: boolean | undefined;
}

interface DeniedFlag {
  spellings: ReadonlyArray<string>;
  // Why it is never allowed.
  reason: string;
}

interface FlagGrammar {
  program: string;
  flags: ReadonlyArray<FlagSpec>;
  denied: ReadonlyArray<DeniedFlag>;
  // What the program allows, appended to every flag refusal.
  allowed: string;
}

interface ParsedFlag {
  key: string;
  // The spelling as written: "-n", "--lines".
  spelling: string;
  // The value, or null for a switch or an Optional flag given none.
  value: string | null;
}

interface ParsedArgs {
  positionals: Array<string>;
  flags: Array<ParsedFlag>;
  // Why the words cannot run, or null.
  problem: string | null;
}

function findFlag(
  grammar: FlagGrammar,
  spelling: string,
): FlagSpec | undefined {
  return grammar.flags.find((flag: FlagSpec): boolean => {
    return flag.spellings.includes(spelling);
  });
}

function findFlagByKey(
  grammar: FlagGrammar,
  key: string,
): FlagSpec | undefined {
  return grammar.flags.find((flag: FlagSpec): boolean => {
    return flag.key === key;
  });
}

function findDeniedFlag(
  grammar: FlagGrammar,
  spelling: string,
): DeniedFlag | undefined {
  return grammar.denied.find((flag: DeniedFlag): boolean => {
    return flag.spellings.includes(spelling);
  });
}

// ` (in "-rf")` when the flag was read out of a cluster or an `=` form.
function whereInToken(token: string, spelling: string): string {
  return token === spelling ? "" : ` (in "${token}")`;
}

function describeFlagProblem(
  grammar: FlagGrammar,
  spelling: string,
  token: string,
): string {
  const denied: DeniedFlag | undefined = findDeniedFlag(grammar, spelling);
  const where: string = whereInToken(token, spelling);

  if (denied) {
    return `${grammar.program} ${spelling}${where} is never allowed: ${denied.reason}; ${grammar.allowed}`;
  }

  const abbreviation: string = spelling.startsWith("--")
    ? " (long flags must be written in full — an abbreviation is refused)"
    : "";

  return `${spelling}${where} is not a ${grammar.program} flag this policy allows${abbreviation}; ${grammar.allowed}`;
}

/*
 * Read args (the program already removed) the way getopt_long would, then
 * check every flag's value and repetition. The first problem wins.
 */
function parseGetoptArgs(
  args: Array<string>,
  grammar: FlagGrammar,
): ParsedArgs {
  const positionals: Array<string> = [];
  const flags: Array<ParsedFlag> = [];
  let afterDoubleDash: boolean = false;

  const fail: (problem: string) => ParsedArgs = (
    problem: string,
  ): ParsedArgs => {
    return { positionals, flags, problem };
  };

  for (let i: number = 0; i < args.length; i++) {
    const token: string = args[i] as string;

    if (afterDoubleDash || token === "-" || !token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (token.startsWith("--")) {
      const eq: number = token.indexOf("=");
      const spelling: string = eq >= 0 ? token.slice(0, eq) : token;
      const spec: FlagSpec | undefined = findFlag(grammar, spelling);

      if (!spec || findDeniedFlag(grammar, spelling)) {
        return fail(describeFlagProblem(grammar, spelling, token));
      }

      if (spec.arity === FlagArity.None) {
        if (eq >= 0) {
          return fail(
            `${spelling} takes no value (in "${token}"); ${grammar.allowed}`,
          );
        }

        flags.push({ key: spec.key, spelling, value: null });
        continue;
      }

      if (eq >= 0) {
        flags.push({ key: spec.key, spelling, value: token.slice(eq + 1) });
        continue;
      }

      const next: string | undefined = args[i + 1];

      if (spec.arity === FlagArity.Required) {
        if (next === undefined) {
          return fail(`${spelling} needs a value; ${grammar.allowed}`);
        }

        flags.push({ key: spec.key, spelling, value: next });
        i++;
        continue;
      }

      if (
        next !== undefined &&
        spec.takesNextWord !== undefined &&
        spec.takesNextWord(next)
      ) {
        flags.push({ key: spec.key, spelling, value: next });
        i++;
      } else {
        flags.push({ key: spec.key, spelling, value: null });
      }
      continue;
    }

    // "-abc": a cluster of short flags, read letter by letter like getopt.
    let rest: string = token.slice(1);

    while (rest.length > 0) {
      const spelling: string = `-${rest.charAt(0)}`;
      const spec: FlagSpec | undefined = findFlag(grammar, spelling);

      if (!spec || findDeniedFlag(grammar, spelling)) {
        return fail(describeFlagProblem(grammar, spelling, token));
      }

      if (spec.arity === FlagArity.None) {
        flags.push({ key: spec.key, spelling, value: null });
        rest = rest.slice(1);
        continue;
      }

      // getopt: everything after the letter is the value — "=" included.
      const attached: string = rest.slice(1);

      if (attached.length > 0) {
        flags.push({ key: spec.key, spelling, value: attached });
        break;
      }

      const next: string | undefined = args[i + 1];

      if (spec.arity === FlagArity.Required) {
        if (next === undefined) {
          return fail(`${spelling} needs a value; ${grammar.allowed}`);
        }

        flags.push({ key: spec.key, spelling, value: next });
        i++;
        break;
      }

      if (
        next !== undefined &&
        spec.takesNextWord !== undefined &&
        spec.takesNextWord(next)
      ) {
        flags.push({ key: spec.key, spelling, value: next });
        i++;
      } else {
        flags.push({ key: spec.key, spelling, value: null });
      }
      break;
    }
  }

  const valueProblem: string | null = checkParsedFlags(flags, grammar);

  return valueProblem
    ? fail(valueProblem)
    : { positionals, flags, problem: null };
}

function checkParsedFlags(
  flags: Array<ParsedFlag>,
  grammar: FlagGrammar,
): string | null {
  const seen: Array<string> = [];

  for (const flag of flags) {
    const spec: FlagSpec | undefined = findFlagByKey(grammar, flag.key);

    if (!spec) {
      return `${flag.spelling} is not a ${grammar.program} flag this policy allows; ${grammar.allowed}`;
    }

    if (spec.arity !== FlagArity.None) {
      if (seen.includes(flag.key) && spec.repeatable !== true) {
        return `give ${spec.spellings.join("/")} only once; ${grammar.allowed}`;
      }

      seen.push(flag.key);
    }

    if (flag.value === null) {
      continue;
    }

    if (flag.value.startsWith("-") && spec.valueMayStartWithDash !== true) {
      return `the value of ${flag.spelling} ("${flag.value}") starts with "-": a word that looks like a flag is never taken as a value; ${grammar.allowed}`;
    }

    const problem: string | null = spec.checkValue
      ? spec.checkValue(flag.value)
      : null;

    if (problem) {
      return `${flag.spelling} ${problem}; ${grammar.allowed}`;
    }
  }

  return null;
}

function hasFlag(parsed: ParsedArgs, key: string): boolean {
  return parsed.flags.some((flag: ParsedFlag): boolean => {
    return flag.key === key;
  });
}

// A switch: `-l`/`--full`.
function switchFlag(key: string, ...spellings: Array<string>): FlagSpec {
  return { spellings, key, arity: FlagArity.None };
}

/*
 * ---------------------------------------------------------------------------
 * Value checks. Each returns why the value is refused, or null.
 * ---------------------------------------------------------------------------
 */

function checkWholeNumber(
  min: number,
  max: number,
): (value: string) => string | null {
  return (value: string): string | null => {
    if (!DIGITS_REGEX.test(value) || value.length > 7) {
      return `must be a whole number from ${min} to ${max}, not "${value}"`;
    }

    const parsed: number = parseInt(value, 10);

    return parsed < min || parsed > max
      ? `must be a whole number from ${min} to ${max}, not "${value}"`
      : null;
  };
}

function checkOneOf(
  allowed: ReadonlyArray<string>,
): (value: string) => string | null {
  return (value: string): string | null => {
    return allowed.includes(value)
      ? null
      : `must be one of ${allowed.join(", ")}, not "${value}"`;
  };
}

/*
 * A comma-separated list whose every item passes `itemRegex` (and, when
 * given, is one of `allowedItems`).
 */
function checkList(
  itemRegex: RegExp,
  description: string,
  allowedItems?: ReadonlyArray<string>,
): (value: string) => string | null {
  return (value: string): string | null => {
    const items: Array<string> = value.split(",");

    if (value.length > 512 || items.length > 32) {
      return `is too long a list ("${value.slice(0, 64)}...")`;
    }

    for (const item of items) {
      if (!itemRegex.test(item)) {
        return `must be ${description}, not "${value}"`;
      }

      if (allowedItems && !allowedItems.includes(item)) {
        return `may only name ${allowedItems.join(", ")} — "${item}" is not one of them`;
      }
    }

    return null;
  };
}

function checkPattern(
  regex: RegExp,
  description: string,
): (value: string) => string | null {
  return (value: string): string | null => {
    return regex.test(value) ? null : `must be ${description}, not "${value}"`;
  };
}

/*
 * ---------------------------------------------------------------------------
 * systemctl
 * ---------------------------------------------------------------------------
 */

const SYSTEMCTL_OUTPUT_FORMATS: ReadonlyArray<string> = [
  "short",
  "cat",
  "json",
];

const SYSTEMCTL_GRAMMAR: FlagGrammar = {
  program: "systemctl",
  allowed: SYSTEMCTL_ALLOWED,
  flags: [
    switchFlag("no-pager", "--no-pager"),
    switchFlag("full", "-l", "--full"),
    switchFlag("all", "-a", "--all"),
    switchFlag("quiet", "-q", "--quiet"),
    switchFlag("plain", "--plain"),
    switchFlag("no-legend", "--no-legend"),
    switchFlag("failed", "--failed"),
    switchFlag("reverse", "--reverse"),
    switchFlag("value", "--value"),
    {
      spellings: ["-n", "--lines"],
      key: "lines",
      arity: FlagArity.Required,
      checkValue: checkWholeNumber(0, MAX_SYSTEMCTL_STATUS_LINES),
    },
    {
      spellings: ["-o", "--output"],
      key: "output",
      arity: FlagArity.Required,
      checkValue: checkOneOf(SYSTEMCTL_OUTPUT_FORMATS),
    },
    {
      spellings: ["--state"],
      key: "state",
      arity: FlagArity.Required,
      repeatable: true,
      checkValue: checkList(
        /^[a-z][a-z-]{0,31}$/,
        "unit states such as failed,running",
      ),
    },
    {
      spellings: ["-t", "--type"],
      key: "type",
      arity: FlagArity.Required,
      repeatable: true,
      checkValue: checkList(
        /^[a-z][a-z-]{0,31}$/,
        "unit types such as service,timer",
      ),
    },
    {
      spellings: ["-p", "--property"],
      key: "property",
      arity: FlagArity.Required,
      repeatable: true,
      checkValue: checkList(
        /^[A-Za-z]{1,64}$/,
        "property names",
        SYSTEMCTL_SHOW_PROPERTIES,
      ),
    },
    {
      spellings: ["-P"],
      key: "property-value",
      arity: FlagArity.Required,
      repeatable: true,
      checkValue: checkList(
        /^[A-Za-z]{1,64}$/,
        "property names",
        SYSTEMCTL_SHOW_PROPERTIES,
      ),
    },
  ],
  denied: [
    {
      spellings: ["-H", "--host"],
      reason: "it runs the command on another machine over SSH",
    },
    {
      spellings: ["-M", "--machine"],
      reason: "it talks to a container's or another machine's service manager",
    },
    {
      spellings: ["-C", "--capsule"],
      reason: "it talks to a capsule's service manager",
    },
    {
      spellings: ["--root", "--image", "--image-policy"],
      reason: "it operates on another root directory or a disk image",
    },
    {
      spellings: ["--user", "--global"],
      reason:
        "it acts on user service managers; the agent acts on the host's system manager only",
    },
    {
      spellings: ["--runtime"],
      reason: "it makes a unit-file change for the current boot",
    },
    {
      spellings: ["-f", "--force"],
      reason: "it overrides systemd's safety checks",
    },
    {
      spellings: ["-i", "--ignore-inhibitors", "--check-inhibitors"],
      reason: "it overrides shutdown and sleep inhibitors",
    },
    {
      spellings: ["--job-mode"],
      reason:
        "it changes how queued jobs are replaced (isolate, flush and fail can stop other units)",
    },
    {
      spellings: ["--wait"],
      reason: "it blocks until the unit exits, so the command would hang",
    },
    {
      spellings: ["-s", "--signal", "--kill-whom", "--kill-value"],
      reason: "it picks a signal for systemctl kill, which is not allowed",
    },
    {
      spellings: ["--now"],
      reason: "it pairs enable/disable with a start/stop",
    },
    {
      spellings: [
        "--firmware-setup",
        "--boot-loader-menu",
        "--boot-loader-entry",
        "--reboot-argument",
        "--when",
      ],
      reason: "it configures a reboot or power-off",
    },
  ],
};

// How many unit words a read verb takes.
enum UnitOperands {
  // No words (list-jobs, is-system-running).
  None = "None",
  // Any number of unit names, none included (status).
  AnyUnits = "AnyUnits",
  // At least one unit name (is-active, show).
  SomeUnits = "SomeUnits",
  // At most one unit name (list-dependencies).
  AtMostOneUnit = "AtMostOneUnit",
  // Any number of unit patterns that may glob (list-units).
  Patterns = "Patterns",
}

interface SystemctlReadVerb {
  // The flag keys this verb takes.
  flags: ReadonlyArray<string>;
  operands: UnitOperands;
  // What it shows, for the reason.
  shows: string;
}

const LIST_FLAGS: ReadonlyArray<string> = [
  "no-pager",
  "full",
  "all",
  "plain",
  "no-legend",
  "output",
  "quiet",
];

const SYSTEMCTL_READ_VERBS: Readonly<Record<string, SystemctlReadVerb>> = {
  status: {
    flags: ["no-pager", "full", "all", "lines", "output", "quiet"],
    operands: UnitOperands.AnyUnits,
    shows:
      "the status and recent log lines of units (or of the whole service manager)",
  },
  "is-active": {
    flags: ["no-pager", "quiet"],
    operands: UnitOperands.SomeUnits,
    shows: "whether units are active",
  },
  "is-failed": {
    flags: ["no-pager", "quiet"],
    operands: UnitOperands.SomeUnits,
    shows: "whether units have failed",
  },
  "is-enabled": {
    flags: ["no-pager", "quiet", "full"],
    operands: UnitOperands.SomeUnits,
    shows: "whether units start at boot",
  },
  "is-system-running": {
    flags: ["no-pager", "quiet"],
    operands: UnitOperands.None,
    shows: "the overall state of the service manager",
  },
  "list-units": {
    flags: [...LIST_FLAGS, "failed", "state", "type"],
    operands: UnitOperands.Patterns,
    shows: "the loaded units and their states",
  },
  "list-unit-files": {
    flags: [...LIST_FLAGS, "state", "type"],
    operands: UnitOperands.Patterns,
    shows: "the installed unit files and whether they are enabled",
  },
  "list-timers": {
    flags: [...LIST_FLAGS, "state"],
    operands: UnitOperands.Patterns,
    shows: "the timers and when they fire next",
  },
  "list-sockets": {
    flags: [...LIST_FLAGS, "state"],
    operands: UnitOperands.Patterns,
    shows: "the listening socket units",
  },
  "list-jobs": {
    flags: LIST_FLAGS,
    operands: UnitOperands.None,
    shows: "the queued jobs",
  },
  "list-dependencies": {
    flags: ["no-pager", "full", "all", "plain", "no-legend", "reverse"],
    operands: UnitOperands.AtMostOneUnit,
    shows: "a unit's dependency tree",
  },
  show: {
    flags: ["no-pager", "full", "all", "property", "property-value", "value"],
    operands: UnitOperands.SomeUnits,
    shows: "the allowed properties of units",
  },
};

// The changes, and how each reads on an approval card.
const SYSTEMCTL_WRITE_VERBS: Readonly<Record<string, string>> = {
  restart: "restarts",
  start: "starts",
  reload: "reloads the configuration of",
  "try-restart": "restarts (if it is running)",
  "reload-or-restart": "reloads (or else restarts)",
  "reset-failed": "clears the failed state of",
  stop: "stops",
};

// The flags a change may carry.
const SYSTEMCTL_WRITE_FLAGS: ReadonlyArray<string> = ["no-pager", "quiet"];

const PERSISTENT_CONFIG_REASON: string =
  "it changes which units start at boot or how they are configured, and persistent configuration is left to a human";

const HOST_STATE_REASON: string =
  "it powers off, reboots, suspends or changes the run state of the whole host";

const ENVIRONMENT_REASON: string =
  "the service manager's environment can hold secrets";

const SYSTEMCTL_DENIED_VERBS: Readonly<Record<string, string>> = {
  enable: PERSISTENT_CONFIG_REASON,
  disable: PERSISTENT_CONFIG_REASON,
  reenable: PERSISTENT_CONFIG_REASON,
  preset: PERSISTENT_CONFIG_REASON,
  "preset-all": PERSISTENT_CONFIG_REASON,
  mask: PERSISTENT_CONFIG_REASON,
  unmask: PERSISTENT_CONFIG_REASON,
  link: PERSISTENT_CONFIG_REASON,
  revert: PERSISTENT_CONFIG_REASON,
  "add-wants": PERSISTENT_CONFIG_REASON,
  "add-requires": PERSISTENT_CONFIG_REASON,
  "set-default": PERSISTENT_CONFIG_REASON,
  edit: "it opens an editor and writes a drop-in that persists",
  cat: "unit files can hold secrets (Environment=, credentials); read state with systemctl show UNIT -p PROPERTY instead",
  "show-environment": ENVIRONMENT_REASON,
  "set-environment": ENVIRONMENT_REASON,
  "unset-environment": ENVIRONMENT_REASON,
  "import-environment": ENVIRONMENT_REASON,
  "daemon-reload": "it reloads the service manager itself",
  "daemon-reexec": "it re-executes the service manager itself",
  isolate: "it stops every unit the target does not need",
  kill: "it signals every process of a unit; use systemctl restart or stop",
  "set-property": "it changes a unit's resource controls persistently",
  clean: "it deletes a unit's state, cache, log or runtime directories",
  freeze: "it freezes every process of a unit",
  thaw: "it thaws a frozen unit's processes",
  bind: "it mounts paths into a unit's namespace",
  "mount-image": "it mounts an image into a unit's namespace",
  cancel: "it cancels queued jobs",
  "log-level": "it changes the service manager's logging",
  "log-target": "it changes the service manager's logging",
  "service-log-level": "it changes a service's logging",
  "service-log-target": "it changes a service's logging",
  "service-watchdogs": "it changes the service manager's watchdogs",
  poweroff: HOST_STATE_REASON,
  reboot: HOST_STATE_REASON,
  halt: HOST_STATE_REASON,
  kexec: HOST_STATE_REASON,
  "soft-reboot": HOST_STATE_REASON,
  suspend: HOST_STATE_REASON,
  hibernate: HOST_STATE_REASON,
  "hybrid-sleep": HOST_STATE_REASON,
  "suspend-then-hibernate": HOST_STATE_REASON,
  sleep: HOST_STATE_REASON,
  "switch-root": HOST_STATE_REASON,
  default: HOST_STATE_REASON,
  rescue: HOST_STATE_REASON,
  emergency: HOST_STATE_REASON,
  exit: HOST_STATE_REASON,
};

function hasOwn(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function describeUnitProblem(operand: string, verb: string): string {
  return `"${operand}" is not a unit name systemctl ${verb} can take here: unit names use letters, digits and @ _ . : \\ - only, and globs (* ? [ ]) belong to list-units patterns; ${SYSTEMCTL_ALLOWED}`;
}

function evaluateSystemctl(argv: Array<string>): ResourceCommandPolicyResult {
  const parsed: ParsedArgs = parseGetoptArgs(argv.slice(1), SYSTEMCTL_GRAMMAR);

  if (parsed.problem) {
    return deniedResult(argv, parsed.problem);
  }

  // No command word is list-units, as systemctl reads it.
  const verb: string = parsed.positionals[0] ?? "list-units";
  const operands: Array<string> = parsed.positionals.slice(1);

  if (hasOwn(SYSTEMCTL_DENIED_VERBS, verb)) {
    return deniedResult(
      argv,
      `systemctl ${verb} is never allowed: ${SYSTEMCTL_DENIED_VERBS[verb]}; ${SYSTEMCTL_ALLOWED}`,
    );
  }

  const isWrite: boolean = hasOwn(SYSTEMCTL_WRITE_VERBS, verb);
  const readVerb: SystemctlReadVerb | undefined = hasOwn(
    SYSTEMCTL_READ_VERBS,
    verb,
  )
    ? SYSTEMCTL_READ_VERBS[verb]
    : undefined;

  if (!isWrite && !readVerb) {
    return deniedResult(
      argv,
      `"${verb}" is not a systemctl command this policy allows (commands are lowercase and written in full); ${SYSTEMCTL_ALLOWED}`,
    );
  }

  const allowedFlags: ReadonlyArray<string> = readVerb
    ? readVerb.flags
    : SYSTEMCTL_WRITE_FLAGS;

  const misplaced: ParsedFlag | undefined = parsed.flags.find(
    (flag: ParsedFlag): boolean => {
      return !allowedFlags.includes(flag.key);
    },
  );

  if (misplaced) {
    return deniedResult(
      argv,
      `${misplaced.spelling} does not apply to systemctl ${verb}${
        isWrite ? " (a change takes only --no-pager and --quiet)" : ""
      }; ${SYSTEMCTL_ALLOWED}`,
    );
  }

  if (readVerb) {
    return evaluateSystemctlRead(argv, verb, readVerb, operands, parsed);
  }

  return evaluateSystemctlWrite(argv, verb, operands);
}

function evaluateSystemctlRead(
  argv: Array<string>,
  verb: string,
  readVerb: SystemctlReadVerb,
  operands: Array<string>,
  parsed: ParsedArgs,
): ResourceCommandPolicyResult {
  switch (readVerb.operands) {
    case UnitOperands.None:
      if (operands.length > 0) {
        return deniedResult(
          argv,
          `systemctl ${verb} takes no unit names; ${SYSTEMCTL_ALLOWED}`,
        );
      }
      break;
    case UnitOperands.SomeUnits:
      if (operands.length === 0) {
        return deniedResult(
          argv,
          `systemctl ${verb} needs at least one unit name: systemctl ${verb} UNIT; ${SYSTEMCTL_ALLOWED}`,
        );
      }
      break;
    case UnitOperands.AtMostOneUnit:
      if (operands.length > 1) {
        return deniedResult(
          argv,
          `systemctl ${verb} takes at most one unit name; ${SYSTEMCTL_ALLOWED}`,
        );
      }
      break;
    default:
      break;
  }

  const operandRegex: RegExp =
    readVerb.operands === UnitOperands.Patterns
      ? UNIT_PATTERN_REGEX
      : UNIT_NAME_REGEX;

  const badOperand: string | undefined = operands.find(
    (operand: string): boolean => {
      return !operandRegex.test(operand);
    },
  );

  if (badOperand !== undefined) {
    return deniedResult(argv, describeUnitProblem(badOperand, verb));
  }

  if (
    verb === "show" &&
    !hasFlag(parsed, "property") &&
    !hasFlag(parsed, "property-value")
  ) {
    return deniedResult(
      argv,
      `systemctl show must name the properties it prints with -p (for example -p ActiveState,SubState,Result,NRestarts): without -p it prints every property, Environment included, which can hold secrets. Allowed properties: ${SYSTEMCTL_SHOW_PROPERTIES.join(
        ", ",
      )}`,
    );
  }

  return {
    tier: ResourceCommandTier.Read,
    reason: `systemctl ${verb} shows ${readVerb.shows}; it changes nothing`,
    program: argv[0] || "",
    args: argv.slice(1),
    verb,
    displayCommand: renderResourceDisplayCommand(argv),
    targets: [],
  };
}

function evaluateSystemctlWrite(
  argv: Array<string>,
  verb: string,
  operands: Array<string>,
): ResourceCommandPolicyResult {
  const action: string = SYSTEMCTL_WRITE_VERBS[verb] || verb;

  if (operands.length === 0) {
    if (verb === "reset-failed") {
      return {
        tier: ResourceCommandTier.RiskyWrite,
        reason:
          "systemctl reset-failed with no unit clears the failed state of EVERY failed unit (name one unit to make it a safe change)",
        program: argv[0] || "",
        args: argv.slice(1),
        verb,
        displayCommand: renderResourceDisplayCommand(argv),
        targets: [],
      };
    }

    return deniedResult(
      argv,
      `systemctl ${verb} needs the unit it acts on: systemctl ${verb} UNIT; ${SYSTEMCTL_ALLOWED}`,
    );
  }

  const targets: Array<string> = [];
  let humanReason: string | null = null;

  for (const operand of operands) {
    if (!UNIT_NAME_REGEX.test(operand)) {
      return deniedResult(argv, describeUnitProblem(operand, verb));
    }

    const unit: string = canonicalSystemdUnitName(operand);
    const stem: string = unitStem(unit);
    const type: string = unitType(unit);

    if (!stem || stem.startsWith(".") || stem.endsWith("@")) {
      return deniedResult(
        argv,
        `systemctl ${verb} ${operand} does not name one unit instance (${unit}); name the instance, as in getty@tty1.service; ${SYSTEMCTL_ALLOWED}`,
      );
    }

    const stateUnit: string | undefined = matchingUnitPattern(
      HOST_STATE_UNIT_PATTERNS,
      stem,
    );

    if (stateUnit !== undefined) {
      return deniedResult(
        argv,
        `systemctl ${verb} ${unit} is never allowed: it is a power or run-state unit (${stateUnit}), and ${HOST_STATE_REASON}; ${SYSTEMCTL_ALLOWED}`,
      );
    }

    if (verb !== "reset-failed") {
      if (UNWRITABLE_UNIT_TYPES.includes(type)) {
        return deniedResult(
          argv,
          `systemctl ${verb} ${unit} is never allowed: a ${type} unit groups other processes or hardware, so the change would reach everything under it — act on the one service instead; ${SYSTEMCTL_ALLOWED}`,
        );
      }

      if (humanReason === null && FAN_OUT_UNIT_TYPES.includes(type)) {
        humanReason = `${unit} is a ${type} unit, so the change reaches ${
          type === "target"
            ? "every unit the target pulls in"
            : "a filesystem or swap area and everything using it"
        }`;
      }
    }

    const protectedPattern: string | undefined = matchingUnitPattern(
      PROTECTED_HOST_UNIT_PATTERNS,
      stem,
    );

    if (humanReason === null && protectedPattern !== undefined) {
      humanReason = `${unit} is a protected unit (${protectedPattern}): remote access, the service manager, the network, the firewall and the container runtimes are only ever changed with a human's approval`;
    }

    if (!targets.includes(unit)) {
      targets.push(unit);
    }
  }

  const unitList: string = joinWords(targets);
  const several: boolean = targets.length > 1;

  const base: Omit<ResourceCommandPolicyResult, "tier" | "reason"> = {
    program: argv[0] || "",
    args: argv.slice(1),
    verb,
    displayCommand: renderResourceDisplayCommand(argv),
    targets,
  };

  if (humanReason !== null) {
    return {
      ...base,
      tier: ResourceCommandTier.RiskyWrite,
      reason: `${action} ${unitList}; ${humanReason}`,
      requiresHuman: true,
    };
  }

  if (several) {
    return {
      ...base,
      tier: ResourceCommandTier.RiskyWrite,
      reason: `${action} ${targets.length} units (${unitList}); a change to more than one unit needs approval`,
    };
  }

  if (verb === "stop") {
    return {
      ...base,
      tier: ResourceCommandTier.RiskyWrite,
      reason: `stops ${unitList}, which stays down until someone starts it again`,
    };
  }

  return {
    ...base,
    tier: ResourceCommandTier.SafeWrite,
    reason: `${action} one unit (${unitList}): a reversible change to that unit only`,
  };
}

/*
 * ---------------------------------------------------------------------------
 * journalctl
 * ---------------------------------------------------------------------------
 */

const JOURNALCTL_OUTPUT_FORMATS: ReadonlyArray<string> = [
  "short",
  "short-iso",
  "short-precise",
  "short-monotonic",
  "cat",
  "json",
  "with-unit",
];

const PRIORITY_WORD: string =
  "(?:emerg|alert|crit|err|warning|notice|info|debug|[0-7])";

const PRIORITY_REGEX: RegExp = new RegExp(
  `^${PRIORITY_WORD}(?:\\.\\.${PRIORITY_WORD})?$`,
);

/*
 * A time journalctl reads: "2024-05-01 10:00:00", "yesterday", "-1h",
 * "1 hour ago", "@1714550400", "10:00 UTC". Anything that looks like a flag
 * ("-f", "--follow") is not a time.
 */
const JOURNAL_TIME_REGEX: RegExp = /^(?!-[A-Za-z-])[A-Za-z0-9 :.+@-]{1,64}$/;

// What journalctl -n reads out of the next word (and consumes it for).
const JOURNAL_LINES_WORD_REGEX: RegExp = /^(?:all|\+?[0-9]+)$/;

// A boot: an offset (0, -1, +2), a 32-hex boot id with an optional offset, or all.
const JOURNAL_BOOT_REGEX: RegExp =
  /^(?:all|[+-]?[0-9]{1,6}|[0-9a-fA-F]{32}(?:[+-][0-9]{1,6})?)$/;

const JOURNAL_IDENTIFIER_REGEX: RegExp =
  /^[A-Za-z0-9_.@:/+][A-Za-z0-9_.@:/+-]{0,127}$/;

const JOURNAL_SIZE_REGEX: RegExp = /^[0-9]{1,6}[KMGT]?$/;

const JOURNAL_TIME_SPAN_REGEX: RegExp =
  /^[0-9]{1,6}(?:s|sec|m|min|h|hr|d|day|days|w|week|weeks|M|month|months|y|year|years)?$/;

function checkJournalLines(value: string): string | null {
  if (value === "all") {
    return `must be a number of lines (at most ${MAX_JOURNALCTL_LINES}): "all" is unbounded`;
  }

  return checkWholeNumber(0, MAX_JOURNALCTL_LINES)(value.replace(/^\+/, ""));
}

const JOURNALCTL_GRAMMAR: FlagGrammar = {
  program: "journalctl",
  allowed: JOURNALCTL_ALLOWED,
  flags: [
    {
      spellings: ["-u", "--unit"],
      key: "unit",
      arity: FlagArity.Required,
      repeatable: true,
      checkValue: checkPattern(UNIT_PATTERN_REGEX, "a unit name or pattern"),
    },
    {
      spellings: ["-t", "--identifier"],
      key: "identifier",
      arity: FlagArity.Required,
      repeatable: true,
      checkValue: checkPattern(
        JOURNAL_IDENTIFIER_REGEX,
        "a syslog identifier such as sshd or kernel",
      ),
    },
    {
      spellings: ["-n", "--lines"],
      key: "lines",
      arity: FlagArity.Optional,
      takesNextWord: (word: string): boolean => {
        return JOURNAL_LINES_WORD_REGEX.test(word);
      },
      checkValue: checkJournalLines,
    },
    {
      spellings: ["-S", "--since"],
      key: "since",
      arity: FlagArity.Required,
      valueMayStartWithDash: true,
      checkValue: checkPattern(
        JOURNAL_TIME_REGEX,
        'a time such as "2024-05-01 10:00", "-1h", "yesterday" or "1 hour ago"',
      ),
    },
    {
      spellings: ["-U", "--until"],
      key: "until",
      arity: FlagArity.Required,
      valueMayStartWithDash: true,
      checkValue: checkPattern(
        JOURNAL_TIME_REGEX,
        'a time such as "2024-05-01 10:00", "-1h", "yesterday" or "1 hour ago"',
      ),
    },
    {
      spellings: ["-p", "--priority"],
      key: "priority",
      arity: FlagArity.Required,
      checkValue: checkPattern(
        PRIORITY_REGEX,
        "a priority (emerg, alert, crit, err, warning, notice, info, debug or 0-7) or a range such as err..warning",
      ),
    },
    {
      spellings: ["-g", "--grep"],
      key: "grep",
      arity: FlagArity.Required,
      checkValue: (value: string): string | null => {
        return value.length >= 1 && value.length <= 256
          ? null
          : "must be a pattern of 1 to 256 characters";
      },
    },
    {
      spellings: ["-b", "--boot"],
      key: "boot",
      arity: FlagArity.Optional,
      valueMayStartWithDash: true,
      takesNextWord: (word: string): boolean => {
        return JOURNAL_BOOT_REGEX.test(word);
      },
      checkValue: checkPattern(
        JOURNAL_BOOT_REGEX,
        "a boot offset (0, -1, ...) or a boot id",
      ),
    },
    {
      spellings: ["-o", "--output"],
      key: "output",
      arity: FlagArity.Required,
      checkValue: checkOneOf(JOURNALCTL_OUTPUT_FORMATS),
    },
    switchFlag("dmesg", "-k", "--dmesg"),
    switchFlag("no-pager", "--no-pager"),
    switchFlag("utc", "--utc"),
    switchFlag("reverse", "-r", "--reverse"),
    switchFlag("no-hostname", "--no-hostname"),
    switchFlag("catalog", "-x", "--catalog"),
    switchFlag("quiet", "-q", "--quiet"),
    switchFlag("list-boots", "--list-boots"),
    switchFlag("disk-usage", "--disk-usage"),
    {
      spellings: ["--vacuum-size"],
      key: "vacuum-size",
      arity: FlagArity.Required,
      checkValue: checkPattern(JOURNAL_SIZE_REGEX, "a size such as 500M or 2G"),
    },
    {
      spellings: ["--vacuum-time"],
      key: "vacuum-time",
      arity: FlagArity.Required,
      checkValue: checkPattern(
        JOURNAL_TIME_SPAN_REGEX,
        "a time span such as 7d, 2weeks or 12h",
      ),
    },
    {
      spellings: ["--vacuum-files"],
      key: "vacuum-files",
      arity: FlagArity.Required,
      checkValue: checkWholeNumber(1, 100000),
    },
  ],
  denied: [
    {
      spellings: ["-f", "--follow"],
      reason:
        "it follows the journal forever, so the command would only end at its timeout — bound it with -n N or --since instead",
    },
    {
      spellings: [
        "-D",
        "--directory",
        "--file",
        "-i",
        "--root",
        "--image",
        "--image-policy",
      ],
      reason:
        "it reads journal files from another place than the host's journal",
    },
    {
      spellings: ["-M", "--machine", "--namespace"],
      reason: "it reads another machine's or namespace's journal",
    },
    {
      spellings: [
        "--rotate",
        "--flush",
        "--sync",
        "--relinquish-var",
        "--smart-relinquish-var",
      ],
      reason: "it changes how journald stores the journal",
    },
    {
      spellings: [
        "--setup-keys",
        "--verify",
        "--verify-key",
        "--interval",
        "--force",
      ],
      reason: "it manages Forward Secure Sealing keys",
    },
    {
      spellings: ["--update-catalog"],
      reason: "it rewrites the message catalog",
    },
    {
      spellings: ["--cursor-file"],
      reason: "it writes a cursor file on the host",
    },
  ],
};

const VACUUM_KEYS: ReadonlyArray<string> = [
  "vacuum-size",
  "vacuum-time",
  "vacuum-files",
];

function evaluateJournalctl(argv: Array<string>): ResourceCommandPolicyResult {
  const parsed: ParsedArgs = parseGetoptArgs(argv.slice(1), JOURNALCTL_GRAMMAR);

  if (parsed.problem) {
    return deniedResult(argv, parsed.problem);
  }

  if (parsed.positionals.length > 0) {
    return deniedResult(
      argv,
      `journalctl takes no match words or paths here ("${parsed.positionals[0]}"): filter with -u UNIT, -t IDENTIFIER, -p PRIORITY, -g REGEX, -k or -b; ${JOURNALCTL_ALLOWED}`,
    );
  }

  const base: Omit<ResourceCommandPolicyResult, "tier" | "reason" | "verb"> = {
    program: argv[0] || "",
    args: argv.slice(1),
    displayCommand: renderResourceDisplayCommand(argv),
    targets: [],
  };

  const vacuums: Array<ParsedFlag> = parsed.flags.filter(
    (flag: ParsedFlag): boolean => {
      return VACUUM_KEYS.includes(flag.key);
    },
  );

  if (vacuums.length > 0) {
    const other: ParsedFlag | undefined = parsed.flags.find(
      (flag: ParsedFlag): boolean => {
        return (
          !VACUUM_KEYS.includes(flag.key) &&
          flag.key !== "no-pager" &&
          flag.key !== "quiet"
        );
      },
    );

    if (other) {
      return deniedResult(
        argv,
        `run a journal vacuum on its own (${other.spelling} does not go with it), as in journalctl --vacuum-time=7d; ${JOURNALCTL_ALLOWED}`,
      );
    }

    return {
      ...base,
      tier: ResourceCommandTier.RiskyWrite,
      verb: "vacuum",
      reason: `journalctl ${vacuums
        .map((flag: ParsedFlag): string => {
          return `${flag.spelling}=${flag.value || ""}`;
        })
        .join(
          " ",
        )} permanently deletes archived journal files beyond the limit`,
      targets: ["journal"],
    };
  }

  const bounded: boolean =
    hasFlag(parsed, "lines") ||
    hasFlag(parsed, "since") ||
    hasFlag(parsed, "list-boots") ||
    hasFlag(parsed, "disk-usage");

  if (!bounded) {
    return deniedResult(
      argv,
      `journalctl must be bounded: add -n N (at most ${MAX_JOURNALCTL_LINES} lines) or --since TIME, as in journalctl -u nginx.service -n 200 --no-pager; ${JOURNALCTL_ALLOWED}`,
    );
  }

  let verb: string = "logs";
  let reason: string = "journalctl reads a bounded slice of the journal";

  if (hasFlag(parsed, "list-boots")) {
    verb = "list-boots";
    reason = "journalctl --list-boots lists the recorded boots";
  } else if (hasFlag(parsed, "disk-usage")) {
    verb = "disk-usage";
    reason = "journalctl --disk-usage shows how much disk the journal uses";
  }

  return { ...base, tier: ResourceCommandTier.Read, verb, reason };
}

/*
 * ---------------------------------------------------------------------------
 * The one-shot getopt programs: df, free, uptime, uname, dmesg, lsblk, ss, top
 * ---------------------------------------------------------------------------
 */

const FILESYSTEM_TYPE_REGEX: RegExp = /^[a-z0-9][a-z0-9_.-]{0,31}$/;

/*
 * An absolute path df may stat (hasDotDotStep refuses a ".." step). Steps
 * are separated by exactly one "/", so a long word that is not a path can
 * never make the regex backtrack.
 */
const ABSOLUTE_PATH_REGEX: RegExp =
  /^\/(?:[A-Za-z0-9_@:+,=%.-]+(?:\/[A-Za-z0-9_@:+,=%.-]+){0,31}\/?)?$/;

const DEVICE_PATH_REGEX: RegExp =
  /^\/dev\/[A-Za-z0-9_:@+.-]+(?:\/[A-Za-z0-9_:@+.-]+){0,8}$/;

function hasDotDotStep(path: string): boolean {
  return path.split("/").some((step: string): boolean => {
    return step === "..";
  });
}

const DF_GRAMMAR: FlagGrammar = {
  program: "df",
  allowed: DF_ALLOWED,
  flags: [
    switchFlag("human", "-h", "--human-readable"),
    switchFlag("si", "-H", "--si"),
    switchFlag("inodes", "-i", "--inodes"),
    switchFlag("kilobytes", "-k"),
    switchFlag("print-type", "-T", "--print-type"),
    switchFlag("portability", "-P", "--portability"),
    switchFlag("all", "-a", "--all"),
    switchFlag("local", "-l", "--local"),
    switchFlag("total", "--total"),
    {
      spellings: ["-t", "--type"],
      key: "type",
      arity: FlagArity.Required,
      repeatable: true,
      checkValue: checkPattern(
        FILESYSTEM_TYPE_REGEX,
        "a filesystem type such as ext4",
      ),
    },
    {
      spellings: ["-x", "--exclude-type"],
      key: "exclude-type",
      arity: FlagArity.Required,
      repeatable: true,
      checkValue: checkPattern(
        FILESYSTEM_TYPE_REGEX,
        "a filesystem type such as tmpfs",
      ),
    },
  ],
  denied: [],
};

const FREE_GRAMMAR: FlagGrammar = {
  program: "free",
  allowed: FREE_ALLOWED,
  flags: [
    switchFlag("bytes", "-b", "--bytes"),
    switchFlag("kibi", "-k", "--kibi"),
    switchFlag("mebi", "-m", "--mebi"),
    switchFlag("gibi", "-g", "--gibi"),
    switchFlag("human", "-h", "--human"),
    switchFlag("wide", "-w", "--wide"),
    switchFlag("total", "-t", "--total"),
    switchFlag("si", "--si"),
  ],
  denied: [
    {
      spellings: ["-s", "--seconds", "-c", "--count"],
      reason:
        "it repeats the report, so the command would run until its timeout",
    },
  ],
};

const UPTIME_GRAMMAR: FlagGrammar = {
  program: "uptime",
  allowed: UPTIME_ALLOWED,
  flags: [
    switchFlag("pretty", "-p", "--pretty"),
    switchFlag("since", "-s", "--since"),
  ],
  denied: [],
};

const UNAME_GRAMMAR: FlagGrammar = {
  program: "uname",
  allowed: UNAME_ALLOWED,
  flags: [
    switchFlag("all", "-a", "--all"),
    switchFlag("kernel-release", "-r", "--kernel-release"),
    switchFlag("kernel-name", "-s", "--kernel-name"),
    switchFlag("machine", "-m", "--machine"),
    switchFlag("nodename", "-n", "--nodename"),
    switchFlag("kernel-version", "-v", "--kernel-version"),
    switchFlag("operating-system", "-o", "--operating-system"),
  ],
  denied: [],
};

const DMESG_LEVEL_REGEX: RegExp =
  /^\+?(?:emerg|alert|crit|err|warn|notice|info|debug)\+?$/;

const DMESG_GRAMMAR: FlagGrammar = {
  program: "dmesg",
  allowed: DMESG_ALLOWED,
  flags: [
    switchFlag("ctime", "-T", "--ctime"),
    switchFlag("notime", "-t", "--notime"),
    switchFlag("kernel", "-k", "--kernel"),
    switchFlag("decode", "-x", "--decode"),
    {
      spellings: ["-l", "--level"],
      key: "level",
      arity: FlagArity.Required,
      checkValue: checkList(
        DMESG_LEVEL_REGEX,
        "levels such as err,warn (emerg, alert, crit, err, warn, notice, info, debug)",
      ),
    },
  ],
  denied: [
    {
      spellings: ["-w", "--follow", "-W", "--follow-new"],
      reason:
        "it waits for new messages forever, so the command would only end at its timeout",
    },
    {
      spellings: ["-c", "--read-clear", "-C", "--clear"],
      reason: "it clears the kernel ring buffer",
    },
    {
      spellings: [
        "-n",
        "--console-level",
        "-D",
        "--console-off",
        "-E",
        "--console-on",
      ],
      reason: "it changes what the kernel prints to the console",
    },
    {
      spellings: ["-F", "--file", "-K", "--kmsg-file"],
      reason: "it reads a file instead of the kernel ring buffer",
    },
    {
      spellings: ["-H", "--human"],
      reason: "it starts a pager; use -T for readable timestamps",
    },
  ],
};

const LSBLK_COLUMNS_REGEX: RegExp = /^\+?[A-Za-z][A-Za-z0-9%:_-]{0,31}$/;

const LSBLK_GRAMMAR: FlagGrammar = {
  program: "lsblk",
  allowed: LSBLK_ALLOWED,
  flags: [
    switchFlag("fs", "-f", "--fs"),
    switchFlag("bytes", "-b", "--bytes"),
    switchFlag("paths", "-p", "--paths"),
    switchFlag("json", "-J", "--json"),
    switchFlag("nodeps", "-d", "--nodeps"),
    switchFlag("all", "-a", "--all"),
    switchFlag("list", "-l", "--list"),
    switchFlag("noheadings", "-n", "--noheadings"),
    {
      spellings: ["-o", "--output"],
      key: "output",
      arity: FlagArity.Required,
      checkValue: checkList(
        LSBLK_COLUMNS_REGEX,
        "column names such as NAME,SIZE,TYPE,MOUNTPOINTS",
      ),
    },
  ],
  denied: [
    {
      spellings: ["--sysroot"],
      reason: "it reads another root directory",
    },
  ],
};

/*
 * One word of an ss filter expression (state established, dport = :443,
 * ( ... )), or a whole expression quoted as one word.
 */
const SS_FILTER_WORD_REGEX: RegExp =
  /^[A-Za-z0-9_.:/()!=<>[\]%*,][A-Za-z0-9_.:/()!=<>[\]%*, -]{0,255}$/;

const SS_GRAMMAR: FlagGrammar = {
  program: "ss",
  allowed: SS_ALLOWED,
  flags: [
    switchFlag("tcp", "-t", "--tcp"),
    switchFlag("udp", "-u", "--udp"),
    switchFlag("listening", "-l", "--listening"),
    switchFlag("numeric", "-n", "--numeric"),
    switchFlag("processes", "-p", "--processes"),
    switchFlag("all", "-a", "--all"),
    switchFlag("summary", "-s", "--summary"),
    switchFlag("unix", "-x", "--unix"),
    switchFlag("ipv4", "-4", "--ipv4"),
    switchFlag("ipv6", "-6", "--ipv6"),
    switchFlag("extended", "-e", "--extended"),
    switchFlag("info", "-i", "--info"),
    switchFlag("memory", "-m", "--memory"),
    switchFlag("options", "-o", "--options"),
    switchFlag("resolve", "-r", "--resolve"),
    switchFlag("no-header", "-H", "--no-header"),
  ],
  denied: [
    {
      spellings: ["-K", "--kill"],
      reason: "it forcibly closes the sockets it lists",
    },
    {
      spellings: ["-D", "--diag"],
      reason: "it writes raw socket data to a file",
    },
    {
      spellings: ["-F", "--filter"],
      reason:
        "it reads the filter from a file; write the filter as words instead",
    },
    {
      spellings: ["-N", "--net"],
      reason: "it switches to another network namespace",
    },
    {
      spellings: ["-E", "--events"],
      reason:
        "it streams socket events forever, so the command would only end at its timeout",
    },
  ],
};

const TOP_FIELD_REGEX: RegExp = /^[+-]?[A-Za-z%][A-Za-z0-9%+._-]{0,15}$/;

const TOP_GRAMMAR: FlagGrammar = {
  program: "top",
  allowed: TOP_ALLOWED,
  flags: [
    switchFlag("batch", "-b", "--batch-mode"),
    {
      spellings: ["-n", "--iterations"],
      key: "iterations",
      arity: FlagArity.Required,
      checkValue: (value: string): string | null => {
        return value === "1"
          ? null
          : `must be 1 (top runs exactly once), not "${value}"`;
      },
    },
    {
      spellings: ["-o", "--sort-override"],
      key: "sort",
      arity: FlagArity.Required,
      valueMayStartWithDash: true,
      checkValue: checkPattern(
        TOP_FIELD_REGEX,
        "a field name such as %CPU or %MEM",
      ),
    },
    switchFlag("cmdline", "-c", "--cmdline-toggle"),
    {
      spellings: ["-w", "--width"],
      key: "width",
      arity: FlagArity.Optional,
      takesNextWord: (word: string): boolean => {
        return LEADING_DIGIT_REGEX.test(word);
      },
      checkValue: checkWholeNumber(1, MAX_TOP_WIDTH),
    },
    switchFlag("threads", "-H", "--threads-show"),
  ],
  denied: [],
};

interface SimpleProgram {
  grammar: FlagGrammar;
  // Checks every positional word; null means the program takes none.
  checkOperand: ((operand: string) => string | null) | null;
  reason: string;
}

const SIMPLE_PROGRAMS: Readonly<Record<string, SimpleProgram>> = {
  df: {
    grammar: DF_GRAMMAR,
    checkOperand: (operand: string): string | null => {
      return ABSOLUTE_PATH_REGEX.test(operand) && !hasDotDotStep(operand)
        ? null
        : `"${operand}" is not an absolute path df can report on`;
    },
    reason: "df shows filesystem space and inode use; it changes nothing",
  },
  free: {
    grammar: FREE_GRAMMAR,
    checkOperand: null,
    reason: "free shows memory and swap use once; it changes nothing",
  },
  uptime: {
    grammar: UPTIME_GRAMMAR,
    checkOperand: null,
    reason:
      "uptime shows how long the host has run and its load; it changes nothing",
  },
  uname: {
    grammar: UNAME_GRAMMAR,
    checkOperand: null,
    reason: "uname shows the kernel and machine; it changes nothing",
  },
  dmesg: {
    grammar: DMESG_GRAMMAR,
    checkOperand: null,
    reason:
      "dmesg reads the kernel ring buffer without clearing it; it changes nothing",
  },
  lsblk: {
    grammar: LSBLK_GRAMMAR,
    checkOperand: (operand: string): string | null => {
      return DEVICE_PATH_REGEX.test(operand) && !hasDotDotStep(operand)
        ? null
        : `"${operand}" is not a /dev device path lsblk can list`;
    },
    reason: "lsblk lists block devices; it changes nothing",
  },
  ss: {
    grammar: SS_GRAMMAR,
    checkOperand: (operand: string): string | null => {
      return SS_FILTER_WORD_REGEX.test(operand)
        ? null
        : `"${operand}" is not a word of an ss filter expression`;
    },
    reason: "ss lists sockets; it changes nothing",
  },
};

function evaluateSimpleProgram(
  argv: Array<string>,
  simple: SimpleProgram,
): ResourceCommandPolicyResult {
  const parsed: ParsedArgs = parseGetoptArgs(argv.slice(1), simple.grammar);

  if (parsed.problem) {
    return deniedResult(argv, parsed.problem);
  }

  for (const operand of parsed.positionals) {
    const problem: string | null = simple.checkOperand
      ? simple.checkOperand(operand)
      : `${simple.grammar.program} takes no words besides its flags ("${operand}")`;

    if (problem) {
      return deniedResult(argv, `${problem}; ${simple.grammar.allowed}`);
    }
  }

  return {
    tier: ResourceCommandTier.Read,
    reason: simple.reason,
    program: argv[0] || "",
    args: argv.slice(1),
    verb: argv[0] || "",
    displayCommand: renderResourceDisplayCommand(argv),
    targets: [],
  };
}

function evaluateTop(argv: Array<string>): ResourceCommandPolicyResult {
  const parsed: ParsedArgs = parseGetoptArgs(argv.slice(1), TOP_GRAMMAR);

  if (parsed.problem) {
    return deniedResult(argv, parsed.problem);
  }

  if (parsed.positionals.length > 0) {
    return deniedResult(
      argv,
      `top takes no words besides its flags ("${parsed.positionals[0]}"); ${TOP_ALLOWED}`,
    );
  }

  if (!hasFlag(parsed, "batch") || !hasFlag(parsed, "iterations")) {
    return deniedResult(
      argv,
      `top must run once in batch mode with -b and -n 1 (without them it waits for a terminal until its timeout); ${TOP_ALLOWED}`,
    );
  }

  return {
    tier: ResourceCommandTier.Read,
    reason:
      "top prints one batch snapshot of the busiest processes; it changes nothing",
    program: argv[0] || "",
    args: argv.slice(1),
    verb: "top",
    displayCommand: renderResourceDisplayCommand(argv),
    targets: [],
  };
}

/*
 * ---------------------------------------------------------------------------
 * ps: UNIX (-ef), BSD (aux) and GNU (--sort) options, as procps reads them
 * ---------------------------------------------------------------------------
 */

/*
 * The output keys -o/o may print and --sort may order by. Nothing here
 * prints a process's environment (only the BSD `e` modifier does, and it is
 * Denied).
 */
const PS_FORMAT_KEYS: ReadonlyArray<string> = [
  "pid",
  "ppid",
  "pgid",
  "pgrp",
  "sid",
  "sess",
  "tid",
  "lwp",
  "spid",
  "nlwp",
  "thcount",
  "user",
  "euser",
  "ruser",
  "uname",
  "uid",
  "euid",
  "ruid",
  "group",
  "egroup",
  "rgroup",
  "gid",
  "egid",
  "rgid",
  "%cpu",
  "pcpu",
  "c",
  "cp",
  "%mem",
  "pmem",
  "rss",
  "rssize",
  "rsz",
  "vsz",
  "vsize",
  "sz",
  "size",
  "drs",
  "trs",
  "stat",
  "state",
  "s",
  "start",
  "start_time",
  "stime",
  "lstart",
  "bsdstart",
  "etime",
  "etimes",
  "time",
  "cputime",
  "cputimes",
  "bsdtime",
  "tty",
  "tt",
  "tname",
  "comm",
  "ucmd",
  "ucomm",
  "cmd",
  "args",
  "command",
  "ni",
  "nice",
  "pri",
  "priority",
  "psr",
  "wchan",
  "class",
  "cls",
  "policy",
  "rtprio",
  "f",
  "flags",
  "cgroup",
  "unit",
  "slice",
  "maj_flt",
  "min_flt",
  "majflt",
  "minflt",
  "oom",
  "oomadj",
];

// One -o item: KEY, KEY:WIDTH or KEY=HEADER.
const PS_FORMAT_ITEM_REGEX: RegExp =
  /^([a-z%_]{1,16})(?::[0-9]{1,4})?(?:=[A-Za-z0-9_%-]{0,32})?$/;

const PS_SORT_ITEM_REGEX: RegExp = /^[+-]?([a-z%_]{1,16})$/;

const PS_PID_LIST_REGEX: RegExp = /^[0-9]{1,7}(?:[, ][0-9]{1,7}){0,63}$/;

const PS_USER_LIST_REGEX: RegExp =
  /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}(?:[, ][A-Za-z0-9_][A-Za-z0-9_.-]{0,31}){0,31}$/;

const PS_COMMAND_LIST_REGEX: RegExp =
  /^[A-Za-z0-9_.:@+][A-Za-z0-9_.:@+-]{0,63}(?:,[A-Za-z0-9_.:@+][A-Za-z0-9_.:@+-]{0,63}){0,31}$/;

function checkPsFormat(value: string): string | null {
  const items: Array<string> = value.split(/[, ]/);

  if (value.length > 512 || items.length > 64) {
    return "is too long a format list";
  }

  for (const item of items) {
    const match: RegExpExecArray | null = PS_FORMAT_ITEM_REGEX.exec(item);

    if (!match || !PS_FORMAT_KEYS.includes(match[1] || "")) {
      return `must list output keys such as pid,ppid,user,%cpu,%mem,etime,stat,args — "${item}" is not one`;
    }
  }

  return null;
}

function checkPsSort(value: string): string | null {
  const items: Array<string> = value.split(",");

  if (value.length > 256 || items.length > 16) {
    return "is too long a sort list";
  }

  for (const item of items) {
    const match: RegExpExecArray | null = PS_SORT_ITEM_REGEX.exec(item);

    if (!match || !PS_FORMAT_KEYS.includes(match[1] || "")) {
      return `must list sort keys such as -%cpu or -rss — "${item}" is not one`;
    }
  }

  return null;
}

// UNIX switches (-e) and the UNIX options that take a value (-o FORMAT).
const PS_UNIX_SWITCHES: ReadonlyArray<string> = [
  "e",
  "A",
  "f",
  "F",
  "l",
  "H",
  "L",
  "T",
  "w",
];

const PS_UNIX_VALUE_OPTIONS: Readonly<
  Record<string, (value: string) => string | null>
> = {
  o: checkPsFormat,
  p: checkPattern(PS_PID_LIST_REGEX, "a list of pids such as 1234,5678"),
  u: checkPattern(PS_USER_LIST_REGEX, "a list of user names or ids"),
  C: checkPattern(
    PS_COMMAND_LIST_REGEX,
    "a list of command names such as nginx",
  ),
};

const PS_BSD_SWITCHES: ReadonlyArray<string> = ["a", "u", "x", "w", "f"];

const PS_BSD_VALUE_OPTIONS: Readonly<
  Record<string, (value: string) => string | null>
> = {
  o: checkPsFormat,
};

const PS_GNU_SWITCHES: ReadonlyArray<string> = [
  "--no-headers",
  "--no-heading",
  "--forest",
];

function evaluatePs(argv: Array<string>): ResourceCommandPolicyResult {
  const args: Array<string> = argv.slice(1);
  const deny: (problem: string) => ResourceCommandPolicyResult = (
    problem: string,
  ): ResourceCommandPolicyResult => {
    return deniedResult(argv, `${problem}; ${PS_ALLOWED}`);
  };

  for (let i: number = 0; i < args.length; i++) {
    const token: string = args[i] as string;

    if (token === "" || token === "-" || token === "--") {
      return deny(`"${token}" is not a ps option`);
    }

    if (token.startsWith("--")) {
      const eq: number = token.indexOf("=");
      const name: string = eq >= 0 ? token.slice(0, eq) : token;

      if (PS_GNU_SWITCHES.includes(name)) {
        if (eq >= 0) {
          return deny(`${name} takes no value (in "${token}")`);
        }
        continue;
      }

      if (name !== "--sort") {
        return deny(
          `${name} is not a ps option this policy allows (long options must be written in full)`,
        );
      }

      let value: string | undefined = eq >= 0 ? token.slice(eq + 1) : undefined;

      if (value === undefined) {
        value = args[i + 1];
        i++;
      }

      if (value === undefined) {
        return deny("--sort needs a key such as -%cpu");
      }

      const problem: string | null = checkPsSort(value);

      if (problem) {
        return deny(`--sort ${problem}`);
      }
      continue;
    }

    const isUnix: boolean = token.startsWith("-");
    const switches: ReadonlyArray<string> = isUnix
      ? PS_UNIX_SWITCHES
      : PS_BSD_SWITCHES;
    const valueOptions: Readonly<
      Record<string, (value: string) => string | null>
    > = isUnix ? PS_UNIX_VALUE_OPTIONS : PS_BSD_VALUE_OPTIONS;
    let rest: string = isUnix ? token.slice(1) : token;

    while (rest.length > 0) {
      const letter: string = rest.charAt(0);
      const spelling: string = isUnix ? `-${letter}` : letter;
      const where: string = whereInToken(token, spelling);

      if (!isUnix && letter === "e") {
        return deny(
          `the BSD e option${where} prints every process's environment, where secrets live, so it is never allowed`,
        );
      }

      if (switches.includes(letter)) {
        rest = rest.slice(1);
        continue;
      }

      if (!hasOwn(valueOptions, letter)) {
        return deny(
          `${isUnix ? spelling : `the BSD ${letter} option`}${where} is not a ps option this policy allows`,
        );
      }

      // procps: the rest of the word is the value, else the next word.
      let value: string | undefined = rest.slice(1);

      if (!value) {
        value = args[i + 1];
        i++;
      }

      if (value === undefined) {
        return deny(`${spelling}${where} needs a value`);
      }

      const check: ((value: string) => string | null) | undefined =
        valueOptions[letter];
      const problem: string | null = check ? check(value) : null;

      if (problem) {
        return deny(`${spelling} ${problem}`);
      }
      break;
    }
  }

  return {
    tier: ResourceCommandTier.Read,
    reason: "ps lists processes; it changes nothing",
    program: argv[0] || "",
    args: argv.slice(1),
    verb: "ps",
    displayCommand: renderResourceDisplayCommand(argv),
    targets: [],
  };
}

/*
 * ---------------------------------------------------------------------------
 * ip: its own option loop (prefix matching, options before the object)
 * ---------------------------------------------------------------------------
 */

// The option spellings allowed, after "--x" is read as "-x" the way ip does.
const IP_ALLOWED_OPTIONS: ReadonlyArray<string> = [
  "-br",
  "-brief",
  "-s",
  "-stats",
  "-statistics",
  "-d",
  "-details",
  "-j",
  "-json",
  "-p",
  "-pretty",
  "-4",
  "-6",
];

/*
 * Options ip resolves by prefix that must never run, each checked in ip's
 * own order: "-b" is -batch (it reads commands from a file), "-n" is -netns
 * (another network namespace), "-fo" is -force.
 */
interface IpDeniedOption {
  // The option as ip spells it in full.
  name: string;
  // The shortest prefix ip resolves to it (shorter ones mean another option).
  minimumLength: number;
  reason: string;
}

const IP_DENIED_OPTIONS: ReadonlyArray<IpDeniedOption> = [
  {
    name: "-batch",
    minimumLength: 2,
    reason: "it reads more ip commands from a file",
  },
  {
    name: "-force",
    minimumLength: 3,
    reason: "it keeps going past errors in batch mode",
  },
  {
    name: "-netns",
    minimumLength: 2,
    reason: "it switches to another network namespace",
  },
];

// Every spelling of the objects ip may read, with the name used in labels.
const IP_OBJECTS: Readonly<Record<string, string>> = {
  a: "address",
  addr: "address",
  address: "address",
  l: "link",
  link: "link",
  r: "route",
  route: "route",
  n: "neigh",
  neigh: "neigh",
  neighbor: "neigh",
  neighbour: "neigh",
  ru: "rule",
  rule: "rule",
};

const IP_DENIED_OBJECTS: Readonly<Record<string, string>> = {
  netns: "it creates, deletes or runs commands in network namespaces",
  xfrm: "its state shows IPsec keys",
  monitor: "it streams events forever",
};

const IP_READ_ACTIONS: ReadonlyArray<string> = ["show", "list", "ls"];

const IP_WRITE_ACTIONS: ReadonlyArray<string> = [
  "add",
  "append",
  "change",
  "chg",
  "del",
  "delete",
  "flush",
  "prepend",
  "replace",
  "restore",
  "save",
  "set",
  "test",
];

// One filter word after show: dev eth0, table all, scope global, 10.0.0.0/8.
const IP_FILTER_WORD_REGEX: RegExp =
  /^[A-Za-z0-9_.:/@%+][A-Za-z0-9_.:/@%+-]{0,63}$/;

const IP_ADDRESS_REGEX: RegExp =
  /^(?=[^/]*[.:])[0-9a-fA-F:.]{2,45}(?:\/[0-9]{1,3})?$/;

function evaluateIp(argv: Array<string>): ResourceCommandPolicyResult {
  const deny: (problem: string) => ResourceCommandPolicyResult = (
    problem: string,
  ): ResourceCommandPolicyResult => {
    return deniedResult(argv, `${problem}; ${IP_ALLOWED}`);
  };

  let index: number = 1;

  while (index < argv.length && (argv[index] as string).startsWith("-")) {
    const token: string = argv[index] as string;

    if (token === "--") {
      return deny(`ip needs no "--"`);
    }

    // ip reads "--brief" as "-brief".
    const option: string = token.startsWith("--") ? token.slice(1) : token;

    if (!IP_ALLOWED_OPTIONS.includes(option)) {
      const denied: IpDeniedOption | undefined = IP_DENIED_OPTIONS.find(
        (entry: IpDeniedOption): boolean => {
          return (
            option.length >= entry.minimumLength &&
            entry.name.startsWith(option)
          );
        },
      );

      if (denied) {
        return deny(
          `ip ${token} is never allowed: ip reads it as ${denied.name}, and ${denied.reason}`,
        );
      }

      return deny(
        `${token} is not an ip option this policy allows (options are written in full and come before the object)`,
      );
    }

    index++;
  }

  const objectWord: string | undefined = argv[index];

  if (objectWord === undefined) {
    return deny("ip needs an object to show");
  }

  if (hasOwn(IP_DENIED_OBJECTS, objectWord)) {
    return deny(
      `ip ${objectWord} is never allowed: ${IP_DENIED_OBJECTS[objectWord]}`,
    );
  }

  if (!hasOwn(IP_OBJECTS, objectWord)) {
    return deny(`ip ${objectWord} is not an object this policy reads`);
  }

  const object: string = IP_OBJECTS[objectWord] || objectWord;
  const rest: Array<string> = argv.slice(index + 1);
  const action: string | undefined = rest[0];

  const read: (label: string) => ResourceCommandPolicyResult = (
    label: string,
  ): ResourceCommandPolicyResult => {
    return {
      tier: ResourceCommandTier.Read,
      reason: `ip ${label} shows the host's network configuration; it changes nothing`,
      program: argv[0] || "",
      args: argv.slice(1),
      verb: label,
      displayCommand: renderResourceDisplayCommand(argv),
      targets: [],
    };
  };

  if (action === undefined) {
    return read(`${object} show`);
  }

  if (IP_READ_ACTIONS.includes(action)) {
    const badFilter: string | undefined = rest
      .slice(1)
      .find((word: string): boolean => {
        return !IP_FILTER_WORD_REGEX.test(word);
      });

    if (badFilter !== undefined) {
      return deny(
        `"${badFilter}" is not a filter word ip ${objectWord} ${action} can take (such as dev eth0 or table all)`,
      );
    }

    return read(`${object} show`);
  }

  if (object === "route" && action === "get") {
    if (rest.length !== 2 || !IP_ADDRESS_REGEX.test(rest[1] || "")) {
      return deny(
        "ip route get takes exactly one IP address, as in ip route get 1.1.1.1",
      );
    }

    return read("route get");
  }

  if (IP_WRITE_ACTIONS.includes(action)) {
    return deny(
      `ip ${objectWord} ${action} changes the host's network configuration, which is never allowed`,
    );
  }

  return deny(
    `"${action}" is not an ip ${object} read (write show, list or ls in full)`,
  );
}

/*
 * ---------------------------------------------------------------------------
 * cat, hostnamectl, timedatectl
 * ---------------------------------------------------------------------------
 */

function evaluateCat(argv: Array<string>): ResourceCommandPolicyResult {
  const operands: Array<string> = argv.slice(1);

  if (operands.length === 0) {
    return deniedResult(argv, `cat needs a file to read; ${CAT_ALLOWED}`);
  }

  for (const operand of operands) {
    if (operand.startsWith("-")) {
      return deniedResult(
        argv,
        `cat takes no flags ("${operand}"); ${CAT_ALLOWED}`,
      );
    }

    if (!HOST_READABLE_FILES.includes(operand)) {
      return deniedResult(
        argv,
        `cat may not read "${operand}"; ${CAT_ALLOWED}`,
      );
    }
  }

  return {
    tier: ResourceCommandTier.Read,
    reason: "cat reads kernel counters or the OS release; it changes nothing",
    program: argv[0] || "",
    args: argv.slice(1),
    verb: "cat",
    displayCommand: renderResourceDisplayCommand(argv),
    targets: [],
  };
}

function evaluateStatusTool(
  argv: Array<string>,
  readCommands: ReadonlyArray<string>,
  allowed: string,
  shows: string,
): ResourceCommandPolicyResult {
  const operands: Array<string> = argv.slice(1);
  const flag: string | undefined = operands.find((word: string): boolean => {
    return word.startsWith("-");
  });

  if (flag !== undefined) {
    return deniedResult(
      argv,
      `${argv[0]} takes no flags here ("${flag}"); ${allowed}`,
    );
  }

  const command: string = operands[0] ?? "status";

  if (operands.length > 1 || !readCommands.includes(command)) {
    return deniedResult(
      argv,
      `${renderResourceDisplayCommand(argv)} is not allowed: only the read commands run, and settings are never changed; ${allowed}`,
    );
  }

  return {
    tier: ResourceCommandTier.Read,
    reason: `${argv[0]} ${command} shows ${shows}; it changes nothing`,
    program: argv[0] || "",
    args: argv.slice(1),
    verb: command,
    displayCommand: renderResourceDisplayCommand(argv),
    targets: [],
  };
}

/*
 * ---------------------------------------------------------------------------
 * kill
 * ---------------------------------------------------------------------------
 */

// Signal spellings kill accepts here, each with the name shown on the card.
const KILL_SIGNALS: Readonly<Record<string, string>> = {
  TERM: "TERM",
  SIGTERM: "TERM",
  "15": "TERM",
  HUP: "HUP",
  SIGHUP: "HUP",
  INT: "INT",
  SIGINT: "INT",
  KILL: "KILL",
  SIGKILL: "KILL",
  "9": "KILL",
};

const PID_REGEX: RegExp = /^[1-9][0-9]{0,6}$/;

function evaluateKill(argv: Array<string>): ResourceCommandPolicyResult {
  const args: Array<string> = argv.slice(1);
  const deny: (problem: string) => ResourceCommandPolicyResult = (
    problem: string,
  ): ResourceCommandPolicyResult => {
    return deniedResult(argv, `${problem}; ${KILL_ALLOWED}`);
  };

  let signal: string = "TERM";
  let index: number = 0;
  const first: string | undefined = args[0];

  if (first === "-s") {
    const name: string | undefined = args[1];

    if (name === undefined || !hasOwn(KILL_SIGNALS, name)) {
      return deny(
        `-s needs one of the allowed signals (${Object.keys(KILL_SIGNALS).join(", ")})`,
      );
    }

    signal = KILL_SIGNALS[name] || name;
    index = 2;
  } else if (first !== undefined && first.startsWith("-") && first !== "--") {
    const name: string = first.slice(1);

    if (!hasOwn(KILL_SIGNALS, name)) {
      return deny(
        `"${first}" is not a signal this policy sends (-TERM, -15, -HUP, -INT, -KILL or -9)`,
      );
    }

    signal = KILL_SIGNALS[name] || name;
    index = 1;
  }

  const pidWords: Array<string> = args.slice(index);

  if (pidWords.length === 0) {
    return deny("kill needs the pid it signals");
  }

  const targets: Array<string> = [];

  for (const word of pidWords) {
    if (word.startsWith("-")) {
      return deny(
        `"${word}" is never allowed after the signal: a negative pid signals a whole process group (-1 is every process), and "--" or a second option is not needed`,
      );
    }

    if (!PID_REGEX.test(word) || parseInt(word, 10) > MAX_PID) {
      return deny(
        `"${word}" is not a pid (a whole number from 2 to ${MAX_PID}, no leading zeros)`,
      );
    }

    if (word === "1") {
      return deny("pid 1 is the host's init system; kill 1 is never allowed");
    }

    const target: string = `pid:${word}`;

    if (!targets.includes(target)) {
      targets.push(target);
    }
  }

  return {
    tier: ResourceCommandTier.RiskyWrite,
    reason: `kill sends SIG${signal} to ${
      targets.length === 1 ? "process" : `${targets.length} processes:`
    } ${joinWords(
      targets.map((target: string): string => {
        return target.slice("pid:".length);
      }),
    )}; ending a process on the host always needs a human's approval`,
    program: argv[0] || "",
    args: argv.slice(1),
    verb: "kill",
    displayCommand: renderResourceDisplayCommand(argv),
    targets,
    requiresHuman: true,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Dispatch
 * ---------------------------------------------------------------------------
 */

const PROGRAM_EVALUATORS: Readonly<
  Record<string, (argv: Array<string>) => ResourceCommandPolicyResult>
> = {
  systemctl: evaluateSystemctl,
  journalctl: evaluateJournalctl,
  df: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateSimpleProgram(argv, SIMPLE_PROGRAMS["df"] as SimpleProgram);
  },
  free: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateSimpleProgram(
      argv,
      SIMPLE_PROGRAMS["free"] as SimpleProgram,
    );
  },
  uptime: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateSimpleProgram(
      argv,
      SIMPLE_PROGRAMS["uptime"] as SimpleProgram,
    );
  },
  ps: evaluatePs,
  ss: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateSimpleProgram(argv, SIMPLE_PROGRAMS["ss"] as SimpleProgram);
  },
  ip: evaluateIp,
  dmesg: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateSimpleProgram(
      argv,
      SIMPLE_PROGRAMS["dmesg"] as SimpleProgram,
    );
  },
  lsblk: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateSimpleProgram(
      argv,
      SIMPLE_PROGRAMS["lsblk"] as SimpleProgram,
    );
  },
  cat: evaluateCat,
  top: evaluateTop,
  uname: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateSimpleProgram(
      argv,
      SIMPLE_PROGRAMS["uname"] as SimpleProgram,
    );
  },
  hostnamectl: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateStatusTool(
      argv,
      ["status"],
      HOSTNAMECTL_ALLOWED,
      "the host name, OS and hardware",
    );
  },
  timedatectl: (argv: Array<string>): ResourceCommandPolicyResult => {
    return evaluateStatusTool(
      argv,
      ["status", "show", "timesync-status"],
      TIMEDATECTL_ALLOWED,
      "the clock, time zone and time synchronization",
    );
  },
  kill: evaluateKill,
};

function evaluateHostArgv(raw: unknown): ResourceCommandPolicyResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return deniedResult([], "Empty command.");
  }

  if (
    raw.some((word: unknown): boolean => {
      return typeof word !== "string";
    })
  ) {
    return deniedResult(
      raw as Array<string>,
      "Every word of the command must be a string.",
    );
  }

  const argv: Array<string> = (raw as Array<string>).slice();
  const program: string = argv[0] as string;

  if (!hasOwn(PROGRAM_EVALUATORS, program)) {
    return deniedResult(
      argv,
      `"${program}" is not a program the host command policy runs: a host command starts with ${HOST_COMMAND_PROGRAMS.join(
        ", ",
      )} (the name alone, never a path)`,
    );
  }

  const nonAscii: string | undefined = argv.find((word: string): boolean => {
    return !PRINTABLE_ASCII_REGEX.test(word);
  });

  if (nonAscii !== undefined) {
    return deniedResult(
      argv,
      `"${nonAscii}" holds a character that is not printable ASCII (a look-alike dash, quote or letter, or a control character); retype the command in plain ASCII`,
    );
  }

  const evaluator: (argv: Array<string>) => ResourceCommandPolicyResult =
    PROGRAM_EVALUATORS[program] as (
      argv: Array<string>,
    ) => ResourceCommandPolicyResult;

  return evaluator(argv);
}

const READ_COMMAND_GUIDE: string = [
  "- Services: `systemctl status UNIT --no-pager -n 50`, `systemctl is-active|is-failed|is-enabled UNIT`, `systemctl list-units --failed --no-pager` (also --type=service, --state=S, --all, PATTERN), `systemctl list-timers --all`, `systemctl list-dependencies UNIT`, `systemctl show UNIT -p ActiveState,SubState,Result,NRestarts,ExecMainStatus,MainPID,MemoryCurrent` (-p is required and only unit-state properties are allowed — never Environment, and never systemctl cat)",
  `- Logs: \`journalctl -u UNIT -n 200 --no-pager\` — every read needs -n N (at most ${MAX_JOURNALCTL_LINES}) or --since TIME; also -p err, -k, -b [-1], --until, -g REGEX, -t IDENTIFIER, -o short-iso|json, -r, --utc; \`journalctl --list-boots\`, \`journalctl --disk-usage\`; never -f`,
  "- Resources: `uptime`, `free -m`, `df -h`, `df -i`, `lsblk -f`, `uname -a`, `hostnamectl`, `timedatectl`, `dmesg -T --level=err,warn`",
  "- Processes: `ps aux --sort=-%cpu`, `ps -eo pid,ppid,user,%cpu,%mem,etime,stat,args --sort=-%mem`, `top -b -n 1 -o %MEM` (top needs -b -n 1)",
  "- Network: `ss -tulpn`, `ss -s`, `ss -tn state established`, `ip -br addr`, `ip -br link`, `ip route`, `ip route get 1.1.1.1`, `ip neigh`, `ip -s link`",
  `- Kernel counters: \`cat /proc/loadavg\` — cat reads only ${HOST_READABLE_FILES.join(", ")}`,
  "- One program per command, named without a path: no pipes, redirects, sudo, shells or other programs",
].join("\n");

const WRITE_COMMAND_GUIDE: string = [
  "- SafeWrite (runs unattended when allowed): `systemctl restart|start|reload|try-restart|reload-or-restart|reset-failed UNIT` for exactly ONE service, socket, timer or path unit (targets are full unit names: nginx is nginx.service)",
  "- RiskyWrite (needs approval unless the allowlist or Bypass approval covers it): `systemctl stop UNIT`; any of the verbs above on several units; `systemctl reset-failed` with no unit; `journalctl --vacuum-time=7d` / `--vacuum-size=500M` / `--vacuum-files=N` (target journal)",
  "- Always a human: any change to a protected unit (ssh/sshd, systemd-*, dbus, polkit, NetworkManager, networking, getty, docker, containerd, podman, kubelet, firewalld, nftables, iptables, ufw, user@), start/stop/restart/reload of a .target, .mount, .automount or .swap unit, and `kill [-TERM|-15|-HUP|-INT|-KILL|-9] PID` (pids from 2 up)",
  "- Never: systemctl enable/disable/mask/unmask/edit/cat/daemon-reload/daemon-reexec/isolate/kill/set-property/*-environment/clean, the power and run-state verbs and units (reboot, poweroff, halt, suspend, rescue, emergency, ...), slices, scopes and devices, --force/--user/--host/--machine/--root, journalctl -f/--rotate/--flush, dmesg --clear, ss -K, ip changes, killing pid 1 or a process group",
].join("\n");

const HostCommandPolicy: ResourceToolPolicy = {
  name: "host",
  programs: HOST_COMMAND_PROGRAMS,
  readCommandGuide: READ_COMMAND_GUIDE,
  writeCommandGuide: WRITE_COMMAND_GUIDE,
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    try {
      return evaluateHostArgv(argv);
    } catch {
      return deniedResult(
        Array.isArray(argv) ? argv : [],
        "the host command policy could not evaluate this command",
      );
    }
  },
};

export default HostCommandPolicy;
