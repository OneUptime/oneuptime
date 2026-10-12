import HuntressConnection from "Common/Models/DatabaseModels/HuntressConnection";
import HuntressIncidentReport from "Common/Models/DatabaseModels/HuntressIncidentReport";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import { HUNTRESS_WEBHOOK_ROUTE } from "Common/Types/Huntress/HuntressWebhook";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Huntress has three routes under the API: the connections' CRUD
 * (/huntress-connection) and the webhook Huntress posts to
 * (/huntress/webhook/<connection id>), both served by HuntressConnectionAPI,
 * and the read-only report list (/huntress-incident-report), a plain
 * BaseAPI. A model's @CrudApiEndpoint only answers once BaseAPI/Index.ts
 * mounts it, and a webhook route left out there is a 404 that Huntress
 * retries for a day and nobody sees. Booting the whole API router here would
 * pull in every service, so the registration is pinned on the source,
 * whitespace-insensitively, the way MessageQueueBaseAPIRegistration pins the
 * Queues models.
 */

const PACKAGES_DIR: string = path.join(__dirname, "../../..");

function readSource(...parts: Array<string>): string {
  return fs
    .readFileSync(path.join(PACKAGES_DIR, ...parts), "utf8")
    .replace(/\s+/g, "");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("the Huntress routes under the API", () => {
  const index: string = readSource("App", "FeatureSet", "BaseAPI", "Index.ts");
  const api: string = readSource(
    "Common",
    "Server",
    "API",
    "HuntressConnectionAPI.ts",
  );

  test("HuntressConnectionAPI is imported and mounted once, under the API prefix", () => {
    expect(index).toContain(
      'importHuntressConnectionAPIfrom"Common/Server/API/HuntressConnectionAPI";',
    );
    expect(
      countOccurrences(
        index,
        "app.use(`/${APP_NAME.toLocaleLowerCase()}`,newHuntressConnectionAPI().getRouter(),);",
      ),
    ).toBe(1);
  });

  test("the connection API is the connections' CRUD API, for the connection model", () => {
    expect(api).toContain(
      "exportdefaultclassHuntressConnectionAPIextendsBaseAPI<HuntressConnection,HuntressConnectionServiceType>",
    );
    expect(api).toContain(
      "super(HuntressConnection,HuntressConnectionService);",
    );
    expect(new HuntressConnection().crudApiPath?.toString()).toBe(
      "/huntress-connection",
    );
  });

  test("it answers the webhook at /huntress/webhook/<connection id>, with no credential", () => {
    expect(HUNTRESS_WEBHOOK_ROUTE).toBe("/huntress/webhook");
    expect(api).toContain(
      "this.router.post(`${HUNTRESS_WEBHOOK_ROUTE}/:connectionId`,async(req:ExpressRequest,res:ExpressResponse,next:NextFunction)=>{",
    );

    // No auth middleware between the route and its handler.
    expect(api).not.toMatch(
      /HUNTRESS_WEBHOOK_ROUTE\}\/:connectionId`,[A-Za-z.]+\.(isAuthorized|getUserMiddleware)/,
    );
  });

  test("it acts on the raw body the signature covers, not a re-serialized copy", () => {
    expect(api).toContain("rawBody:(reqasOneUptimeRequest).rawBody,");
    expect(api).not.toContain("JSON.stringify(req.body)");
  });

  test("the report list is a plain read API, mounted once", () => {
    expect(index).toContain(
      'importHuntressIncidentReportfrom"Common/Models/DatabaseModels/HuntressIncidentReport";',
    );
    expect(index).toContain(
      'importHuntressIncidentReportService,{ServiceasHuntressIncidentReportServiceType,}from"Common/Server/Services/HuntressIncidentReportService";',
    );

    const mount: RegExp =
      /newBaseAPI<HuntressIncidentReport,HuntressIncidentReportServiceType>\(HuntressIncidentReport,HuntressIncidentReportService,?\)\.getRouter\(\)/g;

    expect(index.match(mount) || []).toHaveLength(1);
    expect(new HuntressIncidentReport().crudApiPath?.toString()).toBe(
      "/huntress-incident-report",
    );
  });

  test("no other model answers on a Huntress route", () => {
    const owners: Array<string> = [];

    for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
      const model: BaseModel = new modelType();
      const route: string | undefined = model.crudApiPath?.toString();

      if (route && route.startsWith("/huntress")) {
        owners.push(`${route} -> ${modelType.name}`);
      }
    }

    expect(owners.sort()).toEqual([
      "/huntress-connection -> HuntressConnection",
      "/huntress-incident-report -> HuntressIncidentReport",
    ]);
  });
});
