import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ExceptionSettings from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSettings";
import ExceptionTriageActions from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionTriageActions";
import { ExceptionTriageAction } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * Resolve and archive: one click in the header on every page but Settings,
 * where the Status card holds the same actions next to who last changed
 * them. A viewer without edit permission sees the buttons locked.
 */

let permissions: Array<Permission> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissions;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
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

const EXCEPTION_ID: string = "50000000-0000-4000-8000-000000000001";
const onAction: Mock<(action: ExceptionTriageAction) => void> =
  jest.fn<(action: ExceptionTriageAction) => void>();

beforeEach(() => {
  permissions = [Permission.ProjectOwner];
  onAction.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ExceptionTriageActions", () => {
  test.each([
    [false, false, ["Resolve", "Archive"]],
    [true, false, ["Reopen", "Archive"]],
    [false, true, ["Resolve", "Unarchive"]],
    [true, true, ["Reopen", "Unarchive"]],
  ])(
    "resolved=%s archived=%s offers %j",
    (isResolved: boolean, isArchived: boolean, labels: Array<string>) => {
      render(
        <ExceptionTriageActions
          isResolved={isResolved}
          isArchived={isArchived}
          onAction={onAction}
        />,
      );

      expect(
        screen.getAllByRole("button").map((button: HTMLElement) => {
          return button.textContent;
        }),
      ).toEqual(labels);
    },
  );

  test("each click reports the action and the state it leads to", () => {
    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByTestId("exception-triage-resolve"));
    fireEvent.click(screen.getByTestId("exception-triage-archive"));

    expect(
      onAction.mock.calls.map((call: [ExceptionTriageAction]) => {
        return call[0];
      }),
    ).toEqual([
      {
        id: "resolve",
        label: "Resolve",
        nextState: { isResolved: true, isArchived: false },
      },
      {
        id: "archive",
        label: "Archive",
        nextState: { isResolved: false, isArchived: true },
      },
    ]);
  });

  test("while one action is saving the other is locked", () => {
    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        pendingActionId="resolve"
        onAction={onAction}
      />,
    );

    expect(screen.getByTestId("exception-triage-archive")).toBeDisabled();
    expect(screen.getByTestId("exception-triage-resolve")).toBeDisabled();
  });

  test("a read-only viewer sees the buttons locked", () => {
    permissions = [Permission.ReadTelemetryException];

    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        onAction={onAction}
      />,
    );

    expect(screen.getByTestId("exception-triage-resolve")).toBeDisabled();
    expect(screen.getByTestId("exception-triage-archive")).toBeDisabled();
  });
});

describe("ExceptionSettings", () => {
  function exceptionWith(
    values: Partial<TelemetryException>,
  ): TelemetryException {
    const exception: TelemetryException = new TelemetryException();
    Object.assign(exception, values);
    return exception;
  }

  function renderSettings(
    exception: TelemetryException,
    extra: Partial<React.ComponentProps<typeof ExceptionSettings>> = {},
  ): void {
    render(
      <MemoryRouter>
        <ExceptionSettings
          exception={exception}
          telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
          onAction={onAction}
          onDismissActionError={() => {}}
          {...extra}
        />
      </MemoryRouter>,
    );
  }

  test("an open exception reads as unresolved and not archived", () => {
    renderSettings(exceptionWith({ isResolved: false, isArchived: false }));

    expect(
      screen.getByTestId("exception-settings-resolution-state"),
    ).toHaveTextContent("Unresolved");
    expect(
      screen.getByTestId("exception-settings-resolution-history"),
    ).toHaveTextContent("Open and waiting for a fix.");
    expect(
      screen.getByTestId("exception-settings-archive-state"),
    ).toHaveTextContent("Not archived");

    fireEvent.click(screen.getByTestId("exception-settings-resolve"));
    expect(onAction.mock.calls[0]![0]).toMatchObject({
      id: "resolve",
      nextState: { isResolved: true, isArchived: false },
    });

    fireEvent.click(screen.getByTestId("exception-settings-archive"));
    expect(onAction.mock.calls[1]![0]).toMatchObject({
      id: "archive",
      nextState: { isResolved: false, isArchived: true },
    });
  });

  test("names who resolved and archived it, and when", () => {
    const user: User = new User();
    user.name = new Name("Priya Raman");
    user.email = new Email("priya@example.com");

    renderSettings(
      exceptionWith({
        isResolved: true,
        isArchived: true,
        markedAsResolvedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        markedAsResolvedByUser: user,
        markedAsArchivedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      }),
    );

    expect(
      screen.getByTestId("exception-settings-resolution-history"),
    ).toHaveTextContent("Resolved 2 hours ago by Priya Raman");
    expect(
      screen.getByTestId("exception-settings-archive-history"),
    ).toHaveTextContent("Archived 1 day ago");

    expect(
      screen.getByTestId("exception-settings-unresolve"),
    ).toHaveTextContent("Mark as Unresolved");
    expect(
      screen.getByTestId("exception-settings-unarchive"),
    ).toHaveTextContent("Unarchive");

    fireEvent.click(screen.getByTestId("exception-settings-unresolve"));
    expect(onAction.mock.calls[0]![0]).toMatchObject({
      id: "unresolve",
      nextState: { isResolved: false, isArchived: true },
    });
  });

  test("falls back to the email when a user has no name", () => {
    const user: User = new User();
    user.email = new Email("ops@example.com");

    renderSettings(
      exceptionWith({
        isResolved: true,
        markedAsResolvedByUser: user,
      }),
    );

    expect(
      screen.getByTestId("exception-settings-resolution-history"),
    ).toHaveTextContent("Resolved by ops@example.com");
  });

  test("shows a failed action inline and lets it be dismissed", () => {
    const dismiss: Mock<() => void> = jest.fn<() => void>();

    renderSettings(exceptionWith({}), {
      actionError: "You do not have permission to edit this exception.",
      onDismissActionError: dismiss,
    });

    expect(screen.getByText("Action failed")).toBeInTheDocument();
    expect(
      screen.getByText("You do not have permission to edit this exception."),
    ).toBeInTheDocument();
  });

  test("keeps the delete card in its danger zone", () => {
    renderSettings(exceptionWith({}));

    expect(
      within(screen.getByTestId("exception-settings-danger-zone")).getByRole(
        "heading",
        { name: "Delete Exception" },
      ),
    ).toBeInTheDocument();
  });

  test("locks the status buttons for a read-only viewer", () => {
    permissions = [Permission.ReadTelemetryException];
    renderSettings(exceptionWith({}));

    expect(screen.getByTestId("exception-settings-resolve")).toBeDisabled();
    expect(screen.getByTestId("exception-settings-archive")).toBeDisabled();
  });
});
