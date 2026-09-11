import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

interface ArchivableResource {
  resource: string;
  model: string;
  overview?: string;
}

const RESOURCES: Array<ArchivableResource> = [
  { resource: "Rum", model: "RumApplication" },
  { resource: "Cloud", model: "CloudResource" },
  { resource: "Serverless", model: "ServerlessFunction" },
  { resource: "Kubernetes", model: "KubernetesCluster", overview: "Index.tsx" },
  { resource: "Docker", model: "DockerHost" },
  { resource: "Podman", model: "PodmanHost" },
  { resource: "DockerSwarm", model: "DockerSwarmCluster", overview: "Index.tsx" },
  { resource: "Host", model: "Host" },
  { resource: "Ceph", model: "CephCluster", overview: "Index.tsx" },
  { resource: "VMware", model: "VMwareVCenter", overview: "Index.tsx" },
  { resource: "IoT", model: "IoTFleet", overview: "Index.tsx" },
  { resource: "Proxmox", model: "ProxmoxCluster", overview: "Index.tsx" },
  { resource: "NetworkDevice", model: "NetworkDevice", overview: "Index.tsx" },
  { resource: "Service", model: "Service", overview: "Index.tsx" },
  { resource: "Inventory", model: "InventoryItem", overview: "Index.tsx" },
];

function readSource(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function getPageFiles(directory: string): Array<string> {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry: fs.Dirent): Array<string> => {
      const filename: string = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return getPageFiles(filename);
      }

      return entry.name.endsWith(".tsx") ? [filename] : [];
    },
  );
}

/*
 * The browser integration suite exercises the three newly added Settings
 * pages. This repository-wide guard catches the placement regression on any
 * resource, including a future resource copied from an old Overview page.
 */
describe("resource archive controls belong to Settings", () => {
  test.each(RESOURCES)(
    "$resource Settings retains exactly one archive card for its own model",
    ({ resource, model }: ArchivableResource): void => {
      const settings: string = readSource(
        `Pages/${resource}/View/Settings.tsx`,
      );

      expect(settings.match(/<ArchiveResourceCard\b/g)).toHaveLength(1);
      expect(settings).toContain(`<ArchiveResourceCard<${model}>`);
      expect(settings).toContain(`modelType={${model}}`);
    },
  );

  test.each(RESOURCES)(
    "$resource Overview has no archive control",
    ({ resource, overview }: ArchivableResource): void => {
      expect(
        readSource(`Pages/${resource}/View/${overview || "Overview.tsx"}`),
      ).not.toContain("ArchiveResourceCard");
    },
  );

  test("every resource page that imports an archive card is a Settings page", () => {
    const archivePages: Array<string> = getPageFiles(
      path.join(DASHBOARD_SRC, "Pages"),
    )
      .map((filename: string): string => {
        return path.relative(DASHBOARD_SRC, filename);
      })
      .filter((filename: string): boolean => {
        return readSource(filename).includes("ArchiveResourceCard");
      });

    expect(archivePages.sort()).toEqual(
      RESOURCES.map(({ resource }: ArchivableResource): string => {
        return `Pages/${resource}/View/Settings.tsx`;
      }).sort(),
    );
  });
});

interface SettingsRoute {
  router: string;
  resource: string;
  component: string;
  pageKey: string;
}

const NEW_SETTINGS_ROUTES: Array<SettingsRoute> = [
  {
    router: "RumApplicationRoutes",
    resource: "Rum",
    component: "RumApplicationSettings",
    pageKey: "RUM_APPLICATION_VIEW_SETTINGS",
  },
  {
    router: "CloudResourceRoutes",
    resource: "Cloud",
    component: "CloudResourceSettings",
    pageKey: "CLOUD_RESOURCE_VIEW_SETTINGS",
  },
  {
    router: "ServerlessRoutes",
    resource: "Serverless",
    component: "ServerlessFunctionSettings",
    pageKey: "SERVERLESS_FUNCTION_VIEW_SETTINGS",
  },
];

describe("the new Settings destinations are registered with their resource routers", () => {
  test.each(NEW_SETTINGS_ROUTES)(
    "$resource routes Settings to the page that contains the archive card",
    ({ router, resource, component, pageKey }: SettingsRoute): void => {
      const source: string = readSource(`Routes/${router}.tsx`);
      const routes: Array<string> =
        source.match(/<PageRoute\b[\s\S]*?(?=<PageRoute\b|$)/g) || [];
      const settingsRoutes: Array<string> = routes.filter(
        (route: string): boolean => {
          return new RegExp(
            `path=\\{RouteUtil\\.getLastPathForKey\\(\\s*PageMap\\.${pageKey}\\s*,?\\s*\\)\\}`,
          ).test(route);
        },
      );

      expect(source).toContain(
        `import ${component} from "../Pages/${resource}/View/Settings"`,
      );
      expect(settingsRoutes).toHaveLength(1);
      expect(settingsRoutes[0]).toContain(`<${component}`);
      expect(settingsRoutes[0]).toMatch(
        new RegExp(`pageRoute=\\{\\s*RouteMap\\[PageMap\\.${pageKey}\\]`),
      );
    },
  );
});
