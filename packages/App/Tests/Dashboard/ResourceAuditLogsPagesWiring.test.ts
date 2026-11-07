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
import { AUDIT_LOG_ROOT_RESOURCE_TABLES } from "Common/Types/AuditLog/AuditLogCoverage";
import ObjectID from "Common/Types/ObjectID";

/*
 * WHERE PEOPLE FIND A RESOURCE'S HISTORY (issue #6187).
 *
 * Every project-scoped model is audited now, and a row that belongs to a
 * resource - an owner, a rule, a note, a variable - rolls its entries up to
 * that resource (Common/Types/AuditLog/AuditLogCoverage). So:
 *
 *   - every resource's Audit Logs page lists what rolls up to it, by the
 *     root pointer alone (a resourceType filter would keep the resource's own
 *     entries and drop the rest - and the Docker Swarm page asked for a type,
 *     "Docker Swarm Cluster", that no entry carries);
 *   - Queues, Databases, RUM applications and Teams, the resources that had
 *     no Audit Logs page, have one, where their neighbours have theirs;
 *   - every resource with a page is drawn, and linked, in the project-wide
 *     log, and a row with no page of its own opens its resource's.
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

// Every resource's Audit Logs page: Pages/<Product>/<View>/AuditLogs.tsx.
function resourceAuditLogPages(): Array<string> {
  const pages: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(path.join(DASHBOARD_SRC, directory), {
      withFileTypes: true,
    })) {
      const relative: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(relative);
      } else if (entry.name === "AuditLogs.tsx") {
        pages.push(relative);
      }
    }
  };

  walk("Pages");

  // The project-wide log, and its settings, are not a resource's.
  return pages
    .filter((page: string): boolean => {
      return !page.startsWith(path.join("Pages", "Settings"));
    })
    .sort();
}

const QUEUE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OWNER_ROW_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

describe("every resource's Audit Logs page", () => {
  const pages: Array<string> = resourceAuditLogPages();

  test("the sweep finds the pages (it is not vacuous)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(30);
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
      ]),
    );
  });
});

describe("the resources that had no Audit Logs page", () => {
  test.each([
    {
      name: "Queues",
      key: "MESSAGE_QUEUE_VIEW_AUDIT_LOGS",
      page: ["Pages", "MessageQueue", "View", "AuditLogs.tsx"],
      routes: "MessageQueueRoutes.tsx",
      menu: ["Pages", "MessageQueue", "View", "SideMenu.tsx"],
      breadcrumbs: "MessageQueueBreadcrumbs.ts",
      component: "MessageQueueAuditLogs",
    },
    {
      name: "Databases",
      key: "DATABASE_SERVER_VIEW_AUDIT_LOGS",
      page: ["Pages", "Database", "View", "AuditLogs.tsx"],
      routes: "DatabaseRoutes.tsx",
      menu: ["Pages", "Database", "View", "SideMenu.tsx"],
      breadcrumbs: "DatabaseBreadcrumbs.ts",
      component: "DatabaseServerAuditLogs",
    },
    {
      name: "RUM applications",
      key: "RUM_APPLICATION_VIEW_AUDIT_LOGS",
      page: ["Pages", "Rum", "View", "AuditLogs.tsx"],
      routes: "RumApplicationRoutes.tsx",
      menu: ["Pages", "Rum", "View", "SideMenu.tsx"],
      breadcrumbs: "RumBreadcrumbs.ts",
      component: "RumApplicationAuditLogs",
    },
    {
      name: "Teams",
      key: "TEAM_VIEW_AUDIT_LOGS",
      page: ["Pages", "Teams", "View", "AuditLogs.tsx"],
      routes: "TeamsRoutes.tsx",
      menu: ["Pages", "Teams", "View", "SideMenu.tsx"],
      breadcrumbs: "TeamsBreadcrumbs.ts",
      component: "TeamsViewAuditLogs",
    },
  ])(
    "$name: a page, a route, a menu item and breadcrumbs",
    (data: {
      key: string;
      page: Array<string>;
      routes: string;
      menu: Array<string>;
      breadcrumbs: string;
      component: string;
    }) => {
      expect((PageMap as unknown as Record<string, string>)[data.key]).toBe(
        data.key,
      );

      const routeMap: string = readDense("Utils", "RouteMap.ts");

      expect(routeMap).toContain(
        `[PageMap.${data.key}]: \`\${RouteParams.ModelID}/audit-logs\``,
      );
      expect(routeMap).toContain(`[PageMap.${data.key}]: new Route(`);

      const routes: string = readCode("Routes", data.routes);

      expect(routes).toContain(`<${data.component}`);
      expect(routes).toContain(`RouteMap[PageMap.${data.key}] as Route`);

      const menu: string = readCode(...data.menu);

      expect(menu).toContain('title: "Audit Logs"');
      expect(menu).toContain(`RouteMap[PageMap.${data.key}]`);
      // Audit Logs sits right before the delete item, as on its neighbours.
      expect(menu.indexOf(`RouteMap[PageMap.${data.key}]`)).toBeLessThan(
        menu.lastIndexOf("_DELETE]"),
      );

      expect(readCode("Utils", "Breadcrumbs", data.breadcrumbs)).toContain(
        `BuildBreadcrumbLinksByTitles(PageMap.${data.key}, [`,
      );
      expect(readCode(...data.page)).toContain("rootResourceId={modelId}");
    },
  );
});

describe("every resource with a page is drawn and linked in the project's log", () => {
  const rootTypes: Array<string> = (
    AllModelTypes as Array<{ new (): BaseModel }>
  )
    .map((modelType: { new (): BaseModel }): BaseModel => {
      return new modelType();
    })
    .filter((model: BaseModel): boolean => {
      return AUDIT_LOG_ROOT_RESOURCE_TABLES.has(model.tableName as string);
    })
    .map((model: BaseModel): string => {
      return model.singularName as string;
    });

  test("the sweep reads the roots", () => {
    expect(rootTypes.length).toBe(AUDIT_LOG_ROOT_RESOURCE_TABLES.size);
  });

  test.each(rootTypes)("%s has its icon and opens its page", (type: string) => {
    expect(RESOURCE_META[type]).toBeDefined();
    expect(RESOURCE_META[type]!.viewRoute).toBeDefined();
  });
});

describe("a row with no page of its own opens its resource's", () => {
  const queueMeta: ResourceMeta = getResourceMeta("Queue");

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
