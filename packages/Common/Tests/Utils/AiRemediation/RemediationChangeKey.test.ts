import { getRemediationChangeKey } from "../../../Utils/AiRemediation/RemediationChangeKey";
import {
  AiRemediationCommand,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - which change a command makes
 * (Utils/AiRemediation/RemediationChangeKey), so the same fix is told apart
 * from another across incidents:
 *
 *  - kubectl: the verb (and subcommand) on its one object, in its
 *    namespace, on its cluster - whatever its numbers;
 *  - a cloud change: the catalog's operation on its one resource, in its
 *    account - whatever its flags; an Azure id compares without case;
 *  - any other command: word for word, on its resource;
 *  - a Bash step: word for word, on its Runner;
 *  - nothing it cannot read has a key, and it never throws.
 */

const CLUSTER_A: string = "aaaaaaaa-1111-4111-8111-111111111111";
const CLUSTER_B: string = "bbbbbbbb-2222-4222-8222-222222222222";
const ACCOUNT: string = "cccccccc-3333-4333-8333-333333333333";
const OTHER_ACCOUNT: string = "dddddddd-4444-4444-8444-444444444444";
const RUNNER: string = "eeeeeeee-5555-4555-8555-555555555555";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const AZURE_SITE: string =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers/Microsoft.Web/sites/web";

function kubectl(
  command: string,
  cluster: string = CLUSTER_A,
): Pick<
  AiRemediationCommand,
  | "stepType"
  | "command"
  | "runnerId"
  | "kubernetesClusterId"
  | "resourceType"
  | "resourceId"
> {
  return {
    stepType: RunbookStepType.Kubectl,
    command,
    runnerId: RUNNER,
    kubernetesClusterId: cluster,
  };
}

function resource(
  command: string,
  resourceType: AiResourceType = AiResourceType.AwsAccount,
  resourceId: string = ACCOUNT,
): Pick<
  AiRemediationCommand,
  | "stepType"
  | "command"
  | "runnerId"
  | "kubernetesClusterId"
  | "resourceType"
  | "resourceId"
> {
  return {
    stepType: RunbookStepType.ResourceCommand,
    command,
    runnerId: RUNNER,
    resourceType,
    resourceId,
  };
}

describe("kubectl: the verb on its one object, in its namespace, on its cluster", () => {
  test("a scale to 6 and a scale to 8 of the same deployment are one change", () => {
    const six: string | null = getRemediationChangeKey(
      kubectl("kubectl scale deployment/web --replicas=6 -n shop"),
    );
    const eight: string | null = getRemediationChangeKey(
      kubectl("kubectl scale deployment/web --replicas=8 -n shop"),
    );

    expect(six).not.toBeNull();
    expect(six).toBe(eight);
  });

  test("the same object, written two ways, is one change", () => {
    expect(
      getRemediationChangeKey(
        kubectl("kubectl rollout restart deployment/web -n shop"),
      ),
    ).toBe(
      getRemediationChangeKey(
        kubectl("kubectl rollout restart deploy web --namespace shop"),
      ),
    );
  });

  test("another verb, another subcommand, another object, namespace or cluster is another change", () => {
    const base: string | null = getRemediationChangeKey(
      kubectl("kubectl rollout restart deployment/web -n shop"),
    );

    for (const other of [
      kubectl("kubectl rollout undo deployment/web -n shop"),
      kubectl("kubectl scale deployment/web --replicas=3 -n shop"),
      kubectl("kubectl rollout restart deployment/api -n shop"),
      kubectl("kubectl rollout restart deployment/web -n payments"),
      kubectl("kubectl rollout restart deployment/web -n shop", CLUSTER_B),
    ]) {
      expect(getRemediationChangeKey(other)).not.toBe(base);
    }
  });

  test("a command that names no single object is compared as written", () => {
    const all: string | null = getRemediationChangeKey(
      kubectl("kubectl delete pod -l app=web -n shop"),
    );

    expect(all).not.toBeNull();
    expect(all).toBe(
      getRemediationChangeKey(kubectl("kubectl delete pod -l app=web -n shop")),
    );
    expect(all).not.toBe(
      getRemediationChangeKey(kubectl("kubectl delete pod -l app=api -n shop")),
    );
  });

  test("whether or not the model wrote kubectl, it is one change", () => {
    expect(
      getRemediationChangeKey(
        kubectl("rollout restart deployment/web -n shop"),
      ),
    ).toBe(
      getRemediationChangeKey(
        kubectl("kubectl rollout restart deployment/web -n shop"),
      ),
    );
  });

  test("a kubectl step with no cluster, or no verb, has no key", () => {
    expect(
      getRemediationChangeKey({
        stepType: RunbookStepType.Kubectl,
        command: "kubectl rollout restart deployment/web",
        runnerId: RUNNER,
      }),
    ).toBeNull();
    expect(getRemediationChangeKey(kubectl("kubectl"))).toBeNull();
    expect(getRemediationChangeKey(kubectl("   "))).toBeNull();
  });
});

describe("a cloud change: the operation on its one resource, in its account", () => {
  test("a scale out to 4 and to 8 of the same service are one change", () => {
    const four: string | null = getRemediationChangeKey(
      resource(`cloud scale-out ${ECS} --count 4`),
    );
    const eight: string | null = getRemediationChangeKey(
      resource(`cloud scale-out ${ECS} --count=8`),
    );

    expect(four).not.toBeNull();
    expect(four).toBe(eight);
  });

  test("another operation, resource or account is another change", () => {
    const base: string | null = getRemediationChangeKey(
      resource(`cloud scale-out ${ECS} --count 4`),
    );

    expect(
      getRemediationChangeKey(resource(`cloud restart-service ${ECS}`)),
    ).not.toBe(base);
    expect(
      getRemediationChangeKey(
        resource(
          "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/api --count 4",
        ),
      ),
    ).not.toBe(base);
    expect(
      getRemediationChangeKey(
        resource(
          `cloud scale-out ${ECS} --count 4`,
          AiResourceType.AwsAccount,
          OTHER_ACCOUNT,
        ),
      ),
    ).not.toBe(base);
  });

  test("an Azure resource id compares without case, as the inventory does", () => {
    expect(
      getRemediationChangeKey(
        resource(
          `cloud restart-service ${AZURE_SITE}`,
          AiResourceType.AzureSubscription,
        ),
      ),
    ).toBe(
      getRemediationChangeKey(
        resource(
          `cloud restart-service ${AZURE_SITE.toLowerCase()}`,
          AiResourceType.AzureSubscription,
        ),
      ),
    );
  });

  test("a command the catalog cannot read has no key", () => {
    for (const command of [
      "aws ecs update-service --service web",
      "cloud scale-out not-an-arn --count 4",
      "cloud",
      "",
    ]) {
      expect(getRemediationChangeKey(resource(command))).toBeNull();
    }
  });
});

describe("any other command: word for word, on its resource", () => {
  test("its words carry its meaning", () => {
    const on: string | null = getRemediationChangeKey(
      resource("govc vm.power -on web-01", AiResourceType.VMwareVCenter),
    );
    const off: string | null = getRemediationChangeKey(
      resource("govc vm.power -off web-01", AiResourceType.VMwareVCenter),
    );

    expect(on).not.toBeNull();
    expect(off).not.toBeNull();
    expect(on).not.toBe(off);
  });

  test("the same words on another resource are another change", () => {
    expect(
      getRemediationChangeKey(
        resource("docker restart web", AiResourceType.DockerHost),
      ),
    ).not.toBe(
      getRemediationChangeKey(
        resource(
          "docker restart web",
          AiResourceType.DockerHost,
          OTHER_ACCOUNT,
        ),
      ),
    );
  });

  test("spacing does not make another change", () => {
    expect(
      getRemediationChangeKey(
        resource("docker   restart  web", AiResourceType.DockerHost),
      ),
    ).toBe(
      getRemediationChangeKey(
        resource("docker restart web", AiResourceType.DockerHost),
      ),
    );
  });

  test("a resource command with no resource has no key", () => {
    expect(
      getRemediationChangeKey({
        stepType: RunbookStepType.ResourceCommand,
        command: "docker restart web",
        runnerId: RUNNER,
      }),
    ).toBeNull();
  });
});

describe("a Bash step: word for word, on its Runner", () => {
  test("the same command on the same Runner is one change", () => {
    const step: Pick<
      AiRemediationCommand,
      "stepType" | "command" | "runnerId"
    > = {
      stepType: RunbookStepType.Bash,
      command: "systemctl restart nginx",
      runnerId: RUNNER,
    };

    expect(getRemediationChangeKey(step)).toBe(
      getRemediationChangeKey({ ...step, runnerId: RUNNER.toUpperCase() }),
    );
    expect(getRemediationChangeKey(step)).not.toBe(
      getRemediationChangeKey({ ...step, runnerId: CLUSTER_B }),
    );
  });
});

describe("what never has a key", () => {
  test("anything malformed answers null and never throws", () => {
    const malformed: Array<unknown> = [
      null,
      undefined,
      {},
      { stepType: "Nonsense", command: "x", runnerId: RUNNER },
      { stepType: RunbookStepType.Bash, command: 42, runnerId: RUNNER },
      {
        stepType: RunbookStepType.Bash,
        command: "line one\nline two",
        runnerId: RUNNER,
      },
    ];

    for (const value of malformed) {
      expect(() => {
        return getRemediationChangeKey(value as AiRemediationCommand);
      }).not.toThrow();
      expect(getRemediationChangeKey(value as AiRemediationCommand)).toBeNull();
    }
  });

  test("a key is bounded, whatever the command holds", () => {
    const key: string | null = getRemediationChangeKey({
      stepType: RunbookStepType.Bash,
      command: `echo ${"x".repeat(1900)}`,
      runnerId: RUNNER,
      policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    } as AiRemediationCommand);

    expect(key).not.toBeNull();
    expect((key || "").length).toBeLessThanOrEqual(1200);
  });
});
