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
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

interface TableColumn {
  title: string;
  getElement?: (item: GoogleSecOpsConnection) => ReactElement;
}

let mockConnections: Array<GoogleSecOpsConnection> = [];

/*
 * Supply table rows while exercising the page's real cell, modal and copy
 * button. The table's API, pagination and editing controls are unrelated.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { columns: Array<TableColumn> }): ReactElement => {
      const errorColumn: TableColumn | undefined = props.columns.find(
        (column: TableColumn): boolean => {
          return column.title === "Last Error";
        },
      );

      return (
        <div>
          {mockConnections.map(
            (connection: GoogleSecOpsConnection): ReactElement => {
              return (
                <div key={connection._id} data-testid="connection-error">
                  {errorColumn?.getElement?.(connection)}
                </div>
              );
            },
          )}
        </div>
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
/*
 * `jest` here is the one imported from @jest/globals, whose fn() is generic
 * over the function type. Naming the result through ReturnType keeps that
 * type rather than the ambient @types/jest `Mock<Return, Args>`, which is a
 * different shape and does not accept it.
 */
const writeText: ReturnType<typeof jest.fn<(text: string) => Promise<void>>> =
  jest.fn<(text: string) => Promise<void>>();

function renderPage(error: string | null | undefined): void {
  const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  connection._id = "22222222-2222-4222-8222-222222222222";
  if (error !== undefined) {
    connection.lastError = error as string;
  }
  mockConnections = [connection];

  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <GoogleSecOpsConnectionsPage
        pageRoute={new Route("/dashboard/security-events/google-secops")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

describe("Google SecOps complete error messages", () => {
  beforeEach((): void => {
    mockConnections = [];
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

  test("copies the complete stored message directly from its shortened row preview", async (): Promise<void> => {
    renderPage(LONG_ERROR);

    const row: HTMLElement = screen.getByTestId("connection-error");
    expect(row.textContent).toContain("Google SecOps alerts fetch failed");
    expect(row.textContent).not.toContain("Verify the instance resource name");
    expect(row.textContent).not.toContain(LONG_ERROR);

    fireEvent.click(screen.getByRole("button", { name: "Copy Error" }));

    await waitFor((): void => {
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(LONG_ERROR);
    });
    expect(await screen.findByText("Copied!")).toBeVisible();
  });

  test("opens, copies and closes the full error without losing line breaks or trailing details", async (): Promise<void> => {
    renderPage(LONG_ERROR);

    fireEvent.click(screen.getByRole("button", { name: "View Full Error" }));

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Last Error",
    });
    const fullError: HTMLElement =
      within(dialog).getByLabelText("Full error message");
    expect(fullError.textContent).toBe(LONG_ERROR);
    expect(dialog.querySelector("script")).toBeNull();
    expect(fullError).toHaveAttribute("tabindex", "0");

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy Error" }));
    await waitFor((): void => {
      expect(writeText).toHaveBeenCalledWith(LONG_ERROR);
    });

    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Close" })[0]!,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View Full Error" }),
    ).toBeVisible();
  });

  test.each(["Enter", " "])(
    "copies the full message with the %s key",
    async (key: string): Promise<void> => {
      renderPage(LONG_ERROR);
      fireEvent.keyDown(screen.getByRole("button", { name: "Copy Error" }), {
        key,
      });
      await waitFor((): void => {
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith(LONG_ERROR);
      });
    },
  );

  test("keeps a short error readable and copyable", async (): Promise<void> => {
    const error: string =
      "Google SecOps alerts fetch failed (HTTP 403): permission denied";
    renderPage(error);
    expect(screen.getByText(error)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy Error" }));
    await waitFor((): void => {
      expect(writeText).toHaveBeenCalledWith(error);
    });
  });

  test.each([undefined, null, ""])(
    "shows no error actions for a healthy row with lastError=%s",
    (error: string | null | undefined): void => {
      renderPage(error);
      expect(screen.getByTestId("connection-error")).toHaveTextContent("-");
      expect(
        screen.queryByRole("button", { name: "Copy Error" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "View Full Error" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(writeText).not.toHaveBeenCalled();
    },
  );
});
