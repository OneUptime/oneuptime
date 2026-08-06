import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import TelemetryAttributeService from "../../../Server/Services/TelemetryAttributeService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
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

const NOT_ON_DASHBOARD_MESSAGE: string =
  "This attribute is not part of this dashboard.";

/*
 * The attribute keys the advisory's proof of concept reaches for: none of
 * them belongs to a dashboard variable, and every one of them is high-value
 * telemetry an anonymous viewer must never be able to enumerate.
 */
const SENSITIVE_KEYS: Array<string> = [
  "http.url",
  "db.statement",
  "enduser.id",
  "user.email",
  "http.request.header.authorization",
  "k8s.namespace.name",
];

const ALL_TELEMETRY_TYPES: Array<TelemetryType> = [
  TelemetryType.Metric,
  TelemetryType.Trace,
  TelemetryType.Log,
  TelemetryType.Exception,
  TelemetryType.Profile,
];

describe("DashboardAPI public attribute-values", () => {
  let dashboardId: ObjectID;
  let projectId: ObjectID;
  let dashboard: Dashboard;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  type VariableSpec = {
    type?: DashboardVariableType | string | undefined;
    attributeKey?: unknown;
  };

  type BuildViewConfigFunction = (data: {
    variables?: Array<VariableSpec> | undefined;
    componentTypes?: Array<string> | undefined;
  }) => DashboardViewConfig;

  const buildViewConfig: BuildViewConfigFunction = (data: {
    variables?: Array<VariableSpec> | undefined;
    componentTypes?: Array<string> | undefined;
  }): DashboardViewConfig => {
    return {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: (data.componentTypes || []).map(
        (componentType: string, index: number): JSONObject => {
          return {
            _type: "DashboardComponent",
            componentId: ObjectID.generate().toString(),
            componentType: componentType,
            topInDashboardUnits: index,
            leftInDashboardUnits: 0,
            widthInDashboardUnits: 12,
            heightInDashboardUnits: 6,
            arguments: {},
          };
        },
      ),
      variables: (data.variables || []).map(
        (variable: VariableSpec, index: number): Record<string, unknown> => {
          return {
            id: ObjectID.generate().toString(),
            name: `variable-${index}`,
            label: `Variable ${index}`,
            type: variable.type,
            attributeKey: variable.attributeKey,
          };
        },
      ),
    } as unknown as DashboardViewConfig;
  };

  type SetAttributeVariablesFunction = (attributeKeys: Array<string>) => void;

  /*
   * Put one telemetry-attribute variable on the dashboard per key — the
   * shape the public variable selector actually renders.
   */
  const setAttributeVariables: SetAttributeVariablesFunction = (
    attributeKeys: Array<string>,
  ): void => {
    dashboard.dashboardViewConfig = buildViewConfig({
      componentTypes: [DashboardComponentType.Chart],
      variables: attributeKeys.map((attributeKey: string): VariableSpec => {
        return {
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: attributeKey,
        };
      }),
    });
  };

  type CallRouteFunction = (body?: JSONObject) => Promise<void>;

  const callRoute: CallRouteFunction = async (
    body?: JSONObject,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        dashboardId: dashboardId.toString(),
      },
      body: body === undefined ? {} : body,
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

  type GetFetchArgsFunction = () => JSONObject;

  const getFetchArgs: GetFetchArgsFunction = (): JSONObject => {
    const calls: Array<Array<unknown>> = (
      TelemetryAttributeService.fetchAttributeValues as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);

    return calls[0]![0] as JSONObject;
  };

  type GetThrownErrorFunction = () => unknown;

  const getThrownError: GetThrownErrorFunction = (): unknown => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);

    return calls[0]![0];
  };

  type ExpectNothingReadFunction = () => void;

  const expectNothingRead: ExpectNothingReadFunction = (): void => {
    expect(
      TelemetryAttributeService.fetchAttributeValues,
    ).not.toHaveBeenCalled();
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
    setAttributeVariables([]);

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);

    jest
      .spyOn(TelemetryAttributeService, "fetchAttributeValues")
      .mockResolvedValue([]);

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

  describe("attribute allowlist (GHSA-w332-x78m-vf3v)", () => {
    it("refuses to read a project's log attributes from a dashboard that has no variables", async () => {
      /*
       * The advisory's proof of concept verbatim: a public dashboard whose
       * only widget is a text box, used as a SELECT DISTINCT over every log
       * in the owning project.
       */
      dashboard.dashboardViewConfig = buildViewConfig({
        componentTypes: [DashboardComponentType.Text],
      });

      await callRoute({
        attributeKey: "http.url",
        telemetryType: TelemetryType.Log,
      });

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        NOT_ON_DASHBOARD_MESSAGE,
      );
      expectNothingRead();
    });

    it("refuses every sensitive key the advisory names, across every telemetry type", async () => {
      setAttributeVariables(["k8s.cluster.name"]);

      for (const attributeKey of SENSITIVE_KEYS) {
        for (const telemetryType of ALL_TELEMETRY_TYPES) {
          jest.clearAllMocks();

          await callRoute({
            attributeKey: attributeKey,
            telemetryType: telemetryType,
          });

          const error: unknown = getThrownError();

          expect(error).toBeInstanceOf(BadDataException);
          expect((error as BadDataException).message).toBe(
            NOT_ON_DASHBOARD_MESSAGE,
          );
          expectNothingRead();
        }
      }
    });

    it("serves the key the dashboard's own variable binds to", async () => {
      setAttributeVariables(["k8s.cluster.name"]);

      await callRoute({ attributeKey: "k8s.cluster.name" });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getFetchArgs()["attributeKey"]).toBe("k8s.cluster.name");
    });

    it("serves every key across several variables, and nothing beside them", async () => {
      const configuredKeys: Array<string> = [
        "resource.k8s.cluster.name",
        "resource.k8s.namespace.name",
        "resource.service.name",
      ];

      setAttributeVariables(configuredKeys);

      for (const attributeKey of configuredKeys) {
        jest.clearAllMocks();

        await callRoute({ attributeKey: attributeKey });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(getFetchArgs()["attributeKey"]).toBe(attributeKey);
      }

      jest.clearAllMocks();

      // A near-miss on a configured key is still a miss.
      await callRoute({ attributeKey: "resource.service.namespace" });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("refuses a key belonging to a different public dashboard's variables", async () => {
      setAttributeVariables(["tenant.a.key"]);

      await callRoute({ attributeKey: "tenant.b.key" });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("does not let a non-telemetry variable unlock an attribute key", async () => {
      /*
       * Only `Telemetry Attribute` variables drive an attribute lookup. A
       * custom-list / query / text variable that happens to carry an
       * attributeKey field must not widen the allowlist.
       */
      const otherTypes: Array<DashboardVariableType> = [
        DashboardVariableType.CustomList,
        DashboardVariableType.Query,
        DashboardVariableType.TextInput,
      ];

      for (const variableType of otherTypes) {
        jest.clearAllMocks();

        dashboard.dashboardViewConfig = buildViewConfig({
          variables: [
            {
              type: variableType,
              attributeKey: "user.email",
            },
          ],
        });

        await callRoute({ attributeKey: "user.email" });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });

    it("ignores a variable whose attribute key is missing or not a string", async () => {
      const badKeys: Array<unknown> = [undefined, null, "", "   ", 42, {}, []];

      for (const badKey of badKeys) {
        jest.clearAllMocks();

        dashboard.dashboardViewConfig = buildViewConfig({
          variables: [
            {
              type: DashboardVariableType.TelemetryAttribute,
              attributeKey: badKey,
            },
          ],
        });

        await callRoute({ attributeKey: "http.url" });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });

    it("refuses everything when the stored view config is missing or malformed", async () => {
      const malformedConfigs: Array<unknown> = [
        null,
        undefined,
        "not-an-object",
        42,
        {},
        { variables: null },
        { variables: "not-an-array" },
        { variables: [null, 7, "variable"] },
        { variables: [{ type: DashboardVariableType.TelemetryAttribute }] },
        { components: [{ componentType: DashboardComponentType.Chart }] },
      ];

      for (const config of malformedConfigs) {
        jest.clearAllMocks();
        dashboard.dashboardViewConfig = config as DashboardViewConfig;

        await callRoute({ attributeKey: "http.url" });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });

    it("matches a configured key regardless of surrounding whitespace", async () => {
      dashboard.dashboardViewConfig = buildViewConfig({
        variables: [
          {
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "  host.name  ",
          },
        ],
      });

      await callRoute({ attributeKey: " host.name " });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getFetchArgs()["attributeKey"]).toBe("host.name");
    });

    it("does not treat a prototype key as configured", async () => {
      setAttributeVariables(["host.name"]);

      for (const attributeKey of [
        "__proto__",
        "constructor",
        "toString",
        "hasOwnProperty",
      ]) {
        jest.clearAllMocks();

        await callRoute({ attributeKey: attributeKey });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });

    it("rejects a missing, blank or non-string attribute key before any lookup", async () => {
      setAttributeVariables(["host.name"]);

      const badRequests: Array<JSONObject> = [
        {},
        { attributeKey: "" },
        { attributeKey: "   " },
        { attributeKey: 42 } as unknown as JSONObject,
        { attributeKey: null } as unknown as JSONObject,
        { attributeKey: ["host.name"] } as unknown as JSONObject,
        { attributeKey: { toString: "host.name" } } as unknown as JSONObject,
      ];

      for (const body of badRequests) {
        jest.clearAllMocks();

        await callRoute(body);

        const error: unknown = getThrownError();

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as BadDataException).message).toBe(
          "attributeKey is required.",
        );
        expectNothingRead();
      }
    });
  });

  describe("telemetry type", () => {
    it("passes each valid telemetry type through for an allowlisted key", async () => {
      setAttributeVariables(["host.name"]);

      for (const telemetryType of ALL_TELEMETRY_TYPES) {
        jest.clearAllMocks();

        await callRoute({
          attributeKey: "host.name",
          telemetryType: telemetryType,
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(getFetchArgs()["telemetryType"]).toBe(telemetryType);
      }
    });

    it("falls back to Metric for a missing or unrecognised telemetry type", async () => {
      setAttributeVariables(["host.name"]);

      const badTypes: Array<unknown> = [
        undefined,
        "",
        "Logs",
        "metric",
        "DROP TABLE",
      ];

      for (const telemetryType of badTypes) {
        jest.clearAllMocks();

        await callRoute({
          attributeKey: "host.name",
          telemetryType: telemetryType as string,
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(getFetchArgs()["telemetryType"]).toBe(TelemetryType.Metric);
      }
    });
  });

  describe("authorization", () => {
    it("rejects a dashboard that is not public before reading anything", async () => {
      dashboard.isPublicDashboard = false;
      setAttributeVariables(["host.name"]);

      await callRoute({ attributeKey: "host.name" });

      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingRead();
    });

    /*
     * A missing dashboard never reaches the attribute lookup: hasReadAccess
     * fails closed first, so the viewer is told they have no access rather
     * than whether the id exists.
     */
    it("rejects a dashboard that cannot be found", async () => {
      jest.spyOn(DashboardService, "findOneById").mockResolvedValue(null);

      await callRoute({ attributeKey: "host.name" });

      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingRead();
    });

    it("rejects a dashboard with no project", async () => {
      setAttributeVariables(["host.name"]);
      delete dashboard.projectId;

      await callRoute({ attributeKey: "host.name" });

      expect(getThrownError()).toBeInstanceOf(NotFoundException);
      expectNothingRead();
    });
  });

  describe("project scoping", () => {
    it("pins the lookup to the dashboard's own project", async () => {
      setAttributeVariables(["host.name"]);

      await callRoute({ attributeKey: "host.name" });

      expect(getFetchArgs()["projectId"]).toBe(projectId);
    });

    it("ignores a client-supplied projectId pointing at another tenant", async () => {
      const otherProjectId: ObjectID = ObjectID.generate();

      setAttributeVariables(["host.name"]);

      await callRoute({
        attributeKey: "host.name",
        projectId: otherProjectId.toString(),
      });

      const fetchArgs: JSONObject = getFetchArgs();

      expect(fetchArgs["projectId"]).toBe(projectId);
      expect(fetchArgs["projectId"]).not.toBe(otherProjectId.toString());
    });

    it("never forwards a client-supplied search text or metric scope", async () => {
      setAttributeVariables(["host.name"]);

      await callRoute({
        attributeKey: "host.name",
        searchText: "%",
        metricName: "some.other.metric",
      });

      const fetchArgs: JSONObject = getFetchArgs();

      expect(fetchArgs["searchText"]).toBeUndefined();
      expect(fetchArgs["metricName"]).toBeUndefined();
    });
  });
});
