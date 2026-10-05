import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import {
  RESOURCE_AI_ACCESS_INSIGHTS_PATH,
  RESOURCE_AI_ACCESS_LOGS_PATH,
  RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
  RESOURCE_AI_ACCESS_STATUS_PATH,
  RESOURCE_AI_ACCESS_TEST_PATH,
} from "Common/Types/AI/ResourceAiAccessApi";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The resource AI access API (Common/Server/API/ResourceAiAccessAPI.ts:
 * status, test connection, reset agent, logs and insights for the AI pages of
 * every resource a resource AI agent serves) only answers once
 * BaseAPI/Index.ts mounts it under the /api prefix — and, like the
 * Kubernetes cluster's AI access API, BEFORE the CRUD routers of the
 * resources it serves, so no CRUD route can ever answer on its paths first.
 * Pinned on the source, whitespace-insensitively, the way
 * TopologyAPIRegistration pins the Topology router: booting the whole API
 * would pull in every service.
 */

const APP_ROOT: string = path.join(__dirname, "../..");

/*
 * Block comments and whole-line `//` comments are dropped before matching:
 * an assertion about the wiring has to read the code, not the prose that
 * explains it.
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

// Index of the single match of `pattern`, failing loudly on 0 or >1.
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

const RESOURCE_AI_ACCESS_MOUNT: string = `${API_PREFIX}ResourceAiAccessAPI);`;
const KUBERNETES_AI_ACCESS_MOUNT: string = `${API_PREFIX}KubernetesClusterAiAccessAPI);`;

// The CRUD router of each resource the API serves: `new BaseAPI<Model, ServiceType>(Model, Service).getRouter()`.
function crudMount(model: string): RegExp {
  return new RegExp(
    `app\\.use\\(\`\\/\\$\\{APP_NAME\\.toLocaleLowerCase\\(\\)\\}\`,newBaseAPI<${model},${model}ServiceType>\\(${model},${model}Service,?\\)\\.getRouter\\(\\),?\\);`,
  );
}

const SERVED_MODELS: Array<string> = [
  "DockerHost",
  "PodmanHost",
  "DockerSwarmCluster",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "DatabaseServer",
  "Host",
];

const RESOURCE_AI_ACCESS_PATHS: Array<string> = [
  RESOURCE_AI_ACCESS_STATUS_PATH,
  RESOURCE_AI_ACCESS_TEST_PATH,
  RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
  RESOURCE_AI_ACCESS_INSIGHTS_PATH,
  RESOURCE_AI_ACCESS_LOGS_PATH,
];

describe("Resource AI access API registration in BaseAPI/Index.ts", () => {
  test("imports the router from Common once", () => {
    expect(
      countOccurrences(
        INDEX,
        'importResourceAiAccessAPIfrom"Common/Server/API/ResourceAiAccessAPI";',
      ),
    ).toBe(1);
    expect(
      countOccurrences(INDEX, '"Common/Server/API/ResourceAiAccessAPI"'),
    ).toBe(1);
  });

  test("mounts it exactly once, under the /api prefix", () => {
    expect(countOccurrences(INDEX, RESOURCE_AI_ACCESS_MOUNT)).toBe(1);
    expect(countOccurrences(INDEX, 'constAPP_NAME:string="api";')).toBe(1);
  });

  test("is mounted inside the BaseAPI feature set's init, after APP_NAME is defined", () => {
    const init: number = INDEX.indexOf(
      "constBaseAPIFeatureSet:FeatureSet={init:async():Promise<void>=>{",
    );
    const appName: number = INDEX.indexOf('constAPP_NAME:string="api";');
    const mount: number = INDEX.indexOf(RESOURCE_AI_ACCESS_MOUNT);

    expect(init).toBeGreaterThan(-1);
    expect(appName).toBeGreaterThan(init);
    expect(mount).toBeGreaterThan(appName);
  });

  test.each(SERVED_MODELS)(
    "is mounted before the %s CRUD router, so its action routes win the match",
    (model: string) => {
      const crud: number = indexOfOnly(INDEX, crudMount(model));
      const mount: number = INDEX.indexOf(RESOURCE_AI_ACCESS_MOUNT);

      expect(mount).toBeGreaterThan(-1);
      expect(mount).toBeLessThan(crud);
    },
  );

  test("sits next to the Kubernetes cluster's AI access API, which stays mounted as it was", () => {
    expect(countOccurrences(INDEX, KUBERNETES_AI_ACCESS_MOUNT)).toBe(1);
    expect(INDEX.indexOf(RESOURCE_AI_ACCESS_MOUNT)).toBeGreaterThan(
      INDEX.indexOf(KUBERNETES_AI_ACCESS_MOUNT),
    );
  });

  test("no feature set other than BaseAPI mounts it", () => {
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
        ",ResourceAiAccessAPI)",
      );
      for (let index: number = 0; index < occurrences; index++) {
        mounts.push(featureSet);
      }
    }

    expect(mounts).toEqual(["BaseAPI"]);
  });
});

/*
 * BaseAPI answers on `${crudApiPath}` plus these suffixes
 * (Common/Server/API/BaseAPI.ts). A CRUD router mounted before this one
 * would win any of its paths one of these patterns matches.
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

// Express 4 semantics: case-insensitive, optional trailing slash.
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

describe("no CRUD router claims a resource AI access path", () => {
  const crudPaths: Array<{ owner: string; route: string }> = allCrudApiPaths();

  test("the CRUD route list is real, so nothing below passes vacuously", () => {
    expect(crudPaths.length).toBeGreaterThan(300);
  });

  test("every path lives under /resource-ai-access", () => {
    for (const routePath of RESOURCE_AI_ACCESS_PATHS) {
      expect(routePath.startsWith("/resource-ai-access/")).toBe(true);
    }
  });

  test("no CRUD route pattern matches any resource AI access path", () => {
    const collisions: Array<string> = [];

    for (const entry of crudPaths) {
      for (const suffix of CRUD_ROUTE_SUFFIXES) {
        const pattern: RegExp = expressPattern(`${entry.route}${suffix}`);
        for (const routePath of RESOURCE_AI_ACCESS_PATHS) {
          if (pattern.test(routePath)) {
            collisions.push(
              `${entry.owner} (${entry.route}${suffix}) answers ${routePath}`,
            );
          }
        }
      }
    }

    expect(collisions).toEqual([]);
  });

  test("the pattern check itself would catch a colliding CRUD path", () => {
    expect(
      expressPattern("/resource-ai-access/:id").test(
        RESOURCE_AI_ACCESS_STATUS_PATH,
      ),
    ).toBe(true);
    expect(
      expressPattern("/docker-host/:id/get-item").test(
        RESOURCE_AI_ACCESS_STATUS_PATH,
      ),
    ).toBe(false);
  });
});
