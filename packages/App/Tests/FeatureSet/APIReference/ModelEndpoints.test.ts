import ModelServiceHandler from "../../../FeatureSet/APIReference/Service/Model";
import { makeT } from "../../../FeatureSet/APIReference/Utils/I18n";
import {
  DrawnModelEndpoint,
  ModelEndpoint,
  getDescribedModelEndpoints,
  getModelEndpoints,
} from "../../../FeatureSet/APIReference/Utils/ModelEndpoints";
import {
  PAGE_FIXTURES,
  countOccurrences,
  renderPage,
} from "./ReferenceFixtures";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import ScheduleLayersSaveUtil, {
  SCHEDULE_LAYERS_READ_ROUTE,
  SCHEDULE_LAYERS_SAVE_ROUTE,
  ScheduleLayersSaveRequest,
  ScheduleLayersSaveResult,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayersSave";
import { USER_OVERRIDE_END_NOW_ROUTE } from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import { describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The routes a resource answers beside its own operations, on its API
 * Reference page (issue #9038): an on-call schedule's layers read and saved
 * in one call, and a user override ended now (issue #7899). Each is drawn
 * from Utils/ModelEndpoints, so these hold that list to the server - the
 * routes it registers, the requests it reads - and the page to the list.
 */

jest.mock("../../../FeatureSet/APIReference/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(
    __dirname,
    "../../../FeatureSet/APIReference",
  );
  return {
    ViewsPath: nodePath.join(root, "views"),
    StaticPath: nodePath.join(root, "Static"),
    CodeExamplesPath: nodePath.join(root, "CodeExamples"),
  };
});

const SCHEDULE_PATH: string =
  new OnCallDutyPolicySchedule().crudApiPath!.toString();
const OVERRIDE_PATH: string =
  new OnCallDutyPolicyUserOverride().crudApiPath!.toString();

const COMMON_ROOT: string = path.resolve(__dirname, "../../../../Common");
const LOCALES_ROOT: string = path.resolve(
  __dirname,
  "../../../FeatureSet/APIReference/Locales",
);

function readCommon(relative: string): string {
  return fs.readFileSync(path.join(COMMON_ROOT, relative), "utf8");
}

function endpointsOf(crudApiPath: string): Array<DrawnModelEndpoint> {
  return getModelEndpoints({
    crudApiPath: crudApiPath,
    apiPath: `/api${crudApiPath}`,
    exampleObjectID: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  });
}

function byId(
  endpoints: Array<DrawnModelEndpoint>,
  id: string,
): DrawnModelEndpoint {
  const found: DrawnModelEndpoint | undefined = endpoints.find(
    (endpoint: DrawnModelEndpoint) => {
      return endpoint.id === id;
    },
  );

  if (!found) {
    throw new Error(`No endpoint ${id}`);
  }

  return found;
}

// Every locale key an endpoint's section draws, as the page asks for it.
function keysOf(endpoint: ModelEndpoint): Array<string> {
  return [
    endpoint.headingKey,
    endpoint.introKey,
    endpoint.requestTitleKey,
    endpoint.idDescriptionKey,
    ...endpoint.bodyFields.map((field: { descriptionKey: string }) => {
      return field.descriptionKey;
    }),
    ...endpoint.refusalKeys,
  ].map((key: string) => {
    return `pages.modelEndpoints.${key}`;
  });
}

const DESCRIBED: Array<ModelEndpoint> = Object.values(
  getDescribedModelEndpoints(),
).flat();

describe("the endpoints a resource has beside its own", () => {
  it("are the schedule's layers read and saved, and an override ended now", () => {
    expect(Object.keys(getDescribedModelEndpoints()).sort()).toEqual(
      [SCHEDULE_PATH, OVERRIDE_PATH].sort(),
    );

    const schedule: Array<DrawnModelEndpoint> = endpointsOf(SCHEDULE_PATH);
    expect(
      schedule.map((endpoint: DrawnModelEndpoint) => {
        return `${endpoint.method} ${endpoint.path}`;
      }),
    ).toEqual([
      "GET /api/on-call-duty-policy-schedule/:id/layers",
      "POST /api/on-call-duty-policy-schedule/:id/save-layers",
    ]);

    expect(
      endpointsOf(OVERRIDE_PATH).map((endpoint: DrawnModelEndpoint) => {
        return `${endpoint.method} ${endpoint.path}`;
      }),
    ).toEqual(["POST /api/on-call-duty-policy-user-override/:id/end-now"]);
  });

  it("are none for a resource with nothing beside its own operations", () => {
    expect(endpointsOf("/monitor")).toEqual([]);
    expect(endpointsOf("")).toEqual([]);
  });

  it("are the routes the server registers, under the resource's own path", () => {
    expect(byId(endpointsOf(SCHEDULE_PATH), "read-layers").route).toBe(
      SCHEDULE_LAYERS_READ_ROUTE,
    );
    expect(byId(endpointsOf(SCHEDULE_PATH), "save-layers").route).toBe(
      SCHEDULE_LAYERS_SAVE_ROUTE,
    );
    expect(byId(endpointsOf(OVERRIDE_PATH), "end-now").route).toBe(
      USER_OVERRIDE_END_NOW_ROUTE,
    );

    const scheduleAPI: string = readCommon(
      "Server/API/OnCallDutyPolicyScheduleAPI.ts",
    );
    expect(scheduleAPI).toContain(
      "this.router.get(\n      `${new this.entityType().getCrudApiPath()?.toString()}${SCHEDULE_LAYERS_READ_ROUTE}`",
    );
    expect(scheduleAPI).toContain(
      "this.router.post(\n      `${new this.entityType().getCrudApiPath()?.toString()}${SCHEDULE_LAYERS_SAVE_ROUTE}`",
    );
    expect(
      readCommon("Server/API/OnCallDutyPolicyUserOverrideAPI.ts"),
    ).toContain("USER_OVERRIDE_END_NOW_ROUTE");
  });

  it("give a save the server reads, and the answers it gives", () => {
    const save: DrawnModelEndpoint = byId(
      endpointsOf(SCHEDULE_PATH),
      "save-layers",
    );
    const read: DrawnModelEndpoint = byId(
      endpointsOf(SCHEDULE_PATH),
      "read-layers",
    );

    // The example save is one the server parses as it is written.
    const parsed: ScheduleLayersSaveRequest =
      ScheduleLayersSaveUtil.parseRequest(save.requestBody);
    expect(ScheduleLayersSaveUtil.requestToJSON(parsed)).toEqual(
      save.requestBody,
    );

    // The read answers a save that changes nothing, as the server writes it.
    const answered: ScheduleLayersSaveRequest =
      ScheduleLayersSaveUtil.parseRequest(read.response);
    expect(ScheduleLayersSaveUtil.requestToJSON(answered)).toEqual(
      read.response,
    );
    // Of two layers and two people: the counts a version starts with.
    expect(answered.basedOnVersion.startsWith("1-2-2-")).toBe(true);

    // The save's answer, as the server writes it.
    const result: ScheduleLayersSaveResult =
      ScheduleLayersSaveUtil.resultFromJSON(save.response);
    expect(ScheduleLayersSaveUtil.resultToJSON(result)).toEqual(save.response);
    // The changed layers: one layer of three people.
    expect(result.version.startsWith("1-1-3-")).toBe(true);

    // What save names: the request's own fields.
    expect(
      save.bodyFields.map((field: { name: string }) => {
        return field.name;
      }),
    ).toEqual(Object.keys(save.requestBody || {}));
    expect(read.bodyFields).toEqual([]);
    expect(read.requestBody).toBeUndefined();
  });

  it("give End Now the answer the route sends", () => {
    const endNow: DrawnModelEndpoint = byId(
      endpointsOf(OVERRIDE_PATH),
      "end-now",
    );
    const api: string = readCommon(
      "Server/API/OnCallDutyPolicyUserOverrideAPI.ts",
    );

    expect(Object.keys(endNow.response).sort()).toEqual(["_id", "endsAt"]);
    expect(api).toContain("endsAt: endsAt.toISOString()");
    expect(endNow.requestBody).toBeUndefined();
  });

  it("give request examples for the record, in every language the page offers", () => {
    const save: DrawnModelEndpoint = byId(
      endpointsOf(SCHEDULE_PATH),
      "save-layers",
    );
    const read: DrawnModelEndpoint = byId(
      endpointsOf(SCHEDULE_PATH),
      "read-layers",
    );

    expect(save.codeExamples.curl).toContain(
      '-X POST "https://oneuptime.com/api/on-call-duty-policy-schedule/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d/save-layers"',
    );
    expect(save.codeExamples.curl).toContain('"basedOnVersion"');
    expect(read.codeExamples.curl).toContain(
      '-X GET "https://oneuptime.com/api/on-call-duty-policy-schedule/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d/layers"',
    );
    expect(read.codeExamples.requestPreview.body).toBe("");

    for (const language of [
      "javascript",
      "typescript",
      "python",
      "go",
      "java",
      "csharp",
      "php",
      "ruby",
      "rust",
      "powershell",
    ] as const) {
      expect([language, save.codeExamples[language]]).toEqual([
        language,
        expect.stringContaining("/save-layers"),
      ]);
    }
  });
});

describe("their words", () => {
  const keys: Array<string> = Array.from(
    new Set(
      DESCRIBED.flatMap(keysOf).concat([
        "pages.modelEndpoints.refusalsHeading",
      ]),
    ),
  );

  it("are keys of their own strings, which the page writes the prefix of", () => {
    for (const endpoint of DESCRIBED) {
      expect(endpoint.headingKey).not.toContain(".");
    }

    const template: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../FeatureSet/APIReference/views/main/model.ejs",
      ),
      "utf8",
    );
    expect(template).toContain(
      "t('pages.modelEndpoints.' + endpoint.headingKey)",
    );
    expect(template).toContain(
      "t('pages.modelEndpoints.' + field.descriptionKey)",
    );
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "are written in %s, not left to fall back to English",
    (language: string) => {
      const locale: {
        pages: { modelEndpoints: Record<string, string> };
      } = JSON.parse(
        fs.readFileSync(path.join(LOCALES_ROOT, `${language}.json`), "utf8"),
      );
      const t: (key: string) => string = makeT(language);

      for (const key of keys) {
        const name: string = key.replace("pages.modelEndpoints.", "");
        const written: string | undefined = locale.pages.modelEndpoints[name];

        expect({ language, key, written: typeof written }).toEqual({
          language,
          key,
          written: "string",
        });
        expect(t(key)).not.toBe(key);
      }
    },
  );

  it("name the fields and routes as the API writes them, in every language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const t: (key: string) => string = makeT(language);

      expect([
        language,
        t("pages.modelEndpoints.scheduleLayersReadIntro"),
      ]).toEqual([language, expect.stringContaining("basedOnVersion")]);
      expect([language, t("pages.modelEndpoints.layersDescription")]).toEqual([
        language,
        expect.stringContaining("{ layerUserId, userId }"),
      ]);
      expect([
        language,
        t("pages.modelEndpoints.scheduleLayersConflict"),
      ]).toEqual([language, expect.stringMatching(/^409 Conflict/)]);
      expect([
        language,
        t("pages.modelEndpoints.userOverrideEndNowIntro"),
      ]).toEqual([language, expect.stringContaining("endsAt")]);
    }
  });
});

describe("the model page", () => {
  it("draws a section for each, with its route, fields, refusals and answer", async () => {
    const endpoints: Array<DrawnModelEndpoint> = endpointsOf(SCHEDULE_PATH);
    const html: string = await renderPage({
      ...PAGE_FIXTURES["model"]!,
      pageData: {
        ...PAGE_FIXTURES["model"]!.pageData,
        apiPath: "/api/on-call-duty-policy-schedule",
        moreEndpoints: endpoints,
      },
    });

    expect(html).toContain('id="read-layers"');
    expect(html).toContain('id="save-layers"');
    expect(html).toContain(">Read Layers</h2>");
    expect(html).toContain(">Save Layers</h2>");
    expect(html).toContain("/api/on-call-duty-policy-schedule/:id/layers");
    expect(html).toContain("/api/on-call-duty-policy-schedule/:id/save-layers");

    for (const field of ["basedOnVersion", "layers", "deletedLayerIds"]) {
      expect(html).toContain(`<code class="inline-code">${field}</code>`);
    }

    expect(html).toContain(">Refusals</h4>");
    expect(html).toContain("409 Conflict: the layers changed");
    expect(html).toContain("Save Layers Request");
    expect(html).toContain("&#34;deletedLayers&#34;: 1");

    // After the resource's own operations, before its permissions.
    expect(html.indexOf('id="save-layers"')).toBeGreaterThan(
      html.indexOf('id="delete"'),
    );
    expect(html.indexOf('id="save-layers"')).toBeLessThan(
      html.indexOf(">Permissions</h2>"),
    );
  });

  it("draws them in the reader's language", async () => {
    const html: string = await renderPage(
      {
        ...PAGE_FIXTURES["model"]!,
        pageData: {
          ...PAGE_FIXTURES["model"]!.pageData,
          moreEndpoints: endpointsOf(OVERRIDE_PATH),
        },
      },
      { lang: "de" },
    );

    expect(html).toContain(">Jetzt beenden</h2>");
    expect(html).toContain("ID der Benutzerüberschreibung");
    expect(countOccurrences(html, 'id="end-now"')).toBe(1);
  });

  it("draws none for a resource without them", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    expect(html).not.toContain('id="save-layers"');
    expect(html).not.toContain(">Refusals</h4>");
  });

  it("is handed them by the page's service, for the schedule's page only", async () => {
    const pageDataOf: (
      page: string,
    ) => Promise<Record<string, unknown>> = async (
      page: string,
    ): Promise<Record<string, unknown>> => {
      let locals: Record<string, unknown> = {};

      const req: ExpressRequest = {
        params: { lang: "en", page: page },
        originalUrl: `/reference/en/${page}`,
        headers: {},
      } as unknown as ExpressRequest;

      const res: unknown = {
        status: (): unknown => {
          return res;
        },
        render: (
          _view: string,
          renderLocals: Record<string, unknown>,
        ): void => {
          locals = renderLocals;
        },
      };

      await ModelServiceHandler.executeResponse(req, res as ExpressResponse);

      return (locals["pageData"] || {}) as Record<string, unknown>;
    };

    const schedule: Record<string, unknown> = await pageDataOf(
      new OnCallDutyPolicySchedule().getAPIDocumentationPath(),
    );
    const endpoints: Array<DrawnModelEndpoint> = schedule[
      "moreEndpoints"
    ] as Array<DrawnModelEndpoint>;

    expect(
      endpoints.map((endpoint: DrawnModelEndpoint) => {
        return endpoint.path;
      }),
    ).toEqual([
      `${String(schedule["apiPath"])}/:id/layers`,
      `${String(schedule["apiPath"])}/:id/save-layers`,
    ]);
    // The examples name the page's own example record.
    expect(endpoints[1]!.codeExamples.curl).toContain(
      `/${String(schedule["exampleObjectID"])}/save-layers`,
    );

    const override: Record<string, unknown> = await pageDataOf(
      new OnCallDutyPolicyUserOverride().getAPIDocumentationPath(),
    );
    expect(
      (override["moreEndpoints"] as Array<DrawnModelEndpoint>).map(
        (endpoint: DrawnModelEndpoint) => {
          return endpoint.id;
        },
      ),
    ).toEqual(["end-now"]);
  }, 120000);
});
