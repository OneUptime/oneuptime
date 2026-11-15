import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A service's SLOs page (#8443), and the SLO list's What It Measures column
 * (#8441).
 *
 * The page lists the live SLOs whose services include this one, and can
 * create one already measuring it: the SLOs page's own two-step form, with
 * Request success picked and this service chosen. Only the props the page
 * hands to ModelTable are under test, so the table is captured instead of
 * rendered.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import ServiceSlos, {
  getServiceSloCreateInitialValues,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Slos";
import {
  getSloWhatItMeasuresColumns,
  SLO_TABLE_SELECT_MORE_FIELDS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Slos";
import {
  SLO_CREATE_FORM_STEPS,
  SLO_CREATE_INITIAL_VALUES,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import Column from "../../../UI/Components/ModelTable/Column";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { refuseRequestsTo } from "../../Helpers/RealNetworkRequests";

/*
 * Reads the page makes that these tests leave unanswered: refused at
 * once, as the network refused them, and taken as reads it could not
 * make (Tests/Helpers/RealNetworkRequests.ts).
 */
refuseRequestsTo(["/label/get-list"]);

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const SERVICE_ID: string = "20000000-0000-4000-8000-0000000000b2";

type TableProps = Record<string, unknown>;

function renderPage(): TableProps {
  mockCapturedTableProps.length = 0;
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/service/${SERVICE_ID}/slos`,
  );

  render(
    <MemoryRouter>
      <ServiceSlos {...({} as PageComponentProps)} />
    </MemoryRouter>,
  );

  expect(mockCapturedTableProps.length).toBeGreaterThan(0);

  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("a service's SLOs page", () => {
  test("lists the live SLOs whose services include this one", () => {
    const props: TableProps = renderPage();
    const query: Record<string, unknown> = props["query"] as Record<
      string,
      unknown
    >;

    expect(query["services"]).toBeInstanceOf(Includes);
    expect(
      ((query["services"] as Includes).values as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([SERVICE_ID]);
    // An archived SLO is not evaluated: this service's requests do not spend its budget.
    expect(query["isArchived"]).toBe(false);
    expect(props["modelType"]).toBe(ServiceLevelObjective);
  });

  test("is its own table, named for the service page", () => {
    const props: TableProps = renderPage();

    expect(props["id"]).toBe("service-slos-table");
    expect(props["userPreferencesKey"]).toBe("service-slos-table");
    expect(props["name"]).toBe("Service > SLOs");
    expect((props["cardProps"] as Record<string, unknown>)["title"]).toBe(
      "Service Level Objectives",
    );
    expect(props["noItemsMessage"]).toBe(
      "No SLO measures this service yet. Create one to track how many of its requests succeed, or how fast they are served.",
    );
    expect((props["documentationLink"] as Route).toString()).toBe(
      "/docs/slo/request-slos",
    );
  });

  test("creates an SLO with the SLOs page's own two steps", () => {
    const props: TableProps = renderPage();

    expect(props["isCreateable"]).toBe(true);
    expect(props["isEditable"]).toBe(false);
    expect(props["isDeleteable"]).toBe(false);
    expect(props["formSteps"]).toBe(SLO_CREATE_FORM_STEPS);
    expect(
      (props["formFields"] as Array<{ field: Record<string, unknown> }>).map(
        (field: { field: Record<string, unknown> }): string => {
          return Object.keys(field.field)[0] as string;
        },
      ),
    ).toEqual([
      "sliType",
      "services",
      "latencyThresholdInMilliseconds",
      "name",
      "targetPercentage",
      "description",
      "atRiskThresholdPercentage",
      "windowType",
      "windowDays",
      "timezone",
      "labels",
    ]);
  });

  test("opens the create form already measuring this service's requests", () => {
    const props: TableProps = renderPage();

    expect(props["createInitialValues"]).toEqual({
      ...SLO_CREATE_INITIAL_VALUES,
      sliType: SliType.RequestSuccess,
      services: [SERVICE_ID],
    });
  });

  test("opens a new SLO's own page once it is created, as the SLOs page does", async () => {
    const props: TableProps = renderPage();
    const onCreateSuccess: (
      item: ServiceLevelObjective,
      modalType?: unknown,
    ) => Promise<ServiceLevelObjective> = props["onCreateSuccess"] as (
      item: ServiceLevelObjective,
      modalType?: unknown,
    ) => Promise<ServiceLevelObjective>;

    const created: ServiceLevelObjective = new ServiceLevelObjective();
    created._id = "30000000-0000-4000-8000-0000000000c3";

    await expect(onCreateSuccess(created)).resolves.toBe(created);
  });

  test("shows the SLO list's reliability columns, then labels and owners", () => {
    const props: TableProps = renderPage();
    const titles: Array<string> = (
      props["columns"] as Array<Column<ServiceLevelObjective>>
    ).map((column: Column<ServiceLevelObjective>): string => {
      return column.title as string;
    });

    expect(titles.slice(-2)).toEqual(["Labels", "Owners"]);
    expect(titles).toContain("Status");
    expect(props["selectMoreFields"]).toBe(SLO_TABLE_SELECT_MORE_FIELDS);
  });

  test("filters by name and by status", () => {
    const props: TableProps = renderPage();

    expect(
      (props["filters"] as Array<{ title: string }>).map(
        (filter: { title: string }): string => {
          return filter.title;
        },
      ),
    ).toEqual(["Name", "Status"]);
  });
});

describe("getServiceSloCreateInitialValues", () => {
  test("is the SLOs page's seeds, measuring one service's requests", () => {
    const values: Record<string, unknown> = getServiceSloCreateInitialValues(
      new ObjectID(SERVICE_ID),
    ) as Record<string, unknown>;

    expect(values["sliType"]).toBe(SliType.RequestSuccess);
    expect(values["services"]).toEqual([SERVICE_ID]);
    expect(values["targetPercentage"]).toBe(
      SLO_CREATE_INITIAL_VALUES.targetPercentage,
    );
    expect(values["windowDays"]).toBe(SLO_CREATE_INITIAL_VALUES.windowDays);
  });

  test("leaves the SLOs page's own seeds as they are", () => {
    getServiceSloCreateInitialValues(new ObjectID(SERVICE_ID));

    expect(SLO_CREATE_INITIAL_VALUES.sliType).toBe(SliType.MonitorUptime);
    expect(
      (SLO_CREATE_INITIAL_VALUES as Record<string, unknown>)["services"],
    ).toBeUndefined();
  });
});

describe("the service menu's and the router's SLOs page", () => {
  test("is at /service/<id>/slos", () => {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.SERVICE_VIEW_SLOS] as Route,
      { modelId: new ObjectID(SERVICE_ID) },
    );

    expect(route.toString()).toContain(`/service/${SERVICE_ID}/slos`);
  });
});

describe("the SLO list's What It Measures column", () => {
  const column: Column<ServiceLevelObjective> =
    getSloWhatItMeasuresColumns()[0]!;

  function drawCell(slo: ServiceLevelObjective): void {
    render(<MemoryRouter>{column.getElement!(slo)}</MemoryRouter>);
  }

  function withServices(names: Array<string>): Array<Service> {
    return names.map((name: string, index: number): Service => {
      const service: Service = new Service();
      service._id = `40000000-0000-4000-8000-00000000000${index}`;
      service.name = name;
      return service;
    });
  }

  function withMonitors(names: Array<string>): Array<Monitor> {
    return names.map((name: string, index: number): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor._id = `50000000-0000-4000-8000-00000000000${index}`;
      monitor.name = name;
      return monitor;
    });
  }

  test("is one column titled for what an SLO measures", () => {
    expect(getSloWhatItMeasuresColumns()).toHaveLength(1);
    expect(column.title).toBe("What It Measures");
  });

  test("names a request SLO's services", () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.sliType = SliType.RequestLatency;
    slo.services = withServices(["checkout", "payments"]);
    slo.monitors = withMonitors(["left over"]);

    drawCell(slo);

    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
    expect(screen.queryByText("left over")).toBeNull();
  });

  test("names a monitor uptime SLO's monitors, as the Monitors column did", () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.sliType = SliType.MonitorUptime;
    slo.monitors = withMonitors(["API", "Database"]);
    slo.services = withServices(["unused"]);

    drawCell(slo);

    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByText("Database")).toBeInTheDocument();
    expect(screen.queryByText("unused")).toBeNull();
  });

  test("an SLO read before what it measures was stored reads as monitor uptime", () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.monitors = withMonitors(["API"]);

    drawCell(slo);

    expect(screen.getByText("API")).toBeInTheDocument();
  });

  test("the list reads each row's SLI type and services", () => {
    expect(SLO_TABLE_SELECT_MORE_FIELDS).toMatchObject({
      sliType: true,
      services: { name: true, _id: true },
    });
  });
});
