import { describe, expect, test } from "@jest/globals";
import {
  RouteAttributes,
  routeMapPath,
  routesAt,
  routesInCode,
} from "./PageRoutes";

/*
 * The route reader the wiring suites pin the apps' routes with (#7684): a
 * route reads the same however Prettier breaks its lines, and a pin of one
 * route - the routes at its path, held to a list of one - fails when the
 * route is mounted anywhere else, twice, or as anything else.
 */

const MOUNT_PATH: string = routeMapPath("SCHEDULED_MAINTENANCE_EVENTS_ROOT");

const MOUNT: RouteAttributes = {
  path: MOUNT_PATH,
  element: "<ScheduledMaintenanceEventsRoutes {...commonPageProps} />",
};

const MOUNT_ON_ONE_LINE: string =
  '<PageRoute path={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT]?.toString() || ""} element={<ScheduledMaintenanceEventsRoutes {...commonPageProps} />} />';

// As Prettier writes it two levels into App.tsx's <Routes>.
const MOUNT_WRAPPED: string = `
  <PageRoute
    path={
      RouteMap[
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT
      ]?.toString() || ""
    }
    element={
      <ScheduledMaintenanceEventsRoutes {...commonPageProps} />
    }
  />`;

function routesOf(routes: string): Array<RouteAttributes> {
  return routesInCode(`<Routes>${routes}</Routes>`);
}

describe("a route reads as its code, however its lines are broken", () => {
  test.each([
    ["on one line", MOUNT_ON_ONE_LINE],
    ["wrapped, its key inside its brackets too", MOUNT_WRAPPED],
  ])("a product's mount, %s", (_layout: string, code: string) => {
    expect(routesOf(code)).toEqual([MOUNT]);
  });

  test.each([
    [
      "on one line",
      '<PageRoute path={tokenFreeRoute(RouteMap[PageMap.UNSUBSCRIBE]?.toString() || "")} element={<Unsubscribe statusPageName={statusPageName} manageLinkChannels={manageLinkChannels} />} />',
    ],
    [
      "wrapped, with the comma Prettier adds",
      `
      <PageRoute
        path={tokenFreeRoute(
          RouteMap[PageMap.UNSUBSCRIBE]?.toString() || "",
        )}
        element={
          <Unsubscribe
            statusPageName={statusPageName}
            manageLinkChannels={
              manageLinkChannels
            }
          />
        }
      />`,
    ],
  ])("a call and a page's props, %s", (_layout: string, code: string) => {
    expect(routesOf(code)).toEqual([
      {
        path: 'tokenFreeRoute(RouteMap[PageMap.UNSUBSCRIBE]?.toString() || "")',
        element:
          "<Unsubscribe statusPageName={statusPageName} manageLinkChannels={manageLinkChannels} />",
      },
    ]);
  });

  test.each([
    [
      "on one line",
      '<PageRoute element={<MonitorLayout {...commonPageProps} />}><PageRoute path="monitors" element={<Monitors renderEmpty={() => <Empty />} />}><PageRoute index element={<MonitorList />} /></PageRoute></PageRoute>',
    ],
    [
      "wrapped, with comments, a tag's > on a line of its own and JSX in parentheses",
      `
      {/* Monitors */}
      <PageRoute
        element={<MonitorLayout {...commonPageProps} />}
      >
        {/* The list */}
        <PageRoute
          path="monitors"
          element={
            <Monitors
              renderEmpty={() => (
                <Empty />
              )}
            />
          }
        >
          <PageRoute index element={<MonitorList />} />
        </PageRoute>
      </PageRoute>`,
    ],
  ])("layout routes and their routes, %s", (_layout: string, code: string) => {
    expect(routesOf(code)).toEqual([
      {
        element: "<MonitorLayout {...commonPageProps} />",
        children:
          '<PageRoute path="monitors" element={<Monitors renderEmpty={() => <Empty />} />}><PageRoute index element={<MonitorList />} /></PageRoute>',
      },
      {
        path: '"monitors"',
        element: "<Monitors renderEmpty={() => <Empty />} />",
        children: "<PageRoute index element={<MonitorList />} />",
      },
      { index: "true", element: "<MonitorList />" },
    ]);
  });

  test.each([
    [
      "on one line",
      '<PageRoute path={RouteMap[PageMap.LOGS_ROOT]?.toString().replace("/*", "") || ""} element={<Logs />} />',
    ],
    [
      "broken before its dots",
      `
      <PageRoute
        path={
          RouteMap[PageMap.LOGS_ROOT]
            ?.toString()
            .replace("/*", "") || ""
        }
        element={<Logs />}
      />`,
    ],
  ])("a member chain, %s", (_layout: string, code: string) => {
    expect(routesOf(code)).toEqual([
      {
        path: 'RouteMap[PageMap.LOGS_ROOT]?.toString().replace("/*", "") || ""',
        element: "<Logs />",
      },
    ]);
  });

  test.each([
    [
      "on one line",
      '<PageRoute path="soon" element={<Placeholder>Coming soon</Placeholder>} />',
    ],
    [
      "on lines of its own",
      `
      <PageRoute
        path="soon"
        element={
          <Placeholder>
            Coming   soon
          </Placeholder>
        }
      />`,
    ],
  ])("JSX text, %s", (_layout: string, code: string) => {
    expect(routesOf(code)).toEqual([
      {
        path: '"soon"',
        element: "<Placeholder>Coming soon</Placeholder>",
      },
    ]);
  });

  test("a string keeps its quotes, an attribute with no value is true, and a spread is kept whole", () => {
    expect(
      routesOf(
        '<PageRoute path="*" element={<PageNotFound />} /><PageRoute {...routeProps} path="x" element={<X />} caseSensitive />',
      ),
    ).toEqual([
      { path: '"*"', element: "<PageNotFound />" },
      {
        "{...routeProps}": "",
        path: '"x"',
        element: "<X />",
        caseSensitive: "true",
      },
    ]);
  });

  test("only the tag asked for is read: PageRoute, or react-router's own Route", () => {
    const code: string =
      '<Route path="/accounts" element={<LoginPage />} /><PageRoute path="/x" element={<X />} />';

    expect(routesOf(code)).toEqual([{ path: '"/x"', element: "<X />" }]);
    expect(routesInCode(`<Routes>${code}</Routes>`, "Route")).toEqual([
      { path: '"/accounts"', element: "<LoginPage />" },
    ]);
  });
});

describe("a pin of one route holds all of it", () => {
  test("the route pinned passes", () => {
    expect(routesAt(routesOf(MOUNT_WRAPPED), MOUNT_PATH)).toEqual([MOUNT]);
  });

  test.each([
    [
      "mounted at another path",
      '<PageRoute path={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS]?.toString() || ""} element={<ScheduledMaintenanceEventsRoutes {...commonPageProps} />} />',
    ],
    ["mounted twice", MOUNT_ON_ONE_LINE + MOUNT_WRAPPED],
    [
      "drawing another element",
      '<PageRoute path={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT]?.toString() || ""} element={<ScheduledMaintenanceEventsRoutes />} />',
    ],
    [
      "given another attribute",
      '<PageRoute path={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT]?.toString() || ""} element={<ScheduledMaintenanceEventsRoutes {...commonPageProps} />} caseSensitive />',
    ],
    [
      "given routes of its own",
      '<PageRoute path={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT]?.toString() || ""} element={<ScheduledMaintenanceEventsRoutes {...commonPageProps} />}><PageRoute index element={<Overview />} /></PageRoute>',
    ],
    [
      "mounted with another tag",
      '<Route path={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT]?.toString() || ""} element={<ScheduledMaintenanceEventsRoutes {...commonPageProps} />} />',
    ],
  ])("fails for the route %s", (_change: string, code: string) => {
    expect(routesAt(routesOf(code), MOUNT_PATH)).not.toEqual([MOUNT]);
  });
});
