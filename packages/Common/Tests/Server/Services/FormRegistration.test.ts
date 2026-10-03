import AllModelTypes from "../../../Models/DatabaseModels/Index";
import Form from "../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import FormService, {
  Service as FormServiceClass,
} from "../../../Server/Services/FormService";
import FormSubmissionService, {
  Service as FormSubmissionServiceClass,
} from "../../../Server/Services/FormSubmissionService";
import Services from "../../../Server/Services/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Incident forms are reachable only through the wiring pinned here:
 *
 * - both services must be in Server/Services/Index.ts, or the workflow
 *   runtime cannot find Form's components and the retention sweep
 *   skips both tables;
 * - both CRUD routers must be mounted in the BaseAPI feature set, or the
 *   dashboard's Forms pages and the API get a 404.
 *
 * Form's router is the FormAPI, which extends BaseAPI with
 * the public routes every form link uses (/form/public/...). A
 * plain BaseAPI in its place would compile and keep the dashboard working
 * while every shared link answered 404, so only FormAPI passes. It
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

describe("Form and FormSubmission registration", () => {
  test("both models are registered with every other database model", () => {
    expect(AllModelTypes).toContain(Form);
    expect(AllModelTypes).toContain(FormSubmission);
  });

  test.each([
    [FormService, FormServiceClass, Form],
    [FormSubmissionService, FormSubmissionServiceClass, FormSubmission],
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
   * Form itself is imported by FormAPI, which the index
   * mounts; an unused model import in the index would fail App's
   * noUnusedLocals.
   */
  test("BaseAPI imports FormSubmission and the FormAPI that serves Form", () => {
    const source: string = dense(readBaseApiSource());

    expect(source).toContain(
      dense('import FormAPI from "Common/Server/API/FormAPI";'),
    );
    expect(source).toContain(
      dense(
        'import FormSubmission from "Common/Models/DatabaseModels/FormSubmission";',
      ),
    );
  });

  test("BaseAPI mounts a CRUD router for FormSubmission under /api, once", () => {
    const source: string = readBaseApiSource();

    expect(dense(source)).toContain(
      dense(`import FormSubmissionService, {
  Service as FormSubmissionServiceType,
} from "Common/Server/Services/FormSubmissionService";`),
    );

    const mount: RegExp = new RegExp(
      "app\\.use\\(\\s*`/\\$\\{APP_NAME\\.toLocaleLowerCase\\(\\)\\}`,\\s*" +
        "new BaseAPI<\\s*FormSubmission,\\s*FormSubmissionServiceType\\s*>\\(" +
        "\\s*FormSubmission,\\s*FormSubmissionService,?\\s*\\)\\.getRouter\\(\\),?\\s*\\)",
    );

    expect(source).toMatch(mount);
    expect(count(source.match(/new BaseAPI<\s*FormSubmission,/g))).toBe(1);
  });

  test("BaseAPI mounts Form's router under /api exactly once, as the FormAPI with the public routes", () => {
    const source: string = readBaseApiSource();

    const plainMount: RegExp = new RegExp(
      "app\\.use\\(\\s*`/\\$\\{APP_NAME\\.toLocaleLowerCase\\(\\)\\}`,\\s*" +
        "new BaseAPI<\\s*Form,\\s*FormServiceType\\s*>\\(" +
        "\\s*Form,\\s*FormService,?\\s*\\)\\.getRouter\\(\\),?\\s*\\)",
      "g",
    );
    const customMount: RegExp = new RegExp(
      "app\\.use\\(\\s*`/\\$\\{APP_NAME\\.toLocaleLowerCase\\(\\)\\}`,\\s*" +
        "new FormAPI\\(\\)\\.getRouter\\(\\),?\\s*\\)",
      "g",
    );

    const plainMounts: number = count(source.match(plainMount));
    const customMounts: number = count(source.match(customMount));

    expect(customMounts).toBe(1);
    expect(plainMounts).toBe(0);

    // No other router for the model hides behind a different spelling.
    expect(count(source.match(/new BaseAPI<\s*Form,/g))).toBe(0);
    expect(count(source.match(/new FormAPI\(/g))).toBe(1);
  });

  test("the routers serve the models' own CRUD paths", () => {
    expect(new Form().getCrudApiPath()?.toString()).toBe("/form");
    expect(new FormSubmission().getCrudApiPath()?.toString()).toBe(
      "/form-submission",
    );
  });
});
