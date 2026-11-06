import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  CLOUD_CHANGE_OPERATION_NAMES,
  CLOUD_OPERATIONS,
  CloudOperationSpec,
} from "../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import {
  DECLARED_CODE_CHANGES_PATH,
  DECLARED_CODE_CHANGE_PATH,
  DECLARED_CODE_KINDS,
  DECLARED_CODE_OWNER_PATH,
  DeclaredCode,
  DeclaredCodeKind,
  LastingCloudChange,
  getDeclaredCodeChangeRequest,
  getDeclaredCodeTarget,
  getLastingCloudChange,
  isDeclaredCodePath,
  isPathNamedAfter,
  readDeclaredCode,
  readDeclaredCodeChangeTaskContext,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import { describe, expect, test } from "@jest/globals";

/*
 * Utils/AiRemediation/DeclaredCodeChange - a fix that lasts: the same change
 * as a pull request to the code that declares the resource. Which code a
 * resource's tags name, which changes set a value that code declares (and so
 * have a pull request), where each kind of code keeps that value, which
 * files of a repository are that code, and the request the Code task is
 * started with, for each kind of code.
 */

const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const ASG: string =
  "arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:11111111-2222-3333-4444-555555555555:autoScalingGroupName/web-asg";
const LAMBDA: string =
  "arn:aws:lambda:us-east-1:123456789012:function:checkout";
const PLAN: string =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers/Microsoft.Web/serverfarms/web-plan";
const MIG: string =
  "//compute.googleapis.com/projects/my-project/zones/us-central1-a/instanceGroupManagers/web-mig";

describe("the routes", () => {
  test("live with the fix's other actions", () => {
    expect(DECLARED_CODE_OWNER_PATH).toBe(
      "/auto-remediation/declared-code-owner",
    );
    expect(DECLARED_CODE_CHANGE_PATH).toBe(
      "/auto-remediation/declared-code-change",
    );
    expect(DECLARED_CODE_CHANGES_PATH).toBe(
      "/auto-remediation/declared-code-changes",
    );
  });
});

describe("readDeclaredCode", () => {
  test.each([
    [
      'CloudFormation stack "web-prod"',
      {
        kind: DeclaredCodeKind.CloudFormation,
        name: "CloudFormation",
        stackName: "web-prod",
      },
    ],
    [
      "Terraform",
      { kind: DeclaredCodeKind.Terraform, name: "Terraform", stackName: null },
    ],
    [
      "OpenTofu",
      { kind: DeclaredCodeKind.Terraform, name: "OpenTofu", stackName: null },
    ],
    [
      "the AWS CDK",
      {
        kind: DeclaredCodeKind.CloudFormation,
        name: "the AWS CDK",
        stackName: null,
      },
    ],
    [
      "CloudFormation",
      {
        kind: DeclaredCodeKind.CloudFormation,
        name: "CloudFormation",
        stackName: null,
      },
    ],
    ["Bicep", { kind: DeclaredCodeKind.Bicep, name: "Bicep", stackName: null }],
    [
      "Pulumi",
      { kind: DeclaredCodeKind.Pulumi, name: "Pulumi", stackName: null },
    ],
    [
      "Crossplane",
      {
        kind: DeclaredCodeKind.Crossplane,
        name: "Crossplane",
        stackName: null,
      },
    ],
  ])("%s", (managedAsCode: string, declared: DeclaredCode) => {
    expect(readDeclaredCode(managedAsCode)).toEqual(declared);
  });

  test.each([[null], [undefined], [""], ["  "], ["Ansible"], ["a person"]])(
    "%j is no code a pull request can go to",
    (value: string | null | undefined) => {
      expect(readDeclaredCode(value)).toBeNull();
    },
  );
});

describe("getLastingCloudChange", () => {
  test.each([
    [
      AiResourceType.AwsAccount,
      `cloud scale-out ${ECS} --count 4`,
      {
        operation: "scale-out",
        kind: "ecs-service",
        value: "4",
        resourceName: "web",
      },
    ],
    [
      AiResourceType.AwsAccount,
      `cloud scale-in ${ASG} --count 2`,
      {
        operation: "scale-in",
        kind: "autoscaling-group",
        value: "2",
        resourceName: "web-asg",
      },
    ],
    [
      AiResourceType.AwsAccount,
      `cloud set-concurrency ${LAMBDA} --value 50`,
      {
        operation: "set-concurrency",
        kind: "lambda-function",
        value: "50",
        resourceName: "checkout",
      },
    ],
    [
      AiResourceType.AwsAccount,
      `cloud roll-back-service ${LAMBDA}:live --to 41`,
      {
        operation: "roll-back-service",
        kind: "lambda-alias",
        value: "41",
        resourceName: "checkout:live",
      },
    ],
    [
      AiResourceType.AzureSubscription,
      `cloud scale-out ${PLAN} --count 3`,
      {
        operation: "scale-out",
        kind: "app-service-plan",
        value: "3",
        resourceName: "web-plan",
      },
    ],
    [
      AiResourceType.GoogleCloudProject,
      `cloud scale-in ${MIG} --count 2`,
      {
        operation: "scale-in",
        kind: "managed-instance-group",
        value: "2",
        resourceName: "web-mig",
      },
    ],
  ])(
    "%s %s sets a value the code declares",
    (
      resourceType: AiResourceType,
      command: string,
      expected: Partial<LastingCloudChange>,
    ) => {
      const change: LastingCloudChange | null = getLastingCloudChange({
        resourceType,
        command,
      });

      expect(change).toMatchObject(expected);
      expect(change?.sentence.length).toBeGreaterThan(0);
    },
  );

  test.each([
    [`cloud restart-service ${ECS}`],
    [
      `cloud reboot-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0`,
    ],
    [
      `cloud stop-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0`,
    ],
    [
      `cloud start-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0`,
    ],
    [`cloud describe ${ECS}`],
    [`cloud dry-run scale-out ${ECS} --count 4`],
    ["cloud whoami"],
    ["not a cloud command"],
  ])("%s leaves nothing for an apply to undo", (command: string) => {
    expect(
      getLastingCloudChange({
        resourceType: AiResourceType.AwsAccount,
        command,
      }),
    ).toBeNull();
  });

  test("another resource type's command is none", () => {
    expect(
      getLastingCloudChange({
        resourceType: AiResourceType.DockerHost,
        command: `cloud scale-out ${ECS} --count 4`,
      }),
    ).toBeNull();
  });

  test("the changes that last are exactly the catalog's whose undo writes a value back", () => {
    const lasting: Array<string> = CLOUD_OPERATIONS.filter(
      (operation: CloudOperationSpec): boolean => {
        return Boolean(operation.undo?.valueFlag);
      },
    ).map((operation: CloudOperationSpec): string => {
      return operation.name;
    });

    expect(lasting.sort()).toEqual([
      "roll-back-service",
      "scale-in",
      "scale-out",
      "set-concurrency",
    ]);
    // Every one of them is a change the catalog offers.
    for (const name of lasting) {
      expect(CLOUD_CHANGE_OPERATION_NAMES).toContain(name);
    }
  });
});

describe("getDeclaredCodeTarget", () => {
  test.each([
    [
      "aws",
      "scale-out",
      "ecs-service",
      DeclaredCodeKind.Terraform,
      "aws_ecs_service",
      "desired_count",
    ],
    [
      "aws",
      "scale-in",
      "ecs-service",
      DeclaredCodeKind.CloudFormation,
      "AWS::ECS::Service",
      "DesiredCount",
    ],
    [
      "aws",
      "scale-out",
      "autoscaling-group",
      DeclaredCodeKind.Terraform,
      "aws_autoscaling_group",
      "desired_capacity",
    ],
    [
      "aws",
      "scale-out",
      "autoscaling-group",
      DeclaredCodeKind.CloudFormation,
      "AWS::AutoScaling::AutoScalingGroup",
      "DesiredCapacity",
    ],
    [
      "aws",
      "set-concurrency",
      "lambda-function",
      DeclaredCodeKind.Terraform,
      "aws_lambda_function",
      "reserved_concurrent_executions",
    ],
    [
      "aws",
      "set-concurrency",
      "lambda-function",
      DeclaredCodeKind.CloudFormation,
      "AWS::Lambda::Function",
      "ReservedConcurrentExecutions",
    ],
    [
      "aws",
      "roll-back-service",
      "lambda-alias",
      DeclaredCodeKind.CloudFormation,
      "AWS::Lambda::Alias",
      "FunctionVersion",
    ],
    [
      "azure",
      "scale-out",
      "app-service-plan",
      DeclaredCodeKind.Bicep,
      "Microsoft.Web/serverfarms",
      "sku.capacity",
    ],
    [
      "azure",
      "scale-out",
      "app-service-plan",
      DeclaredCodeKind.Terraform,
      "azurerm_service_plan",
      "worker_count",
    ],
    [
      "azure",
      "scale-in",
      "vm-scale-set",
      DeclaredCodeKind.Bicep,
      "Microsoft.Compute/virtualMachineScaleSets",
      "sku.capacity",
    ],
    [
      "azure",
      "roll-back-service",
      "container-app",
      DeclaredCodeKind.Bicep,
      "Microsoft.App/containerApps",
      "template.containers.image",
    ],
    [
      "gcp",
      "scale-out",
      "managed-instance-group",
      DeclaredCodeKind.Terraform,
      "google_compute_instance_group_manager (or google_compute_region_instance_group_manager)",
      "target_size",
    ],
  ])(
    "%s %s on %s in %s: %s.%s",
    (
      provider: string,
      operation: string,
      kind: string,
      codeKind: DeclaredCodeKind,
      resourceType: string,
      attribute: string,
    ) => {
      expect(
        getDeclaredCodeTarget({
          provider: provider as never,
          operation,
          kind,
          codeKind,
        }),
      ).toEqual({ resourceType, attribute });
    },
  );

  test("a pair the guide does not know is none: the task looks for the value itself", () => {
    expect(
      getDeclaredCodeTarget({
        provider: "aws",
        operation: "scale-out",
        kind: "ecs-service",
        codeKind: DeclaredCodeKind.Bicep,
      }),
    ).toBeNull();
    expect(
      getDeclaredCodeTarget({
        provider: "aws",
        operation: "restart-service",
        kind: "ecs-service",
        codeKind: DeclaredCodeKind.Terraform,
      }),
    ).toBeNull();
  });

  test("every lasting change of every kind has a Terraform target", () => {
    for (const operation of CLOUD_OPERATIONS) {
      if (!operation.undo?.valueFlag) {
        continue;
      }

      for (const kind of operation.kinds) {
        expect({
          operation: operation.name,
          kind: `${kind.provider}:${kind.kind}`,
          hasTarget: Boolean(
            getDeclaredCodeTarget({
              provider: kind.provider,
              operation: operation.name,
              kind: kind.kind,
              codeKind: DeclaredCodeKind.Terraform,
            }),
          ),
        }).toEqual({
          operation: operation.name,
          kind: `${kind.provider}:${kind.kind}`,
          hasTarget: true,
        });
      }
    }
  });
});

describe("isDeclaredCodePath", () => {
  test.each([
    ["infra/ecs/main.tf", DeclaredCodeKind.Terraform, true],
    ["modules/web/variables.tf.json", DeclaredCodeKind.Terraform, true],
    ["live/prod/terragrunt.hcl", DeclaredCodeKind.Terraform, true],
    ["envs/prod/main.tofu", DeclaredCodeKind.Terraform, true],
    ["src/main.ts", DeclaredCodeKind.Terraform, false],
    ["cloudformation/web.yaml", DeclaredCodeKind.CloudFormation, true],
    ["infra/templates/web.yml", DeclaredCodeKind.CloudFormation, true],
    ["stacks/web.json", DeclaredCodeKind.CloudFormation, true],
    ["template.yaml", DeclaredCodeKind.CloudFormation, true],
    ["deploy/web.template.json", DeclaredCodeKind.CloudFormation, true],
    ["deploy/web-stack.yml", DeclaredCodeKind.CloudFormation, true],
    ["cdk/cdk.json", DeclaredCodeKind.CloudFormation, true],
    ["package.json", DeclaredCodeKind.CloudFormation, false],
    [".github/workflows/ci.yml", DeclaredCodeKind.CloudFormation, false],
    ["infra/main.bicep", DeclaredCodeKind.Bicep, true],
    ["infra/main.bicepparam", DeclaredCodeKind.Bicep, true],
    ["infra/main.tf", DeclaredCodeKind.Bicep, false],
    ["Pulumi.yaml", DeclaredCodeKind.Pulumi, true],
    ["infra/Pulumi.prod.yaml", DeclaredCodeKind.Pulumi, true],
    ["crossplane/compositions/web.yaml", DeclaredCodeKind.Crossplane, true],
  ])(
    "%s is %s code: %s",
    (path: string, kind: DeclaredCodeKind, isCode: boolean) => {
      expect(isDeclaredCodePath(path, kind)).toBe(isCode);
    },
  );

  test("every kind of code reads some path", () => {
    const paths: Record<DeclaredCodeKind, string> = {
      [DeclaredCodeKind.Terraform]: "main.tf",
      [DeclaredCodeKind.CloudFormation]: "template.yaml",
      [DeclaredCodeKind.Bicep]: "main.bicep",
      [DeclaredCodeKind.Pulumi]: "Pulumi.yaml",
      [DeclaredCodeKind.Crossplane]: "crossplane/x.yaml",
    };

    for (const kind of DECLARED_CODE_KINDS) {
      expect(isDeclaredCodePath(paths[kind], kind)).toBe(true);
    }
  });
});

describe("isPathNamedAfter", () => {
  test.each([
    ["services/web/main.tf", "web", true],
    ["stacks/web.yaml", "web", true],
    ["web-service.tf", "web", true],
    ["web_service.tf", "web", true],
    ["stacks/web-prod.yaml", "web-prod", true],
    ["stacks/webhooks.yaml", "web", false],
    ["infra/main.tf", "web", false],
    ["a/b.tf", "b", false],
  ])("%s named after %s: %s", (path: string, name: string, named: boolean) => {
    expect(isPathNamedAfter(path, name)).toBe(named);
  });
});

describe("the request the Code task is started with, for each kind of code", () => {
  const resource: {
    providerResourceId: string;
    name: string;
    tags: Record<string, string>;
  } = {
    providerResourceId: ECS,
    name: "web",
    tags: { team: "payments", "aws:cloudformation:stack-name": "web-prod" },
  };

  function requestFor(
    declaredCode: DeclaredCode,
    command: string = `cloud scale-out ${ECS} --count 4`,
    resourceType: AiResourceType = AiResourceType.AwsAccount,
    hasLiveChangeRun: boolean = false,
    replacedValue: string | null = null,
  ): string {
    return getDeclaredCodeChangeRequest({
      change: getLastingCloudChange({ resourceType, command })!,
      declaredCode,
      resource,
      command,
      replacedValue,
      hasLiveChangeRun,
    });
  }

  test("Terraform: the change, the resource, desired_count of aws_ecs_service, and what not to change", () => {
    const request: string = requestFor(readDeclaredCode("Terraform")!);

    expect(request.split("\n")[0]).toBe(
      "Scale the ECS service web out to 4 tasks, in the Terraform code that declares it, and open a pull request with that change.",
    );
    expect(request).toContain(
      `OneUptime AI proposed this change on the live resource as \`cloud scale-out ${ECS} --count 4\`.`,
    );
    expect(request).toContain(`- id: ${ECS}`);
    expect(request).toContain("- name: web");
    expect(request).toContain(
      "- tags: team=payments, aws:cloudformation:stack-name=web-prod",
    );
    expect(request).toContain(
      "In Terraform or OpenTofu, the value is most likely the `desired_count` of the `aws_ecs_service` that declares this resource: set it to 4.",
    );
    expect(request).toContain("Change that one value and nothing else.");
    expect(request).toContain(
      "change nothing, and say where it comes from instead.",
    );
  });

  test("CloudFormation: the stack named, and DesiredCount of AWS::ECS::Service", () => {
    const request: string = requestFor(
      readDeclaredCode('CloudFormation stack "web-prod"')!,
    );

    expect(request.split("\n")[0]).toBe(
      'Scale the ECS service web out to 4 tasks, in the CloudFormation stack "web-prod" code that declares it, and open a pull request with that change.',
    );
    expect(request).toContain("- CloudFormation stack: web-prod");
    expect(request).toContain(
      "In CloudFormation, the value is most likely the `DesiredCount` of the `AWS::ECS::Service` that declares this resource: set it to 4.",
    );
  });

  test("Bicep: sku.capacity of Microsoft.Web/serverfarms", () => {
    const request: string = requestFor(
      readDeclaredCode("Bicep")!,
      `cloud scale-out ${PLAN} --count 3`,
      AiResourceType.AzureSubscription,
    );

    expect(request).toContain(
      "In Bicep, the value is most likely the `sku.capacity` of the `Microsoft.Web/serverfarms` that declares this resource: set it to 3.",
    );
  });

  test("a change that ran says so, and the value it replaced", () => {
    const request: string = requestFor(
      readDeclaredCode("Terraform")!,
      `cloud scale-out ${ECS} --count 4`,
      AiResourceType.AwsAccount,
      true,
      "2",
    );

    expect(request).toContain(
      `OneUptime AI made this change on the live resource as \`cloud scale-out ${ECS} --count 4\`, replacing 2.`,
    );
  });

  test("a pair the guide does not know asks the task to find the value", () => {
    const request: string = requestFor(readDeclaredCode("Bicep")!);

    expect(request).toContain(
      "Find the value this change sets in the Bicep code, and set it to 4.",
    );
  });

  test("tags are capped, and a long value is cut", () => {
    const many: Record<string, string> = {};

    for (let index: number = 0; index < 40; index++) {
      many[`tag${index}`] = "x".repeat(300);
    }

    const request: string = getDeclaredCodeChangeRequest({
      change: getLastingCloudChange({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-out ${ECS} --count 4`,
      })!,
      declaredCode: readDeclaredCode("Terraform")!,
      resource: { ...resource, tags: many },
      command: `cloud scale-out ${ECS} --count 4`,
      hasLiveChangeRun: false,
    });
    const tagLine: string =
      request.split("\n").find((line: string): boolean => {
        return line.startsWith("- tags: ");
      }) || "";

    expect(tagLine.split(", ").length).toBe(30);
    expect(tagLine).not.toContain("x".repeat(250));
  });
});

describe("readDeclaredCodeChangeTaskContext", () => {
  const CONTEXT: Record<string, unknown> = {
    suggestionId: "aaaaaaaa-1111-4111-8111-111111111111",
    sequence: 2,
    resourceType: AiResourceType.AwsAccount,
    resourceId: "bbbbbbbb-2222-4222-8222-222222222222",
    command: `cloud scale-out ${ECS} --count 4`,
    managedAsCode: "Terraform",
  };

  test("the link a task keeps to its fix", () => {
    expect(readDeclaredCodeChangeTaskContext(CONTEXT)).toEqual(CONTEXT);
  });

  test.each([
    [null],
    ["context"],
    [{ ...CONTEXT, suggestionId: "not-an-id" }],
    [{ ...CONTEXT, sequence: 0 }],
    [{ ...CONTEXT, sequence: 1.5 }],
    [{ ...CONTEXT, sequence: "2" }],
  ])("%j is none", (value: unknown) => {
    expect(readDeclaredCodeChangeTaskContext(value)).toBeNull();
  });
});
