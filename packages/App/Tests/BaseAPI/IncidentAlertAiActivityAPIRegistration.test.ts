import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import { INCIDENT_ALERT_AI_INSIGHTS_PATHS } from "Common/Types/AI/IncidentAlertAiInsights";
import {
  INCIDENT_ALERT_AI_LOGS_PATHS,
  INCIDENT_ALERT_AI_SUBJECT_KINDS,
  IncidentAlertAiSubjectKind,
} from "Common/Types/AI/IncidentAlertAiLogs";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The calls behind the AI section of the Incidents and Alerts menus
 * (Common/Server/API/IncidentAlertAiActivityAPI.ts: the AI Logs and AI
 * Insights of a project's incidents, and of its alerts) only answer once
 * BaseAPI/Index.ts mounts them under the /api prefix, and only if no CRUD
 * router answers on their paths first. Pinned on the source,
 * whitespace-insensitively, the way ResourceAiAccessAPIRegistration pins the
 * resource AI access router: booting the whole API would pull in every
 * service.
 */

const APP_ROOT: string = path.join(__dirname, "../..");

// An assertion about the wiring reads the code, not the prose around it.
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

const INDEX: string = readSquashed(
  path.join(APP_ROOT, "FeatureSet/BaseAPI/Index.ts"),
);

const MOUNT: string =
  "app.use(`/${APP_NAME.toLocaleLowerCase()}`,IncidentAlertAiActivityAPI);";

const ACTIVITY_PATHS: Array<string> = INCIDENT_ALERT_AI_SUBJECT_KINDS.flatMap(
  (subjectKind: IncidentAlertAiSubjectKind): Array<string> => {
    return [
      INCIDENT_ALERT_AI_LOGS_PATHS[subjectKind],
      INCIDENT_ALERT_AI_INSIGHTS_PATHS[subjectKind],
    ];
  },
);

describe("Incident and alert AI activity API registration in BaseAPI/Index.ts", () => {
  test("imports the router from Common once", () => {
    expect(
      countOccurrences(
        INDEX,
        'importIncidentAlertAiActivityAPIfrom"Common/Server/API/IncidentAlertAiActivityAPI";',
      ),
    ).toBe(1);
    expect(
      countOccurrences(INDEX, '"Common/Server/API/IncidentAlertAiActivityAPI"'),
    ).toBe(1);
  });

  test("mounts it exactly once, under the /api prefix, inside the feature set's init", () => {
    const init: number = INDEX.indexOf(
      "constBaseAPIFeatureSet:FeatureSet={init:async():Promise<void>=>{",
    );
    const appName: number = INDEX.indexOf('constAPP_NAME:string="api";');
    const mount: number = INDEX.indexOf(MOUNT);

    expect(countOccurrences(INDEX, MOUNT)).toBe(1);
    expect(init).toBeGreaterThan(-1);
    expect(appName).toBeGreaterThan(init);
    expect(mount).toBeGreaterThan(appName);
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
        ",IncidentAlertAiActivityAPI)",
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
 * (Common/Server/API/BaseAPI.ts): a CRUD router would win any of these paths
 * one of them matches, wherever it is mounted.
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

describe("no CRUD router claims an incident or alert AI activity path", () => {
  const crudPaths: Array<{ owner: string; route: string }> = allCrudApiPaths();

  test("the CRUD route list is real, so nothing below passes vacuously", () => {
    expect(crudPaths.length).toBeGreaterThan(300);
  });

  test("every path lives under /ai-activity, one logs and one insights path per product", () => {
    expect(ACTIVITY_PATHS).toEqual([
      "/ai-activity/incident/logs",
      "/ai-activity/incident/insights",
      "/ai-activity/alert/logs",
      "/ai-activity/alert/insights",
    ]);
  });

  test("no CRUD route pattern matches any of them", () => {
    const collisions: Array<string> = [];

    for (const entry of crudPaths) {
      for (const suffix of CRUD_ROUTE_SUFFIXES) {
        const pattern: RegExp = expressPattern(`${entry.route}${suffix}`);

        for (const routePath of ACTIVITY_PATHS) {
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
      expressPattern("/ai-activity/:id/get-item").test(
        "/ai-activity/incident/logs",
      ),
    ).toBe(false);
    expect(
      expressPattern("/ai-activity/incident/:id").test(
        "/ai-activity/incident/logs",
      ),
    ).toBe(true);
  });
});
