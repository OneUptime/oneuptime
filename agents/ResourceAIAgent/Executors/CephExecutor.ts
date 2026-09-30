import fs from "fs";
import path from "path";
import PrepareGuard, {
  GuardResult,
  GuardedCommand,
  refusalPrefix,
} from "./PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "./ResourceExecutor";
import SpawnSandbox, {
  DEFAULT_SPAWN_PATH,
  SandboxCapture,
  SandboxJobDirectory,
  describeMissingBinary,
  lastStderrLine,
  redactOutput,
} from "./SpawnSandbox";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import { CEPH_OUTPUT_FORMATS } from "../Common/Utils/AiRemediation/Resource/CephCommandPolicy";

/*
 * The executor for Ceph clusters: runs the ceph commands OneUptime AI
 * composed with the agent's OWN ceph.conf, keyring and client name, as an
 * argv — never through a shell. See ResourceExecutor for the contract every
 * executor keeps.
 *
 * prepare() runs PrepareGuard first (the policy re-check with the agent's
 * copy of CephCommandPolicy, investigation implies Read, the write switch
 * and write scope, the cluster's identity), then its own checks:
 *
 *   - the command carries none of the options that choose the cluster, the
 *     identity or a file (the policy refuses them; this is the second line,
 *     because argparse lets a LATER --id or --keyring override the agent's
 *     own: `ceph --id oneuptime-ai auth ls --id admin` runs as admin);
 *   - the agent can connect at all: CEPH_CONF and CEPH_KEYRING are plain
 *     absolute paths to readable files, and CEPH_CLIENT_ID is a client name.
 *
 * ceph then runs as /usr/bin/ceph (Alpine's ceph19-common, Squid) with
 *
 *   argv  --conf CEPH_CONF --keyring CEPH_KEYRING --id CEPH_CLIENT_ID
 *         --connect-timeout SECONDS  <the payload's args, exactly as sent>
 *
 * — this is the only place those four options are ever written — and a
 * CLOSED environment: PATH and HOME (the command's private, empty home).
 * Nothing else of the agent's environment reaches ceph: not CEPH_ARGS (which
 * ceph would prepend to every command line), not CEPH_CONF itself, not the
 * agent's OneUptime key or proxy settings. The payload's own output format
 * (--format json, -f plain, or none) is kept as the policy read it, and
 * `ceph -s` passes through as-is.
 *
 * The defaults fit the compose file next to the collector: the ceph/ folder
 * of the install directory is mounted at /etc/ceph, with the cluster's
 * minimal ceph.conf and the keyring of client.oneuptime-ai:
 *
 *   CEPH_CONF       /etc/ceph/ceph.conf
 *   CEPH_CLIENT_ID  oneuptime-ai (a "client." prefix is dropped)
 *   CEPH_KEYRING    /etc/ceph/ceph.client.<CEPH_CLIENT_ID>.keyring
 *
 * The keyring's caps are the hard limit of what any command can do: read
 * caps (mon 'allow r' mgr 'allow r' osd 'allow r') keep the cluster
 * read-only whatever the agent's settings say.
 *
 * run() never throws; a failure carries ceph's own last line plus what an
 * operator should change (the keyring, its file mode, the monitors'
 * addresses, the client's caps, ...). probePosture() runs `ceph versions`
 * and `ceph health` (both --format json) the same way and reports the
 * cluster's release and health.
 */

// The ceph CLI the image installs (Alpine's ceph19-common package).
export const CEPH_BINARY: string = "/usr/bin/ceph";

// The program the policy tiers and the output belongs to.
export const CEPH_PROGRAM: string = "ceph";

// The agent's settings (read from its environment).
export const CEPH_CONF_ENV: string = "CEPH_CONF";
export const CEPH_KEYRING_ENV: string = "CEPH_KEYRING";
export const CEPH_CLIENT_ID_ENV: string = "CEPH_CLIENT_ID";

export const DEFAULT_CEPH_CONF: string = "/etc/ceph/ceph.conf";
export const DEFAULT_CEPH_CLIENT_ID: string = "oneuptime-ai";

// Ceph's own spelling of a client's keyring file.
export function getDefaultCephKeyring(clientId: string): string {
  return `/etc/ceph/ceph.client.${clientId}.keyring`;
}

// The options only this executor writes, in the order it writes them.
export const CEPH_CONF_OPTION: string = "--conf";
export const CEPH_KEYRING_OPTION: string = "--keyring";
export const CEPH_ID_OPTION: string = "--id";
export const CEPH_CONNECT_TIMEOUT_OPTION: string = "--connect-timeout";

/*
 * The longest ceph may spend connecting (authenticating with the monitors):
 * at most this, and at most half the command's own budget, so an
 * unreachable monitor ends in ceph's own "timed out" — which says what is
 * wrong — well before the sandbox kills a silent process.
 */
export const MAX_CEPH_CONNECT_TIMEOUT_SECONDS: number = 10;

/*
 * The posture probe: `ceph versions` and `ceph health` in parallel, each
 * within CEPH_PROBE_TIMEOUT_MS (inside the agent's own posture timeout,
 * Posture.DEFAULT_PROBE_TIMEOUT_MS, 15s), connecting within
 * CEPH_PROBE_CONNECT_TIMEOUT_SECONDS.
 */
export const CEPH_PROBE_TIMEOUT_MS: number = 12_000;
export const CEPH_PROBE_CONNECT_TIMEOUT_SECONDS: number = 5;
export const CEPH_VERSIONS_PROBE_ARGS: ReadonlyArray<string> = [
  "versions",
  "--format",
  "json",
];
export const CEPH_HEALTH_PROBE_ARGS: ReadonlyArray<string> = [
  "health",
  "--format",
  "json",
];

// The read caps a client needs, as `ceph auth` takes them.
export const CEPH_READ_CAPS: string =
  "mon 'allow r' mgr 'allow r' osd 'allow r'";

/*
 * The only dash-prefixed words a payload may carry (the ones the policy
 * accepts: the output format, -s, and orch ps's named arguments). Anything
 * else — above all --conf, --keyring, --id, --name, --cluster, -c, -k, -n,
 * -m, an abbreviation of one of them, or a `--key=value` configuration
 * override — would change which cluster, identity or file ceph uses.
 */
const ALLOWED_OPTION_WORDS: ReadonlyArray<string> = [
  "-s",
  "-f",
  "--format",
  ...CEPH_OUTPUT_FORMATS.map((format: string): string => {
    return `--format=${format}`;
  }),
  "--daemon_type",
  "--daemon-type",
  "--service_name",
  "--service-name",
  "--refresh",
];

// A ceph client name, without "client." (entity names are TYPE.ID).
const CLIENT_ID_REGEX: RegExp = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

const CLIENT_PREFIX: string = "client.";

// A comma (ceph reads a list) or "$" (ceph expands $cluster, $id, ...).
const LIST_OR_VARIABLE_REGEX: RegExp = /[,$]/;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_REGEX: RegExp = /[\u0000-\u001f\u007f]/;

const SENTENCE_END_REGEX: RegExp = /[.!?]$/;

// A health status as `ceph health` prints it.
const HEALTH_STATUS_REGEX: RegExp = /^HEALTH_[A-Z]{2,8}$/;

// A health check's code ("OSD_DOWN", "PG_DEGRADED").
const HEALTH_CHECK_CODE_REGEX: RegExp = /^[A-Z0-9_]{1,64}$/;

// How many health check codes the posture lists.
const MAX_POSTURE_HEALTH_CHECKS: number = 8;

// "ceph version 19.2.3 (c92aebb2...) squid (stable)"
const CEPH_VERSION_KEY_REGEX: RegExp =
  /^ceph version (\S+)(?: \([0-9a-f]{7,64}\))?(?: (.+))?$/;

// The longest version label read out of `ceph versions`.
const MAX_VERSION_LABEL_LENGTH: number = 96;

/*
 * ---------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------
 */

export interface CephSettings {
  // The ceph.conf ceph reads (--conf).
  confPath: string;
  // The keyring ceph authenticates with (--keyring).
  keyringPath: string;
  // The client's name without "client." (--id).
  clientId: string;
  // Which variable each value came from, or null for the default.
  confVariable: string | null;
  keyringVariable: string | null;
  // What stops ceph from running at all; empty when nothing does.
  problems: Array<string>;
  // Worth logging once at start-up, but not fatal.
  warnings: Array<string>;
}

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value.trim() : "";
}

/*
 * Why a configured path cannot be handed to ceph, or null. ceph reads
 * --conf and --keyring as comma-separated LISTS and expands $cluster, $id,
 * $name and $host in them, so only a single, plain absolute path is taken:
 * the agent checks exactly the file ceph will open. A relative path would
 * resolve inside the command's private working directory.
 */
export function describeCephPathProblem(data: {
  value: string;
  variable: string;
}): string | null {
  const shown: string = `${data.variable}="${data.value}"`;

  if (!path.posix.isAbsolute(data.value)) {
    return `${shown} is not an absolute path. Set it to the file's path inside the agent's container, e.g. /etc/ceph/...`;
  }

  if (
    LIST_OR_VARIABLE_REGEX.test(data.value) ||
    CONTROL_CHARACTER_REGEX.test(data.value)
  ) {
    return `${shown} must name one file by a plain path (no commas, no $ variables, no control characters).`;
  }

  return null;
}

/*
 * Everything ceph needs from the agent's environment. Never throws; what is
 * unusable is listed in problems, each naming the variable to set.
 */
export function resolveCephSettings(env: NodeJS.ProcessEnv): CephSettings {
  const problems: Array<string> = [];
  const warnings: Array<string> = [];

  let clientId: string =
    readTrimmed(env, CEPH_CLIENT_ID_ENV) || DEFAULT_CEPH_CLIENT_ID;

  if (clientId.startsWith(CLIENT_PREFIX)) {
    const bare: string = clientId.slice(CLIENT_PREFIX.length);

    warnings.push(
      `${CEPH_CLIENT_ID_ENV}="${clientId}" starts with "${CLIENT_PREFIX}", which ceph --id adds itself; the agent uses "${bare}". Set ${CEPH_CLIENT_ID_ENV}=${bare}.`,
    );
    clientId = bare;
  }

  if (!CLIENT_ID_REGEX.test(clientId)) {
    problems.push(
      `${CEPH_CLIENT_ID_ENV}="${clientId}" is not a Ceph client name. Set it to the name of the client you created for the agent, without "${CLIENT_PREFIX}" (e.g. ${DEFAULT_CEPH_CLIENT_ID} for client.${DEFAULT_CEPH_CLIENT_ID}).`,
    );
  }

  const confSetting: string = readTrimmed(env, CEPH_CONF_ENV);
  const keyringSetting: string = readTrimmed(env, CEPH_KEYRING_ENV);
  const confPath: string = confSetting || DEFAULT_CEPH_CONF;
  const keyringPath: string = keyringSetting || getDefaultCephKeyring(clientId);

  const confProblem: string | null = describeCephPathProblem({
    value: confPath,
    variable: CEPH_CONF_ENV,
  });
  const keyringProblem: string | null = describeCephPathProblem({
    value: keyringPath,
    variable: CEPH_KEYRING_ENV,
  });

  if (confProblem) {
    problems.push(confProblem);
  }

  if (keyringProblem) {
    problems.push(keyringProblem);
  }

  return {
    confPath,
    keyringPath,
    clientId,
    confVariable: confSetting ? CEPH_CONF_ENV : null,
    keyringVariable: keyringSetting ? CEPH_KEYRING_ENV : null,
    problems,
    warnings,
  };
}

/*
 * Why ceph.conf or the keyring cannot be read, or null. Checked before
 * every command and probe (a mount can come and go), so the operator reads
 * "not mounted" or "not readable by UID 1000" rather than ceph's
 * "RADOS object not found".
 */
export function getCephFileProblem(data: {
  settings: CephSettings;
  file: "conf" | "keyring";
}): string | null {
  const settings: CephSettings = data.settings;
  const isConf: boolean = data.file === "conf";
  const filePath: string = isConf ? settings.confPath : settings.keyringPath;
  const variable: string = isConf ? CEPH_CONF_ENV : CEPH_KEYRING_ENV;
  const configured: string | null = isConf
    ? settings.confVariable
    : settings.keyringVariable;
  const subject: string = isConf
    ? `The ceph.conf at ${filePath}`
    : `The keyring ${filePath}`;
  const where: string = configured
    ? `where ${variable} points`
    : "in the ceph/ folder next to docker-compose.yml";

  let stat: fs.Stats;

  try {
    stat = fs.statSync(filePath);
  } catch (err: unknown) {
    const code: unknown =
      err && typeof err === "object"
        ? (err as Record<string, unknown>)["code"]
        : undefined;

    if (code === "EACCES") {
      return `${subject} is in a directory the agent (UID 1000) cannot enter: make the mounted directory readable (chmod 755).`;
    }

    return isConf
      ? `${subject} is not in the agent's container. Put the cluster's ceph.conf (ceph config generate-minimal-conf) ${where}.`
      : `${subject} is not in the agent's container. Create it (ceph auth get-or-create client.${settings.clientId} ${CEPH_READ_CAPS}) and put it ${where}.`;
  }

  if (!stat.isFile()) {
    return `${subject} is not a file (Docker mounts an empty directory when the file is missing on the host). Put the ${
      isConf ? "ceph.conf" : "keyring"
    } there and restart the agent.`;
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return isConf
      ? `${subject} is not readable by the agent (UID 1000). It holds no secret: chmod 644 it.`
      : `${subject} is not readable by the agent (UID 1000). On the host: chown 1000:1000 and chmod 600 the keyring file.`;
  }

  return null;
}

/*
 * How long ceph may spend connecting, in whole seconds (ceph takes an
 * integer): half the command's budget, between 1 and
 * MAX_CEPH_CONNECT_TIMEOUT_SECONDS.
 */
export function getCephConnectTimeoutSeconds(timeoutInMs: number): number {
  if (typeof timeoutInMs !== "number" || !Number.isFinite(timeoutInMs)) {
    return 1;
  }

  return Math.min(
    MAX_CEPH_CONNECT_TIMEOUT_SECONDS,
    Math.max(1, Math.floor(timeoutInMs / 2000)),
  );
}

/*
 * ceph's complete argv: the agent's own connection options, then the
 * payload's words exactly as sent.
 */
export function buildCephArgv(data: {
  settings: CephSettings;
  connectTimeoutSeconds: number;
  args: ReadonlyArray<string>;
}): Array<string> {
  return [
    CEPH_CONF_OPTION,
    data.settings.confPath,
    CEPH_KEYRING_OPTION,
    data.settings.keyringPath,
    CEPH_ID_OPTION,
    data.settings.clientId,
    CEPH_CONNECT_TIMEOUT_OPTION,
    String(Math.max(1, Math.floor(data.connectTimeoutSeconds))),
    ...data.args,
  ];
}

/*
 * ceph's COMPLETE environment for one command: PATH and the command's
 * private HOME. Nothing of the agent's own environment is merged in (no
 * CEPH_ARGS, no CEPH_CONF); SpawnSandbox closes it again.
 */
export function buildCephEnvironment(data: {
  homeDir: string;
}): Record<string, string> {
  return {
    PATH: DEFAULT_SPAWN_PATH,
    HOME: data.homeDir,
  };
}

/*
 * The first word of the payload that would choose the cluster, the
 * identity, a file or a configuration override (see ALLOWED_OPTION_WORDS),
 * or null. Every value word the policy accepts starts with a letter or a
 * digit, so any other dash-prefixed word is an option to ceph.
 */
export function findForbiddenCephOption(
  args: ReadonlyArray<string>,
): string | null {
  for (const word of args) {
    if (typeof word !== "string") {
      return String(word);
    }

    if (word.startsWith("-") && !ALLOWED_OPTION_WORDS.includes(word)) {
      return word;
    }
  }

  return null;
}

/*
 * ceph prints two lines on EVERY run whose keyring is not at the default
 * place for its --id ("auth: unable to find a keyring on
 * /etc/ceph/ceph.client.ID.keyring,/etc/ceph/ceph.keyring,...: (2) No such
 * file or directory" and "AuthRegistry(0x...) no keyring found at ...,
 * disabling cephx"): the library looks there before it reads --keyring.
 * They are noise when they do not name the agent's keyring — and "disabling
 * cephx" would mislead whoever reads the output — so those lines, and only
 * those, are dropped.
 */
const KEYRING_SEARCH_LINE_REGEX: RegExp =
  /(?:auth: unable to find a keyring on|AuthRegistry\(0x[0-9a-f]+\) no keyring found at) (.+?)(?:: \(\d+\) .*|, disabling cephx)$/;

export function dropKeyringSearchNoise(
  stderr: string,
  keyringPath: string,
): string {
  if (!stderr) {
    return stderr;
  }

  const lines: Array<string> = stderr.split("\n");
  const kept: Array<string> = lines.filter((line: string): boolean => {
    const match: RegExpExecArray | null = KEYRING_SEARCH_LINE_REGEX.exec(
      line.replace(/\r$/, ""),
    );

    if (!match) {
      return true;
    }

    const searched: Array<string> = (match[1] || "")
      .split(",")
      .map((entry: string): string => {
        return entry.trim();
      });

    return searched.includes(keyringPath);
  });

  return kept.length === lines.length ? stderr : kept.join("\n");
}

/*
 * ---------------------------------------------------------------------------
 * Failures, in words for an operator
 * ---------------------------------------------------------------------------
 */

export type CephFailureKind =
  | "conf_unreadable"
  | "conf_invalid"
  | "keyring_missing"
  | "keyring_unreadable"
  | "keyring_invalid"
  | "no_monitors"
  | "mon_unresolvable"
  | "auth_rejected"
  | "mon_unreachable"
  | "connect_failed"
  | "access_denied"
  | "no_orchestrator"
  | "mgr_module"
  | "not_found"
  | "busy"
  | "unknown_command"
  | "invalid_argument";

/*
 * ceph's last line when it never connected: the library's error for the
 * connection ("[errno 13] RADOS permission denied (error connecting to the
 * cluster)"), ceph's own "timed out" when --connect-timeout ran out, or the
 * failure to read ceph.conf ("Error initializing cluster client: ...").
 */
const CONNECTION_FAILURE_REGEX: RegExp =
  /\(error connecting to the cluster\)|^timed out$|^Cluster connection (?:interrupted|aborted)|^Error initializing cluster client|^Error connecting to cluster/i;

// A monitor's or mgr's answer: "Error EACCES: access denied".
const COMMAND_ERROR_REGEX: RegExp = /^Error (E[A-Z]+)\b/;

// What ceph printed before a connection failure, in the order it is read.
const CONF_INVALID_REGEX: RegExp =
  /invalid argument \(error calling conf_read_file\)/i;
const CONF_UNREADABLE_REGEX: RegExp = /conf_read_file/i;
const KEYRING_NOT_FOUND_REGEX: RegExp = /monclient: keyring not found/i;
const NO_MONITORS_REGEX: RegExp =
  /unable to get monitor info from DNS SRV|no monitors specified/i;
const MON_UNRESOLVABLE_REGEX: RegExp =
  /server name not found|unable to parse addrs|cannot identify monitors to contact/i;
const AUTH_REJECTED_REGEX: RegExp =
  /RADOS permission denied|handle_auth_bad_method|PermissionDeniedError|bad authorizer|authentication error/i;
const MON_UNREACHABLE_REGEX: RegExp =
  /^timed out$|RADOS timed out|Cluster connection interrupted or timed out|authenticate timed out/im;

// What a command's own error says about why it failed.
const NO_ORCHESTRATOR_REGEX: RegExp = /orchestrator|orch set backend/i;
const MGR_MODULE_REGEX: RegExp = /\bmodule\b/i;
const INVALID_COMMAND_REGEX: RegExp = /invalid command/i;
const NO_VALID_COMMAND_REGEX: RegExp = /no valid command found/i;

// Characters a keyring path could hold that mean something in a RegExp.
const REGEXP_SPECIAL_CHARACTERS_REGEX: RegExp = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(text: string): string {
  return text.replace(REGEXP_SPECIAL_CHARACTERS_REGEX, "\\$&");
}

// Whether ceph said this about the agent's own keyring file.
function mentionsKeyring(data: {
  stderr: string;
  keyringPath: string;
  pattern: (escapedPath: string) => string;
}): boolean {
  if (!data.keyringPath) {
    return false;
  }

  return new RegExp(data.pattern(escapeRegExp(data.keyringPath))).test(
    data.stderr,
  );
}

// Why ceph never connected, from everything it printed.
function classifyConnectionFailure(
  stderr: string,
  keyringPath: string,
): CephFailureKind {
  if (CONF_INVALID_REGEX.test(stderr)) {
    return "conf_invalid";
  }

  if (CONF_UNREADABLE_REGEX.test(stderr)) {
    return "conf_unreadable";
  }

  if (
    mentionsKeyring({
      stderr,
      keyringPath,
      pattern: (keyring: string): string => {
        return `(?:failed to load|error parsing file) ${keyring}\\b`;
      },
    })
  ) {
    return "keyring_invalid";
  }

  if (
    mentionsKeyring({
      stderr,
      keyringPath,
      pattern: (keyring: string): string => {
        return `unable to find a keyring on ${keyring}: \\(13\\)`;
      },
    })
  ) {
    return "keyring_unreadable";
  }

  if (
    mentionsKeyring({
      stderr,
      keyringPath,
      pattern: (keyring: string): string => {
        return `unable to find a keyring on ${keyring}: \\(2\\)`;
      },
    }) ||
    KEYRING_NOT_FOUND_REGEX.test(stderr)
  ) {
    return "keyring_missing";
  }

  if (NO_MONITORS_REGEX.test(stderr)) {
    return "no_monitors";
  }

  if (MON_UNRESOLVABLE_REGEX.test(stderr)) {
    return "mon_unresolvable";
  }

  if (AUTH_REJECTED_REGEX.test(stderr)) {
    return "auth_rejected";
  }

  if (MON_UNREACHABLE_REGEX.test(stderr)) {
    return "mon_unreachable";
  }

  return "connect_failed";
}

/*
 * What kind of failure ceph's stderr describes, or null. Its LAST line
 * decides: an answer from the cluster ("Error EACCES: ...") is about the
 * command, a connection error is about how the agent connects (and the
 * lines before it say which part) — ceph prints keyring warnings on runs
 * that then succeed, so a warning alone never decides anything.
 */
export function classifyCephFailure(
  stderr: string,
  keyringPath: string = "",
): CephFailureKind | null {
  if (typeof stderr !== "string" || !stderr.trim()) {
    return null;
  }

  const lastLine: string = lastStderrLine(stderr);

  if (CONNECTION_FAILURE_REGEX.test(lastLine)) {
    return classifyConnectionFailure(stderr, keyringPath);
  }

  const match: RegExpExecArray | null = COMMAND_ERROR_REGEX.exec(lastLine);

  if (match) {
    switch (match[1]) {
      case "EACCES":
      case "EPERM":
        return "access_denied";
      case "ENOENT":
        if (NO_ORCHESTRATOR_REGEX.test(lastLine)) {
          return "no_orchestrator";
        }

        return MGR_MODULE_REGEX.test(lastLine) ? "mgr_module" : "not_found";
      case "EOPNOTSUPP":
      case "ENOTSUP":
        return NO_ORCHESTRATOR_REGEX.test(lastLine)
          ? "no_orchestrator"
          : "mgr_module";
      case "EBUSY":
      case "EAGAIN":
        return "busy";
      case "EINVAL":
        return INVALID_COMMAND_REGEX.test(lastLine) ||
          NO_VALID_COMMAND_REGEX.test(stderr)
          ? "unknown_command"
          : "invalid_argument";
      default:
        return null;
    }
  }

  if (NO_VALID_COMMAND_REGEX.test(stderr)) {
    return "unknown_command";
  }

  return null;
}

function isWriteTier(tier: ResourceCommandTier | null): boolean {
  return (
    tier === ResourceCommandTier.SafeWrite ||
    tier === ResourceCommandTier.RiskyWrite
  );
}

/*
 * What to change for a failure of this kind. The connection failures a
 * probe hits stay within the posture's 256-character bound for the default
 * paths.
 */
export function describeCephFailure(data: {
  kind: CephFailureKind;
  settings: CephSettings;
  // The command's tier; null for the posture probe.
  tier: ResourceCommandTier | null;
}): string {
  const settings: CephSettings = data.settings;
  const client: string = `client.${settings.clientId}`;

  switch (data.kind) {
    case "conf_unreadable":
      return `ceph could not read ${settings.confPath} (${CEPH_CONF_ENV}): mount the cluster's ceph.conf there, readable by UID 1000.`;
    case "conf_invalid":
      return `${settings.confPath} (${CEPH_CONF_ENV}) is not a valid ceph.conf: replace it with the output of ceph config generate-minimal-conf.`;
    case "keyring_missing":
      return `ceph found no key for ${client} in ${settings.keyringPath} (${CEPH_KEYRING_ENV}): export it with ceph auth get ${client} -o <that file>.`;
    case "keyring_unreadable":
      return `The agent (UID 1000) cannot read ${settings.keyringPath}: on the host, chown 1000:1000 and chmod 600 the keyring file.`;
    case "keyring_invalid":
      return `${settings.keyringPath} (${CEPH_KEYRING_ENV}) is not a valid keyring: export it again with ceph auth get ${client} -o <that file>.`;
    case "no_monitors":
      return `${settings.confPath} names no monitors: add mon_host (ceph config generate-minimal-conf writes it).`;
    case "mon_unresolvable":
      return `The agent cannot resolve the monitors in ${settings.confPath} (mon_host): use IP addresses, or names this container's DNS resolves.`;
    case "auth_rejected":
      return `The monitors rejected ${client}'s key: check that ${CEPH_CLIENT_ID_ENV} names the client ${settings.keyringPath} holds, and that the key matches ceph auth get ${client}.`;
    case "mon_unreachable":
      return `The agent cannot reach the monitors in ${settings.confPath} (mon_host): check the addresses and that this machine reaches them on TCP 3300 and 6789.`;
    case "connect_failed":
      return `ceph could not connect to the cluster: check the monitors in ${settings.confPath} (mon_host) and ${client}'s keyring ${settings.keyringPath}.`;
    case "access_denied":
      return isWriteTier(data.tier)
        ? `${client}'s caps do not allow this change: give it the fixes caps from the Ceph agent's README (ceph auth caps ${client} ...), or leave this change to a person.`
        : `${client} may not read this: give it the read caps with ceph auth caps ${client} ${CEPH_READ_CAPS}.`;
    case "no_orchestrator":
      return "This cluster has no orchestrator backend (cephadm), so ceph orch commands do not work on it: use the osd, mon, mgr, pg and crash commands instead.";
    case "mgr_module":
      return "The mgr module this command needs is not enabled or not running: check ceph mgr module ls and ceph mgr stat.";
    case "not_found":
      return "The object it names does not exist: look up the exact name with ceph osd tree, ceph osd pool ls, ceph pg dump_stuck, ceph crash ls or ceph orch ps.";
    case "busy":
      return "The cluster cannot do it right now: check ceph status and ceph progress, and try again once the cluster has settled.";
    case "unknown_command":
      return "The cluster does not offer this command: the commands of mgr modules (pg, df, osd df, crash, orch, balancer) exist only while a mgr is active and the module is on (check ceph mgr stat), and some differ by release (check ceph versions).";
    case "invalid_argument":
      return "The cluster rejected the command's arguments: check them against the command's usage for this cluster's release (ceph versions).";
  }
}

// A sentence ends before another one is appended.
function joinSentences(first: string, second: string): string {
  const head: string = first.trim();

  if (!head) {
    return second;
  }

  return `${SENTENCE_END_REGEX.test(head) ? head : `${head}.`} ${second}`;
}

// What silence until the kill means for ceph (describeKill's hint).
export function getCephSilenceHint(settings: CephSettings): string {
  return `the Ceph cluster never answered: the monitors in ${settings.confPath} (mon_host) may be unreachable from this agent (TCP 3300 and 6789), or the command waits for a mgr that is not running (pg, df, osd df, crash, orch and balancer commands need an active mgr: check ceph mgr stat)`;
}

/*
 * ---------------------------------------------------------------------------
 * `ceph versions` and `ceph health`
 * ---------------------------------------------------------------------------
 */

export interface CephVersionCount {
  // "19.2.3 squid (stable)"
  label: string;
  // How many daemons run it.
  count: number;
}

// ceph prints a newline before its JSON; anything else is not JSON.
function parseJson(stdout: string): unknown {
  if (typeof stdout !== "string" || !stdout.trim()) {
    return null;
  }

  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// "ceph version 19.2.3 (hash) squid (stable)" as "19.2.3 squid (stable)".
export function describeCephVersionKey(key: string): string {
  const trimmed: string = key.trim();
  const match: RegExpExecArray | null = CEPH_VERSION_KEY_REGEX.exec(trimmed);
  const label: string = match
    ? [match[1], match[2]]
        .filter((part: string | undefined): boolean => {
          return Boolean(part && part.trim());
        })
        .join(" ")
    : trimmed;

  return label.slice(0, MAX_VERSION_LABEL_LENGTH);
}

/*
 * The versions the cluster's daemons run, from `ceph versions --format
 * json`: its "overall" map (every daemon), or the per-type maps added up
 * when there is none. Most daemons first. Null when the output is not that.
 */
export function parseCephVersions(
  stdout: string,
): Array<CephVersionCount> | null {
  const parsed: Record<string, unknown> | null = asRecord(parseJson(stdout));

  if (!parsed) {
    return null;
  }

  const counts: Map<string, number> = new Map<string, number>();
  const add: (map: unknown) => void = (map: unknown): void => {
    const entries: Record<string, unknown> | null = asRecord(map);

    for (const [key, value] of Object.entries(entries || {})) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        continue;
      }

      const label: string = describeCephVersionKey(key);

      if (label) {
        counts.set(label, (counts.get(label) || 0) + value);
      }
    }
  };

  if (asRecord(parsed["overall"])) {
    add(parsed["overall"]);
  } else {
    for (const map of Object.values(parsed)) {
      add(map);
    }
  }

  if (counts.size === 0) {
    return null;
  }

  return Array.from(counts.entries())
    .map(([label, count]: [string, number]): CephVersionCount => {
      return { label, count };
    })
    .sort((a: CephVersionCount, b: CephVersionCount): number => {
      return b.count - a.count || a.label.localeCompare(b.label);
    });
}

/*
 * The version the posture reports: "ceph 19.2.3 squid (stable)", or every
 * version with its daemon count while an upgrade is under way.
 */
export function describeCephVersions(
  versions: Array<CephVersionCount>,
): string | null {
  if (versions.length === 0) {
    return null;
  }

  if (versions.length === 1) {
    return `ceph ${versions[0]!.label}`;
  }

  return `ceph ${versions
    .map((version: CephVersionCount): string => {
      return `${version.label} (${version.count} daemon${
        version.count === 1 ? "" : "s"
      })`;
    })
    .join(", ")}`;
}

export interface CephHealth {
  // "HEALTH_OK", "HEALTH_WARN" or "HEALTH_ERR".
  status: string;
  // The codes of the raised health checks ("OSD_DOWN", ...), in ceph's order.
  checks: Array<string>;
}

// The cluster's health from `ceph health --format json`, or null.
export function parseCephHealth(stdout: string): CephHealth | null {
  const parsed: Record<string, unknown> | null = asRecord(parseJson(stdout));

  if (!parsed || typeof parsed["status"] !== "string") {
    return null;
  }

  const status: string = parsed["status"].trim();

  if (!HEALTH_STATUS_REGEX.test(status)) {
    return null;
  }

  const checks: Array<string> = Object.keys(
    asRecord(parsed["checks"]) || {},
  ).filter((code: string): boolean => {
    return HEALTH_CHECK_CODE_REGEX.test(code);
  });

  return { status, checks };
}

/*
 * ---------------------------------------------------------------------------
 * The executor
 * ---------------------------------------------------------------------------
 */

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function describeDuration(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
}

export default class CephExecutor implements ResourceExecutor {
  // How long each posture probe command may take (a test shortens it).
  public probeTimeoutMs: number = CEPH_PROBE_TIMEOUT_MS;
  protected readonly sandbox: SpawnSandbox;
  private readonly settings: CephSettings;

  public constructor(protected readonly options: ExecutorOptions) {
    this.sandbox = new SpawnSandbox({
      tmpDir: options.tmpDir,
      spawnImpl: options.spawnImpl,
      logger: options.logger,
    });
    this.settings = resolveCephSettings(options.env || {});

    for (const warning of this.settings.warnings) {
      options.logger.warn(warning);
    }
  }

  // What the agent read from its environment (test seam).
  public getSettings(): CephSettings {
    return this.settings;
  }

  /*
   * Nothing in a Ceph cluster is this agent's own: it runs no daemon there.
   * ONEUPTIME_AI_PROTECTED_TARGETS (osd.3, a pool name, a daemon name) adds
   * the operator's.
   */
  public getProtectedTargets(): Array<string> {
    return [];
  }

  // Why ceph cannot run at all right now, or null.
  public getConfigurationProblem(): string | null {
    if (this.settings.problems.length > 0) {
      return this.settings.problems.join(" ");
    }

    return (
      getCephFileProblem({ settings: this.settings, file: "conf" }) ||
      getCephFileProblem({ settings: this.settings, file: "keyring" })
    );
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      protectedTargets: this.getProtectedTargets(),
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    const refused: string = refusalPrefix(guarded.resourceType);

    // This executor starts ceph and nothing else, for a Ceph cluster only.
    if (
      guarded.resourceType !== AiResourceType.CephCluster ||
      guarded.program !== CEPH_PROGRAM
    ) {
      return {
        refusal: `${refused}: this executor runs ceph for a Ceph cluster only, not "${guarded.program}" for a ${guarded.resourceType}.`,
      };
    }

    const forbidden: string | null = findForbiddenCephOption(guarded.args);

    if (forbidden !== null) {
      return {
        refusal: `${refused}: "${forbidden}" is an option to ceph itself, and the agent alone chooses the cluster, client, keyring and files ceph uses (it passes --conf, --keyring, --id and --connect-timeout), so "${guarded.displayCommand}" does not run.`,
      };
    }

    const problem: string | null = this.getConfigurationProblem();

    if (problem) {
      return {
        refusal: `${refused}: it cannot connect to the Ceph cluster as configured. ${problem}`,
      };
    }

    return {
      refusal: null,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      run: (): Promise<ExecResult> => {
        return this.runCommand(guarded);
      },
    };
  }

  public async probePosture(): Promise<ResourcePostureProbe> {
    const protectedTargets: Array<string> = this.getProtectedTargets();
    const details: Record<string, string | number | boolean | null> = {
      clientId: this.settings.clientId,
      confPath: this.settings.confPath,
      keyringPath: this.settings.keyringPath,
    };

    const unreachable: (reachError: string) => ResourcePostureProbe = (
      reachError: string,
    ): ResourcePostureProbe => {
      return {
        toolVersion: null,
        reachable: false,
        reachError,
        details,
        protectedTargets,
      };
    };

    try {
      const problem: string | null = this.getConfigurationProblem();

      if (problem) {
        return unreachable(problem);
      }

      const [versions, health]: [SandboxCapture, SandboxCapture] =
        await Promise.all([
          this.capture(
            [...CEPH_VERSIONS_PROBE_ARGS],
            this.probeTimeoutMs,
            CEPH_PROBE_CONNECT_TIMEOUT_SECONDS,
          ),
          this.capture(
            [...CEPH_HEALTH_PROBE_ARGS],
            this.probeTimeoutMs,
            CEPH_PROBE_CONNECT_TIMEOUT_SECONDS,
          ),
        ]);

      const failure: string | null =
        this.describeProbeFailure(versions, "ceph versions") ||
        this.describeProbeFailure(health, "ceph health");

      if (failure) {
        return unreachable(failure);
      }

      const versionCounts: Array<CephVersionCount> | null = parseCephVersions(
        versions.stdout,
      );
      const cephHealth: CephHealth | null = parseCephHealth(health.stdout);

      details["health"] = cephHealth ? cephHealth.status : null;
      details["healthChecks"] =
        cephHealth && cephHealth.checks.length > 0
          ? cephHealth.checks.slice(0, MAX_POSTURE_HEALTH_CHECKS).join(", ")
          : null;
      details["mixedVersions"] = versionCounts
        ? versionCounts.length > 1
        : null;

      return {
        toolVersion: versionCounts ? describeCephVersions(versionCounts) : null,
        reachable: true,
        reachError: null,
        details,
        protectedTargets,
      };
    } catch (err: unknown) {
      return unreachable(
        `Checking the Ceph cluster failed: ${describeError(err)}`,
      );
    }
  }

  public sweepOrphanedJobDirs(): Promise<void> {
    try {
      const removed: number = this.sandbox.sweepOrphanedJobDirs();

      if (removed > 0) {
        this.options.logger.info(
          "Removed job directories a previous run left behind",
          { removed },
        );
      }
    } catch (err: unknown) {
      this.options.logger.warn("Could not sweep old job directories", {
        error: describeError(err),
      });
    }

    return Promise.resolve();
  }

  public removeAllJobDirs(): Promise<void> {
    try {
      this.sandbox.removeAllJobDirs();
    } catch (err: unknown) {
      this.options.logger.warn("Could not remove the job directories", {
        error: describeError(err),
      });
    }

    return Promise.resolve();
  }

  // Why one probe command says the cluster is not usable, or null.
  private describeProbeFailure(
    captured: SandboxCapture,
    command: string,
  ): string | null {
    if (captured.setupError !== null) {
      return `Could not prepare a private directory for ceph: ${captured.setupError}`;
    }

    if (captured.spawnError !== null) {
      return captured.spawnError.code === "ENOENT"
        ? describeMissingBinary({ program: CEPH_PROGRAM, binary: CEPH_BINARY })
        : `Could not start ceph: ${captured.spawnError.message}`;
    }

    if (captured.timedOut || captured.signal === "SIGKILL") {
      return `The Ceph cluster did not answer ${command} within ${describeDuration(
        this.probeTimeoutMs,
      )}: check mon_host in ${this.settings.confPath} and the network to the monitors (TCP 3300 and 6789).`;
    }

    if (captured.signal !== null) {
      return `ceph was terminated by ${captured.signal}.`;
    }

    if (captured.exitCode === 0) {
      return null;
    }

    const kind: CephFailureKind | null = classifyCephFailure(
      captured.stderr,
      this.settings.keyringPath,
    );

    if (kind) {
      return describeCephFailure({
        kind,
        settings: this.settings,
        tier: null,
      });
    }

    const reason: string = lastStderrLine(
      redactOutput({
        resourceType: AiResourceType.CephCluster,
        program: CEPH_PROGRAM,
        text: captured.stderr,
      }),
    );

    return `${command} failed (exit code ${captured.exitCode ?? "?"})${
      reason ? `: ${reason}` : "."
    }`;
  }

  /*
   * Spawn ceph with the agent's connection options and these words, in a
   * fresh job directory; never throws. The keyring search noise is dropped
   * from stderr here, before anything reads it.
   */
  private async capture(
    args: Array<string>,
    timeoutInMs: number,
    connectTimeoutSeconds: number,
  ): Promise<SandboxCapture> {
    const captured: SandboxCapture = await this.sandbox.capture({
      binary: CEPH_BINARY,
      args: buildCephArgv({
        settings: this.settings,
        connectTimeoutSeconds,
        args,
      }),
      timeoutInMs,
      buildEnv: (jobDir: SandboxJobDirectory): Record<string, string> => {
        return buildCephEnvironment({ homeDir: jobDir.homeDir });
      },
    });

    return {
      ...captured,
      stderr: dropKeyringSearchNoise(
        captured.stderr,
        this.settings.keyringPath,
      ),
    };
  }

  private async runCommand(guarded: GuardedCommand): Promise<ExecResult> {
    try {
      const captured: SandboxCapture = await this.capture(
        guarded.args.slice(),
        guarded.timeoutInMs,
        getCephConnectTimeoutSeconds(guarded.timeoutInMs),
      );
      const result: ExecResult = SpawnSandbox.toExecResult(captured, {
        resourceType: AiResourceType.CephCluster,
        program: CEPH_PROGRAM,
        binary: CEPH_BINARY,
        timeoutInMs: guarded.timeoutInMs,
        maxOutputBytes: this.sandbox.getMaxOutputBytes(),
        silenceHint: getCephSilenceHint(this.settings),
      });

      return this.explainFailure(result, captured, guarded.tier);
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        errorMessage: `ceph could not be run: ${describeError(err)}`,
      };
    }
  }

  /*
   * A failed command's message, with what to change added: ceph's own line
   * says what went wrong, this says what to do about it.
   */
  private explainFailure(
    result: ExecResult,
    captured: SandboxCapture,
    tier: ResourceCommandTier,
  ): ExecResult {
    if (
      result.success ||
      captured.setupError !== null ||
      captured.spawnError !== null
    ) {
      return result;
    }

    const message: string = result.errorMessage || "ceph failed";

    if (captured.timedOut || captured.signal === "SIGKILL") {
      if (!isWriteTier(tier)) {
        return result;
      }

      return {
        ...result,
        errorMessage: joinSentences(
          message,
          "The change may already have reached the monitors, which apply it on their own: check ceph status and ceph health detail before running it again.",
        ),
      };
    }

    const kind: CephFailureKind | null = classifyCephFailure(
      captured.stderr,
      this.settings.keyringPath,
    );

    if (!kind) {
      return result;
    }

    return {
      ...result,
      errorMessage: joinSentences(
        message,
        describeCephFailure({ kind, settings: this.settings, tier }),
      ),
    };
  }
}
