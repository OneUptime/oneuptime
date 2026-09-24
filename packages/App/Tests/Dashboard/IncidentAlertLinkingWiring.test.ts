import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source wiring of linking alerts to incidents in the dashboard. App has no
 * renderer, so the files are read as text and only the invariants that would
 * silently break the feature if they drifted are pinned:
 *
 *   - the "Linked Alerts" (incident) and "Linked Incidents" (alert) pages are
 *     reachable: PageMap keys, relative and absolute routes, mounted inside
 *     the right view layout, breadcrumbs, and side-menu items in existing
 *     sections (the incident view's sections are pinned elsewhere);
 *   - both pages list IncidentAlert rows scoped to the record being viewed,
 *     link from a card button gated on the link AND on reading the other
 *     side, through the shared numbered link dialog, and say "Link" /
 *     "Unlink" rather than create / delete (the bulk action too);
 *   - the alerts table offers the two bulk actions and renders their dialog,
 *     gated on the link model (and incident read) and capped;
 *   - the create-incident page reads `?alertIds=` and hands the ids to the
 *     server through miscDataProps;
 *   - the lifecycle switches sit in a card of their own, because a
 *     CardModelDetail writes every field it holds on Update.
 *
 * The behaviour behind these is covered by jsdom tests in Common
 * (IncidentAlertLinking*.test.tsx) and by IncidentFromAlerts.test.ts.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");

const INCIDENT_PAGE: string = "Pages/Incidents/View/Alerts.tsx";
const ALERT_PAGE: string = "Pages/Alerts/View/Incidents.tsx";
const BULK_HOOK: string = "Components/Alert/BulkIncidentLinkActions.tsx";
const LINK_HELPERS: string = "Components/IncidentAlert/IncidentAlertLink.ts";
const LINK_DIALOG: string =
  "Components/IncidentAlert/LinkIncidentAlertModal.tsx";
const ALERTS_TABLE: string = "Components/Alert/AlertsTable.tsx";
const CREATE_PAGE: string = "Pages/Incidents/Create.tsx";
const SETTINGS_PAGE: string =
  "Pages/Incidents/Settings/IncidentMoreSettings.tsx";

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

function withoutSpaces(value: string): string {
  return value.replace(/\s+/g, "");
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

// Every `field: { <name>: ... }` in a chunk of dense source, in order.
function fieldNames(denseSection: string): Array<string> {
  return [...denseSection.matchAll(/field:\{([A-Za-z]+):/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// Every column title of a ModelTable's `columns={[...]}`, in order.
function columnTitles(denseSource: string): Array<string> {
  const columns: string = denseSource.slice(denseSource.indexOf("columns={["));

  return [...columns.matchAll(/\},title:"([^"]+)",type:FieldType\./g)].map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

interface LinkPageCase {
  name: string;
  page: string;
  pageKey: string;
  viewKey: string;
  segment: string;
  routePathObject: string;
  urlSegment: string;
  routesFile: string;
  pageComponent: string;
  layoutStart: string;
  layoutEnd: string | null;
  breadcrumbFile: string;
  breadcrumb: Array<string>;
  sideMenu: string;
  sideMenuSection: string;
  menuTitle: string;
  scopeField: string;
  linkedField: string;
  linkedModel: string;
  singularName: string;
  columns: Array<string>;
  viewAction: string;
  linkButton: string;
  optionsLoader: string;
}

const LINK_PAGES: Array<LinkPageCase> = [
  {
    name: "incident Linked Alerts",
    page: INCIDENT_PAGE,
    pageKey: "INCIDENT_VIEW_ALERTS",
    viewKey: "INCIDENT_VIEW",
    segment: "alerts",
    routePathObject: "IncidentsRoutePath",
    urlSegment: "incidents",
    routesFile: "Routes/IncidentsRoutes.tsx",
    pageComponent: "IncidentViewAlerts",
    layoutStart:
      '<PageRoutepath={IncidentsRoutePath[PageMap.INCIDENT_VIEW]||""}element={<IncidentViewLayout{...props}/>}>',
    layoutEnd: null,
    breadcrumbFile: "Utils/Breadcrumbs/IncidentBreadcrumbs.ts",
    breadcrumb: ["Project", "Incidents", "View Incident", "Linked Alerts"],
    sideMenu: "Pages/Incidents/View/SideMenu.tsx",
    sideMenuSection: "Investigation",
    menuTitle: "Linked Alerts",
    scopeField: "incidentId",
    linkedField: "alertId",
    linkedModel: "Alert",
    singularName: "Alert",
    columns: ["Alert #", "Title", "Current State", "Linked At", "Linked By"],
    viewAction: "View Alert",
    linkButton: "Link Alert",
    optionsLoader: "fetchAlertLinkOptions",
  },
  {
    name: "alert Linked Incidents",
    page: ALERT_PAGE,
    pageKey: "ALERT_VIEW_INCIDENTS",
    viewKey: "ALERT_VIEW",
    segment: "incidents",
    routePathObject: "AlertsRoutePath",
    urlSegment: "alerts",
    routesFile: "Routes/AlertRoutes.tsx",
    pageComponent: "AlertViewIncidents",
    layoutStart:
      '<PageRoutepath={AlertsRoutePath[PageMap.ALERT_VIEW]||""}element={<AlertViewLayout{...props}/>}>',
    layoutEnd:
      '<PageRoutepath={AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW]||""}',
    breadcrumbFile: "Utils/Breadcrumbs/AlertBreadcrumbs.ts",
    breadcrumb: ["Project", "Alerts", "View Alert", "Linked Incidents"],
    sideMenu: "Pages/Alerts/View/SideMenu.tsx",
    sideMenuSection: "Basic",
    menuTitle: "Linked Incidents",
    scopeField: "alertId",
    linkedField: "incidentId",
    linkedModel: "Incident",
    singularName: "Incident",
    columns: ["Incident #", "Title", "Current State", "Linked At", "Linked By"],
    viewAction: "View Incident",
    linkButton: "Link Incident",
    optionsLoader: "fetchIncidentLinkOptions",
  },
];

describe.each(LINK_PAGES)("the $name page", (c: LinkPageCase) => {
  test("is declared in PageMap", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      `${c.pageKey} = "${c.pageKey}",`,
    );
  });

  test("has a relative route one segment under the viewed record", () => {
    const code: string = denseRaw("Utils/RouteMap.ts");
    const routePaths: string = sectionBetween(
      code,
      `exportconst${c.routePathObject}:Dictionary<string>={`,
      "};",
    );

    expect(routePaths).toContain(
      `[PageMap.${c.pageKey}]:\`\${RouteParams.ModelID}/${c.segment}\`,`,
    );
  });

  test("has an absolute route, declared after the record's own view route", () => {
    const code: string = denseRaw("Utils/RouteMap.ts");
    const route: string = `[PageMap.${c.pageKey}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/${c.urlSegment}/\${${c.routePathObject}[PageMap.${c.pageKey}]}\`,),`;
    const viewRoute: string = `[PageMap.${c.viewKey}]:newRoute(`;

    expect(code).toContain(route);
    expect(code.indexOf(viewRoute)).toBeGreaterThan(-1);
    expect(code.indexOf(route)).toBeGreaterThan(code.indexOf(viewRoute));
  });

  test("is mounted inside the record's view layout", () => {
    const code: string = denseRaw(c.routesFile);
    const layoutStart: number = code.indexOf(c.layoutStart);
    const layoutEnd: number = c.layoutEnd
      ? code.indexOf(c.layoutEnd)
      : code.lastIndexOf("</Routes>");
    const route: string = `<PageRoutepath={RouteUtil.getLastPathForKey(PageMap.${c.pageKey})}element={<${c.pageComponent}{...props}pageRoute={RouteMap[PageMap.${c.pageKey}]asRoute}/>}/>`;
    const at: number = code.indexOf(route);

    expect(layoutStart).toBeGreaterThan(-1);
    expect(layoutEnd).toBeGreaterThan(layoutStart);
    expect(at).toBeGreaterThan(layoutStart);
    expect(at).toBeLessThan(layoutEnd);
    expect(code).toContain(
      `import${c.pageComponent}from"../${c.page.replace(/\.tsx$/, "")}";`,
    );
  });

  test("has breadcrumbs", () => {
    const titles: string = c.breadcrumb
      .map((title: string): string => {
        return `"${withoutSpaces(title)}"`;
      })
      .join(",");

    expect(dense(c.breadcrumbFile)).toContain(
      `...BuildBreadcrumbLinksByTitles(PageMap.${c.pageKey},[${titles},]),`,
    );
  });

  test("is linked from the record's side menu, in an existing section", () => {
    const code: string = dense(c.sideMenu);
    const section: string = sectionBetween(
      code,
      `<SideMenuSectiontitle="${c.sideMenuSection}">`,
      "</SideMenuSection>",
    );

    expect(section).toContain(
      `<SideMenuItemlink={{title:"${withoutSpaces(c.menuTitle)}",to:RouteUtil.populateRouteParams(RouteMap[PageMap.${c.pageKey}]asRoute,{modelId:props.modelId},),}}icon={IconProp.Link}/>`,
    );
    // Linked once, and nowhere else in the menu.
    expect(code.split(`PageMap.${c.pageKey}]`).length - 1).toBe(1);
  });

  test("lists the IncidentAlert rows of the record being viewed", () => {
    const code: string = dense(c.page);

    expect(code).toContain(
      'importIncidentAlertfrom"Common/Models/DatabaseModels/IncidentAlert";',
    );
    expect(code).toContain(
      "<ModelTable<IncidentAlert>modelType={IncidentAlert}",
    );
    expect(code).toContain(
      "constmodelId:ObjectID=Navigation.getLastParamAsObjectID(1);",
    );
    expect(code).toContain(
      `query={{${c.scopeField}:modelId,projectId:ProjectUtil.getCurrentProjectId()!,}}`,
    );
  });

  /*
   * The table's own create form listed the other side by bare title. Linking
   * is a card button that opens the shared dialog instead, which lists
   * recent records by number - so the table must not offer a create form of
   * its own next to it.
   */
  test("links from its own card button, not the table's create form", () => {
    const code: string = dense(c.page);

    expect(code).toContain("isCreateable={false}");
    expect(code).toContain("isEditable={false}");
    expect(code).not.toContain("createVerb=");
    expect(code).not.toContain("formFields=");
    expect(code).not.toContain("onBeforeCreate=");
    expect(code).toContain(`singularName="${c.singularName}"`);
  });

  test("gates the link button on the link and on reading the other side", () => {
    const code: string = dense(c.page);

    expect(code).toMatch(
      new RegExp(
        `=lockUnlessAllowed\\(PermissionGate\\.gateCardButton\\(\\{title:"${withoutSpaces(c.linkButton)}",[\\s\\S]{0,200}\\},newIncidentAlert\\(\\),ModelAction\\.Create,\\),PermissionGate\\.check\\(new${c.linkedModel}\\(\\),ModelAction\\.Read\\),\\);`,
      ),
    );
    expect(code).toContain("onClick:()=>{setShowLinkModal(true);},");
  });

  test("links through the shared dialog, stamping the record, and refreshes", () => {
    const code: string = dense(c.page);

    expect(code).toContain(
      'importLinkIncidentAlertModalfrom"../../../Components/IncidentAlert/LinkIncidentAlertModal";',
    );

    const dialog: string = sectionBetween(
      code,
      "{showLinkModal&&(<LinkIncidentAlertModal",
      "/>)}",
    );

    expect(dialog).toContain(`title="${withoutSpaces(c.linkButton)}"`);
    expect(dialog).toContain(`modelType={${c.linkedModel}}`);
    expect(dialog).toContain(`loadOptions={${c.optionsLoader}}`);
    expect(dialog).toContain("awaitcreateIncidentAlertLink({");
    expect(dialog).toContain(`${c.scopeField}:modelId,`);
    expect(dialog).toContain(`${c.linkedField}:newObjectID(`);
    expect(dialog).toContain("setShowLinkModal(false);setRefreshToggle(");
    expect(code).toContain("refreshToggle={refreshToggle.toString()}");
  });

  test("says Unlink, not Delete, for a row", () => {
    const code: string = dense(c.page);

    expect(code).toContain("isDeleteable={true}");
    expect(code).toContain('deleteButtonText="Unlink"');
    expect(code).toContain(
      `getDeleteConfirmation={async():Promise<DeleteConfirmation>=>{return{title:"Unlink${withoutSpaces(c.singularName)}",`,
    );
    expect(code).toContain('submitButtonText:"Unlink",');
  });

  test("offers bulk unlink, warning that only the links are removed", () => {
    const code: string = dense(c.page);
    const bulkActions: string = sectionBetween(code, "bulkActions={{", "}}");

    expect(bulkActions).toContain(
      'buttons:[ModalTableBulkDefaultActions.Delete],deleteVerb:"Unlink",deleteIcon:IconProp.LinkSlash,',
    );
    expect(bulkActions).toMatch(
      /deleteConfirmationWarning:"Onlythelinksareremoved[^"]*notdeleted[^"]*"/,
    );
  });

  test("shows the agreed columns and a view action", () => {
    const code: string = dense(c.page);

    expect(columnTitles(code)).toEqual(c.columns.map(withoutSpaces));
    expect(code).toContain(`title:"${withoutSpaces(c.viewAction)}"`);
    expect(code).toContain('field:{createdAt:true,},title:"LinkedAt"');
    expect(code).toContain(
      "createdByUser:{name:true,email:true,profilePictureId:true,}",
    );
  });

  /*
   * Every column but Linked At is keyed by the same relation, so without an
   * export value of its own each one exported the related record's title.
   */
  test("gives each relation column its own CSV export value", () => {
    const columns: string = dense(c.page).slice(
      dense(c.page).indexOf("columns={["),
    );

    expect(columns.split("getExportValue:").length - 1).toBe(4);
  });
});

describe("the incident view side menu", () => {
  test("keeps Linked Alerts right after Postmortem, inside Investigation", () => {
    const code: string = dense("Pages/Incidents/View/SideMenu.tsx");
    const investigation: string = sectionBetween(
      code,
      '<SideMenuSectiontitle="Investigation">',
      "</SideMenuSection>",
    );

    const titles: Array<string> = [
      ...investigation.matchAll(/title:"([^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(titles).toEqual([
      "Description",
      "RootCause",
      "Remediation",
      "Runbooks",
      "Postmortem",
      "LinkedAlerts",
    ]);
  });
});

describe("declaring an incident from the alert page", () => {
  test("is a card button gated on creating the incident and the link", () => {
    const code: string = dense(ALERT_PAGE);

    expect(code).toContain(
      'letdeclareIncidentButton:CardButtonSchema|null=PermissionGate.gateCardButton({title:"DeclareIncident",',
    );
    expect(code).toMatch(
      /title:"DeclareIncident",[\s\S]{0,400}\},newIncident\(\),ModelAction\.Create,\);/,
    );
    expect(code).toContain(
      "declareIncidentButton=PermissionGate.gateCardButton(declareIncidentButton,newIncidentAlert(),ModelAction.Create,);",
    );
    expect(code).toContain(
      "if(linkIncidentButton){cardButtons.push(linkIncidentButton);}if(declareIncidentButton){cardButtons.push(declareIncidentButton);}",
    );
    expect(code).toContain("buttons:cardButtons,");
  });

  test("navigates to the create page with this alert's id", () => {
    expect(dense(ALERT_PAGE)).toContain(
      "Navigation.navigate(getDeclareIncidentFromAlertsRoute([modelId.toString()]),);",
    );
  });
});

describe("the alerts table bulk actions", () => {
  test("spreads the incident link actions before Delete and renders their dialog", () => {
    const code: string = dense(ALERTS_TABLE);

    expect(code).toContain(
      'importuseBulkIncidentLinkActionsfrom"./BulkIncidentLinkActions";',
    );
    expect(code).toContain(
      "const{bulkActions:incidentLinkBulkActions,modals:incidentLinkBulkActionModals,}=useBulkIncidentLinkActions();",
    );
    expect(code).toContain(
      "buttons:[getBulkChangeStateAction(),...labelBulkActions,...ownerBulkActions,...incidentLinkBulkActions,ModalTableBulkDefaultActions.Delete,]",
    );
    expect(code).toContain(
      "{labelBulkActionModals}{ownerBulkActionModals}{incidentLinkBulkActionModals}",
    );
  });

  test("gates linking on the link model and incident read, declaring on the incident too", () => {
    const code: string = dense(BULK_HOOK);

    expect(code).toContain(
      "constlinkGate:PermissionGateResult=PermissionGate.check(newIncidentAlert(),ModelAction.Create,);",
    );
    expect(code).toContain(
      "constincidentReadGate:PermissionGateResult=PermissionGate.check(newIncident(),ModelAction.Read,);",
    );
    expect(code).toContain(
      "constdeclareGate:PermissionGateResult=PermissionGate.check(newIncident(),ModelAction.Create,);",
    );
    expect(code).toContain(
      "...capAction(gateAction(linkToIncidentAction,[linkGate,incidentReadGate]),LINK_CAP_TOOLTIP,),",
    );
    expect(code).toContain(
      "...capAction(gateAction(declareIncidentAction,[declareGate,linkGate]),DECLARE_CAP_TOOLTIP,),",
    );
  });

  test("caps both actions at the shared per-action maximum", () => {
    const code: string = dense(BULK_HOOK);

    expect(code).toContain(
      'MAX_ALERTS_PER_INCIDENT_LINK_ACTION,}from"Common/Types/Incident/IncidentAlertLink";',
    );
    expect(code).toContain(
      "returnitems.length<=MAX_ALERTS_PER_INCIDENT_LINK_ACTION;",
    );
    expect(code).toContain(
      "returnitems.length>MAX_ALERTS_PER_INCIDENT_LINK_ACTION;},disabled:true,tooltip:tooltip,",
    );
  });

  test("creates one IncidentAlert per alert and treats an existing link as done", () => {
    const code: string = dense(BULK_HOOK);

    expect(code).toContain(
      "awaitcreateIncidentAlertLink({incidentId:newObjectID(incidentId),alertId:newObjectID(alertId),});",
    );
    expect(code).toContain(
      "if(isAlreadyLinkedError(message)){successItems.push(alert);}",
    );
  });

  test("picks the incident in the shared numbered dialog", () => {
    const code: string = dense(BULK_HOOK);

    expect(code).toContain('<LinkIncidentAlertModaltitle="LinktoIncident"');
    expect(code).toContain(
      "modelType={Incident}loadOptions={fetchIncidentLinkOptions}",
    );
    expect(code).toContain("onSubmit={linkAlertsToIncident}");
  });
});

describe("the shared link helpers and dialog", () => {
  test("create the link through the model API", () => {
    expect(dense(LINK_HELPERS)).toContain(
      "awaitModelAPI.create<IncidentAlert>({model:link,modelType:IncidentAlert,});",
    );
  });

  test("recognise a duplicate by the shared message, not by English words", () => {
    const code: string = dense(LINK_HELPERS);

    expect(code).toContain(
      'import{INCIDENT_ALERT_ALREADY_LINKED_MESSAGE}from"Common/Types/Incident/IncidentAlertLink";',
    );
    expect(code).toContain(
      "normalized.includes(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE.toLowerCase())",
    );
    expect(code).not.toContain('"alreadylinked"');
  });

  test("list recent records newest first", () => {
    const code: string = dense(LINK_HELPERS);

    expect(
      code.split("sort:{createdAt:SortOrder.Descending,}").length - 1,
    ).toBe(2);
  });

  test("search every record by title on the server as the user types", () => {
    expect(dense(LINK_DIALOG)).toContain(
      'dropdownModal:{type:props.modelType,labelField:"title",valueField:"_id",},dropdownOptions:options,',
    );
  });
});

describe("the create-incident page", () => {
  test("reads the alert ids from the shared query parameter", () => {
    const code: string = dense(CREATE_PAGE);

    expect(code).toContain(
      'INCIDENT_ALERT_IDS_TO_LINK_KEY,INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,MAX_ALERTS_PER_INCIDENT_LINK_ACTION,}from"Common/Types/Incident/IncidentAlertLink";',
    );
    expect(code).toContain(
      "IncidentFromAlerts.parseAlertIdsQueryParam(Navigation.getQueryStringByName(INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM),);",
    );
  });

  test("sends the linked alert ids as miscDataProps from onBeforeCreate", () => {
    const code: string = dense(CREATE_PAGE);

    expect(code).toContain(
      "onBeforeCreate={async(item:Incident,miscDataProps:JSONObject,):Promise<Incident>=>{",
    );
    expect(code).toContain(
      "miscDataProps[INCIDENT_ALERT_IDS_TO_LINK_KEY]=alertsToLink.map(",
    );
  });

  test("fetches the prefill before taking the loader down", () => {
    const code: string = dense(CREATE_PAGE);
    const loader: string = sectionBetween(
      code,
      "constfetchInitialValuesFromAlerts:",
      "constfetchAlertsToLink:",
    );

    expect(loader.indexOf("setIsLoading(true);")).toBeGreaterThan(-1);
    expect(loader.indexOf("awaitPromise.all([")).toBeGreaterThan(
      loader.indexOf("setIsLoading(true);"),
    );
    expect(loader.indexOf("setInitialValuesForIncident(")).toBeGreaterThan(
      loader.indexOf("awaitPromise.all(["),
    );
    expect(loader.lastIndexOf("setIsLoading(false);")).toBeGreaterThan(
      loader.indexOf("setInitialValuesForIncident("),
    );
  });

  test("never copies on-call policies from the alerts", () => {
    const code: string = dense(CREATE_PAGE);
    const alertPath: string = sectionBetween(
      code,
      "constfetchInitialValuesFromAlerts:",
      "constgetIncidentTemplateInitialValues:",
    );

    expect(alertPath).not.toContain("onCallDutyPolicies");
    expect(alertPath).not.toContain("onCallDutyPolicy");
  });

  test("aliases the banner so it does not shadow the Alert model", () => {
    const code: string = dense(CREATE_PAGE);

    expect(code).toContain(
      'importAlertfrom"Common/Models/DatabaseModels/Alert";',
    );
    expect(code).toContain(
      'importAlertBanner,{AlertType}from"Common/UI/Components/Alerts/Alert";',
    );
  });

  test("keeps the old flows when no alert ids are given", () => {
    const code: string = dense(CREATE_PAGE);

    expect(code).toContain(
      "}elseif(incidentTemplateId){fetchIncidentTemplate(newObjectID(incidentTemplateId));}else{fetchFirstIncidentState();setIsLoading(false);}",
    );
  });
});

describe("the linked alerts lifecycle settings", () => {
  const LIFECYCLE_FIELDS: Array<string> = [
    "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
    "resolveLinkedAlertsWhenIncidentResolved",
  ];

  function cards(): Array<string> {
    return dense(SETTINGS_PAGE).split("<CardModelDetail<Project>").slice(1);
  }

  test("are a card of their own that edits exactly the two switches", () => {
    const linkedAlertsCards: Array<string> = cards().filter(
      (card: string): boolean => {
        return card.startsWith('name="LinkedAlerts"');
      },
    );

    expect(linkedAlertsCards).toHaveLength(1);

    const card: string = linkedAlertsCards[0]!;

    expect(
      fieldNames(sectionBetween(card, "formFields={[", "modelDetailProps={{")),
    ).toEqual(LIFECYCLE_FIELDS);
    expect(
      fieldNames(sectionBetween(card, "modelDetailProps={{", "modelId:")),
    ).toEqual(LIFECYCLE_FIELDS);
    expect(card).toContain("fieldType:FormFieldSchemaType.Toggle");
    expect(card).toContain("isEditable={true}");
  });

  test("are not edited by any other card on the page", () => {
    const otherCards: Array<string> = cards().filter(
      (card: string): boolean => {
        return !card.startsWith('name="LinkedAlerts"');
      },
    );

    expect(otherCards.length).toBeGreaterThan(0);

    for (const card of otherCards) {
      for (const field of LIFECYCLE_FIELDS) {
        expect(card).not.toContain(field);
      }
    }
  });
});

describe("the overview pages", () => {
  test.each(["Pages/Incidents/View/Index.tsx", "Pages/Alerts/View/Index.tsx"])(
    "%s does not load links (they have their own pages)",
    (page: string) => {
      expect(readCode(page)).not.toContain("IncidentAlert");
    },
  );
});
