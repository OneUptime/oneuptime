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
import ExceptionIssueBadges from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionIssueBadges";
import ExceptionRow from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRow";
import ExceptionSettings from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSettings";
import ExceptionSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSummary";
import ExceptionTriageActions from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionTriageActions";
import { ExceptionTriageAction } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * A RESOLVED EXCEPTION THAT COMES BACK, AND RESOLVE IN NEXT RELEASE, ON
 * SCREEN.
 *
 *   - The list row and the exception's header say Regressed when it came
 *     back after it was resolved, New when it was first seen in the last day,
 *     and Unhandled - so a person triaging sees what to open first.
 *   - Resolve has a small menu beside it, while a release is known, with
 *     Resolve in next release: occurrences from that release do not reopen
 *     it. Settings offers it as a second button, and says when an exception
 *     came back, or which release it waits out.
 */

let permissions: Array<Permission> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissions;
      },
      getProjectPermissions: (): null => {
        return null;
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

const HOUR_MS: number = 60 * 60 * 1000;
const EXCEPTION_ID: string = "50000000-0000-4000-8000-000000000042";

const onAction: Mock<(action: ExceptionTriageAction) => void> =
  jest.fn<(action: ExceptionTriageAction) => void>();

function exceptionWith(
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = EXCEPTION_ID;
  exception.exceptionType = "TypeError";
  exception.message = "Cannot read properties of undefined (reading 'id')";
  exception.occuranceCount = 12;
  Object.assign(exception, values);
  return exception;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}

beforeEach(() => {
  permissions = [Permission.ProjectOwner];
  onAction.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the badges a row shows", () => {
  test("Regressed, with when it came back on hover", () => {
    render(
      <ExceptionIssueBadges
        exception={{
          isResolved: false,
          regressedAt: hoursAgo(2),
          firstSeenAt: hoursAgo(400),
        }}
      />,
    );

    const badge: HTMLElement = screen.getByTestId("exception-badge-regressed");
    expect(badge).toHaveTextContent("Regressed");
    expect(badge.getAttribute("title")).toMatch(
      /^It came back .+, after it was resolved\.$/,
    );
    expect(screen.queryByTestId("exception-badge-new")).toBeNull();
  });

  test("New for an exception first seen in the last day", () => {
    render(<ExceptionIssueBadges exception={{ firstSeenAt: hoursAgo(3) }} />);

    expect(screen.getByTestId("exception-badge-new")).toHaveTextContent("New");
    expect(screen.getByTestId("exception-badge-new")).toHaveAttribute(
      "title",
      "First seen in the last 24 hours.",
    );
  });

  test("Unhandled, and nothing at all for a quiet, handled, resolved one", () => {
    const { rerender } = render(
      <ExceptionIssueBadges
        exception={{ unhandled: true, firstSeenAt: hoursAgo(400) }}
      />,
    );

    expect(screen.getByTestId("exception-badge-unhandled")).toHaveTextContent(
      "Unhandled",
    );

    rerender(
      <ExceptionIssueBadges
        exception={{
          isResolved: true,
          regressedAt: hoursAgo(50),
          firstSeenAt: hoursAgo(3),
        }}
      />,
    );

    expect(screen.queryByTestId(/^exception-badge-/)).toBeNull();
  });

  test("the list row carries them on its service line", () => {
    render(
      <ExceptionRow
        exception={exceptionWith({
          isResolved: false,
          regressedAt: hoursAgo(1),
          unhandled: true,
          firstSeenAt: hoursAgo(300),
          lastSeenAt: hoursAgo(1),
        })}
      />,
    );

    const row: HTMLElement = screen.getByRole("button");
    expect(
      within(row).getByTestId("exception-badge-regressed"),
    ).toBeInTheDocument();
    expect(
      within(row).getByTestId("exception-badge-unhandled"),
    ).toBeInTheDocument();
  });
});

describe("the exception's header", () => {
  function renderSummary(exception: TelemetryException): void {
    render(
      <MemoryRouter>
        <ExceptionSummary exception={exception} />
      </MemoryRouter>,
    );
  }

  test("says Regressed beside Unresolved", () => {
    renderSummary(
      exceptionWith({
        isResolved: false,
        regressedAt: hoursAgo(1),
        firstSeenAt: hoursAgo(2),
      }),
    );

    expect(screen.getByTestId("exception-summary-status")).toHaveTextContent(
      "Unresolved",
    );
    expect(screen.getByTestId("exception-summary-regressed")).toHaveTextContent(
      "Regressed",
    );
    // A regressed exception is not new, however recently it was first seen.
    expect(screen.queryByTestId("exception-summary-new")).toBeNull();
  });

  test("says New for an exception first seen in the last day", () => {
    renderSummary(exceptionWith({ firstSeenAt: hoursAgo(5) }));

    expect(screen.getByTestId("exception-summary-new")).toHaveTextContent(
      "New",
    );
  });

  test("says neither once it is resolved", () => {
    renderSummary(
      exceptionWith({
        isResolved: true,
        regressedAt: hoursAgo(1),
        firstSeenAt: hoursAgo(2),
      }),
    );

    expect(screen.queryByTestId("exception-summary-regressed")).toBeNull();
    expect(screen.queryByTestId("exception-summary-new")).toBeNull();
  });
});

describe("Resolve in next release beside Resolve", () => {
  test("opens from the menu beside Resolve, and reports the release it waits out", () => {
    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
      />,
    );

    const trigger: HTMLElement = screen.getByTestId(
      "exception-triage-resolve-menu",
    );
    expect(trigger).toHaveAttribute("aria-label", "More ways to resolve");

    fireEvent.click(trigger);

    const item: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: /Resolve in next release/ },
    );
    fireEvent.click(item);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0]).toEqual({
      id: "resolve-next-release",
      label: "Resolve in next release",
      nextState: { isResolved: true, isArchived: false },
      release: "v1.4.0",
    });
  });

  test("Resolve itself still resolves in one click", () => {
    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByTestId("exception-triage-resolve"));

    expect(onAction.mock.calls[0]![0]).toMatchObject({ id: "resolve" });
  });

  test("is not offered once resolved, or when no release is known", () => {
    const { rerender } = render(
      <ExceptionTriageActions
        isResolved={true}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
      />,
    );

    expect(screen.queryByTestId("exception-triage-resolve-menu")).toBeNull();

    rerender(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        onAction={onAction}
      />,
    );

    expect(screen.queryByTestId("exception-triage-resolve-menu")).toBeNull();
    expect(
      screen.getAllByRole("button").map((button: HTMLElement) => {
        return button.textContent;
      }),
    ).toEqual(["Resolve", "Archive"]);
  });

  test("a read-only viewer finds the menu locked too", () => {
    permissions = [Permission.ReadTelemetryException];

    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
      />,
    );

    expect(screen.getByTestId("exception-triage-resolve-menu")).toBeDisabled();
  });

  test("while it is saving, Resolve shows the work and Archive waits", () => {
    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        pendingActionId="resolve-next-release"
        onAction={onAction}
      />,
    );

    expect(screen.getByTestId("exception-triage-archive")).toBeDisabled();
    expect(screen.getByTestId("exception-triage-resolve")).toBeDisabled();
  });
});

describe("Settings", () => {
  function renderSettings(exception: TelemetryException): void {
    render(
      <MemoryRouter>
        <ExceptionSettings
          exception={exception}
          telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
          onAction={onAction}
          onDismissActionError={() => {}}
        />
      </MemoryRouter>,
    );
  }

  test("offers Resolve in next release as a second button, naming the release", () => {
    renderSettings(
      exceptionWith({
        isResolved: false,
        isArchived: false,
        lastSeenInRelease: "2.3.1",
      }),
    );

    const button: HTMLElement = screen.getByTestId(
      "exception-settings-resolve-next-release",
    );
    expect(button).toHaveTextContent("Resolve in next release");

    fireEvent.click(button);
    expect(onAction.mock.calls[0]![0]).toMatchObject({
      id: "resolve-next-release",
      release: "2.3.1",
      nextState: { isResolved: true, isArchived: false },
    });

    // Mark as Resolved stays the main button.
    expect(screen.getByTestId("exception-settings-resolve")).toHaveTextContent(
      "Mark as Resolved",
    );
  });

  test("an exception that came back says so under its resolution", () => {
    renderSettings(
      exceptionWith({
        isResolved: false,
        regressedAt: hoursAgo(3),
      }),
    );

    expect(
      screen.getByTestId("exception-settings-resolution-detail").textContent,
    ).toMatch(/^It came back .+, after it was resolved\.$/);
  });

  test("an exception resolved in the next release names the release it waits out", () => {
    renderSettings(
      exceptionWith({
        isResolved: true,
        resolvedInReleaseAfter: "2.3.1",
        markedAsResolvedAt: hoursAgo(1),
      }),
    );

    expect(
      screen.getByTestId("exception-settings-resolution-detail"),
    ).toHaveTextContent(
      "Resolved in the next release: occurrences from 2.3.1 do not reopen it.",
    );
    // Resolved: no second way to resolve it.
    expect(
      screen.queryByTestId("exception-settings-resolve-next-release"),
    ).toBeNull();
  });

  test("a plain open exception has nothing more to say", () => {
    renderSettings(exceptionWith({ isResolved: false }));

    expect(
      screen.queryByTestId("exception-settings-resolution-detail"),
    ).toBeNull();
    expect(
      screen.queryByTestId("exception-settings-resolve-next-release"),
    ).toBeNull();
  });
});
