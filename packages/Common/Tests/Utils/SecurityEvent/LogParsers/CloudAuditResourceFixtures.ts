import { JSONObject } from "../../../../Types/JSON";
import { cloudTrailRecord } from "./LogParserFixtures";
import { googleAuditEntry } from "./GoogleCloudAuditFixtures";

/*
 * Audit records about cloud resources, as each cloud writes them, for the
 * tests of which resources they name (#9779). Made-up accounts, projects,
 * subscriptions and people; the shapes are each cloud's own. Not a test
 * file itself.
 */

export const ACCOUNT: string = "111122223333";
export const OTHER_ACCOUNT: string = "444455556666";
export const SUBSCRIPTION: string = "11111111-2222-3333-4444-555555555555";

// A role's session, as CloudTrail writes most calls made from the console or a pipeline.
const ASSUMED_ROLE: JSONObject = {
  type: "AssumedRole",
  principalId: "AROAEXAMPLEID:alice",
  arn: `arn:aws:sts::${ACCOUNT}:assumed-role/Admin/alice`,
  accountId: ACCOUNT,
  sessionContext: {
    sessionIssuer: {
      type: "Role",
      principalId: "AROAEXAMPLEID",
      arn: `arn:aws:iam::${ACCOUNT}:role/Admin`,
      accountId: ACCOUNT,
      userName: "Admin",
    },
    attributes: {
      creationDate: "2026-11-18T09:00:00Z",
      mfaAuthenticated: "true",
    },
  },
};

// A bucket made public: S3 lists the bucket in `resources` and names it in the call.
export const S3_PUT_BUCKET_POLICY: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "s3.amazonaws.com",
  eventName: "PutBucketPolicy",
  requestParameters: {
    bucketName: "acme-invoices",
    Host: "acme-invoices.s3.us-east-1.amazonaws.com",
    bucketPolicy: {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicRead",
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: "arn:aws:s3:::acme-invoices/*",
        },
      ],
    },
    policy: "",
  },
  responseElements: null,
  additionalEventData: {
    SignatureVersion: "SigV4",
    AuthenticationMethod: "AuthHeader",
    "x-amz-id-2": "Ex4mpLe=",
  },
  resources: [
    {
      accountId: ACCOUNT,
      type: "AWS::S3::Bucket",
      ARN: "arn:aws:s3:::acme-invoices",
    },
  ],
});

// An object read refused: a data event, with the object and its bucket in `resources`.
export const S3_GET_OBJECT_DENIED: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "s3.amazonaws.com",
  eventName: "GetObject",
  readOnly: true,
  errorCode: "AccessDenied",
  errorMessage: "Access Denied",
  eventCategory: "Data",
  managementEvent: false,
  requestParameters: {
    bucketName: "acme-invoices",
    key: "2026/11/invoice-0042.pdf",
    Host: "acme-invoices.s3.us-east-1.amazonaws.com",
  },
  resources: [
    {
      type: "AWS::S3::Object",
      ARN: "arn:aws:s3:::acme-invoices/2026/11/invoice-0042.pdf",
    },
    {
      accountId: ACCOUNT,
      type: "AWS::S3::Bucket",
      ARN: "arn:aws:s3:::acme-invoices",
    },
  ],
});

// Two instances launched into a subnet and a security group: the instances are in what AWS answered.
export const EC2_RUN_INSTANCES: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "ec2.amazonaws.com",
  eventName: "RunInstances",
  requestParameters: {
    instancesSet: {
      items: [{ imageId: "ami-0abcdef1234567890", minCount: 2, maxCount: 2 }],
    },
    instanceType: "t3.micro",
    subnetId: "subnet-0a1b2c3d4e5f60718",
    groupSet: { items: [{ groupId: "sg-0123456789abcdef0" }] },
    disableApiTermination: false,
  },
  responseElements: {
    requestId: "a1b2c3d4-0000-4000-8000-000000000001",
    reservationId: "r-0123456789abcdef0",
    ownerId: ACCOUNT,
    groupSet: {},
    instancesSet: {
      items: [
        {
          instanceId: "i-0123456789abcdef0",
          imageId: "ami-0abcdef1234567890",
          subnetId: "subnet-0a1b2c3d4e5f60718",
          vpcId: "vpc-0fedcba9876543210",
        },
        {
          instanceId: "i-0fedcba9876543210",
          imageId: "ami-0abcdef1234567890",
          subnetId: "subnet-0a1b2c3d4e5f60718",
          vpcId: "vpc-0fedcba9876543210",
        },
      ],
    },
  },
});

// SSH opened to the internet on a security group.
export const EC2_AUTHORIZE_INGRESS: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "ec2.amazonaws.com",
  eventName: "AuthorizeSecurityGroupIngress",
  requestParameters: {
    groupId: "sg-0123456789abcdef0",
    ipPermissions: {
      items: [
        {
          ipProtocol: "tcp",
          fromPort: 22,
          toPort: 22,
          groups: {},
          ipRanges: { items: [{ cidrIp: "0.0.0.0/0" }] },
          ipv6Ranges: {},
          prefixListIds: {},
        },
      ],
    },
  },
  responseElements: {
    requestId: "a1b2c3d4-0000-4000-8000-000000000002",
    _return: true,
    securityGroupRuleSet: {
      items: [
        {
          groupOwnerId: ACCOUNT,
          groupId: "sg-0123456789abcdef0",
          securityGroupRuleId: "sgr-0123456789abcdef0",
          isEgress: false,
          ipProtocol: "tcp",
          fromPort: 22,
          toPort: 22,
          cidrIpv4: "0.0.0.0/0",
        },
      ],
    },
  },
});

// New code for a function, named by its name: the answer gives its ARN and its role.
export const LAMBDA_UPDATE_CODE: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "lambda.amazonaws.com",
  eventName: "UpdateFunctionCode20150331v2",
  requestParameters: {
    functionName: "Checkout-Handler",
    publish: true,
  },
  responseElements: {
    functionName: "Checkout-Handler",
    functionArn: `arn:aws:lambda:us-east-1:${ACCOUNT}:function:Checkout-Handler:7`,
    runtime: "nodejs20.x",
    role: `arn:aws:iam::${ACCOUNT}:role/checkout-exec`,
    version: "7",
  },
});

// Anyone allowed to invoke a function's alias, from a bucket.
export const LAMBDA_ADD_PERMISSION: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "lambda.amazonaws.com",
  eventName: "AddPermission20150331v2",
  requestParameters: {
    functionName: `arn:aws:lambda:us-east-1:${ACCOUNT}:function:Checkout-Handler:prod`,
    statementId: "s3-invoke",
    action: "lambda:InvokeFunction",
    principal: "s3.amazonaws.com",
    sourceArn: "arn:aws:s3:::acme-uploads",
  },
  responseElements: {
    statement:
      '{"Sid":"s3-invoke","Effect":"Allow","Principal":{"Service":"s3.amazonaws.com"},"Action":"lambda:InvokeFunction"}',
  },
});

// A database made reachable from the internet; RDS keeps its identifier in lower case.
export const RDS_MODIFY_PUBLIC: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "rds.amazonaws.com",
  eventName: "ModifyDBInstance",
  requestParameters: {
    dBInstanceIdentifier: "Orders-DB",
    publiclyAccessible: true,
    vpcSecurityGroupIds: ["sg-0aaaaaaaabbbbbbbb"],
    applyImmediately: true,
  },
  responseElements: {
    dBInstanceIdentifier: "orders-db",
    dBInstanceArn: `arn:aws:rds:us-east-1:${ACCOUNT}:db:orders-db`,
    publiclyAccessible: true,
  },
});

// A queue's policy changed: SQS names it by its URL.
export const SQS_SET_ATTRIBUTES: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "sqs.amazonaws.com",
  eventName: "SetQueueAttributes",
  requestParameters: {
    queueUrl: `https://sqs.us-east-1.amazonaws.com/${ACCOUNT}/orders-queue`,
    attributes: { Policy: '{"Statement":[]}' },
  },
  responseElements: null,
});

// A service redeployed: ECS names its cluster and service by name, and answers with their ARNs.
export const ECS_UPDATE_SERVICE: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "ecs.amazonaws.com",
  eventName: "UpdateService",
  requestParameters: {
    cluster: "prod",
    service: "checkout",
    forceNewDeployment: true,
  },
  responseElements: {
    service: {
      serviceArn: `arn:aws:ecs:us-east-1:${ACCOUNT}:service/prod/checkout`,
      clusterArn: `arn:aws:ecs:us-east-1:${ACCOUNT}:cluster/prod`,
      serviceName: "checkout",
    },
  },
});

// A key scheduled for deletion: KMS lists the key in `resources`, and names it by its id.
export const KMS_SCHEDULE_DELETION: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "kms.amazonaws.com",
  eventName: "ScheduleKeyDeletion",
  requestParameters: {
    keyId: "1234abcd-12ab-34cd-56ef-1234567890ab",
    pendingWindowInDays: 7,
  },
  responseElements: {
    keyId: `arn:aws:kms:us-east-1:${ACCOUNT}:key/1234abcd-12ab-34cd-56ef-1234567890ab`,
    keyState: "PendingDeletion",
  },
  resources: [
    {
      accountId: ACCOUNT,
      type: "AWS::KMS::Key",
      ARN: `arn:aws:kms:us-east-1:${ACCOUNT}:key/1234abcd-12ab-34cd-56ef-1234567890ab`,
    },
  ],
});

// An EKS cluster's API opened to the internet.
export const EKS_UPDATE_CLUSTER_CONFIG: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "eks.amazonaws.com",
  eventName: "UpdateClusterConfig",
  requestParameters: {
    name: "prod-eks",
    resourcesVpcConfig: {
      endpointPublicAccess: true,
      publicAccessCidrs: ["0.0.0.0/0"],
    },
  },
  responseElements: {
    update: {
      id: "a1b2c3d4-0000-4000-8000-000000000003",
      status: "InProgress",
    },
  },
});

// A command run on an instance through Systems Manager: the instance is named by its id.
export const SSM_SEND_COMMAND: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "ssm.amazonaws.com",
  eventName: "SendCommand",
  requestParameters: {
    instanceIds: ["i-0123456789abcdef0"],
    documentName: "AWS-RunShellScript",
  },
  responseElements: null,
});

// A distribution changed: CloudFront calls it `id`, and an origin's id is no distribution.
export const CLOUDFRONT_UPDATE_DISTRIBUTION: JSONObject = cloudTrailRecord({
  userIdentity: ASSUMED_ROLE,
  eventSource: "cloudfront.amazonaws.com",
  eventName: "UpdateDistribution",
  awsRegion: "us-east-1",
  requestParameters: {
    id: "E2QWRUHAPOMQZL",
    distributionConfig: {
      origins: {
        quantity: 1,
        items: [
          { id: "S3-acme-site", domainName: "acme-site.s3.amazonaws.com" },
        ],
      },
    },
  },
  responseElements: null,
});

/*
 * The Azure Activity Log as a diagnostic setting exports it (capitals) - a
 * blob container made public, a part of a storage account.
 */
export function azureContainerWrite(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-11-18T10:00:01.0000000Z",
    resourceId: `/SUBSCRIPTIONS/${SUBSCRIPTION.toUpperCase()}/RESOURCEGROUPS/RG-PROD/PROVIDERS/MICROSOFT.STORAGE/STORAGEACCOUNTS/ACMEINVOICES/BLOBSERVICES/DEFAULT/CONTAINERS/INVOICES`,
    operationName:
      "MICROSOFT.STORAGE/STORAGEACCOUNTS/BLOBSERVICES/CONTAINERS/WRITE",
    category: "Administrative",
    resultType: "Success",
    resultSignature: "Succeeded.OK",
    durationMs: "212",
    callerIpAddress: "203.0.113.7",
    correlationId: "7e6d5c4b-0000-4000-8000-000000000101",
    identity: {
      authorization: {
        scope: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/acmeinvoices/blobServices/default/containers/invoices`,
        action:
          "Microsoft.Storage/storageAccounts/blobServices/containers/write",
      },
      claims: {
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn":
          "alice@contoso.example",
      },
    },
    level: "Information",
    location: "global",
    properties: {
      statusCode: "OK",
      eventCategory: "Administrative",
      entity: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/acmeinvoices/blobServices/default/containers/invoices`,
      message:
        "Microsoft.Storage/storageAccounts/blobServices/containers/write",
    },
    ...overrides,
  };
}

/*
 * The Activity Log as its REST API returns it (a connected subscription's
 * Cloud audit logs) - a role granted on a Key Vault, an extension resource
 * of the vault.
 */
export function azureKeyVaultRoleAssignment(
  overrides: JSONObject = {},
): JSONObject {
  return {
    authorization: {
      action: "Microsoft.Authorization/roleAssignments/write",
      scope: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/kv-payments`,
    },
    caller: "mallory@contoso.example",
    category: { value: "Administrative", localizedValue: "Administrative" },
    correlationId: "8f7e6d5c-0000-4000-8000-000000000102",
    eventDataId: "a0b1c2d3-0000-4000-8000-000000000103",
    eventTimestamp: "2026-11-18T10:02:30.1234567Z",
    httpRequest: { clientIpAddress: "198.51.100.66", method: "PUT" },
    level: "Informational",
    operationName: {
      value: "Microsoft.Authorization/roleAssignments/write",
      localizedValue: "Create role assignment",
    },
    resourceGroupName: "rg-prod",
    resourceProviderName: {
      value: "Microsoft.Authorization",
      localizedValue: "Microsoft.Authorization",
    },
    resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/kv-payments/providers/Microsoft.Authorization/roleAssignments/9f0e1d2c-0000-4000-8000-000000000104`,
    status: { value: "Succeeded", localizedValue: "Succeeded" },
    subStatus: {
      value: "Created",
      localizedValue: "Created (HTTP Status Code: 201)",
    },
    subscriptionId: SUBSCRIPTION,
    ...overrides,
  };
}

// Google Cloud: a VM's startup script changed, filed under the VM.
export const GCP_SET_METADATA: JSONObject = googleAuditEntry(
  "activity",
  {
    serviceName: "compute.googleapis.com",
    methodName: "v1.compute.instances.setMetadata",
    resourceName: "projects/acme-prod/zones/us-central1-a/instances/web-1",
    authorizationInfo: [
      {
        permission: "compute.instances.setMetadata",
        granted: true,
        resourceAttributes: {
          service: "compute",
          name: "projects/acme-prod/zones/us-central1-a/instances/web-1",
          type: "compute.instances",
        },
      },
    ],
    request: { "@type": "type.googleapis.com/compute.instances.setMetadata" },
  },
  {
    resource: {
      type: "gce_instance",
      labels: {
        instance_id: "4567890123456789012",
        project_id: "acme-prod",
        zone: "us-central1-a",
      },
    },
  },
);

// Google Cloud: a bucket's IAM policy changed.
export const GCP_BUCKET_IAM: JSONObject = googleAuditEntry(
  "activity",
  {
    serviceName: "storage.googleapis.com",
    methodName: "storage.setIamPermissions",
    resourceName: "projects/_/buckets/acme-invoices",
    serviceData: {
      "@type": "type.googleapis.com/google.iam.v1.logging.AuditData",
      policyDelta: {
        bindingDeltas: [
          {
            action: "ADD",
            role: "roles/storage.objectViewer",
            member: "allUsers",
          },
        ],
      },
    },
  },
  {
    resource: {
      type: "gcs_bucket",
      labels: {
        bucket_name: "acme-invoices",
        project_id: "acme-prod",
        location: "us",
      },
    },
  },
);

// Google Cloud: a BigQuery table changed, filed under its dataset.
export const GCP_BIGQUERY_TABLE: JSONObject = googleAuditEntry(
  "activity",
  {
    serviceName: "bigquery.googleapis.com",
    methodName: "google.cloud.bigquery.v2.TableService.PatchTable",
    resourceName: "projects/acme-prod/datasets/billing/tables/invoices",
  },
  {
    resource: {
      type: "bigquery_dataset",
      labels: { dataset_id: "billing", project_id: "acme-prod" },
    },
  },
);

// Google Cloud: a Cloud Run service replaced through the Knative API (gcloud run deploy).
export const GCP_CLOUD_RUN_REPLACE: JSONObject = googleAuditEntry(
  "activity",
  {
    serviceName: "run.googleapis.com",
    methodName: "google.cloud.run.v1.Services.ReplaceService",
    resourceName: "namespaces/acme-prod/services/checkout",
  },
  {
    resource: {
      type: "cloud_run_revision",
      labels: {
        project_id: "acme-prod",
        location: "us-central1",
        service_name: "checkout",
        revision_name: "",
        configuration_name: "",
      },
    },
  },
);

// Google Cloud: a secret's policy changed; Secret Manager names its project by number.
export const GCP_SECRET_BY_PROJECT_NUMBER: JSONObject = googleAuditEntry(
  "activity",
  {
    serviceName: "secretmanager.googleapis.com",
    methodName:
      "google.cloud.secretmanager.v1.SecretManagerService.SetIamPolicy",
    resourceName: "projects/123456789012/secrets/db-password",
  },
  {
    resource: {
      type: "audited_resource",
      labels: {
        project_id: "acme-prod",
        service: "secretmanager.googleapis.com",
        method:
          "google.cloud.secretmanager.v1.SecretManagerService.SetIamPolicy",
      },
    },
  },
);

// Google Cloud: a firewall rule opened.
export const GCP_FIREWALL_INSERT: JSONObject = googleAuditEntry(
  "activity",
  {
    serviceName: "compute.googleapis.com",
    methodName: "v1.compute.firewalls.insert",
    resourceName: "projects/acme-prod/global/firewalls/allow-ssh-anywhere",
  },
  {
    resource: {
      type: "gce_firewall_rule",
      labels: {
        project_id: "acme-prod",
        firewall_rule_id: "8012345678901234567",
      },
    },
  },
);

// Google Cloud: a zonal GKE cluster changed through the older API, which names its zone.
export const GCP_GKE_ZONAL_UPDATE: JSONObject = googleAuditEntry(
  "activity",
  {
    serviceName: "container.googleapis.com",
    methodName: "google.container.v1.ClusterManager.UpdateCluster",
    resourceName: "projects/acme-prod/zones/us-central1-a/clusters/prod",
  },
  {
    resource: {
      type: "gke_cluster",
      labels: {
        project_id: "acme-prod",
        location: "us-central1-a",
        cluster_name: "prod",
      },
    },
  },
);
