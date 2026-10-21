import {
  ALLOWLIST_WILDCARD_TOKEN,
  MAX_RESOURCE_COMMAND_TOKENS,
  RESOURCE_SHELL_SYNTAX_RULE,
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  ResourceTokenizeResult,
  allowlistPatternMatches,
  applyAutoExecutionLadder,
  deniedResult,
  getPrivilegeEscalationRefusal,
  globMatchesTarget,
  renderResourceDisplayCommand,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  AiRemediationCommandPolicyVerdict,
  MAX_COMMAND_LENGTH_CHARS,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import CommandPolicy from "../../../../Utils/AiRemediation/CommandPolicy";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the tool-agnostic half of the resource command
 * policy.
 *
 * - The tokenizer reads quoting ONLY (single, double, backslash) and refuses
 *   everything a shell would have given a meaning the agent never will:
 *   unquoted | ; & > < ` and $(, backticks and $( inside double quotes,
 *   newlines and NUL, sudo and friends. Its refusal of shell syntax always
 *   says "pipes and redirects are not supported; run one command".
 * - Rendering round-trips through the tokenizer, whatever the words hold.
 * - Target globs: `*` within one target, anchored, case-sensitive, linear.
 * - Allowlist entries: a whole-word `*` matches one word, every other word
 *   is compared exactly, and the lengths must be equal.
 * - The auto-execution ladder: Denied, Read, requiresHuman, SafeWrite,
 *   bypass, allowlist, ask — in that order.
 */

function tokens(command: string): Array<string> | undefined {
  return tokenizeResourceCommand(command).argv;
}

function tokenError(command: string): string {
  const result: ResourceTokenizeResult = tokenizeResourceCommand(command);

  expect(result.argv).toBeUndefined();

  return result.errorMessage || "";
}

function result(
  overrides: Partial<ResourceCommandPolicyResult> = {},
): ResourceCommandPolicyResult {
  return {
    tier: ResourceCommandTier.RiskyWrite,
    reason: "stops one container",
    program: "docker",
    args: ["stop", "web"],
    verb: "stop",
    displayCommand: "docker stop web",
    targets: ["web"],
    ...overrides,
  };
}

describe("tokenizeResourceCommand — words", () => {
  test.each([
    ["docker ps -a", ["docker", "ps", "-a"]],
    ["  docker   ps\t-a  ", ["docker", "ps", "-a"]],
    ["uptime", ["uptime"]],
    [
      `docker logs 'my app' --tail 50`,
      ["docker", "logs", "my app", "--tail", "50"],
    ],
    [`docker logs "my app"`, ["docker", "logs", "my app"]],
    [`docker logs my\\ app`, ["docker", "logs", "my app"]],
    [
      `pvesh get "/nodes/pve1/tasks?errors=1&limit=5"`,
      ["pvesh", "get", "/nodes/pve1/tasks?errors=1&limit=5"],
    ],
    [`journalctl -u 'a|b'`, ["journalctl", "-u", "a|b"]],
    [
      `echo 'semi;colon' "gt>lt<" amp\\&`,
      ["echo", "semi;colon", "gt>lt<", "amp&"],
    ],
    [`db x 'it'\\''s'`, ["db", "x", "it's"]],
    [`db x "say \\"hi\\""`, ["db", "x", 'say "hi"']],
    [`db x "back\\\\slash"`, ["db", "x", "back\\slash"]],
    [
      `db x "dollar \\$(not) and \\\`tick\\\`"`,
      ["db", "x", "dollar $(not) and `tick`"],
    ],
    [`db x "keep \\n literal"`, ["db", "x", "keep \\n literal"]],
    [`db x '$(literal)' '\`literal\`'`, ["db", "x", "$(literal)", "`literal`"]],
    [`db x ''`, ["db", "x", ""]],
    [`db x ""`, ["db", "x", ""]],
    [`db x a""b`, ["db", "x", "ab"]],
    [`db x $HOME \${X}`, ["db", "x", "$HOME", "${X}"]],
    [`ps -eo pid,comm --sort=-%cpu`, ["ps", "-eo", "pid,comm", "--sort=-%cpu"]],
    [`db trailing\\`, ["db", "trailing\\"]],
  ])("%p -> %p", (command: string, expected: Array<string>) => {
    expect(tokens(command)).toEqual(expected);
  });

  test("the program is argv[0], never stripped", () => {
    expect(tokens("docker version")?.[0]).toBe("docker");
    expect(tokens("DOCKER version")?.[0]).toBe("DOCKER");
  });
});

describe("tokenizeResourceCommand — shell syntax is refused", () => {
  test.each([
    ["docker ps | grep web", "a pipe (|)"],
    ["docker ps || true", "a pipe (|)"],
    ["docker ps; docker info", "a command separator (;)"],
    ["docker ps && docker info", "a background or chaining operator (&)"],
    ["docker restart web &", "a background or chaining operator (&)"],
    ["docker ps > /tmp/out", "an output redirect (>)"],
    ["docker ps >> /tmp/out", "an output redirect (>)"],
    ["docker ps 2>&1", "an output redirect (>)"],
    ["db x < /etc/passwd", "an input redirect (<)"],
    ["docker logs `docker ps -q`", "command substitution (`...`)"],
    ["docker logs $(docker ps -q)", "command substitution ($(...))"],
    ["docker logs web$(id)", "command substitution ($(...))"],
    ["pvesh get /nodes?a=1&b=2", "a background or chaining operator (&)"],
  ])("%p is refused as %s", (command: string, what: string) => {
    const message: string = tokenError(command);

    expect(message).toContain(what);
    expect(message).toContain(RESOURCE_SHELL_SYNTAX_RULE);
    expect(message).toContain("quote the character");
  });

  test.each([
    [`docker logs "$(docker ps -q)"`, "command substitution ($(...))"],
    ['docker logs "`id`"', "command substitution (`...`)"],
  ])(
    "%p is refused inside double quotes too, where a shell would expand it",
    (command: string, what: string) => {
      const message: string = tokenError(command);

      expect(message).toContain(what);
      expect(message).toContain("inside double quotes");
      expect(message).toContain(RESOURCE_SHELL_SYNTAX_RULE);
    },
  );

  test("the rule is the phrase the design names", () => {
    expect(RESOURCE_SHELL_SYNTAX_RULE).toBe(
      "pipes and redirects are not supported; run one command",
    );
  });

  test.each([
    ["docker ps\ndocker info"],
    ["docker ps\r\ndocker info"],
    ["docker ps\rdocker info"],
    ["docker ps\0"],
    ["docker logs 'multi\nline'"],
    ['docker logs "multi\nline"'],
  ])("%p is refused: one line only", (command: string) => {
    expect(tokenError(command)).toContain("single line");
  });
});

describe("tokenizeResourceCommand — privilege and shape", () => {
  test.each([
    ["sudo docker ps"],
    ["SUDO docker ps"],
    ["/usr/bin/sudo docker ps"],
    ["doas systemctl restart nginx"],
    ["su -c 'systemctl restart nginx'"],
    ["pkexec systemctl restart nginx"],
    ["sudo"],
  ])("%p is refused, not stripped", (command: string) => {
    const message: string = tokenError(command);

    expect(message).toContain("own permissions");
    expect(message).toMatch(/drop (sudo|doas|su|pkexec)/);
  });

  test("sudo later in the argv is only a word (the program decides)", () => {
    expect(tokens("journalctl -t sudo")).toEqual(["journalctl", "-t", "sudo"]);
  });

  test.each([[""], ["   "], ["\t"], ["''"], ['""']])(
    "%p is empty",
    (command: string) => {
      const parsed: ResourceTokenizeResult = tokenizeResourceCommand(command);

      if (parsed.argv) {
        // A quoted empty word is a word: argv[0] "" is left to the dispatcher.
        expect(parsed.argv).toEqual([""]);
      } else {
        expect(parsed.errorMessage).toBe("Empty command.");
      }
    },
  );

  test.each([[null], [undefined], [42], [{}]])(
    "%p (not a string) is empty",
    (command: unknown) => {
      expect(tokenizeResourceCommand(command as string).errorMessage).toBe(
        "Empty command.",
      );
    },
  );

  test.each([["docker 'ps"], ['docker "ps'], ["docker 'ps\"x"], ["db x \"a'"]])(
    "%p has unbalanced quotes",
    (command: string) => {
      expect(tokenError(command)).toBe("Unbalanced quotes in the command.");
    },
  );

  test("at most 64 words", () => {
    const sixtyFour: string = [
      "db",
      ...Array.from({ length: 63 }, () => {
        return "x";
      }),
    ].join(" ");
    const sixtyFive: string = `${sixtyFour} x`;

    expect(MAX_RESOURCE_COMMAND_TOKENS).toBe(64);
    expect(tokens(sixtyFour)).toHaveLength(64);
    expect(tokenError(sixtyFive)).toContain("at most 64 words");
  });

  test("at most MAX_COMMAND_LENGTH_CHARS characters", () => {
    const longest: string = `db ${"x".repeat(MAX_COMMAND_LENGTH_CHARS - 3)}`;

    expect(longest).toHaveLength(MAX_COMMAND_LENGTH_CHARS);
    expect(tokens(longest)).toHaveLength(2);
    expect(tokenError(`${longest}x`)).toContain(
      `${MAX_COMMAND_LENGTH_CHARS}-character limit`,
    );
  });
});

describe("getPrivilegeEscalationRefusal", () => {
  test.each([["docker"], ["systemctl"], ["sudoers"], ["pseudo"], [""]])(
    "%p is not a privilege switch",
    (program: string) => {
      expect(getPrivilegeEscalationRefusal(program)).toBeNull();
    },
  );

  test.each([["sudo"], ["Sudo"], ["/bin/su"], [" doas "], ["pkexec"]])(
    "%p is",
    (program: string) => {
      expect(getPrivilegeEscalationRefusal(program)).toContain(
        "own permissions",
      );
    },
  );
});

describe("renderResourceDisplayCommand", () => {
  test.each([
    [["docker", "ps", "-a"], "docker ps -a"],
    [["docker", "logs", "my app"], "docker logs 'my app'"],
    [["db", "x", ""], "db x ''"],
    [["db", "x", "it's"], "db x 'it'\\''s'"],
    [["journalctl", "-u", "a|b"], "journalctl -u 'a|b'"],
    [["ps", "--sort=-%cpu", "-eo", "pid,comm"], "ps --sort=-%cpu -eo pid,comm"],
    [
      ["pvesh", "get", "/nodes/pve1/qemu/101/status/current"],
      "pvesh get /nodes/pve1/qemu/101/status/current",
    ],
    [[], ""],
  ])("%p -> %p", (argv: Array<string>, expected: string) => {
    expect(renderResourceDisplayCommand(argv)).toBe(expected);
  });

  test("drops anything that is not a word", () => {
    expect(
      renderResourceDisplayCommand([
        "docker",
        7 as unknown as string,
        "ps",
        null as unknown as string,
      ]),
    ).toBe("docker ps");
    expect(renderResourceDisplayCommand(null as unknown as Array<string>)).toBe(
      "",
    );
  });

  test.each([
    [["db", "x", "a;b", "c|d", "e&f", "g>h", "i<j"]],
    [["db", "x", "$(id)", "`id`", "${HOME}", "$HOME"]],
    [["db", "x", "it's", '"quoted"', "back\\slash", "tab\there"]],
    [["db", "x", "", " ", "*", "?", "~", "#comment"]],
    [["db", "x", "'", "''", "\\", "\\'"]],
  ])("round-trips %p through the tokenizer", (argv: Array<string>) => {
    expect(tokens(renderResourceDisplayCommand(argv))).toEqual(argv);
  });
});

describe("deniedResult", () => {
  test("is Denied with the argv split into program and args", () => {
    expect(deniedResult(["docker", "exec", "web", "sh"], "no exec")).toEqual({
      tier: ResourceCommandTier.Denied,
      reason: "no exec",
      program: "docker",
      args: ["exec", "web", "sh"],
      verb: "",
      displayCommand: "docker exec web sh",
      targets: [],
    });
  });

  test("is total on garbage", () => {
    for (const argv of [[], null, undefined, "docker ps", [1, 2], [{}, "ps"]]) {
      const denied: ResourceCommandPolicyResult = deniedResult(
        argv as unknown as Array<string>,
        "x",
      );

      expect(denied.tier).toBe(ResourceCommandTier.Denied);
      expect(Array.isArray(denied.args)).toBe(true);
      expect(denied.targets).toEqual([]);
    }
  });
});

describe("globMatchesTarget", () => {
  test.each([
    ["web", "web", true],
    ["web", "web-1", false],
    ["web-*", "web-1", true],
    ["web-*", "web-", true],
    ["web-*", "api-1", false],
    ["*-web", "prod-web", true],
    ["*", "anything", true],
    ["*", "", true],
    ["", "", true],
    ["", "web", false],
    ["w*b", "web", true],
    ["w*b", "wb", true],
    ["w*b", "webs", false],
    ["Web", "web", false],
    ["web", "Web", false],
    ["node/*", "node/101", true],
    ["pve1/1*", "pve1/101", true],
    ["pve1/1*", "pve2/101", false],
    ["a*b*c", "aXbYc", true],
    ["a*b*c", "aXbY", false],
    ["literal*", "literal*", true],
  ])(
    "%p matches %p: %p",
    (pattern: string, target: string, expected: boolean) => {
      expect(globMatchesTarget(pattern, target)).toBe(expected);
    },
  );

  test("non-strings never match", () => {
    expect(globMatchesTarget(null as unknown as string, "web")).toBe(false);
    expect(globMatchesTarget("*", undefined as unknown as string)).toBe(false);
  });

  test("agrees with CommandPolicy.globMatches, which it mirrors", () => {
    const pairs: Array<[string, string]> = [
      ["web-*", "web-1"],
      ["*a*a*a*b", "aaaaaaaaaa"],
      ["x*", "y"],
      ["*", ""],
      ["a*", "a"],
      ["**", "zz"],
    ];

    for (const [pattern, target] of pairs) {
      expect(globMatchesTarget(pattern, target)).toBe(
        CommandPolicy.globMatches(pattern, target),
      );
    }
  });

  test("stays linear on a pathological pattern", () => {
    const started: number = Date.now();

    expect(globMatchesTarget(`${"*a".repeat(40)}*b`, "a".repeat(20000))).toBe(
      false,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("allowlistPatternMatches", () => {
  test.each([
    [["docker", "stop", "web"], ["docker", "stop", "web"], true],
    [["docker", "stop", "*"], ["docker", "stop", "web"], true],
    [["docker", "stop", "*"], ["docker", "stop", "--time=5"], true],
    [["docker", "*", "web"], ["docker", "kill", "web"], true],
    [["docker", "stop", "*"], ["docker", "stop", "web", "api"], false],
    [["docker", "stop", "*", "*"], ["docker", "stop", "web"], false],
    [["docker", "stop", "web-*"], ["docker", "stop", "web-1"], false],
    [["docker", "stop", "web-*"], ["docker", "stop", "web-*"], true],
    [["docker", "stop", "Web"], ["docker", "stop", "web"], false],
    [
      ["docker", "stop", "--time", "*"],
      ["docker", "stop", "--time", "5"],
      true,
    ],
    [["docker", "stop", "--time", "*"], ["docker", "stop", "--time=5"], false],
    [["*", "stop", "web"], ["podman", "stop", "web"], true],
    [[], [], false],
  ])(
    "%p matches %p: %p",
    (pattern: Array<string>, argv: Array<string>, expected: boolean) => {
      expect(allowlistPatternMatches(pattern, argv)).toBe(expected);
    },
  );

  test("the wildcard is exactly a whole-word *", () => {
    expect(ALLOWLIST_WILDCARD_TOKEN).toBe("*");
  });

  test("garbage never matches", () => {
    expect(
      allowlistPatternMatches(null as unknown as Array<string>, ["docker"]),
    ).toBe(false);
    expect(
      allowlistPatternMatches(
        ["docker"],
        undefined as unknown as Array<string>,
      ),
    ).toBe(false);
    expect(
      allowlistPatternMatches(
        ["docker", 1 as unknown as string],
        ["docker", "1"],
      ),
    ).toBe(false);
    expect(
      allowlistPatternMatches(
        ["docker", "*"],
        ["docker", null as unknown as string],
      ),
    ).toBe(false);
  });
});

describe("applyAutoExecutionLadder", () => {
  const off: { allowlistMatched: boolean; bypassApproval: boolean } = {
    allowlistMatched: false,
    bypassApproval: false,
  };
  const everything: { allowlistMatched: boolean; bypassApproval: boolean } = {
    allowlistMatched: true,
    bypassApproval: true,
  };

  test("Denied stays Denied whatever the operator set", () => {
    const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
      result({ tier: ResourceCommandTier.Denied, reason: "exec is denied" }),
      everything,
    );

    expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
    expect(verdict.tier).toBe(ResourceCommandTier.Denied);
    expect(verdict.reason).toContain("exec is denied");
    expect(verdict.reason).toContain("even with human approval");
  });

  test("an unknown tier is Denied", () => {
    const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
      result({ tier: "Mystery" as ResourceCommandTier }),
      everything,
    );

    expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
    expect(verdict.tier).toBe(ResourceCommandTier.Denied);
  });

  test("a missing result is Denied", () => {
    expect(
      applyAutoExecutionLadder(
        null as unknown as ResourceCommandPolicyResult,
        everything,
      ).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.Denied);
  });

  test("Read auto-approves (it changes nothing)", () => {
    const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
      result({ tier: ResourceCommandTier.Read, reason: "lists containers" }),
      off,
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.Read);
    expect(verdict.reason).toBe("lists containers");
  });

  test.each([ResourceCommandTier.SafeWrite, ResourceCommandTier.RiskyWrite])(
    "requiresHuman on a %s beats bypass and the allowlist",
    (tier: ResourceCommandTier) => {
      const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
        result({ tier, requiresHuman: true, reason: "kills a pid" }),
        everything,
      );

      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.requiresHuman).toBe(true);
      expect(verdict.tier).toBe(tier);
      expect(verdict.reason).toContain("kills a pid");
      expect(verdict.reason).toContain("Neither bypassing approvals");
    },
  );

  test("SafeWrite auto-approves with nothing set", () => {
    const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
      result({ tier: ResourceCommandTier.SafeWrite, reason: "restarts one" }),
      off,
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.reason).toBe("restarts one");
    expect(verdict.requiresHuman).toBeUndefined();
  });

  test("RiskyWrite asks by default", () => {
    const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
      result(),
      off,
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(verdict.reason).toBe(
      "Requires human approval: stops one container.",
    );
    expect(verdict.requiresHuman).toBeUndefined();
  });

  test("RiskyWrite auto-approves when the resource bypasses approvals", () => {
    const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
      result(),
      { allowlistMatched: false, bypassApproval: true },
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.reason).toContain("bypasses approvals");
  });

  test("RiskyWrite auto-approves when the allowlist matched", () => {
    const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
      result(),
      { allowlistMatched: true, bypassApproval: false },
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.reason).toBe("Matched the resource's command allowlist.");
  });

  test("only a literal true counts for bypass and allowlist", () => {
    const verdict: ResourceAutoExecutionVerdict = applyAutoExecutionLadder(
      result(),
      {
        allowlistMatched: "true" as unknown as boolean,
        bypassApproval: 1 as unknown as boolean,
      },
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
  });
});
