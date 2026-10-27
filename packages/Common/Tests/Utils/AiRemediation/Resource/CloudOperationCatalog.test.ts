import {
  ALL_CLOUD_CATALOG_PROVIDERS,
  CLOUD_CHANGE_OPERATION_NAMES,
  CLOUD_MAX_RESOURCE_ID_LENGTH,
  CLOUD_OPERATIONS,
  CLOUD_OPERATION_NAMES,
  CLOUD_PROGRAM,
  CLOUD_REPLACED_VALUE_PREFIX,
  CLOUD_RESOURCE_KINDS,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudOperationKindSpec,
  CloudOperationSpec,
  CloudParamSpec,
  CloudResourceKindSpec,
  CloudResourceParse,
  CloudUndoResult,
  ParsedCloudCommand,
  ParsedCloudResource,
  describeCloudOperationUsage,
  formatCloudReplacedValue,
  getCloudCatalogProvider,
  getCloudIntegerFlag,
  getCloudOperation,
  getCloudOperationKind,
  getCloudReadCommandGuide,
  getCloudUndoCommand,
  getCloudWriteCommandGuide,
  getCloudWriteTarget,
  isCloudChangeOperation,
  isSameCloudResourceId,
  parseCloudCommand,
  parseCloudResourceId,
  readCloudReplacedValue,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { tokenizeResourceCommand } from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  AWS_LOG_READ_ACTION_GROUP,
  AWS_READ_ONLY_ACTIONS,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — CloudOperationCatalog, the closed set of `cloud`
 * operations the Cloud AI agent's executor, the server's live reads and the
 * cloud command policy all read.
 *
 * - The catalog is well formed: unique names, the five reads run on the
 *   server and whoami on the agent, every change names the kinds it works
 *   on (with a tier, an API call and the permissions its role needs), three
 *   changes always ask a person, and every change says how it is undone.
 * - Resource ids: ARNs, Azure resource IDs and Google Cloud full resource
 *   names are read strictly, with the kind and the parts the agent needs.
 * - The grammar is as strict as the db catalog's, and its canonical argv
 *   re-parses to itself.
 * - What a change replaced is read from its output's first line only, and
 *   the undo is the catalog's inverse with that value.
 */

const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const EC2: string =
  "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc1234def567890";
const RDS: string = "arn:aws:rds:us-east-1:123456789012:db:orders";
const AURORA: string =
  "arn:aws:rds:us-east-1:123456789012:cluster:orders-cluster";
const ASG: string =
  "arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:6f3c9d1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f:autoScalingGroupName/web-asg";
const LAMBDA: string =
  "arn:aws:lambda:us-east-1:123456789012:function:checkout";
const LAMBDA_ALIAS: string =
  "arn:aws:lambda:us-east-1:123456789012:function:checkout:live";
const SQS: string = "arn:aws:sqs:us-east-1:123456789012:orders-dlq";
const TARGET_GROUP: string =
  "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/web-tg/0123456789abcdef";
const S3: string = "arn:aws:s3:::my-bucket";

const SUBSCRIPTION: string = "00000000-0000-0000-0000-0000000000AB";
const AZ: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/prod/providers`;
const SITE: string = `${AZ}/Microsoft.Web/sites/web`;
const PLAN: string = `${AZ}/Microsoft.Web/serverfarms/web-plan`;
const CONTAINER_APP: string = `${AZ}/Microsoft.App/containerApps/api`;
const VM: string = `${AZ}/Microsoft.Compute/virtualMachines/vm-1`;
const VMSS: string = `${AZ}/Microsoft.Compute/virtualMachineScaleSets/workers`;
const POSTGRES: string = `${AZ}/Microsoft.DBforPostgreSQL/flexibleServers/pg-1`;
const FAILOVER_GROUP: string = `${AZ}/Microsoft.Sql/servers/sql-1/failoverGroups/fg-1`;
const STORAGE: string = `${AZ}/Microsoft.Storage/storageAccounts/data1`;

const GCE: string =
  "//compute.googleapis.com/projects/my-project/zones/us-central1-a/instances/web-1";
const MIG_ZONAL: string =
  "//compute.googleapis.com/projects/my-project/zones/us-central1-a/instanceGroupManagers/web-mig";
const MIG_REGIONAL: string =
  "//compute.googleapis.com/projects/my-project/regions/us-central1/instanceGroupManagers/web-mig";
const RUN: string =
  "//run.googleapis.com/projects/my-project/locations/us-central1/services/web";
const SQL: string =
  "//cloudsql.googleapis.com/projects/my-project/instances/orders";

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

function operation(name: string): CloudOperationSpec {
  const found: CloudOperationSpec | null = getCloudOperation(name);

  if (!found) {
    throw new Error(`no operation ${name}`);
  }

  return found;
}

describe("the catalog is well formed", () => {
  test("operation names are unique lowercase words joined by dashes", () => {
    const words: Array<string> = CLOUD_OPERATIONS.flatMap(
      (spec: CloudOperationSpec): Array<string> => {
        return [spec.name, ...spec.aliases];
      },
    );

    expect(new Set<string>(words).size).toBe(words.length);

    for (const word of words) {
      expect(word).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }

    expect(CLOUD_OPERATION_NAMES).toEqual(
      CLOUD_OPERATIONS.map((spec: CloudOperationSpec): string => {
        return spec.name;
      }),
    );
  });

  test("ten changes, five reads on the server and one read on the agent", () => {
    const serverReads: Array<string> = CLOUD_OPERATIONS.filter(
      (spec: CloudOperationSpec): boolean => {
        return spec.runsOn === "server";
      },
    ).map((spec: CloudOperationSpec): string => {
      return spec.name;
    });

    expect(serverReads).toEqual([
      "describe",
      "recent-events",
      "target-health",
      "quota-usage",
      "read-logs",
    ]);
    expect(CLOUD_CHANGE_OPERATION_NAMES).toEqual([
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
    ]);
    expect(
      CLOUD_OPERATIONS.filter((spec: CloudOperationSpec): boolean => {
        return spec.runsOn === "agent" && !isCloudChangeOperation(spec);
      }).map((spec: CloudOperationSpec): string => {
        return spec.name;
      }),
    ).toEqual(["whoami"]);
  });

  test("every read is Read on every kind, and runs on the server unless it is whoami", () => {
    for (const spec of CLOUD_OPERATIONS) {
      if (isCloudChangeOperation(spec)) {
        expect(spec.runsOn).toBe("agent");

        for (const kind of spec.kinds) {
          expect(kind.tier).not.toBe(ResourceCommandTier.Read);
        }

        continue;
      }

      for (const kind of spec.kinds) {
        expect(kind.tier).toBe(ResourceCommandTier.Read);
        expect(kind.requiresHuman).toBe(false);
      }
    }
  });

  test("every change names known kinds of its own cloud, an API call and its role's permissions", () => {
    for (const spec of CLOUD_OPERATIONS.filter(isCloudChangeOperation)) {
      expect(spec.takesResource).toBe(true);
      expect(spec.kinds.length).toBeGreaterThan(0);

      for (const kind of spec.kinds) {
        const known: CloudResourceKindSpec | undefined =
          CLOUD_RESOURCE_KINDS.find(
            (candidate: CloudResourceKindSpec): boolean => {
              return (
                candidate.provider === kind.provider &&
                candidate.kind === kind.kind
              );
            },
          );

        expect(known).toBeDefined();
        expect(kind.apiCall.length).toBeGreaterThan(5);
        expect(kind.permissions.length).toBeGreaterThan(0);
      }
    }
  });

  test("three changes always ask a person, and only those", () => {
    const alwaysHuman: Array<string> = [];

    for (const spec of CLOUD_OPERATIONS) {
      const flags: Array<boolean> = spec.kinds.map(
        (kind: CloudOperationKindSpec): boolean => {
          return kind.requiresHuman;
        },
      );

      if (flags.some(Boolean)) {
        // Always ask on every kind it works on, never on some only.
        expect(flags.every(Boolean)).toBe(true);
        alwaysHuman.push(spec.name);
      }
    }

    expect(alwaysHuman).toEqual([
      "fail-over-database",
      "stop-instance",
      "redrive-queue",
    ]);
  });

  test("the safe changes are a rolling ECS restart, starting an instance and scaling out", () => {
    const safe: Array<string> = [];

    for (const spec of CLOUD_OPERATIONS) {
      for (const kind of spec.kinds) {
        if (kind.tier === ResourceCommandTier.SafeWrite) {
          safe.push(`${spec.name}:${kind.provider}:${kind.kind}`);
        }
      }
    }

    expect(safe).toEqual([
      "restart-service:aws:ecs-service",
      "start-instance:aws:ec2-instance",
      "start-instance:aws:rds-instance",
      "start-instance:azure:virtual-machine",
      "start-instance:gcp:compute-instance",
      "scale-out:aws:ecs-service",
      "scale-out:aws:autoscaling-group",
      "scale-out:azure:app-service-plan",
      "scale-out:azure:vm-scale-set",
      "scale-out:gcp:cloud-run-service",
      "scale-out:gcp:managed-instance-group",
    ]);
  });

  test("restarting a service is riskier on Azure than on ECS", () => {
    const restart: CloudOperationSpec = operation("restart-service");

    expect(getCloudOperationKind(restart, "aws", "ecs-service")?.tier).toBe(
      ResourceCommandTier.SafeWrite,
    );
    expect(getCloudOperationKind(restart, "azure", "app-service")?.tier).toBe(
      ResourceCommandTier.RiskyWrite,
    );
    expect(getCloudOperationKind(restart, "azure", "container-app")?.tier).toBe(
      ResourceCommandTier.RiskyWrite,
    );
    // Google Cloud has none.
    expect(
      getCloudOperationKind(restart, "gcp", "cloud-run-service"),
    ).toBeNull();
  });

  test("every change says how it is undone, and an inverse works on the same kinds but one", () => {
    const withoutInverse: Array<string> = [];

    for (const spec of CLOUD_OPERATIONS.filter(isCloudChangeOperation)) {
      if (!spec.undo) {
        expect(spec.undoNote.length).toBeGreaterThan(0);
        continue;
      }

      const inverse: CloudOperationSpec = operation(spec.undo.operation);

      for (const kind of spec.kinds) {
        if (!getCloudOperationKind(inverse, kind.provider, kind.kind)) {
          withoutInverse.push(`${spec.name}:${kind.provider}:${kind.kind}`);
        }
      }

      if (spec.undo.valueFlag) {
        expect(
          inverse.flags.some((flag: CloudParamSpec): boolean => {
            return flag.name === spec.undo!.valueFlag;
          }),
        ).toBe(true);
      }
    }

    // The catalog stops no RDS instance: starting one has nothing to undo.
    expect(withoutInverse).toEqual(["start-instance:aws:rds-instance"]);
  });

  test("a flag that applies to some kinds names kinds the operation has", () => {
    for (const spec of CLOUD_OPERATIONS) {
      const kinds: Array<string> = spec.kinds.map(
        (kind: CloudOperationKindSpec): string => {
          return kind.kind;
        },
      );

      for (const flag of spec.flags) {
        for (const kind of flag.kinds || []) {
          expect(kinds).toContain(kind);
        }
      }
    }
  });

  test("each cloud's resource type names its cloud", () => {
    expect(getCloudCatalogProvider(AiResourceType.AwsAccount)).toBe("aws");
    expect(getCloudCatalogProvider(AiResourceType.AzureSubscription)).toBe(
      "azure",
    );
    expect(getCloudCatalogProvider(AiResourceType.GoogleCloudProject)).toBe(
      "gcp",
    );
    expect(getCloudCatalogProvider(AiResourceType.DockerHost)).toBeNull();
    expect(getCloudCatalogProvider("aws")).toBeNull();
  });
});

describe("AWS ARNs", () => {
  test("an ECS service names its cluster and service", () => {
    const parsedResource: ParsedCloudResource = resource("aws", ECS);

    expect(parsedResource.kind).toBe("ecs-service");
    expect(parsedResource.accountId).toBe("123456789012");
    expect(parsedResource.region).toBe("us-east-1");
    expect(parsedResource.parts["cluster"]).toBe("prod");
    expect(parsedResource.parts["name"]).toBe("web");
  });

  test.each([
    [EC2, "ec2-instance", "instanceId", "i-0abc1234def567890"],
    [RDS, "rds-instance", "name", "orders"],
    [AURORA, "rds-cluster", "name", "orders-cluster"],
    [ASG, "autoscaling-group", "name", "web-asg"],
    [LAMBDA, "lambda-function", "functionName", "checkout"],
    [LAMBDA_ALIAS, "lambda-alias", "alias", "live"],
    [SQS, "sqs-queue", "queueName", "orders-dlq"],
    [TARGET_GROUP, "elb-target-group", "name", "web-tg"],
  ])("%s is a %s", (id: string, kind: string, part: string, value: string) => {
    const parsedResource: ParsedCloudResource = resource("aws", id);

    expect(parsedResource.kind).toBe(kind);
    expect(parsedResource.parts[part]).toBe(value);
  });

  test("a load balancer of an application or network kind", () => {
    expect(
      resource(
        "aws",
        "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/web-alb/0123456789abcdef",
      ).kind,
    ).toBe("elb-load-balancer");
  });

  test("a Lambda version is not an alias, and other ARNs have no kind", () => {
    expect(resource("aws", `${LAMBDA}:7`).kind).toBeNull();
    expect(resource("aws", `${LAMBDA}:$LATEST`).kind).toBeNull();

    const bucket: ParsedCloudResource = resource("aws", S3);

    expect(bucket.kind).toBeNull();
    expect(bucket.accountId).toBe("");
  });

  test("an old-format ECS service ARN (no cluster) has no kind", () => {
    expect(
      resource("aws", "arn:aws:ecs:us-east-1:123456789012:service/web").kind,
    ).toBeNull();
  });

  test.each([
    "ecs-service-web",
    "arn:aws:ecs:us-east-1:123456789012",
    "arn:azure:ecs:us-east-1:123456789012:service/prod/web",
    "arn:aws:ecs:us-east-1:12345:service/prod/web",
    "arn:aws:ecs:US-EAST-1:123456789012:service/prod/web",
    "arn:aws:ecs:us-east-1:123456789012:service/prod/web app",
    "arn:aws:ecs:us-east-1:123456789012:service/prod/'web'",
    "arn:aws:lambda:us-east-1:123456789012:function:checkout:bad.alias",
  ])("refuses %s", (id: string) => {
    expect(parseCloudResourceId("aws", id).ok).toBe(false);
  });

  test("refuses an id longer than the catalog reads, and anything that is not a string", () => {
    const long: string = `arn:aws:s3:::${"a".repeat(CLOUD_MAX_RESOURCE_ID_LENGTH)}`;
    const result: CloudResourceParse = parseCloudResourceId("aws", long);

    expect(result.ok).toBe(false);
    expect(parseCloudResourceId("aws", undefined).ok).toBe(false);
    expect(parseCloudResourceId("aws", 42).ok).toBe(false);
    expect(parseCloudResourceId("aws", "").ok).toBe(false);
  });
});

describe("Azure resource IDs", () => {
  test.each([
    [SITE, "app-service"],
    [PLAN, "app-service-plan"],
    [CONTAINER_APP, "container-app"],
    [VM, "virtual-machine"],
    [VMSS, "vm-scale-set"],
    [POSTGRES, "postgresql-flexible-server"],
    [
      `${AZ}/Microsoft.DBforMySQL/flexibleServers/my-1`,
      "mysql-flexible-server",
    ],
    [FAILOVER_GROUP, "sql-failover-group"],
  ])("%s is a %s", (id: string, kind: string) => {
    expect(resource("azure", id).kind).toBe(kind);
  });

  test("namespaces and types are compared without case, and the subscription is lowercased", () => {
    const parsedResource: ParsedCloudResource = resource(
      "azure",
      `/SUBSCRIPTIONS/${SUBSCRIPTION}/RESOURCEGROUPS/Prod/PROVIDERS/microsoft.web/SITES/web`,
    );

    expect(parsedResource.kind).toBe("app-service");
    expect(parsedResource.accountId).toBe(SUBSCRIPTION.toLowerCase());
    expect(parsedResource.parts["resourceGroup"]).toBe("Prod");
  });

  test("a failover group names its server", () => {
    const parsedResource: ParsedCloudResource = resource(
      "azure",
      FAILOVER_GROUP,
    );

    expect(parsedResource.parts["server"]).toBe("sql-1");
    expect(parsedResource.parts["name"]).toBe("fg-1");
  });

  test("another resource has no kind", () => {
    expect(resource("azure", STORAGE).kind).toBeNull();
  });

  test.each([
    "web",
    `/subscriptions/not-a-guid/resourceGroups/prod/providers/Microsoft.Web/sites/web`,
    `/subscriptions/${SUBSCRIPTION}/resourceGroups/prod/Microsoft.Web/sites/web`,
    `/subscriptions/${SUBSCRIPTION}/resourceGroups/prod/providers/Microsoft.Web/sites`,
    `/subscriptions/${SUBSCRIPTION}/resourceGroups/prod./providers/Microsoft.Web/sites/web`,
    `${SITE} `,
    `${AZ}/Microsoft.Web/sites/we b`,
  ])("refuses %s", (id: string) => {
    expect(parseCloudResourceId("azure", id).ok).toBe(false);
  });

  test("ids are the same resource whatever their case", () => {
    expect(isSameCloudResourceId("azure", SITE, SITE.toUpperCase())).toBe(true);
    expect(isSameCloudResourceId("aws", ECS, ECS.toUpperCase())).toBe(false);
    expect(getCloudWriteTarget(resource("azure", SITE))).toBe(
      SITE.toLowerCase(),
    );
    expect(getCloudWriteTarget(resource("aws", ECS))).toBe(ECS);
  });
});

describe("Google Cloud full resource names", () => {
  test("a Compute Engine VM names its zone and its region", () => {
    const parsedResource: ParsedCloudResource = resource("gcp", GCE);

    expect(parsedResource.kind).toBe("compute-instance");
    expect(parsedResource.zone).toBe("us-central1-a");
    expect(parsedResource.region).toBe("us-central1");
    expect(parsedResource.accountId).toBe("my-project");
    expect(parsedResource.parts["name"]).toBe("web-1");
  });

  test.each([
    [MIG_ZONAL, "managed-instance-group"],
    [MIG_REGIONAL, "managed-instance-group"],
    [RUN, "cloud-run-service"],
    [SQL, "cloud-sql-instance"],
  ])("%s is a %s", (id: string, kind: string) => {
    expect(resource("gcp", id).kind).toBe(kind);
  });

  test("a project number is an account too, and sqladmin is read as cloudsql", () => {
    expect(
      resource(
        "gcp",
        "//run.googleapis.com/projects/123456789/locations/europe-west1/services/web",
      ).accountId,
    ).toBe("123456789");

    const sql: ParsedCloudResource = resource(
      "gcp",
      "//sqladmin.googleapis.com/projects/my-project/instances/orders",
    );

    expect(sql.kind).toBe("cloud-sql-instance");
    expect(sql.id).toBe(SQL);
  });

  test("another resource has no kind", () => {
    expect(
      resource(
        "gcp",
        "//storage.googleapis.com/projects/my-project/buckets/data",
      ).kind,
    ).toBeNull();
  });

  test.each([
    "projects/my-project/zones/us-central1-a/instances/web-1",
    "//compute.example.com/projects/my-project/zones/us-central1-a/instances/web-1",
    "//compute.googleapis.com/folders/1/zones/us-central1-a/instances/web-1",
    "//compute.googleapis.com/projects/My-Project/zones/us-central1-a/instances/web-1",
    "//compute.googleapis.com/projects/my-project/zones/us-central1-a/instances/web 1",
  ])("refuses %s", (id: string) => {
    expect(parseCloudResourceId("gcp", id).ok).toBe(false);
  });
});

describe("the grammar", () => {
  test("a change reads into its operation, resource, kind and typed flags", () => {
    const command: ParsedCloudCommand = parsed(
      "aws",
      `cloud scale-out ${ECS} --count 4`,
    );

    expect(command.operation.name).toBe("scale-out");
    expect(command.resource?.kind).toBe("ecs-service");
    expect(command.kindSpec.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(command.flags["count"]).toBe(4);
    expect(command.canonicalArgs).toEqual(["scale-out", ECS, "--count", "4"]);
  });

  test("--flag=value reads like --flag value, and the canonical argv re-parses to itself", () => {
    for (const [provider, command] of [
      ["aws", `cloud scale-in ${ASG} --count=2`],
      ["aws", `cloud roll-back-service ${ECS} --to web:41`],
      ["aws", `cloud set-concurrency ${LAMBDA} --value none`],
      ["aws", `cloud recent-events ${RDS} --limit 10 --hours 3`],
      ["azure", `cloud roll-back-service ${SITE} --slot staging`],
      ["gcp", `cloud read-logs ${RUN} --filter "timeout error" --minutes 30`],
      ["gcp", "cloud whoami"],
    ] as Array<[CloudCatalogProvider, string]>) {
      const first: ParsedCloudCommand = parsed(provider, command);
      const again: CloudCommandParse = parseCloudCommand(provider, [
        CLOUD_PROGRAM,
        ...first.canonicalArgs,
      ]);

      expect(again.ok).toBe(true);

      if (again.ok) {
        expect(again.command.canonicalArgs).toEqual(first.canonicalArgs);
      }
    }
  });

  test("flags come out in catalog order", () => {
    expect(
      parsed("aws", `cloud recent-events ${RDS} --limit 10 --hours 3`)
        .canonicalArgs,
    ).toEqual(["recent-events", RDS, "--hours", "3", "--limit", "10"]);
  });

  test("an omitted flag reads as its default", () => {
    const command: ParsedCloudCommand = parsed(
      "aws",
      `cloud recent-events ${RDS}`,
    );

    expect(getCloudIntegerFlag(command, "hours")).toBe(6);
    expect(getCloudIntegerFlag(command, "limit")).toBe(50);
    expect(getCloudIntegerFlag(command, "missing")).toBeNull();
  });

  test("whoami names no resource", () => {
    expect(parsed("aws", "cloud whoami").resource).toBeNull();
    expect(refusal("aws", `cloud whoami ${ECS}`)).toMatch(/takes no resource/);
  });

  test.each([
    [
      `cloud scale-out ${EC2} --count 4`,
      /not available for a EC2 instance|not available for an? EC2 instance/,
    ],
    [`cloud scale-out ${ECS}`, /needs --count/],
    [`cloud scale-out ${ECS} --count 0`, /from 1 to 1000/],
    [`cloud scale-out ${ECS} --count 04`, /without leading zeros/],
    [`cloud scale-out ${ECS} -c 4`, /long flags only/],
    [`cloud scale-out ${ECS} --count 4 --count 5`, /more than once/],
    [`cloud scale-out ${ECS} --count`, /needs a value/],
    [`cloud scale-out ${ECS} --count=`, /needs a value/],
    [`cloud scale-out ${ECS} --count --force`, /next word/],
    [`cloud scale-out ${ECS} --Count 4`, /lowercase/],
    [`cloud scale-out ${ECS} --replicas 4`, /takes --count/],
    [`cloud scale-out ${ECS} --region us-west-2 --count 4`, /own account/],
    [`cloud scale-out ${ECS} ${ASG} --count 4`, /exactly one resource/],
    [`cloud scale-out --count 4`, /needs the resource's ARN/],
    [`cloud roll-back-service ${ECS} --slot staging`, /does not apply/],
    [`cloud set-concurrency ${LAMBDA} --value 0`, /or the word "none"/],
    [`cloud read-logs ${LAMBDA} --filter 'a"b'`, /no quotes/],
    [`cloud read-logs ${LAMBDA} --filter '$(id)'`, /no quotes/],
    [`cloud describe ${SITE}`, /ARN/],
    ["cloud", /name an operation/],
    ["cloud --count 4", /comes right after/],
    ["aws ecs update-service", /starts with "cloud"/],
  ])("refuses %s", (command: string, pattern: RegExp) => {
    expect(refusal("aws", command)).toMatch(pattern);
  });

  test("an App Service slot swap needs its slot", () => {
    expect(refusal("azure", `cloud roll-back-service ${SITE}`)).toMatch(
      /needs --slot/,
    );
    expect(
      parsed("azure", `cloud roll-back-service ${SITE} --slot staging`).flags[
        "slot"
      ],
    ).toBe("staging");
  });

  test("an operation the cloud lacks is refused, and names what it has", () => {
    const message: string = refusal("azure", `cloud target-health ${SITE}`);

    expect(message).toMatch(/not available on Azure/);
    expect(message).toMatch(/describe/);
    expect(refusal("gcp", `cloud redrive-queue ${RUN}`)).toMatch(
      /not available on Google Cloud/,
    );
  });

  test("CLI habits are answered with what to write instead", () => {
    expect(refusal("aws", `cloud aws ${ECS}`)).toMatch(/not the aws CLI/);
    expect(refusal("aws", `cloud delete ${ECS}`)).toMatch(/never available/);
    expect(refusal("aws", `cloud terminate ${EC2}`)).toMatch(/never available/);
    expect(refusal("aws", "cloud attach-role-policy")).toMatch(/IAM/);
    expect(refusal("aws", `cloud get-secret-value x`)).toMatch(/secrets/);
    expect(refusal("aws", `cloud restart ${ECS}`)).toMatch(/restart-service/);
    expect(refusal("aws", `cloud rollback ${ECS}`)).toMatch(
      /roll-back-service/,
    );
    expect(refusal("aws", `cloud Describe ${ECS}`)).toMatch(/lowercase/);
    expect(refusal("aws", `cloud purge-queue ${SQS}`)).toMatch(
      /never available/,
    );
  });

  test("-- ends the flags", () => {
    expect(parsed("aws", `cloud describe -- ${ECS}`).resource?.id).toBe(ECS);
  });

  test("an argv that is not one, or a cloud the catalog lacks, is refused without throwing", () => {
    expect(parseCloudCommand("aws", undefined).ok).toBe(false);
    expect(parseCloudCommand("aws", []).ok).toBe(false);
    expect(parseCloudCommand("aws", ["cloud", 4]).ok).toBe(false);
    expect(
      parseCloudCommand("oracle" as CloudCatalogProvider, ["cloud", "whoami"])
        .ok,
    ).toBe(false);
  });

  test("usage lines name the flags, required ones without brackets", () => {
    expect(describeCloudOperationUsage(operation("scale-out"))).toBe(
      "cloud scale-out RESOURCE --count N",
    );
    expect(describeCloudOperationUsage(operation("whoami"))).toBe(
      "cloud whoami",
    );
    expect(
      describeCloudOperationUsage(
        operation("roll-back-service"),
        "app-service",
      ),
    ).toBe("cloud roll-back-service RESOURCE --slot SLOT");
  });
});

describe("what a change replaced", () => {
  test("is written and read back on the first line", () => {
    const line: string = formatCloudReplacedValue({ count: "2" });

    expect(line).toBe(`${CLOUD_REPLACED_VALUE_PREFIX}{"count":"2"}`);
    expect(readCloudReplacedValue(`${line}\nECS service web: 2 → 4`)).toEqual({
      count: "2",
    });
  });

  test("only the first line counts: a later line cannot stand in for it", () => {
    expect(
      readCloudReplacedValue(
        `changed\n${formatCloudReplacedValue({ count: "9" })}`,
      ),
    ).toEqual({});
  });

  test("unknown keys and values outside their pattern are dropped", () => {
    expect(
      formatCloudReplacedValue({ count: "two", version: "web:41", other: "x" }),
    ).toBe(`${CLOUD_REPLACED_VALUE_PREFIX}{"version":"web:41"}`);
    expect(
      readCloudReplacedValue(
        `${CLOUD_REPLACED_VALUE_PREFIX}{"count":"2","value":"-1","x":"y"}`,
      ),
    ).toEqual({ count: "2" });
  });

  test("a line that is not a JSON object reads as nothing", () => {
    for (const text of [
      `${CLOUD_REPLACED_VALUE_PREFIX}not json`,
      `${CLOUD_REPLACED_VALUE_PREFIX}["2"]`,
      `${CLOUD_REPLACED_VALUE_PREFIX}{"count":2}`,
      `${CLOUD_REPLACED_VALUE_PREFIX}{"count":"${"1".repeat(3000)}"}`,
      "",
    ]) {
      expect(readCloudReplacedValue(text)).toEqual({});
    }

    expect(readCloudReplacedValue(undefined)).toEqual({});
  });
});

describe("the undo of a change", () => {
  function undo(
    provider: CloudCatalogProvider,
    command: string,
    replaced: Record<string, string>,
  ): CloudUndoResult {
    return getCloudUndoCommand({
      command: parsed(provider, command),
      replaced,
    });
  }

  test("a scale-out is undone by a scale-in to the recorded count, and back", () => {
    expect(
      undo("aws", `cloud scale-out ${ECS} --count 4`, { count: "2" }),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "scale-in", ECS, "--count", "2"],
    });
    expect(
      undo("gcp", `cloud scale-in ${MIG_ZONAL} --count 2`, { count: "5" }),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "scale-out", MIG_ZONAL, "--count", "5"],
    });
  });

  test("starting is undone by stopping, and stopping by starting", () => {
    expect(undo("aws", `cloud start-instance ${EC2}`, {})).toEqual({
      kind: "command",
      argv: ["cloud", "stop-instance", EC2],
    });
    expect(undo("azure", `cloud stop-instance ${VM}`, {})).toEqual({
      kind: "command",
      argv: ["cloud", "start-instance", VM],
    });
  });

  test("a roll-back is undone by rolling forward to the recorded version", () => {
    expect(
      undo("aws", `cloud roll-back-service ${ECS}`, { version: "web:42" }),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "roll-back-service", ECS, "--to", "web:42"],
    });
  });

  test("a slot swap is undone by the same swap", () => {
    expect(
      undo("azure", `cloud roll-back-service ${SITE} --slot staging`, {}),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "roll-back-service", SITE, "--slot", "staging"],
    });
  });

  test("a concurrency limit goes back to the recorded one, none included", () => {
    expect(
      undo("aws", `cloud set-concurrency ${LAMBDA} --value 50`, {
        value: "none",
      }),
    ).toEqual({
      kind: "command",
      argv: ["cloud", "set-concurrency", LAMBDA, "--value", "none"],
    });
  });

  test("a failover is undone by failing back", () => {
    expect(undo("aws", `cloud fail-over-database ${AURORA}`, {})).toEqual({
      kind: "command",
      argv: ["cloud", "fail-over-database", AURORA],
    });
  });

  test("an RDS instance is started, never stopped, so its start has nothing to undo", () => {
    const result: CloudUndoResult = undo("aws", `cloud start-instance ${RDS}`, {
      state: "stopped",
    });

    expect(result.kind).toBe("nothing");

    if (result.kind === "nothing") {
      expect(result.reason).toMatch(/does not work on an? RDS instance/);
    }
  });

  test("restarts, reboots and redrives have nothing to undo", () => {
    for (const command of [
      `cloud restart-service ${ECS}`,
      `cloud reboot-instance ${RDS}`,
      `cloud redrive-queue ${SQS}`,
    ]) {
      expect(undo("aws", command, {}).kind).toBe("nothing");
    }
  });

  test("a change whose replaced value is unknown is not undone by a guess", () => {
    const result: CloudUndoResult = undo(
      "aws",
      `cloud scale-out ${ECS} --count 4`,
      {},
    );

    expect(result.kind).toBe("unknown");
  });

  test("a read has nothing to undo", () => {
    expect(undo("aws", `cloud describe ${ECS}`, {}).kind).toBe("nothing");
  });
});

describe("the guides", () => {
  test("the read guide lists what each cloud can read", () => {
    const aws: string = getCloudReadCommandGuide("aws");
    const azure: string = getCloudReadCommandGuide("azure");

    for (const name of [
      "describe",
      "recent-events",
      "quota-usage",
      "read-logs",
      "whoami",
    ]) {
      expect(aws).toContain(`cloud ${name}`);
      expect(azure).toContain(`cloud ${name}`);
    }

    expect(aws).toContain("cloud target-health");
    expect(azure).not.toContain("cloud target-health");
    expect(aws).toContain("ARN");
    expect(getCloudReadCommandGuide("gcp")).toContain(
      "Google Cloud full resource name",
    );
  });

  test("the write guide lists each cloud's changes with their tiers and what never runs", () => {
    for (const provider of ALL_CLOUD_CATALOG_PROVIDERS) {
      const guide: string = getCloudWriteCommandGuide(provider);

      expect(guide).toContain("Never, even with approval");
      expect(guide).toContain("cloud scale-out");
      expect(guide).not.toContain("cloud describe");
    }

    const aws: string = getCloudWriteCommandGuide("aws");

    expect(aws).toContain("ECS service: safe");
    expect(aws).toContain("SQS queue: always needs a person");
    expect(getCloudWriteCommandGuide("azure")).toContain(
      "App Service or Function App: riskier",
    );
    expect(getCloudWriteCommandGuide("gcp")).not.toContain("redrive-queue");
  });
});

/*
 * The live reads run on the server with the account's read-only
 * connection, and a refused read names the permissions its kind lists
 * here: so every AWS permission a read names is one the connection's
 * setup grants. (Azure's Monitoring Reader holds every read, and Google
 * Cloud's viewer roles the three permissions the reads name.)
 */
describe("the reads' permissions", () => {
  test("every AWS permission a read names is granted to the read-only connection", () => {
    const granted: Set<string> = new Set<string>([
      ...AWS_READ_ONLY_ACTIONS,
      ...AWS_LOG_READ_ACTION_GROUP.actions,
    ]);

    for (const operation of CLOUD_OPERATIONS) {
      if (operation.runsOn !== "server") {
        continue;
      }

      for (const kind of operation.kinds) {
        if (kind.provider !== "aws") {
          continue;
        }

        for (const permission of kind.permissions) {
          expect([operation.name, kind.kind, granted.has(permission)]).toEqual([
            operation.name,
            kind.kind,
            true,
          ]);
        }
      }
    }
  });

  test("the Google Cloud reads name only what the connection's viewer roles hold", () => {
    const named: Set<string> = new Set<string>();

    for (const operation of CLOUD_OPERATIONS) {
      for (const kind of operation.kinds) {
        if (operation.runsOn === "server" && kind.provider === "gcp") {
          kind.permissions.forEach((permission: string): void => {
            named.add(permission);
          });
        }
      }
    }

    expect(Array.from(named).sort()).toEqual([
      "cloudasset.assets.searchAllResources",
      "logging.logEntries.list",
      "monitoring.timeSeries.list",
    ]);
  });

  test("an AWS kind with no Describe call of its own is read from the stored copy, which needs none", () => {
    const describe: CloudOperationSpec = getCloudOperation("describe")!;
    const fallback: CloudOperationKindSpec = getCloudOperationKind(
      describe,
      "aws",
      null,
    )!;

    expect(fallback.kind).toBe("*");
    expect(fallback.permissions).toEqual([]);
    expect(fallback.apiCall).toContain("NOT LIVE");
    expect(
      getCloudOperationKind(describe, "aws", "ecs-service")!.permissions,
    ).toEqual(["ecs:DescribeServices"]);
  });
});
