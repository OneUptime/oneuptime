import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import PublicDashboardSloHistoryPolicy, {
  PublicDashboardSloHistoryPolicyResult,
} from "../../../../Server/Utils/Dashboard/PublicDashboardSloHistoryPolicy";
import {
  PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE,
  PublicDashboardSloWidgetTargetKind,
} from "../../../../Server/Utils/Dashboard/PublicDashboardSloWidget";
import PublicDashboardViewConfig from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { SloWidgetDisplayType } from "../../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../../Types/Dashboard/DashboardTemplates";
import DashboardVariable from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../../Types/Dashboard/DashboardViewConfig";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import { SLO_LIST_DEFAULT_MAX_ROWS } from "../../../../Utils/Slo/SloListWidgetFormat";
import { describe, expect, it } from "@jest/globals";

/*
 * The SLO template's own stored config, driven through the server policies
 * that stand between an ANONYMOUS public-dashboard viewer and the project's
 * data.
 *
 * The editorial suite pins what the template SAYS. This one pins what it can
 * be made to DO once a dashboard created from it is published: which rows the
 * unauthenticated routes read, which columns travel to the viewer, what the
 * viewer's toolbar selection is allowed to change, and which widgets fail
 * closed.
 *
 * Written against the template rather than hand-built widgets: a widget the
 * template ships is a widget that exists on real public dashboards.
 */

// -- Fixtures --------------------------------------------------------------

/*
 * DashboardAPI stamps the owning dashboard's project over every policy query
 * as the LAST word before the root read, so it is modelled rather than assumed.
 */
const DASHBOARD_PROJECT_ID: ObjectID = ObjectID.generate();

const PICKED_SLO: string = "Checkout API";

/*
 * Everything a caller of the public endpoint controls that names something the
 * dashboard never published. None of it may reach the query.
 */
const HOSTILE_QUERY: JSONObject = {
  _id: ObjectID.generate().toString(),
  projectId: ObjectID.generate().toString(),
  name: "probe",
  isArchived: true,
  description: "leak",
  limit: 100000,
  skip: 500,
};

const UNSUPPORTED_MESSAGE_PREFIX: string =
  "Unsupported public dashboard resource widget: ";

/*
 * The seven display fields (plus the row id) both SLO widgets render. Pinned
 * as a literal: this IS what an anonymous viewer can read.
 */
const PUBLISHED_SLO_SELECT: JSONObject = {
  _id: true,
  name: true,
  targetPercentage: true,
  currentSliPercentage: true,
  errorBudgetRemainingPercentage: true,
  errorBudgetRemainingSeconds: true,
  currentBurnRate: true,
  sloStatus: true,
};

type WidgetArguments = Record<string, unknown>;

// -- Helpers ---------------------------------------------------------------

/*
 * The config exactly as the public route reads it back: sanitized for
 * anonymous viewers, then through JSON, because it lives in a JSONB column.
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

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

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

function labelOf(component: DashboardBaseComponent): string {
  return `${component.componentType} "${titleOf(component)}"`;
}

function sloVariableOf(config: DashboardViewConfig): DashboardVariable {
  const variables: Array<DashboardVariable> = config.variables || [];

  expect(variables).toHaveLength(1);
  return variables[0] as DashboardVariable;
}

// What the browser sends for a single-select toolbar pick.
function selectionOf(
  config: DashboardViewConfig,
  selectedValue: string,
): Array<JSONObject> {
  return [
    {
      id: sloVariableOf(config).id,
      selectedValue: selectedValue,
      selectedValues: [],
    },
  ];
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

// The query the route actually executes: the policy's, with the project stamped last.
function routeQuery(
  policy: PublicDashboardResourceListPolicyResult,
): Record<string, unknown> {
  return { ...policy.query, projectId: DASHBOARD_PROJECT_ID };
}

function outcomeOf(data: {
  config: DashboardViewConfig;
  component: DashboardBaseComponent;
  requestedVariables?: Array<JSONObject> | undefined;
}): string {
  try {
    return `lists ${buildPolicy(data).resourceType}`;
  } catch (error) {
    if (error instanceof BadDataException) {
      return `refused: ${error.message}`;
    }

    return `threw a non-BadDataException: ${String(error)}`;
  }
}

function buildHistoryPolicy(data: {
  config: DashboardViewConfig;
  component: DashboardBaseComponent;
  requestedVariables?: Array<JSONObject> | undefined;
}): PublicDashboardSloHistoryPolicyResult {
  // The route resolves the viewer's selections exactly like this before building.
  const variables: Array<DashboardVariable> =
    PublicDashboardResourceListPolicy.resolveDashboardVariableSelections({
      dashboardViewConfig: data.config,
      requestedVariables: data.requestedVariables || [],
    });

  return PublicDashboardSloHistoryPolicy.build({
    widget: data.component,
    requestedAggregateBy: {
      startTimestamp: new Date("2026-08-09T00:00:00.000Z"),
      endTimestamp: new Date("2026-08-09T06:00:00.000Z"),
    },
    variables,
  });
}

/*
 * Columns the model declares that a select does NOT publish, derived from the
 * model so each sensitive name is checked to be a real column before it is
 * checked to be withheld — a rename cannot make an assertion vacuous.
 */
function expectSelectPublishesNothingSensitive(data: {
  model: DatabaseBaseModel;
  select: JSONObject;
  sensitiveColumns: Array<string>;
}): void {
  const declared: Array<string> = data.model.getTableColumns().columns;
  const published: Array<string> = Object.keys(data.select);

  for (const column of published) {
    expect(
      `${column} is ${declared.includes(column) ? "a column" : "NOT A COLUMN"}`,
    ).toBe(`${column} is a column`);
  }

  for (const column of data.sensitiveColumns) {
    expect(
      `${column} is ${declared.includes(column) ? "a column" : "NOT A COLUMN"}`,
    ).toBe(`${column} is a column`);
    expect(
      `${column} is ${published.includes(column) ? "PUBLISHED" : "withheld"}`,
    ).toBe(`${column} is withheld`);
  }
}

const SENSITIVE_SLO_COLUMNS: Array<string> = [
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
  "atRiskThresholdPercentage",
  "errorBudgetTotalSeconds",
  "isEnabled",
  "isArchived",
  "archivedAt",
  "archivedByUserId",
  "lastEvaluatedAt",
  "nextEvaluationAt",
  "lastAccumulatedBucketEndAt",
  "statusChangeNotificationSentAt",
  "createdByUserId",
  "projectId",
];

// -- Tests -----------------------------------------------------------------

describe("SLO dashboard template on a public dashboard", () => {
  describe("the config an anonymous viewer is served", () => {
    it("keeps every widget and the SLO variable the template ships", () => {
      const template: DashboardViewConfig = getTemplateConfig(
        DashboardTemplateType.Slo,
      ) as DashboardViewConfig;
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
      expect(published.variables).toHaveLength(1);
    });
  });

  describe("every component on the template", () => {
    /*
     * The fall-through guard. As published and before any pick, the SLO List
     * serves its resource, the SLO widgets refuse for the one reason that is
     * not a bug (nobody has picked an SLO), and the metric and text widgets are
     * turned away from the list endpoint entirely. There is no fourth outcome.
     */
    it("either lists a known resource or is refused, with nothing in between", () => {
      const config: DashboardViewConfig = storedConfig();

      expect(
        config.components.map((component: DashboardBaseComponent): string => {
          return `${labelOf(component)} -> ${outcomeOf({ config, component })}`;
        }),
      ).toEqual(
        config.components.map((component: DashboardBaseComponent): string => {
          if (component.componentType === DashboardComponentType.SloList) {
            return `${labelOf(component)} -> lists slo-list`;
          }

          if (component.componentType === DashboardComponentType.Slo) {
            return `${labelOf(component)} -> refused: ${PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE}`;
          }

          return `${labelOf(component)} -> refused: ${UNSUPPORTED_MESSAGE_PREFIX}${component.componentType}`;
        }),
      );
    });

    it("lists the SLO widgets' objective once a pick is sent, and nothing else changes", () => {
      const config: DashboardViewConfig = storedConfig();
      const requestedVariables: Array<JSONObject> = selectionOf(
        config,
        PICKED_SLO,
      );

      for (const component of config.components) {
        const expected: string =
          component.componentType === DashboardComponentType.SloList
            ? "lists slo-list"
            : component.componentType === DashboardComponentType.Slo
              ? "lists slo"
              : `refused: ${UNSUPPORTED_MESSAGE_PREFIX}${component.componentType}`;

        expect(
          `${labelOf(component)} -> ${outcomeOf({
            config,
            component,
            requestedVariables,
          })}`,
        ).toBe(`${labelOf(component)} -> ${expected}`);
      }
    });
  });

  describe("the SLO widgets", () => {
    /*
     * Unpicked, every SLO widget fails closed on BOTH unauthenticated routes.
     * What it must never do is resolve to "whichever SLO the query finds",
     * which on a project-scoped read means any of them.
     */
    it("refuse on the resource and history routes until an SLO is picked", () => {
      const config: DashboardViewConfig = storedConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);

      for (const component of sloWidgets) {
        expect(() => {
          return buildPolicy({ config, component });
        }).toThrow(PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE);

        if (
          argumentsOf(component)["displayType"] === SloWidgetDisplayType.Chart
        ) {
          expect(() => {
            return buildHistoryPolicy({ config, component });
          }).toThrow(PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE);
        }
      }
    });

    /*
     * With a pick, the read is an exact-match NAME within the dashboard's
     * project, among ACTIVE objectives only, two rows at most (one to show,
     * one to detect a shared name) — and nothing in the request's own query
     * survives.
     */
    it("read the picked SLO by exact name, active only, at most two rows, whatever the query says", () => {
      const config: DashboardViewConfig = storedConfig();

      for (const component of componentsOfType(
        config,
        DashboardComponentType.Slo,
      )) {
        const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
          config,
          component,
          requestedQuery: HOSTILE_QUERY,
          requestedVariables: selectionOf(config, PICKED_SLO),
        });

        expect(`${labelOf(component)} -> ${policy.resourceType}`).toBe(
          `${labelOf(component)} -> slo`,
        );
        expect(routeQuery(policy)).toEqual({
          name: PICKED_SLO,
          isArchived: false,
          projectId: DASHBOARD_PROJECT_ID,
        });
        expect(policy.limit).toBe(2);
        expect(policy.sort).toEqual({ name: SortOrder.Ascending });
        expect(policy.select).toEqual(PUBLISHED_SLO_SELECT);
      }
    });

    /*
     * A viewer's value is used as a literal equality, never compiled into a
     * search or an IN-list: a string that looks like SQL is just a name no SLO
     * has.
     */
    it("treat a hostile pick as a literal name, never as a pattern", () => {
      const config: DashboardViewConfig = storedConfig();
      const component: DashboardBaseComponent = componentsOfType(
        config,
        DashboardComponentType.Slo,
      )[0] as DashboardBaseComponent;
      const hostile: string = "' OR 1=1 --%";

      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        config,
        component,
        requestedVariables: selectionOf(config, hostile),
      });

      expect(policy.query["name"]).toBe(hostile);
      expect(policy.query["name"]).not.toBeInstanceOf(Includes);
    });

    /*
     * Only the STORED variable's selection counts. A selection for a variable
     * id this dashboard never stored, or a multi-value array sent against the
     * stored single-select, is dropped — leaving the widget unpicked.
     */
    it("ignore selections the stored variable could not have produced", () => {
      const config: DashboardViewConfig = storedConfig();
      const component: DashboardBaseComponent = componentsOfType(
        config,
        DashboardComponentType.Slo,
      )[0] as DashboardBaseComponent;

      for (const requestedVariables of [
        [{ id: ObjectID.generate().toString(), selectedValue: PICKED_SLO }],
        [
          {
            id: sloVariableOf(config).id,
            selectedValues: [PICKED_SLO, "Search API"],
          },
        ],
      ] as Array<Array<JSONObject>>) {
        expect(() => {
          return buildPolicy({ config, component, requestedVariables });
        }).toThrow(PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE);
      }
    });

    it("refuse an oversized pick before it can become a query parameter", () => {
      const config: DashboardViewConfig = storedConfig();
      const component: DashboardBaseComponent = componentsOfType(
        config,
        DashboardComponentType.Slo,
      )[0] as DashboardBaseComponent;

      expect(() => {
        return buildPolicy({
          config,
          component,
          requestedVariables: selectionOf(config, "x".repeat(2000)),
        });
      }).toThrow(BadDataException);
    });

    it("chart history for the picked SLO by name, and only for Chart widgets", () => {
      const config: DashboardViewConfig = storedConfig();
      const requestedVariables: Array<JSONObject> = selectionOf(
        config,
        PICKED_SLO,
      );

      for (const component of componentsOfType(
        config,
        DashboardComponentType.Slo,
      )) {
        const isChart: boolean =
          argumentsOf(component)["displayType"] === SloWidgetDisplayType.Chart;

        if (!isChart) {
          // A tile publishes current numbers, never 400 days of history.
          expect(() => {
            return buildHistoryPolicy({
              config,
              component,
              requestedVariables,
            });
          }).toThrow(BadDataException);
          continue;
        }

        const policy: PublicDashboardSloHistoryPolicyResult =
          buildHistoryPolicy({ config, component, requestedVariables });

        expect(policy.target).toEqual({
          kind: PublicDashboardSloWidgetTargetKind.Selected,
          serviceLevelObjectiveName: PICKED_SLO,
        });
        expect(policy.limit).toBe(LIMIT_PER_PROJECT);
      }
    });

    it("keep every other ServiceLevelObjective column behind the session", () => {
      const config: DashboardViewConfig = storedConfig();

      expectSelectPublishesNothingSensitive({
        model: new ServiceLevelObjective(),
        select: buildPolicy({
          config,
          component: componentsOfType(
            config,
            DashboardComponentType.Slo,
          )[0] as DashboardBaseComponent,
          requestedVariables: selectionOf(config, PICKED_SLO),
        }).select,
        sensitiveColumns: SENSITIVE_SLO_COLUMNS,
      });
    });
  });

  describe("the SLO List", () => {
    function sloList(config: DashboardViewConfig): DashboardBaseComponent {
      const lists: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.SloList,
      );

      expect(lists).toHaveLength(1);
      return lists[0] as DashboardBaseComponent;
    }

    /*
     * The fleet as published: every ACTIVE objective in the dashboard's
     * project, least budget first, capped by the widget's own stored maxRows.
     * Archived objectives are not evaluated and never reach a public page.
     */
    it("lists every active SLO in the dashboard's project and nothing the request names", () => {
      const config: DashboardViewConfig = storedConfig();
      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        config,
        component: sloList(config),
        requestedQuery: HOSTILE_QUERY,
      });

      expect(policy.resourceType).toBe("slo-list");
      expect(routeQuery(policy)).toEqual({
        isArchived: false,
        projectId: DASHBOARD_PROJECT_ID,
      });
      expect(policy.sort).toEqual({
        errorBudgetRemainingPercentage: SortOrder.Ascending,
        name: SortOrder.Ascending,
      });
      expect(Object.keys(policy.sort)).toEqual([
        "errorBudgetRemainingPercentage",
        "name",
      ]);
      expect(policy.limit).toBe(SLO_LIST_DEFAULT_MAX_ROWS);
      expect(policy.limit).toBeLessThanOrEqual(LIMIT_PER_PROJECT);
    });

    it("narrows to the picked SLO's row, still active only", () => {
      const config: DashboardViewConfig = storedConfig();

      expect(
        routeQuery(
          buildPolicy({
            config,
            component: sloList(config),
            requestedVariables: selectionOf(config, PICKED_SLO),
          }),
        ),
      ).toEqual({
        isArchived: false,
        name: PICKED_SLO,
        projectId: DASHBOARD_PROJECT_ID,
      });
    });

    it("publishes the same seven display fields as the SLO widget, and nothing else", () => {
      const config: DashboardViewConfig = storedConfig();
      const select: JSONObject = buildPolicy({
        config,
        component: sloList(config),
      }).select;

      expect(select).toEqual(PUBLISHED_SLO_SELECT);
      expectSelectPublishesNothingSensitive({
        model: new ServiceLevelObjective(),
        select,
        sensitiveColumns: SENSITIVE_SLO_COLUMNS,
      });
    });

    it("applies a stored status filter, and refuses one that is not a real status", () => {
      const config: DashboardViewConfig = storedConfig();
      const list: DashboardBaseComponent = sloList(config);

      const filtered: PublicDashboardResourceListPolicyResult = buildPolicy({
        config,
        component: {
          ...list,
          arguments: {
            ...argumentsOf(list),
            sloStatuses: [SloStatus.AtRisk, SloStatus.BudgetExhausted],
          },
        } as DashboardBaseComponent,
      });

      expect(filtered.query["sloStatus"]).toBeInstanceOf(Includes);
      expect((filtered.query["sloStatus"] as Includes).values).toEqual([
        SloStatus.AtRisk,
        SloStatus.BudgetExhausted,
      ]);

      for (const brokenStatuses of [["Everything"], "At Risk", [3]]) {
        expect(() => {
          return buildPolicy({
            config,
            component: {
              ...list,
              arguments: { ...argumentsOf(list), sloStatuses: brokenStatuses },
            } as DashboardBaseComponent,
          });
        }).toThrow(BadDataException);
      }
    });

    it("takes its row cap from the stored widget, clamped to the project ceiling", () => {
      const config: DashboardViewConfig = storedConfig();
      const list: DashboardBaseComponent = sloList(config);

      for (const [maxRows, expected] of [
        [10, 10],
        [LIMIT_PER_PROJECT * 10, LIMIT_PER_PROJECT],
        [0, SLO_LIST_DEFAULT_MAX_ROWS],
        [undefined, SLO_LIST_DEFAULT_MAX_ROWS],
      ] as Array<[number | undefined, number]>) {
        expect(
          buildPolicy({
            config,
            component: {
              ...list,
              arguments: { ...argumentsOf(list), maxRows },
            } as DashboardBaseComponent,
            requestedQuery: { limit: 100000 },
          }).limit,
        ).toBe(expected);
      }
    });
  });
});
