import { testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import { AgentConfig } from "../Config";
import PrepareGuard, {
  DEFAULT_GUARD_POLICY,
  GuardPolicy,
  GuardResult,
  GuardedCommand,
  getAgentDisplayName,
  isSameResourceIdentifier,
  mergeTargets,
  refusalPrefix,
} from "../Executors/PrepareGuard";
import { ResourceCommandRequest } from "../Executors/ResourceExecutor";
import { fakePolicy } from "./Helpers/FakeExecutor";
import { TEST_RESOURCE_ID, testPayload } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  ResourceCommandPolicyResult,
  deniedResult,
} from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * PrepareGuard: the checks every executor runs first. The per-tool
 * policies are strict (and some are still fail-closed stubs), so most cases
 * inject a table-driven policy (fakePolicy) that keeps the REAL write-scope
 * rule; the last block runs the real policy for what the dispatcher itself
 * decides whatever the tool module says.
 */

const URL: string = "https://oneuptime.example.com";

const TABLE: GuardPolicy & { calls: Array<Array<string>> } = fakePolicy({
  "docker ps": ResourceCommandTier.Read,
  "docker restart web-1": ResourceCommandTier.SafeWrite,
  "docker restart api-1": ResourceCommandTier.SafeWrite,
  "docker restart traefik": ResourceCommandTier.SafeWrite,
  "docker stop web-1": ResourceCommandTier.RiskyWrite,
  "docker node drain": {
    tier: ResourceCommandTier.RiskyWrite,
    targets: [],
  },
  "docker kill web-1": {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: true,
  },
  "docker ps -a": {
    tier: ResourceCommandTier.Read,
    args: ["ps", "--all"],
  },
});

function config(overrides: Record<string, string> = {}): AgentConfig {
  return testConfig(URL, overrides);
}

function request(
  payload: Record<string, unknown> = {},
  overrides: Partial<ResourceCommandRequest> = {},
): ResourceCommandRequest {
  return {
    payload: testPayload(payload),
    origin: "AiInvestigation",
    timeoutInMs: 30_000,
    ...overrides,
  };
}

function check(data: {
  config?: AgentConfig;
  request?: ResourceCommandRequest;
  protectedTargets?: Array<string>;
  policy?: GuardPolicy;
}): GuardResult {
  return PrepareGuard.check({
    config: data.config || config(),
    request: data.request || request(),
    protectedTargets: data.protectedTargets,
    policy: data.policy || TABLE,
  });
}

function expectRefused(result: GuardResult, pattern: RegExp): string {
  assert.notStrictEqual(result.refusal, null, "refused");
  const refusal: string = result.refusal as string;
  assert.match(refusal, /^Refused by the /);
  assert.match(refusal, pattern);
  return refusal;
}

function expectAllowed(result: GuardResult): GuardedCommand {
  assert.strictEqual(result.refusal, null, String(result.refusal));
  return result as GuardedCommand;
}

const WRITE_REMEDIATION: Record<string, unknown> = {
  args: ["restart", "web-1"],
  displayCommand: "docker restart web-1",
  tier: "SafeWrite",
};

describe("a command every check allows", () => {
  test("a read from an investigation: the guarded command, as the executor runs it", () => {
    const guarded: GuardedCommand = expectAllowed(check({}));

    assert.strictEqual(guarded.resourceType, AiResourceType.DockerHost);
    assert.strictEqual(guarded.program, "docker");
    assert.deepStrictEqual(guarded.args, ["ps"]);
    assert.deepStrictEqual(guarded.argv, ["docker", "ps"]);
    assert.strictEqual(guarded.tier, ResourceCommandTier.Read);
    assert.strictEqual(guarded.displayCommand, "docker ps");
    assert.strictEqual(guarded.policy.tier, ResourceCommandTier.Read);
    assert.strictEqual(guarded.timeoutInMs, 30_000);
  });

  test("the policy sees the argv with the program, and a copy of it", () => {
    const payload: Record<string, unknown> = testPayload();
    const args: Array<string> = payload["args"] as Array<string>;
    const mutating: GuardPolicy = {
      ...TABLE,
      evaluateArgv: (data: {
        resourceType: AiResourceType;
        argv: Array<string>;
      }): ResourceCommandPolicyResult => {
        const result: ResourceCommandPolicyResult = TABLE.evaluateArgv(data);
        data.argv.push("--mutated");
        return result;
      },
    };

    const guarded: GuardedCommand = expectAllowed(
      PrepareGuard.check({
        config: config(),
        request: { payload, origin: "AiInvestigation", timeoutInMs: 1_000 },
        policy: mutating,
      }),
    );

    assert.deepStrictEqual(args, ["ps"]);
    assert.deepStrictEqual(guarded.argv, ["docker", "ps"]);
    assert.deepStrictEqual(TABLE.calls[TABLE.calls.length - 1], [
      "docker",
      "ps",
    ]);
  });

  test("a read runs on a read-only agent", () => {
    expectAllowed(
      check({ config: config({ ONEUPTIME_AI_ALLOW_WRITES: "no" }) }),
    );
  });

  test("a write from a remediation on a writable agent", () => {
    const guarded: GuardedCommand = expectAllowed(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        request: request(WRITE_REMEDIATION, { origin: "AiRemediation" }),
      }),
    );

    assert.strictEqual(guarded.tier, ResourceCommandTier.SafeWrite);
    assert.deepStrictEqual(guarded.args, ["restart", "web-1"]);
  });

  test("a write inside the write targets", () => {
    expectAllowed(
      check({
        config: config({
          ONEUPTIME_AI_ALLOW_WRITES: "true",
          ONEUPTIME_AI_WRITE_TARGETS: "web-*",
        }),
        request: request(WRITE_REMEDIATION, { origin: "AiRemediation" }),
      }),
    );
  });

  test("the server may claim a higher tier than the agent reads: the agent's tier wins", () => {
    const guarded: GuardedCommand = expectAllowed(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        request: request(
          { ...WRITE_REMEDIATION, tier: "RiskyWrite" },
          { origin: "AiRemediation" },
        ),
      }),
    );

    assert.strictEqual(guarded.tier, ResourceCommandTier.SafeWrite);
  });

  test("a command only a human may approve is not the agent's to refuse (the server gated it)", () => {
    expectAllowed(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        request: request(
          {
            args: ["kill", "web-1"],
            displayCommand: "docker kill web-1",
            tier: "RiskyWrite",
          },
          { origin: "AiRemediation" },
        ),
      }),
    );
  });

  test("the identity matches ignoring case and whitespace; a known resource id must match too", () => {
    expectAllowed(
      check({ request: request({ resourceIdentifier: "  WEB-HOST-1 " }) }),
    );
    expectAllowed(
      check({
        request: request(
          { resourceId: TEST_RESOURCE_ID.toUpperCase() },
          { agentResourceId: TEST_RESOURCE_ID },
        ),
      }),
    );
    // Unknown (not registered yet): the resource id is not checked.
    expectAllowed(
      check({
        request: request({ resourceId: "whatever" }, { agentResourceId: null }),
      }),
    );
  });
});

describe("refusals", () => {
  test("an agent without a resource type runs nothing", () => {
    const refusal: string = expectRefused(
      check({ config: config({ ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "" }) }),
      /it has no resource type configured, so it runs nothing/,
    );
    assert.match(refusal, /^Refused by the resource AI agent:/);
  });

  test("an agent that does not know its resource's name runs nothing", () => {
    expectRefused(
      check({
        config: config({
          ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
          DOCKER_HOST_NAME: "",
        }),
        request: request({ resourceType: "Host", program: "uptime", args: [] }),
      }),
      /^Refused by the Host AI agent: it does not know which Host it serves/,
    );
  });

  test("no payload, or no program and argv", () => {
    for (const payload of [null, [], "docker ps"]) {
      expectRefused(
        PrepareGuard.check({
          config: config(),
          request: {
            payload: payload as unknown as Record<string, unknown>,
            origin: "AiInvestigation",
            timeoutInMs: 1,
          },
          policy: TABLE,
        }),
        /arrived without a command/,
      );
    }

    for (const bad of [
      { program: undefined },
      { program: "  " },
      { program: 7 },
      { args: undefined },
      { args: "ps" },
      { args: ["ps", 5] },
    ]) {
      expectRefused(
        check({ request: request(bad) }),
        /without a command to run \(a program and its arguments\)/,
      );
    }
  });

  test("an origin that is not OneUptime AI", () => {
    expectRefused(
      check({ request: request({}, { origin: "Runbook" }) }),
      /this job came from "Runbook"/,
    );
    expectRefused(
      check({ request: request({}, { origin: "" }) }),
      /this job came from "\(unknown\)"/,
    );
  });

  test("another resource type", () => {
    expectRefused(
      check({ request: request({ resourceType: "PodmanHost" }) }),
      /this command is for a "PodmanHost" resource, and this agent serves a Docker host/,
    );
    expectRefused(
      check({ request: request({ resourceType: undefined }) }),
      /"\(not specified\)" resource/,
    );
  });

  test("another resource: a blank identity never matches", () => {
    expectRefused(
      check({ request: request({ resourceIdentifier: "web-host-2" }) }),
      /this command is for Docker host "web-host-2", but this agent serves "web-host-1". Check DOCKER_HOST_NAME/,
    );

    for (const identifier of ["", "   ", undefined, 5]) {
      expectRefused(
        check({ request: request({ resourceIdentifier: identifier }) }),
        /this command is for Docker host "\(not specified\)"/,
      );
    }
  });

  test("another resource id, or none, once the agent knows its own", () => {
    expectRefused(
      check({
        request: request(
          { resourceId: "other-id" },
          { agentResourceId: TEST_RESOURCE_ID },
        ),
      }),
      /this command is for resource id "other-id", but this agent is registered for/,
    );
    expectRefused(
      check({
        request: request(
          { resourceId: undefined },
          { agentResourceId: TEST_RESOURCE_ID },
        ),
      }),
      /resource id "\(not specified\)"/,
    );
  });

  test("a program this resource type does not run — the policy is never asked", () => {
    const before: number = TABLE.calls.length;

    expectRefused(
      check({ request: request({ program: "rm", args: ["-rf", "/"] }) }),
      /"rm" is not a program the Docker AI agent runs \(it runs docker\)/,
    );
    expectRefused(
      check({ request: request({ program: "/usr/bin/docker" }) }),
      /"\/usr\/bin\/docker" is not a program/,
    );
    assert.strictEqual(TABLE.calls.length, before);
  });

  test("a command the policy denies, with the policy's reason", () => {
    expectRefused(
      check({ request: request({ args: ["exec", "web-1", "sh"] }) }),
      /: not in the fake policy's table\.$/,
    );
  });

  test("a policy that throws, or answers nothing, refuses", () => {
    expectRefused(
      check({
        policy: {
          ...TABLE,
          evaluateArgv: (): ResourceCommandPolicyResult => {
            throw new Error("boom");
          },
        },
      }),
      /could not evaluate this command/,
    );
    expectRefused(
      check({
        policy: {
          ...TABLE,
          evaluateArgv: (): ResourceCommandPolicyResult => {
            return null as unknown as ResourceCommandPolicyResult;
          },
        },
      }),
      /the command is denied/,
    );
  });

  test("the agent's policy reading the argv differently from the server refuses", () => {
    // The policy normalizes "-a" to "--all": the server would have sent that.
    expectRefused(
      check({ request: request({ args: ["ps", "-a"] }) }),
      /its command policy reads "docker ps --all" differently from OneUptime/,
    );

    expectRefused(
      check({
        policy: {
          ...TABLE,
          evaluateArgv: (data: {
            resourceType: AiResourceType;
            argv: Array<string>;
          }): ResourceCommandPolicyResult => {
            return {
              ...TABLE.evaluateArgv(data),
              program: "podman",
            };
          },
        },
      }),
      /differently from OneUptime/,
    );

    expectRefused(
      check({
        policy: {
          ...TABLE,
          evaluateArgv: (data: {
            resourceType: AiResourceType;
            argv: Array<string>;
          }): ResourceCommandPolicyResult => {
            return {
              ...TABLE.evaluateArgv(data),
              tier: "Unknown" as ResourceCommandTier,
            };
          },
        },
      }),
      /differently from OneUptime/,
    );
  });

  test("a job that does not say (or mis-says) its tier", () => {
    for (const tier of [undefined, "", "read", "Denied", 1]) {
      expectRefused(
        check({ request: request({ tier }) }),
        /the job does not say which tier "docker ps" is/,
      );
    }
  });

  test("a write the server sent as something milder", () => {
    expectRefused(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        request: request(
          {
            args: ["stop", "web-1"],
            displayCommand: "docker stop web-1",
            tier: "SafeWrite",
          },
          { origin: "AiRemediation" },
        ),
      }),
      /OneUptime sent "docker stop web-1" as SafeWrite, but this agent's policy reads it as RiskyWrite/,
    );
  });

  test("an investigation may only read", () => {
    expectRefused(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        request: request(WRITE_REMEDIATION),
      }),
      /an investigation may only run read-only commands, and "docker restart web-1" is SafeWrite/,
    );
  });

  test("a write on a read-only agent names the switch and its value", () => {
    expectRefused(
      check({
        request: request(WRITE_REMEDIATION, { origin: "AiRemediation" }),
      }),
      /changes the Docker host, and this agent is read-only \(ONEUPTIME_AI_ALLOW_WRITES is not set\). To let OneUptime AI apply fixes, set ONEUPTIME_AI_ALLOW_WRITES=true on the agent and restart it\./,
    );
    expectRefused(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "yes" }),
        request: request(WRITE_REMEDIATION, { origin: "AiRemediation" }),
      }),
      /read-only \(ONEUPTIME_AI_ALLOW_WRITES="yes"\)/,
    );
  });

  test("a write to a target the executor protects", () => {
    expectRefused(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        request: request(
          {
            args: ["restart", "traefik"],
            displayCommand: "docker restart traefik",
            tier: "SafeWrite",
          },
          { origin: "AiRemediation" },
        ),
        protectedTargets: ["traefik"],
      }),
      /would change traefik, which the Docker AI agent protects \(traefik\)/,
    );
  });

  test("a write to a target the configuration protects", () => {
    expectRefused(
      check({
        config: config({
          ONEUPTIME_AI_ALLOW_WRITES: "true",
          ONEUPTIME_AI_PROTECTED_TARGETS: "web-*",
        }),
        request: request(WRITE_REMEDIATION, { origin: "AiRemediation" }),
      }),
      /which the Docker AI agent protects \(web-\*\)/,
    );
  });

  test("a write outside the write targets, or one that names no target", () => {
    const scoped: AgentConfig = config({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_WRITE_TARGETS: "web-*",
    });

    expectRefused(
      check({
        config: scoped,
        request: request(
          {
            args: ["restart", "api-1"],
            displayCommand: "docker restart api-1",
            tier: "SafeWrite",
          },
          { origin: "AiRemediation" },
        ),
      }),
      /would change api-1, which is outside the targets the Docker AI agent may change \(ONEUPTIME_AI_WRITE_TARGETS=web-\*\)/,
    );
    expectRefused(
      check({
        config: scoped,
        request: request(
          {
            args: ["node", "drain"],
            displayCommand: "docker node drain",
            tier: "RiskyWrite",
          },
          { origin: "AiRemediation" },
        ),
      }),
      /does not name the objects it changes/,
    );
  });

  test("more protected targets than OneUptime accepts: no writes at all", () => {
    const many: Array<string> = Array.from(
      { length: 70 },
      (_: unknown, i: number): string => {
        return `p-${i}`;
      },
    );

    expectRefused(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        request: request(WRITE_REMEDIATION, { origin: "AiRemediation" }),
        protectedTargets: many,
      }),
      /it protects 70 targets, more than the 64 OneUptime accepts/,
    );
  });

  test("a write scope check that throws refuses", () => {
    expectRefused(
      check({
        config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        request: request(WRITE_REMEDIATION, { origin: "AiRemediation" }),
        policy: {
          ...TABLE,
          getWriteScopeRefusal: (): string | null => {
            throw new Error("boom");
          },
        },
      }),
      /its write scope could not be checked/,
    );
  });

  test("each type refuses in its own agent's name", () => {
    expectRefused(
      check({
        config: config({
          ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "ceph",
          CEPH_CLUSTER_NAME: "ceph-prod",
        }),
        request: request({ resourceType: "CephCluster" }),
      }),
      /^Refused by the Ceph AI agent: this command is for Ceph cluster "web-host-1", but this agent serves "ceph-prod". Check CEPH_CLUSTER_NAME/,
    );
  });
});

describe("with the real policy", () => {
  test("the default policy is ResourceCommandPolicy", () => {
    assert.strictEqual(
      DEFAULT_GUARD_POLICY.evaluateArgv({
        resourceType: AiResourceType.DockerHost,
        argv: ["sudo", "docker", "ps"],
      }).tier,
      ResourceCommandTier.Denied,
    );
    assert.strictEqual(
      DEFAULT_GUARD_POLICY.getWriteScopeRefusal({
        result: deniedResult(["docker", "ps"], "x"),
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        resourceType: AiResourceType.DockerHost,
      })?.includes("is denied by the command policy"),
      true,
    );
  });

  test("a word holding a newline is denied before any tool policy reads it", () => {
    expectRefused(
      PrepareGuard.check({
        config: config(),
        request: request({ args: ["ps", "a\nb"] }),
      }),
      /must be a single line/,
    );
  });

  test("anything the real policy does not allow never gets through", () => {
    const result: GuardResult = PrepareGuard.check({
      config: config({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
      request: request(
        {
          args: ["run", "--privileged", "alpine"],
          displayCommand: "docker run --privileged alpine",
          tier: "RiskyWrite",
        },
        { origin: "AiRemediation" },
      ),
    });

    expectRefused(result, /./);
  });
});

describe("helpers", () => {
  test("display names and the refusal prefix", () => {
    assert.strictEqual(
      getAgentDisplayName(AiResourceType.DatabaseServer),
      "Database AI agent",
    );
    assert.strictEqual(getAgentDisplayName(null), "resource AI agent");
    assert.strictEqual(
      refusalPrefix(AiResourceType.VMwareVCenter),
      "Refused by the VMware AI agent",
    );
  });

  test("isSameResourceIdentifier", () => {
    assert.strictEqual(isSameResourceIdentifier("A", " a "), true);
    assert.strictEqual(isSameResourceIdentifier("", ""), false);
    assert.strictEqual(isSameResourceIdentifier(" ", " "), false);
    assert.strictEqual(isSameResourceIdentifier(undefined, "a"), false);
    assert.strictEqual(isSameResourceIdentifier("a", 5), false);
  });

  test("mergeTargets: trimmed, blanks and duplicates dropped, order kept", () => {
    assert.deepStrictEqual(
      mergeTargets([" a ", "b"], undefined, ["b", "", "c"], []),
      ["a", "b", "c"],
    );
  });
});
