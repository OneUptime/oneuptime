import "@testing-library/jest-dom";
import React, { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DashboardMonitorListComponentElement, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent";
import DashboardVariableSelector from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariableSelector";
import { setPublicDashboardContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import DashboardMonitorListComponentUtil from "../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import URL from "../../../Types/API/URL";
import { VariableValueChange } from "../../../UI/Components/Dashboard/DashboardVariableControl";

const listMock: jest.Mock = jest.fn();
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const DASHBOARD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const UNIT_660: string = "06600000-0000-4000-8000-000000000000";
const UNIT_661: string = "06610000-0000-4000-8000-000000000000";
const NETWORK: string = "00000000-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return listMock(...args);
      },
    },
  };
});
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return PROJECT_ID;
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
            return "/monitor";
          },
        };
      },
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

function variable(
  overrides: Partial<DashboardVariable> = {},
): DashboardVariable {
  return {
    id: "unit",
    name: "UNIT",
    type: DashboardVariableType.ProjectLabel,
    labelOptions: [
      { label: "0660", value: UNIT_660 },
      { label: "0661", value: UNIT_661 },
    ],
    ...overrides,
  };
}

const dashboardViewConfig: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

function props(overrides: Partial<ComponentProps> = {}): ComponentProps {
  const component: ComponentProps["component"] =
    DashboardMonitorListComponentUtil.getDefaultComponent();
  component.arguments = {
    title: "{{UNIT}} NETWORK",
    labelVariableId: "unit",
    maxRows: 25,
  };
  return {
    component,
    componentId: component.componentId,
    key: "monitors",
    isEditMode: false,
    isSelected: false,
    onComponentUpdate: () => {},
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig,
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: [variable()],
    ...overrides,
  };
}

function response(name: string): {
  data: Array<Record<string, unknown>>;
  count: number;
} {
  return {
    data: [
      {
        _id: UNIT_660,
        name,
        monitorType: "Manual",
        currentMonitorStatus: { name: "Operational" },
      },
    ],
    count: 1,
  };
}

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue(response("All unit monitors"));
  setPublicDashboardContext(null);
});
afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("MonitorList project label variables", () => {
  test("changing the real UNIT selector changes the query, rows and title without a refresh tick", async () => {
    const initial: ComponentProps = props();
    function Dashboard(): React.ReactElement {
      const [variables, setVariables] = React.useState<
        Array<DashboardVariable>
      >([variable()]);
      return (
        <>
          <DashboardVariableSelector
            variables={variables}
            onVariableValueChange={(
              _id: string,
              change: VariableValueChange,
            ) => {
              return setVariables([
                { ...(variables[0] as DashboardVariable), ...change },
              ]);
            }}
          />
          <DashboardMonitorListComponentElement
            {...initial}
            variables={variables}
          />
        </>
      );
    }
    render(<Dashboard />);
    expect(await screen.findByText("All unit monitors")).toBeInTheDocument();
    expect(screen.getByText("All NETWORK")).toBeInTheDocument();

    listMock.mockResolvedValue(response("0660 router"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: UNIT_660 },
    });
    expect(await screen.findByText("0660 router")).toBeInTheDocument();
    expect(screen.queryByText("All unit monitors")).not.toBeInTheDocument();
    expect(screen.getByText("0660 NETWORK")).toBeInTheDocument();
    expect(listMock.mock.calls[1][0].query.labels).toEqual(
      new Includes([UNIT_660]),
    );

    listMock.mockResolvedValue(response("0661 switch"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: UNIT_661 },
    });
    expect(await screen.findByText("0661 switch")).toBeInTheDocument();
    expect(screen.queryByText("0660 router")).not.toBeInTheDocument();
    expect(listMock.mock.calls[2][0].query.labels).toEqual(
      new Includes([UNIT_661]),
    );

    listMock.mockResolvedValue(response("All unit monitors"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(await screen.findByText("All unit monitors")).toBeInTheDocument();
    expect(listMock.mock.calls[3][0].query.labels).toBeUndefined();
  });

  test("retains project, fixed labels, status, monitor type and row limit", async () => {
    const input: ComponentProps = props({
      variables: [variable({ selectedValue: UNIT_660 })],
    });
    input.component.arguments = {
      ...input.component.arguments,
      labelIds: [NETWORK],
      statusFilter: "operational",
      monitorStatusIds: [NETWORK],
      monitorTypes: ["Manual"],
      maxRows: 7,
    };
    render(<DashboardMonitorListComponentElement {...input} />);
    await waitFor(() => {
      return expect(listMock).toHaveBeenCalledTimes(1);
    });
    expect(listMock.mock.calls[0][0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        labels: new IncludesAnyOfGroups([[NETWORK], [UNIT_660]]),
        currentMonitorStatus: { isOperationalState: true },
        currentMonitorStatusId: new Includes([NETWORK]),
        monitorType: new Includes(["Manual"]),
      },
      limit: 7,
      skip: 0,
      sort: { name: SortOrder.Ascending },
    });
    expect(await screen.findByText("0660 NETWORK")).toBeInTheDocument();
  });

  test("All retains fixed labels even when a default is configured", async () => {
    const input: ComponentProps = props({
      variables: [variable({ selectedValue: "", defaultValue: UNIT_660 })],
    });
    input.component.arguments.labelIds = [NETWORK];
    render(<DashboardMonitorListComponentElement {...input} />);
    await screen.findByText("All NETWORK");
    expect(listMock.mock.calls[0][0].query.labels).toEqual(
      new Includes([NETWORK]),
    );
  });

  test("a deleted label returns the ordinary empty state", async () => {
    listMock.mockResolvedValue({ data: [], count: 0 });
    render(
      <DashboardMonitorListComponentElement
        {...props({ variables: [variable({ selectedValue: UNIT_660 })] })}
      />,
    );
    expect(await screen.findByText("No monitors found")).toBeInTheDocument();
    expect(listMock.mock.calls[0][0].query.labels).toEqual(
      new Includes([UNIT_660]),
    );
  });

  test("a removed binding produces a configuration error without fetching all monitors", async () => {
    render(
      <DashboardMonitorListComponentElement {...props({ variables: [] })} />,
    );
    expect(
      await screen.findByText(/label variable is missing/),
    ).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  test("a selection absent from published options is an error", async () => {
    render(
      <DashboardMonitorListComponentElement
        {...props({ variables: [variable({ selectedValue: NETWORK })] })}
      />,
    );
    expect(
      await screen.findByText(/offered by this dashboard variable/),
    ).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  test("late responses for the previous unit cannot replace the latest results", async () => {
    let resolvePrevious: (
      result: ReturnType<typeof response>,
    ) => void = () => {};
    listMock.mockImplementationOnce(() => {
      return new Promise<ReturnType<typeof response>>(
        (
          resolve: (
            result:
              | ReturnType<typeof response>
              | PromiseLike<ReturnType<typeof response>>,
          ) => void,
        ) => {
          resolvePrevious = resolve;
        },
      );
    });
    const initial: ComponentProps = props({
      variables: [variable({ selectedValue: UNIT_660 })],
    });
    const view: ReturnType<typeof render> = render(
      <DashboardMonitorListComponentElement {...initial} />,
    );
    await waitFor(() => {
      return expect(listMock).toHaveBeenCalledTimes(1);
    });
    listMock.mockResolvedValue(response("0661 switch"));
    view.rerender(
      <DashboardMonitorListComponentElement
        {...initial}
        variables={[variable({ selectedValue: UNIT_661 })]}
      />,
    );
    expect(await screen.findByText("0661 switch")).toBeInTheDocument();
    await act(async () => {
      resolvePrevious(response("0660 router"));
    });
    expect(screen.queryByText("0660 router")).not.toBeInTheDocument();
    expect(screen.getByText("0661 switch")).toBeInTheDocument();
    expect(screen.getByText("0661 NETWORK")).toBeInTheDocument();
  });

  test("late errors for a previous selection do not hide the latest rows", async () => {
    let rejectPrevious: (error: Error) => void = () => {};
    listMock.mockImplementationOnce(() => {
      return new Promise<ReturnType<typeof response>>(
        (
          _resolve: (
            result:
              | ReturnType<typeof response>
              | PromiseLike<ReturnType<typeof response>>,
          ) => void,
          reject: (error?: unknown) => void,
        ) => {
          rejectPrevious = reject;
        },
      );
    });
    const initial: ComponentProps = props({
      variables: [variable({ selectedValue: UNIT_660 })],
    });
    const view: ReturnType<typeof render> = render(
      <DashboardMonitorListComponentElement {...initial} />,
    );
    await waitFor(() => {
      return expect(listMock).toHaveBeenCalledTimes(1);
    });
    listMock.mockResolvedValue(response("0661 switch"));
    view.rerender(
      <DashboardMonitorListComponentElement
        {...initial}
        variables={[variable({ selectedValue: UNIT_661 })]}
      />,
    );
    await screen.findByText("0661 switch");
    await act(async () => {
      rejectPrevious(new Error("Old request failed"));
    });
    expect(screen.queryByText("Old request failed")).not.toBeInTheDocument();
    expect(screen.getByText("0661 switch")).toBeInTheDocument();
  });

  test("public requests send component identity and selection IDs to the dashboard endpoint", async () => {
    setPublicDashboardContext({
      dashboardId: DASHBOARD_ID,
      apiUrl: URL.fromString("https://dev.oneuptime.com/public-dashboard-api"),
      postJSON: async () => {
        throw new Error("Unexpected public request");
      },
    });
    const input: ComponentProps = props({
      variables: [
        variable({ isMultiSelect: true, selectedValues: [UNIT_660, UNIT_661] }),
      ],
    });
    render(<DashboardMonitorListComponentElement {...input} />);
    await screen.findByText("0660, 0661 NETWORK");
    const options: Record<string, any> =
      listMock.mock.calls[0][0].requestOptions;
    expect(options["overrideRequestUrl"].toString()).toContain(
      `/resource-list/${DASHBOARD_ID.toString()}/monitor`,
    );
    expect(options["additionalRequestBody"]).toEqual({
      componentId: input.componentId.toString(),
      variables: [
        {
          id: "unit",
          selectedValue: null,
          selectedValues: [UNIT_660, UNIT_661],
        },
      ],
    });
  });
});
