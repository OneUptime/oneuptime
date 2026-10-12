import fs from "fs";
import os from "os";
import path from "path";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { GoCodeGenerator } from "../Core/GoCodeGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import {
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../Core/Types";
import { StringUtils } from "../Core/StringUtils";
import { buildFixtureSpec } from "./Fixtures";

/*
 * Issue #4719: how the generated provider reads a number the API answered.
 *
 * Postgres hands a decimal column back as text, and OneUptime servers
 * answered it as text: "uptimePercentGreaterThanOrEqualTo": "100". The
 * generated code read a number only from a JSON number (or a wrapper of
 * one), so the text read as null and every apply of a status page bar color
 * rule failed with "Provider produced inconsistent result after apply".
 *
 * Every number attribute - of every resource and every data source - is now
 * read through one Go function, numberFromAPI (StaticFiles/apinumber.go),
 * which reads a JSON number, numeric text, and either inside a wrapper, and
 * keeps the value the attribute held when the API answered the same number.
 * These pin that the generated code calls it everywhere and reads numbers no
 * other way; the Go tests copied in beside it (apinumber_test.go,
 * apinumber_roundtrip_test.go) pin what it does.
 */

const PROVIDER_DIR: string = "internal/provider";

let outputDir: string;
let resources: Array<TerraformResource>;
let dataSources: Array<TerraformDataSource>;

function readGenerated(fileName: string): string {
  return fs.readFileSync(path.join(outputDir, PROVIDER_DIR, fileName), "utf-8");
}

function generatedFiles(prefix: string): Array<string> {
  return fs
    .readdirSync(path.join(outputDir, PROVIDER_DIR))
    .filter((fileName: string): boolean => {
      return fileName.startsWith(prefix) && fileName.endsWith(".go");
    });
}

function numberAttributes(
  schema: Record<string, TerraformAttribute>,
): Array<[string, TerraformAttribute]> {
  return Object.entries(schema).filter(
    ([, attribute]: [string, TerraformAttribute]): boolean => {
      return attribute.type === "number";
    },
  );
}

function countOf(source: string, text: string): number {
  return source.split(text).length - 1;
}

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-numbers-"));
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

  await new ResourceGenerator(config, buildFixtureSpec()).generateResources();
  await new DataSourceGenerator(
    config,
    buildFixtureSpec(),
  ).generateDataSources();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildFixtureSpec());
  resources = parser.getResources();
  dataSources = parser.getDataSources();
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("the one line that reads a number", () => {
  test("passes the attribute's current value along with what the API answered", () => {
    expect(
      GoCodeGenerator.generateNumberFromAPI(
        "data.Priority",
        'dataMap["priority"]',
      ),
    ).toBe('data.Priority = numberFromAPI(data.Priority, dataMap["priority"])');
  });

  test("is what a map read of a number generates too", () => {
    for (const goType of ["int", "int64", "float64"]) {
      expect(
        GoCodeGenerator.generateMapAccess(
          "item",
          "priority",
          goType,
          "data.Priority",
        ),
      ).toBe('data.Priority = numberFromAPI(data.Priority, item["priority"])');
    }
  });
});

describe("a resource with a number attribute", () => {
  test("reads it through numberFromAPI in Create and in Read", () => {
    const go: string = readGenerated("resource_monitor_status.go");

    const create: string = go.substring(
      go.indexOf(") Create(ctx context.Context"),
      go.indexOf(") Read(ctx context.Context"),
    );
    const read: string = go.substring(
      go.indexOf(") Read(ctx context.Context"),
      go.indexOf(") Delete(ctx context.Context"),
    );

    for (const method of [create, read]) {
      expect(method).toContain(
        'data.Priority = numberFromAPI(data.Priority, dataMap["priority"])',
      );
    }
  });

  test("reads it through numberFromAPI in Update", () => {
    const go: string = readGenerated("resource_monitor.go");
    const update: string = go.substring(
      go.indexOf(") Update(ctx context.Context"),
      go.indexOf(") Delete(ctx context.Context"),
    );

    expect(update).toContain(
      'data.Priority = numberFromAPI(data.Priority, dataMap["priority"])',
    );
  });

  test("still sends a number as a JSON number", () => {
    const go: string = readGenerated("resource_monitor_status.go");

    expect(go).toContain(
      'requestDataMap["priority"] = r.bigFloatToFloat64(data.Priority.ValueBigFloat())',
    );
  });
});

describe("a data source with a number attribute", () => {
  const go: () => string = (): string => {
    return readGenerated("data_source_monitor_status.go");
  };

  test("reads it through numberFromAPI, keeping the lookup argument it was given", () => {
    expect(go()).toContain(
      'data.Priority = numberFromAPI(data.Priority, item["priority"])',
    );
  });

  test("still looks it up by the number", () => {
    expect(go()).toContain(
      'filters["priority"] = lookupNumber(data.Priority)',
    );
  });

  /*
   * Go refuses to build a file that imports a package it does not use, and
   * nothing in a data source names math/big any more.
   */
  test("imports no math/big", () => {
    for (const fileName of generatedFiles("data_source_")) {
      const source: string = readGenerated(fileName);
      expect(source).not.toContain('"math/big"');
      expect(source).not.toContain("big.");
    }
  });
});

describe("every number attribute of every generated resource and data source", () => {
  test("there are some, so the checks below check something", () => {
    const count: number =
      resources.reduce((sum: number, resource: TerraformResource): number => {
        return sum + numberAttributes(resource.schema).length;
      }, 0) +
      dataSources.reduce(
        (sum: number, dataSource: TerraformDataSource): number => {
          return sum + numberAttributes(dataSource.schema).length;
        },
        0,
      );

    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("is read from the API only through numberFromAPI", () => {
    const misread: Array<string> = [];

    const check: (
      fileName: string,
      schema: Record<string, TerraformAttribute>,
      responseMap: string,
    ) => void = (
      fileName: string,
      schema: Record<string, TerraformAttribute>,
      responseMap: string,
    ): void => {
      const source: string = readGenerated(fileName);

      for (const [name, attribute] of numberAttributes(schema)) {
        const apiField: string = attribute.apiFieldName || name;
        const field: string = StringUtils.toPascalCase(name);
        const read: string = `${responseMap}["${apiField}"]`;
        const throughTheHelper: string = `data.${field} = numberFromAPI(data.${field}, ${read})`;

        // Every place the generated code touches the answer is the helper.
        if (countOf(source, read) !== countOf(source, throughTheHelper)) {
          misread.push(`${fileName}: ${name} is read some other way`);
        }
      }
    };

    for (const resource of resources) {
      check(`resource_${resource.name}.go`, resource.schema, "dataMap");
    }
    for (const dataSource of dataSources) {
      check(`data_source_${dataSource.name}.go`, dataSource.schema, "item");
    }

    expect(misread).toEqual([]);
  });

  test("is never made from a float64 or nulled by hand any more", () => {
    for (const fileName of [
      ...generatedFiles("resource_"),
      ...generatedFiles("data_source_"),
    ]) {
      const source: string = readGenerated(fileName);

      expect(source).not.toContain("types.NumberValue(big.NewFloat(");
      expect(source).not.toContain("types.NumberNull()");
    }
  });
});

describe("the Go copied in beside the generated code", () => {
  test.each([
    ["apinumber.go"],
    ["apinumber_test.go"],
    ["apinumber_roundtrip_test.go"],
  ])("%s is copied verbatim", (fileName: string) => {
    expect(readGenerated(fileName)).toBe(
      fs.readFileSync(
        path.join(__dirname, "..", "StaticFiles", fileName),
        "utf-8",
      ),
    );
  });

  test("numberFromAPI takes what the generated code passes it", () => {
    expect(readGenerated("apinumber.go")).toContain(
      "func numberFromAPI(previous types.Number, value interface{}) types.Number {",
    );
  });

  /*
   * The round trip drives the resource issue #4719 was about by its
   * Terraform name, through the provider's protocol server: it has to be
   * the name the generator gives it (Common's
   * DecimalColumnsApiAndTerraform.test.ts holds the real spec to it).
   */
  test("the round trip names the resource from issue #4719", () => {
    expect(readGenerated("apinumber_roundtrip_test.go")).toContain(
      'barColorRuleType         = "oneuptime_status_page_history_chart_bar_color"',
    );
    expect(readGenerated("apinumber_roundtrip_test.go")).toContain(
      'barColorRuleAPIPath      = "/api/status-page-history-chart-bar-color-rule"',
    );
  });
});
