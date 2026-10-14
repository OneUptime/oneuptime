import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { DEFAULT_MONITORING_INTERVAL } from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import {
  TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER,
  TERRAFORM_PROVIDER_VERSION_PLACEHOLDER,
  getTerraformProviderVersionConstraint,
} from "../../../FeatureSet/Docs/Utils/Placeholders";
import { readPage } from "./DocsContentSupport";
import { boldPaths } from "./DocsPageShape";
import {
  codeIn,
  englishPage,
  englishSection,
  lineStartingWith,
  rowStartingWith,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import {
  COMPLETE_GUIDE,
  EXAMPLES,
  MONITOR_STEPS,
  QUICK_START,
  TERRAFORM_OVERVIEW,
  TERRAFORM_PAGES,
  TerraformDocsPageEntry,
  UNDECLARED_REFERENCES,
} from "./TerraformDocsPages";
import {
  CodeBlock,
  DATA_SOURCE_GENERATOR,
  DOCUMENTATION_GENERATOR,
  E2E_FIXTURES,
  HclAttribute,
  HclBlock,
  HclBody,
  HclValue,
  MONITOR_STEPS_GO,
  MonitorStepsSchema,
  NestedAttribute,
  PROVIDER_GENERATOR,
  RESOURCE_GENERATOR,
  ProviderAttribute,
  ProviderSchema,
  ProviderType,
  REPO_ROOT,
  attributeNamed,
  codeBlocks,
  goFunction,
  monitorStepsValues,
  parseHcl,
  readMonitorStepsSchema,
  readProvider,
  readRepoFile,
  referencesInBody,
} from "./TerraformDocsSupport";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  MAX_MONITOR_REQUEST_TIMEOUT_IN_MS,
  MAX_MONITOR_RETRY_COUNT,
} from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { DEFAULT_NTP_PORT } from "Common/Types/Monitor/NtpMonitor/NtpMonitorUtil";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  FILTER_JSON_OPTIONS,
  MONITOR_STEP_SUB_CONFIGS,
} from "Common/Utils/DeveloperDocs/TerraformMonitorSteps";
import { beforeAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 30a: the Terraform overview, quick start, complete
 * guide, monitor steps and examples, held to the provider they document and
 * to the product behind it. TerraformDocsTranslations holds the 16
 * translations to these English pages.
 *
 * The provider is read where the generator reads it (TerraformDocsSupport):
 * the real OpenAPI spec through the real OpenAPIParser, with the generator's
 * own ResourceGenerator.getSchemaFlags, and monitorsteps.go for a monitor's
 * monitor_steps. So:
 *
 *   - every HCL block on the pages parses, and every resource, data source,
 *     attribute, nested attribute and fixed value it writes is one the
 *     provider has, with every required attribute set, values of the right
 *     type, and a check_on and filter_type the Dashboard's criteria editor
 *     offers for that monitor type and that check (CriteriaFilterUtil);
 *   - every table and list of attributes, values and errors on the pages is
 *     the provider's, both ways where a page lists them all;
 *   - what the pages say about the product - menu paths, the API key form,
 *     plans, defaults, error messages, what the server does with a monitor
 *     without steps - is read from the code that makes it true.
 *
 * A renamed attribute, a value the provider no longer accepts, or a default
 * the product changed fails here, rather than in a reader's first plan.
 */

const PAGE_NAMES: Array<string> = TERRAFORM_PAGES.map(
  (entry: TerraformDocsPageEntry): string => {
    return entry.page;
  },
);

// The provider's own name for its types: oneuptime_<name>.
const PROVIDER_PREFIX: string = "oneuptime_";

// Terraform's own arguments of every resource block.
const META_ARGUMENTS: ReadonlyArray<string> = [
  "count",
  "for_each",
  "depends_on",
  "lifecycle",
  "provider",
];

const RFC_3339: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const E2E_TEST_NAME: RegExp = /`(\d{2}-[a-z0-9-]+)`/g;
const PROVIDER_TYPE_SPAN: RegExp = /^oneuptime_[a-z0-9_]+$/;

let provider: ProviderSchema;

beforeAll(async () => {
  provider = await readProvider();
}, 180000);

function pageBlocks(page: string): Array<CodeBlock> {
  return codeBlocks(englishPage(page));
}

function hclBlocksOf(page: string): Array<CodeBlock> {
  return pageBlocks(page).filter((block: CodeBlock): boolean => {
    return block.lang === "hcl";
  });
}

// Every HCL block of a page, parsed, with where it is.
function parsedBlocks(
  page: string,
): Array<{ block: CodeBlock; body: HclBody }> {
  return hclBlocksOf(page).map((block: CodeBlock) => {
    return { block: block, body: parseHcl(block.code) };
  });
}

function resourceType(name: string): ProviderType {
  const type: ProviderType | undefined = provider.resources.get(name);

  if (!type) {
    throw new Error(`The provider has no resource oneuptime_${name}`);
  }

  return type;
}

function dataSourceType(name: string): ProviderType {
  const type: ProviderType | undefined = provider.dataSources.get(name);

  if (!type) {
    throw new Error(`The provider has no data source oneuptime_${name}`);
  }

  return type;
}

// A provider type name without its prefix: oneuptime_label -> label.
function shortName(typeName: string): string {
  if (!typeName.startsWith(PROVIDER_PREFIX)) {
    throw new Error(`${typeName} is not a type of the OneUptime provider`);
  }

  return typeName.slice(PROVIDER_PREFIX.length);
}

describe("the provider these pages document", () => {
  it("is read from the spec this tree publishes: the resources and data sources the pages name are there", () => {
    expect(provider.resources.size).toBeGreaterThan(100);
    expect(provider.dataSources.size).toBeGreaterThanOrEqual(
      provider.resources.size,
    );
    expect(resourceType("monitor").attributes.get("monitor_steps")?.type).toBe(
      "monitor_steps",
    );
  });

  it("reads monitorsteps.go's nested attributes, their flags and fixed values", () => {
    const schema: MonitorStepsSchema = readMonitorStepsSchema();

    expect(schema.step.get("criteria")).toEqual(
      expect.objectContaining({ kind: "ListNested", required: true }),
    );
    expect(schema.step.get("tls_client_key")).toEqual(
      expect.objectContaining({ sensitive: true, required: false }),
    );
    expect(schema.criteria.get("filter_condition")?.required).toBe(true);
    expect(schema.filter.get("check_on")?.required).toBe(true);
    expect(schema.filter.get("value")?.required).toBe(false);
    expect(schema.incident.get("title")?.required).toBe(true);
    expect(monitorStepsValues("monitorStepsCheckOnValues")).toContain(
      "Is Online",
    );
    expect(schema.subConfigs).toContainEqual(["log_monitor", "logMonitor"]);
  });
});

/*
 * HCL checks. Each returns the problems it finds, as "where: what", so a
 * test can expect an empty list and a failure says what to fix.
 */

// What a page declares, by the address another block refers to it with.
interface Declarations {
  // "oneuptime_label.critical"
  resources: Set<string>;
  // "data.oneuptime_label.critical"
  data: Set<string>;
  // "var.oneuptime_api_key"
  variables: Set<string>;
  // "oneuptime.staging"
  providerAliases: Set<string>;
}

function declarationsOf(page: string): Declarations {
  const declared: Declarations = {
    resources: new Set(),
    data: new Set(),
    variables: new Set(),
    providerAliases: new Set(),
  };

  for (const { body } of parsedBlocks(page)) {
    for (const block of body.blocks) {
      if (block.type === "resource") {
        declared.resources.add(`${block.labels[0]}.${block.labels[1]}`);
      }

      if (block.type === "data") {
        declared.data.add(`data.${block.labels[0]}.${block.labels[1]}`);
      }

      if (block.type === "variable") {
        declared.variables.add(`var.${block.labels[0]}`);
      }

      const alias: HclAttribute | undefined = attributeNamed(
        block.body.attributes,
        "alias",
      );

      if (block.type === "provider" && alias?.value.kind === "string") {
        declared.providerAliases.add(`${block.labels[0]}.${alias.value.value}`);
      }
    }
  }

  return declared;
}

function isEmptyValue(value: HclValue): boolean {
  return (
    (value.kind === "string" && value.value === "") ||
    (value.kind === "tuple" && value.items.length === 0) ||
    (value.kind === "object" && value.attributes.length === 0)
  );
}

function isJsonencode(value: HclValue): boolean {
  return (
    value.kind === "call" &&
    value.name === "jsonencode" &&
    value.args.length === 1 &&
    value.args[0]?.kind === "object"
  );
}

function stringLiteral(value: HclValue | undefined): string | null {
  return value && value.kind === "string" ? value.value : null;
}

function boolLiteral(value: HclValue | undefined): boolean | null {
  return value && value.kind === "bool" ? value.value : null;
}

// The HCL value kinds each provider attribute type takes as a literal.
const LITERAL_KINDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  string: ["string", "template"],
  number: ["number"],
  bool: ["bool"],
  list: ["tuple"],
  set: ["tuple"],
  monitor_steps: ["tuple"],
};

// Whether a value can be of a provider attribute's type.
function typeProblem(
  attribute: ProviderAttribute,
  value: HclValue,
): string | null {
  if (value.kind === "reference") {
    return null;
  }

  if (value.kind === "call") {
    return attribute.type === "string"
      ? null
      : `${attribute.name} is a ${attribute.type}, not a function's result`;
  }

  if (!(LITERAL_KINDS[attribute.type] || []).includes(value.kind)) {
    return `${attribute.name} is a ${attribute.type}, written as a ${value.kind}`;
  }

  if (attribute.enumValues.length > 0 && value.kind === "string") {
    if (!attribute.enumValues.includes(value.value)) {
      return `${attribute.name} = "${value.value}" is not one of the provider's values`;
    }
  }

  if (attribute.isDateTime && value.kind === "string") {
    if (!RFC_3339.test(value.value)) {
      return `${attribute.name} = "${value.value}" is not an RFC 3339 time`;
    }
  }

  return null;
}

// The items of a list of objects, each as its attributes.
function objectItems(
  list: HclValue | undefined,
  path: string,
  report: (path: string, problem: string) => void,
): Array<Array<HclAttribute>> {
  if (!list || list.kind !== "tuple" || list.items.length === 0) {
    report(path, "is not a list with at least one item");
    return [];
  }

  return list.items.map((item: HclValue): Array<HclAttribute> => {
    if (item.kind !== "object") {
      report(path, `has an item that is a ${item.kind}`);
      return [];
    }

    return item.attributes;
  });
}

// Attributes monitorsteps.go has at this level, nothing empty, every required one set.
function nestedProblems(
  attributes: Array<HclAttribute>,
  allowed: Map<string, NestedAttribute>,
  path: string,
  report: (path: string, problem: string) => void,
): void {
  for (const attribute of attributes) {
    if (!allowed.has(attribute.name)) {
      report(path, `${attribute.name} is not an attribute monitorsteps.go has`);
    }

    if (isEmptyValue(attribute.value)) {
      report(path, `${attribute.name} is empty: leave it out instead`);
    }
  }

  for (const [name, nested] of Array.from(allowed.entries())) {
    if (nested.required && !attributeNamed(attributes, name)) {
      report(path, `${name} is required`);
    }
  }
}

// A string attribute that must be one of a monitorsteps.go list; its value.
function fixedValue(
  attributes: Array<HclAttribute>,
  name: string,
  listName: string,
  path: string,
  report: (path: string, problem: string) => void,
): string | null {
  const attribute: HclAttribute | undefined = attributeNamed(attributes, name);

  if (!attribute) {
    return null;
  }

  const literal: string | null = stringLiteral(attribute.value);

  if (literal === null) {
    report(path, `${name} is not a string`);
    return null;
  }

  if (!monitorStepsValues(listName).includes(literal)) {
    report(path, `${name} = "${literal}" is not one of ${listName}`);
  }

  return literal;
}

// The values of a criteria editor dropdown.
function optionValues(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return String(option.value);
  });
}

const URL_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.SSLCertificate,
];

const HOST_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
  MonitorType.NTP,
];

// Filter types that compare with nothing: they take no value.
const FILTER_TYPES_WITHOUT_VALUE: ReadonlyArray<string> = [
  FilterType.True,
  FilterType.False,
  FilterType.IsEmpty,
  FilterType.IsNotEmpty,
  FilterType.IsExecuting,
  FilterType.IsNotExecuting,
];

function filterProblems(
  filter: Array<HclAttribute>,
  monitorType: MonitorType,
  path: string,
  report: (path: string, problem: string) => void,
): void {
  const schema: MonitorStepsSchema = readMonitorStepsSchema();

  nestedProblems(filter, schema.filter, path, report);

  const checkOn: string | null = fixedValue(
    filter,
    "check_on",
    "monitorStepsCheckOnValues",
    path,
    report,
  );
  const filterType: string | null = fixedValue(
    filter,
    "filter_type",
    "monitorStepsFilterTypeValues",
    path,
    report,
  );

  if (
    checkOn &&
    !optionValues(
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType),
    ).includes(checkOn)
  ) {
    report(
      path,
      `a ${monitorType} monitor's criteria editor offers no "${checkOn}"`,
    );
  }

  if (
    checkOn &&
    filterType &&
    !optionValues(
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn as CheckOn),
    ).includes(filterType)
  ) {
    report(
      path,
      `"${checkOn}" is not compared with "${filterType}" in the criteria editor`,
    );
  }

  const value: HclAttribute | undefined = attributeNamed(filter, "value");

  if (value && value.value.kind !== "string") {
    report(path, "value is not a string");
  }

  if (filterType) {
    const takesNoValue: boolean =
      FILTER_TYPES_WITHOUT_VALUE.includes(filterType);

    if (takesNoValue && value) {
      report(path, `"${filterType}" takes no value`);
    }

    if (!takesNoValue && !value) {
      report(path, `"${filterType}" needs a value`);
    }
  }

  fixedValue(
    filter,
    "evaluate_over_time_type",
    "monitorStepsEvaluateOverTimeTypeValues",
    path,
    report,
  );
  fixedValue(
    filter,
    "evaluate_over_time_no_data_policy",
    "monitorStepsNoDataPolicyValues",
    path,
    report,
  );

  for (const option of FILTER_JSON_OPTIONS) {
    const json: HclAttribute | undefined = attributeNamed(
      filter,
      option.attributeName,
    );

    if (json && !isJsonencode(json.value)) {
      report(
        path,
        `${option.attributeName} is not written with jsonencode({ ... })`,
      );
    }
  }
}

function criteriaProblems(
  criteria: Array<HclAttribute>,
  monitorType: MonitorType,
  path: string,
  report: (path: string, problem: string) => void,
): void {
  const schema: MonitorStepsSchema = readMonitorStepsSchema();

  nestedProblems(criteria, schema.criteria, path, report);
  fixedValue(
    criteria,
    "filter_condition",
    "monitorStepsFilterConditionValues",
    path,
    report,
  );

  if (
    boolLiteral(attributeNamed(criteria, "change_monitor_status")?.value) &&
    !attributeNamed(criteria, "monitor_status_id")
  ) {
    report(path, "changes the status, but names no monitor_status_id");
  }

  const templateLists: Array<[string, string, Map<string, NestedAttribute>]> = [
    ["incidents", "create_incidents", schema.incident],
    ["alerts", "create_alerts", schema.alert],
  ];

  for (const [list, flag, templateSchema] of templateLists) {
    const templates: HclAttribute | undefined = attributeNamed(criteria, list);

    if (!templates) {
      continue;
    }

    if (!boolLiteral(attributeNamed(criteria, flag)?.value)) {
      report(path, `has ${list} without ${flag} = true`);
    }

    objectItems(templates.value, `${path}.${list}`, report).forEach(
      (template: Array<HclAttribute>, index: number): void => {
        nestedProblems(
          template,
          templateSchema,
          `${path}.${list}[${index}]`,
          report,
        );
      },
    );
  }

  objectItems(
    attributeNamed(criteria, "filters")?.value,
    `${path}.filters`,
    report,
  ).forEach((filter: Array<HclAttribute>, index: number): void => {
    filterProblems(filter, monitorType, `${path}.filters[${index}]`, report);
  });
}

function stepProblems(
  step: Array<HclAttribute>,
  monitorType: MonitorType,
  path: string,
  report: (path: string, problem: string) => void,
): void {
  const schema: MonitorStepsSchema = readMonitorStepsSchema();

  nestedProblems(step, schema.step, path, report);

  for (const [name] of schema.subConfigs) {
    const config: HclAttribute | undefined = attributeNamed(step, name);

    if (config && !isJsonencode(config.value)) {
      report(path, `${name} is not written with jsonencode({ ... })`);
    }
  }

  const hasDestination: boolean = Boolean(
    attributeNamed(step, "monitor_destination"),
  );
  const destinationType: string | null = fixedValue(
    step,
    "monitor_destination_type",
    "monitorStepsDestinationTypeValues",
    path,
    report,
  );

  if (hasDestination !== Boolean(destinationType)) {
    report(
      path,
      "monitor_destination and monitor_destination_type go together",
    );
  }

  if (
    destinationType &&
    URL_MONITOR_TYPES.includes(monitorType) &&
    destinationType !== "URL"
  ) {
    report(path, `a ${monitorType} monitor checks a URL`);
  }

  if (
    destinationType &&
    HOST_MONITOR_TYPES.includes(monitorType) &&
    destinationType === "URL"
  ) {
    report(path, `a ${monitorType} monitor checks a hostname or an IP address`);
  }

  fixedValue(
    step,
    "request_type",
    "monitorStepsRequestTypeValues",
    path,
    report,
  );

  const port: HclValue | undefined = attributeNamed(step, "port")?.value;

  if (
    port &&
    !(port.kind === "number" && port.value >= 1 && port.value <= 65535)
  ) {
    report(path, "port is not a number from 1 to 65535");
  }

  objectItems(
    attributeNamed(step, "criteria")?.value,
    `${path}.criteria`,
    report,
  ).forEach((criteria: Array<HclAttribute>, index: number): void => {
    criteriaProblems(
      criteria,
      monitorType,
      `${path}.criteria[${index}]`,
      report,
    );
  });
}

/*
 * monitor_steps, as monitorsteps.go takes it and as the Dashboard judges it:
 * nested attributes it has, required ones set, fixed values it accepts,
 * values of the right kind, nothing empty, and a check_on and filter_type
 * the criteria editor offers for this monitor type and this check.
 */
function monitorStepsProblems(
  value: HclValue,
  monitorType: MonitorType,
  where: string,
): Array<string> {
  const problems: Array<string> = [];
  const report: (path: string, problem: string) => void = (
    path: string,
    problem: string,
  ): void => {
    problems.push(`${where} ${path}: ${problem}`);
  };

  objectItems(value, "monitor_steps", report).forEach(
    (step: Array<HclAttribute>, index: number): void => {
      stepProblems(step, monitorType, `monitor_steps[${index}]`, report);
    },
  );

  return problems;
}

/*
 * The fragments of a page: snippets that are one attribute of a monitor
 * (its steps, a criteria list, a filter list), and the monitor type each
 * belongs to, as the prose around it says.
 */
const FRAGMENT_MONITOR_TYPES: Readonly<Record<string, MonitorType>> = {
  // "Comparing one field of a script's result": a Custom Code monitor's step.
  monitor_steps: MonitorType.CustomJavaScriptCode,
  // "Incidents and alerts": the website is unreachable.
  criteria: MonitorType.Website,
  // A filter on when an SSL certificate expires.
  filters: MonitorType.SSLCertificate,
};

function stringValue(value: string, line: number): HclValue {
  return { kind: "string", value: value, line: line };
}

function attributeOf(name: string, value: HclValue): HclAttribute {
  return { name: name, value: value, line: value.line };
}

// A fragment as the monitor_steps of the monitor it belongs to.
function fragmentAsSteps(fragment: HclAttribute): HclValue {
  if (fragment.name === "monitor_steps") {
    return fragment.value;
  }

  const line: number = fragment.line;
  const criteria: HclValue =
    fragment.name === "criteria"
      ? fragment.value
      : {
          kind: "tuple",
          line: line,
          items: [
            {
              kind: "object",
              line: line,
              attributes: [
                attributeOf("name", stringValue("Fragment", line)),
                attributeOf("filter_condition", stringValue("All", line)),
                fragment,
              ],
            },
          ],
        };

  return {
    kind: "tuple",
    line: line,
    items: [
      {
        kind: "object",
        line: line,
        attributes: [
          attributeOf(
            "monitor_destination",
            stringValue("https://example.com", line),
          ),
          attributeOf("monitor_destination_type", stringValue("URL", line)),
          attributeOf("criteria", criteria),
        ],
      },
    ],
  };
}

const PROVIDER_ARGUMENTS: ReadonlyArray<string> = [
  "api_key",
  "oneuptime_url",
  "alias",
];
const VARIABLE_ARGUMENTS: ReadonlyArray<string> = [
  "description",
  "type",
  "default",
  "sensitive",
];
const OUTPUT_ARGUMENTS: ReadonlyArray<string> = [
  "value",
  "description",
  "sensitive",
];

function terraformBlockProblems(block: HclBlock, where: string): Array<string> {
  const problems: Array<string> = [];

  for (const nested of block.body.blocks) {
    if (nested.type === "backend") {
      continue;
    }

    if (nested.type !== "required_providers") {
      problems.push(`${where}: terraform has a ${nested.type} block`);
      continue;
    }

    const requirement: HclValue | undefined = attributeNamed(
      nested.body.attributes,
      "oneuptime",
    )?.value;

    if (!requirement || requirement.kind !== "object") {
      problems.push(`${where}: required_providers names no oneuptime`);
      continue;
    }

    const source: string | null = stringLiteral(
      attributeNamed(requirement.attributes, "source")?.value,
    );
    const version: string | null = stringLiteral(
      attributeNamed(requirement.attributes, "version")?.value,
    );

    if (source !== "oneuptime/oneuptime") {
      problems.push(`${where}: the provider's source is "${source}"`);
    }

    if (version !== TERRAFORM_PROVIDER_VERSION_PLACEHOLDER) {
      problems.push(
        `${where}: the version is "${version}", not the placeholder`,
      );
    }
  }

  return problems;
}

function resourceBlockProblems(
  block: HclBlock,
  type: ProviderType,
  where: string,
): Array<string> {
  const typeName: string = block.labels[0] as string;
  const attributes: Array<HclAttribute> = block.body.attributes;
  const problems: Array<string> = [];

  for (const attribute of attributes) {
    if (META_ARGUMENTS.includes(attribute.name)) {
      continue;
    }

    const known: ProviderAttribute | undefined = type.attributes.get(
      attribute.name,
    );

    if (!known || !known.settable) {
      problems.push(
        `${where}: ${typeName}.${attribute.name} is not an attribute a configuration sets`,
      );
      continue;
    }

    const problem: string | null = typeProblem(known, attribute.value);

    if (problem) {
      problems.push(`${where}: ${problem}`);
    }

    if (attribute.name === "monitor_steps") {
      problems.push(
        ...monitorStepsProblems(
          attribute.value,
          stringLiteral(
            attributeNamed(attributes, "monitor_type")?.value,
          ) as MonitorType,
          where,
        ),
      );
    }
  }

  for (const known of Array.from(type.attributes.values())) {
    if (known.required && !attributeNamed(attributes, known.name)) {
      problems.push(`${where}: ${typeName} needs ${known.name}`);
    }
  }

  for (const nested of block.body.blocks) {
    if (nested.type !== "lifecycle") {
      problems.push(`${where}: ${typeName} has no ${nested.type} block`);
    }
  }

  return problems;
}

function dataBlockProblems(
  block: HclBlock,
  type: ProviderType,
  where: string,
): Array<string> {
  const typeName: string = block.labels[0] as string;
  const names: Array<string> = block.body.attributes.map(
    (attribute: HclAttribute): string => {
      return attribute.name;
    },
  );
  const problems: Array<string> = [];

  for (const name of names) {
    const attribute: ProviderAttribute | undefined = type.attributes.get(name);

    if (!attribute || (name !== "id" && !attribute.isLookupFilter)) {
      problems.push(`${where}: ${typeName} cannot be looked up by ${name}`);
    }
  }

  if (names.length === 0 || (names.includes("id") && names.length > 1)) {
    problems.push(`${where}: a lookup sets id, or other arguments, not both`);
  }

  return problems;
}

function movedBlockProblems(block: HclBlock, where: string): Array<string> {
  const from: HclValue | undefined = attributeNamed(
    block.body.attributes,
    "from",
  )?.value;
  const to: HclValue | undefined = attributeNamed(
    block.body.attributes,
    "to",
  )?.value;

  if (from?.kind !== "reference" || to?.kind !== "reference") {
    return [`${where}: moved needs from and to`];
  }

  const [fromType, fromName] = from.path.split(".");
  const [toType, toName] = to.path.split(".");
  const target: ProviderType = resourceType(shortName(toType as string));

  if (
    fromName !== toName ||
    target.legacyName !== shortName(fromType as string)
  ) {
    return [
      `${where}: ${from.path} is not the old name of ${to.path} (that was ${PROVIDER_PREFIX}${target.legacyName})`,
    ];
  }

  return [];
}

function argumentsProblems(
  block: HclBlock,
  allowed: ReadonlyArray<string>,
  where: string,
): Array<string> {
  return block.body.attributes
    .filter((attribute: HclAttribute): boolean => {
      return !allowed.includes(attribute.name);
    })
    .map((attribute: HclAttribute): string => {
      return `${where}: a ${block.type} block has no ${attribute.name}`;
    });
}

// Every problem of one top-level block of a page.
function blockProblems(block: HclBlock, where: string): Array<string> {
  switch (block.type) {
    case "terraform":
      return terraformBlockProblems(block, where);
    case "provider":
      return [
        ...(block.labels[0] === "oneuptime"
          ? []
          : [`${where}: provider "${block.labels[0]}"`]),
        ...argumentsProblems(block, PROVIDER_ARGUMENTS, where),
        ...(attributeNamed(block.body.attributes, "api_key")?.value.kind ===
        "string"
          ? [`${where}: an API key written into the configuration`]
          : []),
      ];
    case "resource":
    case "data": {
      const typeName: string = block.labels[0] as string;
      const type: ProviderType | undefined = (
        block.type === "data" ? provider.dataSources : provider.resources
      ).get(shortName(typeName));

      if (!type) {
        return [`${where}: the provider has no ${block.type} ${typeName}`];
      }

      return block.type === "data"
        ? dataBlockProblems(block, type, where)
        : resourceBlockProblems(block, type, where);
    }
    case "moved":
      return movedBlockProblems(block, where);
    case "variable":
      return argumentsProblems(block, VARIABLE_ARGUMENTS, where);
    case "output":
      return argumentsProblems(block, OUTPUT_ARGUMENTS, where);
    default:
      return [`${where}: a ${block.type} block`];
  }
}

// Type names a value can mention that are not references: map(string).
const TYPE_KEYWORDS: ReadonlyArray<string> = ["string", "number", "bool"];

// Every problem of a reference: what it names is there, and has that attribute.
function referenceProblems(
  page: string,
  reference: string,
  declared: Declarations,
  where: string,
): Array<string> {
  const allowed: ReadonlyArray<string> = UNDECLARED_REFERENCES[page] || [];
  const parts: Array<string> = reference.split(".");

  if (TYPE_KEYWORDS.includes(reference) || parts[0] === "each") {
    return [];
  }

  if (parts[0] === "var") {
    const variable: string = `var.${parts[1]}`;

    return declared.variables.has(variable) || allowed.includes(variable)
      ? []
      : [`${where}: ${variable} is not declared on the page`];
  }

  if (parts[0] === "oneuptime") {
    return declared.providerAliases.has(reference)
      ? []
      : [`${where}: no provider alias ${reference}`];
  }

  const isData: boolean = parts[0] === "data";
  const [typeName, name, attribute] = isData ? parts.slice(1) : parts;
  const address: string = `${isData ? "data." : ""}${typeName}.${name}`;
  const type: ProviderType | undefined = (
    isData ? provider.dataSources : provider.resources
  ).get(shortName(typeName as string));

  if (!type) {
    return [
      `${where}: ${reference} names no ${isData ? "data source" : "resource"}`,
    ];
  }

  const problems: Array<string> = [];

  if (
    attribute !== undefined &&
    attribute !== "id" &&
    !type.attributes.has(attribute)
  ) {
    problems.push(`${where}: ${type.name} has no attribute ${attribute}`);
  }

  const isDeclared: boolean = isData
    ? declared.data.has(address)
    : declared.resources.has(address);

  if (!isDeclared && !allowed.includes(address)) {
    problems.push(`${where}: ${address} is not declared on the page`);
  }

  return problems;
}

// Every problem of a page's HCL, block by block.
function pageHclProblems(page: string): Array<string> {
  const declared: Declarations = declarationsOf(page);
  const problems: Array<string> = [];

  for (const { block, body } of parsedBlocks(page)) {
    const where: string = `${page}:${block.line}`;

    for (const nested of body.blocks) {
      problems.push(
        ...blockProblems(
          nested,
          `${where} ${nested.type} ${nested.labels.join(".")}`,
        ),
      );
    }

    for (const attribute of body.attributes) {
      if (block.info === 'title="terraform.tfvars"') {
        if (!declared.variables.has(`var.${attribute.name}`)) {
          problems.push(
            `${where}: terraform.tfvars sets an undeclared ${attribute.name}`,
          );
        }

        continue;
      }

      const monitorType: MonitorType | undefined =
        FRAGMENT_MONITOR_TYPES[attribute.name];

      if (!monitorType) {
        problems.push(
          `${where}: a fragment of ${attribute.name}, which no monitor type is listed for`,
        );
        continue;
      }

      problems.push(
        ...monitorStepsProblems(fragmentAsSteps(attribute), monitorType, where),
      );
    }

    // A moved block names an old type on purpose: movedBlockProblems reads it.
    const referring: HclBody = {
      attributes: body.attributes,
      blocks: body.blocks.filter((nested: HclBlock): boolean => {
        return nested.type !== "moved";
      }),
    };

    for (const reference of referencesInBody(referring)) {
      problems.push(...referenceProblems(page, reference, declared, where));
    }
  }

  return problems;
}

// The address a reference names: "oneuptime_label.critical", "var.x", "data.oneuptime_x.y".
function addressOf(reference: string): string {
  const parts: Array<string> = reference.split(".");

  return parts[0] === "data"
    ? parts.slice(0, 3).join(".")
    : parts.slice(0, 2).join(".");
}

describe("the HCL on the pages", () => {
  it.each(PAGE_NAMES)("%s: every block parses as HCL", (page: string) => {
    const failures: Array<string> = [];

    for (const block of hclBlocksOf(page)) {
      try {
        parseHcl(block.code);
      } catch (error) {
        failures.push(`${page}:${block.line}: ${(error as Error).message}`);
      }
    }

    expect(hclBlocksOf(page).length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it.each(PAGE_NAMES)(
    "%s: writes only resources, data sources, attributes and values the provider has, with every required attribute",
    (page: string) => {
      expect(pageHclProblems(page)).toEqual([]);
    },
  );

  it.each(PAGE_NAMES)(
    "%s: leaves to the reader only names it uses and does not declare",
    (page: string) => {
      const declared: Declarations = declarationsOf(page);
      const used: Set<string> = new Set(
        parsedBlocks(page).flatMap(({ body }: { body: HclBody }) => {
          return referencesInBody(body).map(addressOf);
        }),
      );

      for (const allowed of UNDECLARED_REFERENCES[page] || []) {
        expect({
          page,
          allowed,
          used: used.has(allowed),
          declared:
            declared.resources.has(allowed) || declared.variables.has(allowed),
        }).toEqual({ page, allowed, used: true, declared: false });
      }
    },
  );

  it("write every ID as OneUptime writes one: a UUID", () => {
    let ids: number = 0;

    for (const page of PAGE_NAMES) {
      for (const { body } of parsedBlocks(page)) {
        for (const block of body.blocks) {
          const id: string | null = stringLiteral(
            attributeNamed(block.body.attributes, "id")?.value,
          );

          if (id !== null) {
            ids++;
            expect({ page, id, uuid: UUID.test(id) }).toEqual({
              page,
              id,
              uuid: true,
            });
          }
        }
      }
    }

    expect(ids).toBeGreaterThan(0);
  });

  it("keep every secret in a variable marked sensitive", () => {
    for (const page of PAGE_NAMES) {
      for (const { body } of parsedBlocks(page)) {
        for (const block of body.blocks) {
          const sensitive: boolean | null = boolLiteral(
            attributeNamed(block.body.attributes, "sensitive")?.value,
          );

          // A variable that holds a key: its name says so.
          if (
            block.type === "variable" &&
            (block.labels[0] as string).endsWith("_key")
          ) {
            expect({ page, variable: block.labels[0], sensitive }).toEqual({
              page,
              variable: block.labels[0],
              sensitive: true,
            });
          }
        }
      }
    }
  });
});

describe("the checks themselves", () => {
  it("catch an attribute the provider lacks, a value it refuses and a missing requirement", () => {
    const body: HclBody = parseHcl(
      [
        'resource "oneuptime_label" "x" {',
        '  name   = "x"',
        '  colour = "#FFFFFF"',
        "}",
        "",
        'resource "oneuptime_monitor" "y" {',
        '  name         = "y"',
        '  monitor_type = "Websites"',
        "}",
      ].join("\n"),
    );
    const problems: Array<string> = body.blocks.flatMap((block: HclBlock) => {
      return blockProblems(block, block.labels.join("."));
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        "oneuptime_label.x: oneuptime_label.colour is not an attribute a configuration sets",
        "oneuptime_label.x: oneuptime_label needs color",
        'oneuptime_monitor.y: monitor_type = "Websites" is not one of the provider\'s values',
      ]),
    );
  });

  it("catch a check the monitor type does not offer, a comparison the check does not take, and a number for a value", () => {
    const steps: HclValue = (
      parseHcl(
        [
          "monitor_steps = [{",
          '  monitor_destination      = "https://example.com"',
          '  monitor_destination_type = "URL"',
          "  criteria = [{",
          '    name             = "x"',
          '    filter_condition = "All"',
          "    filters = [",
          '      { check_on = "Expires In Days", filter_type = "Less Than", value = "14" },',
          '      { check_on = "Response Status Code", filter_type = "Contains", value = 200 }',
          "    ]",
          "  }]",
          "}]",
        ].join("\n"),
      ).attributes[0] as HclAttribute
    ).value;

    expect(monitorStepsProblems(steps, MonitorType.Website, "x")).toEqual(
      expect.arrayContaining([
        'x monitor_steps[0].criteria[0].filters[0]: a Website monitor\'s criteria editor offers no "Expires In Days"',
        'x monitor_steps[0].criteria[0].filters[1]: "Response Status Code" is not compared with "Contains" in the criteria editor',
        "x monitor_steps[0].criteria[0].filters[1]: value is not a string",
      ]),
    );
  });

  it("catch an empty placeholder, a status change with no status and a destination without its type", () => {
    const steps: HclValue = (
      parseHcl(
        [
          "monitor_steps = [{",
          '  monitor_destination = "gateway.example.com"',
          "  request_headers     = {}",
          "  criteria = [{",
          '    name                  = "x"',
          '    filter_condition      = "Any"',
          "    change_monitor_status = true",
          '    filters               = [{ check_on = "Is Online", filter_type = "False" }]',
          "  }]",
          "}]",
        ].join("\n"),
      ).attributes[0] as HclAttribute
    ).value;

    expect(monitorStepsProblems(steps, MonitorType.Ping, "x")).toEqual(
      expect.arrayContaining([
        "x monitor_steps[0]: request_headers is empty: leave it out instead",
        "x monitor_steps[0]: monitor_destination and monitor_destination_type go together",
        "x monitor_steps[0].criteria[0]: changes the status, but names no monitor_status_id",
      ]),
    );
  });

  it("catch a reference to an attribute the provider lacks, or to nothing the page declares", () => {
    const declared: Declarations = {
      resources: new Set(["oneuptime_label.x"]),
      data: new Set(),
      variables: new Set(),
      providerAliases: new Set(),
    };

    expect(
      referenceProblems(QUICK_START, "oneuptime_label.x.colour", declared, "x"),
    ).toEqual(["x: label has no attribute colour"]);
    expect(
      referenceProblems(QUICK_START, "oneuptime_label.y.id", declared, "x"),
    ).toEqual(["x: oneuptime_label.y is not declared on the page"]);
    expect(referenceProblems(QUICK_START, "var.secret", declared, "x")).toEqual(
      ["x: var.secret is not declared on the page"],
    );
  });

  it("read the HCL the pages write: heredocs, templates, quoted keys, calls and references", () => {
    const body: HclBody = parseHcl(
      [
        'resource "oneuptime_monitor" "z" {',
        '  name = "Website: ${each.key}"',
        "  custom_code = <<-EOT",
        '    return { data: "x" };',
        "  EOT",
        "  headers = {",
        '    "Content-Type" = "application/json"',
        "  }",
        '  body   = jsonencode({ check = "health" })',
        "  labels = [oneuptime_label.a.id, data.oneuptime_label.b.id]",
        "}",
      ].join("\n"),
    );
    const block: HclBlock = body.blocks[0] as HclBlock;

    expect(block.labels).toEqual(["oneuptime_monitor", "z"]);
    expect(attributeNamed(block.body.attributes, "name")?.value.kind).toBe(
      "template",
    );
    expect(
      stringLiteral(
        attributeNamed(block.body.attributes, "custom_code")?.value,
      ),
    ).toBe('return { data: "x" };');
    expect(referencesInBody(block.body)).toEqual([
      "each.key",
      "oneuptime_label.a.id",
      "data.oneuptime_label.b.id",
    ]);
    expect(() => {
      return parseHcl('resource "x" "y" {\n  a = "b" "c"\n}');
    }).toThrow();
    expect(() => {
      return parseHcl('resource "x" "y" {\n  a = ["b" "c"]\n}');
    }).toThrow();
  });
});

/*
 * What each page says, against the code that makes it true.
 */

// The resource or data source names a text writes as code: `oneuptime_label`.
function providerTypesIn(text: string): Array<string> {
  return codeIn(text).filter((span: string): boolean => {
    return PROVIDER_TYPE_SPAN.test(span);
  });
}

// A heading's section of the English page, as the pages write it.
function section(page: string, heading: string): string {
  return englishSection(page, heading);
}

const DETAILS_OPENING: string = ":::details ";

// A side menu's section: `title: "Advanced",` followed by its items.
const MENU_SECTION: RegExp =
  /title: "([^"]+)",\s+(?:defaultCollapsed: (?:true|false),\s+)?items: \[/g;

// The section of a Dashboard side menu an item is listed in.
function menuSectionOf(menu: string, item: string): string | null {
  const itemAt: number = menu.indexOf(`title: "${item}",`);
  let found: string | null = null;

  for (const match of Array.from(menu.matchAll(MENU_SECTION))) {
    if ((match.index as number) < itemAt) {
      found = match[1] as string;
    }
  }

  return itemAt < 0 ? null : found;
}

// An attribute of the provider block's schema, up to the next attribute.
function providerSchemaAttribute(source: string, name: string): string {
  const start: number = source.indexOf(`"${name}": schema.StringAttribute{`);

  if (start < 0) {
    throw new Error(`The provider's schema has no ${name}`);
  }

  return source.slice(start, source.indexOf("\n            },", start));
}

describe("the overview", () => {
  it("names resources the provider has, each with its data source, in the table of what you can manage", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(TERRAFORM_OVERVIEW, "## What you can manage"),
      "Resource",
    );
    const named: Array<string> = rows.flatMap((row: Array<string>) => {
      return providerTypesIn(row[0] as string);
    });

    expect(named.length).toBeGreaterThanOrEqual(15);

    for (const typeName of named) {
      expect({
        typeName,
        resource: provider.resources.has(shortName(typeName)),
      }).toEqual({
        typeName,
        resource: true,
      });
      expect({
        typeName,
        dataSource: provider.dataSources.has(shortName(typeName)),
      }).toEqual({ typeName, dataSource: true });
    }
  });

  it("is right that every resource has a data source of the same name", () => {
    expect(
      section(TERRAFORM_OVERVIEW, "### Read what already exists"),
    ).toContain("Every resource has a data source of the same name");

    for (const name of Array.from(provider.resources.keys())) {
      expect({ name, dataSource: provider.dataSources.has(name) }).toEqual({
        name,
        dataSource: true,
      });
    }
  });

  it("names the renamed types as the provider names them, old and new, owners and feeds too", () => {
    const text: string = section(TERRAFORM_OVERVIEW, "### Renamed resources");

    for (const [name, legacyName] of [
      ["iot_fleet", "io_t_fleet"],
      ["vcenter", "v_center"],
    ]) {
      expect(text).toContain(`\`oneuptime_${name}\``);
      expect(text).toContain(`\`oneuptime_${legacyName}\``);
      expect(resourceType(name as string).legacyName).toBe(legacyName);
    }

    // "and the same for their label rules, owners and feeds".
    for (const name of [
      "iot_fleet_label_rule",
      "iot_fleet_team_owner",
      "vcenter_feed",
      "vcenter_user_owner",
    ]) {
      expect(resourceType(name).legacyName).toBe(
        name.replace("iot_fleet", "io_t_fleet").replace("vcenter", "v_center"),
      );
    }

    // The provider says so in a plan, and keeps the old name working.
    expect(readRepoFile(RESOURCE_GENERATOR)).toContain(
      "has been renamed to ${this.providerName}_${resource.name}",
    );
    expect(readRepoFile(RESOURCE_GENERATOR)).toContain("legacyNameStateMover(");
  });

  it("asks for the versions the generated docs give for import blocks", () => {
    expect(readRepoFile(DOCUMENTATION_GENERATOR)).toContain(
      "block (Terraform 1.5+, OpenTofu 1.6+)",
    );

    for (const page of [TERRAFORM_OVERVIEW, QUICK_START]) {
      expect(englishPage(page)).toContain(
        "**Terraform 1.5 or later, or OpenTofu 1.6 or later.**",
      );
    }
  });

  it("is right that API keys need the Growth plan on OneUptime Cloud", () => {
    expect(new ApiKey().createBillingPlan).toBe(PlanType.Growth);

    for (const page of [TERRAFORM_OVERVIEW, QUICK_START]) {
      expect(englishPage(page)).toContain(
        "**On OneUptime Cloud, the Growth plan or above.** A project's API keys work only on it.",
      );
    }
  });

  it("says what the version placeholder takes: the newest release of this major", () => {
    const text: string = section(TERRAFORM_OVERVIEW, "### Pick a version");

    expect(text).toContain(
      `The constraint above, \`${TERRAFORM_PROVIDER_VERSION_PLACEHOLDER}\`, takes the newest ${TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER}.x release`,
    );
    expect(getTerraformProviderVersionConstraint("14.0.55")).toBe("~> 14.0");
  });

  it("names the Developer section and its pages as the Dashboard does", () => {
    const text: string = section(
      TERRAFORM_OVERVIEW,
      "## Let the dashboard write it",
    );

    expect(text).toContain(`**${DEVELOPER_DOCS_SECTION_TITLE}**`);

    for (const definition of DEVELOPER_DOCS_PAGES as Array<DeveloperDocsPageDefinition>) {
      expect(text).toContain(`**${definition.title}**`);
    }
  });

  it("writes every kind of attribute the way the provider types it", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(TERRAFORM_OVERVIEW, "## How attributes are written"),
      "Kind of value",
    );
    const example: (kind: string) => string = (kind: string): string => {
      return codeIn(rowStartingWith(rows, kind)[2] as string)[0] as string;
    };

    expect(example("Text, numbers, true or false")).toBe(
      "is_public_status_page = false",
    );
    expect(
      resourceType("status_page").attributes.get("is_public_status_page")?.type,
    ).toBe("bool");
    expect(example("A reference to another record")).toBe(
      "incident_severity_id = oneuptime_incident_severity.sev1.id",
    );
    expect(
      resourceType("incident").attributes.get("incident_severity_id")?.relation,
    ).toBe("incident_severity");
    expect(example("A list of references")).toBe(
      "labels = [oneuptime_label.critical.id]",
    );
    expect(resourceType("monitor").attributes.get("labels")).toEqual(
      expect.objectContaining({ type: "set", relation: "label" }),
    );
    expect(example("A color, a domain and other wrapped values")).toBe(
      'color = "#FF5733"',
    );
    expect(resourceType("label").attributes.get("color")?.isComplexObject).toBe(
      true,
    );
    expect(
      resourceType("domain").attributes.get("domain")?.isComplexObject,
    ).toBe(true);
    expect(example("A date and time")).toBe(
      'starts_at = "2030-06-01T02:00:00Z"',
    );
    expect(
      resourceType("scheduled_maintenance_event").attributes.get("starts_at")
        ?.isDateTime,
    ).toBe(true);
    expect(example("Other structured settings")).toBe(
      "log_monitor = jsonencode({ ... })",
    );
    expect(readMonitorStepsSchema().subConfigs).toContainEqual([
      "log_monitor",
      "logMonitor",
    ]);
  });
});

describe("the quick start", () => {
  const page: string = englishPage(QUICK_START);

  it("walks the API key form as the Dashboard draws it", () => {
    const access: string = readRepoFile(
      "packages/App/FeatureSet/Dashboard/src/Components/Permission/RoleAccess.ts",
    );
    const form: string = readRepoFile(
      "packages/App/FeatureSet/Dashboard/src/Components/ApiKey/ApiKeyCreateForm.ts",
    );
    const view: string = readRepoFile(
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView.tsx",
    );
    const menu: string = readRepoFile(
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu.tsx",
    );

    for (const title of [
      "Access",
      "Project Admin",
      "Choose permissions later",
    ]) {
      expect(access).toContain(`title: "${title}"`);
      expect(page).toContain(`**${title}**`);
    }

    expect(form).toContain('title: "Name"');
    expect(form).toContain(
      "The key stops working on this date. A year from today unless you pick another.",
    );
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(view).toContain('title: "API Key Details"');
    expect(view).toContain('title: "API Key",');
    expect(menu.indexOf('title: "Advanced"')).toBeLessThan(
      menu.indexOf('title: "API Keys"'),
    );
    expect(page).toContain(
      "The key expires a year from today. To pick another date, open **More fields** before you create it",
    );
    expect(page).toContain(
      "copy the **API Key** from the **API Key Details** card",
    );
  });

  it("reads the monitor statuses every project starts with, by the names they start with", () => {
    const project: string = readRepoFile(
      "packages/Common/Server/Services/ProjectService.ts",
    );

    for (const name of ["Operational", "Degraded", "Offline"]) {
      expect(project).toContain(`.name = "${name}";`);
    }

    expect(page).toContain(
      'data "oneuptime_monitor_status" "operational" {\n  name = "Operational"\n}',
    );
    expect(page).toContain(
      'data "oneuptime_monitor_status" "offline" {\n  name = "Offline"\n}',
    );
  });

  it("checks every five minutes, as a new monitor does in the Dashboard", () => {
    expect(DEFAULT_MONITORING_INTERVAL).toBe("*/5 * * * *");
    expect(page).toContain(
      `monitoring_interval = "${DEFAULT_MONITORING_INTERVAL}"`,
    );
    expect(page).toContain("checks `https://example.com` every five minutes");
  });

  it("counts the resources the plan adds, and names where each one shows", () => {
    const resources: number = parsedBlocks(QUICK_START).reduce(
      (count: number, { body }: { body: HclBody }): number => {
        return (
          count +
          body.blocks.filter((block: HclBlock): boolean => {
            return block.type === "resource";
          }).length
        );
      },
      0,
    );

    expect(page).toContain(
      `The plan ends with \`Plan: ${resources} to add, 0 to change, 0 to destroy.\``,
    );
    expect(resources).toBe(4);
  });

  it("quotes the errors a first run can stop on as the provider and the API word them", () => {
    const providerSource: string = readRepoFile(PROVIDER_GENERATOR);
    const headings: Array<string> = page
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith(DETAILS_OPENING);
      })
      .map((line: string): string => {
        return line.slice(DETAILS_OPENING.length);
      });

    expect(providerSource).toContain('"Missing API Key",');
    expect(providerSource).toContain(
      "the OneUptime API returned status %d: %s",
    );
    expect(
      readRepoFile("packages/Common/Server/Middleware/ProjectAuthorization.ts"),
    ).toContain('throw new BadDataException("Invalid API Key");');
    expect(
      readRepoFile("packages/Common/Types/Billing/PlanCutoffCredentials.ts"),
    ).toContain("return `API keys need the ${planName} plan.");
    expect(
      readRepoFile(
        "packages/Common/Server/Types/Database/Permissions/TablePermission.ts",
      ),
    ).toContain("`You do not have permissions to ${type} ${");
    expect(new Monitor().singularName).toBe("Monitor");
    expect(readRepoFile(DATA_SOURCE_GENERATOR)).toContain(
      '"Not Found", fmt.Sprintf("No ${label} matches %s.", describeLookup(filterNames))',
    );

    expect(headings).toEqual([
      "Missing API Key",
      "The OneUptime API returned status 400: Invalid API Key",
      "The OneUptime API returned status 402: API keys need the Growth plan",
      "The OneUptime API returned status 422: You do not have permissions to create Monitor",
      'No monitor status matches {name = "Offline"}',
    ]);
  });

  it("names the Dashboard's menu paths as its side menus are laid out", () => {
    const settings: string = readRepoFile(
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu.tsx",
    );
    const monitors: string = readRepoFile(
      "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu.tsx",
    );
    const paths: Array<string> = boldPaths(page).map(
      (segments: Array<string>): string => {
        return segments.join(" → ");
      },
    );

    expect(paths).toEqual([
      "Project Settings → Advanced → API Keys",
      "Project Settings → Basic → Labels",
      "Project Settings → Billing and Invoices → Billing",
      "Monitors → Settings → Monitor Status",
    ]);

    expect(menuSectionOf(settings, "API Keys")).toBe("Advanced");
    expect(menuSectionOf(settings, "Labels")).toBe("Basic");
    expect(menuSectionOf(settings, "Billing")).toBe("Billing and Invoices");
    expect(menuSectionOf(monitors, "Monitor Status")).toBe("Settings");
  });
});

describe("the complete guide", () => {
  const providerSource: string = readRepoFile(PROVIDER_GENERATOR);

  it("lists the provider's two settings, their environment variables and what happens without them", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(COMPLETE_GUIDE, "## Configure the provider"),
      "Setting",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["`api_key`", "`oneuptime_url`"]);
    expect(rowStartingWith(rows, "`api_key`")[1]).toBe("`ONEUPTIME_API_KEY`");
    expect(rowStartingWith(rows, "`oneuptime_url`")[1]).toBe("`ONEUPTIME_URL`");

    // The schema: both optional, the key sensitive.
    expect(providerSource).toContain(
      '"oneuptime_url": schema.StringAttribute{',
    );
    expect(providerSchemaAttribute(providerSource, "api_key")).toContain(
      "Optional:            true,\n                Sensitive:           true,",
    );
    expect(providerSchemaAttribute(providerSource, "oneuptime_url")).toContain(
      "Optional:            true,",
    );
    expect(
      providerSchemaAttribute(providerSource, "oneuptime_url"),
    ).not.toContain("Sensitive");
    // Each from its environment variable when the block leaves it out.
    expect(providerSource).toContain(
      'os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_URL")',
    );
    expect(providerSource).toContain(
      'os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_API_KEY")',
    );
    expect(providerSource).toContain('oneuptimeUrl = "oneuptime.com"');
    // A scheme and /api are added.
    expect(providerSource).toContain(
      'oneuptimeUrl = "https://" + oneuptimeUrl',
    );
    expect(providerSource).toContain(
      'strings.TrimSuffix(oneuptimeUrl, "/") + "/api"',
    );
    expect(section(COMPLETE_GUIDE, "## Configure the provider")).toContain(
      "the provider adds `https://` when the address has no scheme, and `/api` at the end",
    );
  });

  it("is right that a master key's create fails for want of a project", () => {
    expect(
      readRepoFile("packages/Common/Server/Services/MonitorService.ts"),
    ).toContain(
      'throw new BadDataException("ProjectId required to create monitor.");',
    );
    expect(section(COMPLETE_GUIDE, "## Configure the provider")).toContain(
      "fails with `ProjectId required`",
    );
  });

  it("gives a lookup the rules and the errors the data sources have", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(COMPLETE_GUIDE, "## Read what already exists"),
      "You set",
    );
    const generator: string = readRepoFile(DATA_SOURCE_GENERATOR);

    expect(
      rows.map((row: Array<string>): string => {
        return row[2] as string;
      }),
    ).toEqual([
      "`Not Found` when no record has it",
      "`Not Found` when none matches, `Ambiguous Match` when more than one does",
      "`Invalid Lookup`",
    ]);

    for (const summary of ["Not Found", "Ambiguous Match", "Invalid Lookup"]) {
      expect(generator).toContain(`"${summary}"`);
    }

    expect(generator).toContain(
      "// limit 2 is enough to detect ambiguity without paging.",
    );
    expect(generator).toContain("hasId && len(filters) > 0");
    expect(generator).toContain("!hasId && len(filters) == 0");

    // Plain values only: a secret, a time, a list or JSON is never an argument.
    const statusPage: ProviderType = dataSourceType("status_page");

    expect(statusPage.attributes.get("name")?.isLookupFilter).toBe(true);
    expect(
      statusPage.attributes.get("is_public_status_page")?.isLookupFilter,
    ).toBe(true);
    expect(statusPage.attributes.get("master_password")?.isLookupFilter).toBe(
      false,
    );
    expect(statusPage.attributes.get("created_at")?.isLookupFilter).toBe(false);
    expect(statusPage.attributes.get("labels")?.isLookupFilter).toBe(false);
    expect(statusPage.attributes.get("project_id")?.isLookupFilter).toBe(false);
    expect(
      dataSourceType("monitor_status").attributes.get("priority")
        ?.isLookupFilter,
    ).toBe(true);
  });

  it("keeps the CI examples to the key's environment variable", () => {
    const yaml: Array<CodeBlock> = pageBlocks(COMPLETE_GUIDE).filter(
      (block: CodeBlock): boolean => {
        return block.lang === "yaml";
      },
    );

    expect(yaml.length).toBe(2);
    expect(yaml[0]?.code).toContain(
      "ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}",
    );

    for (const block of yaml) {
      expect(block.code).toContain("terraform plan -input=false -out=tfplan");
      expect(block.code).toContain("terraform apply -input=false tfplan");
    }
  });

  it("is right that timestamps are compared as instants, and the server's defaults are no drift", () => {
    const rfc3339: string = readRepoFile(
      "Scripts/TerraformProvider/StaticFiles/rfc3339.go",
    );
    const jsonSubset: string = readRepoFile(
      "Scripts/TerraformProvider/StaticFiles/jsonsubset.go",
    );

    expect(rfc3339).toContain("StringSemanticEquals");
    expect(jsonSubset).toContain(
      "func jsonIsSubset(plan, actual interface{}) bool",
    );
    expect(readRepoFile(MONITOR_STEPS_GO)).toContain(
      "return jsonIsSubset(theirsPlain, minePlain), diags",
    );
  });
});

// The type a monitor steps table writes for an attribute monitorsteps.go declares.
const NESTED_KINDS: Readonly<Record<string, string>> = {
  String: "string",
  Bool: "bool",
  Int64: "number",
  Map: "map(string)",
  List: "list(string)",
  ListNested: "list",
};

// The first-column code spans of a table's rows: the attributes it lists.
function attributesListed(rows: Array<Array<string>>): Array<string> {
  return rows
    .map((row: Array<string>): string => {
      return codeIn(row[0] as string)[0] as string;
    })
    .sort();
}

// Every code span of a text that is one of a list's values.
function valuesNamed(
  text: string,
  values: ReadonlyArray<string>,
): Array<string> {
  return codeIn(text).filter((span: string): boolean => {
    return values.includes(span);
  });
}

/*
 * The monitor types each row of the check_on table speaks of, by the row's
 * first cell: every value the row lists is offered for each of them.
 */
const CHECK_ON_ROW_TYPES: Readonly<Record<string, ReadonlyArray<MonitorType>>> =
  {
    "Website / API": [MonitorType.Website, MonitorType.API],
    "Ping / IP": [MonitorType.Ping, MonitorType.IP],
    Port: [MonitorType.Port],
    "SSL Certificate": [MonitorType.SSLCertificate],
    "Incoming Request": [MonitorType.IncomingRequest],
    "Incoming Email": [MonitorType.IncomingEmail],
    Server: [MonitorType.Server],
    Logs: [MonitorType.Logs],
    Traces: [MonitorType.Traces],
    Exceptions: [MonitorType.Exceptions],
    Profiles: [MonitorType.Profiles],
    "AI / LLM": [MonitorType.Llm],
    Metrics: [MonitorType.Metrics],
    "Custom Code / Synthetic": [
      MonitorType.CustomJavaScriptCode,
      MonitorType.SyntheticMonitor,
    ],
    DNS: [MonitorType.DNS],
    Domain: [MonitorType.Domain],
    DNSSEC: [MonitorType.DNSSEC],
    "SQL Query": [MonitorType.SQLQuery],
    "Database Health": [MonitorType.Database],
    "External Status Page": [MonitorType.ExternalStatusPage],
    NTP: [MonitorType.NTP],
    "Network Device (SNMP)": [MonitorType.NetworkDevice],
  };

describe("the monitor steps page", () => {
  const schema: MonitorStepsSchema = readMonitorStepsSchema();

  it("lists every attribute of a step but the per-type JSON ones, with its type, and says which are sensitive and required", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(MONITOR_STEPS, "## Step attributes"),
      "Attribute",
    );
    const subConfigNames: Array<string> = schema.subConfigs.map(
      ([name]: [string, string]): string => {
        return name;
      },
    );
    const plain: Array<NestedAttribute> = Array.from(
      schema.step.values(),
    ).filter((attribute: NestedAttribute): boolean => {
      return !subConfigNames.includes(attribute.name);
    });

    expect(attributesListed(rows)).toEqual(
      plain
        .map((attribute: NestedAttribute): string => {
          return attribute.name;
        })
        .sort(),
    );

    for (const attribute of plain) {
      const written: string = rowStartingWith(
        rows,
        `\`${attribute.name}\``,
      )[1] as string;
      let expected: string = NESTED_KINDS[attribute.kind] as string;

      if (attribute.sensitive) {
        expected += " (sensitive)";
      }

      if (attribute.required) {
        expected += " (required)";
      }

      expect({ attribute: attribute.name, type: written }).toEqual({
        attribute: attribute.name,
        type: expected,
      });
    }
  });

  it("names every per-type JSON attribute of a step, as the provider and the Dashboard's export have them", () => {
    const text: string = section(
      MONITOR_STEPS,
      "### Settings of each monitor type",
    );
    const subConfigNames: Array<string> = schema.subConfigs.map(
      ([name]: [string, string]): string => {
        return name;
      },
    );

    expect(valuesNamed(text, subConfigNames).sort()).toEqual(
      [...subConfigNames].sort(),
    );
    expect(schema.subConfigs).toEqual(
      MONITOR_STEP_SUB_CONFIGS.map(
        (config: {
          attributeName: string;
          apiKey: string;
        }): [string, string] => {
          return [config.attributeName, config.apiKey];
        },
      ),
    );
  });

  it("writes an ID inside a step's JSON as the API writes one", () => {
    expect(
      section(MONITOR_STEPS, "### Settings of each monitor type"),
    ).toContain(
      'telemetryServiceIds = [{ _type = "ObjectID", value = oneuptime_service.checkout.id }]',
    );
    expect(readRepoFile("packages/Common/Types/ObjectID.ts")).toContain(
      "_type: ObjectType.ObjectID,",
    );
  });

  it("lists every attribute of a criteria, and which are required", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(MONITOR_STEPS, "## Criteria attributes"),
      "Attribute",
    );

    expect(attributesListed(rows)).toEqual(
      Array.from(schema.criteria.keys()).sort(),
    );

    for (const attribute of Array.from(schema.criteria.values())) {
      const type: string = rowStartingWith(
        rows,
        `\`${attribute.name}\``,
      )[1] as string;

      expect({
        attribute: attribute.name,
        required: type.endsWith("(required)"),
      }).toEqual({
        attribute: attribute.name,
        required: attribute.required,
      });
    }
  });

  it("names every attribute of an incident and an alert template, and the required ones", () => {
    const text: string = section(MONITOR_STEPS, "### Incidents and alerts");
    const incidentSentence: string = lineStartingWith(
      text,
      "An item of `incidents` takes",
    );
    const incident: Array<string> = codeIn(
      incidentSentence.split(". An item of `alerts`")[0] as string,
    ).filter((span: string): boolean => {
      return span !== "incidents";
    });
    const alertsSentence: string = incidentSentence.split(
      ". An item of `alerts`",
    )[1] as string;
    const [added, removed] = alertsSentence.split(", and without ");
    const alert: Array<string> = [
      ...incident.filter((name: string): boolean => {
        return !["incident_severity_id", "auto_resolve_incident"].includes(
          name,
        );
      }),
      ...codeIn(added as string),
    ].filter((name: string): boolean => {
      return !codeIn(removed as string).includes(name);
    });

    expect([...incident].sort()).toEqual(
      Array.from(schema.incident.keys()).sort(),
    );
    expect(alert.sort()).toEqual(Array.from(schema.alert.keys()).sort());
    expect(incidentSentence).toContain(
      "takes `title` and `description` (both required)",
    );

    for (const templates of [schema.incident, schema.alert]) {
      expect(
        Array.from(templates.values())
          .filter((attribute: NestedAttribute): boolean => {
            return attribute.required;
          })
          .map((attribute: NestedAttribute): string => {
            return attribute.name;
          })
          .sort(),
      ).toEqual(["description", "title"]);
    }
  });

  it("names every attribute of a filter", () => {
    const page: string = englishPage(MONITOR_STEPS);

    const spans: Array<string> = codeIn(page);

    for (const name of Array.from(schema.filter.keys())) {
      expect({
        name,
        named: spans.some((span: string): boolean => {
          return span === name || span.startsWith(`${name} = `);
        }),
      }).toEqual({ name, named: true });
    }

    for (const option of FILTER_JSON_OPTIONS) {
      expect(schema.filter.has(option.attributeName)).toBe(true);
    }
  });

  it("lists the fixed values of a filter's window and no-data policy, and of a step's request and destination", () => {
    const text: string = englishPage(MONITOR_STEPS);
    const lists: Array<[string, string, string]> = [
      [
        "monitorStepsEvaluateOverTimeTypeValues",
        "## Filter reference",
        "`evaluate_over_time_type`",
      ],
      [
        "monitorStepsNoDataPolicyValues",
        "## Filter reference",
        "`evaluate_over_time_no_data_policy`",
      ],
      [
        "monitorStepsRequestTypeValues",
        "## Step attributes",
        "| `request_type` |",
      ],
      [
        "monitorStepsDestinationTypeValues",
        "## Step attributes",
        "| `monitor_destination_type` |",
      ],
      [
        "monitorStepsScreenSizeTypeValues",
        "## Step attributes",
        "| `screen_size_types` |",
      ],
      [
        "monitorStepsBrowserTypeValues",
        "## Step attributes",
        "| `browser_types` |",
      ],
      [
        "monitorStepsFilterConditionValues",
        "## Criteria attributes",
        "| `filter_condition` |",
      ],
    ];

    for (const [listName, heading, start] of lists) {
      const line: string = lineStartingWith(
        section(MONITOR_STEPS, heading)
          .split("\n")
          .map((candidate: string): string => {
            // A paragraph names its attribute first: start the line there.
            const at: number = candidate.indexOf(start);
            return at > 0 && !candidate.startsWith("|")
              ? candidate.slice(at)
              : candidate;
          })
          .join("\n"),
        start,
      );
      const values: Array<string> = monitorStepsValues(listName);

      expect({
        listName,
        named: Array.from(new Set(valuesNamed(line, values))).sort(),
      }).toEqual({
        listName,
        named: [...values].sort(),
      });
    }

    expect(
      monitorStepsValues("monitorStepsEvaluateOverTimeTypeValues"),
    ).toEqual(Object.values(EvaluateOverTimeType));
    expect(text).toContain("`Ignore` (the default) does not match");
  });

  it("lists check_on values each monitor type's criteria editor offers", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(MONITOR_STEPS, "### What a filter can check"),
      "Monitor type",
    );
    const checkOnValues: Array<string> = monitorStepsValues(
      "monitorStepsCheckOnValues",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(Object.keys(CHECK_ON_ROW_TYPES));

    for (const row of rows) {
      const listed: Array<string> = valuesNamed(
        row[1] as string,
        checkOnValues,
      );

      expect(listed.length).toBeGreaterThan(0);

      for (const monitorType of CHECK_ON_ROW_TYPES[row[0] as string] || []) {
        const offered: Array<string> = optionValues(
          CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType),
        );

        for (const checkOn of listed) {
          expect({
            monitorType,
            checkOn,
            offered: offered.includes(checkOn),
          }).toEqual({
            monitorType,
            checkOn,
            offered: true,
          });
        }
      }
    }

    // Every check_on the provider accepts is the API's: CheckOn's values.
    expect([...checkOnValues].sort()).toEqual(
      Array.from(new Set(Object.values(CheckOn) as Array<string>)).sort(),
    );
  });

  it("lists every filter_type once", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(MONITOR_STEPS, "### How a filter compares"),
      "Kind",
    );
    const filterTypes: Array<string> = monitorStepsValues(
      "monitorStepsFilterTypeValues",
    );
    const listed: Array<string> = rows.flatMap((row: Array<string>) => {
      return valuesNamed(row[1] as string, filterTypes);
    });

    expect([...listed].sort()).toEqual([...filterTypes].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect([...filterTypes].sort()).toEqual(
      (Object.values(FilterType) as Array<string>).sort(),
    );
  });

  it("gives the probe's caps on a step's timeout and retries, and NTP's port", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      section(MONITOR_STEPS, "## Step attributes"),
      "Attribute",
    );

    expect(rowStartingWith(rows, "`request_timeout_in_ms`")[3]).toContain(
      `The probe lowers anything above ${MAX_MONITOR_REQUEST_TIMEOUT_IN_MS} to ${MAX_MONITOR_REQUEST_TIMEOUT_IN_MS}.`,
    );
    expect(rowStartingWith(rows, "`retry_count`")[3]).toContain(
      `The probe lowers anything above ${MAX_MONITOR_RETRY_COUNT} to ${MAX_MONITOR_RETRY_COUNT}.`,
    );
    expect(rowStartingWith(rows, "`port`")[3]).toContain(
      `\`${DEFAULT_NTP_PORT}\` when not set`,
    );
  });

  it("is right that nothing checks a monitor without steps, and nothing fills them in", () => {
    const probe: string = readRepoFile(
      "packages/Probe/Utils/Monitors/Monitor.ts",
    );
    const monitorService: string = readRepoFile(
      "packages/Common/Server/Services/MonitorService.ts",
    );
    const attribute: string = goFunction(
      readRepoFile(MONITOR_STEPS_GO),
      "func MonitorStepsSchemaAttribute(",
    );

    expect(probe).toContain(
      'logger.debug("No monitor steps found");\n      return;',
    );
    expect(monitorService).not.toContain("getDefaultMonitorSteps");
    expect(monitorService).toContain("if (createBy.data.monitorSteps) {");
    expect(attribute).toContain("Optional:            true,");
    expect(attribute).toContain("listplanmodifier.UseStateForUnknown()");
    expect(section(MONITOR_STEPS, "## A monitor without steps")).toContain(
      "probes skip a monitor without steps, and it stays in the status it started in",
    );
  });

  it("is right about the default status: the project's operational one, the one a new monitor gets", () => {
    const monitorService: string = readRepoFile(
      "packages/Common/Server/Services/MonitorService.ts",
    );

    expect(monitorService).toContain("isOperationalState: true,");
    expect(monitorService).toContain(
      "defaultMonitorStatusId: monitorStatus.id,",
    );
  });

  it("checks what the end-to-end test's website monitor checks", () => {
    const fixture: HclBody = parseHcl(
      readRepoFile(`${E2E_FIXTURES}/35-monitor-with-steps/main.tf`),
    );
    const filtersOf: (body: HclBody, name: string) => Array<string> = (
      body: HclBody,
      name: string,
    ): Array<string> => {
      const monitor: HclBlock | undefined = body.blocks.find(
        (block: HclBlock): boolean => {
          return (
            block.labels[0] === "oneuptime_monitor" && block.labels[1] === name
          );
        },
      );
      const triples: Array<string> = [];
      const walk: (value: HclValue) => void = (value: HclValue): void => {
        if (value.kind === "tuple") {
          value.items.forEach(walk);
        }

        if (value.kind === "object") {
          const checkOn: string | null = stringLiteral(
            attributeNamed(value.attributes, "check_on")?.value,
          );

          if (checkOn) {
            triples.push(
              [
                checkOn,
                stringLiteral(
                  attributeNamed(value.attributes, "filter_type")?.value,
                ),
                stringLiteral(attributeNamed(value.attributes, "value")?.value),
              ].join(" | "),
            );
          }

          value.attributes.forEach((attribute: HclAttribute): void => {
            walk(attribute.value);
          });
        }
      };

      walk(
        attributeNamed(monitor?.body.attributes || [], "monitor_steps")
          ?.value || {
          kind: "null",
          line: 0,
        },
      );

      return triples.sort();
    };
    const pageExample: HclBody = parseHcl(
      (
        hclBlocksOf(MONITOR_STEPS).find((block: CodeBlock): boolean => {
          return block.code.includes('resource "oneuptime_monitor" "website"');
        }) as CodeBlock
      ).code,
    );

    expect(filtersOf(pageExample, "website")).toEqual(
      filtersOf(fixture, "website"),
    );
    expect(filtersOf(fixture, "website").length).toBeGreaterThan(1);
  });
});

describe("the examples page", () => {
  const page: string = englishPage(EXAMPLES);

  it("names end-to-end tests that exist, and that apply the resources of their section", () => {
    const sections: Array<string> = page.split("\n### ");
    let named: number = 0;

    for (const text of sections) {
      const types: Set<string> = new Set(
        parseHcl(
          codeBlocks(text)
            .filter((block: CodeBlock): boolean => {
              return block.lang === "hcl";
            })
            .map((block: CodeBlock): string => {
              return block.code;
            })
            .join("\n\n"),
        )
          .blocks.filter((block: HclBlock): boolean => {
            return block.type === "resource";
          })
          .map((block: HclBlock): string => {
            return block.labels[0] as string;
          }),
      );

      for (const match of Array.from(text.matchAll(E2E_TEST_NAME))) {
        const name: string = match[1] as string;
        const fixture: string = path.join(
          REPO_ROOT,
          E2E_FIXTURES,
          name,
          "main.tf",
        );

        named++;
        expect({ name, exists: fs.existsSync(fixture) }).toEqual({
          name,
          exists: true,
        });

        const applied: Set<string> = new Set(
          parseHcl(fs.readFileSync(fixture, "utf8"))
            .blocks.filter((block: HclBlock): boolean => {
              return block.type === "resource";
            })
            .map((block: HclBlock): string => {
              return block.labels[0] as string;
            }),
        );

        expect({
          name,
          shared: Array.from(types).some((type: string): boolean => {
            return applied.has(type);
          }),
        }).toEqual({ name, shared: true });
      }
    }

    expect(named).toBeGreaterThanOrEqual(8);
  });

  it("judges a certificate as a new SSL certificate monitor does in the Dashboard", () => {
    const id: ObjectID = ObjectID.generate();
    const filtersOf: (
      criteria: MonitorCriteriaInstance | null,
    ) => Array<string> = (
      criteria: MonitorCriteriaInstance | null,
    ): Array<string> => {
      return (criteria?.data?.filters || []).map(
        (filter: {
          checkOn: CheckOn;
          filterType?: FilterType | undefined;
          value?: unknown;
        }): string => {
          return `${filter.checkOn} | ${filter.filterType} | ${filter.value ?? ""}`;
        },
      );
    };
    const dashboard: Array<Array<string>> = [
      filtersOf(
        MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
          monitorType: MonitorType.SSLCertificate,
          monitorStatusId: id,
          incidentSeverityId: id,
          alertSeverityId: id,
          monitorName: "x",
        }),
      ),
      filtersOf(
        MonitorCriteriaInstance.getDefaultWarningMonitorCriteriaInstance({
          monitorType: MonitorType.SSLCertificate,
          alertSeverityId: id,
          monitorName: "x",
        }),
      ),
      filtersOf(
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.SSLCertificate,
          monitorStatusId: id,
          monitorName: "x",
        }),
      ),
    ];
    const certificate: HclBlock = parsedBlocks(EXAMPLES)
      .flatMap(({ body }: { body: HclBody }) => {
        return body.blocks;
      })
      .find((block: HclBlock): boolean => {
        return block.labels[1] === "certificate";
      }) as HclBlock;
    const step: HclValue = (
      attributeNamed(certificate.body.attributes, "monitor_steps")?.value as {
        items: Array<HclValue>;
      }
    ).items[0] as HclValue;
    const criteria: Array<HclValue> = (
      attributeNamed(
        (step as { attributes: Array<HclAttribute> }).attributes,
        "criteria",
      )?.value as { items: Array<HclValue> }
    ).items;
    const written: Array<Array<string>> = criteria.map((item: HclValue) => {
      const filters: Array<HclValue> = (
        attributeNamed(
          (item as { attributes: Array<HclAttribute> }).attributes,
          "filters",
        )?.value as { items: Array<HclValue> }
      ).items;

      return filters.map((filter: HclValue): string => {
        const attributes: Array<HclAttribute> = (
          filter as { attributes: Array<HclAttribute> }
        ).attributes;

        return [
          stringLiteral(attributeNamed(attributes, "check_on")?.value),
          stringLiteral(attributeNamed(attributes, "filter_type")?.value),
          stringLiteral(attributeNamed(attributes, "value")?.value) || "",
        ].join(" | ");
      });
    });

    expect(written).toEqual(dashboard);
    expect(page).toContain(
      `degraded when it expires in ${MonitorCriteriaInstance.DEFAULT_SSL_CERTIFICATE_EXPIRY_WARNING_DAYS} days or less, as a new SSL certificate monitor is in the dashboard`,
    );
  });

  it("is right about who joins a team at once, and who is invited", () => {
    const service: string = readRepoFile(
      "packages/Common/Server/Services/TeamMemberService.ts",
    );

    expect(service).toContain("createBy.data.hasAcceptedInvitation = false;");
    expect(service).toContain("await this.isUserMemberOfProject({");
    expect(page).toContain(
      "A person who is already in the project joins the team at once. Anyone else is invited, and is in the team once they accept.",
    );
  });

  it("keeps a drill off the status pages, which an incident is on unless told otherwise", () => {
    const incident: ProviderType = resourceType("incident");

    expect(incident.attributes.get("is_visible_on_status_page")).toEqual(
      expect.objectContaining({ settable: true }),
    );
    expect(
      incident.attributes.get(
        "should_status_page_subscribers_be_notified_on_incident_created",
      ),
    ).toEqual(expect.objectContaining({ settable: true }));
    expect(
      readRepoFile("packages/Common/Models/DatabaseModels/Incident.ts"),
    ).toContain("public isVisibleOnStatusPage?: boolean = undefined;");
  });

  it("names the environment variables a probe signs in with, and the keys agents use", () => {
    const probeConfig: string = readRepoFile("packages/Probe/Config.ts");

    expect(probeConfig).toContain('process.env["PROBE_ID"]');
    expect(probeConfig).toContain('process.env["PROBE_KEY"]');
    expect(page).toContain(
      "Run the probe with `PROBE_ID` set to the probe's `id` and `PROBE_KEY` to the key",
    );

    for (const key of [
      "incoming_request_secret_key",
      "server_monitor_secret_key",
    ]) {
      expect(resourceType("monitor").attributes.get(key)).toEqual(
        expect.objectContaining({ settable: false }),
      );
      expect(page).toContain(key);
    }

    expect(readPage("en", "monitor/incoming-request-monitor")).toContain(
      "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY",
    );
    expect(page).toContain("`https://oneuptime.com/heartbeat/YOUR_SECRET_KEY`");
  });
});
