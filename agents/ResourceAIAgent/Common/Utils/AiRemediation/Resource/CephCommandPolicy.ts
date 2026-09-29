/*
 * The ceph command policy: tiers the ceph CLI (health, OSDs, pools,
 * placement groups, daemons) for Ceph clusters.
 *
 * The agent spawns the ceph binary (Squid 19) with the argv this policy
 * read and with its OWN --conf, --keyring and --id, so what this policy has
 * to bound is what one ceph command can do. It is an allowlist of exact
 * command words with validated arguments; anything it does not model is
 * Denied, with a reason that names what may run instead.
 *
 * ---- How ceph reads its argv --------------------------------------------------
 *
 * ceph parses its own options with Python's argparse (parse_known_args)
 * BEFORE it looks at the command, and hands every word it did not consume
 * to the monitors, which match it against their command table. That parser
 * decides what a dash-prefixed word means, and it is generous:
 *   - options may appear anywhere: before, between and after the command
 *     words (`ceph osd -f json tree` is `ceph osd tree -f json`);
 *   - long options may be ABBREVIATED (allow_abbrev): `--out` is --out-file
 *     and `--keyr`-style prefixes of any option it knows are that option;
 *   - short options may be combined (`-sw`) or carry their value inline
 *     (`-fjson`, `-f=json`), and `--opt=value` carries one too;
 *   - whatever argparse does not consume, librados reads as a configuration
 *     override: `--keyring=...`, `--mon-host=...`, `--log-file=...`,
 *     `--admin-socket=...` switch the cluster, the identity or write files;
 *   - `--admin-daemon`, `-i`/`--in-file`, `-o`/`--out-file`, `-w`/`--watch`
 *     read a local admin socket, read or write local files, or never end.
 * So this policy NEVER interprets a dash-prefixed word it does not know. It
 * accepts exactly:
 *   - `--format V`, `--format=V` or `-f V`, with V one of json, json-pretty
 *     or plain, at most once, anywhere (argparse reads it anywhere);
 *   - `-s` alone, which is `ceph status`;
 *   - after `orch ps` only, the named arguments that command takes:
 *     `--daemon_type T` (or `--daemon-type T`), `--service_name S` (or
 *     `--service-name S`) and `--refresh`, each at most once.
 * Every other word that starts with "-" is Denied — which also defeats
 * abbreviations, combined short options, `--` and negative numbers. A flag
 * that takes a value accepts only a value it validates, so it can never
 * swallow a word that would otherwise have been refused. An empty word, a
 * word with a Unicode look-alike and a word of the wrong case match nothing
 * and are Denied.
 *
 * ---- Tiers ----------------------------------------------------------------------
 *
 * Read (what an investigation may run): status (or -s), health [detail],
 * df [detail], versions, version, progress, quorum_status; osd tree
 * [up|down|in|out|destroyed]..., osd df [tree], osd perf, osd stat, osd
 * dump, osd blocked-by, osd find ID, osd metadata [ID], osd ok-to-stop
 * ID..., osd safe-to-destroy ID...; osd pool ls [detail], osd pool stats
 * [POOL], osd pool get POOL VAR|all; pg stat, pg dump_stuck [STATE]...
 * [SECONDS], pg PGID query, pg PGID list_unfound, pg ls-by-osd ID, pg
 * ls-by-pool POOL, pg ls-by-primary ID; mon stat, mon dump; mgr stat, mgr
 * module ls, mgr services; crash ls, crash ls-new, crash stat, crash info
 * CRASH_ID; orch ps (see above), orch ls, orch host ls, orch device ls; log
 * last [N<=1000] [debug|info|sec|warn|error] [*|cluster|audit|cephadm];
 * balancer status; fs status [FS], fs ls, mds stat.
 *
 * SafeWrite (runs unattended in Automatic mode) is a reversible change to
 * exactly ONE named object, or the clearing of a flag that returns the
 * cluster to normal: osd in ID; osd unset FLAG; crash archive CRASH_ID;
 * orch daemon restart TYPE.ID; pg scrub PGID; pg deep-scrub PGID.
 *
 * RiskyWrite (a human, the allowlist or Bypass approval decides): osd out
 * ID; osd down ID; osd set FLAG; osd reweight ID 0..1; pg repair PGID; mgr
 * fail [NAME]; orch daemon stop|start TYPE.ID; orch restart SERVICE; crash
 * archive-all; balancer on|off.
 *
 * RiskyWrite that always asks a human (requiresHuman — not Bypass approval,
 * not the allowlist): osd pool set POOL size|min_size N, which re-replicates
 * or discards copies of every object in the pool, or blocks its I/O; and
 * osd set pause, which stops every client read and write in the cluster.
 *
 * FLAG is one of noout, norebalance, nobackfill, norecover, noscrub,
 * nodeep-scrub, pause. Every OSD command names ONE OSD; ceph's lists, `any`,
 * `all` and `*` are Denied.
 *
 * Denied: everything else — among it osd purge/destroy/rm/lost/new/create,
 * osd crush, osd pool create/delete/rm/rename and every other pool setting,
 * auth (cephx keys), config-key (secrets), config, tell, daemon and
 * --admin-daemon (commands inside a daemon), injectargs, fs changes, mon
 * membership, mgr module enable/disable, orch apply/rm/host/upgrade and
 * daemon rm, osd require-osd-release, osd set-*-ratio, pg force_create_pg,
 * pg PGID mark_unfound_lost, crash rm/prune and `ceph log TEXT`.
 *
 * ---- Targets ------------------------------------------------------------------
 *
 * The canonical names a write's targets hold, which the agent's
 * ONEUPTIME_AI_WRITE_TARGETS globs and protected targets are compared with:
 * osd.N for an OSD (whether the command wrote 3 or osd.3; leading zeros are
 * refused so an OSD has one spelling), the daemon name for a cephadm daemon
 * (osd.3, mon.host1, rgw.store.host1.abcdef), the service name for orch
 * restart, mgr.NAME for mgr fail NAME, the pool name, the PG id (1.2f),
 * crash/CRASH_ID for one crash report, and "cluster" for a cluster-wide
 * change (osd set/unset, balancer on/off, crash archive-all, and mgr fail
 * without a name).
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only,
 * and nothing from Node.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";

const CEPH_PROGRAM: string = "ceph";

// The target a cluster-wide change names (osd set/unset, balancer, ...).
export const CEPH_CLUSTER_TARGET: string = "cluster";

// The prefix of a crash report's target: "crash/<crash id>".
export const CEPH_CRASH_TARGET_PREFIX: string = "crash/";

// The output formats --format (or -f) may name.
export const CEPH_OUTPUT_FORMATS: ReadonlyArray<string> = [
  "json",
  "json-pretty",
  "plain",
];

// The cluster-wide OSD flags osd set and osd unset may name.
export const CEPH_OSD_FLAGS: ReadonlyArray<string> = [
  "noout",
  "norebalance",
  "nobackfill",
  "norecover",
  "noscrub",
  "nodeep-scrub",
  "pause",
];

// The one flag whose setting stops client I/O cluster-wide.
const CLIENT_IO_PAUSE_FLAG: string = "pause";

// What each flag does while it is set, for the reasons on approval cards.
const OSD_FLAG_EFFECTS: Readonly<Record<string, string>> = {
  noout: "down OSDs are never marked out, so their data is not re-replicated",
  norebalance: "data is not rebalanced across OSDs",
  nobackfill: "PGs are not backfilled",
  norecover: "PGs are not recovered",
  noscrub: "PGs are not scrubbed",
  "nodeep-scrub": "PGs are not deep-scrubbed",
  pause: "every client read and write is stopped",
};

const OSD_TREE_STATES: ReadonlyArray<string> = [
  "up",
  "down",
  "in",
  "out",
  "destroyed",
];

const STUCK_PG_STATES: ReadonlyArray<string> = [
  "inactive",
  "unclean",
  "stale",
  "undersized",
  "degraded",
];

const LOG_LEVELS: ReadonlyArray<string> = [
  "debug",
  "info",
  "sec",
  "warn",
  "error",
];

const LOG_CHANNELS: ReadonlyArray<string> = [
  "*",
  "cluster",
  "audit",
  "cephadm",
];

// The pool settings osd pool set may change (always with a human).
const POOL_REPLICA_SETTINGS: ReadonlyArray<string> = ["size", "min_size"];

// The most OSDs one ok-to-stop / safe-to-destroy check may name.
const MAX_OSD_IDS_PER_CHECK: number = 32;

// The most cluster-log lines log last may print.
const MAX_LOG_LAST_LINES: number = 1000;

/*
 * ---- Argument shapes ----------------------------------------------------------
 *
 * Each is anchored, ASCII-only and linear. None accepts a word that starts
 * with "-" (argparse would read it as an option) or "@".
 */

// An OSD id as ceph reads one, "3" or "osd.3", without leading zeros.
const OSD_ID_REGEX: RegExp = /^(?:osd\.)?(0|[1-9][0-9]{0,5})$/;

// An OSD's number alone: the ID of an "osd.ID" daemon.
const OSD_NUMBER_REGEX: RegExp = /^(?:0|[1-9][0-9]{0,5})$/;

// A pool name: ".mgr" and ".rgw.root" are real pools.
const POOL_NAME_REGEX: RegExp = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,127}$/;

// A pool setting osd pool get may read ("size", "pg_num", "nodeep-scrub").
const POOL_VARIABLE_REGEX: RegExp = /^[a-z][a-z0-9_-]{0,63}$/;

// A PG id, POOL.SEED in lowercase hex, as ceph prints it (no leading zeros).
const PGID_REGEX: RegExp =
  /^(?:0|[1-9][0-9]{0,9})\.(?:0|[1-9a-f][0-9a-f]{0,7})$/;

// A cephadm daemon name: TYPE.ID ("osd.3", "mon.host1", "rgw.a.host1.xyz").
const DAEMON_NAME_REGEX: RegExp =
  /^([a-z][a-z0-9-]{0,31})\.([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/;

// A cephadm daemon type ("osd", "node-exporter").
const DAEMON_TYPE_REGEX: RegExp = /^[a-z][a-z0-9-]{0,31}$/;

// A cephadm service name: TYPE or TYPE.ID ("mon", "osd.all-available-devices").
const SERVICE_NAME_REGEX: RegExp =
  /^[a-z][a-z0-9-]{0,31}(?:\.[A-Za-z0-9][A-Za-z0-9_.-]{0,127})?$/;

// A manager daemon's name as mgr fail takes it ("host1.abcdef").
const MGR_NAME_REGEX: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

// A file system's name.
const FS_NAME_REGEX: RegExp = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/*
 * A crash report id: its UTC timestamp and a UUID
 * ("2024-05-21T10:15:42.123456Z_0c7d3c6e-..."); Nautilus wrote "_" where
 * later releases write "T".
 */
const CRASH_ID_REGEX: RegExp =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T_][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A whole number of seconds (pg dump_stuck's threshold).
const SECONDS_REGEX: RegExp = /^(?:0|[1-9][0-9]{0,8})$/;

// A digit string of any length, to tell "out of range" from "not a number".
const DIGITS_REGEX: RegExp = /^[0-9]+$/;

// An OSD weight: 0 to 1 with at most four decimals ("0", "0.85", "1.0").
const WEIGHT_REGEX: RegExp = /^[01](?:\.[0-9]{1,4})?$/;

// A pool's replica count (ceph caps size at 10).
const REPLICA_COUNT_REGEX: RegExp = /^(?:[1-9]|10)$/;

// A word that starts with a digit is a PG id to `ceph pg ...`.
const STARTS_WITH_DIGIT_REGEX: RegExp = /^[0-9]/;

/*
 * ---- Options ------------------------------------------------------------------
 */

const LONG_FORMAT_OPTION: string = "--format";
const SHORT_FORMAT_OPTION: string = "-f";
const STATUS_OPTION: string = "-s";

// "-fjson" / "-foo": argparse reads -f with an inline value.
const INLINE_SHORT_FORMAT_REGEX: RegExp = /^-f[^-]/;

// "-sw", "-sf", "-s=1": -s combined with something else.
const COMBINED_STATUS_REGEX: RegExp = /^-s./;

// The named arguments orch ps takes, each spelling mapped to its argument.
const ORCH_PS_OPTIONS: Readonly<Record<string, string>> = {
  "--daemon_type": "daemon_type",
  "--daemon-type": "daemon_type",
  "--service_name": "service_name",
  "--service-name": "service_name",
  "--refresh": "refresh",
};

const OPTION_LIST_FOR_HUMANS: string =
  "the only options accepted are --format json|json-pretty|plain (or -f json), -s on its own (ceph status), and --daemon_type TYPE, --service_name NAME and --refresh after orch ps";

/*
 * Options (and configuration overrides) refused with their own reason, so
 * the model learns why rather than only that. Any other dash-prefixed word
 * is refused with the generic reason. Compared after dropping an inline
 * "=value" and reading "_" as "-", the way ceph reads configuration names.
 */
const DENIED_OPTION_GROUPS: ReadonlyArray<{
  reason: string;
  options: ReadonlyArray<string>;
}> = [
  {
    reason:
      "the agent connects with its own configuration, keyring and identity, so a command may not choose another cluster, monitor, user or key",
    options: [
      "-c",
      "--conf",
      "-k",
      "--keyring",
      "--keyfile",
      "--key",
      "--id",
      "--user",
      "-n",
      "--name",
      "--cluster",
      "-m",
      "--mon-host",
      "--mon-addr",
      "--setuser",
      "--setgroup",
      "--auth-client-required",
      "--auth-cluster-required",
      "--auth-service-required",
      "--auth-supported",
    ],
  },
  {
    reason:
      "it makes ceph read or write a file on the agent's machine (-i/--in-file, -o/--out-file, log files)",
    options: [
      "-i",
      "--in-file",
      "-o",
      "--out-file",
      "--log-file",
      "--log-to-file",
      "--log-to-stderr",
      "--err-to-stderr",
      "--admin-socket",
    ],
  },
  {
    reason:
      "it sends the command to a daemon's admin socket, which accepts any command that daemon has",
    options: ["--admin-daemon"],
  },
  {
    reason:
      "it watches the cluster until it is killed; read recent events with ceph log last or the state with ceph status instead",
    options: [
      "-w",
      "--watch",
      "--watch-debug",
      "--watch-info",
      "--watch-sec",
      "--watch-warn",
      "--watch-error",
      "-W",
      "--watch-channel",
    ],
  },
  {
    reason:
      "it confirms a destructive change, and destructive changes never run",
    options: [
      "--yes-i-really-mean-it",
      "--yes-i-really-really-mean-it",
      "--yes-i-really-really-mean-it-not-faking",
      "--i-know-what-i-am-doing",
      "--force",
    ],
  },
  {
    reason:
      "it prints ceph's help; the read and write command guides list what may run",
    options: ["-h", "--help", "--help-all", "--completion"],
  },
  {
    reason: "the agent sets its own timeouts and never polls",
    options: ["--connect-timeout", "--period", "-p", "--block"],
  },
  {
    reason: "write ceph status (or -s) instead",
    options: ["--status"],
  },
  {
    reason: "write ceph version (or ceph versions) instead",
    options: ["-v", "--version"],
  },
  {
    reason: "it changes how much ceph prints; write the command without it",
    options: ["--verbose", "--concise"],
  },
];

const DENIED_OPTION_REASONS: Map<string, string> = new Map<string, string>();

for (const group of DENIED_OPTION_GROUPS) {
  for (const option of group.options) {
    DENIED_OPTION_REASONS.set(option, group.reason);
  }
}

// Why a dash-prefixed word is refused, in words for the model.
function describeOptionRefusal(word: string): string {
  const shown: string = `"${word}"`;

  if (word === "--") {
    return `${shown} is not needed: no ceph command OneUptime AI may run takes a word that starts with "-", and ${OPTION_LIST_FOR_HUMANS}`;
  }

  const equals: number = word.indexOf("=");
  const name: string = equals >= 0 ? word.slice(0, equals) : word;

  if (name === SHORT_FORMAT_OPTION || INLINE_SHORT_FORMAT_REGEX.test(word)) {
    return `${shown} is not accepted: write the output format as its own word, --format json (or -f json), with json, json-pretty or plain`;
  }

  if (COMBINED_STATUS_REGEX.test(word)) {
    return `${shown} is not accepted: -s must stand alone (it is ceph status), and ${OPTION_LIST_FOR_HUMANS}`;
  }

  const normalized: string = name.startsWith("--")
    ? `--${name.slice(2).replace(/_/g, "-")}`
    : name;
  let groupReason: string | undefined = DENIED_OPTION_REASONS.get(normalized);

  if (!groupReason && normalized.startsWith("--watch")) {
    groupReason = DENIED_OPTION_REASONS.get("--watch");
  }

  if (!groupReason && normalized.startsWith("--debug")) {
    groupReason =
      "it changes ceph's debug logging, which ceph reads as a configuration override";
  }

  if (groupReason) {
    return `${shown} is not accepted: ${groupReason}`;
  }

  if (
    normalized.length >= 3 &&
    normalized !== LONG_FORMAT_OPTION &&
    LONG_FORMAT_OPTION.startsWith(normalized)
  ) {
    return `${shown} is not accepted: ceph would read it as an abbreviation of --format, so write --format in full`;
  }

  return `${shown} is not an option OneUptime AI may pass to ceph: ceph reads an option it does not know as an abbreviation of one it does (--out is --out-file) or as a configuration override (--keyring, --mon-host, --log-file), so ${OPTION_LIST_FOR_HUMANS}`;
}

/*
 * The command line with ceph's own options taken out, the way argparse
 * takes them out: the command words in order (orch ps's named arguments
 * among them), the output format, and whether -s was given.
 */
interface CephCommandLine {
  words: Array<string>;
  format: string | null;
  status: boolean;
}

function formatRefusal(value: string | undefined): string {
  if (value === undefined) {
    return "--format (or -f) needs a value: json, json-pretty or plain";
  }

  return `"${value}" is not an output format OneUptime AI may ask for: --format (or -f) takes json, json-pretty or plain`;
}

/*
 * Take the output format and -s out of the words, wherever they are (see
 * the header). Returns why the words cannot be read, or the command line.
 */
function readCommandLine(args: Array<string>): CephCommandLine | string {
  const words: Array<string> = [];
  let format: string | null = null;
  let status: boolean = false;

  for (let index: number = 0; index < args.length; index++) {
    const word: string = args[index] as string;
    let value: string | undefined;

    if (word === LONG_FORMAT_OPTION || word === SHORT_FORMAT_OPTION) {
      value = args[index + 1];
      index++;
    } else if (word.startsWith(`${LONG_FORMAT_OPTION}=`)) {
      value = word.slice(LONG_FORMAT_OPTION.length + 1);
    } else if (word === STATUS_OPTION) {
      if (status) {
        return "-s is given twice; write it once";
      }

      status = true;
      continue;
    } else {
      words.push(word);
      continue;
    }

    if (format !== null) {
      return "the output format is given twice (ceph would keep only the last); give --format once";
    }

    if (value === undefined || !CEPH_OUTPUT_FORMATS.includes(value)) {
      return formatRefusal(value);
    }

    format = value;
  }

  return { words, format, status };
}

/*
 * ---- Commands -------------------------------------------------------------------
 */

interface CephVerdict {
  tier: ResourceCommandTier;
  reason: string;
  targets: Array<string>;
  requiresHuman?: boolean | undefined;
}

// Reads the words after a rule's command words: a verdict, or why not.
type CephArgumentReader = (rest: Array<string>) => CephVerdict | string;

interface CephCommandRule {
  // The command's exact words, e.g. ["osd", "pool", "get"].
  words: ReadonlyArray<string>;
  // What follows them, for refusals ("POOL VAR|all").
  usage: string;
  readArguments: CephArgumentReader;
}

function read(reason: string): CephVerdict {
  return { tier: ResourceCommandTier.Read, reason, targets: [] };
}

function safeWrite(reason: string, targets: Array<string>): CephVerdict {
  return { tier: ResourceCommandTier.SafeWrite, reason, targets };
}

function riskyWrite(
  reason: string,
  targets: Array<string>,
  requiresHuman: boolean = false,
): CephVerdict {
  const verdict: CephVerdict = {
    tier: ResourceCommandTier.RiskyWrite,
    reason,
    targets,
  };

  if (requiresHuman) {
    verdict.requiresHuman = true;
  }

  return verdict;
}

// The canonical target of an OSD id word, or null when it is not one.
function osdTarget(word: string | undefined): string | null {
  if (typeof word !== "string") {
    return null;
  }

  const match: RegExpExecArray | null = OSD_ID_REGEX.exec(word);
  return match ? `osd.${match[1]}` : null;
}

function describeBadOsdId(word: string | undefined): string {
  if (word === undefined) {
    return "it needs an OSD id, such as 3 or osd.3";
  }

  return `"${word}" is not an OSD id: write one OSD as its number or osd.NUMBER (3 or osd.3), without leading zeros`;
}

function describeBadPgid(word: string | undefined): string {
  if (word === undefined) {
    return "it needs a PG id, such as 1.2f";
  }

  return `"${word}" is not a PG id: write it as POOL.SEED the way ceph prints it, such as 1.2f (lowercase hex, no leading zeros)`;
}

function describeBadPool(word: string | undefined): string {
  if (word === undefined) {
    return "it needs a pool name";
  }

  return `"${word}" is not a pool name OneUptime AI may use: letters, digits, "_", "." and "-" (not first), at most 128 characters`;
}

function describeBadCrashId(word: string | undefined): string {
  if (word === undefined) {
    return "it needs a crash id from ceph crash ls";
  }

  return `"${word}" is not a crash id: copy one from ceph crash ls (TIMESTAMP_UUID, such as 2024-05-21T10:15:42.123456Z_0c7d3c6e-1b2a-4c3d-9e8f-0123456789ab)`;
}

// The canonical daemon name, or null (an OSD daemon's id is its number).
function daemonTarget(word: string | undefined): string | null {
  if (typeof word !== "string") {
    return null;
  }

  const match: RegExpExecArray | null = DAEMON_NAME_REGEX.exec(word);

  if (!match) {
    return null;
  }

  if (match[1] === "osd" && !OSD_NUMBER_REGEX.test(match[2] || "")) {
    return null;
  }

  return word;
}

function describeBadDaemon(word: string | undefined): string {
  if (word === undefined) {
    return "it needs one daemon name from ceph orch ps, such as osd.3 or mon.host1";
  }

  return `"${word}" is not a cephadm daemon name: write one daemon as TYPE.ID exactly as ceph orch ps lists it (osd.3, mon.host1, rgw.store.host1.abcdef)`;
}

// Exactly one word, checked by `accept`; the rest refused.
function exactlyOne(
  rest: Array<string>,
  describeBad: (word: string | undefined) => string,
  accept: (word: string) => CephVerdict | null,
): CephVerdict | string {
  if (rest.length === 0) {
    return describeBad(undefined);
  }

  if (rest.length > 1) {
    return `it takes exactly one argument, and ${rest.length} were given: run one command per object`;
  }

  const verdict: CephVerdict | null = accept(rest[0] as string);
  return verdict || describeBad(rest[0]);
}

function noArguments(reason: string): CephArgumentReader {
  return (rest: Array<string>): CephVerdict | string => {
    return rest.length === 0 ? read(reason) : "it takes no arguments";
  };
}

// No arguments, or one optional keyword ("detail", "tree").
function optionalKeyword(
  keyword: string,
  reason: string,
  keywordReason: string,
): CephArgumentReader {
  return (rest: Array<string>): CephVerdict | string => {
    if (rest.length === 0) {
      return read(reason);
    }

    if (rest.length === 1 && rest[0] === keyword) {
      return read(keywordReason);
    }

    return `the only word it takes is "${keyword}"`;
  };
}

// Zero or more distinct words from `choices`.
function distinctChoices(
  rest: Array<string>,
  choices: ReadonlyArray<string>,
): string | null {
  const seen: Set<string> = new Set<string>();

  for (const word of rest) {
    if (!choices.includes(word)) {
      return `"${word}" is not one of ${choices.join(", ")}`;
    }

    if (seen.has(word)) {
      return `"${word}" is given twice`;
    }

    seen.add(word);
  }

  return null;
}

// One to MAX_OSD_IDS_PER_CHECK OSD ids (ok-to-stop, safe-to-destroy).
function osdIdList(reason: string): CephArgumentReader {
  return (rest: Array<string>): CephVerdict | string => {
    if (rest.length === 0) {
      return describeBadOsdId(undefined);
    }

    if (rest.length > MAX_OSD_IDS_PER_CHECK) {
      return `it may name at most ${MAX_OSD_IDS_PER_CHECK} OSDs`;
    }

    for (const word of rest) {
      if (!osdTarget(word)) {
        return describeBadOsdId(word);
      }
    }

    return read(reason);
  };
}

function readOsdFlag(
  rest: Array<string>,
  verdictFor: (flag: string) => CephVerdict,
): CephVerdict | string {
  return exactlyOne(
    rest,
    (word: string | undefined): string => {
      return word === undefined
        ? `it needs one flag: ${CEPH_OSD_FLAGS.join(", ")}`
        : `"${word}" is not a flag OneUptime AI may change: only ${CEPH_OSD_FLAGS.join(", ")} (flags such as noup, nodown, noin, full and sortbitwise are never changed)`;
    },
    (word: string): CephVerdict | null => {
      return CEPH_OSD_FLAGS.includes(word) ? verdictFor(word) : null;
    },
  );
}

function readOrchPsArguments(rest: Array<string>): CephVerdict | string {
  const seen: Set<string> = new Set<string>();
  let index: number = 0;

  while (index < rest.length) {
    const word: string = rest[index] as string;
    const argument: string | undefined = Object.prototype.hasOwnProperty.call(
      ORCH_PS_OPTIONS,
      word,
    )
      ? ORCH_PS_OPTIONS[word]
      : undefined;

    if (!argument) {
      return `"${word}" is not accepted: orch ps takes only --daemon_type TYPE, --service_name NAME and --refresh (to list one host's daemons, filter the full list)`;
    }

    if (seen.has(argument)) {
      return `--${argument} is given twice; give it once`;
    }

    seen.add(argument);

    if (argument === "refresh") {
      index++;
      continue;
    }

    const value: string | undefined = rest[index + 1];
    const valid: boolean =
      typeof value === "string" &&
      (argument === "daemon_type"
        ? DAEMON_TYPE_REGEX.test(value)
        : SERVICE_NAME_REGEX.test(value));

    if (!valid) {
      return value === undefined
        ? `${word} needs a value`
        : `"${value}" is not a ${
            argument === "daemon_type"
              ? "daemon type (osd, mon, mgr, mds, rgw, crash, ...)"
              : "service name (mon, osd.all-available-devices, rgw.store, ...)"
          }`;
    }

    index += 2;
  }

  return read(
    "lists the daemons cephadm manages, with their hosts, status and versions",
  );
}

function readLogLastArguments(rest: Array<string>): CephVerdict | string {
  let index: number = 0;
  const first: string | undefined = rest[0];

  if (first !== undefined && DIGITS_REGEX.test(first)) {
    const count: number = Number(first);

    if (
      first.length > 4 ||
      first.startsWith("0") ||
      count < 1 ||
      count > MAX_LOG_LAST_LINES
    ) {
      return `"${first}" is not a line count OneUptime AI may ask for: 1 to ${MAX_LOG_LAST_LINES}`;
    }

    index++;
  }

  if (index < rest.length && LOG_LEVELS.includes(rest[index] as string)) {
    index++;
  }

  if (index < rest.length && LOG_CHANNELS.includes(rest[index] as string)) {
    index++;
  }

  if (index < rest.length) {
    return `"${rest[index]}" is not accepted here: the arguments are an optional line count (1 to ${MAX_LOG_LAST_LINES}), then a level (${LOG_LEVELS.join(", ")}), then a channel (${LOG_CHANNELS.join(", ")}), in that order`;
  }

  return read("reads the most recent entries of the cluster log");
}

function readDumpStuckArguments(rest: Array<string>): CephVerdict | string {
  const states: Array<string> = rest.slice();
  const last: string | undefined = states[states.length - 1];

  if (last !== undefined && SECONDS_REGEX.test(last)) {
    states.pop();
  }

  const problem: string | null = distinctChoices(states, STUCK_PG_STATES);

  if (problem) {
    return `${problem}; it takes stuck states (${STUCK_PG_STATES.join(", ")}) and then an optional threshold in seconds`;
  }

  return read("lists the placement groups stuck in a state");
}

function readPoolGetArguments(rest: Array<string>): CephVerdict | string {
  if (rest.length !== 2) {
    return "it takes a pool name and one setting (or all)";
  }

  const [pool, variable] = rest as [string, string];

  if (!POOL_NAME_REGEX.test(pool)) {
    return describeBadPool(pool);
  }

  if (variable !== "all" && !POOL_VARIABLE_REGEX.test(variable)) {
    return `"${variable}" is not a pool setting: name one (size, min_size, pg_num, crush_rule, ...) or all`;
  }

  return read(`reads pool ${pool}'s settings`);
}

function readPoolSetArguments(rest: Array<string>): CephVerdict | string {
  if (rest.length !== 3) {
    return "it takes a pool name, size or min_size, and a count";
  }

  const [pool, variable, value] = rest as [string, string, string];

  if (!POOL_NAME_REGEX.test(pool)) {
    return describeBadPool(pool);
  }

  if (!POOL_REPLICA_SETTINGS.includes(variable)) {
    return `"${variable}" is not a pool setting OneUptime AI may change: only size and min_size (pg_num, crush_rule, nodelete, quotas and every other pool setting are never changed)`;
  }

  if (!REPLICA_COUNT_REGEX.test(value)) {
    return `"${value}" is not a replica count: 1 to 10`;
  }

  return variable === "size"
    ? riskyWrite(
        `sets pool ${pool}'s replica count (size) to ${value}, which re-replicates or discards a copy of every object in the pool`,
        [pool],
        true,
      )
    : riskyWrite(
        `sets the number of replicas pool ${pool} needs to serve I/O (min_size) to ${value}, which can block the pool's I/O or accept writes with too few copies`,
        [pool],
        true,
      );
}

function readReweightArguments(rest: Array<string>): CephVerdict | string {
  if (rest.length !== 2) {
    return "it takes one OSD id and a weight from 0 to 1";
  }

  const [id, weight] = rest as [string, string];
  const target: string | null = osdTarget(id);

  if (!target) {
    return describeBadOsdId(id);
  }

  if (!WEIGHT_REGEX.test(weight) || Number(weight) > 1) {
    return `"${weight}" is not a weight: 0 to 1, such as 0.85`;
  }

  return riskyWrite(
    `overrides ${target}'s weight to ${weight}, which moves data off (or back onto) it (undo: ceph osd reweight ${id} 1)`,
    [target],
  );
}

function readMgrFailArguments(rest: Array<string>): CephVerdict | string {
  if (rest.length === 0) {
    return riskyWrite(
      "fails the active manager over to a standby, restarting every manager module",
      [CEPH_CLUSTER_TARGET],
    );
  }

  if (rest.length > 1 || !MGR_NAME_REGEX.test(rest[0] as string)) {
    return "it takes at most one manager name, as ceph mgr stat shows it";
  }

  return riskyWrite(
    `fails manager ${rest[0]} over to a standby, restarting every manager module`,
    [`mgr.${rest[0]}`],
  );
}

/*
 * Every command OneUptime AI may run, by its exact words. No rule's words
 * are a prefix of another's, so the longest match is the only match.
 */
const COMMAND_RULES: ReadonlyArray<CephCommandRule> = [
  // ---- Cluster ----
  {
    words: ["status"],
    usage: "",
    readArguments: noArguments(
      "reads the cluster's status: health, monitors, OSDs, PGs and usage",
    ),
  },
  {
    words: ["health"],
    usage: "[detail]",
    readArguments: optionalKeyword(
      "detail",
      "reads the cluster's health",
      "reads every health check and what it affects",
    ),
  },
  {
    words: ["df"],
    usage: "[detail]",
    readArguments: optionalKeyword(
      "detail",
      "reads the cluster's and each pool's usage",
      "reads the cluster's and each pool's detailed usage",
    ),
  },
  {
    words: ["versions"],
    usage: "",
    readArguments: noArguments("reads the versions every daemon runs"),
  },
  {
    words: ["version"],
    usage: "",
    readArguments: noArguments("reads the monitors' version"),
  },
  {
    words: ["progress"],
    usage: "",
    readArguments: noArguments(
      "reads the progress of recovery and other long-running events",
    ),
  },
  {
    words: ["quorum_status"],
    usage: "",
    readArguments: noArguments("reads the monitor quorum"),
  },
  {
    words: ["log", "last"],
    usage: "[N] [debug|info|sec|warn|error] [*|cluster|audit|cephadm]",
    readArguments: readLogLastArguments,
  },

  // ---- OSDs ----
  {
    words: ["osd", "tree"],
    usage: "[up|down|in|out|destroyed]...",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      const problem: string | null = distinctChoices(rest, OSD_TREE_STATES);
      return problem
        ? problem
        : read("reads the OSD tree and each OSD's state");
    },
  },
  {
    words: ["osd", "df"],
    usage: "[tree]",
    readArguments: optionalKeyword(
      "tree",
      "reads each OSD's usage",
      "reads each OSD's usage along the CRUSH tree",
    ),
  },
  {
    words: ["osd", "perf"],
    usage: "",
    readArguments: noArguments("reads each OSD's commit and apply latency"),
  },
  {
    words: ["osd", "stat"],
    usage: "",
    readArguments: noArguments("reads how many OSDs are up and in"),
  },
  {
    words: ["osd", "dump"],
    usage: "",
    readArguments: noArguments("reads the OSD map"),
  },
  {
    words: ["osd", "blocked-by"],
    usage: "",
    readArguments: noArguments("reads which OSDs are blocking peering"),
  },
  {
    words: ["osd", "find"],
    usage: "ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadOsdId, (word: string) => {
        return osdTarget(word) ? read("reads where an OSD runs") : null;
      });
    },
  },
  {
    words: ["osd", "metadata"],
    usage: "[ID]",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      if (rest.length === 0) {
        return read("reads every OSD's metadata");
      }

      return exactlyOne(rest, describeBadOsdId, (word: string) => {
        return osdTarget(word) ? read("reads an OSD's metadata") : null;
      });
    },
  },
  {
    words: ["osd", "ok-to-stop"],
    usage: "ID...",
    readArguments: osdIdList(
      "checks whether stopping these OSDs would leave PGs unavailable (changes nothing)",
    ),
  },
  {
    words: ["osd", "safe-to-destroy"],
    usage: "ID...",
    readArguments: osdIdList(
      "checks whether these OSDs still hold data the cluster needs (changes nothing)",
    ),
  },

  // ---- Pools ----
  {
    words: ["osd", "pool", "ls"],
    usage: "[detail]",
    readArguments: optionalKeyword(
      "detail",
      "lists the pools",
      "lists the pools and their settings",
    ),
  },
  {
    words: ["osd", "pool", "stats"],
    usage: "[POOL]",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      if (rest.length === 0) {
        return read("reads every pool's I/O and recovery rates");
      }

      return exactlyOne(rest, describeBadPool, (word: string) => {
        return POOL_NAME_REGEX.test(word)
          ? read("reads a pool's I/O and recovery rates")
          : null;
      });
    },
  },
  {
    words: ["osd", "pool", "get"],
    usage: "POOL VAR|all",
    readArguments: readPoolGetArguments,
  },

  // ---- Placement groups ----
  {
    words: ["pg", "stat"],
    usage: "",
    readArguments: noArguments("reads a summary of PG states"),
  },
  {
    words: ["pg", "dump_stuck"],
    usage: "[inactive|unclean|stale|undersized|degraded]... [SECONDS]",
    readArguments: readDumpStuckArguments,
  },
  {
    words: ["pg", "ls-by-osd"],
    usage: "ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadOsdId, (word: string) => {
        return osdTarget(word) ? read("lists the PGs on an OSD") : null;
      });
    },
  },
  {
    words: ["pg", "ls-by-primary"],
    usage: "ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadOsdId, (word: string) => {
        return osdTarget(word)
          ? read("lists the PGs an OSD is primary for")
          : null;
      });
    },
  },
  {
    words: ["pg", "ls-by-pool"],
    usage: "POOL",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadPool, (word: string) => {
        return POOL_NAME_REGEX.test(word) ? read("lists a pool's PGs") : null;
      });
    },
  },

  // ---- Monitors, managers, file systems ----
  {
    words: ["mon", "stat"],
    usage: "",
    readArguments: noArguments("reads the monitors and the quorum"),
  },
  {
    words: ["mon", "dump"],
    usage: "",
    readArguments: noArguments("reads the monitor map"),
  },
  {
    words: ["mgr", "stat"],
    usage: "",
    readArguments: noArguments("reads which manager is active"),
  },
  {
    words: ["mgr", "services"],
    usage: "",
    readArguments: noArguments("reads the endpoints the manager modules serve"),
  },
  {
    words: ["mgr", "module", "ls"],
    usage: "",
    readArguments: noArguments("lists the manager modules"),
  },
  {
    words: ["fs", "status"],
    usage: "[FS]",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      if (rest.length === 0) {
        return read("reads the file systems' MDS ranks and pools");
      }

      return exactlyOne(
        rest,
        (word: string | undefined): string => {
          return word === undefined
            ? "it needs a file system name"
            : `"${word}" is not a file system name`;
        },
        (word: string) => {
          return FS_NAME_REGEX.test(word)
            ? read("reads a file system's MDS ranks and pools")
            : null;
        },
      );
    },
  },
  {
    words: ["fs", "ls"],
    usage: "",
    readArguments: noArguments("lists the file systems"),
  },
  {
    words: ["mds", "stat"],
    usage: "",
    readArguments: noArguments("reads the MDS daemons' states"),
  },
  {
    words: ["balancer", "status"],
    usage: "",
    readArguments: noArguments("reads the balancer's mode and state"),
  },

  // ---- Crash reports ----
  {
    words: ["crash", "ls"],
    usage: "",
    readArguments: noArguments("lists the crash reports"),
  },
  {
    words: ["crash", "ls-new"],
    usage: "",
    readArguments: noArguments("lists the crash reports not yet archived"),
  },
  {
    words: ["crash", "stat"],
    usage: "",
    readArguments: noArguments("counts the crash reports by age"),
  },
  {
    words: ["crash", "info"],
    usage: "CRASH_ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadCrashId, (word: string) => {
        return CRASH_ID_REGEX.test(word)
          ? read("reads one crash report and its backtrace")
          : null;
      });
    },
  },

  // ---- cephadm ----
  {
    words: ["orch", "ps"],
    usage: "[--daemon_type TYPE] [--service_name NAME] [--refresh]",
    readArguments: readOrchPsArguments,
  },
  {
    words: ["orch", "ls"],
    usage: "",
    readArguments: noArguments("lists the services cephadm manages"),
  },
  {
    words: ["orch", "host", "ls"],
    usage: "",
    readArguments: noArguments("lists the hosts cephadm manages"),
  },
  {
    words: ["orch", "device", "ls"],
    usage: "",
    readArguments: noArguments("lists the storage devices cephadm sees"),
  },

  // ---- Changes: one OSD ----
  {
    words: ["osd", "in"],
    usage: "ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadOsdId, (word: string) => {
        const target: string | null = osdTarget(word);
        return target
          ? safeWrite(
              `marks ${target} in, so CRUSH maps data back to it (undo: ceph osd out ${word})`,
              [target],
            )
          : null;
      });
    },
  },
  {
    words: ["osd", "out"],
    usage: "ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadOsdId, (word: string) => {
        const target: string | null = osdTarget(word);
        return target
          ? riskyWrite(
              `marks ${target} out, so CRUSH moves its data to other OSDs (undo: ceph osd in ${word})`,
              [target],
            )
          : null;
      });
    },
  },
  {
    words: ["osd", "down"],
    usage: "ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadOsdId, (word: string) => {
        const target: string | null = osdTarget(word);
        return target
          ? riskyWrite(
              `marks ${target} down, so its PGs re-peer without it until the OSD, if it is running, marks itself up again`,
              [target],
            )
          : null;
      });
    },
  },
  {
    words: ["osd", "reweight"],
    usage: "ID WEIGHT",
    readArguments: readReweightArguments,
  },

  // ---- Changes: cluster-wide flags ----
  {
    words: ["osd", "unset"],
    usage: CEPH_OSD_FLAGS.join("|"),
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return readOsdFlag(rest, (flag: string): CephVerdict => {
        return safeWrite(
          `clears the cluster-wide ${flag} flag (while set, ${OSD_FLAG_EFFECTS[flag]}), returning the cluster to normal (undo: ceph osd set ${flag})`,
          [CEPH_CLUSTER_TARGET],
        );
      });
    },
  },
  {
    words: ["osd", "set"],
    usage: CEPH_OSD_FLAGS.join("|"),
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return readOsdFlag(rest, (flag: string): CephVerdict => {
        return riskyWrite(
          `sets the cluster-wide ${flag} flag: until it is unset, ${OSD_FLAG_EFFECTS[flag]} (undo: ceph osd unset ${flag})`,
          [CEPH_CLUSTER_TARGET],
          flag === CLIENT_IO_PAUSE_FLAG,
        );
      });
    },
  },
  {
    words: ["balancer", "on"],
    usage: "",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return rest.length === 0
        ? riskyWrite(
            "turns the automatic balancer on, which starts moving PGs between OSDs (undo: ceph balancer off)",
            [CEPH_CLUSTER_TARGET],
          )
        : "it takes no arguments";
    },
  },
  {
    words: ["balancer", "off"],
    usage: "",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return rest.length === 0
        ? riskyWrite(
            "turns the automatic balancer off, so PGs stop being rebalanced (undo: ceph balancer on)",
            [CEPH_CLUSTER_TARGET],
          )
        : "it takes no arguments";
    },
  },

  // ---- Changes: placement groups ----
  {
    words: ["pg", "scrub"],
    usage: "PGID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadPgid, (word: string) => {
        return PGID_REGEX.test(word)
          ? safeWrite(
              `schedules a scrub of PG ${word}, which compares its replicas' metadata and changes no data`,
              [word],
            )
          : null;
      });
    },
  },
  {
    words: ["pg", "deep-scrub"],
    usage: "PGID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadPgid, (word: string) => {
        return PGID_REGEX.test(word)
          ? safeWrite(
              `schedules a deep scrub of PG ${word}, which reads and checksums every replica and changes no data`,
              [word],
            )
          : null;
      });
    },
  },
  {
    words: ["pg", "repair"],
    usage: "PGID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadPgid, (word: string) => {
        return PGID_REGEX.test(word)
          ? riskyWrite(
              `repairs PG ${word}, overwriting the replicas ceph judges inconsistent with the copy it judges authoritative`,
              [word],
            )
          : null;
      });
    },
  },

  // ---- Changes: pools ----
  {
    words: ["osd", "pool", "set"],
    usage: "POOL size|min_size N",
    readArguments: readPoolSetArguments,
  },

  // ---- Changes: managers and cephadm daemons ----
  {
    words: ["mgr", "fail"],
    usage: "[NAME]",
    readArguments: readMgrFailArguments,
  },
  {
    words: ["orch", "daemon", "restart"],
    usage: "TYPE.ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadDaemon, (word: string) => {
        const target: string | null = daemonTarget(word);
        return target
          ? safeWrite(
              `restarts one cephadm daemon, ${target}, which comes back with the same configuration`,
              [target],
            )
          : null;
      });
    },
  },
  {
    words: ["orch", "daemon", "stop"],
    usage: "TYPE.ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadDaemon, (word: string) => {
        const target: string | null = daemonTarget(word);
        return target
          ? riskyWrite(
              `stops one cephadm daemon, ${target}, until it is started again (undo: ceph orch daemon start ${target})`,
              [target],
            )
          : null;
      });
    },
  },
  {
    words: ["orch", "daemon", "start"],
    usage: "TYPE.ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadDaemon, (word: string) => {
        const target: string | null = daemonTarget(word);
        return target
          ? riskyWrite(`starts one cephadm daemon, ${target}`, [target])
          : null;
      });
    },
  },
  {
    words: ["orch", "restart"],
    usage: "SERVICE",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(
        rest,
        (word: string | undefined): string => {
          return word === undefined
            ? "it needs one service name from ceph orch ls, such as mgr or rgw.store"
            : `"${word}" is not a cephadm service name: write one service exactly as ceph orch ls lists it (mon, mgr, osd.all-available-devices, rgw.store)`;
        },
        (word: string) => {
          return SERVICE_NAME_REGEX.test(word)
            ? riskyWrite(
                `restarts every daemon of the cephadm service ${word}`,
                [word],
              )
            : null;
        },
      );
    },
  },

  // ---- Changes: crash reports ----
  {
    words: ["crash", "archive"],
    usage: "CRASH_ID",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return exactlyOne(rest, describeBadCrashId, (word: string) => {
        return CRASH_ID_REGEX.test(word)
          ? safeWrite(
              "archives one crash report so it no longer raises RECENT_CRASH; the report is kept (ceph crash ls still lists it)",
              [`${CEPH_CRASH_TARGET_PREFIX}${word}`],
            )
          : null;
      });
    },
  },
  {
    words: ["crash", "archive-all"],
    usage: "",
    readArguments: (rest: Array<string>): CephVerdict | string => {
      return rest.length === 0
        ? riskyWrite(
            "archives every crash report at once, clearing RECENT_CRASH without looking at each one (the reports are kept)",
            [CEPH_CLUSTER_TARGET],
          )
        : "it takes no arguments (archive one report with ceph crash archive CRASH_ID)";
    },
  },
];

/*
 * The exact command words of every command OneUptime AI may run on a Ceph
 * cluster ("osd pool get", "pg query" for `ceph pg PGID query`), for tests
 * and documentation.
 */
export const CEPH_COMMANDS: ReadonlyArray<string> = [
  ...COMMAND_RULES.map((rule: CephCommandRule): string => {
    return rule.words.join(" ");
  }),
  "pg query",
  "pg list_unfound",
];

/*
 * `ceph pg PGID CMD` is a command ceph sends to the PG's primary OSD, not
 * to the monitors. Only the two that change nothing are allowed:
 * mark_unfound_lost (which gives up on objects for good) and every other
 * PG command are Denied.
 */
const PG_TARGETED_COMMANDS: Readonly<Record<string, string>> = {
  query: "reads one PG's peering and recovery state",
  list_unfound: "lists the objects one PG cannot find",
};

/*
 * Families refused with their own reason, by their leading words. Only
 * asked when no rule matched, so `fs status` still reads while `fs rm` is
 * explained here. The longest matching key wins.
 */
const DENIED_FAMILY_REASONS: Readonly<Record<string, string>> = {
  auth: "ceph auth prints and changes cephx keys, the cluster's credentials",
  "config-key":
    "ceph config-key holds secrets (dashboard, RGW and cephadm credentials) and settings daemons act on",
  config:
    "ceph config changes daemon settings cluster-wide, and its dump, get, show and log print settings that can hold credentials",
  tell: "ceph tell runs commands inside a daemon (injectargs, config set, heap and debug commands)",
  daemon:
    "ceph daemon talks to a daemon's admin socket on the agent's machine, which accepts any command that daemon has",
  daemonperf:
    "ceph daemonperf talks to a daemon's admin socket on the agent's machine",
  injectargs: "injectargs changes daemon settings at runtime",
  "osd purge": "it deletes an OSD and its data from the cluster for good",
  "osd purge-new": "it deletes an OSD from the cluster for good",
  "osd destroy": "it destroys an OSD's data and keys for good",
  "osd rm": "it removes an OSD from the cluster",
  "osd lost": "it tells the cluster to give up on an OSD's data for good",
  "osd new": "it adds an OSD to the cluster",
  "osd create": "it adds an OSD to the cluster",
  "osd crush": "it changes the CRUSH map, which moves data across the cluster",
  "osd setcrushmap":
    "it replaces the CRUSH map, which moves data across the cluster",
  "osd getcrushmap":
    "it writes the binary CRUSH map (read the tree with ceph osd tree instead)",
  "osd setmaxosd": "it changes the OSD map's size",
  "osd require-osd-release":
    "it raises the minimum OSD release, which cannot be undone",
  "osd set-full-ratio":
    "it changes the ratio at which the cluster stops writes",
  "osd set-nearfull-ratio":
    "it changes the cluster's capacity warning threshold",
  "osd set-backfillfull-ratio":
    "it changes the ratio at which the cluster stops backfill",
  "osd set-group": "it sets flags on groups of OSDs (use one OSD at a time)",
  "osd unset-group":
    "it clears flags on groups of OSDs (use one OSD at a time)",
  "osd blocklist": "it cuts clients off from the cluster",
  "osd blacklist": "it cuts clients off from the cluster",
  "osd erasure-code-profile": "it changes erasure-code profiles",
  "osd tier": "it changes cache tiering, which moves data between pools",
  "osd primary-affinity": "it changes which OSDs serve reads",
  "osd primary-temp": "it overrides PG placement",
  "osd pg-temp": "it overrides PG placement",
  "osd pg-upmap": "it overrides PG placement",
  "osd pg-upmap-items": "it overrides PG placement",
  "osd pg-upmap-primary": "it overrides PG placement",
  "osd rm-pg-upmap": "it changes PG placement overrides",
  "osd rm-pg-upmap-items": "it changes PG placement overrides",
  "osd rm-pg-upmap-primary": "it changes PG placement overrides",
  "osd reweight-by-utilization":
    "it reweights many OSDs at once (reweight one with ceph osd reweight ID WEIGHT)",
  "osd reweight-by-pg":
    "it reweights many OSDs at once (reweight one with ceph osd reweight ID WEIGHT)",
  "osd test-reweight-by-utilization":
    "it is not a command OneUptime AI needs (read usage with ceph osd df)",
  "osd test-reweight-by-pg":
    "it is not a command OneUptime AI needs (read usage with ceph osd df)",
  "osd scrub":
    "it scrubs every PG on an OSD at once (scrub one PG with ceph pg scrub PGID)",
  "osd deep-scrub":
    "it deep-scrubs every PG on an OSD at once (deep-scrub one PG with ceph pg deep-scrub PGID)",
  "osd repair":
    "it repairs every PG on an OSD at once (repair one PG with ceph pg repair PGID)",
  "osd pool create": "it creates a pool",
  "osd pool delete": "it deletes a pool and every object in it",
  "osd pool rm": "it deletes a pool and every object in it",
  "osd pool rename":
    "it renames a pool, which breaks every client that uses it",
  "osd pool mksnap": "it creates pool snapshots",
  "osd pool rmsnap": "it deletes pool snapshots",
  "osd pool set-quota": "it changes a pool's quota, which can stop its writes",
  "osd pool application": "it changes which applications a pool is tagged for",
  "osd pool autoscale-status":
    "it is not among the pool reads OneUptime AI may run (read pool settings with ceph osd pool ls detail)",
  "osd pool":
    "only osd pool ls, stats and get read pools, and osd pool set POOL size|min_size N changes one (with a human)",
  fs: "only ceph fs status and ceph fs ls may run; the other fs commands create, remove, fail or reconfigure a file system",
  mds: "only ceph mds stat may run; the other mds commands change MDS daemons' state",
  mon: "only ceph mon stat and ceph mon dump may run; the other mon commands change monitor membership or settings",
  "mgr module":
    "only ceph mgr module ls may run; enabling or disabling a manager module changes what the cluster runs",
  mgr: "only ceph mgr stat, mgr services, mgr module ls and mgr fail [NAME] may run",
  orch: "only orch ps, ls, host ls, device ls, daemon restart|stop|start TYPE.ID and restart SERVICE may run; apply, rm, host, daemon rm, upgrade and the rest change what cephadm deploys",
  "orch daemon":
    "only ceph orch daemon restart|stop|start TYPE.ID may change a daemon (daemon rm and redeploy never run)",
  pg: "only pg stat, dump_stuck, ls-by-osd, ls-by-pool, ls-by-primary, PGID query, PGID list_unfound, scrub, deep-scrub and repair may run; the rest force PG creation, recovery or peering",
  crash:
    "only crash ls, ls-new, stat, info, archive and archive-all may run; crash rm and prune delete reports for good",
  log: "only ceph log last may run; ceph log TEXT writes a message into the cluster log",
  balancer:
    "only ceph balancer status, on and off may run; the other balancer commands change how it moves data",
  "health mute": "it mutes a health check, which hides a problem",
  "health unmute":
    "it unmutes health checks (only ceph health [detail] may run)",
  dashboard: "it manages the dashboard's users and credentials",
  restful: "it manages REST API keys",
  rgw: "it manages object gateway realms, zones and users",
  nfs: "it manages NFS exports and clusters",
  smb: "it manages SMB shares and clusters",
  telemetry: "it changes what the cluster reports outside itself",
  device: "it manages device health monitoring and lights",
  cephadm: "it manages cephadm's SSH keys and hosts",
  quorum: "it changes the monitor quorum",
  sync: "it forces monitor store syncs",
  heap: "it changes a daemon's memory allocator",
  osd: "the OSD commands that may run are osd tree, df, perf, stat, dump, blocked-by, find, metadata, ok-to-stop, safe-to-destroy (reads) and osd in, out, down, set, unset, reweight (changes)",
};

const SUPPORTED_COMMANDS_SUMMARY: string =
  "Reads: status (or -s), health [detail], df [detail], versions, progress, quorum_status, log last, osd tree|df|perf|stat|dump|blocked-by|find|metadata|ok-to-stop|safe-to-destroy, osd pool ls|stats|get, pg stat|dump_stuck|ls-by-osd|ls-by-pool|ls-by-primary, pg PGID query|list_unfound, mon stat|dump, mgr stat|services|module ls, fs status|ls, mds stat, balancer status, crash ls|ls-new|stat|info, orch ps|ls|host ls|device ls. Changes: osd in|out|down ID, osd set|unset FLAG, osd reweight ID W, pg scrub|deep-scrub|repair PGID, crash archive ID, crash archive-all, orch daemon restart|stop|start TYPE.ID, orch restart SERVICE, mgr fail [NAME], balancer on|off, osd pool set POOL size|min_size N";

/*
 * The family reason for these words, from their longest leading words down
 * to (but not including) `shortest` words; null when none names them.
 */
function findFamilyRefusal(
  words: Array<string>,
  shortest: number,
): string | null {
  const shown: string = `ceph ${renderResourceDisplayCommand(words)}`;

  for (
    let length: number = Math.min(3, words.length);
    length > shortest;
    length--
  ) {
    const key: string = words.slice(0, length).join(" ");

    if (Object.prototype.hasOwnProperty.call(DENIED_FAMILY_REASONS, key)) {
      return `"${shown}" is not allowed: ${DENIED_FAMILY_REASONS[key]}`;
    }
  }

  return null;
}

// Why no rule matched these words: a family reason, or the general one.
function describeUnknownCommand(words: Array<string>): string {
  return (
    findFamilyRefusal(words, 0) ||
    `"ceph ${renderResourceDisplayCommand(words)}" is not a command OneUptime AI may run on a Ceph cluster. ${SUPPORTED_COMMANDS_SUMMARY}`
  );
}

// `ceph pg PGID CMD`: the two PG commands that change nothing.
function evaluatePgTargeted(words: Array<string>): CephVerdict | string {
  const pgid: string = words[1] as string;

  if (!PGID_REGEX.test(pgid)) {
    return describeBadPgid(pgid);
  }

  const command: string | undefined = words[2];

  if (
    command === undefined ||
    !Object.prototype.hasOwnProperty.call(PG_TARGETED_COMMANDS, command)
  ) {
    return `ceph pg ${pgid} takes only query or list_unfound (mark_unfound_lost and every other PG command never run)`;
  }

  if (words.length > 3) {
    return `ceph pg ${pgid} ${command} takes no more arguments`;
  }

  return read(PG_TARGETED_COMMANDS[command] as string);
}

// The rule whose words start these words (longest first), or null.
function findRule(words: Array<string>): CephCommandRule | null {
  let best: CephCommandRule | null = null;

  for (const rule of COMMAND_RULES) {
    if (rule.words.length > words.length) {
      continue;
    }

    const matches: boolean = rule.words.every(
      (word: string, index: number): boolean => {
        return words[index] === word;
      },
    );

    if (matches && (!best || rule.words.length > best.words.length)) {
      best = rule;
    }
  }

  return best;
}

function commandResult(
  argv: Array<string>,
  verb: string,
  verdict: CephVerdict,
): ResourceCommandPolicyResult {
  const result: ResourceCommandPolicyResult = {
    tier: verdict.tier,
    reason: verdict.reason,
    program: CEPH_PROGRAM,
    args: argv.slice(1),
    verb,
    displayCommand: renderResourceDisplayCommand(argv),
    targets: verdict.targets.slice(),
  };

  if (verdict.requiresHuman === true) {
    result.requiresHuman = true;
  }

  return result;
}

function evaluateCephArgv(rawArgv: unknown): ResourceCommandPolicyResult {
  if (
    !Array.isArray(rawArgv) ||
    rawArgv.length === 0 ||
    rawArgv.some((word: unknown): boolean => {
      return typeof word !== "string";
    })
  ) {
    return deniedResult(
      rawArgv as Array<string>,
      "the command is not a list of words",
    );
  }

  const argv: Array<string> = (rawArgv as Array<string>).slice();

  if (argv[0] !== CEPH_PROGRAM) {
    return deniedResult(
      argv,
      `the ceph command policy only reads commands that start with "${CEPH_PROGRAM}"`,
    );
  }

  const args: Array<string> = argv.slice(1);

  if (args.length === 0) {
    return deniedResult(
      argv,
      "the command names no ceph command (ceph on its own opens an interactive shell); run one command, such as ceph status",
    );
  }

  if (
    args.some((word: string): boolean => {
      return word.trim() === "";
    })
  ) {
    return deniedResult(argv, "a word of the command is empty");
  }

  const line: CephCommandLine | string = readCommandLine(args);

  if (typeof line === "string") {
    return deniedResult(argv, line);
  }

  if (line.status) {
    if (line.words.length > 0) {
      return deniedResult(
        argv,
        "-s is ceph status and must stand alone: run the other command separately",
      );
    }

    return commandResult(
      argv,
      "status",
      read("reads the cluster's status: health, monitors, OSDs, PGs and usage"),
    );
  }

  const words: Array<string> = line.words;

  if (words.length === 0) {
    return deniedResult(
      argv,
      "the command names no ceph command, only an output format; add one, such as ceph status --format json",
    );
  }

  const isOrchPs: boolean = words[0] === "orch" && words[1] === "ps";

  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index] as string;

    if (!word.startsWith("-")) {
      continue;
    }

    if (
      isOrchPs &&
      index >= 2 &&
      Object.prototype.hasOwnProperty.call(ORCH_PS_OPTIONS, word)
    ) {
      continue;
    }

    const name: string = word.split("=")[0] as string;

    if (
      isOrchPs &&
      name !== word &&
      Object.prototype.hasOwnProperty.call(ORCH_PS_OPTIONS, name)
    ) {
      return deniedResult(
        argv,
        ORCH_PS_OPTIONS[name] === "refresh"
          ? `"${word}" is not accepted: --refresh takes no value, so write it on its own`
          : `"${word}" is not accepted: write orch ps's named arguments as two words (${name} VALUE)`,
      );
    }

    return deniedResult(argv, describeOptionRefusal(word));
  }

  if (
    words[0] === "pg" &&
    words.length >= 2 &&
    STARTS_WITH_DIGIT_REGEX.test(words[1] as string)
  ) {
    const verdict: CephVerdict | string = evaluatePgTargeted(words);

    return typeof verdict === "string"
      ? deniedResult(argv, verdict)
      : commandResult(argv, `pg ${words[2]}`, verdict);
  }

  const rule: CephCommandRule | null = findRule(words);

  if (!rule) {
    return deniedResult(argv, describeUnknownCommand(words));
  }

  const verb: string = rule.words.join(" ");
  const verdict: CephVerdict | string = rule.readArguments(
    words.slice(rule.words.length),
  );

  if (typeof verdict === "string") {
    // `health mute X` is its own (refused) command, not bad health arguments.
    return deniedResult(
      argv,
      findFamilyRefusal(words, rule.words.length) ||
        `ceph ${verb} is refused: ${verdict}. Usage: ceph ${verb}${
          rule.usage ? ` ${rule.usage}` : ""
        }`,
    );
  }

  return commandResult(argv, verb, verdict);
}

const READ_COMMAND_GUIDE: string = [
  "- Cluster: `ceph status` (or `ceph -s`), `ceph health [detail]`, `ceph df [detail]`, `ceph versions`, `ceph version`, `ceph progress`, `ceph quorum_status`, `ceph log last [N<=1000] [debug|info|sec|warn|error] [*|cluster|audit|cephadm]`",
  "- OSDs (ID = 3 or osd.3): `ceph osd tree [up|down|in|out|destroyed]`, `ceph osd df [tree]`, `ceph osd perf`, `ceph osd stat`, `ceph osd dump`, `ceph osd blocked-by`, `ceph osd find ID`, `ceph osd metadata [ID]`, `ceph osd ok-to-stop ID...`, `ceph osd safe-to-destroy ID...`",
  "- Pools: `ceph osd pool ls [detail]`, `ceph osd pool stats [POOL]`, `ceph osd pool get POOL VAR|all`",
  "- PGs (PGID = 1.2f): `ceph pg stat`, `ceph pg dump_stuck [inactive|unclean|stale|undersized|degraded]... [SECONDS]`, `ceph pg PGID query`, `ceph pg PGID list_unfound`, `ceph pg ls-by-osd ID`, `ceph pg ls-by-pool POOL`, `ceph pg ls-by-primary ID`",
  "- Daemons: `ceph mon stat`, `ceph mon dump`, `ceph mgr stat`, `ceph mgr services`, `ceph mgr module ls`, `ceph fs status [FS]`, `ceph fs ls`, `ceph mds stat`, `ceph balancer status`",
  "- Crashes: `ceph crash ls`, `ceph crash ls-new`, `ceph crash stat`, `ceph crash info CRASH_ID`",
  "- cephadm: `ceph orch ps [--daemon_type TYPE] [--service_name NAME] [--refresh]`, `ceph orch ls`, `ceph orch host ls`, `ceph orch device ls`",
  "- Add `--format json` (or `-f json`, `json-pretty`, `plain`) for structured output; no other option is accepted (never -c, --keyring, --id, --admin-daemon, -i, -o or -w), and `auth`, `config-key`, `config`, `tell` and `daemon` never run",
].join("\n");

const WRITE_COMMAND_GUIDE: string = [
  "- SafeWrite (runs unattended in Automatic mode): `ceph osd in ID`, `ceph osd unset noout|norebalance|nobackfill|norecover|noscrub|nodeep-scrub|pause`, `ceph crash archive CRASH_ID`, `ceph orch daemon restart TYPE.ID`, `ceph pg scrub PGID`, `ceph pg deep-scrub PGID`",
  "- RiskyWrite (needs approval unless allowlisted or approvals are bypassed): `ceph osd out ID`, `ceph osd down ID`, `ceph osd set noout|norebalance|nobackfill|norecover|noscrub|nodeep-scrub`, `ceph osd reweight ID 0..1`, `ceph pg repair PGID`, `ceph mgr fail [NAME]`, `ceph orch daemon stop|start TYPE.ID`, `ceph orch restart SERVICE`, `ceph crash archive-all`, `ceph balancer on|off`",
  "- Always asks a human: `ceph osd set pause` (stops all client I/O) and `ceph osd pool set POOL size|min_size N`",
  "- One OSD, PG, daemon, service or crash report per command (ID = 3 or osd.3, PGID = 1.2f, TYPE.ID as `ceph orch ps` lists it); rollbacks: osd out/in, osd set/unset, balancer on/off, orch daemon stop/start",
  "- Never runs: osd purge|destroy|rm|lost|new|crush, pool create|delete|rename or any other pool setting, `auth`, `config-key`, `config`, `tell`, `daemon`, `injectargs`, fs changes, mon changes, `mgr module enable|disable`, `orch apply|rm|host|upgrade`, `crash rm|prune`",
].join("\n");

const CephCommandPolicy: ResourceToolPolicy = {
  name: "ceph",
  programs: [CEPH_PROGRAM],
  readCommandGuide: READ_COMMAND_GUIDE,
  writeCommandGuide: WRITE_COMMAND_GUIDE,
  /*
   * What a `*` in an allowlist entry may stand for in ceph's grammar — two
   * of each kind (daemon names, PG ids, OSD flags, weights), so an entry
   * such as `ceph orch daemon stop *` is valid and seen to be broad.
   */
  allowlistStandIns: [
    "osd.1",
    "osd.2",
    "mgr.a",
    "mgr.b",
    "1.1f",
    "1.2a",
    "noout",
    "norebalance",
    "0.5",
    "0.8",
  ],
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    try {
      return evaluateCephArgv(argv);
    } catch {
      /*
       * Total: whatever the argv held, a failure to read it is a refusal —
       * one that never reads the argv again (a word that threw once may
       * throw twice).
       */
      return deniedResult(
        [],
        "the ceph command policy could not read this command",
      );
    }
  },
};

export default CephCommandPolicy;
