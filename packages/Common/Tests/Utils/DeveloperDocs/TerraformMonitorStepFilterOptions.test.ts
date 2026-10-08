import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CriteriaFilterSchema } from "../../../Types/Monitor/CriteriaFilter";
import {
  FILTER_JSON_OPTIONS,
  MonitorStepsHclContext,
  monitorStepsToHcl,
} from "../../../Utils/DeveloperDocs/TerraformMonitorSteps";
import { TerraformVariableCollector } from "../../../Utils/DeveloperDocs/TerraformValues";
import { HclTestValue, toTestValue } from "./HclTestValue";

/*
 * Every option a monitor criteria filter accepts reaches Terraform in two
 * codebases: the provider (Scripts/TerraformProvider/StaticFiles/
 * monitorsteps.go - the filter's attribute types, its schema, ToAPI and
 * FromAPI) and the dashboard's Terraform export (FILTER_JSON_OPTIONS in
 * TerraformMonitorSteps.ts, the provider's FromAPI ported to HCL).
 *
 * customCodeMonitorOptions (a Result Value filter's field path) was added to
 * CriteriaFilterSchema with neither: a Terraform-managed monitor could not set
 * it, an import dropped it, the export left it out, and an apply over a
 * monitor set up in the dashboard removed it. These hold the schema, the
 * provider and the export together, so an option added to one fails here
 * until all three know it.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const MONITOR_STEPS_GO: string = fs.readFileSync(
  path.join(REPO_ROOT, "Scripts/TerraformProvider/StaticFiles/monitorsteps.go"),
  "utf8",
);

// `"check_on":   types.StringType,` in monitorStepsFilterAttrTypes.
const GO_ATTR_TYPE: RegExp = /"([a-z_]+)":\s+types\.[A-Za-z0-9]+/g;
// `"check_on": schema.StringAttribute{` at the filter schema's own level.
const GO_SCHEMA_ATTRIBUTE: RegExp =
  /^\t{3}"([a-z_]+)": schema\.[A-Za-z0-9]+Attribute\{/gm;
// `monitorStepsAttrJSON(attrs, "snmp_monitor_options", ...)` in ToAPI.
const GO_RAW_JSON_SENT: RegExp = /monitorStepsAttrJSON\(attrs, "([a-z_]+)"/g;
// `monitorStepsAPIJSONString(m["snmpMonitorOptions"])` in FromAPI.
const GO_RAW_JSON_READ: RegExp =
  /monitorStepsAPIJSONString\(m\["([A-Za-z]+)"\]\)/g;
// The description the registry docs render for custom_code_monitor_options.
const GO_CUSTOM_CODE_DESCRIPTION: RegExp =
  /"custom_code_monitor_options": schema\.StringAttribute\{\s+MarkdownDescription: "([^"]+)"/;
const REGEXP_SPECIAL_CHARACTERS: RegExp = /[.*+?^${}()|[\]\\]/g;

// A Go function of monitorsteps.go, from its signature to its closing brace.
function goFunction(name: string): string {
  const start: number = MONITOR_STEPS_GO.indexOf(`\nfunc ${name}(`);

  if (start === -1) {
    throw new Error(`monitorsteps.go has no func ${name}`);
  }

  const end: number = MONITOR_STEPS_GO.indexOf("\n}\n", start);

  return MONITOR_STEPS_GO.slice(start, end + 3);
}

function captures(source: string, pattern: RegExp): Array<string> {
  return Array.from(source.matchAll(pattern))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .sort();
}

function escapeRegExp(text: string): string {
  return text.replace(REGEXP_SPECIAL_CHARACTERS, "\\$&");
}

/*
 * The CriteriaFilter keys the provider maps to typed attributes, with those
 * attributes. Every other key CriteriaFilterSchema accepts has to be a raw-JSON
 * option in FILTER_JSON_OPTIONS.
 */
const TYPED_FILTER_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = {
  checkOn: ["check_on"],
  filterType: ["filter_type"],
  value: ["value"],
  evaluateOverTime: ["evaluate_over_time"],
  evaluateOverTimeOptions: [
    "evaluate_over_time_minutes",
    "evaluate_over_time_type",
    "evaluate_over_time_no_data_policy",
  ],
  serverMonitorOptions: ["disk_path"],
};

// A value for each typed key, as the API returns it.
const TYPED_FILTER_SAMPLES: Readonly<Record<string, unknown>> = {
  checkOn: "Result Value",
  filterType: "Equal To",
  value: "UP",
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 5,
    evaluateOverTimeType: "Average",
    onNoDataPolicy: "Ignore",
  },
  serverMonitorOptions: { diskPath: "/" },
};

function schemaKeys(): Array<string> {
  return Object.keys(CriteriaFilterSchema.shape).sort();
}

function rawJsonApiKeys(): Array<string> {
  return FILTER_JSON_OPTIONS.map(
    (option: { attributeName: string; apiKey: string }): string => {
      return option.apiKey;
    },
  ).sort();
}

function rawJsonAttributeNames(): Array<string> {
  return FILTER_JSON_OPTIONS.map(
    (option: { attributeName: string; apiKey: string }): string => {
      return option.attributeName;
    },
  ).sort();
}

function typedAttributeNames(): Array<string> {
  return Object.values(TYPED_FILTER_KEYS).flat();
}

describe("every option CriteriaFilterSchema accepts is known to Terraform", () => {
  test("each key is a typed attribute or a raw-JSON option", () => {
    const unknownToTerraform: Array<string> = schemaKeys().filter(
      (key: string): boolean => {
        return !(key in TYPED_FILTER_KEYS) && !rawJsonApiKeys().includes(key);
      },
    );

    expect(unknownToTerraform).toEqual([]);
  });

  test("customCodeMonitorOptions is the custom_code_monitor_options option", () => {
    expect(schemaKeys()).toContain("customCodeMonitorOptions");
    expect(FILTER_JSON_OPTIONS).toContainEqual({
      attributeName: "custom_code_monitor_options",
      apiKey: "customCodeMonitorOptions",
    });
  });

  test("this test's own lists name only keys the schema has", () => {
    for (const key of [
      ...Object.keys(TYPED_FILTER_KEYS),
      ...rawJsonApiKeys(),
    ]) {
      expect({ key, inSchema: schemaKeys().includes(key) }).toEqual({
        key,
        inSchema: true,
      });
    }
    expect(Object.keys(TYPED_FILTER_SAMPLES).sort()).toEqual(
      Object.keys(TYPED_FILTER_KEYS).sort(),
    );
  });
});

describe("the provider's filter (monitorsteps.go)", () => {
  const attrTypes: string = goFunction("monitorStepsFilterAttrTypes");
  const filterSchema: string = goFunction("monitorStepsFilterSchema");
  const toApi: string = goFunction("monitorStepsFilterToAPI");
  const fromApi: string = goFunction("monitorStepsFilterFromAPI");

  test("has exactly the typed attributes and raw-JSON options named here", () => {
    const expected: Array<string> = [
      ...typedAttributeNames(),
      ...rawJsonAttributeNames(),
    ].sort();

    expect(captures(attrTypes, GO_ATTR_TYPE)).toEqual(expected);
    expect(captures(filterSchema, GO_SCHEMA_ATTRIBUTE)).toEqual(expected);
  });

  test("sends and reads exactly the export's raw-JSON options", () => {
    expect(captures(toApi, GO_RAW_JSON_SENT)).toEqual(rawJsonAttributeNames());
    expect(captures(fromApi, GO_RAW_JSON_READ)).toEqual(rawJsonApiKeys());
  });

  test("maps each raw-JSON option to its own CriteriaFilter key, both ways", () => {
    for (const option of FILTER_JSON_OPTIONS) {
      const attribute: string = escapeRegExp(option.attributeName);
      const apiKey: string = escapeRegExp(option.apiKey);

      expect({
        option: option.attributeName,
        type: new RegExp(`"${attribute}":\\s+types\\.StringType,`).test(
          attrTypes,
        ),
        schema: new RegExp(
          `"${attribute}": schema\\.StringAttribute\\{[^}]*Optional:\\s+true,[^}]*stringvalidator\\.LengthAtLeast\\(1\\)`,
        ).test(filterSchema),
        sent: new RegExp(
          `monitorStepsAttrJSON\\(attrs, "${attribute}", attrPath, diags\\); ok \\{\\s+out\\["${apiKey}"\\] = v\\s+\\}`,
        ).test(toApi),
        read: new RegExp(
          `monitorStepsAPIJSONString\\(m\\["${apiKey}"\\]\\); ok \\{\\s+attrs\\["${attribute}"\\] = types\\.StringValue\\(s\\)\\s+\\}`,
        ).test(fromApi),
      }).toEqual({
        option: option.attributeName,
        type: true,
        schema: true,
        sent: true,
        read: true,
      });
    }
  });

  test("describes custom_code_monitor_options for the registry docs", () => {
    const description: RegExpMatchArray | null = filterSchema.match(
      GO_CUSTOM_CODE_DESCRIPTION,
    );

    expect(description?.[1]).toContain("Custom Code and Synthetic");
    expect(description?.[1]).toContain("resultValuePath");
    expect(description?.[1]).toContain("`jsonencode()`");
  });
});

describe("the dashboard's export", () => {
  function exportedFilter(filter: Record<string, unknown>): {
    [key: string]: HclTestValue;
  } {
    const context: MonitorStepsHclContext = {
      variables: new TerraformVariableCollector(),
      variablePrefix: "health_api",
      monitorLabel: 'monitor "Health API"',
    };
    const converted: HclTestValue = toTestValue(
      monitorStepsToHcl(
        {
          _type: "MonitorSteps",
          value: {
            monitorStepsInstanceArray: [
              {
                _type: "MonitorStep",
                value: {
                  customCode: "return { data: { status: 'UP' } };",
                  monitorCriteria: {
                    _type: "MonitorCriteria",
                    value: {
                      monitorCriteriaInstanceArray: [
                        {
                          _type: "MonitorCriteriaInstance",
                          value: {
                            name: "Unhealthy",
                            filterCondition: "Any",
                            filters: [filter],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
        context,
      ),
    );

    return (
      converted as Array<{
        criteria: Array<{ filters: Array<{ [key: string]: HclTestValue }> }>;
      }>
    )[0]!.criteria[0]!.filters[0]!;
  }

  test("writes every attribute of the provider's filter from a filter carrying every option", () => {
    const filter: Record<string, unknown> = { ...TYPED_FILTER_SAMPLES };

    for (const option of FILTER_JSON_OPTIONS) {
      filter[option.apiKey] = { example: option.apiKey };
    }

    // Every key the schema accepts is set, so nothing is left untried.
    expect(Object.keys(filter).sort()).toEqual(schemaKeys());

    expect(Object.keys(exportedFilter(filter)).sort()).toEqual(
      captures(goFunction("monitorStepsFilterAttrTypes"), GO_ATTR_TYPE),
    );
  });

  test("writes a Result Value filter's field path where the provider reads it", () => {
    expect(
      exportedFilter({
        checkOn: "Result Value",
        filterType: "Not Equal To",
        value: "UP",
        customCodeMonitorOptions: { resultValuePath: "status" },
      }),
    ).toEqual({
      check_on: "Result Value",
      filter_type: "Not Equal To",
      value: "UP",
      custom_code_monitor_options: {
        call: "jsonencode",
        args: [{ resultValuePath: "status" }],
      },
    });
  });
});
