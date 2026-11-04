/*
 * Offline fixture for Cloud's Overview and its Spend pages - Costs, Savings
 * and Budgets - and an account's Costs tab: the REAL Cloud route group
 * (Routes/CloudResourceRoutes - its layout, side menus, trail and every
 * page), under its real RouteMap pattern, as App.tsx mounts it. Only the
 * data boundary (ModelAPI, AnalyticsModelAPI, API, Realtime) and the
 * signed-in user are replaced. Every record is fabricated for an "Acme
 * Cloud" workspace.
 *
 * The costs are made up day by day - each account's services, Regions and,
 * where the cloud says it, resources - and every figure the pages show is
 * worked out from them as the server works it out: each account's summary
 * (summarizeCloudAccountCosts, summarizeCloudAccountSavings), each day's
 * sum and each breakdown (/aggregate's sums, in the window and currency
 * asked for), the budgets' month so far. So the Overview, Costs, an
 * account's Costs and Budgets agree with each other, as they do for real.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?state=   (default: five accounts on three clouds, four of them read)
 *             | unread (no account's costs or recommendations read yet)
 *             | empty (no cloud account yet)
 *   ?fail=    accounts (the first read of the accounts fails) | costs (the
 *             first read of each costs card fails); a second read answers
 *   ?lang=    de | fa (Persian, laid out right to left, as production does)
 *   ?theme=   dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__cloudSpendFixture: listRequests,
 * countRequests, itemRequests, aggregateRequests, metricRequests (a
 * resource's readings, for its right-sizing), creates, updates and
 * unhandled - anything the fixture does not model. The spec asserts
 * `unhandled` is empty.
 */
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
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import CloudResourceRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/CloudResourceRoutes";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { getCloudRightSizingRecommendationId } from "Common/Types/Cloud/CloudRightSizing";
import { findCloudCostAnomalies } from "Common/Types/Cloud/CloudCostAnomaly";
import Project from "Common/Models/DatabaseModels/Project";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import { Red, Yellow } from "Common/Types/BrandColors";
import {
  CloudCostState,
  CloudSavingKind,
  addUtcDays,
  addUtcMonths,
  startOfUtcDay,
  startOfUtcMonth,
  summarizeCloudAccountCosts,
  summarizeCloudAccountSavings,
  toCloudCostDay,
} from "Common/Types/Cloud/CloudCost";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";
import { setPageLanguage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const EMPTY = params.get("state") === "empty";
const UNREAD = params.get("state") === "unread";
// The reads that fail once, then answer when tried again.
const FAILING = new Set(
  (params.get("fail") || "").split(",").filter((kind) => {
    return ["accounts", "costs"].includes(kind);
  }),
);
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: LANGUAGE,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Persian reads right to left, as production's followLanguageForPage sets it.
setPageLanguage(LANGUAGE);
// Dates in the reader's language, as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

/*
 * ---------------------------------------------------------------------------
 * The workspace
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date();
const LOADED_AT = NOW.getTime();
const GIB = 1024 * 1024 * 1024;

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Cloud",
});

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

const GRANTED = [Permission.ProjectOwner];

PermissionUtil.getAllPermissions = () => {
  return GRANTED;
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: GRANTED.map((permission) => {
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

/*
 * ---------------------------------------------------------------------------
 * The accounts and what they cost, day by day
 * ---------------------------------------------------------------------------
 */
const WEB_PROD = uuid("81000000", 1);
const DATA_LAKE = uuid("81000000", 2);
const ANALYTICS = uuid("81000000", 3);
const CORE_PROD = uuid("81000000", 4);
const EU_SHOP = uuid("81000000", 5);
const CONNECTION = uuid("80000000", 1);

/*
 * What each account's cloud bills a day, by service, Region and (where the
 * cloud names it) resource: AWS Cost Explorer says the service and Region,
 * a Google Cloud detailed billing export names each resource too.
 */
const BILLED = {
  [WEB_PROD]: {
    currency: "USD",
    lines: [
      {
        service: "Amazon Elastic Compute Cloud - Compute",
        region: "us-east-1",
        resourceId: "",
        base: 142,
      },
      {
        service: "Amazon Relational Database Service",
        region: "us-east-1",
        resourceId: "",
        base: 76,
      },
      {
        service: "Amazon Simple Storage Service",
        region: "us-east-1",
        resourceId: "",
        base: 29,
      },
      {
        service: "Amazon CloudFront",
        region: "",
        resourceId: "",
        base: 22,
      },
      {
        service: "Amazon ElastiCache",
        region: "us-east-1",
        resourceId: "",
        base: 18,
      },
      { service: "AWS Lambda", region: "eu-west-1", resourceId: "", base: 12 },
    ],
  },
  [DATA_LAKE]: {
    currency: "USD",
    lines: [
      {
        service: "Amazon Simple Storage Service",
        region: "us-west-2",
        resourceId: "",
        base: 64,
      },
      { service: "AWS Glue", region: "us-west-2", resourceId: "", base: 31 },
      {
        service: "Amazon Athena",
        region: "us-west-2",
        resourceId: "",
        base: 21,
        /*
         * Yesterday a query ran away: about two and a half times its usual
         * day - an unusual day on Costs, and a budget's alert.
         */
        spikeDaysAgo: 1,
        spikeFactor: 2.5,
      },
    ],
  },
  [ANALYTICS]: {
    currency: "USD",
    lines: [
      {
        service: "Compute Engine",
        region: "europe-west1",
        resourceId:
          "//compute.googleapis.com/projects/acme-analytics/zones/europe-west1-b/instances/etl-runner-1",
        base: 34,
      },
      {
        service: "BigQuery",
        region: "europe-west1",
        resourceId: "",
        base: 26,
      },
      {
        service: "Cloud Storage",
        region: "europe-west1",
        resourceId:
          "//storage.googleapis.com/projects/_/buckets/acme-analytics-raw",
        base: 9,
      },
    ],
  },
  [EU_SHOP]: {
    currency: "EUR",
    lines: [
      {
        service: "Virtual Machines",
        region: "westeurope",
        resourceId:
          "/subscriptions/5f0c2d7e-9a41-4f3b-8c6e-1d2a3b4c5d6e/resourcegroups/shop/providers/microsoft.compute/virtualmachines/shop-web-1",
        base: 17,
      },
    ],
  },
};

const historyStart = addUtcMonths(startOfUtcMonth(NOW), -2);
const today = startOfUtcDay(NOW);
const COST_ROWS = [];

for (const [accountRow, billed] of Object.entries(BILLED)) {
  billed.lines.forEach((line, lineIndex) => {
    for (
      let day = historyStart, index = 0;
      day.getTime() <= today.getTime();
      day = addUtcDays(day, 1), index++
    ) {
      /*
       * A steady spend that drifts with the week, a little higher each
       * month, and today's in part: a cloud reports the day late.
       */
      const swing = 1 + 0.12 * Math.sin(index / 2.3 + lineIndex);
      const growth = 1 + index / 400;
      const partial = day.getTime() === today.getTime() ? 0.4 : 1;
      const spike =
        line.spikeDaysAgo !== undefined &&
        Math.round((today.getTime() - day.getTime()) / DAY) ===
          line.spikeDaysAgo
          ? line.spikeFactor
          : 1;
      const cost =
        Math.round(line.base * swing * growth * partial * spike * 100) / 100;
      COST_ROWS.push({
        cloudAccountId: accountRow,
        day: new Date(day),
        currency: billed.currency,
        service: line.service,
        region: line.region,
        resourceId: line.resourceId,
        cost: cost,
      });
    }
  });
}

/*
 * When the accounts' costs were last read: two hours ago, but never before
 * today's start. A summary read across midnight would end at yesterday -
 * or, on a month's first day, at last month - while every page sums
 * today's rows too, so between 00:00 and 02:00 UTC the Overview's month
 * and Costs' breakdown would tell two different months.
 */
const COSTS_READ_AT = new Date(Math.max(LOADED_AT - 2 * HOUR, today.getTime()));

/*
 * An account's summary, as the server writes it after a read of its costs
 * (CloudCostWriter.summarizePoints): its figures, and the days of its last
 * two weeks that cost far more than usual.
 */
function costSummaryOf(accountRow) {
  const dailyTotals = new Map();
  const monthServices = new Map();
  const dailyServiceTotals = new Map();
  const monthStart = startOfUtcMonth(NOW).getTime();

  for (const row of COST_ROWS) {
    if (row.cloudAccountId !== accountRow) {
      continue;
    }
    const key = toCloudCostDay(row.day);
    dailyTotals.set(key, (dailyTotals.get(key) || 0) + row.cost);
    const services = dailyServiceTotals.get(key) || new Map();
    services.set(row.service, (services.get(row.service) || 0) + row.cost);
    dailyServiceTotals.set(key, services);
    if (row.day.getTime() >= monthStart) {
      monthServices.set(
        row.service,
        (monthServices.get(row.service) || 0) + row.cost,
      );
    }
  }

  const summary = summarizeCloudAccountCosts({
    dailyTotals,
    monthServices,
    currency: BILLED[accountRow].currency,
    now: COSTS_READ_AT,
  });
  const anomalies = findCloudCostAnomalies({
    dailyServiceTotals,
    latestDay: summary.latestDay,
  });

  return anomalies.length > 0 ? { ...summary, anomalies } : summary;
}

/*
 * ---------------------------------------------------------------------------
 * The ways to spend less, as each cloud's recommender makes them
 * ---------------------------------------------------------------------------
 */
const WEB_1 = uuid("82000000", 1);
const ORDERS_DB = uuid("82000000", 2);
const CACHE_1 = uuid("82000000", 3);
const ETL_RUNNER = uuid("82000000", 4);
// Sized by OneUptime from its own readings: no recommender speaks for them.
const SHOP_WEB_1 = uuid("82000000", 5);
const BATCH_1 = uuid("82000000", 6);
const SHOP_WEB_1_ID =
  "/subscriptions/5f0c2d7e-9a41-4f3b-8c6e-1d2a3b4c5d6e/resourceGroups/shop/providers/Microsoft.Compute/virtualMachines/shop-web-1";

function recommendation(number, fields) {
  return {
    _id: uuid("83000000", number),
    projectId: PROJECT_ID,
    recommendationId: `rec-${number}`,
    currency: "USD",
    lastSeenAt: new Date(LOADED_AT - 3 * HOUR),
    ...fields,
  };
}

const RECOMMENDATIONS = [
  recommendation(1, {
    cloudAccountId: WEB_PROD,
    cloudAccount: { name: "web-prod" },
    provider: "aws",
    kind: CloudSavingKind.Rightsize,
    action: "Rightsize",
    resourceName: "orders-db",
    resourceType: "RDS DB instance",
    resourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
    cloudResourceId: ORDERS_DB,
    cloudResource: { name: "orders-db" },
    region: "us-east-1",
    currentConfiguration: "db.r6g.2xlarge",
    recommendedConfiguration: "db.r6g.xlarge",
    monthlySavings: 410.5,
    monthlyCost: 821,
    effort: "Medium",
    source: "AWS Cost Optimization Hub",
  }),
  recommendation(2, {
    cloudAccountId: WEB_PROD,
    cloudAccount: { name: "web-prod" },
    provider: "aws",
    kind: CloudSavingKind.Commitment,
    action: "Purchase Savings Plans",
    resourceName: "Compute Savings Plan",
    resourceType: "Savings Plan",
    resourceId: "",
    region: "us-east-1",
    currentConfiguration: "On-Demand",
    recommendedConfiguration: "1-year Compute Savings Plan, $2.10 an hour",
    monthlySavings: 300,
    monthlyCost: 4300,
    effort: "Low",
    source: "AWS Cost Optimization Hub",
  }),
  recommendation(3, {
    cloudAccountId: WEB_PROD,
    cloudAccount: { name: "web-prod" },
    provider: "aws",
    kind: CloudSavingKind.Rightsize,
    action: "Rightsize",
    resourceName: "web-1",
    resourceType: "EC2 instance",
    resourceId: "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1",
    cloudResourceId: WEB_1,
    cloudResource: { name: "web-1" },
    region: "us-east-1",
    currentConfiguration: "m5.2xlarge",
    recommendedConfiguration: "m5.xlarge",
    monthlySavings: 280.32,
    monthlyCost: 560.64,
    effort: "Low",
    source: "AWS Cost Optimization Hub",
  }),
  recommendation(4, {
    cloudAccountId: ANALYTICS,
    cloudAccount: { name: "analytics" },
    provider: "gcp",
    kind: CloudSavingKind.Rightsize,
    action: "Change machine type",
    resourceName: "etl-runner-1",
    resourceType: "Compute Engine instance",
    resourceId:
      "//compute.googleapis.com/projects/acme-analytics/zones/europe-west1-b/instances/etl-runner-1",
    cloudResourceId: ETL_RUNNER,
    cloudResource: { name: "etl-runner-1" },
    region: "europe-west1",
    currentConfiguration: "n2-standard-16",
    recommendedConfiguration: "n2-standard-8",
    monthlySavings: 190.44,
    monthlyCost: 380.88,
    effort: "Low",
    source: "Google Cloud Recommender",
  }),
  recommendation(5, {
    cloudAccountId: DATA_LAKE,
    cloudAccount: { name: "data-lake" },
    provider: "aws",
    kind: CloudSavingKind.Upgrade,
    action: "Upgrade",
    resourceName: "vol-0lake7",
    resourceType: "EBS volume",
    resourceId: "arn:aws:ec2:us-west-2:210987654321:volume/vol-0lake7",
    region: "us-west-2",
    currentConfiguration: "gp2, 2,000 GiB",
    recommendedConfiguration: "gp3, 2,000 GiB",
    monthlySavings: 54.1,
    monthlyCost: 200,
    effort: "Low",
    source: "AWS Cost Optimization Hub",
  }),
  recommendation(6, {
    cloudAccountId: WEB_PROD,
    cloudAccount: { name: "web-prod" },
    provider: "aws",
    kind: CloudSavingKind.Idle,
    action: "Delete",
    resourceName: "vol-0ab12",
    resourceType: "EBS volume",
    resourceId: "arn:aws:ec2:us-east-1:123456789012:volume/vol-0ab12",
    region: "us-east-1",
    currentConfiguration: "Unattached for 21 days",
    recommendedConfiguration: "",
    monthlySavings: 36.8,
    monthlyCost: 36.8,
    effort: "VeryLow",
    source: "AWS Cost Optimization Hub",
  }),
  recommendation(7, {
    cloudAccountId: ANALYTICS,
    cloudAccount: { name: "analytics" },
    provider: "gcp",
    kind: CloudSavingKind.Idle,
    action: "Delete",
    resourceName: "etl-static-ip",
    resourceType: "IP address",
    resourceId:
      "//compute.googleapis.com/projects/acme-analytics/regions/europe-west1/addresses/etl-static-ip",
    region: "europe-west1",
    currentConfiguration: "Reserved, not used for 14 days",
    recommendedConfiguration: "",
    monthlySavings: 7.3,
    monthlyCost: 7.3,
    effort: "VeryLow",
    source: "Google Cloud Recommender",
  }),
  /*
   * OneUptime's own right-sizing, as the savings lane keeps it: an EC2
   * instance no recommender speaks for, sized from its CPU, its saving not
   * known yet - AWS Cost Explorer bills it under its service only.
   */
  recommendation(8, {
    recommendationId: getCloudRightSizingRecommendationId(BATCH_1),
    cloudAccountId: DATA_LAKE,
    cloudAccount: { name: "data-lake" },
    provider: "aws",
    kind: CloudSavingKind.Rightsize,
    action: "Rightsize",
    resourceName: "batch-1",
    resourceType: "EC2 Instance",
    resourceId: "arn:aws:ec2:us-west-2:210987654321:instance/i-0batch1",
    cloudResourceId: BATCH_1,
    cloudResource: { name: "batch-1" },
    region: "us-west-2",
    currentConfiguration: "m5.4xlarge",
    recommendedConfiguration: "m5.xlarge",
    monthlySavings: 0,
    effort: "Medium",
    source: "OneUptime",
    evidence: {
      cpuP95Percent: 8,
      cpuMaxPercent: 22,
      memoryPeakPercent: null,
      observedDays: 14,
      factor: 4,
      isSavingUpperBound: false,
    },
  }),
];

function savingsSummaryOf(accountRow) {
  return summarizeCloudAccountSavings({
    savings: RECOMMENDATIONS.filter((row) => {
      return row.cloudAccountId === accountRow;
    }).map((row) => {
      return {
        monthlySavings: row.monthlySavings,
        currency: row.currency,
        kind: row.kind,
      };
    }),
    now: new Date(LOADED_AT - 3 * HOUR),
  });
}

function notRead(state, message) {
  return {
    state,
    message,
    currency: "USD",
    monthToDate: 0,
    lastMonth: 0,
    monthFullDays: 0,
    lastMonthToDate: 0,
    projectedMonth: 0,
    last30Days: 0,
    topServices: [],
    readAt: COSTS_READ_AT.toISOString(),
  };
}

function account(accountRow, fields) {
  return {
    _id: accountRow,
    projectId: PROJECT_ID,
    cloudConnectionId: CONNECTION,
    lastSeenAt: new Date(LOADED_AT - 4 * MINUTE),
    createdAt: new Date(LOADED_AT - 90 * DAY),
    ...fields,
  };
}

const ACCOUNTS = EMPTY
  ? []
  : [
      account(WEB_PROD, {
        name: "web-prod",
        provider: "aws",
        accountId: "123456789012",
        resourceCount: 248,
        costSummary: UNREAD
          ? notRead(
              CloudCostState.NotSetUp,
              "Cost Explorer is not turned on for this account yet.",
            )
          : costSummaryOf(WEB_PROD),
        savingsSummary: UNREAD ? null : savingsSummaryOf(WEB_PROD),
      }),
      account(DATA_LAKE, {
        name: "data-lake",
        provider: "aws",
        accountId: "210987654321",
        resourceCount: 64,
        lastSeenAt: new Date(LOADED_AT - 7 * MINUTE),
        costSummary: UNREAD ? null : costSummaryOf(DATA_LAKE),
        savingsSummary: UNREAD ? null : savingsSummaryOf(DATA_LAKE),
      }),
      account(ANALYTICS, {
        name: "analytics",
        provider: "gcp",
        accountId: "acme-analytics",
        resourceCount: 41,
        costSummary: UNREAD
          ? notRead(
              CloudCostState.NotSetUp,
              "Name the billing export's table to read this project's costs.",
            )
          : costSummaryOf(ANALYTICS),
        savingsSummary: UNREAD ? null : savingsSummaryOf(ANALYTICS),
      }),
      account(CORE_PROD, {
        name: "core-prod",
        provider: "azure",
        accountId: "8d3f1c2b-4a5e-4b6c-9d7e-0f1a2b3c4d5e",
        resourceCount: 117,
        costSummary: notRead(
          CloudCostState.NotAllowed,
          "AuthorizationFailed: the client does not have authorization to perform action 'Microsoft.CostManagement/query/action' over scope '/subscriptions/8d3f1c2b-4a5e-4b6c-9d7e-0f1a2b3c4d5e'.",
        ),
        savingsSummary: UNREAD ? null : savingsSummaryOf(CORE_PROD),
      }),
      account(EU_SHOP, {
        name: "eu-shop",
        provider: "azure",
        accountId: "5f0c2d7e-9a41-4f3b-8c6e-1d2a3b4c5d6e",
        resourceCount: 23,
        costSummary: UNREAD ? null : costSummaryOf(EU_SHOP),
        savingsSummary: UNREAD ? null : savingsSummaryOf(EU_SHOP),
      }),
    ];

/*
 * ---------------------------------------------------------------------------
 * Resources: three whose last read found something, three OneUptime sizes
 * from its own readings (USAGE: one running hot, an Azure VM billed by name
 * with half its size to spare, an EC2 instance kept among the ways to spend
 * less), and two environments the accounts run apps in (App Platforms')
 * ---------------------------------------------------------------------------
 */
function minutesAgo(minutes) {
  return new Date(LOADED_AT - minutes * MINUTE);
}

function reading(value) {
  return { value: value, time: minutesAgo(5).toISOString() };
}

function resource(id, fields) {
  return {
    _id: id,
    projectId: PROJECT_ID,
    cloudResourceKind: "resource",
    isArchived: false,
    otelCollectorStatus: "connected",
    cloudReadingsAt: minutesAgo(2),
    lastSeenAt: minutesAgo(2),
    ...fields,
  };
}

const RESOURCES = EMPTY
  ? []
  : [
      resource(WEB_1, {
        name: "web-1",
        cloudProvider: "aws",
        cloudResourceType: "AWS::EC2::Instance",
        cloudRegion: "us-east-1",
        cloudAccountId: "123456789012",
        providerResourceId:
          "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1",
        cloudReadings: { "aws/ec2/statuscheckfailed": reading(1) },
        healthSeverity: "critical",
      }),
      resource(ORDERS_DB, {
        name: "orders-db",
        cloudProvider: "aws",
        cloudResourceType: "AWS::RDS::DBInstance",
        cloudRegion: "us-east-1",
        cloudAccountId: "123456789012",
        providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
        cloudProperties: { AllocatedStorage: 100 },
        cloudReadings: {
          "aws/rds/freestoragespace": reading(8 * GIB),
          "aws/rds/cpuutilization": reading(97),
        },
        healthSeverity: "warning",
      }),
      // Running hot, and no recommender speaks for it: under-provisioned.
      resource(CACHE_1, {
        name: "sessions-cache",
        cloudProvider: "aws",
        cloudResourceType: "AWS::ElastiCache::CacheCluster",
        cloudRegion: "us-east-1",
        cloudAccountId: "123456789012",
        providerResourceId:
          "arn:aws:elasticache:us-east-1:123456789012:cluster:sessions-cache",
        cloudProperties: { CacheNodeType: "cache.r6g.large" },
        telemetryAttributes: {
          Namespace: "AWS/ElastiCache",
          "Dimensions.CacheClusterId": "sessions-cache",
        },
        cloudReadings: { "aws/elasticache/cpuutilization": reading(99) },
        healthSeverity: "warning",
      }),
      /*
       * An Azure VM its cloud bills by name and no recommender speaks for:
       * half its size would do, and its saving is known.
       */
      resource(SHOP_WEB_1, {
        name: "shop-web-1",
        cloudProvider: "azure",
        cloudResourceType: "Microsoft.Compute/virtualMachines",
        cloudRegion: "westeurope",
        cloudAccountId: "5f0c2d7e-9a41-4f3b-8c6e-1d2a3b4c5d6e",
        cloudResourceGroup: "shop",
        providerResourceId: SHOP_WEB_1_ID,
        cloudProperties: { vmSize: "Standard_D8s_v5" },
        telemetryAttributes: { "azuremonitor.resource_id": SHOP_WEB_1_ID },
        cloudReadings: { percentage_cpu: reading(9) },
      }),
      // An EC2 instance OneUptime sized: kept among the ways to spend less.
      resource(BATCH_1, {
        name: "batch-1",
        cloudProvider: "aws",
        cloudResourceType: "AWS::EC2::Instance",
        cloudRegion: "us-west-2",
        cloudAccountId: "210987654321",
        providerResourceId:
          "arn:aws:ec2:us-west-2:210987654321:instance/i-0batch1",
        cloudProperties: { InstanceType: "m5.4xlarge" },
        telemetryAttributes: {
          Namespace: "AWS/EC2",
          "Dimensions.InstanceId": "i-0batch1",
        },
        cloudReadings: { "aws/ec2/cpuutilization": reading(6) },
      }),
      /*
       * A Compute Engine instance, as Cloud Asset Inventory lists it under
       * its Cloud Monitoring type: well, and billed by name in the detailed
       * billing export, so its page says what it costs.
       */
      resource(ETL_RUNNER, {
        name: "etl-runner-1",
        cloudProvider: "gcp",
        cloudResourceType: "gce_instance",
        cloudRegion: "europe-west1",
        cloudAccountId: "acme-analytics",
        providerResourceId:
          "//compute.googleapis.com/projects/acme-analytics/zones/europe-west1-b/instances/etl-runner-1",
        cloudReadings: {
          "compute.googleapis.com/instance/cpu/utilization": reading(0.41),
        },
      }),
      {
        _id: uuid("84000000", 1),
        projectId: PROJECT_ID,
        cloudResourceKind: "environment",
        isArchived: false,
        name: "checkout · us-east-1 · 123456789012",
        cloudProvider: "aws",
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      },
      {
        _id: uuid("84000000", 2),
        projectId: PROJECT_ID,
        cloudResourceKind: "environment",
        isArchived: false,
        name: "billing · eu-west-1 · 123456789012",
        cloudProvider: "aws",
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "eu-west-1",
      },
      // An environment of an account no connection here reads: not counted.
      {
        _id: uuid("84000000", 3),
        projectId: PROJECT_ID,
        cloudResourceKind: "environment",
        isArchived: false,
        name: "api · europe-west1 · other-project",
        cloudProvider: "gcp",
        cloudPlatform: "gcp_cloud_run",
        cloudAccountId: "other-project",
        cloudRegion: "europe-west1",
      },
    ];

const APPS = [1, 2, 3, 4, 5].map((number) => {
  return {
    _id: uuid("85000000", number),
    projectId: PROJECT_ID,
    name: ["checkout-api", "inventory", "payments", "billing-api", "api"][
      number - 1
    ],
    cloudResourceId:
      number <= 3
        ? uuid("84000000", 1)
        : number === 4
          ? uuid("84000000", 2)
          : uuid("84000000", 3),
  };
});

/*
 * ---------------------------------------------------------------------------
 * Budgets: one within, one on course to pass, one past 80%, one paused
 * ---------------------------------------------------------------------------
 */
function summaryOf(accountRow) {
  const found = ACCOUNTS.find((row) => {
    return row._id === accountRow;
  });
  return found && found.costSummary && found.costSummary.state === "reading"
    ? found.costSummary
    : null;
}

function usdTotal(field) {
  return [WEB_PROD, DATA_LAKE, ANALYTICS].reduce((sum, accountRow) => {
    const summary = summaryOf(accountRow);
    return sum + (summary ? summary[field] : 0);
  }, 0);
}

function roundUp(amount, to) {
  return Math.ceil(amount / to) * to;
}

function budget(number, fields) {
  return {
    _id: uuid("86000000", number),
    projectId: PROJECT_ID,
    currency: "USD",
    alertThresholds: "80,100",
    alertOnProjection: true,
    isEnabled: true,
    lastCheckedAt: UNREAD ? undefined : minutesAgo(20),
    createdAt: new Date(LOADED_AT - (40 - number) * DAY),
    ...fields,
  };
}

const ALL_MONTH = usdTotal("monthToDate");
const ALL_PROJECTED = usdTotal("projectedMonth");
const LAKE = summaryOf(DATA_LAKE);
const ANALYTICS_SUMMARY = summaryOf(ANALYTICS);

const BUDGETS = EMPTY
  ? []
  : [
      budget(1, {
        name: "Production",
        description: "Every account, before credits.",
        monthlyAmount: roundUp(ALL_PROJECTED * 1.2, 1000) || 10000,
        spentThisMonth: ALL_MONTH,
        projectedThisMonth: ALL_PROJECTED,
      }),
      budget(2, {
        name: "Data platform",
        cloudAccountId: DATA_LAKE,
        cloudAccount: { name: "data-lake" },
        // Under its thresholds, but the last week's pace passes it.
        monthlyAmount: LAKE ? roundUp(LAKE.projectedMonth * 0.85, 100) : 3000,
        spentThisMonth: LAKE ? LAKE.monthToDate : 0,
        projectedThisMonth: LAKE ? LAKE.projectedMonth : 0,
      }),
      budget(3, {
        name: "Analytics",
        cloudAccountId: ANALYTICS,
        cloudAccount: { name: "analytics" },
        // 86% of it spent: past its first threshold.
        monthlyAmount: ANALYTICS_SUMMARY
          ? Math.round(ANALYTICS_SUMMARY.monthToDate / 0.86)
          : 2000,
        spentThisMonth: ANALYTICS_SUMMARY ? ANALYTICS_SUMMARY.monthToDate : 0,
        projectedThisMonth: ANALYTICS_SUMMARY
          ? ANALYTICS_SUMMARY.projectedMonth
          : 0,
        alertThresholds: "50,80,100",
      }),
      budget(4, {
        name: "Sandbox",
        monthlyAmount: 500,
        spentThisMonth: 0,
        projectedThisMonth: 0,
        isEnabled: false,
      }),
    ];

const TABLES = {
  CloudAccount: ACCOUNTS,
  CloudResource: RESOURCES,
  CloudCostRecommendation: EMPTY || UNREAD ? [] : RECOMMENDATIONS,
  CloudBudget: BUDGETS,
  CloudApp: APPS,
  CloudConnection: EMPTY
    ? []
    : [
        {
          _id: CONNECTION,
          projectId: PROJECT_ID,
          name: "Acme AWS",
          provider: "aws",
          isEnabled: true,
        },
      ],
  AlertSeverity: [
    {
      _id: uuid("87000000", 1),
      projectId: PROJECT_ID,
      name: "Critical",
      color: Red,
      order: 1,
    },
    {
      _id: uuid("87000000", 2),
      projectId: PROJECT_ID,
      name: "Warning",
      color: Yellow,
      order: 2,
    },
  ],
  OnCallDutyPolicy: [
    {
      _id: uuid("88000000", 1),
      projectId: PROJECT_ID,
      name: "Cloud on-call",
    },
  ],
};

/*
 * ---------------------------------------------------------------------------
 * The data boundary
 * ---------------------------------------------------------------------------
 */
const fixture = {
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  metricRequests: [],
  creates: [],
  updates: [],
  apiRequests: [],
  unhandled: [],
};
window.__cloudSpendFixture = fixture;

// What a read that fails says, as the API's error answer does.
const READ_FAILED = "The server took too long to answer. Try again.";
const failedOnce = new Set();

// A read of this kind fails the first time it is made, and only then.
function failsNow(kind) {
  if (!FAILING.has(kind) || failedOnce.has(kind)) {
    return false;
  }
  failedOnce.add(kind);
  return true;
}

function tableName(modelType) {
  return new modelType().tableName || "";
}

// A query, as it reads in the spec: Includes by their values, ids as text.
function serialize(query) {
  const plain = {};
  for (const [field, value] of Object.entries(query || {})) {
    if (value instanceof Includes) {
      plain[field] = { includes: value.values.map(String) };
    } else if (value instanceof InBetween) {
      plain[field] = {
        inBetween: [
          new Date(value.startValue).toISOString(),
          new Date(value.endValue).toISOString(),
        ],
      };
    } else if (value instanceof NotNull) {
      plain[field] = { notNull: true };
    } else if (value instanceof ObjectID) {
      plain[field] = value.toString();
    } else if (value && typeof value === "object" && value._type) {
      plain[field] = { [value._type]: String(value.value ?? "") };
    } else {
      plain[field] = value;
    }
  }
  return plain;
}

function idsOf(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      return String(entry && entry._id ? entry._id : entry);
    });
  }
  return value === undefined || value === null ? [] : [String(value)];
}

// A query, matched as the server would, for the columns these pages read.
function rowMatches(row, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    if (wanted instanceof EqualToOrNull) {
      if (
        row[field] !== undefined &&
        row[field] !== null &&
        String(row[field]) !== String(wanted.value)
      ) {
        return false;
      }
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
    if (wanted instanceof ObjectID) {
      if (String(row[field]) !== wanted.toString()) {
        return false;
      }
      continue;
    }
    if (wanted instanceof NotNull) {
      if (row[field] === undefined || row[field] === null) {
        return false;
      }
      continue;
    }
    if (wanted instanceof IsNull) {
      if (row[field] !== undefined && row[field] !== null) {
        return false;
      }
      continue;
    }
    if (wanted instanceof InBetween) {
      const time = new Date(row[field] || 0).getTime();
      if (
        time < new Date(wanted.startValue).getTime() ||
        time > new Date(wanted.endValue).getTime()
      ) {
        return false;
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
      continue;
    }
    // A form's or a filter's text search: the row's text holds it.
    if (wanted && typeof wanted === "object" && wanted._type === "Search") {
      if (
        !String(row[field] ?? "")
          .toLowerCase()
          .includes(String(wanted.value ?? "").toLowerCase())
      ) {
        return false;
      }
    }
  }
  return true;
}

function rowsOf(modelType, query) {
  return (TABLES[tableName(modelType)] || []).filter((row) => {
    return rowMatches(row, query);
  });
}

/*
 * The tables the pages read that the fixture keeps empty, as a new
 * project's are: a resource's page counts the open incidents and alerts
 * linked to it, by the states that are not resolved.
 */
const EMPTY_TABLES = [
  "Label",
  "Team",
  "User",
  "ProjectUser",
  "TableView",
  "Incident",
  "Alert",
  "IncidentState",
  "AlertState",
  // A resource's Metrics card: no metric catalog in this workspace.
  "MetricType",
];

function isModelled(modelType) {
  const name = tableName(modelType);
  return Boolean(TABLES[name]) || EMPTY_TABLES.includes(name);
}

function sortRows(rows, sort) {
  const [sortField] = Object.keys(sort || {});
  if (!sortField) {
    return rows;
  }
  const direction = String(sort[sortField]).toLowerCase().startsWith("desc")
    ? -1
    : 1;
  return [...rows].sort((a, b) => {
    const left = a[sortField];
    const right = b[sortField];
    if (left instanceof Date || right instanceof Date) {
      return (
        ((left ? new Date(left).getTime() : 0) -
          (right ? new Date(right).getTime() : 0)) *
        direction
      );
    }
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * direction;
    }
    return String(left ?? "").localeCompare(String(right ?? "")) * direction;
  });
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  fixture.listRequests.push({
    modelName: name,
    query: serialize(options.query),
    sort: options.sort ? JSON.parse(JSON.stringify(options.sort)) : null,
    limit: options.limit,
  });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "list", modelName: name });
  }

  if (name === "CloudAccount" && failsNow("accounts")) {
    throw new HTTPErrorResponse(504, { message: READ_FAILED }, {});
  }

  const rows = sortRows(rowsOf(options.modelType, options.query), options.sort);
  const skip = options.skip || 0;
  const limit = options.limit || rows.length;

  return {
    data: rows.slice(skip, skip + limit).map((row) => {
      return Object.assign(new options.modelType(), row);
    }),
    count: rows.length,
    skip: skip,
    limit: limit,
  };
};

ModelAPI.count = async (options) => {
  const name = tableName(options.modelType);
  fixture.countRequests.push({
    modelName: name,
    query: serialize(options.query),
  });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "count", modelName: name });
  }

  return rowsOf(options.modelType, options.query).length;
};

ModelAPI.getItem = async (options) => {
  const name = tableName(options.modelType);
  fixture.itemRequests.push({ modelName: name, id: options.id.toString() });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "item", modelName: name });
    return null;
  }

  const found = (TABLES[name] || []).find((row) => {
    return row._id === options.id.toString();
  });

  return found ? Object.assign(new options.modelType(), found) : null;
};

// A budget made from Cloud > Budgets' form: kept, so the list shows it.
async function createRecord(options) {
  const name = tableName(options.modelType);
  const model = options.model;

  if (name !== "CloudBudget") {
    fixture.unhandled.push({ kind: "create", modelName: name });
    return new HTTPResponse(200, {}, {});
  }

  const relationId = (value) => {
    if (!value) {
      return "";
    }
    return String(value._id || value.id || value);
  };
  const created = {
    name: model.name,
    monthlyAmount: Number(model.monthlyAmount),
    currency: model.currency,
    cloudAccountId: relationId(model.cloudAccount || model.cloudAccountId),
    alertThresholds: model.alertThresholds,
    alertOnProjection: model.alertOnProjection,
    alertOnAnomaly: model.alertOnAnomaly,
    isEnabled: model.isEnabled,
    description: model.description || "",
  };
  fixture.creates.push({ modelName: name, data: created });

  const row = budget(BUDGETS.length + 1, {
    ...created,
    cloudAccountId: created.cloudAccountId || undefined,
    cloudAccount: created.cloudAccountId
      ? {
          name: (
            ACCOUNTS.find((account) => {
              return account._id === created.cloudAccountId;
            }) || { name: "" }
          ).name,
        }
      : undefined,
    // Not checked until the next read of the costs, or the hourly check.
    lastCheckedAt: undefined,
    spentThisMonth: 0,
    projectedThisMonth: 0,
  });
  BUDGETS.push(row);

  return new HTTPResponse(200, { _id: row._id }, {});
}

ModelAPI.create = createRecord;

// The forms save through createOrUpdate: a new record, or an edit of one.
ModelAPI.createOrUpdate = async (options) => {
  if (options.formType === FormType.Create) {
    return await createRecord(options);
  }
  const name = tableName(options.modelType);
  const id =
    options.model && options.model._id ? String(options.model._id) : "";
  fixture.updates.push({ modelName: name, id, data: { form: true } });
  const found = (TABLES[name] || []).find((row) => {
    return row._id === id;
  });
  if (!found) {
    fixture.unhandled.push({ kind: "form-update", modelName: name });
  }
  return new HTTPResponse(200, {}, {});
};

// A budget's switch, as the list's row switch saves it.
ModelAPI.updateById = async (options) => {
  const name = tableName(options.modelType);
  fixture.updates.push({
    modelName: name,
    id: options.id.toString(),
    data: JSON.parse(JSON.stringify(options.data || {})),
  });
  const found = (TABLES[name] || []).find((row) => {
    return row._id === options.id.toString();
  });
  if (found) {
    Object.assign(found, options.data);
  }
  return new HTTPResponse(200, {}, {});
};

/*
 * What the costs pages sum: the cost rows of the window, currency and
 * accounts asked for, by day or by one dimension (/aggregate's Sum).
 */
AnalyticsModelAPI.aggregate = async (options) => {
  const aggregateBy = options.aggregateBy || {};
  const query = aggregateBy.query || {};
  const groupBy = Object.keys(aggregateBy.groupBy || {});

  // A resource's readings, as OneUptime's own right-sizing reads them.
  if (options.modelType === Metric) {
    return answerMetric(aggregateBy, query);
  }

  fixture.aggregateRequests.push({
    modelName: tableName(options.modelType),
    interval: aggregateBy.aggregationInterval,
    groupBy: groupBy,
    query: serialize(query),
  });

  if (options.modelType !== CloudCost) {
    fixture.unhandled.push({
      kind: "aggregate",
      modelName: tableName(options.modelType),
    });
    return { data: [] };
  }

  // The daily spend and the breakdown each fail their first read.
  const card =
    aggregateBy.aggregationInterval === AggregationInterval.Day
      ? "costs-daily"
      : "costs-breakdown";
  if (FAILING.has("costs") && !failedOnce.has(card)) {
    failedOnce.add(card);
    throw new HTTPErrorResponse(504, { message: READ_FAILED }, {});
  }

  const rows = COST_ROWS.filter((row) => {
    if (query.currency && row.currency !== String(query.currency)) {
      return false;
    }
    if (query.resourceId && row.resourceId !== String(query.resourceId)) {
      return false;
    }
    if (query.cloudAccountId instanceof Includes) {
      if (
        !query.cloudAccountId.values.map(String).includes(row.cloudAccountId)
      ) {
        return false;
      }
    } else if (query.cloudAccountId) {
      if (String(query.cloudAccountId) !== row.cloudAccountId) {
        return false;
      }
    }
    if (query.day instanceof InBetween) {
      const time = row.day.getTime();
      if (
        time < new Date(query.day.startValue).getTime() ||
        time > new Date(query.day.endValue).getTime()
      ) {
        return false;
      }
    }
    return true;
  });

  const sums = new Map();
  for (const row of rows) {
    const key =
      aggregateBy.aggregationInterval === AggregationInterval.Day
        ? row.day.toISOString()
        : groupBy
            .map((field) => {
              return String(row[field] ?? "");
            })
            .join("\u0000");
    const entry = sums.get(key) || { row, value: 0 };
    entry.value += row.cost;
    sums.set(key, entry);
  }

  return {
    data: Array.from(sums.entries()).map(([key, entry]) => {
      if (aggregateBy.aggregationInterval === AggregationInterval.Day) {
        return {
          timestamp: key,
          value: Math.round(entry.value * 100) / 100,
        };
      }
      const result = { value: Math.round(entry.value * 100) / 100 };
      for (const field of groupBy) {
        result[field] = entry.row[field];
      }
      return result;
    }),
  };
};

/*
 * The last 14 days of what OneUptime read of a resource's CPU and memory,
 * by the attribute its readings are filed under: each figure one value
 * over the window, its first reading two weeks back.
 */
const USAGE = {
  [SHOP_WEB_1_ID]: {
    cpu: { [AggregationType.P95]: 12, [AggregationType.Max]: 30 },
    samples: 20160,
  },
  "sessions-cache": {
    cpu: { [AggregationType.P95]: 91, [AggregationType.Max]: 99 },
    memory: 62,
    samples: 4032,
  },
  "i-0batch1": {
    cpu: { [AggregationType.P95]: 8, [AggregationType.Max]: 22 },
    samples: 4032,
  },
};

function answerMetric(aggregateBy, query) {
  const attributes = query.attributes || {};
  const names =
    query.name instanceof Includes ? query.name.values : [query.name];
  fixture.metricRequests.push({
    aggregationType: aggregateBy.aggregationType,
    interval: aggregateBy.aggregationInterval,
    names: names.map(String),
    attributes: JSON.parse(JSON.stringify(attributes)),
  });

  const usage = Object.entries(USAGE).find(([value]) => {
    return Object.values(attributes).includes(value);
  });

  if (!usage) {
    return { data: [] };
  }

  const readings = usage[1];
  const isMemory = names.some((name) => {
    return String(name).includes("memory");
  });
  const first = new Date(LOADED_AT - 14 * DAY);
  let value = null;

  if (aggregateBy.aggregationType === AggregationType.Count) {
    value = isMemory ? null : readings.samples;
  } else if (isMemory) {
    value =
      aggregateBy.aggregationType === AggregationType.Max
        ? readings.memory ?? null
        : null;
  } else {
    value = readings.cpu[aggregateBy.aggregationType] ?? null;
  }

  return value === null
    ? { data: [] }
    : { data: [{ timestamp: first, value }] };
}

AnalyticsModelAPI.getList = async (options) => {
  /*
   * A resource's Metrics card lists its metrics: none in this fixture, as
   * for a resource whose provider has sent nothing in its window.
   */
  if (options.modelType === Metric) {
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  fixture.unhandled.push({
    kind: "analytics-list",
    modelName: tableName(options.modelType),
  });
  return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
};

AnalyticsModelAPI.count = async () => {
  return 0;
};

/*
 * What a resource's page and an account's Overview ask the server beyond
 * the models, answered as for a project that uses neither: Security
 * Events found nothing about the resource, and no Cloud AI agent is
 * connected to the account.
 */
function answerApi(method, url, body) {
  // The Metrics card's attribute keys: none, as for no metric yet.
  if (method === "POST" && url.endsWith("/telemetry/metrics/get-attributes")) {
    return { attributes: [] };
  }

  if (method === "POST" && url.endsWith("/security-case/resource-security")) {
    return {
      kind: body.kind,
      id: body.id,
      name: "",
      isInUse: false,
      windowDays: 7,
      values: [],
      isSearchedByLogs: false,
      entity: null,
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      lastSeen: null,
      openCases: null,
    };
  }

  if (method === "POST" && url.endsWith("/resource-ai-access/status")) {
    return {
      resourceType: "AwsAccount",
      resourceId: String(body.resourceId),
      resourceName: "",
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiSettingsSource: "oneuptime",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No Cloud AI agent is connected",
          nextStep:
            "To let OneUptime AI fix problems in this account, use \"Let AI fix problems\" on the account's Overview and run the command it shows in the cloud's own shell.",
          blocksInvestigation: false,
          blocksRemediation: true,
        },
      ],
      isInvestigationReady: true,
      isRemediationReady: false,
      automaticRemediation: { incidents: false, alerts: false },
    };
  }

  return null;
}

async function handleApi(method, options) {
  const url = new URL(options.url.toString(), window.location.origin);
  fixture.apiRequests.push({ method, url: url.pathname });
  const answer = answerApi(method, url.pathname, options.data || {});
  if (answer) {
    return new HTTPResponse(200, answer, {});
  }
  fixture.unhandled.push({ kind: "api", method, url: url.pathname });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

function subscribe() {
  return () => {};
}
Realtime.listenToAnalyticsModelEvent = subscribe;
Realtime.listenToModelEvent = subscribe;

/*
 * ---------------------------------------------------------------------------
 * Router, as App.tsx mounts the Cloud route group
 * ---------------------------------------------------------------------------
 */
const PAGE_PROPS = {
  pageRoute: RouteMap[PageMap.CLOUD_OVERVIEW],
  currentProject: project,
  hasPaymentMethod: true,
};

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

// A page the views link to that is not modelled: says where it is.
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

function CloudArea() {
  useNavigationHooks();
  return <CloudResourceRoutes {...PAGE_PROPS} />;
}

function FixtureApp() {
  useNavigationHooks();

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            OneUptime
          </span>
          <span className="text-sm text-gray-500">Acme Cloud</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route
          path={RouteMap[PageMap.CLOUD_ROOT].toString()}
          element={<CloudArea />}
        />
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

// As the Dashboard mounts it: navigations update synchronously.
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
