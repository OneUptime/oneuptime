import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import PublicDashboardSloWidget, {
  PublicDashboardSloWidgetConfig,
} from "../../../../Server/Utils/Dashboard/PublicDashboardSloWidget";
import PublicDashboardViewConfig from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../../Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../../Types/Dashboard/DashboardViewConfig";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * The SLO template's own stored config, driven through the server policy that
 * stands between an ANONYMOUS public-dashboard viewer and the project's data.
 *
 * The editorial suite (Tests/Types/Dashboard/SloDashboardTemplate.test.ts)
 * pins what the template SAYS. This one pins what it can be made to DO once a
 * dashboard created from it is published: which rows the unauthenticated
 * routes will read, which columns of those rows travel to the viewer, and
 * which widgets fail closed instead of resolving to something broader than
 * their author picked.
 *
 * Written against the template rather than against hand-built widgets on
 * purpose: a widget the template ships is a widget that exists on real public
 * dashboards, so the two files have to agree about the same JSON, and a
 * change to either one that breaks that agreement fails here.
 */

// -- Fixtures --------------------------------------------------------------

/*
 * The owning dashboard's project. DashboardAPI.servePublicResourceList stamps
 * this over the policy query as the LAST word before the root read, so it is
 * modelled here rather than assumed.
 */
const DASHBOARD_PROJECT_ID: ObjectID = ObjectID.generate();

// The objective an editor picks on a widget after creating the dashboard.
const PICKED_SLO_ID: ObjectID = ObjectID.generate();

/*
 * Everything a caller of the public endpoint controls, all of it naming
 * something this dashboard never published: another SLO, another project,
 * another row set, an unbounded page. None of it may reach the query.
 */
const HOSTILE_QUERY: JSONObject = {
  _id: ObjectID.generate().toString(),
  projectId: ObjectID.generate().toString(),
  name: "probe",
  isEnabled: true,
  isPrivate: false,
  limit: 100000,
  skip: 500,
};

/*
 * The two refusal messages the policy can answer a template widget with. Both
 * are pinned as literals: they are what an operator reads when a public page
 * shows an error, and they say two DIFFERENT things — "nobody picked an
 * objective yet" versus "this kind of widget has no public list at all".
 */
const NO_OBJECTIVE_MESSAGE: string =
  "This dashboard widget has no Service Level Objective selected.";

/*
 * The public list resource each template widget kind resolves to. Any widget
 * kind NOT in this map must be refused; that is the whole point of the
 * fall-through walk at the bottom of the file.
 */
const PUBLIC_LIST_RESOURCE_BY_COMPONENT_TYPE: Partial<
  Record<DashboardComponentType, string>
> = {
  [DashboardComponentType.IncidentList]: "incident",
  [DashboardComponentType.AlertList]: "alert",
  [DashboardComponentType.MonitorList]: "monitor",
};

type WidgetArguments = Record<string, unknown>;

// -- Helpers ---------------------------------------------------------------

/*
 * The config exactly as the public route reads it back: sanitized for
 * anonymous viewers, then through JSON, because it lives in a JSONB column.
 * Anything the template puts in a widget argument that does not survive that
 * round trip is not what the policy parses.
 */
function storedConfig(): DashboardViewConfig {
  const sanitized: DashboardViewConfig | null =
    PublicDashboardViewConfig.sanitize(
      getTemplateConfig(DashboardTemplateType.Slo),
    );

  expect(sanitized).not.toBeNull();

  return JSON.parse(JSON.stringify(sanitized)) as DashboardViewConfig;
}

function componentsOfType(
  config: DashboardViewConfig,
  componentType: DashboardComponentType,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return component.componentType === componentType;
    },
  );
}

// Fails loudly (rather than returning undefined) when the widget is gone.
function onlyComponentOfType(
  config: DashboardViewConfig,
  componentType: DashboardComponentType,
): DashboardBaseComponent {
  const matches: Array<DashboardBaseComponent> = componentsOfType(
    config,
    componentType,
  );

  expect(matches).toHaveLength(1);

  return matches[0] as DashboardBaseComponent;
}

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

/*
 * Widget titles are the only stable handle on a template widget — component
 * ids are regenerated on every getTemplateConfig() call and row positions
 * move whenever a band is inserted. Each family stores its title under its
 * own key; the Slo widget uses `widgetTitle`, which no other family does.
 */
function titleOf(component: DashboardBaseComponent): string {
  const args: WidgetArguments = argumentsOf(component);

  for (const key of ["widgetTitle", "title", "chartTitle", "text"]) {
    const value: unknown = args[key];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return "(untitled)";
}

// Every assertion below is labelled with this, so a failure names the widget.
function labelOf(component: DashboardBaseComponent): string {
  return `${component.componentType} "${titleOf(component)}"`;
}

/*
 * A copy of a stored widget with its arguments overridden — used to model the
 * editor picking an objective on a template widget, which is the only thing
 * that turns one of them into a widget that resolves.
 */
function withArguments(
  component: DashboardBaseComponent,
  overrides: WidgetArguments,
): DashboardBaseComponent {
  return {
    ...component,
    arguments: { ...argumentsOf(component), ...overrides },
  } as DashboardBaseComponent;
}

function buildPolicy(data: {
  config: DashboardViewConfig;
  component: DashboardBaseComponent;
  requestedQuery?: JSONObject | undefined;
  requestedVariables?: Array<JSONObject> | undefined;
}): PublicDashboardResourceListPolicyResult {
  return PublicDashboardResourceListPolicy.build({
    widget: data.component as unknown as JSONObject,
    dashboardViewConfig: data.config,
    requestedVariables: data.requestedVariables || [],
    requestedQuery: data.requestedQuery || {},
  });
}

/*
 * The query the route actually executes: the policy query, with the owning
 * dashboard's project stamped over it. Asserting on THIS rather than on
 * policy.query alone is what proves a requested projectId cannot survive.
 */
function routeQuery(policy: PublicDashboardResourceListPolicyResult): {
  [key: string]: unknown;
} {
  return { ...policy.query, projectId: DASHBOARD_PROJECT_ID };
}

/*
 * What the policy did with one stored widget, as a single comparable string:
 * either the resource it will list, or the refusal it answered with. A widget
 * that resolves where it should be refused reads as a plain diff rather than
 * as a missing throw.
 */
function outcomeOf(data: {
  config: DashboardViewConfig;
  component: DashboardBaseComponent;
}): string {
  try {
    const policy: PublicDashboardResourceListPolicyResult = buildPolicy(data);

    return `lists ${policy.resourceType}`;
  } catch (error) {
    if (error instanceof BadDataException) {
      return `refused: ${error.message}`;
    }

    return `threw a non-BadDataException: ${String(error)}`;
  }
}

function expectedOutcomeOf(component: DashboardBaseComponent): string {
  const resourceType: string | undefined =
    PUBLIC_LIST_RESOURCE_BY_COMPONENT_TYPE[component.componentType];

  if (resourceType) {
    return `lists ${resourceType}`;
  }

  /*
   * Every Slo widget the template ships is unconfigured, so it refuses for
   * the one reason that is not a bug.
   */
  if (component.componentType === DashboardComponentType.Slo) {
    return `refused: ${NO_OBJECTIVE_MESSAGE}`;
  }

  /*
   * Text, Value and Chart widgets read the metric store, not a Postgres list,
   * so the public list endpoint has nothing to serve them — and says which
   * widget kind it is turning away.
   */
  return `refused: Unsupported public dashboard resource widget: ${component.componentType}`;
}

/*
 * The columns the model declares that a widget's public select does NOT
 * publish. Derived from the model itself so it cannot go stale as the model
 * grows.
 */
function withheldColumnsOf(data: {
  model: DatabaseBaseModel;
  select: JSONObject;
}): Array<string> {
  const published: Array<string> = Object.keys(data.select);

  return data.model
    .getTableColumns()
    .columns.filter((column: string): boolean => {
      return !published.includes(column);
    });
}

/*
 * Two directions, both needed:
 *
 * - every field the select DOES publish is a real column of the model, so a
 *   pinned select cannot quietly drift onto a field that no longer exists;
 * - every column named as sensitive is a real column of the model AND is
 *   withheld. Checking that the name is real is what stops this list from
 *   rotting into a set of no-op assertions after a column rename.
 */
function expectSelectPublishesNothingSensitive(data: {
  modelName: string;
  model: DatabaseBaseModel;
  select: JSONObject;
  sensitiveColumns: Array<string>;
}): void {
  const declared: Array<string> = data.model.getTableColumns().columns;
  const withheld: Array<string> = withheldColumnsOf({
    model: data.model,
    select: data.select,
  });

  expect(declared.length).toBeGreaterThan(0);
  expect(withheld.length).toBeGreaterThan(0);
  expect(data.sensitiveColumns.length).toBeGreaterThan(0);

  for (const column of Object.keys(data.select)) {
    expect(
      `${data.modelName}.${column} is ${
        declared.includes(column) ? "a column" : "NOT A COLUMN"
      }`,
    ).toBe(`${data.modelName}.${column} is a column`);
  }

  for (const column of data.sensitiveColumns) {
    expect(
      `${data.modelName}.${column} is ${
        declared.includes(column) ? "a column" : "NOT A COLUMN"
      }`,
    ).toBe(`${data.modelName}.${column} is a column`);

    expect(
      `${data.modelName}.${column} is ${
        withheld.includes(column) ? "withheld" : "PUBLISHED"
      }`,
    ).toBe(`${data.modelName}.${column} is withheld`);
  }
}

function monitorVariableOf(config: DashboardViewConfig): DashboardVariable {
  const telemetryVariables: Array<DashboardVariable> = (
    config.variables || []
  ).filter((variable: DashboardVariable): boolean => {
    return variable.type === DashboardVariableType.TelemetryAttribute;
  });

  expect(telemetryVariables).toHaveLength(1);

  return telemetryVariables[0] as DashboardVariable;
}

/*
 * A selection for the template's own Monitor variable, plus one for a
 * variable this dashboard does not have. Neither may become a filter on the
 * Postgres-backed lists, which read no telemetry attribute at all.
 */
function hostileVariableSelections(
  config: DashboardViewConfig,
): Array<JSONObject> {
  return [
    {
      id: monitorVariableOf(config).id,
      selectedValues: ["' OR 1=1 --", "%"],
    },
    {
      id: ObjectID.generate().toString(),
      selectedValues: ["a variable this dashboard never stored"],
    },
  ];
}

// -- Tests -----------------------------------------------------------------

describe("SLO dashboard template on a public dashboard", () => {
  describe("the config an anonymous viewer is served", () => {
    /*
     * The sanitizer drops Data Source widgets outright, because their stored
     * config IS a query against an internal system. This template ships none,
     * so publishing it must cost it no widgets — if a later revision reaches
     * for a Data Source widget, the public page would silently lose it.
     */
    it("keeps every widget the template ships", () => {
      const template: DashboardViewConfig = getTemplateConfig(
        DashboardTemplateType.Slo,
      ) as DashboardViewConfig;

      expect(template).not.toBeNull();
      expect(template.components.length).toBeGreaterThan(0);

      const published: DashboardViewConfig = storedConfig();

      expect(
        published.components.map(
          (component: DashboardBaseComponent): string => {
            return component.componentType;
          },
        ),
      ).toEqual(
        template.components.map((component: DashboardBaseComponent): string => {
          return component.componentType;
        }),
      );
    });
  });

  describe("SLO widgets while no objective is picked", () => {
    /*
     * The security property this template rests on. Every Slo widget ships
     * without a serviceLevelObjectiveId because a template cannot know a
     * project's SLO ids — and on a public dashboard the stored id IS the
     * authorization decision. An unconfigured widget therefore has to fail
     * closed: the one thing it must never do is resolve to "whichever SLO the
     * query finds", which on a project-scoped read means any of them.
     */
    it("refuses every SLO widget the template ships", () => {
      const config: DashboardViewConfig = storedConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);

      const outcomes: Array<string> = sloWidgets.map(
        (component: DashboardBaseComponent): string => {
          return `${labelOf(component)} -> ${outcomeOf({ config, component })}`;
        },
      );

      expect(outcomes).toEqual(
        sloWidgets.map((component: DashboardBaseComponent): string => {
          return `${labelOf(component)} -> refused: ${NO_OBJECTIVE_MESSAGE}`;
        }),
      );
    });

    /*
     * The same stored widget also drives the SloHistory aggregation route,
     * which is a second unauthenticated surface reading a different store.
     * Both parse the id through PublicDashboardSloWidget, so both have to
     * refuse the unconfigured widget — a template whose widgets failed closed
     * on one route and open on the other would be worse than either.
     */
    it("refuses the same widgets on the SLO history route too", () => {
      const config: DashboardViewConfig = storedConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);

      const outcomes: Array<string> = sloWidgets.map(
        (component: DashboardBaseComponent): string => {
          try {
            const parsed: PublicDashboardSloWidgetConfig =
              PublicDashboardSloWidget.readConfig(component);

            return `${labelOf(component)} -> read ${parsed.serviceLevelObjectiveId.toString()}`;
          } catch (error) {
            if (error instanceof BadDataException) {
              return `${labelOf(component)} -> refused: ${error.message}`;
            }

            return `${labelOf(component)} -> threw a non-BadDataException: ${String(
              error,
            )}`;
          }
        },
      );

      expect(outcomes).toEqual(
        sloWidgets.map((component: DashboardBaseComponent): string => {
          return `${labelOf(component)} -> refused: ${NO_OBJECTIVE_MESSAGE}`;
        }),
      );
    });
  });

  describe("an SLO widget once an objective is picked", () => {
    /*
     * The id comes from stored config and from nowhere else. A caller that
     * names a different SLO, a different project, or no filter at all gets
     * the one row the widget's author published — which is why this endpoint
     * cannot be walked across the project's other objectives.
     */
    it("resolves to exactly the SLO stored on the widget, whatever the request asks for", () => {
      const config: DashboardViewConfig = storedConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);

      const resolved: Array<string> = sloWidgets.map(
        (component: DashboardBaseComponent): string => {
          const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
            config,
            component: withArguments(component, {
              serviceLevelObjectiveId: PICKED_SLO_ID.toString(),
            }),
            requestedQuery: HOSTILE_QUERY,
            requestedVariables: hostileVariableSelections(config),
          });

          return `${labelOf(component)} -> ${policy.resourceType} ${JSON.stringify(
            routeQuery(policy),
          )}`;
        },
      );

      expect(resolved).toEqual(
        sloWidgets.map((component: DashboardBaseComponent): string => {
          return `${labelOf(component)} -> slo ${JSON.stringify({
            _id: PICKED_SLO_ID,
            projectId: DASHBOARD_PROJECT_ID,
          })}`;
        }),
      );
    });

    /*
     * One row, no filter, and no caller-supplied page size. A widget that
     * renders a single objective has no use for a second row, and a read that
     * accepts no filter cannot be turned into an oracle that answers
     * questions about the SLOs it was not pointed at.
     */
    it("reads one row and accepts no filter of its own", () => {
      const config: DashboardViewConfig = storedConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);

      for (const component of sloWidgets) {
        const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
          config,
          component: withArguments(component, {
            serviceLevelObjectiveId: PICKED_SLO_ID.toString(),
          }),
          requestedQuery: HOSTILE_QUERY,
          requestedVariables: hostileVariableSelections(config),
        });

        expect(`${labelOf(component)} reads ${policy.limit} row(s)`).toBe(
          `${labelOf(component)} reads 1 row(s)`,
        );
        expect(
          `${labelOf(component)} filters on ${Object.keys(policy.query)
            .sort()
            .join(", ")}`,
        ).toBe(`${labelOf(component)} filters on _id`);
        expect(policy.sort).toEqual({ name: SortOrder.Ascending });
      }
    });

    /*
     * The id is not the only thing the server parses out of these widgets:
     * the series and the shape are stored under `sloMetric` and
     * `displayType`, and the policy reads those same keys. Renaming either
     * key in the template would leave the server silently defaulting to the
     * SLI tile on six widgets that draw three different numbers.
     */
    it("parses back the series and display the template stored on each widget", () => {
      const config: DashboardViewConfig = storedConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);

      const parsed: Array<string> = sloWidgets.map(
        (component: DashboardBaseComponent): string => {
          const config2: PublicDashboardSloWidgetConfig =
            PublicDashboardSloWidget.readConfig(
              withArguments(component, {
                serviceLevelObjectiveId: PICKED_SLO_ID.toString(),
              }),
            );

          return `${labelOf(component)} -> ${config2.sloMetric}/${config2.displayType}`;
        },
      );

      expect(parsed).toEqual(
        sloWidgets.map((component: DashboardBaseComponent): string => {
          const args: WidgetArguments = argumentsOf(component);

          return `${labelOf(component)} -> ${String(args["sloMetric"])}/${String(
            args["displayType"],
          )}`;
        }),
      );

      // ...and what came back is a real member of each enum, not a free string.
      for (const entry of parsed) {
        const [metric, display] = (entry.split(" -> ")[1] as string).split("/");

        expect(Object.values(SloWidgetMetric) as Array<string>).toContain(
          metric as string,
        );
        expect(Object.values(SloWidgetDisplayType) as Array<string>).toContain(
          display as string,
        );
      }
    });
  });

  describe("what an SLO row may show in public", () => {
    function sloSelect(): JSONObject {
      const config: DashboardViewConfig = storedConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);

      return buildPolicy({
        config,
        component: withArguments(sloWidgets[0] as DashboardBaseComponent, {
          serviceLevelObjectiveId: PICKED_SLO_ID.toString(),
        }),
        requestedQuery: HOSTILE_QUERY,
      }).select;
    }

    it("publishes the row id and the seven display numbers, and nothing else", () => {
      expect(sloSelect()).toEqual({
        _id: true,
        name: true,
        targetPercentage: true,
        currentSliPercentage: true,
        errorBudgetRemainingPercentage: true,
        errorBudgetRemainingSeconds: true,
        currentBurnRate: true,
        sloStatus: true,
      });
    });

    /*
     * An SLO's headline numbers are publishable; its DEFINITION is not. Which
     * monitors it watches, how it is evaluated and on what schedule, the
     * metric query behind it, and who created it are all things a reader of a
     * public status page has no business reading out of it.
     *
     * Driven from ServiceLevelObjective's own column list so that each name
     * below is checked to be a real column before it is checked to be
     * withheld — a rename that made one of these assertions vacuous fails
     * here instead of passing quietly.
     */
    it("keeps every other ServiceLevelObjective column behind the session", () => {
      expectSelectPublishesNothingSensitive({
        modelName: "ServiceLevelObjective",
        model: new ServiceLevelObjective(),
        select: sloSelect(),
        sensitiveColumns: [
          "description",
          "slug",
          "labels",
          "monitors",
          "monitorLabels",
          "autoAddedMonitors",
          "downtimeMonitorStatuses",
          "multiMonitorMode",
          "metricQueryConfig",
          "sliType",
          "windowType",
          "windowDays",
          "timezone",
          "lastEvaluatedAt",
          "nextEvaluationAt",
          "lastAccumulatedBucketEndAt",
          "statusChangeNotificationSentAt",
          "createdByUser",
          "createdByUserId",
          "projectId",
        ],
      });
    });
  });

  describe("the incident, alert and monitor lists the template ships", () => {
    /*
     * These three read Postgres and carry no stored filter at all — the
     * template deliberately pre-filters none of them to a lifecycle state, a
     * severity, or a monitor type. So the ONLY thing narrowing the read is
     * the project the dashboard belongs to, and that has to hold even when
     * the caller supplies a query naming another project.
     */
    it("scopes each list to the dashboard's project and to nothing else", () => {
      const config: DashboardViewConfig = storedConfig();
      const listWidgets: Array<DashboardBaseComponent> = [
        onlyComponentOfType(config, DashboardComponentType.IncidentList),
        onlyComponentOfType(config, DashboardComponentType.AlertList),
        onlyComponentOfType(config, DashboardComponentType.MonitorList),
      ];

      expect(listWidgets.length).toBeGreaterThan(0);

      for (const component of listWidgets) {
        const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
          config,
          component,
          requestedQuery: HOSTILE_QUERY,
          requestedVariables: hostileVariableSelections(config),
        });

        /*
         * The policy names no project of its own: the route's stamp is the
         * only source of project scope, and it must be the last word.
         */
        expect(
          `${labelOf(component)} filters on [${Object.keys(policy.query)
            .sort()
            .join(", ")}]`,
        ).toBe(`${labelOf(component)} filters on []`);

        expect(routeQuery(policy)).toEqual({
          projectId: DASHBOARD_PROJECT_ID,
        });
      }
    });

    /*
     * The dashboard's Monitor variable is a TelemetryAttribute bound to the
     * bare `monitorName` key, which these three widgets cannot read: they
     * query Postgres, and MonitorList's only variable binding is a
     * ProjectLabel one this template does not ship. A selection therefore has
     * to leave the query untouched rather than become an IN-list on it.
     */
    it("lets no variable selection become a filter on those lists", () => {
      const config: DashboardViewConfig = storedConfig();
      const variable: DashboardVariable = monitorVariableOf(config);

      expect(variable.attributeKey).toBe("monitorName");

      for (const componentType of [
        DashboardComponentType.IncidentList,
        DashboardComponentType.AlertList,
        DashboardComponentType.MonitorList,
      ]) {
        const component: DashboardBaseComponent = onlyComponentOfType(
          config,
          componentType,
        );
        const withSelection: PublicDashboardResourceListPolicyResult =
          buildPolicy({
            config,
            component,
            requestedVariables: [
              {
                id: variable.id,
                selectedValues: ["api-monitor", "' OR 1=1 --"],
              },
            ],
          });
        const withoutSelection: PublicDashboardResourceListPolicyResult =
          buildPolicy({ config, component });

        expect(
          `${labelOf(component)} with a monitor picked: ${JSON.stringify(
            withSelection.query,
          )}`,
        ).toBe(
          `${labelOf(component)} with a monitor picked: ${JSON.stringify(
            withoutSelection.query,
          )}`,
        );
      }
    });

    /*
     * Resource type, order and page size, per widget. The resource type is
     * checked against the URL the caller requested before any read happens,
     * so a widget resolving to the wrong one would let a dashboard serve a
     * resource it does not render; the limit comes from the widget's OWN
     * stored maxRows, never from the request.
     */
    it("maps each list to its own resource, order and stored row cap", () => {
      const config: DashboardViewConfig = storedConfig();

      const expectations: Array<{
        componentType: DashboardComponentType;
        resourceType: string;
        sort: JSONObject;
      }> = [
        {
          componentType: DashboardComponentType.IncidentList,
          resourceType: "incident",
          sort: { createdAt: SortOrder.Descending },
        },
        {
          componentType: DashboardComponentType.AlertList,
          resourceType: "alert",
          sort: { createdAt: SortOrder.Descending },
        },
        {
          componentType: DashboardComponentType.MonitorList,
          resourceType: "monitor",
          sort: { name: SortOrder.Ascending },
        },
      ];

      for (const expectation of expectations) {
        const component: DashboardBaseComponent = onlyComponentOfType(
          config,
          expectation.componentType,
        );
        const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
          config,
          component,
          requestedQuery: HOSTILE_QUERY,
        });

        expect(`${labelOf(component)} lists ${policy.resourceType}`).toBe(
          `${labelOf(component)} lists ${expectation.resourceType}`,
        );
        expect(policy.sort).toEqual(expectation.sort);

        // The cap is the widget's own stored one, not the request's 100000.
        expect(`${labelOf(component)} reads ${policy.limit} rows`).toBe(
          `${labelOf(component)} reads ${String(
            argumentsOf(component)["maxRows"],
          )} rows`,
        );
        expect(policy.limit).toBeGreaterThan(0);
        expect(policy.limit).toBeLessThanOrEqual(LIMIT_PER_PROJECT);
      }
    });

    it("publishes only the columns the incident list renders", () => {
      const config: DashboardViewConfig = storedConfig();
      const select: JSONObject = buildPolicy({
        config,
        component: onlyComponentOfType(
          config,
          DashboardComponentType.IncidentList,
        ),
      }).select;

      expect(select).toEqual({
        _id: true,
        title: true,
        createdAt: true,
        currentIncidentState: { name: true, color: true },
        incidentSeverity: { name: true, color: true },
      });

      /*
       * An incident's title and state are what the widget draws. Its write-up
       * is not: the description, the root cause, the remediation notes and
       * the postmortem are internal narrative, and the telemetry query and
       * monitor bindings describe the project's topology.
       */
      expectSelectPublishesNothingSensitive({
        modelName: "Incident",
        model: new Incident(),
        select,
        sensitiveColumns: [
          "description",
          "rootCause",
          "remediationNotes",
          "postmortemNote",
          "postmortemAttachments",
          "telemetryQuery",
          "customFields",
          "monitors",
          "monitorSummary",
          "labels",
          "onCallDutyPolicies",
          "isPrivate",
          "createdByUserId",
          "seriesLabels",
        ],
      });
    });

    it("publishes only the columns the alert list renders", () => {
      const config: DashboardViewConfig = storedConfig();
      const select: JSONObject = buildPolicy({
        config,
        component: onlyComponentOfType(
          config,
          DashboardComponentType.AlertList,
        ),
      }).select;

      expect(select).toEqual({
        _id: true,
        title: true,
        createdAt: true,
        currentAlertState: { name: true, color: true },
        alertSeverity: { name: true, color: true },
      });

      expectSelectPublishesNothingSensitive({
        modelName: "Alert",
        model: new Alert(),
        select,
        sensitiveColumns: [
          "description",
          "rootCause",
          "remediationNotes",
          "telemetryQuery",
          "customFields",
          "monitor",
          "monitorId",
          "monitorSummary",
          "labels",
          "onCallDutyPolicies",
          "isPrivate",
          "createdByUserId",
          "seriesLabels",
        ],
      });
    });

    it("publishes only the columns the monitor list renders", () => {
      const config: DashboardViewConfig = storedConfig();
      const select: JSONObject = buildPolicy({
        config,
        component: onlyComponentOfType(
          config,
          DashboardComponentType.MonitorList,
        ),
      }).select;

      expect(select).toEqual({
        _id: true,
        name: true,
        monitorType: true,
        currentMonitorStatus: { name: true, color: true },
      });

      /*
       * The monitor list is the one on this dashboard with credentials behind
       * it. A monitor's steps carry the request it makes — URLs, headers,
       * bodies — and three columns are literally secret keys that let a
       * caller post as that monitor.
       */
      expectSelectPublishesNothingSensitive({
        modelName: "Monitor",
        model: new Monitor(),
        select,
        sensitiveColumns: [
          "monitorSteps",
          "serverMonitorSecretKey",
          "incomingRequestSecretKey",
          "incomingEmailSecretKey",
          "incomingMonitorRequest",
          "incomingEmailMonitorRequest",
          "serverMonitorResponse",
          "customFields",
          "description",
          "labels",
          "slug",
          "dependsOnMonitors",
          "monitoringInterval",
          "createdByUserId",
        ],
      });
    });
  });

  describe("every component on the template", () => {
    /*
     * The fall-through guard. Walking the whole config — not just the widgets
     * this file has an opinion about — is what proves that no widget kind the
     * template ships reaches the public list endpoint by accident. A widget
     * added to the template later either appears in the expected map above,
     * or it must be refused; there is no third outcome, and "silently built a
     * policy nobody reviewed" is exactly the one worth failing on.
     */
    it("either lists a known resource or is refused, with nothing in between", () => {
      const config: DashboardViewConfig = storedConfig();
      const components: Array<DashboardBaseComponent> = config.components;

      expect(components.length).toBeGreaterThan(0);

      const outcomes: Array<string> = components.map(
        (component: DashboardBaseComponent): string => {
          return `${labelOf(component)} -> ${outcomeOf({ config, component })}`;
        },
      );

      expect(outcomes).toEqual(
        components.map((component: DashboardBaseComponent): string => {
          return `${labelOf(component)} -> ${expectedOutcomeOf(component)}`;
        }),
      );

      /*
       * Guards: a template that listed everything, or nothing, would pass the
       * comparison above only because the expectations were derived from it.
       */
      const listed: Array<string> = outcomes.filter(
        (outcome: string): boolean => {
          return outcome.includes(" -> lists ");
        },
      );
      const refused: Array<string> = outcomes.filter(
        (outcome: string): boolean => {
          return outcome.includes(" -> refused: ");
        },
      );

      expect(listed.length).toBe(
        Object.keys(PUBLIC_LIST_RESOURCE_BY_COMPONENT_TYPE).length,
      );
      expect(refused.length).toBeGreaterThan(0);
      expect(listed.length + refused.length).toBe(components.length);
    });

    /*
     * Nothing that does resolve may resolve to an empty policy: a blank
     * resource type would fail the route's resource check for the wrong
     * reason, and a blank select would hand the serializer a whole row.
     */
    it("gives every widget that does resolve a complete policy", () => {
      const config: DashboardViewConfig = storedConfig();
      const listWidgets: Array<DashboardBaseComponent> =
        config.components.filter(
          (component: DashboardBaseComponent): boolean => {
            return Boolean(
              PUBLIC_LIST_RESOURCE_BY_COMPONENT_TYPE[component.componentType],
            );
          },
        );

      expect(listWidgets.length).toBeGreaterThan(0);

      for (const component of listWidgets) {
        const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
          config,
          component,
        });

        expect(
          `${labelOf(component)} resource "${policy.resourceType}"`,
        ).not.toBe(`${labelOf(component)} resource ""`);
        expect(
          `${labelOf(component)} selects ${Object.keys(policy.select).length} field(s)`,
        ).not.toBe(`${labelOf(component)} selects 0 field(s)`);
        expect(Object.keys(policy.sort).length).toBeGreaterThan(0);
        expect(policy.limit).toBeGreaterThan(0);
      }
    });
  });
});
