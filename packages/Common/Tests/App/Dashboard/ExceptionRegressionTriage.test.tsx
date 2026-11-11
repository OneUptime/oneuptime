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
import ExceptionMoreActions, {
  EXCEPTION_MORE_ACTIONS_TEST_IDS,
  hasExceptionMoreActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionMoreActions";
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
 *   - The header's ⋯ offers Resolve in next release while a release is
 *     known: occurrences from that release do not reopen it. The buttons
 *     stay Resolve and Archive. Settings offers it as a second button, and
 *     says when an exception
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

describe("Resolve in next release in the header's ⋯", () => {
  function openMore(): HTMLElement {
    const trigger: HTMLElement = screen.getByTestId("exception-more-actions");

    expect(trigger).toHaveAttribute("aria-label", "More actions");
    fireEvent.click(trigger);

    return screen.getByRole("menu");
  }

  test("opens from the ⋯, and reports the release it waits out", () => {
    render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
      />,
    );

    const item: HTMLElement = within(openMore()).getByRole("menuitem", {
      name: /Resolve in next release/,
    });

    expect(item).toHaveAttribute(
      "data-testid",
      "exception-triage-resolve-next-release",
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

  test("Resolve itself still resolves in one click, and the buttons are only Resolve and Archive", () => {
    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        onAction={onAction}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button: HTMLElement) => {
        return button.textContent;
      }),
    ).toEqual(["Resolve", "Archive"]);
    // No split menu beside Resolve any more: the ⋯ holds the rest.
    expect(screen.queryByTestId("exception-triage-resolve-menu")).toBeNull();

    fireEvent.click(screen.getByTestId("exception-triage-resolve"));

    expect(onAction.mock.calls[0]![0]).toMatchObject({ id: "resolve" });
  });

  test("is not offered once resolved, or when no release is known", () => {
    render(
      <ExceptionMoreActions
        isResolved={true}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
        onCreateMonitor={() => {}}
      />,
    );

    expect(
      within(openMore()).queryByTestId("exception-triage-resolve-next-release"),
    ).toBeNull();

    cleanup();

    render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={false}
        onAction={onAction}
        onCreateMonitor={() => {}}
      />,
    );

    expect(
      within(openMore()).queryByTestId("exception-triage-resolve-next-release"),
    ).toBeNull();
  });

  test("a read-only viewer finds it locked, and told why", () => {
    permissions = [Permission.ReadTelemetryException];

    render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
      />,
    );

    const item: HTMLElement = within(openMore()).getByTestId(
      "exception-triage-resolve-next-release",
    );

    expect(item).toHaveAttribute("aria-disabled", "true");

    // The reason the permission gate gives, read with the item.
    const reasonId: string | null = item.getAttribute("aria-describedby");

    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)?.textContent).toMatch(
      /permission/i,
    );

    fireEvent.click(item);

    expect(onAction).not.toHaveBeenCalled();
  });

  test("while a triage move saves, it waits", () => {
    render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        pendingActionId="resolve"
        onAction={onAction}
      />,
    );

    const item: HTMLElement = within(openMore()).getByTestId(
      "exception-triage-resolve-next-release",
    );

    expect(item).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(item);

    expect(onAction).not.toHaveBeenCalled();
  });

  test("while it is saving, Resolve shows the work and Archive waits", () => {
    render(
      <ExceptionTriageActions
        isResolved={false}
        isArchived={false}
        pendingActionId="resolve-next-release"
        onAction={onAction}
      />,
    );

    expect(screen.getByTestId("exception-triage-archive")).toBeDisabled();
    expect(screen.getByTestId("exception-triage-resolve")).toBeDisabled();
    expect(screen.getByTestId("exception-triage-resolve")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});

/*
 * The header's ⋯ holds what an exception takes now and then: Resolve in
 * next release and Create monitor. The header's buttons are Resolve and
 * Archive, and the ⋯ is never an empty menu.
 */
describe("the header's ⋯", () => {
  function openMore(): HTMLElement {
    fireEvent.click(
      screen.getByTestId(EXCEPTION_MORE_ACTIONS_TEST_IDS.trigger),
    );

    return screen.getByRole("menu");
  }

  function itemNames(menu: HTMLElement): Array<string> {
    return within(menu)
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });
  }

  test("offers Create monitor, which opens a new monitor for the exception", () => {
    const onCreateMonitor: Mock<() => void> = jest.fn<() => void>();

    render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={false}
        onAction={onAction}
        onCreateMonitor={onCreateMonitor}
      />,
    );

    const item: HTMLElement = within(openMore()).getByTestId(
      EXCEPTION_MORE_ACTIONS_TEST_IDS.createMonitor,
    );

    expect(item).toHaveTextContent("Create monitor");
    expect(item).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(item);

    expect(onCreateMonitor).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  test("lists Resolve in next release, then Create monitor", () => {
    render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
        onCreateMonitor={() => {}}
      />,
    );

    expect(itemNames(openMore())).toEqual([
      "Resolve in next release",
      "Create monitor",
    ]);
  });

  test("a reader who may not create monitors is not offered it", () => {
    render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
      />,
    );

    expect(
      within(openMore()).queryByTestId(
        EXCEPTION_MORE_ACTIONS_TEST_IDS.createMonitor,
      ),
    ).toBeNull();
    expect(itemNames(screen.getByRole("menu"))).toEqual([
      "Resolve in next release",
    ]);
  });

  test("once resolved, the ⋯ holds Create monitor alone", () => {
    render(
      <ExceptionMoreActions
        isResolved={true}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
        onCreateMonitor={() => {}}
      />,
    );

    expect(itemNames(openMore())).toEqual(["Create monitor"]);
  });

  test("archived but unresolved, it can still be resolved in the next release, and stays archived", () => {
    render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={true}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
        onCreateMonitor={() => {}}
      />,
    );

    const menu: HTMLElement = openMore();

    expect(itemNames(menu)).toEqual([
      "Resolve in next release",
      "Create monitor",
    ]);

    fireEvent.click(
      within(menu).getByTestId(
        EXCEPTION_MORE_ACTIONS_TEST_IDS.resolveInNextRelease,
      ),
    );

    expect(onAction.mock.calls[0]![0]).toMatchObject({
      id: "resolve-next-release",
      nextState: { isResolved: true, isArchived: true },
    });
  });

  test("with nothing to offer, draws no ⋯ at all", () => {
    const { container } = render(
      <ExceptionMoreActions
        isResolved={true}
        isArchived={false}
        lastSeenInRelease="v1.4.0"
        onAction={onAction}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId(EXCEPTION_MORE_ACTIONS_TEST_IDS.trigger),
    ).toBeNull();

    cleanup();

    const { container: noRelease } = render(
      <ExceptionMoreActions
        isResolved={false}
        isArchived={false}
        onAction={onAction}
      />,
    );

    expect(noRelease).toBeEmptyDOMElement();
  });

  test.each([
    [
      { isResolved: false, isArchived: false, lastSeenInRelease: "v1.4.0" },
      true,
    ],
    [{ isResolved: false, isArchived: false }, false],
    [{ isResolved: false, isArchived: false, lastSeenInRelease: "" }, false],
    [
      { isResolved: true, isArchived: false, lastSeenInRelease: "v1.4.0" },
      false,
    ],
    [
      { isResolved: false, isArchived: true, lastSeenInRelease: "v1.4.0" },
      true,
    ],
  ] as Array<
    [
      { isResolved: boolean; isArchived: boolean; lastSeenInRelease?: string },
      boolean,
    ]
  >)(
    "hasExceptionMoreActions, without Create monitor, for %j is %s",
    (
      state: {
        isResolved: boolean;
        isArchived: boolean;
        lastSeenInRelease?: string;
      },
      expected: boolean,
    ) => {
      expect(hasExceptionMoreActions(state)).toBe(expected);
      // Create monitor alone is something to offer, whatever the state.
      expect(
        hasExceptionMoreActions({ ...state, onCreateMonitor: () => {} }),
      ).toBe(true);
    },
  );

  test("hasExceptionMoreActions says the ⋯ draws, exactly when it does", () => {
    const states: Array<{
      isResolved: boolean;
      isArchived: boolean;
      lastSeenInRelease?: string;
      onCreateMonitor?: () => void;
    }> = [];

    for (const isResolved of [false, true]) {
      for (const isArchived of [false, true]) {
        for (const lastSeenInRelease of [undefined, "v1.4.0"]) {
          for (const onCreateMonitor of [undefined, () => {}]) {
            states.push({
              isResolved,
              isArchived,
              ...(lastSeenInRelease ? { lastSeenInRelease } : {}),
              ...(onCreateMonitor ? { onCreateMonitor } : {}),
            });
          }
        }
      }
    }

    for (const state of states) {
      const { container } = render(
        <ExceptionMoreActions {...state} onAction={onAction} />,
      );

      expect([state, container.childElementCount > 0]).toEqual([
        state,
        hasExceptionMoreActions(state),
      ]);

      cleanup();
    }
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
