import CephCommandPolicy, {
  CEPH_CLUSTER_TARGET,
  CEPH_COMMANDS,
  CEPH_CRASH_TARGET_PREFIX,
  CEPH_OSD_FLAGS,
  CEPH_OUTPUT_FORMATS,
} from "../../../../Utils/AiRemediation/Resource/CephCommandPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  ResourceTokenizeResult,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  ResourceOutputRedaction,
  ResourceOutputRedactionHook,
  getResourceOutputRedactionHooks,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the ceph command policy (CephCommandPolicy), the
 * tool policy the dispatcher hands every command for a Ceph cluster.
 *
 * - Grammar: an allowlist of exact command words with validated arguments
 *   (OSD ids 3 / osd.3, pool names, PG ids, daemon names, crash ids); every
 *   Read command, every SafeWrite, RiskyWrite and requiresHuman change, and
 *   Denied for everything else, with a reason that says what may run.
 * - Options, read the way ceph's argparse reads them: only --format /
 *   --format= / -f with json|json-pretty|plain (once, anywhere), -s alone,
 *   and orch ps's named arguments after "orch ps". Every other
 *   dash-prefixed word is Denied, so abbreviations, combined short options,
 *   configuration overrides, `--` and flags after positionals never hide.
 * - Targets are canonical (osd.N, daemon names, pools, PG ids,
 *   crash/<id>, "cluster") and the displayCommand round-trips.
 * - Total: nothing it is given makes it throw.
 * - Dispatcher integration for AiResourceType.CephCluster: evaluateCommand,
 *   evaluateForAutoExecution, matchesAllowlist,
 *   describeAllowlistPatternProblem, isBroadAllowlistPattern,
 *   getWriteScopeRefusal and the command guides.
 * - The ceph output redaction hooks: keyring keys, bare cephx secrets and
 *   audit-log config values.
 */

const CEPH: AiResourceType = AiResourceType.CephCluster;

const CRASH_ID: string =
  "2024-05-21T10:15:42.123456Z_0c7d3c6e-1b2a-4c3d-9e8f-0123456789ab";

const NAUTILUS_CRASH_ID: string =
  "2019-07-09_17:42:37.469390Z_0c7d3c6e-1b2a-4c3d-9e8f-0123456789ab";

const CEPHX_SECRET: string = "AQBv5pRkAAAAABAAIbnP0fYNy9LQYUcxJXAtdA==";

function evaluate(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: CEPH,
    command,
  });
}

function argvOf(command: string): Array<string> {
  const tokenized: ResourceTokenizeResult = tokenizeResourceCommand(command);

  if (!tokenized.argv) {
    throw new Error(`test command does not tokenize: ${command}`);
  }

  return tokenized.argv;
}

function expectDenied(
  result: ResourceCommandPolicyResult,
  reasonPart: string,
): void {
  expect(result.tier).toBe(ResourceCommandTier.Denied);
  expect(result.targets).toEqual([]);
  expect(result.requiresHuman).toBeUndefined();
  expect(result.reason).toContain(reasonPart);
}

function expectRoundTrip(
  command: string,
  result: ResourceCommandPolicyResult,
): void {
  const argv: Array<string> = argvOf(command);

  expect(result.program).toBe("ceph");
  expect(result.args).toEqual(argv.slice(1));
  expect(tokenizeResourceCommand(result.displayCommand).argv).toEqual(argv);
}

// ---- Module shape -------------------------------------------------------------

describe("the ceph tool policy", () => {
  test("is named ceph, runs only the ceph program and is what the dispatcher uses", () => {
    expect(CephCommandPolicy.name).toBe("ceph");
    expect([...CephCommandPolicy.programs]).toEqual(["ceph"]);
    expect([...CephCommandPolicy.programs]).toEqual([
      ...AI_RESOURCE_TYPE_INFO[CEPH].programs,
    ]);
    expect(ResourceCommandPolicy.getToolPolicy(CEPH)).toBe(CephCommandPolicy);
  });

  test("is no longer the fail-closed stub", () => {
    expect(CephCommandPolicy.evaluateArgv(["ceph"]).reason).not.toContain(
      "not implemented yet",
    );
    expect(CephCommandPolicy.readCommandGuide).not.toContain("Unavailable");
    expect(CephCommandPolicy.writeCommandGuide).not.toContain("Unavailable");
  });

  test("pins the exported vocabularies", () => {
    expect(CEPH_CLUSTER_TARGET).toBe("cluster");
    expect(CEPH_CRASH_TARGET_PREFIX).toBe("crash/");
    expect([...CEPH_OUTPUT_FORMATS]).toEqual(["json", "json-pretty", "plain"]);
    expect([...CEPH_OSD_FLAGS]).toEqual([
      "noout",
      "norebalance",
      "nobackfill",
      "norecover",
      "noscrub",
      "nodeep-scrub",
      "pause",
    ]);
  });

  test("no command's words are a prefix of another's", () => {
    for (const left of CEPH_COMMANDS) {
      for (const right of CEPH_COMMANDS) {
        if (left !== right) {
          expect(right.startsWith(`${left} `)).toBe(false);
        }
      }
    }

    expect(new Set<string>(CEPH_COMMANDS).size).toBe(CEPH_COMMANDS.length);
  });
});

// ---- Reads --------------------------------------------------------------------

const READ_COMMANDS: Array<[string, string]> = [
  ["ceph status", "status"],
  ["ceph -s", "status"],
  ["ceph health", "health"],
  ["ceph health detail", "health"],
  ["ceph df", "df"],
  ["ceph df detail", "df"],
  ["ceph versions", "versions"],
  ["ceph version", "version"],
  ["ceph progress", "progress"],
  ["ceph quorum_status", "quorum_status"],
  ["ceph log last", "log last"],
  ["ceph log last 100", "log last"],
  ["ceph log last 1000 warn", "log last"],
  ["ceph log last 50 error cluster", "log last"],
  ["ceph log last warn audit", "log last"],
  ["ceph log last cephadm", "log last"],
  ["ceph log last 20 debug '*'", "log last"],
  ["ceph log last 1 sec", "log last"],
  ["ceph log last info", "log last"],
  ["ceph osd tree", "osd tree"],
  ["ceph osd tree down", "osd tree"],
  ["ceph osd tree up in", "osd tree"],
  ["ceph osd tree out destroyed", "osd tree"],
  ["ceph osd df", "osd df"],
  ["ceph osd df tree", "osd df"],
  ["ceph osd perf", "osd perf"],
  ["ceph osd stat", "osd stat"],
  ["ceph osd dump", "osd dump"],
  ["ceph osd blocked-by", "osd blocked-by"],
  ["ceph osd find 3", "osd find"],
  ["ceph osd find osd.12", "osd find"],
  ["ceph osd metadata", "osd metadata"],
  ["ceph osd metadata 0", "osd metadata"],
  ["ceph osd metadata osd.7", "osd metadata"],
  ["ceph osd ok-to-stop 3", "osd ok-to-stop"],
  ["ceph osd ok-to-stop 3 4 osd.5", "osd ok-to-stop"],
  ["ceph osd safe-to-destroy osd.9", "osd safe-to-destroy"],
  ["ceph osd safe-to-destroy 1 2", "osd safe-to-destroy"],
  ["ceph osd pool ls", "osd pool ls"],
  ["ceph osd pool ls detail", "osd pool ls"],
  ["ceph osd pool stats", "osd pool stats"],
  ["ceph osd pool stats rbd", "osd pool stats"],
  ["ceph osd pool stats .mgr", "osd pool stats"],
  ["ceph osd pool get rbd size", "osd pool get"],
  ["ceph osd pool get rbd all", "osd pool get"],
  ["ceph osd pool get .rgw.root pg_num", "osd pool get"],
  ["ceph osd pool get cephfs_data nodeep-scrub", "osd pool get"],
  ["ceph pg stat", "pg stat"],
  ["ceph pg dump_stuck", "pg dump_stuck"],
  ["ceph pg dump_stuck inactive", "pg dump_stuck"],
  ["ceph pg dump_stuck unclean stale undersized degraded", "pg dump_stuck"],
  ["ceph pg dump_stuck stale 300", "pg dump_stuck"],
  ["ceph pg dump_stuck 60", "pg dump_stuck"],
  ["ceph pg 1.2f query", "pg query"],
  ["ceph pg 0.0 query", "pg query"],
  ["ceph pg 12.a3 list_unfound", "pg list_unfound"],
  ["ceph pg ls-by-osd 3", "pg ls-by-osd"],
  ["ceph pg ls-by-osd osd.3", "pg ls-by-osd"],
  ["ceph pg ls-by-pool rbd", "pg ls-by-pool"],
  ["ceph pg ls-by-primary osd.0", "pg ls-by-primary"],
  ["ceph mon stat", "mon stat"],
  ["ceph mon dump", "mon dump"],
  ["ceph mgr stat", "mgr stat"],
  ["ceph mgr services", "mgr services"],
  ["ceph mgr module ls", "mgr module ls"],
  ["ceph fs status", "fs status"],
  ["ceph fs status cephfs", "fs status"],
  ["ceph fs ls", "fs ls"],
  ["ceph mds stat", "mds stat"],
  ["ceph balancer status", "balancer status"],
  ["ceph crash ls", "crash ls"],
  ["ceph crash ls-new", "crash ls-new"],
  ["ceph crash stat", "crash stat"],
  [`ceph crash info ${CRASH_ID}`, "crash info"],
  [`ceph crash info ${NAUTILUS_CRASH_ID}`, "crash info"],
  ["ceph orch ps", "orch ps"],
  ["ceph orch ps --daemon_type osd", "orch ps"],
  ["ceph orch ps --daemon-type node-exporter", "orch ps"],
  ["ceph orch ps --service_name osd.all-available-devices", "orch ps"],
  ["ceph orch ps --service-name rgw.store --refresh", "orch ps"],
  ["ceph orch ps --refresh --daemon_type mon --service_name mon", "orch ps"],
  ["ceph orch ls", "orch ls"],
  ["ceph orch host ls", "orch host ls"],
  ["ceph orch device ls", "orch device ls"],
];

describe("Read commands", () => {
  test.each(READ_COMMANDS)(
    "%s is Read (%s)",
    (command: string, verb: string) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.Read);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual([]);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.reason.length).toBeGreaterThan(0);
      expectRoundTrip(command, result);
      expect(
        ResourceCommandPolicy.isReadOnly({ resourceType: CEPH, command }),
      ).toBe(true);
    },
  );

  test("every Test connection command is a read", () => {
    for (const command of AI_RESOURCE_TYPE_INFO[CEPH].testCommands) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.Read);
    }
  });

  test.each([
    ["ceph status --format json", "status"],
    ["ceph status --format=json-pretty", "status"],
    ["ceph status -f plain", "status"],
    ["ceph --format json status", "status"],
    ["ceph -f json-pretty osd tree", "osd tree"],
    ["ceph osd -f json tree", "osd tree"],
    ["ceph osd tree down -f json", "osd tree"],
    ["ceph -s --format json", "status"],
    ["ceph --format=plain -s", "status"],
    ["ceph orch ps --daemon_type osd -f json", "orch ps"],
    ["ceph orch ps -f json --daemon_type osd", "orch ps"],
    ["ceph orch ps --daemon_type -f json osd", "orch ps"],
    ["ceph pg 1.2f query --format json", "pg query"],
    ["ceph log last 10 --format=json", "log last"],
    ["ceph health detail -f json-pretty", "health"],
  ])(
    "%s: the output format is read wherever argparse reads it",
    (command: string, verb: string) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.Read);
      expect(result.verb).toBe(verb);
      expectRoundTrip(command, result);
    },
  );

  test("the log channel * is kept as one quoted word", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      "ceph log last 20 warn '*'",
    );

    expect(result.args).toEqual(["log", "last", "20", "warn", "*"]);
    expect(result.displayCommand).toBe("ceph log last 20 warn '*'");
  });

  test("a pool name may be 128 characters long, not 129", () => {
    const longest: string = `p${"o".repeat(127)}`;

    expect(evaluate(`ceph osd pool stats ${longest}`).tier).toBe(
      ResourceCommandTier.Read,
    );
    expectDenied(
      evaluate(`ceph osd pool stats ${longest}o`),
      "is not a pool name",
    );
  });

  test("ok-to-stop may name 32 OSDs, not 33", () => {
    const ids: Array<string> = Array.from(
      { length: 33 },
      (_value: unknown, index: number): string => {
        return String(index);
      },
    );

    expect(
      evaluate(`ceph osd ok-to-stop ${ids.slice(0, 32).join(" ")}`).tier,
    ).toBe(ResourceCommandTier.Read);
    expectDenied(
      evaluate(`ceph osd ok-to-stop ${ids.join(" ")}`),
      "at most 32 OSDs",
    );
  });
});

// ---- Writes -------------------------------------------------------------------

const SAFE_WRITES: Array<[string, string, Array<string>]> = [
  ["ceph osd in 3", "osd in", ["osd.3"]],
  ["ceph osd in osd.12", "osd in", ["osd.12"]],
  ["ceph osd in 0", "osd in", ["osd.0"]],
  ["ceph osd in 3 --format json", "osd in", ["osd.3"]],
  ...CEPH_OSD_FLAGS.map((flag: string): [string, string, Array<string>] => {
    return [`ceph osd unset ${flag}`, "osd unset", ["cluster"]];
  }),
  [`ceph crash archive ${CRASH_ID}`, "crash archive", [`crash/${CRASH_ID}`]],
  ["ceph orch daemon restart osd.3", "orch daemon restart", ["osd.3"]],
  ["ceph orch daemon restart mon.host1", "orch daemon restart", ["mon.host1"]],
  [
    "ceph orch daemon restart rgw.store.host1.abcdef",
    "orch daemon restart",
    ["rgw.store.host1.abcdef"],
  ],
  [
    "ceph orch daemon restart node-exporter.host1",
    "orch daemon restart",
    ["node-exporter.host1"],
  ],
  ["ceph pg scrub 1.2f", "pg scrub", ["1.2f"]],
  ["ceph pg deep-scrub 3.0", "pg deep-scrub", ["3.0"]],
  ["ceph pg deep-scrub 10.ffffffff", "pg deep-scrub", ["10.ffffffff"]],
];

const RISKY_WRITES: Array<[string, string, Array<string>]> = [
  ["ceph osd out 3", "osd out", ["osd.3"]],
  ["ceph osd out osd.3", "osd out", ["osd.3"]],
  ["ceph osd down 7", "osd down", ["osd.7"]],
  ["ceph osd down osd.7", "osd down", ["osd.7"]],
  ...CEPH_OSD_FLAGS.filter((flag: string): boolean => {
    return flag !== "pause";
  }).map((flag: string): [string, string, Array<string>] => {
    return [`ceph osd set ${flag}`, "osd set", ["cluster"]];
  }),
  ["ceph osd reweight 3 0.85", "osd reweight", ["osd.3"]],
  ["ceph osd reweight osd.3 0", "osd reweight", ["osd.3"]],
  ["ceph osd reweight 3 1", "osd reweight", ["osd.3"]],
  ["ceph osd reweight 3 1.0", "osd reweight", ["osd.3"]],
  ["ceph osd reweight 3 0.0001", "osd reweight", ["osd.3"]],
  ["ceph pg repair 1.2f", "pg repair", ["1.2f"]],
  ["ceph mgr fail", "mgr fail", ["cluster"]],
  ["ceph mgr fail host1.abcdef", "mgr fail", ["mgr.host1.abcdef"]],
  ["ceph orch daemon stop osd.3", "orch daemon stop", ["osd.3"]],
  [
    "ceph orch daemon start mds.cephfs.host1.xyz",
    "orch daemon start",
    ["mds.cephfs.host1.xyz"],
  ],
  ["ceph orch restart mgr", "orch restart", ["mgr"]],
  [
    "ceph orch restart osd.all-available-devices",
    "orch restart",
    ["osd.all-available-devices"],
  ],
  ["ceph orch restart rgw.store", "orch restart", ["rgw.store"]],
  ["ceph crash archive-all", "crash archive-all", ["cluster"]],
  ["ceph balancer on", "balancer on", ["cluster"]],
  ["ceph balancer off", "balancer off", ["cluster"]],
];

const ALWAYS_HUMAN_WRITES: Array<[string, string, Array<string>]> = [
  ["ceph osd set pause", "osd set", ["cluster"]],
  ["ceph osd pool set rbd size 3", "osd pool set", ["rbd"]],
  ["ceph osd pool set rbd min_size 2", "osd pool set", ["rbd"]],
  ["ceph osd pool set .mgr size 1", "osd pool set", [".mgr"]],
  ["ceph osd pool set rbd size 10", "osd pool set", ["rbd"]],
];

describe("SafeWrite: a reversible change to one named object", () => {
  test.each(SAFE_WRITES)(
    "%s is SafeWrite (%s)",
    (command: string, verb: string, targets: Array<string>) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual(targets);
      expect(result.requiresHuman).toBeUndefined();
      expectRoundTrip(command, result);
      expect(
        ResourceCommandPolicy.isReadOnly({ resourceType: CEPH, command }),
      ).toBe(false);
    },
  );
});

describe("RiskyWrite: a human, the allowlist or Bypass approval decides", () => {
  test.each(RISKY_WRITES)(
    "%s is RiskyWrite (%s)",
    (command: string, verb: string, targets: Array<string>) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual(targets);
      expect(result.requiresHuman).toBeUndefined();
      expectRoundTrip(command, result);
    },
  );
});

describe("requiresHuman: never unattended", () => {
  test.each(ALWAYS_HUMAN_WRITES)(
    "%s is RiskyWrite that always asks a human (%s)",
    (command: string, verb: string, targets: Array<string>) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual(targets);
      expect(result.requiresHuman).toBe(true);
      expectRoundTrip(command, result);
    },
  );

  test("the reasons say what the change does and how to undo it", () => {
    expect(evaluate("ceph osd out 3").reason).toContain("undo: ceph osd in 3");
    expect(evaluate("ceph osd in osd.3").reason).toContain(
      "undo: ceph osd out osd.3",
    );
    expect(evaluate("ceph osd set noout").reason).toContain(
      "undo: ceph osd unset noout",
    );
    expect(evaluate("ceph osd unset noout").reason).toContain(
      "undo: ceph osd set noout",
    );
    expect(evaluate("ceph balancer on").reason).toContain(
      "undo: ceph balancer off",
    );
    expect(evaluate("ceph orch daemon stop osd.3").reason).toContain(
      "undo: ceph orch daemon start osd.3",
    );
    expect(evaluate("ceph osd set pause").reason).toContain(
      "every client read and write is stopped",
    );
    expect(evaluate("ceph osd pool set rbd size 2").reason).toContain(
      "replica count",
    );
  });
});

// ---- Denied families ------------------------------------------------------------

describe("Denied: commands that never run", () => {
  test.each([
    ["ceph osd purge 3", "deletes an OSD"],
    ["ceph osd purge-new 3", "deletes an OSD"],
    ["ceph osd destroy 3", "destroys an OSD"],
    ["ceph osd rm 3", "removes an OSD"],
    ["ceph osd lost 3", "give up"],
    ["ceph osd new 0c7d3c6e-1b2a-4c3d-9e8f-0123456789ab", "adds an OSD"],
    ["ceph osd create", "adds an OSD"],
    ["ceph osd crush reweight osd.3 0.5", "CRUSH"],
    ["ceph osd crush rm osd.3", "CRUSH"],
    ["ceph osd crush move host1 root=default", "CRUSH"],
    ["ceph osd setcrushmap", "CRUSH"],
    ["ceph osd getcrushmap", "CRUSH"],
    ["ceph osd pool delete rbd rbd", "deletes a pool"],
    ["ceph osd pool rm rbd", "deletes a pool"],
    ["ceph osd pool rename rbd rbd2", "renames a pool"],
    ["ceph osd pool create newpool 32", "creates a pool"],
    ["ceph osd pool set rbd pg_num 64", "only size and min_size"],
    ["ceph osd pool set rbd nodelete false", "only size and min_size"],
    ["ceph osd pool set rbd crush_rule fast", "only size and min_size"],
    ["ceph osd pool set-quota rbd max_bytes 0", "quota"],
    ["ceph osd pool application enable rbd rbd", "applications"],
    ["ceph osd pool mksnap rbd s1", "snapshots"],
    ["ceph osd pool autoscale-status", "not among the pool reads"],
    ["ceph osd pool frobnicate", "only osd pool ls, stats and get"],
    ["ceph auth get client.admin", "cephx keys"],
    ["ceph auth ls", "cephx keys"],
    ["ceph auth print-key client.admin", "cephx keys"],
    ["ceph auth get-or-create client.x mon 'allow *'", "cephx keys"],
    ["ceph auth del client.x", "cephx keys"],
    ["ceph config-key get mgr/dashboard/key", "secrets"],
    ["ceph config-key dump", "secrets"],
    ["ceph config-key set k v", "secrets"],
    ["ceph config set osd osd_max_backfills 8", "cluster-wide"],
    ["ceph config rm osd osd_max_backfills", "cluster-wide"],
    ["ceph config assimilate-conf", "cluster-wide"],
    ["ceph config dump", "credentials"],
    ["ceph config get mon", "credentials"],
    ["ceph tell osd.3 bench", "inside a daemon"],
    ["ceph tell mon.a config set debug_mon 20", "inside a daemon"],
    ["ceph tell 'osd.*' version", "inside a daemon"],
    ["ceph daemon osd.3 config show", "admin socket"],
    ["ceph daemonperf osd.3", "admin socket"],
    ["ceph injectargs x", "runtime"],
    ["ceph fs rm cephfs", "file system"],
    ["ceph fs fail cephfs", "file system"],
    ["ceph fs reset cephfs", "file system"],
    ["ceph fs new cephfs meta data", "file system"],
    ["ceph fs set cephfs max_mds 2", "file system"],
    ["ceph mds fail 0", "MDS daemons"],
    ["ceph mon remove a", "monitor membership"],
    ["ceph mon add d 10.0.0.4", "monitor membership"],
    ["ceph mon rm a", "monitor membership"],
    ["ceph mon metadata a", "only ceph mon stat"],
    ["ceph mgr module enable telemetry", "manager module"],
    ["ceph mgr module disable dashboard", "manager module"],
    ["ceph mgr dump", "only ceph mgr stat"],
    ["ceph orch rm rgw.store", "cephadm deploys"],
    ["ceph orch apply mon 3", "cephadm deploys"],
    ["ceph orch host rm host1", "cephadm deploys"],
    ["ceph orch host add host4", "cephadm deploys"],
    ["ceph orch upgrade stop", "cephadm deploys"],
    ["ceph orch daemon rm osd.3", "daemon rm"],
    ["ceph orch daemon redeploy osd.3", "daemon rm"],
    ["ceph osd require-osd-release squid", "cannot be undone"],
    ["ceph osd set-full-ratio 0.99", "stops writes"],
    ["ceph osd set-nearfull-ratio 0.9", "warning threshold"],
    ["ceph osd set-backfillfull-ratio 0.95", "stops backfill"],
    ["ceph osd set-group noout host1", "groups of OSDs"],
    ["ceph pg force_create_pg 1.2f", "force PG creation"],
    ["ceph pg force-recovery 1.2f", "force PG creation"],
    ["ceph pg repeer 1.2f", "force PG creation"],
    ["ceph pg dump", "force PG creation"],
    ["ceph pg 1.2f mark_unfound_lost revert", "mark_unfound_lost"],
    ["ceph pg 1.2f mark_unfound_lost delete", "mark_unfound_lost"],
    [`ceph crash rm ${CRASH_ID}`, "delete reports"],
    ["ceph crash prune 7", "delete reports"],
    ["ceph log 'hello world'", "writes a message"],
    ["ceph balancer mode upmap", "how it moves data"],
    ["ceph balancer optimize plan1", "how it moves data"],
    ["ceph balancer execute plan1", "how it moves data"],
    ["ceph health mute OSD_DOWN", "hides a problem"],
    ["ceph health mute OSD_DOWN 1h", "hides a problem"],
    ["ceph health unmute OSD_DOWN", "unmutes health checks"],
    ["ceph health foo", "the only word it takes"],
    ["ceph dashboard ac-user-show", "dashboard"],
    ["ceph restful create-key admin", "REST API keys"],
    ["ceph telemetry on", "outside itself"],
    ["ceph rgw realm list", "object gateway"],
    ["ceph nfs cluster ls", "NFS"],
    ["ceph cephadm get-ssh-config", "SSH keys"],
    ["ceph device ls", "device health"],
    ["ceph heap stats", "memory allocator"],
    ["ceph sync force", "syncs"],
    ["ceph quorum enter", "quorum"],
    ["ceph osd blocklist add 10.0.0.1", "cuts clients off"],
    ["ceph osd blacklist add 10.0.0.1", "cuts clients off"],
    ["ceph osd scrub 3", "every PG on an OSD"],
    ["ceph osd deep-scrub 3", "every PG on an OSD"],
    ["ceph osd repair 3", "every PG on an OSD"],
    ["ceph osd reweight-by-utilization", "many OSDs"],
    ["ceph osd reweight-by-pg", "many OSDs"],
    ["ceph osd primary-affinity osd.3 0", "serve reads"],
    ["ceph osd pg-upmap-items 1.2f 3 4", "placement"],
    ["ceph osd rm-pg-upmap-items 1.2f", "placement"],
    ["ceph osd erasure-code-profile set p k=2 m=1", "erasure-code"],
    ["ceph osd tier add a b", "cache tiering"],
    ["ceph osd map rbd obj", "OSD commands that may run"],
    ["ceph osd setmaxosd 10", "OSD map"],
    ["ceph report", "not a command OneUptime AI may run"],
    ["ceph foo", "not a command OneUptime AI may run"],
    ["ceph frobnicate everything now", "not a command OneUptime AI may run"],
  ])("%s", (command: string, reasonPart: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expectDenied(result, reasonPart);
    expect(result.verb).toBe("");
    expect(result.program).toBe("ceph");
    expect(result.displayCommand.startsWith("ceph ")).toBe(true);
  });

  test.each([
    ["ceph osd set noup", "is not a flag"],
    ["ceph osd set nodown", "is not a flag"],
    ["ceph osd set noin", "is not a flag"],
    ["ceph osd set full", "is not a flag"],
    ["ceph osd unset sortbitwise", "is not a flag"],
    ["ceph osd unset recovery_deletes", "is not a flag"],
  ])("%s: only the modeled OSD flags", (command: string, reason: string) => {
    expectDenied(evaluate(command), reason);
  });

  test("an unknown command's reason names what may run", () => {
    const reason: string = evaluate("ceph foo").reason;

    expect(reason).toContain("Reads: status");
    expect(reason).toContain("Changes: osd in|out|down ID");
    expect(reason).toContain("osd pool set POOL size|min_size N");
  });

  test("ceph with no command (an interactive shell) is Denied", () => {
    expectDenied(evaluate("ceph"), "interactive shell");
    expectDenied(evaluate("ceph --format json"), "only an output format");
    expectDenied(evaluate("ceph -f plain"), "only an output format");
  });
});

// ---- Options: the argparse rules ---------------------------------------------

describe("options never smuggle anything past the grammar", () => {
  test.each([
    // A daemon's admin socket.
    [
      "ceph --admin-daemon /var/run/ceph/ceph-osd.0.asok status",
      "admin socket",
    ],
    ["ceph status --admin-daemon=/var/run/ceph/x.asok", "admin socket"],
    ["ceph --admin_daemon /x.asok status", "admin socket"],
    // Another cluster, identity or key.
    ["ceph -c /tmp/other.conf status", "own configuration"],
    ["ceph --conf=/tmp/other.conf status", "own configuration"],
    ["ceph -k /etc/ceph/ceph.client.admin.keyring status", "own configuration"],
    ["ceph --keyring /etc/ceph/admin.keyring health", "own configuration"],
    ["ceph health --keyring=/etc/ceph/admin.keyring", "own configuration"],
    [`ceph --key=${CEPHX_SECRET} status`, "own configuration"],
    ["ceph --keyfile /tmp/k status", "own configuration"],
    ["ceph --id admin status", "own configuration"],
    ["ceph --user admin status", "own configuration"],
    ["ceph -n client.admin status", "own configuration"],
    ["ceph --name=client.admin status", "own configuration"],
    ["ceph --cluster other status", "own configuration"],
    ["ceph -m 10.0.0.1:6789 status", "own configuration"],
    ["ceph --mon-host 10.0.0.1 status", "own configuration"],
    ["ceph --mon_host=10.0.0.1 status", "own configuration"],
    ["ceph --setuser root status", "own configuration"],
    ["ceph --auth_client_required none status", "own configuration"],
    // Files on the agent's machine.
    ["ceph -o /tmp/out status", "file on the agent"],
    ["ceph --out-file=/tmp/out status", "file on the agent"],
    ["ceph --in-file /etc/passwd status", "file on the agent"],
    ["ceph -i /etc/passwd status", "file on the agent"],
    ["ceph --log-file=/tmp/x status", "file on the agent"],
    ["ceph --log_file /tmp/x status", "file on the agent"],
    ["ceph --admin-socket=/tmp/x status", "file on the agent"],
    // Abbreviations argparse would expand.
    ["ceph --keyr=/x status", "abbreviation"],
    ["ceph --out /tmp/out status", "abbreviation"],
    ["ceph --in /etc/passwd status", "abbreviation"],
    ["ceph --adm /x.asok status", "not an option"],
    ["ceph --form json status", "abbreviation of --format"],
    ["ceph --forma=json status", "abbreviation of --format"],
    ["ceph --fo json status", "abbreviation of --format"],
    // Never-ending watches.
    ["ceph -w", "until it is killed"],
    ["ceph --watch", "until it is killed"],
    ["ceph --watch-warn", "until it is killed"],
    ["ceph --watch_error", "until it is killed"],
    ["ceph -W audit", "until it is killed"],
    ["ceph --watch-channel=audit", "until it is killed"],
    // Confirmations of destructive changes.
    ["ceph osd out 3 --yes-i-really-mean-it", "destructive"],
    ["ceph osd pool set rbd size 1 --yes-i-really-mean-it", "destructive"],
    ["ceph osd purge 3 --yes-i-really-really-mean-it", "destructive"],
    ["ceph orch daemon restart osd.3 --force", "destructive"],
    // Help, versions, verbosity, timeouts, debug.
    ["ceph -h", "help"],
    ["ceph --help", "help"],
    ["ceph status --help-all", "help"],
    ["ceph --status", "ceph status"],
    ["ceph -v", "ceph version"],
    ["ceph --version", "ceph version"],
    ["ceph --verbose status", "how much ceph prints"],
    ["ceph --concise status", "how much ceph prints"],
    ["ceph --connect-timeout 5 status", "timeouts"],
    ["ceph -p 1 status", "timeouts"],
    ["ceph --block pg scrub 1.2f", "timeouts"],
    ["ceph --debug-ms=20 status", "debug"],
    ["ceph --debug_ms 1 status", "debug"],
    // Combined, inline and malformed spellings.
    ["ceph -sf json", "stand alone"],
    ["ceph -sw", "stand alone"],
    ["ceph -s=1", "stand alone"],
    ["ceph -fjson status", "its own word"],
    ["ceph -f=json status", "its own word"],
    ["ceph -fplain osd tree", "its own word"],
    ["ceph --FORMAT json status", "not an option"],
    ["ceph osd tree '--format json'", "not an option"],
    ["ceph osd out -1", "not an option"],
    ["ceph -x status", "not an option"],
    ["ceph ---format json status", "not an option"],
    // The terminator.
    ["ceph --", "not needed"],
    ["ceph -- status", "not needed"],
    ["ceph status --", "not needed"],
    ["ceph osd tree -- down", "not needed"],
  ])("%s", (command: string, reasonPart: string) => {
    expectDenied(evaluate(command), reasonPart);
  });

  test.each([
    ["ceph --format xml status", "not an output format"],
    ["ceph --format yaml status", "not an output format"],
    ["ceph --format xml-pretty status", "not an output format"],
    ["ceph --format JSON status", "not an output format"],
    ["ceph status --format", "needs a value"],
    ["ceph status -f", "needs a value"],
    ["ceph status --format=", "not an output format"],
    ["ceph -f --admin-daemon /x.asok status", "not an output format"],
    ["ceph -f -s", "not an output format"],
    ["ceph -f status", "not an output format"],
    ["ceph status --format json --format json", "twice"],
    ["ceph status -f json --format=plain", "twice"],
    ["ceph osd tree --format json-pretty -f json", "twice"],
    ["ceph -s -s", "twice"],
  ])("%s: the output format", (command: string, reasonPart: string) => {
    expectDenied(evaluate(command), reasonPart);
  });

  test.each([
    ["ceph -s osd tree", "stand alone"],
    ["ceph status -s", "stand alone"],
    ["ceph -s osd out 3", "stand alone"],
    ["ceph osd tree -s", "stand alone"],
  ])("%s: -s is status and stands alone", (command: string, reason: string) => {
    expectDenied(evaluate(command), reason);
  });

  test.each([
    ["ceph orch ps --daemon_type=osd", "two words"],
    ["ceph orch ps --service-name=mgr", "two words"],
    ["ceph orch ps --refresh=true", "takes no value"],
    ["ceph orch ps --daemon_type osd --daemon-type mon", "twice"],
    ["ceph orch ps --service_name a --service-name b", "twice"],
    ["ceph orch ps --refresh --refresh", "twice"],
    ["ceph orch ps --daemon_type --refresh", "not a daemon type"],
    ["ceph orch ps --service_name --refresh", "not a service name"],
    ["ceph orch ps --daemon_type", "needs a value"],
    ["ceph orch ps --service_name", "needs a value"],
    ["ceph orch ps --daemon_type OSD", "not a daemon type"],
    ["ceph orch ps --service_name -x", "not an option"],
    ["ceph orch ps --service_name -s", "stand alone"],
    ["ceph orch ps host1", "takes only"],
    ["ceph orch ps --hostname host1", "not an option"],
    ["ceph orch ps --daemon_id 3", "not an option"],
    ["ceph orch ps --sort_by name", "not an option"],
    ["ceph orch ps --format yaml", "not an output format"],
    ["ceph --refresh orch ps", "not an option"],
    ["ceph orch --refresh ps", "not an option"],
    ["ceph --daemon_type osd orch ps", "not an option"],
    ["ceph orch ls --refresh", "not an option"],
    ["ceph orch ls --export", "not an option"],
    ["ceph orch host ls --detail", "not an option"],
    ["ceph orch device ls --refresh", "not an option"],
    ["ceph osd tree --refresh", "not an option"],
  ])(
    "%s: orch ps's named arguments, only after orch ps",
    (command: string, reasonPart: string) => {
      expectDenied(evaluate(command), reasonPart);
    },
  );
});

// ---- Arguments ----------------------------------------------------------------

describe("arguments are validated, so a target can never hide", () => {
  test.each([
    ["ceph osd out", "needs an OSD id"],
    ["ceph osd out 1 2", "exactly one argument"],
    ["ceph osd out any", "not an OSD id"],
    ["ceph osd out all", "not an OSD id"],
    ["ceph osd out '*'", "not an OSD id"],
    ["ceph osd out 03", "without leading zeros"],
    ["ceph osd out osd.03", "without leading zeros"],
    ["ceph osd out osd.", "not an OSD id"],
    ["ceph osd out OSD.3", "not an OSD id"],
    ["ceph osd out osd3", "not an OSD id"],
    ["ceph osd out 1234567", "not an OSD id"],
    ["ceph osd out 3.0", "not an OSD id"],
    ["ceph osd out osd.3,osd.4", "not an OSD id"],
    ["ceph osd out mon.a", "not an OSD id"],
    ["ceph osd in 3 4", "exactly one argument"],
    ["ceph osd down osd.1 osd.2", "exactly one argument"],
    ["ceph osd find", "needs an OSD id"],
    ["ceph osd find 1 2", "exactly one argument"],
    ["ceph osd metadata x", "not an OSD id"],
    ["ceph osd ok-to-stop", "needs an OSD id"],
    ["ceph osd ok-to-stop any", "not an OSD id"],
    ["ceph osd safe-to-destroy 1 all", "not an OSD id"],
    ["ceph osd tree 5", "not one of"],
    ["ceph osd tree down down", "given twice"],
    ["ceph osd df plain", "only word"],
    ["ceph osd df tree class hdd", "only word"],
    ["ceph health detail extra", "only word"],
    ["ceph df DETAIL", "only word"],
    ["ceph status now", "takes no arguments"],
    ["ceph mon dump 3", "takes no arguments"],
    ["ceph crash ls extra", "takes no arguments"],
    ["ceph osd pool get rbd", "a pool name and one setting"],
    ["ceph osd pool get rbd size extra", "a pool name and one setting"],
    ["ceph osd pool get @rbd size", "not a pool name"],
    ["ceph osd pool get rbd SIZE", "not a pool setting"],
    ["ceph osd pool stats rbd extra", "exactly one argument"],
    ["ceph osd pool stats 'my pool'", "not a pool name"],
    ["ceph osd pool set rbd size 0", "replica count"],
    ["ceph osd pool set rbd size 11", "replica count"],
    ["ceph osd pool set rbd size 3.0", "replica count"],
    ["ceph osd pool set rbd min_size 03", "replica count"],
    ["ceph osd pool set rbd size", "a pool name, size or min_size"],
    ["ceph osd pool set @rbd size 3", "not a pool name"],
    ["ceph osd reweight 3", "a weight from 0 to 1"],
    ["ceph osd reweight 3 1.5", "not a weight"],
    ["ceph osd reweight 3 2", "not a weight"],
    ["ceph osd reweight 3 .5", "not a weight"],
    ["ceph osd reweight 3 0.12345", "not a weight"],
    ["ceph osd reweight 3 1e0", "not a weight"],
    ["ceph osd reweight 3 1.0001", "not a weight"],
    ["ceph osd reweight x 0.5", "not an OSD id"],
    ["ceph osd reweight 3 0.5 extra", "one OSD id and a weight"],
    ["ceph osd set", "needs one flag"],
    ["ceph osd set noout norebalance", "exactly one argument"],
    ["ceph osd unset NOOUT", "is not a flag"],
    ["ceph pg scrub", "needs a PG id"],
    ["ceph pg scrub 1.2F", "not a PG id"],
    ["ceph pg scrub 1.02f", "not a PG id"],
    ["ceph pg scrub 01.2f", "not a PG id"],
    ["ceph pg scrub 1", "not a PG id"],
    ["ceph pg scrub 1.2fs0", "not a PG id"],
    ["ceph pg scrub 1.2f 1.30", "exactly one argument"],
    ["ceph pg repair 1.123456789", "not a PG id"],
    ["ceph pg deep-scrub 1.g", "not a PG id"],
    ["ceph pg 1.2F query", "not a PG id"],
    ["ceph pg 1.2f", "takes only query or list_unfound"],
    ["ceph pg 1.2f query extra", "no more arguments"],
    ["ceph pg 1 query", "not a PG id"],
    ["ceph pg dump_stuck stuck", "not one of"],
    ["ceph pg dump_stuck stale stale", "given twice"],
    ["ceph pg dump_stuck 60 stale", "not one of"],
    ["ceph pg ls-by-osd", "needs an OSD id"],
    ["ceph pg ls-by-pool", "needs a pool name"],
    ["ceph log last 0", "line count"],
    ["ceph log last 1001", "line count"],
    ["ceph log last 00010", "line count"],
    ["ceph log last 99999999", "line count"],
    ["ceph log last warn 10", "in that order"],
    ["ceph log last 10 cluster warn", "in that order"],
    ["ceph log last 10 warn cluster extra", "in that order"],
    ["ceph log last 10 critical", "in that order"],
    ["ceph crash info", "needs a crash id"],
    ["ceph crash info abc", "not a crash id"],
    [
      "ceph crash info 2024-05-21T10:15:42.123456Z_0C7D3C6E-1B2A-4C3D-9E8F-0123456789AB",
      "not a crash id",
    ],
    [`ceph crash archive ${CRASH_ID} ${CRASH_ID}`, "exactly one argument"],
    ["ceph crash archive-all now", "takes no arguments"],
    ["ceph orch daemon restart", "needs one daemon name"],
    ["ceph orch daemon restart osd", "not a cephadm daemon name"],
    ["ceph orch daemon restart osd.03", "not a cephadm daemon name"],
    ["ceph orch daemon restart osd.osd.3", "not a cephadm daemon name"],
    ["ceph orch daemon restart osd.all", "not a cephadm daemon name"],
    ["ceph orch daemon restart Mon.host1", "not a cephadm daemon name"],
    ["ceph orch daemon restart .host1", "not a cephadm daemon name"],
    ["ceph orch daemon stop mon.", "not a cephadm daemon name"],
    ["ceph orch daemon restart mon.host1 mon.host2", "exactly one argument"],
    ["ceph orch restart", "needs one service name"],
    ["ceph orch restart Mgr", "not a cephadm service name"],
    ["ceph orch restart mgr mon", "exactly one argument"],
    ["ceph mgr fail a b", "at most one manager name"],
    ["ceph mgr fail .x", "at most one manager name"],
    ["ceph balancer on now", "takes no arguments"],
    ["ceph fs status 'bad name'", "not a file system name"],
    ["ceph fs status a b", "exactly one argument"],
  ])("%s", (command: string, reasonPart: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expectDenied(result, reasonPart);
  });

  test("a refused argument names the usage", () => {
    expect(evaluate("ceph osd reweight 3 2").reason).toContain(
      "Usage: ceph osd reweight ID WEIGHT",
    );
    expect(evaluate("ceph orch daemon stop mon").reason).toContain(
      "Usage: ceph orch daemon stop TYPE.ID",
    );
  });
});

// ---- Tokenization, quoting, look-alikes ---------------------------------------

describe("quotes, whitespace and look-alikes", () => {
  test("quoted words are the same words", () => {
    const result: ResourceCommandPolicyResult =
      evaluate(`ceph 'osd' "out" '3'`);

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.targets).toEqual(["osd.3"]);
    expect(result.displayCommand).toBe("ceph osd out 3");
  });

  test.each([
    ["ceph 'osd out' 3", "not a command"],
    [`ceph "osd tree -f json"`, "not a command"],
    ["ceph '' status", "empty"],
    ["ceph status ''", "empty"],
    ["ceph ''", "empty"],
    ["ceph ' '", "empty"],
    ["ceph osd out '3 '", "not an OSD id"],
  ])("%s is Denied", (command: string, reasonPart: string) => {
    expectDenied(evaluate(command), reasonPart);
  });

  test("tabs and surrounding spaces split words like spaces", () => {
    expect(evaluate("  ceph\tosd   tree  ").tier).toBe(
      ResourceCommandTier.Read,
    );
  });

  test.each([
    ["ceph osd tree | head", "pipes and redirects are not supported"],
    ["ceph status; ceph auth ls", "pipes and redirects are not supported"],
    ["ceph status && ceph osd out 3", "pipes and redirects are not supported"],
    ["ceph status > /tmp/x", "pipes and redirects are not supported"],
    ["ceph $(echo status)", "pipes and redirects are not supported"],
    ["ceph `echo status`", "pipes and redirects are not supported"],
    ["ceph status\nceph auth ls", "single line"],
    ["sudo ceph status", "own permissions"],
    ["/usr/bin/ceph status", "without a path"],
    ["rados df", "is not a program the Ceph AI agent runs"],
    ["CEPH status", "is not a program the Ceph AI agent runs"],
    ["kubectl get pods", "is not a program the Ceph AI agent runs"],
  ])("%s never reaches the grammar", (command: string, reasonPart: string) => {
    expectDenied(evaluate(command), reasonPart);
  });

  test.each([
    ["ceph оsd tree"], // Cyrillic o
    ["ceph osd tree ‐‐format json"], // Unicode hyphens
    ["ceph −f json status"], // minus sign
    ["ceph —format json status"], // em dash
    ["ceph osd out ３"], // fullwidth 3
    ["ceph osd out osd.３"],
    ["ceph status​"], // zero-width space
    ["ceph ｓtatus"], // fullwidth s
    ["ceph Status"],
    ["ceph STATUS"],
    ["ceph OSD tree"],
    ["ceph osd Out 3"],
    ["ceph osd out '3 '"], // no-break space inside the word
    ["ceph osd out 3"], // no-break space is not a word break
    ["ceph pg 1․2f query"], // one-dot leader
    ["ceph osd pool get rbd‍ size"],
    ["ceph osd set noоut"],
    ["ceph orch daemon restart osd·3"],
  ])("%p is Denied", (command: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.targets).toEqual([]);
  });

  test("an over-long command or one with too many words is Denied", () => {
    expect(evaluate(`ceph osd pool stats ${"a".repeat(2000)}`).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(evaluate(`ceph osd ok-to-stop ${"1 ".repeat(70).trim()}`).tier).toBe(
      ResourceCommandTier.Denied,
    );
  });
});

// ---- Totality -----------------------------------------------------------------

describe("evaluateArgv is total and never changes its input", () => {
  test.each([
    [null],
    [undefined],
    [42],
    ["ceph status"],
    [{}],
    [[]],
    [[1]],
    [["ceph", 1]],
    [[null]],
    [["ceph", null]],
    [["ceph", undefined]],
    [[["ceph"]]],
    [["ceph", {}]],
    [["ceph", ["status"]]],
    [["osd", "tree"]],
    [["", "status"]],
    [["ceph"]],
  ])("%p is Denied without throwing", (argv: unknown) => {
    const result: ResourceCommandPolicyResult = CephCommandPolicy.evaluateArgv(
      argv as Array<string>,
    );

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.targets).toEqual([]);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test("an argv whose words throw when read is Denied, not thrown", () => {
    const evil: Array<string> = ["ceph", "status"];

    Object.defineProperty(evil, 1, {
      get(): string {
        throw new Error("boom");
      },
    });

    expect((): void => {
      CephCommandPolicy.evaluateArgv(evil);
    }).not.toThrow();
    expect(CephCommandPolicy.evaluateArgv(evil).tier).toBe(
      ResourceCommandTier.Denied,
    );
  });

  test("a frozen argv is read, not changed, and results are fresh arrays", () => {
    const argv: Array<string> = Object.freeze([
      "ceph",
      "osd",
      "out",
      "3",
    ]) as unknown as Array<string>;
    const result: ResourceCommandPolicyResult =
      CephCommandPolicy.evaluateArgv(argv);

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(argv).toEqual(["ceph", "osd", "out", "3"]);

    result.args.push("--yes-i-really-mean-it");
    result.targets.push("osd.4");

    const again: ResourceCommandPolicyResult =
      CephCommandPolicy.evaluateArgv(argv);

    expect(again.args).toEqual(["osd", "out", "3"]);
    expect(again.targets).toEqual(["osd.3"]);
  });

  test("huge argvs and words are Denied quickly", () => {
    const started: number = Date.now();
    const manyWords: Array<string> = [
      "ceph",
      "osd",
      "ok-to-stop",
      ...Array.from({ length: 10000 }, (): string => {
        return "1";
      }),
    ];

    expect(CephCommandPolicy.evaluateArgv(manyWords).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(
      CephCommandPolicy.evaluateArgv([
        "ceph",
        "crash",
        "info",
        `2024-05-21T10:15:42.${"1".repeat(100000)}Z_x`,
      ]).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      CephCommandPolicy.evaluateArgv(["ceph", "-".repeat(100000)]).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("the dispatcher and the tool agree on an argv", () => {
    for (const [command] of [
      ...READ_COMMANDS,
      ...SAFE_WRITES,
      ...RISKY_WRITES,
    ]) {
      const argv: Array<string> = argvOf(command as string);

      expect(
        ResourceCommandPolicy.evaluateArgv({ resourceType: CEPH, argv }),
      ).toEqual(CephCommandPolicy.evaluateArgv(argv));
    }
  });
});

// ---- Dispatcher integration ---------------------------------------------------

function autoExecution(
  command: string,
  allowlistPatterns: Array<string> = [],
  bypassApproval: boolean = false,
): ResourceAutoExecutionVerdict {
  return ResourceCommandPolicy.evaluateForAutoExecution({
    resourceType: CEPH,
    command,
    allowlistPatterns,
    bypassApproval,
  });
}

describe("evaluateForAutoExecution (the ladder)", () => {
  test("a read is AutoApproved", () => {
    const verdict: ResourceAutoExecutionVerdict = autoExecution("ceph status");

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.Read);
  });

  test.each(
    SAFE_WRITES.map((row: [string, string, Array<string>]) => {
      return [row[0]];
    }),
  )("%s runs unattended (SafeWrite)", (command: string) => {
    const verdict: ResourceAutoExecutionVerdict = autoExecution(command);

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.SafeWrite);
  });

  test.each(
    RISKY_WRITES.map((row: [string, string, Array<string>]) => {
      return [row[0]];
    }),
  )("%s asks, unless bypassed (RiskyWrite)", (command: string) => {
    expect(autoExecution(command).verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(autoExecution(command, [], true).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
  });

  test("the allowlist promotes the RiskyWrite it names, and only it", () => {
    expect(autoExecution("ceph osd out 3", ["ceph osd out *"]).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(autoExecution("ceph osd out 3", ["ceph osd out *"]).reason).toBe(
      "Matched the resource's command allowlist.",
    );
    expect(autoExecution("ceph osd out 3", ["ceph osd out 3"]).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(autoExecution("ceph osd out 3", ["ceph osd out 4"]).verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(autoExecution("ceph osd down 3", ["ceph osd out *"]).verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(
      autoExecution("ceph osd out 3 --format json", [
        "ceph osd out * --format json",
      ]).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      autoExecution("ceph osd out 3", ["ceph osd out * --format json"]).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
    expect(
      autoExecution("ceph balancer on", ["ceph balancer on"]).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
  });

  test.each([
    ["ceph osd set pause", ["ceph osd set pause"]],
    ["ceph osd pool set rbd size 2", ["ceph osd pool set * size *"]],
    ["ceph osd pool set rbd min_size 1", ["ceph osd pool set rbd min_size 1"]],
  ])(
    "%s always asks a human, even bypassed and allowlisted",
    (command: string, allowlist: Array<string>) => {
      const verdict: ResourceAutoExecutionVerdict = autoExecution(
        command,
        allowlist,
        true,
      );

      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.requiresHuman).toBe(true);
      expect(verdict.reason).toContain("Requires human approval");
    },
  );

  test.each([
    ["ceph auth ls", ["ceph auth ls *"]],
    ["ceph osd purge 3", ["ceph osd purge *"]],
    ["ceph osd out 3 --yes-i-really-mean-it", ["ceph osd out * *"]],
    ["ceph --admin-daemon /x.asok status", []],
    ["ceph tell osd.3 injectargs x", []],
  ])(
    "%s is Denied, whatever is bypassed or allowlisted",
    (command: string, allowlist: Array<string>) => {
      const verdict: ResourceAutoExecutionVerdict = autoExecution(
        command,
        allowlist,
        true,
      );

      expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
      expect(verdict.tier).toBe(ResourceCommandTier.Denied);
      expect(verdict.reason).toContain("cannot run even with human approval");
    },
  );
});

describe("the allowlist", () => {
  function problem(pattern: unknown): string | null {
    return ResourceCommandPolicy.describeAllowlistPatternProblem({
      resourceType: CEPH,
      pattern,
    });
  }

  function broad(pattern: unknown): boolean {
    return ResourceCommandPolicy.isBroadAllowlistPattern({
      resourceType: CEPH,
      pattern,
    });
  }

  test.each([
    ["ceph osd out *"],
    ["ceph osd out 3"],
    ["ceph osd in *"],
    ["ceph osd down *"],
    ["ceph osd set noout"],
    ["ceph osd reweight 3 *"],
    ["ceph osd reweight * 0.5"],
    ["ceph balancer on"],
    ["ceph crash archive-all"],
    ["ceph mgr fail"],
    ["ceph mgr fail *"],
    ["ceph orch restart *"],
    ["ceph orch daemon stop osd.3"],
    ["ceph pg repair 1.2f"],
    ["ceph osd pool set * size 3"],
    ["ceph osd out * --format json"],
    // The grammar's own words stand in for these `*`s (daemon names, PG ids, flags, weights).
    ["ceph orch daemon stop *"],
    ["ceph pg repair *"],
    ["ceph osd set *"],
    ["ceph osd reweight * *"],
  ])("%s is a valid entry", (pattern: string) => {
    expect(problem(pattern)).toBeNull();
  });

  test.each([
    ["ceph status", "fewer than two words"],
    ["ceph -s", "fewer than two words"],
    ["ceph health detail", "read-only command"],
    ["ceph osd tree down", "read-only command"],
    ["ceph osd pool get * size", "read-only command"],
    ["ceph auth get *", "can never match"],
    ["ceph osd purge * --yes-i-really-mean-it", "can never match"],
    ["ceph osd out", "can never match"],
    ["ceph * out 3", "where the command goes"],
    [
      "docker restart *",
      "does not start with a program the Ceph AI agent runs",
    ],
    ["ceph osd out * | tee", "cannot be read as one command"],
    ["", "cannot be blank"],
  ])("%s is refused (%s)", (pattern: string, problemPart: string) => {
    expect(problem(pattern)).toContain(problemPart);
  });

  test.each([
    ["ceph osd out *", true],
    ["ceph osd in *", true],
    ["ceph osd down *", true],
    ["ceph osd reweight * 0.5", true],
    ["ceph mgr fail *", true],
    ["ceph orch restart *", true],
    ["ceph osd pool set * size 3", true],
    ["ceph osd out 3", false],
    ["ceph osd reweight 3 *", false],
    ["ceph osd pool set rbd size *", false],
    ["ceph osd set noout", false],
    ["ceph crash archive-all", false],
    ["ceph health detail", false],
    ["ceph orch daemon stop *", true],
    ["ceph pg repair *", true],
    ["ceph osd reweight * *", true],
    // The flag is a value of a cluster-wide change; the target stays "cluster".
    ["ceph osd set *", false],
  ])("%s broad: %s", (pattern: string, expected: boolean) => {
    expect(broad(pattern)).toBe(expected);
  });

  test("matchesAllowlist matches word by word, skipping invalid entries", () => {
    const matches: (command: string, patterns: Array<string>) => boolean = (
      command: string,
      patterns: Array<string>,
    ): boolean => {
      return ResourceCommandPolicy.matchesAllowlist({
        resourceType: CEPH,
        command,
        patterns,
      });
    };

    expect(matches("ceph osd out 3", ["ceph osd out *"])).toBe(true);
    expect(matches("ceph osd out 3", ["ceph osd out 3"])).toBe(true);
    expect(matches("ceph osd out osd.3", ["ceph osd out 3"])).toBe(false);
    expect(matches("ceph osd out 3", ["ceph osd * 3"])).toBe(false);
    expect(matches("ceph osd out 3", ["ceph osd out"])).toBe(false);
    expect(matches("ceph osd out 3", ["docker stop *"])).toBe(false);
    expect(matches("ceph health detail", ["ceph health detail"])).toBe(false);
    expect(matches("ceph osd out 3 4", ["ceph osd out *"])).toBe(false);
  });
});

describe("getWriteScopeRefusal with ceph targets", () => {
  function refusal(
    command: string,
    options: {
      allowWrites?: boolean;
      writeTargets?: Array<string>;
      protectedTargets?: Array<string>;
    } = {},
  ): string | null {
    return ResourceCommandPolicy.getWriteScopeRefusal({
      result: evaluate(command),
      allowWrites: options.allowWrites !== false,
      writeTargets: options.writeTargets || [],
      protectedTargets: options.protectedTargets || [],
      resourceType: CEPH,
    });
  }

  test("reads are never refused, not even read-only", () => {
    expect(refusal("ceph status", { allowWrites: false })).toBeNull();
    expect(refusal("ceph osd tree", { writeTargets: ["osd.1"] })).toBeNull();
  });

  test("a Denied command is refused", () => {
    expect(refusal("ceph auth ls")).toContain("denied by the command policy");
  });

  test("a read-only agent refuses every write and names the setting", () => {
    const text: string | null = refusal("ceph osd in 3", {
      allowWrites: false,
    });

    expect(text).toContain(`${RESOURCE_AI_ALLOW_WRITES_ENV}=true`);
    expect(text).toContain("Ceph AI agent");
  });

  test("with no write targets configured, any write may run", () => {
    for (const [command] of [
      ...SAFE_WRITES,
      ...RISKY_WRITES,
      ...ALWAYS_HUMAN_WRITES,
    ]) {
      expect(refusal(command as string)).toBeNull();
    }
  });

  test.each([
    ["ceph osd out 3", ["osd.*"], true],
    ["ceph osd out osd.3", ["osd.3"], true],
    ["ceph orch daemon restart osd.3", ["osd.*"], true],
    ["ceph orch daemon restart mon.host1", ["osd.*"], false],
    ["ceph osd set noout", ["osd.*"], false],
    ["ceph osd set noout", ["cluster"], true],
    ["ceph balancer on", ["cluster"], true],
    ["ceph crash archive-all", ["cluster"], true],
    ["ceph mgr fail", ["cluster"], true],
    ["ceph mgr fail host1.abc", ["cluster"], false],
    ["ceph mgr fail host1.abc", ["mgr.*"], true],
    [`ceph crash archive ${CRASH_ID}`, ["crash/*"], true],
    [`ceph crash archive ${CRASH_ID}`, ["osd.*"], false],
    ["ceph pg scrub 1.2f", ["1.*"], true],
    ["ceph pg scrub 2.0", ["1.*"], false],
    ["ceph pg repair 1.2f", ["osd.*"], false],
    ["ceph osd pool set rbd size 3", ["rbd"], true],
    ["ceph osd pool set images size 3", ["rbd"], false],
    ["ceph orch restart rgw.store", ["rgw.*"], true],
  ])(
    "%s with write targets %p allowed: %s",
    (command: string, writeTargets: Array<string>, allowed: boolean) => {
      const text: string | null = refusal(command, { writeTargets });

      if (allowed) {
        expect(text).toBeNull();
      } else {
        expect(text).toContain(RESOURCE_AI_WRITE_TARGETS_ENV);
      }
    },
  );

  test("protected targets are never changed, in either OSD spelling", () => {
    expect(
      refusal("ceph osd out 3", { protectedTargets: ["osd.3"] }),
    ).toContain("protects");
    expect(
      refusal("ceph osd out osd.3", { protectedTargets: ["osd.3"] }),
    ).toContain("protects");
    expect(
      refusal("ceph orch daemon stop osd.3", { protectedTargets: ["osd.3"] }),
    ).toContain("protects");
    expect(
      refusal("ceph mgr fail host1.abc", {
        protectedTargets: ["mgr.host1.abc"],
      }),
    ).toContain("protects");
    expect(
      refusal("ceph osd out 4", { protectedTargets: ["osd.3"] }),
    ).toBeNull();
  });
});

// ---- Guides -------------------------------------------------------------------

describe("the command guides", () => {
  const read: string = CephCommandPolicy.readCommandGuide;
  const write: string = CephCommandPolicy.writeCommandGuide;

  test("the dispatcher serves them for Ceph clusters", () => {
    expect(ResourceCommandPolicy.getReadCommandGuide(CEPH)).toBe(read);
    expect(ResourceCommandPolicy.getWriteCommandGuide(CEPH)).toBe(write);
  });

  test("are compact markdown bullets", () => {
    for (const guide of [read, write]) {
      for (const line of guide.split("\n")) {
        expect(line.startsWith("- ")).toBe(true);
      }

      expect(guide.length).toBeLessThan(2000);
    }
  });

  test("mention every command the grammar accepts", () => {
    const both: string = `${read}\n${write}`;

    for (const command of CEPH_COMMANDS) {
      const words: Array<string> = command.split(" ");
      const last: string = words.pop() as string;
      const prefix: string =
        command === "pg query" || command === "pg list_unfound"
          ? "ceph pg PGID "
          : `ceph ${words
              .map((word: string) => {
                return `${word} `;
              })
              .join("")}`;
      const escape: (text: string) => string = (text: string): string => {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      };
      const pattern: RegExp = new RegExp(
        `${escape(prefix)}(?:[\\w-]+\\|)*${escape(last)}(?:\\|[\\w-]+)*(?=[ \`])`,
      );

      expect(both).toMatch(pattern);
    }
  });

  test("put reads in the read guide and changes in the write guide", () => {
    expect(read).toContain("`ceph status`");
    expect(read).toContain("--format json");
    expect(read).not.toContain("ceph osd out");
    expect(write).toContain("SafeWrite");
    expect(write).toContain("RiskyWrite");
    expect(write).toContain("Always asks a human");
    expect(write).toContain("`ceph osd set pause`");
    expect(write).toContain("Never runs");
  });

  test.each([
    ["ceph osd in 3", ResourceCommandTier.SafeWrite, "ceph osd in ID"],
    ["ceph osd out 3", ResourceCommandTier.RiskyWrite, "ceph osd out ID"],
    ["ceph pg scrub 1.2f", ResourceCommandTier.SafeWrite, "ceph pg scrub PGID"],
    [
      "ceph orch daemon restart osd.3",
      ResourceCommandTier.SafeWrite,
      "ceph orch daemon restart TYPE.ID",
    ],
    [
      "ceph orch restart mgr",
      ResourceCommandTier.RiskyWrite,
      "ceph orch restart SERVICE",
    ],
  ])(
    "the guide's tier for %s matches the grammar",
    (command: string, tier: ResourceCommandTier, guideForm: string) => {
      expect(evaluate(command).tier).toBe(tier);

      const bullet: string | undefined = write
        .split("\n")
        .find((line: string): boolean => {
          return line.includes(guideForm);
        });

      expect(bullet).toBeDefined();
      expect(bullet).toContain(
        tier === ResourceCommandTier.SafeWrite ? "SafeWrite" : "RiskyWrite",
      );
    },
  );
});

// ---- Output redaction ---------------------------------------------------------

function redactCeph(text: string): ResourceOutputRedaction {
  return redactResourceCommandOutputWithCount({
    resourceType: CEPH,
    program: "ceph",
    text,
  });
}

describe("ceph output redaction", () => {
  test("ceph has the keyring hook and the secret-value hook", () => {
    expect(getResourceOutputRedactionHooks("ceph").length).toBe(2);
  });

  test.each([
    [`${CEPHX_SECRET}\n`, CEPHX_SECRET],
    [`exported keyring ${CEPHX_SECRET} for client.x`, CEPHX_SECRET],
    [`{\\"key\\": \\"${CEPHX_SECRET}\\"}`, CEPHX_SECRET],
    [`--key=${CEPHX_SECRET}`, CEPHX_SECRET],
    [`[client.admin]\n\tkey = ${CEPHX_SECRET}\n`, CEPHX_SECRET],
    [`client.admin\n\tkey: ${CEPHX_SECRET}\n`, CEPHX_SECRET],
    [`[{"entity":"client.admin","key":"${CEPHX_SECRET}"}]`, CEPHX_SECRET],
    [
      `audit [INF] from='client.? 10.0.0.1:0/1' entity='client.admin' cmd=[{"prefix": "config-key set", "key": "mgr/dashboard/pwd", "val": "hunter2"}]: dispatch`,
      "hunter2",
    ],
    [
      `audit [INF] cmd=[{"prefix":"config set","who":"client.rgw","name":"rgw_keystone_admin_password","value":"s3cr3t-pw"}]: dispatch`,
      "s3cr3t-pw",
    ],
    [
      `{"message":"cmd=[{\\"prefix\\": \\"config-key set\\", \\"key\\": \\"k\\", \\"val\\": \\"hunter2\\"}]: dispatch"}`,
      "hunter2",
    ],
    [
      `{"message":"cmd=[{\\"prefix\\": \\"config-key set\\", \\"key\\": \\"k\\", \\"val\\": \\"{\\\\\\"password\\\\\\": \\\\\\"s3cr3t\\\\\\"}\\"}]: dispatch"}`,
      "s3cr3t",
    ],
    [`{"val": "multi \\"quoted\\" secret"}`, "secret"],
  ])("%p loses %p", (text: string, secret: string) => {
    const redacted: ResourceOutputRedaction = redactCeph(text);

    expect(redacted.text).not.toContain(secret);
    expect(redacted.text).toContain("[redacted]");
    expect(redacted.redactionCount).toBeGreaterThan(0);
  });

  test("what the audit entry did stays readable", () => {
    const redacted: string = redactResourceCommandOutput({
      resourceType: CEPH,
      program: "ceph",
      text: `audit [INF] cmd=[{"prefix": "config-key set", "key": "k", "val": "hunter2"}]: dispatch`,
    });

    expect(redacted).toContain('"prefix": "config-key set"');
    expect(redacted).toContain(": dispatch");
  });

  test("redaction is idempotent", () => {
    const once: string = redactCeph(
      `{"val": "hunter2"} ${CEPHX_SECRET} key = ${CEPHX_SECRET}`,
    ).text;
    const twice: ResourceOutputRedaction = redactCeph(once);

    expect(twice.text).toBe(once);
  });

  test.each([
    [
      "ID  CLASS  WEIGHT   TYPE NAME       STATUS  REWEIGHT  PRI-AFF\n-1         0.29306  root default\n-3         0.09769      host node1\n 0    hdd  0.09769          osd.0       up   1.00000  1.00000",
    ],
    [
      "HEALTH_WARN 1 osds down; Degraded data redundancy: 12/345 objects degraded (3.478%), 5 pgs degraded\n[WRN] OSD_DOWN: 1 osds down\n    osd.3 (root=default,host=node2) is down",
    ],
    [
      "--- RAW STORAGE ---\nCLASS     SIZE    AVAIL     USED  RAW USED  %RAW USED\nhdd    300 GiB  290 GiB  10 GiB    10 GiB       3.33",
    ],
    [
      "ok\npg_stat\tstate\tup\tup_primary\tacting\tacting_primary\n1.2f\tstale+active+clean\t[0,1,2]\t0\t[0,1,2]\t0",
    ],
    ['{"val": ""}'],
  ])("ordinary ceph output keeps its values: %p", (text: string) => {
    for (const hook of getResourceOutputRedactionHooks("ceph")) {
      const hooked: ResourceOutputRedaction = (
        hook as ResourceOutputRedactionHook
      )({ resourceType: CEPH, program: "ceph", text });

      expect(hooked.text).toBe(text);
      expect(hooked.redactionCount).toBe(0);
    }
  });

  test("the ceph hooks are total and linear on hostile text", () => {
    const started: number = Date.now();
    const hostile: Array<string> = [
      "",
      `AQ${"A".repeat(200000)}`,
      '"val": "'.repeat(20000),
      '\\"val\\": \\"'.repeat(20000),
      `{"val": "${"\\\\".repeat(50000)}`,
      `\\"value\\": \\"${"\\\\\\\\".repeat(50000)}`,
    ];

    for (const text of hostile) {
      for (const hook of getResourceOutputRedactionHooks("ceph")) {
        expect((): void => {
          hook({ resourceType: CEPH, program: "ceph", text });
        }).not.toThrow();
      }
    }

    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("the ceph hooks run for ceph only", () => {
    const text: string = '{"val": "plain-value"}';

    expect(
      redactResourceCommandOutput({
        resourceType: AiResourceType.Host,
        program: "unknown-program",
        text,
      }),
    ).toContain("plain-value");
    expect(redactCeph(text).text).not.toContain("plain-value");
  });
});
