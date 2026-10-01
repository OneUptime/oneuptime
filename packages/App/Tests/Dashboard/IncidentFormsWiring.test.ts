import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source wiring of the dashboard's incident forms pages (issue #4114):
 * Incidents > Settings > Forms, and a form's own page. App has no renderer,
 * so the files are read as text and only the invariants that would silently
 * break the feature if they drifted are pinned:
 *
 *   - both pages are reachable: PageMap keys, relative and absolute routes,
 *     mounted inside the Incidents layout (with its side menu), breadcrumbs,
 *     and a "Forms" item in the Settings section right after "Incident
 *     Templates";
 *   - a form's page shows the link a reporter opens - the Accounts app's
 *     incident-form route with the form's share key - and resets it through
 *     ResetObjectID on that column;
 *   - its Questions card is the custom field settings card in form mode;
 *   - both pages take the severity, which the server requires, from one
 *     shared field, and the submissions are listed with a plain ModelTable
 *     (IncidentsTable carries saved views and custom field columns that are
 *     about incidents, not submissions).
 *
 * The behaviour behind these is covered by jsdom tests in Common
 * (IncidentFormsPages, IncidentFormShareLinkCard, IncidentsSideMenu,
 * BreadcrumbCoverage and ProductMenuBreadcrumbs).
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");

const LIST_PAGE: string = "Pages/Incidents/Settings/IncidentForms.tsx";
const VIEW_PAGE: string = "Pages/Incidents/Settings/IncidentFormView.tsx";
const SHARE_LINK: string = "Components/IncidentForm/IncidentFormShareLink.ts";
const SHARE_LINK_CARD: string =
  "Components/IncidentForm/IncidentFormShareLinkCard.tsx";
const FIELDS: string = "Components/IncidentForm/IncidentFormFields.ts";
const ROUTES: string = "Routes/IncidentsRoutes.tsx";
const SIDE_MENU: string = "Pages/Incidents/SideMenu.tsx";
const BREADCRUMBS: string = "Utils/Breadcrumbs/IncidentBreadcrumbs.ts";

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

interface FormsPageCase {
  name: string;
  pageKey: string;
  relativePath: string;
  pageComponent: string;
  page: string;
  breadcrumb: Array<string>;
}

const PAGES: Array<FormsPageCase> = [
  {
    name: "Forms list",
    pageKey: "INCIDENTS_SETTINGS_FORMS",
    relativePath: '"settings/forms"',
    pageComponent: "IncidentSettingsForms",
    page: LIST_PAGE,
    breadcrumb: ["Project", "Incidents", "Settings", "Forms"],
  },
  {
    name: "form's own page",
    pageKey: "INCIDENTS_SETTINGS_FORMS_VIEW",
    relativePath: "`settings/forms/${RouteParams.ModelID}`",
    pageComponent: "IncidentSettingsFormView",
    page: VIEW_PAGE,
    breadcrumb: ["Project", "Incidents", "Settings", "Forms", "View Form"],
  },
];

describe.each(PAGES)("the $name", (c: FormsPageCase) => {
  test("is declared in PageMap", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      `${c.pageKey} = "${c.pageKey}",`,
    );
  });

  test("has a relative route under Incidents > Settings", () => {
    const routePaths: string = sectionBetween(
      denseRaw("Utils/RouteMap.ts"),
      "exportconstIncidentsRoutePath:Dictionary<string>={",
      "};",
    );

    expect(routePaths).toContain(
      `[PageMap.${c.pageKey}]:${c.relativePath.replace(/\s+/g, "")},`,
    );
  });

  test("has an absolute route in the incidents product", () => {
    expect(denseRaw("Utils/RouteMap.ts")).toContain(
      `[PageMap.${c.pageKey}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/incidents/\${IncidentsRoutePath[PageMap.${c.pageKey}]}\`,),`,
    );
  });

  test("is mounted inside the Incidents layout, so it has the side menu", () => {
    const code: string = denseRaw(ROUTES);
    const layoutStart: string =
      '<PageRoutepath="/"element={<Layout{...props}hideSideMenu={hideSideMenu}/>}>';
    const route: string = `<PageRoutepath={IncidentsRoutePath[PageMap.${c.pageKey}]||""}element={<${c.pageComponent}{...props}pageRoute={RouteMap[PageMap.${c.pageKey}]asRoute}/>}/>`;
    const at: number = code.indexOf(route);
    const layoutAt: number = code.indexOf(layoutStart);

    expect(layoutAt).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(layoutAt);
    // The layout's children are all self-closing: nothing closed it yet.
    expect(code.slice(layoutAt, at)).not.toContain("</PageRoute>");
    expect(code.split(route).length - 1).toBe(1);
    expect(code).toContain(
      `import${c.pageComponent}from"../${c.page.replace(/\.tsx$/, "")}";`,
    );
  });

  test("has breadcrumbs", () => {
    const titles: string = c.breadcrumb
      .map((title: string): string => {
        return `"${title.replace(/\s+/g, "")}"`;
      })
      .join(",");

    expect(dense(BREADCRUMBS)).toContain(
      `...BuildBreadcrumbLinksByTitles(PageMap.${c.pageKey},[${titles},]),`,
    );
  });
});

describe("the Incidents side menu", () => {
  function settingsSection(): string {
    // Settings is the last section: it runs to the end of the sections array.
    return sectionBetween(dense(SIDE_MENU), 'title:"Settings",', "];");
  }

  test("links Forms from the Settings section, with the forms icon", () => {
    expect(settingsSection()).toContain(
      '{link:{title:"Forms",to:RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENTS_SETTINGS_FORMS]asRoute,),},icon:IconProp.ClipboardDocumentList,}',
    );
    // Linked once; the form's own page is reached from the list.
    expect(
      dense(SIDE_MENU).split("PageMap.INCIDENTS_SETTINGS_FORMS]").length - 1,
    ).toBe(1);
    expect(dense(SIDE_MENU)).not.toContain("INCIDENTS_SETTINGS_FORMS_VIEW");
  });

  test("puts Forms right after Incident Templates", () => {
    const titles: Array<string> = [
      ...settingsSection().matchAll(/title:"([^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(titles.indexOf("Forms")).toBeGreaterThan(0);
    expect(titles.indexOf("Forms")).toBe(
      titles.indexOf("IncidentTemplates") + 1,
    );
  });
});

describe("the list page", () => {
  test("lists the project's IncidentForm rows in a table of its own", () => {
    const code: string = dense(LIST_PAGE);

    expect(code).toContain(
      'importIncidentFormfrom"Common/Models/DatabaseModels/IncidentForm";',
    );
    expect(code).toContain("<ModelTable<IncidentForm>modelType={IncidentForm}");
    expect(code).toContain('id="incident-forms-table"');
    expect(code).toContain('userPreferencesKey="incident-forms-table"');
    expect(code).toContain(
      'saveFilterProps={{tableId:"incident-forms-table",}}',
    );
    expect(code).toContain(
      "query={{projectId:ProjectUtil.getCurrentProjectId()!,}}",
    );
    expect(code).toContain(
      "viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}",
    );
  });
});

describe("the fields both pages share", () => {
  test("the severity is required, and both pages build it from the one field", () => {
    const severity: string = sectionBetween(
      dense(FIELDS),
      "exportconstgetIncidentFormSeverityField:GetIncidentFormFieldFunction=(",
      "};};",
    );

    expect(severity).toContain("field:{incidentSeverity:true,}");
    expect(severity).toContain("required:true,");

    expect(dense(LIST_PAGE)).toContain(
      "getIncidentFormSeverityField(INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID)",
    );
    expect(dense(VIEW_PAGE)).toContain("getIncidentFormSeverityField(),");

    for (const page of [LIST_PAGE, VIEW_PAGE]) {
      expect(dense(page)).not.toContain("incidentSeverity:true");
    }
  });
});

describe("a form's page", () => {
  test("shows the Questions card in form mode", () => {
    expect(dense(VIEW_PAGE)).toContain(
      '<IncidentCustomFieldSettingsCardmode="form"modelType={IncidentForm}modelId={modelId}/>',
    );
  });

  test("shows the Share Link card, read again after Form Details is saved", () => {
    const code: string = dense(VIEW_PAGE);

    expect(code).toContain(
      "<IncidentFormShareLinkCardmodelId={modelId}refresher={shareLinkRefresher}/>",
    );
    expect(code).toContain(
      "onSaveSuccess={()=>{setShareLinkRefresher((previous:boolean):boolean=>{return!previous;});}}",
    );
  });

  test("lists submissions with a plain ModelTable of this form's rows", () => {
    const code: string = dense(VIEW_PAGE);

    expect(code).toContain(
      "<ModelTable<IncidentFormSubmission>modelType={IncidentFormSubmission}",
    );
    expect(code).toContain(
      "query={{incidentFormId:modelId,projectId:ProjectUtil.getCurrentProjectId()!,}}",
    );
    expect(code).toContain("isCreateable={false}");
    expect(code).toContain("isEditable={false}");
    expect(code).not.toContain("IncidentsTable");
    expect(code).not.toContain("customFieldsModelType");
  });

  test("goes back to the list after the form is deleted", () => {
    expect(dense(VIEW_PAGE)).toContain(
      "onDeleteSuccess={()=>{Navigation.navigate(RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENTS_SETTINGS_FORMS]asRoute,),);}}",
    );
  });
});

describe("the share link", () => {
  test("is the Accounts app's incident-form route with the form's share key", () => {
    const code: string = dense(SHARE_LINK);

    expect(code).toContain('import{ACCOUNTS_URL}from"Common/UI/Config";');
    expect(code).toContain(
      'exportconstINCIDENT_FORM_PUBLIC_ROUTE_SEGMENT:string="incident-form";',
    );
    // From a copy of ACCOUNTS_URL: addRoute changes the URL it is called on.
    expect(code).toContain(
      "returnURL.fromString(ACCOUNTS_URL.toString()).addRoute(`/${INCIDENT_FORM_PUBLIC_ROUTE_SEGMENT}/${shareKey.toString()}`,);",
    );
  });

  test("is reset through ResetObjectID on the form's shareKey column", () => {
    const code: string = dense(SHARE_LINK_CARD);

    expect(code).toContain(
      '<ResetObjectID<IncidentForm>modelType={IncidentForm}fieldName="shareKey"modelId={props.modelId}',
    );
    expect(code).toContain("buttonTitle={IncidentFormCopy.resetLink}");
    expect(code).toContain(
      "confirmDescription={IncidentFormCopy.resetLinkConfirmation}",
    );
    expect(code).toContain(
      "constlink:URL=getIncidentFormShareLink(shown.shareKey);",
    );
  });
});
