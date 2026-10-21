import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS,
  MAX_POSTURE_LIST_ENTRIES,
  MAX_POSTURE_STRING_LENGTH,
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  MAX_RESOURCE_COMMANDS_PER_INVESTIGATION,
  MAX_RESOURCE_COMMAND_OUTPUT_CHARS_FOR_LLM,
  MAX_RESOURCE_COMMAND_TIMEOUT_MS,
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  RESOURCE_AI_AGENT_API_KEY_ENVS,
  RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_INGEST_PATH,
  RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceAiAgentPosture,
  ResourceAiAgentRegistrationRefusalReason,
  ResourceAiRemediationMode,
  ResourceCommandTier,
  TRANSIENT_RESOURCE_AI_AGENT_REGISTRATION_REFUSALS,
  UNATTENDED_RESOURCE_REMEDIATION_MODES,
  isTransientResourceAiAgentRegistrationRefusal,
  isUnattendedResourceRemediationMode,
  parseResourceAiAgentPosture,
  parseResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  MAX_KUBECTL_COMMANDS_PER_INVESTIGATION,
  MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM,
  MAX_KUBECTL_TIMEOUT_MS,
  UNATTENDED_REMEDIATION_MODES,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the resource AI agent's shared vocabulary.
 *
 * - The tier and mode enums carry exactly the Kubernetes string values, so
 *   a stored tier or mode means the same thing on a cluster and on any
 *   other resource (and the dashboard, prompts and ladders can share them).
 * - An unknown mode reads as Disabled, never as something wider.
 * - The posture the agent reports is parsed strictly and fails closed:
 *   writes are allowed only for the boolean true, and a malformed write
 *   scope turns writes off rather than being partly trusted.
 * - The env names, ingest path, image, health port and caps other units
 *   (agent, server, docs) code against are pinned.
 */

function posture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "prod-web-1",
    agentVersion: "14.0.8",
    allowWrites: true,
    allowWritesSetting: "true",
    writeTargets: ["web-*"],
    protectedTargets: ["oneuptime-ai-agent", "3f2a9c1b7d4e"],
    toolVersion: "27.3.1",
    reachable: true,
    reachError: null,
    details: { podmanRootless: false },
    reportedAt: "2026-09-28T10:00:00.000Z",
    ...overrides,
  };
}

describe("tier and mode parity with Kubernetes", () => {
  test("ResourceCommandTier has exactly KubectlCommandTier's names and values", () => {
    expect(Object.entries(ResourceCommandTier)).toEqual(
      Object.entries(KubectlCommandTier),
    );
  });

  test("ResourceAiRemediationMode has exactly KubernetesAiRemediationMode's names and values", () => {
    expect(Object.entries(ResourceAiRemediationMode)).toEqual(
      Object.entries(KubernetesAiRemediationMode),
    );
  });

  test("the unattended modes are the same values in the same order", () => {
    expect(UNATTENDED_RESOURCE_REMEDIATION_MODES as Array<string>).toEqual(
      UNATTENDED_REMEDIATION_MODES as Array<string>,
    );
    expect(UNATTENDED_RESOURCE_REMEDIATION_MODES).toEqual([
      ResourceAiRemediationMode.Automatic,
      ResourceAiRemediationMode.BypassApproval,
    ]);
  });

  test("the shared caps match the kubectl lane's", () => {
    expect(MAX_RESOURCE_COMMANDS_PER_INVESTIGATION).toBe(
      MAX_KUBECTL_COMMANDS_PER_INVESTIGATION,
    );
    expect(MAX_RESOURCE_COMMAND_TIMEOUT_MS).toBe(MAX_KUBECTL_TIMEOUT_MS);
    expect(MAX_RESOURCE_COMMAND_OUTPUT_CHARS_FOR_LLM).toBe(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM,
    );
    expect(RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES).toBe(
      KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
    );
  });
});

describe("isUnattendedResourceRemediationMode", () => {
  test.each([
    [ResourceAiRemediationMode.Automatic, true],
    [ResourceAiRemediationMode.BypassApproval, true],
    [ResourceAiRemediationMode.RequireApproval, false],
    [ResourceAiRemediationMode.Disabled, false],
    [undefined, false],
    [null, false],
  ])(
    "%p is unattended: %p",
    (mode: ResourceAiRemediationMode | undefined | null, expected: boolean) => {
      expect(isUnattendedResourceRemediationMode(mode)).toBe(expected);
    },
  );

  test("a value that is not a mode is never unattended", () => {
    expect(
      isUnattendedResourceRemediationMode(
        "automatic" as ResourceAiRemediationMode,
      ),
    ).toBe(false);
  });
});

describe("parseResourceAiRemediationMode", () => {
  test.each(Object.values(ResourceAiRemediationMode))(
    "reads %s exactly",
    (mode: ResourceAiRemediationMode) => {
      expect(parseResourceAiRemediationMode(mode)).toBe(mode);
    },
  );

  test.each([
    ["automatic"],
    ["AUTOMATIC"],
    [" Automatic"],
    ["Bypass"],
    [""],
    [null],
    [undefined],
    [1],
    [{}],
    [["Automatic"]],
  ])("reads %p as Disabled, never wider", (value: unknown) => {
    expect(parseResourceAiRemediationMode(value)).toBe(
      ResourceAiRemediationMode.Disabled,
    );
  });
});

describe("pinned wire and deployment constants", () => {
  test("ingest path, image, health port and alive window", () => {
    expect(RESOURCE_AI_AGENT_INGEST_PATH).toBe("/resource-ai-agent-ingest");
    expect(RESOURCE_AI_AGENT_IMAGE_REPOSITORY).toBe(
      "oneuptime/resource-ai-agent",
    );
    expect(RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT).toBe(3877);
    // The Kubernetes AI agent listens on 3876; both may share a host.
    expect(RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT).not.toBe(3876);
    expect(RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES).toBe(5);
  });

  test("the environment the agent reads", () => {
    expect(RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV).toBe(
      "ONEUPTIME_AI_AGENT_RESOURCE_TYPE",
    );
    expect(RESOURCE_AI_AGENT_RESOURCE_NAME_ENV).toBe(
      "ONEUPTIME_AI_AGENT_RESOURCE_NAME",
    );
    expect(RESOURCE_AI_ALLOW_WRITES_ENV).toBe("ONEUPTIME_AI_ALLOW_WRITES");
    expect(RESOURCE_AI_WRITE_TARGETS_ENV).toBe("ONEUPTIME_AI_WRITE_TARGETS");
    expect(RESOURCE_AI_AGENT_API_KEY_ENVS).toEqual([
      "ONEUPTIME_API_KEY",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "ONEUPTIME_SERVICE_TOKEN",
    ]);
  });

  test("the caps", () => {
    // A runaway guard, not a ration: an investigation runs what it needs.
    expect(MAX_RESOURCE_COMMANDS_PER_INVESTIGATION).toBe(200);
    expect(DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS).toBe(30_000);
    expect(MAX_RESOURCE_COMMAND_TIMEOUT_MS).toBe(120_000);
    // What a caller that does not page gets; the toolkits page everything.
    expect(MAX_RESOURCE_COMMAND_OUTPUT_CHARS_FOR_LLM).toBe(40_000);
    expect(MAX_RESOURCE_AGENT_OUTPUT_BYTES).toBe(1024 * 1024);
    expect(DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS).toBeLessThan(
      MAX_RESOURCE_COMMAND_TIMEOUT_MS,
    );
    expect(MAX_POSTURE_LIST_ENTRIES).toBe(64);
    expect(MAX_POSTURE_STRING_LENGTH).toBe(256);
  });
});

describe("registration refusals", () => {
  const ALL_REASONS: Array<ResourceAiAgentRegistrationRefusalReason> = [
    "resource_type_invalid",
    "resource_identifier_invalid",
    "resource_not_found",
    "previous_instance_online",
    "agent_cap_reached",
  ];

  test("only previous_instance_online clears on its own", () => {
    expect(TRANSIENT_RESOURCE_AI_AGENT_REGISTRATION_REFUSALS).toEqual([
      "previous_instance_online",
    ]);
    expect(
      ALL_REASONS.filter(
        (reason: ResourceAiAgentRegistrationRefusalReason): boolean => {
          return isTransientResourceAiAgentRegistrationRefusal(reason);
        },
      ),
    ).toEqual(["previous_instance_online"]);
  });

  test.each([
    ["legacy_runner_online"],
    ["PREVIOUS_INSTANCE_ONLINE"],
    [" previous_instance_online"],
    [""],
    [null],
    [undefined],
    [403],
    [{}],
  ])("%p is not a transient refusal", (value: unknown) => {
    expect(isTransientResourceAiAgentRegistrationRefusal(value)).toBe(false);
  });
});

describe("parseResourceAiAgentPosture", () => {
  test("reads a well-formed posture", () => {
    const parsed: ResourceAiAgentPosture | null =
      parseResourceAiAgentPosture(posture());

    expect(parsed).toEqual({
      resourceType: AiResourceType.DockerHost,
      resourceIdentifier: "prod-web-1",
      agentVersion: "14.0.8",
      allowWrites: true,
      allowWritesSetting: "true",
      writeTargets: ["web-*"],
      protectedTargets: ["oneuptime-ai-agent", "3f2a9c1b7d4e"],
      toolVersion: "27.3.1",
      reachable: true,
      reachError: null,
      details: { podmanRootless: false },
      reportedAt: "2026-09-28T10:00:00.000Z",
    });
  });

  test("reads a minimal posture with every optional field defaulted closed", () => {
    const parsed: ResourceAiAgentPosture | null = parseResourceAiAgentPosture({
      resourceType: AiResourceType.Host,
      resourceIdentifier: "db-1",
    });

    expect(parsed).toEqual({
      resourceType: AiResourceType.Host,
      resourceIdentifier: "db-1",
      agentVersion: null,
      allowWrites: false,
      allowWritesSetting: null,
      writeTargets: [],
      protectedTargets: [],
      toolVersion: null,
      reachable: false,
      reachError: null,
      details: {},
    });
  });

  test.each([
    [null],
    [undefined],
    ["posture"],
    [42],
    [true],
    [[]],
    [[posture()]],
  ])("%p is not a posture", (value: unknown) => {
    expect(parseResourceAiAgentPosture(value)).toBeNull();
  });

  test.each([
    [{ resourceType: undefined }],
    [{ resourceType: "docker" }],
    [{ resourceType: "dockerhost" }],
    [{ resourceType: "KubernetesCluster" }],
    [{ resourceType: 1 }],
    [{ resourceIdentifier: undefined }],
    [{ resourceIdentifier: "" }],
    [{ resourceIdentifier: "   " }],
    [{ resourceIdentifier: 7 }],
    [{ resourceIdentifier: "x".repeat(257) }],
  ])(
    "is null when the identity is not exact: %p",
    (overrides: Record<string, unknown>) => {
      expect(parseResourceAiAgentPosture(posture(overrides))).toBeNull();
    },
  );

  test("trims the identifier and accepts exactly 256 characters", () => {
    expect(
      parseResourceAiAgentPosture(
        posture({ resourceIdentifier: "  prod-web-1 " }),
      )?.resourceIdentifier,
    ).toBe("prod-web-1");
    expect(
      parseResourceAiAgentPosture(
        posture({ resourceIdentifier: "x".repeat(256) }),
      )?.resourceIdentifier,
    ).toBe("x".repeat(256));
  });

  test.each([
    ["true"],
    ["TRUE"],
    [1],
    ["yes"],
    [{}],
    [[true]],
    [null],
    [undefined],
    [false],
  ])("allowWrites %p is not true", (value: unknown) => {
    expect(
      parseResourceAiAgentPosture(posture({ allowWrites: value }))?.allowWrites,
    ).toBe(false);
  });

  test.each([
    ["reachable", "true"],
    ["reachable", 1],
    ["reachable", undefined],
  ])("%s %p is not true", (field: string, value: unknown) => {
    expect(
      parseResourceAiAgentPosture(posture({ [field]: value }))?.reachable,
    ).toBe(false);
  });

  describe("a malformed write scope turns writes off", () => {
    test.each([
      ["writeTargets", "web-*"],
      ["writeTargets", [1]],
      ["writeTargets", ["web-*", null]],
      ["writeTargets", ["web-*", ""]],
      ["writeTargets", ["   "]],
      ["writeTargets", ["x".repeat(257)]],
      ["writeTargets", { 0: "web-*" }],
      [
        "writeTargets",
        Array.from({ length: 65 }, (_: unknown, i: number): string => {
          return `svc-${i}`;
        }),
      ],
      ["protectedTargets", "oneuptime-ai-agent"],
      ["protectedTargets", [{ name: "oneuptime-ai-agent" }]],
      ["protectedTargets", ["oneuptime-ai-agent", 7]],
      [
        "protectedTargets",
        Array.from({ length: 65 }, (_: unknown, i: number): string => {
          return `p-${i}`;
        }),
      ],
    ])("%s = %p", (field: string, value: unknown) => {
      const parsed: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
        posture({ [field]: value }),
      );

      expect(parsed).not.toBeNull();
      expect(parsed?.allowWrites).toBe(false);
      /*
       * Never partly trusted: a list that broke the rules is empty, and
       * with allowWrites false no write runs whatever it would have said.
       */
      expect(parsed?.[field as "writeTargets" | "protectedTargets"]).toEqual(
        [],
      );
    });
  });

  test("absent or null lists read as [] and leave allowWrites alone", () => {
    for (const value of [undefined, null]) {
      const parsed: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
        posture({ writeTargets: value, protectedTargets: value }),
      );

      expect(parsed?.writeTargets).toEqual([]);
      expect(parsed?.protectedTargets).toEqual([]);
      expect(parsed?.allowWrites).toBe(true);
    }
  });

  test("lists are trimmed and de-duplicated, and exactly 64 entries are accepted", () => {
    const sixtyFour: Array<string> = Array.from(
      { length: 64 },
      (_: unknown, i: number): string => {
        return `svc-${i}`;
      },
    );

    const parsed: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
      posture({
        writeTargets: [" web-* ", "web-*", "api"],
        protectedTargets: sixtyFour,
      }),
    );

    expect(parsed?.writeTargets).toEqual(["web-*", "api"]);
    expect(parsed?.protectedTargets).toEqual(sixtyFour);
    expect(parsed?.allowWrites).toBe(true);
  });

  test("display strings are trimmed, capped at 256 characters, and null when not strings", () => {
    const parsed: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
      posture({
        agentVersion: "  14.0.8  ",
        toolVersion: "v".repeat(400),
        reachError: 42,
        allowWritesSetting: "",
      }),
    );

    expect(parsed?.agentVersion).toBe("14.0.8");
    expect(parsed?.toolVersion).toBe("v".repeat(256));
    expect(parsed?.reachError).toBeNull();
    expect(parsed?.allowWritesSetting).toBeNull();
  });

  test("details keep only scalar values, at most 64 of them, and never prototype keys", () => {
    const raw: Record<string, unknown> = {
      swarmRole: "manager",
      podmanRootless: true,
      port: 5432,
      nothing: null,
      nested: { a: 1 },
      list: [1, 2],
      notANumber: Number.NaN,
      infinite: Number.POSITIVE_INFINITY,
      fn: (): number => {
        return 1;
      },
      long: "y".repeat(300),
    };
    Object.defineProperty(raw, "__proto__", {
      value: "polluted",
      enumerable: true,
    });
    raw["constructor"] = "polluted";

    const parsed: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
      posture({ details: raw }),
    );

    expect(parsed?.details).toEqual({
      swarmRole: "manager",
      podmanRootless: true,
      port: 5432,
      nothing: null,
      long: "y".repeat(256),
    });
    expect(Object.getPrototypeOf(parsed?.details)).toBe(Object.prototype);

    const many: Record<string, number> = {};
    for (let i: number = 0; i < 100; i++) {
      many[`k${i}`] = i;
    }

    expect(
      Object.keys(
        parseResourceAiAgentPosture(posture({ details: many }))?.details || {},
      ),
    ).toHaveLength(64);
  });

  test.each([[[1, 2]], ["manager"], [7], [null]])(
    "details %p read as {}",
    (value: unknown) => {
      expect(
        parseResourceAiAgentPosture(posture({ details: value }))?.details,
      ).toEqual({});
    },
  );

  test("reportedAt is kept only when it parses as a date", () => {
    expect(
      parseResourceAiAgentPosture(posture({ reportedAt: "not a date" })),
    ).not.toHaveProperty("reportedAt");
    expect(
      parseResourceAiAgentPosture(posture({ reportedAt: 1700000000000 })),
    ).not.toHaveProperty("reportedAt");
    expect(
      parseResourceAiAgentPosture(
        posture({ reportedAt: `2026-09-28T10:00:00Z${" ".repeat(80)}` }),
      ),
    ).not.toHaveProperty("reportedAt");
  });

  test("unknown fields never reach the parsed posture", () => {
    const parsed: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
      posture({ agentKey: "secret", credential: { password: "x" } }),
    );

    expect(parsed).not.toHaveProperty("agentKey");
    expect(parsed).not.toHaveProperty("credential");
  });
});
