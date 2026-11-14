import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_RESOURCE_META,
  RESOURCE_META,
  ResourceLink,
  ResourceMeta,
  getResourceLink,
  getResourceMeta,
} from "../../FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import DataPipeline from "Common/Models/DatabaseModels/DataPipeline";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Form from "Common/Models/DatabaseModels/Form";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import Team from "Common/Models/DatabaseModels/Team";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import { AUDIT_LOG_ROOT_RESOURCE_TABLES } from "Common/Types/AuditLog/AuditLogCoverage";
import { getApiSingularName } from "Common/Utils/ModelApiName";
import { AuditLogRootResource } from "Common/Types/BaseDatabase/EnableAuditLogOn";
import ObjectID from "Common/Types/ObjectID";

/*
 * WHERE PEOPLE FIND A RESOURCE'S HISTORY (issues #6187 and #6246).
 *
 * Every project-scoped model is audited now, and a row that belongs to a
 * resource - an owner, a rule, a note, a variable - rolls its entries up to
 * that resource (Common/Types/AuditLog/AuditLogCoverage). So:
 *
 *   - every resource's Audit Logs page lists what rolls up to it, by the
 *     root pointer alone (a resourceType filter would keep the resource's own
 *     entries and drop the rest - and the Docker Swarm page asked for a type,
 *     "Docker Swarm Cluster", that no entry carries);
 *   - the resources that had no Audit Logs page have one, where their
 *     neighbours have theirs: Queues, Databases, RUM applications and Teams
 *     (#6187), then network devices and sites, forms, cloud accounts and
 *     resources (and App Platforms' environments, the same rows), serverless
 *     functions, Data Observability's tables, pipelines and data products,
 *     exceptions, Data Security's stores and issues, code repositories and
 *     status page announcements (#6246);
 *   - every resource with a page is drawn, and linked, in the project-wide
 *     log, and a row with no page of its own opens its resource's;
 *   - and the other way round: every resource the log rolls entries up to
 *     has an Audit Logs page on its view. (That every resource's view menu
 *     links one is Common/Tests/App/Dashboard/ResourceViewMenusAuditLogs,
 *     which draws every menu.)
 *
 * Source-level (plain Node, no renderer); the pure helper module is imported.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadCodeFunction = (...segments: Array<string>) => string;

// A source file with its comments taken out and its white space collapsed.
const readCode: ReadCodeFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
};

/*
 * A source file with only its white space collapsed: RouteMap's paths hold
 * "/*" (a mount's wildcard), which readCode would take for a comment.
 */
const readDense: ReadCodeFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(/\s+/g, " ");
};

const TYPESCRIPT_SOURCE: RegExp = /\.tsx?$/;

// Every source file under a directory of Dashboard/src, relative to it.
function sourceFilesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(path.join(DASHBOARD_SRC, directory), {
    withFileTypes: true,
  })) {
    const relative: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(relative));
    } else if (TYPESCRIPT_SOURCE.test(entry.name)) {
      files.push(relative);
    }
  }

  return files;
}

/*
 * Every resource's Audit Logs page: each file that draws the audit log table
 * - Pages/<Product>/<View>/AuditLogs.tsx, and the exception's detail page,
 * which draws its Audit Logs section under the exception's summary.
 */
function resourceAuditLogPages(): Array<string> {
  return [...sourceFilesUnder("Pages"), ...sourceFilesUnder("Components")]
    .filter((file: string): boolean => {
      // The project-wide log, and the table itself, are not a resource's.
      return (
        !file.startsWith(path.join("Pages", "Settings")) &&
        !file.startsWith(path.join("Components", "AuditLogs")) &&
        readCode(file).includes("<AuditLogsTable")
      );
    })
    .sort();
}

// The relative path a page has in its product's RoutePath dictionary.
function routePathOf(key: string): string | undefined {
  const routeMap: string = readDense("Utils", "RouteMap.ts");
  const match: RegExpMatchArray | null = routeMap.match(
    new RegExp(`\\[PageMap\\.${key}\\]: \`([^\`]*)\`,`),
  );

  return match ? match[1] : undefined;
}

const QUEUE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OWNER_ROW_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ROOT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

type ModelType = { new (): BaseModel };

const MODELS: Array<BaseModel> = (AllModelTypes as Array<ModelType>).map(
  (modelType: ModelType): BaseModel => {
    return new modelType();
  },
);

describe("every resource's Audit Logs page", () => {
  const pages: Array<string> = resourceAuditLogPages();

  test("the sweep finds the pages (it is not vacuous)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(48);
  });

  test.each(pages)(
    "%s lists everything that rolls up to its resource",
    (page: string) => {
      const source: string = readCode(page);

      expect(source).toContain("<AuditLogsTable");
      expect(source).toContain("rootResourceId={");
      expect(source).not.toContain("resourceType=");
      expect(source).not.toMatch(/\sresourceId=\{/);
    },
  );

  test("the resources that had none have one now", () => {
    expect(pages).toEqual(
      expect.arrayContaining([
        path.join("Pages", "MessageQueue", "View", "AuditLogs.tsx"),
        path.join("Pages", "Database", "View", "AuditLogs.tsx"),
        path.join("Pages", "Rum", "View", "AuditLogs.tsx"),
        path.join("Pages", "Teams", "View", "AuditLogs.tsx"),
        path.join("Pages", "Workflow", "View", "AuditLogs.tsx"),
        path.join("Pages", "NetworkDevice", "View", "AuditLogs.tsx"),
        path.join("Pages", "NetworkSite", "View", "AuditLogs.tsx"),
        path.join("Pages", "Forms", "View", "AuditLogs.tsx"),
        path.join("Pages", "Cloud", "Accounts", "View", "AuditLogs.tsx"),
        path.join("Pages", "Cloud", "View", "AuditLogs.tsx"),
        path.join("Pages", "AppPlatforms", "View", "AuditLogs.tsx"),
        path.join("Pages", "Serverless", "View", "AuditLogs.tsx"),
        path.join("Pages", "DataObservability", "TableView", "AuditLogs.tsx"),
        path.join("Pages", "DataPipeline", "View", "AuditLogs.tsx"),
        path.join("Pages", "DataProduct", "View", "AuditLogs.tsx"),
        path.join("Components", "Exceptions", "ExceptionExplorer.tsx"),
        path.join("Pages", "DataSecurity", "StoreView", "AuditLogs.tsx"),
        path.join("Pages", "DataSecurity", "IssueView", "AuditLogs.tsx"),
        path.join("Pages", "Code", "Repository", "AuditLogs.tsx"),
        path.join(
          "Pages",
          "StatusPages",
          "Announcements",
          "View",
          "AuditLogs.tsx",
        ),
      ]),
    );
  });
});

interface NewPage {
  name: string;
  // The resource the page is about, a root its rows roll up to.
  model: ModelType;
  // Its Audit Logs page, and the view page it is a tab of.
  key: string;
  view: string;
  // Where the page, its route, its menu item and its trail are.
  page: Array<string>;
  // What the page passes as the root: the id the route carries.
  root: string;
  routes: string;
  // The element the route draws, as the routes file writes it.
  element: string;
  menu: Array<string>;
  breadcrumbs: Array<string>;
}

const NEW_PAGES: Array<NewPage> = [
  {
    name: "Queues",
    model: MessageQueue,
    key: "MESSAGE_QUEUE_VIEW_AUDIT_LOGS",
    view: "MESSAGE_QUEUE_VIEW",
    page: ["Pages", "MessageQueue", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "MessageQueueRoutes.tsx",
    element: "<MessageQueueAuditLogs",
    menu: ["Pages", "MessageQueue", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "MessageQueueBreadcrumbs.ts"],
  },
  {
    name: "Databases",
    model: DatabaseServer,
    key: "DATABASE_SERVER_VIEW_AUDIT_LOGS",
    view: "DATABASE_SERVER_VIEW",
    page: ["Pages", "Database", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "DatabaseRoutes.tsx",
    element: "<DatabaseServerAuditLogs",
    menu: ["Pages", "Database", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "DatabaseBreadcrumbs.ts"],
  },
  {
    name: "RUM applications",
    model: RumApplication,
    key: "RUM_APPLICATION_VIEW_AUDIT_LOGS",
    view: "RUM_APPLICATION_VIEW",
    page: ["Pages", "Rum", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "RumApplicationRoutes.tsx",
    element: "<RumApplicationAuditLogs",
    menu: ["Pages", "Rum", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "RumBreadcrumbs.ts"],
  },
  {
    name: "Teams",
    model: Team,
    key: "TEAM_VIEW_AUDIT_LOGS",
    view: "TEAM_VIEW",
    page: ["Pages", "Teams", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "TeamsRoutes.tsx",
    element: "<TeamsViewAuditLogs",
    menu: ["Pages", "Teams", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "TeamsBreadcrumbs.ts"],
  },
  {
    name: "Network devices",
    model: NetworkDevice,
    key: "NETWORK_DEVICE_VIEW_AUDIT_LOGS",
    view: "NETWORK_DEVICE_VIEW",
    page: ["Pages", "NetworkDevice", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "NetworkDeviceRoutes.tsx",
    element: "<NetworkDeviceAuditLogs",
    menu: ["Pages", "NetworkDevice", "View", "SideMenu.tsx"],
    breadcrumbs: ["Pages", "NetworkDevice", "Utils", "Breadcrumbs.ts"],
  },
  {
    name: "Network sites",
    model: NetworkSite,
    key: "NETWORK_SITE_VIEW_AUDIT_LOGS",
    view: "NETWORK_SITE_VIEW",
    page: ["Pages", "NetworkSite", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "NetworkSiteRoutes.tsx",
    element: "<NetworkSiteViewAuditLogs",
    menu: ["Pages", "NetworkSite", "View", "SideMenu.tsx"],
    breadcrumbs: ["Pages", "NetworkSite", "Utils", "Breadcrumbs.ts"],
  },
  {
    name: "Forms",
    model: Form,
    key: "FORM_VIEW_AUDIT_LOGS",
    view: "FORM_VIEW",
    page: ["Pages", "Forms", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "FormsRoutes.tsx",
    element: "<FormAuditLogs",
    menu: ["Pages", "Forms", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "FormsBreadcrumbs.ts"],
  },
  {
    name: "Cloud accounts",
    model: CloudAccount,
    key: "CLOUD_ACCOUNT_VIEW_AUDIT_LOGS",
    view: "CLOUD_ACCOUNT_VIEW",
    page: ["Pages", "Cloud", "Accounts", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "CloudResourceRoutes.tsx",
    element: "<CloudAccountAuditLogs",
    menu: ["Pages", "Cloud", "Accounts", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "CloudBreadcrumbs.ts"],
  },
  {
    name: "Cloud resources",
    model: CloudResource,
    key: "CLOUD_RESOURCE_VIEW_AUDIT_LOGS",
    view: "CLOUD_RESOURCE_VIEW",
    page: ["Pages", "Cloud", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "CloudResourceRoutes.tsx",
    element: "<CloudResourceAuditLogs",
    menu: ["Pages", "Cloud", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "CloudBreadcrumbs.ts"],
  },
  {
    // An environment is a CloudResource row too, with its pages in App Platforms.
    name: "App Platforms environments",
    model: CloudResource,
    key: "APP_PLATFORMS_ENVIRONMENT_VIEW_AUDIT_LOGS",
    view: "APP_PLATFORMS_ENVIRONMENT_VIEW",
    page: ["Pages", "AppPlatforms", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "AppPlatformsRoutes.tsx",
    element: "<AppPlatformEnvironmentAuditLogs",
    menu: ["Pages", "AppPlatforms", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "AppPlatformsBreadcrumbs.ts"],
  },
  {
    name: "Serverless functions",
    model: ServerlessFunction,
    key: "SERVERLESS_FUNCTION_VIEW_AUDIT_LOGS",
    view: "SERVERLESS_FUNCTION_VIEW",
    page: ["Pages", "Serverless", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "ServerlessRoutes.tsx",
    element: "<ServerlessFunctionAuditLogs",
    menu: ["Pages", "Serverless", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "ServerlessBreadcrumbs.ts"],
  },
  {
    name: "Data Observability tables",
    model: DataAsset,
    key: "DATA_OBSERVABILITY_TABLE_VIEW_AUDIT_LOGS",
    view: "DATA_OBSERVABILITY_TABLE_VIEW",
    page: ["Pages", "DataObservability", "TableView", "AuditLogs.tsx"],
    root: "modelId",
    routes: "DataObservabilityRoutes.tsx",
    element: "<TableAuditLogsPage",
    menu: ["Pages", "DataObservability", "TableView", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "DataObservabilityBreadcrumbs.ts"],
  },
  {
    name: "Data Observability pipelines",
    model: DataPipeline,
    key: "DATA_OBSERVABILITY_PIPELINE_VIEW_AUDIT_LOGS",
    view: "DATA_OBSERVABILITY_PIPELINE_VIEW",
    page: ["Pages", "DataPipeline", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "DataObservabilityRoutes.tsx",
    element: "<DataPipelineAuditLogsPage",
    menu: ["Pages", "DataPipeline", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "DataObservabilityBreadcrumbs.ts"],
  },
  {
    name: "Data products",
    model: DataProduct,
    key: "DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_AUDIT_LOGS",
    view: "DATA_OBSERVABILITY_DATA_PRODUCT_VIEW",
    page: ["Pages", "DataProduct", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "DataObservabilityRoutes.tsx",
    element: "<DataProductAuditLogsPage",
    menu: ["Pages", "DataProduct", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "DataObservabilityBreadcrumbs.ts"],
  },
  {
    // A section of the exception's page, under the summary every one of its pages shows.
    name: "Exceptions",
    model: TelemetryException,
    key: "EXCEPTIONS_VIEW_AUDIT_LOGS",
    view: "EXCEPTIONS_VIEW",
    page: ["Components", "Exceptions", "ExceptionExplorer.tsx"],
    root: "props.telemetryExceptionId",
    routes: "ExceptionsRoutes.tsx",
    element: "<ExceptionView",
    menu: ["Pages", "Exceptions", "View", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "ExceptionsBreadcrumbs.ts"],
  },
  {
    name: "Data Security stores",
    model: DataStore,
    key: "DATA_SECURITY_STORE_VIEW_AUDIT_LOGS",
    view: "DATA_SECURITY_STORE_VIEW",
    page: ["Pages", "DataSecurity", "StoreView", "AuditLogs.tsx"],
    root: "modelId",
    routes: "DataSecurityRoutes.tsx",
    element: "<DataStoreAuditLogsPage",
    menu: ["Pages", "DataSecurity", "StoreView", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "DataSecurityBreadcrumbs.ts"],
  },
  {
    // Its menu is data (IssueViewMenu), which the side menu draws.
    name: "Data Security issues",
    model: DataSecurityIssue,
    key: "DATA_SECURITY_ISSUE_VIEW_AUDIT_LOGS",
    view: "DATA_SECURITY_ISSUE_VIEW",
    page: ["Pages", "DataSecurity", "IssueView", "AuditLogs.tsx"],
    root: "modelId",
    routes: "DataSecurityRoutes.tsx",
    element: "<DataSecurityIssueAuditLogsPage",
    menu: ["Components", "DataSecurity", "IssueViewMenu.ts"],
    breadcrumbs: ["Utils", "Breadcrumbs", "DataSecurityBreadcrumbs.ts"],
  },
  {
    name: "Code repositories",
    model: CodeRepository,
    key: "CODE_REPOSITORY_VIEW_AUDIT_LOGS",
    view: "CODE_REPOSITORY_VIEW",
    page: ["Pages", "Code", "Repository", "AuditLogs.tsx"],
    root: "modelId",
    routes: "CodeRoutes.tsx",
    element: "<CodeRepositoryAuditLogs",
    menu: ["Pages", "Code", "Repository", "SideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "CodeBreadcrumbs.ts"],
  },
  {
    name: "Status page announcements",
    model: StatusPageAnnouncement,
    key: "ANNOUNCEMENT_VIEW_AUDIT_LOGS",
    view: "ANNOUNCEMENT_VIEW",
    page: ["Pages", "StatusPages", "Announcements", "View", "AuditLogs.tsx"],
    root: "modelId",
    routes: "StatusPagesRoutes.tsx",
    element: "<AnnouncementViewAuditLogs",
    menu: ["Pages", "StatusPages", "AnnouncementSideMenu.tsx"],
    breadcrumbs: ["Utils", "Breadcrumbs", "StatusPagesBreadcrumbs.ts"],
  },
];

describe("the resources that had no Audit Logs page", () => {
  test.each(NEW_PAGES)(
    "$name: a page under the view, a route, a menu item and breadcrumbs",
    (data: NewPage) => {
      expect((PageMap as unknown as Record<string, string>)[data.key]).toBe(
        data.key,
      );

      // A tab of the view: its path is the view's, and then audit-logs.
      const viewPath: string | undefined = routePathOf(data.view);

      expect(viewPath).toBeDefined();
      expect(viewPath).toContain("${RouteParams.ModelID}");
      expect(routePathOf(data.key)).toBe(`${viewPath}/audit-logs`);
      expect(readDense("Utils", "RouteMap.ts")).toContain(
        `[PageMap.${data.key}]: new Route(`,
      );

      const routes: string = readCode("Routes", data.routes);

      expect(routes).toContain(data.element);
      expect(routes).toMatch(
        new RegExp(`RouteMap\\[\\s?PageMap\\.${data.key}\\s?\\] as Route`),
      );

      const menu: string = readCode(...data.menu);
      const item: number = menu.indexOf(`PageMap.${data.key}`);

      expect(item).toBeGreaterThan(-1);
      /*
       * Its own item, titled as every resource's is, whether the menu is JSX
       * (title before the route) or data (page before the title).
       */
      const after: number = menu.indexOf("PageMap.", item + 1);
      const itemWindow: string = menu.slice(
        menu.lastIndexOf("PageMap.", item - 1) + 1,
        after < 0 ? menu.length : after,
      );

      expect(itemWindow.split('title: "Audit Logs"')).toHaveLength(2);

      // Audit Logs sits right before the delete item, as on its neighbours.
      if (menu.includes("_DELETE")) {
        expect(item).toBeLessThan(menu.lastIndexOf("_DELETE"));
      }

      expect(readCode(...data.breadcrumbs)).toMatch(
        new RegExp(
          `BuildBreadcrumbLinksByTitles\\(\\s?PageMap\\.${data.key},\\s?\\[[^\\]]*"Audit Logs",?\\s?\\]`,
        ),
      );
      expect(readCode(...data.page)).toContain(`rootResourceId={${data.root}}`);
    },
  );

  test.each(NEW_PAGES)(
    "$name: its resource is a root, drawn in the project's log and linked to its view",
    (data: NewPage) => {
      const model: BaseModel = new data.model();

      expect(
        AUDIT_LOG_ROOT_RESOURCE_TABLES.has(model.tableName as string),
      ).toBe(true);
      expect(RESOURCE_META[getApiSingularName(model)]).toBeDefined();
    },
  );

  test("the exception's page draws the Audit Logs section for its own route", () => {
    expect(readCode("Routes", "ExceptionsRoutes.tsx")).toContain(
      "pageRoute={RouteMap[PageMap.EXCEPTIONS_VIEW_AUDIT_LOGS] as Route} section={ExceptionDetailSection.AuditLogs}",
    );
    expect(
      readCode("Components", "Exceptions", "ExceptionDetailSection.ts"),
    ).toContain('AuditLogs = "audit-logs"');
    expect(
      readCode("Components", "Exceptions", "ExceptionExplorer.tsx"),
    ).toContain(
      "{props.section === ExceptionDetailSection.AuditLogs && ( <AuditLogsTable",
    );
  });

  test("a cloud resource's Audit Logs is a tab of both its products, so a forward keeps it", () => {
    const pages: string = readCode("Utils", "CloudResourceViewPages.ts");

    expect(pages).toContain('AuditLogs = "audit-logs"');
    expect(pages).toContain(
      "[CloudResourceViewTab.AuditLogs]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_AUDIT_LOGS",
    );
    expect(pages).toContain(
      "[CloudResourceViewTab.AuditLogs]: PageMap.CLOUD_RESOURCE_VIEW_AUDIT_LOGS",
    );
  });
});

const ROOTS: Array<BaseModel> = MODELS.filter((model: BaseModel): boolean => {
  return AUDIT_LOG_ROOT_RESOURCE_TABLES.has(model.tableName as string);
});

describe("every resource with a page is drawn and linked in the project's log", () => {
  /*
   * The type an entry is stored under: the model's kept API name when the
   * screen renamed it (#6817), so old entries and new ones are one type.
   */
  const rootTypes: Array<string> = ROOTS.map((model: BaseModel): string => {
    return getApiSingularName(model);
  });

  test("the sweep reads the roots", () => {
    expect(rootTypes.length).toBe(AUDIT_LOG_ROOT_RESOURCE_TABLES.size);
    expect(rootTypes.length).toBeGreaterThanOrEqual(47);
  });

  test.each(rootTypes)("%s has its icon and opens its page", (type: string) => {
    expect(RESOURCE_META[type]).toBeDefined();
    expect(RESOURCE_META[type]!.viewRoute).toBeDefined();
  });

  /*
   * The other way round: a resource the log rolls entries up to has an Audit
   * Logs page on its view, so its history is never only in the project-wide
   * log. A new root without one fails here.
   */
  test.each(rootTypes)(
    "%s has an Audit Logs page on its view",
    (type: string) => {
      const view: string = RESOURCE_META[type]!.viewRoute as string;
      const auditLogs: string = `${view}_AUDIT_LOGS`;

      expect((PageMap as unknown as Record<string, string>)[auditLogs]).toBe(
        auditLogs,
      );
      expect(routePathOf(auditLogs)).toBe(`${routePathOf(view)}/audit-logs`);
    },
  );
});

/*
 * Every row that rolls up to a resource and has no page of its own - an
 * owner, a domain, a rule, a verdict on a finding - opens the resource it
 * belongs to from the project-wide log, while it exists and once deleted.
 */
const ROWS_WITHOUT_A_PAGE: Array<[string, string, string]> = MODELS.filter(
  (model: BaseModel): boolean => {
    const root: AuditLogRootResource | undefined =
      model.enableAuditLogOn?.rootResource;

    return Boolean(
      root &&
        rootTypeIsRoot(root.resourceType) &&
        !RESOURCE_META[model.singularName as string],
    );
  },
).map((model: BaseModel): [string, string, string] => {
  return [
    model.tableName as string,
    model.singularName as string,
    model.enableAuditLogOn!.rootResource!.resourceType,
  ];
});

function rootTypeIsRoot(resourceType: string): boolean {
  return ROOTS.some((root: BaseModel): boolean => {
    return root.singularName === resourceType;
  });
}

describe("a row with no page of its own opens its resource's", () => {
  const queueMeta: ResourceMeta = getResourceMeta("Queue");

  test("the sweep finds the rows (it is not vacuous)", () => {
    expect(ROWS_WITHOUT_A_PAGE.length).toBeGreaterThanOrEqual(80);
    expect(
      ROWS_WITHOUT_A_PAGE.map((row: [string, string, string]): string => {
        return row[0];
      }),
    ).toEqual(
      expect.arrayContaining([
        "MessageQueueOwnerUser",
        "NetworkDeviceOwnerUser",
        "NetworkDeviceDiagnostic",
        "NetworkSiteAssignmentRule",
        "FormDomain",
        "FormSubmission",
        "CloudResourceOwnerTeam",
        "ServerlessFunctionOwnerUser",
        "DataAssetOwnerUser",
        "DataStoreOwnerTeam",
        "DataStoreFinding",
      ]),
    );
  });

  test.each(ROWS_WITHOUT_A_PAGE)(
    "%s (%s) opens its %s, and still does once deleted",
    (_table: string, type: string, rootType: string) => {
      const rootMeta: ResourceMeta = getResourceMeta(rootType);

      expect(rootMeta).not.toBe(DEFAULT_RESOURCE_META);

      for (const action of ["Create", "Update", "Delete"]) {
        expect(
          getResourceLink({
            meta: getResourceMeta(type),
            action,
            resourceId: OWNER_ROW_ID,
            rootResourceId: ROOT_ID,
            rootMeta,
          }),
        ).toEqual({ page: rootMeta.viewRoute, modelId: ROOT_ID });
      }
    },
  );

  test("a network device's owner opens the device; a form's domain the form; a finding's verdict its store", () => {
    for (const [type, rootType, page] of [
      [
        "Network Device User Owner",
        "Network Device",
        PageMap.NETWORK_DEVICE_VIEW,
      ],
      ["Form Domain", "Form", PageMap.FORM_VIEW],
      ["Data Store Finding", "Data Store", PageMap.DATA_SECURITY_STORE_VIEW],
    ] as Array<[string, string, PageMap]>) {
      expect(
        getResourceLink({
          meta: getResourceMeta(type),
          action: "Update",
          resourceId: OWNER_ROW_ID,
          rootResourceId: ROOT_ID,
          rootMeta: getResourceMeta(rootType),
        }),
      ).toEqual({ page, modelId: ROOT_ID });
    }
  });

  test("a queue's owner opens the queue, and still does once deleted", () => {
    for (const action of ["Create", "Delete"]) {
      const link: ResourceLink | null = getResourceLink({
        meta: getResourceMeta("Queue User Owner"),
        action,
        resourceId: OWNER_ROW_ID,
        rootResourceId: QUEUE_ID,
        rootMeta: queueMeta,
      });

      expect(link).toEqual({
        page: PageMap.MESSAGE_QUEUE_VIEW,
        modelId: QUEUE_ID,
      });
    }
  });

  test("a row that is its own root, or whose root has no page, opens nothing", () => {
    expect(
      getResourceLink({
        meta: DEFAULT_RESOURCE_META,
        action: "Update",
        resourceId: OWNER_ROW_ID,
        rootResourceId: OWNER_ROW_ID,
        rootMeta: queueMeta,
      }),
    ).toBeNull();
    expect(
      getResourceLink({
        meta: DEFAULT_RESOURCE_META,
        action: "Update",
        resourceId: OWNER_ROW_ID,
        rootResourceId: QUEUE_ID,
        rootMeta: DEFAULT_RESOURCE_META,
      }),
    ).toBeNull();
    expect(
      getResourceLink({
        meta: DEFAULT_RESOURCE_META,
        action: "Update",
        resourceId: OWNER_ROW_ID,
        rootResourceId: undefined,
        rootMeta: queueMeta,
      }),
    ).toBeNull();
  });

  test("a resource with a page of its own opens its own, never its root's", () => {
    expect(
      getResourceLink({
        meta: queueMeta,
        action: "Update",
        resourceId: QUEUE_ID,
        rootResourceId: QUEUE_ID,
        rootMeta: queueMeta,
      }),
    ).toEqual({ page: PageMap.MESSAGE_QUEUE_VIEW, modelId: QUEUE_ID });

    // A deleted resource with a page of its own has nowhere to go.
    expect(
      getResourceLink({
        meta: queueMeta,
        action: "Delete",
        resourceId: QUEUE_ID,
        rootResourceId: QUEUE_ID,
        rootMeta: queueMeta,
      }),
    ).toBeNull();
  });
});
