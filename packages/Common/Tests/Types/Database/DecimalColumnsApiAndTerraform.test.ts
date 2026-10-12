import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import StatusPageHistoryChartBarColorRule from "../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { JSONObject } from "../../../Types/JSON";
import { DataSourceGenerator } from "../../../../../Scripts/TerraformProvider/Core/DataSourceGenerator";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import { ResourceGenerator } from "../../../../../Scripts/TerraformProvider/Core/ResourceGenerator";
import { StringUtils } from "../../../../../Scripts/TerraformProvider/Core/StringUtils";
import {
  OpenAPIOperation,
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * Issue #4719, through the code that publishes the API: every decimal
 * column the API reference documents, from the model to the Terraform
 * provider generated from that reference (Scripts/OpenAPI,
 * Scripts/TerraformProvider).
 *
 * A status page bar color rule's uptime percent is a decimal column. The
 * API answered it as text, "100", for a field its spec calls a number; the
 * provider read the text as null, and every apply of the rule failed with
 * "Provider produced inconsistent result after apply". So for each one:
 *
 *   - the spec says `number`, in every schema it appears in;
 *   - the provider makes it a number attribute, of the data source and of
 *     the resource where there is one;
 *   - the generated Go reads it only through numberFromAPI
 *     (StaticFiles/apinumber.go), which reads a JSON number, numeric text,
 *     and either inside a wrapper.
 *
 * That the API answers each as a JSON number is
 * DecimalColumnsReadAsNumbers.test.ts.
 */

// Postgres column types node-postgres hands back as text.
const DECIMAL_TYPES: Array<string> = ["decimal", "numeric"];

const REPORTED: string =
  "StatusPageHistoryChartBarColorRule.uptimePercentGreaterThanOrEqualTo";

interface PublishedDecimal {
  label: string;
  table: string;
  route: string;
  column: string;
}

let spec: JSONObject;
let resources: Array<TerraformResource>;
let dataSources: Array<TerraformDataSource>;
let published: Array<PublishedDecimal>;
let outputDir: string;

// Every decimal column the API reference documents.
function findPublishedDecimals(): Array<PublishedDecimal> {
  const found: Array<PublishedDecimal> = [];

  for (const modelType of Models) {
    const model: BaseModel = new modelType();

    if (!model.enableDocumentation || !model.crudApiPath || !model.tableName) {
      continue;
    }

    for (const column of getMetadataArgsStorage().columns) {
      if (
        column.target !== modelType ||
        !DECIMAL_TYPES.includes(String(column.options.type).toLowerCase())
      ) {
        continue;
      }

      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column.propertyName);

      if (!accessControl || accessControl.read.length === 0) {
        continue;
      }

      found.push({
        label: `${model.tableName}.${column.propertyName}`,
        table: model.tableName,
        route: model.crudApiPath.toString(),
        column: column.propertyName,
      });
    }
  }

  return found;
}

function isUnder(operationPath: string, route: string): boolean {
  return operationPath === route || operationPath.startsWith(`${route}/`);
}

function operationsOf(
  operations: Record<string, OpenAPIOperation | undefined>,
): Array<OpenAPIOperation> {
  return Object.values(operations).filter(
    (operation: OpenAPIOperation | undefined): boolean => {
      return Boolean(operation);
    },
  ) as Array<OpenAPIOperation>;
}

// The resource or data source the provider makes of the model at this route.
function generatedFor<T extends TerraformResource | TerraformDataSource>(
  generated: Array<T>,
  route: string,
): T | undefined {
  return generated.find((item: T): boolean => {
    return operationsOf(
      item.operations as Record<string, OpenAPIOperation | undefined>,
    ).some((operation: OpenAPIOperation): boolean => {
      return isUnder(operation.path, route);
    });
  });
}

function attributeFor(
  schema: Record<string, TerraformAttribute>,
  column: string,
): [string, TerraformAttribute] | undefined {
  return Object.entries(schema).find(
    ([, attribute]: [string, TerraformAttribute]): boolean => {
      return attribute.apiFieldName === column;
    },
  );
}

function propertyOf(
  schemaName: string,
  column: string,
): JSONObject | undefined {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
  const schema: JSONObject | undefined = schemas[schemaName] as
    | JSONObject
    | undefined;

  return ((schema?.["properties"] || {}) as JSONObject)[column] as
    | JSONObject
    | undefined;
}

function readGenerated(fileName: string): string {
  return fs.readFileSync(
    path.join(outputDir, "internal/provider", fileName),
    "utf-8",
  );
}

function countOf(source: string, text: string): number {
  return source.split(text).length - 1;
}

beforeAll(async () => {
  spec = OpenAPIUtil.generateOpenAPISpec();
  published = findPublishedDecimals();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec as unknown as OpenAPISpec);
  resources = parser.getResources();
  dataSources = parser.getDataSources();

  // The provider, cut down to the models these columns belong to.
  const routes: Array<string> = published.map(
    (decimal: PublishedDecimal): string => {
      return decimal.route;
    },
  );
  const cut: JSONObject = {
    ...spec,
    paths: Object.fromEntries(
      Object.entries(spec["paths"] as JSONObject).filter(
        ([operationPath]: [string, unknown]): boolean => {
          return routes.some((route: string): boolean => {
            return isUnder(operationPath, route);
          });
        },
      ),
    ),
  };

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "decimal-columns-tf-"));
  const config: {
    outputDir: string;
    providerName: string;
    providerVersion: string;
    goModuleName: string;
  } = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "14.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new ResourceGenerator(
    config,
    cut as unknown as OpenAPISpec,
  ).generateResources();
  await new DataSourceGenerator(
    config,
    cut as unknown as OpenAPISpec,
  ).generateDataSources();
}, 120000);

afterAll(() => {
  if (outputDir) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

describe("the decimal columns the API reference documents", () => {
  test("are found, the reported one among them", () => {
    const labels: Array<string> = published.map(
      (decimal: PublishedDecimal): string => {
        return decimal.label;
      },
    );

    // A floor, so a broken lookup cannot pass by finding nothing.
    expect(labels.length).toBeGreaterThanOrEqual(15);
    expect(labels).toContain(REPORTED);
    expect(labels).toContain("ServiceLevelObjective.targetPercentage");
    expect(labels).toContain("LlmModelPrice.inputPricePerMillionTokensInUSD");
  });

  test("are numbers in every schema the API reference publishes them in", () => {
    const notNumbers: Array<string> = [];

    for (const decimal of published) {
      let seen: number = 0;

      for (const suffix of ["", "ReadSchema", "CreateSchema", "UpdateSchema"]) {
        const property: JSONObject | undefined = propertyOf(
          `${decimal.table}${suffix}`,
          decimal.column,
        );

        if (!property) {
          continue;
        }

        seen++;
        if (property["type"] !== "number") {
          notNumbers.push(
            `${decimal.label} in ${decimal.table}${suffix}: ${JSON.stringify(property["type"])}`,
          );
        }
      }

      if (seen === 0) {
        notNumbers.push(`${decimal.label}: in no schema`);
      }
    }

    expect(notNumbers).toEqual([]);
  });
});

describe("the Terraform provider", () => {
  test("makes each a number attribute of its data source, and of its resource where it has one", () => {
    const problems: Array<string> = [];
    let resourceAttributes: number = 0;

    for (const decimal of published) {
      const dataSource: TerraformDataSource | undefined = generatedFor(
        dataSources,
        decimal.route,
      );
      const inDataSource: [string, TerraformAttribute] | undefined =
        dataSource && attributeFor(dataSource.schema, decimal.column);

      if (!inDataSource) {
        problems.push(`${decimal.label}: no data source attribute`);
      } else if (inDataSource[1].type !== "number") {
        problems.push(`${decimal.label}: data source ${inDataSource[1].type}`);
      }

      const resource: TerraformResource | undefined = generatedFor(
        resources,
        decimal.route,
      );
      const inResource: [string, TerraformAttribute] | undefined =
        resource && attributeFor(resource.schema, decimal.column);

      if (inResource) {
        resourceAttributes++;
        if (inResource[1].type !== "number") {
          problems.push(`${decimal.label}: resource ${inResource[1].type}`);
        }
      }
    }

    expect(problems).toEqual([]);
    // Uptime percents, SLO targets, burn rates, budgets, prices, coordinates.
    expect(resourceAttributes).toBeGreaterThanOrEqual(8);
  });

  test("reads each only through numberFromAPI, in every resource and data source", () => {
    const misread: Array<string> = [];

    for (const decimal of published) {
      const generated: Array<
        [string, string, Record<string, TerraformAttribute>]
      > = [];

      const resource: TerraformResource | undefined = generatedFor(
        resources,
        decimal.route,
      );
      if (resource) {
        generated.push([
          `resource_${resource.name}.go`,
          "dataMap",
          resource.schema,
        ]);
      }

      const dataSource: TerraformDataSource | undefined = generatedFor(
        dataSources,
        decimal.route,
      );
      if (dataSource) {
        generated.push([
          `data_source_${dataSource.name}.go`,
          "item",
          dataSource.schema,
        ]);
      }

      for (const [fileName, responseMap, schema] of generated) {
        const attribute: [string, TerraformAttribute] | undefined =
          attributeFor(schema, decimal.column);

        if (!attribute) {
          continue;
        }

        const source: string = readGenerated(fileName);
        const field: string = StringUtils.toPascalCase(attribute[0]);
        const read: string = `${responseMap}["${decimal.column}"]`;
        const throughTheHelper: string = `data.${field} = numberFromAPI(data.${field}, ${read})`;

        if (countOf(source, throughTheHelper) === 0) {
          misread.push(`${fileName}: ${attribute[0]} is not read at all`);
        } else if (
          countOf(source, read) !== countOf(source, throughTheHelper)
        ) {
          misread.push(`${fileName}: ${attribute[0]} is read some other way`);
        }
      }
    }

    expect(misread).toEqual([]);
  });
});

describe("oneuptime_status_page_history_chart_bar_color, the resource in the issue", () => {
  function reportedResource(): TerraformResource {
    const resource: TerraformResource | undefined = generatedFor(
      resources,
      "/status-page-history-chart-bar-color-rule",
    );

    expect(resource?.name).toBe("status_page_history_chart_bar_color");
    return resource as TerraformResource;
  }

  test("takes the uptime percent as a required number", () => {
    const attribute: TerraformAttribute | undefined =
      reportedResource().schema["uptime_percent_greater_than_or_equal_to"];

    expect(attribute?.type).toBe("number");
    expect(attribute?.apiFieldName).toBe("uptimePercentGreaterThanOrEqualTo");
    expect(
      ResourceGenerator.getSchemaFlags(
        "uptime_percent_greater_than_or_equal_to",
        attribute as TerraformAttribute,
        reportedResource(),
      ),
    ).toEqual({ required: true, optional: false, computed: false });
  });

  test("reads it back through numberFromAPI after a create, at a refresh and after an update", () => {
    const go: string = readGenerated(
      "resource_status_page_history_chart_bar_color.go",
    );
    const line: string =
      'data.UptimePercentGreaterThanOrEqualTo = numberFromAPI(data.UptimePercentGreaterThanOrEqualTo, dataMap["uptimePercentGreaterThanOrEqualTo"])';

    for (const [method, next] of [
      [") Create(ctx context.Context", ") Read(ctx context.Context"],
      [") Read(ctx context.Context", ") Update(ctx context.Context"],
      [") Update(ctx context.Context", ") Delete(ctx context.Context"],
    ] as Array<[string, string]>) {
      expect(go.indexOf(method)).toBeGreaterThan(-1);
      expect(go.substring(go.indexOf(method), go.indexOf(next))).toContain(
        line,
      );
    }
  });

  test("its data source looks a rule up by the uptime percent and reads it back the same way", () => {
    const dataSource: TerraformDataSource | undefined = generatedFor(
      dataSources,
      "/status-page-history-chart-bar-color-rule",
    );

    expect(
      dataSource?.schema["uptime_percent_greater_than_or_equal_to"]
        ?.isLookupFilter,
    ).toBe(true);

    const go: string = readGenerated(
      "data_source_status_page_history_chart_bar_color.go",
    );
    expect(go).toContain(
      'filters["uptimePercentGreaterThanOrEqualTo"] = lookupNumber(data.UptimePercentGreaterThanOrEqualTo)',
    );
    expect(go).toContain(
      'data.UptimePercentGreaterThanOrEqualTo = numberFromAPI(data.UptimePercentGreaterThanOrEqualTo, item["uptimePercentGreaterThanOrEqualTo"])',
    );
  });

  test("is the resource the provider's round trip test drives", () => {
    const roundTrip: string = readGenerated("apinumber_roundtrip_test.go");

    expect(roundTrip).toContain(`"oneuptime_${reportedResource().name}"`);
    expect(roundTrip).toContain(
      `"/api${String(new StatusPageHistoryChartBarColorRule().crudApiPath)}"`,
    );
  });
});
