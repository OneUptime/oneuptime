/*
 * The pvesh command policy: what OneUptime AI may ask the Proxmox AI agent
 * to do on a Proxmox VE cluster.
 *
 * There is no pvesh binary in the agent. A command is written in pvesh's
 * grammar, because that is what models know —
 *
 *   pvesh <get|ls|create> <api-path> [--name value | --name=value]...
 *         [--output-format json|json-pretty|text]
 *
 * — and the agent turns it into ONE call to the Proxmox VE HTTPS API
 * (https://PVE_HOST:8006/api2/json<path>) with its own API token: get and
 * ls are a GET, create is a POST. parseProxmoxCommand, exported below, is
 * that translation, and it is the SAME analysis this policy tiers: it only
 * ever returns a request for a command evaluateArgv does not deny, so there
 * is no second parser (and no real pvesh) whose reading of the words could
 * differ from the one that was judged.
 *
 * ---- Grammar ---------------------------------------------------------------
 *
 * A strict subset of what the real pvesh (Perl, Getopt::Long) accepts, so a
 * command copied from the Proxmox docs either works as written or is
 * refused with a reason that says what to write instead:
 *   - The command word comes right after "pvesh" (pvesh picks its command
 *     from the first word, before it parses any option). get and ls read,
 *     create acts; set (a PUT: configuration), delete, usage and help are
 *     refused.
 *   - Exactly one API path, anywhere after the command word. It starts with
 *     "/" and has no query string (?a=b), fragment, percent-encoding,
 *     whitespace, or empty, "." or ".." segment; a single trailing "/" is
 *     dropped. Paths are compared case-sensitively, as the API does.
 *   - Every option is "--name value" or "--name=value", and EVERY option
 *     takes a value: booleans are written 0 or 1 ("--online 1"), never bare.
 *     So which word is a value never depends on which option it follows,
 *     and a value never starts with "-": "--timeout --forceStop 1" is
 *     refused rather than read as a timeout of "--forceStop", so a flag can
 *     never hide inside another flag's value.
 *   - Single-dash options ("-timeout", Getopt::Long's other spelling),
 *     combined short options ("-abc"), unique-prefix abbreviations
 *     ("--time"), "--" and an option given twice are refused: each would be
 *     a second spelling of something the policy has to see exactly once.
 *   - Options are checked per path against a closed list, and every value
 *     against its own pattern; an option that is not listed is Denied.
 *
 * ---- Tiers -----------------------------------------------------------------
 *
 * Read (get, ls) is an ALLOWLIST of path shapes (READ_ROUTES) whose
 * variable segments are validated: a node name, a VMID (a leading zero
 * would be a second spelling of the same guest, so it is refused), a task
 * UPID, a storage or a service id. Everything under /access (users, API
 * tokens, ACLs, two-factor, tickets) is Denied, as are consoles (vncproxy,
 * termproxy, spiceproxy, ...: the Proxmox equivalent of exec), the QEMU
 * monitor and the guest agent's exec, file and password calls. A guest's
 * config and pending changes (cloud-init passwords) and the cluster storage
 * list are readable because ResourceOutputRedactor masks their secrets.
 *
 * create (POST) is Denied except:
 *   SafeWrite   /nodes/{node}/{qemu|lxc}/{vmid}/status/{start|resume|reboot}
 *               — one named guest; shutting it down again undoes it.
 *   RiskyWrite  .../status/{shutdown|stop|suspend}, /nodes/{node}/qemu/
 *               {vmid}/status/reset, and /nodes/{node}/services/{service}/
 *               {start|restart|reload} for RESTARTABLE_SERVICES.
 *   RiskyWrite + requiresHuman
 *               .../migrate (it moves a guest between nodes and, offline,
 *               stops it while it moves), and a start, restart or reload of
 *               corosync or pve-cluster (cluster membership, quorum and
 *               /etc/pve) — never unattended, whatever the mode.
 * A write must name its node: "localhost" (whichever node the agent's API
 * endpoint happens to be) is refused, because the node the change lands on
 * — and so the service target it touches — would be unknown.
 *
 * Targets (what ONEUPTIME_AI_WRITE_TARGETS and the agent's protected targets
 * are compared with): a guest write targets its VMID ("101"), which is
 * unique across the cluster and stays the guest's name on whichever node it
 * runs; a node-service write targets "<node>/<service>" ("pve1/pveproxy").
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only,
 * nothing from Node. Total: evaluateArgv and parseProxmoxCommand never
 * throw, whatever they are handed.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { MAX_COMMAND_LENGTH_CHARS } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import {
  MAX_RESOURCE_COMMAND_TOKENS,
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";

export const PVESH_PROGRAM: string = "pvesh";

export type ProxmoxApiMethod = "GET" | "POST";

export type ProxmoxOutputFormat = "json" | "json-pretty" | "text";

export const PROXMOX_OUTPUT_FORMATS: ReadonlyArray<ProxmoxOutputFormat> = [
  "json",
  "json-pretty",
  "text",
];

// The one option every path takes: how the agent prints the API's answer.
export const PROXMOX_OUTPUT_FORMAT_OPTION: string = "output-format";

// The longest API path this policy reads.
export const MAX_PROXMOX_API_PATH_CHARS: number = 512;

/*
 * The HTTPS call a pvesh command becomes. Built only for a command the
 * policy does not deny: GET params go in the query string, POST params in
 * the form body. The API wraps every answer as {"data": ...}; print the
 * data member, never the envelope — the generic output redaction rules read
 * a top-level "data" object as a Kubernetes Secret's data and mask all of
 * it.
 */
export interface ProxmoxApiRequest {
  method: ProxmoxApiMethod;
  /*
   * The canonical path under /api2/json: starts with "/", no trailing "/",
   * every segment validated. A segment never holds "/", "?", "#", "%" or
   * whitespace, but a task UPID holds ":", "@" and "!": encode each segment
   * (encodeURIComponent) when building the URL.
   */
  path: string;
  // The options by API parameter name, values exactly as validated.
  params: Record<string, string>;
  // --output-format, or null when the command did not choose one.
  outputFormat: ProxmoxOutputFormat | null;
}

export interface ProxmoxCommandParseResult {
  // Set when the command may run.
  request?: ProxmoxApiRequest | undefined;
  // Why it may not (the policy's Denied reason); set when it may not.
  errorMessage?: string | undefined;
}

// ---- Values ------------------------------------------------------------------

interface ProxmoxValueRule {
  // What a valid value looks like, for refusals: "0 or 1".
  expected: string;
  accepts: (value: string) => boolean;
}

function enumRule(
  values: ReadonlyArray<string>,
  expected?: string,
): ProxmoxValueRule {
  return {
    expected:
      expected ||
      (values.length === 1
        ? `exactly ${values[0]}`
        : `one of ${values.join(", ")}`),
    accepts: (value: string): boolean => {
      return values.includes(value);
    },
  };
}

const DECIMAL_REGEX: RegExp = /^(?:0|[1-9][0-9]{0,9})$/;

// A whole number written plainly (no sign, no leading zero) within [min, max].
function integerRule(min: number, max: number): ProxmoxValueRule {
  return {
    expected: `a whole number from ${min} to ${max}`,
    accepts: (value: string): boolean => {
      if (!DECIMAL_REGEX.test(value)) {
        return false;
      }

      const parsed: number = Number(value);

      return parsed >= min && parsed <= max;
    },
  };
}

function patternRule(pattern: RegExp, expected: string): ProxmoxValueRule {
  return {
    expected,
    accepts: (value: string): boolean => {
      return pattern.test(value);
    },
  };
}

// PVE's own boolean spellings are many; 0 and 1 are the ones it always takes.
const BOOLEAN_RULE: ProxmoxValueRule = enumRule(["0", "1"], "0 or 1");

/*
 * A node name as PVE writes it: a hostname label (dots allowed, as some
 * clusters use FQDNs).
 */
const NODE_NAME_REGEX: RegExp = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;

/*
 * The API's alias for "the node that answers this request" — for the agent,
 * whichever node PVE_HOST points at.
 */
const LOCAL_NODE_ALIAS: string = "localhost";

/*
 * A guest id. PVE's own range is 100 to 999999999; a leading zero is
 * refused because "0101" and "101" would be two spellings of one guest, and
 * write targets are compared as text.
 */
const VMID_REGEX: RegExp = /^[1-9][0-9]{1,8}$/;

/*
 * A task id as PVE::Tools::upid_decode reads it:
 * UPID:<node>:<pid>:<pstart>:<starttime>:<type>:<id>:<user>: (hex numbers;
 * the id may be empty; the user may carry an API token's "!name").
 */
const UPID_REGEX: RegExp =
  /^UPID:[A-Za-z0-9][A-Za-z0-9.-]{0,62}:[0-9A-Fa-f]{8}:[0-9A-Fa-f]{8,9}:[0-9A-Fa-f]{8}:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_.@!-]{0,128}:[A-Za-z0-9_.@!-]{1,128}:$/;

// PVE's pve-storage-id: a letter, then letters, digits, "-", "_" or ".".
const STORAGE_ID_REGEX: RegExp =
  /^[A-Za-z](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;

// A systemd service name as /nodes/{node}/services lists them.
const SERVICE_ID_REGEX: RegExp = /^[a-z][a-z0-9-]{0,63}$/;

// A block device, as /nodes/{node}/disks/list prints it.
const DISK_PATH_REGEX: RegExp =
  /^\/dev\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}){0,3}$/;

const VMID_RULE: ProxmoxValueRule = patternRule(
  VMID_REGEX,
  "a guest id (VMID) such as 101",
);

const NODE_NAME_RULE: ProxmoxValueRule = patternRule(
  NODE_NAME_REGEX,
  "a node name such as pve2",
);

// A UNIX timestamp in seconds.
const EPOCH_RULE: ProxmoxValueRule = integerRule(0, 9999999999);

const COUNT_RULE: ProxmoxValueRule = integerRule(1, 5000);

const OFFSET_RULE: ProxmoxValueRule = integerRule(0, 1000000);

// /nodes/{node}/syslog reads journal times, not timestamps.
const SYSLOG_TIME_RULE: ProxmoxValueRule = patternRule(
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?: [0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?$/,
  "a time such as 2025-01-31 or '2025-01-31 14:05' (quote it)",
);

// A guest's own timeout (seconds) for start, reboot and shutdown.
const GUEST_TIMEOUT_RULE: ProxmoxValueRule = integerRule(0, 3600);

const RRD_TIMEFRAME_RULE: ProxmoxValueRule = enumRule(["hour", "day", "week"]);

const RRD_CF_RULE: ProxmoxValueRule = enumRule(["AVERAGE", "MAX"]);

const RRD_PARAMS: Readonly<Record<string, ProxmoxValueRule>> = {
  timeframe: RRD_TIMEFRAME_RULE,
  cf: RRD_CF_RULE,
};

const STORAGE_CONTENT_TYPES: ReadonlyArray<string> = [
  "images",
  "rootdir",
  "vztmpl",
  "iso",
  "backup",
  "snippets",
  "import",
];

const STORAGE_CONTENT_RULE: ProxmoxValueRule = {
  expected: `a comma-separated list of ${STORAGE_CONTENT_TYPES.join(", ")}`,
  accepts: (value: string): boolean => {
    const parts: Array<string> = value.split(",");

    return (
      parts.length <= STORAGE_CONTENT_TYPES.length &&
      parts.every((part: string): boolean => {
        return STORAGE_CONTENT_TYPES.includes(part);
      })
    );
  },
};

// ---- Segments ----------------------------------------------------------------

interface ProxmoxSegmentRule {
  pattern: RegExp;
  expected: string;
}

const GUEST_TYPES: ReadonlyArray<string> = ["qemu", "lxc"];

// The guest-agent reads OneUptime AI may make (each is its own GET).
const GUEST_AGENT_READS: ReadonlyArray<string> = [
  "info",
  "get-osinfo",
  "get-fsinfo",
  "network-get-interfaces",
  "get-host-name",
  "get-time",
];

/*
 * The variable segments of READ_ROUTES, written "{name}" in a route. A
 * segment that fails its pattern names the route as a near miss, so the
 * refusal says which segment is wrong instead of listing every path.
 */
const SEGMENT_RULES: Readonly<Record<string, ProxmoxSegmentRule>> = {
  "{node}": {
    pattern: NODE_NAME_REGEX,
    expected: "a node name such as pve1",
  },
  "{guest}": {
    pattern: /^(?:qemu|lxc)$/,
    expected: "qemu (a VM) or lxc (a container)",
  },
  "{vmid}": {
    pattern: VMID_REGEX,
    expected: "a guest id (VMID) such as 101, without leading zeros",
  },
  "{upid}": {
    pattern: UPID_REGEX,
    expected:
      "a task id (UPID) exactly as /nodes/{node}/tasks lists it, such as UPID:pve1:0001A2B3:0C4D5E6F:65A1B2C3:qmstart:101:root@pam:",
  },
  "{storage}": {
    pattern: STORAGE_ID_REGEX,
    expected: "a storage id such as local-lvm",
  },
  "{service}": {
    pattern: SERVICE_ID_REGEX,
    expected: "a service name such as pveproxy",
  },
  "{agent}": {
    pattern: new RegExp(`^(?:${GUEST_AGENT_READS.join("|")})$`),
    expected: `one of ${GUEST_AGENT_READS.join(", ")}`,
  },
};

// ---- Reads -------------------------------------------------------------------

interface ProxmoxReadRoute {
  // "/nodes/{node}/{guest}/{vmid}/config": literals and SEGMENT_RULES names.
  path: string;
  // The options it takes besides --output-format.
  params: Readonly<Record<string, ProxmoxValueRule>>;
  // Options the API refuses the call without.
  required?: ReadonlyArray<string> | undefined;
  // Its output can hold secrets, which the output redactor masks.
  redacted?: boolean | undefined;
}

const NO_PARAMS: Readonly<Record<string, ProxmoxValueRule>> = {};

/*
 * Every path get and ls may read, with its options. Anything else is Denied.
 */
const READ_ROUTES: ReadonlyArray<ProxmoxReadRoute> = [
  { path: "/version", params: NO_PARAMS },
  { path: "/cluster/status", params: NO_PARAMS },
  {
    path: "/cluster/resources",
    params: { type: enumRule(["vm", "storage", "node", "sdn"]) },
  },
  { path: "/cluster/ha/status/current", params: NO_PARAMS },
  {
    path: "/cluster/ha/resources",
    params: { type: enumRule(["vm", "ct"]) },
  },
  { path: "/cluster/log", params: { max: COUNT_RULE } },
  { path: "/cluster/tasks", params: NO_PARAMS },
  { path: "/cluster/replication", params: NO_PARAMS },
  { path: "/cluster/backup", params: NO_PARAMS },
  { path: "/nodes", params: NO_PARAMS },
  { path: "/nodes/{node}/status", params: NO_PARAMS },
  { path: "/nodes/{node}/version", params: NO_PARAMS },
  {
    path: "/nodes/{node}/tasks",
    params: {
      errors: BOOLEAN_RULE,
      limit: COUNT_RULE,
      vmid: VMID_RULE,
      source: enumRule(["archive", "active", "all"]),
      start: OFFSET_RULE,
      typefilter: patternRule(
        /^[A-Za-z0-9_-]{1,64}$/,
        "a task type such as qmstart or vzdump",
      ),
      userfilter: patternRule(
        /^[A-Za-z0-9_.@!-]{1,128}$/,
        "a user such as root@pam",
      ),
      since: EPOCH_RULE,
      until: EPOCH_RULE,
    },
  },
  { path: "/nodes/{node}/tasks/{upid}/status", params: NO_PARAMS },
  {
    path: "/nodes/{node}/tasks/{upid}/log",
    params: { limit: COUNT_RULE, start: OFFSET_RULE },
  },
  {
    path: "/nodes/{node}/syslog",
    params: {
      limit: COUNT_RULE,
      start: OFFSET_RULE,
      since: SYSLOG_TIME_RULE,
      until: SYSLOG_TIME_RULE,
      service: patternRule(
        /^[A-Za-z0-9_.@-]{1,128}$/,
        "a systemd unit such as pveproxy",
      ),
    },
  },
  {
    path: "/nodes/{node}/journal",
    params: { lastentries: COUNT_RULE, since: EPOCH_RULE, until: EPOCH_RULE },
  },
  { path: "/nodes/{node}/services", params: NO_PARAMS },
  { path: "/nodes/{node}/services/{service}/state", params: NO_PARAMS },
  {
    path: "/nodes/{node}/storage",
    params: { content: STORAGE_CONTENT_RULE, enabled: BOOLEAN_RULE },
  },
  { path: "/nodes/{node}/storage/{storage}/status", params: NO_PARAMS },
  {
    path: "/nodes/{node}/disks/list",
    params: { skipsmart: BOOLEAN_RULE, "include-partitions": BOOLEAN_RULE },
  },
  {
    path: "/nodes/{node}/disks/smart",
    params: {
      disk: patternRule(DISK_PATH_REGEX, "a block device such as /dev/sda"),
      healthonly: BOOLEAN_RULE,
    },
    required: ["disk"],
  },
  {
    path: "/nodes/{node}/network",
    params: {
      type: enumRule([
        "bridge",
        "bond",
        "eth",
        "alias",
        "vlan",
        "OVSBridge",
        "OVSBond",
        "OVSPort",
        "OVSIntPort",
        "any_bridge",
        "any_local_bridge",
      ]),
    },
  },
  { path: "/nodes/{node}/netstat", params: NO_PARAMS },
  {
    path: "/nodes/{node}/rrddata",
    params: RRD_PARAMS,
    required: ["timeframe"],
  },
  { path: "/nodes/{node}/qemu", params: { full: BOOLEAN_RULE } },
  { path: "/nodes/{node}/lxc", params: NO_PARAMS },
  { path: "/nodes/{node}/{guest}/{vmid}/status/current", params: NO_PARAMS },
  {
    path: "/nodes/{node}/{guest}/{vmid}/config",
    params: { current: BOOLEAN_RULE },
    redacted: true,
  },
  {
    path: "/nodes/{node}/{guest}/{vmid}/pending",
    params: NO_PARAMS,
    redacted: true,
  },
  {
    path: "/nodes/{node}/{guest}/{vmid}/rrddata",
    params: RRD_PARAMS,
    required: ["timeframe"],
  },
  { path: "/nodes/{node}/{guest}/{vmid}/snapshot", params: NO_PARAMS },
  { path: "/nodes/{node}/qemu/{vmid}/agent/{agent}", params: NO_PARAMS },
  { path: "/nodes/{node}/replication", params: { guest: VMID_RULE } },
  { path: "/nodes/{node}/apt/update", params: NO_PARAMS },
  { path: "/nodes/{node}/ceph/status", params: NO_PARAMS },
  { path: "/pools", params: NO_PARAMS },
  { path: "/storage", params: NO_PARAMS, redacted: true },
];

// What get and ls may read, for refusals (the read guide has the options).
export const PROXMOX_READABLE_PATHS_SUMMARY: string =
  "Readable paths: /version; /cluster/status, /cluster/resources, /cluster/tasks, /cluster/log, /cluster/replication, /cluster/backup, /cluster/ha/status/current, /cluster/ha/resources; /pools; /storage; /nodes; /nodes/{node}/ followed by status, version, tasks, tasks/{upid}/status, tasks/{upid}/log, syslog, journal, services, services/{service}/state, storage, storage/{storage}/status, disks/list, disks/smart, network, netstat, rrddata, replication, apt/update or ceph/status; /nodes/{node}/qemu and /nodes/{node}/lxc; /nodes/{node}/{qemu|lxc}/{vmid}/ followed by status/current, config, pending, rrddata or snapshot; /nodes/{node}/qemu/{vmid}/agent/ followed by info, get-osinfo, get-fsinfo, network-get-interfaces, get-host-name or get-time";

// ---- Writes ------------------------------------------------------------------

/*
 * Node services OneUptime AI may start, restart or reload (RiskyWrite): the
 * PVE daemons whose restart is the documented fix for a hung API, web UI,
 * statistics, HA agent, scheduler or firewall, and the node's time, cron
 * and mail daemons.
 */
export const PROXMOX_RESTARTABLE_SERVICES: ReadonlyArray<string> = [
  "pveproxy",
  "pvedaemon",
  "pvestatd",
  "pve-ha-lrm",
  "pve-ha-crm",
  "spiceproxy",
  "pvescheduler",
  "pve-firewall",
  "chrony",
  "cron",
  "postfix",
];

/*
 * Node services a restart of which can take the node out of the cluster
 * (corosync: membership and quorum) or freeze /etc/pve cluster-wide
 * (pve-cluster: pmxcfs) — RiskyWrite, and always a human's call.
 */
export const PROXMOX_CLUSTER_CRITICAL_SERVICES: ReadonlyArray<string> = [
  "corosync",
  "pve-cluster",
];

const SERVICE_ACTIONS: ReadonlyArray<string> = ["start", "restart", "reload"];

interface ProxmoxGuestAction {
  tier: ResourceCommandTier;
  // Options besides --output-format, per guest type.
  params: Readonly<Record<string, Readonly<Record<string, ProxmoxValueRule>>>>;
  // What it does, completed with the guest: "starts VM 101 on node pve1".
  describe: string;
  // Why it has its tier.
  because: string;
}

const TIMEOUT_ONLY: Readonly<Record<string, ProxmoxValueRule>> = {
  timeout: GUEST_TIMEOUT_RULE,
};

/*
 * The guest power actions pvesh create may take
 * (/nodes/{node}/{qemu|lxc}/{vmid}/status/{action}), with the options the
 * API gives each one that OneUptime AI may use. A guest type an action is
 * not listed for (an lxc reset) does not have it.
 */
const GUEST_STATUS_ACTIONS: Readonly<Record<string, ProxmoxGuestAction>> = {
  start: {
    tier: ResourceCommandTier.SafeWrite,
    params: { qemu: TIMEOUT_ONLY, lxc: NO_PARAMS },
    describe: "starts",
    because: "one named guest, and shutting it down again undoes it",
  },
  resume: {
    tier: ResourceCommandTier.SafeWrite,
    params: { qemu: NO_PARAMS, lxc: NO_PARAMS },
    describe: "resumes the paused",
    because: "one named guest, and suspending it again undoes it",
  },
  reboot: {
    tier: ResourceCommandTier.SafeWrite,
    params: { qemu: TIMEOUT_ONLY, lxc: TIMEOUT_ONLY },
    describe: "cleanly reboots",
    because: "one named guest, shut down cleanly and started again on its own",
  },
  shutdown: {
    tier: ResourceCommandTier.RiskyWrite,
    params: {
      qemu: {
        timeout: GUEST_TIMEOUT_RULE,
        forceStop: enumRule(["0"]),
      },
      lxc: {
        timeout: GUEST_TIMEOUT_RULE,
        forceStop: enumRule(["0"]),
      },
    },
    describe: "shuts down",
    because: "the guest stays down, serving nothing, until someone starts it",
  },
  stop: {
    tier: ResourceCommandTier.RiskyWrite,
    params: { qemu: NO_PARAMS, lxc: NO_PARAMS },
    describe: "hard-stops",
    because:
      "it is pulling the plug: what the guest had not written is lost, and it stays down until someone starts it",
  },
  suspend: {
    tier: ResourceCommandTier.RiskyWrite,
    params: { qemu: NO_PARAMS, lxc: NO_PARAMS },
    describe: "pauses",
    because: "the guest serves nothing until someone resumes it",
  },
  reset: {
    tier: ResourceCommandTier.RiskyWrite,
    params: { qemu: NO_PARAMS },
    describe: "hard-resets",
    because:
      "it is pressing the reset button: what the VM had not written is lost",
  },
};

const MIGRATE_PARAMS: Readonly<
  Record<string, Readonly<Record<string, ProxmoxValueRule>>>
> = {
  qemu: { target: NODE_NAME_RULE, online: BOOLEAN_RULE },
  lxc: {
    target: NODE_NAME_RULE,
    online: BOOLEAN_RULE,
    restart: BOOLEAN_RULE,
  },
};

// What pvesh create may do, for refusals.
export const PROXMOX_CREATE_PATHS_SUMMARY: string =
  "pvesh create may only start, resume, reboot, shut down, stop or suspend one guest (/nodes/{node}/{qemu|lxc}/{vmid}/status/ followed by start, resume, reboot, shutdown, stop or suspend), reset one VM (/nodes/{node}/qemu/{vmid}/status/reset), migrate one guest (/nodes/{node}/{qemu|lxc}/{vmid}/migrate --target {node}), or start, restart or reload one node service (/nodes/{node}/services/{service}/ followed by start, restart or reload)";

// ---- Never -------------------------------------------------------------------

const ACCESS_REASON: string =
  "everything under /access (users, groups, roles, API tokens, ACLs, two-factor, tickets and passwords) is off-limits to OneUptime AI, to read or to change";

const CONSOLE_REASON: string =
  "console and terminal proxies (vncproxy, vncwebsocket, termproxy, spiceproxy, vncshell, spiceshell, mtunnel) hand out an interactive shell or screen, the Proxmox equivalent of exec, so they are never allowed";

const GUEST_EXEC_REASON: string =
  "the QEMU monitor and the guest agent's exec, file and password calls run commands in, read files from or change passwords of a guest, so they are never allowed; the guest agent reads OneUptime AI may make are info, get-osinfo, get-fsinfo, network-get-interfaces, get-host-name and get-time";

const NODE_EXECUTE_REASON: string =
  "/nodes/{node}/execute runs a batch of arbitrary API calls, so it is never allowed; run each read on its own";

// Console proxies, at /nodes/{node}/<this>.
const NODE_CONSOLE_SEGMENTS: ReadonlyArray<string> = [
  "vncshell",
  "spiceshell",
  "termproxy",
  "vncwebsocket",
];

// Console and tunnel proxies, at /nodes/{node}/{qemu|lxc}/{vmid}/<this>.
const GUEST_CONSOLE_SEGMENTS: ReadonlyArray<string> = [
  "vncproxy",
  "vncwebsocket",
  "termproxy",
  "spiceproxy",
  "mtunnel",
  "mtunnelwebsocket",
];

// Guest-agent calls, at /nodes/{node}/qemu/{vmid}/agent/<this>.
const GUEST_AGENT_EXEC_SEGMENTS: ReadonlyArray<string> = [
  "exec",
  "exec-status",
  "file-read",
  "file-write",
  "set-user-password",
];

// Node-wide bulk actions, at /nodes/{node}/<this>.
const NODE_BULK_SEGMENTS: ReadonlyArray<string> = [
  "startall",
  "stopall",
  "suspendall",
  "migrateall",
];

/*
 * Why a path is never allowed, whatever the command word, or null. Checked
 * before anything else about the command, so the model hears the real
 * reason rather than a complaint about an option.
 */
function describeForbiddenPath(segments: Array<string>): string | null {
  if (segments[0] === "access") {
    return ACCESS_REASON;
  }

  if (segments[0] !== "nodes") {
    return null;
  }

  const third: string = segments[2] || "";
  const fifth: string = segments[4] || "";

  if (segments.length === 3 && NODE_CONSOLE_SEGMENTS.includes(third)) {
    return CONSOLE_REASON;
  }

  if (third === "execute") {
    return NODE_EXECUTE_REASON;
  }

  if (!GUEST_TYPES.includes(third)) {
    return null;
  }

  if (segments.length === 5 && GUEST_CONSOLE_SEGMENTS.includes(fifth)) {
    return CONSOLE_REASON;
  }

  if (third === "qemu" && fifth === "monitor") {
    return GUEST_EXEC_REASON;
  }

  if (
    fifth === "agent" &&
    GUEST_AGENT_EXEC_SEGMENTS.includes(segments[5] || "")
  ) {
    return GUEST_EXEC_REASON;
  }

  return null;
}

/*
 * Why a create on this path is refused, when it is a well-known action with
 * a better answer than the generic list, or null.
 */
function describeRefusedAction(segments: Array<string>): string | null {
  if (segments[0] !== "nodes" || segments.length < 3) {
    return null;
  }

  const third: string = segments[2] || "";

  if (segments.length === 3 && third === "status") {
    return "rebooting or shutting down a node takes every guest on it down, so it is never allowed";
  }

  if (segments.length === 3 && NODE_BULK_SEGMENTS.includes(third)) {
    return `/nodes/{node}/${third} acts on every guest on the node at once, so it is never allowed; act on one guest at a time`;
  }

  if (
    GUEST_TYPES.includes(third) &&
    segments[4] === "snapshot" &&
    segments.length >= 5
  ) {
    return "creating, rolling back or deleting snapshots is never allowed: a rollback discards everything written since the snapshot";
  }

  return null;
}

// ---- Analysis ----------------------------------------------------------------

interface ProxmoxOption {
  name: string;
  value: string;
}

interface ProxmoxWords {
  positionals: Array<string>;
  options: Array<ProxmoxOption>;
  // The first problem with how the words are written, or null.
  problem: string | null;
}

// "--output-format", "--forceStop", "--include-partitions".
const OPTION_NAME_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9-]*$/;

/*
 * Split the words after the command word into the API path and the
 * options (see the Grammar section). Never stops early: it records the
 * first problem and keeps going, so the path is still found for a better
 * refusal.
 */
function splitWords(words: Array<string>): ProxmoxWords {
  const positionals: Array<string> = [];
  const options: Array<ProxmoxOption> = [];
  const seen: Array<string> = [];
  let problem: string | null = null;

  const note: (text: string) => void = (text: string): void => {
    if (problem === null) {
      problem = text;
    }
  };

  for (let i: number = 0; i < words.length; i++) {
    const word: string = words[i] || "";

    if (word === "--") {
      note(
        'pvesh commands never need "--": write the API path, then each option as --name value',
      );
      continue;
    }

    if (word.startsWith("--")) {
      const equals: number = word.indexOf("=");
      const name: string = equals >= 0 ? word.slice(2, equals) : word.slice(2);
      let value: string;

      if (equals >= 0) {
        value = word.slice(equals + 1);
      } else {
        const next: string | undefined = words[i + 1];

        if (next === undefined || next.startsWith("-")) {
          note(
            `--${shorten(name)} needs a value right after it (--${shorten(name)} VALUE or --${shorten(name)}=VALUE${
              next === undefined ? "" : `; got the option "${shorten(next)}"`
            }); booleans are written 0 or 1`,
          );
          continue;
        }

        value = next;
        i++;
      }

      if (!OPTION_NAME_REGEX.test(name)) {
        note(
          `"${shorten(word)}" is not an option pvesh understands: options are written --name value`,
        );
        continue;
      }

      if (seen.includes(name)) {
        note(`--${name} is given more than once: give each option once`);
        continue;
      }

      seen.push(name);
      options.push({ name, value });
      continue;
    }

    if (word.startsWith("-")) {
      note(
        `"${shorten(word)}" is not supported: pvesh options are written with two dashes and a value (--name value or --name=value), never as single-dash or combined short options`,
      );
      continue;
    }

    positionals.push(word);
  }

  return { positionals, options, problem };
}

// A word shown inside a refusal, cut so a huge argument cannot flood it.
function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

interface ProxmoxPath {
  // Canonical: "/nodes/pve1/status".
  path: string;
  segments: Array<string>;
}

// Characters an API path OneUptime AI may use can hold (see UPID_REGEX).
const PATH_CHARACTERS_REGEX: RegExp = /^[A-Za-z0-9._:@!/-]+$/;

// The API path, canonical, or why it cannot be one.
function readPath(raw: string): ProxmoxPath | string {
  if (!raw) {
    return "the API path is empty: name one, such as /cluster/status";
  }

  if (raw.length > MAX_PROXMOX_API_PATH_CHARS) {
    return `the API path is longer than ${MAX_PROXMOX_API_PATH_CHARS} characters`;
  }

  if (raw.includes("?") || raw.includes("&") || raw.includes("#")) {
    return `"${shorten(raw)}" carries a query string: write each parameter as an option after the path instead (pvesh get /nodes/pve1/tasks --errors 1 --limit 20)`;
  }

  if (raw.includes("%")) {
    return `"${shorten(raw)}" is percent-encoded: write the path plainly (a UPID with its colons as they are)`;
  }

  if (!raw.startsWith("/")) {
    return `"${shorten(raw)}" is not an API path: paths start with "/", such as /nodes/pve1/status`;
  }

  if (!PATH_CHARACTERS_REGEX.test(raw)) {
    return `"${shorten(raw)}" holds a character no API path OneUptime AI may read has (paths use letters, digits and . _ - : @ !)`;
  }

  if (raw === "/") {
    return `"/" is the root of the API, not a path OneUptime AI may read. ${PROXMOX_READABLE_PATHS_SUMMARY}`;
  }

  const trimmed: string = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  const segments: Array<string> = trimmed.slice(1).split("/");

  if (
    segments.some((segment: string): boolean => {
      return segment === "" || segment === "." || segment === "..";
    })
  ) {
    return `"${shorten(raw)}" has an empty, "." or ".." segment: write the path out plainly`;
  }

  return { path: `/${segments.join("/")}`, segments };
}

interface ProxmoxRouteMatch {
  route: ProxmoxReadRoute;
  values: Record<string, string>;
}

interface ProxmoxRouteLookup {
  match: ProxmoxRouteMatch | null;
  // Why the closest route did not match, when one came close.
  nearMiss: string | null;
}

// The read route this path is, or the closest one and what is wrong.
function findReadRoute(segments: Array<string>): ProxmoxRouteLookup {
  let nearMiss: string | null = null;
  let nearMissFailures: number = Number.MAX_SAFE_INTEGER;

  for (const route of READ_ROUTES) {
    const pattern: Array<string> = route.path.slice(1).split("/");

    if (pattern.length !== segments.length) {
      continue;
    }

    const values: Record<string, string> = {};
    let literalsMatch: boolean = true;
    let failures: number = 0;
    let firstFailure: string | null = null;

    for (let i: number = 0; i < pattern.length; i++) {
      const expected: string = pattern[i] || "";
      const actual: string = segments[i] || "";
      const rule: ProxmoxSegmentRule | undefined =
        Object.prototype.hasOwnProperty.call(SEGMENT_RULES, expected)
          ? SEGMENT_RULES[expected]
          : undefined;

      if (!rule) {
        if (expected !== actual) {
          literalsMatch = false;
          break;
        }
        continue;
      }

      if (!rule.pattern.test(actual)) {
        failures++;

        if (firstFailure === null) {
          firstFailure = `"${shorten(actual)}" in ${route.path} must be ${rule.expected}`;
        }
        continue;
      }

      values[expected.slice(1, -1)] = actual;
    }

    if (!literalsMatch) {
      continue;
    }

    if (failures === 0) {
      return { match: { route, values }, nearMiss: null };
    }

    if (failures < nearMissFailures) {
      nearMissFailures = failures;
      nearMiss = firstFailure;
    }
  }

  return { match: null, nearMiss };
}

interface ProxmoxCheckedOptions {
  params: Record<string, string>;
  outputFormat: ProxmoxOutputFormat | null;
}

function listOptions(
  allowed: Readonly<Record<string, ProxmoxValueRule>>,
): string {
  const names: Array<string> = Object.keys(allowed).map((name: string) => {
    return `--${name}`;
  });

  return names.length === 0
    ? `it takes no options besides --${PROXMOX_OUTPUT_FORMAT_OPTION}`
    : `its options are ${names.join(", ")} and --${PROXMOX_OUTPUT_FORMAT_OPTION}`;
}

/*
 * Check every option against the ones `where` takes, and the required ones
 * against those given: the API parameters and the output format, or why
 * not.
 */
function checkOptions(
  options: Array<ProxmoxOption>,
  allowed: Readonly<Record<string, ProxmoxValueRule>>,
  required: ReadonlyArray<string>,
  where: string,
): ProxmoxCheckedOptions | string {
  const params: Record<string, string> = {};
  let outputFormat: ProxmoxOutputFormat | null = null;

  for (const option of options) {
    if (option.name === PROXMOX_OUTPUT_FORMAT_OPTION) {
      const format: ProxmoxOutputFormat | undefined =
        PROXMOX_OUTPUT_FORMATS.find((candidate: ProxmoxOutputFormat) => {
          return candidate === option.value;
        });

      if (!format) {
        return `--${PROXMOX_OUTPUT_FORMAT_OPTION} must be one of ${PROXMOX_OUTPUT_FORMATS.join(", ")} (got "${shorten(option.value)}")`;
      }

      outputFormat = format;
      continue;
    }

    const rule: ProxmoxValueRule | undefined =
      Object.prototype.hasOwnProperty.call(allowed, option.name)
        ? allowed[option.name]
        : undefined;

    if (!rule) {
      return `--${option.name} is not an option OneUptime AI may pass to ${where}: ${listOptions(allowed)}`;
    }

    if (!rule.accepts(option.value)) {
      return `--${option.name} on ${where} must be ${rule.expected} (got "${shorten(option.value)}")`;
    }

    params[option.name] = option.value;
  }

  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      const rule: ProxmoxValueRule | undefined = allowed[name];

      return `${where} needs --${name}${rule ? ` (${rule.expected})` : ""}`;
    }
  }

  return { params, outputFormat };
}

interface ProxmoxDenial {
  allowed: false;
  reason: string;
}

interface ProxmoxAllowance {
  allowed: true;
  tier: ResourceCommandTier;
  reason: string;
  verb: string;
  targets: Array<string>;
  requiresHuman: boolean;
  request: ProxmoxApiRequest;
}

type ProxmoxAnalysis = ProxmoxDenial | ProxmoxAllowance;

function deny(reason: string): ProxmoxDenial {
  return { allowed: false, reason };
}

const READ_COMMANDS: ReadonlyArray<string> = ["get", "ls"];
const CREATE_COMMAND: string = "create";

const WHAT_IS_ALLOWED: string =
  "read with pvesh get <path> (or pvesh ls <path>) and act with pvesh create <path>";

// Why each pvesh command word OneUptime AI may not use is refused.
const REFUSED_COMMANDS: Readonly<Record<string, string>> = {
  set: `pvesh set changes configuration (an HTTP PUT), which OneUptime AI never does; ${PROXMOX_CREATE_PATHS_SUMMARY}`,
  delete: `pvesh delete removes objects (an HTTP DELETE), which OneUptime AI never does; ${PROXMOX_CREATE_PATHS_SUMMARY}`,
  usage: `pvesh usage is not available: the agent calls the Proxmox VE API directly, and only the paths it allows. ${PROXMOX_READABLE_PATHS_SUMMARY}`,
  help: `pvesh help is not available: the agent calls the Proxmox VE API directly, and only the paths it allows. ${PROXMOX_READABLE_PATHS_SUMMARY}`,
};

function guestNoun(guest: string, vmid: string): string {
  return guest === "lxc" ? `container ${vmid}` : `VM ${vmid}`;
}

/*
 * The whole judgement of one argv (program included): what it may do, or
 * why it may not. Both evaluateArgv and parseProxmoxCommand are views of
 * this, so the request the agent sends is exactly what was tiered.
 */
function analyzeProxmoxArgv(rawArgv: unknown): ProxmoxAnalysis {
  if (!Array.isArray(rawArgv) || rawArgv.length === 0) {
    return deny("Empty command.");
  }

  if (
    rawArgv.some((word: unknown): boolean => {
      return typeof word !== "string";
    })
  ) {
    return deny("Every word of the command must be a string.");
  }

  const argv: Array<string> = rawArgv as Array<string>;

  if (argv.length > MAX_RESOURCE_COMMAND_TOKENS) {
    return deny(
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
    return deny(
      `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
    );
  }

  if (
    argv.some((word: string): boolean => {
      return word.includes("\n") || word.includes("\r") || word.includes("\0");
    })
  ) {
    return deny(
      "A command must be a single line: no word may hold a newline or a NUL character.",
    );
  }

  if (argv[0] !== PVESH_PROGRAM) {
    return deny(
      `a Proxmox command starts with "${PVESH_PROGRAM}": ${WHAT_IS_ALLOWED}`,
    );
  }

  const command: string = argv[1] || "";

  if (!command) {
    return deny(
      `name what pvesh should do: ${WHAT_IS_ALLOWED}, such as pvesh get /cluster/status`,
    );
  }

  if (command.startsWith("-")) {
    return deny(
      `the pvesh command (get, ls or create) comes right after pvesh, before any option: pvesh reads its first word as the command`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(REFUSED_COMMANDS, command)) {
    return deny(REFUSED_COMMANDS[command] || WHAT_IS_ALLOWED);
  }

  const isRead: boolean = READ_COMMANDS.includes(command);

  if (!isRead && command !== CREATE_COMMAND) {
    return deny(
      `"${shorten(command)}" is not a pvesh command OneUptime AI may run: ${WHAT_IS_ALLOWED}`,
    );
  }

  const words: ProxmoxWords = splitWords(argv.slice(2));
  const rawPath: string | undefined = words.positionals[0];

  if (rawPath === undefined) {
    return deny(
      words.problem ||
        `name the API path after pvesh ${command}, such as pvesh ${command} ${
          isRead ? "/cluster/status" : "/nodes/pve1/qemu/101/status/start"
        }`,
    );
  }

  const path: ProxmoxPath | string = readPath(rawPath);

  if (typeof path === "string") {
    return deny(words.problem || path);
  }

  const forbidden: string | null = describeForbiddenPath(path.segments);

  if (forbidden) {
    return deny(forbidden);
  }

  if (words.problem) {
    return deny(words.problem);
  }

  if (words.positionals.length > 1) {
    return deny(
      `pvesh takes exactly one API path, but "${shorten(
        words.positionals[1] || "",
      )}" follows it: write options as --name value`,
    );
  }

  return isRead
    ? analyzeRead(command, path, words.options)
    : analyzeCreate(path, words.options);
}

function analyzeRead(
  command: string,
  path: ProxmoxPath,
  options: Array<ProxmoxOption>,
): ProxmoxAnalysis {
  const lookup: ProxmoxRouteLookup = findReadRoute(path.segments);

  if (!lookup.match) {
    if (lookup.nearMiss) {
      return deny(lookup.nearMiss);
    }

    if (isCreateShape(path.segments)) {
      return deny(
        `${path.path} is an action for pvesh create, not something to read: a guest's state is at /nodes/{node}/{qemu|lxc}/{vmid}/status/current and a node service's at /nodes/{node}/services/{service}/state. ${PROXMOX_READABLE_PATHS_SUMMARY}`,
      );
    }

    return deny(
      `${path.path} is not a path OneUptime AI may read. ${PROXMOX_READABLE_PATHS_SUMMARY}`,
    );
  }

  const route: ProxmoxReadRoute = lookup.match.route;
  const checked: ProxmoxCheckedOptions | string = checkOptions(
    options,
    route.params,
    route.required || [],
    `pvesh ${command} ${route.path}`,
  );

  if (typeof checked === "string") {
    return deny(checked);
  }

  return {
    allowed: true,
    tier: ResourceCommandTier.Read,
    reason: `reads ${path.path} from the Proxmox VE API and changes nothing${
      route.redacted
        ? "; passwords and keys in it are redacted before anyone sees the output"
        : ""
    }`,
    verb: command,
    targets: [],
    requiresHuman: false,
    request: {
      method: "GET",
      path: path.path,
      params: checked.params,
      outputFormat: checked.outputFormat,
    },
  };
}

// Does this path have the shape of an action pvesh create may take?
function isCreateShape(segments: Array<string>): boolean {
  if (segments[0] !== "nodes") {
    return false;
  }

  if (segments.length === 6) {
    return GUEST_TYPES.includes(segments[2] || "") && segments[4] === "status";
  }

  if (segments.length === 5) {
    return (
      (GUEST_TYPES.includes(segments[2] || "") && segments[4] === "migrate") ||
      segments[2] === "services"
    );
  }

  return false;
}

/*
 * A write names its node: a malformed name, or "localhost" (whichever node
 * the agent's API endpoint is), is refused.
 */
function describeWriteNodeProblem(node: string, where: string): string | null {
  if (!NODE_NAME_REGEX.test(node)) {
    return `"${shorten(node)}" in ${where} must be a node name such as pve1`;
  }

  if (node.toLowerCase() === LOCAL_NODE_ALIAS) {
    return `a change must name its node, not "${node}" (which is whichever node the agent's API endpoint is): read /nodes, then write /nodes/<name>/...`;
  }

  return null;
}

function analyzeCreate(
  path: ProxmoxPath,
  options: Array<ProxmoxOption>,
): ProxmoxAnalysis {
  const segments: Array<string> = path.segments;
  const refused: string | null = describeRefusedAction(segments);

  if (refused) {
    return deny(refused);
  }

  const node: string = segments[1] || "";
  const third: string = segments[2] || "";

  if (
    segments[0] === "nodes" &&
    segments.length === 6 &&
    GUEST_TYPES.includes(third) &&
    segments[4] === "status"
  ) {
    return analyzeGuestStatus(
      path,
      node,
      third,
      segments[3] || "",
      segments[5] || "",
      options,
    );
  }

  if (
    segments[0] === "nodes" &&
    segments.length === 5 &&
    GUEST_TYPES.includes(third) &&
    segments[4] === "migrate"
  ) {
    return analyzeMigrate(path, node, third, segments[3] || "", options);
  }

  if (
    segments[0] === "nodes" &&
    segments.length === 5 &&
    third === "services"
  ) {
    return analyzeService(
      path,
      node,
      segments[3] || "",
      segments[4] || "",
      options,
    );
  }

  if (findReadRoute(segments).match) {
    return deny(
      `${path.path} is a path to read (pvesh get ${path.path}), not an action; ${PROXMOX_CREATE_PATHS_SUMMARY}`,
    );
  }

  return deny(
    `pvesh create ${path.path} is not allowed; ${PROXMOX_CREATE_PATHS_SUMMARY}`,
  );
}

function analyzeGuestStatus(
  path: ProxmoxPath,
  node: string,
  guest: string,
  vmid: string,
  action: string,
  options: Array<ProxmoxOption>,
): ProxmoxAnalysis {
  const template: string = `/nodes/{node}/${guest}/{vmid}/status/${action}`;
  const nodeProblem: string | null = describeWriteNodeProblem(node, template);

  if (nodeProblem) {
    return deny(nodeProblem);
  }

  if (!VMID_REGEX.test(vmid)) {
    return deny(
      `"${shorten(vmid)}" in ${template} must be ${SEGMENT_RULES["{vmid}"]?.expected || "a VMID"}`,
    );
  }

  const known: ProxmoxGuestAction | undefined =
    Object.prototype.hasOwnProperty.call(GUEST_STATUS_ACTIONS, action)
      ? GUEST_STATUS_ACTIONS[action]
      : undefined;
  const allowed: Readonly<Record<string, ProxmoxValueRule>> | undefined =
    known && Object.prototype.hasOwnProperty.call(known.params, guest)
      ? known.params[guest]
      : undefined;

  if (!known || !allowed) {
    const actions: Array<string> = Object.keys(GUEST_STATUS_ACTIONS).filter(
      (name: string): boolean => {
        const candidate: ProxmoxGuestAction | undefined =
          GUEST_STATUS_ACTIONS[name];

        return Boolean(
          candidate &&
            Object.prototype.hasOwnProperty.call(candidate.params, guest),
        );
      },
    );

    return deny(
      `"${shorten(action)}" is not a ${
        guest === "lxc" ? "container" : "VM"
      } status action OneUptime AI may take: it may ${actions.join(", ")} one (/nodes/{node}/${guest}/{vmid}/status/<action>)${
        guest === "lxc" && action === "reset"
          ? "; containers have no reset, reboot one instead"
          : ""
      }`,
    );
  }

  const checked: ProxmoxCheckedOptions | string = checkOptions(
    options,
    allowed,
    [],
    `pvesh create ${template}`,
  );

  if (typeof checked === "string") {
    return deny(checked);
  }

  return {
    allowed: true,
    tier: known.tier,
    reason: `${known.describe} ${guestNoun(guest, vmid)} on node ${node}: ${known.because}`,
    verb: `${guest} ${action}`,
    targets: [vmid],
    requiresHuman: false,
    request: {
      method: "POST",
      path: path.path,
      params: checked.params,
      outputFormat: checked.outputFormat,
    },
  };
}

function analyzeMigrate(
  path: ProxmoxPath,
  node: string,
  guest: string,
  vmid: string,
  options: Array<ProxmoxOption>,
): ProxmoxAnalysis {
  const template: string = `/nodes/{node}/${guest}/{vmid}/migrate`;
  const nodeProblem: string | null = describeWriteNodeProblem(node, template);

  if (nodeProblem) {
    return deny(nodeProblem);
  }

  if (!VMID_REGEX.test(vmid)) {
    return deny(
      `"${shorten(vmid)}" in ${template} must be ${SEGMENT_RULES["{vmid}"]?.expected || "a VMID"}`,
    );
  }

  const allowed: Readonly<Record<string, ProxmoxValueRule>> =
    MIGRATE_PARAMS[guest] || NO_PARAMS;
  const checked: ProxmoxCheckedOptions | string = checkOptions(
    options,
    allowed,
    ["target"],
    `pvesh create ${template}`,
  );

  if (typeof checked === "string") {
    return deny(checked);
  }

  const target: string = checked.params["target"] || "";

  if (target.toLowerCase() === LOCAL_NODE_ALIAS) {
    return deny(
      `--target must name the node to move to, not "${target}": read /nodes for the node names`,
    );
  }

  if (target.toLowerCase() === node.toLowerCase()) {
    return deny(
      `${guestNoun(guest, vmid)} is already on node ${node}: --target must name a different node`,
    );
  }

  return {
    allowed: true,
    tier: ResourceCommandTier.RiskyWrite,
    reason: `moves ${guestNoun(guest, vmid)} from node ${node} to node ${target}: it loads another node and, unless it moves online, stops the guest while it moves, so a human always decides`,
    verb: `${guest} migrate`,
    targets: [vmid],
    requiresHuman: true,
    request: {
      method: "POST",
      path: path.path,
      params: checked.params,
      outputFormat: checked.outputFormat,
    },
  };
}

function analyzeService(
  path: ProxmoxPath,
  node: string,
  service: string,
  action: string,
  options: Array<ProxmoxOption>,
): ProxmoxAnalysis {
  const template: string = `/nodes/{node}/services/{service}/${action}`;
  const nodeProblem: string | null = describeWriteNodeProblem(node, template);

  if (nodeProblem) {
    return deny(nodeProblem);
  }

  if (action === "stop") {
    return deny(
      "stopping a node service is never allowed: it stays down until someone starts it. Restart or reload it instead (/nodes/{node}/services/{service}/restart)",
    );
  }

  if (!SERVICE_ACTIONS.includes(action)) {
    return deny(
      `"${shorten(action)}" is not a service action OneUptime AI may take: it may ${SERVICE_ACTIONS.join(", ")} a node service (/nodes/{node}/services/{service}/<action>)`,
    );
  }

  const isCritical: boolean =
    PROXMOX_CLUSTER_CRITICAL_SERVICES.includes(service);

  if (!isCritical && !PROXMOX_RESTARTABLE_SERVICES.includes(service)) {
    return deny(
      `"${shorten(service)}" is not a node service OneUptime AI may ${action}: it may start, restart or reload ${[
        ...PROXMOX_RESTARTABLE_SERVICES,
        ...PROXMOX_CLUSTER_CRITICAL_SERVICES,
      ].join(", ")}`,
    );
  }

  const checked: ProxmoxCheckedOptions | string = checkOptions(
    options,
    NO_PARAMS,
    [],
    `pvesh create ${template}`,
  );

  if (typeof checked === "string") {
    return deny(checked);
  }

  return {
    allowed: true,
    tier: ResourceCommandTier.RiskyWrite,
    reason: isCritical
      ? `${action}s ${service} on node ${node}: ${
          service === "corosync"
            ? "corosync carries cluster membership and quorum"
            : "pve-cluster serves /etc/pve, the configuration every node shares"
        }, and a restart that goes wrong can take the node out of the cluster, so a human always decides`
      : `${action}s the ${service} service on node ${node}: what it serves pauses while it ${
          action === "reload" ? "reloads" : "restarts"
        }`,
    verb: `service ${action}`,
    targets: [`${node}/${service}`],
    requiresHuman: isCritical,
    request: {
      method: "POST",
      path: path.path,
      params: checked.params,
      outputFormat: checked.outputFormat,
    },
  };
}

/*
 * The Proxmox VE API request a pvesh command becomes (program included in
 * argv), or the policy's reason it may not run. The agent's executor calls
 * this on the argv it received after the policy has passed it, and sends
 * exactly the request it returns.
 */
export function parseProxmoxCommand(
  argv: Array<string>,
): ProxmoxCommandParseResult {
  let analysis: ProxmoxAnalysis;

  try {
    analysis = analyzeProxmoxArgv(argv);
  } catch {
    return {
      errorMessage: "the pvesh command policy could not evaluate this command",
    };
  }

  if (!analysis.allowed) {
    return { errorMessage: analysis.reason };
  }

  return {
    request: {
      method: analysis.request.method,
      path: analysis.request.path,
      params: { ...analysis.request.params },
      outputFormat: analysis.request.outputFormat,
    },
  };
}

// ---- Guides ------------------------------------------------------------------

const READ_COMMAND_GUIDE: string = [
  "- `pvesh get <path> [--name value]...` (or `pvesh ls <path>`) reads the Proxmox VE API; options are `--name value` or `--name=value`, booleans 0 or 1, and `--output-format json|json-pretty|text` picks the output. No query strings (`?a=b`); one path per command.",
  "- Cluster: `pvesh get /version`, `/cluster/status`, `/cluster/resources [--type vm|storage|node|sdn]`, `/cluster/ha/status/current`, `/cluster/ha/resources [--type vm|ct]`, `/cluster/log [--max N]`, `/cluster/tasks`, `/cluster/replication`, `/cluster/backup`, `/pools`, `/storage`, `/nodes`.",
  "- A node: `/nodes/{node}/status`, `/version`, `/services`, `/services/{service}/state`, `/storage [--content images] [--enabled 1]`, `/storage/{storage}/status`, `/disks/list`, `/disks/smart --disk /dev/sda`, `/network`, `/netstat`, `/replication [--guest VMID]`, `/apt/update`, `/ceph/status`, `/rrddata --timeframe hour|day|week [--cf AVERAGE|MAX]`.",
  "- Tasks and logs: `/nodes/{node}/tasks [--errors 1] [--limit N] [--vmid VMID] [--source archive|active|all] [--typefilter TYPE] [--userfilter USER] [--start N] [--since EPOCH] [--until EPOCH]`, `/nodes/{node}/tasks/{upid}/status`, `/nodes/{node}/tasks/{upid}/log [--limit N] [--start N]`, `/nodes/{node}/syslog [--limit N] [--start N] [--since 'YYYY-MM-DD HH:MM'] [--until ...] [--service UNIT]`, `/nodes/{node}/journal [--lastentries N] [--since EPOCH] [--until EPOCH]`.",
  "- Guests ({type} is qemu for VMs, lxc for containers; {vmid} like 101): `/nodes/{node}/qemu [--full 1]`, `/nodes/{node}/lxc`, `/nodes/{node}/{type}/{vmid}/status/current`, `/config [--current 1]` (secrets redacted), `/pending`, `/snapshot`, `/rrddata --timeframe hour|day|week`; QEMU guest agent: `/nodes/{node}/qemu/{vmid}/agent/info|get-osinfo|get-fsinfo|network-get-interfaces|get-host-name|get-time`.",
  "- Never: anything under /access (users, API tokens, ACLs), consoles (vncproxy, termproxy, spiceproxy), the QEMU monitor, guest-agent exec or file access, `pvesh set`, `pvesh delete`, `pvesh usage`.",
].join("\n");

const WRITE_COMMAND_GUIDE: string = [
  "- `pvesh create <path> [--name value]...` is one POST to the Proxmox VE API. {type} is qemu (VM) or lxc (container), {vmid} the guest id; always name the node (read /nodes; never localhost).",
  "- Safe (runs unattended in Automatic mode): `pvesh create /nodes/{node}/{type}/{vmid}/status/start`, `/status/resume`, `/status/reboot` (`--timeout N` on a qemu start and on reboots).",
  "- Riskier (needs approval unless allowlisted or approvals are bypassed): `/nodes/{node}/{type}/{vmid}/status/shutdown [--timeout N] [--forceStop 0]`, `/status/stop`, `/status/suspend`, `/nodes/{node}/qemu/{vmid}/status/reset`; `pvesh create /nodes/{node}/services/{service}/start|restart|reload` for pveproxy, pvedaemon, pvestatd, pve-ha-lrm, pve-ha-crm, spiceproxy, pvescheduler, pve-firewall, chrony, cron, postfix.",
  "- Always asks a human: `pvesh create /nodes/{node}/{type}/{vmid}/migrate --target {othernode} [--online 0|1]` (`--restart 0|1` for lxc), and starting, restarting or reloading corosync or pve-cluster.",
  "- Never: `pvesh set` (configuration), `pvesh delete`, stopping a node service, node reboot or shutdown, startall/stopall/migrateall, snapshots, anything under /access, consoles, guest-agent exec.",
].join("\n");

const ProxmoxCommandPolicy: ResourceToolPolicy = {
  name: "pvesh",
  programs: [PVESH_PROGRAM],
  readCommandGuide: READ_COMMAND_GUIDE,
  writeCommandGuide: WRITE_COMMAND_GUIDE,
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    let analysis: ProxmoxAnalysis;

    try {
      analysis = analyzeProxmoxArgv(argv);
    } catch {
      return deniedResult(
        argv,
        "the pvesh command policy could not evaluate this command",
      );
    }

    if (!analysis.allowed) {
      return deniedResult(argv, analysis.reason);
    }

    const words: Array<string> = argv.slice();
    const result: ResourceCommandPolicyResult = {
      tier: analysis.tier,
      reason: analysis.reason,
      program: PVESH_PROGRAM,
      args: words.slice(1),
      verb: analysis.verb,
      displayCommand: renderResourceDisplayCommand(words),
      targets: analysis.targets.slice(),
    };

    if (analysis.requiresHuman) {
      result.requiresHuman = true;
    }

    return result;
  },
};

export default ProxmoxCommandPolicy;
