import ModelServiceHandler, {
  getTelemetryListExamples,
} from "../../../FeatureSet/APIReference/Service/Model";
import ResourceUtil, {
  ModelDocumentation,
} from "../../../FeatureSet/APIReference/Utils/Resources";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import { AnalyticsModelSchema } from "Common/Utils/Schema/AnalyticsModelSchema";
import { describe, expect, it, jest } from "@jest/globals";
import type * as Path from "path";

/*
 * A telemetry resource's page showed the list request every other page
 * shows, sorted {"createdAt": -1}. A telemetry list sorts by "ASC" or "DESC"
 * only - StatementGenerator wrote -1 as ORDER BY createdAt undefined, which
 * ClickHouse refuses - and createdAt is not the time a telemetry table is
 * sorted by. The page's list and count requests are now bounded and sorted
 * by the table's time column, and held here to what the API runs.
 */

jest.mock("../../../FeatureSet/APIReference/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(
    __dirname,
    "../../../FeatureSet/APIReference",
  );
  return {
    ViewsPath: path.join(root, "views"),
    StaticPath: path.join(root, "Static"),
    CodeExamplesPath: path.join(root, "CodeExamples"),
  };
});

type AnalyticsModelType = new () => AnalyticsBaseModel;

interface PageExamples {
  query: JSONObject;
  sort: JSONObject;
  listRequest: string;
}

async function pageExamples(
  resource: ModelDocumentation,
): Promise<PageExamples> {
  let locals: Record<string, unknown> = {};

  const req: ExpressRequest = {
    params: { lang: "en", page: resource.path },
    originalUrl: `/reference/en/${resource.path}`,
    headers: {},
  } as unknown as ExpressRequest;

  const res: unknown = {
    status: (): unknown => {
      return res;
    },
    render: (_view: string, renderLocals: Record<string, unknown>): void => {
      locals = renderLocals;
    },
  };

  await ModelServiceHandler.executeResponse(req, res as ExpressResponse);

  const pageData: Record<string, any> = locals["pageData"] as Record<
    string,
    any
  >;

  return {
    query: pageData["exampleObjects"]["simpleQueryExample"],
    sort: pageData["exampleObjects"]["simpleSortExample"],
    listRequest: pageData["codeExamples"]["list"]["curl"],
  };
}

const telemetry: Array<ModelDocumentation> = ResourceUtil.getResources().filter(
  (resource: ModelDocumentation): boolean => {
    return resource.isAnalytics;
  },
);

describe("a telemetry resource's list example", () => {
  it("covers the telemetry the reference documents", () => {
    expect(telemetry.length).toBeGreaterThanOrEqual(9);
  });

  it("is bounded and sorted by the table's time column, newest first", async () => {
    for (const resource of telemetry) {
      const model: AnalyticsBaseModel = resource.model as AnalyticsBaseModel;
      const examples: PageExamples = await pageExamples(resource);

      expect([resource.name, examples.sort]).toEqual([
        resource.name,
        { [model.defaultSortColumn]: SortOrder.Descending },
      ]);
      expect([resource.name, examples.query]).toEqual([
        resource.name,
        getTelemetryListExamples(model).simpleQueryExample,
      ]);
      expect(examples.listRequest).toContain(
        `"${model.defaultSortColumn}": "DESC"`,
      );
    }
  }, 120000);

  it("is a query and a sort the schema documents and the API runs", () => {
    for (const resource of telemetry) {
      const model: AnalyticsBaseModel = resource.model as AnalyticsBaseModel;
      const modelType: AnalyticsModelType =
        model.constructor as AnalyticsModelType;
      const { simpleQueryExample, simpleSortExample } =
        getTelemetryListExamples(model);

      expect([
        resource.name,
        AnalyticsModelSchema.getQueryModelSchema({ modelType }).safeParse(
          simpleQueryExample,
        ).success,
        AnalyticsModelSchema.getSortModelSchema({ modelType }).safeParse(
          simpleSortExample,
        ).success,
      ]).toEqual([resource.name, true, true]);

      const generator: StatementGenerator<AnalyticsBaseModel> =
        new StatementGenerator<AnalyticsBaseModel>({
          modelType: modelType,
          database: ClickhouseAppInstance,
        });

      expect(
        generator.toWhereStatement(
          JSONFunctions.deserialize(simpleQueryExample) as never,
        ).query,
      ).toMatch(/^AND \{p0:Identifier\} > \{p1:DateTime(64\(9\))?\}$/);
      expect(
        generator.toSortStatement(
          JSONFunctions.deserialize(simpleSortExample) as never,
        ).query,
      ).toBe("{p0:Identifier} DESC");
    }
  });
});
