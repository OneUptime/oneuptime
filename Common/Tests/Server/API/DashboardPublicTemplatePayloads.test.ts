import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import MetricService from "../../../Server/Services/MetricService";
import TelemetryAttributeService from "../../../Server/Services/TelemetryAttributeService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const ATTRIBUTE_VALUES_ROUTE: string =
  "/dashboard/attribute-values/:dashboardId";
const METRICS_AGGREGATE_ROUTE: string =
  "/dashboard/metrics-aggregate/:dashboardId";

/*
 * Every template a user can actually create a dashboard from. Blank has no
 * config at all, so it is excluded rather than special-cased.
 */
const TEMPLATE_TYPES: Array<DashboardTemplateType> = Object.values(
  DashboardTemplateType,
).filter((type: DashboardTemplateType) => {
  return type !== DashboardTemplateType.Blank;
});

/*
 * Small, deliberately independent readers over a stored config. These
 * duplicate a little of what the server's allowlist walkers do on purpose:
 * if the walkers stop reaching a shape the templates actually ship, these
 * still find the key and the request they build starts failing.
 */
type CollectFunction = (config: unknown) => Array<string>;

const collectVariableAttributeKeys: CollectFunction = (
  config: unknown,
): Array<string> => {
  const variables: unknown =
    config && typeof config === "object"
      ? (config as Record<string, unknown>)["variables"]
      : undefined;

  if (!Array.isArray(variables)) {
    return [];
  }

  return variables
    .filter((variable: unknown) => {
      return (
        variable &&
        typeof variable === "object" &&
        (variable as Record<string, unknown>)["type"] ===
          DashboardVariableType.TelemetryAttribute &&
        typeof (variable as Record<string, unknown>)["attributeKey"] ===
          "string"
      );
    })
    .map((variable: unknown) => {
      return (variable as Record<string, unknown>)["attributeKey"] as string;
    });
};

type WalkCollectFunction = (config: unknown, field: string) => Array<string>;

const collectStringsUnderKey: WalkCollectFunction = (
  config: unknown,
  field: string,
): Array<string> => {
  const found: Array<string> = [];

  const walk: (node: unknown) => void = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }

    const obj: Record<string, unknown> = node as Record<string, unknown>;
    const value: unknown = obj[field];

    if (typeof value === "string" && value.length > 0) {
      found.push(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.length > 0) {
          found.push(item);
        }
      }
    }

    for (const key of Object.keys(obj)) {
      walk(obj[key]);
    }
  };

  walk(config);

  return Array.from(new Set(found));
};

describe("public dashboard allowlists vs the shipped templates", () => {
  let dashboardId: ObjectID;
  let projectId: ObjectID;
  let dashboard: Dashboard;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  type LoadTemplateFunction = (type: DashboardTemplateType) => JSONObject;

  /*
   * Round-trip the template through JSON the way the JSONB column does, so
   * ObjectID instances become strings and the handler sees exactly the shape
   * a real stored dashboard has.
   */
  const loadTemplate: LoadTemplateFunction = (
    type: DashboardTemplateType,
  ): JSONObject => {
    const config: DashboardViewConfig | null = getTemplateConfig(type);

    expect(config).not.toBeNull();

    return JSON.parse(JSON.stringify(config)) as JSONObject;
  };

  type CallAttributeValuesFunction = (attributeKey: string) => Promise<void>;

  const callAttributeValues: CallAttributeValuesFunction = async (
    attributeKey: string,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: { dashboardId: dashboardId.toString() },
      body: { attributeKey: attributeKey },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", ATTRIBUTE_VALUES_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  type CallAggregateFunction = (overrides: JSONObject) => Promise<void>;

  const callAggregate: CallAggregateFunction = async (
    overrides: JSONObject,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: { dashboardId: dashboardId.toString() },
      body: {
        aggregateBy: {
          aggregateColumnName: "value",
          aggregationType: "Avg",
          aggregationTimestampColumnName: "time",
          startTimestamp: "2026-01-01T00:00:00.000Z",
          endTimestamp: "2026-01-02T00:00:00.000Z",
          limit: 100,
          skip: 0,
          ...overrides,
        },
      },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", METRICS_AGGREGATE_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  type ExpectNoErrorFunction = (context: string) => void;

  const expectNoError: ExpectNoErrorFunction = (context: string): void => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    if (calls.length > 0) {
      const error: unknown = calls[0]![0];

      throw new Error(
        `${context} was refused: ${(error as Error)?.message || String(error)}`,
      );
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();
    projectId = ObjectID.generate();

    dashboard = new Dashboard();
    dashboard.id = dashboardId;
    dashboard.projectId = projectId;
    dashboard.isPublicDashboard = true;
    dashboard.enableMasterPassword = false;

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);
    jest
      .spyOn(TelemetryAttributeService, "fetchAttributeValues")
      .mockResolvedValue([]);
    jest.spyOn(MetricService, "aggregateBy").mockResolvedValue({ data: [] });

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The suite above is only meaningful if the templates actually carry the
   * shapes it replays. Pin that here so a template refactor that drops all
   * variables (or all metrics) turns this red instead of quietly making
   * every case above pass on an empty loop.
   */
  describe("fixture invariants", () => {
    it("still ships templates with telemetry-attribute variables and charted metrics", async () => {
      const kubernetes: JSONObject = loadTemplate(
        DashboardTemplateType.Kubernetes,
      );

      expect(
        collectVariableAttributeKeys(kubernetes).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        collectStringsUnderKey(kubernetes, "metricName").length,
      ).toBeGreaterThanOrEqual(1);

      const totalVariableKeys: number = TEMPLATE_TYPES.reduce(
        (total: number, type: DashboardTemplateType): number => {
          return (
            total + collectVariableAttributeKeys(loadTemplate(type)).length
          );
        },
        0,
      );

      const totalGroupByKeys: number = TEMPLATE_TYPES.reduce(
        (total: number, type: DashboardTemplateType): number => {
          return (
            total +
            collectStringsUnderKey(loadTemplate(type), "groupByAttributeKeys")
              .length
          );
        },
        0,
      );

      expect(totalVariableKeys).toBeGreaterThanOrEqual(1);
      expect(totalGroupByKeys).toBeGreaterThanOrEqual(1);
    });
  });

  describe("every shipped template still works when published", () => {
    it.each(TEMPLATE_TYPES)(
      "serves the %s template's own variables, metrics and groupings",
      async (templateType: DashboardTemplateType) => {
        const config: JSONObject = loadTemplate(templateType);

        dashboard.dashboardViewConfig =
          config as unknown as DashboardViewConfig;

        const variableKeys: Array<string> =
          collectVariableAttributeKeys(config);
        const metricNames: Array<string> = collectStringsUnderKey(
          config,
          "metricName",
        );
        const groupByKeys: Array<string> = collectStringsUnderKey(
          config,
          "groupByAttributeKeys",
        );

        let requests: number = 0;

        // 1. Every variable dropdown must still be able to load its options.
        for (const attributeKey of variableKeys) {
          jest.clearAllMocks();

          await callAttributeValues(attributeKey);

          expectNoError(`${templateType} variable "${attributeKey}"`);
          expect(
            TelemetryAttributeService.fetchAttributeValues,
          ).toHaveBeenCalledTimes(1);
          requests++;
        }

        // 2. Every charted metric must still aggregate.
        for (const metricName of metricNames) {
          jest.clearAllMocks();

          await callAggregate({ query: { name: metricName } });

          expectNoError(`${templateType} metric "${metricName}"`);
          expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
          requests++;
        }

        /*
         * 3. Every configured grouping must still be accepted, on a metric
         *    the same dashboard charts.
         */
        if (metricNames.length > 0) {
          for (const groupByKey of groupByKeys) {
            jest.clearAllMocks();

            await callAggregate({
              query: { name: metricNames[0] as string },
              groupByAttributeKeys: [groupByKey],
            });

            expectNoError(`${templateType} grouping "${groupByKey}"`);
            expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
            requests++;
          }

          /*
           * 4. The interpolation case: once a viewer picks a value from a
           *    template variable, the client sends it as an attribute filter
           *    on a key the widgets never stored themselves.
           */
          for (const attributeKey of variableKeys) {
            jest.clearAllMocks();

            await callAggregate({
              query: {
                name: metricNames[0] as string,
                attributes: { [attributeKey]: "selected-value" },
              },
            });

            expectNoError(
              `${templateType} interpolated filter "${attributeKey}"`,
            );
            expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
            requests++;
          }
        }

        // The template must actually have exercised something.
        expect(requests).toBeGreaterThan(0);
      },
    );
  });

  describe("templates do not become readers for anything else", () => {
    it("refuses a sensitive attribute key on every template", async () => {
      for (const templateType of TEMPLATE_TYPES) {
        const config: JSONObject = loadTemplate(templateType);

        dashboard.dashboardViewConfig =
          config as unknown as DashboardViewConfig;

        for (const attributeKey of ["user.email", "db.statement"]) {
          jest.clearAllMocks();

          await callAttributeValues(attributeKey);

          expect(nextFunction).toHaveBeenCalled();
          expect(
            TelemetryAttributeService.fetchAttributeValues,
          ).not.toHaveBeenCalled();
        }
      }
    });

    it("refuses an uncharted metric on every template", async () => {
      for (const templateType of TEMPLATE_TYPES) {
        const config: JSONObject = loadTemplate(templateType);

        dashboard.dashboardViewConfig =
          config as unknown as DashboardViewConfig;

        jest.clearAllMocks();

        await callAggregate({ query: { name: "billing.revenue.total" } });

        expect(nextFunction).toHaveBeenCalled();
        expect(MetricService.aggregateBy).not.toHaveBeenCalled();
      }
    });

    it("refuses an unconfigured grouping on every template that charts a metric", async () => {
      for (const templateType of TEMPLATE_TYPES) {
        const config: JSONObject = loadTemplate(templateType);
        const metricNames: Array<string> = collectStringsUnderKey(
          config,
          "metricName",
        );

        if (metricNames.length === 0) {
          continue;
        }

        dashboard.dashboardViewConfig =
          config as unknown as DashboardViewConfig;

        jest.clearAllMocks();

        await callAggregate({
          query: { name: metricNames[0] as string },
          groupByAttributeKeys: ["enduser.id"],
        });

        expect(nextFunction).toHaveBeenCalled();
        expect(MetricService.aggregateBy).not.toHaveBeenCalled();
      }
    });

    it("refuses an attribute filter on a key no widget or variable uses", async () => {
      for (const templateType of TEMPLATE_TYPES) {
        const config: JSONObject = loadTemplate(templateType);
        const metricNames: Array<string> = collectStringsUnderKey(
          config,
          "metricName",
        );

        if (metricNames.length === 0) {
          continue;
        }

        dashboard.dashboardViewConfig =
          config as unknown as DashboardViewConfig;

        jest.clearAllMocks();

        await callAggregate({
          query: {
            name: metricNames[0] as string,
            attributes: { "user.email": { _type: "StartsWith", value: "a" } },
          },
        });

        expect(nextFunction).toHaveBeenCalled();
        expect(MetricService.aggregateBy).not.toHaveBeenCalled();
      }
    });
  });

  describe("cross-route isolation", () => {
    /*
     * The two routes read two different parts of the config. A key that
     * unlocks one must not unlock the other.
     */
    const CHART_METRIC: string = "system.cpu.utilization";
    const VARIABLE_KEY: string = "resource.k8s.cluster.name";
    const GROUP_BY_KEY: string = "resource.host.name";

    type SetMixedDashboardFunction = () => void;

    const setMixedDashboard: SetMixedDashboardFunction = (): void => {
      dashboard.dashboardViewConfig = {
        _type: "DashboardViewConfig",
        heightInDashboardUnits: 24,
        variables: [
          {
            id: ObjectID.generate().toString(),
            name: "cluster",
            label: "Cluster",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: VARIABLE_KEY,
          },
        ],
        components: [
          {
            componentId: ObjectID.generate().toString(),
            componentType: "Chart",
            arguments: {
              metricQueryConfigs: [
                {
                  metricQueryData: {
                    filterData: { metricName: CHART_METRIC },
                    groupByAttributeKeys: [GROUP_BY_KEY],
                  },
                },
              ],
            },
          },
        ],
      } as unknown as DashboardViewConfig;
    };

    it("does not let a chart's group-by key become a readable variable attribute", async () => {
      setMixedDashboard();

      await callAttributeValues(GROUP_BY_KEY);

      expect(nextFunction).toHaveBeenCalled();
      expect(
        TelemetryAttributeService.fetchAttributeValues,
      ).not.toHaveBeenCalled();
    });

    it("does not let a variable's attribute key become a group-by dimension", async () => {
      setMixedDashboard();

      await callAggregate({
        query: { name: CHART_METRIC },
        groupByAttributeKeys: [VARIABLE_KEY],
      });

      expect(nextFunction).toHaveBeenCalled();
      expect(MetricService.aggregateBy).not.toHaveBeenCalled();
    });

    it("serves the variable key on attribute-values (positive control)", async () => {
      setMixedDashboard();

      await callAttributeValues(VARIABLE_KEY);

      expectNoError("variable key");
      expect(
        TelemetryAttributeService.fetchAttributeValues,
      ).toHaveBeenCalledTimes(1);
    });

    it("serves the chart's group-by key on metrics-aggregate (positive control)", async () => {
      setMixedDashboard();

      await callAggregate({
        query: { name: CHART_METRIC },
        groupByAttributeKeys: [GROUP_BY_KEY],
      });

      expectNoError("chart group-by key");
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });
  });
});
