import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import { TopologyApiPath } from "Common/Types/Topology/TopologyApi";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Topology API (issue #3973) only answers once BaseAPI/Index.ts mounts
 * `new TopologyAPI().getRouter()` under the /api prefix. A router left out
 * compiles fine and 404s from the dashboard, which the Topology page then
 * reports as "Topology was updated. Reload the page." forever — so the
 * registration is pinned on the source, whitespace-insensitively, the way
 * DatabaseServerBaseAPIRegistration pins the Databases CRUD routers. Booting
 * the whole API would pull in every service.
 *
 * TopologyAPI.test.ts covers what the router does once it is mounted (every
 * route a POST behind the user middleware). This file covers that it IS
 * mounted, once, in the right place, and that no other router can answer on
 * its paths first.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const COMMON_ROOT: string = path.join(APP_ROOT, "../Common");

/*
 * Block comments and whole-line `//` comments are dropped before matching:
 * an assertion about the wiring has to read the code, not the prose that
 * explains it (Index.ts describes the Topology mount in a comment).
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function readSquashed(absolutePath: string): string {
  return stripComments(fs.readFileSync(absolutePath, "utf8")).replace(
    /\s+/g,
    "",
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/* Index of the single match of `pattern`, failing loudly on 0 or >1. */
function indexOfOnly(haystack: string, pattern: RegExp): number {
  const matches: Array<RegExpMatchArray> = Array.from(
    haystack.matchAll(new RegExp(pattern.source, "g")),
  );
  expect(matches).toHaveLength(1);
  return matches[0]!.index!;
}

const INDEX_PATH: string = path.join(APP_ROOT, "FeatureSet/BaseAPI/Index.ts");
const INDEX: string = readSquashed(INDEX_PATH);

const API_PREFIX: string = "app.use(`/${APP_NAME.toLocaleLowerCase()}`,";

const TOPOLOGY_MOUNT: string = `${API_PREFIX}newTopologyAPI().getRouter());`;

const INVENTORY_ITEM_CRUD: RegExp =
  /app\.use\(`\/\$\{APP_NAME\.toLocaleLowerCase\(\)\}`,newBaseAPI<InventoryItem,InventoryItemServiceType>\(InventoryItem,InventoryItemServiceInstance,?\)\.getRouter\(\),?\);/;

const INVENTORY_RELATIONSHIP_CRUD: RegExp =
  /app\.use\(`\/\$\{APP_NAME\.toLocaleLowerCase\(\)\}`,newBaseAPI<InventoryItemRelationship,InventoryItemRelationshipServiceType>\(InventoryItemRelationship,InventoryItemRelationshipServiceInstance,?\)\.getRouter\(\),?\);/;

const TOPOLOGY_PATHS: Array<string> = Object.values(TopologyApiPath);

describe("Topology API registration in BaseAPI/Index.ts", () => {
  test("imports the Topology router from its own module, once", () => {
    expect(
      countOccurrences(INDEX, 'importTopologyAPIfrom"./API/Topology";'),
    ).toBe(1);
    /* No second binding (e.g. a default import under another name). */
    expect(countOccurrences(INDEX, '"./API/Topology"')).toBe(1);
  });

  test("mounts `new TopologyAPI().getRouter()` exactly once, under the /api prefix", () => {
    expect(countOccurrences(INDEX, "newTopologyAPI()")).toBe(1);
    expect(countOccurrences(INDEX, TOPOLOGY_MOUNT)).toBe(1);
    /* The prefix it is mounted under is the one every BaseAPI router uses. */
    expect(countOccurrences(INDEX, 'constAPP_NAME:string="api";')).toBe(1);
  });

  test("is mounted inside the BaseAPI feature set's init, after APP_NAME is defined", () => {
    const init: number = INDEX.indexOf(
      "constBaseAPIFeatureSet:FeatureSet={init:async():Promise<void>=>{",
    );
    const appName: number = INDEX.indexOf('constAPP_NAME:string="api";');
    const mount: number = INDEX.indexOf(TOPOLOGY_MOUNT);

    expect(init).toBeGreaterThan(-1);
    expect(appName).toBeGreaterThan(init);
    expect(mount).toBeGreaterThan(appName);
  });

  test("is mounted after the InventoryItem and InventoryItemRelationship CRUD routers", () => {
    const itemCrud: number = indexOfOnly(INDEX, INVENTORY_ITEM_CRUD);
    const relationshipCrud: number = indexOfOnly(
      INDEX,
      INVENTORY_RELATIONSHIP_CRUD,
    );
    const mount: number = INDEX.indexOf(TOPOLOGY_MOUNT);

    expect(mount).toBeGreaterThan(itemCrud);
    expect(mount).toBeGreaterThan(relationshipCrud);
  });

  test("no feature set other than BaseAPI mounts the Topology router", () => {
    const featureSetRoot: string = path.join(APP_ROOT, "FeatureSet");
    const mounts: Array<string> = [];

    for (const featureSet of fs.readdirSync(featureSetRoot)) {
      const indexFile: string = path.join(
        featureSetRoot,
        featureSet,
        "Index.ts",
      );
      if (!fs.existsSync(indexFile)) {
        continue;
      }
      const occurrences: number = countOccurrences(
        readSquashed(indexFile),
        "newTopologyAPI()",
      );
      for (let index: number = 0; index < occurrences; index++) {
        mounts.push(featureSet);
      }
    }

    expect(mounts).toEqual(["BaseAPI"]);
  });

  test("no app.use prefix in BaseAPI/Index.ts claims a /telemetry path", () => {
    const prefixes: Array<string> = Array.from(
      INDEX.matchAll(/app\.use\(([^,]+),/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(prefixes.length).toBeGreaterThan(300);
    expect(
      prefixes.filter((prefix: string): boolean => {
        return prefix.includes("telemetry");
      }),
    ).toEqual([]);
  });
});

/*
 * BaseAPI / BaseAnalyticsAPI answer on `${crudApiPath}` plus these suffixes
 * (Common/Server/API/BaseAPI.ts). A CRUD router mounted before the Topology
 * router would win any Topology path one of these patterns matches.
 */
const CRUD_ROUTE_SUFFIXES: Array<string> = [
  "",
  "/get-list",
  "/count",
  "/:id",
  "/:id/get-item",
  "/:id/update-item",
  "/:id/delete-item",
];

/* Express 4 semantics: case-insensitive, optional trailing slash. */
function expressPattern(route: string): RegExp {
  const source: string = route
    .split("/")
    .map((segment: string): string => {
      return segment.startsWith(":")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${source}/?$`, "i");
}

function allCrudApiPaths(): Array<{ owner: string; route: string }> {
  const paths: Array<{ owner: string; route: string }> = [];

  for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
    const route: string | undefined = new modelType().crudApiPath?.toString();
    if (route) {
      paths.push({ owner: modelType.name, route });
    }
  }

  for (const modelType of AnalyticsModels as Array<{
    new (): AnalyticsBaseModel;
  }>) {
    const route: string | undefined = new modelType().crudApiPath?.toString();
    if (route) {
      paths.push({ owner: modelType.name, route });
    }
  }

  return paths;
}

describe("no CRUD router claims a Topology path", () => {
  const crudPaths: Array<{ owner: string; route: string }> = allCrudApiPaths();

  test("the CRUD route list is real, so nothing below passes vacuously", () => {
    expect(crudPaths.length).toBeGreaterThan(300);
    expect(new InventoryItem().crudApiPath?.toString()).toBe("/inventory-item");
    expect(new InventoryItemRelationship().crudApiPath?.toString()).toBe(
      "/inventory-item-relationship",
    );
    expect(TOPOLOGY_PATHS.length).toBe(6);
  });

  test("every Topology path lives under /telemetry/topology", () => {
    for (const topologyPath of TOPOLOGY_PATHS) {
      expect(topologyPath.startsWith("/telemetry/topology/")).toBe(true);
    }
  });

  test("no model's crudApiPath is, or sits under, /telemetry/topology", () => {
    const offenders: Array<string> = crudPaths
      .filter((entry: { route: string }): boolean => {
        const route: string = entry.route.toLowerCase();
        return (
          route === "/telemetry" ||
          route === "/telemetry/topology" ||
          route.startsWith("/telemetry/topology/")
        );
      })
      .map((entry: { owner: string; route: string }): string => {
        return `${entry.owner} -> ${entry.route}`;
      });

    expect(offenders).toEqual([]);
  });

  test("no CRUD route pattern matches any Topology path", () => {
    const collisions: Array<string> = [];

    for (const entry of crudPaths) {
      for (const suffix of CRUD_ROUTE_SUFFIXES) {
        const pattern: RegExp = expressPattern(`${entry.route}${suffix}`);
        for (const topologyPath of TOPOLOGY_PATHS) {
          if (pattern.test(topologyPath)) {
            collisions.push(
              `${entry.owner} (${entry.route}${suffix}) answers ${topologyPath}`,
            );
          }
        }
      }
    }

    expect(collisions).toEqual([]);
  });

  test("the pattern check itself would catch a colliding CRUD path", () => {
    /* Guards the guard: a model routed at /telemetry/topology would collide. */
    expect(
      expressPattern("/telemetry/topology/:id").test(TopologyApiPath.Entity),
    ).toBe(true);
    expect(
      expressPattern("/telemetry/topology/entity").test(TopologyApiPath.Entity),
    ).toBe(true);
    expect(
      expressPattern("/inventory-item/:id/get-item").test(
        TopologyApiPath.Entity,
      ),
    ).toBe(false);
  });

  test("no other router source spells a Topology path; they come from TopologyApiPath", () => {
    const roots: Array<string> = [
      path.join(APP_ROOT, "FeatureSet/BaseAPI/API"),
      path.join(COMMON_ROOT, "Server/API"),
    ];
    const spelled: Array<string> = [];

    for (const root of roots) {
      for (const file of fs.readdirSync(root)) {
        if (!file.endsWith(".ts")) {
          continue;
        }
        const code: string = readSquashed(path.join(root, file));
        if (code.includes("/telemetry/topology")) {
          spelled.push(path.relative(APP_ROOT, path.join(root, file)));
        }
      }
    }

    expect(spelled).toEqual([]);

    /* The Topology router registers each contract path by enum member. */
    const router: string = readSquashed(
      path.join(APP_ROOT, "FeatureSet/BaseAPI/API/Topology.ts"),
    );
    for (const member of Object.keys(TopologyApiPath)) {
      expect(
        countOccurrences(router, `router.post(TopologyApiPath.${member},`),
      ).toBe(1);
    }
  });
});
