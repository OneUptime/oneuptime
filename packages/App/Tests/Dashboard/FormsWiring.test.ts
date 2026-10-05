import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source wiring of the dashboard's Forms product: forms anyone with the link
 * can fill in, whose submissions create incidents or scheduled maintenance
 * events. It replaced Incident Forms, which lived under Incidents >
 * Settings > Forms. App has no renderer, so the files are read as text and
 * only the invariants that would silently break the product if they drifted
 * are pinned:
 *
 *   - every page is reachable: PageMap keys, relative and absolute routes
 *     under /forms, the product mounted in App.tsx, list pages inside the
 *     Forms layout (its menu), a form's pages inside the form's layout (its
 *     menu), and breadcrumbs for each;
 *   - Forms is a product in the product menu, with the automation products
 *     right after Runbooks, and has Developer pages like every product;
 *   - Incident Forms is gone: no Forms item in the Incidents menu, no old
 *     page keys, files or breadcrumbs - and the old URLs forward to the same
 *     form in Forms, outside the Incidents layout;
 *   - a form's menu walks the order a form is set up in, and Delete Form is
 *     in Advanced.
 *
 * The behaviour behind these is covered by jsdom tests in Common
 * (FormsPages, FormShareLinkCard, FormBuilderState, FormOnSubmit,
 * IncidentsSideMenu, BreadcrumbCoverage and ProductMenuBreadcrumbs).
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");

const ROUTES: string = "Routes/FormsRoutes.tsx";
const ALL_ROUTES: string = "Routes/AllRoutes.tsx";
const INCIDENTS_ROUTES: string = "Routes/IncidentsRoutes.tsx";
const MOVED_PAGE_PATHS: string = "Routes/MovedPagePaths.ts";
const LIST_MENU: string = "Pages/Forms/SideMenu.tsx";
const VIEW_MENU: string = "Pages/Forms/View/SideMenu.tsx";
const LIST_LAYOUT: string = "Pages/Forms/Layout.tsx";
const VIEW_LAYOUT: string = "Pages/Forms/View/Layout.tsx";
const BREADCRUMBS: string = "Utils/Breadcrumbs/FormsBreadcrumbs.ts";
const INCIDENT_BREADCRUMBS: string = "Utils/Breadcrumbs/IncidentBreadcrumbs.ts";
const INCIDENTS_MENU: string = "Pages/Incidents/SideMenu.tsx";
const NAVIGATION_ITEMS: string = "Utils/NavigationItems.tsx";
const REDIRECT: string = "Components/FormBuilder/MovedFormPageRedirect.tsx";
const SHARE_LINK: string = "Components/FormBuilder/FormShareLink.ts";
const DEVELOPER_PAGES: string =
  "Components/DeveloperDocs/DeveloperDocsPages.ts";

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

// Comments removed (they may legitimately mention anything), whitespace squashed.
function readCode(relativePath: string): string {
  return readRaw(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

// Comments and all whitespace removed, so Prettier can reflow freely.
function dense(relativePath: string): string {
  return readCode(relativePath).replace(/\s+/g, "");
}

/*
 * All whitespace removed but comments kept: the route files hold route
 * strings ending in "/*", which the comment stripping above would take for
 * the start of a comment.
 */
function denseRaw(relativePath: string): string {
  return readRaw(relativePath).replace(/\s+/g, "");
}

/*
 * The source between two markers. Throws rather than returning empty: a
 * marker that moved would otherwise let every assertion below pass vacuously.
 */
function sectionBetween(source: string, start: string, end: string): string {
  const startsAt: number = source.indexOf(start);

  if (startsAt < 0) {
    throw new Error(`Expected to find ${start}`);
  }

  const from: number = startsAt + start.length;
  const to: number = source.indexOf(end, from);

  if (to < 0) {
    throw new Error(`Expected to find ${end} after ${start}`);
  }

  return source.slice(from, to);
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

interface FormsPageCase {
  pageKey: string;
  // The relative route, or null for the list - the product's mount itself.
  relativePath: string | null;
  // The route element's component, as FormsRoutes imports it.
  pageComponent: string;
  page: string;
  // The layout it is drawn in: the product's, or a form's.
  layout: "list" | "view";
  breadcrumb: Array<string>;
}

const PAGES: Array<FormsPageCase> = [
  {
    pageKey: "FORMS",
    relativePath: null,
    pageComponent: "Forms",
    page: "Pages/Forms/Forms",
    layout: "list",
    breadcrumb: ["Project", "Forms"],
  },
  {
    pageKey: "FORMS_SUBMISSIONS",
    relativePath: '"submissions"',
    pageComponent: "FormsSubmissions",
    page: "Pages/Forms/Submissions",
    layout: "list",
    breadcrumb: ["Project", "Forms", "Submissions"],
  },
  {
    pageKey: "FORM_VIEW",
    relativePath: "`${RouteParams.ModelID}`",
    pageComponent: "FormBuild",
    page: "Pages/Forms/View/Build",
    layout: "view",
    breadcrumb: ["Project", "Forms", "View Form"],
  },
  {
    pageKey: "FORM_VIEW_ON_SUBMIT",
    relativePath: "`${RouteParams.ModelID}/on-submit`",
    pageComponent: "FormOnSubmit",
    page: "Pages/Forms/View/OnSubmit",
    layout: "view",
    breadcrumb: ["Project", "Forms", "View Form", "On Submit"],
  },
  {
    pageKey: "FORM_VIEW_SHARE",
    relativePath: "`${RouteParams.ModelID}/share`",
    pageComponent: "FormShare",
    page: "Pages/Forms/View/Share",
    layout: "view",
    breadcrumb: ["Project", "Forms", "View Form", "Share"],
  },
  {
    pageKey: "FORM_VIEW_SUBMISSIONS",
    relativePath: "`${RouteParams.ModelID}/submissions`",
    pageComponent: "FormViewSubmissions",
    page: "Pages/Forms/View/Submissions",
    layout: "view",
    breadcrumb: ["Project", "Forms", "View Form", "Submissions"],
  },
  {
    pageKey: "FORM_VIEW_DELETE",
    relativePath: "`${RouteParams.ModelID}/delete`",
    pageComponent: "FormDelete",
    page: "Pages/Forms/View/Delete",
    layout: "view",
    breadcrumb: ["Project", "Forms", "View Form", "Delete Form"],
  },
];

describe("the product's mount", () => {
  test("FORMS_ROOT is declared, routed to /forms/* and mounted lazily in App.tsx", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      'FORMS_ROOT = "FORMS_ROOT",',
    );
    // Prettier may wrap the call, with a trailing comma: either is the same route.
    expect(denseRaw("Utils/RouteMap.ts").replace(/,\)/g, ")")).toContain(
      "[PageMap.FORMS_ROOT]:newRoute(`/dashboard/${RouteParams.ProjectID}/forms/*`),",
    );

    const app: string = dense("App.tsx");

    expect(app).toContain(
      'constFormsRoutes:LazyRoutes=lazy(()=>{returnimport("./Routes/FormsRoutes");});',
    );
    expect(
      countOf(
        app,
        '<PageRoutepath={RouteMap[PageMap.FORMS_ROOT]?.toString()||""}element={<FormsRoutes{...commonPageProps}/>}/>',
      ),
    ).toBe(1);
    expect(dense(ALL_ROUTES)).toContain(
      'export{defaultasFormsRoutes}from"./FormsRoutes";',
    );
  });

  test("the list is the mount's index route, inside the Forms layout", () => {
    const code: string = denseRaw(ROUTES);

    expect(code).toContain(
      '<PageRoutepath="/"element={<FormsLayout{...props}/>}><PageRouteindexelement={<Forms{...props}pageRoute={RouteMap[PageMap.FORMS]asRoute}/>}/>',
    );
  });

  test("a form's pages are inside the form's layout, which opens on Build", () => {
    const code: string = denseRaw(ROUTES);

    expect(code).toContain(
      '<PageRoutepath={FormsRoutePath[PageMap.FORM_VIEW]||""}element={<FormViewLayout{...props}/>}><PageRouteindexelement={<FormBuild{...props}pageRoute={RouteMap[PageMap.FORM_VIEW]asRoute}/>}/>',
    );
  });
});

describe.each(PAGES)("the $pageKey page", (c: FormsPageCase) => {
  test("is declared in PageMap", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      `${c.pageKey} = "${c.pageKey}",`,
    );
  });

  test("has its route under /forms", () => {
    const routeMap: string = denseRaw("Utils/RouteMap.ts");

    if (c.relativePath === null) {
      expect(routeMap).toContain(
        `[PageMap.${c.pageKey}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/forms\`),`,
      );
      return;
    }

    const routePaths: string = sectionBetween(
      routeMap,
      "exportconstFormsRoutePath:Dictionary<string>={",
      "};",
    );

    expect(routePaths).toContain(
      `[PageMap.${c.pageKey}]:${c.relativePath.replace(/\s+/g, "")},`,
    );
    expect(routeMap).toContain(
      `[PageMap.${c.pageKey}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/forms/\${FormsRoutePath[PageMap.${c.pageKey}]}\`,),`,
    );
  });

  test("is mounted once, in its layout", () => {
    const code: string = denseRaw(ROUTES);
    const element: string = `element={<${c.pageComponent}{...props}pageRoute={RouteMap[PageMap.${c.pageKey}]asRoute}/>}`;

    expect(countOf(code, element)).toBe(1);
    expect(code).toContain(`import${c.pageComponent}from"../${c.page}";`);

    const at: number = code.indexOf(element);
    const viewLayoutAt: number = code.indexOf(
      "element={<FormViewLayout{...props}/>}",
    );

    expect(viewLayoutAt).toBeGreaterThan(-1);

    if (c.layout === "list") {
      expect(at).toBeLessThan(viewLayoutAt);
    } else {
      expect(at).toBeGreaterThan(viewLayoutAt);
    }

    expect(fs.existsSync(path.join(DASHBOARD_SRC, `${c.page}.tsx`))).toBe(true);
  });

  test("has breadcrumbs", () => {
    const titles: string = c.breadcrumb
      .map((title: string): string => {
        return `"${title.replace(/\s+/g, "")}"`;
      })
      .join(",");

    expect(dense(BREADCRUMBS)).toContain(
      `...BuildBreadcrumbLinksByTitles(PageMap.${c.pageKey},[${titles}`,
    );
  });
});

describe("the layouts", () => {
  test("both read their breadcrumbs from the Forms breadcrumbs, exported with the others", () => {
    expect(dense("Utils/Breadcrumbs/index.ts")).toContain(
      'export*from"./FormsBreadcrumbs";',
    );
    expect(dense(LIST_LAYOUT)).toContain(
      "breadcrumbLinks={getFormsBreadcrumbs(path)}sideMenu={<FormsSideMenu/>}",
    );
    expect(dense(VIEW_LAYOUT)).toContain(
      "breadcrumbLinks={getFormsBreadcrumbs(path)}sideMenu={<FormViewSideMenumodelId={modelId}/>}",
    );
  });

  test("a form's page is titled with the form's name", () => {
    expect(dense(VIEW_LAYOUT)).toContain(
      '<ModelPagetitle="Form"modelType={Form}modelId={modelId}modelNameField="name"',
    );
  });
});

describe("the menus", () => {
  test("the product's menu: Forms, then every submission, then the Developer pages", () => {
    const code: string = dense(LIST_MENU);

    expect(code).toContain(
      '{link:{title:"Forms",to:RouteUtil.populateRouteParams(RouteMap[PageMap.FORMS]asRoute),},icon:IconProp.ClipboardDocumentList,}',
    );
    expect(code).toContain(
      '{link:{title:"Submissions",to:RouteUtil.populateRouteParams(RouteMap[PageMap.FORMS_SUBMISSIONS]asRoute,),},icon:IconProp.InboxStack,}',
    );
    expect(code).toContain(
      "addDeveloperSideMenuSection(sections,{modelType:Form,scope:DeveloperDocsScope.List,});",
    );
    // No Settings section: a form carries its own settings.
    expect(code).not.toContain('title:"Settings"');
  });

  test("a form's menu walks the order a form is set up in, then Developer, then Advanced", () => {
    const code: string = dense(VIEW_MENU);
    const titles: Array<string> = [
      ...code.matchAll(/title(?::|=)"([^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(titles).toEqual([
      "Form",
      "Build",
      "OnSubmit",
      "Share",
      "Submissions",
      "Advanced",
      "DeleteForm",
    ]);

    const developer: number = code.indexOf(
      "getDeveloperSideMenuSection({modelType:Form,scope:DeveloperDocsScope.View,modelId:props.modelId,})",
    );

    expect(developer).toBeGreaterThan(code.indexOf('title:"Submissions"'));
    expect(developer).toBeLessThan(code.indexOf('title="Advanced"'));

    for (const pageKey of [
      "FORM_VIEW",
      "FORM_VIEW_ON_SUBMIT",
      "FORM_VIEW_SHARE",
      "FORM_VIEW_SUBMISSIONS",
      "FORM_VIEW_DELETE",
    ]) {
      expect(code).toContain(
        `RouteUtil.populateRouteParams(RouteMap[PageMap.${pageKey}]asRoute,{modelId:props.modelId},)`,
      );
    }

    expect(sectionBetween(code, 'title:"DeleteForm"', "/>")).toContain(
      'className="danger-on-hover"',
    );
  });

  test("both scopes have Developer pages, for the Form table", () => {
    const code: string = dense(DEVELOPER_PAGES);

    expect(code).toContain(
      '{pageKey:PageMap.FORMS,scope:DeveloperDocsScope.List,tableName:"Form",}',
    );
    expect(code).toContain(
      '{pageKey:PageMap.FORM_VIEW,scope:DeveloperDocsScope.View,tableName:"Form",}',
    );

    const routes: string = denseRaw(ROUTES);

    expect(routes).toContain(
      "getDeveloperDocsRoutes({modelType:FormModel,scope:DeveloperDocsScope.List,props,mountPageKey:PageMap.FORMS_ROOT,})",
    );
    expect(routes).toContain(
      "getDeveloperDocsRoutes({modelType:FormModel,scope:DeveloperDocsScope.View,props,})",
    );
  });
});

describe("the product menu", () => {
  function formsItem(): string {
    return sectionBetween(
      dense(NAVIGATION_ITEMS),
      'title:t("navbar.items.formsTitle","Forms"),',
      "category:analyticsAutomationCategory,",
    );
  }

  test("lists Forms, opening the list, with its own description", () => {
    const item: string = formsItem();

    expect(item).toContain(
      "route:RouteUtil.populateRouteParams(RouteMap[PageMap.FORMS]asRoute),",
    );
    expect(item).toContain("activeRoute:RouteMap[PageMap.FORMS],");
    expect(item).toContain("icon:IconProp.ClipboardDocumentList,");
    expect(item).toContain(
      'description:t("navbar.items.formsDescription","Formsanyonecanfillinthatcreateincidentsorscheduledmaintenanceevents.",),',
    );
  });

  test("someone looking for the old incident forms finds it", () => {
    const item: string = formsItem();

    for (const keyword of [
      '"incidentform"',
      '"formbuilder"',
      '"submissions"',
    ]) {
      expect(item).toContain(keyword);
    }
  });

  test("sits with the automation products, right after Runbooks", () => {
    const code: string = dense(NAVIGATION_ITEMS);
    const runbooks: number = code.indexOf(
      'description:t("navbar.items.runbooksDescription"),',
    );
    const forms: number = code.indexOf(
      'title:t("navbar.items.formsTitle","Forms"),',
    );

    expect(runbooks).toBeGreaterThan(-1);
    expect(forms).toBeGreaterThan(runbooks);
    // Nothing else is listed between them.
    expect(code.slice(runbooks, forms)).not.toContain('title:t("navbar.items.');
  });
});

describe("Incident Forms is gone", () => {
  test("the Incidents menu has no Forms item", () => {
    const code: string = dense(INCIDENTS_MENU);

    expect(code).not.toContain('title:"Forms"');
    expect(code).not.toContain("FORMS");
  });

  test("no page key, route, breadcrumb or page of it is left", () => {
    expect(readCode("Utils/PageMap.ts")).not.toContain(
      "INCIDENTS_SETTINGS_FORMS",
    );
    expect(readCode("Utils/RouteMap.ts")).not.toContain(
      "INCIDENTS_SETTINGS_FORMS",
    );
    expect(readCode(INCIDENT_BREADCRUMBS)).not.toContain(
      "INCIDENTS_SETTINGS_FORMS",
    );

    for (const relativePath of [
      "Pages/Incidents/Settings/IncidentForms.tsx",
      "Pages/Incidents/Settings/IncidentFormView.tsx",
      "Components/IncidentForm",
    ]) {
      expect(fs.existsSync(path.join(DASHBOARD_SRC, relativePath))).toBe(false);
    }
  });

  test("its old URLs forward to the same form in Forms, outside the Incidents layout", () => {
    const code: string = denseRaw(INCIDENTS_ROUTES);

    expect(denseRaw(MOVED_PAGE_PATHS)).toContain(
      'exportconstMOVED_INCIDENT_FORM_PATHS:{forms:string;formView:string}={forms:"settings/forms",formView:`settings/forms/${RouteParams.ModelID}`,};',
    );
    // Imported from the shared module; other moved paths may share the import.
    expect(code).toMatch(
      /import\{[^}]*\bMOVED_INCIDENT_FORM_PATHS\b[^}]*\}from"\.\/MovedPagePaths";/,
    );

    const forms: number = code.indexOf(
      "<PageRoutepath={MOVED_INCIDENT_FORM_PATHS.forms}element={<MovedFormPageRedirectpageMap={PageMap.FORMS}/>}/>",
    );
    const formView: number = code.indexOf(
      "<PageRoutepath={MOVED_INCIDENT_FORM_PATHS.formView}element={<MovedFormPageRedirectpageMap={PageMap.FORM_VIEW}/>}/>",
    );
    const layout: number = code.indexOf(
      '<PageRoutepath="/"element={<Layout{...props}hideSideMenu={hideSideMenu}/>}>',
    );

    expect(forms).toBeGreaterThan(-1);
    expect(formView).toBeGreaterThan(-1);
    expect(layout).toBeGreaterThan(formView);
    expect(layout).toBeGreaterThan(forms);
  });

  test("the forward replaces the old address and keeps the form's id, query and hash", () => {
    const code: string = dense(REDIRECT);

    expect(code).toContain(
      "props.pageMap===PageMap.FORM_VIEW&&modelId?{modelId}:undefined",
    );
    expect(code).toContain(
      "<Navigatereplace={true}to={{pathname:destination.toString(),search:location.search,hash:location.hash,}}/>",
    );
  });
});

describe("the share link", () => {
  test("is the Accounts app's form route with the form's share key", () => {
    const code: string = dense(SHARE_LINK);

    expect(code).toContain('import{ACCOUNTS_URL}from"Common/UI/Config";');
    expect(code).toContain(
      'exportconstFORM_PUBLIC_ROUTE_SEGMENT:string="form";',
    );
    // From a copy of ACCOUNTS_URL: addRoute changes the URL it is called on.
    expect(code).toContain(
      "returnURL.fromString(ACCOUNTS_URL.toString()).addRoute(`/${FORM_PUBLIC_ROUTE_SEGMENT}/${shareKey.toString()}`,);",
    );
  });

  test("matches the route the Accounts app mounts the public page on", () => {
    const accountsApp: string = fs.readFileSync(
      path.join(APP_ROOT, "FeatureSet/Accounts/src/App.tsx"),
      "utf8",
    );

    expect(accountsApp).toContain('path="/accounts/form/:shareKey"');
  });
});
