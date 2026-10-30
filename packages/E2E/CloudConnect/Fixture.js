import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import "Common/UI/Styles/Theme.css";
import CloudConnectPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Connect";
import CloudLayout from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Layout";
import CloudAccountsPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/Accounts";
import CloudAccountViewLayout from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Layout";
import CloudAccountOverviewPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Overview";
import CloudAccountResourcesPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Resources";
import CloudAccountTopologyPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Topology";
import CloudAccountChangesPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Changes";
import CloudAccountSettingsPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Settings";
import CloudAccountDeletePage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Delete";
import CloudAccountAiAgentPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/AI/Agent";
import CloudAccountAiLogsPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/AI/Logs";
import CloudAccountFeedPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Feed";
import CloudResourceViewLayout from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Layout";
import CloudResourceOverviewPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Overview";
import CloudResourceIncidentsPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Incidents";
import CloudResourceAlertsPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Alerts";
import CloudResourceChangesPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Changes";
import PageMap from "../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudAccountFeed from "Common/Models/DatabaseModels/CloudAccountFeed";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { setPageLanguage } from "Common/UI/Utils/PageLanguage";

/*
 * The fixture page: the real Cloud > Connect page in the real Cloud layout
 * (its side menu, breadcrumbs and widths), at its own address
 * (/dashboard/<project>/cloud/connect), with the API answered from an
 * in-page store (window.__cloudConnectFixture) the specs read - every
 * connection saved or changed, every test and read-now request - and
 * drive - what a test answers next. An address the page links to that is
 * not modelled draws its path.
 *
 *   ?state=     empty (default: nothing connected)
 *               | connected (an AWS account that works, an Azure
 *               subscription that does not, a Google Cloud project that is
 *               turned off)
 *               | new (an Azure subscription just connected, waiting for
 *               its first read)
 *   ?role=      owner (default) | member
 *   ?aws=       role (default: this OneUptime can sign in to an AWS role)
 *               | key (it cannot: AWS connects with an access key)
 *   ?verdict=   pass (default) | warn | auth | slow
 *   ?cloud=     aws | azure | gcp (the page opens that cloud's form)
 *   ?theme=dark   ?lang=ja|de|fa
 *
 * Cloud > Accounts and one account's pages are drawn too
 * (/dashboard/<project>/cloud/accounts[/<account>[/resources|topology|
 * changes|settings|delete]]): with ?state=connected, the AWS account the
 * AWS connection reads (being read), the Azure subscription of the
 * connection that is not working (not read lately) and a Google Cloud
 * project no connection reads any more, each with what it holds. The AWS
 * account's resources - a load balancer in front of two machines in one
 * network, a database and its queues in another Region, a function that
 * stopped reporting - are its Resources and its map, each with its own
 * page (/dashboard/<project>/cloud/<resource>[/incidents|alerts|changes]):
 * what its inventory lists, the incident and the alert linked to it, and
 * what the account's activity log and AWS Health recorded
 * (AnalyticsModelAPI, ChangeEvent).
 *
 * What OneUptime AI may do on an account: the AI agent card on its
 * Overview, Let AI fix problems (its one question, the command for the
 * cloud's own shell and More fields), and the account's AI pages
 * (/dashboard/<project>/cloud/accounts/<account>/ai/agent|logs), answered
 * from POST /resource-ai-access/status, /test, /reset-agent and /logs as
 * the server answers them:
 *
 *   ?ai=        none (default: OneUptime AI reads the account, no Cloud AI
 *               agent connected)
 *               | connected (the AWS account's agent is online and asks
 *               for approval)
 *               | offline (it connected once and stopped reporting)
 *               | fail (every status read fails)
 *
 * window.__cloudConnectFixture.connectAgent() makes the agent connect, as
 * it does a few minutes after the setup command finished. The page says
 * which language it is in and which way it reads, as production's
 * followLanguageForPage does: Persian is laid out right to left.
 */

const params = new URLSearchParams(window.location.search);
const role = params.get("role") || "owner";
const dataState = params.get("state") || "empty";
const awsWay = params.get("aws") || "role";
const aiState = ["connected", "offline", "fail"].includes(params.get("ai"))
  ? params.get("ai")
  : "none";
const language = ["ja", "de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    ja: { translation: JA },
    de: { translation: DE },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
setPageLanguage(language);

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

const project = new Project();
project._id = PROJECT_ID;
project.name = "SYSNETIX DEMO";
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
UserUtil.getUserId = () => {
  return new ObjectID("10000000-0000-4000-8000-000000000002");
};
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
};

const ROLES = {
  owner: [Permission.ProjectOwner],
  member: [Permission.ProjectMember],
};
const granted = ROLES[role] || ROLES.owner;

PermissionUtil.getAllPermissions = () => {
  return granted;
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: granted.map((permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

function connection(id, fields) {
  const item = new CloudConnection();
  Object.assign(item, {
    _id: id,
    projectId: new ObjectID(PROJECT_ID),
    isEnabled: true,
    createdAt: new Date("2026-10-20T08:00:00.000Z"),
    ...fields,
  });
  return item;
}

// Just connected: no read yet, nothing failed.
const NEW_CONNECTIONS = [
  connection("20000000-0000-4000-8000-000000000004", {
    name: "Microsoft Azure",
    provider: "azure",
    config: {
      authMethod: "azure-client-secret",
      tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
      clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      cloud: "public",
      readIntervalInMinutes: "5",
    },
  }),
];

const connections =
  dataState === "empty"
    ? []
    : dataState === "new"
      ? NEW_CONNECTIONS
      : [
          connection("20000000-0000-4000-8000-000000000001", {
            name: "AWS 123456789012",
            provider: "aws",
            config: {
              authMethod: "aws-role",
              roleArn:
                "arn:aws:iam::123456789012:role/OneUptimeReadOnly-5f3a9c1e",
              readIntervalInMinutes: "10",
            },
            lastPulledAt: new Date("2026-10-21T09:50:00.000Z"),
            lastSuccessfulPullAt: new Date("2026-10-21T09:50:00.000Z"),
            lastPullResult: {
              status: "success",
              accounts: ["123456789012"],
              resourceCount: 46,
              resourceTypes: [
                { type: "AWS::EC2::Instance", count: 24 },
                { type: "AWS::RDS::DBInstance", count: 9 },
                { type: "AWS::Lambda::Function", count: 7 },
                { type: "AWS::ElasticLoadBalancingV2::LoadBalancer", count: 4 },
                { type: "AWS::S3::Bucket", count: 2 },
              ],
              regions: [
                { region: "us-east-1", count: 31 },
                { region: "eu-west-1", count: 15 },
              ],
              newResources: 0,
              archivedResources: 0,
              pointsWritten: 1840,
              changesRecorded: 12,
              requestCount: 64,
              warnings: [],
              durationMs: 5400,
              finishedAt: "2026-10-21T09:50:05.000Z",
            },
          }),
          connection("20000000-0000-4000-8000-000000000002", {
            name: "Contoso production",
            provider: "azure",
            config: {
              authMethod: "azure-client-secret",
              tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
              clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
              cloud: "public",
              readIntervalInMinutes: "5",
            },
            lastPulledAt: new Date("2026-10-21T09:55:00.000Z"),
            lastError:
              "Azure Resource Manager request failed with HTTP 403: The client '00001111-aaaa-2222-bbbb-3333cccc4444' does not have authorization to perform action 'Microsoft.Insights/metrics/read'.",
            lastPullResult: {
              status: "failed",
              failureKind: "permission",
              accounts: [],
              resourceCount: 0,
              resourceTypes: [],
              regions: [],
              newResources: 0,
              archivedResources: 0,
              pointsWritten: 0,
              requestCount: 2,
              warnings: [],
              durationMs: 400,
              finishedAt: "2026-10-21T09:55:01.000Z",
            },
          }),
          connection("20000000-0000-4000-8000-000000000003", {
            name: "Google Cloud acme-prod",
            provider: "gcp",
            isEnabled: false,
            config: {
              authMethod: "gcp-service-account-key",
              clientEmail:
                "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
              keyProjectId: "acme-prod",
              readIntervalInMinutes: "60",
            },
            lastPulledAt: new Date("2026-10-19T12:00:00.000Z"),
            lastSuccessfulPullAt: new Date("2026-10-19T12:00:00.000Z"),
            lastPullResult: {
              status: "success",
              accounts: ["acme-prod"],
              resourceCount: 3,
              resourceTypes: [{ type: "gce_instance", count: 3 }],
              regions: [{ region: "europe-west1", count: 3 }],
              newResources: 0,
              archivedResources: 0,
              pointsWritten: 90,
              requestCount: 13,
              warnings: [],
              durationMs: 900,
              finishedAt: "2026-10-19T12:00:01.000Z",
            },
          }),
        ];

/*
 * The accounts the connections read. One now for every time the fixture
 * stamps, so "read 4 minutes ago" never crosses the hour the status pill
 * turns at while a test runs.
 */
const NOW = Date.now();
const MINUTE = 60 * 1000;

function account(id, fields) {
  const item = new CloudAccount();
  Object.assign(item, {
    _id: id,
    projectId: new ObjectID(PROJECT_ID),
    createdAt: new Date("2026-10-20T08:00:00.000Z"),
    labels: [],
    isAiInvestigationEnabled: true,
    isAiLogReadEnabled: false,
    // The agent's setup command sets the mode once it connects.
    aiRemediationMode: aiState === "none" ? "Disabled" : "RequireApproval",
    aiCommandAllowlist: [],
    ...fields,
  });
  return item;
}

function readingConnection(id, name) {
  return Object.assign(new CloudConnection(), { _id: id, name: name });
}

const AWS_ACCOUNT_ID = "30000000-0000-4000-8000-000000000001";
const AZURE_ACCOUNT_ID = "30000000-0000-4000-8000-000000000002";
const GCP_ACCOUNT_ID = "30000000-0000-4000-8000-000000000003";

const accounts =
  dataState === "connected"
    ? [
        account(AWS_ACCOUNT_ID, {
          name: "Production",
          description: "Checkout, orders and the storefront.",
          provider: "aws",
          accountId: "123456789012",
          providerAccountName: "acme-production",
          cloudConnectionId: new ObjectID(
            "20000000-0000-4000-8000-000000000001",
          ),
          cloudConnection: readingConnection(
            "20000000-0000-4000-8000-000000000001",
            "AWS 123456789012",
          ),
          resourceCount: 46,
          regionCount: 2,
          resourceSummary: {
            resourceCount: 46,
            types: [
              { type: "AWS::EC2::Instance", count: 24 },
              { type: "AWS::RDS::DBInstance", count: 9 },
              { type: "AWS::Lambda::Function", count: 7 },
              { type: "AWS::ElasticLoadBalancingV2::LoadBalancer", count: 4 },
              { type: "AWS::S3::Bucket", count: 2 },
            ],
            regions: [
              { region: "us-east-1", count: 31 },
              { region: "eu-west-1", count: 15 },
            ],
          },
          lastSeenAt: new Date(NOW - 4 * MINUTE),
          inventoryListedAt: new Date(NOW - 22 * MINUTE),
        }),
        account(AZURE_ACCOUNT_ID, {
          name: "Contoso production",
          provider: "azure",
          accountId: "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
          providerAccountName: "Contoso production",
          cloudConnectionId: new ObjectID(
            "20000000-0000-4000-8000-000000000002",
          ),
          cloudConnection: readingConnection(
            "20000000-0000-4000-8000-000000000002",
            "Contoso production",
          ),
          resourceCount: 37,
          regionCount: 2,
          resourceSummary: {
            resourceCount: 37,
            types: [
              { type: "Microsoft.Compute/virtualMachines", count: 18 },
              { type: "Microsoft.Sql/servers/databases", count: 6 },
            ],
            regions: [
              { region: "westeurope", count: 29 },
              { region: "northeurope", count: 8 },
            ],
          },
          lastSeenAt: new Date(NOW - 26 * 60 * MINUTE),
          inventoryListedAt: new Date(NOW - 26 * 60 * MINUTE),
        }),
        account(GCP_ACCOUNT_ID, {
          name: "acme-legacy",
          provider: "gcp",
          accountId: "acme-legacy",
          resourceCount: 3,
          regionCount: 1,
          resourceSummary: {
            resourceCount: 3,
            types: [{ type: "gce_instance", count: 3 }],
            regions: [{ region: "europe-west1", count: 3 }],
          },
          lastSeenAt: new Date("2026-10-19T12:00:00.000Z"),
        }),
      ]
    : [];

function cloudResource(id, fields) {
  return Object.assign(new CloudResource(), {
    _id: id,
    projectId: new ObjectID(PROJECT_ID),
    cloudProvider: "aws",
    cloudAccountId: "123456789012",
    isArchived: false,
    labels: [],
    ...fields,
  });
}

const SUBNET_A = "subnet-0d5f1a2b3c4d5e6f7";
const SUBNET_B = "subnet-0e6a2b3c4d5e6f708";
const WEB_SECURITY_GROUP = "sg-0f1e2d3c4b5a69788";
const DB_SECURITY_GROUP = "sg-0c4d5e6f7a8b9c0d1";
const VPC_ID = "vpc-0a1b2c3d4e5f60718";

const WEB_ALB_ID = "40000000-0000-4000-8000-000000000001";
const ORDERS_DB_ID = "40000000-0000-4000-8000-000000000002";
const NIGHTLY_EXPORT_ID = "40000000-0000-4000-8000-000000000003";
const WEB_1_ID = "40000000-0000-4000-8000-000000000004";
const WEB_2_ID = "40000000-0000-4000-8000-000000000005";
const VPC_ROW_ID = "40000000-0000-4000-8000-000000000006";
const ORDERS_QUEUE_ID = "40000000-0000-4000-8000-000000000007";
const ORDERS_DLQ_ID = "40000000-0000-4000-8000-000000000008";

// A machine behind the load balancer, in its network and security group.
function webInstance(id, name, instanceId, ip, subnet) {
  return cloudResource(id, {
    name: name,
    cloudResourceKind: "resource",
    cloudResourceType: "AWS::EC2::Instance",
    providerResourceId: instanceId,
    cloudRegion: "us-east-1",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW - 3 * MINUTE),
    inventoriedAt: new Date(NOW - 22 * MINUTE),
    cloudRelationships: [
      { kind: "runs-in", target: subnet, targetType: "AWS::EC2::Subnet" },
      { kind: "runs-in", target: VPC_ID, targetType: "AWS::EC2::VPC" },
      {
        kind: "protected-by",
        target: WEB_SECURITY_GROUP,
        targetType: "AWS::EC2::SecurityGroup",
      },
    ],
    cloudEndpoints: [`ip-${ip.split(".").join("-")}.ec2.internal`, ip],
    cloudTags: { Name: name, env: "production", team: "storefront" },
    cloudProperties: {
      InstanceType: "t3.large",
      State: { Name: "running" },
      AvailabilityZone: subnet === SUBNET_A ? "us-east-1a" : "us-east-1b",
      ImageId: "ami-0c55b159cbfafe1f0",
      VpcId: VPC_ID,
      SubnetId: subnet,
      PrivateIpAddress: ip,
      SecurityGroupIds: [WEB_SECURITY_GROUP],
    },
  });
}

/*
 * The AWS account's resources, as its Resources page lists them, its
 * Topology draws them and a resource's Overview names its neighbours: a
 * load balancer in front of two machines in one network, a database and
 * its queues in another Region, and a function that stopped reporting.
 */
const AWS_RESOURCES = [
  cloudResource(WEB_ALB_ID, {
    name: "web-alb",
    cloudResourceKind: "resource",
    cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    providerResourceId:
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web-alb/50dc6c495c0c9188",
    cloudRegion: "us-east-1",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW - 3 * MINUTE),
    inventoriedAt: new Date(NOW - 22 * MINUTE),
    description: "The storefront's public entry point.",
    cloudRelationships: [
      { kind: "runs-in", target: SUBNET_A, targetType: "AWS::EC2::Subnet" },
      { kind: "runs-in", target: SUBNET_B, targetType: "AWS::EC2::Subnet" },
      {
        kind: "protected-by",
        target: WEB_SECURITY_GROUP,
        targetType: "AWS::EC2::SecurityGroup",
      },
      {
        kind: "routes-to",
        target: "i-0a1b2c3d4e5f60001",
        targetType: "AWS::EC2::Instance",
      },
      {
        kind: "routes-to",
        target: "i-0a1b2c3d4e5f60002",
        targetType: "AWS::EC2::Instance",
      },
    ],
    cloudEndpoints: ["web-alb-1234567890.us-east-1.elb.amazonaws.com"],
    cloudTags: {
      env: "production",
      team: "storefront",
      "aws:cloudformation:stack-name": "storefront-prod",
    },
    cloudProperties: {
      Type: "application",
      Scheme: "internet-facing",
      DNSName: "web-alb-1234567890.us-east-1.elb.amazonaws.com",
      IpAddressType: "ipv4",
      LoadBalancerName: "web-alb",
      SecurityGroups: [WEB_SECURITY_GROUP],
      Subnets: [SUBNET_A, SUBNET_B],
    },
  }),
  cloudResource(ORDERS_DB_ID, {
    name: "orders-db",
    cloudResourceKind: "resource",
    cloudResourceType: "AWS::RDS::DBInstance",
    providerResourceId: "orders-db",
    cloudRegion: "eu-west-1",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW - 3 * MINUTE),
    inventoriedAt: new Date(NOW - 22 * MINUTE),
    cloudRelationships: [
      {
        kind: "protected-by",
        target: DB_SECURITY_GROUP,
        targetType: "AWS::EC2::SecurityGroup",
      },
    ],
    cloudEndpoints: ["orders-db.c9akciq32xyz.eu-west-1.rds.amazonaws.com"],
    cloudTags: { env: "production", team: "orders" },
    cloudProperties: {
      DBInstanceClass: "db.r6g.large",
      Engine: "postgres",
      EngineVersion: "15.4",
      MultiAZ: true,
      AllocatedStorage: 200,
      StorageEncrypted: true,
      Endpoint: {
        Address: "orders-db.c9akciq32xyz.eu-west-1.rds.amazonaws.com",
        Port: 5432,
      },
    },
  }),
  cloudResource(NIGHTLY_EXPORT_ID, {
    name: "nightly-export",
    cloudResourceKind: "resource",
    cloudResourceType: "AWS::Lambda::Function",
    providerResourceId: "nightly-export",
    cloudRegion: "us-east-1",
    otelCollectorStatus: "disconnected",
    lastSeenAt: new Date(NOW - 3 * 24 * 60 * MINUTE),
    inventoriedAt: new Date(NOW - 3 * 24 * 60 * MINUTE),
    cloudTags: {},
    cloudProperties: {
      Runtime: "nodejs20.x",
      MemorySize: 1024,
      Timeout: 900,
      Handler: "index.handler",
      Architectures: ["arm64"],
    },
  }),
  webInstance(WEB_1_ID, "web-1", "i-0a1b2c3d4e5f60001", "10.0.1.23", SUBNET_A),
  webInstance(WEB_2_ID, "web-2", "i-0a1b2c3d4e5f60002", "10.0.2.41", SUBNET_B),
  cloudResource(VPC_ROW_ID, {
    name: "prod-vpc",
    cloudResourceKind: "resource",
    cloudResourceType: "AWS::EC2::VPC",
    providerResourceId: VPC_ID,
    cloudRegion: "us-east-1",
    otelCollectorStatus: "disconnected",
    lastSeenAt: new Date(NOW - 22 * MINUTE),
    inventoriedAt: new Date(NOW - 22 * MINUTE),
    cloudTags: { Name: "prod-vpc" },
    cloudProperties: { CidrBlock: "10.0.0.0/16", InstanceTenancy: "default" },
  }),
  cloudResource(ORDERS_QUEUE_ID, {
    name: "orders-queue",
    cloudResourceKind: "resource",
    cloudResourceType: "AWS::SQS::Queue",
    providerResourceId:
      "https://sqs.eu-west-1.amazonaws.com/123456789012/orders-queue",
    cloudRegion: "eu-west-1",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW - 3 * MINUTE),
    inventoriedAt: new Date(NOW - 22 * MINUTE),
    cloudRelationships: [
      {
        kind: "dead-letters-to",
        target: "arn:aws:sqs:eu-west-1:123456789012:orders-dlq",
        targetType: "AWS::SQS::Queue",
      },
    ],
    cloudTags: { team: "orders" },
    cloudProperties: {
      Arn: "arn:aws:sqs:eu-west-1:123456789012:orders-queue",
      VisibilityTimeout: 30,
      MessageRetentionPeriod: 345600,
    },
  }),
  cloudResource(ORDERS_DLQ_ID, {
    name: "orders-dlq",
    cloudResourceKind: "resource",
    cloudResourceType: "AWS::SQS::Queue",
    providerResourceId: "arn:aws:sqs:eu-west-1:123456789012:orders-dlq",
    cloudRegion: "eu-west-1",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW - 3 * MINUTE),
    inventoriedAt: new Date(NOW - 22 * MINUTE),
    cloudTags: { team: "orders" },
    cloudProperties: {
      Arn: "arn:aws:sqs:eu-west-1:123456789012:orders-dlq",
      MessageRetentionPeriod: 1209600,
    },
  }),
];

/*
 * Open incidents and alerts, linked to the resources they are about the
 * way a monitor links them, with the states a list counts as open.
 */
const INCIDENT_STATES = [
  Object.assign(new IncidentState(), {
    _id: "50000000-0000-4000-8000-000000000001",
    name: "Identified",
    color: new Color("#ef4444"),
    order: 1,
    isResolvedState: false,
  }),
  Object.assign(new IncidentState(), {
    _id: "50000000-0000-4000-8000-000000000002",
    name: "Resolved",
    color: new Color("#10b981"),
    order: 2,
    isResolvedState: true,
  }),
];
const ALERT_STATES = [
  Object.assign(new AlertState(), {
    _id: "51000000-0000-4000-8000-000000000001",
    name: "Created",
    color: new Color("#ef4444"),
    order: 1,
    isResolvedState: false,
  }),
  Object.assign(new AlertState(), {
    _id: "51000000-0000-4000-8000-000000000002",
    name: "Resolved",
    color: new Color("#10b981"),
    order: 2,
    isResolvedState: true,
  }),
];

function linkedResource(id) {
  const found = AWS_RESOURCES.find((item) => {
    return item._id === id;
  });
  return Object.assign(new CloudResource(), {
    _id: id,
    name: found ? found.name : "",
    projectId: new ObjectID(PROJECT_ID),
  });
}

const INCIDENTS =
  dataState === "connected"
    ? [
        Object.assign(new Incident(), {
          _id: "60000000-0000-4000-8000-000000000001",
          projectId: new ObjectID(PROJECT_ID),
          incidentNumber: 42,
          incidentNumberWithPrefix: "#42",
          title: "Checkout pages answer slowly",
          declaredAt: new Date(NOW - 18 * MINUTE),
          createdAt: new Date(NOW - 18 * MINUTE),
          currentIncidentStateId: INCIDENT_STATES[0]._id,
          currentIncidentState: INCIDENT_STATES[0],
          incidentSeverity: Object.assign(new IncidentSeverity(), {
            _id: "52000000-0000-4000-8000-000000000001",
            name: "Critical",
            color: new Color("#ef4444"),
          }),
          cloudResources: [linkedResource(WEB_ALB_ID)],
          monitors: [],
          labels: [],
        }),
      ]
    : [];

const ALERTS =
  dataState === "connected"
    ? [
        Object.assign(new Alert(), {
          _id: "61000000-0000-4000-8000-000000000001",
          projectId: new ObjectID(PROJECT_ID),
          alertNumber: 17,
          alertNumberWithPrefix: "#17",
          title: "orders-db CPU above 90%",
          createdAt: new Date(NOW - 9 * MINUTE),
          currentAlertStateId: ALERT_STATES[0]._id,
          currentAlertState: ALERT_STATES[0],
          alertSeverity: Object.assign(new AlertSeverity(), {
            _id: "53000000-0000-4000-8000-000000000001",
            name: "Warning",
            color: new Color("#f59e0b"),
          }),
          cloudResources: [linkedResource(ORDERS_DB_ID)],
          monitor: undefined,
          labels: [],
        }),
      ]
    : [];

/*
 * What the AWS account's activity log recorded and AWS Health published,
 * as the cloud connection writes them (CloudChangeRecorder): each tied to
 * the account's row, and to the resource it changed when the connection
 * holds it.
 */
function cloudChange(minutesAgo, fields, attributes) {
  return Object.assign(new ChangeEvent(), {
    _id: `70000000-0000-4000-8000-0000000000${String(minutesAgo).padStart(2, "0")}`,
    projectId: new ObjectID(PROJECT_ID),
    time: new Date(NOW - minutesAgo * MINUTE),
    ...fields,
    attributes: {
      "oneuptime.change.source": "cloud",
      "cloud.provider": "aws",
      "cloud.account.id": "123456789012",
      "oneuptime.cloud_account.id": AWS_ACCOUNT_ID,
      ...attributes,
    },
  });
}

// CloudTrail names who did it by its user name: an IAM user, a role's session.
const MAYA = "maya.lopez";
const DEPLOY_ROLE = "GitHubActions";

const CHANGES =
  dataState === "connected"
    ? [
        cloudChange(
          12,
          {
            eventType: "config-change",
            title: `AuthorizeSecurityGroupIngress on ${WEB_SECURITY_GROUP}`,
            description: `${MAYA} ran AuthorizeSecurityGroupIngress in account 123456789012 (us-east-1), on ${WEB_SECURITY_GROUP}.`,
          },
          {
            "oneuptime.change.status": "succeeded",
            "cloud.region": "us-east-1",
            "oneuptime.cloud.actor": MAYA,
            "oneuptime.cloud.operation": "AuthorizeSecurityGroupIngress",
          },
        ),
        cloudChange(
          25,
          {
            eventType: "deployment",
            title: "UpdateFunctionCode20150331v2 on nightly-export",
            description: `${DEPLOY_ROLE} ran UpdateFunctionCode20150331v2 in account 123456789012 (us-east-1), on nightly-export.`,
          },
          {
            "oneuptime.change.status": "succeeded",
            "cloud.region": "us-east-1",
            "oneuptime.cloud.actor": DEPLOY_ROLE,
            "oneuptime.cloud.operation": "UpdateFunctionCode20150331v2",
            "oneuptime.resource.type": "CloudResource",
            "oneuptime.resource.id": NIGHTLY_EXPORT_ID,
          },
        ),
        cloudChange(
          40,
          {
            eventType: "scaling",
            title: "ModifyDBInstance on orders-db",
            description: `${MAYA} ran ModifyDBInstance in account 123456789012 (eu-west-1), on orders-db.`,
          },
          {
            "oneuptime.change.status": "succeeded",
            "cloud.region": "eu-west-1",
            "oneuptime.cloud.actor": MAYA,
            "oneuptime.cloud.operation": "ModifyDBInstance",
            "oneuptime.resource.type": "CloudResource",
            "oneuptime.resource.id": ORDERS_DB_ID,
          },
        ),
        cloudChange(
          55,
          {
            eventType: "config-change",
            title: "Failed: DeleteLoadBalancer on web-alb",
            description: `${MAYA} tried to run DeleteLoadBalancer in account 123456789012 (us-east-1), on arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web-alb/50dc6c495c0c9188.`,
          },
          {
            "oneuptime.change.status": "failed",
            "cloud.region": "us-east-1",
            "oneuptime.cloud.actor": MAYA,
            "oneuptime.cloud.operation": "DeleteLoadBalancer",
            "oneuptime.resource.type": "CloudResource",
            "oneuptime.resource.id": WEB_ALB_ID,
          },
        ),
        cloudChange(
          75,
          {
            eventType: "provider-event",
            title: "AWS Health: EC2 operational issue (open)",
            description:
              "We are investigating increased API error rates for the RunInstances API in the US-EAST-1 Region. Existing instances are not affected.",
          },
          {
            "oneuptime.change.source": "cloud-health",
            "cloud.region": "us-east-1",
            "oneuptime.cloud.operation": "AWS_EC2_OPERATIONAL_ISSUE",
          },
        ),
        cloudChange(
          95,
          {
            eventType: "config-change",
            title: "ModifyLoadBalancerAttributes on web-alb",
            description: `${DEPLOY_ROLE} ran ModifyLoadBalancerAttributes in account 123456789012 (us-east-1), on arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web-alb/50dc6c495c0c9188.`,
          },
          {
            "oneuptime.change.status": "succeeded",
            "cloud.region": "us-east-1",
            "oneuptime.cloud.actor": DEPLOY_ROLE,
            "oneuptime.cloud.operation": "ModifyLoadBalancerAttributes",
            "oneuptime.resource.type": "CloudResource",
            "oneuptime.resource.id": WEB_ALB_ID,
          },
        ),
      ]
    : [];

/*
 * Whether a row matches a list's query, as far as these lists ask: each
 * field equal, an Includes any of its values, an attributes map each of
 * its keys. A relation (cloudResources) matches by the ids it holds.
 */
function idsOf(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      return String(entry && entry._id ? entry._id : entry);
    });
  }
  if (value && typeof value === "object" && value._id) {
    return [String(value._id)];
  }
  return value === undefined || value === null ? [] : [String(value)];
}

function rowMatches(row, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    if (wanted instanceof Includes) {
      const allowed = wanted.values.map(String);
      if (
        !idsOf(row[field]).some((entry) => {
          return allowed.includes(entry);
        })
      ) {
        return false;
      }
      continue;
    }
    if (field === "attributes" && wanted && typeof wanted === "object") {
      for (const [key, value] of Object.entries(wanted)) {
        if (typeof value !== "string") {
          continue;
        }
        if (String((row.attributes || {})[key] || "") !== value) {
          return false;
        }
      }
      continue;
    }
    if (
      typeof wanted === "string" ||
      typeof wanted === "number" ||
      typeof wanted === "boolean"
    ) {
      if (String(row[field] ?? "") !== String(wanted)) {
        return false;
      }
    }
  }
  return true;
}

// A query's value as the list sent it: an Includes' values, or the value.
function plainValues(value) {
  if (value && typeof value === "object" && Array.isArray(value.values)) {
    return value.values.map(String);
  }
  if (value && typeof value === "object" && Array.isArray(value.value)) {
    return value.value.map(String);
  }
  return value === undefined || value === null ? [] : [String(value)];
}

const state = {
  // What each list read asked for, by model.
  listRequests: [],
  // Every connection a form created, as the model it sent.
  creates: [],
  // Every update: the id and the data.
  updates: [],
  deletes: [],
  // Every test request body, and every read-now path.
  tests: [],
  readNows: [],
  // How often the page asked for one connection: a read it watches.
  itemAsks: 0,
  roleSetupAsks: 0,
  verdict: params.get("verdict") || "pass",
  held: [],
};

/*
 * What a test answers, for the cloud it tests - the form's own cloud, or a
 * saved connection's - as the server answers: what it found reads in that
 * cloud's words.
 */
const FOUND = {
  aws: {
    accounts: ["123456789012"],
    resourceCount: 46,
    resourceTypes: [
      { type: "AWS::EC2::Instance", count: 24 },
      { type: "AWS::RDS::DBInstance", count: 9 },
      { type: "AWS::Lambda::Function", count: 7 },
      { type: "AWS::ElasticLoadBalancingV2::LoadBalancer", count: 4 },
      { type: "AWS::S3::Bucket", count: 2 },
    ],
    regions: [
      { region: "us-east-1", count: 31 },
      { region: "eu-west-1", count: 15 },
    ],
  },
  azure: {
    accounts: ["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"],
    resourceCount: 37,
    resourceTypes: [
      { type: "Microsoft.Compute/virtualMachines", count: 18 },
      { type: "Microsoft.Sql/servers/databases", count: 6 },
      { type: "Microsoft.Web/sites", count: 5 },
      { type: "Microsoft.Storage/storageAccounts", count: 4 },
      { type: "Microsoft.Network/loadBalancers", count: 2 },
      { type: "Microsoft.Cache/Redis", count: 2 },
    ],
    regions: [
      { region: "westeurope", count: 29 },
      { region: "northeurope", count: 8 },
    ],
  },
  gcp: {
    accounts: ["acme-prod"],
    resourceCount: 12,
    resourceTypes: [
      { type: "gce_instance", count: 8 },
      { type: "cloudsql_database", count: 3 },
      { type: "cloud_run_revision", count: 1 },
    ],
    regions: [{ region: "europe-west1", count: 12 }],
  },
};

// What each cloud says when it refuses a key.
const REFUSED = {
  aws: "The security token included in the request is invalid.",
  azure:
    "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID.",
  gcp: "invalid_grant: Invalid JWT Signature.",
};

function verdict(name, provider) {
  const cloud = FOUND[provider] ? provider : "azure";

  if (name === "warn") {
    return {
      provider: cloud,
      status: "warn",
      message: "Signed in; nothing reports metrics yet.",
      accounts: FOUND[cloud].accounts,
      resourceCount: 0,
      resourceTypes: [],
      regions: [],
      durationMs: 700,
    };
  }

  if (name === "auth") {
    return {
      provider: cloud,
      status: "fail",
      message: REFUSED[cloud],
      failureKind: "authentication",
      durationMs: 300,
    };
  }

  return {
    provider: cloud,
    status: "pass",
    message: "Signed in and counted what there is to monitor.",
    ...FOUND[cloud],
    isSample: true,
    durationMs: 1300,
  };
}

// The cloud a test is for: the form's, or the saved connection's.
function providerOf(body) {
  if (body && body.provider) {
    return body.provider;
  }

  const saved = connections.find((item) => {
    return Boolean(body) && item.id.toString() === String(body.connectionId);
  });

  return saved ? saved.provider : "azure";
}

function answer(name, provider) {
  return new HTTPResponse(200, verdict(name, provider), {});
}

/*
 * ---------------------------------------------------------------------------
 * OneUptime AI on an account: its access status, Test connection, Reset
 * agent and AI Logs, as ResourceAiAccessService and ResourceAiAccessAPI
 * answer them for a cloud account - read live through its read-only
 * connection without an agent, so an agent's gaps block only its fixes.
 * ---------------------------------------------------------------------------
 */
const AI_RESOURCE_TYPES = {
  aws: "AwsAccount",
  azure: "AzureSubscription",
  gcp: "GoogleCloudProject",
};
const AI_NOUNS = {
  AwsAccount: "AWS account",
  AzureSubscription: "Azure subscription",
  GoogleCloudProject: "Google Cloud project",
};
const AI_AGENT_ID = "50000000-0000-4000-8000-000000000001";
// The changes the AWS agent's setup command turned on (every one of them).
const AWS_OPERATIONS = [
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
];

state.ai = aiState;
state.aiPosts = [];

function accountOf(resourceId) {
  return accounts.find((item) => {
    return item._id === String(resourceId);
  });
}

function aiAgentSummary(found, type, isOnline) {
  return {
    agentId: AI_AGENT_ID,
    connectionStatus: "connected",
    isOnline: isOnline,
    agentVersion: "1.0.0",
    lastAliveAt: new Date(
      isOnline ? NOW - 20 * 1000 : NOW - 3 * 60 * MINUTE,
    ).toISOString(),
    lastRegisteredAt: new Date(NOW - 2 * 24 * 60 * MINUTE).toISOString(),
    posture: {
      resourceType: type,
      resourceIdentifier: found.accountId,
      agentVersion: "1.0.0",
      allowWrites: true,
      writeTargets: [],
      protectedTargets: [],
      toolVersion: "AWS",
      reachable: true,
      details: {
        cloudProvider: found.provider,
        cloudAccountId: found.accountId,
        enabledOperations: AWS_OPERATIONS.join(","),
        requiredTag: null,
        awsWriteRoleArn: `arn:aws:iam::${found.accountId}:role/OneUptimeCloudAiAgentWrite`,
        awsPrincipalArn: `arn:aws:sts::${found.accountId}:assumed-role/OneUptimeCloudAiAgent/agent`,
        awsRegion: "us-east-1",
      },
      aiSettings: {
        investigation: true,
        fixes: "RequireApproval",
        isConfigured: true,
      },
    },
  };
}

function aiStatus(resourceId) {
  const found = accountOf(resourceId) || accounts[0];
  const type = AI_RESOURCE_TYPES[found ? found.provider : "aws"];
  const noun = AI_NOUNS[type];
  const page = `the ${noun}'s AI agent page (AI → AI agent)`;
  const status = {
    resourceType: type,
    resourceId: String(resourceId),
    resourceName: found ? found.name : "",
    isAiInvestigationEnabled: true,
    aiRemediationMode: "Disabled",
    aiSettingsSource: "oneuptime",
    aiCommandAllowlist: [],
    agent: null,
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: false,
  };

  if (state.ai === "connected" && found) {
    return {
      ...status,
      aiRemediationMode: "RequireApproval",
      aiSettingsSource: "agent_configuration",
      aiAccessConfiguredAt: new Date(NOW - 2 * 24 * 60 * MINUTE).toISOString(),
      aiAccessLastVerifiedAt: new Date(NOW - 5 * MINUTE).toISOString(),
      agent: aiAgentSummary(found, type, true),
      isRemediationReady: true,
    };
  }

  if (state.ai === "offline" && found) {
    return {
      ...status,
      aiRemediationMode: "RequireApproval",
      aiSettingsSource: "agent_configuration",
      agent: aiAgentSummary(found, type, false),
      gaps: [
        {
          code: "ai_agent_offline",
          title: "The Cloud AI agent is offline",
          nextStep:
            "It last reported in 3 hours ago. Check that its container is running and can reach your OneUptime URL (its logs say why it cannot).",
          blocksInvestigation: false,
          blocksRemediation: true,
        },
      ],
    };
  }

  return {
    ...status,
    gaps: [
      {
        code: "ai_agent_not_connected",
        title: "No Cloud AI agent is connected",
        nextStep: `To let OneUptime AI fix problems in this ${noun}, use "Let AI fix problems" on the account's Overview (or ${page}) and run the command it shows in the cloud's own shell: it creates the Cloud AI agent's role and starts the agent, which connects on its own.`,
        blocksInvestigation: false,
        blocksRemediation: true,
      },
      {
        code: "remediation_disabled",
        title: `AI fixes are turned off for this ${noun}`,
        nextStep: `Set "Fixes" to "Ask for approval", "Automatic" or "Bypass approval" on ${page}.`,
        blocksInvestigation: false,
        blocksRemediation: true,
      },
    ],
  };
}

// What AI did on the AWS account: one investigation, and one fix approved.
function aiLogs(resourceId) {
  const found = accountOf(resourceId);
  if (!found || found.provider !== "aws") {
    return { investigations: [], fixes: [] };
  }
  return {
    investigations: [
      {
        aiRunId: "60000000-0000-4000-8000-000000000001",
        status: "Completed",
        analysisTldr:
          "The checkout service ran out of capacity after the 14:00 deploy doubled its traffic; two more tasks would carry it.",
        createdAt: new Date(NOW - 50 * MINUTE).toISOString(),
        completedAt: new Date(NOW - 46 * MINUTE).toISOString(),
        incident: {
          id: "70000000-0000-4000-8000-000000000001",
          title: "Checkout is slow for every customer",
          number: 18,
        },
        alert: null,
      },
    ],
    fixes: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        status: "Approved",
        executionMode: "RequireApproval",
        suggestionType: "CommandPlan",
        rationale:
          "Scale the checkout service out from 4 to 6 tasks: every task is above 90% CPU since the deploy.",
        createdAt: new Date(NOW - 45 * MINUTE).toISOString(),
        incidentId: "70000000-0000-4000-8000-000000000001",
        alertId: null,
        approvedAt: new Date(NOW - 41 * MINUTE).toISOString(),
        approvedByName: "Maya Chen",
      },
    ],
  };
}

// The commands AI ran on the account through its agent, newest first.
/*
 * The account's feed (Activity -> Feed), newest last here: how it came to
 * OneUptime, its Cloud AI agent connecting, a person letting AI read its
 * logs, and the agent being reset - as the server writes them.
 */
const ACCOUNT_LINK = `[AWS account Production](/dashboard/${PROJECT_ID}/cloud/accounts/${AWS_ACCOUNT_ID})`;
const ACCOUNT_FEED = [
  {
    _id: "91000000-0000-4000-8000-000000000001",
    cloudAccountId: AWS_ACCOUNT_ID,
    cloudAccountFeedEventType: "CloudAccountCreated",
    feedInfoInMarkdown: `☁️ OneUptime found ${ACCOUNT_LINK} when the cloud connection **AWS 123456789012** first read it.`,
    displayColor: new Color("#3b82f6"),
    postedAt: new Date(NOW - 9 * 24 * 60 * MINUTE),
  },
  {
    _id: "91000000-0000-4000-8000-000000000002",
    cloudAccountId: AWS_ACCOUNT_ID,
    cloudAccountFeedEventType: "CloudAccountUpdated",
    feedInfoInMarkdown:
      "The Cloud AI agent connected. What AI may do here follows the agent's configuration: investigation on, fixes Ask for approval. Change it with ONEUPTIME_AI_INVESTIGATION and ONEUPTIME_AI_FIXES where the agent runs; the AWS account's AI agent page shows how.",
    moreInformationInMarkdown:
      "**Agent**: Cloud AI agent (b0000000-0000-4000-8000-000000000001)\n\n**Identity**: `123456789012`",
    displayColor: new Color("#10b981"),
    postedAt: new Date(NOW - 3 * 24 * 60 * MINUTE),
  },
  {
    _id: "91000000-0000-4000-8000-000000000003",
    cloudAccountId: AWS_ACCOUNT_ID,
    cloudAccountFeedEventType: "CloudAccountUpdated",
    feedInfoInMarkdown: `🤖 **Maya Chen** changed what OneUptime AI may do on ${ACCOUNT_LINK}:\n\n- Reading the account's log lines during investigations turned **on**`,
    moreInformationInMarkdown:
      "Investigations may now read this account's recent log lines (CloudWatch Logs, Log Analytics or Cloud Logging) through its read-only connection. Log lines can hold customer data.",
    displayColor: new Color("#eab308"),
    user: { name: "Maya Chen", email: "maya@acme.example" },
    postedAt: new Date(NOW - 2 * 24 * 60 * MINUTE),
  },
  {
    _id: "91000000-0000-4000-8000-000000000004",
    cloudAccountId: AWS_ACCOUNT_ID,
    cloudAccountFeedEventType: "CloudAccountUpdated",
    feedInfoInMarkdown:
      "🔄 The Cloud AI agent was reset by **Maya Chen**. It reconnects on its own within a few minutes.",
    displayColor: new Color("#3b82f6"),
    user: { name: "Maya Chen", email: "maya@acme.example" },
    postedAt: new Date(NOW - 30 * MINUTE),
  },
];

const RUNNER_JOBS = [
  {
    _id: "90000000-0000-4000-8000-000000000002",
    createdAt: new Date(NOW - 5 * MINUTE),
    origin: "AiInvestigation",
    status: "Succeeded",
    exitCode: 0,
    payload: { displayCommand: "cloud whoami" },
  },
  {
    _id: "90000000-0000-4000-8000-000000000001",
    createdAt: new Date(NOW - 40 * MINUTE),
    origin: "AiRemediation",
    status: "Succeeded",
    exitCode: 0,
    payload: {
      displayCommand:
        "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/checkout --count 6",
    },
  },
];

window.__cloudConnectFixture = {
  state: state,
  // The Cloud AI agent connects, as it does once its command finished.
  connectAgent: () => {
    state.ai = "connected";
    const found = accountOf(AWS_ACCOUNT_ID);
    if (found) {
      found.aiRemediationMode = "RequireApproval";
    }
  },
  setVerdict: (name) => {
    state.verdict = name;
  },
  release: (name) => {
    const held = state.held.splice(0);
    for (const entry of held) {
      entry.resolve(answer(name, entry.provider));
    }
  },
  // A read the page started (Read now) ends: the connection was read now.
  finishRead: (id) => {
    const found = connections.find((item) => {
      return item.id.toString() === id;
    });
    if (found) {
      const now = new Date();
      found.lastPulledAt = now;
      found.lastSuccessfulPullAt = now;
      found.lastError = undefined;
      found.lastPullResult = {
        status: "success",
        accounts: ["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"],
        resourceCount: 37,
        resourceTypes: [
          { type: "Microsoft.Compute/virtualMachines", count: 18 },
        ],
        regions: [
          { region: "westeurope", count: 29 },
          { region: "northeurope", count: 8 },
        ],
        newResources: 37,
        archivedResources: 0,
        pointsWritten: 512,
        requestCount: 40,
        warnings: [],
        durationMs: 4000,
        finishedAt: now.toISOString(),
      };
    }
  },
};

function copy(item) {
  return Object.assign(new CloudConnection(), item);
}

ModelAPI.getList = async (args) => {
  if (args.modelType === CloudConnection) {
    const data = connections.map(copy);
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  if (args.modelType === CloudAccount) {
    state.listRequests.push({ model: "CloudAccount" });
    const data = accounts.map((item) => {
      return Object.assign(new CloudAccount(), item);
    });
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  if (args.modelType === CloudResource) {
    const query = args.query || {};
    const provider = String(query.cloudProvider || "");
    const accountIds = plainValues(query.cloudAccountId);
    state.listRequests.push({
      model: "CloudResource",
      cloudProvider: provider,
      cloudAccountIds: accountIds,
      isArchived: query.isArchived,
      limit: args.limit,
    });
    const data = AWS_RESOURCES.filter((item) => {
      return (
        item.cloudProvider === provider &&
        accountIds.includes(item.cloudAccountId)
      );
    }).map((item) => {
      return Object.assign(new CloudResource(), item);
    });
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  // The project's Server key, which the Cloud AI agent connects with.
  if (args.modelType === TelemetryIngestionKey) {
    state.listRequests.push({ model: "TelemetryIngestionKey" });
    const key = Object.assign(new TelemetryIngestionKey(), {
      _id: "a0000000-0000-4000-8000-000000000001",
      name: "Cloud AI agent key",
      secretKey: new ObjectID("a1000000-0000-4000-8000-000000000001"),
      keyType: "Server",
      allowedOrigins: [],
    });
    return { data: [key], count: 1, skip: 0, limit: args.limit };
  }

  // The commands OneUptime AI ran on an account through its agent.
  if (args.modelType === RunnerJob) {
    state.listRequests.push({ model: "RunnerJob" });
    const data = (state.ai === "connected" ? RUNNER_JOBS : []).map((row) => {
      return Object.assign(new RunnerJob(), row);
    });
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  // The account's feed, newest first unless the reader asked otherwise.
  if (args.modelType === CloudAccountFeed) {
    const query = args.query || {};
    const accountId = String(query.cloudAccountId || "");
    state.listRequests.push({
      model: "CloudAccountFeed",
      cloudAccountId: accountId,
    });
    const ascending = Boolean(
      args.sort && String(args.sort.postedAt || "") === "ASC",
    );
    const data = ACCOUNT_FEED.filter((row) => {
      return row.cloudAccountId === accountId;
    })
      .sort((left, right) => {
        return ascending
          ? left.postedAt.getTime() - right.postedAt.getTime()
          : right.postedAt.getTime() - left.postedAt.getTime();
      })
      .map((row) => {
        return Object.assign(new CloudAccountFeed(), row);
      });
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  // The open incidents and alerts of a resource, or of an account's resources.
  const issues = {
    Incident: { rows: INCIDENTS, type: Incident },
    Alert: { rows: ALERTS, type: Alert },
    IncidentState: { rows: INCIDENT_STATES, type: IncidentState },
    AlertState: { rows: ALERT_STATES, type: AlertState },
  };
  for (const [name, table] of Object.entries(issues)) {
    if (args.modelType === table.type) {
      state.listRequests.push({ model: name });
      const data = table.rows
        .filter((row) => {
          return rowMatches(row, args.query);
        })
        .map((row) => {
          return Object.assign(new table.type(), row);
        });
      return { data: data, count: data.length, skip: 0, limit: args.limit };
    }
  }

  return { data: [], count: 0, skip: 0, limit: args.limit };
};

// One connection, as the list asks after a read it started (Read now).
ModelAPI.getItem = async (args) => {
  if (args.modelType === CloudAccount) {
    const found = accounts.find((item) => {
      return item._id === args.id.toString();
    });
    return found ? Object.assign(new CloudAccount(), found) : null;
  }

  if (args.modelType === CloudResource) {
    const found = AWS_RESOURCES.find((item) => {
      return item._id === args.id.toString();
    });
    return found ? Object.assign(new CloudResource(), found) : null;
  }

  state.itemAsks++;
  if (args.modelType === CloudConnection) {
    const found = connections.find((item) => {
      return item.id.toString() === args.id.toString();
    });
    return found ? copy(found) : null;
  }
  return null;
};

ModelAPI.count = async (args) => {
  if (args.modelType === CloudConnection) {
    return connections.length;
  }
  if (args.modelType === CloudAccount) {
    return accounts.length;
  }
  // A resource's open incidents and alerts, as its menu and cards count them.
  if (args.modelType === Incident) {
    return INCIDENTS.filter((row) => {
      return rowMatches(row, args.query);
    }).length;
  }
  if (args.modelType === Alert) {
    return ALERTS.filter((row) => {
      return rowMatches(row, args.query);
    }).length;
  }
  return 0;
};

// What changed in an account or a resource, newest first.
AnalyticsModelAPI.getList = async (args) => {
  state.listRequests.push({
    model: "ChangeEvent",
    attributes: JSON.parse(JSON.stringify(args.query?.attributes || {})),
  });
  if (args.modelType !== ChangeEvent) {
    return { data: [], count: 0, skip: 0, limit: args.limit };
  }
  const data = CHANGES.filter((row) => {
    return rowMatches(row, args.query);
  }).map((row) => {
    return Object.assign(new ChangeEvent(), row);
  });
  const skip = Number(args.skip || 0);
  const limit = Number(args.limit || 10);
  return {
    data: data.slice(skip, skip + limit),
    count: data.length,
    skip: skip,
    limit: limit,
  };
};

AnalyticsModelAPI.count = async (modelType, query) => {
  if (modelType !== ChangeEvent) {
    return 0;
  }
  return CHANGES.filter((row) => {
    return rowMatches(row, query);
  }).length;
};

ModelAPI.create = async (args) => {
  const model = args.model;
  state.creates.push({
    name: model.name,
    provider: model.provider,
    config: model.config,
    secrets: model.secrets,
    isEnabled: model.isEnabled,
  });
  return new HTTPResponse(200, {}, {});
};

ModelAPI.updateById = async (args) => {
  state.updates.push({ id: args.id.toString(), data: args.data });
  const found =
    connections.find((item) => {
      return item.id.toString() === args.id.toString();
    }) ||
    accounts.find((item) => {
      return item._id === args.id.toString();
    });
  if (found) {
    Object.assign(found, args.data);
  }
  return new HTTPResponse(200, {}, {});
};

ModelAPI.deleteItem = async (args) => {
  state.deletes.push(args.id.toString());
  const index = connections.findIndex((item) => {
    return item.id.toString() === args.id.toString();
  });
  if (index >= 0) {
    connections.splice(index, 1);
  }
  const accountIndex = accounts.findIndex((item) => {
    return item._id === args.id.toString();
  });
  if (accountIndex >= 0) {
    accounts.splice(accountIndex, 1);
  }
};

ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

API.get = async (options) => {
  const url = options.url.toString();

  if (url.endsWith("/cloud-connection/aws-role-setup")) {
    state.roleSetupAsks++;
    return new HTTPResponse(
      200,
      awsWay === "key"
        ? { isAvailable: false, externalId: "" }
        : {
            isAvailable: true,
            trustedPrincipalArn: "arn:aws:iam::999988887777:root",
            externalId: "oneuptime-6c2b8f0e4d1a9b3c7e5f2a8d0c6b4e1f",
          },
      {},
    );
  }

  return new HTTPResponse(200, {}, {});
};

API.post = async (options) => {
  const url = options.url.toString();

  if (url.includes("/resource-ai-access/")) {
    const route = url.slice(url.indexOf("/resource-ai-access/"));
    const body = options.data || {};
    state.aiPosts.push({ route: route, body: body });

    if (state.ai === "fail") {
      throw new Error("Network Error");
    }
    if (route === "/resource-ai-access/status") {
      return new HTTPResponse(200, aiStatus(body.resourceId), {});
    }
    if (route === "/resource-ai-access/logs") {
      return new HTTPResponse(200, aiLogs(body.resourceId), {});
    }
    if (route === "/resource-ai-access/test") {
      const found = accountOf(body.resourceId) || accounts[0];
      return new HTTPResponse(
        200,
        {
          ok: true,
          message: "The Cloud AI agent answered.",
          results: [
            {
              command: "cloud whoami",
              succeeded: true,
              exitCode: 0,
              output: `AWS account ${found.accountId}, us-east-1. Changes: ${AWS_OPERATIONS.join(", ")}.`,
              errorMessage: null,
            },
          ],
          status: aiStatus(body.resourceId),
        },
        {},
      );
    }
    return new HTTPResponse(200, { ok: true }, {});
  }

  if (url.endsWith("/cloud-connection/test")) {
    state.tests.push({ body: options.data });

    const provider = providerOf(options.data);

    if (state.verdict === "slow") {
      return await new Promise((resolve) => {
        state.held.push({ resolve, provider });
      });
    }

    return answer(state.verdict, provider);
  }

  if (url.endsWith("/read-now")) {
    state.readNows.push(new URL(url).pathname);
    return new HTTPResponse(200, { queued: true }, {});
  }

  return new HTTPResponse(200, {}, {});
};

// What App.tsx does for every page: the router's hooks, handed to Navigation.
function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

const CONNECT_ROUTE = RouteMap[PageMap.CLOUD_CONNECT];

function FixtureLayout() {
  useNavigationHooks();

  return (
    <CloudLayout
      currentProject={project}
      pageRoute={CONNECT_ROUTE}
      hasPaymentMethod={true}
    />
  );
}

function FixtureConnect() {
  useNavigationHooks();

  return (
    <CloudConnectPage
      currentProject={project}
      pageRoute={CONNECT_ROUTE}
      hasPaymentMethod={true}
    />
  );
}

const ACCOUNTS_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNTS];
const ACCOUNT_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW];
const ACCOUNT_RESOURCES_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_RESOURCES];

// A Dashboard page, given what App.tsx gives every page.
function withNavigation(Component, pageRoute) {
  return function NavigatedPage() {
    useNavigationHooks();

    return (
      <Component
        currentProject={project}
        pageRoute={pageRoute}
        hasPaymentMethod={true}
      />
    );
  };
}

const FixtureAccountsLayout = withNavigation(CloudLayout, ACCOUNTS_ROUTE);
const FixtureAccounts = withNavigation(CloudAccountsPage, ACCOUNTS_ROUTE);
const FixtureAccountLayout = withNavigation(
  CloudAccountViewLayout,
  ACCOUNT_ROUTE,
);
const FixtureAccountOverview = withNavigation(
  CloudAccountOverviewPage,
  ACCOUNT_ROUTE,
);
const FixtureAccountResources = withNavigation(
  CloudAccountResourcesPage,
  ACCOUNT_RESOURCES_ROUTE,
);

const ACCOUNT_TOPOLOGY_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_TOPOLOGY];
const ACCOUNT_CHANGES_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_CHANGES];
const ACCOUNT_SETTINGS_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_SETTINGS];
const ACCOUNT_DELETE_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_DELETE];
const ACCOUNT_AI_AGENT_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_AI_AGENT];
const ACCOUNT_AI_LOGS_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_AI_LOGS];
const ACCOUNT_FEED_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_FEED];
const RESOURCE_ROUTE = RouteMap[PageMap.CLOUD_RESOURCE_VIEW];
const RESOURCE_INCIDENTS_ROUTE =
  RouteMap[PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS];
const RESOURCE_ALERTS_ROUTE = RouteMap[PageMap.CLOUD_RESOURCE_VIEW_ALERTS];
const RESOURCE_CHANGES_ROUTE = RouteMap[PageMap.CLOUD_RESOURCE_VIEW_CHANGES];

const FixtureAccountTopology = withNavigation(
  CloudAccountTopologyPage,
  ACCOUNT_TOPOLOGY_ROUTE,
);
const FixtureAccountChanges = withNavigation(
  CloudAccountChangesPage,
  ACCOUNT_CHANGES_ROUTE,
);
const FixtureAccountSettings = withNavigation(
  CloudAccountSettingsPage,
  ACCOUNT_SETTINGS_ROUTE,
);
const FixtureAccountDelete = withNavigation(
  CloudAccountDeletePage,
  ACCOUNT_DELETE_ROUTE,
);
const FixtureAccountAiAgent = withNavigation(
  CloudAccountAiAgentPage,
  ACCOUNT_AI_AGENT_ROUTE,
);
const FixtureAccountAiLogs = withNavigation(
  CloudAccountAiLogsPage,
  ACCOUNT_AI_LOGS_ROUTE,
);
const FixtureAccountFeed = withNavigation(
  CloudAccountFeedPage,
  ACCOUNT_FEED_ROUTE,
);
const FixtureResourceLayout = withNavigation(
  CloudResourceViewLayout,
  RESOURCE_ROUTE,
);
const FixtureResourceOverview = withNavigation(
  CloudResourceOverviewPage,
  RESOURCE_ROUTE,
);
const FixtureResourceIncidents = withNavigation(
  CloudResourceIncidentsPage,
  RESOURCE_INCIDENTS_ROUTE,
);
const FixtureResourceAlerts = withNavigation(
  CloudResourceAlertsPage,
  RESOURCE_ALERTS_ROUTE,
);
const FixtureResourceChanges = withNavigation(
  CloudResourceChangesPage,
  RESOURCE_CHANGES_ROUTE,
);

// A page the Connect page links to that is not modelled: says where it is.
function StubPage() {
  useNavigationHooks();
  const location = useLocation();

  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">Not modelled</h1>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
        {location.search}
      </p>
    </main>
  );
}

/*
 * App.tsx reads the location itself, so the whole Dashboard is drawn again
 * on every navigation, and with it the side menu, which marks the page.
 */
function FixtureApp() {
  useLocation();

  return (
    <div className="min-h-screen bg-gray-50 pb-10" data-testid="fixture-page">
      <Routes>
        <Route element={<FixtureLayout />}>
          <Route path={CONNECT_ROUTE.toString()} element={<FixtureConnect />} />
        </Route>
        <Route element={<FixtureAccountsLayout />}>
          <Route
            path={ACCOUNTS_ROUTE.toString()}
            element={<FixtureAccounts />}
          />
        </Route>
        <Route element={<FixtureAccountLayout />}>
          <Route
            path={ACCOUNT_ROUTE.toString()}
            element={<FixtureAccountOverview />}
          />
          <Route
            path={ACCOUNT_RESOURCES_ROUTE.toString()}
            element={<FixtureAccountResources />}
          />
          <Route
            path={ACCOUNT_TOPOLOGY_ROUTE.toString()}
            element={<FixtureAccountTopology />}
          />
          <Route
            path={ACCOUNT_CHANGES_ROUTE.toString()}
            element={<FixtureAccountChanges />}
          />
          <Route
            path={ACCOUNT_SETTINGS_ROUTE.toString()}
            element={<FixtureAccountSettings />}
          />
          <Route
            path={ACCOUNT_DELETE_ROUTE.toString()}
            element={<FixtureAccountDelete />}
          />
          <Route
            path={ACCOUNT_AI_AGENT_ROUTE.toString()}
            element={<FixtureAccountAiAgent />}
          />
          <Route
            path={ACCOUNT_AI_LOGS_ROUTE.toString()}
            element={<FixtureAccountAiLogs />}
          />
          <Route
            path={ACCOUNT_FEED_ROUTE.toString()}
            element={<FixtureAccountFeed />}
          />
        </Route>
        <Route element={<FixtureResourceLayout />}>
          <Route
            path={RESOURCE_ROUTE.toString()}
            element={<FixtureResourceOverview />}
          />
          <Route
            path={RESOURCE_INCIDENTS_ROUTE.toString()}
            element={<FixtureResourceIncidents />}
          />
          <Route
            path={RESOURCE_ALERTS_ROUTE.toString()}
            element={<FixtureResourceAlerts />}
          />
          <Route
            path={RESOURCE_CHANGES_ROUTE.toString()}
            element={<FixtureResourceChanges />}
          />
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
