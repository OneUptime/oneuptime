import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Every OneUptime Health screen the enterprise plugin provides loads and
 * renders in a browser environment: the lazy import resolves, the
 * @oneuptime/admin-dashboard/... and Common/... imports the moved screens use
 * resolve at runtime (not only for the type-checker), and the first render
 * does not throw. The health API is replaced by a request that never answers,
 * so each screen shows its first, loading state.
 *
 * React and Testing Library are required rather than imported: ee's server
 * type-check (tsconfig.json) covers Tests/ and has no React types, while the
 * screens themselves are type-checked by ee/AdminDashboard/tsconfig.json.
 */

jest.mock("Common/UI/Utils/API/API", () => {
  const pending: () => Promise<never> = (): Promise<never> => {
    return new Promise<never>(() => {
      // never settles: the screen stays in its loading state
    });
  };

  return {
    __esModule: true,
    default: {
      get: pending,
      post: pending,
      put: pending,
      delete: pending,
      getFriendlyMessage: (err: unknown): string => {
        return String(err);
      },
    },
  };
});

/*
 * Monaco cannot run in jsdom; the query console's editor is replaced by a
 * plain element so the rest of the console renders.
 */
jest.mock("@monaco-editor/react", () => {
  const react: { createElement: (...args: Array<unknown>) => unknown } =
    jest.requireActual("react") as {
      createElement: (...args: Array<unknown>) => unknown;
    };

  return {
    __esModule: true,
    default: (): unknown => {
      return react.createElement("textarea", {
        "data-testid": "monaco-editor",
      });
    },
    loader: {
      config: (): void => {
        // nothing to configure without a real editor
      },
    },
  };
});

type ReactModule = {
  createElement: (...args: Array<unknown>) => unknown;
  Suspense: unknown;
};

type RenderResult = { container: HTMLElement; unmount: () => void };

type TestingLibrary = {
  render: (element: unknown) => RenderResult;
  cleanup: () => void;
  waitFor: (
    assertion: () => void,
    options?: { timeout?: number },
  ) => Promise<void>;
};

type RouterModule = { MemoryRouter: unknown };

type LazyComponent = { $$typeof: symbol };

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const React: ReactModule = require("react");
const TestingLibraryModule: TestingLibrary = require("@testing-library/react");
const Router: RouterModule = require("react-router-dom");
const HealthPlugins: Record<string, LazyComponent> =
  require("../../../AdminDashboard/Health/Plugins").default;
const AdminPlugins: Record<string, unknown> =
  require("../../../AdminDashboard/Index").default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const HEALTH_KEYS: Array<string> = [
  "HealthOverview",
  "HealthQueues",
  "HealthPostgres",
  "HealthRedis",
  "HealthLogs",
  "HealthTelemetry",
  "HealthQueryConsole",
  "HealthClickhouseCluster",
];

/*
 * What each screen's first state shows: the in-card loader while its request
 * is outstanding, or, for the screens that render before any request, a
 * piece of their own content. An import or render failure unmounts the tree,
 * so it can never satisfy this.
 */
const FIRST_STATE_TEXT: Record<string, string> = {
  HealthLogs: "Diagnostic logs",
  HealthTelemetry: "By signal",
  HealthQueryConsole: "PostgreSQL",
};

const FALLBACK_TEXT: string = "plugin-loading";

/*
 * The first render of a screen compiles its whole import graph through
 * ts-jest, which on a cold cache takes longer than jest's 5 s default.
 */
const FIRST_LOAD_TIMEOUT_IN_MS: number = 90000;

afterEach(() => {
  TestingLibraryModule.cleanup();
});

describe("the enterprise Health plugins", () => {
  test("provide exactly the enterprise Health screens", () => {
    expect(Object.keys(HealthPlugins).sort()).toEqual([...HEALTH_KEYS].sort());
  });

  test("are part of the Admin Dashboard plugin object", () => {
    for (const key of HEALTH_KEYS) {
      expect(AdminPlugins[key]).toBe(HealthPlugins[key]);
    }

    // The instance log stays core (Community): no plugin replaces it.
    expect(AdminPlugins["HealthInstanceLogs"]).toBeUndefined();
  });

  test.each(HEALTH_KEYS)("%s is a lazy component", (key: string) => {
    expect(HealthPlugins[key]?.$$typeof).toBe(Symbol.for("react.lazy"));
  });

  test.each(HEALTH_KEYS)(
    "%s loads and renders its first state",
    async (key: string) => {
      const { container } = TestingLibraryModule.render(
        React.createElement(
          Router.MemoryRouter,
          null,
          React.createElement(
            React.Suspense,
            { fallback: FALLBACK_TEXT },
            React.createElement(HealthPlugins[key]),
          ),
        ),
      );

      await TestingLibraryModule.waitFor(
        () => {
          const text: string | undefined = FIRST_STATE_TEXT[key];

          if (text) {
            expect(container.textContent).toContain(text);
          } else {
            expect(
              container.querySelector('[data-testid="component-loader"]'),
            ).not.toBeNull();
          }
        },
        { timeout: FIRST_LOAD_TIMEOUT_IN_MS },
      );

      expect(container.textContent).not.toContain(FALLBACK_TEXT);
    },
    FIRST_LOAD_TIMEOUT_IN_MS + 10000,
  );
});
