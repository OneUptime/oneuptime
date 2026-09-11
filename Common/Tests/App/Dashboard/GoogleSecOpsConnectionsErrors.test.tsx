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
import GoogleSecOpsConnectionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/GoogleSecOpsConnections";
import GoogleSecOpsConnection from "../../../Models/DatabaseModels/GoogleSecOpsConnection";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ModelColumn from "../../../UI/Components/ModelTable/Column";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import TableRow from "../../../UI/Components/Table/TableRow";
import TableColumn from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

let mockConnections: Array<GoogleSecOpsConnection> = [];
let mockTableProps: ModelTableProps<GoogleSecOpsConnection> | undefined;
let mockIsMobile: boolean = false;

/*
 * Replace only the ModelTable data-loading boundary. The real TableRow decides
 * action visibility, dispatches the selected row, and completes its loading
 * state. The page's modal, buttons and clipboard behavior also remain real.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<GoogleSecOpsConnection>): ReactElement => {
      mockTableProps = props;
      const columns: Array<TableColumn<GoogleSecOpsConnection>> = [
        ...props.columns.map(
          (
            column: ModelColumn<GoogleSecOpsConnection>,
          ): TableColumn<GoogleSecOpsConnection> => {
            return {
              title: column.title,
              type: column.type,
              key: Object.keys(column.field)[0] as keyof GoogleSecOpsConnection,
              getElement: column.getElement,
              noValueMessage: column.noValueMessage,
            };
          },
        ),
        { title: "Actions", type: FieldType.Actions },
      ];

      if (mockIsMobile) {
        return (
          <div>
            {mockConnections.map(
              (connection: GoogleSecOpsConnection): ReactElement => {
                return (
                  <section key={connection._id} data-testid={connection.name}>
                    <TableRow
                      item={connection}
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
        <table aria-label="Google SecOps Connections">
          <thead>
            <tr>
              {columns.map(
                (column: TableColumn<GoogleSecOpsConnection>): ReactElement => {
                  return <th key={column.title}>{column.title}</th>;
                },
              )}
            </tr>
          </thead>
          {mockConnections.map(
            (connection: GoogleSecOpsConnection): ReactElement => {
              return (
                <tbody key={connection._id} data-testid={connection.name}>
                  <TableRow
                    item={connection}
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

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
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
            resolution: "Verify the instance resource name in tenant settings.",
            received: "<script>alert('literal error text')</script>",
          },
        ],
      },
    },
    null,
    2,
  );

const originalClipboard: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText: ReturnType<typeof jest.fn<(text: string) => Promise<void>>> =
  jest.fn<(text: string) => Promise<void>>();

function createConnection(
  name: string,
  error: string | null | undefined,
): GoogleSecOpsConnection {
  const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  connection.id = ObjectID.generate();
  connection.name = name;
  if (error !== undefined) {
    // API responses can contain null even though the optional model field is string.
    connection.lastError = error as string;
  }
  return connection;
}

function pageElement(): ReactElement {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  return (
    <MemoryRouter>
      <GoogleSecOpsConnectionsPage
        pageRoute={new Route("/dashboard/security-events/google-secops")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>
  );
}

function renderPage(connections: Array<GoogleSecOpsConnection>): RenderResult {
  mockConnections = connections;
  return render(pageElement());
}

function openError(connectionName: string = "Production"): HTMLElement {
  fireEvent.click(
    within(screen.getByTestId(connectionName)).getByRole("button", {
      name: "View Error",
    }),
  );
  return screen.getByRole("dialog", { name: "Last Error" });
}

describe("Google SecOps connection error actions", () => {
  beforeEach((): void => {
    mockConnections = [];
    mockTableProps = undefined;
    mockIsMobile = false;
    writeText.mockReset();
    writeText.mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach((): void => {
    cleanup();
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
    renderPage([createConnection("Production", LONG_ERROR)]);

    expect(
      screen.queryByRole("columnheader", { name: "Last Error" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    expect(mockTableProps?.selectMoreFields).toEqual(
      expect.objectContaining({ lastError: true }),
    );

    const row: HTMLElement = screen.getByTestId("Production");
    const viewError: HTMLElement = within(row).getByRole("button", {
      name: "View Error",
    });
    expect(viewError).toBeEnabled();
    expect(viewError.closest("td")).toBe(row.querySelector("td:last-child"));
    expect(row).not.toHaveTextContent("Google SecOps alerts fetch failed");
    expect(screen.queryByRole("button", { name: "Copy Error" })).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  describe.each([
    { layout: "desktop", isMobile: false },
    { layout: "mobile", isMobile: true },
  ])("$layout actions", ({ isMobile }: { isMobile: boolean }): void => {
    beforeEach((): void => {
      mockIsMobile = isMobile;
    });

    test.each([undefined, null, ""])(
      "shows no error action for a healthy connection with lastError=%s",
      (error: string | null | undefined): void => {
        renderPage([createConnection("Production", error)]);

        expect(screen.getByTestId("Production")).toBeVisible();
        expect(screen.queryByRole("button", { name: "View Error" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Copy Error" })).toBeNull();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(writeText).not.toHaveBeenCalled();
      },
    );

    test("opens and copies the complete multiline error, then can reopen after closing", async (): Promise<void> => {
      renderPage([createConnection("Production", LONG_ERROR)]);

      const dialog: HTMLElement = openError();
      const fullError: HTMLElement =
        within(dialog).getByLabelText("Full error message");
      expect(fullError.textContent).toBe(LONG_ERROR);
      expect(fullError.tagName).toBe("PRE");
      expect(fullError).toHaveAttribute("tabindex", "0");
      expect(dialog.querySelector("script")).toBeNull();

      fireEvent.click(
        within(dialog).getByRole("button", { name: "Copy Error" }),
      );

      await waitFor((): void => {
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith(LONG_ERROR);
      });
      expect(await within(dialog).findByText("Copied!")).toBeVisible();

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
        renderPage([createConnection("Production", LONG_ERROR)]);
        const dialog: HTMLElement = openError();
        fireEvent.keyDown(
          within(dialog).getByRole("button", { name: "Copy Error" }),
          {
            key,
          },
        );
        await waitFor((): void => {
          expect(writeText).toHaveBeenCalledTimes(1);
          expect(writeText).toHaveBeenCalledWith(LONG_ERROR);
        });
      },
    );

    test("opens the selected connection's error and leaves healthy rows without the action", async (): Promise<void> => {
      const firstError: string = "First tenant: permission denied";
      const secondError: string = "Second tenant: instance not found";
      renderPage([
        createConnection("First tenant", firstError),
        createConnection("Healthy tenant", undefined),
        createConnection("Second tenant", secondError),
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
      fireEvent.click(
        within(secondDialog).getByRole("button", { name: "Copy Error" }),
      );
      await waitFor((): void => {
        expect(writeText).toHaveBeenCalledWith(secondError);
      });
      fireEvent.click(
        within(secondDialog).getAllByRole("button", { name: "Close" })[0]!,
      );

      const firstDialog: HTMLElement = openError("First tenant");
      expect(
        within(firstDialog).getByLabelText("Full error message").textContent,
      ).toBe(firstError);
    });

    test("hides a cleared error after refresh and opens the latest error if the connection fails again", (): void => {
      const connection: GoogleSecOpsConnection = createConnection(
        "Production",
        "Previous failure",
      );
      const page: RenderResult = renderPage([connection]);

      openError();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      connection.lastError = "";
      page.rerender(pageElement());
      expect(screen.queryByRole("button", { name: "View Error" })).toBeNull();

      connection.lastError = "Latest failure after a successful poll";
      page.rerender(pageElement());
      expect(
        within(openError()).getByLabelText("Full error message").textContent,
      ).toBe(connection.lastError);
    });

    test("allows read-only members to view and copy errors while update actions remain disabled", async (): Promise<void> => {
      jest.spyOn(PermissionGate, "check").mockReturnValue({
        isAllowed: false,
        disabledReason: "You do not have permission to update connections.",
      });
      const error: string =
        "Google SecOps alerts fetch failed (HTTP 403): permission denied";
      renderPage([createConnection("Production", error)]);

      expect(
        screen.getByRole("button", { name: "Test connection" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Run now" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Update Service Account JSON" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "View Error" })).toBeEnabled();

      const dialog: HTMLElement = openError();
      expect(
        within(dialog).getByLabelText("Full error message").textContent,
      ).toBe(error);
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Copy Error" }),
      );
      await waitFor((): void => {
        expect(writeText).toHaveBeenCalledWith(error);
      });
    });
  });
});
