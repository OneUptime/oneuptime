import { describe, expect, test } from "@jest/globals";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import PublicDashboardMetricServices from "../../../Server/Utils/Dashboard/PublicDashboardMetricServices";
import PublicDashboardResourceListPolicy from "../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import PublicDashboardSloHistoryPolicy from "../../../Server/Utils/Dashboard/PublicDashboardSloHistoryPolicy";
import PublicDashboardSloWidget from "../../../Server/Utils/Dashboard/PublicDashboardSloWidget";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardComponentType, {
  isDashboardComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import { getDashboardWidgetSortColumns } from "../../../Utils/Dashboard/DashboardWidgetSorts";
import { widgetSettingsOf } from "../../Helpers/DashboardWidgetSettingsDeclared";
import { drawnFromWhole } from "../../Helpers/PublicDashboardServedWhole";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Issue #6338: what the page draws is what the public routes allow. Every
 * public route that serves what a public dashboard's page draws reads the
 * config the page draws (PublicDashboardViewConfig.getDrawnConfig), and
 * that is built from what /view-config serves - which is now each widget's
 * settings its type is served, and each variable's fields its type is
 * served, not everything stored.
 *
 * So every answer those routes give is held here to the answer they gave
 * when every setting was served, worked out from the same stored config:
 *
 * - the metric routes' allowlists (/metrics-aggregate, /metric-types):
 *   the metric names, the keys a query may group and filter by, the
 *   columns it may group by and the services each metric is read for;
 * - /attribute-values: the attribute keys of the dashboard's variables;
 * - /resource-list's policy for every list widget, with the visitor's
 *   variable picks and sort;
 * - the SLO routes (/resource-list/slo, /slo-history-aggregate): the SLO a
 *   widget shows, and the history it charts;
 * - /overview's widget summaries and the metrics it lists.
 *
 * For every widget the page draws, with every setting its type has, each
 * answer is unchanged. A setting no widget type has - which no board reads
 * - widens none of them; where it did before (a metric named in it, a key
 * a chart never groups by), the routes now refuse what the page never asks
 * for.
 */

// The routes' allowlist builders, as the routes call them.
interface PublicRouteAllowlists {
  collectDashboardMetricNames(metricWidgetSettings: unknown): Set<string>;
  collectDashboardGroupByAttributeKeys(
    metricWidgetSettings: unknown,
  ): Set<string>;
  collectDashboardFilterAttributeKeys(metricSources: {
    metricWidgetSettings: Array<JSONObject>;
    variables: Array<DashboardVariable>;
  }): Set<string>;
  collectDashboardGroupByColumns(metricWidgetSettings: unknown): Set<string>;
  collectDashboardVariableAttributeKeys(
    variables: Array<DashboardVariable> | undefined,
  ): Set<string>;
  buildPublicComponentSummaries(
    drawnViewConfig: DashboardViewConfig,
  ): Array<JSONObject>;
}

const ROUTES: PublicRouteAllowlists =
  DashboardAPI as unknown as PublicRouteAllowlists;

// The config every public route read before issue #6338, and reads now.
const drawnBefore: (stored: unknown) => DashboardViewConfig = drawnFromWhole;

function drawnNow(stored: unknown): DashboardViewConfig {
  return PublicDashboardViewConfig.getDrawnConfig(stored);
}

type Outcome = unknown;

// A policy's answer: what it builds, or the words it refuses with.
function outcomeOf(build: () => unknown): Outcome {
  try {
    return { built: JSONFunctions.serializeValue(build() as JSONObject) };
  } catch (error) {
    return { refused: (error as Error).message };
  }
}

function sorted(values: Set<string>): Array<string> {
  return [...values].sort();
}

interface RouteAnswers {
  // The widgets the routes look a request's widget up among.
  widgets: Array<unknown>;
  metricNames: Array<string>;
  groupByAttributeKeys: Array<string>;
  filterAttributeKeys: Array<string>;
  groupByColumns: Array<string>;
  savedServices: Array<unknown>;
  variableAttributeKeys: Array<string>;
  summaries: Array<JSONObject>;
  resourceLists: Array<Outcome>;
  sloWidgets: Array<Outcome>;
  sloHistories: Array<Outcome>;
}

interface Requests {
  // The visitor's variable picks, as the page sends them.
  variables: unknown;
  // A header click per widget, by its place in the drawn list.
  sorts: Array<unknown>;
}

/*
 * Every answer a public route gives that depends on the drawn config, for
 * these requests: each list widget's list, each SLO widget's SLO and
 * history, every allowlist and the overview.
 */
function answersOf(
  drawn: DashboardViewConfig,
  requests: Requests,
): RouteAnswers {
  const metricWidgetSettings: Array<JSONObject> =
    PublicDashboardViewConfig.getMetricWidgetSettings(drawn);
  const variables: Array<DashboardVariable> = drawn.variables || [];

  const resolvedVariables: () => Array<DashboardVariable> =
    (): Array<DashboardVariable> => {
      return PublicDashboardResourceListPolicy.resolveDashboardVariableSelections(
        {
          variables: variables,
          requestedVariables: requests.variables,
        },
      );
    };

  return {
    widgets: drawn.components.map((component: DashboardBaseComponent) => {
      return [
        component.componentId.toString(),
        component.componentType,
        component.topInDashboardUnits,
        component.leftInDashboardUnits,
        component.widthInDashboardUnits,
        component.heightInDashboardUnits,
      ];
    }),
    metricNames: sorted(
      ROUTES.collectDashboardMetricNames(metricWidgetSettings),
    ),
    groupByAttributeKeys: sorted(
      ROUTES.collectDashboardGroupByAttributeKeys(metricWidgetSettings),
    ),
    filterAttributeKeys: sorted(
      ROUTES.collectDashboardFilterAttributeKeys({
        metricWidgetSettings: metricWidgetSettings,
        variables: variables,
      }),
    ),
    groupByColumns: sorted(
      ROUTES.collectDashboardGroupByColumns(metricWidgetSettings),
    ),
    savedServices: [
      ...PublicDashboardMetricServices.getSavedServices(
        metricWidgetSettings,
      ).entries(),
    ].sort(),
    variableAttributeKeys: sorted(
      ROUTES.collectDashboardVariableAttributeKeys(drawn.variables),
    ),
    summaries: ROUTES.buildPublicComponentSummaries(drawn),
    resourceLists: drawn.components.map(
      (component: DashboardBaseComponent, index: number): Outcome => {
        return outcomeOf(() => {
          return PublicDashboardResourceListPolicy.build({
            widget: component as unknown as JSONObject,
            variables: drawn.variables,
            requestedVariables: requests.variables,
            requestedQuery: undefined,
            requestedSort: requests.sorts[index],
          });
        });
      },
    ),
    sloWidgets: drawn.components.map(
      (component: DashboardBaseComponent): Outcome => {
        return outcomeOf(() => {
          return PublicDashboardSloWidget.readConfig(
            component,
            resolvedVariables(),
          );
        });
      },
    ),
    sloHistories: drawn.components.map(
      (component: DashboardBaseComponent): Outcome => {
        return outcomeOf(() => {
          return PublicDashboardSloHistoryPolicy.build({
            widget: component,
            requestedAggregateBy: {
              startTimestamp: "2026-11-01T00:00:00.000Z",
              endTimestamp: "2026-11-02T00:00:00.000Z",
            },
            variables: resolvedVariables(),
          });
        });
      },
    ),
  };
}

const SERVICE_IDS: Array<string> = [
  "0f8fad5b-d9cb-469f-a165-70867728950e",
  "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "16fd2706-8baf-433b-82eb-8c7fada847da",
];

const IDS: Array<string> = [
  "a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1",
  "b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2",
  "c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3",
];

const LABEL_IDS: Array<string> = [
  "d4d4d4d4-4444-4444-8444-d4d4d4d4d4d4",
  "e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5",
];

// The values a filter takes, across every list widget, and some no list takes.
const FILTER_VALUES: Array<unknown> = [
  "unresolved",
  "resolved",
  "acknowledged",
  "operational",
  "non-operational",
  "down",
  "linux",
  "windows",
  "ready",
  "not-ready",
  "online",
  "offline",
  "qemu",
  "lxc",
  "running",
  "stopped",
  "on",
  "off",
  "exclude",
  "only",
  "up",
  "out",
  "manager",
  "worker",
  "notready",
  "replicated",
  "global",
  "converged",
  "notconverged",
  "connected",
  "disconnected",
  "0",
  "1",
  "2",
  "Error",
  "Warning",
  "Tile",
  "Chart",
  "Sli",
  "BurnRate",
  "ErrorBudgetRemaining",
  "",
  "bogus",
  7,
  null,
];

/*
 * The values each list's filter takes (PublicDashboardResourceListPolicy),
 * by widget type and setting: drawn most of the time, so a list is read
 * rather than refused, and its other settings shape what it reads.
 */
const VALID_FILTER_VALUES: Record<string, Array<string>> = {
  "IncidentList.stateFilter": ["unresolved", "resolved", "acknowledged"],
  "AlertList.stateFilter": ["unresolved", "resolved", "acknowledged"],
  "MonitorList.statusFilter": ["operational", "non-operational"],
  "NetworkMap.statusFilter": ["down", "operational"],
  "HostList.statusFilter": ["connected", "disconnected"],
  "HostList.osTypeFilter": ["linux", "darwin", "windows"],
  "DockerHostList.statusFilter": ["connected", "disconnected"],
  "PodmanHostList.statusFilter": ["connected", "disconnected"],
  "KubernetesNodeList.readinessFilter": ["ready", "not-ready"],
  "ProxmoxNodeList.statusFilter": ["online", "offline"],
  "ProxmoxGuestList.guestTypeFilter": ["qemu", "lxc"],
  "ProxmoxGuestList.statusFilter": ["running", "stopped"],
  "VMwareVirtualMachineList.powerStateFilter": ["on", "off"],
  "VMwareVirtualMachineList.templateFilter": ["exclude", "only"],
  "CephOsdList.stateFilter": ["up", "down", "out"],
  "StorageArrayHardwareList.kindFilter": ["Hardware", "Drive", "Controller"],
  "StorageArrayHardwareList.statusFilter": ["unhealthy"],
  "DockerSwarmNodeList.roleFilter": ["manager", "worker"],
  "DockerSwarmNodeList.statusFilter": ["ready", "notready"],
  "DockerSwarmServiceList.serviceModeFilter": ["replicated", "global"],
  "DockerSwarmServiceList.statusFilter": ["converged", "notconverged"],
  "TraceList.statusFilter": ["0", "1", "2"],
  "LogStream.severityFilter": ["Error", "Warning", "Information"],
};

interface Generation {
  random: SeededRandom;
  name: string;
  variableIds: Array<string>;
}

function pick<T>(random: SeededRandom, values: ReadonlyArray<T>): T {
  return values[random(values.length)]!;
}

function someOf<T>(random: SeededRandom, values: ReadonlyArray<T>): Array<T> {
  return values.filter((): boolean => {
    return random(2) === 0;
  });
}

// An id as the editor, the API or a script stores it.
function storedId(random: SeededRandom, id: string): JSONValue {
  return random(3) === 0 ? { _type: "ObjectID", value: id } : id;
}

// A saved metric query, as a chart, a value, a gauge or a table keeps it.
function metricQuery(generation: Generation, index: number): JSONObject {
  const random: SeededRandom = generation.random;
  const name: string = generation.name;

  return {
    metricAliasData: {
      metricVariable: "a",
      title: `Latency ${name}`,
      legend: "p99",
    },
    metricQueryData: {
      filterData: {
        metricName: `metric.${name}.${index}.${random(3)}`,
        aggegationType: pick(random, ["Avg", "Sum", "Max"]),
        ...(random(2) === 0
          ? { attributes: { [`filter.${name}.${random(4)}`]: "prod" } }
          : {}),
        ...(random(2) === 0
          ? {
              telemetryServiceIds: someOf(random, SERVICE_IDS).map(
                (id: string): JSONValue => {
                  return storedId(random, id);
                },
              ),
            }
          : {}),
      },
      ...(random(2) === 0
        ? { groupByAttributeKeys: [`group.${name}.${random(4)}`] }
        : {}),
      ...(random(3) === 0 ? { groupBy: { attributes: random(2) === 0 } } : {}),
    },
    ...(random(4) === 0
      ? {
          fallback: {
            queryConfig: {
              metricQueryData: {
                filterData: { metricName: `fallback.${name}.${random(3)}` },
              },
            },
          },
        }
      : {}),
  };
}

// A value for one setting of a widget type, as its editor or the API stores it.
function settingValue(
  generation: Generation,
  componentType: string,
  setting: string,
  index: number,
): unknown {
  const random: SeededRandom = generation.random;

  switch (setting) {
    case "metricQueryConfig":
      return metricQuery(generation, index);
    case "metricQueryConfigs":
      return [
        metricQuery(generation, index),
        metricQuery(generation, index + 1),
      ];
    case "metricFormulaConfigs":
      return [{ metricFormulaData: { metricFormula: "a / 2" } }];
    case "columns":
      return [
        {
          id: "c1",
          variable: "a",
          header: "Latency",
          kind: "Metric",
          metricName: `column.${generation.name}.${random(3)}`,
          aggregation: "Avg",
        },
        {
          id: "c2",
          variable: "b",
          header: "Half",
          kind: "Formula",
          formula: "a / 2",
        },
      ];
    case "groupByAttributes":
      return [{ key: `table.group.${random(3)}`, header: "Host" }];
    case "groupByAttributeKeys":
      return [`table.keys.${random(3)}`];
    case "attributeFilters":
      return componentType === DashboardComponentType.Table
        ? { [`table.filter.${random(3)}`]: "production" }
        : { "url.host": "internal.example.com" };
    case "labelVariableId":
    case "serviceLevelObjectiveVariableId":
      return random(4) === 0
        ? "a variable this dashboard does not have"
        : storedId(
            random,
            pick(random, generation.variableIds.concat(["none"])),
          );
    case "serviceLevelObjectiveId":
      return random(4) === 0 ? 42 : storedId(random, pick(random, IDS));
    case "sloMetric":
      return random(5) === 0
        ? "bogus"
        : pick(random, ["Sli", "ErrorBudgetRemaining", "BurnRate"]);
    case "displayType":
      return random(5) === 0 ? "bogus" : pick(random, ["Tile", "Chart"]);
    case "maxRows":
    case "maxSites":
    case "limit":
    case "topLimit":
    case "maxEvents":
      return pick(random, [5, 25, "10", 0, -3, 5000, "many"]);
    case "namespaces":
      return pick(random, ["payments, checkout", "default", "", " , "]);
    case "podPhases":
    case "monitorTypes":
    case "sloStatuses":
    case "severityFilters":
    case "classNameFilters":
      return someOf(random, [
        "Running",
        "Pending",
        "API",
        "Ping",
        "Met",
        "Error",
      ]);
    case "imageName":
    case "nameSearch":
    case "bodyContains":
    case "attributeFilterQuery":
    case "spanNameContains":
    case "messageContains":
      return pick(random, ["nginx", "payments", "level=error", ""]);
    case "sort": {
      const columns: Array<{ key: string }> =
        getDashboardWidgetSortColumns(componentType);

      return random(4) === 0 || columns.length === 0
        ? pick(random, ["bogus:desc", "status", "", 7])
        : `${pick(random, columns).key}:${pick(random, ["asc", "desc"])}`;
    }
    case "viewMode":
      return pick(random, ["list", "honeycomb", "map", "bogus"]);
    default:
      break;
  }

  if (setting.endsWith("Ids")) {
    return someOf(
      random,
      (setting === "labelIds" ? LABEL_IDS : IDS).map(
        (id: string): JSONValue => {
          return storedId(random, id);
        },
      ),
    );
  }

  if (setting.endsWith("Filter")) {
    const valid: Array<string> | undefined =
      VALID_FILTER_VALUES[`${componentType}.${setting}`];

    return valid && random(4) !== 0
      ? pick(random, valid)
      : pick(random, FILTER_VALUES);
  }

  if (
    setting.startsWith("is") ||
    setting.startsWith("show") ||
    setting.startsWith("allow") ||
    setting === "hideUnit" ||
    setting === "includeChildSpans"
  ) {
    return random(2) === 0;
  }

  return `${componentType} ${setting} ${generation.name}`;
}

/*
 * Settings the widget's type does not have, as a script or an older
 * version leaves them, each holding what a route would read if it were
 * served: a metric with its services, keys to group and filter by, a
 * whole-attribute group - a table's own settings among them, on a widget
 * that is no table.
 */
function junkSettings(
  generation: Generation,
  typeSettings: Array<string>,
): JSONObject {
  const random: SeededRandom = generation.random;
  const name: string = generation.name;
  const junk: JSONObject = {};

  if (random(2) === 0) {
    junk["notes"] = `for the owner only ${name}`;
  }

  if (random(2) === 0) {
    junk["queryConfigs"] = [
      {
        metricQueryData: {
          filterData: {
            metricName: `junk.metric.${name}`,
            attributes: { [`junk.filter.${name}`]: "x" },
            telemetryServiceIds: [SERVICE_IDS[2]!],
          },
          groupByAttributeKeys: [`junk.group.${name}`],
          groupBy: { attributes: true },
        },
      },
    ];
  }

  if (random(2) === 0) {
    junk["groupBy"] = { attributes: true, [`junk.column.${name}`]: true };
  }

  if (random(3) === 0) {
    junk["groupByAttributes"] = [{ key: `junk.table.${name}` }];
    junk["attributeFilters"] = { [`junk.attribute.${name}`]: "x" };
  }

  // Only what its type does not have.
  for (const key of Object.keys(junk)) {
    if (typeSettings.includes(key)) {
      delete junk[key];
    }
  }

  return junk;
}

/*
 * Every setting a widget type has, read from its declaration, its editor
 * and its sort - never from the table that decides what is served, so a
 * setting it wrongly withholds is still generated, and shows as an answer
 * that changed. A type no board draws holds what a Data Source widget
 * would.
 */
function settingsTheTypeHas(componentType: string): Array<string> {
  return isDashboardComponentType(componentType)
    ? widgetSettingsOf(componentType)
    : ["title", "query", "queries"];
}

interface GeneratedDashboard {
  // Every widget with every setting its type has, and every variable.
  clean: unknown;
  // The same, with settings no widget type has beside some of them.
  dirty: unknown;
  requests: Requests;
}

const ALL_TYPES: Array<string> = [
  ...Object.values(DashboardComponentType),
  "HostMetricChart",
];

const VARIABLE_TYPES: Array<string> = [
  ...Object.values(DashboardVariableType),
  "Some type from the future",
];

function generate(random: SeededRandom, name: string): GeneratedDashboard {
  const variableIds: Array<string> = [];
  const variables: Array<JSONObject> = [];
  const variableCount: number = random(5);

  for (let index: number = 0; index < variableCount; index++) {
    const type: string = pick(random, VARIABLE_TYPES);
    const id: string = random(5) === 0 ? "" : `variable-${name}-${index}`;
    const variable: JSONObject = {
      ...(id ? { id: id } : {}),
      name: `variable_${index}`,
      label: `Variable ${index}`,
      type: type,
      // Every field a variable has, whatever its type.
      attributeKey: random(4) === 0 ? 42 : `variable.${name}.${random(3)}`,
      customListValues: "prod,staging",
      labelOptions: LABEL_IDS.map((value: string, labelIndex: number) => {
        return { label: `Label ${labelIndex}`, value: value };
      }),
      query: `SELECT DISTINCT cluster FROM internal_${name}`,
      isMultiSelect: random(2) === 0,
      ...(random(2) === 0
        ? { defaultValue: pick(random, ["prod", "Met", LABEL_IDS[0]!]) }
        : {}),
      ...(random(2) === 0 ? { selectedValue: "prod" } : {}),
      ...(random(3) === 0 ? { selectedValues: ["prod", LABEL_IDS[1]!] } : {}),
    };

    if (id) {
      variableIds.push(id);
    }

    variables.push(variable);
  }

  const generation: Generation = { random, name, variableIds };
  const cleanEntries: Array<unknown> = [];
  const dirtyEntries: Array<unknown> = [];
  const count: number = 1 + random(9);

  for (let index: number = 0; index < count; index++) {
    const componentType: string = pick(random, ALL_TYPES);
    const settings: JSONObject = {};
    const typeSettings: Array<string> = settingsTheTypeHas(componentType);

    for (const setting of typeSettings) {
      if (random(5) !== 0) {
        settings[setting] = settingValue(
          generation,
          componentType,
          setting,
          index,
        ) as JSONObject;
      }
    }

    const dirtySettings: JSONObject = {
      ...settings,
      ...junkSettings(generation, typeSettings),
    };
    const componentId: string =
      random(5) === 0 ? "" : ObjectID.generate().toString();
    const asText: boolean = random(4) === 0;

    const entryOf: (widgetSettings: JSONObject) => JSONObject = (
      widgetSettings: JSONObject,
    ): JSONObject => {
      return {
        ...(componentId ? { componentId: componentId } : {}),
        componentType: componentType,
        topInDashboardUnits: index,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 6,
        heightInDashboardUnits: 4,
        arguments: asText
          ? (JSON.stringify(widgetSettings) as unknown as JSONObject)
          : widgetSettings,
      };
    };

    cleanEntries.push(entryOf(settings));
    dirtyEntries.push(entryOf(dirtySettings));
  }

  const configOf: (entries: Array<unknown>) => unknown = (
    entries: Array<unknown>,
  ): unknown => {
    return {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: entries,
      ...(variableCount > 0 ? { variables: variables } : {}),
    };
  };

  // The visitor's picks: some variables, each with a value it may offer.
  const requestedVariables: Array<JSONObject> = variables
    .filter((variable: JSONObject): boolean => {
      return Boolean(variable["id"]) && random(2) === 0;
    })
    .map((variable: JSONObject): JSONObject => {
      return {
        id: variable["id"]!,
        selectedValue: pick(random, ["prod", "", null, LABEL_IDS[0]!]),
        selectedValues: someOf(random, ["prod", LABEL_IDS[1]!]),
      };
    });

  return {
    clean: configOf(cleanEntries),
    dirty: configOf(dirtyEntries),
    requests: {
      variables: requestedVariables,
      sorts: cleanEntries.map((): unknown => {
        return random(3) === 0
          ? pick(random, ["status:desc", "name:asc", "time:desc", "bogus"])
          : undefined;
      }),
    },
  };
}

const SEEDS: Array<number> = [6338, 1, 2, 3, 5, 8, 13, 21, 34, 55];

const RUNS_PER_SEED: number = 25;

describe("every public route answers as before for every widget the page draws (issue #6338)", () => {
  test("not vacuous: the routes have something to answer, and refuse now and then", () => {
    let lists: number = 0;
    let refusedLists: number = 0;
    let sloWidgets: number = 0;
    let metricNames: number = 0;
    let services: number = 0;
    let variableKeys: number = 0;

    for (const seed of SEEDS) {
      const random: SeededRandom = seededRandom(seed);

      for (let run: number = 0; run < RUNS_PER_SEED; run++) {
        const generated: GeneratedDashboard = generate(
          random,
          `s${seed}r${run}`,
        );
        const answers: RouteAnswers = answersOf(
          drawnNow(generated.clean),
          generated.requests,
        );

        for (const outcome of answers.resourceLists) {
          if ((outcome as JSONObject)["built"]) {
            lists++;
          } else if (
            !String((outcome as JSONObject)["refused"]).startsWith(
              "Unsupported",
            )
          ) {
            refusedLists++;
          }
        }

        sloWidgets += answers.sloWidgets.filter((outcome: Outcome): boolean => {
          return Boolean((outcome as JSONObject)["built"]);
        }).length;
        metricNames += answers.metricNames.length;
        services += answers.savedServices.length;
        variableKeys += answers.variableAttributeKeys.length;
      }
    }

    expect(lists).toBeGreaterThan(100);
    expect(refusedLists).toBeGreaterThan(20);
    // An SLO widget is one type of 55: a few, pinned and following a variable.
    expect(sloWidgets).toBeGreaterThan(5);
    expect(metricNames).toBeGreaterThan(100);
    expect(services).toBeGreaterThan(50);
    expect(variableKeys).toBeGreaterThan(20);
  });

  test("one widget of every type, with every setting its type has: every answer as before", () => {
    const random: SeededRandom = seededRandom(63380);
    const generation: Generation = {
      random: random,
      name: "every",
      variableIds: ["v-label", "v-slo"],
    };

    const stored: JSONObject = {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: Object.values(DashboardComponentType).map(
        (componentType: DashboardComponentType, index: number): JSONObject => {
          const settings: JSONObject = {};

          for (const setting of settingsTheTypeHas(componentType)) {
            settings[setting] = settingValue(
              generation,
              componentType,
              setting,
              index,
            ) as JSONObject;
          }

          return {
            componentId: ObjectID.generate().toString(),
            componentType: componentType,
            topInDashboardUnits: index,
            leftInDashboardUnits: 0,
            widthInDashboardUnits: 6,
            heightInDashboardUnits: 4,
            arguments: settings,
          };
        },
      ),
      variables: [
        {
          id: "v-label",
          name: "labels",
          type: DashboardVariableType.ProjectLabel,
          labelOptions: [{ label: "Prod", value: LABEL_IDS[0]! }],
          query: "SELECT secret",
        },
        {
          id: "v-slo",
          name: "slo",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "sloName",
          defaultValue: "Checkout availability",
        },
      ],
    };

    const requests: Requests = {
      variables: [
        { id: "v-label", selectedValue: LABEL_IDS[0]!, selectedValues: [] },
      ],
      sorts: [],
    };

    expect(answersOf(drawnNow(stored), requests)).toEqual(
      answersOf(drawnBefore(stored), requests),
    );
  });

  test.each(SEEDS)(
    "seed %i: with every setting each widget's type has, every answer is as before; a setting no type has changes none",
    (seed: number) => {
      const random: SeededRandom = seededRandom(seed);

      for (let run: number = 0; run < RUNS_PER_SEED; run++) {
        const generated: GeneratedDashboard = generate(
          random,
          `s${seed}r${run}`,
        );
        const label: string = `seed ${seed}, dashboard ${run}`;

        const now: RouteAnswers = answersOf(
          drawnNow(generated.clean),
          generated.requests,
        );

        // Every answer, as when every setting was served.
        expect([label, now]).toEqual([
          label,
          answersOf(drawnBefore(generated.clean), generated.requests),
        ]);

        // A setting no widget type has changes no answer...
        const dirtyNow: RouteAnswers = answersOf(
          drawnNow(generated.dirty),
          generated.requests,
        );

        expect([label, dirtyNow]).toEqual([label, now]);

        // ...and widens none: what is allowed now was allowed before.
        const dirtyBefore: RouteAnswers = answersOf(
          drawnBefore(generated.dirty),
          generated.requests,
        );

        for (const key of [
          "metricNames",
          "groupByAttributeKeys",
          "filterAttributeKeys",
          "groupByColumns",
          "variableAttributeKeys",
        ] as const) {
          for (const allowed of dirtyNow[key]) {
            expect([
              label,
              key,
              allowed,
              dirtyBefore[key].includes(allowed),
            ]).toEqual([label, key, allowed, true]);
          }
        }
      }
    },
  );
});

describe("what a setting no widget type has allowed before, and the routes now refuse", () => {
  const chartWith: (settings: JSONObject) => unknown = (
    settings: JSONObject,
  ): unknown => {
    return {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: [
        {
          componentId: ObjectID.generate().toString(),
          componentType: DashboardComponentType.Chart,
          arguments: {
            chartTitle: "CPU",
            metricQueryConfigs: [
              {
                metricQueryData: {
                  filterData: { metricName: "system.cpu.utilization" },
                },
              },
            ],
            ...settings,
          },
        },
      ],
    };
  };

  test("a metric named only in a key no board reads", () => {
    const stored: unknown = chartWith({
      queryConfigs: [
        { metricQueryData: { filterData: { metricName: "billing.revenue" } } },
      ],
    });

    expect(
      answersOf(drawnBefore(stored), { variables: [], sorts: [] }).metricNames,
    ).toEqual(["billing.revenue", "system.cpu.utilization"]);
    expect(
      answersOf(drawnNow(stored), { variables: [], sorts: [] }).metricNames,
    ).toEqual(["system.cpu.utilization"]);
  });

  test("a table's group-by and filter keys stored on a chart, which never groups or filters by them", () => {
    const stored: unknown = chartWith({
      groupByAttributes: [{ key: "enduser.id" }],
      attributeFilters: { "k8s.namespace.name": "payments" },
      groupBy: { attributes: true },
    });

    const before: RouteAnswers = answersOf(drawnBefore(stored), {
      variables: [],
      sorts: [],
    });
    const now: RouteAnswers = answersOf(drawnNow(stored), {
      variables: [],
      sorts: [],
    });

    expect(before.groupByAttributeKeys).toEqual(["enduser.id"]);
    expect(before.filterAttributeKeys).toEqual(["k8s.namespace.name"]);
    expect(before.groupByColumns).toEqual(["attributes"]);

    expect(now.groupByAttributeKeys).toEqual([]);
    expect(now.filterAttributeKeys).toEqual([]);
    expect(now.groupByColumns).toEqual([]);
    expect(now.metricNames).toEqual(["system.cpu.utilization"]);
  });

  test("a title on a widget that draws none is no longer in the overview's summary", () => {
    const stored: unknown = {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: [
        {
          componentId: ObjectID.generate().toString(),
          componentType: DashboardComponentType.Text,
          arguments: { text: "Status", title: "Internal: payments migration" },
        },
      ],
    };

    expect(
      answersOf(drawnBefore(stored), { variables: [], sorts: [] }).summaries,
    ).toEqual([
      expect.objectContaining({
        title: "Internal: payments migration",
        text: "Status",
      }),
    ]);
    expect(
      answersOf(drawnNow(stored), { variables: [], sorts: [] }).summaries,
    ).toEqual([expect.objectContaining({ title: null, text: "Status" })]);
  });
});
