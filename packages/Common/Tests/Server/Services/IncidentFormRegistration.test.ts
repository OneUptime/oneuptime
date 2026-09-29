import AllModelTypes from "../../../Models/DatabaseModels/Index";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentFormSubmission from "../../../Models/DatabaseModels/IncidentFormSubmission";
import IncidentFormService, {
  Service as IncidentFormServiceClass,
} from "../../../Server/Services/IncidentFormService";
import IncidentFormSubmissionService, {
  Service as IncidentFormSubmissionServiceClass,
} from "../../../Server/Services/IncidentFormSubmissionService";
import Services from "../../../Server/Services/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Incident forms are reachable only through the wiring pinned here:
 *
 * - both services must be in Server/Services/Index.ts, or the workflow
 *   runtime cannot find IncidentForm's components and the retention sweep
 *   skips both tables;
 * - both CRUD routers must be mounted in the BaseAPI feature set, or the
 *   dashboard's Forms pages and the API get a 404.
 *
 * IncidentForm's router is the IncidentFormAPI, which extends BaseAPI with
 * the public routes every form link uses (/incident-form/public/...). A
 * plain BaseAPI in its place would compile and keep the dashboard working
 * while every shared link answered 404, so only IncidentFormAPI passes. It
 * is mounted exactly once, since a second router would shadow the first.
 * The mounts are checked in the source text, tolerant of the ways prettier
 * may wrap them.
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

function count(source: RegExpMatchArray | null): number {
  return source ? source.length : 0;
}

describe("IncidentForm and IncidentFormSubmission registration", () => {
  test("both models are registered with every other database model", () => {
    expect(AllModelTypes).toContain(IncidentForm);
    expect(AllModelTypes).toContain(IncidentFormSubmission);
  });

  test.each([
    [IncidentFormService, IncidentFormServiceClass, IncidentForm],
    [
      IncidentFormSubmissionService,
      IncidentFormSubmissionServiceClass,
      IncidentFormSubmission,
    ],
  ] as Array<[unknown, new () => unknown, new () => unknown]>)(
    "the service is registered exactly once, for its model",
    (
      service: unknown,
      serviceClass: new () => unknown,
      modelType: new () => unknown,
    ) => {
      expect(Services).toContain(service);
      expect(service).toBeInstanceOf(serviceClass);

      const claimants: Array<unknown> = Services.filter(
        (candidate: unknown): boolean => {
          const model: unknown = (
            candidate as { getModel?: () => unknown }
          ).getModel?.();
          return model instanceof modelType;
        },
      );

      expect(claimants).toEqual([service]);
    },
  );

  /*
   * IncidentForm itself is imported by IncidentFormAPI, which the index
   * mounts; an unused model import in the index would fail App's
   * noUnusedLocals.
   */
  test("BaseAPI imports IncidentFormSubmission and the IncidentFormAPI that serves IncidentForm", () => {
    const source: string = dense(readBaseApiSource());

    expect(source).toContain(
      dense('import IncidentFormAPI from "Common/Server/API/IncidentFormAPI";'),
    );
    expect(source).toContain(
      dense(
        'import IncidentFormSubmission from "Common/Models/DatabaseModels/IncidentFormSubmission";',
      ),
    );
  });

  test("BaseAPI mounts a CRUD router for IncidentFormSubmission under /api, once", () => {
    const source: string = readBaseApiSource();

    expect(dense(source)).toContain(
      dense(`import IncidentFormSubmissionService, {
  Service as IncidentFormSubmissionServiceType,
} from "Common/Server/Services/IncidentFormSubmissionService";`),
    );

    const mount: RegExp = new RegExp(
      "app\\.use\\(\\s*`/\\$\\{APP_NAME\\.toLocaleLowerCase\\(\\)\\}`,\\s*" +
        "new BaseAPI<\\s*IncidentFormSubmission,\\s*IncidentFormSubmissionServiceType\\s*>\\(" +
        "\\s*IncidentFormSubmission,\\s*IncidentFormSubmissionService,?\\s*\\)\\.getRouter\\(\\),?\\s*\\)",
    );

    expect(source).toMatch(mount);
    expect(count(source.match(/new BaseAPI<\s*IncidentFormSubmission,/g))).toBe(
      1,
    );
  });

  test("BaseAPI mounts IncidentForm's router under /api exactly once, as the IncidentFormAPI with the public routes", () => {
    const source: string = readBaseApiSource();

    const plainMount: RegExp = new RegExp(
      "app\\.use\\(\\s*`/\\$\\{APP_NAME\\.toLocaleLowerCase\\(\\)\\}`,\\s*" +
        "new BaseAPI<\\s*IncidentForm,\\s*IncidentFormServiceType\\s*>\\(" +
        "\\s*IncidentForm,\\s*IncidentFormService,?\\s*\\)\\.getRouter\\(\\),?\\s*\\)",
      "g",
    );
    const customMount: RegExp = new RegExp(
      "app\\.use\\(\\s*`/\\$\\{APP_NAME\\.toLocaleLowerCase\\(\\)\\}`,\\s*" +
        "new IncidentFormAPI\\(\\)\\.getRouter\\(\\),?\\s*\\)",
      "g",
    );

    const plainMounts: number = count(source.match(plainMount));
    const customMounts: number = count(source.match(customMount));

    expect(customMounts).toBe(1);
    expect(plainMounts).toBe(0);

    // No other router for the model hides behind a different spelling.
    expect(count(source.match(/new BaseAPI<\s*IncidentForm,/g))).toBe(0);
    expect(count(source.match(/new IncidentFormAPI\(/g))).toBe(1);
  });

  test("the routers serve the models' own CRUD paths", () => {
    expect(new IncidentForm().getCrudApiPath()?.toString()).toBe(
      "/incident-form",
    );
    expect(new IncidentFormSubmission().getCrudApiPath()?.toString()).toBe(
      "/incident-form-submission",
    );
  });
});
