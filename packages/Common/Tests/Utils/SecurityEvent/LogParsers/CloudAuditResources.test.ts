import { describe, expect, test } from "@jest/globals";
import { getAwsInventoryType } from "../../../../Server/Utils/CloudConnection/Aws/AwsInventoryCatalog";
import { FaasCloudPlatform } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";
import {
  CLOUDTRAIL_RESOURCE_FIELDS,
  CloudTrailResourceField,
  EC2_RESOURCE_ID_KINDS,
  MAX_CLOUD_AUDIT_RESOURCE_IDS,
  buildCatalogAwsArn,
  canCloudResourceHaveSecurityEvents,
  canServerlessFunctionBeNamedByAuditLog,
  getAzureTopLevelResourceId,
  getGoogleTopLevelResourceName,
  getServerlessFunctionCloudResourceId,
  isCloudFrontDistributionId,
  isCloudResourceNamedByItsId,
  isEc2ResourceId,
  isKmsKeyId,
  normalizeAwsArn,
  normalizeAzureResourceId,
  normalizeGoogleResourceName,
  readAzureActivityResourceIds,
  readCloudTrailResourceIds,
  readGoogleCloudAuditResourceIds,
  readLambdaFunctionName,
  readSqsQueueUrl,
} from "../../../../Utils/SecurityEvent/LogParsers/CloudAuditResources";
import { cloudTrailRecord } from "./LogParserFixtures";
import { googleAuditEntry } from "./GoogleCloudAuditFixtures";
import {
  ACCOUNT,
  CLOUDFRONT_UPDATE_DISTRIBUTION,
  EC2_AUTHORIZE_INGRESS,
  EC2_RUN_INSTANCES,
  ECS_UPDATE_SERVICE,
  EKS_UPDATE_CLUSTER_CONFIG,
  GCP_BIGQUERY_TABLE,
  GCP_BUCKET_IAM,
  GCP_CLOUD_RUN_REPLACE,
  GCP_FIREWALL_INSERT,
  GCP_GKE_ZONAL_UPDATE,
  GCP_SECRET_BY_PROJECT_NUMBER,
  GCP_SET_METADATA,
  KMS_SCHEDULE_DELETION,
  LAMBDA_ADD_PERMISSION,
  LAMBDA_UPDATE_CODE,
  OTHER_ACCOUNT,
  RDS_MODIFY_PUBLIC,
  S3_GET_OBJECT_DENIED,
  S3_PUT_BUCKET_POLICY,
  SQS_SET_ATTRIBUTES,
  SSM_SEND_COMMAND,
  SUBSCRIPTION,
  azureContainerWrite,
  azureKeyVaultRoleAssignment,
} from "./CloudAuditResourceFixtures";

/*
 * WHICH CLOUD RESOURCES AN AUDIT RECORD IS ABOUT (#9779).
 *
 * Each cloud keeps the resource a call was made on its own way; these are
 * the ids the records are read into - the ones the resources' Cloud
 * Resources keep - and the near misses that must never be read as one of
 * them: a longer name, another account, a short name, an id of the wrong
 * shape.
 */

const EC2: string = `arn:aws:ec2:us-east-1:${ACCOUNT}`;

function googleIds(entry: JSONObject): Array<string> {
  return readGoogleCloudAuditResourceIds({
    entry,
    payload: entry["protoPayload"] as JSONObject,
  });
}

describe("readCloudTrailResourceIds: what a CloudTrail record lists and names", () => {
  test("a bucket made public: the bucket, once, from its resources and its call - never the caller's role", () => {
    expect(readCloudTrailResourceIds(S3_PUT_BUCKET_POLICY)).toEqual([
      "arn:aws:s3:::acme-invoices",
    ]);
  });

  test("an object read refused: the object's bucket, not the object", () => {
    expect(readCloudTrailResourceIds(S3_GET_OBJECT_DENIED)).toEqual([
      "arn:aws:s3:::acme-invoices",
    ]);
  });

  test("instances launched: the subnet and security group asked for, then the instances and VPC AWS answered with", () => {
    expect(readCloudTrailResourceIds(EC2_RUN_INSTANCES)).toEqual([
      `${EC2}:subnet/subnet-0a1b2c3d4e5f60718`,
      `${EC2}:security-group/sg-0123456789abcdef0`,
      `${EC2}:instance/i-0123456789abcdef0`,
      `${EC2}:vpc/vpc-0fedcba9876543210`,
      `${EC2}:instance/i-0fedcba9876543210`,
    ]);
  });

  test("SSH opened on a security group: the group, never its rule's id", () => {
    expect(readCloudTrailResourceIds(EC2_AUTHORIZE_INGRESS)).toEqual([
      `${EC2}:security-group/sg-0123456789abcdef0`,
    ]);
  });

  test("a function named by its name, as it was named: its ARN, and the role AWS answered with", () => {
    expect(readCloudTrailResourceIds(LAMBDA_UPDATE_CODE)).toEqual([
      `arn:aws:lambda:us-east-1:${ACCOUNT}:function:Checkout-Handler`,
      `arn:aws:iam::${ACCOUNT}:role/checkout-exec`,
    ]);
  });

  test("a function's alias by its ARN is the function; the bucket allowed to invoke it is named too", () => {
    expect(readCloudTrailResourceIds(LAMBDA_ADD_PERMISSION)).toEqual([
      `arn:aws:lambda:us-east-1:${ACCOUNT}:function:Checkout-Handler`,
      "arn:aws:s3:::acme-uploads",
    ]);
  });

  test("a database by its identifier, in the lower case RDS keeps, and the security group it was moved into", () => {
    expect(readCloudTrailResourceIds(RDS_MODIFY_PUBLIC)).toEqual([
      `arn:aws:rds:us-east-1:${ACCOUNT}:db:orders-db`,
      `${EC2}:security-group/sg-0aaaaaaaabbbbbbbb`,
    ]);
  });

  test("a queue by its URL", () => {
    expect(readCloudTrailResourceIds(SQS_SET_ATTRIBUTES)).toEqual([
      `arn:aws:sqs:us-east-1:${ACCOUNT}:orders-queue`,
    ]);
  });

  test("an ECS service by its name and its cluster's", () => {
    expect(readCloudTrailResourceIds(ECS_UPDATE_SERVICE)).toEqual([
      `arn:aws:ecs:us-east-1:${ACCOUNT}:cluster/prod`,
      `arn:aws:ecs:us-east-1:${ACCOUNT}:service/prod/checkout`,
    ]);
  });

  test("a key scheduled for deletion, once, however the record names it", () => {
    expect(readCloudTrailResourceIds(KMS_SCHEDULE_DELETION)).toEqual([
      `arn:aws:kms:us-east-1:${ACCOUNT}:key/1234abcd-12ab-34cd-56ef-1234567890ab`,
    ]);
  });

  test("an EKS cluster opened to the internet", () => {
    expect(readCloudTrailResourceIds(EKS_UPDATE_CLUSTER_CONFIG)).toEqual([
      `arn:aws:eks:us-east-1:${ACCOUNT}:cluster/prod-eks`,
    ]);
  });

  test("an instance a Systems Manager command ran on", () => {
    expect(readCloudTrailResourceIds(SSM_SEND_COMMAND)).toEqual([
      `${EC2}:instance/i-0123456789abcdef0`,
    ]);
  });

  test("a CloudFront distribution by its id; an origin's id is no distribution", () => {
    expect(readCloudTrailResourceIds(CLOUDFRONT_UPDATE_DISTRIBUTION)).toEqual([
      `arn:aws:cloudfront::${ACCOUNT}:distribution/E2QWRUHAPOMQZL`,
    ]);
  });

  test("a console sign-in and an access key are about no cloud resource", () => {
    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "signin.amazonaws.com",
          eventName: "ConsoleLogin",
          requestParameters: null,
          responseElements: { ConsoleLogin: "Success" },
        }),
      ),
    ).toEqual([]);
    expect(readCloudTrailResourceIds(cloudTrailRecord({}))).toEqual([]);
  });

  test("each in the account the call was received in", () => {
    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "ec2.amazonaws.com",
          eventName: "StopInstances",
          recipientAccountId: OTHER_ACCOUNT,
          awsRegion: "eu-west-1",
          requestParameters: {
            instancesSet: { items: [{ instanceId: "i-0123456789abcdef0" }] },
          },
        }),
      ),
    ).toEqual([
      `arn:aws:ec2:eu-west-1:${OTHER_ACCOUNT}:instance/i-0123456789abcdef0`,
    ]);
  });

  test("a Region of another partition gives that partition's ARN", () => {
    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "dynamodb.amazonaws.com",
          eventName: "DeleteTable",
          awsRegion: "cn-north-1",
          requestParameters: { tableName: "Orders" },
        }),
      ),
    ).toEqual([`arn:aws-cn:dynamodb:cn-north-1:${ACCOUNT}:table/Orders`]);
  });

  test("with no account it can be read in, only what needs none - and what the record lists", () => {
    const record: JSONObject = cloudTrailRecord({
      recipientAccountId: "",
      userIdentity: { type: "AWSAccount", principalId: "AIDAEXAMPLE" },
      eventSource: "s3.amazonaws.com",
      eventName: "PutBucketAcl",
      requestParameters: {
        bucketName: "acme-invoices",
        instanceId: "i-0123456789abcdef0",
      },
      resources: [
        {
          type: "AWS::KMS::Key",
          ARN: `arn:aws:kms:us-east-1:${ACCOUNT}:key/1234abcd-12ab-34cd-56ef-1234567890ab`,
        },
      ],
    });

    expect(readCloudTrailResourceIds(record)).toEqual([
      `arn:aws:kms:us-east-1:${ACCOUNT}:key/1234abcd-12ab-34cd-56ef-1234567890ab`,
      "arn:aws:s3:::acme-invoices",
    ]);
  });

  test("at most a handful, however many it names", () => {
    const items: Array<JSONObject> = [];

    for (let index: number = 0; index < 30; index++) {
      items.push({
        instanceId: `i-0123456789abcd${index.toString(16).padStart(3, "0")}`,
      });
    }

    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "ec2.amazonaws.com",
          eventName: "TerminateInstances",
          requestParameters: { instancesSet: { items } },
        }),
      ),
    ).toHaveLength(MAX_CLOUD_AUDIT_RESOURCE_IDS);
  });

  test("a record that nests without end is read to a bound, quickly", () => {
    let nested: JSONObject = { instanceId: "i-0123456789abcdef0" };

    for (let depth: number = 0; depth < 5000; depth++) {
      nested = { next: nested, sibling: [1, 2, 3] };
    }

    const wide: JSONObject = {};

    for (let index: number = 0; index < 20000; index++) {
      wide[`field${index}`] = { deeper: [{ value: `v${index}` }] };
    }

    const started: number = Date.now();

    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "ec2.amazonaws.com",
          eventName: "ModifyInstanceAttribute",
          requestParameters: nested,
          responseElements: wide,
        }),
      ),
    ).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("readCloudTrailResourceIds: near misses never name a resource", () => {
  test("a longer bucket name is its own bucket, never a shorter one's", () => {
    const ids: Array<string> = readCloudTrailResourceIds(
      cloudTrailRecord({
        eventSource: "s3.amazonaws.com",
        eventName: "PutBucketAcl",
        requestParameters: { bucketName: "acme-invoices-archive" },
      }),
    );

    expect(ids).toEqual(["arn:aws:s3:::acme-invoices-archive"]);
    expect(ids).not.toContain("arn:aws:s3:::acme-invoices");
  });

  test("a bucket's field in another service's call names no bucket", () => {
    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "cloudtrail.amazonaws.com",
          eventName: "UpdateTrail",
          requestParameters: { name: "org-trail", bucketName: "acme-invoices" },
        }),
      ),
    ).toEqual([]);
  });

  test.each([
    ["too short", "i-0123"],
    ["in capitals", "i-0123456789ABCDEF0"],
    ["a transit gateway's attachment", "tgw-attach-0123456789abcdef0"],
    ["a security group's rule", "sgr-0123456789abcdef0"],
    ["with more after it", "i-0123456789abcdef0x"],
    ["an image", "ami-0123456789abcdef0"],
  ])(
    "an EC2-looking value %s names nothing",
    (_case: string, value: string) => {
      expect(
        readCloudTrailResourceIds(
          cloudTrailRecord({
            eventSource: "ec2.amazonaws.com",
            eventName: "CreateTags",
            requestParameters: {
              resourcesSet: { items: [{ resourceId: value }] },
            },
          }),
        ),
      ).toEqual([]);
    },
  );

  test("a bare name in a field no resource is named by names nothing", () => {
    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "dynamodb.amazonaws.com",
          eventName: "UpdateTable",
          requestParameters: {
            indexName: "orders",
            billingMode: "PROVISIONED",
          },
        }),
      ),
    ).toEqual([]);
  });

  test("a key's alias is no key", () => {
    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "kms.amazonaws.com",
          eventName: "DisableKey",
          requestParameters: { keyId: "alias/payments" },
        }),
      ),
    ).toEqual([]);
  });

  test("a session's ARN is the caller, never a resource", () => {
    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "iam.amazonaws.com",
          eventName: "TagRole",
          requestParameters: {
            roleName: "Admin",
            tags: [
              {
                key: "owner",
                value: `arn:aws:sts::${ACCOUNT}:assumed-role/Admin/alice`,
              },
            ],
          },
        }),
      ),
    ).toEqual([]);
  });

  test("an ECS service with no cluster named is left out, never guessed", () => {
    expect(
      readCloudTrailResourceIds(
        cloudTrailRecord({
          eventSource: "ecs.amazonaws.com",
          eventName: "UpdateService",
          requestParameters: { service: "checkout" },
        }),
      ),
    ).toEqual([]);
  });
});

describe("the ARNs built are the ones the resources' rows keep", () => {
  test("every field of the table builds an ARN of its type, through the cloud catalog", () => {
    for (const entry of CLOUDTRAIL_RESOURCE_FIELDS) {
      const dimensions: Record<string, string> = {
        ...(entry.fixedDimensions || {}),
        [entry.dimension]: sampleValueOf(entry),
      };

      for (const dimension of Object.keys(entry.companions || {})) {
        dimensions[dimension] = "prod";
      }

      const arn: string | null = buildCatalogAwsArn({
        namespace: entry.namespace,
        dimensions,
        place: { accountId: ACCOUNT, region: "us-east-1" },
        type: entry.type,
      });

      expect({ field: entry.field, arn: arn?.startsWith("arn:aws:") }).toEqual({
        field: entry.field,
        arn: true,
      });
    }
  });

  test("a security group's, a VPC's and a subnet's ARN are the inventory's own", () => {
    for (const [type, id] of [
      ["AWS::EC2::SecurityGroup", "sg-0123456789abcdef0"],
      ["AWS::EC2::VPC", "vpc-0123456789abcdef0"],
      ["AWS::EC2::Subnet", "subnet-0123456789abcdef0"],
    ] as Array<[string, string]>) {
      const kind: (typeof EC2_RESOURCE_ID_KINDS)[number] | undefined =
        EC2_RESOURCE_ID_KINDS.find((each: { type: string }): boolean => {
          return each.type === type;
        });

      expect(kind!.arn(id, { accountId: ACCOUNT, region: "eu-west-1" })).toBe(
        getAwsInventoryType(type)!.inventoryId!.arn(id, {
          accountId: ACCOUNT,
          region: "eu-west-1",
        }),
      );
    }
  });

  test("an EKS cluster's ARN is the inventory's own", () => {
    expect(readCloudTrailResourceIds(EKS_UPDATE_CLUSTER_CONFIG)).toEqual([
      getAwsInventoryType("AWS::EKS::Cluster")!.inventoryId!.arn("prod-eks", {
        accountId: ACCOUNT,
        region: "us-east-1",
      }),
    ]);
  });
});

function sampleValueOf(entry: CloudTrailResourceField): string {
  if (entry.accepts === isKmsKeyId) {
    return "1234abcd-12ab-34cd-56ef-1234567890ab";
  }

  if (entry.accepts === isCloudFrontDistributionId) {
    return "E2QWRUHAPOMQZL";
  }

  return "orders";
}

describe("an ARN as the resource it is of", () => {
  test.each([
    ["an S3 object", "arn:aws:s3:::acme/a/b.pdf", "arn:aws:s3:::acme"],
    ["an S3 bucket", "arn:aws:s3:::acme", "arn:aws:s3:::acme"],
    [
      "an S3 access point keeps its Region",
      "arn:aws:s3:us-east-1:111122223333:accesspoint/inbox",
      "arn:aws:s3:us-east-1:111122223333:accesspoint/inbox",
    ],
    [
      "a Lambda version",
      "arn:aws:lambda:us-east-1:111122223333:function:Checkout:7",
      "arn:aws:lambda:us-east-1:111122223333:function:Checkout",
    ],
    [
      "a DynamoDB index",
      "arn:aws:dynamodb:us-east-1:111122223333:table/Orders/index/ByCustomer",
      "arn:aws:dynamodb:us-east-1:111122223333:table/Orders",
    ],
    [
      "a DynamoDB stream",
      "arn:aws:dynamodb:us-east-1:111122223333:table/Orders/stream/2026-11-18T10:00:00.000",
      "arn:aws:dynamodb:us-east-1:111122223333:table/Orders",
    ],
    [
      "a Kinesis consumer",
      "arn:aws:kinesis:us-east-1:111122223333:stream/clicks/consumer/app:1",
      "arn:aws:kinesis:us-east-1:111122223333:stream/clicks",
    ],
    [
      "an SNS subscription",
      "arn:aws:sns:us-east-1:111122223333:alerts:5f1e1a2b-0000-4000-8000-000000000001",
      "arn:aws:sns:us-east-1:111122223333:alerts",
    ],
    [
      "a log group as CloudTrail writes it",
      "arn:aws:logs:us-east-1:111122223333:log-group:/aws/lambda/checkout:*",
      "arn:aws:logs:us-east-1:111122223333:log-group:/aws/lambda/checkout",
    ],
    [
      "a load balancer's listener",
      "arn:aws:elasticloadbalancing:us-east-1:111122223333:listener/app/web/50dc6c495c0c9188/f2f7dc8efc522ab2",
      "arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/web/50dc6c495c0c9188",
    ],
    [
      "a load balancer's listener rule",
      "arn:aws:elasticloadbalancing:us-east-1:111122223333:listener-rule/app/web/50dc6c495c0c9188/f2f7dc8efc522ab2/9683b2d02a6cabee",
      "arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/web/50dc6c495c0c9188",
    ],
    [
      "a target group, as it is",
      "arn:aws:elasticloadbalancing:us-east-1:111122223333:targetgroup/web/73e2d6bc24d8a067",
      "arn:aws:elasticloadbalancing:us-east-1:111122223333:targetgroup/web/73e2d6bc24d8a067",
    ],
  ])("%s", (_case: string, arn: string, expected: string) => {
    expect(normalizeAwsArn(arn)).toBe(expected);
  });

  test.each([
    ["a session", "arn:aws:sts::111122223333:assumed-role/Admin/alice"],
    ["no ARN", "arn:aws:s3"],
    ["a name", "orders"],
    ["white space", "arn:aws:s3:::my bucket"],
  ])("%s is no resource", (_case: string, value: string) => {
    expect(normalizeAwsArn(value)).toBeNull();
  });
});

describe("names and ids the way each service writes them", () => {
  test.each([
    ["Checkout", { name: "Checkout", accountId: "" }],
    ["Checkout:prod", { name: "Checkout", accountId: "" }],
    [
      "111122223333:function:Checkout",
      { name: "Checkout", accountId: "111122223333" },
    ],
    [
      "111122223333:function:Checkout:7",
      { name: "Checkout", accountId: "111122223333" },
    ],
  ])("a Lambda function given as %p", (value: string, expected: unknown) => {
    expect(readLambdaFunctionName(value)).toEqual(expected);
  });

  test.each([
    "arn:aws:lambda:us-east-1:111122223333:function:Checkout",
    "us-east-1.Checkout",
    "12:function:Checkout",
    "a".repeat(65),
    "",
  ])("%p is no function name to build an ARN from", (value: string) => {
    expect(readLambdaFunctionName(value)).toBeNull();
  });

  test.each([
    [
      "https://sqs.eu-west-1.amazonaws.com/111122223333/orders",
      { name: "orders", accountId: "111122223333", region: "eu-west-1" },
    ],
    [
      "https://queue.amazonaws.com/111122223333/orders",
      { name: "orders", accountId: "111122223333", region: "us-east-1" },
    ],
    [
      "https://us-west-2.queue.amazonaws.com/111122223333/orders",
      { name: "orders", accountId: "111122223333", region: "us-west-2" },
    ],
  ])("an SQS queue at %s", (url: string, expected: unknown) => {
    expect(readSqsQueueUrl(url)).toEqual(expected);
  });

  test.each([
    "http://sqs.us-east-1.amazonaws.com/111122223333/orders",
    "https://sqs.us-east-1.amazonaws.com/orders",
    "https://example.com/111122223333/orders",
    "https://sqs.us-east-1.amazonaws.com/111122223333/orders/extra",
  ])("%s is no queue", (url: string) => {
    expect(readSqsQueueUrl(url)).toBeNull();
  });

  test("EC2 ids: the prefix, then 8 or 17 lowercase hex digits", () => {
    expect(isEc2ResourceId("i-0123abcd", "i-")).toBe(true);
    expect(isEc2ResourceId("i-0123456789abcdef0", "i-")).toBe(true);
    expect(isEc2ResourceId("i-0123456789abcdef", "i-")).toBe(false);
    expect(isEc2ResourceId("sg-0123abcd", "i-")).toBe(false);
  });

  test("a KMS key's id, never its alias; a distribution's id, never an origin's", () => {
    expect(isKmsKeyId("1234abcd-12ab-34cd-56ef-1234567890ab")).toBe(true);
    expect(isKmsKeyId("mrk-1234abcd12ab34cd56ef1234567890ab")).toBe(true);
    expect(isKmsKeyId("alias/payments")).toBe(false);
    expect(isKmsKeyId("1234abcd-12ab-34cd-56ef-1234567890aG")).toBe(false);
    expect(isCloudFrontDistributionId("E2QWRUHAPOMQZL")).toBe(true);
    expect(isCloudFrontDistributionId("S3-acme-site")).toBe(false);
    expect(isCloudFrontDistributionId("e2qwruhapomqzl")).toBe(false);
  });
});

describe("readAzureActivityResourceIds: what an Activity Log record is about", () => {
  test("a blob container made public, as the export writes it: the container and its storage account, in lower case", () => {
    expect(readAzureActivityResourceIds(azureContainerWrite())).toEqual([
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.storage/storageaccounts/acmeinvoices/blobservices/default/containers/invoices`,
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.storage/storageaccounts/acmeinvoices`,
    ]);
  });

  test("a role granted on a Key Vault, as the REST API returns it: the assignment and the vault", () => {
    expect(readAzureActivityResourceIds(azureKeyVaultRoleAssignment())).toEqual(
      [
        `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.keyvault/vaults/kv-payments/providers/microsoft.authorization/roleassignments/9f0e1d2c-0000-4000-8000-000000000104`,
        `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.keyvault/vaults/kv-payments`,
      ],
    );
  });

  test("a rule of a network security group: the group", () => {
    expect(
      readAzureActivityResourceIds(
        azureContainerWrite({
          resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-web/securityRules/allow-ssh`,
        }),
      ),
    ).toContain(
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.network/networksecuritygroups/nsg-web`,
    );
  });

  test("a subscription's own setting, and a resource group, are what they are and nothing more", () => {
    expect(
      readAzureActivityResourceIds(
        azureContainerWrite({
          resourceId: `/subscriptions/${SUBSCRIPTION}/providers/microsoft.insights/diagnosticSettings/to-siem`,
        }),
      ),
    ).toEqual([
      `/subscriptions/${SUBSCRIPTION}/providers/microsoft.insights/diagnosticsettings/to-siem`,
    ]);
    expect(
      readAzureActivityResourceIds(
        azureContainerWrite({
          resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/`,
        }),
      ),
    ).toEqual([`/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod`]);
  });

  test("a resource group called providers is still a resource group", () => {
    expect(
      getAzureTopLevelResourceId(
        `/subscriptions/${SUBSCRIPTION}/resourcegroups/providers/providers/microsoft.compute/virtualmachines/vm-1/extensions/agent`,
      ),
    ).toBe(
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/providers/providers/microsoft.compute/virtualmachines/vm-1`,
    );
  });

  test("a Defender for Cloud alert names the resource it was raised on, only by its ID", () => {
    const ids: Array<string> = readAzureActivityResourceIds(
      azureContainerWrite({
        category: "Security",
        resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Security/locations/westeurope/alerts/2518301663999999999_a1b2`,
        properties: {
          alertName: "Suspicious PowerShell activity detected",
          resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01`,
          compromisedEntity: "vm-prod-01",
        },
      }),
    );

    expect(ids).toContain(
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.compute/virtualmachines/vm-prod-01`,
    );
    expect(ids).not.toContain("vm-prod-01");
  });

  test("near misses: a longer name is another resource, and what is no resource ID names nothing", () => {
    const ids: Array<string> = readAzureActivityResourceIds(
      azureContainerWrite({
        resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-010`,
      }),
    );

    expect(ids).toEqual([
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.compute/virtualmachines/vm-prod-010`,
    ]);
    expect(ids).not.toContain(
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.compute/virtualmachines/vm-prod-01`,
    );

    for (const resourceId of [
      "",
      "global",
      "vm-prod-01",
      "/resourceGroups/x",
    ]) {
      expect(
        readAzureActivityResourceIds(azureContainerWrite({ resourceId })),
      ).toEqual([]);
    }

    expect(normalizeAzureResourceId("/subscriptions/")).toBeNull();
  });
});

describe("readGoogleCloudAuditResourceIds: what a Google Cloud audit entry is about", () => {
  test("a VM's metadata changed: the VM by its name, and by the id its entry is filed under", () => {
    expect(googleIds(GCP_SET_METADATA)).toEqual([
      "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/web-1",
      "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/4567890123456789012",
    ]);
  });

  test("a bucket's IAM policy changed: the bucket, once", () => {
    expect(googleIds(GCP_BUCKET_IAM)).toEqual([
      "//storage.googleapis.com/projects/_/buckets/acme-invoices",
    ]);
  });

  test("a BigQuery table changed: the table and its dataset", () => {
    expect(googleIds(GCP_BIGQUERY_TABLE)).toEqual([
      "//bigquery.googleapis.com/projects/acme-prod/datasets/billing/tables/invoices",
      "//bigquery.googleapis.com/projects/acme-prod/datasets/billing",
    ]);
  });

  test("a Cloud Run service replaced through the Knative API: the service under its project and location", () => {
    expect(googleIds(GCP_CLOUD_RUN_REPLACE)).toEqual([
      "//run.googleapis.com/projects/acme-prod/locations/us-central1/services/checkout",
    ]);
  });

  test("a secret named by its project's number: by the project's id", () => {
    expect(googleIds(GCP_SECRET_BY_PROJECT_NUMBER)).toEqual([
      "//secretmanager.googleapis.com/projects/acme-prod/secrets/db-password",
    ]);
  });

  test("a firewall rule, and a zonal GKE cluster under its location", () => {
    expect(googleIds(GCP_FIREWALL_INSERT)).toEqual([
      "//compute.googleapis.com/projects/acme-prod/global/firewalls/allow-ssh-anywhere",
    ]);
    expect(googleIds(GCP_GKE_ZONAL_UPDATE)).toEqual([
      "//container.googleapis.com/projects/acme-prod/locations/us-central1-a/clusters/prod",
    ]);
  });

  test("a name of any project is no one resource's", () => {
    expect(googleIds(googleAuditEntry("activity"))).toEqual([]);
  });

  test("near misses: another VM's name, and a service that is no API", () => {
    const ids: Array<string> = googleIds(
      googleAuditEntry(
        "activity",
        {
          serviceName: "compute.googleapis.com",
          resourceName:
            "projects/acme-prod/zones/us-central1-a/instances/web-10",
        },
        { resource: { type: "project", labels: { project_id: "acme-prod" } } },
      ),
    );

    expect(ids).toEqual([
      "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/web-10",
    ]);
    expect(ids).not.toContain(
      "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/web-1",
    );
    expect(
      googleIds(
        googleAuditEntry("activity", {
          serviceName: "Compute Engine",
          resourceName:
            "projects/acme-prod/zones/us-central1-a/instances/web-1",
        }),
      ),
    ).toEqual([]);
  });

  test("the resource a name is a part of", () => {
    expect(
      getGoogleTopLevelResourceName(
        "projects/_/buckets/acme/objects/2026/11/invoice.pdf",
      ),
    ).toBe("projects/_/buckets/acme");
    expect(
      getGoogleTopLevelResourceName(
        "apps/acme-prod/services/default/versions/v2",
      ),
    ).toBe("apps/acme-prod/services/default");
    expect(
      getGoogleTopLevelResourceName(
        "projects/acme-prod/locations/us/functions/checkout",
      ),
    ).toBeNull();
    expect(getGoogleTopLevelResourceName("projects/acme-prod")).toBeNull();
    expect(
      normalizeGoogleResourceName({
        serviceName: "run.googleapis.com",
        resourceName: "namespaces/acme-prod/services/checkout",
        labels: {},
      }),
    ).toBeNull();
  });
});

describe("getServerlessFunctionCloudResourceId: a function's own id at its cloud (#9780)", () => {
  test("a Lambda function's ARN, from its account, Region and name", () => {
    expect(
      getServerlessFunctionCloudResourceId({
        functionIdentifier: "Checkout-Handler",
        cloudProvider: "aws",
        cloudPlatform: FaasCloudPlatform.AwsLambda,
        cloudRegion: "us-east-1",
        cloudAccountId: ACCOUNT,
      }),
    ).toBe(`arn:aws:lambda:us-east-1:${ACCOUNT}:function:Checkout-Handler`);

    // An AWS function whose platform was not reported.
    expect(
      getServerlessFunctionCloudResourceId({
        functionIdentifier: "checkout",
        cloudProvider: "aws",
        cloudRegion: "eu-west-1",
        cloudAccountId: ACCOUNT,
      }),
    ).toBe(`arn:aws:lambda:eu-west-1:${ACCOUNT}:function:checkout`);
  });

  test("a Google Cloud function's full resource name", () => {
    expect(
      getServerlessFunctionCloudResourceId({
        functionIdentifier: "resize-image",
        cloudProvider: "gcp",
        cloudPlatform: FaasCloudPlatform.GcpCloudFunctions,
        cloudRegion: "us-central1",
        cloudAccountId: "acme-prod",
      }),
    ).toBe(
      "//cloudfunctions.googleapis.com/projects/acme-prod/locations/us-central1/functions/resize-image",
    );
  });

  test("nothing is guessed where the telemetry does not say it in full", () => {
    for (const fn of [
      // No account: a Lambda layer that reports none.
      {
        functionIdentifier: "checkout",
        cloudPlatform: FaasCloudPlatform.AwsLambda,
        cloudRegion: "us-east-1",
      },
      // No Region.
      {
        functionIdentifier: "checkout",
        cloudPlatform: FaasCloudPlatform.AwsLambda,
        cloudAccountId: ACCOUNT,
      },
      // An account that is no AWS account.
      {
        functionIdentifier: "checkout",
        cloudPlatform: FaasCloudPlatform.AwsLambda,
        cloudRegion: "us-east-1",
        cloudAccountId: "acme",
      },
      // A Lambda@Edge replica's name, or a name with a version.
      {
        functionIdentifier: "us-east-1.checkout",
        cloudPlatform: FaasCloudPlatform.AwsLambda,
        cloudRegion: "us-east-1",
        cloudAccountId: ACCOUNT,
      },
      {
        functionIdentifier: "checkout:prod",
        cloudPlatform: FaasCloudPlatform.AwsLambda,
        cloudRegion: "us-east-1",
        cloudAccountId: ACCOUNT,
      },
      // An Azure function: its resource ID holds a resource group no telemetry reports.
      {
        functionIdentifier: "orders-func",
        cloudProvider: "azure",
        cloudPlatform: FaasCloudPlatform.AzureFunctions,
        cloudRegion: "westeurope",
        cloudAccountId: SUBSCRIPTION,
      },
      // No platform and no provider.
      {
        functionIdentifier: "checkout",
        cloudRegion: "us-east-1",
        cloudAccountId: ACCOUNT,
      },
    ]) {
      expect(getServerlessFunctionCloudResourceId(fn)).toBeNull();
    }
  });
});

describe("canServerlessFunctionBeNamedByAuditLog: whose functions an audit log can name (#9780)", () => {
  test("a Lambda function's and a Google Cloud function's", () => {
    expect(
      canServerlessFunctionBeNamedByAuditLog({
        cloudPlatform: FaasCloudPlatform.AwsLambda,
      }),
    ).toBe(true);
    // An AWS function whose platform was not reported.
    expect(
      canServerlessFunctionBeNamedByAuditLog({ cloudProvider: "AWS" }),
    ).toBe(true);
    expect(
      canServerlessFunctionBeNamedByAuditLog({
        cloudProvider: "gcp",
        cloudPlatform: FaasCloudPlatform.GcpCloudFunctions,
      }),
    ).toBe(true);
  });

  test("never an Azure function's, nor one of no known cloud", () => {
    expect(
      canServerlessFunctionBeNamedByAuditLog({
        cloudProvider: "azure",
        cloudPlatform: FaasCloudPlatform.AzureFunctions,
      }),
    ).toBe(false);
    expect(canServerlessFunctionBeNamedByAuditLog({})).toBe(false);
    expect(
      canServerlessFunctionBeNamedByAuditLog({ cloudProvider: "gcp" }),
    ).toBe(false);
  });
});

describe("canCloudResourceHaveSecurityEvents: a resource an event can reach (#9779)", () => {
  const AZURE_NSG: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/prod/providers/Microsoft.Network/networkSecurityGroups/web-nsg`;
  const STAND_IN: string = "AWS/AmazonMQ Broker=orders";

  test("one its cloud's audit log names by its own ID, in each cloud", () => {
    for (const resource of [
      {
        provider: "aws",
        type: "AWS::S3::Bucket",
        providerResourceId: "arn:aws:s3:::payments-bucket",
      },
      {
        provider: "azure",
        type: "Microsoft.Network/networkSecurityGroups",
        providerResourceId: AZURE_NSG,
      },
      {
        provider: "gcp",
        type: "storage.googleapis.com/Bucket",
        providerResourceId:
          "//storage.googleapis.com/projects/_/buckets/acme-backups",
      },
    ]) {
      expect(canCloudResourceHaveSecurityEvents(resource)).toBe(true);
      expect(isCloudResourceNamedByItsId(resource.providerResourceId)).toBe(
        true,
      );
    }
  });

  test("one kept by a stand-in, with logs of its own its stream stamps with that stand-in", () => {
    expect(
      canCloudResourceHaveSecurityEvents({
        provider: "AWS",
        type: "AWS::DocDB::DBCluster",
        providerResourceId: "AWS/DocDB DBClusterIdentifier=orders",
      }),
    ).toBe(true);
    // Its audit log still cannot name it.
    expect(
      isCloudResourceNamedByItsId("AWS/DocDB DBClusterIdentifier=orders"),
    ).toBe(false);
  });

  test("one kept by a stand-in that answers on a name or a public address of its own", () => {
    expect(
      canCloudResourceHaveSecurityEvents({
        provider: "aws",
        type: "AWS::AmazonMQ::Broker",
        providerResourceId: STAND_IN,
        cloudEndpoints: ["b-1234.mq.us-east-1.amazonaws.com"],
      }),
    ).toBe(true);
    expect(
      canCloudResourceHaveSecurityEvents({
        provider: "aws",
        type: "AWS::AmazonMQ::Broker",
        providerResourceId: STAND_IN,
        cloudEndpoints: ["203.0.113.10"],
      }),
    ).toBe(true);
  });

  test("never one known only by a stand-in, with no logs and no name or address of its own", () => {
    expect(
      canCloudResourceHaveSecurityEvents({
        provider: "aws",
        type: "AWS::AmazonMQ::Broker",
        providerResourceId: STAND_IN,
      }),
    ).toBe(false);
    // A loopback address is no address of its own.
    expect(
      canCloudResourceHaveSecurityEvents({
        provider: "aws",
        type: "AWS::AmazonMQ::Broker",
        providerResourceId: STAND_IN,
        cloudEndpoints: ["127.0.0.1"],
      }),
    ).toBe(false);
    // A row with no ID at all, and nothing else.
    expect(
      canCloudResourceHaveSecurityEvents({
        provider: "aws",
        type: "AWS::Lambda::Function",
        providerResourceId: "  ",
      }),
    ).toBe(false);
    expect(isCloudResourceNamedByItsId(STAND_IN)).toBe(false);
    expect(isCloudResourceNamedByItsId(null)).toBe(false);
  });
});
