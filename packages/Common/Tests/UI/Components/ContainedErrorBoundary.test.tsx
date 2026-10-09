import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ErrorInfo, FunctionComponent, ReactElement } from "react";
import ContainedErrorBoundary, {
  ContainedErrorFallbackProps,
} from "../../../UI/Components/ContainedErrorBoundary/ContainedErrorBoundary";
import { CHUNK_LOAD_RELOAD_STORAGE_KEY } from "../../../UI/Components/ErrorBoundary";
import { SpyInstance } from "jest-mock";

/*
 * ContainedErrorBoundary is the boundary for one part of a page - one
 * dashboard widget (issue #4571), one settings form. What it has to hold:
 * a throw below it replaces only its own children, with the fallback it was
 * handed; the rest of the page renders on; the fallback can draw the
 * children again; new reset keys start it over; and a stale bundle still
 * reloads the page the way the app's own boundary does.
 */

let shouldThrow: boolean = true;
let renders: number = 0;

const Flaky: FunctionComponent = (): ReactElement => {
  renders++;

  if (shouldThrow) {
    throw new Error("Widget exploded");
  }

  return <div data-testid="flaky-ok">Drawn</div>;
};

const ChunkFailure: FunctionComponent = (): ReactElement => {
  const error: Error = new Error(
    "Failed to fetch dynamically imported module: /dashboard/dist/chunk-X.js",
  );
  throw error;
};

function fallback(data: ContainedErrorFallbackProps): ReactElement {
  return (
    <div data-testid="contained-fallback">
      <span data-testid="contained-fallback-message">{data.error.message}</span>
      <button type="button" onClick={data.retry}>
        Try again
      </button>
    </div>
  );
}

const ORIGINAL_LOCATION: Location = window.location;
let reloadMock: jest.Mock<() => void>;
let consoleErrorSpy: SpyInstance<typeof console.error>;

beforeEach(() => {
  shouldThrow = true;
  renders = 0;
  window.sessionStorage.clear();

  reloadMock = jest.fn<() => void>();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...ORIGINAL_LOCATION, reload: reloadMock },
  });

  // React and the boundary both report the caught error; keep the run quiet.
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("ContainedErrorBoundary", () => {
  test("draws its children when nothing throws", () => {
    shouldThrow = false;

    render(
      <ContainedErrorBoundary renderFallback={fallback}>
        <Flaky />
      </ContainedErrorBoundary>,
    );

    expect(screen.getByTestId("flaky-ok")).toBeInTheDocument();
    expect(screen.queryByTestId("contained-fallback")).toBeNull();
  });

  test("a throw replaces only its own children; the rest of the page stays", () => {
    render(
      <div>
        <p data-testid="before">Header</p>
        <ContainedErrorBoundary renderFallback={fallback}>
          <Flaky />
        </ContainedErrorBoundary>
        <p data-testid="after">Footer</p>
      </div>,
    );

    expect(screen.getByTestId("contained-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("contained-fallback-message")).toHaveTextContent(
      "Widget exploded",
    );
    expect(screen.getByTestId("before")).toHaveTextContent("Header");
    expect(screen.getByTestId("after")).toHaveTextContent("Footer");
  });

  test("two boundaries side by side fail apart", () => {
    const Fine: FunctionComponent = (): ReactElement => {
      return <div data-testid="fine">Fine</div>;
    };

    render(
      <div>
        <ContainedErrorBoundary renderFallback={fallback}>
          <Flaky />
        </ContainedErrorBoundary>
        <ContainedErrorBoundary renderFallback={fallback}>
          <Fine />
        </ContainedErrorBoundary>
      </div>,
    );

    expect(screen.getAllByTestId("contained-fallback")).toHaveLength(1);
    expect(screen.getByTestId("fine")).toBeInTheDocument();
  });

  test("retry draws the children again", () => {
    render(
      <ContainedErrorBoundary renderFallback={fallback}>
        <Flaky />
      </ContainedErrorBoundary>,
    );

    expect(screen.getByTestId("contained-fallback")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Try again"));

    expect(screen.getByTestId("flaky-ok")).toBeInTheDocument();
    expect(screen.queryByTestId("contained-fallback")).toBeNull();
  });

  test("retry of a failure that persists shows the fallback again, not a blank", () => {
    render(
      <ContainedErrorBoundary renderFallback={fallback}>
        <Flaky />
      </ContainedErrorBoundary>,
    );

    const rendersBefore: number = renders;
    fireEvent.click(screen.getByText("Try again"));

    expect(renders).toBeGreaterThan(rendersBefore);
    expect(screen.getByTestId("contained-fallback")).toBeInTheDocument();
  });

  test("new reset keys start it over", () => {
    const { rerender } = render(
      <ContainedErrorBoundary renderFallback={fallback} resetKeys={["v1"]}>
        <Flaky />
      </ContainedErrorBoundary>,
    );

    expect(screen.getByTestId("contained-fallback")).toBeInTheDocument();

    shouldThrow = false;

    // The same keys leave it showing the fallback...
    rerender(
      <ContainedErrorBoundary renderFallback={fallback} resetKeys={["v1"]}>
        <Flaky />
      </ContainedErrorBoundary>,
    );
    expect(screen.getByTestId("contained-fallback")).toBeInTheDocument();

    // ...and a new one draws the children again.
    rerender(
      <ContainedErrorBoundary renderFallback={fallback} resetKeys={["v2"]}>
        <Flaky />
      </ContainedErrorBoundary>,
    );
    expect(screen.getByTestId("flaky-ok")).toBeInTheDocument();
  });

  test("reports the error to onError and to the console", () => {
    const onError: jest.Mock<(error: Error, errorInfo: ErrorInfo) => void> =
      jest.fn<(error: Error, errorInfo: ErrorInfo) => void>();

    render(
      <ContainedErrorBoundary renderFallback={fallback} onError={onError}>
        <Flaky />
      </ContainedErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].message).toBe("Widget exploded");
    expect(
      consoleErrorSpy.mock.calls.some((call: Array<unknown>) => {
        return call[0] === "Uncaught error rendering part of the page:";
      }),
    ).toBe(true);
  });

  test("a thrown value that is not an Error reaches the fallback as one", () => {
    const ThrowsText: FunctionComponent = (): ReactElement => {
      // eslint-disable-next-line no-throw-literal
      throw "plain text";
    };

    render(
      <ContainedErrorBoundary renderFallback={fallback}>
        <ThrowsText />
      </ContainedErrorBoundary>,
    );

    expect(screen.getByTestId("contained-fallback-message")).toHaveTextContent(
      "plain text",
    );
  });

  test("a stale bundle reloads the page once, as the app's boundary does", () => {
    render(
      <ContainedErrorBoundary renderFallback={fallback}>
        <ChunkFailure />
      </ContainedErrorBoundary>,
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem(CHUNK_LOAD_RELOAD_STORAGE_KEY),
    ).not.toBeNull();
  });

  test("an ordinary error never reloads the page", () => {
    render(
      <ContainedErrorBoundary renderFallback={fallback}>
        <Flaky />
      </ContainedErrorBoundary>,
    );

    expect(reloadMock).not.toHaveBeenCalled();
  });

  test("an error thrown later, by a re-render, is caught too", () => {
    shouldThrow = false;

    const Host: FunctionComponent<{ tick: number }> = (props: {
      tick: number;
    }): ReactElement => {
      return (
        <ContainedErrorBoundary renderFallback={fallback}>
          <span data-testid="tick">{props.tick}</span>
          <Flaky />
        </ContainedErrorBoundary>
      );
    };

    const { rerender } = render(<Host tick={1} />);
    expect(screen.getByTestId("flaky-ok")).toBeInTheDocument();

    shouldThrow = true;
    act(() => {
      rerender(<Host tick={2} />);
    });

    expect(screen.getByTestId("contained-fallback")).toBeInTheDocument();
  });
});
