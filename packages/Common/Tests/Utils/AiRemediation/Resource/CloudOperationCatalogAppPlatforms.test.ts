import {
  CLOUD_RESOURCE_KINDS,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudOperationKindSpec,
  CloudOperationSpec,
  CloudResourceKindSpec,
  CloudResourceParse,
  CloudUndoResult,
  ParsedCloudCommand,
  ParsedCloudResource,
  getCloudOperation,
  getCloudOperationKind,
  getCloudUndoCommand,
  getCloudWriteCommandGuide,
  getCloudWriteTarget,
  parseCloudCommand,
  parseCloudResourceId,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import {
  AwsCloudCommandPolicy,
  AzureCloudCommandPolicy,
  GcpCloudCommandPolicy,
} from "../../../../Utils/AiRemediation/Resource/CloudCommandPolicy";
import {
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - App Platforms' own platforms in the cloud catalog
 * (Utils/AiRemediation/Resource/CloudOperationCatalog), so the environments
 * App Platforms shows can be fixed as other cloud resources are:
 *
 *  - an App Runner service, an Elastic Beanstalk environment, an Azure
 *    container group and an App Engine service are kinds the catalog reads
 *    from their ids, with the parts the agent addresses them by;
 *  - what each may be changed with, its tier, its one API call and the
 *    permissions its grant holds, word for word;
 *  - how each change is undone, from the value it replaced;
 *  - the policy tiers them as the catalog does, and the guides list them.
 */

const APP_RUNNER: string =
  "arn:aws:apprunner:us-east-1:123456789012:service/checkout-web/8fe1e10304f84fd2b0df550fe98a71fa";
const BEANSTALK: string =
  "arn:aws:elasticbeanstalk:eu-west-1:123456789012:environment/shop/shop-prod";
const SUBSCRIPTION: string = "00000000-0000-0000-0000-0000000000ab";
const CONTAINER_GROUP: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/jobs/providers/Microsoft.ContainerInstance/containerGroups/nightly-export`;
const APP_ENGINE: string =
  "//appengine.googleapis.com/apps/shop-prod-17/services/default";

function resource(
  provider: CloudCatalogProvider,
  id: string,
): ParsedCloudResource {
  const result: CloudResourceParse = parseCloudResourceId(provider, id);

  if (!result.ok) {
    throw new Error(`${id} did not parse: ${result.errorMessage}`);
  }

  return result.resource;
}

function parse(
  provider: CloudCatalogProvider,
  command: string,
): CloudCommandParse {
  return parseCloudCommand(provider, tokenizeResourceCommand(command).argv);
}

function parsed(
  provider: CloudCatalogProvider,
  command: string,
): ParsedCloudCommand {
  const result: CloudCommandParse = parse(provider, command);

  if (!result.ok) {
    throw new Error(`${command} did not parse: ${result.errorMessage}`);
  }

  return result.command;
}

function refusal(provider: CloudCatalogProvider, command: string): string {
  const result: CloudCommandParse = parse(provider, command);

  if (result.ok) {
    throw new Error(`${command} parsed, but should be refused`);
  }

  return result.errorMessage;
}

function operation(name: string): CloudOperationSpec {
  const found: CloudOperationSpec | null = getCloudOperation(name);

  if (!found) {
    throw new Error(`no operation ${name}`);
  }

  return found;
}

function kindOf(
  name: string,
  provider: CloudCatalogProvider,
  kind: string,
): CloudOperationKindSpec | null {
  return getCloudOperationKind(operation(name), provider, kind);
}

function undo(
  provider: CloudCatalogProvider,
  command: string,
  replaced: Record<string, string>,
): CloudUndoResult {
  return getCloudUndoCommand({ command: parsed(provider, command), replaced });
}

const POLICIES: Readonly<Record<CloudCatalogProvider, ResourceToolPolicy>> = {
  aws: AwsCloudCommandPolicy,
  azure: AzureCloudCommandPolicy,
  gcp: GcpCloudCommandPolicy,
};

function evaluate(
  provider: CloudCatalogProvider,
  command: string,
): ResourceCommandPolicyResult {
  return POLICIES[provider].evaluateArgv(
    tokenizeResourceCommand(command).argv as Array<string>,
  );
}

describe("the kinds and their ids", () => {
  test("the catalog names the four platforms, each in its own cloud", () => {
    const kinds: Array<string> = CLOUD_RESOURCE_KINDS.map(
      (spec: CloudResourceKindSpec): string => {
        return `${spec.provider}:${spec.kind}:${spec.displayName}`;
      },
    );

    expect(kinds).toEqual(
      expect.arrayContaining([
        "aws:apprunner-service:App Runner service",
        "aws:beanstalk-environment:Elastic Beanstalk environment",
        "azure:container-group:container group",
        "gcp:app-engine-service:App Engine service",
      ]),
    );
  });

  test("an App Runner service names its service and the id App Runner gave it", () => {
    const service: ParsedCloudResource = resource("aws", APP_RUNNER);

    expect(service.kind).toBe("apprunner-service");
    expect(service.accountId).toBe("123456789012");
    expect(service.region).toBe("us-east-1");
    expect(service.parts["name"]).toBe("checkout-web");
    expect(service.parts["serviceId"]).toBe("8fe1e10304f84fd2b0df550fe98a71fa");
    expect(getCloudWriteTarget(service)).toBe(APP_RUNNER);
  });

  test("an App Runner ARN without its 32-digit id, or of another resource, has no kind", () => {
    for (const id of [
      "arn:aws:apprunner:us-east-1:123456789012:service/checkout-web/8fe1e103",
      "arn:aws:apprunner:us-east-1:123456789012:service/checkout-web",
      "arn:aws:apprunner:us-east-1:123456789012:service/ab/8fe1e10304f84fd2b0df550fe98a71fa",
      "arn:aws:apprunner:us-east-1:123456789012:autoscalingconfiguration/web/1/8fe1e10304f84fd2b0df550fe98a71fa",
      "arn:aws:apprunner:us-east-1:123456789012:service/checkout-web/8FE1E10304F84FD2B0DF550FE98A71FA",
    ]) {
      expect([id, resource("aws", id).kind]).toEqual([id, null]);
    }
  });

  test("an Elastic Beanstalk environment names its application and its environment", () => {
    const environment: ParsedCloudResource = resource("aws", BEANSTALK);

    expect(environment.kind).toBe("beanstalk-environment");
    expect(environment.region).toBe("eu-west-1");
    expect(environment.parts["application"]).toBe("shop");
    expect(environment.parts["name"]).toBe("shop-prod");
  });

  test("an environment Elastic Beanstalk could not name, or an application of it, has no kind", () => {
    for (const id of [
      // Three characters: an environment's name has four at least.
      "arn:aws:elasticbeanstalk:eu-west-1:123456789012:environment/shop/abc",
      // A hyphen at an end.
      "arn:aws:elasticbeanstalk:eu-west-1:123456789012:environment/shop/shop-prod-",
      "arn:aws:elasticbeanstalk:eu-west-1:123456789012:application/shop",
      "arn:aws:elasticbeanstalk:eu-west-1:123456789012:applicationversion/shop/v42",
    ]) {
      expect([id, resource("aws", id).kind]).toEqual([id, null]);
    }

    // An application whose name holds a space is not an ARN the catalog reads.
    expect(
      parseCloudResourceId(
        "aws",
        "arn:aws:elasticbeanstalk:eu-west-1:123456789012:environment/my shop/shop-prod",
      ).ok,
    ).toBe(false);
  });

  test("a container group is read without case, as Azure compares ids", () => {
    const group: ParsedCloudResource = resource(
      "azure",
      CONTAINER_GROUP.replace(
        "Microsoft.ContainerInstance/containerGroups",
        "MICROSOFT.CONTAINERINSTANCE/CONTAINERGROUPS",
      ),
    );

    expect(group.kind).toBe("container-group");
    expect(group.accountId).toBe(SUBSCRIPTION);
    expect(group.parts["resourceGroup"]).toBe("jobs");
    expect(group.parts["name"]).toBe("nightly-export");
    expect(getCloudWriteTarget(resource("azure", CONTAINER_GROUP))).toBe(
      CONTAINER_GROUP.toLowerCase(),
    );
  });

  test("an App Engine service is named under its app's project, and its account is that project", () => {
    const service: ParsedCloudResource = resource("gcp", APP_ENGINE);

    expect(service.kind).toBe("app-engine-service");
    expect(service.id).toBe(APP_ENGINE);
    expect(service.accountId).toBe("shop-prod-17");
    expect(service.parts["project"]).toBe("shop-prod-17");
    expect(service.parts["name"]).toBe("default");
  });

  test("an App Engine version, or an app itself, is read but has no kind", () => {
    expect(resource("gcp", `${APP_ENGINE}/versions/20261105t101500`).kind).toBe(
      null,
    );
    expect(
      resource("gcp", "//appengine.googleapis.com/apps/shop-prod-17").kind,
    ).toBe(null);
  });

  test("only App Engine names a resource under apps: any other API under apps is not a name", () => {
    expect(
      parseCloudResourceId(
        "gcp",
        "//run.googleapis.com/apps/shop-prod-17/services/default",
      ).ok,
    ).toBe(false);
    // A malformed service name under App Engine has no kind.
    expect(
      resource(
        "gcp",
        "//appengine.googleapis.com/apps/shop-prod-17/services/-web",
      ).kind,
    ).toBe(null);
  });
});

describe("what each platform may be changed with, and its grant word for word", () => {
  test.each([
    [
      "restart-service",
      "aws",
      "apprunner-service",
      ResourceCommandTier.RiskyWrite,
      false,
      ["apprunner:StartDeployment", "apprunner:DescribeService"],
    ],
    [
      "restart-service",
      "aws",
      "beanstalk-environment",
      ResourceCommandTier.RiskyWrite,
      false,
      [
        "elasticbeanstalk:RestartAppServer",
        "elasticbeanstalk:DescribeEnvironments",
      ],
    ],
    [
      "restart-service",
      "azure",
      "container-group",
      ResourceCommandTier.RiskyWrite,
      false,
      [
        "Microsoft.ContainerInstance/containerGroups/restart/action",
        "Microsoft.ContainerInstance/containerGroups/read",
      ],
    ],
    [
      "start-instance",
      "azure",
      "container-group",
      ResourceCommandTier.SafeWrite,
      false,
      [
        "Microsoft.ContainerInstance/containerGroups/start/action",
        "Microsoft.ContainerInstance/containerGroups/read",
      ],
    ],
    [
      "stop-instance",
      "azure",
      "container-group",
      ResourceCommandTier.RiskyWrite,
      true,
      [
        "Microsoft.ContainerInstance/containerGroups/stop/action",
        "Microsoft.ContainerInstance/containerGroups/read",
      ],
    ],
    [
      "scale-out",
      "gcp",
      "app-engine-service",
      ResourceCommandTier.SafeWrite,
      false,
      [
        "appengine.versions.update",
        "appengine.versions.get",
        "appengine.services.get",
      ],
    ],
    [
      "scale-in",
      "gcp",
      "app-engine-service",
      ResourceCommandTier.RiskyWrite,
      false,
      [
        "appengine.versions.update",
        "appengine.versions.get",
        "appengine.services.get",
      ],
    ],
    [
      "roll-back-service",
      "gcp",
      "app-engine-service",
      ResourceCommandTier.RiskyWrite,
      false,
      [
        "appengine.services.update",
        "appengine.services.get",
        "appengine.versions.list",
      ],
    ],
  ])(
    "%s on %s %s",
    (
      name: string,
      provider: string,
      kind: string,
      tier: ResourceCommandTier,
      requiresHuman: boolean,
      permissions: Array<string>,
    ) => {
      const spec: CloudOperationKindSpec | null = kindOf(
        name,
        provider as CloudCatalogProvider,
        kind,
      );

      expect(spec).not.toBeNull();
      expect(spec!.kind).toBe(kind);
      expect(spec!.tier).toBe(tier);
      expect(spec!.requiresHuman).toBe(requiresHuman);
      expect(spec!.permissions).toEqual(permissions);
      expect(spec!.apiCall.length).toBeGreaterThan(10);
    },
  );

  test("each platform has exactly these changes, and no other", () => {
    const changes: Record<string, Array<string>> = {};

    for (const kind of [
      "aws:apprunner-service",
      "aws:beanstalk-environment",
      "azure:container-group",
      "gcp:app-engine-service",
    ]) {
      const [provider = "", name = ""] = kind.split(":");

      changes[kind] = [
        "restart-service",
        "start-instance",
        "scale-out",
        "scale-in",
        "reboot-instance",
        "roll-back-service",
        "set-concurrency",
        "fail-over-database",
        "stop-instance",
        "redrive-queue",
      ].filter((operationName: string): boolean => {
        const spec: CloudOperationKindSpec | null = kindOf(
          operationName,
          provider as CloudCatalogProvider,
          name,
        );

        // A "*" entry is a read's: a change's kinds are its own.
        return Boolean(spec && spec.kind === name);
      });
    }

    expect(changes).toEqual({
      "aws:apprunner-service": ["restart-service"],
      "aws:beanstalk-environment": ["restart-service"],
      "azure:container-group": [
        "restart-service",
        "start-instance",
        "stop-instance",
      ],
      "gcp:app-engine-service": ["scale-out", "scale-in", "roll-back-service"],
    });
  });

  test("an App Runner restart runs only while the service deploys its every new version, and says so", () => {
    expect(kindOf("restart-service", "aws", "apprunner-service")!.apiCall).toBe(
      "apprunner:StartDeployment (a redeploy of the version it runs, automatic deployments on)",
    );
  });

  test("a change a platform does not take is refused, naming what takes it, with its article", () => {
    expect(refusal("aws", `cloud scale-out ${APP_RUNNER} --count 4`)).toContain(
      "cloud scale-out is not available for an App Runner service",
    );
    expect(refusal("aws", `cloud roll-back-service ${BEANSTALK}`)).toContain(
      "cloud roll-back-service is not available for an Elastic Beanstalk environment",
    );
    expect(refusal("gcp", `cloud restart-service ${APP_ENGINE}`)).toContain(
      "cloud restart-service is not available on Google Cloud",
    );
    expect(
      refusal("azure", `cloud reboot-instance ${CONTAINER_GROUP}`),
    ).toContain("cloud reboot-instance is not available for a container group");
  });

  test("an App Engine roll back takes --to a version, and never a slot", () => {
    expect(
      parsed(
        "gcp",
        `cloud roll-back-service ${APP_ENGINE} --to=20261105t101500`,
      ).canonicalArgs,
    ).toEqual(["roll-back-service", APP_ENGINE, "--to", "20261105t101500"]);
    expect(
      refusal("gcp", `cloud roll-back-service ${APP_ENGINE} --slot staging`),
    ).toContain("--slot does not apply to an App Engine service");
  });

  test("a scale of an App Engine service needs its count, from 1", () => {
    expect(refusal("gcp", `cloud scale-out ${APP_ENGINE}`)).toContain(
      "needs --count N",
    );
    expect(refusal("gcp", `cloud scale-in ${APP_ENGINE} --count 0`)).toContain(
      "--count must be a whole number from 1 to 1000",
    );
    expect(
      parsed("gcp", `cloud scale-out ${APP_ENGINE} --count 4`).flags,
    ).toEqual({ count: 4 });
  });

  test("CLI words for what is left to a person are answered with why", () => {
    for (const word of [
      "update-environment",
      "rebuild-environment",
      "swap-environment-cnames",
      "pause-service",
      "resume-service",
    ]) {
      expect(refusal("aws", `cloud ${word} ${BEANSTALK}`)).toContain(
        "are left to a person",
      );
    }

    expect(refusal("aws", `cloud start-deployment ${APP_RUNNER}`)).toContain(
      "write restart-service instead",
    );
    expect(refusal("aws", `cloud restart-app-server ${BEANSTALK}`)).toContain(
      "write restart-service instead",
    );
    expect(refusal("gcp", `cloud migrate-traffic ${APP_ENGINE}`)).toContain(
      "write roll-back-service instead",
    );
  });
});

describe("how each change is undone", () => {
  test("a restart has nothing to undo: the same version runs again", () => {
    for (const [provider, id] of [
      ["aws", APP_RUNNER],
      ["aws", BEANSTALK],
      ["azure", CONTAINER_GROUP],
    ] as Array<[CloudCatalogProvider, string]>) {
      const result: CloudUndoResult = undo(
        provider,
        `cloud restart-service ${id}`,
        {},
      );

      expect(result.kind).toBe("nothing");
    }
  });

  test("starting a container group is undone by stopping it, and stopping by starting it", () => {
    expect(
      undo("azure", `cloud start-instance ${CONTAINER_GROUP}`, {
        state: "stopped",
      }),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "stop-instance", CONTAINER_GROUP],
    });
    expect(
      undo("azure", `cloud stop-instance ${CONTAINER_GROUP}`, {
        state: "running",
      }),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "start-instance", CONTAINER_GROUP],
    });
  });

  test("an App Engine roll back is undone by moving the traffic back to the version it replaced", () => {
    expect(
      undo("gcp", `cloud roll-back-service ${APP_ENGINE}`, {
        version: "20261106t083000",
      }),
    ).toEqual({
      kind: "command",
      argv: [
        "cloud",
        "roll-back-service",
        APP_ENGINE,
        "--to",
        "20261106t083000",
      ],
    });

    // Without the version it replaced, it cannot be undone exactly.
    expect(undo("gcp", `cloud roll-back-service ${APP_ENGINE}`, {}).kind).toBe(
      "unknown",
    );
  });

  test("an App Engine scale is undone by the opposite scale to the count it replaced", () => {
    expect(
      undo("gcp", `cloud scale-out ${APP_ENGINE} --count 6`, { count: "3" }),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "scale-in", APP_ENGINE, "--count", "3"],
    });
    expect(
      undo("gcp", `cloud scale-in ${APP_ENGINE} --count 2`, { count: "5" }),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "scale-out", APP_ENGINE, "--count", "5"],
    });
  });
});

describe("the policy and the guides", () => {
  test.each([
    [
      "aws",
      `cloud restart-service ${APP_RUNNER}`,
      ResourceCommandTier.RiskyWrite,
      false,
      APP_RUNNER,
    ],
    [
      "aws",
      `cloud restart-service ${BEANSTALK}`,
      ResourceCommandTier.RiskyWrite,
      false,
      BEANSTALK,
    ],
    [
      "azure",
      `cloud start-instance ${CONTAINER_GROUP}`,
      ResourceCommandTier.SafeWrite,
      false,
      CONTAINER_GROUP.toLowerCase(),
    ],
    [
      "azure",
      `cloud stop-instance ${CONTAINER_GROUP}`,
      ResourceCommandTier.RiskyWrite,
      true,
      CONTAINER_GROUP.toLowerCase(),
    ],
    [
      "gcp",
      `cloud scale-out ${APP_ENGINE} --count 3`,
      ResourceCommandTier.SafeWrite,
      false,
      APP_ENGINE,
    ],
    [
      "gcp",
      `cloud roll-back-service ${APP_ENGINE}`,
      ResourceCommandTier.RiskyWrite,
      false,
      APP_ENGINE,
    ],
  ])(
    "%s %s is tiered as the catalog says, on its one resource",
    (
      provider: string,
      command: string,
      tier: ResourceCommandTier,
      requiresHuman: boolean,
      target: string,
    ) => {
      const result: ResourceCommandPolicyResult = evaluate(
        provider as CloudCatalogProvider,
        command,
      );

      expect(result.tier).toBe(tier);
      expect(Boolean(result.requiresHuman)).toBe(requiresHuman);
      expect(result.targets).toEqual([target]);
    },
  );

  test("a dry run of each new change is a read of the change it checks", () => {
    for (const [provider, command] of [
      ["aws", `cloud dry-run restart-service ${APP_RUNNER}`],
      ["aws", `cloud dry-run restart-service ${BEANSTALK}`],
      ["azure", `cloud dry-run stop-instance ${CONTAINER_GROUP}`],
      ["gcp", `cloud dry-run roll-back-service ${APP_ENGINE}`],
      ["gcp", `cloud dry-run scale-in ${APP_ENGINE} --count 1`],
    ] as Array<[CloudCatalogProvider, string]>) {
      const result: ResourceCommandPolicyResult = evaluate(provider, command);

      expect([command, result.tier]).toEqual([
        command,
        ResourceCommandTier.Read,
      ]);
      expect(result.targets).toEqual([]);
    }
  });

  test("the allowlist's stand-ins reach each new kind, so `cloud restart-service *` reads as broad", () => {
    const standIns: Array<string> = [
      ...(AwsCloudCommandPolicy.allowlistStandIns || []),
      ...(AzureCloudCommandPolicy.allowlistStandIns || []),
      ...(GcpCloudCommandPolicy.allowlistStandIns || []),
    ];
    const kinds: Set<string> = new Set<string>();

    for (const id of standIns) {
      for (const provider of [
        "aws",
        "azure",
        "gcp",
      ] as Array<CloudCatalogProvider>) {
        const result: CloudResourceParse = parseCloudResourceId(provider, id);

        if (result.ok && result.resource.kind) {
          kinds.add(`${provider}:${result.resource.kind}`);
        }
      }
    }

    for (const kind of [
      "aws:apprunner-service",
      "aws:beanstalk-environment",
      "azure:container-group",
      "gcp:app-engine-service",
    ]) {
      expect([kind, kinds.has(kind)]).toEqual([kind, true]);
    }
  });

  test("the write guide lists each platform with its tier", () => {
    const aws: string = getCloudWriteCommandGuide("aws");
    const azure: string = getCloudWriteCommandGuide("azure");
    const gcp: string = getCloudWriteCommandGuide("gcp");

    expect(aws).toContain("App Runner service: riskier");
    expect(aws).toContain("Elastic Beanstalk environment: riskier");
    expect(azure).toContain("container group: safe");
    expect(azure).toContain("container group: always needs a person");
    expect(gcp).toContain("App Engine service: safe");
    expect(gcp).toContain("App Engine service: riskier");
  });
});
