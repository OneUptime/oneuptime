import {
  DOCKER_COMMAND_REFUSALS,
  DOCKER_ENGINE_READ_COMMANDS,
  DOCKER_ENGINE_WRITE_PATHS,
  DOCKER_SWARM_GROUPS,
  DockerCommandPath,
  DockerCommandSpec,
  DockerFlagKind,
  DockerFlagSpec,
  DockerJudgement,
  DockerParsedArgs,
  DockerProfile,
  describeAllowedDockerFlags,
  dockerFlagValue,
  dockerFlagValues,
  evaluateDockerArgv,
  evaluateDockerArgvSafely,
  findBadDockerFilter,
  findBadDockerFormat,
  findBadDockerName,
  isDockerCpuCount,
  isDockerFlagGiven,
  isDockerImageReference,
  isDockerMemorySize,
  isDockerObjectName,
  isDockerSwitchOn,
  isDockerTimeValue,
  isGoDuration,
  mergeDockerCommands,
  parseDockerCount,
  parseDockerFlags,
  resolveDockerCommandPath,
  uniqueDockerTargets,
} from "../../../../Utils/AiRemediation/Resource/DockerCliGrammar";
import { DOCKER_ENGINE_PROFILE } from "../../../../Utils/AiRemediation/Resource/DockerEngineCommandPolicy";
import { DOCKER_SWARM_PROFILE } from "../../../../Utils/AiRemediation/Resource/DockerSwarmCommandPolicy";
import { ResourceCommandPolicyResult } from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the docker CLI grammar both docker policies share:
 * command lookup (no flag before the command), a flag parser that reads an
 * argv exactly the way pflag does (so nothing can hide in what we took for
 * a flag value), fail-closed extras (unknown flags, repeats, value checks),
 * and a total evaluator.
 */

const FLAGS: ReadonlyArray<DockerFlagSpec> = [
  { name: "all", shorthand: "a", kind: DockerFlagKind.Bool },
  { name: "quiet", shorthand: "q", kind: DockerFlagKind.Bool },
  { name: "last", shorthand: "n", kind: DockerFlagKind.Value },
  {
    name: "filter",
    shorthand: "f",
    kind: DockerFlagKind.Value,
    repeatable: true,
  },
  {
    name: "timeout",
    shorthand: "t",
    kind: DockerFlagKind.Value,
    aliases: ["time"],
  },
  {
    name: "follow",
    shorthand: "F",
    kind: DockerFlagKind.Bool,
    refusal: "is refused for the test",
  },
];

function parse(
  words: Array<string>,
  interspersed: boolean = true,
): DockerParsedArgs {
  return parseDockerFlags({
    words,
    flags: FLAGS,
    command: "docker test",
    interspersed,
  });
}

function valuesOf(parsed: DockerParsedArgs): Record<string, Array<string>> {
  const out: Record<string, Array<string>> = {};

  parsed.values.forEach((values: Array<string>, name: string): void => {
    out[name] = values;
  });

  return out;
}

describe("parseDockerFlags mirrors pflag", () => {
  test.each([
    [["--last=5"], { last: ["5"] }, []],
    [["--last", "5"], { last: ["5"] }, []],
    [["-n", "5"], { last: ["5"] }, []],
    [["-n5"], { last: ["5"] }, []],
    [["-n=5"], { last: ["5"] }, []],
    [["-n="], { last: ["="] }, []],
    [["-an", "5"], { all: ["true"], last: ["5"] }, []],
    [["-aqn5"], { all: ["true"], quiet: ["true"], last: ["5"] }, []],
    [["-na"], { last: ["a"] }, []],
    [["-a=false"], { all: ["false"] }, []],
    [["--all=false"], { all: ["false"] }, []],
    [["--all", "false"], { all: ["true"] }, ["false"]],
    [["-a", "x"], { all: ["true"] }, ["x"]],
    [["x", "-a", "y"], { all: ["true"] }, ["x", "y"]],
    [["-n", "-a"], { last: ["-a"] }, []],
    [["--last", "--all"], { last: ["--all"] }, []],
    [["--", "-a", "--all"], {}, ["-a", "--all"]],
    [["-a", "--", "--"], { all: ["true"] }, ["--"]],
    [["-"], {}, ["-"]],
    [[""], {}, [""]],
    [["-f", "a=1", "--filter=b=2", "-fc=3"], { filter: ["a=1", "b=2", "c=3"] }, []],
    [["--time", "5"], { timeout: ["5"] }, []],
    [["-t5"], { timeout: ["5"] }, []],
  ])(
    "%p parses to %p with positionals %p",
    (
      words: Array<string>,
      values: Record<string, Array<string>>,
      positionals: Array<string>,
    ) => {
      const parsed: DockerParsedArgs = parse(words);

      expect(parsed.problem).toBeUndefined();
      expect(valuesOf(parsed)).toEqual(values);
      expect(parsed.positionals).toEqual(positionals);
    },
  );

  test.each([
    ["1", "true"],
    ["t", "true"],
    ["T", "true"],
    ["TRUE", "true"],
    ["true", "true"],
    ["True", "true"],
    ["0", "false"],
    ["f", "false"],
    ["F", "false"],
    ["FALSE", "false"],
    ["false", "false"],
    ["False", "false"],
  ])("a switch reads =%s as %s (Go's ParseBool)", (written: string, value: string) => {
    expect(dockerFlagValue(parse([`--all=${written}`]), "all")).toBe(value);
    expect(dockerFlagValue(parse([`-a=${written}`]), "all")).toBe(value);
  });

  test.each([
    [["--all=yes"], "is a switch"],
    [["--all=tRUE"], "is a switch"],
    [["-a=on"], "is a switch"],
    [["--all="], "is a switch"],
    [["-a="], "not one OneUptime AI may use"],
    [["--last"], "needs a value"],
    [["-n"], "needs a value"],
    [["-an"], "needs a value"],
    [["---all"], "not valid flag syntax"],
    [["--=5"], "not valid flag syntax"],
    [["--bogus"], "not one OneUptime AI may use with docker test"],
    [["-z"], "not one OneUptime AI may use with docker test"],
    [["-az"], '-z (in "-az")'],
    [["--ALL"], "not one OneUptime AI"],
    [["-A"], "not one OneUptime AI"],
    [["--no_trunc"], "not one OneUptime AI"],
    [["--follow"], "is refused for the test"],
    [["-F"], "is refused for the test"],
    [["-aF"], '-F (in "-aF") flag is refused'],
    [["--follow=false"], "is refused for the test"],
    [["-a", "-a"], "more than once"],
    [["-aa"], "more than once"],
    [["--all", "--all=false"], "more than once"],
    [["-n", "1", "--last=2"], "more than once"],
    [["-t", "1", "--time", "2"], "more than once"],
    [["--host", "x"], "global flags"],
    [["-H", "x"], "global flags"],
    [["--tlscacert", "x"], "global flags"],
    [["--context=x"], "global flags"],
    [["-D"], "global flags"],
    [["-а"], "not one OneUptime AI"],
    [["—all"], ""],
  ])("%p is refused (%s)", (words: Array<string>, phrase: string) => {
    const parsed: DockerParsedArgs = parse(words);

    if (phrase === "") {
      // A look-alike dash is no flag at all: it is a positional.
      expect(parsed.problem).toBeUndefined();
      expect(parsed.positionals).toEqual(words);
      return;
    }

    expect(parsed.problem).toContain(phrase);
  });

  test("a refused flag lists what the command allows, without refused flags", () => {
    const problem: string = parse(["--bogus"]).problem || "";

    expect(problem).toContain(
      "-a/--all, -q/--quiet, -n/--last VALUE, -f/--filter VALUE, -t/--timeout VALUE",
    );
    expect(problem).not.toContain("--follow");
  });

  test("a non-interspersed command stops reading flags at its first positional", () => {
    const parsed: DockerParsedArgs = parse(["-a", "web", "-q", "--last=5"], false);

    expect(parsed.problem).toBeUndefined();
    expect(valuesOf(parsed)).toEqual({ all: ["true"] });
    expect(parsed.positionals).toEqual(["web", "-q", "--last=5"]);
  });

  test("accessors", () => {
    const parsed: DockerParsedArgs = parse([
      "-a=false",
      "-f",
      "a=1",
      "-f",
      "b=2",
      "-q",
    ]);

    expect(dockerFlagValues(parsed, "filter")).toEqual(["a=1", "b=2"]);
    expect(dockerFlagValue(parsed, "filter")).toBe("b=2");
    expect(dockerFlagValue(parsed, "last")).toBeUndefined();
    expect(isDockerFlagGiven(parsed, "all")).toBe(true);
    expect(isDockerSwitchOn(parsed, "all")).toBe(false);
    expect(isDockerSwitchOn(parsed, "quiet")).toBe(true);
    expect(isDockerFlagGiven(parsed, "last")).toBe(false);
  });

  test("describeAllowedDockerFlags says none when nothing is allowed", () => {
    expect(describeAllowedDockerFlags([])).toBe("none");
    expect(
      describeAllowedDockerFlags([
        { name: "x", kind: DockerFlagKind.Bool, refusal: "no" },
      ]),
    ).toBe("none");
  });
});

describe("resolveDockerCommandPath", () => {
  test.each([
    [["docker", "ps", "-a"], "ps", undefined, ["-a"]],
    [["docker", "container", "ls", "-a"], "container ls", "container", ["-a"]],
    [["docker", "container", "list"], "container ls", "container", []],
    [["docker", "container", "ps"], "container ls", "container", []],
    [["docker", "image", "list"], "image ls", "image", []],
    [["docker", "image", "rmi", "x"], "image rm", "image", ["x"]],
    [["docker", "container", "remove", "x"], "container rm", "container", ["x"]],
    [["docker", "stack", "up"], "stack deploy", "stack", []],
    [["docker", "stack", "down", "app"], "stack rm", "stack", ["app"]],
    [["docker", "service", "list"], "service ls", "service", []],
    [["docker", "container", "frobnicate"], "container frobnicate", "container", []],
    [["docker", "secret", "ls"], "secret", undefined, ["ls"]],
    [["docker", "constructor"], "constructor", undefined, []],
    [["docker", "container", "__proto__"], "container __proto__", "container", []],
  ])(
    "%p resolves to %p",
    (
      words: Array<string>,
      path: string,
      group: string | undefined,
      rest: Array<string>,
    ) => {
      const resolved: DockerCommandPath = resolveDockerCommandPath(words);

      expect(resolved.problem).toBeUndefined();
      expect(resolved.path).toBe(path);
      expect(resolved.group).toBe(group);
      expect(resolved.rest).toEqual(rest);
    },
  );

  test.each([
    [["docker"], 'after "docker"'],
    [["docker", "-H", "x", "ps"], "global flags"],
    [["docker", "--", "ps"], "global flags"],
    [["docker", "container"], "needs a subcommand"],
    [["docker", "container", "-a", "ls"], "comes before the docker container subcommand"],
    [["docker", "service", "--help"], "comes before the docker service subcommand"],
  ])("%p has a problem (%s)", (words: Array<string>, phrase: string) => {
    expect(resolveDockerCommandPath(words).problem).toContain(phrase);
  });
});

describe("values", () => {
  test.each([
    ["web", true],
    ["web-1", true],
    ["my_app.web.1", true],
    ["3f2a9c1b7d4e", true],
    ["a", true],
    ["self", true],
    ["-web", false],
    ["_web", false],
    [".web", false],
    ["/web", false],
    ["web app", false],
    ["web;rm", false],
    ["wеb", false],
    ["web​", false],
    ["", false],
    ["{{.Name}}", false],
    ["a".repeat(255), true],
    ["a".repeat(256), false],
  ])("isDockerObjectName(%p) is %p", (word: string, expected: boolean) => {
    expect(isDockerObjectName(word)).toBe(expected);
  });

  test.each([
    ["nginx", true],
    ["nginx:1.27", true],
    ["registry.example.com:5000/team/app:2.0", true],
    ["app@sha256:0123abcdef", true],
    ["-q", false],
    ["", false],
    ["nginx latest", false],
    ["{{.}}", false],
  ])("isDockerImageReference(%p) is %p", (word: string, expected: boolean) => {
    expect(isDockerImageReference(word)).toBe(expected);
  });

  test.each([
    ["30m", true],
    ["0s", true],
    ["1h30m", true],
    ["1.5h", true],
    ["300ms", true],
    ["2026-09-29", true],
    ["2026-09-29T10:00", true],
    ["2026-09-29T10:00:00Z", true],
    ["2026-09-29T10:00:00.123+02:00", true],
    ["1758000000", true],
    ["1758000000.25", true],
    ["0", false],
    ["", false],
    ["-10m", false],
    ["+10m", false],
    ["10", false],
    ["yesterday", false],
    ["30 m", false],
    ["1h".repeat(40), false],
  ])("isDockerTimeValue(%p) is %p", (value: string, expected: boolean) => {
    expect(isDockerTimeValue(value)).toBe(expected);
  });

  test("isGoDuration accepts 0 (update delays) but not garbage", () => {
    expect(isGoDuration("0")).toBe(true);
    expect(isGoDuration("10s")).toBe(true);
    expect(isGoDuration("soon")).toBe(false);
    expect(isGoDuration("-1s")).toBe(false);
  });

  test.each([
    ["0", 10, 0],
    ["10", 10, 10],
    ["0010", 10, 10],
    ["11", 10, null],
    ["-1", 10, null],
    ["+1", 10, null],
    ["1.5", 10, null],
    ["", 10, null],
    ["1e3", 10000, null],
    ["9".repeat(10), 10, null],
  ])("parseDockerCount(%p, %p) is %p", (value: string, max: number, expected: number | null) => {
    expect(parseDockerCount(value, max)).toBe(expected);
  });

  test.each([
    ["512m", true],
    ["1g", true],
    ["1.5GiB", true],
    ["536870912", true],
    ["512MB", true],
    ["256b", true],
    ["lots", false],
    ["-1", false],
    ["1 g", false],
    ["1gg", false],
  ])("isDockerMemorySize(%p) is %p", (value: string, expected: boolean) => {
    expect(isDockerMemorySize(value)).toBe(expected);
  });

  test.each([
    ["0.5", true],
    ["2", true],
    ["1.25", true],
    ["two", false],
    ["-1", false],
    ["1.2345", false],
  ])("isDockerCpuCount(%p) is %p", (value: string, expected: boolean) => {
    expect(isDockerCpuCount(value)).toBe(expected);
  });

  test("filters must be KEY=VALUE", () => {
    const withFilters: (...filters: Array<string>) => DockerParsedArgs = (
      ...filters: Array<string>
    ): DockerParsedArgs => {
      return parse(
        filters.reduce(
          (words: Array<string>, filter: string): Array<string> => {
            return [...words, "--filter", filter];
          },
          [],
        ),
      );
    };

    expect(findBadDockerFilter(withFilters("status=exited"))).toBeNull();
    expect(findBadDockerFilter(withFilters("label=a=b", "name=^web$"))).toBeNull();
    expect(findBadDockerFilter(withFilters("status"))).toContain("KEY=VALUE");
    expect(findBadDockerFilter(withFilters("=x"))).toContain("KEY=VALUE");
    expect(findBadDockerFilter(withFilters("-q=x"))).toContain("KEY=VALUE");
    expect(
      findBadDockerFilter(withFilters(`name=${"x".repeat(300)}`)),
    ).toContain("KEY=VALUE");
  });

  test("formats are json or table, never a template", () => {
    const withFormat: (format: string) => DockerParsedArgs = (
      format: string,
    ): DockerParsedArgs => {
      return parseDockerFlags({
        words: ["--format", format],
        flags: [{ name: "format", kind: DockerFlagKind.Value }],
        command: "docker test",
        interspersed: true,
      });
    };

    expect(findBadDockerFormat(parse([]), ["json"])).toBeNull();
    expect(findBadDockerFormat(withFormat("json"), ["json"])).toBeNull();
    expect(findBadDockerFormat(withFormat("table"), ["json"])).toContain(
      '"json"',
    );
    expect(
      findBadDockerFormat(withFormat("{{json .}}"), ["json", "table"]),
    ).toContain("Go templates are not allowed");
    expect(findBadDockerFormat(withFormat("JSON"), ["json"])).not.toBeNull();
  });

  test("findBadDockerName names the first bad word", () => {
    expect(findBadDockerName(["web", "api"], "container")).toBeNull();
    expect(findBadDockerName(["web", "-x", "y z"], "container")).toContain(
      '"-x" is not a container name',
    );
  });

  test("uniqueDockerTargets keeps the first of each, in order", () => {
    expect(uniqueDockerTargets(["b", "a", "b", "c", "a"])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

describe("evaluateDockerArgv", () => {
  function spec(
    judgement: DockerJudgement | (() => DockerJudgement),
  ): DockerCommandSpec {
    return {
      verb: "probe",
      flags: [],
      judge(): DockerJudgement {
        return typeof judgement === "function" ? judgement() : judgement;
      },
    };
  }

  function profile(
    commands: Array<[string, DockerCommandSpec]>,
    refusals: Array<[string, string]> = [],
  ): DockerProfile {
    return {
      name: "test-profile",
      resourceDescription: "a test engine",
      commands: new Map<string, DockerCommandSpec>(commands),
      refusals: new Map<string, string>(refusals),
      allowedSummary: "Allowed: probe.",
    };
  }

  test("a Read never carries targets or requiresHuman", () => {
    const result: ResourceCommandPolicyResult = evaluateDockerArgv(
      profile([
        [
          "probe",
          spec({
            tier: ResourceCommandTier.Read,
            reason: "reads",
            targets: ["web"],
            requiresHuman: true,
          }),
        ],
      ]),
      ["docker", "probe"],
    );

    expect(result.tier).toBe(ResourceCommandTier.Read);
    expect(result.targets).toEqual([]);
    expect(result.requiresHuman).toBeUndefined();
    expect(result.verb).toBe("probe");
  });

  test("a write keeps its targets (once each) and requiresHuman", () => {
    const result: ResourceCommandPolicyResult = evaluateDockerArgv(
      profile([
        [
          "probe",
          spec({
            tier: ResourceCommandTier.RiskyWrite,
            reason: "writes",
            targets: ["web", "web", "api"],
            requiresHuman: true,
          }),
        ],
      ]),
      ["docker", "probe"],
    );

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.targets).toEqual(["web", "api"]);
    expect(result.requiresHuman).toBe(true);
  });

  test("an unknown tier from a judge is Denied", () => {
    const result: ResourceCommandPolicyResult = evaluateDockerArgv(
      profile([
        [
          "probe",
          spec({
            tier: "Mystery" as ResourceCommandTier,
            reason: "?",
            targets: ["web"],
          }),
        ],
      ]),
      ["docker", "probe"],
    );

    expect(result.targets).toEqual([]);
    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.verb).toBe("probe");
  });

  test("a judge that throws is Denied by the safe wrapper", () => {
    const broken: DockerProfile = profile([
      [
        "probe",
        spec((): DockerJudgement => {
          throw new Error("boom");
        }),
      ],
    ]);

    expect(() => {
      evaluateDockerArgv(broken, ["docker", "probe"]);
    }).toThrow();

    const result: ResourceCommandPolicyResult = evaluateDockerArgvSafely(
      broken,
      ["docker", "probe"],
    );

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain("could not evaluate");
  });

  test("refusals: the profile's path, then its group, then the shared list", () => {
    const refusing: DockerProfile = profile(
      [],
      [
        ["exec", "is refused by the profile"],
        ["service", "is refused as a group"],
      ],
    );

    expect(evaluateDockerArgv(refusing, ["docker", "exec", "x"]).reason).toBe(
      "docker exec is never allowed for a test engine: it is refused by the profile. Allowed: probe.",
    );
    expect(
      evaluateDockerArgv(refusing, ["docker", "service", "ls"]).reason,
    ).toContain("docker service ls is never allowed for a test engine: it is refused as a group");
    expect(
      evaluateDockerArgv(refusing, ["docker", "service"]).reason,
    ).toContain("docker service is never allowed for a test engine: it is refused as a group");
    expect(evaluateDockerArgv(refusing, ["docker", "run", "x"]).reason).toContain(
      "creates and starts a new container",
    );
    expect(evaluateDockerArgv(refusing, ["docker", "probe"]).reason).toContain(
      "docker probe is not a docker command OneUptime AI may run",
    );
  });

  test("bounds are enforced even without the dispatcher", () => {
    const open: DockerProfile = profile([
      ["probe", spec({ tier: ResourceCommandTier.Read, reason: "reads" })],
    ]);

    expect(
      evaluateDockerArgv(open, [
        "docker",
        "probe",
        ...Array.from({ length: 63 }, (): string => {
          return "x";
        }),
      ]).reason,
    ).toContain("at most 64 words");
    expect(
      evaluateDockerArgv(open, ["docker", "probe", "x".repeat(2000)]).reason,
    ).toContain("2000-character limit");
  });

  test("mergeDockerCommands keeps the first table's spec for a path", () => {
    const first: DockerCommandSpec = spec({
      tier: ResourceCommandTier.Read,
      reason: "first",
    });
    const second: DockerCommandSpec = spec({
      tier: ResourceCommandTier.Read,
      reason: "second",
    });

    const merged: ReadonlyMap<string, DockerCommandSpec> = mergeDockerCommands(
      new Map<string, DockerCommandSpec>([["probe", first]]),
      new Map<string, DockerCommandSpec>([
        ["probe", second],
        ["other", second],
      ]),
    );

    expect(merged.get("probe")).toBe(first);
    expect(merged.get("other")).toBe(second);
  });
});

describe("the two profiles and the shared refusals agree", () => {
  test("no refused path is also an allowed command of either profile", () => {
    for (const profileUnderTest of [DOCKER_ENGINE_PROFILE, DOCKER_SWARM_PROFILE]) {
      for (const path of DOCKER_COMMAND_REFUSALS.keys()) {
        expect(profileUnderTest.commands.has(path)).toBe(false);
      }

      for (const path of profileUnderTest.refusals.keys()) {
        expect(profileUnderTest.commands.has(path)).toBe(false);
      }
    }
  });

  test("each profile's commands are keyed by their own verb", () => {
    for (const profileUnderTest of [DOCKER_ENGINE_PROFILE, DOCKER_SWARM_PROFILE]) {
      profileUnderTest.commands.forEach(
        (commandSpec: DockerCommandSpec, path: string): void => {
          expect(commandSpec.verb).toBe(path);
        },
      );
    }
  });

  test("the engine refuses every swarm group; the swarm refuses every engine write", () => {
    for (const group of DOCKER_SWARM_GROUPS) {
      expect(DOCKER_ENGINE_PROFILE.refusals.has(group)).toBe(true);
    }

    for (const path of DOCKER_ENGINE_WRITE_PATHS) {
      expect(DOCKER_SWARM_PROFILE.refusals.has(path)).toBe(true);
      expect(DOCKER_ENGINE_PROFILE.commands.has(path)).toBe(true);
    }

    for (const path of DOCKER_ENGINE_READ_COMMANDS.keys()) {
      expect(DOCKER_ENGINE_PROFILE.commands.has(path)).toBe(true);
      expect(DOCKER_SWARM_PROFILE.commands.has(path)).toBe(true);
    }
  });
});
