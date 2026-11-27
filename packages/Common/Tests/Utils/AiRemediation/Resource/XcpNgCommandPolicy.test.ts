import XcpNgCommandPolicy, {
  MAX_XO_API_PATH_CHARS,
  MAX_XO_FIELDS,
  MAX_XO_FILTER_CHARS,
  MAX_XO_FILTER_DEPTH,
  MAX_XO_FILTER_REGEX_CHARS,
  MAX_XO_LIMIT,
  MAX_XO_SNAPSHOT_NAME_CHARS,
  XCP_NG_ACTIONS_SUMMARY,
  XCP_NG_READABLE_PATHS_SUMMARY,
  XCP_NG_TARGET_KINDS,
  XO_CLI_PROGRAM,
  XO_CLI_REST_COMMAND,
  XO_OWN_COLLECTIONS,
  XO_POOL_COLLECTIONS,
  XO_REST_API_BASE_PATH,
  XcpNgCommandParseResult,
  XenOrchestraApiRequest,
  XenOrchestraFilterNode,
  XenOrchestraFilterParseResult,
  describeXenOrchestraFilterProblem,
  parseXcpNgCommand,
  parseXenOrchestraFilter,
} from "../../../../Utils/AiRemediation/Resource/XcpNgCommandPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  ResourceTokenizeResult,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  isIdentityResolvedByAgent,
  parseAiResourceType,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the xo-cli command policy (XcpNgCommandPolicy) for
 * XCP-ng pools, and the request parser the XCP-ng AI agent sends to Xen
 * Orchestra's REST API (parseXcpNgCommand).
 *
 * - The grammar is xo-cli 0.32's REST mode, a strict subset of it: rest,
 *   then get or post, one path, name=value parameters. Everything that
 *   could be a second reading of the words (a query string, a dotted name,
 *   a json: value, a parameter twice, a flag) is refused.
 * - get reads an allowlist of path shapes over the pool's own objects and
 *   Xen Orchestra's records of its work; Xen Orchestra's users, tokens,
 *   roles, servers, plugins, proxies and backup repositories, downloads and
 *   the event stream are Denied.
 * - A filter is parsed with complex-matcher's grammar and refused when it
 *   could test a secret's value: a term with no property, a credential's
 *   name, a free-form configuration bag.
 * - post: start, resume and unpause a VM, plug a PBD and run a backup
 *   schedule are SafeWrite; reboots, shutdowns, suspend, pause, a snapshot
 *   and enabling a host are RiskyWrite; a migration within the pool and a
 *   toolstack restart always need a human; everything else is Denied with
 *   its reason.
 * - parseXcpNgCommand only ever builds a request for a command the policy
 *   allows, and the request is exactly the command that was tiered.
 * - Targets are <kind>/<uuid>; a bare UUID in the agent's lists names the
 *   object whatever its kind.
 *
 * The lab is the one #10995's recorded scrape describes (Production pool
 * b7569d99..., hosts xcp-prod-01/02/03, VMs web-01, db-01, app-02, win-03).
 */

const POOL: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const HOST: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
const OTHER_HOST: string = "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7";
const VM: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const SR: string = "1d2c3b4a-5e6f-4789-9abc-def012345678";
const PBD: string = "16b2a60f-7c4d-f45f-7c7a-963b06fc587d";
const VDI: string = "aa11bb22-cc33-4d44-8e55-ff6677889900";
const SCHEDULE: string = "cf7249f8-d20b-494f-97f4-b1f32f94e780";
const JOB: string = "d33f3dc1-92b4-469c-ad58-4c2a106a4721";
const TASK: string = "0mdd1basu";
const BACKUP_LOG: string = "1753776067468";

function evaluate(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: AiResourceType.XcpNgPool,
    command,
  });
}

function tokens(command: string): Array<string> {
  const tokenized: ResourceTokenizeResult = tokenizeResourceCommand(command);

  if (!tokenized.argv) {
    throw new Error(`does not tokenize: ${command}`);
  }

  return tokenized.argv;
}

function parse(command: string): XcpNgCommandParseResult {
  return parseXcpNgCommand(tokens(command));
}

function request(command: string): XenOrchestraApiRequest {
  const parsed: XcpNgCommandParseResult = parse(command);

  if (!parsed.request) {
    throw new Error(`no request for ${command}: ${parsed.errorMessage}`);
  }

  return parsed.request;
}

function expectRead(command: string): ResourceCommandPolicyResult {
  const result: ResourceCommandPolicyResult = evaluate(command);

  expect({ command, tier: result.tier, reason: result.reason }).toEqual({
    command,
    tier: ResourceCommandTier.Read,
    reason: expect.stringContaining("changes nothing"),
  });
  expect(result.targets).toEqual([]);
  expect(result.requiresHuman).toBeUndefined();
  expect(result.verb).toBe("get");

  return result;
}

function expectDenied(command: string, mentions?: string | RegExp): string {
  const result: ResourceCommandPolicyResult = evaluate(command);

  expect({ command, tier: result.tier }).toEqual({
    command,
    tier: ResourceCommandTier.Denied,
  });
  expect(result.targets).toEqual([]);
  expect(result.requiresHuman).toBeUndefined();
  expect(parse(command).request).toBeUndefined();
  expect(parse(command).errorMessage).toBe(result.reason);

  if (mentions !== undefined) {
    expect(result.reason).toMatch(mentions);
  }

  return result.reason;
}

function filterOf(text: string): XenOrchestraFilterNode {
  const parsed: XenOrchestraFilterParseResult = parseXenOrchestraFilter(text);

  if (!parsed.node) {
    throw new Error(`filter does not parse: ${text}: ${parsed.problem}`);
  }

  return parsed.node;
}

describe("module shape", () => {
  test("is the xo-cli policy for the xo-cli program", () => {
    expect(XcpNgCommandPolicy.name).toBe("xo-cli");
    expect([...XcpNgCommandPolicy.programs]).toEqual(["xo-cli"]);
    expect(XO_CLI_PROGRAM).toBe("xo-cli");
    expect(XO_CLI_REST_COMMAND).toBe("rest");
    expect(XO_REST_API_BASE_PATH).toBe("/rest/v0");
    expect([...XCP_NG_TARGET_KINDS]).toEqual(["vm", "pbd", "host", "schedule"]);
    expect(XcpNgCommandPolicy.refusesAlwaysAskingAllowlistEntries).toBe(true);
  });

  test("the pool's collections and Xen Orchestra's own are told apart", () => {
    expect([...XO_POOL_COLLECTIONS]).toEqual([
      "pools",
      "hosts",
      "vms",
      "vm-controllers",
      "vm-snapshots",
      "vm-templates",
      "srs",
      "pbds",
      "vdis",
      "vdi-snapshots",
      "vbds",
      "vifs",
      "pifs",
      "networks",
      "alarms",
      "messages",
    ]);
    expect([...XO_OWN_COLLECTIONS]).toEqual([
      "tasks",
      "backup-jobs",
      "backup-logs",
      "restore-logs",
      "schedules",
    ]);

    for (const collection of XO_POOL_COLLECTIONS) {
      expect(XO_OWN_COLLECTIONS).not.toContain(collection);
    }
  });

  test("the XCP-ng pool resource type runs xo-cli through this policy", () => {
    const info: (typeof AI_RESOURCE_TYPE_INFO)[AiResourceType.XcpNgPool] =
      AI_RESOURCE_TYPE_INFO[AiResourceType.XcpNgPool];

    expect(info.programs).toEqual(["xo-cli"]);
    expect(info.agentAlias).toBe("xcp-ng");
    expect(info.agentDisplayName).toBe("XCP-ng AI agent");
    expect(info.displayName).toBe("XCP-ng pool");
    expect(info.sentenceName).toBe("XCP-ng pool");
    expect(info.identityEnvVars).toEqual(["XCP_NG_POOL_ID"]);
    expect(info.defaultIdentityPlaceholders).toEqual([]);
    expect(isIdentityResolvedByAgent(AiResourceType.XcpNgPool)).toBe(true);
    expect(ResourceCommandPolicy.getToolPolicy(AiResourceType.XcpNgPool)).toBe(
      XcpNgCommandPolicy,
    );
  });

  test.each([
    ["xcp-ng"],
    ["XCP-NG"],
    ["xcp_ng"],
    ["xcpng"],
    ["xen-orchestra"],
    ["xen_orchestra"],
    ["XcpNgPool"],
    ["xcpngpool"],
  ])("%s selects the XCP-ng pool type", (alias: string) => {
    expect(parseAiResourceType(alias)).toBe(AiResourceType.XcpNgPool);
  });

  test("the Test connection commands are reads of the policy", () => {
    for (const command of AI_RESOURCE_TYPE_INFO[AiResourceType.XcpNgPool]
      .testCommands) {
      expectRead(command);
    }
  });

  test("the guides name every allowed change and say what never runs", () => {
    const read: string = XcpNgCommandPolicy.readCommandGuide;
    const write: string = XcpNgCommandPolicy.writeCommandGuide;

    for (const collection of [...XO_POOL_COLLECTIONS, ...XO_OWN_COLLECTIONS]) {
      expect(read).toContain(`\`${collection}\``);
    }

    expect(read).toContain("filter='!attached?'");
    expect(read).toContain("Never:");

    for (const action of [
      "vms/<uuid>/actions/start",
      "resume",
      "unpause",
      "pbds/<uuid>/actions/plug",
      "schedules/<uuid>/actions/run",
      "clean_reboot",
      "hard_reboot",
      "clean_shutdown",
      "hard_shutdown",
      "suspend",
      "pause",
      "snapshot",
      "hosts/<uuid>/actions/enable",
      "migrate hostId=",
      "restart_toolstack",
    ]) {
      expect(write).toContain(action);
    }

    expect(write).toContain("Always asks a human");
    expect(write).toContain("Never:");
  });

  test("every example command in the guides is judged as the guide says", () => {
    expectRead(
      "xo-cli rest get vms fields=name_label,power_state,$container filter=power_state:Halted",
    );
    expectRead(
      "xo-cli rest get pbds fields=attached,host,SR filter='!attached?'",
    );
    expectRead(
      "xo-cli rest get backup-logs fields=jobName,status,start,result filter=status:failure limit=10",
    );
    expectRead(
      "xo-cli rest get tasks fields=name_label,status,properties,result filter=status:failure limit=20",
    );
  });
});

describe("grammar: xo-cli and its rest command", () => {
  test("a command starts with xo-cli", () => {
    expect(XcpNgCommandPolicy.evaluateArgv(["pvesh", "get", "/"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(XcpNgCommandPolicy.evaluateArgv(["xe", "vm-list"]).reason).toContain(
      'starts with "xo-cli"',
    );
  });

  test("the dispatcher refuses other programs for an XCP-ng pool", () => {
    expect(evaluate("xe vm-list").reason).toContain(
      '"xe" is not a program the XCP-ng AI agent runs',
    );
    expect(evaluate("/usr/bin/xo-cli rest get vms").reason).toContain(
      "without a path",
    );
    expect(evaluate("sudo xo-cli rest get vms").reason).toContain(
      "own permissions",
    );
  });

  test("xo-cli alone, and rest alone, say what to write", () => {
    expectDenied("xo-cli", /xo-cli rest get <path>/);
    expectDenied("xo-cli rest", /xo-cli rest get vms fields=/);
  });

  test.each([
    ["register", "xo-cli register https://xo.example.com admin"],
    ["unregister", "xo-cli unregister"],
    ["create-token", "xo-cli create-token https://xo.example.com admin"],
    ["list-commands", "xo-cli list-commands"],
    ["list-objects", "xo-cli list-objects type=VM"],
    ["watch", "xo-cli watch"],
    ["help", "xo-cli help"],
  ])("xo-cli %s is not available", (name: string, command: string) => {
    expectDenied(command, `xo-cli ${name} is not available`);
  });

  test.each([
    ["xo-cli vm.start id=" + "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c"],
    ["xo-cli vm.delete id=x"],
    ["xo-cli user.getAll"],
    ["xo-cli xo.getAllObjects"],
  ])("the JSON-RPC API is not available: %s", (command: string) => {
    expectDenied(command, /JSON-RPC API/);
  });

  test("another word after xo-cli is not a command", () => {
    expectDenied("xo-cli restful get vms", /not an xo-cli command/);
    expectDenied("xo-cli REST get vms", /not an xo-cli command/);
  });

  test.each([
    ["--au", "xo-cli --au rest get vms", /certificate/],
    [
      "--allowUnauthorized",
      "xo-cli --allowUnauthorized rest get vms",
      /certificate/,
    ],
    [
      "--url",
      "xo-cli --url https://token@xo.example.com rest get vms",
      /its own Xen Orchestra/,
    ],
    [
      "--url=",
      "xo-cli --url=https://xo.example.com rest get vms",
      /its own Xen Orchestra/,
    ],
    ["-u", "xo-cli -u https://xo rest get vms", /its own Xen Orchestra/],
    ["--json before rest", "xo-cli --json rest get vms", /as JSON/],
    ["--json after rest", "xo-cli rest --json get vms", /as JSON/],
    ["--json after the path", "xo-cli rest get vms --json", /as JSON/],
    ["--au after rest", "xo-cli rest --au get vms", /certificate/],
    ["an unknown flag", "xo-cli --verbose rest get vms", /not available/],
  ])("%s is refused", (_: string, command: string, reason: RegExp) => {
    expectDenied(command, reason);
  });

  test.each([
    ["patch", `xo-cli rest patch vms/${VM} name_label=x`, /configuration/],
    ["put", `xo-cli rest put vms/${VM}/tags/prod`, /HTTP PUT/],
    ["del", `xo-cli rest del vms/${VM}`, /deletes/],
    ["delete", `xo-cli rest delete vms/${VM}`, /deleting anything/],
  ])(
    "rest %s is never allowed",
    (_: string, command: string, reason: RegExp) => {
      const why: string = expectDenied(command, reason);

      expect(why).toContain(XCP_NG_ACTIONS_SUMMARY);
    },
  );

  test("an unknown rest command is refused", () => {
    expectDenied("xo-cli rest list vms", /not an xo-cli rest command/);
    expectDenied("xo-cli rest GET vms", /not an xo-cli rest command/);
    expectDenied("xo-cli rest -x vms", /comes right after xo-cli rest/);
  });

  test("get and post need a path", () => {
    expectDenied("xo-cli rest get", /name the path after xo-cli rest get/);
    expectDenied("xo-cli rest post", /name the path after xo-cli rest post/);
  });
});

describe("grammar: the path", () => {
  test.each([
    ["vms"],
    ["/vms"],
    ["vms/"],
    ["/vms/"],
    ["/rest/v0/vms"],
    ["rest/v0/vms"],
    ["/rest/v0/vms/"],
  ])("%s is the vms collection", (path: string) => {
    const built: XenOrchestraApiRequest = request(
      `xo-cli rest get ${path} fields=name_label`,
    );

    expect(built.path).toBe("/vms");
    expect(built.method).toBe("GET");
    expect(built.query).toEqual({ fields: "name_label" });
  });

  test("a path keeps its words as typed in the display, and its canonical form in the request", () => {
    const result: ResourceCommandPolicyResult = expectRead(
      `xo-cli rest get /rest/v0/vms/${VM}/`,
    );

    expect(result.displayCommand).toBe(`xo-cli rest get /rest/v0/vms/${VM}/`);
    expect(request(`xo-cli rest get /rest/v0/vms/${VM}/`).path).toBe(
      `/vms/${VM}`,
    );
  });

  test.each([
    ["'vms?fields=name_label'", /query string/],
    ["'vms?filter=power_state:Halted&fields=name_label'", /query string/],
    ["'vms#top'", /query string/],
    ["vms%2Falarms", /percent-encoded/],
    [`vms/${VM}/../../users`, /"\." or "\.\." segment/],
    ["vms/./x", /"\." or "\.\." segment/],
    ["vms//alarms", /empty/],
    ["'vms alarms'", /character no path/],
    ["vms~", /character no path/],
    ["/", /root of the REST API/],
    ["/rest/v0", /root of the REST API/],
    ["/rest/v0/", /root of the REST API/],
  ])("%s is refused", (path: string, reason: RegExp) => {
    expectDenied(`xo-cli rest get ${path}`, reason);
  });

  test("an over-long path is refused", () => {
    expectDenied(
      `xo-cli rest get vms/${"a".repeat(MAX_XO_API_PATH_CHARS)}`,
      /longer than 300 characters/,
    );
  });

  test("a second path is refused", () => {
    expectDenied("xo-cli rest get vms hosts", /not a parameter/);
    expectDenied(`xo-cli rest get vms/${VM} vms`, /not a parameter/);
  });

  test("a query string is refused with the parameters written out", () => {
    const reason: string = expectDenied(
      "xo-cli rest get 'vms?fields=name_label'",
    );

    expect(reason).toContain(
      "xo-cli rest get vms fields=name_label,power_state filter=power_state:Halted",
    );
  });
});

describe("grammar: parameters", () => {
  test("a parameter before the path is refused", () => {
    expectDenied("xo-cli rest get fields=name_label vms", /before the path/);
  });

  test("a word without = is refused", () => {
    expectDenied("xo-cli rest get vms name_label", /name=value/);
    expectDenied(
      `xo-cli rest get tasks/${TASK} wait`,
      /the agent itself waits/,
    );
  });

  test("a dotted name is refused, as xo-cli would nest it", () => {
    expectDenied(
      `xo-cli rest post vms/${VM}/actions/migrate hostId=${HOST} srIdByVdiId.x=y`,
      /dotted name/,
    );
    expectDenied("xo-cli rest get vms fields.x=y", /dotted name/);
  });

  test("a name that is not a word is refused", () => {
    expectDenied("xo-cli rest get vms 1fields=x", /names are letters/);
    expectDenied("xo-cli rest get vms fi-elds=x", /names are letters/);
  });

  test("an empty value is refused", () => {
    expectDenied("xo-cli rest get vms fields=", /fields= has no value/);
  });

  test("a json: value is refused", () => {
    expectDenied("xo-cli rest get vms 'filter=json:{\"a\":1}'", /plain text/);
  });

  test("a parameter given twice is refused", () => {
    expectDenied(
      "xo-cli rest get vms fields=name_label fields=power_state",
      /more than once/,
    );
  });

  test.each([
    [
      "--output",
      "xo-cli rest get vms --output vms.json",
      /never writes it to a file/,
    ],
    ["-o", "xo-cli rest get vms -o x", /never writes it to a file/],
    [
      "--output=",
      "xo-cli rest get vms --output=x",
      /never writes it to a file/,
    ],
    [
      "--input",
      `xo-cli rest post vms/${VM}/actions/snapshot --input x`,
      /name=value words/,
    ],
    [
      "-i",
      `xo-cli rest post vms/${VM}/actions/snapshot -i x`,
      /name=value words/,
    ],
    ["a short flag", "xo-cli rest get vms -x", /one name=value word/],
  ])("%s is refused", (_: string, command: string, reason: RegExp) => {
    expectDenied(command, reason);
  });

  test.each([
    ["ndjson", "xo-cli rest get vms ndjson=true", /as JSON/],
    ["markdown", "xo-cli rest get vms markdown=true", /as JSON/],
    [
      "sync",
      `xo-cli rest post vms/${VM}/actions/start sync=true`,
      /waits for it itself/,
    ],
    ["wait", `xo-cli rest get tasks/${TASK} wait=true`, /answers at once/],
    ["watch", "xo-cli rest get tasks watch=true", /answers at once/],
    [
      "an unknown name",
      "xo-cli rest get vms sort=name_label",
      /its parameters are fields, filter, limit/,
    ],
  ])(
    "%s is refused with its reason",
    (_: string, command: string, reason: RegExp) => {
      expectDenied(command, reason);
    },
  );

  test("the words of a parameter value are kept as they are", () => {
    expect(
      request(
        "xo-cli rest get vms 'filter=name_label:\"web 01\" power_state:Running'",
      ).query,
    ).toEqual({ filter: 'name_label:"web 01" power_state:Running' });
  });

  test("a value may hold = signs", () => {
    expect(
      request(`xo-cli rest post vms/${VM}/actions/snapshot name_label=a=b`)
        .body,
    ).toEqual({ name_label: "a=b" });
    // complex-matcher reads an unquoted = as the end of a word, as here.
    expect(
      request("xo-cli rest get vms 'filter=name_label:\"a=b\"'").query[
        "filter"
      ],
    ).toBe('name_label:"a=b"');
    expectDenied("xo-cli rest get vms filter=name_label:a=b", /cannot be read/);
  });
});

describe("grammar: what an argv may be", () => {
  test("an empty argv, and words that are not strings, are refused", () => {
    expect(XcpNgCommandPolicy.evaluateArgv([]).reason).toBe("Empty command.");
    expect(
      XcpNgCommandPolicy.evaluateArgv([
        "xo-cli",
        "rest",
        "get",
        7 as unknown as string,
      ]).reason,
    ).toBe("Every word of the command must be a string.");
    expect(parseXcpNgCommand(null as unknown as Array<string>)).toEqual({
      errorMessage: "Empty command.",
    });
  });

  test("too many words, too many characters, a newline or a NUL are refused", () => {
    expect(
      XcpNgCommandPolicy.evaluateArgv([
        "xo-cli",
        "rest",
        "get",
        "vms",
        ...Array.from({ length: 70 }, (_: unknown, i: number): string => {
          return `p${i}=1`;
        }),
      ]).reason,
    ).toContain("at most 64 words");
    expect(
      XcpNgCommandPolicy.evaluateArgv([
        "xo-cli",
        "rest",
        "get",
        `vms`,
        `filter=${"a".repeat(5000)}`,
      ]).reason,
    ).toContain("character limit");
    expect(
      XcpNgCommandPolicy.evaluateArgv(["xo-cli", "rest", "get", "vms\nusers"])
        .reason,
    ).toContain("single line");
    expect(
      XcpNgCommandPolicy.evaluateArgv(["xo-cli", "rest", "get", "vms\0"])
        .reason,
    ).toContain("single line");
  });

  test("shell syntax never reaches the policy", () => {
    for (const command of [
      "xo-cli rest get vms | jq .",
      "xo-cli rest get vms; xo-cli rest del vms/x",
      "xo-cli rest get vms > out",
      "xo-cli rest get vms && rm -rf /",
      "xo-cli rest get $(echo vms)",
      "xo-cli rest get `echo vms`",
    ]) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.Denied);
    }
  });

  test("evaluateArgv and parseXcpNgCommand never throw, whatever they are handed", () => {
    const garbage: Array<unknown> = [
      undefined,
      null,
      42,
      "xo-cli rest get vms",
      {},
      [null],
      [undefined, undefined],
      ["xo-cli", {}],
      ["xo-cli", "rest", ["get"]],
      ["xo-cli", "rest", "get", "\u0000"],
      ["xo-cli", "rest", "get", "vms", "filter=" + "(".repeat(200)],
      ["xo-cli", "rest", "get", "vms", "filter=" + "!".repeat(400) + "a:b"],
      ["xo-cli", "rest", "get", "vms", 'filter="'],
      ["xo-cli", "rest", "get", "vms", "filter=/"],
      ["xo-cli", "rest", "get", "vms", "filter=/(/"],
      [
        "xo-cli",
        "rest",
        "post",
        "vms/x/actions/start",
        "hostId=" + "x".repeat(3000),
      ],
    ];

    for (const value of garbage) {
      expect(() => {
        XcpNgCommandPolicy.evaluateArgv(value as Array<string>);
      }).not.toThrow();
      expect(() => {
        parseXcpNgCommand(value as Array<string>);
      }).not.toThrow();
    }
  });
});

describe("reads: collections", () => {
  test.each(
    XO_POOL_COLLECTIONS.map((c: string) => {
      return [c];
    }),
  )("the pool's %s are read for this pool only", (collection: string) => {
    expectRead(
      `xo-cli rest get ${collection} fields=name_label filter=name_label:x limit=5`,
    );

    const built: XenOrchestraApiRequest = request(
      `xo-cli rest get ${collection} fields=name_label filter=name_label:x limit=5`,
    );

    expect(built).toEqual({
      method: "GET",
      path: `/${collection}`,
      query: { fields: "name_label", filter: "name_label:x", limit: "5" },
      body: null,
      scope: { kind: "collection" },
      change: null,
    });
  });

  test.each(
    XO_OWN_COLLECTIONS.map((c: string) => {
      return [c];
    }),
  )(
    "Xen Orchestra's %s are read as Xen Orchestra keeps them",
    (collection: string) => {
      expectRead(`xo-cli rest get ${collection} filter=status:failure limit=5`);
      expect(request(`xo-cli rest get ${collection} limit=5`).scope).toEqual({
        kind: "none",
      });
    },
  );

  test("a list with no parameters is a read too (Xen Orchestra lists paths)", () => {
    expectRead("xo-cli rest get vms");
    expect(request("xo-cli rest get vms").query).toEqual({});
  });

  test("fields=* asks for whole objects", () => {
    expect(request("xo-cli rest get hosts fields=*").query).toEqual({
      fields: "*",
    });
  });

  test("dotted fields read a property inside another", () => {
    expect(
      request("xo-cli rest get vms fields=name_label,memory.size,$pool").query,
    ).toEqual({ fields: "name_label,memory.size,$pool" });
  });

  test.each([
    ["fields=name_label,,power_state", /no empty one/],
    ["fields=name_label,__proto__", /objects themselves/],
    ["fields=constructor", /objects themselves/],
    ["fields=a.prototype", /objects themselves/],
    ["fields=name_label,po:wer", /letters, digits/],
    [`fields=${"a".repeat(65)}`, /at most 64 characters/],
    [
      `fields=${Array.from(
        { length: MAX_XO_FIELDS + 1 },
        (_: unknown, i: number) => {
          return `f${i}`;
        },
      ).join(",")}`,
      /at most 40 property names/,
    ],
    ["limit=0", /a whole number from 1 to 5000/],
    [`limit=${MAX_XO_LIMIT + 1}`, /a whole number from 1 to 5000/],
    ["limit=01", /a whole number from 1 to 5000/],
    ["limit=-1", /a whole number from 1 to 5000/],
    ["limit=1.5", /a whole number from 1 to 5000/],
    ["limit=ten", /a whole number from 1 to 5000/],
  ])("%s is refused", (param: string, reason: RegExp) => {
    expectDenied(`xo-cli rest get vms ${param}`, reason);
  });

  test("the largest limit is allowed", () => {
    expectRead(`xo-cli rest get messages limit=${MAX_XO_LIMIT}`);
  });

  test("an unknown collection is refused with what may be read", () => {
    const reason: string = expectDenied(
      "xo-cli rest get vm fields=name_label",
      /not a path OneUptime AI may read/,
    );

    expect(reason).toContain(XCP_NG_READABLE_PATHS_SUMMARY);
  });
});

describe("reads: one object", () => {
  test.each(
    XO_POOL_COLLECTIONS.map((c: string) => {
      return [c];
    }),
  )(
    "one of the pool's %s is read with its pool checked",
    (collection: string) => {
      expectRead(`xo-cli rest get ${collection}/${VM}`);
      expect(request(`xo-cli rest get ${collection}/${VM}`)).toEqual({
        method: "GET",
        path: `/${collection}/${VM}`,
        query: {},
        body: null,
        scope: { kind: "object", collection, id: VM },
        change: null,
      });
    },
  );

  test.each([
    ["tasks", TASK],
    ["backup-jobs", JOB],
    ["backup-logs", BACKUP_LOG],
    ["restore-logs", BACKUP_LOG],
    ["schedules", SCHEDULE],
  ])(
    "one of Xen Orchestra's %s is read by its id",
    (collection: string, id: string) => {
      expectRead(`xo-cli rest get ${collection}/${id}`);
      expect(request(`xo-cli rest get ${collection}/${id}`).scope).toEqual({
        kind: "none",
      });
    },
  );

  test.each([
    [`vms/${VM.toUpperCase()}`, /write it in lower case/],
    ["vms/web-01", /a UUID in lower case/],
    ["vms/101", /a UUID in lower case/],
    [`vms/${VM}x`, /a UUID in lower case/],
    ["tasks/0MDD1BASU", /a task id/],
    ["tasks/abc", /a task id/],
    ["backup-logs/abc", /a backup log id/],
    ["restore-logs/12", /a restore log id/],
    ["schedules/daily", /a UUID in lower case/],
  ])("%s is refused", (path: string, reason: RegExp) => {
    expectDenied(`xo-cli rest get ${path}`, reason);
  });

  test("an object takes no parameters", () => {
    expectDenied(
      `xo-cli rest get vms/${VM} fields=name_label`,
      /it takes no parameters/,
    );
    expectDenied(
      `xo-cli rest get tasks/${TASK} limit=1`,
      /it takes no parameters/,
    );
  });

  test("a sub-read without an object names none", () => {
    expectDenied("xo-cli rest get vms/alarms", /names no object/);
    expectDenied("xo-cli rest get hosts/stats", /names no object/);
  });
});

describe("reads: what belongs to an object", () => {
  const ACTIVITY: ReadonlyArray<string> = [
    "pools",
    "hosts",
    "vms",
    "vm-controllers",
    "vm-snapshots",
    "vm-templates",
    "srs",
    "vdis",
    "networks",
    "pifs",
    "vbds",
    "vifs",
  ];

  for (const collection of ACTIVITY) {
    for (const sub of ["alarms", "messages", "tasks"]) {
      test(`${collection}/<uuid>/${sub} is read with its parent's pool checked`, () => {
        expectRead(
          `xo-cli rest get ${collection}/${VM}/${sub} fields=name filter=name:x limit=3`,
        );
        expect(
          request(`xo-cli rest get ${collection}/${VM}/${sub} limit=3`).scope,
        ).toEqual({ kind: "object", collection, id: VM });
      });
    }
  }

  test.each([["vms"], ["vm-controllers"], ["vm-snapshots"], ["vm-templates"]])(
    "%s/<uuid>/vdis is read",
    (collection: string) => {
      expectRead(
        `xo-cli rest get ${collection}/${VM}/vdis fields=name_label,size`,
      );
    },
  );

  test("a VM's backup jobs are read", () => {
    expectRead(`xo-cli rest get vms/${VM}/backup-jobs fields=name,mode`);
  });

  test.each([["pools"], ["hosts"], ["vms"]])(
    "%s/<uuid>/stats is read at any granularity",
    (collection: string) => {
      for (const granularity of ["seconds", "minutes", "hours", "days"]) {
        expect(
          request(
            `xo-cli rest get ${collection}/${VM}/stats granularity=${granularity}`,
          ).query,
        ).toEqual({ granularity });
      }

      expectRead(`xo-cli rest get ${collection}/${VM}/stats`);
      expectDenied(
        `xo-cli rest get ${collection}/${VM}/stats granularity=weeks`,
        /one of seconds, minutes, hours, days/,
      );
      expectDenied(
        `xo-cli rest get ${collection}/${VM}/stats fields=x`,
        /its parameters are granularity/,
      );
    },
  );

  test.each([["pools"], ["vms"]])(
    "%s/<uuid>/dashboard is read",
    (collection: string) => {
      expectRead(`xo-cli rest get ${collection}/${POOL}/dashboard`);
      expectDenied(
        `xo-cli rest get ${collection}/${POOL}/dashboard ndjson=true`,
        /as JSON/,
      );
    },
  );

  test.each([["pools"], ["hosts"]])(
    "%s/<uuid>/missing_patches is read",
    (collection: string) => {
      expectRead(`xo-cli rest get ${collection}/${HOST}/missing_patches`);
    },
  );

  test.each([
    [`pbds/${PBD}/alarms`],
    [`hosts/${HOST}/dashboard`],
    [`srs/${SR}/stats`],
    [`vdis/${VDI}/missing_patches`],
    [`hosts/${HOST}/vdis`],
    [`srs/${SR}/backup-jobs`],
    [`vms/${VM}/smt`],
    [`hosts/${HOST}/smt`],
    [`pools/${POOL}/rolling_update_recovery`],
    [`vms/${VM}/alarms/x`],
    [`tasks/${TASK}/alarms`],
    [`backup-jobs/${JOB}/logs`],
  ])("%s is not a path OneUptime AI may read", (path: string) => {
    expectDenied(`xo-cli rest get ${path}`, /not a path OneUptime AI may read/);
  });

  test("an action is not something to read", () => {
    expectDenied(
      `xo-cli rest get vms/${VM}/actions/start`,
      /an action for xo-cli rest post/,
    );
  });
});

describe("reads: never", () => {
  test.each([
    ["users", /users, groups, roles, privileges and tokens/],
    ["users/me", /users, groups, roles, privileges and tokens/],
    [
      "users/722d17b9-699b-49d2-8193-be1ac573d3de/authentication_tokens",
      /tokens are listed in full/,
    ],
    ["groups", /users, groups/],
    ["acl-roles", /roles/],
    ["acl-privileges", /privileges/],
    ["servers", /connections to the pools' masters/],
    ["servers/63375ed4-6d71-4fce-91b0-0a98921b1f9f", /XAPI user/],
    ["plugins", /secrets included/],
    ["plugins/openmetrics", /secrets included/],
    ["proxies", /proxies are off-limits/],
    ["backup-repositories", /credentials of its storage/],
    ["remotes", /credentials of its storage/],
    ["backup-archives", /off-limits/],
    ["events", /never ends/],
    ["browser-media", /never allowed/],
    ["v2v", /never allowed/],
    ["mcp", /REST API itself/],
    ["docs", /documentation/],
    ["docs/swagger.json", /documentation/],
    ["gui-routes", /interface routes/],
    ["dashboard", /for administrators/],
    ["ping", /checks Xen Orchestra itself/],
    ["sms", /storage managers/],
    ["pcis", /PCI devices/],
    ["pgpus", /GPUs/],
  ])("%s", (path: string, reason: RegExp) => {
    expectDenied(`xo-cli rest get ${path}`, reason);
    expectDenied(`xo-cli rest get /rest/v0/${path}`, reason);
  });

  test("Xen Orchestra's deprecated backup paths point at their replacements", () => {
    for (const path of [
      "backup/jobs/vm",
      "backup/logs",
      `backup/jobs/vm/${JOB}`,
      "backup/jobs/metadata",
    ]) {
      expectDenied(`xo-cli rest get ${path}`, /backup-jobs and backup-logs/);
    }
  });

  test.each([
    [`vms/${VM}.xva`],
    [`vms/${VM}.ova`],
    [`vm-snapshots/${VM}.xva`],
    [`vm-templates/${VM}.xva`],
    [`vdis/${VDI}.vhd`],
    [`vdis/${VDI}.raw`],
    [`vdi-snapshots/${VDI}.qcow2`],
    [`hosts/${HOST}/logs.tgz`],
    [`hosts/${HOST}/audit.txt`],
  ])("the download %s is never allowed", (path: string) => {
    expectDenied(`xo-cli rest get ${path}`, /exports and downloads/);
    expectDenied(`xo-cli rest post ${path}`, /exports and downloads/);
  });

  test("a forbidden path is refused for its reason before a parameter's problem", () => {
    expectDenied("xo-cli rest get users bogus", /users, groups/);
    expectDenied("xo-cli rest get users fields=a fields=b", /users, groups/);
  });
});

describe("filters: Xen Orchestra's grammar", () => {
  test.each([
    [
      "power_state:Halted",
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "power_state",
            child: { type: "word", value: "Halted" },
          },
        ],
      },
    ],
    [
      "!attached?",
      {
        type: "and",
        terms: [{ type: "not", child: { type: "truthy", name: "attached" } }],
      },
    ],
    [
      "! attached?",
      {
        type: "and",
        terms: [{ type: "not", child: { type: "truthy", name: "attached" } }],
      },
    ],
    [
      "|(power_state:Halted power_state:Paused)",
      {
        type: "and",
        terms: [
          {
            type: "or",
            terms: [
              {
                type: "property",
                name: "power_state",
                child: { type: "word", value: "Halted" },
              },
              {
                type: "property",
                name: "power_state",
                child: { type: "word", value: "Paused" },
              },
            ],
          },
        ],
      },
    ],
    [
      "(power_state:Running tags:prod)",
      {
        type: "and",
        terms: [
          {
            type: "and",
            terms: [
              {
                type: "property",
                name: "power_state",
                child: { type: "word", value: "Running" },
              },
              {
                type: "property",
                name: "tags",
                child: { type: "word", value: "prod" },
              },
            ],
          },
        ],
      },
    ],
    [
      'name_label:"web 01"',
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "name_label",
            child: { type: "string", value: "web 01" },
          },
        ],
      },
    ],
    [
      'name_label:"say \\"hi\\""',
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "name_label",
            child: { type: "string", value: 'say "hi"' },
          },
        ],
      },
    ],
    [
      "name_label:/^web-[0-9]+$/i",
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "name_label",
            child: { type: "regex", pattern: "^web-[0-9]+$", flags: "i" },
          },
        ],
      },
    ],
    [
      "memory:(size:>=1073741824)",
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "memory",
            child: {
              type: "and",
              terms: [
                {
                  type: "property",
                  name: "size",
                  child: {
                    type: "comparison",
                    operator: ">=",
                    value: 1073741824,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "name_label:web*",
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "name_label",
            child: { type: "word", value: "web*" },
          },
        ],
      },
    ],
    [
      "name_label : web",
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "name_label",
            child: { type: "word", value: "web" },
          },
        ],
      },
    ],
    [
      `$pool:${POOL}`,
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "$pool",
            child: { type: "word", value: POOL },
          },
        ],
      },
    ],
    [
      "object:type:SR",
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "object",
            child: {
              type: "property",
              name: "type",
              child: { type: "word", value: "SR" },
            },
          },
        ],
      },
    ],
    [
      '"name_label":x',
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "name_label",
            child: { type: "word", value: "x" },
          },
        ],
      },
    ],
    [
      "  power_state:Running   enabled?  ",
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "power_state",
            child: { type: "word", value: "Running" },
          },
          { type: "truthy", name: "enabled" },
        ],
      },
    ],
    [
      "time:<1764100000",
      {
        type: "and",
        terms: [
          {
            type: "property",
            name: "time",
            child: { type: "comparison", operator: "<", value: 1764100000 },
          },
        ],
      },
    ],
  ])(
    "%s parses as complex-matcher reads it",
    (input: string, tree: unknown) => {
      expect(parseXenOrchestraFilter(input)).toEqual({
        node: tree,
        problem: null,
      });
    },
  );

  test.each([
    ["", /empty/],
    ["   ", /empty/],
    ['name_label:"web', /not closed/],
    ["name_label:/web", /not closed/],
    ["name_label:/(/", /not a regular expression/],
    ["time:>abc", /not a number/],
    ["(power_state:Running", /cannot be read/],
    ["power_state:Running)", /cannot be read/],
    ["|power_state:Running", /cannot be read/],
    ["name_label:", /cannot be read/],
    ["!", /cannot be read/],
    ["#x", /cannot be read/],
  ])("%s does not parse", (input: string, problem: RegExp) => {
    const parsed: XenOrchestraFilterParseResult =
      parseXenOrchestraFilter(input);

    expect(parsed.node).toBeNull();
    expect(parsed.problem).toMatch(problem);
  });

  test("a filter that is not text does not parse", () => {
    expect(parseXenOrchestraFilter(5)).toEqual({
      node: null,
      problem: "the filter is not text",
    });
  });

  test("a filter is bounded in length and depth", () => {
    expect(
      parseXenOrchestraFilter(`name_label:${"a".repeat(MAX_XO_FILTER_CHARS)}`)
        .problem,
    ).toContain("at most 500 characters");
    expect(
      parseXenOrchestraFilter(
        `${"(".repeat(MAX_XO_FILTER_DEPTH)}a:b${")".repeat(MAX_XO_FILTER_DEPTH)}`,
      ).problem,
    ).toContain(`at most ${MAX_XO_FILTER_DEPTH} levels`);
    expect(
      parseXenOrchestraFilter(`${"!".repeat(MAX_XO_FILTER_DEPTH + 1)}a?`)
        .problem,
    ).toContain(`at most ${MAX_XO_FILTER_DEPTH} levels`);
    expect(
      parseXenOrchestraFilter(
        `${"(".repeat(MAX_XO_FILTER_DEPTH - 2)}a:b${")".repeat(MAX_XO_FILTER_DEPTH - 2)}`,
      ).node,
    ).not.toBeNull();
  });

  test.each([
    ["(a+)+", /repeats itself/],
    ["(a*)*", /repeats itself/],
    ["(\\w+\\s?)*", /repeats itself/],
    ["((a)+)+", /repeats itself/],
    ["(.*a){2,}", /repeats itself/],
    ["(a)\\1", /back-references/],
    ["(?<n>a)\\k<n>", /back-references/],
    [`${"a".repeat(MAX_XO_FILTER_REGEX_CHARS + 1)}`, /at most 128 characters/],
  ])(
    "the regular expression /%s/ is refused",
    (pattern: string, problem: RegExp) => {
      const parsed: XenOrchestraFilterParseResult = parseXenOrchestraFilter(
        `name_label:/${pattern}/`,
      );

      expect(parsed.problem).toMatch(problem);
    },
  );

  test.each([
    ["^web"],
    ["^web-[0-9]+$"],
    ["(ab)+"],
    ["(?:prod|staging)-[a-z]+"],
    ["[a+*]+"],
    ["a+?b"],
    ["\\d{2,4}"],
    ["^(web|api)\\d+$"],
  ])("the regular expression /%s/ is allowed", (pattern: string) => {
    expect(
      parseXenOrchestraFilter(`name_label:/${pattern}/`).problem,
    ).toBeNull();
  });
});

describe("filters: never on a secret", () => {
  test.each([
    ["hunter2"],
    ['"hunter2"'],
    ["/^hunt/"],
    [">5"],
    ["power_state:Running hunter2"],
    ["!hunter2"],
    ["|(power_state:Running hunter2)"],
    ["(hunter*)"],
    ["*"],
  ])("a term with no property is refused: %s", (input: string) => {
    expect(describeXenOrchestraFilterProblem(filterOf(input))).toMatch(
      /names no property/,
    );
    expectDenied(`xo-cli rest get vms 'filter=${input}'`, /names no property/);
  });

  test.each([
    ["password:x"],
    ["chappassword:x"],
    ["incoming_chappassword?"],
    ["password_secret:x"],
    ["authenticationToken:x"],
    ["token:x"],
    ["sshKey:x"],
    ["private_key:x"],
    ["certificates:x"],
    ["license_params:x"],
    ["cookie:x"],
    ["salt:x"],
    ["Password:x"],
    ['"pass word":x'],
  ])("a credential's name is refused: %s", (input: string) => {
    expect(describeXenOrchestraFilterProblem(filterOf(input))).toMatch(
      /names a credential/,
    );
  });

  test.each([
    ["device_config:(server:nfs)"],
    ["Device-Config:x"],
    ["xenStoreData:x"],
    ["other:x"],
    ["other_config:x"],
    ["otherConfig:x"],
    ["sm_config:x"],
    ["PV_args:x"],
    ["PV_bootloader_args:x"],
    ["bios_strings:x"],
    ["platform:x"],
    ["notes:x"],
    ["properties:(params:x)"],
    ["result:x"],
    ["tasks:x"],
    ["settings:x"],
    ["data:x"],
    ["infos:x"],
    ["warnings:x"],
    ["params:x"],
    ["args:x"],
    ["logging:x"],
    ["user_data:x"],
    ["xenStoreData?"],
    ["!other?"],
    ['"device_config":x'],
  ])("a free-form bag is refused: %s", (input: string) => {
    expect(describeXenOrchestraFilterProblem(filterOf(input))).toMatch(
      /free-form configuration/,
    );
  });

  test("a secret one level down is refused too", () => {
    expect(
      describeXenOrchestraFilterProblem(filterOf("memory:(password:x)")),
    ).toMatch(/names a credential/);
    expect(
      describeXenOrchestraFilterProblem(filterOf("object:(device_config:x)")),
    ).toMatch(/free-form configuration/);
    expect(
      describeXenOrchestraFilterProblem(
        filterOf("|(power_state:Running !xenStoreData?)"),
      ),
    ).toMatch(/free-form configuration/);
  });

  test("the secret-probing filters an injected instruction would try are refused", () => {
    for (const filter of [
      "device_config:(password:/^h/)",
      "device_config:/^h/",
      "other:(cloud-init:/pass/)",
      "xenStoreData:(vm-data/root-password:a*)",
      "properties:(params:(password:/^a/))",
      "/hunter/",
      "hunter*",
    ]) {
      expect(evaluate(`xo-cli rest get pbds 'filter=${filter}'`).tier).toBe(
        ResourceCommandTier.Denied,
      );
    }
  });

  test.each([
    ["power_state:Halted"],
    ["!attached?"],
    ["attached?"],
    ["name_label:/^web/"],
    ["tags:prod"],
    ["status:failure"],
    ["|(status:failure status:interrupted)"],
    ["memory:(size:>1073741824)"],
    ["CPUs:(number:>=4)"],
    ["object:(type:SR)"],
    ["body:(name:cpu_usage)"],
    [`$pool:${POOL}`],
    [`$container:${HOST}`],
    [`host:${HOST} SR:${SR}`],
    ["SR_type:nfs shared?"],
    ["power_state:Running !tags:test"],
    ["enabled? power_state:Running"],
    ["jobName:/nightly/ status:failure"],
    ["name:VM_STARTED"],
    ["time:>1764100000"],
  ])(
    "a filter on named, harmless properties is allowed: %s",
    (input: string) => {
      expect(describeXenOrchestraFilterProblem(filterOf(input))).toBeNull();
      expectRead(`xo-cli rest get vms 'filter=${input}'`);
    },
  );
});

describe("writes: safe changes", () => {
  test("starting a VM is safe and targets it", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      `xo-cli rest post vms/${VM}/actions/start`,
    );

    expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(result.targets).toEqual([`vm/${VM}`]);
    expect(result.verb).toBe("vm start");
    expect(result.requiresHuman).toBeUndefined();
    expect(result.reason).toBe(
      `starts VM ${VM}: one named VM, and shutting it down again undoes it`,
    );
    expect(request(`xo-cli rest post vms/${VM}/actions/start`)).toEqual({
      method: "POST",
      path: `/vms/${VM}/actions/start`,
      query: {},
      body: {},
      scope: { kind: "object", collection: "vms", id: VM },
      change: {
        collection: "vms",
        id: VM,
        action: "start",
        mustBeInPool: true,
        destinationHostId: null,
        alreadyWhen: { property: "power_state", values: ["Running"] },
        requires: { property: "power_state", values: ["Halted"] },
        privileges: ["vm:start"],
      },
    });
  });

  test("starting a VM on a named host passes it, and needs host:allow-vm too", () => {
    const built: XenOrchestraApiRequest = request(
      `xo-cli rest post vms/${VM}/actions/start hostId=${HOST}`,
    );

    expect(built.body).toEqual({ hostId: HOST });
    expect(built.change?.privileges).toEqual(["vm:start", "host:allow-vm"]);
    expect(
      evaluate(`xo-cli rest post vms/${VM}/actions/start hostId=${HOST}`)
        .reason,
    ).toContain(`on host ${HOST}`);
    expectDenied(
      `xo-cli rest post vms/${VM}/actions/start hostId=xcp-prod-01`,
      /a UUID in lower case/,
    );
  });

  test.each([
    ["resume", "Suspended", "vm:resume"],
    ["unpause", "Paused", "vm:unpause"],
  ])("%s is safe", (action: string, needs: string, privilege: string) => {
    const result: ResourceCommandPolicyResult = evaluate(
      `xo-cli rest post vms/${VM}/actions/${action}`,
    );

    expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(result.targets).toEqual([`vm/${VM}`]);

    const built: XenOrchestraApiRequest = request(
      `xo-cli rest post vms/${VM}/actions/${action}`,
    );

    expect(built.change?.requires).toEqual({
      property: "power_state",
      values: [needs],
    });
    expect(built.change?.alreadyWhen).toEqual({
      property: "power_state",
      values: ["Running"],
    });
    expect(built.change?.privileges).toEqual([privilege]);
  });

  test("plugging a PBD (re-plugging a storage repository on its host) is safe", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      `xo-cli rest post pbds/${PBD}/actions/plug`,
    );

    expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(result.targets).toEqual([`pbd/${PBD}`]);
    expect(result.verb).toBe("pbd plug");
    expect(result.reason).toContain("attaching its storage repository");

    const built: XenOrchestraApiRequest = request(
      `xo-cli rest post pbds/${PBD}/actions/plug`,
    );

    expect(built.scope).toEqual({
      kind: "object",
      collection: "pbds",
      id: PBD,
    });
    expect(built.change).toEqual({
      collection: "pbds",
      id: PBD,
      action: "plug",
      mustBeInPool: true,
      destinationHostId: null,
      alreadyWhen: { property: "attached", values: [true] },
      requires: null,
      privileges: ["pbd:plug"],
    });
  });

  test("running a backup schedule again is safe, and Xen Orchestra's, not a pool's", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      `xo-cli rest post schedules/${SCHEDULE}/actions/run`,
    );

    expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(result.targets).toEqual([`schedule/${SCHEDULE}`]);
    expect(result.reason).toContain("retention");

    const built: XenOrchestraApiRequest = request(
      `xo-cli rest post schedules/${SCHEDULE}/actions/run`,
    );

    expect(built.scope).toEqual({ kind: "none" });
    expect(built.change?.mustBeInPool).toBe(false);
    expect(built.change?.privileges).toEqual(["schedule:run"]);
  });
});

describe("writes: riskier changes", () => {
  test.each([
    ["clean_reboot", "vm:reboot:clean", null],
    ["hard_reboot", "vm:reboot:hard", null],
    ["clean_shutdown", "vm:shutdown:clean", "Halted"],
    ["hard_shutdown", "vm:shutdown:hard", "Halted"],
    ["suspend", "vm:suspend", "Suspended"],
    ["pause", "vm:pause", "Paused"],
  ])(
    "%s is riskier",
    (action: string, privilege: string, already: string | null) => {
      const result: ResourceCommandPolicyResult = evaluate(
        `xo-cli rest post vms/${VM}/actions/${action}`,
      );

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.targets).toEqual([`vm/${VM}`]);
      expect(result.verb).toBe(`vm ${action}`);

      const built: XenOrchestraApiRequest = request(
        `xo-cli rest post vms/${VM}/actions/${action}`,
      );

      expect(built.change?.privileges).toEqual([privilege]);
      expect(built.change?.alreadyWhen).toEqual(
        already ? { property: "power_state", values: [already] } : null,
      );
    },
  );

  test("a snapshot is riskier, and may be named", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      `xo-cli rest post vms/${VM}/actions/snapshot 'name_label=before fix'`,
    );

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.reason).toContain('named "before fix"');
    expect(result.reason).toContain("never does");
    expect(
      request(
        `xo-cli rest post vms/${VM}/actions/snapshot 'name_label=before fix'`,
      ).body,
    ).toEqual({ name_label: "before fix" });
    expect(request(`xo-cli rest post vms/${VM}/actions/snapshot`).body).toEqual(
      {},
    );
    expectDenied(
      `xo-cli rest post vms/${VM}/actions/snapshot name_label=${"a".repeat(MAX_XO_SNAPSHOT_NAME_CHARS + 1)}`,
      /a name of 1 to 128 characters/,
    );
    expect(
      XcpNgCommandPolicy.evaluateArgv([
        "xo-cli",
        "rest",
        "post",
        `vms/${VM}/actions/snapshot`,
        "name_label=a\tb",
      ]).reason,
    ).toContain("no control character");
  });

  test("enabling a host is riskier and targets it", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      `xo-cli rest post hosts/${HOST}/actions/enable`,
    );

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.targets).toEqual([`host/${HOST}`]);
    expect(result.reason).toContain("HA may place VMs");
    expect(
      request(`xo-cli rest post hosts/${HOST}/actions/enable`).change
        ?.alreadyWhen,
    ).toEqual({ property: "enabled", values: [true] });
  });

  test("an action takes only its own parameters", () => {
    expectDenied(
      `xo-cli rest post vms/${VM}/actions/clean_reboot force=true`,
      /it takes no parameters/,
    );
    expectDenied(
      `xo-cli rest post pbds/${PBD}/actions/plug hostId=${HOST}`,
      /it takes no parameters/,
    );
  });
});

describe("writes: always a human", () => {
  test("a migration within the pool always asks a human", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      `xo-cli rest post vms/${VM}/actions/migrate hostId=${OTHER_HOST}`,
    );

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.requiresHuman).toBe(true);
    expect(result.targets).toEqual([`vm/${VM}`]);
    expect(result.reason).toContain(`to host ${OTHER_HOST} within the pool`);

    const built: XenOrchestraApiRequest = request(
      `xo-cli rest post vms/${VM}/actions/migrate hostId=${OTHER_HOST}`,
    );

    expect(built.body).toEqual({ hostId: OTHER_HOST });
    expect(built.change?.destinationHostId).toBe(OTHER_HOST);
    expect(built.change?.privileges).toEqual([
      "vm:migrate-send",
      "host:migrate-receive",
    ]);
  });

  test("a migration needs its destination, within the pool only", () => {
    expectDenied(`xo-cli rest post vms/${VM}/actions/migrate`, /needs hostId=/);
    expectDenied(
      `xo-cli rest post vms/${VM}/actions/migrate hostId=${OTHER_HOST} srId=${SR}`,
      /within the pool/,
    );
    expectDenied(
      `xo-cli rest post vms/${VM}/actions/migrate hostId=${OTHER_HOST} migrationNetworkId=${SR}`,
      /within the pool/,
    );
    expectDenied(
      `xo-cli rest post vms/${VM}/actions/migrate hostId=${OTHER_HOST} bypassCpuCheck=true`,
      /may crash/,
    );
  });

  test("a toolstack restart always asks a human, and never skips the backup check", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      `xo-cli rest post hosts/${HOST}/actions/restart_toolstack`,
    );

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.requiresHuman).toBe(true);
    expect(result.targets).toEqual([`host/${HOST}`]);
    expectDenied(
      `xo-cli rest post hosts/${HOST}/actions/restart_toolstack bypassBackupCheck=true`,
      /bypassBackupCheck is never allowed/,
    );
  });
});

describe("writes: never", () => {
  test.each([
    ["revert_snapshot", /discards everything written since the snapshot/],
    ["clone", /creates a VM/],
    ["insert_browser_iso", /changes what the VM boots/],
  ])("a VM's %s is never allowed", (action: string, reason: RegExp) => {
    expectDenied(`xo-cli rest post vms/${VM}/actions/${action}`, reason);
  });

  test("an action a VM does not have is refused with the ones it has", () => {
    const reason: string = expectDenied(
      `xo-cli rest post vms/${VM}/actions/destroy`,
    );

    expect(reason).toContain(
      "it may start, resume, unpause, clean_reboot, hard_reboot, clean_shutdown, hard_shutdown, suspend, pause, snapshot, migrate",
    );
  });

  test.each([
    ["disable", /HA and new VMs stop using it/],
    ["evacuate", /moves every VM on it/],
    ["clean_shutdown", /every VM on it goes down/],
    ["emergency_shutdown", /every VM on it goes down/],
    ["clean_reboot", /every VM on it goes down/],
    ["smart_reboot", /every VM on it goes down/],
    ["start", /powering a host on/],
    ["detach", /ejecting a host/],
    ["forget", /forgetting a host/],
    ["management_reconfigure", /management interface/],
    ["move_management_ip", /management interface/],
    ["scan_pifs", /network configuration/],
    ["probe_nfs", /probing storage/],
    ["probe_iscsi_iqns", /probing storage/],
    ["probe_hba_exists", /probing storage/],
  ])("a host's %s is never allowed", (action: string, reason: RegExp) => {
    expectDenied(`xo-cli rest post hosts/${HOST}/actions/${action}`, reason);
  });

  test("an action a host does not have is refused with the ones it has", () => {
    expect(
      expectDenied(`xo-cli rest post hosts/${HOST}/actions/reboot`),
    ).toContain("it may enable, restart_toolstack");
  });

  test("unplugging storage is never allowed", () => {
    expectDenied(
      `xo-cli rest post pbds/${PBD}/actions/unplug`,
      /lose their disks/,
    );
  });

  test.each([
    ["rolling_reboot"],
    ["rolling_update"],
    ["emergency_shutdown"],
    ["create_network"],
    ["create_vm"],
    ["add_host"],
    ["management_reconfigure"],
    ["finalize_rolling_update"],
    ["import_vms_from_vmware"],
  ])("the pool-wide %s is never allowed", (action: string) => {
    expectDenied(
      `xo-cli rest post pools/${POOL}/actions/${action}`,
      /actions on a whole pool/,
    );
  });

  test("creating a VM in a pool is never allowed", () => {
    expectDenied(`xo-cli rest post pools/${POOL}/vms`, /creating a VM/);
  });

  test.each([
    [`srs/${SR}/actions/scan`, /storage repository/],
    [`srs/${SR}/actions/forget`, /storage repository/],
    [`srs/${SR}/actions/reclaim_space`, /storage repository/],
    [`srs/${SR}/actions/import_vdi_from_url`, /storage repository/],
    [`srs/${SR}/vdis`, /storage repository/],
    [`vdis/${VDI}/actions/migrate`, /virtual disk/],
    [`vbds/${VDI}/actions/connect`, /disks or network interfaces/],
    [`vifs/${VDI}/actions/disconnect`, /disks or network interfaces/],
    [`networks/${VDI}/actions/x`, /networks/],
    [`pifs/${VDI}/actions/x`, /networks/],
    [`tasks/${TASK}/actions/abort`, /tasks/],
    [`backup-jobs/${JOB}/actions/run`, /run its schedule/],
    [`vm-snapshots/${VM}/actions/x`, /snapshots, templates/],
    [`vm-templates/${VM}/actions/x`, /snapshots, templates/],
    [`vm-controllers/${VM}/actions/x`, /snapshots, templates/],
  ])("post %s is never allowed", (path: string, reason: RegExp) => {
    expectDenied(`xo-cli rest post ${path}`, reason);
  });

  test.each([
    ["vms"],
    ["srs"],
    ["backup-jobs"],
    ["schedules"],
    ["pools"],
    ["hosts"],
  ])("creating %s is never allowed", (collection: string) => {
    expectDenied(
      `xo-cli rest post ${collection}`,
      /creating .* is never allowed/,
    );
  });

  test.each([
    ["users"],
    ["servers/63375ed4-6d71-4fce-91b0-0a98921b1f9f/actions/connect"],
    ["acl-roles"],
    ["plugins/openmetrics/actions/load"],
  ])("post %s is refused for its reason", (path: string) => {
    expectDenied(`xo-cli rest post ${path}`, /off-limits|never/);
  });

  test("a post on a path to read says to read it", () => {
    expectDenied(`xo-cli rest post vms/${VM}`, /is a path to read/);
    expectDenied(`xo-cli rest post vms/${VM}/alarms`, /is a path to read/);
  });

  test("a post on another shape is refused with what post may do", () => {
    expect(
      expectDenied(`xo-cli rest post vms/${VM}/actions/start/now`),
    ).toContain(XCP_NG_ACTIONS_SUMMARY);
  });

  test("an action's object is a lower-case UUID", () => {
    expectDenied(
      `xo-cli rest post vms/${VM.toUpperCase()}/actions/start`,
      /write it in lower case/,
    );
    expectDenied(
      "xo-cli rest post vms/web-01/actions/start",
      /a UUID in lower case/,
    );
    expectDenied(
      `xo-cli rest post schedules/daily/actions/run`,
      /a UUID in lower case/,
    );
  });
});

describe("the ladder", () => {
  function ladder(
    command: string,
    options: { bypassApproval?: boolean; allowlist?: Array<string> } = {},
  ): ResourceAutoExecutionVerdict {
    return ResourceCommandPolicy.evaluateForAutoExecution({
      resourceType: AiResourceType.XcpNgPool,
      command,
      allowlistPatterns: options.allowlist || [],
      bypassApproval: options.bypassApproval === true,
    });
  }

  test("a read and a safe change run unattended; a riskier one asks", () => {
    expect(ladder("xo-cli rest get vms fields=name_label").verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(ladder(`xo-cli rest post vms/${VM}/actions/start`).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(ladder(`xo-cli rest post pbds/${PBD}/actions/plug`).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(
      ladder(`xo-cli rest post vms/${VM}/actions/clean_reboot`).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
  });

  test("bypassing approvals runs a riskier change, never one that always asks", () => {
    expect(
      ladder(`xo-cli rest post vms/${VM}/actions/clean_reboot`, {
        bypassApproval: true,
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);

    const migrate: ResourceAutoExecutionVerdict = ladder(
      `xo-cli rest post vms/${VM}/actions/migrate hostId=${OTHER_HOST}`,
      { bypassApproval: true },
    );

    expect(migrate.verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(migrate.requiresHuman).toBe(true);
  });

  test("an exact allowlist entry pre-approves that one riskier change", () => {
    const entry: string = `xo-cli rest post vms/${VM}/actions/clean_reboot`;

    expect(ladder(entry, { allowlist: [entry] }).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(
      ladder(`xo-cli rest post vms/${VM}/actions/hard_reboot`, {
        allowlist: [entry],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
  });

  test("a denied command never runs, whatever approves it", () => {
    const verdict: ResourceAutoExecutionVerdict = ladder(
      `xo-cli rest del vms/${VM}`,
      { bypassApproval: true, allowlist: [`xo-cli rest del vms/${VM}`] },
    );

    expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
    expect(verdict.reason).toContain("cannot run even with human approval");
  });
});

describe("the allowlist", () => {
  function problem(pattern: string): string | null {
    return ResourceCommandPolicy.describeAllowlistPatternProblem({
      resourceType: AiResourceType.XcpNgPool,
      pattern,
    });
  }

  test("an exact riskier change is a valid entry, and not broad", () => {
    const entry: string = `xo-cli rest post vms/${VM}/actions/clean_reboot`;

    expect(problem(entry)).toBeNull();
    expect(
      ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType: AiResourceType.XcpNgPool,
        pattern: entry,
      }),
    ).toBe(false);
  });

  test("a change that always asks a person is refused as an entry", () => {
    expect(
      problem(
        `xo-cli rest post vms/${VM}/actions/migrate hostId=${OTHER_HOST}`,
      ),
    ).toContain("a human always decides");
    expect(
      problem(`xo-cli rest post hosts/${HOST}/actions/restart_toolstack`),
    ).toContain("pre-approves nothing");
  });

  test("a read is refused as an entry", () => {
    expect(problem("xo-cli rest get vms fields=name_label")).toContain(
      "read-only command",
    );
  });

  test("an entry with a * where the path goes can never match", () => {
    expect(problem("xo-cli rest post *")).toContain("can never match");
    expect(problem("xo-cli rest post * hostId=*")).toContain("can never match");
    expect(problem("xo-cli rest * x")).toContain("can never match");
    expect(problem("xo-cli * post x")).toContain(
      "has a * where the command goes",
    );
  });

  test("a denied change is refused as an entry", () => {
    expect(problem(`xo-cli rest del vms/${VM}`)).toContain("can never match");
  });
});

describe("the write scope", () => {
  const reboot: ResourceCommandPolicyResult = evaluate(
    `xo-cli rest post vms/${VM}/actions/clean_reboot`,
  );
  const plug: ResourceCommandPolicyResult = evaluate(
    `xo-cli rest post pbds/${PBD}/actions/plug`,
  );

  function refusal(data: {
    result: ResourceCommandPolicyResult;
    allowWrites?: boolean;
    writeTargets?: Array<string>;
    protectedTargets?: Array<string>;
  }): string | null {
    return ResourceCommandPolicy.getWriteScopeRefusal({
      result: data.result,
      allowWrites: data.allowWrites !== false,
      writeTargets: data.writeTargets || [],
      protectedTargets: data.protectedTargets || [],
      resourceType: AiResourceType.XcpNgPool,
    });
  }

  test("a read-only agent refuses every change", () => {
    expect(refusal({ result: reboot, allowWrites: false })).toContain(
      "The XCP-ng AI agent for this XCP-ng pool is read-only",
    );
    expect(
      refusal({
        result: evaluate("xo-cli rest get vms"),
        allowWrites: false,
      }),
    ).toBeNull();
  });

  test("a protected VM is protected by its UUID alone, its target or a glob", () => {
    for (const entry of [
      VM,
      `vm/${VM}`,
      "vm/e8a5*",
      "e8a5b2c1-*",
      VM.toUpperCase(),
    ]) {
      expect(refusal({ result: reboot, protectedTargets: [entry] })).toContain(
        "which the XCP-ng AI agent protects",
      );
    }

    expect(
      refusal({ result: reboot, protectedTargets: [`vm/${OTHER_HOST}`] }),
    ).toBeNull();
    expect(
      refusal({ result: reboot, protectedTargets: [OTHER_HOST] }),
    ).toBeNull();
  });

  test("a protected target's refusal says what to protect", () => {
    expect(refusal({ result: reboot, protectedTargets: [VM] })).toContain(
      "the VM it runs in and of Xen Orchestra's own VM",
    );
  });

  test("write targets allow by kind, by target or by a UUID alone", () => {
    expect(refusal({ result: reboot, writeTargets: ["vm/*"] })).toBeNull();
    expect(refusal({ result: plug, writeTargets: ["vm/*"] })).toContain(
      "outside the targets",
    );
    expect(
      refusal({ result: plug, writeTargets: ["vm/*", "pbd/*"] }),
    ).toBeNull();
    expect(refusal({ result: reboot, writeTargets: [VM] })).toBeNull();
    expect(refusal({ result: reboot, writeTargets: [`vm/${VM}`] })).toBeNull();
    expect(refusal({ result: reboot, writeTargets: [OTHER_HOST] })).toContain(
      "outside the targets",
    );
  });

  test("an entry that names nothing the agent changes is a problem, so the agent stays read-only", () => {
    const describe: (entry: string) => string | null = (
      entry: string,
    ): string | null => {
      return (
        XcpNgCommandPolicy.describeTargetEntryProblem as (
          entry: string,
        ) => string | null
      )(entry);
    };

    for (const entry of [
      "xoa",
      "web-01",
      "Xen Orchestra",
      "vm/web-01",
      "vdi/*",
    ]) {
      expect(describe(entry)).toContain(
        "names nothing the XCP-ng AI agent changes",
      );
    }

    for (const entry of ["101", "abc", "vm/dead"]) {
      expect(describe(entry)).toContain("is not a UUID");
    }

    for (const entry of [
      "*",
      "",
      VM,
      `vm/${VM}`,
      "vm/*",
      "host/*",
      "pbd/*",
      "schedule/*",
      "*/e8a5*",
      "e8a5*",
      `VM/${VM.toUpperCase()}`,
    ]) {
      expect(describe(entry)).toBeNull();
    }
  });
});

describe("parse and judge are one analysis", () => {
  const CORPUS: ReadonlyArray<string> = [
    "xo-cli rest get vms fields=name_label,power_state filter=power_state:Halted",
    "xo-cli rest get pbds fields=attached,host,SR filter='!attached?'",
    `xo-cli rest get vms/${VM}`,
    `xo-cli rest get pools/${POOL}/alarms limit=5`,
    `xo-cli rest get hosts/${HOST}/stats granularity=hours`,
    "xo-cli rest get backup-logs filter=status:failure limit=10",
    `xo-cli rest get tasks/${TASK}`,
    `xo-cli rest post vms/${VM}/actions/start`,
    `xo-cli rest post vms/${VM}/actions/start hostId=${HOST}`,
    `xo-cli rest post vms/${VM}/actions/clean_shutdown`,
    `xo-cli rest post vms/${VM}/actions/snapshot name_label=x`,
    `xo-cli rest post vms/${VM}/actions/migrate hostId=${OTHER_HOST}`,
    `xo-cli rest post pbds/${PBD}/actions/plug`,
    `xo-cli rest post schedules/${SCHEDULE}/actions/run`,
    `xo-cli rest post hosts/${HOST}/actions/enable`,
    `xo-cli rest post hosts/${HOST}/actions/restart_toolstack`,
    "xo-cli rest get users",
    `xo-cli rest del vms/${VM}`,
    `xo-cli rest post vms/${VM}/actions/revert_snapshot`,
    "xo-cli rest get vms filter=hunter2",
    "xo-cli rest get 'vms?fields=x'",
    `xo-cli rest post pbds/${PBD}/actions/unplug`,
    "xo-cli vm.start id=x",
  ];

  test.each(
    CORPUS.map((c: string) => {
      return [c];
    }),
  )("%s: a request exactly when the policy allows it", (command: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);
    const parsed: XcpNgCommandParseResult = parse(command);

    if (result.tier === ResourceCommandTier.Denied) {
      expect(parsed.request).toBeUndefined();
      expect(parsed.errorMessage).toBe(result.reason);
      return;
    }

    expect(parsed.errorMessage).toBeUndefined();
    expect(parsed.request?.method).toBe(
      result.tier === ResourceCommandTier.Read ? "GET" : "POST",
    );
    expect(parsed.request?.change === null).toBe(
      result.tier === ResourceCommandTier.Read,
    );
  });

  test("the request handed out is a copy: changing it changes nothing next time", () => {
    const command: string = `xo-cli rest post vms/${VM}/actions/start hostId=${HOST}`;
    const first: XenOrchestraApiRequest = request(command);

    first.body!["hostId"] = "evil";
    first.query["x"] = "y";
    (first.change!.privileges as Array<string>).push("vm:*");
    (first.change!.alreadyWhen!.values as Array<string | boolean>).push("x");

    const second: XenOrchestraApiRequest = request(command);

    expect(second.body).toEqual({ hostId: HOST });
    expect(second.query).toEqual({});
    expect(second.change?.privileges).toEqual(["vm:start", "host:allow-vm"]);
    expect(second.change?.alreadyWhen?.values).toEqual(["Running"]);
  });

  test("the policy never changes the argv it is handed", () => {
    const argv: Array<string> = tokens(
      `xo-cli rest post vms/${VM}/actions/start hostId=${HOST}`,
    );
    const copy: Array<string> = argv.slice();

    XcpNgCommandPolicy.evaluateArgv(argv);
    parseXcpNgCommand(argv);

    expect(argv).toEqual(copy);
  });

  test("every display command round-trips through the tokenizer", () => {
    for (const command of CORPUS) {
      const result: ResourceCommandPolicyResult = evaluate(command);

      if (result.tier === ResourceCommandTier.Denied) {
        continue;
      }

      expect(tokens(result.displayCommand)).toEqual(tokens(command));
    }
  });

  test("the program and its arguments are the argv, unchanged", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      "xo-cli rest get /rest/v0/vms/ fields=name_label",
    );

    expect(result.program).toBe("xo-cli");
    expect(result.args).toEqual([
      "rest",
      "get",
      "/rest/v0/vms/",
      "fields=name_label",
    ]);
  });
});
