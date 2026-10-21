import ProxmoxCommandPolicy, {
  MAX_PROXMOX_API_PATH_CHARS,
  PROXMOX_CLUSTER_CRITICAL_SERVICES,
  PROXMOX_CREATE_PATHS_SUMMARY,
  PROXMOX_OUTPUT_FORMATS,
  PROXMOX_READABLE_PATHS_SUMMARY,
  PROXMOX_RESTARTABLE_SERVICES,
  PVESH_PROGRAM,
  ProxmoxApiRequest,
  ProxmoxCommandParseResult,
  parseProxmoxCommand,
} from "../../../../Utils/AiRemediation/Resource/ProxmoxCommandPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  ResourceTokenizeResult,
  renderResourceDisplayCommand,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  RESOURCE_REDACTED_MARKER,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the pvesh command policy (ProxmoxCommandPolicy)
 * for Proxmox clusters, and the request parser the agent sends to the
 * Proxmox VE API (parseProxmoxCommand).
 *
 * - Read (get, ls) only on an allowlist of API paths with validated
 *   segments and per-path options; /access, consoles, the QEMU monitor and
 *   guest-agent exec/file calls are Denied.
 * - create: guest start/resume/reboot are SafeWrite; shutdown, stop,
 *   suspend, qemu reset and restarting the allowed node services are
 *   RiskyWrite; migrate and corosync / pve-cluster are RiskyWrite that
 *   always need a human; everything else (set, delete, usage, other paths,
 *   service stop, ...) is Denied.
 * - The grammar leaves no second reading: every option takes a value, no
 *   single-dash, abbreviated, duplicated or "--" forms, no query strings,
 *   no encoded or relative paths — so a denied option or path can never
 *   hide in another word.
 * - parseProxmoxCommand only ever builds a request for a command the
 *   policy allows, and the request is exactly the command that was tiered.
 * - Targets are the VMID for a guest and "<node>/<service>" for a service.
 * - The pvesh redaction hook masks cipassword, password, keyring and
 *   encryption-key in config, pending and storage output.
 */

const UPID: string =
  "UPID:pve1:0001A2B3:0C4D5E6F:65A1B2C3:qmstart:101:root@pam:";
const TOKEN_UPID: string =
  "UPID:pve-2.lab:00ABCDEF:0012345AB:65A1B2C3:vzdump::svc@pve!oneuptime:";

// A VMID (or any other all-digit path segment).
const DIGITS_ONLY: RegExp = /^[0-9]+$/;

function evaluate(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: AiResourceType.ProxmoxCluster,
    command,
  });
}

function evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
  return ProxmoxCommandPolicy.evaluateArgv(argv);
}

function tokens(command: string): Array<string> {
  const tokenized: ResourceTokenizeResult = tokenizeResourceCommand(command);

  if (!tokenized.argv) {
    throw new Error(`does not tokenize: ${command}`);
  }

  return tokenized.argv;
}

function parse(command: string): ProxmoxCommandParseResult {
  return parseProxmoxCommand(tokens(command));
}

function request(command: string): ProxmoxApiRequest {
  const parsed: ProxmoxCommandParseResult = parse(command);

  if (!parsed.request) {
    throw new Error(`no request for ${command}: ${parsed.errorMessage}`);
  }

  return parsed.request;
}

function expectDenied(command: string, mentions?: string | RegExp): void {
  const result: ResourceCommandPolicyResult = evaluate(command);

  expect(result.tier).toBe(ResourceCommandTier.Denied);
  expect(result.targets).toEqual([]);
  expect(result.requiresHuman).toBeUndefined();

  if (mentions !== undefined) {
    expect(result.reason).toMatch(mentions);
  }
}

describe("module shape", () => {
  test("is the pvesh policy for the pvesh program", () => {
    expect(ProxmoxCommandPolicy.name).toBe("pvesh");
    expect([...ProxmoxCommandPolicy.programs]).toEqual(["pvesh"]);
    expect(PVESH_PROGRAM).toBe("pvesh");
    expect([...PROXMOX_OUTPUT_FORMATS]).toEqual([
      "json",
      "json-pretty",
      "text",
    ]);
  });

  test("is what the dispatcher routes a Proxmox cluster to", () => {
    expect(
      ResourceCommandPolicy.getToolPolicy(AiResourceType.ProxmoxCluster),
    ).toBe(ProxmoxCommandPolicy);
    expect(
      ResourceCommandPolicy.getReadCommandGuide(AiResourceType.ProxmoxCluster),
    ).toBe(ProxmoxCommandPolicy.readCommandGuide);
    expect(
      ResourceCommandPolicy.getWriteCommandGuide(AiResourceType.ProxmoxCluster),
    ).toBe(ProxmoxCommandPolicy.writeCommandGuide);
  });

  test("is no longer the fail-closed stub", () => {
    expect(evaluate("pvesh get /version").reason).not.toContain(
      "not implemented yet",
    );
    expect(ProxmoxCommandPolicy.readCommandGuide).not.toContain("Unavailable");
    expect(ProxmoxCommandPolicy.writeCommandGuide).not.toContain("Unavailable");
  });

  test.each(
    AI_RESOURCE_TYPE_INFO[AiResourceType.ProxmoxCluster].testCommands.map(
      (command: string): [string] => {
        return [command];
      },
    ),
  )("the Test connection command %p is a Read", (command: string) => {
    expect(evaluate(command).tier).toBe(ResourceCommandTier.Read);
    expect(
      ResourceCommandPolicy.isReadOnly({
        resourceType: AiResourceType.ProxmoxCluster,
        command,
      }),
    ).toBe(true);
  });
});

/*
 * One command per read route, with the canonical API path it reads. Every
 * route in READ_ROUTES appears here at least once.
 */
const READ_COMMANDS: Array<[string, string]> = [
  ["pvesh get /version", "/version"],
  ["pvesh get /cluster/status", "/cluster/status"],
  ["pvesh get /cluster/resources", "/cluster/resources"],
  ["pvesh get /cluster/ha/status/current", "/cluster/ha/status/current"],
  ["pvesh get /cluster/ha/resources", "/cluster/ha/resources"],
  ["pvesh get /cluster/log", "/cluster/log"],
  ["pvesh get /cluster/tasks", "/cluster/tasks"],
  ["pvesh get /cluster/replication", "/cluster/replication"],
  ["pvesh get /cluster/backup", "/cluster/backup"],
  ["pvesh get /nodes", "/nodes"],
  ["pvesh get /nodes/pve1/status", "/nodes/pve1/status"],
  ["pvesh get /nodes/pve1/version", "/nodes/pve1/version"],
  ["pvesh get /nodes/pve1/tasks", "/nodes/pve1/tasks"],
  [
    `pvesh get /nodes/pve1/tasks/${UPID}/status`,
    `/nodes/pve1/tasks/${UPID}/status`,
  ],
  [`pvesh get /nodes/pve1/tasks/${UPID}/log`, `/nodes/pve1/tasks/${UPID}/log`],
  [
    `pvesh get '/nodes/pve-2.lab/tasks/${TOKEN_UPID}/log'`,
    `/nodes/pve-2.lab/tasks/${TOKEN_UPID}/log`,
  ],
  ["pvesh get /nodes/pve1/syslog", "/nodes/pve1/syslog"],
  ["pvesh get /nodes/pve1/journal", "/nodes/pve1/journal"],
  ["pvesh get /nodes/pve1/services", "/nodes/pve1/services"],
  [
    "pvesh get /nodes/pve1/services/pveproxy/state",
    "/nodes/pve1/services/pveproxy/state",
  ],
  [
    "pvesh get /nodes/pve1/services/pve-ha-lrm/state",
    "/nodes/pve1/services/pve-ha-lrm/state",
  ],
  ["pvesh get /nodes/pve1/storage", "/nodes/pve1/storage"],
  [
    "pvesh get /nodes/pve1/storage/local-lvm/status",
    "/nodes/pve1/storage/local-lvm/status",
  ],
  ["pvesh get /nodes/pve1/disks/list", "/nodes/pve1/disks/list"],
  [
    "pvesh get /nodes/pve1/disks/smart --disk /dev/sda",
    "/nodes/pve1/disks/smart",
  ],
  ["pvesh get /nodes/pve1/network", "/nodes/pve1/network"],
  ["pvesh get /nodes/pve1/netstat", "/nodes/pve1/netstat"],
  ["pvesh get /nodes/pve1/rrddata --timeframe hour", "/nodes/pve1/rrddata"],
  ["pvesh get /nodes/pve1/qemu", "/nodes/pve1/qemu"],
  ["pvesh get /nodes/pve1/lxc", "/nodes/pve1/lxc"],
  [
    "pvesh get /nodes/pve1/qemu/101/status/current",
    "/nodes/pve1/qemu/101/status/current",
  ],
  [
    "pvesh get /nodes/pve1/lxc/200/status/current",
    "/nodes/pve1/lxc/200/status/current",
  ],
  ["pvesh get /nodes/pve1/qemu/101/config", "/nodes/pve1/qemu/101/config"],
  ["pvesh get /nodes/pve1/lxc/200/config", "/nodes/pve1/lxc/200/config"],
  ["pvesh get /nodes/pve1/qemu/101/pending", "/nodes/pve1/qemu/101/pending"],
  ["pvesh get /nodes/pve1/lxc/200/pending", "/nodes/pve1/lxc/200/pending"],
  [
    "pvesh get /nodes/pve1/qemu/101/rrddata --timeframe day",
    "/nodes/pve1/qemu/101/rrddata",
  ],
  [
    "pvesh get /nodes/pve1/lxc/200/rrddata --timeframe week --cf MAX",
    "/nodes/pve1/lxc/200/rrddata",
  ],
  ["pvesh get /nodes/pve1/qemu/101/snapshot", "/nodes/pve1/qemu/101/snapshot"],
  ["pvesh get /nodes/pve1/lxc/200/snapshot", "/nodes/pve1/lxc/200/snapshot"],
  [
    "pvesh get /nodes/pve1/qemu/101/agent/info",
    "/nodes/pve1/qemu/101/agent/info",
  ],
  [
    "pvesh get /nodes/pve1/qemu/101/agent/get-osinfo",
    "/nodes/pve1/qemu/101/agent/get-osinfo",
  ],
  [
    "pvesh get /nodes/pve1/qemu/101/agent/get-fsinfo",
    "/nodes/pve1/qemu/101/agent/get-fsinfo",
  ],
  [
    "pvesh get /nodes/pve1/qemu/101/agent/network-get-interfaces",
    "/nodes/pve1/qemu/101/agent/network-get-interfaces",
  ],
  [
    "pvesh get /nodes/pve1/qemu/101/agent/get-host-name",
    "/nodes/pve1/qemu/101/agent/get-host-name",
  ],
  [
    "pvesh get /nodes/pve1/qemu/101/agent/get-time",
    "/nodes/pve1/qemu/101/agent/get-time",
  ],
  ["pvesh get /nodes/pve1/replication", "/nodes/pve1/replication"],
  ["pvesh get /nodes/pve1/apt/update", "/nodes/pve1/apt/update"],
  ["pvesh get /nodes/pve1/ceph/status", "/nodes/pve1/ceph/status"],
  ["pvesh get /pools", "/pools"],
  ["pvesh get /storage", "/storage"],
  // ls reads the same paths.
  ["pvesh ls /nodes", "/nodes"],
  ["pvesh ls /nodes/pve1/qemu", "/nodes/pve1/qemu"],
  // Node names: FQDN-style, digits first, and the API's localhost alias.
  [
    "pvesh get /nodes/pve1.example.com/status",
    "/nodes/pve1.example.com/status",
  ],
  ["pvesh get /nodes/1node/status", "/nodes/1node/status"],
  ["pvesh get /nodes/localhost/status", "/nodes/localhost/status"],
  // VMIDs from two to nine digits.
  [
    "pvesh get /nodes/pve1/qemu/10/status/current",
    "/nodes/pve1/qemu/10/status/current",
  ],
  [
    "pvesh get /nodes/pve1/qemu/999999999/status/current",
    "/nodes/pve1/qemu/999999999/status/current",
  ],
  // A trailing slash is dropped from the request path.
  ["pvesh get /nodes/pve1/status/", "/nodes/pve1/status"],
];

describe("Read", () => {
  test.each(READ_COMMANDS)(
    "%p is a Read of %p",
    (command: string, path: string) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.Read);
      expect(result.targets).toEqual([]);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.program).toBe("pvesh");
      expect(result.verb).toBe(tokens(command)[1]);
      expect(result.reason).toContain(`reads ${path} from the Proxmox VE API`);
      expect(result.reason).toContain("changes nothing");

      const built: ProxmoxApiRequest = request(command);

      expect(built.method).toBe("GET");
      expect(built.path).toBe(path);
    },
  );

  test.each([
    ["pvesh get /nodes/pve1/qemu/101/config"],
    ["pvesh get /nodes/pve1/lxc/200/pending"],
    ["pvesh get /storage"],
  ])("%p says its secrets are redacted", (command: string) => {
    expect(evaluate(command).reason).toContain("redacted");
  });

  test("a plain read does not claim redaction", () => {
    expect(evaluate("pvesh get /cluster/status").reason).not.toContain(
      "redacted",
    );
  });
});

describe("Read options", () => {
  test.each([
    ["pvesh get /cluster/resources --type vm", { type: "vm" }],
    ["pvesh get /cluster/resources --type=storage", { type: "storage" }],
    ["pvesh get /cluster/resources --type node", { type: "node" }],
    ["pvesh get /cluster/resources --type sdn", { type: "sdn" }],
    ["pvesh get /cluster/ha/resources --type ct", { type: "ct" }],
    ["pvesh get /cluster/log --max 50", { max: "50" }],
    [
      "pvesh get /nodes/pve1/tasks --errors 1 --limit 20",
      { errors: "1", limit: "20" },
    ],
    [
      "pvesh get /nodes/pve1/tasks --vmid 101 --source all --start 0",
      { vmid: "101", source: "all", start: "0" },
    ],
    [
      "pvesh get /nodes/pve1/tasks --typefilter qmstart --userfilter root@pam",
      { typefilter: "qmstart", userfilter: "root@pam" },
    ],
    [
      "pvesh get /nodes/pve1/tasks --since 1735689600 --until 1735776000",
      { since: "1735689600", until: "1735776000" },
    ],
    [
      `pvesh get /nodes/pve1/tasks/${UPID}/log --limit 100 --start 50`,
      { limit: "100", start: "50" },
    ],
    [
      "pvesh get /nodes/pve1/syslog --limit 200 --since '2025-01-31 14:05' --until 2025-02-01 --service pveproxy",
      {
        limit: "200",
        since: "2025-01-31 14:05",
        until: "2025-02-01",
        service: "pveproxy",
      },
    ],
    [
      "pvesh get /nodes/pve1/syslog --since '2025-01-31 14:05:59'",
      { since: "2025-01-31 14:05:59" },
    ],
    [
      "pvesh get /nodes/pve1/journal --lastentries 100 --since 1735689600",
      { lastentries: "100", since: "1735689600" },
    ],
    [
      "pvesh get /nodes/pve1/storage --content images,rootdir --enabled 1",
      { content: "images,rootdir", enabled: "1" },
    ],
    [
      "pvesh get /nodes/pve1/disks/list --skipsmart 1 --include-partitions 0",
      { skipsmart: "1", "include-partitions": "0" },
    ],
    [
      "pvesh get /nodes/pve1/disks/smart --disk /dev/nvme0n1 --healthonly 1",
      { disk: "/dev/nvme0n1", healthonly: "1" },
    ],
    [
      "pvesh get /nodes/pve1/disks/smart --disk=/dev/disk/by-id/ata-WDC_WD40EFRX-68N32N0_WD-WCC7K0XXXXXX",
      { disk: "/dev/disk/by-id/ata-WDC_WD40EFRX-68N32N0_WD-WCC7K0XXXXXX" },
    ],
    ["pvesh get /nodes/pve1/network --type bridge", { type: "bridge" }],
    ["pvesh get /nodes/pve1/network --type OVSBridge", { type: "OVSBridge" }],
    [
      "pvesh get /nodes/pve1/rrddata --timeframe week --cf AVERAGE",
      { timeframe: "week", cf: "AVERAGE" },
    ],
    ["pvesh get /nodes/pve1/qemu --full 1", { full: "1" }],
    ["pvesh get /nodes/pve1/qemu/101/config --current 1", { current: "1" }],
    ["pvesh get /nodes/pve1/replication --guest 101", { guest: "101" }],
    // Options before the path, and mixed around it, read the same.
    ["pvesh get --type vm /cluster/resources", { type: "vm" }],
    [
      "pvesh get --errors=1 /nodes/pve1/tasks --limit 5",
      { errors: "1", limit: "5" },
    ],
  ])("%p", (command: string, params: Record<string, string>) => {
    expect(evaluate(command).tier).toBe(ResourceCommandTier.Read);
    expect(request(command).params).toEqual(params);
  });

  test.each([
    ["pvesh get /version --output-format json", "json"],
    ["pvesh get /version --output-format=json-pretty", "json-pretty"],
    ["pvesh get --output-format text /version", "text"],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start --output-format json",
      "json",
    ],
  ])("%p prints as %p", (command: string, format: string) => {
    expect(evaluate(command).tier).not.toBe(ResourceCommandTier.Denied);
    expect(request(command).outputFormat).toBe(format);
    expect(request(command).params).toEqual({});
  });

  test("no --output-format leaves the choice to the agent", () => {
    expect(request("pvesh get /version").outputFormat).toBeNull();
  });

  test.each([
    [
      "pvesh get /version --output-format yaml",
      "--output-format must be one of json, json-pretty, text",
    ],
    [
      "pvesh get /version --output-format JSON",
      "--output-format must be one of",
    ],
    ["pvesh get /version --output-format=", "--output-format must be one of"],
    [
      "pvesh get /cluster/resources --type vms",
      "must be one of vm, storage, node, sdn",
    ],
    [
      "pvesh get /cluster/resources --type VM",
      "must be one of vm, storage, node, sdn",
    ],
    ["pvesh get /cluster/ha/resources --type vm1", "one of vm, ct"],
    ["pvesh get /cluster/log --max 0", "a whole number from 1 to 5000"],
    ["pvesh get /cluster/log --max 5001", "a whole number from 1 to 5000"],
    ["pvesh get /cluster/log --max 050", "a whole number"],
    ["pvesh get /cluster/log --max -1", "--max needs a value"],
    ["pvesh get /cluster/log --max=-1", "a whole number"],
    ["pvesh get /cluster/log --max 1e3", "a whole number"],
    ["pvesh get /cluster/log --max ' 10'", "a whole number"],
    [
      "pvesh get /nodes/pve1/tasks --errors true",
      "--errors on pvesh get /nodes/{node}/tasks must be 0 or 1",
    ],
    ["pvesh get /nodes/pve1/tasks --errors yes", "must be 0 or 1"],
    ["pvesh get /nodes/pve1/tasks --vmid 0101", "a guest id (VMID)"],
    [
      "pvesh get /nodes/pve1/tasks --source running",
      "one of archive, active, all",
    ],
    ["pvesh get /nodes/pve1/tasks --typefilter 'qm start'", "a task type"],
    [
      "pvesh get /nodes/pve1/tasks --userfilter 'root@pam x'",
      "a user such as root@pam",
    ],
    [
      "pvesh get /nodes/pve1/syslog --since yesterday",
      "a time such as 2025-01-31",
    ],
    [
      "pvesh get /nodes/pve1/syslog --since 1735689600",
      "a time such as 2025-01-31",
    ],
    ["pvesh get /nodes/pve1/journal --since '2025-01-31'", "a whole number"],
    [
      "pvesh get /nodes/pve1/storage --content images,secrets",
      "a comma-separated list of",
    ],
    ["pvesh get /nodes/pve1/storage --content ''", "a comma-separated list of"],
    [
      "pvesh get /nodes/pve1/disks/smart --disk sda",
      "a block device such as /dev/sda",
    ],
    [
      "pvesh get /nodes/pve1/disks/smart --disk /dev/../etc/shadow",
      "a block device",
    ],
    [
      "pvesh get /nodes/pve1/disks/smart --disk /etc/pve/priv/authkey.key",
      "a block device",
    ],
    [
      "pvesh get /nodes/pve1/rrddata --timeframe month",
      "one of hour, day, week",
    ],
    [
      "pvesh get /nodes/pve1/rrddata --timeframe hour --cf MIN",
      "one of AVERAGE, MAX",
    ],
    [
      "pvesh get /nodes/pve1/network --type wireguard",
      "--type on pvesh get /nodes/{node}/network",
    ],
  ])("%p is Denied: a bad value", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    [
      "pvesh get /nodes/pve1/rrddata",
      "needs --timeframe (one of hour, day, week)",
    ],
    ["pvesh get /nodes/pve1/qemu/101/rrddata --cf MAX", "needs --timeframe"],
    [
      "pvesh get /nodes/pve1/disks/smart",
      "needs --disk (a block device such as /dev/sda)",
    ],
  ])(
    "%p is Denied: a required option is missing",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );

  test.each([
    [
      "pvesh get /version --type vm",
      "it takes no options besides --output-format",
    ],
    [
      "pvesh get /cluster/status --full 1",
      "it takes no options besides --output-format",
    ],
    [
      "pvesh get /nodes/pve1/lxc --full 1",
      "is not an option OneUptime AI may pass to pvesh get /nodes/{node}/lxc",
    ],
    [
      "pvesh get /nodes/pve1/tasks --statusfilter ok",
      "its options are --errors, --limit, --vmid",
    ],
    ["pvesh get /nodes/pve1/tasks --Limit 5", "--Limit is not an option"],
    ["pvesh get /nodes/pve1/tasks --lim 5", "--lim is not an option"],
    [
      "pvesh get /nodes/pve1/qemu/101/config --snapshot before-upgrade",
      "--snapshot is not an option",
    ],
    [
      "pvesh get /nodes/pve1/journal --startcursor x",
      "--startcursor is not an option",
    ],
    [
      "pvesh get /nodes/pve1/tasks/" + UPID + "/log --download 1",
      "--download is not an option",
    ],
    [
      "pvesh get /version --human-readable 1",
      "--human-readable is not an option",
    ],
    ["pvesh get /version --noborder 1", "--noborder is not an option"],
    ["pvesh get /version --noproxy 1", "--noproxy is not an option"],
    ["pvesh get /version --constructor 1", "--constructor is not an option"],
    ["pvesh get /version --toString 1", "--toString is not an option"],
  ])(
    "%p is Denied: an option the path does not take",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );
});

describe("Read refusals", () => {
  test.each([
    ["pvesh get /access"],
    ["pvesh get /access/users"],
    ["pvesh get /access/users/root@pam/token"],
    ["pvesh get /access/acl"],
    ["pvesh get /access/tfa"],
    ["pvesh get /access/ticket"],
    ["pvesh ls /access/roles"],
    ["pvesh create /access/ticket --username root@pam"],
    ["pvesh create /access/users/root@pam/token/ai"],
    ["pvesh get /access/users --output-format yaml"],
    ["pvesh get /access/users -x"],
  ])("%p is Denied: /access", (command: string) => {
    expectDenied(command, "everything under /access");
  });

  test.each([
    ["pvesh create /nodes/pve1/qemu/101/vncproxy"],
    ["pvesh create /nodes/pve1/lxc/200/termproxy"],
    ["pvesh create /nodes/pve1/qemu/101/spiceproxy"],
    ["pvesh get /nodes/pve1/qemu/101/vncwebsocket --port 5900"],
    ["pvesh create /nodes/pve1/qemu/101/mtunnel"],
    ["pvesh create /nodes/pve1/termproxy"],
    ["pvesh create /nodes/pve1/vncshell"],
    ["pvesh create /nodes/pve1/spiceshell"],
    ["pvesh get /nodes/pve1/vncwebsocket"],
  ])("%p is Denied: a console", (command: string) => {
    expectDenied(command, "the Proxmox equivalent of exec");
  });

  test.each([
    ["pvesh create /nodes/pve1/qemu/101/agent/exec --command whoami"],
    ["pvesh get /nodes/pve1/qemu/101/agent/exec-status --pid 1"],
    ["pvesh get /nodes/pve1/qemu/101/agent/file-read --file /etc/shadow"],
    ["pvesh create /nodes/pve1/qemu/101/agent/file-write"],
    ["pvesh create /nodes/pve1/qemu/101/agent/set-user-password"],
    ["pvesh create /nodes/pve1/qemu/101/monitor --command 'info status'"],
  ])("%p is Denied: exec in a guest", (command: string) => {
    expectDenied(
      command,
      "run commands in, read files from or change passwords",
    );
  });

  test("the node's batch execute is Denied", () => {
    expectDenied(
      "pvesh create /nodes/pve1/execute",
      "a batch of arbitrary API calls",
    );
  });

  test.each([
    ["pvesh get /", '"/" is the root of the API'],
    ["pvesh get /cluster", "/cluster is not a path OneUptime AI may read"],
    ["pvesh get /cluster/config", "is not a path OneUptime AI may read"],
    ["pvesh get /cluster/config/nodes", "is not a path OneUptime AI may read"],
    ["pvesh get /cluster/acme/plugins", "is not a path OneUptime AI may read"],
    ["pvesh get /cluster/notifications/endpoints/smtp", "is not a path"],
    ["pvesh get /cluster/firewall/rules", "is not a path"],
    ["pvesh get /cluster/sdn/vnets", "is not a path"],
    ["pvesh get /cluster/mapping/pci", "is not a path"],
    ["pvesh get /nodes/pve1", "is not a path"],
    ["pvesh get /nodes/pve1/qemu/101", "is not a path"],
    [
      "pvesh get /nodes/pve1/qemu/101/cloudinit/dump --type user",
      "is not a path",
    ],
    ["pvesh get /nodes/pve1/storage/local/content", "is not a path"],
    ["pvesh get /nodes/pve1/lxc/200/agent/info", "is not a path"],
    ["pvesh get /nodes/pve1/qemu/101/snapshot/before/config", "is not a path"],
    ["pvesh get /nodes/pve1/firewall/rules", "is not a path"],
    ["pvesh get /nodes/pve1/certificates/info", "is not a path"],
    ["pvesh get /nodes/pve1/hosts", "is not a path"],
    ["pvesh get /Nodes", "is not a path"],
    ["pvesh get /VERSION", "is not a path"],
  ])(
    "%p is Denied: not an allowed read path",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
      expect(evaluate(command).reason).toContain("Readable paths:");
    },
  );

  test.each([
    [
      "pvesh get /nodes/pve_1/status",
      '"pve_1" in /nodes/{node}/status must be a node name',
    ],
    ["pvesh get /nodes/-pve/status", "must be a node name"],
    [`pvesh get /nodes/${"n".repeat(64)}/status`, "must be a node name"],
    ["pvesh get /nodes/pve1/qemu/0101/status/current", "without leading zeros"],
    ["pvesh get /nodes/pve1/qemu/7/status/current", "a guest id (VMID)"],
    [
      "pvesh get /nodes/pve1/qemu/1234567890/status/current",
      "a guest id (VMID)",
    ],
    ["pvesh get /nodes/pve1/qemu/abc/config", "a guest id (VMID)"],
    ["pvesh get /nodes/pve1/vm/101/config", "qemu (a VM) or lxc (a container)"],
    [
      "pvesh get /nodes/pve1/QEMU/101/config",
      "qemu (a VM) or lxc (a container)",
    ],
    ["pvesh get /nodes/pve1/tasks/UPID:pve1:bad/status", "a task id (UPID)"],
    ["pvesh get /nodes/pve1/tasks/12345/log", "a task id (UPID)"],
    ["pvesh get /nodes/pve1/storage/-local/status", "a storage id"],
    ["pvesh get /nodes/pve1/services/PVEPROXY/state", "a service name"],
    ["pvesh get /nodes/pve1/qemu/101/agent/ping", "one of info, get-osinfo"],
    [
      "pvesh get /nodes/pve1/qemu/101/agent/get-users",
      "one of info, get-osinfo",
    ],
  ])(
    "%p is Denied: a bad path segment",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );

  test.each([
    ["pvesh get /nodes/pve1/qemu/101/status/start"],
    ["pvesh get /nodes/pve1/lxc/200/status/stop"],
    ["pvesh ls /nodes/pve1/qemu/101/migrate"],
    ["pvesh get /nodes/pve1/services/pveproxy/restart"],
  ])("%p is Denied: an action, not a read", (command: string) => {
    expectDenied(
      command,
      "is an action for pvesh create, not something to read",
    );
  });
});

describe("SafeWrite", () => {
  test.each([
    [
      "pvesh create /nodes/pve1/qemu/101/status/start",
      "qemu start",
      "101",
      "starts VM 101 on node pve1",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start --timeout 60",
      "qemu start",
      "101",
      "starts VM 101",
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/status/start",
      "lxc start",
      "200",
      "starts container 200 on node pve1",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/resume",
      "qemu resume",
      "101",
      "resumes the paused VM 101",
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/status/resume",
      "lxc resume",
      "200",
      "resumes the paused container 200",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/reboot",
      "qemu reboot",
      "101",
      "cleanly reboots VM 101",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/reboot --timeout=120",
      "qemu reboot",
      "101",
      "reboots",
    ],
    [
      "pvesh create /nodes/pve2/lxc/200/status/reboot --timeout 30",
      "lxc reboot",
      "200",
      "reboots container 200 on node pve2",
    ],
    [
      "pvesh create /nodes/pve1/qemu/999999999/status/start",
      "qemu start",
      "999999999",
      "starts",
    ],
    [
      "pvesh create --timeout 60 /nodes/pve1/qemu/101/status/start",
      "qemu start",
      "101",
      "starts",
    ],
  ])(
    "%p is SafeWrite",
    (command: string, verb: string, target: string, reason: string) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual([target]);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.reason).toContain(reason);
      expect(request(command).method).toBe("POST");
    },
  );

  test("the timeout is sent as an API parameter", () => {
    expect(
      request("pvesh create /nodes/pve1/qemu/101/status/start --timeout 60"),
    ).toEqual({
      method: "POST",
      path: "/nodes/pve1/qemu/101/status/start",
      params: { timeout: "60" },
      outputFormat: null,
    });
  });

  test.each([
    [
      "pvesh create /nodes/pve1/lxc/200/status/start --timeout 60",
      "it takes no options besides --output-format",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/resume --timeout 5",
      "it takes no options",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start --skiplock 1",
      "--skiplock is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start --force-cpu host",
      "--force-cpu is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start --stateuri tcp",
      "--stateuri is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start --targetstorage local",
      "--targetstorage is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/resume --nocheck 1",
      "--nocheck is not an option",
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/status/start --debug 1",
      "--debug is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start --timeout 3601",
      "a whole number from 0 to 3600",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start --timeout abc",
      "a whole number from 0 to 3600",
    ],
  ])(
    "%p is Denied: an option a safe write does not take",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );
});

describe("RiskyWrite", () => {
  test.each([
    [
      "pvesh create /nodes/pve1/qemu/101/status/shutdown",
      "qemu shutdown",
      "101",
      "shuts down VM 101",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout 180 --forceStop 0",
      "qemu shutdown",
      "101",
      "stays down",
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/status/shutdown --forceStop=0",
      "lxc shutdown",
      "200",
      "shuts down container 200",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/stop",
      "qemu stop",
      "101",
      "hard-stops VM 101",
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/status/stop",
      "lxc stop",
      "200",
      "pulling the plug",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/suspend",
      "qemu suspend",
      "101",
      "pauses VM 101",
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/status/suspend",
      "lxc suspend",
      "200",
      "until someone resumes it",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/reset",
      "qemu reset",
      "101",
      "hard-resets VM 101",
    ],
  ])(
    "%p is RiskyWrite",
    (command: string, verb: string, target: string, reason: string) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual([target]);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.reason).toContain(reason);
    },
  );

  test.each(
    PROXMOX_RESTARTABLE_SERVICES.flatMap(
      (service: string): Array<[string, string]> => {
        return ["start", "restart", "reload"].map(
          (action: string): [string, string] => {
            return [service, action];
          },
        );
      },
    ),
  )(
    "the %s service may be %sed (RiskyWrite, no human required)",
    (service: string, action: string) => {
      const command: string = `pvesh create /nodes/pve1/services/${service}/${action}`;
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.verb).toBe(`service ${action}`);
      expect(result.targets).toEqual([`pve1/${service}`]);
      expect(result.requiresHuman).toBeUndefined();
      expect(request(command)).toEqual({
        method: "POST",
        path: `/nodes/pve1/services/${service}/${action}`,
        params: {},
        outputFormat: null,
      });
    },
  );

  test("the service list is the one the spec names", () => {
    expect([...PROXMOX_RESTARTABLE_SERVICES].sort()).toEqual(
      [
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
      ].sort(),
    );
    expect([...PROXMOX_CLUSTER_CRITICAL_SERVICES]).toEqual([
      "corosync",
      "pve-cluster",
    ]);
  });

  test("a restart says what pauses, a reload that it reloads", () => {
    expect(
      evaluate("pvesh create /nodes/pve1/services/pveproxy/restart").reason,
    ).toContain("restarts the pveproxy service on node pve1");
    expect(
      evaluate("pvesh create /nodes/pve1/services/pveproxy/reload").reason,
    ).toContain("while it reloads");
  });

  test.each([
    [
      "pvesh create /nodes/pve1/qemu/101/status/shutdown --forceStop 1",
      "--forceStop on pvesh create /nodes/{node}/qemu/{vmid}/status/shutdown must be exactly 0",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/shutdown --keepActive 1",
      "--keepActive is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/stop --timeout 10",
      "it takes no options besides --output-format",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/stop --overrule-shutdown 1",
      "--overrule-shutdown is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/suspend --todisk 1",
      "--todisk is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/reset --skiplock 1",
      "--skiplock is not an option",
    ],
    [
      "pvesh create /nodes/pve1/services/pveproxy/restart --timeout 5",
      "it takes no options besides --output-format",
    ],
  ])(
    "%p is Denied: an option a risky write does not take",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );
});

describe("writes that always need a human", () => {
  test.each([
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2",
      "qemu migrate",
      "101",
      { target: "pve2" },
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --online 1",
      "qemu migrate",
      "101",
      { target: "pve2", online: "1" },
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --online=0 --target=pve3.lab",
      "qemu migrate",
      "101",
      { online: "0", target: "pve3.lab" },
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/migrate --target pve2 --restart 1",
      "lxc migrate",
      "200",
      { target: "pve2", restart: "1" },
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/migrate --target pve2 --online 0 --restart 0",
      "lxc migrate",
      "200",
      { target: "pve2", online: "0", restart: "0" },
    ],
  ])(
    "%p is RiskyWrite + requiresHuman",
    (
      command: string,
      verb: string,
      target: string,
      params: Record<string, string>,
    ) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.requiresHuman).toBe(true);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual([target]);
      expect(result.reason).toContain("a human always decides");
      expect(request(command).params).toEqual(params);
    },
  );

  test("the migrate reason names both nodes", () => {
    expect(
      evaluate("pvesh create /nodes/pve1/qemu/101/migrate --target pve2")
        .reason,
    ).toContain("moves VM 101 from node pve1 to node pve2");
  });

  test.each(
    PROXMOX_CLUSTER_CRITICAL_SERVICES.flatMap(
      (service: string): Array<[string, string]> => {
        return ["start", "restart", "reload"].map(
          (action: string): [string, string] => {
            return [service, action];
          },
        );
      },
    ),
  )(
    "%s %s is RiskyWrite + requiresHuman",
    (service: string, action: string) => {
      const result: ResourceCommandPolicyResult = evaluate(
        `pvesh create /nodes/pve1/services/${service}/${action}`,
      );

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.requiresHuman).toBe(true);
      expect(result.targets).toEqual([`pve1/${service}`]);
      expect(result.reason).toContain("a human always decides");
    },
  );

  test.each([
    [
      "pvesh create /nodes/pve1/qemu/101/migrate",
      "needs --target (a node name such as pve2)",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve1",
      "is already on node pve1",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target PVE1",
      "is already on node pve1",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target localhost",
      "--target must name the node to move to",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target 'pve 2'",
      "a node name such as pve2",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --restart 1",
      "--restart is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --with-local-disks 1",
      "--with-local-disks is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --force 1",
      "--force is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --targetstorage local",
      "--targetstorage is not an option",
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/migrate --target pve2 --target-storage local",
      "--target-storage is not an option",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --online yes",
      "must be 0 or 1",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --target pve3",
      "--target is given more than once",
    ],
  ])("%p is Denied", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });
});

describe("Denied writes", () => {
  test.each([
    [
      "pvesh set /nodes/pve1/qemu/101/config --memory 8192",
      "pvesh set changes configuration",
    ],
    [
      "pvesh set /cluster/options --keyboard en-us",
      "pvesh set changes configuration",
    ],
    ["pvesh delete /nodes/pve1/qemu/101", "pvesh delete removes objects"],
    [
      "pvesh delete /nodes/pve1/qemu/101/snapshot/before-upgrade",
      "pvesh delete removes objects",
    ],
    ["pvesh usage /nodes", "pvesh usage is not available"],
    ["pvesh help", "pvesh help is not available"],
    [
      "pvesh post /nodes/pve1/qemu/101/status/start",
      '"post" is not a pvesh command',
    ],
    ["pvesh put /nodes/pve1/qemu/101/config", '"put" is not a pvesh command'],
    ["pvesh GET /version", '"GET" is not a pvesh command'],
    [
      "pvesh Create /nodes/pve1/qemu/101/status/start",
      '"Create" is not a pvesh command',
    ],
    ["pvesh constructor /version", '"constructor" is not a pvesh command'],
    ["pvesh __proto__ /version", '"__proto__" is not a pvesh command'],
    ["pvesh", "name what pvesh should do"],
  ])("%p is Denied: the command word", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("set and delete say what pvesh create may do instead", () => {
    expect(evaluate("pvesh set /nodes/pve1/qemu/101/config").reason).toContain(
      PROXMOX_CREATE_PATHS_SUMMARY,
    );
    expect(evaluate("pvesh delete /pools/prod").reason).toContain(
      PROXMOX_CREATE_PATHS_SUMMARY,
    );
    expect(evaluate("pvesh usage /nodes").reason).toContain(
      PROXMOX_READABLE_PATHS_SUMMARY,
    );
  });

  test.each([
    [
      "pvesh create /nodes/pve1/services/pveproxy/stop",
      "stopping a node service is never allowed",
    ],
    [
      "pvesh create /nodes/pve1/services/corosync/stop",
      "stopping a node service is never allowed",
    ],
    [
      "pvesh create /nodes/pve1/services/sshd/restart",
      '"sshd" is not a node service OneUptime AI may restart',
    ],
    [
      "pvesh create /nodes/pve1/services/systemd-journald/restart",
      "is not a node service",
    ],
    [
      "pvesh create /nodes/pve1/services/pvefw-logger/restart",
      "is not a node service",
    ],
    [
      "pvesh create /nodes/pve1/services/ksmtuned/start",
      "is not a node service",
    ],
    [
      "pvesh create /nodes/pve1/services/PVEPROXY/restart",
      "is not a node service",
    ],
    [
      "pvesh create /nodes/pve1/services/pveproxy/kill",
      '"kill" is not a service action',
    ],
    [
      "pvesh create /nodes/pve1/services/pveproxy/state",
      '"state" is not a service action',
    ],
  ])("%p is Denied: node services", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    [
      "pvesh create /nodes/pve1/lxc/200/status/reset",
      "containers have no reset, reboot one instead",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/hibernate",
      '"hibernate" is not a VM status action',
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/current",
      '"current" is not a VM status action',
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/Start",
      '"Start" is not a VM status action',
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/constructor",
      '"constructor" is not a VM status action',
    ],
    [
      "pvesh create /nodes/pve1/qemu/0101/status/start",
      "without leading zeros",
    ],
    ["pvesh create /nodes/pve1/qemu/abc/status/start", "a guest id (VMID)"],
    [
      "pvesh create /nodes/pve1/qemu/abc/migrate --target pve2",
      "a guest id (VMID)",
    ],
    ["pvesh create /nodes/pve_1/qemu/101/status/start", "must be a node name"],
  ])("%p is Denied: guest actions", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    ["pvesh create /nodes/localhost/qemu/101/status/start"],
    ["pvesh create /nodes/LocalHost/qemu/101/status/stop"],
    ["pvesh create /nodes/localhost/lxc/200/migrate --target pve2"],
    ["pvesh create /nodes/localhost/services/pveproxy/restart"],
  ])("%p is Denied: a write names its node", (command: string) => {
    expectDenied(command, "a change must name its node");
  });

  test.each([
    [
      "pvesh create /nodes/pve1/status --command reboot",
      "rebooting or shutting down a node",
    ],
    ["pvesh create /nodes/pve1/stopall", "acts on every guest on the node"],
    ["pvesh create /nodes/pve1/startall", "acts on every guest on the node"],
    [
      "pvesh create /nodes/pve1/migrateall --target pve2",
      "acts on every guest on the node",
    ],
    ["pvesh create /nodes/pve1/suspendall", "acts on every guest on the node"],
    [
      "pvesh create /nodes/pve1/qemu/101/snapshot --snapname before",
      "snapshots is never allowed",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/snapshot/before/rollback",
      "a rollback discards everything",
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/snapshot/before/rollback",
      "a rollback discards everything",
    ],
  ])(
    "%p is Denied: node-wide and destructive actions",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );

  test.each([
    ["pvesh create /nodes/pve1/qemu --vmid 999"],
    ["pvesh create /nodes/pve1/qemu/101/clone --newid 102"],
    ["pvesh create /nodes/pve1/qemu/101/template"],
    ["pvesh create /nodes/pve1/qemu/101/move_disk --disk scsi0"],
    ["pvesh create /nodes/pve1/lxc/200/remote_migrate"],
    ["pvesh create /nodes/pve1/apt/update"],
    ["pvesh create /nodes/pve1/storage/local/upload"],
    ["pvesh create /nodes/pve1/storage/local/download-url"],
    ["pvesh create /cluster/ha/resources/vm:101/migrate --node pve2"],
    ["pvesh create /cluster/backup --schedule daily"],
    ["pvesh create /pools --poolid prod"],
    ["pvesh create /cluster/firewall/rules"],
    ["pvesh create /nodes/pve1/qemu/101/status"],
  ])("%p is Denied: not an allowed create path", (command: string) => {
    expectDenied(command, PROXMOX_CREATE_PATHS_SUMMARY);
  });

  test.each([
    ["pvesh create /version"],
    ["pvesh create /nodes/pve1/tasks"],
    ["pvesh create /nodes/pve1/qemu/101/status/current"],
  ])("%p is Denied: a read path is not an action", (command: string) => {
    const reason: string = evaluate(command).reason;

    expect(evaluate(command).tier).toBe(ResourceCommandTier.Denied);
    expect(reason).toMatch(/is a path to read|is not a VM status action/);
  });
});

describe("the grammar leaves no second reading", () => {
  test.each([
    // Single-dash and combined short options.
    ["pvesh get -timeout 30 /version", '"-timeout" is not supported'],
    ["pvesh get /nodes/pve1/tasks -errors 1", '"-errors" is not supported'],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start -t 5",
      '"-t" is not supported',
    ],
    [
      "pvesh get /version -abc",
      "never as single-dash or combined short options",
    ],
    ["pvesh get /version -", '"-" is not supported'],
    // The terminator.
    ["pvesh get -- /version", 'pvesh commands never need "--"'],
    ["pvesh get /version --", 'pvesh commands never need "--"'],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start -- --forceStop 1",
      'never need "--"',
    ],
    // A value option with no value, or with an option where the value goes.
    ["pvesh get /cluster/log --max", "--max needs a value right after it"],
    [
      "pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout --forceStop 1",
      'got the option "--forceStop"',
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target --online 1",
      "--target needs a value",
    ],
    // Booleans are never bare.
    ["pvesh get /nodes/pve1/tasks --errors", "--errors needs a value"],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --online",
      "booleans are written 0 or 1",
    ],
    // Duplicates, in every spelling.
    [
      "pvesh get /cluster/log --max 5 --max 10",
      "--max is given more than once",
    ],
    [
      "pvesh get /cluster/log --max=5 --max 10",
      "--max is given more than once",
    ],
    [
      "pvesh get /version --output-format json --output-format=text",
      "--output-format is given more than once",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/shutdown --forceStop 0 --forceStop=1",
      "--forceStop is given more than once",
    ],
    // Malformed option names.
    [
      "pvesh get /version --=json",
      '"--=json" is not an option pvesh understands',
    ],
    ["pvesh get /version --output_format json", "--output_format"],
    [
      "pvesh get /version '--output format' json",
      "is not an option pvesh understands",
    ],
    ["pvesh get /version --__proto__ x", "is not an option pvesh understands"],
    // The command word first.
    ["pvesh --output-format json get /version", "comes right after pvesh"],
    ["pvesh -x get /version", "comes right after pvesh"],
  ])("%p is Denied", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("an option swallowing the path leaves no path to run", () => {
    // --timeout takes "/nodes/..." as its value: there is no path left.
    expectDenied(
      "pvesh create --timeout /nodes/pve1/qemu/101/status/start",
      "name the API path after pvesh create",
    );
  });

  test("a denied path cannot hide as an option value", () => {
    expectDenied(
      "pvesh get /version --output-format /access/users",
      "--output-format must be one of",
    );
    expectDenied(
      "pvesh get /cluster/log --max=/access/users",
      "a whole number",
    );
  });

  test.each([
    ["pvesh get /version /cluster/status", 'but "/cluster/status" follows it'],
    ["pvesh get /nodes/pve1/tasks errors=1", 'but "errors=1" follows it'],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start /nodes/pve1/qemu/102/status/start",
      "exactly one API path",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start 60",
      'but "60" follows it',
    ],
    ["pvesh get /version ''", 'but "" follows it'],
  ])("%p is Denied: one path only", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    [
      "pvesh get '/nodes/pve1/tasks?errors=1&limit=5'",
      "carries a query string",
    ],
    ["pvesh get /nodes/pve1/tasks?errors=1", "carries a query string"],
    ["pvesh get '/version#x'", "carries a query string"],
    [
      "pvesh get /nodes/pve1/tasks/UPID%3Apve1%3A0001A2B3/status",
      "is percent-encoded",
    ],
    ["pvesh get nodes", "paths start with"],
    ["pvesh get nodes/pve1/status", "paths start with"],
    ["pvesh get ''", "the API path is empty"],
    ["pvesh get //nodes", 'has an empty, "." or ".." segment'],
    ["pvesh get /nodes//status", "has an empty"],
    ["pvesh get /nodes/pve1/status//", "has an empty"],
    ["pvesh get /nodes/pve1/../../access/users", '".." segment'],
    ["pvesh get /nodes/./pve1/status", '"." or ".."'],
    ["pvesh get '/nodes/pve 1/status'", "holds a character no API path"],
    ["pvesh get '/nodes/pve1/status\\'", "holds a character"],
    ["pvesh get /nodes/pve1/status*", "holds a character"],
    ["pvesh get /nodes/pve1/qemu/101/config,/access", "holds a character"],
    ["pvesh get /nodes/pve1/status;id", "a command separator"],
  ])(
    "%p is Denied: the path is not written plainly",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );

  test("a path longer than the limit is Denied", () => {
    const longPath: string = `/nodes/${"a".repeat(MAX_PROXMOX_API_PATH_CHARS)}`;

    expectDenied(`pvesh get ${longPath}`, "longer than 512 characters");
  });

  test("a command longer than 2000 characters is Denied", () => {
    expectDenied(
      `pvesh get /cluster/log --max ${"1".repeat(2100)}`,
      "2000-character limit",
    );
    expect(
      evaluateArgv([
        "pvesh",
        "get",
        "/version",
        "--output-format",
        "x".repeat(2100),
      ]).reason,
    ).toContain("2000-character limit");
  });

  test("more than 64 words is Denied", () => {
    const argv: Array<string> = ["pvesh", "get", "/version"];

    while (argv.length <= 64) {
      argv.push("--output-format", "json");
    }

    expect(evaluateArgv(argv).reason).toContain("at most 64 words");
  });

  test.each([
    // Cyrillic "ѕ" in pvesh, "е" in get, and in path segments.
    ["pveѕh get /version", "is not a program the Proxmox AI agent runs"],
    ["pvesh gеt /version", "is not a pvesh command"],
    ["pvesh get /vеrsion", "holds a character no API path"],
    ["pvesh get /nodes/pve1/qemu/１０１/config", "holds a character"],
    ["pvesh get ／version", "paths start with"],
    ["pvesh create /nodes/pve1/qemu/101/status/stаrt", "holds a character"],
    // An en dash or em dash is not an option: it is an extra word.
    ["pvesh get /cluster/log –max 5", 'but "–max" follows it'],
    ["pvesh get /cluster/log —max 5", 'but "—max" follows it'],
    // Invisible and non-ASCII space and dash characters.
    ["pvesh get /version\u200b", "holds a character"],
    [
      "pvesh get /cluster/log --ma\u200bx 5",
      "is not an option pvesh understands",
    ],
    ["pvesh get /ver\u00a0sion", "holds a character"],
    ["pvesh get\u00a0/version", "is not a pvesh command"],
    [
      "pvesh create /nodes/pve1/services/pve\u2010proxy/restart",
      "holds a character",
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/start \u2014timeout 5",
      "follows it",
    ],
  ])(
    "%p is Denied: look-alike characters",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );

  test.each([
    ['pvesh get "/nodes/pve1/status"', "/nodes/pve1/status"],
    ["pvesh get '/nodes/pve1/status'", "/nodes/pve1/status"],
    ["pvesh get /nodes/'pve1'/status", "/nodes/pve1/status"],
    [
      'pvesh get /nodes/pve1/syslog --since "2025-01-31 14:05"',
      "/nodes/pve1/syslog",
    ],
  ])("quoting %p reads %p", (command: string, path: string) => {
    expect(evaluate(command).tier).toBe(ResourceCommandTier.Read);
    expect(request(command).path).toBe(path);
  });

  test.each([
    ["pvesh get /version | head", "pipes and redirects are not supported"],
    ["pvesh get /version > out.json", "pipes and redirects are not supported"],
    [
      "pvesh get /version; pvesh delete /pools/prod",
      "pipes and redirects are not supported",
    ],
    [
      "pvesh get $(cat /etc/pve/priv/token)",
      "pipes and redirects are not supported",
    ],
    ["sudo pvesh get /version", "own permissions"],
    ["/usr/bin/pvesh get /version", "write the program name without a path"],
    ["qm start 101", 'starts with "pvesh"'],
    ["pct stop 200", 'starts with "pvesh"'],
    ["PVESH get /version", "is not a program"],
  ])(
    "%p is Denied by the dispatcher before the tool",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );
});

describe("totality", () => {
  test.each([
    [null],
    [undefined],
    [42],
    ["pvesh get /version"],
    [{}],
    [[]],
    [[null]],
    [["pvesh", 5]],
    [["pvesh", "get", {}]],
    [["pvesh", "get", "/version\n"]],
    [["pvesh", "get", "/version\0"]],
    [["pvesh", "get", "/version\r"]],
    [["kubectl", "get", "pods"]],
    [["", "get", "/version"]],
    [["pvesh", ""]],
    [["pvesh", "get", ""]],
  ])("the tool never throws on %p and denies it", (argv: unknown) => {
    const result: ResourceCommandPolicyResult = evaluateArgv(
      argv as Array<string>,
    );

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.targets).toEqual([]);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);

    const parsed: ProxmoxCommandParseResult = parseProxmoxCommand(
      argv as Array<string>,
    );

    expect(parsed.request).toBeUndefined();
    expect(typeof parsed.errorMessage).toBe("string");
  });

  test("the tool never changes the argv it is handed", () => {
    const argv: Array<string> = [
      "pvesh",
      "create",
      "/nodes/pve1/qemu/101/status/start/",
      "--timeout=5",
    ];
    const copy: Array<string> = argv.slice();

    evaluateArgv(argv);
    parseProxmoxCommand(argv);

    expect(argv).toEqual(copy);
  });
});

describe("the result fields", () => {
  test("args are the words after pvesh, exactly as written", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      "pvesh create /nodes/pve1/qemu/101/status/start/ --timeout=5",
    );

    expect(result.args).toEqual([
      "create",
      "/nodes/pve1/qemu/101/status/start/",
      "--timeout=5",
    ]);
    expect(result.program).toBe("pvesh");
  });

  test.each([
    ["pvesh get /version", "pvesh get /version"],
    ["pvesh   get    /version  ", "pvesh get /version"],
    [
      "pvesh get /nodes/pve1/syslog --since '2025-01-31 14:05'",
      "pvesh get /nodes/pve1/syslog --since '2025-01-31 14:05'",
    ],
    [
      `pvesh get /nodes/pve-2.lab/tasks/${TOKEN_UPID}/status`,
      `pvesh get '/nodes/pve-2.lab/tasks/${TOKEN_UPID}/status'`,
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout=60 --forceStop 0",
      "pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout=60 --forceStop 0",
    ],
    [
      "pvesh set /nodes/pve1/qemu/101/config",
      "pvesh set /nodes/pve1/qemu/101/config",
    ],
    [
      "pvesh get '/nodes/pve1/tasks?errors=1&limit=5'",
      "pvesh get '/nodes/pve1/tasks?errors=1&limit=5'",
    ],
  ])("%p is displayed as %p", (command: string, display: string) => {
    expect(evaluate(command).displayCommand).toBe(display);
  });

  test("a display command round-trips through the tokenizer", () => {
    for (const [command] of READ_COMMANDS) {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(tokens(result.displayCommand)).toEqual(tokens(command));
      expect(evaluate(result.displayCommand).tier).toBe(result.tier);
    }
  });

  test("the display command is the tokenizer's rendering", () => {
    const argv: Array<string> = tokens(
      `pvesh get /nodes/pve1/tasks/${TOKEN_UPID}/log --limit 5`,
    );

    expect(evaluateArgv(argv).displayCommand).toBe(
      renderResourceDisplayCommand(argv),
    );
  });
});

describe("parseProxmoxCommand", () => {
  test.each([
    [
      "pvesh get /nodes/pve1/tasks --errors 1 --limit 20 --output-format json",
      {
        method: "GET",
        path: "/nodes/pve1/tasks",
        params: { errors: "1", limit: "20" },
        outputFormat: "json",
      },
    ],
    [
      "pvesh ls /nodes/",
      { method: "GET", path: "/nodes", params: {}, outputFormat: null },
    ],
    [
      `pvesh get /nodes/pve1/tasks/${UPID}/status`,
      {
        method: "GET",
        path: `/nodes/pve1/tasks/${UPID}/status`,
        params: {},
        outputFormat: null,
      },
    ],
    [
      "pvesh create /nodes/pve1/lxc/200/status/shutdown --timeout=30 --forceStop 0",
      {
        method: "POST",
        path: "/nodes/pve1/lxc/200/status/shutdown",
        params: { timeout: "30", forceStop: "0" },
        outputFormat: null,
      },
    ],
    [
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2 --online 1",
      {
        method: "POST",
        path: "/nodes/pve1/qemu/101/migrate",
        params: { target: "pve2", online: "1" },
        outputFormat: null,
      },
    ],
    [
      "pvesh create /nodes/pve1/services/corosync/restart --output-format json-pretty",
      {
        method: "POST",
        path: "/nodes/pve1/services/corosync/restart",
        params: {},
        outputFormat: "json-pretty",
      },
    ],
  ])("%p", (command: string, expected: unknown) => {
    expect(parse(command)).toEqual({ request: expected });
  });

  test("the argv with its program is what it reads", () => {
    expect(
      parseProxmoxCommand(["pvesh", "get", "/version"]).request,
    ).toBeDefined();
    expect(parseProxmoxCommand(["get", "/version"]).errorMessage).toContain(
      'starts with "pvesh"',
    );
  });

  test("a denied command gets the policy's reason and no request", () => {
    for (const command of [
      "pvesh get /access/users",
      "pvesh set /nodes/pve1/qemu/101/config --memory 1",
      "pvesh create /nodes/pve1/services/pveproxy/stop",
      "pvesh get /cluster/log --max 5 --max 6",
    ]) {
      const parsed: ProxmoxCommandParseResult = parse(command);

      expect(parsed.request).toBeUndefined();
      expect(parsed.errorMessage).toBe(evaluate(command).reason);
    }
  });

  test("builds a request exactly when the policy does not deny", () => {
    const commands: Array<string> = [
      ...READ_COMMANDS.map(([command]: [string, string]): string => {
        return command;
      }),
      "pvesh create /nodes/pve1/qemu/101/status/start",
      "pvesh create /nodes/pve1/qemu/101/status/reset",
      "pvesh create /nodes/pve1/lxc/200/status/reset",
      "pvesh create /nodes/pve1/services/pveproxy/restart",
      "pvesh create /nodes/pve1/services/pveproxy/stop",
      "pvesh create /nodes/pve1/qemu/101/migrate --target pve2",
      "pvesh get /access/users",
      "pvesh delete /pools/prod",
      "pvesh get /version --bogus 1",
    ];

    for (const command of commands) {
      const denied: boolean =
        evaluate(command).tier === ResourceCommandTier.Denied;
      const parsed: ProxmoxCommandParseResult = parse(command);

      expect(parsed.request === undefined).toBe(denied);
      expect(parsed.errorMessage === undefined).toBe(!denied);
    }
  });

  test("the method follows the command word, never the path", () => {
    expect(
      request("pvesh get /nodes/pve1/qemu/101/status/current").method,
    ).toBe("GET");
    expect(request("pvesh ls /nodes").method).toBe("GET");
    expect(
      request("pvesh create /nodes/pve1/qemu/101/status/stop").method,
    ).toBe("POST");
  });

  test("each call returns its own params object", () => {
    const first: ProxmoxApiRequest = request("pvesh get /cluster/log --max 5");

    first.params["max"] = "999999";

    expect(request("pvesh get /cluster/log --max 5").params).toEqual({
      max: "5",
    });
  });

  test("request segments never hold characters that break a URL", () => {
    for (const [command] of READ_COMMANDS) {
      for (const segment of request(command).path.slice(1).split("/")) {
        expect(segment).toMatch(/^[A-Za-z0-9._:@!-]+$/);
      }
    }
  });
});

describe("through the dispatcher", () => {
  function autoExecute(
    command: string,
    options: {
      allowlistPatterns?: Array<string>;
      bypassApproval?: boolean;
    } = {},
  ): ResourceAutoExecutionVerdict {
    return ResourceCommandPolicy.evaluateForAutoExecution({
      resourceType: AiResourceType.ProxmoxCluster,
      command,
      allowlistPatterns: options.allowlistPatterns || [],
      bypassApproval: options.bypassApproval === true,
    });
  }

  test("a read is AutoApproved (it changes nothing)", () => {
    const verdict: ResourceAutoExecutionVerdict = autoExecute(
      "pvesh get /cluster/status",
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.Read);
  });

  test("a SafeWrite is AutoApproved", () => {
    const verdict: ResourceAutoExecutionVerdict = autoExecute(
      "pvesh create /nodes/pve1/qemu/101/status/start",
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.SafeWrite);
  });

  test("a RiskyWrite needs approval", () => {
    const verdict: ResourceAutoExecutionVerdict = autoExecute(
      "pvesh create /nodes/pve1/qemu/101/status/stop",
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(verdict.requiresHuman).toBeUndefined();
  });

  test("a RiskyWrite runs when approvals are bypassed", () => {
    expect(
      autoExecute("pvesh create /nodes/pve1/qemu/101/status/stop", {
        bypassApproval: true,
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
  });

  test("a RiskyWrite runs when the allowlist names it", () => {
    const verdict: ResourceAutoExecutionVerdict = autoExecute(
      "pvesh create /nodes/pve1/services/pveproxy/restart",
      {
        allowlistPatterns: [
          "pvesh create /nodes/pve1/services/pveproxy/restart",
        ],
      },
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.reason).toBe("Matched the resource's command allowlist.");
  });

  test("the allowlist matches word by word, options included", () => {
    const patterns: Array<string> = [
      "pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout *",
    ];

    expect(
      autoExecute(
        "pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout 60",
        { allowlistPatterns: patterns },
      ).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    // Another spelling is another command to the allowlist.
    expect(
      autoExecute(
        "pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout=60",
        { allowlistPatterns: patterns },
      ).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
    // Another guest is another path.
    expect(
      autoExecute(
        "pvesh create /nodes/pve1/qemu/102/status/shutdown --timeout 60",
        { allowlistPatterns: patterns },
      ).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
  });

  test.each([
    ["pvesh create /nodes/pve1/qemu/101/migrate --target pve2"],
    ["pvesh create /nodes/pve1/services/corosync/restart"],
    ["pvesh create /nodes/pve1/services/pve-cluster/reload"],
  ])(
    "%p always asks a human: not bypass, not the allowlist",
    (command: string) => {
      for (const verdict of [
        autoExecute(command),
        autoExecute(command, { bypassApproval: true }),
        autoExecute(command, { allowlistPatterns: [command] }),
        autoExecute(command, {
          allowlistPatterns: [command],
          bypassApproval: true,
        }),
      ]) {
        expect(verdict.verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
        expect(verdict.requiresHuman).toBe(true);
      }
    },
  );

  test.each([
    ["pvesh get /access/users"],
    ["pvesh set /nodes/pve1/qemu/101/config --memory 1"],
    ["pvesh create /nodes/pve1/services/pveproxy/stop"],
  ])("%p is Denied whatever the settings", (command: string) => {
    const verdict: ResourceAutoExecutionVerdict = autoExecute(command, {
      allowlistPatterns: [command],
      bypassApproval: true,
    });

    expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
    expect(verdict.reason).toContain("cannot run even with human approval");
  });

  describe("matchesAllowlist", () => {
    function matches(command: string, patterns: Array<string>): boolean {
      return ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.ProxmoxCluster,
        command,
        patterns,
      });
    }

    test("an exact entry matches", () => {
      expect(
        matches("pvesh create /nodes/pve1/qemu/101/status/stop", [
          "pvesh create /nodes/pve1/qemu/101/status/stop",
        ]),
      ).toBe(true);
    });

    test("a * is one whole word, never part of a path", () => {
      expect(
        matches("pvesh create /nodes/pve1/qemu/101/status/stop", [
          "pvesh create /nodes/*/qemu/*/status/stop",
        ]),
      ).toBe(false);
      expect(
        matches(
          "pvesh create /nodes/pve1/qemu/101/status/stop --output-format json",
          [
            "pvesh create /nodes/pve1/qemu/101/status/stop --output-format json",
          ],
        ),
      ).toBe(true);
      expect(
        matches(
          "pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout 30",
          ["pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout *"],
        ),
      ).toBe(true);
    });

    test("an entry for a read or a denied command never matches", () => {
      expect(matches("pvesh get /version", ["pvesh get /version"])).toBe(false);
      expect(
        matches("pvesh create /nodes/pve1/services/pveproxy/stop", [
          "pvesh create /nodes/pve1/services/pveproxy/stop",
        ]),
      ).toBe(false);
    });
  });

  describe("describeAllowlistPatternProblem", () => {
    function problem(pattern: string): string | null {
      return ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.ProxmoxCluster,
        pattern,
      });
    }

    test.each([
      ["pvesh create /nodes/pve1/qemu/101/status/stop"],
      ["pvesh create /nodes/pve1/qemu/101/status/shutdown --timeout *"],
      ["pvesh create /nodes/pve1/services/pveproxy/restart"],
      ["pvesh create /nodes/pve1/qemu/101/status/start"],
      ["pvesh create /nodes/pve1/qemu/101/migrate --target *"],
    ])("%p is valid", (pattern: string) => {
      expect(problem(pattern)).toBeNull();
    });

    test("a read pre-approves nothing", () => {
      expect(problem("pvesh get /cluster/status")).toContain(
        "is a read-only command",
      );
      expect(problem("pvesh get /cluster/log --max *")).toContain(
        "is a read-only command",
      );
    });

    test("a * standing for an option with a closed set of values never runs", () => {
      // No stand-in for the * is one of the option's values.
      expect(problem("pvesh get /cluster/resources --type *")).toContain(
        "can never match a command that runs",
      );
      expect(
        problem(
          "pvesh create /nodes/pve1/qemu/101/status/stop --output-format *",
        ),
      ).toContain("can never match a command that runs");
    });

    test.each([
      ["pvesh create *", "can never match a command that runs"],
      [
        "pvesh set /nodes/pve1/qemu/101/config",
        "pvesh set changes configuration",
      ],
      [
        "pvesh create /nodes/pve1/services/pveproxy/stop",
        "stopping a node service",
      ],
      ["pvesh get /access/users", "everything under /access"],
      [
        "pvesh * /nodes/pve1/qemu/101/status/stop",
        "has a * where the command goes",
      ],
      ["pvesh create", "fewer than two words"],
      [
        "qm stop 101",
        "does not start with a program the Proxmox AI agent runs",
      ],
    ])("%p is refused", (pattern: string, mentions: string) => {
      expect(problem(pattern)).toContain(mentions);
    });
  });

  describe("isBroadAllowlistPattern", () => {
    function broad(pattern: string): boolean {
      return ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType: AiResourceType.ProxmoxCluster,
        pattern,
      });
    }

    test("an entry with no * is never broad", () => {
      expect(broad("pvesh create /nodes/pve1/qemu/101/status/stop")).toBe(
        false,
      );
      expect(broad("pvesh create /nodes/pve1/services/pveproxy/restart")).toBe(
        false,
      );
    });

    test("an invalid entry is never broad", () => {
      expect(broad("pvesh get /cluster/resources --type *")).toBe(false);
      expect(broad("pvesh create *")).toBe(false);
    });
  });

  describe("getWriteScopeRefusal", () => {
    function refusal(
      command: string,
      posture: {
        allowWrites?: boolean;
        writeTargets?: Array<string>;
        protectedTargets?: Array<string>;
      } = {},
    ): string | null {
      return ResourceCommandPolicy.getWriteScopeRefusal({
        result: evaluate(command),
        allowWrites: posture.allowWrites ?? true,
        writeTargets: posture.writeTargets ?? [],
        protectedTargets: posture.protectedTargets ?? [],
        resourceType: AiResourceType.ProxmoxCluster,
      });
    }

    test("a read is never refused, even by a read-only agent", () => {
      expect(
        refusal("pvesh get /cluster/status", {
          allowWrites: false,
          writeTargets: ["999"],
        }),
      ).toBeNull();
    });

    test("a read-only agent refuses every write, naming the setting", () => {
      const text: string | null = refusal(
        "pvesh create /nodes/pve1/qemu/101/status/start",
        { allowWrites: false },
      );

      expect(text).toContain("Proxmox AI agent");
      expect(text).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
    });

    test("a denied command is refused", () => {
      expect(refusal("pvesh get /access/users")).toContain(
        "is denied by the command policy",
      );
    });

    test("a write inside the scope runs", () => {
      expect(
        refusal("pvesh create /nodes/pve1/qemu/101/status/start", {
          writeTargets: ["1*"],
        }),
      ).toBeNull();
      expect(
        refusal("pvesh create /nodes/pve1/services/pveproxy/restart", {
          writeTargets: ["pve1/*"],
        }),
      ).toBeNull();
      expect(
        refusal("pvesh create /nodes/pve2/qemu/101/migrate --target pve3", {
          writeTargets: ["101"],
        }),
      ).toBeNull();
    });

    test("a write outside the scope is refused", () => {
      expect(
        refusal("pvesh create /nodes/pve1/qemu/205/status/stop", {
          writeTargets: ["1*"],
        }),
      ).toContain("would change 205, which is outside the targets");
      expect(
        refusal("pvesh create /nodes/pve2/services/pveproxy/restart", {
          writeTargets: ["pve1/*"],
        }),
      ).toContain("would change pve2/pveproxy");
    });

    test("the target is the VMID on whichever node the guest runs", () => {
      for (const node of ["pve1", "pve2", "pve3.lab"]) {
        expect(
          refusal(`pvesh create /nodes/${node}/qemu/105/status/stop`, {
            protectedTargets: ["105"],
          }),
        ).toContain("which the Proxmox AI agent protects (105)");
      }
    });

    test("a protected node service is never changed", () => {
      expect(
        refusal("pvesh create /nodes/pve1/services/pveproxy/restart", {
          protectedTargets: ["pve1/pveproxy"],
        }),
      ).toContain("which the Proxmox AI agent protects");
      expect(
        refusal("pvesh create /nodes/PVE1/services/pveproxy/restart", {
          protectedTargets: ["pve1/*"],
        }),
      ).toContain("which the Proxmox AI agent protects");
    });

    test("migrating a protected guest is refused", () => {
      expect(
        refusal("pvesh create /nodes/pve1/lxc/200/migrate --target pve2", {
          protectedTargets: ["200"],
        }),
      ).toContain("protects (200)");
    });
  });
});

describe("the guides", () => {
  test("the read guide names every readable path family", () => {
    const guide: string = ProxmoxCommandPolicy.readCommandGuide;

    for (const fragment of [
      "pvesh get",
      "pvesh ls",
      "--output-format json|json-pretty|text",
      "/version",
      "/cluster/status",
      "/cluster/resources [--type vm|storage|node|sdn]",
      "/cluster/ha/status/current",
      "/cluster/ha/resources",
      "/cluster/log [--max N]",
      "/cluster/tasks",
      "/cluster/replication",
      "/cluster/backup",
      "/pools",
      "/storage",
      "/nodes/{node}/status",
      "/services/{service}/state",
      "/storage/{storage}/status",
      "/disks/smart --disk /dev/sda",
      "/rrddata --timeframe hour|day|week",
      "/nodes/{node}/tasks [--errors 1]",
      "/nodes/{node}/tasks/{upid}/log",
      "/nodes/{node}/syslog",
      "/nodes/{node}/journal [--lastentries N]",
      "/nodes/{node}/{type}/{vmid}/status/current",
      "/config [--current 1]",
      "/pending",
      "/snapshot",
      "agent/info|get-osinfo|get-fsinfo|network-get-interfaces|get-host-name|get-time",
      "/access",
    ]) {
      expect(guide).toContain(fragment);
    }
  });

  test("the write guide names every write and its tier", () => {
    const guide: string = ProxmoxCommandPolicy.writeCommandGuide;

    for (const fragment of [
      "pvesh create",
      "Safe (runs unattended in Automatic mode)",
      "/status/start",
      "/status/resume",
      "/status/reboot",
      "Riskier",
      "/status/shutdown [--timeout N] [--forceStop 0]",
      "/status/stop",
      "/status/suspend",
      "/nodes/{node}/qemu/{vmid}/status/reset",
      "/nodes/{node}/services/{service}/start|restart|reload",
      "Always asks a human",
      "/migrate --target {othernode}",
      "corosync or pve-cluster",
      "never localhost",
      "Never",
    ]) {
      expect(guide).toContain(fragment);
    }

    for (const service of PROXMOX_RESTARTABLE_SERVICES) {
      expect(guide).toContain(service);
    }
  });

  test("the guides are compact markdown bullets", () => {
    for (const guide of [
      ProxmoxCommandPolicy.readCommandGuide,
      ProxmoxCommandPolicy.writeCommandGuide,
    ]) {
      for (const line of guide.split("\n")) {
        expect(line.startsWith("- ")).toBe(true);
      }

      expect(guide.length).toBeLessThan(2500);
    }
  });

  test("the readable-path summary names every read route's last segment", () => {
    for (const [command] of READ_COMMANDS) {
      const path: string = request(command).path;
      const last: string = path.slice(path.lastIndexOf("/") + 1);

      if (
        DIGITS_ONLY.test(last) ||
        last.startsWith("pve") ||
        last === "localhost"
      ) {
        continue;
      }

      expect(PROXMOX_READABLE_PATHS_SUMMARY).toContain(last);
    }
  });
});

describe("redaction of pvesh output", () => {
  function redact(text: string): string {
    return redactResourceCommandOutput({
      resourceType: AiResourceType.ProxmoxCluster,
      program: "pvesh",
      text,
    });
  }

  test("a VM config's cloud-init password and other secrets", () => {
    const config: string = JSON.stringify(
      {
        cores: 2,
        memory: "4096",
        ciuser: "ubuntu",
        cipassword: "$5$abcdefgh$Zq0r7Qm8vYl3nWb4kE1uXo9pTzAa5sDdFfGgHhJjKk2",
        net0: "virtio=BC:24:11:AA:BB:CC,bridge=vmbr0",
        description: "db host; admin password=Hunter2Hunter2",
        name: "db-1",
      },
      null,
      2,
    );
    const redacted: string = redact(config);

    expect(redacted).not.toContain(
      "Zq0r7Qm8vYl3nWb4kE1uXo9pTzAa5sDdFfGgHhJjKk2",
    );
    expect(redacted).not.toContain("Hunter2Hunter2");
    expect(redacted).toContain(`"cipassword": "${RESOURCE_REDACTED_MARKER}"`);
    expect(redacted).toContain('"ciuser": "ubuntu"');
    expect(redacted).toContain('"name": "db-1"');
    expect(redacted).toContain("virtio=BC:24:11:AA:BB:CC,bridge=vmbr0");
  });

  test("compact JSON too", () => {
    expect(redact('{"cipassword":"s3cr3t-value","cores":4}')).toBe(
      `{"cipassword":"${RESOURCE_REDACTED_MARKER}","cores":4}`,
    );
  });

  /*
   * Pinned for the agent's executor: the API wraps every answer as
   * {"data": ...}, and the generic rules read a "data" object as a
   * Kubernetes Secret's data and mask all of it. The agent prints the data
   * member, never the envelope.
   */
  test("a {data: ...} envelope would be masked whole", () => {
    expect(redact('{"data":{"cores":4,"name":"db-1"}}')).not.toContain("db-1");
    expect(redact('{"cores":4,"name":"db-1"}')).toBe(
      '{"cores":4,"name":"db-1"}',
    );
  });

  test.each([
    [
      '[{"key":"cipassword","value":"old-hash-value","pending":"new-hash-value"},{"key":"cores","value":2,"pending":4}]',
    ],
    [
      '[{"pending":"new-hash-value","value":"old-hash-value","key":"cipassword"}]',
    ],
    [
      '[\n  {\n    "value": "old-hash-value",\n    "key": "cipassword",\n    "pending": "new-hash-value"\n  }\n]',
    ],
    [
      '[{"key":"password","value":"old-hash-value","pending":"new-hash-value"}]',
    ],
  ])("a /pending entry %p", (text: string) => {
    const redacted: string = redact(text);

    expect(redacted).not.toContain("old-hash-value");
    expect(redacted).not.toContain("new-hash-value");
  });

  test("a /pending entry for an ordinary key is untouched", () => {
    const text: string =
      '[{"key":"cores","value":2,"pending":4},{"key":"name","value":"db-1"}]';

    expect(redact(text)).toBe(text);
  });

  test("the cluster storage list's keyring, password and encryption key", () => {
    const storage: string = JSON.stringify([
      {
        storage: "ceph-rbd",
        type: "rbd",
        keyring: "/etc/pve/priv/ceph/ceph-rbd.keyring-secret-path",
        monhost: "10.0.0.1",
      },
      {
        storage: "pbs",
        type: "pbs",
        password: "pbs-password-value",
        "encryption-key": "pbs-encryption-key-value",
        fingerprint: "aa:bb:cc",
      },
    ]);
    const redacted: string = redact(storage);

    expect(redacted).not.toContain("keyring-secret-path");
    expect(redacted).not.toContain("pbs-password-value");
    expect(redacted).not.toContain("pbs-encryption-key-value");
    expect(redacted).toContain('"monhost":"10.0.0.1"');
    expect(redacted).toContain('"fingerprint":"aa:bb:cc"');
  });

  test("JSON escaped inside another JSON string", () => {
    const redacted: string = redact(
      '{"log":"{\\"keyring\\":\\"escaped-keyring-value\\",\\"cores\\":2}"}',
    );

    expect(redacted).not.toContain("escaped-keyring-value");
    expect(redacted).toContain('\\"cores\\":2');
  });

  test.each([
    ["cipassword: hashed-password-value", "cipassword: "],
    ["keyring: /etc/pve/priv/ceph/secret-keyring-path", "keyring: "],
    ["encryption-key = encryption-key-value", "encryption-key = "],
    ["  password   plain-password-value", "  password   "],
    ["- keyring: list-keyring-value", "- keyring: "],
  ])("the text line %p", (line: string, kept: string) => {
    const redacted: string = redact(`cores: 2\n${line}\nname: db-1`);

    expect(redacted).toContain(`${kept}${RESOURCE_REDACTED_MARKER}`);
    expect(redacted).toContain("cores: 2");
    expect(redacted).toContain("name: db-1");
  });

  test("pvesh's text table", () => {
    const table: string = [
      "┌────────────┬──────────────────────┐",
      "│ key        │ value                │",
      "╞════════════╪══════════════════════╡",
      "│ cipassword │ table-password-value │",
      "├────────────┼──────────────────────┤",
      "│ cores      │ 2                    │",
      "└────────────┴──────────────────────┘",
    ].join("\n");
    const redacted: string = redact(table);

    expect(redacted).not.toContain("table-password-value");
    expect(redacted).toContain(`│ cipassword │ ${RESOURCE_REDACTED_MARKER} │`);
    expect(redacted).toContain("│ key        │ value                │");
    expect(redacted).toContain("│ cores      │ 2                    │");
  });

  test("a pending table masks every column of the secret's row", () => {
    const redacted: string = redact(
      "| key | value | pending |\n| cipassword | old-cell | new-cell |\n| cores | 2 | 4 |",
    );

    expect(redacted).not.toContain("old-cell");
    expect(redacted).not.toContain("new-cell");
    expect(redacted).toContain("| cores | 2 | 4 |");
    expect(redacted).toContain("| key | value | pending |");
  });

  test("counts what it masks", () => {
    expect(
      redactResourceCommandOutputWithCount({
        resourceType: AiResourceType.ProxmoxCluster,
        program: "pvesh",
        text: '{"cipassword":"a-secret","keyring":"b-secret","cores":2}',
      }).redactionCount,
    ).toBeGreaterThanOrEqual(2);
  });

  test("an already-masked or empty value is left as it is", () => {
    expect(redact('{"cipassword":"[redacted]"}')).toBe(
      '{"cipassword":"[redacted]"}',
    );
    expect(redact('{"keyring":""}')).toBe('{"keyring":""}');
  });

  test("ordinary Proxmox output passes through unchanged", () => {
    const outputs: Array<string> = [
      JSON.stringify([
        { node: "pve1", status: "online", cpu: 0.03, maxmem: 67430035456 },
      ]),
      JSON.stringify({
        version: "8.2.4",
        release: "8.2",
        repoid: "faa83925c9641325",
      }),
      "Jan 31 14:05:01 pve1 pveproxy[1234]: worker 5678 started",
      `${UPID}\nTASK OK`,
      "HEALTH_OK",
    ];

    for (const text of outputs) {
      expect(redact(text)).toBe(text);
    }
  });

  test("the hook runs only for pvesh", () => {
    expect(
      redactResourceCommandOutput({
        resourceType: AiResourceType.DockerHost,
        program: "docker",
        text: "keyring: docker-keyring-value",
      }),
    ).toContain("docker-keyring-value");
  });
});
