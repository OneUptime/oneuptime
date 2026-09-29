import ResourceCommandPolicy, {
  RESOURCE_ALLOWLIST_MAX_PATTERNS,
  RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  renderResourceDisplayCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import DockerEngineCommandPolicy from "../../../../Utils/AiRemediation/Resource/DockerEngineCommandPolicy";
import DockerSwarmCommandPolicy from "../../../../Utils/AiRemediation/Resource/DockerSwarmCommandPolicy";
import ProxmoxCommandPolicy from "../../../../Utils/AiRemediation/Resource/ProxmoxCommandPolicy";
import GovcCommandPolicy from "../../../../Utils/AiRemediation/Resource/GovcCommandPolicy";
import CephCommandPolicy from "../../../../Utils/AiRemediation/Resource/CephCommandPolicy";
import DatabaseCommandPolicy from "../../../../Utils/AiRemediation/Resource/DatabaseCommandPolicy";
import HostCommandPolicy from "../../../../Utils/AiRemediation/Resource/HostCommandPolicy";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test — ResourceCommandPolicy, the dispatcher every caller
 * uses (server tools, the enqueue chokepoint, the approval path, the
 * dashboard form and the agent).
 *
 * - Routing: each resource type reaches its tool policy; a command whose
 *   first word is not one of the type's programs is Denied before any tool
 *   policy reads it; the Wave 1 stubs deny everything.
 * - Fail-closed argv handling: garbage, oversized, multi-line and
 *   privilege-escalating argvs are Denied without reaching the tool, and a
 *   tool that throws or answers nonsense is read as Denied.
 * - The ladder, the allowlist (validity, matching, broadness) and the
 *   agent's write scope, exercised against a fake tool policy with a real
 *   grammar so every branch is reachable while the stubs deny everything.
 */

// A number, as a memory limit or an OSD id is written.
const DIGITS: RegExp = /^[0-9]+$/;

/*
 * A tiny docker-like grammar: enough shapes to reach every branch of the
 * dispatcher. The real kits replace the stubs; this never ships.
 */
const FAKE_DOCKER: ResourceToolPolicy = {
  name: "fake-docker",
  programs: ["docker"],
  readCommandGuide: "- docker ps",
  writeCommandGuide: "- docker restart NAME (safe)",
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    const [program, verb, ...rest] = argv;
    const base: Omit<ResourceCommandPolicyResult, "tier" | "reason"> = {
      program: program || "",
      args: argv.slice(1),
      verb: verb || "",
      displayCommand: renderResourceDisplayCommand(argv),
      targets: [],
    };

    if (verb === "ps" && rest.length <= 1) {
      return {
        ...base,
        tier: ResourceCommandTier.Read,
        reason: "lists containers",
      };
    }

    if (verb === "restart" && rest.length === 1) {
      return {
        ...base,
        tier: ResourceCommandTier.SafeWrite,
        reason: "restarts one container",
        targets: [rest[0]!],
      };
    }

    if (verb === "stop" && rest.length === 1) {
      return {
        ...base,
        tier: ResourceCommandTier.RiskyWrite,
        reason: "stops one container",
        targets: [rest[0]!],
      };
    }

    if (verb === "kill" && rest.length === 1) {
      return {
        ...base,
        tier: ResourceCommandTier.RiskyWrite,
        reason: "kills one container",
        targets: [rest[0]!],
        requiresHuman: true,
      };
    }

    if (
      verb === "update" &&
      rest.length === 3 &&
      rest[0] === "--memory" &&
      DIGITS.test(rest[1]!)
    ) {
      return {
        ...base,
        tier: ResourceCommandTier.RiskyWrite,
        reason: "changes one container's memory limit",
        targets: [rest[2]!],
      };
    }

    if (verb === "system" && rest[0] === "prune" && rest.length === 1) {
      return {
        ...base,
        tier: ResourceCommandTier.RiskyWrite,
        reason: "prunes the engine",
        targets: [],
      };
    }

    return deniedResult(argv, `docker ${verb || ""} is not allowed`);
  },
};

// A ceph-like grammar whose target must be a number (an OSD id).
const FAKE_CEPH: ResourceToolPolicy = {
  name: "fake-ceph",
  programs: ["ceph"],
  readCommandGuide: "- ceph health",
  writeCommandGuide: "- ceph osd out ID (risky)",
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    if (argv[1] === "health" && argv.length === 2) {
      return {
        tier: ResourceCommandTier.Read,
        reason: "shows health",
        program: "ceph",
        args: argv.slice(1),
        verb: "health",
        displayCommand: renderResourceDisplayCommand(argv),
        targets: [],
      };
    }

    if (
      argv[1] === "osd" &&
      argv[2] === "out" &&
      argv.length === 4 &&
      DIGITS.test(argv[3]!)
    ) {
      return {
        tier: ResourceCommandTier.RiskyWrite,
        reason: "marks one OSD out",
        program: "ceph",
        args: argv.slice(1),
        verb: "osd out",
        displayCommand: renderResourceDisplayCommand(argv),
        targets: [`osd.${argv[3]}`],
      };
    }

    return deniedResult(argv, "not a ceph command this fake knows");
  },
};

function useFakeTools(): jest.SpyInstance {
  return jest
    .spyOn(ResourceCommandPolicy, "getToolPolicy")
    .mockImplementation((type: AiResourceType): ResourceToolPolicy => {
      return type === AiResourceType.CephCluster ? FAKE_CEPH : FAKE_DOCKER;
    });
}

function evaluate(
  command: string,
  resourceType: AiResourceType = AiResourceType.DockerHost,
): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({ resourceType, command });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("routing", () => {
  test("each resource type reaches its tool policy", () => {
    const expected: Record<AiResourceType, ResourceToolPolicy> = {
      [AiResourceType.DockerHost]: DockerEngineCommandPolicy,
      [AiResourceType.PodmanHost]: DockerEngineCommandPolicy,
      [AiResourceType.DockerSwarmCluster]: DockerSwarmCommandPolicy,
      [AiResourceType.ProxmoxCluster]: ProxmoxCommandPolicy,
      [AiResourceType.VMwareVCenter]: GovcCommandPolicy,
      [AiResourceType.CephCluster]: CephCommandPolicy,
      [AiResourceType.DatabaseServer]: DatabaseCommandPolicy,
      [AiResourceType.Host]: HostCommandPolicy,
    };

    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(ResourceCommandPolicy.getToolPolicy(type)).toBe(expected[type]);
    }
  });

  test("pins the tool policy names", () => {
    expect(
      ALL_AI_RESOURCE_TYPES.map((type: AiResourceType): string => {
        return ResourceCommandPolicy.getToolPolicy(type).name;
      }),
    ).toEqual([
      "docker-engine",
      "docker-engine",
      "docker-swarm",
      "pvesh",
      "govc",
      "ceph",
      "db",
      "host",
    ]);
  });

  test("each tool policy covers exactly its types' programs", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect([...ResourceCommandPolicy.getToolPolicy(type).programs]).toEqual([
        ...AI_RESOURCE_TYPE_INFO[type].programs,
      ]);
    }
  });

  test("an unknown type gets a policy that refuses everything", () => {
    const tool: ResourceToolPolicy = ResourceCommandPolicy.getToolPolicy(
      "KubernetesCluster" as AiResourceType,
    );

    expect(tool.programs).toEqual([]);
    expect(tool.evaluateArgv(["kubectl", "get", "pods"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(
      evaluate("kubectl get pods", "KubernetesCluster" as AiResourceType).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      evaluate("docker ps", "KubernetesCluster" as AiResourceType).reason,
    ).toContain("no command policy");
  });
});

describe("the Wave 1 stubs fail closed", () => {
  const stubs: Array<ResourceToolPolicy> = [
    DockerEngineCommandPolicy,
    DockerSwarmCommandPolicy,
    ProxmoxCommandPolicy,
    GovcCommandPolicy,
    CephCommandPolicy,
    DatabaseCommandPolicy,
    HostCommandPolicy,
  ];

  /*
   * Only while a stub is in place: a kit that replaces the module makes its
   * own reads non-Denied, and these assertions move to the kit's suite.
   */
  const isStub: (tool: ResourceToolPolicy) => boolean = (
    tool: ResourceToolPolicy,
  ): boolean => {
    return tool
      .evaluateArgv([tool.programs[0] || ""])
      .reason.includes("not implemented yet");
  };

  test.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )(
    "%s: every Test connection command is Denied while its policy is a stub",
    (type: AiResourceType) => {
      const tool: ResourceToolPolicy =
        ResourceCommandPolicy.getToolPolicy(type);

      if (!isStub(tool)) {
        return;
      }

      for (const command of AI_RESOURCE_TYPE_INFO[type].testCommands) {
        const result: ResourceCommandPolicyResult = evaluate(command, type);

        expect(result.tier).toBe(ResourceCommandTier.Denied);
        expect(result.reason).toContain("not implemented yet");
        expect(
          ResourceCommandPolicy.isReadOnly({ resourceType: type, command }),
        ).toBe(false);
      }
    },
  );

  test.each(
    stubs.map((tool: ResourceToolPolicy): [string, ResourceToolPolicy] => {
      return [tool.name, tool];
    }),
  )(
    "the %s stub is total and denies garbage without throwing",
    (_name: string, tool: ResourceToolPolicy) => {
      if (!isStub(tool)) {
        return;
      }

      for (const argv of [
        [],
        [tool.programs[0] || ""],
        [tool.programs[0] || "", "anything", "at", "all"],
        null,
        undefined,
        [1, {}, null],
      ]) {
        const result: ResourceCommandPolicyResult = tool.evaluateArgv(
          argv as unknown as Array<string>,
        );

        expect(result.tier).toBe(ResourceCommandTier.Denied);
        expect(result.targets).toEqual([]);
      }

      expect(tool.readCommandGuide).toContain("Unavailable");
      expect(tool.writeCommandGuide).toContain("not implemented yet");
    },
  );
});

describe("evaluateArgv / evaluateCommand fail closed before the tool", () => {
  let toolSpy: jest.SpyInstance;

  beforeEach(() => {
    useFakeTools();
    toolSpy = jest.spyOn(FAKE_DOCKER, "evaluateArgv");
  });

  test.each([
    ["pvesh get /version", '"docker"'],
    ["govc about", "Docker AI agent"],
    ["kubectl get pods", "Docker host"],
    ["systemctl restart docker", '"docker"'],
    ["Docker ps", '"docker"'],
  ])(
    "%p is Denied for a Docker host: not one of its programs",
    (command: string, mentions: string) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.Denied);
      expect(result.reason).toContain(mentions);
      expect(result.reason).toContain(
        "is not a program the Docker AI agent runs",
      );
      expect(toolSpy).not.toHaveBeenCalled();
    },
  );

  test("a program written with a path is told to drop the path", () => {
    const result: ResourceCommandPolicyResult = evaluate("/usr/bin/docker ps");

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain("without a path");
    expect(toolSpy).not.toHaveBeenCalled();
  });

  test("a host program is Denied for a Docker host and docker is Denied for a Host", () => {
    expect(evaluate("uptime").tier).toBe(ResourceCommandTier.Denied);
    expect(evaluate("docker ps", AiResourceType.Host).reason).toContain(
      "Host AI agent",
    );
  });

  test.each([
    [null],
    [undefined],
    ["docker ps"],
    [[]],
    [["docker", 7]],
    [["docker", null]],
    [
      [
        {
          toString: (): string => {
            return "docker";
          },
        },
        "ps",
      ],
    ],
  ])("argv %p is Denied", (argv: unknown) => {
    const result: ResourceCommandPolicyResult =
      ResourceCommandPolicy.evaluateArgv({
        resourceType: AiResourceType.DockerHost,
        argv: argv as Array<string>,
      });

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(toolSpy).not.toHaveBeenCalled();
  });

  test("more than 64 words is Denied", () => {
    const argv: Array<string> = [
      "docker",
      ...Array.from({ length: 64 }, (): string => {
        return "ps";
      }),
    ];

    expect(
      ResourceCommandPolicy.evaluateArgv({
        resourceType: AiResourceType.DockerHost,
        argv,
      }).reason,
    ).toContain("at most 64 words");
    expect(toolSpy).not.toHaveBeenCalled();
  });

  test("more than 2000 characters of words is Denied", () => {
    expect(
      ResourceCommandPolicy.evaluateArgv({
        resourceType: AiResourceType.DockerHost,
        argv: ["docker", "logs", "x".repeat(2000)],
      }).reason,
    ).toContain("2000-character limit");
    expect(toolSpy).not.toHaveBeenCalled();
  });

  test.each([["web\nrm"], ["web\r"], ["web\0"]])(
    "a word holding %p is Denied",
    (word: string) => {
      expect(
        ResourceCommandPolicy.evaluateArgv({
          resourceType: AiResourceType.DockerHost,
          argv: ["docker", "restart", word],
        }).reason,
      ).toContain("single line");
      expect(toolSpy).not.toHaveBeenCalled();
    },
  );

  test.each([[["sudo", "docker", "ps"]], [["/usr/bin/sudo", "docker", "ps"]]])(
    "argv %p is Denied as a privilege switch",
    (argv: Array<string>) => {
      expect(
        ResourceCommandPolicy.evaluateArgv({
          resourceType: AiResourceType.DockerHost,
          argv,
        }).reason,
      ).toContain("own permissions");
    },
  );

  test("shell syntax in a command string is Denied with the rule", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      "docker ps | grep web",
    );

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain(
      "pipes and redirects are not supported; run one command",
    );
    expect(result.displayCommand).toBe("docker ps | grep web");
    expect(result.program).toBe("");
    expect(result.args).toEqual([]);
    expect(toolSpy).not.toHaveBeenCalled();
  });

  test("an unparseable command's display is trimmed and capped at 200 characters", () => {
    const long: string = `  docker logs ${"x".repeat(300)} |  `;

    expect(evaluate(long).displayCommand).toBe(long.trim().slice(0, 200));
  });

  test("a non-string command is Denied", () => {
    expect(
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.DockerHost,
        command: null as unknown as string,
      }).tier,
    ).toBe(ResourceCommandTier.Denied);
  });

  test("a valid command reaches the tool with a copy of the argv", () => {
    const result: ResourceCommandPolicyResult = evaluate("docker ps -a");

    expect(result.tier).toBe(ResourceCommandTier.Read);
    expect(result.program).toBe("docker");
    expect(result.args).toEqual(["ps", "-a"]);
    expect(toolSpy).toHaveBeenCalledWith(["docker", "ps", "-a"]);
  });
});

describe("evaluateArgv distrusts the tool's answer", () => {
  function withTool(
    evaluateArgv: (argv: Array<string>) => unknown,
  ): ResourceCommandPolicyResult {
    jest.spyOn(ResourceCommandPolicy, "getToolPolicy").mockReturnValue({
      ...FAKE_DOCKER,
      evaluateArgv: evaluateArgv as ResourceToolPolicy["evaluateArgv"],
    });

    return ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.DockerHost,
      argv: ["docker", "restart", "web"],
    });
  }

  test("a tool that throws is Denied", () => {
    const result: ResourceCommandPolicyResult = withTool((): never => {
      throw new Error("boom");
    });

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain("could not evaluate");
  });

  test.each([[null], [undefined], ["SafeWrite"], [42]])(
    "a tool that answers %p is Denied",
    (answer: unknown) => {
      expect(
        withTool((): unknown => {
          return answer;
        }).tier,
      ).toBe(ResourceCommandTier.Denied);
    },
  );

  test.each([["safewrite"], ["Allowed"], [""], [undefined], [1]])(
    "a tool that answers the tier %p is Denied",
    (tier: unknown) => {
      const result: ResourceCommandPolicyResult = withTool((): unknown => {
        return { tier, reason: "fine", targets: ["web"] };
      });

      expect(result.tier).toBe(ResourceCommandTier.Denied);
      expect(result.reason).toContain("unknown tier");
    },
  );

  test("the program is always argv[0] and missing fields are filled in", () => {
    const result: ResourceCommandPolicyResult = withTool((): unknown => {
      return {
        tier: ResourceCommandTier.SafeWrite,
        program: "sh",
        targets: ["web", 7, null],
        requiresHuman: "yes",
      };
    });

    expect(result).toEqual({
      tier: ResourceCommandTier.SafeWrite,
      reason: "no reason was given",
      program: "docker",
      args: ["restart", "web"],
      verb: "",
      displayCommand: "docker restart web",
      targets: ["web"],
    });
  });

  test("requiresHuman is kept only as a literal true", () => {
    expect(
      withTool((): unknown => {
        return {
          tier: ResourceCommandTier.RiskyWrite,
          reason: "r",
          requiresHuman: true,
        };
      }).requiresHuman,
    ).toBe(true);
  });

  test("a tool that mutates the argv it was given cannot change the caller's", () => {
    const argv: Array<string> = ["docker", "restart", "web"];

    jest.spyOn(ResourceCommandPolicy, "getToolPolicy").mockReturnValue({
      ...FAKE_DOCKER,
      evaluateArgv: (given: Array<string>): ResourceCommandPolicyResult => {
        given[2] = "oneuptime-ai-agent";
        return FAKE_DOCKER.evaluateArgv(given);
      },
    });

    ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.DockerHost,
      argv,
    });

    expect(argv).toEqual(["docker", "restart", "web"]);
  });
});

describe("evaluateForAutoExecution — the ladder through the dispatcher", () => {
  beforeEach(() => {
    useFakeTools();
  });

  function verdictFor(data: {
    command: string;
    allowlistPatterns?: Array<string>;
    bypassApproval?: boolean;
  }): ResourceAutoExecutionVerdict {
    return ResourceCommandPolicy.evaluateForAutoExecution({
      resourceType: AiResourceType.DockerHost,
      command: data.command,
      allowlistPatterns: data.allowlistPatterns || [],
      bypassApproval: data.bypassApproval === true,
    });
  }

  test("Denied is Denied, bypass and allowlist included", () => {
    const verdict: ResourceAutoExecutionVerdict = verdictFor({
      command: "docker exec web sh",
      allowlistPatterns: ["docker exec * sh"],
      bypassApproval: true,
    });

    expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
    expect(verdict.tier).toBe(ResourceCommandTier.Denied);
  });

  test("a read auto-approves", () => {
    expect(verdictFor({ command: "docker ps" }).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
  });

  test("a safe write auto-approves", () => {
    const verdict: ResourceAutoExecutionVerdict = verdictFor({
      command: "docker restart web",
    });

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.SafeWrite);
  });

  test("a risky write asks, unless bypassed or allowlisted", () => {
    expect(verdictFor({ command: "docker stop web" }).verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(
      verdictFor({ command: "docker stop web", bypassApproval: true }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      verdictFor({
        command: "docker stop web",
        allowlistPatterns: ["docker stop *"],
      }).reason,
    ).toBe("Matched the resource's command allowlist.");
    expect(
      verdictFor({
        command: "docker stop api",
        allowlistPatterns: ["docker stop web"],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
  });

  test("requiresHuman asks whatever the operator set", () => {
    const verdict: ResourceAutoExecutionVerdict = verdictFor({
      command: "docker kill web",
      allowlistPatterns: ["docker kill *"],
      bypassApproval: true,
    });

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(verdict.requiresHuman).toBe(true);
  });

  test("an unparseable command is Denied", () => {
    expect(
      verdictFor({ command: "docker stop web; docker rm web" }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.Denied);
  });
});

describe("allowlist", () => {
  beforeEach(() => {
    useFakeTools();
  });

  function problem(
    pattern: unknown,
    resourceType: AiResourceType = AiResourceType.DockerHost,
  ): string | null {
    return ResourceCommandPolicy.describeAllowlistPatternProblem({
      resourceType,
      pattern,
    });
  }

  test("pins the bounds", () => {
    expect(RESOURCE_ALLOWLIST_MAX_PATTERNS).toBe(50);
    expect(RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH).toBe(500);
  });

  describe("describeAllowlistPatternProblem", () => {
    test.each([
      ["docker stop *"],
      ["docker stop web"],
      ["docker restart *"],
      ["docker update --memory * web"],
      ["docker update --memory 512 *"],
      ["docker system prune"],
      ["  docker stop *  "],
    ])("%p is valid", (pattern: string) => {
      expect(problem(pattern)).toBeNull();
    });

    test("a numeric-only target can be allowlisted with *", () => {
      expect(problem("ceph osd out *", AiResourceType.CephCluster)).toBeNull();
    });

    test.each([[""], ["   "], [null], [undefined], [42], [["docker stop *"]]])(
      "%p is blank",
      (pattern: unknown) => {
        expect(problem(pattern)).toBe("An allowlist entry cannot be blank.");
      },
    );

    test("longer than 500 characters", () => {
      expect(problem(`docker stop ${"x".repeat(500)}`)).toBe(
        "An allowlist entry can be at most 500 characters long.",
      );
    });

    test("does not parse", () => {
      expect(problem("docker stop * | xargs")).toContain(
        "cannot be read as one command",
      );
      expect(problem("docker stop 'web")).toContain("Unbalanced quotes");
    });

    test.each([
      ["stop *"],
      ["pvesh create /x"],
      ["* stop web"],
      ["sudo docker stop *"],
    ])("%p does not start with the type's program", (pattern: string) => {
      const text: string | null = problem(pattern);

      expect(text).not.toBeNull();
      expect(text).toMatch(
        /does not start with a program the Docker AI agent runs|own permissions/,
      );
    });

    test.each([["docker"], ["docker stop"], ["docker *"]])(
      "%p has fewer than two words after the program",
      (pattern: string) => {
        expect(problem(pattern)).toContain(
          'has fewer than two words after "docker"',
        );
      },
    );

    test("a * where the command goes", () => {
      expect(problem("docker * web")).toContain(
        "has a * where the command goes",
      );
    });

    test("a read pre-approves nothing", () => {
      expect(problem("docker ps -a")).toContain("is a read-only command");
      expect(problem("docker ps *")).toContain("is a read-only command");
    });

    test("a denied command can never match", () => {
      expect(problem("docker exec * sh")).toContain(
        "can never match a command that runs",
      );
      expect(problem("docker exec * sh")).toContain(
        "docker exec is not allowed",
      );
    });

    test("an entry for the wrong resource type", () => {
      expect(problem("docker stop *", AiResourceType.CephCluster)).toContain(
        "Ceph AI agent",
      );
    });

    test("an unknown resource type", () => {
      expect(problem("docker stop *", "Nope" as AiResourceType)).toContain(
        "no command policy",
      );
    });
  });

  describe("describeAllowlistProblems", () => {
    test("a valid list", () => {
      expect(
        ResourceCommandPolicy.describeAllowlistProblems({
          resourceType: AiResourceType.DockerHost,
          patterns: ["docker stop *", "docker restart web"],
        }),
      ).toBeNull();
      expect(
        ResourceCommandPolicy.describeAllowlistProblems({
          resourceType: AiResourceType.DockerHost,
          patterns: [],
        }),
      ).toBeNull();
    });

    test.each([[null], ["docker stop *"], [{ 0: "docker stop *" }]])(
      "%p is not a list",
      (patterns: unknown) => {
        expect(
          ResourceCommandPolicy.describeAllowlistProblems({
            resourceType: AiResourceType.DockerHost,
            patterns,
          }),
        ).toBe("The allowlist must be a list of commands.");
      },
    );

    test("more than 50 entries", () => {
      const patterns: Array<string> = Array.from(
        { length: 51 },
        (_: unknown, i: number): string => {
          return `docker stop web-${i}`;
        },
      );

      expect(
        ResourceCommandPolicy.describeAllowlistProblems({
          resourceType: AiResourceType.DockerHost,
          patterns,
        }),
      ).toContain("at most 50 entries");
      expect(
        ResourceCommandPolicy.describeAllowlistProblems({
          resourceType: AiResourceType.DockerHost,
          patterns: patterns.slice(0, 50),
        }),
      ).toBeNull();
    });

    test("names the first bad entry", () => {
      expect(
        ResourceCommandPolicy.describeAllowlistProblems({
          resourceType: AiResourceType.DockerHost,
          patterns: ["docker stop *", "docker ps -a", "docker exec * sh"],
        }),
      ).toContain('"docker ps -a" is a read-only command');
    });
  });

  describe("matchesAllowlist", () => {
    function matches(command: string, patterns: Array<string>): boolean {
      return ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.DockerHost,
        command,
        patterns,
      });
    }

    test("token by token, a whole-word * for one word", () => {
      expect(matches("docker stop web", ["docker stop *"])).toBe(true);
      expect(matches("docker stop web", ["docker stop web"])).toBe(true);
      expect(matches("docker stop web", ["docker stop api"])).toBe(false);
      expect(matches("docker stop web-1", ["docker stop web-*"])).toBe(false);
      expect(
        matches("docker update --memory 512 web", [
          "docker update --memory * web",
        ]),
      ).toBe(true);
    });

    test("quoting in the command and the pattern is read the same way", () => {
      expect(matches("docker stop 'web'", ['docker stop "web"'])).toBe(true);
    });

    test("an entry describeAllowlistPatternProblem refuses is skipped", () => {
      // "docker ps *" would match word for word, but it is a read entry.
      expect(matches("docker ps -a", ["docker ps *"])).toBe(false);
      expect(matches("docker exec web sh", ["docker exec * sh"])).toBe(false);
    });

    test("only the first 50 entries are read", () => {
      const filler: Array<string> = Array.from(
        { length: 50 },
        (_: unknown, i: number): string => {
          return `docker stop filler-${i}`;
        },
      );

      expect(matches("docker stop web", [...filler, "docker stop web"])).toBe(
        false,
      );
      expect(
        matches("docker stop web", [...filler.slice(1), "docker stop web"]),
      ).toBe(true);
    });

    test("garbage never matches", () => {
      expect(matches("docker stop web | x", ["docker stop *"])).toBe(false);
      expect(matches("", ["docker stop *"])).toBe(false);
      expect(
        ResourceCommandPolicy.matchesAllowlist({
          resourceType: AiResourceType.DockerHost,
          command: "docker stop web",
          patterns: null as unknown as Array<string>,
        }),
      ).toBe(false);
      expect(
        matches("docker stop web", [
          7 as unknown as string,
          null as unknown as string,
        ]),
      ).toBe(false);
    });
  });

  describe("isBroadAllowlistPattern", () => {
    function broad(
      pattern: unknown,
      resourceType: AiResourceType = AiResourceType.DockerHost,
    ): boolean {
      return ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType,
        pattern,
      });
    }

    test("a * that stands for the target is broad", () => {
      expect(broad("docker stop *")).toBe(true);
      expect(broad("docker update --memory 512 *")).toBe(true);
      expect(broad("ceph osd out *", AiResourceType.CephCluster)).toBe(true);
    });

    test("a * that stands for a value, not a target, is not broad", () => {
      expect(broad("docker update --memory * web")).toBe(false);
    });

    test("an entry without a * is not broad", () => {
      expect(broad("docker stop web")).toBe(false);
      expect(broad("docker system prune")).toBe(false);
    });

    test("an invalid entry is never broad", () => {
      expect(broad("docker ps *")).toBe(false);
      expect(broad("docker exec * sh")).toBe(false);
      expect(broad("")).toBe(false);
      expect(broad(null)).toBe(false);
      expect(broad("docker stop *", AiResourceType.CephCluster)).toBe(false);
    });
  });
});

describe("getWriteScopeRefusal", () => {
  function scope(
    result: Partial<ResourceCommandPolicyResult>,
    posture: {
      allowWrites?: boolean;
      writeTargets?: Array<string>;
      protectedTargets?: Array<string>;
      resourceType?: AiResourceType;
    } = {},
  ): string | null {
    return ResourceCommandPolicy.getWriteScopeRefusal({
      result: {
        tier: ResourceCommandTier.SafeWrite,
        reason: "restarts one container",
        program: "docker",
        args: ["restart", "web"],
        verb: "restart",
        displayCommand: "docker restart web",
        targets: ["web"],
        ...result,
      },
      allowWrites: posture.allowWrites ?? true,
      writeTargets: posture.writeTargets ?? [],
      protectedTargets: posture.protectedTargets ?? [],
      resourceType: posture.resourceType ?? AiResourceType.DockerHost,
    });
  }

  test("a read is never refused, even by a read-only agent", () => {
    expect(
      scope(
        { tier: ResourceCommandTier.Read, targets: [] },
        { allowWrites: false, writeTargets: ["nothing"] },
      ),
    ).toBeNull();
  });

  test("a write the scope allows", () => {
    expect(scope({})).toBeNull();
    expect(scope({ tier: ResourceCommandTier.RiskyWrite })).toBeNull();
  });

  test("a Denied command is refused", () => {
    expect(
      scope({ tier: ResourceCommandTier.Denied, reason: "exec is denied" }),
    ).toContain("exec is denied");
  });

  test("an unknown tier is refused", () => {
    expect(scope({ tier: "Mystery" as ResourceCommandTier })).not.toBeNull();
  });

  test("a missing result is refused", () => {
    expect(
      ResourceCommandPolicy.getWriteScopeRefusal({
        result: null as unknown as ResourceCommandPolicyResult,
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        resourceType: AiResourceType.DockerHost,
      }),
    ).not.toBeNull();
  });

  test.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )(
    "a read-only %s agent refuses every write and names ONEUPTIME_AI_ALLOW_WRITES",
    (type: AiResourceType) => {
      const refusal: string | null = scope(
        {},
        { allowWrites: false, resourceType: type },
      );

      expect(refusal).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
      expect(refusal).toContain(AI_RESOURCE_TYPE_INFO[type].agentDisplayName);
      expect(refusal).toContain("read-only");
      expect(refusal).toContain("docker restart web");
    },
  );

  test("only a literal true allows writes", () => {
    expect(
      ResourceCommandPolicy.getWriteScopeRefusal({
        result: {
          tier: ResourceCommandTier.SafeWrite,
          reason: "r",
          program: "docker",
          args: [],
          verb: "",
          displayCommand: "docker restart web",
          targets: ["web"],
        },
        allowWrites: "true" as unknown as boolean,
        writeTargets: [],
        protectedTargets: [],
        resourceType: AiResourceType.DockerHost,
      }),
    ).toContain("ONEUPTIME_AI_ALLOW_WRITES");
  });

  describe("protected targets", () => {
    test.each([
      ["oneuptime-ai-agent", "oneuptime-ai-agent"],
      ["ONEUPTIME-AI-AGENT", "oneuptime-ai-agent"],
      ["/oneuptime-ai-agent", "oneuptime-ai-agent"],
      ["oneuptime-ai-agent", "/oneuptime-ai-agent"],
      ["oneuptime-collector", "oneuptime-*"],
      ["3f2a", "3f2a9c1b7d4e5f60"],
      ["3f2a9c1b7d4e5f60", "3f2a9c1b7d4e5f60"],
      ["oneuptime-ai-agent.service", "oneuptime-ai-agent.service"],
    ])(
      "%p names the protected %p",
      (target: string, protectedTarget: string) => {
        const refusal: string | null = scope(
          { targets: [target] },
          { protectedTargets: [protectedTarget] },
        );

        expect(refusal).toContain("protects");
        expect(refusal).toContain(target);
      },
    );

    test.each([
      ["web", "oneuptime-ai-agent"],
      ["3f2b", "3f2a9c1b7d4e5f60"],
      ["abc", "abc-agent"],
      // A short protected name is not an id, so a hex target is not its prefix.
      ["ab", "abcdef"],
      ["oneuptime", "oneuptime-ai-agent"],
    ])(
      "%p is not the protected %p",
      (target: string, protectedTarget: string) => {
        expect(
          scope({ targets: [target] }, { protectedTargets: [protectedTarget] }),
        ).toBeNull();
      },
    );

    test("protection beats the write targets allowlist", () => {
      expect(
        scope(
          { targets: ["oneuptime-ai-agent"] },
          {
            writeTargets: ["*"],
            protectedTargets: ["oneuptime-ai-agent"],
          },
        ),
      ).toContain("protects");
    });

    test("every target is checked, not just the first", () => {
      expect(
        scope(
          { targets: ["web", "oneuptime-ai-agent"] },
          { protectedTargets: ["oneuptime-ai-agent"] },
        ),
      ).toContain("oneuptime-ai-agent");
    });

    test("blank and non-string protected entries are ignored", () => {
      expect(
        scope(
          { targets: ["web"] },
          {
            protectedTargets: ["", "  ", 7 as unknown as string],
          },
        ),
      ).toBeNull();
    });
  });

  describe("ONEUPTIME_AI_WRITE_TARGETS", () => {
    test("targets inside the globs are allowed", () => {
      expect(
        scope({ targets: ["web-1"] }, { writeTargets: ["web-*", "api"] }),
      ).toBeNull();
      expect(
        scope(
          { targets: ["api", "web-2"] },
          { writeTargets: ["web-*", "api"] },
        ),
      ).toBeNull();
    });

    test("a target outside the globs is refused and names the variable", () => {
      const refusal: string | null = scope(
        { targets: ["web-1", "db"] },
        { writeTargets: ["web-*"] },
      );

      expect(refusal).toContain("db");
      expect(refusal).toContain("ONEUPTIME_AI_WRITE_TARGETS=web-*");
      expect(refusal).toContain("Docker AI agent");
    });

    test("the globs are case-sensitive (narrower is safer)", () => {
      expect(
        scope({ targets: ["Web-1"] }, { writeTargets: ["web-*"] }),
      ).not.toBeNull();
    });

    test("a write that names no target is refused when the targets are limited", () => {
      expect(
        scope(
          { targets: [], tier: ResourceCommandTier.RiskyWrite },
          { writeTargets: ["web-*"] },
        ),
      ).toContain("does not name the objects it changes");
    });

    test("a write that names no target is allowed when the targets are not limited", () => {
      expect(scope({ targets: [] })).toBeNull();
    });

    test("blank entries do not count as a limit", () => {
      expect(
        scope({ targets: ["anything"] }, { writeTargets: ["", "  "] }),
      ).toBeNull();
    });

    test("blank targets are ignored rather than matched", () => {
      expect(
        scope({ targets: ["", "web-1"] }, { writeTargets: ["web-*"] }),
      ).toBeNull();
    });
  });
});

describe("command guides", () => {
  test("come from the type's tool policy", () => {
    useFakeTools();

    expect(
      ResourceCommandPolicy.getReadCommandGuide(AiResourceType.DockerHost),
    ).toBe("- docker ps");
    expect(
      ResourceCommandPolicy.getWriteCommandGuide(AiResourceType.CephCluster),
    ).toBe("- ceph osd out ID (risky)");
  });

  test.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )("%s has non-empty markdown bullet guides", (type: AiResourceType) => {
    for (const guide of [
      ResourceCommandPolicy.getReadCommandGuide(type),
      ResourceCommandPolicy.getWriteCommandGuide(type),
    ]) {
      expect(guide.trim().length).toBeGreaterThan(0);
      expect(guide.trimStart().startsWith("- ")).toBe(true);
    }
  });

  test("an unknown type says it is unavailable", () => {
    expect(
      ResourceCommandPolicy.getReadCommandGuide("Nope" as AiResourceType),
    ).toContain("Unavailable");
  });
});
