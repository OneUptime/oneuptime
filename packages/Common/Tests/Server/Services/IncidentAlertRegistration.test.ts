import AllModelTypes from "../../../Models/DatabaseModels/Index";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import IncidentAlertService, {
  Service as IncidentAlertServiceClass,
} from "../../../Server/Services/IncidentAlertService";
import Services from "../../../Server/Services/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The IncidentAlert link is reachable only through the wiring pinned here:
 *
 * - the service must be in Server/Services/Index.ts, or the workflow runtime
 *   cannot find the model's components and the retention sweep skips it;
 * - the CRUD router must be mounted in the BaseAPI feature set, or the
 *   dashboard's Linked Alerts / Linked Incidents pages, the alerts table's
 *   "Link to Incident" action, the MCP tools and the API all get a 404.
 *
 * The mount is checked in the source text, tolerant of the ways prettier may
 * wrap it.
 */

const BASE_API_INDEX: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/BaseAPI/Index.ts",
);

function readBaseApiSource(): string {
  return fs.readFileSync(BASE_API_INDEX, "utf8");
}

function dense(source: string): string {
  return source.replace(/\s+/g, "");
}

describe("IncidentAlert registration", () => {
  test("the model is registered with every other database model", () => {
    expect(AllModelTypes).toContain(IncidentAlert);
  });

  test("the service is registered exactly once, for the IncidentAlert model", () => {
    expect(Services).toContain(IncidentAlertService);
    expect(IncidentAlertService).toBeInstanceOf(IncidentAlertServiceClass);

    const claimants: Array<unknown> = Services.filter(
      (service: unknown): boolean => {
        const model: unknown = (
          service as { getModel?: () => unknown }
        ).getModel?.();
        return model instanceof IncidentAlert;
      },
    );

    expect(claimants).toEqual([IncidentAlertService]);
  });

  test("BaseAPI imports the service with its Service type and the model", () => {
    const source: string = dense(readBaseApiSource());

    expect(source).toContain(
      dense(
        'import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";',
      ),
    );
    expect(source).toContain(
      dense(`import IncidentAlertService, {
  Service as IncidentAlertServiceType,
} from "Common/Server/Services/IncidentAlertService";`),
    );
  });

  test("BaseAPI mounts a CRUD router for IncidentAlert under /api", () => {
    const source: string = readBaseApiSource();

    const mount: RegExp = new RegExp(
      "app\\.use\\(\\s*`/\\$\\{APP_NAME\\.toLocaleLowerCase\\(\\)\\}`,\\s*" +
        "new BaseAPI<\\s*IncidentAlert,\\s*IncidentAlertServiceType\\s*>\\(" +
        "\\s*IncidentAlert,\\s*IncidentAlertService,?\\s*\\)\\.getRouter\\(\\),?\\s*\\)",
    );

    expect(source).toMatch(mount);

    // Mounted once: a second router would shadow the first.
    const mounts: RegExpMatchArray | null = source.match(
      /new BaseAPI<\s*IncidentAlert,/g,
    );
    expect(mounts).toHaveLength(1);
  });

  test("the router serves the model's own CRUD path", () => {
    expect(new IncidentAlert().getCrudApiPath()?.toString()).toBe(
      "/incident-alert",
    );
  });
});
