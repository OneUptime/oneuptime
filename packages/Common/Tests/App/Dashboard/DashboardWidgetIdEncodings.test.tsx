import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #6328: a dashboard's id settings can be stored as an ObjectID's
 * JSON, `{"_type": "ObjectID", "value": "<id>"}`, by the API, Terraform, a
 * workflow or a script (#4571). Every board revived that into an ObjectID,
 * and two widgets broke on it when signed in:
 *
 *  - the SLO widget trimmed its SLO's id and fell into its error boundary;
 *  - the incident and alert lists compared their states with the states a
 *    state filter reads, as text, and listed nothing.
 *
 * Each widget is rendered here with its ids in every encoding - text, an
 * ObjectID's JSON and a revived ObjectID - both as the board draws it (the
 * stored widget read by StoredDashboardViewConfig.read) and handed its
 * settings as they are. The reads it sends are asserted, and that it draws.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const getIncidentStatesMock: MockFunction = getJestMockFunction();
const getAlertStatesMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<any>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getIncidentStates: (...args: Array<any>) => {
          return getIncidentStatesMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getAlertStates: (...args: Array<any>) => {
        return getAlertStatesMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <span>{props.children}</span>;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: () => {
        return {
          toString: () => {
            return "/resource";
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

import DashboardSloComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloComponent";
import DashboardIncidentListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardIncidentListComponent";
import DashboardAlertListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardAlertListComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { SloWidgetDisplayType } from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import TimeRange from "../../../Types/Time/TimeRange";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import PublicDashboardResourceListPolicy from "../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";

const COMPONENT_ID: string = "11111111-1111-4111-8111-111111111111";
const SLO_ID: string = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

// The project's states: created and acknowledged are open, resolved is not.
const CREATED_STATE_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const ACKNOWLEDGED_STATE_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const RESOLVED_STATE_ID: string = "aaaaaaaa-0000-4000-8000-000000000003";

const STATES: Array<JSONObject> = [
  { _id: CREATED_STATE_ID, order: 1, isCreatedState: true },
  { _id: ACKNOWLEDGED_STATE_ID, order: 2, isAcknowledgedState: true },
  { _id: RESOLVED_STATE_ID, order: 3, isResolvedState: true },
];

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

type Encoding = "text" | "an ObjectID's JSON" | "a revived ObjectID";

const ENCODINGS: Array<Encoding> = [
  "text",
  "an ObjectID's JSON",
  "a revived ObjectID",
];

const encode: (id: string, encoding: Encoding) => unknown = (
  id: string,
  encoding: Encoding,
): unknown => {
  if (encoding === "an ObjectID's JSON") {
    return { _type: "ObjectID", value: id };
  }

  if (encoding === "a revived ObjectID") {
    return new ObjectID(id);
  }

  return id;
};

/*
 * How a widget gets its settings: as the board draws it - the stored
 * widget, as JSON, read by StoredDashboardViewConfig.read - or handed them
 * as they are.
 */
type Path = "as the board draws it" | "handed its settings as they are";

const PATHS: Array<Path> = [
  "as the board draws it",
  "handed its settings as they are",
];

const widgetFor: (
  componentType: DashboardComponentType,
  settings: JSONObject,
  pathTaken: Path,
) => DashboardBaseComponent = (
  componentType: DashboardComponentType,
  settings: JSONObject,
  pathTaken: Path,
): DashboardBaseComponent => {
  const stored: JSONObject = {
    componentId: COMPONENT_ID,
    componentType: componentType,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    arguments: settings,
  };

  if (pathTaken === "as the board draws it") {
    // Stored as JSON: a revived ObjectID is written as its JSON.
    return StoredDashboardViewConfig.read({
      components: [JSON.parse(JSON.stringify(stored))],
    }).components[0]!;
  }

  return {
    ...(stored as unknown as DashboardBaseComponent),
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID(COMPONENT_ID),
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
  };
};

const baseProps: () => DashboardBaseComponentProps =
  (): DashboardBaseComponentProps => {
    return {
      componentId: new ObjectID(COMPONENT_ID),
      key: COMPONENT_ID,
      isEditMode: false,
      isSelected: false,
      onComponentUpdate: (): void => {
        // The widgets never write back through this.
      },
      totalCurrentDashboardWidthInPx: 1200,
      dashboardCanvasTopInPx: 0,
      dashboardCanvasLeftInPx: 0,
      dashboardCanvasWidthInPx: 1200,
      dashboardCanvasHeightInPx: 800,
      dashboardComponentHeightInPx: 320,
      dashboardComponentWidthInPx: 480,
      dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
      dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
      metricTypes: [],
      refreshTick: 0,
      variables: [],
      dashboardId: "d0000000-0000-4000-8000-000000000001",
    };
  };

const buildSlo: () => ServiceLevelObjective = (): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.name = "Checkout availability";
  slo.targetPercentage = 99.9;
  slo.currentSliPercentage = 99.95;
  slo.errorBudgetRemainingPercentage = 42.5;
  slo.errorBudgetRemainingSeconds = 3600;
  slo.currentBurnRate = 1.25;
  slo.sloStatus = SloStatus.Healthy;
  return slo;
};

beforeEach((): void => {
  jest.clearAllMocks();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getItemMock.mockResolvedValue(buildSlo());
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 10 });
  aggregateMock.mockResolvedValue({ data: [] } as AggregatedResult);
  getIncidentStatesMock.mockResolvedValue(STATES);
  getAlertStatesMock.mockResolvedValue(STATES);
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("the SLO widget reads its SLO in every encoding (issue #6328)", () => {
  test.each(PATHS)(
    "signed in, %s: it reads that SLO and draws its numbers",
    async (pathTaken: Path) => {
      for (const encoding of ENCODINGS) {
        jest.clearAllMocks();
        getItemMock.mockResolvedValue(buildSlo());

        const { unmount } = render(
          <DashboardSloComponentElement
            {...baseProps()}
            component={
              widgetFor(
                DashboardComponentType.Slo,
                {
                  serviceLevelObjectiveId: encode(
                    SLO_ID,
                    encoding,
                  ) as JSONObject,
                  displayType: SloWidgetDisplayType.Tile,
                },
                pathTaken,
              ) as never
            }
          />,
        );

        expect(await screen.findByText("99.95%")).toBeInTheDocument();

        // The one read the widget makes signed in: that SLO, by its id.
        expect(getItemMock).toHaveBeenCalledTimes(1);
        const read: JSONObject = getItemMock.mock.calls[0]![0] as JSONObject;
        expect([encoding, String(read["id"])]).toEqual([encoding, SLO_ID]);

        unmount();
      }
    },
  );

  test("on a public dashboard, it asks the dashboard's own route for its SLO and draws it", async () => {
    const publicContext: PublicDashboardContext = {
      dashboardId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      apiUrl: {
        toString: (): string => {
          return "http://localhost/public-dashboard-api";
        },
      },
      postJSON: () => {
        return Promise.resolve({
          data: { data: [] },
        } as unknown as HTTPResponse<JSONObject>);
      },
      apiClient: {},
    } as unknown as PublicDashboardContext;

    for (const pathTaken of PATHS) {
      for (const encoding of ENCODINGS) {
        jest.clearAllMocks();
        setPublicDashboardContext(publicContext);
        getCurrentProjectIdMock.mockReturnValue(null);
        getListMock.mockResolvedValue({
          data: [buildSlo()],
          count: 1,
          skip: 0,
          limit: 1,
        });

        const { unmount } = render(
          <DashboardSloComponentElement
            {...baseProps()}
            component={
              widgetFor(
                DashboardComponentType.Slo,
                {
                  serviceLevelObjectiveId: encode(
                    SLO_ID,
                    encoding,
                  ) as JSONObject,
                  displayType: SloWidgetDisplayType.Tile,
                },
                pathTaken,
              ) as never
            }
          />,
        );

        expect(await screen.findByText("99.95%")).toBeInTheDocument();

        // The widget's own componentId, which the route reads its SLO by.
        expect(getListMock).toHaveBeenCalledTimes(1);
        const read: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;
        expect([
          pathTaken,
          encoding,
          String((read["query"] as JSONObject)["_id"]),
        ]).toEqual([pathTaken, encoding, SLO_ID]);

        unmount();
      }
    }
  });

  test("a stored id that names no SLO says none is selected, and never follows a variable", async () => {
    for (const storedId of [42, [SLO_ID], { id: SLO_ID }]) {
      jest.clearAllMocks();

      const { unmount } = render(
        <DashboardSloComponentElement
          {...baseProps()}
          variables={[
            {
              id: "slo",
              name: "slo",
              type: "Telemetry Attribute",
              attributeKey: "sloName",
              selectedValue: "Checkout availability",
            } as never,
          ]}
          component={
            widgetFor(
              DashboardComponentType.Slo,
              {
                serviceLevelObjectiveId: storedId as unknown as JSONObject,
                serviceLevelObjectiveVariableId: "slo",
              },
              "handed its settings as they are",
            ) as never
          }
        />,
      );

      // Out of edit mode: what is missing, never a click (issue #7160).
      expect(await screen.findByText("No SLO picked yet.")).toBeInTheDocument();
      expect(getItemMock).not.toHaveBeenCalled();
      expect(getListMock).not.toHaveBeenCalled();

      unmount();
    }
  });
});

type ListCase = {
  name: string;
  componentType: DashboardComponentType;
  stateQueryKey: string;
  severityQueryKey: string;
  render: (component: DashboardBaseComponent) => React.ReactElement;
};

const LIST_CASES: Array<ListCase> = [
  {
    name: "incident list",
    componentType: DashboardComponentType.IncidentList,
    stateQueryKey: "currentIncidentStateId",
    severityQueryKey: "incidentSeverityId",
    render: (component: DashboardBaseComponent): React.ReactElement => {
      return (
        <DashboardIncidentListComponentElement
          {...baseProps()}
          component={component as never}
        />
      );
    },
  },
  {
    name: "alert list",
    componentType: DashboardComponentType.AlertList,
    stateQueryKey: "currentAlertStateId",
    severityQueryKey: "alertSeverityId",
    render: (component: DashboardBaseComponent): React.ReactElement => {
      return (
        <DashboardAlertListComponentElement
          {...baseProps()}
          component={component as never}
        />
      );
    },
  },
];

// The values of the query's filter on this column, as text.
const filterValues: (query: JSONObject, key: string) => Array<string> = (
  query: JSONObject,
  key: string,
): Array<string> => {
  const filter: unknown = query[key];

  expect(filter).toBeInstanceOf(Includes);

  return ((filter as Includes).values as Array<unknown>).map(
    (value: unknown): string => {
      return String(value);
    },
  );
};

describe("the incident and alert lists filter by their ids in every encoding (issue #6328)", () => {
  test.each(LIST_CASES)(
    "the $name keeps the states it names that a state filter reads, signed in",
    async (listCase: ListCase) => {
      for (const pathTaken of PATHS) {
        for (const encoding of ENCODINGS) {
          jest.clearAllMocks();
          getIncidentStatesMock.mockResolvedValue(STATES);
          getAlertStatesMock.mockResolvedValue(STATES);

          const { unmount } = render(
            listCase.render(
              widgetFor(
                listCase.componentType,
                {
                  title: "Open",
                  stateFilter: "unresolved",
                  stateIds: [
                    encode(CREATED_STATE_ID, encoding),
                    encode(RESOLVED_STATE_ID, encoding),
                  ] as Array<JSONObject>,
                  severityIds: [
                    encode(ACKNOWLEDGED_STATE_ID, encoding),
                  ] as Array<JSONObject>,
                },
                pathTaken,
              ),
            ),
          );

          await waitFor(() => {
            expect(getListMock).toHaveBeenCalledTimes(1);
          });

          const query: JSONObject = (
            getListMock.mock.calls[0]![0] as JSONObject
          )["query"] as JSONObject;

          // Of the two states it names, the one that is still open.
          expect([
            pathTaken,
            encoding,
            filterValues(query, listCase.stateQueryKey),
          ]).toEqual([pathTaken, encoding, [CREATED_STATE_ID]]);
          expect([
            pathTaken,
            encoding,
            filterValues(query, listCase.severityQueryKey),
          ]).toEqual([pathTaken, encoding, [ACKNOWLEDGED_STATE_ID]]);

          unmount();
        }
      }
    },
  );

  test.each(LIST_CASES)(
    "the $name filters by every state it names when no state filter is set",
    async (listCase: ListCase) => {
      for (const pathTaken of PATHS) {
        for (const encoding of ENCODINGS) {
          jest.clearAllMocks();

          const { unmount } = render(
            listCase.render(
              widgetFor(
                listCase.componentType,
                {
                  stateIds: [
                    encode(CREATED_STATE_ID, encoding),
                    encode(RESOLVED_STATE_ID, encoding),
                  ] as Array<JSONObject>,
                },
                pathTaken,
              ),
            ),
          );

          await waitFor(() => {
            expect(getListMock).toHaveBeenCalledTimes(1);
          });

          expect([
            pathTaken,
            encoding,
            filterValues(
              (getListMock.mock.calls[0]![0] as JSONObject)[
                "query"
              ] as JSONObject,
              listCase.stateQueryKey,
            ),
          ]).toEqual([
            pathTaken,
            encoding,
            [CREATED_STATE_ID, RESOLVED_STATE_ID],
          ]);

          unmount();
        }
      }
    },
  );
});

/*
 * The public routes and the signed-in page agree on every encoding: the
 * policy a public dashboard's list or SLO route answers with is handed the
 * widget the public page draws (PublicDashboardViewConfig.getDrawnConfig),
 * and reads the same ids the signed-in widget reads off the same stored
 * widget.
 */
describe("the public routes and the signed-in page agree on every encoding (issue #6328)", () => {
  const publicPolicyFor: (stored: JSONObject) => JSONObject = (
    stored: JSONObject,
  ): JSONObject => {
    const [drawn] = PublicDashboardViewConfig.getDrawnConfig({
      components: [JSON.parse(JSON.stringify(stored))],
    }).components;

    return PublicDashboardResourceListPolicy.build({
      widget: drawn as unknown as JSONObject,
      variables: [],
      requestedVariables: [],
      requestedQuery: {},
    }).query as JSONObject;
  };

  test.each(LIST_CASES)(
    "the $name filters by the same states and severities on both",
    async (listCase: ListCase) => {
      for (const encoding of ENCODINGS) {
        jest.clearAllMocks();

        const settings: JSONObject = {
          stateIds: [
            encode(CREATED_STATE_ID, encoding),
            encode(RESOLVED_STATE_ID, encoding),
          ] as Array<JSONObject>,
          severityIds: [
            encode(ACKNOWLEDGED_STATE_ID, encoding),
          ] as Array<JSONObject>,
        };
        const stored: JSONObject = {
          componentId: COMPONENT_ID,
          componentType: listCase.componentType,
          arguments: settings,
        };

        const { unmount } = render(
          listCase.render(
            widgetFor(
              listCase.componentType,
              settings,
              "as the board draws it",
            ),
          ),
        );

        await waitFor(() => {
          expect(getListMock).toHaveBeenCalledTimes(1);
        });

        const signedIn: JSONObject = (
          getListMock.mock.calls[0]![0] as JSONObject
        )["query"] as JSONObject;
        const publicQuery: JSONObject = publicPolicyFor(stored);

        for (const key of [listCase.stateQueryKey, listCase.severityQueryKey]) {
          expect([encoding, key, filterValues(publicQuery, key)]).toEqual([
            encoding,
            key,
            filterValues(signedIn, key),
          ]);
        }

        unmount();
      }
    },
  );

  test("the SLO widget reads the same SLO on both", async () => {
    for (const encoding of ENCODINGS) {
      jest.clearAllMocks();
      getItemMock.mockResolvedValue(buildSlo());

      const settings: JSONObject = {
        serviceLevelObjectiveId: encode(SLO_ID, encoding) as JSONObject,
        displayType: SloWidgetDisplayType.Tile,
      };

      const { unmount } = render(
        <DashboardSloComponentElement
          {...baseProps()}
          component={
            widgetFor(
              DashboardComponentType.Slo,
              settings,
              "as the board draws it",
            ) as never
          }
        />,
      );

      expect(await screen.findByText("99.95%")).toBeInTheDocument();

      const signedInId: string = String(
        (getItemMock.mock.calls[0]![0] as JSONObject)["id"],
      );
      const publicQuery: JSONObject = publicPolicyFor({
        componentId: COMPONENT_ID,
        componentType: DashboardComponentType.Slo,
        arguments: settings,
      });

      expect([encoding, String(publicQuery["_id"])]).toEqual([
        encoding,
        signedInId,
      ]);
      expect(signedInId).toBe(SLO_ID);

      unmount();
    }
  });
});
