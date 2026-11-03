"use strict";

/**
 * Every offline fixture navigates as the frontend it draws does.
 *
 * React Router 7 runs every navigation of a bare <BrowserRouter> as a React
 * transition: rendered in slices that other updates may interrupt. The
 * Dashboard mounts <BrowserRouter useTransitions={false}>
 * (App/FeatureSet/Dashboard/src/Index.tsx), so its navigations render at
 * once - a click shows its page, or its page's loading state, straight away.
 * Its side menus light the page Navigation keeps, which the app writes while
 * it renders. Until 2026-11-02, 80 of the offline fixtures under
 * packages/E2E mounted a bare <BrowserRouter> for Dashboard pages, so they
 * navigated differently from the product: with Chromium's CPU slowed four
 * times, Security Operations' case side menu lit the page being left beside
 * the page arrived at in 11 of 20 runs, and 14.0.95's gate failed on it;
 * with the Dashboard's router, in none.
 *
 * The other frontends (Status Page, Accounts, Admin Dashboard, Public
 * Dashboard) mount a bare <BrowserRouter>, so a fixture that draws only
 * their pages keeps their transitions: it navigates as the product it tests.
 *
 * This holds:
 *   - each frontend's src/Index.tsx mounts one BrowserRouter, whose
 *     useTransitions this suite reads (the Dashboard's is false);
 *   - every file under packages/E2E that mounts a router mounts a
 *     BrowserRouter, as a JSX element whose props can be read - another
 *     router, a data router or React.createElement gets a rule here first;
 *   - every fixture's BrowserRouter turns React Router's transitions off
 *     exactly when the frontend it draws does. A fixture draws the frontends
 *     whose src/ its own modules import; one that draws a Dashboard page, or
 *     no frontend's (Common's shells), navigates as the Dashboard does - the
 *     few pages of another frontend drawn beside Dashboard pages (an Admin
 *     Dashboard page in Bulk Actions and LLM Provider Test) are single pages
 *     their specs do not navigate between.
 */

const fs = require("fs");
const path = require("path");
const { routersOf, importsOf, ownModulesOf } = require("./Utils/JsxRouters");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "packages", "E2E");
const FRONTENDS = [
  "Dashboard",
  "StatusPage",
  "Accounts",
  "AdminDashboard",
  "PublicDashboard",
];
const FRONTEND_IMPORT = new RegExp(
  `(?:^|/)FeatureSet/(${FRONTENDS.join("|")})/`,
);
// Files that may hold JSX: the fixtures are .js, a few helpers .jsx/.tsx.
const JSX_FILE = /\.(jsx?|tsx)$/;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "test-results",
  "playwright-report",
  "build",
  "dist",
]);

function sourceFilesUnder(directory) {
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(full));
    } else if (JSX_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found.sort();
}

function relativeToE2E(file) {
  return path.relative(E2E_DIR, file).split(path.sep).join("/");
}

/*
 * The frontends a fixture draws: those whose src/ any of its own modules
 * (the file and the files it imports from packages/E2E) imports.
 */
function frontendsDrawnBy(file) {
  const drawn = new Set();

  for (const module of ownModulesOf(file, E2E_DIR)) {
    for (const specifier of importsOf(
      module,
      fs.readFileSync(module, "utf8"),
    )) {
      const match = FRONTEND_IMPORT.exec(specifier);

      if (match) {
        drawn.add(match[1]);
      }
    }
  }

  return [...drawn].sort();
}

/*
 * How a fixture that draws these frontends navigates, given how each
 * frontend does ("off" = useTransitions={false}, "on" = transitions): as
 * the Dashboard when it draws a Dashboard page or no frontend's; otherwise
 * as the frontends it draws, which must agree. Throws when they do not.
 */
function expectedTransitionsOf(drawn, transitionsByFrontend) {
  if (drawn.length === 0 || drawn.includes("Dashboard")) {
    return transitionsByFrontend.Dashboard;
  }

  const modes = new Set(
    drawn.map((frontend) => {
      return transitionsByFrontend[frontend];
    }),
  );

  if (modes.size !== 1) {
    throw new Error(
      `A fixture draws ${drawn.join(" and ")}, which navigate differently: decide which it follows, here.`,
    );
  }

  return [...modes][0];
}

// How each frontend's src/Index.tsx mounts its router.
function frontendRouters() {
  const routers = {};

  for (const frontend of FRONTENDS) {
    const file = path.join(
      REPO_ROOT,
      "packages",
      "App",
      "FeatureSet",
      frontend,
      "src",
      "Index.tsx",
    );
    routers[frontend] = routersOf(file, fs.readFileSync(file, "utf8"));
  }

  return routers;
}

const fixtures = sourceFilesUnder(E2E_DIR)
  .filter((file) => {
    return fs.readFileSync(file, "utf8").includes("Router");
  })
  .map((file) => {
    return {
      file: relativeToE2E(file),
      full: file,
      routers: routersOf(file, fs.readFileSync(file, "utf8")),
    };
  })
  .filter((fixture) => {
    return fixture.routers.length > 0;
  });

describe("the reader of routers", () => {
  function routers(source) {
    return routersOf("Sample.js", source);
  }

  test("reads useTransitions={false} as transitions off, and anything else as on", () => {
    expect(routers("render(<BrowserRouter><App /></BrowserRouter>);")).toEqual([
      { kind: "element", name: "BrowserRouter", line: 1, transitions: "on" },
    ]);
    expect(
      routers(
        "render(<BrowserRouter useTransitions={false}><App /></BrowserRouter>);",
      )[0].transitions,
    ).toBe("off");
    expect(
      routers(
        "render(\n  <BrowserRouter\n    useTransitions={ false }\n  >\n    <App />\n  </BrowserRouter>,\n);",
      ),
    ).toEqual([
      { kind: "element", name: "BrowserRouter", line: 2, transitions: "off" },
    ]);

    for (const attribute of [
      "useTransitions",
      "useTransitions={true}",
      "useTransitions={!true}",
      'useTransitions="false"',
      "useTransitions={off}",
      "basename={false}",
    ]) {
      expect({
        attribute,
        transitions: routers(
          `render(<BrowserRouter ${attribute}><App /></BrowserRouter>);`,
        )[0].transitions,
      }).toEqual({ attribute, transitions: "on" });
    }

    expect(
      routers("render(<BrowserRouter {...options}><App /></BrowserRouter>);")[0]
        .transitions,
    ).toBe("spread");
  });

  test("reads a router behind `>` inside an expression, and none named in a comment or a string", () => {
    expect(
      routers(
        'render(<BrowserRouter basename={a > b ? "/x" : "/"} useTransitions={false}><App /></BrowserRouter>);',
      ),
    ).toEqual([
      { kind: "element", name: "BrowserRouter", line: 1, transitions: "off" },
    ]);
    expect(
      routers(
        [
          "// <BrowserRouter> is what the Dashboard mounts.",
          "/* <MemoryRouter> too */",
          'const text = "<BrowserRouter>";',
          "render(<App />);",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("reads every other router, and routers made without JSX", () => {
    expect(
      routers(
        [
          "render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);",
          "render(<HashRouter><App /></HashRouter>);",
          "render(<RouterProvider router={router} />);",
          "const router = createBrowserRouter([]);",
          "render(React.createElement(BrowserRouter, null, app));",
          "render(createElement(MemoryRouter, null, app));",
        ].join("\n"),
      ).map((router) => {
        return `${router.kind} ${router.name} ${router.line}`;
      }),
    ).toEqual([
      "element MemoryRouter 1",
      "element HashRouter 2",
      "element RouterProvider 3",
      "call createBrowserRouter 4",
      "call createElement(BrowserRouter) 5",
      "call createElement(MemoryRouter) 6",
    ]);
  });

  test("reads the modules a file imports: static, dynamic, required and re-exported", () => {
    expect(
      importsOf(
        "Sample.js",
        [
          'import Page from "../../App/FeatureSet/StatusPage/src/Pages/Overview";',
          'import "Common/UI/Styles/Theme.css";',
          'const Login = lazy(() => import("../../App/FeatureSet/Accounts/src/Pages/Login"));',
          'const fs = require("fs");',
          'export { default } from "./Shell";',
          "const name = `x`; import(name);",
        ].join("\n"),
      ).sort(),
    ).toEqual(
      [
        "../../App/FeatureSet/StatusPage/src/Pages/Overview",
        "Common/UI/Styles/Theme.css",
        "./Shell",
        "../../App/FeatureSet/Accounts/src/Pages/Login",
        "fs",
      ].sort(),
    );
  });

  test("navigates as the Dashboard with a Dashboard page or none, else as the frontends drawn, which must agree", () => {
    const modes = {
      Dashboard: "off",
      StatusPage: "on",
      Accounts: "on",
      AdminDashboard: "on",
      PublicDashboard: "on",
    };

    expect(expectedTransitionsOf([], modes)).toBe("off");
    expect(expectedTransitionsOf(["Dashboard"], modes)).toBe("off");
    expect(expectedTransitionsOf(["AdminDashboard", "Dashboard"], modes)).toBe(
      "off",
    );
    expect(expectedTransitionsOf(["StatusPage"], modes)).toBe("on");
    expect(expectedTransitionsOf(["Accounts", "StatusPage"], modes)).toBe("on");
    expect(() => {
      return expectedTransitionsOf(["Accounts", "StatusPage"], {
        ...modes,
        StatusPage: "off",
      });
    }).toThrow("navigate differently");
  });
});

describe("the offline fixtures' routers", () => {
  const routersByFrontend = frontendRouters();
  const transitionsByFrontend = {};

  for (const frontend of FRONTENDS) {
    const routers = routersByFrontend[frontend];
    transitionsByFrontend[frontend] =
      routers.length === 1 ? routers[0].transitions : "unread";
  }

  test("each frontend mounts one BrowserRouter, and the Dashboard's turns transitions off", () => {
    for (const frontend of FRONTENDS) {
      expect({
        frontend,
        routers: routersByFrontend[frontend].map((router) => {
          return `${router.kind} ${router.name}`;
        }),
      }).toEqual({ frontend, routers: ["element BrowserRouter"] });
      expect(["on", "off"]).toContain(transitionsByFrontend[frontend]);
    }

    // What every Dashboard fixture follows; if this changes, so must they.
    expect(transitionsByFrontend.Dashboard).toBe("off");
  });

  test("are found where the suites keep them", () => {
    const files = fixtures.map((fixture) => {
      return fixture.file;
    });

    expect(files.length).toBeGreaterThan(85);

    for (const file of [
      "SecurityOperations/Fixture/Fixture.js",
      "NewVersion/Fixture/Index.js",
      "DashboardPlaylists/Fixture/AppFixture.js",
      "CustomFieldFiles/Fixture/Dashboard.js",
      "WorkflowBuilder/Fixture/OnCallLogs.js",
      "MaintenanceCalendar/StatusPageFixture.js",
      "StatusPageSearch/Fixture.js",
    ]) {
      expect(files).toContain(file);
    }
  });

  test("mount a BrowserRouter, as a JSX element whose props can be read", () => {
    const others = [];

    for (const fixture of fixtures) {
      for (const router of fixture.routers) {
        if (
          router.kind !== "element" ||
          router.name !== "BrowserRouter" ||
          router.transitions === "spread"
        ) {
          others.push(
            `${fixture.file}:${router.line} ${router.kind} ${router.name}${
              router.transitions === "spread" ? " with spread props" : ""
            }`,
          );
        }
      }
    }

    expect(others).toEqual([]);
  });

  test("draw the frontends their imports name", () => {
    const drawn = (file) => {
      return frontendsDrawnBy(path.join(E2E_DIR, file));
    };

    expect(drawn("SecurityOperations/Fixture/Fixture.js")).toEqual([
      "Dashboard",
    ]);
    expect(drawn("StatusPageSearch/Fixture.js")).toEqual(["StatusPage"]);
    expect(drawn("MaintenanceCalendar/Fixture.js")).toEqual(["Dashboard"]);
    expect(drawn("MaintenanceCalendar/StatusPageFixture.js")).toEqual([
      "StatusPage",
    ]);
    expect(drawn("Backups/Fixture/Fixture.js")).toEqual(["AdminDashboard"]);
    expect(drawn("SignInOptions/Fixture/Fixture.js")).toEqual([
      "Accounts",
      "StatusPage",
    ]);
    expect(drawn("BulkActions/Fixture/Fixture.js")).toEqual([
      "AdminDashboard",
      "Dashboard",
    ]);
    // Common's shells only: navigates as the Dashboard.
    expect(drawn("NewVersion/Fixture/Index.js")).toEqual([]);
  });

  test("navigate as the frontend they draw: a Dashboard page without React Router's transitions", () => {
    const wrong = [];

    for (const fixture of fixtures) {
      const drawn = frontendsDrawnBy(fixture.full);
      const expected = expectedTransitionsOf(drawn, transitionsByFrontend);

      for (const router of fixture.routers) {
        if (router.transitions !== expected) {
          wrong.push(
            `${fixture.file}:${router.line} draws ${
              drawn.length > 0 ? drawn.join(" and ") : "Common's shells"
            }, so its BrowserRouter ${
              expected === "off"
                ? "takes useTransitions={false}, as the Dashboard's (src/Index.tsx)"
                : "keeps React Router's transitions, as that frontend's src/Index.tsx"
            }`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });
});
