import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "View" button on an Archived list must open the row's own page.
 *
 * Given only a viewPageRoute, ModelTable's View button navigates to
 * `${viewPageRoute}/${id}`. An Archived page is mounted at ".../archived", so
 * handing it the current route (Navigation.getCurrentRoute(), the page's own
 * pageRoute, or the *_ARCHIVED route) builds ".../archived/<id>" — a URL no
 * route matches, and the user lands on a blank page. Archived pages resolve
 * the view page themselves with onViewPage instead.
 *
 * Pinned at the source level (the App suite has no renderer and
 * App/tsconfig.json excludes the dashboard). The pages are discovered from
 * the filesystem, so a new product's Archived page is covered without editing
 * this file. Comments are stripped so a rationale comment that mentions
 * viewPageRoute cannot make a test pass or fail.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const PAGES_DIR: string = path.join(DASHBOARD_SRC, "Pages");

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(filePath: string): string {
  return stripComments(fs.readFileSync(filePath, "utf8")).replace(/\s+/g, " ");
}

// Every `prop={...}` expression in the source, braces balanced.
function propExpressions(code: string, prop: string): Array<string> {
  const expressions: Array<string> = [];
  const opener: string = `${prop}={`;
  let start: number = code.indexOf(opener);

  while (start >= 0) {
    let depth: number = 1;
    let index: number = start + opener.length;

    while (index < code.length && depth > 0) {
      if (code[index] === "{") {
        depth++;
      } else if (code[index] === "}") {
        depth--;
      }
      index++;
    }

    if (depth !== 0) {
      throw new Error(`Unbalanced braces after "${opener}".`);
    }

    expressions.push(code.slice(start + opener.length, index - 1).trim());
    start = code.indexOf(opener, index);
  }

  return expressions;
}

function findArchivedPages(): Array<string> {
  return fs
    .readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((entry: fs.Dirent) => {
      return (
        entry.isDirectory() &&
        fs.existsSync(path.join(PAGES_DIR, entry.name, "Archived.tsx"))
      );
    })
    .map((entry: fs.Dirent) => {
      return entry.name;
    })
    .sort();
}

// Expressions that evaluate to the Archived page's own URL.
const CURRENT_ROUTE_PATTERN: RegExp =
  /Navigation\.getCurrentRoute\(\)|props\.pageRoute|PageMap\.\w*ARCHIVED\b/;

/*
 * The products whose Archived pages sent View to ".../archived/<id>", plus
 * the ones that were already right, with the page View must open.
 */
const VIEW_PAGE_BY_PRODUCT: Record<string, string> = {
  Ceph: "CEPH_CLUSTER_VIEW",
  Cloud: "CLOUD_RESOURCE_VIEW",
  Database: "DATABASE_SERVER_VIEW",
  Docker: "DOCKER_HOST_VIEW",
  DockerSwarm: "DOCKER_SWARM_CLUSTER_VIEW",
  Host: "HOST_VIEW",
  IoT: "IOT_FLEET_VIEW",
  Kubernetes: "KUBERNETES_CLUSTER_VIEW",
  NetworkDevice: "NETWORK_DEVICE_VIEW",
  Podman: "PODMAN_HOST_VIEW",
  Proxmox: "PROXMOX_CLUSTER_VIEW",
  Rum: "RUM_APPLICATION_VIEW",
  Serverless: "SERVERLESS_FUNCTION_VIEW",
  Service: "SERVICE_VIEW",
  VMware: "VMWARE_VCENTER_VIEW",
};

const ARCHIVED_PAGES: Array<string> = findArchivedPages();

describe("Archived page View links", () => {
  test("discovers every product's Archived page", () => {
    // Guards the discovery itself: an empty list would pass everything below.
    for (const product of Object.keys(VIEW_PAGE_BY_PRODUCT)) {
      expect(ARCHIVED_PAGES).toContain(product);
    }
  });

  describe.each(ARCHIVED_PAGES)("Pages/%s/Archived.tsx", (product: string) => {
    const code: string = readCode(
      path.join(PAGES_DIR, product, "Archived.tsx"),
    );

    test("does not pass the current route as its view route", () => {
      for (const expression of propExpressions(code, "viewPageRoute")) {
        expect(expression).not.toMatch(CURRENT_ROUTE_PATTERN);
      }
    });

    test("a viewable table says where View goes", () => {
      /*
       * With neither prop, ModelTable throws "props.viewPageRoute not found"
       * when View is clicked.
       */
      if (!code.includes("isViewable={true}")) {
        return;
      }

      const targets: number =
        propExpressions(code, "onViewPage").length +
        propExpressions(code, "viewPageRoute").length;

      expect(targets).toBeGreaterThan(0);
    });

    test("onViewPage does not resolve to the Archived page", () => {
      for (const expression of propExpressions(code, "onViewPage")) {
        expect(expression).not.toMatch(CURRENT_ROUTE_PATTERN);
      }
    });
  });

  describe.each(Object.entries(VIEW_PAGE_BY_PRODUCT))(
    "Pages/%s/Archived.tsx",
    (product: string, viewPage: string) => {
      test(`View opens ${viewPage}`, () => {
        const code: string = readCode(
          path.join(PAGES_DIR, product, "Archived.tsx"),
        );
        const onViewPage: Array<string> = propExpressions(code, "onViewPage");

        expect(onViewPage).toHaveLength(1);
        expect(onViewPage[0]).toContain(`RouteMap[PageMap.${viewPage}]`);
        expect(onViewPage[0]).toContain("modelId:");
        expect(propExpressions(code, "viewPageRoute")).toHaveLength(0);
      });

      test(`${viewPage} is the resource's own /:id page`, () => {
        /*
         * The product's route-path table maps the view page to the bare model
         * id (".../<product>/:id"), not to a path under "archived".
         */
        const routeMap: string = readCode(
          path.join(DASHBOARD_SRC, "Utils", "RouteMap.ts"),
        );

        expect(routeMap).toContain(
          `[PageMap.${viewPage}]: \`\${RouteParams.ModelID}\`,`,
        );
      });
    },
  );
});
