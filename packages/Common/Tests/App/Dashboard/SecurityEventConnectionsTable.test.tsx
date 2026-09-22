import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  ConnectorProviderHelp,
  connectorProviderHelpEntries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectorProviderHelp";
import SecurityEventConnectionRunDetails from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionRunDetails";
import SecurityEventConnectionsTable, {
  securityEventConnectionsHelpMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsTable";
import {
  CONNECTOR_HEALTH_NO_EVENTS_YET,
  CONNECTOR_HEALTH_SUCCEEDED,
  connectorHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import SecurityEventsConnectionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Connections";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../Models/DatabaseModels/SecurityEventConnectionRun";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityConnectorTestReport } from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { SecurityEventConnectionRunResult } from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import ModelColumn from "../../../UI/Components/ModelTable/Column";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import TableRow from "../../../UI/Components/Table/TableRow";
import TableColumn from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Replace only ModelTable's data-loading boundary: the real TableRow decides
 * action visibility and dispatches the selected row, and every modal the
 * table opens stays real. Rows are keyed by model, and mockIsMobile renders
 * them the way the phone layout does, so both row layouts are exercised.
 */
const mockRows: Map<string, Array<BaseModel>> = new Map();
const mockTableProps: Map<string, ModelTableProps<BaseModel>> = new Map();
let mockIsMobile: boolean = false;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<BaseModel>): ReactElement => {
      const tableName: string = new props.modelType().tableName || "";
      mockTableProps.set(tableName, props);
      const columns: Array<TableColumn<BaseModel>> = [
        ...props.columns.map(
          (column: ModelColumn<BaseModel>): TableColumn<BaseModel> => {
            return {
              title: column.title,
              type: column.type,
              key: Object.keys(column.field)[0] as keyof BaseModel,
              getElement: column.getElement,
              noValueMessage: column.noValueMessage,
            };
          },
        ),
        { title: "Actions", type: FieldType.Actions },
      ];

      if (mockIsMobile) {
        return (
          <div aria-label={props.cardProps?.title as string} role="list">
            {(mockRows.get(tableName) || []).map(
              (row: BaseModel): ReactElement => {
                return (
                  <section
                    key={row._id}
                    data-testid={(row as unknown as { name: string }).name}
                  >
                    <TableRow
                      item={row}
                      columns={columns}
                      actionButtons={props.actionButtons}
                      isMobile={true}
                    />
                  </section>
                );
              },
            )}
          </div>
        );
      }

      return (
        <table aria-label={props.cardProps?.title as string}>
          <thead>
            <tr>
              {columns.map((column: TableColumn<BaseModel>): ReactElement => {
                return <th key={column.title}>{column.title}</th>;
              })}
            </tr>
          </thead>
          {(mockRows.get(tableName) || []).map(
            (row: BaseModel): ReactElement => {
              return (
                <tbody
                  key={row._id}
                  data-testid={(row as unknown as { name: string }).name}
                >
                  <TableRow
                    item={row}
                    columns={columns}
                    actionButtons={props.actionButtons}
                    isMobile={false}
                  />
                </tbody>
              );
            },
          )}
        </table>
      );
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";
const GOOGLE_ID: string = "33333333-3333-4333-8333-333333333333";
const NOW: number = new Date("2026-09-10T12:00:00Z").getTime();
const RESELLER_MESSAGE: string =
  "Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project.";

function pollResult(
  overrides: Partial<SecurityEventConnectionRunResult> = {},
): SecurityEventConnectionRunResult {
  return {
    type: "poll",
    provider: "okta",
    status: "success",
    startedAt: "2026-09-10T11:59:00Z",
    completedAt: "2026-09-10T11:59:02Z",
    durationMs: 2000,
    windowStart: "2026-09-10T11:53:00Z",
    windowEnd: "2026-09-10T11:59:00Z",
    fetchedCount: 0,
    ingestedCount: 0,
    duplicateCount: 0,
    rejectedCount: 0,
    failedCount: 0,
    complete: true,
    requestCount: 1,
    warnings: [],
    samples: [],
    checks: [],
    ...overrides,
  };
}

/*
 * Unlike Partial<>, an override may set a field to undefined, which is how a
 * test describes a connection that was never polled.
 */
type SecurityEventConnectionOverrides = {
  [Key in keyof SecurityEventConnection]?:
    | SecurityEventConnection[Key]
    | undefined;
};

function connection(
  overrides: SecurityEventConnectionOverrides = {},
): SecurityEventConnection {
  const value: SecurityEventConnection = new SecurityEventConnection();
  value._id = CONNECTION_ID;
  value.projectId = PROJECT_ID;
  value.name = "Acme Okta";
  value.provider = SecurityEventConnectorProvider.OktaSystemLog;
  value.config = { orgUrl: "https://acme.okta.com" };
  value.isEnabled = true;
  value.pollIntervalInMinutes = 5;
  value.alertingOnly = true;
  value.createdAt = new Date(NOW - 60 * 60_000);
  value.lastPolledAt = new Date(NOW - 60_000);
  value.lastSuccessfulPollAt = new Date(NOW - 60_000);
  value.lastPollResult = pollResult() as unknown as JSONObject;
  Object.assign(value, overrides);
  return value;
}

function googleConnection(
  overrides: SecurityEventConnectionOverrides = {},
): SecurityEventConnection {
  return connection({
    _id: GOOGLE_ID,
    name: "Customer SecOps",
    provider: SecurityEventConnectorProvider.GoogleSecOps,
    config: {
      region: "europe",
      instanceResourceName: "projects/acme/locations/europe/instances/i",
    },
    lastPollResult: pollResult({
      provider: SecurityEventConnectorProvider.GoogleSecOps,
    }) as unknown as JSONObject,
    ...overrides,
  });
}

function report(provider: string): SecurityConnectorTestReport {
  return {
    provider,
    status: "warn",
    startedAt: "2026-09-10T12:00:00.000Z",
    completedAt: "2026-09-10T12:00:01.000Z",
    durationMs: 1000,
    summary: "Access works; nothing was created in the last 7 days.",
    checks: [
      {
        key: "authentication",
        name: "Authenticate",
        status: "pass",
        durationMs: 200,
        message: "Accepted.",
      },
      {
        key: "detections-available",
        name: "Records available to import",
        status: "warn",
        durationMs: 300,
        message: "No records were created in the last 7 days.",
        remediation: "Polling will import new records as they are created.",
      },
    ],
  };
}

function tableElement(): ReactElement {
  return (
    <MemoryRouter>
      <SecurityEventConnectionsTable />
    </MemoryRouter>
  );
}

function renderTable(rows: Array<SecurityEventConnection>): RenderResult {
  mockRows.set("SecurityEventConnection", rows);
  return render(tableElement());
}

function tableProps(): ModelTableProps<BaseModel> {
  return mockTableProps.get(
    "SecurityEventConnection",
  ) as ModelTableProps<BaseModel>;
}

function row(name: string = "Acme Okta"): HTMLElement {
  return screen.getByTestId(name);
}

function postCall(index: number = 0): JSONObject {
  return jest.mocked(API.post).mock.calls[index]?.[0] as unknown as JSONObject;
}

function mockTransport(): void {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ "project-id": PROJECT_ID.toString() });
  jest
    .spyOn(ModelAPI, "getList")
    .mockResolvedValue({ data: [], count: 0, skip: 0, limit: 20 });
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(connection());
  jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse(200, report("okta") as unknown as JSONObject, {}),
    );
}

describe("SecurityEventConnectionsTable", () => {
  beforeEach((): void => {
    /*
     * Health is judged against the clock, so pin it next to the fixtures'
     * timestamps.
     */
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockRows.clear();
    mockTableProps.clear();
    mockIsMobile = false;
    mockTransport();
  });

  afterEach((): void => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("declares the generic table without ModelTable's own create form and with an Add connection header button", (): void => {
    renderTable([]);

    const props: ModelTableProps<BaseModel> = tableProps();
    expect(props.isCreateable).toBe(false);
    expect(props.isEditable).toBe(false);
    expect(props.formFields).toBeUndefined();
    expect(props.selectMoreFields).toEqual(
      expect.objectContaining({
        lastError: true,
        provider: true,
        config: true,
        alertingOnly: true,
        lastEventIngestedAt: true,
      }),
    );
    expect(props.selectMoreFields).not.toHaveProperty("secrets");
    expect(props.query).toEqual({ projectId: PROJECT_ID });

    const button: CardButtonSchema = props.cardProps
      ?.buttons?.[0] as CardButtonSchema;
    expect(button.title).toBe("Add connection");
    expect(button.disabled).toBe(false);
    expect(
      props.columns.map((column: ModelColumn<BaseModel>): string => {
        return column.title;
      }),
    ).toEqual([
      "Name",
      "Provider",
      "Status",
      "Health",
      "Interval (Minutes)",
      "Last Polled",
      "Last Successful Poll",
      "Last Event Imported",
    ]);
  });

  test("the card names every provider, Google SecOps included", (): void => {
    renderTable([]);

    const props: ModelTableProps<BaseModel> = tableProps();
    expect(props.cardProps?.title).toBe("Security Event Connections");
    expect(props.cardProps?.description).toBe(
      "Poll Microsoft Sentinel, Defender XDR, CrowdStrike Falcon, Splunk, Elastic Security, AWS Security Hub, Okta and Google SecOps as OCSF security events. Test access, run a poll, and inspect imports on demand.",
    );
  });

  test("the empty state explains prerequisites and links every provider's setup guide", (): void => {
    renderTable([]);

    render(
      <MemoryRouter>
        {tableProps().noItemsMessage as ReactElement}
      </MemoryRouter>,
    );

    expect(screen.getByText(/read-only credential/)).toBeVisible();
    expect(screen.getByText(/running OneUptime worker/)).toBeVisible();
    const links: Array<HTMLElement> = within(
      screen.getByRole("list", { name: "Setup guides" }),
    ).getAllByRole("link");
    expect(screen.getAllByRole("link")).toEqual(links);
    expect(
      links.map((link: HTMLElement): string => {
        return link.id.replace(
          "security-event-connections-empty-state-guides-",
          "",
        );
      }),
    ).toEqual([
      SecurityEventConnectorProvider.MicrosoftSentinel,
      SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      SecurityEventConnectorProvider.CrowdStrikeFalcon,
      SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
      SecurityEventConnectorProvider.ElasticSecurity,
      SecurityEventConnectorProvider.AwsSecurityHub,
      SecurityEventConnectorProvider.OktaSystemLog,
      SecurityEventConnectorProvider.GoogleSecOps,
    ]);
    for (const [index, title] of [
      "Microsoft Sentinel",
      "Microsoft Defender XDR",
      "CrowdStrike Falcon",
      "Splunk Enterprise Security",
      "Elastic Security",
      "AWS Security Hub",
      "Okta System Log",
      "Google SecOps",
    ].entries()) {
      expect(within(links[index]!).getByText(title)).toBeVisible();
    }
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("href")).toMatch(
        /\/docs\/integrations\/[a-z-]+$/,
      );
    }
    expect(links[links.length - 1]?.getAttribute("href")).toMatch(
      /\/docs\/integrations\/google-secops$/,
    );
  });

  test("the empty state's Add connection opens the same create form as the card button", async (): Promise<void> => {
    renderTable([]);

    render(
      <MemoryRouter>
        {tableProps().noItemsMessage as ReactElement}
      </MemoryRouter>,
    );

    const button: HTMLElement = screen.getByTestId(
      "security-event-connections-empty-state-add-connection",
    );
    expect(button).toBeEnabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(
      await screen.findByRole("dialog", { name: "Add connection" }),
    ).toBeInTheDocument();
  });

  test("the card button and the empty state's button share one create handler", (): void => {
    renderTable([]);

    const cardButton: CardButtonSchema = tableProps().cardProps
      ?.buttons?.[0] as CardButtonSchema;
    const emptyState: ReactElement<{ onAddConnection: () => void }> =
      tableProps().noItemsMessage as ReactElement<{
        onAddConnection: () => void;
      }>;
    expect(emptyState.props.onAddConnection).toBe(cardButton.onClick);
  });

  /*
   * A provider tile in the empty state passes its provider through the same
   * handler; the form then opens on the Provider step with that card chosen.
   */
  test("the empty state can open the create form with a provider already selected", async (): Promise<void> => {
    renderTable([]);

    const emptyState: ReactElement<{
      onAddConnection: (provider?: SecurityEventConnectorProvider) => void;
    }> = tableProps().noItemsMessage as ReactElement<{
      onAddConnection: (provider?: SecurityEventConnectorProvider) => void;
    }>;

    await act(async (): Promise<void> => {
      emptyState.props.onAddConnection(
        SecurityEventConnectorProvider.CrowdStrikeFalcon,
      );
    });

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add connection",
    });
    expect(
      within(dialog).getByRole("radio", { name: /CrowdStrike Falcon/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(dialog)
        .getAllByRole("radio")
        .filter((radio: HTMLElement): boolean => {
          return radio.getAttribute("aria-checked") === "true";
        }),
    ).toHaveLength(1);
  });

  test("after a provider tile's form is closed, the card button opens a form with nothing chosen", async (): Promise<void> => {
    renderTable([]);

    await act(async (): Promise<void> => {
      (
        tableProps().noItemsMessage as ReactElement<{
          onAddConnection: (provider?: SecurityEventConnectorProvider) => void;
        }>
      ).props.onAddConnection(SecurityEventConnectorProvider.OktaSystemLog);
    });
    const first: HTMLElement = await screen.findByRole("dialog", {
      name: "Add connection",
    });
    expect(
      within(first).getByRole("radio", { name: /Okta System Log/ }),
    ).toHaveAttribute("aria-checked", "true");

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(first).getAllByRole("button", { name: "Close" })[0]!,
      );
    });
    await waitFor((): void => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await act(async (): Promise<void> => {
      (tableProps().cardProps?.buttons?.[0] as CardButtonSchema).onClick();
    });
    const second: HTMLElement = await screen.findByRole("dialog", {
      name: "Add connection",
    });
    expect(
      within(second)
        .getAllByRole("radio")
        .filter((radio: HTMLElement): boolean => {
          return radio.getAttribute("aria-checked") === "true";
        }),
    ).toEqual([]);
  });

  test("members who cannot create connections get a disabled empty-state button with the reason", (): void => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You do not have permission to create connections.",
    });
    renderTable([]);

    const emptyState: ReactElement<{
      canCreate: boolean;
      createDisabledReason?: string;
    }> = tableProps().noItemsMessage as ReactElement<{
      canCreate: boolean;
      createDisabledReason?: string;
    }>;
    expect(emptyState.props.canCreate).toBe(false);
    expect(emptyState.props.createDisabledReason).toBe(
      "You do not have permission to create connections.",
    );

    render(<MemoryRouter>{emptyState}</MemoryRouter>);

    const button: HTMLElement = screen.getByTestId(
      "security-event-connections-empty-state-add-connection",
    );
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The guides stay useful to someone who cannot add a connection.
    expect(
      within(screen.getByRole("list", { name: "Setup guides" })).getAllByRole(
        "link",
      ),
    ).toHaveLength(8);
  });

  /*
   * The help panel used to be two: the framework card's and the retired
   * SecOps card's. Both now live behind the one card's help button.
   */
  test("the help panel is the framework guide followed by the Google SecOps guide", (): void => {
    renderTable([]);

    const help: { title: string; description?: string; markdown: string } =
      tableProps().helpContent as {
        title: string;
        description?: string;
        markdown: string;
      };
    expect(help.title).toBe("How Security Event Connections Work");
    expect(help.markdown).toBe(securityEventConnectionsHelpMarkdown());

    const googleHelp: string =
      ConnectorProviderHelp[SecurityEventConnectorProvider.GoogleSecOps]!
        .markdown;
    const frameworkIndex: number = help.markdown.indexOf(
      "### How Security Event Connections Work",
    );
    const googleIndex: number = help.markdown.indexOf(googleHelp);
    expect(frameworkIndex).toBe(1);
    expect(googleIndex).toBeGreaterThan(frameworkIndex);
    expect(help.markdown).toContain(
      "### How the Google SecOps Connector Works",
    );
    expect(help.markdown).toContain("\n---\n\n### How the Google SecOps");
    expect(help.markdown).toContain(
      "select **Detections** under **Data to import**",
    );
    expect(help.markdown).toContain("row's **Update credentials** action");
    expect(help.markdown).not.toContain("Update Service Account JSON");
    // One section per provider that has help, and only Google has one today.
    expect(connectorProviderHelpEntries()).toHaveLength(1);
  });

  test("shows the catalog title, status and the honest health vocabulary per row", (): void => {
    const imported: SecurityEventConnection = connection({
      _id: "44444444-4444-4444-8444-444444444444",
      name: "Imported Sentinel",
      provider: SecurityEventConnectorProvider.MicrosoftSentinel,
      lastEventIngestedAt: new Date(NOW - 30_000),
    });
    const paused: SecurityEventConnection = connection({
      _id: "55555555-5555-4555-8555-555555555555",
      name: "Paused Splunk",
      provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
      isEnabled: false,
    });
    renderTable([connection(), imported, paused, googleConnection()]);

    expect(row("Acme Okta")).toHaveTextContent("Okta System Log");
    expect(row("Acme Okta")).toHaveTextContent("Enabled");
    expect(row("Acme Okta")).toHaveTextContent(CONNECTOR_HEALTH_NO_EVENTS_YET);
    expect(row("Acme Okta")).not.toHaveTextContent(CONNECTOR_HEALTH_SUCCEEDED);

    expect(row("Imported Sentinel")).toHaveTextContent("Microsoft Sentinel");
    expect(row("Imported Sentinel")).toHaveTextContent(
      CONNECTOR_HEALTH_SUCCEEDED,
    );

    expect(row("Paused Splunk")).toHaveTextContent(
      "Splunk Enterprise Security",
    );
    expect(row("Paused Splunk")).toHaveTextContent("Disabled");
    expect(row("Paused Splunk")).toHaveTextContent("Schedule paused");

    // A Google row is judged by the same rule: no import yet is not success.
    expect(row("Customer SecOps")).toHaveTextContent("Google SecOps");
    expect(row("Customer SecOps")).toHaveTextContent(
      CONNECTOR_HEALTH_NO_EVENTS_YET,
    );
  });

  /*
   * The retired SecOps table had a Scope column. "Alerts only" is still
   * visible at a glance, under the provider name, for a provider whose
   * records have an alerting distinction, and absent for every other one.
   */
  test("a Google SecOps row shows its Data to import choice under the provider name", (): void => {
    renderTable([
      googleConnection({ alertingOnly: true }),
      googleConnection({
        _id: "66666666-6666-4666-8666-666666666666",
        name: "All detections",
        alertingOnly: false,
      }),
      connection(),
    ]);

    const alertsOnly: HTMLElement = row("Customer SecOps");
    const providerCell: HTMLElement = within(alertsOnly).getByText(
      "Google SecOps",
    ).parentElement as HTMLElement;
    expect(providerCell).toHaveTextContent("Google SecOpsAlerts only");
    expect(within(providerCell).getByText("Alerts only")).toHaveClass(
      "text-gray-500",
    );

    expect(row("All detections")).toHaveTextContent(
      "Google SecOpsAlerts and detections",
    );
    expect(row("All detections")).not.toHaveTextContent("Alerts only");

    expect(row("Acme Okta")).not.toHaveTextContent("Alerts only");
    expect(row("Acme Okta")).not.toHaveTextContent("Alerts and detections");
  });

  test("read-only members keep View Error and Diagnostics while every write action is locked", (): void => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You do not have permission to update connections.",
    });
    renderTable([
      connection({ lastError: "Okta System Log request failed (HTTP 401)" }),
    ]);

    const current: HTMLElement = row();
    for (const title of [
      "Test connection",
      "Run now",
      "Edit",
      "Update credentials",
    ]) {
      expect(
        within(current).getByRole("button", { name: title }),
      ).toBeDisabled();
    }
    expect(
      within(current).getByRole("button", { name: "Diagnostics" }),
    ).toBeEnabled();
    expect(
      within(current).getByRole("button", { name: "View Error" }),
    ).toBeEnabled();

    const button: CardButtonSchema = tableProps().cardProps
      ?.buttons?.[0] as CardButtonSchema;
    expect(button.disabled).toBe(true);
    expect(button.tooltip).toBe(
      "You do not have permission to update connections.",
    );
    expect(API.post).not.toHaveBeenCalled();
  });

  test("View Error appears only for rows with an error and opens the full message", (): void => {
    renderTable([
      connection({ lastError: "Okta System Log request failed (HTTP 401)" }),
      connection({
        _id: "44444444-4444-4444-8444-444444444444",
        name: "Healthy",
      }),
    ]);

    expect(
      within(row("Healthy")).queryByRole("button", { name: "View Error" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(row()).getByRole("button", { name: "View Error" }));
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Last Error",
    });
    expect(
      within(dialog).getByLabelText("Full error message").textContent,
    ).toBe("Okta System Log request failed (HTTP 401)");
  });

  test("Test connection posts the connection id to the synchronous test route and shows the checklist", async (): Promise<void> => {
    renderTable([connection()]);

    fireEvent.click(
      within(row()).getByRole("button", { name: "Test connection" }),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Test connection: Acme Okta",
    });
    expect(
      await within(dialog).findByText("Passed with warnings"),
    ).toBeVisible();
    expect(dialog).toHaveTextContent("Access to Okta System Log");
    expect(dialog).toHaveTextContent("What is available to import");

    expect(API.post).toHaveBeenCalledTimes(1);
    expect(postCall()["data"]).toEqual({ connectionId: CONNECTION_ID });
    expect(postCall()["headers"]).toEqual({
      "project-id": PROJECT_ID.toString(),
    });
    const destination: globalThis.URL = new globalThis.URL(
      String(postCall()["url"]),
    );
    expect(destination.pathname).toMatch(/\/security-event-connection\/test$/);
    expect(Array.from(destination.searchParams.keys()).sort()).toEqual([]);
  });

  /*
   * Ported from the retired Google SecOps page: a Google row's test is the
   * same synchronous checklist, now through the shared route.
   */
  test("a Google SecOps row tests synchronously through the shared test route", async (): Promise<void> => {
    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPResponse(
          200,
          report("google-secops") as unknown as JSONObject,
          {},
        ),
      );
    renderTable([googleConnection()]);

    fireEvent.click(
      within(row("Customer SecOps")).getByRole("button", {
        name: "Test connection",
      }),
    );
    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Test connection: Customer SecOps",
    });
    expect(
      await within(dialog).findByText("Passed with warnings"),
    ).toBeVisible();
    expect(dialog).toHaveTextContent("Access to Google SecOps");
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(postCall()["data"]).toEqual({ connectionId: GOOGLE_ID });
    expect(new globalThis.URL(String(postCall()["url"])).pathname).toMatch(
      /\/security-event-connection\/test$/,
    );
  });

  test("Run now opens diagnostics and queues a poll for that connection", async (): Promise<void> => {
    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPResponse(
          200,
          { runId: "66666666-6666-4666-8666-666666666666" },
          {},
        ),
      );
    renderTable([connection()]);

    fireEvent.click(within(row()).getByRole("button", { name: "Run now" }));

    expect(
      await screen.findByRole("dialog", {
        name: "Connection diagnostics: Acme Okta",
      }),
    ).toBeVisible();
    await waitFor((): void => {
      expect(API.post).toHaveBeenCalledTimes(1);
    });
    expect(postCall()["data"]).toEqual({ type: "poll" });
    expect(new globalThis.URL(String(postCall()["url"])).pathname).toMatch(
      new RegExp(`/security-event-connection/${CONNECTION_ID}/run$`),
    );
    // The diagnostics modal never selects the write-only secrets column.
    expect(
      jest.mocked(ModelAPI.getItem).mock.calls[0]?.[0].select,
    ).not.toHaveProperty("secrets");
  });

  test("Diagnostics shows the same health wording and UTC times with a local-time title", async (): Promise<void> => {
    renderTable([connection()]);

    fireEvent.click(within(row()).getByRole("button", { name: "Diagnostics" }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Connection diagnostics: Acme Okta",
    });
    expect(
      within(dialog).getByRole("region", { name: "Scheduled polling" }),
    ).toHaveTextContent(CONNECTOR_HEALTH_NO_EVENTS_YET);
    const lastAttempt: HTMLElement = within(dialog).getAllByText(
      "2026-09-10 11:59:00 UTC",
    )[0] as HTMLElement;
    expect(lastAttempt.getAttribute("title")).toMatch(/^Local time: /);
    expect(API.post).not.toHaveBeenCalled();
  });

  test("Diagnostics for a Google SecOps row speaks in detections and Data to import", async (): Promise<void> => {
    jest
      .mocked(ModelAPI.getItem)
      .mockResolvedValue(googleConnection({ alertingOnly: false }));
    renderTable([googleConnection({ alertingOnly: false })]);

    fireEvent.click(
      within(row("Customer SecOps")).getByRole("button", {
        name: "Diagnostics",
      }),
    );
    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Connection diagnostics: Customer SecOps",
    });
    const scheduled: HTMLElement = within(dialog).getByRole("region", {
      name: "Scheduled polling",
    });
    expect(within(scheduled).getByText("Data to import")).toBeVisible();
    expect(within(scheduled).getByText("Alerts and detections")).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Preview detections" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Preview records" }),
    ).not.toBeInTheDocument();
  });

  /*
   * stale-report-after-failed-rerun: Diagnostics kept the previous
   * checklist when a later Test connection request failed.
   */
  test("Diagnostics Test connection clears the previous checklist when a re-run fails", async (): Promise<void> => {
    renderTable([connection()]);

    fireEvent.click(within(row()).getByRole("button", { name: "Diagnostics" }));
    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Connection diagnostics: Acme Okta",
    });
    const checks: HTMLElement = within(dialog).getByRole("region", {
      name: "On-demand checks",
    });

    fireEvent.click(
      within(checks).getByRole("button", { name: "Test connection" }),
    );
    expect(
      await within(checks).findByText("Passed with warnings"),
    ).toBeVisible();

    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPErrorResponse(
          502,
          { message: "The API could not reach Okta." },
          {},
        ),
      );
    fireEvent.click(
      within(checks).getByRole("button", { name: "Test connection" }),
    );

    expect(
      await within(checks).findByText("The API could not reach Okta."),
    ).toBeVisible();
    expect(
      within(checks).queryByText("Passed with warnings"),
    ).not.toBeInTheDocument();
    expect(
      within(checks).queryByRole("region", { name: "Connection test report" }),
    ).not.toBeInTheDocument();
  });

  test("Edit and Update credentials open the form modal in the matching mode", async (): Promise<void> => {
    renderTable([connection()]);

    fireEvent.click(within(row()).getByRole("button", { name: "Edit" }));
    const edit: HTMLElement = await screen.findByRole("dialog", {
      name: "Edit connection: Acme Okta",
    });
    expect(within(edit).getByLabelText(/^Okta organization URL/)).toHaveValue(
      "https://acme.okta.com",
    );
    fireEvent.click(within(edit).getAllByRole("button", { name: "Close" })[0]!);
    await waitFor((): void => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    fireEvent.click(
      within(row()).getByRole("button", { name: "Update credentials" }),
    );
    const credentials: HTMLElement = await screen.findByRole("dialog", {
      name: "Update credentials: Acme Okta",
    });
    expect(within(credentials).getByLabelText(/^API token/)).toHaveAttribute(
      "placeholder",
      "Unchanged",
    );
    expect(
      within(credentials).queryByLabelText(/^Okta organization URL/),
    ).not.toBeInTheDocument();
  });
});

/*
 * Security Events > Connections used to render this table above a second,
 * Google-only table. It is now just the reseller gate and this table.
 */
describe("Security Events > Connections page", () => {
  beforeEach((): void => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockRows.clear();
    mockTableProps.clear();
    mockIsMobile = false;
    mockTransport();
  });

  afterEach((): void => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function renderPage(project: Project | null): void {
    render(
      <MemoryRouter>
        <SecurityEventsConnectionsPage
          pageRoute={new Route("/dashboard/security-events/connections")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  function project(enableTelemetryFeatures?: boolean): Project {
    const value: Project = new Project();
    value.id = PROJECT_ID;
    if (enableTelemetryFeatures !== undefined) {
      const reseller: Reseller = new Reseller();
      reseller.enableTelemetryFeatures = enableTelemetryFeatures;
      value.reseller = reseller;
    }
    return value;
  }

  test("renders one table, where a Google SecOps connection is a row like any other", async (): Promise<void> => {
    mockRows.set("SecurityEventConnection", [connection(), googleConnection()]);
    await act(async (): Promise<void> => {
      renderPage(project());
    });

    expect(
      screen.getAllByRole("table").map((table: HTMLElement): string | null => {
        return table.getAttribute("aria-label");
      }),
    ).toEqual(["Security Event Connections"]);
    expect(Array.from(mockTableProps.keys())).toEqual([
      "SecurityEventConnection",
    ]);
    expect(row("Customer SecOps")).toHaveTextContent("Google SecOps");
    expect(row("Acme Okta")).toHaveTextContent("Okta System Log");
    expect(screen.queryByText(RESELLER_MESSAGE)).not.toBeInTheDocument();
  });

  test.each([
    ["a plan that includes telemetry", true],
    ["no reseller plan", undefined],
  ])(
    "shows the table for %s",
    async (_label: string, enabled: boolean | undefined): Promise<void> => {
      await act(async (): Promise<void> => {
        renderPage(project(enabled));
      });

      expect(
        screen.getByRole("table", { name: "Security Event Connections" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(RESELLER_MESSAGE)).not.toBeInTheDocument();
    },
  );

  test("shows the table while the project is still loading", async (): Promise<void> => {
    await act(async (): Promise<void> => {
      renderPage(null);
    });

    expect(
      screen.getByRole("table", { name: "Security Event Connections" }),
    ).toBeInTheDocument();
  });

  test("a reseller plan without telemetry shows only the gate message", async (): Promise<void> => {
    mockRows.set("SecurityEventConnection", [googleConnection()]);
    await act(async (): Promise<void> => {
      renderPage(project(false));
    });

    expect(screen.getByText(RESELLER_MESSAGE)).toBeVisible();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
    expect(mockTableProps.size).toBe(0);
    expect(API.post).not.toHaveBeenCalled();
  });
});

/*
 * Ported from the retired GoogleSecOpsConnectionsErrors suite. Last Error
 * used to be a truncated column; the outage behind this page was an error
 * nobody could read. It is now an action that opens the complete message
 * and copies it for support, on both row layouts.
 */
describe("Last Error actions", () => {
  const originalClipboard: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText: ReturnType<typeof jest.fn<(text: string) => Promise<void>>> =
    jest.fn<(text: string) => Promise<void>>();

  const LONG_ERROR: string =
    "Google SecOps alerts fetch failed (HTTP 400):\n" +
    "Customer context: café / 日本語 / 🚨\n" +
    JSON.stringify(
      {
        error: {
          message: "Request contains an invalid argument.",
          details: [
            {
              description: "Diagnostic context ".repeat(600),
              field: "instance",
              resolution:
                "Verify the instance resource name in tenant settings.",
              received: "<script>alert('literal error text')</script>",
            },
          ],
        },
      },
      null,
      2,
    );

  function errorConnection(
    name: string,
    error: string | null | undefined,
  ): SecurityEventConnection {
    const value: SecurityEventConnection = googleConnection({
      _id: ObjectID.generate().toString(),
      name,
    });
    if (error !== undefined) {
      // API responses can contain null even though the model field is a string.
      value.lastError = error as string;
    }
    return value;
  }

  function openError(connectionName: string = "Production"): HTMLElement {
    fireEvent.click(
      within(screen.getByTestId(connectionName)).getByRole("button", {
        name: "View Error",
      }),
    );
    act((): void => {
      // Finish the modal's entry animation without relying on wall-clock timing.
      jest.advanceTimersByTime(80);
    });
    return screen.getByRole("dialog", { name: "Last Error" });
  }

  beforeEach((): void => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockRows.clear();
    mockTableProps.clear();
    mockIsMobile = false;
    writeText.mockReset();
    writeText.mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockTransport();
  });

  afterEach((): void => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll((): void => {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  test("replaces the Last Error column with an action while still fetching the stored error", (): void => {
    renderTable([errorConnection("Production", LONG_ERROR)]);

    expect(
      screen.queryByRole("columnheader", { name: "Last Error" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    expect(tableProps().selectMoreFields).toEqual(
      expect.objectContaining({ lastError: true }),
    );

    const current: HTMLElement = screen.getByTestId("Production");
    const viewError: HTMLElement = within(current).getByRole("button", {
      name: "View Error",
    });
    expect(viewError).toBeEnabled();
    expect(viewError.closest("td")).toBe(
      current.querySelector("td:last-child"),
    );
    expect(current).not.toHaveTextContent("Google SecOps alerts fetch failed");
    expect(screen.queryByRole("button", { name: "Copy Error" })).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  describe.each([
    { layout: "desktop", isMobile: false },
    { layout: "mobile", isMobile: true },
  ])("$layout rows", ({ isMobile }: { isMobile: boolean }): void => {
    beforeEach((): void => {
      mockIsMobile = isMobile;
    });

    test.each([undefined, null, ""])(
      "shows no error action for a healthy connection with lastError=%s",
      (error: string | null | undefined): void => {
        renderTable([errorConnection("Production", error)]);

        expect(screen.getByTestId("Production")).toBeVisible();
        expect(screen.queryByRole("button", { name: "View Error" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Copy Error" })).toBeNull();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(writeText).not.toHaveBeenCalled();
      },
    );

    test("opens and copies the complete multiline error, then can reopen after closing", async (): Promise<void> => {
      renderTable([errorConnection("Production", LONG_ERROR)]);

      const dialog: HTMLElement = openError();
      expect(dialog).toHaveTextContent(
        "Copy this message when contacting support. Credentials are redacted.",
      );
      const fullError: HTMLElement =
        within(dialog).getByLabelText("Full error message");
      expect(fullError.textContent).toBe(LONG_ERROR);
      expect(fullError.tagName).toBe("PRE");
      expect(fullError).toHaveAttribute("tabindex", "0");
      expect(dialog.querySelector("script")).toBeNull();

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog).getByRole("button", { name: "Copy Error" }),
        );
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(LONG_ERROR);
      expect(within(dialog).getByText("Copied!")).toBeVisible();

      act((): void => {
        jest.advanceTimersByTime(1000);
      });
      expect(
        within(dialog).getByRole("button", { name: "Copy Error" }),
      ).toHaveTextContent("Copy Error");

      fireEvent.click(
        within(dialog).getAllByRole("button", { name: "Close" })[1]!,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copy Error" })).toBeNull();
      expect(screen.getByRole("button", { name: "View Error" })).toBeEnabled();

      // A missing action-completion callback leaves this button stuck loading.
      expect(
        within(openError()).getByLabelText("Full error message").textContent,
      ).toBe(LONG_ERROR);
    });

    test.each(["Enter", " "])(
      "copies the full message from the dialog with the %s key",
      async (key: string): Promise<void> => {
        renderTable([errorConnection("Production", LONG_ERROR)]);
        const dialog: HTMLElement = openError();
        await act(async (): Promise<void> => {
          fireEvent.keyDown(
            within(dialog).getByRole("button", { name: "Copy Error" }),
            { key },
          );
        });
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith(LONG_ERROR);
      },
    );

    test("opens the selected connection's error and leaves healthy rows without the action", async (): Promise<void> => {
      const firstError: string = "First tenant: permission denied";
      const secondError: string = "Second tenant: instance not found";
      renderTable([
        errorConnection("First tenant", firstError),
        errorConnection("Healthy tenant", undefined),
        errorConnection("Second tenant", secondError),
      ]);

      expect(
        screen.getAllByRole("button", { name: "View Error" }),
      ).toHaveLength(2);
      expect(
        within(screen.getByTestId("Healthy tenant")).queryByRole("button", {
          name: "View Error",
        }),
      ).toBeNull();

      const secondDialog: HTMLElement = openError("Second tenant");
      expect(
        within(secondDialog).getByLabelText("Full error message").textContent,
      ).toBe(secondError);
      await act(async (): Promise<void> => {
        fireEvent.click(
          within(secondDialog).getByRole("button", { name: "Copy Error" }),
        );
      });
      expect(writeText).toHaveBeenCalledWith(secondError);
      fireEvent.click(
        within(secondDialog).getAllByRole("button", { name: "Close" })[0]!,
      );

      const firstDialog: HTMLElement = openError("First tenant");
      expect(
        within(firstDialog).getByLabelText("Full error message").textContent,
      ).toBe(firstError);
    });

    test("hides a cleared error after refresh and opens the latest error if the connection fails again", (): void => {
      const current: SecurityEventConnection = errorConnection(
        "Production",
        "Previous failure",
      );
      const view: RenderResult = renderTable([current]);

      openError();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      current.lastError = "";
      view.rerender(tableElement());
      expect(screen.queryByRole("button", { name: "View Error" })).toBeNull();

      current.lastError = "Latest failure after a successful poll";
      view.rerender(tableElement());
      expect(
        within(openError()).getByLabelText("Full error message").textContent,
      ).toBe(current.lastError);
    });

    test("allows read-only members to view and copy errors while update actions remain disabled", async (): Promise<void> => {
      jest.spyOn(PermissionGate, "check").mockReturnValue({
        isAllowed: false,
        disabledReason: "You do not have permission to update connections.",
      });
      const error: string =
        "Google SecOps alerts fetch failed (HTTP 403): permission denied";
      renderTable([errorConnection("Production", error)]);

      for (const title of [
        "Test connection",
        "Run now",
        "Edit",
        "Update credentials",
      ]) {
        expect(screen.getByRole("button", { name: title })).toBeDisabled();
      }
      expect(screen.getByRole("button", { name: "View Error" })).toBeEnabled();

      const dialog: HTMLElement = openError();
      expect(
        within(dialog).getByLabelText("Full error message").textContent,
      ).toBe(error);
      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog).getByRole("button", { name: "Copy Error" }),
        );
      });
      expect(writeText).toHaveBeenCalledWith(error);
    });
  });
});

/*
 * A window that cannot be read in one poll no longer pins polling (review
 * findings bound-hit-window-never-advances and
 * alerts-view-budget-pins-cursor-forever). The poller records what it did
 * in chunkMinutes, nextChunkMinutes and forcedAdvance; run details must say
 * it plainly, and a forced advance must name the range to import.
 */
describe("run details for a window one poll could not read", () => {
  function run(
    overrides: Partial<SecurityEventConnectionRunResult>,
    type: SecurityEventConnectionRun["type"] = "poll",
  ): SecurityEventConnectionRun {
    const value: SecurityEventConnectionRun = new SecurityEventConnectionRun();
    value._id = "77777777-7777-4777-8777-777777777777";
    value.securityEventConnectionId = new ObjectID(CONNECTION_ID);
    value.type = type;
    value.status = overrides.status || "partial";
    value.startedAt = new Date("2026-09-10T12:00:00Z");
    value.completedAt = new Date("2026-09-10T12:00:05Z");
    value.result = pollResult({
      type: type || "poll",
      provider: SecurityEventConnectorProvider.AwsSecurityHub,
      status: "partial",
      complete: false,
      windowStart: "2026-09-10T11:29:00Z",
      windowEnd: "2026-09-10T12:00:00Z",
      ...overrides,
    }) as unknown as JSONObject;
    return value;
  }

  function renderRun(value: SecurityEventConnectionRun): HTMLElement {
    render(
      <MemoryRouter>
        <SecurityEventConnectionRunDetails run={value} />
      </MemoryRouter>,
    );
    return screen.getByRole("region", { name: "Run details" });
  }

  afterEach((): void => {
    cleanup();
  });

  test("a forced advance is an alert naming the minute to import", (): void => {
    const details: HTMLElement = renderRun(
      run({
        chunkMinutes: 1,
        nextChunkMinutes: 1,
        forcedAdvance: true,
        warnings: [
          "More records were created in the one minute from 2026-09-10T11:59:00.000Z to 2026-09-10T12:00:00.000Z than one poll can read.",
        ],
      }),
    );

    const forcedAdvanceNotice: RegExp = /Polling moved past one minute/;
    const alert: HTMLElement = within(details)
      .getAllByRole("alert")
      .find((element: HTMLElement): boolean => {
        return forcedAdvanceNotice.test(element.textContent || "");
      }) as HTMLElement;
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent(
      "More findings were created in one minute than one poll can read.",
    );
    expect(alert).toHaveTextContent(
      "use Import this time range under Find historical findings for 2026-09-10 11:59:00 UTC → 2026-09-10 12:00:00 UTC",
    );
    expect(details).toHaveTextContent("Window read by this poll1 minute");
    // The specific notice replaces the generic "did not finish" line.
    expect(details).not.toHaveTextContent("did not finish processing");
    // The poller's own warning is still listed verbatim.
    expect(details).toHaveTextContent(
      "More records were created in the one minute from",
    );
  });

  test("a narrowed window says the next poll reads a shorter window from the same start", (): void => {
    const details: HTMLElement = renderRun(
      run({ chunkMinutes: 1440, nextChunkMinutes: 720 }),
    );

    expect(details).toHaveTextContent("Window read by this poll24 hours");
    expect(details).toHaveTextContent(
      "Next scheduled poll readsUp to 12 hours",
    );
    expect(details).toHaveTextContent(
      "The next scheduled poll reads a window of 12 hours from the same starting point",
    );
    expect(details).not.toHaveTextContent("Polling moved past one minute");
    expect(details).not.toHaveTextContent("moved the cursor to the last");
  });

  test("a resumed window says the cursor moved to the last record read", (): void => {
    const details: HTMLElement = renderRun(
      run({ chunkMinutes: 60, nextChunkMinutes: 60 }),
    );

    expect(details).toHaveTextContent("1 hour, the same length");
    expect(details).toHaveTextContent(
      "moved the cursor to the last finding it read. The next scheduled poll continues from there with a window of 1 hour.",
    );
    expect(details).not.toHaveTextContent("from the same starting point");
  });

  test("a complete poll widens the next window without any alert", (): void => {
    const details: HTMLElement = renderRun(
      run({
        status: "success",
        complete: true,
        chunkMinutes: 30,
        nextChunkMinutes: 60,
      }),
    );

    expect(details).toHaveTextContent("Next scheduled poll readsUp to 1 hour");
    expect(within(details).queryAllByRole("alert")).toHaveLength(0);
  });

  test("a failed poll keeps its window and raises no volume notice", (): void => {
    const details: HTMLElement = renderRun(
      run({
        status: "failed",
        chunkMinutes: 30,
        nextChunkMinutes: 30,
        error: "AWS Security Hub request failed (HTTP 503)",
      }),
    );

    expect(details).toHaveTextContent(
      "A failed poll does not change the window",
    );
    expect(details).not.toHaveTextContent("moved the cursor to the last");
    // A failure is not a volume signal: no narrowing notice.
    expect(details).not.toHaveTextContent("reads a window of");
    expect(details).not.toHaveTextContent("than one poll can read");
  });

  test("runs without window fields keep the generic notice, with range advice for imports", (): void => {
    const details: HTMLElement = renderRun(run({}, "backfill"));

    expect(details).toHaveTextContent(
      "This run did not finish processing every record in the window. Choose a shorter time range to read the rest",
    );
    expect(
      within(details).queryByTestId("poll-window-progress"),
    ).not.toBeInTheDocument();
  });
});

describe("connection health vocabulary", () => {
  test("a succeeding poll that never imported reads as polling, not success", (): void => {
    const item: SecurityEventConnection = connection();
    expect(connectorHealth(item, NOW)).toBe(CONNECTOR_HEALTH_NO_EVENTS_YET);

    item.lastEventIngestedAt = new Date(NOW - 30_000);
    expect(connectorHealth(item, NOW)).toBe(CONNECTOR_HEALTH_SUCCEEDED);
  });

  test("walks every other state in order of precedence", (): void => {
    const item: SecurityEventConnection = connection({
      lastPolledAt: undefined,
      lastSuccessfulPollAt: undefined,
      lastPollResult: undefined,
      createdAt: new Date(NOW - 60_000),
    });
    expect(connectorHealth(item, NOW)).toBe("Waiting for first poll");
    item.lastPolledAt = new Date(NOW - 60_000);
    expect(connectorHealth(item, NOW)).toBe("Details unavailable");
    item.lastPollResult = pollResult({
      status: "empty",
      windowEnd: "2026-09-10T12:00:00Z",
    }) as unknown as JSONObject;
    expect(connectorHealth(item, NOW)).toBe("No records returned");
    item.lastError = "Permission denied";
    expect(connectorHealth(item, NOW)).toBe("Last poll failed");
    item.lastPolledAt = new Date(NOW - 8 * 60_000);
    expect(connectorHealth(item, NOW)).toBe("Poll overdue");
    item.isEnabled = false;
    expect(connectorHealth(item, NOW)).toBe("Schedule paused");
  });
});
