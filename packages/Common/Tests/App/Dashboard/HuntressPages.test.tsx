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
import { getJestSpyOn } from "../../Spy";

/*
 * Incidents > Integrations > Huntress: the list of connections, and the
 * list of reports on a connection's page. Both are ModelTables, so what is
 * under test is what they hand the table - who can do what, the copy, the
 * form, the query - and what each column draws for a row. The table itself
 * is captured instead of rendered; each column's element is rendered alone.
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

import HuntressConnectionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Integrations/Huntress";
import HuntressIncidentReportsTable from "../../../../App/FeatureSet/Dashboard/src/Components/Huntress/HuntressIncidentReportsTable";
import {
  HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES,
  getHuntressConnectionFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Integrations/HuntressConnectionFormFields";
import { HuntressConnectionState } from "../../../../App/FeatureSet/Dashboard/src/Components/Huntress/HuntressConnectionDisplay";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import HuntressConnection from "../../../Models/DatabaseModels/HuntressConnection";
import HuntressIncidentReport from "../../../Models/DatabaseModels/HuntressIncidentReport";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import HuntressIncidentReportOutcome from "../../../Types/Huntress/HuntressIncidentReportOutcome";
import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

interface Column<T> {
  title: string;
  getElement?: (item: T) => React.ReactElement;
  getExportValue?: (item: T) => string;
}

const CONNECTION_ID: string = "6d1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const INCIDENT_ID: string = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  mockCapturedTableProps.length = 0;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function lastTableProps(): Record<string, unknown> {
  const props: Record<string, unknown> | undefined =
    mockCapturedTableProps[mockCapturedTableProps.length - 1];

  if (!props) {
    throw new Error("No ModelTable was rendered.");
  }

  return props;
}

function columnTitled<T>(title: string): Column<T> {
  const columns: Array<Column<T>> = lastTableProps()["columns"] as Array<
    Column<T>
  >;
  const column: Column<T> | undefined = columns.find(
    (candidate: Column<T>): boolean => {
      return candidate.title === title;
    },
  );

  if (!column) {
    throw new Error(`The table has no "${title}" column.`);
  }

  return column;
}

function renderCell<T>(title: string, item: T): HTMLElement {
  const column: Column<T> = columnTitled<T>(title);

  if (!column.getElement) {
    throw new Error(`The "${title}" column draws no element.`);
  }

  return render(column.getElement(item)).container;
}

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

describe("the Huntress connections list", () => {
  function renderPage(): void {
    render(<HuntressConnectionsPage {...PAGE_PROPS} />);
  }

  test("lists the project's connections, connected with Connect Huntress", () => {
    renderPage();

    const props: Record<string, unknown> = lastTableProps();

    expect(props["modelType"]).toBe(HuntressConnection);
    expect(props["createVerb"]).toBe("Connect");
    expect(props["singularName"]).toBe("Huntress");
    expect(props["isCreateable"]).toBe(true);
    expect(props["isViewable"]).toBe(true);
    expect(props["isEditable"]).toBe(false);
    expect(props["isDeleteable"]).toBe(false);
    expect(props["viewButtonText"]).toBe("View Connection");
    expect(props["cardProps"]).toEqual({
      title: "Huntress",
      description:
        "Huntress incident reports open incidents here and page your on-call team. Closing a report in Huntress resolves its incident.",
    });
    expect(props["emptyState"]).toEqual({
      title: "Page on-call for Huntress incident reports",
    });
  });

  test("links the Huntress page of the docs", () => {
    renderPage();

    expect((lastTableProps()["documentationLink"] as Route).toString()).toBe(
      "/docs/integrations/huntress",
    );
  });

  test("connects with the connection form, starting from its defaults", () => {
    renderPage();

    const props: Record<string, unknown> = lastTableProps();
    const fields: Array<{ title?: string }> = props["formFields"] as Array<{
      title?: string;
    }>;

    expect(props["createInitialValues"]).toBe(
      HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES,
    );
    expect(
      fields.map((field: { title?: string }) => {
        return field.title;
      }),
    ).toEqual(
      getHuntressConnectionFormFields().map((field: { title?: string }) => {
        return field.title;
      }),
    );
  });

  test("opens a new connection on its own page, where the setup is", async () => {
    const navigate: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation((): void => {
      // no router here
    });

    renderPage();

    const connection: HuntressConnection = new HuntressConnection();
    connection.id = new ObjectID(CONNECTION_ID);

    const onCreateSuccess: (
      item: HuntressConnection,
    ) => Promise<HuntressConnection> = lastTableProps()["onCreateSuccess"] as (
      item: HuntressConnection,
    ) => Promise<HuntressConnection>;

    await expect(onCreateSuccess(connection)).resolves.toBe(connection);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]![0] as Route).toString()).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS_VIEW] as Route,
        { modelId: new ObjectID(CONNECTION_ID) },
      ).toString(),
    );
  });

  test("shows each connection's state as a pill", () => {
    renderPage();

    const cases: Array<{
      facts: Partial<HuntressConnection>;
      state: HuntressConnectionState;
      label: string;
    }> = [
      {
        facts: {},
        state: HuntressConnectionState.NeedsSigningSecret,
        label: "Signing secret needed",
      },
      {
        facts: { isSigningSecretSet: true },
        state: HuntressConnectionState.Waiting,
        label: "Waiting for Huntress",
      },
      {
        facts: {
          isSigningSecretSet: true,
          lastEventReceivedAt: new Date(),
        },
        state: HuntressConnectionState.Receiving,
        label: "Receiving reports",
      },
      {
        facts: {
          isSigningSecretSet: true,
          lastError: "The request body is not valid JSON.",
          lastErrorAt: new Date(),
        },
        state: HuntressConnectionState.Failing,
        label: "Refusing requests",
      },
    ];

    for (const testCase of cases) {
      const connection: HuntressConnection = new HuntressConnection();
      Object.assign(connection, testCase.facts);

      const cell: HTMLElement = renderCell<HuntressConnection>(
        "State",
        connection,
      );

      expect(
        cell
          .querySelector("[data-testid='huntress-connection-row-state']")
          ?.getAttribute("data-state"),
      ).toBe(testCase.state);
      expect(cell).toHaveTextContent(testCase.label);
      expect(
        columnTitled<HuntressConnection>("State").getExportValue!(connection),
      ).toBe(testCase.label);

      cleanup();
    }
  });

  test("names who each connection pages, or Nobody", () => {
    renderPage();

    const none: HuntressConnection = new HuntressConnection();
    none.onCallDutyPolicies = [];
    expect(renderCell<HuntressConnection>("Pages", none)).toHaveTextContent(
      "Nobody",
    );

    cleanup();

    const paging: HuntressConnection = new HuntressConnection();
    const primary: OnCallDutyPolicy = new OnCallDutyPolicy();
    primary.name = "Security on-call";
    const backup: OnCallDutyPolicy = new OnCallDutyPolicy();
    backup.name = "SOC escalation";
    paging.onCallDutyPolicies = [primary, backup];

    expect(renderCell<HuntressConnection>("Pages", paging)).toHaveTextContent(
      "Security on-call, SOC escalation",
    );
    expect(
      columnTitled<HuntressConnection>("Pages").getExportValue!(paging),
    ).toBe("Security on-call, SOC escalation");
  });
});

describe("a connection's incident reports", () => {
  function renderTable(): void {
    render(
      <HuntressIncidentReportsTable
        connectionId={new ObjectID(CONNECTION_ID)}
      />,
    );
  }

  function report(data: {
    [Key in keyof HuntressIncidentReport]?:
      | HuntressIncidentReport[Key]
      | undefined;
  }): HuntressIncidentReport {
    const row: HuntressIncidentReport = new HuntressIncidentReport();
    row.huntressIncidentReportId = "1234";
    row.organizationId = "42";
    row.organizationName = "Acme Corp";
    Object.assign(row, data);
    return row;
  }

  test("lists only this connection's reports, newest first, read-only", () => {
    renderTable();

    const props: Record<string, unknown> = lastTableProps();

    expect(props["modelType"]).toBe(HuntressIncidentReport);
    expect(
      (
        props["query"] as { huntressConnectionId: ObjectID }
      ).huntressConnectionId.toString(),
    ).toBe(CONNECTION_ID);
    expect(props["sortBy"]).toBe("createdAt");
    expect(props["sortOrder"]).toBe(SortOrder.Descending);
    expect(props["isCreateable"]).toBe(false);
    expect(props["isEditable"]).toBe(false);
    expect(props["isDeleteable"]).toBe(false);
    expect(props["emptyState"]).toEqual({
      title: "No incident reports yet",
      description:
        "Each incident report Huntress sends shows here, with the incident it opened or why it opened none.",
    });
    expect(
      (props["columns"] as Array<Column<HuntressIncidentReport>>).map(
        (column: Column<HuntressIncidentReport>) => {
          return column.title;
        },
      ),
    ).toEqual(["Report", "Severity", "In Huntress", "Outcome", "Received"]);
  });

  test("heads a report with the host it is about, linked to Huntress in a new tab", () => {
    renderTable();

    const cell: HTMLElement = renderCell<HuntressIncidentReport>(
      "Report",
      report({
        affectedName: "DESKTOP-01",
        subject: "CRITICAL - Incident on DESKTOP-01 (Acme Corp)",
      }),
    );

    expect(screen.getByTestId("huntress-report-headline")).toHaveTextContent(
      "DESKTOP-01",
    );
    expect(cell).toHaveTextContent("Acme Corp · #1234");

    const link: HTMLAnchorElement | null = cell.querySelector("a");

    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      "https://huntress.io/org/42/incident_reports/1234",
    );
    expect(link!.getAttribute("target")).toBe("_blank");
  });

  test("draws an unlinked headline when the report names no organization", () => {
    renderTable();

    const cell: HTMLElement = renderCell<HuntressIncidentReport>(
      "Report",
      report({ organizationId: undefined, subject: "HIGH - Suspicious login" }),
    );

    expect(cell.querySelector("a")).toBeNull();
    expect(screen.getByTestId("huntress-report-headline")).toHaveTextContent(
      "Suspicious login",
    );
  });

  test("shows the Huntress severity as a pill, or the raw value it does not know", () => {
    renderTable();

    expect(
      renderCell<HuntressIncidentReport>(
        "Severity",
        report({ severity: HuntressSeverity.Critical }),
      ),
    ).toHaveTextContent("Critical");

    cleanup();

    expect(
      renderCell<HuntressIncidentReport>(
        "Severity",
        report({ severity: "unknown" }),
      ),
    ).toHaveTextContent("unknown");
  });

  test("says what Huntress did with the report, in Huntress's words", () => {
    renderTable();

    expect(
      renderCell<HuntressIncidentReport>(
        "In Huntress",
        report({ status: "partner_dismissed" }),
      ),
    ).toHaveTextContent("Dismissed by your team");
  });

  test("links the incident a report opened, and says when it paged", () => {
    renderTable();

    const cell: HTMLElement = renderCell<HuntressIncidentReport>(
      "Outcome",
      report({
        outcome: HuntressIncidentReportOutcome.IncidentOpened,
        incidentId: new ObjectID(INCIDENT_ID),
        pagedOnCall: true,
      }),
    );

    expect(cell).toHaveTextContent("Incident opened");
    expect(cell).toHaveTextContent("Paged on-call");
    expect(
      screen.getByTestId("huntress-report-incident-link"),
    ).toHaveTextContent("View incident");
    expect(cell.querySelector("a")?.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW] as Route, {
        modelId: new ObjectID(INCIDENT_ID),
      }).toString(),
    );
  });

  test("says the incident is gone when it was deleted", () => {
    renderTable();

    const cell: HTMLElement = renderCell<HuntressIncidentReport>(
      "Outcome",
      report({ outcome: HuntressIncidentReportOutcome.IncidentResolved }),
    );

    expect(cell).toHaveTextContent("Incident resolved");
    expect(cell).toHaveTextContent("Incident deleted");
    expect(cell.querySelector("a")).toBeNull();
    expect(cell).not.toHaveTextContent("Paged on-call");
  });

  test("says why a skipped report opened nothing, with no link", () => {
    renderTable();

    const cell: HTMLElement = renderCell<HuntressIncidentReport>(
      "Outcome",
      report({
        outcome: HuntressIncidentReportOutcome.OrganizationNotWatched,
      }),
    );

    expect(cell).toHaveTextContent("Skipped: organization not watched");
    expect(cell.querySelector("a")).toBeNull();
    expect(
      columnTitled<HuntressIncidentReport>("Outcome").getExportValue!(
        report({
          outcome: HuntressIncidentReportOutcome.ClosedBeforeReceived,
        }),
      ),
    ).toBe("Skipped: already closed in Huntress");
  });
});
