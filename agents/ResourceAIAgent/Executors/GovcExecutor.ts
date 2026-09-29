import fs from "fs";
import net from "net";
import path from "path";
import { parseSwitch } from "../Config";
import PrepareGuard, {
  GuardResult,
  GuardedCommand,
  mergeTargets,
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
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import { globMatchesTarget } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The executor for VMware vCenters: runs the govc commands OneUptime AI
 * composed, with the agent's OWN vCenter credentials, as an argv — never
 * through a shell. See ResourceExecutor for the contract every executor
 * keeps.
 *
 * prepare() runs PrepareGuard first (the policy re-check with the agent's
 * copy of GovcCommandPolicy, investigation implies Read, the write switch
 * and write scope, the vCenter's identity), then its own checks:
 *
 *   - the agent can reach vCenter at all: VCENTER_ENDPOINT is an https://
 *     address, there is a user name and password, and a configured CA file
 *     is really there;
 *   - a write never touches a protected object by its NAME, whatever
 *     inventory path the command wrote it with: "/DC/vm/vcsa" is the same
 *     VM as "vcsa" to vCenter, so a protected "vcsa" covers both (the shared
 *     write-scope rule compares whole strings). The vCenter appliance
 *     itself is protected by the host name in VCENTER_ENDPOINT — powering
 *     it off would cut OneUptime AI and every operator off at once.
 *
 * govc then runs as /usr/bin/govc (the image's) with the argv exactly as
 * the payload sent it, and a CLOSED environment built for that one command:
 *
 *   PATH                  a standard one (govc starts no other program)
 *   HOME, GOVMOMI_HOME    the command's private, empty directories — no
 *                         cached session, known-hosts or config from
 *                         anywhere else
 *   GOVC_URL              VCENTER_ENDPOINT as https://HOST[:PORT]/sdk,
 *                         without any user name or password in it
 *   GOVC_USERNAME,        ONEUPTIME_AI_VCENTER_USERNAME / _PASSWORD when set
 *   GOVC_PASSWORD         (a user whose role may power VMs on, off and
 *                         reset them, for fixes), else the collector's
 *                         read-only VCENTER_USERNAME / VCENTER_PASSWORD
 *   GOVC_INSECURE         "true" only when VCENTER_INSECURE_SKIP_VERIFY is
 *   GOVC_TLS_CA_CERTS     VCENTER_CA_FILE, when set
 *   GOVC_PERSIST_SESSION  "false": no session is ever written to disk
 *   GOVC_DATACENTER       passed through when the agent has it
 *
 * Credentials travel in the environment only, never on the argv (which
 * every process on the machine can read). Nothing else of the agent's
 * environment reaches govc: not its OneUptime key, not its proxy settings
 * (vCenter is on the management network, not behind the proxy used to
 * reach OneUptime), not a stray GOVC_URL, GOVC_HOST or GOVC_GUEST_LOGIN.
 *
 * run() never throws; a failure carries govc's own last line plus what an
 * operator should change (credentials, TLS trust, DNS, privileges, ...).
 * probePosture() runs `govc about -json` the same way and reports the
 * vCenter's product, version and build (the Alpine govc package reports
 * its own version as 0.0.0, so the vCenter's is the useful one).
 */

// The govc binary the image installs (Alpine's govc package).
export const GOVC_BINARY: string = "/usr/bin/govc";

const GOVC_PROGRAM: string = "govc";

// The collector's settings, shared through the same .env.
export const VCENTER_ENDPOINT_ENV: string = "VCENTER_ENDPOINT";
export const VCENTER_USERNAME_ENV: string = "VCENTER_USERNAME";
export const VCENTER_PASSWORD_ENV: string = "VCENTER_PASSWORD";
export const VCENTER_INSECURE_SKIP_VERIFY_ENV: string =
  "VCENTER_INSECURE_SKIP_VERIFY";

// The agent's own: a vCenter user for fixes, a CA bundle, a datacenter.
export const AI_VCENTER_USERNAME_ENV: string = "ONEUPTIME_AI_VCENTER_USERNAME";
export const AI_VCENTER_PASSWORD_ENV: string = "ONEUPTIME_AI_VCENTER_PASSWORD";
export const VCENTER_CA_FILE_ENV: string = "VCENTER_CA_FILE";
export const GOVC_DATACENTER_ENV: string = "GOVC_DATACENTER";

// Inside each command's private directory: govc's own state directory.
export const GOVMOMI_HOME_DIR_NAME: string = "govmomi";

/*
 * How long the posture probe (`govc about -json`) may take: inside the
 * agent's own posture timeout (Posture.DEFAULT_PROBE_TIMEOUT_MS, 15s), so
 * the probe says why vCenter did not answer instead of being cut off.
 */
export const GOVC_PROBE_TIMEOUT_MS: number = 10_000;

// The probe's command: the vCenter's product, version and build, as JSON.
export const GOVC_PROBE_ARGS: ReadonlyArray<string> = ["about", "-json"];

const WHERE_TO_SET: string =
  "in the .env file the AI agent shares with the collector";

// "https://", "ftp://": the value names its scheme.
const URL_SCHEME_REGEX: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;

const SENTENCE_END_REGEX: RegExp = /[.!?]$/;

// The longest string read out of `govc about -json` into the posture.
const MAX_ABOUT_FIELD_LENGTH: number = 128;

const AGENT_DISPLAY_NAME: string =
  AI_RESOURCE_TYPE_INFO[AiResourceType.VMwareVCenter].agentDisplayName;

/*
 * ---------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------
 */

// VCENTER_ENDPOINT as govc gets it.
export interface VCenterEndpoint {
  // https://HOST[:PORT]/sdk, without credentials; null when unusable.
  url: string | null;
  // The host alone (lowercased, IPv6 without brackets); null when unusable.
  host: string | null;
  // The value carried a user name or password, which the agent drops.
  hadCredentials: boolean;
  // Why the value cannot be used, in words for an operator; null when fine.
  problem: string | null;
}

export interface GovcSettings {
  url: string | null;
  host: string | null;
  endpointHadCredentials: boolean;
  username: string;
  password: string;
  // The variables the credentials come from, for messages (never values).
  usernameVariable: string;
  passwordVariable: string;
  insecureSkipVerify: boolean;
  caFile: string | null;
  datacenter: string | null;
  // What stops govc from running at all; empty when nothing does.
  problems: Array<string>;
}

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value.trim() : "";
}

// A password is used exactly as set: surrounding spaces may be part of it.
function readRaw(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value : "";
}

// The configured value for a message — unless it holds a credential.
function showEndpoint(raw: string): string {
  return raw.includes("@")
    ? "(its value is not shown: it contains a user name or password)"
    : `"${raw}"`;
}

/*
 * VCENTER_ENDPOINT — scheme + host, as the collector takes it — as the URL
 * govc wants: https://HOST[:PORT]/sdk. A bare host gets https://, a path
 * of its own is kept (a trailing slash dropped), and a user name or
 * password in it is dropped (the agent logs in with the variables only).
 * Plain http:// is refused: vCenter serves its API over HTTPS only, and the
 * agent never sends its password in clear text.
 */
export function normalizeVCenterEndpoint(
  value: string | null | undefined,
): VCenterEndpoint {
  const raw: string = typeof value === "string" ? value.trim() : "";
  const unusable: (problem: string) => VCenterEndpoint = (
    problem: string,
  ): VCenterEndpoint => {
    return { url: null, host: null, hadCredentials: false, problem };
  };

  if (!raw) {
    return unusable(
      `${VCENTER_ENDPOINT_ENV} is not set. Set it ${WHERE_TO_SET} to your vCenter's address, e.g. https://vcsa.example.com.`,
    );
  }

  const withScheme: string = URL_SCHEME_REGEX.test(raw)
    ? raw
    : `https://${raw}`;

  let parsed: URL;

  try {
    parsed = new URL(withScheme);
  } catch {
    return unusable(
      `${VCENTER_ENDPOINT_ENV} ${showEndpoint(raw)} is not an address. Set it ${WHERE_TO_SET} to scheme + host of your vCenter, e.g. https://vcsa.example.com.`,
    );
  }

  if (parsed.protocol === "http:") {
    return unusable(
      `${VCENTER_ENDPOINT_ENV} ${showEndpoint(raw)} is a plain http:// address. vCenter serves its API over HTTPS only, and the agent never sends its vCenter password unencrypted: use https://.`,
    );
  }

  if (parsed.protocol !== "https:") {
    return unusable(
      `${VCENTER_ENDPOINT_ENV} ${showEndpoint(raw)} is not an https:// address. Set it ${WHERE_TO_SET} to scheme + host of your vCenter, e.g. https://vcsa.example.com.`,
    );
  }

  const host: string = parsed.hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();

  if (!host) {
    return unusable(
      `${VCENTER_ENDPOINT_ENV} ${showEndpoint(raw)} names no host. Set it ${WHERE_TO_SET} to scheme + host of your vCenter, e.g. https://vcsa.example.com.`,
    );
  }

  const hadCredentials: boolean =
    parsed.username !== "" || parsed.password !== "";
  const pathname: string = parsed.pathname.replace(/\/+$/, "") || "/sdk";

  return {
    url: `https://${parsed.host.toLowerCase()}${pathname}`,
    host,
    hadCredentials,
    problem: null,
  };
}

/*
 * Everything govc needs from the agent's environment. Never throws; what is
 * missing or unusable is listed in problems, each naming the variable to
 * set.
 *
 * Credentials: the AI pair (ONEUPTIME_AI_VCENTER_USERNAME / _PASSWORD) when
 * its user name is set — a vCenter user whose role may carry out fixes —
 * else the collector's read-only pair. Half an AI pair is a problem, not a
 * silent fallback: the operator meant the agent to use another user.
 */
export function resolveGovcSettings(env: NodeJS.ProcessEnv): GovcSettings {
  const problems: Array<string> = [];
  const endpoint: VCenterEndpoint = normalizeVCenterEndpoint(
    readRaw(env, VCENTER_ENDPOINT_ENV),
  );

  if (endpoint.problem) {
    problems.push(endpoint.problem);
  }

  const aiUsername: string = readTrimmed(env, AI_VCENTER_USERNAME_ENV);
  const aiPassword: string = readRaw(env, AI_VCENTER_PASSWORD_ENV);
  let username: string;
  let password: string;
  let usernameVariable: string;
  let passwordVariable: string;

  if (aiUsername || aiPassword) {
    username = aiUsername;
    password = aiPassword;
    usernameVariable = AI_VCENTER_USERNAME_ENV;
    passwordVariable = AI_VCENTER_PASSWORD_ENV;

    if (!aiUsername) {
      problems.push(
        `${AI_VCENTER_PASSWORD_ENV} is set but ${AI_VCENTER_USERNAME_ENV} is not. Set both ${WHERE_TO_SET} (the vCenter user OneUptime AI works as), or neither, and the agent uses ${VCENTER_USERNAME_ENV} / ${VCENTER_PASSWORD_ENV}.`,
      );
    } else if (!aiPassword) {
      problems.push(
        `${AI_VCENTER_USERNAME_ENV} is set but ${AI_VCENTER_PASSWORD_ENV} is not. Set that user's password ${WHERE_TO_SET}, or remove ${AI_VCENTER_USERNAME_ENV} to use ${VCENTER_USERNAME_ENV} / ${VCENTER_PASSWORD_ENV}.`,
      );
    }
  } else {
    username = readTrimmed(env, VCENTER_USERNAME_ENV);
    password = readRaw(env, VCENTER_PASSWORD_ENV);
    usernameVariable = VCENTER_USERNAME_ENV;
    passwordVariable = VCENTER_PASSWORD_ENV;

    if (!username) {
      problems.push(
        `${VCENTER_USERNAME_ENV} is not set. Set it ${WHERE_TO_SET} to the vSphere user the agent logs in as (e.g. oneuptime@vsphere.local), or set ${AI_VCENTER_USERNAME_ENV} / ${AI_VCENTER_PASSWORD_ENV}.`,
      );
    }

    if (!password) {
      problems.push(
        `${VCENTER_PASSWORD_ENV} is not set. Set it ${WHERE_TO_SET} to the password of ${VCENTER_USERNAME_ENV}.`,
      );
    }
  }

  const caFile: string = readTrimmed(env, VCENTER_CA_FILE_ENV);
  const datacenter: string = readTrimmed(env, GOVC_DATACENTER_ENV);

  return {
    url: endpoint.url,
    host: endpoint.host,
    endpointHadCredentials: endpoint.hadCredentials,
    username,
    password,
    usernameVariable,
    passwordVariable,
    insecureSkipVerify: parseSwitch(
      readRaw(env, VCENTER_INSECURE_SKIP_VERIFY_ENV),
    ),
    caFile: caFile || null,
    datacenter: datacenter || null,
    problems,
  };
}

/*
 * Why the configured CA file cannot be used, or null. Checked before every
 * command (a mount can come and go), so the operator reads "not mounted"
 * rather than a TLS error.
 */
export function getCaFileProblem(caFile: string | null): string | null {
  if (!caFile) {
    return null;
  }

  let stat: fs.Stats;

  try {
    stat = fs.statSync(caFile);
  } catch {
    return `${VCENTER_CA_FILE_ENV}="${caFile}" does not exist in the agent's container. Mount the CA bundle that signed vCenter's certificate there (read-only), or unset ${VCENTER_CA_FILE_ENV}.`;
  }

  if (!stat.isFile()) {
    return `${VCENTER_CA_FILE_ENV}="${caFile}" is not a file. Point it at the PEM file with the CA that signed vCenter's certificate.`;
  }

  try {
    fs.accessSync(caFile, fs.constants.R_OK);
  } catch {
    return `${VCENTER_CA_FILE_ENV}="${caFile}" is not readable by the agent (it runs as UID 1000 unless its compose file says otherwise). Make the file world-readable: it holds only public certificates.`;
  }

  return null;
}

/*
 * govc's COMPLETE environment for one command (see the header). Nothing of
 * the agent's own environment is merged in; SpawnSandbox closes it again.
 */
export function buildGovcEnvironment(data: {
  settings: GovcSettings;
  homeDir: string;
  govmomiHome: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: DEFAULT_SPAWN_PATH,
    HOME: data.homeDir,
    GOVMOMI_HOME: data.govmomiHome,
    GOVC_URL: data.settings.url || "",
    GOVC_USERNAME: data.settings.username,
    GOVC_PASSWORD: data.settings.password,
    GOVC_INSECURE: data.settings.insecureSkipVerify ? "true" : "false",
    GOVC_PERSIST_SESSION: "false",
  };

  if (data.settings.caFile) {
    env["GOVC_TLS_CA_CERTS"] = data.settings.caFile;
  }

  if (data.settings.datacenter) {
    env["GOVC_DATACENTER"] = data.settings.datacenter;
  }

  return env;
}

/*
 * ---------------------------------------------------------------------------
 * Protected objects
 * ---------------------------------------------------------------------------
 */

/*
 * The vCenter appliance, by the host name the agent reaches it at: the VM
 * is nearly always named after it ("vcsa" for vcsa.example.com). An IP
 * address names no VM, so it protects nothing.
 */
export function getEndpointProtectedTargets(
  host: string | null,
): Array<string> {
  if (!host || net.isIP(host) !== 0) {
    return [];
  }

  const targets: Array<string> = [host];
  const shortName: string = host.split(".")[0] || "";

  if (shortName && shortName !== host) {
    targets.push(shortName);
  }

  return targets;
}

// The object's own name: the last segment of an inventory path.
export function inventoryName(value: string): string {
  const segments: Array<string> = value
    .trim()
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  return segments[segments.length - 1] || "";
}

/*
 * The first target of a write that a protected entry names, compared by
 * the objects' own names (case-insensitive, `*` in the entry): a VM is the
 * same VM whether the command names it "vcsa" or "/DC/vm/infra/vcsa".
 */
export function findProtectedGovcTarget(data: {
  targets: Array<string>;
  protectedTargets: Array<string>;
}): { target: string; protectedTarget: string } | null {
  for (const target of data.targets) {
    if (typeof target !== "string") {
      continue;
    }

    const name: string = inventoryName(target).toLowerCase();

    if (!name) {
      continue;
    }

    for (const protectedTarget of data.protectedTargets) {
      if (typeof protectedTarget !== "string") {
        continue;
      }

      const protectedName: string =
        inventoryName(protectedTarget).toLowerCase();

      if (
        protectedName &&
        (protectedName === name || globMatchesTarget(protectedName, name))
      ) {
        return { target, protectedTarget };
      }
    }
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * Failures, in words for an operator
 * ---------------------------------------------------------------------------
 */

export type GovcFailureKind =
  | "login"
  | "tls_name"
  | "tls_expired"
  | "tls_untrusted"
  | "dns"
  | "refused"
  | "network"
  | "permission"
  | "datacenter"
  | "ambiguous"
  | "tools"
  | "state"
  | "not_found";

// In order: the first rule that matches govc's stderr names the failure.
const FAILURE_RULES: ReadonlyArray<[GovcFailureKind, RegExp]> = [
  [
    "login",
    /incorrect user name or password|InvalidLogin|cannot complete login|NotAuthenticated|session is not authenticated/i,
  ],
  [
    "tls_name",
    /doesn't contain any IP SANs|certificate is valid for .*, not |certificate is not valid for any names/i,
  ],
  ["tls_expired", /certificate has expired|certificate is not yet valid/i],
  [
    "tls_untrusted",
    /x509:|certificate signed by unknown authority|failed to verify certificate|certificate is not trusted|unknown authority|self[- ]signed certificate/i,
  ],
  ["dns", /no such host|server misbehaving|name resolution/i],
  ["refused", /connection refused/i],
  [
    "network",
    /i\/o timeout|no route to host|network is unreachable|connection reset|context deadline exceeded|handshake timeout|dial tcp/i,
  ],
  [
    "permission",
    /NoPermission|permission to perform this operation was denied|NotAuthorized|not authorized/i,
  ],
  [
    "datacenter",
    /default datacenter resolves to multiple|datacenter .*resolves to multiple|specify a datacenter/i,
  ],
  ["ambiguous", /resolves to multiple|matches multiple/i],
  [
    "tools",
    /VMware Tools is not running|ToolsUnavailable|Tools is not running|Tools are not running/i,
  ],
  [
    "state",
    /InvalidPowerState|InvalidState|TaskInProgress|cannot be performed in the current state|not allowed in the current state|task is already in progress/i,
  ],
  ["not_found", /not found/i],
];

// What kind of failure govc's stderr describes, or null.
export function classifyGovcFailure(stderr: string): GovcFailureKind | null {
  if (typeof stderr !== "string" || !stderr.trim()) {
    return null;
  }

  for (const [kind, pattern] of FAILURE_RULES) {
    if (pattern.test(stderr)) {
      return kind;
    }
  }

  return null;
}

/*
 * What to change for a failure of this kind. Short enough to survive the
 * posture's 256-character bound for the connection failures a probe hits.
 */
export function describeGovcFailure(data: {
  kind: GovcFailureKind;
  settings: GovcSettings;
  // The command's tier; null for the posture probe.
  tier: ResourceCommandTier | null;
}): string {
  const settings: GovcSettings = data.settings;
  const where: string = settings.url || VCENTER_ENDPOINT_ENV;

  switch (data.kind) {
    case "login":
      return `vCenter rejected the agent's login: check ${settings.usernameVariable} (the full principal, such as oneuptime@vsphere.local) and ${settings.passwordVariable}, and that the account is not locked.`;
    case "tls_name":
      return `vCenter's TLS certificate does not name the host in ${VCENTER_ENDPOINT_ENV}: use the host name the certificate was issued to.`;
    case "tls_expired":
      return `vCenter's TLS certificate has expired or is not valid yet: renew it in vCenter (Certificate Management).`;
    case "tls_untrusted":
      return settings.caFile
        ? `The CA file in ${VCENTER_CA_FILE_ENV} (${settings.caFile}) does not include the CA that signed vCenter's TLS certificate: add vCenter's VMCA root certificate to it.`
        : `The agent does not trust vCenter's TLS certificate: set ${VCENTER_CA_FILE_ENV} to a mounted file with vCenter's CA (its VMCA root), or ${VCENTER_INSECURE_SKIP_VERIFY_ENV}=true on a private network.`;
    case "dns":
      return `The agent cannot resolve ${
        settings.host || "the host"
      } (${VCENTER_ENDPOINT_ENV}): check the name and the DNS the agent's container uses.`;
    case "refused":
      return `Nothing accepts connections at ${where}: check the host and port in ${VCENTER_ENDPOINT_ENV} and that vCenter is running.`;
    case "network":
      return `The agent cannot reach vCenter at ${where}: check the network and firewall between them (TCP 443).`;
    case "permission":
      return data.tier === ResourceCommandTier.SafeWrite ||
        data.tier === ResourceCommandTier.RiskyWrite
        ? `The vCenter user in ${settings.usernameVariable} may not make this change: give the user in ${AI_VCENTER_USERNAME_ENV} a role with VirtualMachine.Interact.PowerOn, PowerOff and Reset (Host.Config.Maintenance for maintenance mode, Resource.HotMigrate for vm.migrate) on these objects, then restart the agent.`
        : `The vCenter user in ${settings.usernameVariable} cannot see this object: grant it the Read-Only role on the top-level vCenter object with "Propagate to children".`;
    case "datacenter":
      return `This vCenter has more than one datacenter: add -dc DATACENTER to the command (or set ${GOVC_DATACENTER_ENV} on the agent), or name objects by their full inventory path.`;
    case "ambiguous":
      return "The name matches more than one object: name it by its full inventory path (/DATACENTER/vm/FOLDER/NAME), as govc find or govc ls prints it.";
    case "tools":
      return "vm.power -r and -s need VMware Tools running in the guest (see govc vm.info); without it, only -reset or -off restart or stop the VM.";
    case "state":
      return "The object is not in a state that allows this (it is already in that power state, or another task is changing it): check govc vm.info and govc tasks.";
    case "not_found":
      return "No object has that name: find it with govc find . -name NAME or govc ls /DATACENTER/vm, and use the exact name or path.";
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

/*
 * ---------------------------------------------------------------------------
 * `govc about -json`
 * ---------------------------------------------------------------------------
 */

export interface GovcAbout {
  // "VMware vCenter Server 8.0.2 build-22385739"
  fullName: string | null;
  // "VMware vCenter Server"
  name: string | null;
  version: string | null;
  build: string | null;
  // "VirtualCenter" (vCenter) or "HostAgent" (a standalone ESXi host)
  apiType: string | null;
  apiVersion: string | null;
}

// A key of a JSON object whatever its case (govmomi changed it over time).
function readKey(value: unknown, name: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const wanted: string = name.toLowerCase();

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === wanted) {
      return entry;
    }
  }

  return undefined;
}

function readText(value: unknown, name: string): string | null {
  const entry: unknown = readKey(value, name);

  if (typeof entry !== "string" || !entry.trim()) {
    return null;
  }

  return entry.trim().slice(0, MAX_ABOUT_FIELD_LENGTH);
}

/*
 * The vCenter's product facts from `govc about -json`: {"about": {...}} in
 * current govc (lowerCamelCase keys), {"About": {...}} (PascalCase) in
 * older ones. Null when the output is not that.
 */
export function parseGovcAbout(stdout: string): GovcAbout | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  const nested: unknown = readKey(parsed, "about");
  const about: unknown = nested && typeof nested === "object" ? nested : parsed;

  const result: GovcAbout = {
    fullName: readText(about, "fullName"),
    name: readText(about, "name"),
    version: readText(about, "version"),
    build: readText(about, "build"),
    apiType: readText(about, "apiType"),
    apiVersion: readText(about, "apiVersion"),
  };

  const hasAnything: boolean = Object.values(result).some(
    (entry: string | null): boolean => {
      return entry !== null;
    },
  );

  return hasAnything ? result : null;
}

// The version the posture reports: the full name, or name + version + build.
export function describeGovcAboutVersion(about: GovcAbout): string | null {
  if (about.fullName) {
    return about.fullName;
  }

  const parts: Array<string> = [
    about.name || "",
    about.version || "",
    about.build ? `build-${about.build}` : "",
  ].filter((part: string): boolean => {
    return part.length > 0;
  });

  return parts.length > 0 ? parts.join(" ") : null;
}

/*
 * ---------------------------------------------------------------------------
 * The executor
 * ---------------------------------------------------------------------------
 */

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default class GovcExecutor implements ResourceExecutor {
  // How long the posture probe may take (a test shortens it).
  public probeTimeoutMs: number = GOVC_PROBE_TIMEOUT_MS;
  protected readonly sandbox: SpawnSandbox;
  private readonly settings: GovcSettings;

  public constructor(protected readonly options: ExecutorOptions) {
    this.sandbox = new SpawnSandbox({
      tmpDir: options.tmpDir,
      spawnImpl: options.spawnImpl,
      logger: options.logger,
    });
    this.settings = resolveGovcSettings(options.env || {});

    if (this.settings.endpointHadCredentials) {
      options.logger.warn(
        `${VCENTER_ENDPOINT_ENV} contains a user name or password. The ${AGENT_DISPLAY_NAME} ignores them and logs in with ${this.settings.usernameVariable} / ${this.settings.passwordVariable}; remove them from ${VCENTER_ENDPOINT_ENV}.`,
      );
    }
  }

  // What the agent read from its environment (test seam; holds the password).
  public getSettings(): GovcSettings {
    return this.settings;
  }

  /*
   * The objects this agent never changes on its own account (reported in
   * its posture, enforced in prepare): the vCenter appliance, by the host
   * name in VCENTER_ENDPOINT. ONEUPTIME_AI_PROTECTED_TARGETS adds the rest.
   */
  public getProtectedTargets(): Array<string> {
    return getEndpointProtectedTargets(this.settings.host);
  }

  // Why govc cannot run at all right now, or null.
  public getConfigurationProblem(): string | null {
    if (this.settings.problems.length > 0) {
      return this.settings.problems.join(" ");
    }

    return getCaFileProblem(this.settings.caFile);
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const protectedTargets: Array<string> = this.getProtectedTargets();
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      protectedTargets,
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    const refused: string = refusalPrefix(guarded.resourceType);

    // This executor starts govc and nothing else, for a vCenter only.
    if (
      guarded.resourceType !== AiResourceType.VMwareVCenter ||
      guarded.program !== GOVC_PROGRAM
    ) {
      return {
        refusal: `${refused}: this executor runs govc for a VMware vCenter only, not "${guarded.program}" for a ${guarded.resourceType}.`,
      };
    }

    const problem: string | null = this.getConfigurationProblem();

    if (problem) {
      return {
        refusal: `${refused}: it cannot reach vCenter as configured. ${problem}`,
      };
    }

    if (guarded.tier !== ResourceCommandTier.Read) {
      const hit: { target: string; protectedTarget: string } | null =
        findProtectedGovcTarget({
          targets: Array.isArray(guarded.policy.targets)
            ? guarded.policy.targets
            : [],
          protectedTargets: mergeTargets(
            this.options.config.protectedTargets,
            protectedTargets,
          ),
        });

      if (hit) {
        return {
          refusal: `${refused}: "${guarded.displayCommand}" would change ${hit.target}, which the ${AGENT_DISPLAY_NAME} protects (${hit.protectedTarget}): OneUptime AI never changes the vCenter it works through or anything in ONEUPTIME_AI_PROTECTED_TARGETS, whatever inventory path names it.`,
        };
      }
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
    const details: Record<string, string | number | boolean | null> =
      this.describeConnection();

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

      const captured: SandboxCapture = await this.capture(
        [...GOVC_PROBE_ARGS],
        this.probeTimeoutMs,
      );

      if (captured.setupError !== null) {
        return unreachable(
          `Could not prepare a private directory for govc: ${captured.setupError}`,
        );
      }

      if (captured.spawnError !== null) {
        return unreachable(
          captured.spawnError.code === "ENOENT"
            ? describeMissingBinary({
                program: GOVC_PROGRAM,
                binary: GOVC_BINARY,
              })
            : `Could not start govc: ${captured.spawnError.message}`,
        );
      }

      if (captured.timedOut || captured.signal === "SIGKILL") {
        return unreachable(
          `vCenter did not answer within ${
            this.probeTimeoutMs >= 1000
              ? `${Math.round(this.probeTimeoutMs / 1000)}s`
              : `${this.probeTimeoutMs}ms`
          }: check ${VCENTER_ENDPOINT_ENV} (${
            this.settings.url || "not set"
          }) and the network to it (TCP 443).`,
        );
      }

      if (captured.signal !== null) {
        return unreachable(`govc was terminated by ${captured.signal}.`);
      }

      if (captured.exitCode !== 0) {
        const kind: GovcFailureKind | null = classifyGovcFailure(
          captured.stderr,
        );

        if (kind) {
          return unreachable(
            describeGovcFailure({ kind, settings: this.settings, tier: null }),
          );
        }

        const reason: string = lastStderrLine(
          redactOutput({
            resourceType: AiResourceType.VMwareVCenter,
            program: GOVC_PROGRAM,
            text: captured.stderr,
          }),
        );

        return unreachable(
          `govc about failed (exit code ${captured.exitCode ?? "?"})${
            reason ? `: ${reason}` : "."
          }`,
        );
      }

      const about: GovcAbout | null = parseGovcAbout(captured.stdout);

      if (about) {
        details["vcenterProduct"] = about.name;
        details["vcenterVersion"] = about.version;
        details["vcenterBuild"] = about.build;
        details["vcenterApiType"] = about.apiType;
        details["vcenterApiVersion"] = about.apiVersion;
      }

      return {
        toolVersion: about ? describeGovcAboutVersion(about) : null,
        reachable: true,
        reachError: null,
        details,
        protectedTargets,
      };
    } catch (err: unknown) {
      return unreachable(`Checking vCenter failed: ${describeError(err)}`);
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

  /*
   * How the agent connects, for the posture's details: never a credential,
   * only which variables they come from.
   */
  private describeConnection(): Record<
    string,
    string | number | boolean | null
  > {
    return {
      vcenterHost: this.settings.host,
      credentialSource: this.settings.usernameVariable,
      tlsVerification: this.settings.insecureSkipVerify
        ? "skipped"
        : this.settings.caFile
          ? "custom-ca"
          : "system-ca",
      datacenter: this.settings.datacenter,
    };
  }

  // Spawn govc with this argv in a fresh job directory; never throws.
  private capture(
    args: Array<string>,
    timeoutInMs: number,
  ): Promise<SandboxCapture> {
    return this.sandbox.capture({
      binary: GOVC_BINARY,
      args,
      timeoutInMs,
      prepareJobDir: (jobDir: SandboxJobDirectory): void => {
        jobDir.makePrivateDir(GOVMOMI_HOME_DIR_NAME);
      },
      buildEnv: (jobDir: SandboxJobDirectory): Record<string, string> => {
        return buildGovcEnvironment({
          settings: this.settings,
          homeDir: jobDir.homeDir,
          govmomiHome: path.join(jobDir.path, GOVMOMI_HOME_DIR_NAME),
        });
      },
    });
  }

  private async runCommand(guarded: GuardedCommand): Promise<ExecResult> {
    try {
      const captured: SandboxCapture = await this.capture(
        guarded.args.slice(),
        guarded.timeoutInMs,
      );
      const result: ExecResult = SpawnSandbox.toExecResult(captured, {
        resourceType: AiResourceType.VMwareVCenter,
        program: GOVC_PROGRAM,
        binary: GOVC_BINARY,
        timeoutInMs: guarded.timeoutInMs,
        maxOutputBytes: this.sandbox.getMaxOutputBytes(),
        silenceHint: `vCenter at ${
          this.settings.url || VCENTER_ENDPOINT_ENV
        } is probably unreachable from this agent (check ${VCENTER_ENDPOINT_ENV} and the network between them on TCP 443)`,
      });

      return this.explainFailure(result, captured, guarded.tier);
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        errorMessage: `govc could not be run: ${describeError(err)}`,
      };
    }
  }

  /*
   * A failed command's message, with what to change added: govc's own line
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

    const message: string = result.errorMessage || "govc failed";

    if (captured.timedOut || captured.signal === "SIGKILL") {
      if (tier === ResourceCommandTier.Read) {
        return result;
      }

      return {
        ...result,
        errorMessage: joinSentences(
          message,
          "The change may already have reached vCenter, which carries it out as a task that can still complete: check govc tasks and the object's state before running it again.",
        ),
      };
    }

    const kind: GovcFailureKind | null = classifyGovcFailure(captured.stderr);

    if (!kind) {
      return result;
    }

    return {
      ...result,
      errorMessage: joinSentences(
        message,
        describeGovcFailure({ kind, settings: this.settings, tier }),
      ),
    };
  }
}
