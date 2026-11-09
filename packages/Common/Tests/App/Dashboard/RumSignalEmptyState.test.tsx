import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Why a RUM application's Exceptions or Logs are empty, as drawn (issue
 * #5770): in an empty chart on its Overview, and on its Logs page drawn
 * like every empty explorer - each with the one thing to do, wired to what
 * the page can do.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>): unknown => {
        return navigateMock(...args);
      },
    },
  };
});

// A plain anchor, so hrefs can be read without a router.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        className?: string;
        dataTestId?: string;
        children: React.ReactNode;
      }) => {
        return (
          <a
            href={props.to ? props.to.toString() : ""}
            className={props.className}
            data-testid={props.dataTestId}
          >
            {props.children}
          </a>
        );
      },
    };
  },
);

import RumSignalEmptyState, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalEmptyState";
import {
  RumSignalAction,
  RumSignalEmptyCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalWords";
import Route from "../../../Types/API/Route";
import TimeRange from "../../../Types/Time/TimeRange";

const DOCUMENTATION: Route = new Route("/dashboard/p/rum/a/documentation");

const NOT_SET_UP: RumSignalEmptyCopy = {
  title: "Exceptions aren't set up",
  detail: "No exception has arrived from this app.",
  evidence: "Session Replay recorded 2 sessions with errors.",
  action: { kind: "set-up", label: "Set up exceptions", signal: "exceptions" },
  helpLink: {
    text: "Why nothing arrives",
    url: "/docs/rum/troubleshooting#exceptions-or-logs-are-empty",
  },
};

const onSetUp: MockFunction = getJestMockFunction();
const onRangeChange: MockFunction = getJestMockFunction();
const onRetry: MockFunction = getJestMockFunction();
const openMock: MockFunction = getJestMockFunction();

function draw(
  props: Partial<ComponentProps> & { copy: RumSignalEmptyCopy },
): void {
  render(
    <RumSignalEmptyState
      signal="exceptions"
      state="not-set-up"
      variant="chart"
      documentationRoute={DOCUMENTATION}
      onSetUp={(...args: Array<unknown>): void => {
        onSetUp(...args);
      }}
      onRangeChange={(...args: Array<unknown>): void => {
        onRangeChange(...args);
      }}
      onRetry={(): void => {
        onRetry();
      }}
      {...props}
    />,
  );
}

function withAction(action: RumSignalAction): RumSignalEmptyCopy {
  return { title: "Title", detail: "Detail.", action };
}

beforeEach(() => {
  for (const mock of [
    navigateMock,
    onSetUp,
    onRangeChange,
    onRetry,
    openMock,
  ]) {
    mock.mockReset();
  }
  window.open = ((...args: Array<unknown>): null => {
    openMock(...args);
    return null;
  }) as typeof window.open;
});

afterEach(() => {
  cleanup();
});

describe("an empty chart's explanation", () => {
  test("says why, backs it up, and offers the one step and the troubleshooting page", () => {
    draw({ copy: NOT_SET_UP });

    const block: HTMLElement = screen.getByTestId("rum-exceptions-empty");
    expect(block).toHaveAttribute("data-state", "not-set-up");
    expect(screen.getByTestId("rum-exceptions-empty-title")).toHaveTextContent(
      "Exceptions aren't set up",
    );
    expect(screen.getByTestId("rum-exceptions-empty-detail")).toHaveTextContent(
      "No exception has arrived from this app.",
    );
    expect(
      screen.getByTestId("rum-exceptions-empty-evidence"),
    ).toHaveTextContent("Session Replay recorded 2 sessions with errors.");
    const help: HTMLElement = screen.getByTestId("rum-exceptions-empty-help");
    expect(help).toHaveTextContent("Why nothing arrives");
    expect(help).toHaveAttribute(
      "href",
      "/docs/rum/troubleshooting#exceptions-or-logs-are-empty",
    );
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("the setup step opens the signal's dialog", () => {
    draw({ copy: NOT_SET_UP });

    fireEvent.click(screen.getByRole("button", { name: "Set up exceptions" }));

    expect(onSetUp).toHaveBeenCalledWith("exceptions");
  });

  test("a longer range is set on the page", () => {
    draw({
      copy: withAction({
        kind: "set-range",
        label: "Show the past week",
        range: { range: TimeRange.PAST_ONE_WEEK },
      }),
      state: "quiet",
    });

    fireEvent.click(screen.getByRole("button", { name: "Show the past week" }));

    expect(onRangeChange).toHaveBeenCalledWith({
      range: TimeRange.PAST_ONE_WEEK,
    });
  });

  test("Try again asks the page to read again", () => {
    draw({
      copy: withAction({ kind: "retry", label: "Try again" }),
      state: "unknown",
    });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("a step the page cannot take is not offered", () => {
    draw({
      copy: withAction({
        kind: "set-range",
        label: "Show the past week",
        range: { range: TimeRange.PAST_ONE_WEEK },
      }),
      onRangeChange: undefined,
    });
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();

    draw({
      copy: withAction({ kind: "retry", label: "Try again" }),
      onRetry: undefined,
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("the setup steps are the application's Documentation tab", () => {
    draw({
      copy: withAction({ kind: "documentation", label: "See the setup steps" }),
      state: "not-arriving",
    });

    expect(
      screen.getByRole("link", { name: "See the setup steps" }),
    ).toHaveAttribute("href", "/dashboard/p/rum/a/documentation");
  });

  test("a docs page opens in a new tab", () => {
    draw({
      copy: withAction({
        kind: "docs",
        label: "Open Mobile Setup",
        url: "/docs/rum/mobile-setup",
      }),
    });

    const link: HTMLElement = screen.getByRole("link", {
      name: "Open Mobile Setup",
    });
    expect(link).toHaveAttribute("href", "/docs/rum/mobile-setup");
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("an answer with nothing more to say draws only its title", () => {
    draw({
      copy: { title: "No logs in this time range", detail: "" },
      signal: "logs",
      state: "quiet",
    });

    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "No logs in this time range",
    );
    expect(screen.queryByTestId("rum-logs-empty-detail")).toBeNull();
    expect(screen.queryByTestId("rum-logs-empty-evidence")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("the empty Logs page's explanation", () => {
  test("is drawn like every empty explorer, with the step and the help link as its actions", () => {
    draw({
      copy: {
        ...NOT_SET_UP,
        title: "Logs aren't set up",
        action: { kind: "set-up", label: "Set up logs", signal: "logs" },
      },
      signal: "logs",
      variant: "page",
    });

    expect(screen.getByTestId("rum-logs-empty-gutter")).toHaveAttribute(
      "data-state",
      "not-set-up",
    );
    const block: HTMLElement = screen.getByTestId("rum-logs-empty");
    expect(block).toHaveAttribute("data-empty-state-kind", "empty");
    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "Logs aren't set up",
    );
    expect(screen.getByTestId("rum-logs-empty-description")).toHaveTextContent(
      "No exception has arrived from this app.",
    );
    expect(screen.getByTestId("rum-logs-empty-note")).toHaveTextContent(
      "Session Replay recorded 2 sessions with errors.",
    );

    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));
    expect(onSetUp).toHaveBeenCalledWith("logs");

    fireEvent.click(screen.getByTestId("rum-logs-empty-help"));
    expect(openMock).toHaveBeenCalledWith(
      "/docs/rum/troubleshooting#exceptions-or-logs-are-empty",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("the setup steps navigate to the Documentation tab", () => {
    draw({
      copy: withAction({ kind: "documentation", label: "See the setup steps" }),
      signal: "logs",
      state: "not-arriving",
      variant: "page",
    });

    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));

    expect(navigateMock).toHaveBeenCalledWith(DOCUMENTATION);
  });

  test("a check that failed is drawn as an error", () => {
    draw({
      copy: withAction({ kind: "retry", label: "Try again" }),
      signal: "logs",
      state: "unknown",
      variant: "page",
    });

    expect(screen.getByTestId("rum-logs-empty")).toHaveAttribute(
      "data-empty-state-kind",
      "error",
    );
    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
