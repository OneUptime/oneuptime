import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The exception detail view is a small routed product of its own. Each piece
 * of its navigation is maintained in a different file, so a missing entry can
 * leave a menu link pointing at a blank page without producing a type error.
 *
 * App tests run in Node and cannot render Dashboard route modules. Follow the
 * existing product-wiring suites: inspect the source while ignoring formatting
 * so these assertions pin the contract rather than Prettier's line wrapping.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...segments: Array<string>) => string;

const readSource: ReadSourceFunction = (...segments: Array<string>): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

const dense: (source: string) => string = (source: string): string => {
  return source.replace(/\s+/g, "");
};

interface DetailPage {
  key: string;
  section: string;
  suffix: string;
  title: string;
}

const DETAIL_PAGES: ReadonlyArray<DetailPage> = [
  {
    key: "EXCEPTIONS_VIEW",
    section: "Overview",
    suffix: "",
    title: "Overview",
  },
  {
    key: "EXCEPTIONS_VIEW_STACK_TRACE",
    section: "StackTrace",
    suffix: "/stack-trace",
    title: "Stack Trace",
  },
  {
    key: "EXCEPTIONS_VIEW_OCCURRENCES",
    section: "Occurrences",
    suffix: "/occurrences",
    title: "Occurrences",
  },
  {
    key: "EXCEPTIONS_VIEW_CONTEXT",
    section: "Context",
    suffix: "/context",
    title: "Context",
  },
  {
    key: "EXCEPTIONS_VIEW_AI_ASSISTANCE",
    section: "AIAssistance",
    suffix: "/ai-assistance",
    title: "AI Assistance",
  },
  {
    key: "EXCEPTIONS_VIEW_SETTINGS",
    section: "Settings",
    suffix: "/settings",
    title: "Settings",
  },
];

describe("exception detail page wiring", () => {
  test.each(DETAIL_PAGES)("PageMap declares $key", (page: DetailPage) => {
    expect(readSource("Utils", "PageMap.ts")).toContain(
      `${page.key} = "${page.key}"`,
    );
  });

  test.each(DETAIL_PAGES)(
    "$key keeps its expected route suffix",
    (page: DetailPage) => {
      const routeMap: string = dense(readSource("Utils", "RouteMap.ts"));
      const expectedPath: string = page.suffix
        ? `\`${"${RouteParams.ModelID}"}${page.suffix}\``
        : "`${RouteParams.ModelID}`";

      expect(routeMap).toContain(`[PageMap.${page.key}]:${expectedPath}`);
      expect(routeMap).toContain(`[PageMap.${page.key}]:newRoute(`);
    },
  );

  test("preserves the legacy /exceptions/:id overview URL", () => {
    const routeMap: string = dense(readSource("Utils", "RouteMap.ts"));

    expect(routeMap).toContain(
      "[PageMap.EXCEPTIONS_VIEW]:`${RouteParams.ModelID}`",
    );
    expect(routeMap).toContain(
      "[PageMap.EXCEPTIONS_VIEW_ROOT]:newRoute(`/dashboard/${RouteParams.ProjectID}/exceptions`,)",
    );
    expect(routeMap).toContain(
      "[PageMap.EXCEPTIONS_VIEW]:newRoute(`/dashboard/${RouteParams.ProjectID}/exceptions/${ExceptionsRoutePath[PageMap.EXCEPTIONS_VIEW]}`,)",
    );
  });

  test("mounts the six pages beneath one exception layout", () => {
    const routes: string = dense(readSource("Routes", "ExceptionsRoutes.tsx"));

    expect(routes).toContain(
      'path={ExceptionsRoutePath[PageMap.EXCEPTIONS_VIEW]||""}element={<ExceptionViewLayout{...props}/>}',
    );
    expect(routes).toContain(
      "<PageRouteindexelement={<ExceptionView{...props}pageRoute={RouteMap[PageMap.EXCEPTIONS_VIEW]asRoute}section={ExceptionDetailSection.Overview}/>} />".replace(
        /\s+/g,
        "",
      ),
    );

    for (const page of DETAIL_PAGES.slice(1)) {
      expect(routes).toContain(
        `path={RouteUtil.getLastPathForKey(PageMap.${page.key},)}element={<ExceptionView{...props}pageRoute={RouteMap[PageMap.${page.key}]asRoute}section={ExceptionDetailSection.${page.section}}/>}`,
      );
    }
  });

  test.each(DETAIL_PAGES)(
    "the side menu links to $title exactly once",
    (page: DetailPage) => {
      const sideMenu: string = dense(
        readSource("Pages", "Exceptions", "View", "SideMenu.tsx"),
      );
      const destination: string = `getRoute(PageMap.${page.key})`;
      const denseTitle: string = page.title.replace(/\s+/g, "");

      expect(sideMenu.split(destination)).toHaveLength(2);
      expect(sideMenu).toContain(`title:\"${denseTitle}\",to:${destination}`);
    },
  );

  test("groups investigation, AI, and management destinations deliberately", () => {
    const sideMenu: string = dense(
      readSource("Pages", "Exceptions", "View", "SideMenu.tsx"),
    );

    expect(sideMenu).toContain('<SideMenuSectiontitle="Investigate">');
    expect(sideMenu).toContain('<SideMenuSectiontitle="Resolve">');
    expect(sideMenu).toContain('<SideMenuSectiontitle="Manage">');
  });

  test.each(DETAIL_PAGES)(
    "$title has a breadcrumb trail under the exception",
    (page: DetailPage) => {
      const breadcrumbs: string = dense(
        readSource("Utils", "Breadcrumbs", "ExceptionsBreadcrumbs.ts"),
      );
      const denseTitle: string = page.title.replace(/\s+/g, "");

      expect(breadcrumbs).toContain(
        `BuildBreadcrumbLinksByTitles(PageMap.${page.key},[\"Project\",\"Exceptions\",\"Exception\",\"${denseTitle}\",])`,
      );
    },
  );
});
