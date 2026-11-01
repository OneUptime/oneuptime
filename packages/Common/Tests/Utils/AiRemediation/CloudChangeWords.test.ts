import {
  CLOUD_CHANGE_SENTENCES,
  CLOUD_CONCURRENCY_SENTENCE,
  CLOUD_KIND_WORDS,
  CLOUD_SCALE_SENTENCES,
  CloudChangeWords,
  describeCloudChange,
  getCloudKindWordsKeys,
  getCloudResourceShortName,
} from "../../../Utils/AiRemediation/CloudChangeWords";
import {
  CLOUD_RESOURCE_KINDS,
  CloudResourceKindSpec,
  CloudResourceParse,
  parseCloudResourceId,
} from "../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  createTranslator,
  getTemplatePlaceholders,
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - a cloud change in plain words
 * (Utils/AiRemediation/CloudChangeWords):
 *
 *  - every change of the catalog, on every kind it takes, reads as one
 *    sentence that names the kind and the resource by its short name - and
 *    a scale or a concurrency limit, the count it sets;
 *  - the sentence is read from the command by the catalog's own grammar,
 *    so a read, a dry run, a command of another resource, an unknown kind
 *    or a command that does not parse has none;
 *  - the kinds' words are the catalog's own display names, for every kind;
 *  - in another language, the translator words the sentence and the kind.
 */

const AWS: AiResourceType = AiResourceType.AwsAccount;
const AZURE: AiResourceType = AiResourceType.AzureSubscription;
const GCP: AiResourceType = AiResourceType.GoogleCloudProject;

const ECS: string =
  "arn:aws:ecs:us-east-1:123456789012:service/prod/checkout-api";
const EC2: string =
  "arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0";
const RDS: string = "arn:aws:rds:us-east-1:123456789012:db:orders-db";
const AURORA: string =
  "arn:aws:rds:us-east-1:123456789012:cluster:orders-cluster";
const ASG: string =
  "arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:11111111-2222-3333-4444-555555555555:autoScalingGroupName/web-asg";
const LAMBDA: string =
  "arn:aws:lambda:us-east-1:123456789012:function:checkout";
const LAMBDA_ALIAS: string =
  "arn:aws:lambda:us-east-1:123456789012:function:checkout:live";
const SQS: string = "arn:aws:sqs:us-east-1:123456789012:orders-dlq";
const AZURE_PREFIX: string =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers";
const APP_SERVICE: string = `${AZURE_PREFIX}/Microsoft.Web/sites/web`;
const APP_PLAN: string = `${AZURE_PREFIX}/Microsoft.Web/serverfarms/plan-1`;
const CONTAINER_APP: string = `${AZURE_PREFIX}/Microsoft.App/containerApps/api`;
const AZURE_VM: string = `${AZURE_PREFIX}/Microsoft.Compute/virtualMachines/vm-1`;
const VMSS: string = `${AZURE_PREFIX}/Microsoft.Compute/virtualMachineScaleSets/vmss-1`;
const FAILOVER_GROUP: string = `${AZURE_PREFIX}/Microsoft.Sql/servers/sql-1/failoverGroups/fg-1`;
const GCE: string =
  "//compute.googleapis.com/projects/my-project/zones/us-central1-a/instances/web-1";
const RUN: string =
  "//run.googleapis.com/projects/my-project/locations/us-central1/services/web";
const MIG: string =
  "//compute.googleapis.com/projects/my-project/regions/us-central1/instanceGroupManagers/web-mig";
const SQL: string =
  "//sqladmin.googleapis.com/projects/my-project/instances/db-1";

function sentence(resourceType: AiResourceType, command: string): string {
  const words: CloudChangeWords | null = describeCloudChange({
    resourceType,
    command,
  });

  if (!words) {
    throw new Error(`no words for: ${command}`);
  }

  return words.sentence;
}

describe("every change of the catalog reads as one sentence", () => {
  test.each([
    [
      AWS,
      `cloud restart-service ${ECS}`,
      "Restart the ECS service checkout-api",
    ],
    [
      AWS,
      `cloud start-instance ${EC2}`,
      "Start the EC2 instance i-0123456789abcdef0",
    ],
    [AWS, `cloud start-instance ${RDS}`, "Start the RDS instance orders-db"],
    [
      AWS,
      `cloud scale-out ${ECS} --count 8`,
      "Scale the ECS service checkout-api out to 8 tasks",
    ],
    [
      AWS,
      `cloud scale-out ${ASG} --count 6`,
      "Scale the Auto Scaling group web-asg out to 6 instances",
    ],
    [
      AWS,
      `cloud scale-in ${ECS} --count 1`,
      "Scale the ECS service checkout-api in to 1 task",
    ],
    [AWS, `cloud reboot-instance ${RDS}`, "Reboot the RDS instance orders-db"],
    [
      AWS,
      `cloud roll-back-service ${ECS}`,
      "Roll the ECS service checkout-api back to the version before",
    ],
    [
      AWS,
      `cloud roll-back-service ${LAMBDA_ALIAS} --to 41`,
      "Roll the Lambda alias checkout:live back to 41",
    ],
    [
      AWS,
      `cloud set-concurrency ${LAMBDA} --value 20`,
      "Let at most 20 copies of the Lambda function checkout run at once",
    ],
    [
      AWS,
      `cloud set-concurrency ${LAMBDA} --value 1`,
      "Let at most 1 copy of the Lambda function checkout run at once",
    ],
    [
      AWS,
      `cloud set-concurrency ${LAMBDA} --value none`,
      "Remove the limit on how many copies of the Lambda function checkout run at once",
    ],
    [
      AWS,
      `cloud fail-over-database ${AURORA}`,
      "Fail the Aurora cluster orders-cluster over to its standby",
    ],
    [
      AWS,
      `cloud stop-instance ${EC2}`,
      "Stop the EC2 instance i-0123456789abcdef0",
    ],
    [
      AWS,
      `cloud redrive-queue ${SQS}`,
      "Move the messages of the SQS queue orders-dlq back to the queue they came from",
    ],
    [
      AZURE,
      `cloud restart-service ${APP_SERVICE}`,
      "Restart the App Service or Function App web",
    ],
    [
      AZURE,
      `cloud restart-service ${CONTAINER_APP}`,
      "Restart the Container App api",
    ],
    [
      AZURE,
      `cloud scale-out ${APP_PLAN} --count 3`,
      "Scale the App Service plan plan-1 out to 3 instances",
    ],
    [
      AZURE,
      `cloud scale-in ${VMSS} --count 2`,
      "Scale the VM scale set vmss-1 in to 2 instances",
    ],
    [
      AZURE,
      `cloud reboot-instance ${AZURE_VM}`,
      "Reboot the Azure virtual machine vm-1",
    ],
    [
      AZURE,
      `cloud roll-back-service ${APP_SERVICE} --slot staging`,
      "Swap the App Service or Function App web with its staging slot, back to the version before",
    ],
    [
      AZURE,
      `cloud fail-over-database ${FAILOVER_GROUP}`,
      "Fail the SQL failover group fg-1 over to its standby",
    ],
    [GCP, `cloud start-instance ${GCE}`, "Start the Compute Engine VM web-1"],
    [
      GCP,
      `cloud scale-out ${RUN} --count 2`,
      "Raise the minimum of the Cloud Run service web to 2 instances",
    ],
    [
      GCP,
      `cloud scale-in ${RUN} --count 1`,
      "Lower the minimum of the Cloud Run service web to 1 instance",
    ],
    [
      GCP,
      `cloud scale-out ${MIG} --count 5`,
      "Scale the managed instance group web-mig out to 5 instances",
    ],
    [GCP, `cloud reboot-instance ${SQL}`, "Reboot the Cloud SQL instance db-1"],
    [
      GCP,
      `cloud roll-back-service ${RUN} --to web-00041-abc`,
      "Roll the Cloud Run service web back to web-00041-abc",
    ],
  ])(
    "%s %s",
    (resourceType: AiResourceType, command: string, expected: string) => {
      expect(sentence(resourceType, command)).toBe(expected);
    },
  );

  test("the words say what the sentence is about", () => {
    const words: CloudChangeWords | null = describeCloudChange({
      resourceType: AWS,
      command: `cloud scale-out ${ECS} --count=8`,
    });

    expect(words).toEqual({
      operation: "scale-out",
      kindName: "ECS service",
      resourceName: "checkout-api",
      sentence: "Scale the ECS service checkout-api out to 8 tasks",
    });
  });
});

describe("what has no sentence", () => {
  test.each([
    ["a read", AWS, `cloud describe ${ECS}`],
    ["recent events", AWS, `cloud recent-events ${ECS} --hours 6`],
    ["a dry run", AWS, `cloud dry-run scale-out ${ECS} --count 8`],
    ["whoami", AWS, "cloud whoami"],
    ["an aws command", AWS, "aws ecs update-service --service checkout-api"],
    ["nonsense", AWS, "cloud scale-out not-an-arn --count 8"],
    ["empty", AWS, ""],
    ["a Docker command", AiResourceType.DockerHost, "docker restart web"],
    ["the wrong cloud's id", AZURE, `cloud restart-service ${ECS}`],
  ])("%s", (_name: string, resourceType: AiResourceType, command: string) => {
    expect(describeCloudChange({ resourceType, command })).toBeNull();
  });

  test("anything malformed answers null and never throws", () => {
    for (const value of [
      { resourceType: undefined, command: `cloud restart-service ${ECS}` },
      { resourceType: AWS, command: undefined },
      { resourceType: AWS, command: 42 },
      { resourceType: "AwsAccount ", command: `cloud restart-service ${ECS}` },
    ]) {
      expect(() => {
        return describeCloudChange(
          value as unknown as { resourceType: unknown; command: string },
        );
      }).not.toThrow();
      expect(
        describeCloudChange(
          value as unknown as { resourceType: unknown; command: string },
        ),
      ).toBeNull();
    }
  });
});

describe("a resource's short name", () => {
  function parsed(provider: "aws" | "azure" | "gcp", id: string): string {
    const parse: CloudResourceParse = parseCloudResourceId(provider, id);

    if (!parse.ok) {
      throw new Error(parse.errorMessage);
    }

    return getCloudResourceShortName(parse.resource);
  }

  test("is the name its id carries, whatever the cloud", () => {
    expect(parsed("aws", ECS)).toBe("checkout-api");
    expect(parsed("aws", EC2)).toBe("i-0123456789abcdef0");
    expect(parsed("aws", RDS)).toBe("orders-db");
    expect(parsed("aws", ASG)).toBe("web-asg");
    expect(parsed("aws", LAMBDA)).toBe("checkout");
    expect(parsed("aws", LAMBDA_ALIAS)).toBe("checkout:live");
    expect(parsed("aws", SQS)).toBe("orders-dlq");
    expect(parsed("azure", APP_SERVICE)).toBe("web");
    expect(parsed("azure", FAILOVER_GROUP)).toBe("fg-1");
    expect(parsed("gcp", RUN)).toBe("web");
    expect(parsed("gcp", MIG)).toBe("web-mig");
    expect(parsed("gcp", SQL)).toBe("db-1");
  });

  test("an id the catalog has no kind for is named by its last word", () => {
    expect(parsed("aws", "arn:aws:s3:::checkout-assets")).toBe(
      "checkout-assets",
    );
  });

  test("a long name is cut in the sentence; the command under it stays whole", () => {
    const name: string = "a".repeat(200);

    expect(
      parsed(
        "aws",
        `arn:aws:ecs:us-east-1:123456789012:service/prod/${"b".repeat(40)}`,
      ),
    ).toBe("b".repeat(40));

    const words: CloudChangeWords | null = describeCloudChange({
      resourceType: AWS,
      command: `cloud restart-service arn:aws:ecs:us-east-1:123456789012:service/prod/${name.slice(0, 200)}`,
    });

    expect(words?.resourceName.length).toBeLessThanOrEqual(99);
    expect(words?.resourceName.endsWith("...")).toBe(true);
  });
});

describe("the kinds' words are the catalog's own", () => {
  // A display name that does not say whose kind it is, said in the words.
  const NAMED_FOR_ITS_CLOUD: Readonly<Record<string, string>> = {
    "azure:virtual-machine": "Azure virtual machine",
  };

  test("every kind of the catalog has its words, the same as its display name", () => {
    for (const spec of CLOUD_RESOURCE_KINDS) {
      const key: string = `${spec.provider}:${spec.kind}`;

      expect(CLOUD_KIND_WORDS[key]).toBe(
        NAMED_FOR_ITS_CLOUD[key] || spec.displayName,
      );
    }

    expect(
      CLOUD_RESOURCE_KINDS.find((spec: CloudResourceKindSpec): boolean => {
        return `${spec.provider}:${spec.kind}` === "azure:virtual-machine";
      })?.displayName,
    ).toBe("virtual machine");
  });

  test("and nothing else has words", () => {
    expect(Object.keys(CLOUD_KIND_WORDS).sort()).toEqual(
      getCloudKindWordsKeys().sort(),
    );
    expect(
      CLOUD_RESOURCE_KINDS.map((spec: CloudResourceKindSpec): string => {
        return `${spec.provider}:${spec.kind}`;
      }).sort(),
    ).toEqual(getCloudKindWordsKeys().sort());
  });
});

describe("its sentences", () => {
  const plurals: Array<PluralTemplate> = [
    CLOUD_CONCURRENCY_SENTENCE,
    ...Object.values(CLOUD_SCALE_SENTENCES.out),
    ...Object.values(CLOUD_SCALE_SENTENCES.in),
  ];

  test("each names the kind and the resource, a plural its count too, in both forms", () => {
    for (const template of Object.values(CLOUD_CHANGE_SENTENCES)) {
      expect(getTemplatePlaceholders(template)).toEqual(
        expect.arrayContaining(["kind", "name"]),
      );
    }

    for (const template of plurals) {
      for (const form of [template.one, template.other]) {
        expect(getTemplatePlaceholders(form)).toEqual(
          expect.arrayContaining(["kind", "name", "count"]),
        );
      }
    }
  });

  test("in another language, the translator words the sentence and the kind", () => {
    const german: Translator = createTranslator(
      (text: string): string | undefined => {
        const dictionary: Record<string, string> = {
          "Scale the {{kind}} {{name}} out to {{count}} tasks":
            "{{kind}} {{name}}: auf {{count}} Tasks hochskalieren",
          "ECS service": "ECS-Dienst",
        };

        return dictionary[text];
      },
      "de",
    );

    expect(
      describeCloudChange({
        resourceType: AWS,
        command: `cloud scale-out ${ECS} --count 1000`,
        translator: german,
      })?.sentence,
    ).toBe("ECS-Dienst checkout-api: auf 1.000 Tasks hochskalieren");
  });

  test("a language that has not worded the sentence reads it in English, kind and all", () => {
    const partial: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "ECS service" ? "ECS-Dienst" : undefined;
      },
      "de",
    );

    expect(
      describeCloudChange({
        resourceType: AWS,
        command: `cloud restart-service ${ECS}`,
        translator: partial,
      })?.sentence,
    ).toBe("Restart the ECS service checkout-api");
  });
});
