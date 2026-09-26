import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source wiring of "Declare Incident" in an alert's header, and of
 * acknowledging the alerts an incident is declared from. App has no renderer,
 * so the files are read as text and only the invariants that would silently
 * break the feature - or its permission and privacy guarantees - if they
 * drifted are pinned:
 *
 *   - the alert header offers the action whatever state the alert is in
 *     (resolved included), gated on creating the incident and then the link,
 *     hidden while permissions are unknown, and navigating to the prefilled
 *     create page; the other event headers do not grow it;
 *   - EventStatusPanel renders non-state actions after the state actions and
 *     before "More actions", neutral, never counted as state actions;
 *   - the create page only asks the server to acknowledge the alerts when it
 *     is also linking them and the box is offered, allowed and ticked, and
 *     its two extra reads can never take the page down;
 *   - the server refuses an impossible acknowledgement before the incident
 *     number is taken, checks the caller's right to change every alert's
 *     state before anything is written as root, and never makes the request
 *     wait for (or fail because of) the acknowledgements.
 *
 * The behaviour behind these is covered by jsdom tests in Common
 * (EventStatusPanel, ChangeAlertState, the create page), by the service tests
 * (IncidentAlertService, IncidentCreateFromAlerts) and by the offline
 * EventOverview Playwright suite.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const PACKAGES_ROOT: string = path.join(APP_ROOT, "..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");
const COMMON_ROOT: string = path.join(PACKAGES_ROOT, "Common");

const ALERT_CHANGE_STATE: string = "Components/Alert/ChangeState.tsx";
const DECLARE_FROM_ALERT: string =
  "Components/Alert/DeclareIncidentFromAlert.ts";
const BULK_HOOK: string = "Components/Alert/BulkIncidentLinkActions.tsx";
const EVENT_STATUS_PANEL: string = "Components/EventView/EventStatusPanel.tsx";
const ACKNOWLEDGE_ON_DECLARE: string =
  "Components/Incident/AcknowledgeAlertsOnDeclare.ts";
const ALERT_OVERVIEW_PAGE: string = "Pages/Alerts/View/Index.tsx";
const ALERT_LINKED_INCIDENTS_PAGE: string = "Pages/Alerts/View/Incidents.tsx";
const CREATE_PAGE: string = "Pages/Incidents/Create.tsx";

// The other headers built on EventStatusPanel: none of them declares incidents.
const OTHER_EVENT_HEADERS: Array<string> = [
  "Components/Incident/ChangeState.tsx",
  "Components/IncidentEpisode/ChangeState.tsx",
  "Components/AlertEpisode/ChangeState.tsx",
  "Components/ScheduledMaintenance/ChangeState.tsx",
];

const INCIDENT_SERVICE: string = "Server/Services/IncidentService.ts";
const INCIDENT_ALERT_SERVICE: string =
  "Server/Services/IncidentAlertService.ts";
const ALERT_SERVICE: string = "Server/Services/AlertService.ts";
const STATE_CHANGE_AUTHORIZATION: string =
  "Server/Utils/Alert/AlertStateChangeAuthorization.ts";
const INCIDENT_ALERT_LINK_TYPES: string = "Types/Incident/IncidentAlertLink.ts";

// Server code that could call the acknowledgement: the services and the workers / APIs.
const SERVER_SOURCE_DIRS: ReadonlyArray<string> = [
  path.join(COMMON_ROOT, "Server"),
  path.join(APP_ROOT, "FeatureSet/Workers"),
  path.join(APP_ROOT, "FeatureSet/BaseAPI"),
  path.join(APP_ROOT, "FeatureSet/Workflow"),
  path.join(APP_ROOT, "FeatureSet/MCP"),
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

// Comments removed (they may legitimately mention anything), whitespace squashed.
function readCode(relativePath: string): string {
  return stripComments(readRaw(relativePath));
}

// Comments and all whitespace removed, so Prettier can reflow freely.
function dense(relativePath: string): string {
  return readCode(relativePath).replace(/\s+/g, "");
}

// The same, for a file under packages/Common.
function denseCommon(relativePath: string): string {
  return stripComments(
    fs.readFileSync(path.join(COMMON_ROOT, relativePath), "utf8"),
  ).replace(/\s+/g, "");
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

/*
 * The inside of the block that opens at `openAt` (which must be a "{"), by
 * counting braces. Dense source has no comments left, and the files read here
 * hold no unbalanced brace inside a string.
 */
function blockAt(source: string, openAt: number): string {
  if (source[openAt] !== "{") {
    throw new Error(`Expected a "{" at ${openAt}`);
  }

  let depth: number = 0;

  for (let index: number = openAt; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(openAt + 1, index);
      }
    }
  }

  throw new Error(`Unbalanced block at ${openAt}`);
}

/*
 * The body of the function that starts at `marker`: the block opened by the
 * first `opener` after it (default: an arrow function's "=>{").
 */
function bodyOf(
  source: string,
  marker: string,
  opener: string = "=>{",
): string {
  const startsAt: number = source.indexOf(marker);

  if (startsAt < 0) {
    throw new Error(`Expected to find ${marker}`);
  }

  const openerAt: number = source.indexOf(opener, startsAt);

  if (openerAt < 0) {
    throw new Error(`Expected to find ${opener} after ${marker}`);
  }

  return blockAt(source, openerAt + opener.length - 1);
}

/*
 * The body of a class method: the block after its return type, so a
 * parameter type written as an object literal is skipped.
 */
function methodBody(source: string, signature: string): string {
  const startsAt: number = source.indexOf(signature);

  if (startsAt < 0) {
    throw new Error(`Expected to find ${signature}`);
  }

  const match: RegExpExecArray | null = /\):Promise<[^{]*>\{/.exec(
    source.slice(startsAt),
  );

  if (!match) {
    throw new Error(`Expected a return type after ${signature}`);
  }

  return blockAt(source, startsAt + match.index + match[0].length - 1);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// Every .ts / .tsx source file under a directory, tests and builds left out.
function sourceFilesUnder(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      ["node_modules", "build", "dist", "Tests", "Test"].includes(entry.name)
    ) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(fullPath));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("Declare Incident in the alert header", () => {
  test("ChangeAlertState builds the action from the alert id and hands it to the panel", () => {
    const code: string = dense(ALERT_CHANGE_STATE);

    expect(code).toContain(
      'import{getDeclareIncidentFromAlertAction}from"./DeclareIncidentFromAlert";',
    );
    expect(code).toContain(
      "constdeclareIncidentAction:EventPanelAction|null=getDeclareIncidentFromAlertAction(props.alertId);",
    );
    expect(code).toContain(
      "constsecondaryActions:Array<EventPanelAction>=declareIncidentAction?[declareIncidentAction]:[];",
    );
    // Built once, handed over once.
    expect(countOf(code, "getDeclareIncidentFromAlertAction(")).toBe(1);
    expect(countOf(code, "secondaryActions=")).toBe(1);

    const panelProps: string = sectionBetween(
      code,
      "<EventStatusPanel",
      "headerNotice=",
    );

    expect(panelProps).toContain("actions={getActions()}");
    expect(panelProps).toContain("secondaryActions={secondaryActions}");
  });

  /*
   * getActions() returns nothing for a resolved alert. The declare action is
   * built outside it, so a resolved alert keeps it - declaring after the fact
   * (for a postmortem, say) is allowed everywhere else too.
   */
  test("builds the action outside the state actions, so a resolved alert keeps it", () => {
    const code: string = dense(ALERT_CHANGE_STATE);
    const stateActions: string = bodyOf(code, "constgetActions:");

    expect(stateActions.startsWith("if(isResolved){return[];}")).toBe(true);
    expect(stateActions).not.toContain("Declare");
    expect(stateActions).not.toContain("secondaryActions");
    expect(stateActions).not.toContain("declareIncidentAction");

    // Nothing about the alert's state decides whether it is offered.
    const declareAt: number = code.indexOf("constdeclareIncidentAction:");
    const declaration: string = code.slice(
      declareAt,
      code.indexOf("constisAcknowledgeTarget:", declareAt),
    );

    expect(declaration).not.toContain("isResolved");
    expect(declaration).not.toContain("isAcknowledged");
    expect(declaration).not.toContain("currentAlertState");
    expect(code.indexOf("constdeclareIncidentAction:")).toBeGreaterThan(
      code.indexOf("constgetActions:"),
    );
  });

  test("keeps Acknowledge and Resolve as the state actions", () => {
    const stateActions: string = bodyOf(
      dense(ALERT_CHANGE_STATE),
      "constgetActions:",
    );

    expect(stateActions).toContain('label:"Acknowledge"');
    expect(stateActions).toContain('id:"alert-acknowledge-btn"');
    expect(countOf(stateActions, 'label:"Resolve"')).toBe(2);
  });

  test("the loading placeholder holds three buttons: Acknowledge, Resolve and Declare Incident", () => {
    const placeholder: string = sectionBetween(
      dense(ALERT_CHANGE_STATE),
      "exportconstAlertStatePlaceholder:",
      "constChangeAlertState:",
    );
    const buttonRow: string = sectionBetween(
      placeholder,
      '<divclassName="flexgap-2">',
      "</div></div>",
    );

    expect(countOf(buttonRow, '<divclassName="h-9')).toBe(3);
    expect(buttonRow).toContain(
      '<divclassName="h-9w-36rounded-mdbg-gray-100"/>',
    );
  });

  test("gates on creating the incident first, then the link", () => {
    const code: string = dense(DECLARE_FROM_ALERT);
    const gate: string = bodyOf(
      code,
      "exportconstgetDeclareIncidentFromAlertsGate:",
    );

    const incidentCheck: string =
      "constincidentGate:PermissionGateResult=PermissionGate.check(newIncident(),ModelAction.Create,);";
    const earlyReturn: string =
      "if(!incidentGate.isAllowed){returnincidentGate;}";
    const linkCheck: string =
      "returnPermissionGate.check(newIncidentAlert(),ModelAction.Create);";

    expect(gate.indexOf(incidentCheck)).toBe(0);
    expect(gate.indexOf(earlyReturn)).toBeGreaterThan(
      gate.indexOf(incidentCheck),
    );
    expect(gate.indexOf(linkCheck)).toBeGreaterThan(gate.indexOf(earlyReturn));
    // No other gate joins in.
    expect(countOf(gate, "PermissionGate.check(")).toBe(2);
  });

  test("hides the action while the answer is unknown, and locks it with the reason otherwise", () => {
    const action: string = bodyOf(
      dense(DECLARE_FROM_ALERT),
      "exportconstgetDeclareIncidentFromAlertAction:",
    );

    const gateCall: string =
      "constgate:PermissionGateResult=getDeclareIncidentFromAlertsGate();";
    const hidden: string =
      "if(!gate.isAllowed&&!gate.disabledReason){returnnull;}";
    const locked: string =
      "if(!gate.isAllowed){return{...action,isDisabled:true,tooltip:gate.disabledReason,onClick:()=>{},};}returnaction;";

    expect(action.indexOf(gateCall)).toBe(0);
    expect(action.indexOf(hidden)).toBeGreaterThan(action.indexOf(gateCall));
    expect(action.indexOf("constaction:EventPanelAction={")).toBeGreaterThan(
      action.indexOf(hidden),
    );
    expect(action.endsWith(locked)).toBe(true);
  });

  test("is the Declare Incident button: its id, the shared title, the alert icon, and the prefilled create page", () => {
    const code: string = dense(DECLARE_FROM_ALERT);
    const action: string = bodyOf(
      code,
      "exportconstgetDeclareIncidentFromAlertAction:",
    );

    expect(code).toContain(
      'exportconstDECLARE_INCIDENT_FROM_ALERT_BUTTON_ID:string="alert-declare-incident-btn";',
    );
    expect(code).toContain(
      'import{DECLARE_INCIDENT_ACTION_TITLE,getDeclareIncidentFromAlertsRoute,}from"./BulkIncidentLinkActions";',
    );
    expect(action).toContain(
      "constaction:EventPanelAction={id:DECLARE_INCIDENT_FROM_ALERT_BUTTON_ID,label:DECLARE_INCIDENT_ACTION_TITLE,icon:IconProp.Alert,onClick:()=>{Navigation.navigate(getDeclareIncidentFromAlertsRoute([alertId.toString()]),);},};",
    );

    // The same title, icon and route as the bulk action and the Linked Incidents page.
    expect(dense(BULK_HOOK)).toContain(
      'exportconstDECLARE_INCIDENT_ACTION_TITLE:string="DeclareIncident";',
    );
    expect(dense(ALERT_LINKED_INCIDENTS_PAGE)).toContain(
      'title:"DeclareIncident",buttonStyle:ButtonStyleType.NORMAL,icon:IconProp.Alert,onClick:()=>{Navigation.navigate(getDeclareIncidentFromAlertsRoute([modelId.toString()]),);},',
    );
  });

  test("costs the header no request", () => {
    const code: string = dense(DECLARE_FROM_ALERT);

    expect(code).not.toContain("ModelAPI");
    expect(code).not.toContain("API.");
    expect(code).not.toContain("await");
    expect(code).not.toContain("useEffect");
  });

  test("reaches the alert overview through ChangeAlertState, which still loads no links", () => {
    const overview: string = readCode(ALERT_OVERVIEW_PAGE);

    expect(dense(ALERT_OVERVIEW_PAGE)).toContain(
      'importChangeAlertStatefrom"../../../Components/Alert/ChangeState";',
    );
    expect(dense(ALERT_OVERVIEW_PAGE)).toContain(
      "<ChangeAlertStatealertId={modelId}",
    );
    expect(overview).not.toContain("IncidentAlert");
    expect(overview).not.toContain("DeclareIncidentFromAlert");
    expect(overview).not.toContain("secondaryActions");
  });

  test.each(OTHER_EVENT_HEADERS)("%s does not offer it", (file: string) => {
    const code: string = dense(file);

    expect(code).toContain("<EventStatusPanel");
    expect(code).not.toContain("secondaryActions");
    expect(code).not.toContain("DeclareIncidentFromAlert");
    expect(code).not.toContain("alert-declare-incident-btn");
  });
});

describe("EventStatusPanel secondary actions", () => {
  test("are a typed prop of their own, not state actions", () => {
    const code: string = dense(EVENT_STATUS_PANEL);

    expect(code).toContain(
      "exportinterfaceEventPanelAction{id:string;label:string;icon?:IconProp|undefined;onClick:()=>void;isDisabled?:boolean|undefined;tooltip?:string|undefined;}",
    );
    expect(code).toContain(
      "secondaryActions?:Array<EventPanelAction>|undefined;",
    );
  });

  test("render after the state actions and before the More actions menu, whatever the state", () => {
    const cluster: string = sectionBetween(
      dense(EVENT_STATUS_PANEL),
      'aria-label="Eventactions">',
      "</MoreMenu>",
    );

    // Unconditional: shown even when no state action is left (a resolved alert).
    expect(cluster).toContain(
      "{props.actions.map((action:EventStateAction)=>{returngetActionButton(action);})}{(props.secondaryActions||[]).map((action:EventPanelAction)=>{returngetSecondaryActionButton(action);})}{props.onStateSelect&&statesForMenu.length>0&&(<MoreMenu",
    );
    expect(countOf(cluster, "getSecondaryActionButton(")).toBe(1);
  });

  test("never hide a state from the More actions menu", () => {
    const code: string = dense(EVENT_STATUS_PANEL);

    expect(code).toContain(
      "constvisibleActionStateIds:Set<string>=newSet(props.actions.map((action:EventStateAction)=>{returnaction.stateId;}),);",
    );

    const menuRules: string = sectionBetween(
      code,
      "constvisibleActionStateIds:",
      "constactionBaseClassName:",
    );

    expect(menuRules).not.toContain("secondaryActions");
    expect(menuRules).not.toContain("EventPanelAction");
  });

  test("are neutral buttons that obey the panel's disabled state and never change state", () => {
    const button: string = bodyOf(
      dense(EVENT_STATUS_PANEL),
      "constgetSecondaryActionButton:",
    );

    expect(button).toContain(
      "consttranslatedActionLabel:string=translateString(action.label)||action.label;",
    );
    expect(button).toContain(
      "constisDisabled:boolean=Boolean(props.isDisabled||action.isDisabled);",
    );
    expect(button).toContain(
      "onClick={()=>{if(isDisabled){return;}action.onClick();}}",
    );
    expect(button).toContain("${actionBaseClassName}${neutralActionClassName}");
    expect(button).not.toContain("primaryActionClassName");
    expect(button).not.toContain("onActionClick");
    expect(button).not.toContain("onStateSelect");
  });

  test("put a locked action's reason on a focusable wrapper, since a disabled button shows no tooltip", () => {
    const button: string = bodyOf(
      dense(EVENT_STATUS_PANEL),
      "constgetSecondaryActionButton:",
    );

    expect(button).toContain(
      "consthasReachableTooltip:boolean=isDisabled&&Boolean(translatedTooltip);",
    );
    expect(button).toContain("if(!hasReachableTooltip){returnbutton;}");
    expect(button).toContain(
      "return(<Tooltipkey={action.id}text={translatedTooltip}>",
    );
    expect(button).toContain(
      "tabIndex={0}data-testid={`${action.id}-disabled-wrapper`}>{button}</span></Tooltip>);",
    );
  });
});

describe("the create-incident page asking to acknowledge the alerts", () => {
  test("sends the acknowledge key only while linking alerts, and only when it will acknowledge them", () => {
    const code: string = dense(CREATE_PAGE);
    const onBeforeCreate: string = bodyOf(
      code,
      "onBeforeCreate={async(item:Incident,miscDataProps:JSONObject,):Promise<Incident>=>{",
    );
    const linkingBranch: string = bodyOf(
      onBeforeCreate,
      "if(alertsToLink.length>0)",
      "){",
    );

    expect(linkingBranch).toContain(
      "miscDataProps[INCIDENT_ALERT_IDS_TO_LINK_KEY]=alertsToLink.map(",
    );
    expect(linkingBranch).toContain(
      "if(willAcknowledgeAlerts){miscDataProps[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]=true;}",
    );

    // Nowhere else: not outside that branch, and not anywhere else on the page.
    expect(
      countOf(onBeforeCreate, "INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY"),
    ).toBe(1);
    expect(countOf(code, "INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY")).toBe(2);
    expect(code).toContain(
      "importIncidentFromAlerts,{AlertForIncidentPrefill,AlertsToAcknowledge,AlertStateForAcknowledgement,",
    );
    expect(code).toContain(
      'INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,INCIDENT_ALERT_IDS_TO_LINK_KEY,INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,MAX_ALERTS_PER_INCIDENT_LINK_ACTION,}from"Common/Types/Incident/IncidentAlertLink";',
    );
  });

  test("will acknowledge only when there are alerts to acknowledge, the gate allows it and the box is ticked (by default)", () => {
    const code: string = dense(CREATE_PAGE);

    expect(code).toContain(
      "const[shouldAcknowledgeAlerts,setShouldAcknowledgeAlerts]=useState<boolean>(true);",
    );
    expect(code).toContain(
      "constacknowledgeGate:PermissionGateResult=getAcknowledgeAlertsGate();",
    );
    expect(code).toContain(
      "constisAcknowledgeOffered:boolean=alertsToAcknowledge!==null&&(acknowledgeGate.isAllowed||Boolean(acknowledgeGate.disabledReason));",
    );
    expect(code).toContain(
      "constwillAcknowledgeAlerts:boolean=alertsToAcknowledge!==null&&acknowledgeGate.isAllowed&&shouldAcknowledgeAlerts;",
    );
  });

  test("shows the box only when offered, locked with the reason when not allowed, and the note whenever alerts will keep escalating", () => {
    const code: string = dense(CREATE_PAGE);

    expect(code).toContain(
      '{isAcknowledgeOffered&&alertsToAcknowledge&&(<divclassName="mt-3"data-testid="incident-create-acknowledge-alerts"><CheckboxElementdataTestId="incident-create-acknowledge-alerts-checkbox"title={getAcknowledgeAlertsTitle(alertsToAcknowledge,alertsToLink.length,)}description={getAcknowledgeAlertsDescription(alertsToAcknowledge,acknowledgeGate.disabledReason,)}value={willAcknowledgeAlerts}disabled={!acknowledgeGate.isAllowed}hoverText={acknowledgeGate.disabledReason}onChange={(value:boolean)=>{setShouldAcknowledgeAlerts(value);}}/></div>)}',
    );
    expect(code).toContain(
      '{alertsToAcknowledge&&!willAcknowledgeAlerts&&(<pclassName="mt-2"data-testid="incident-create-alerts-keep-escalating">{getAlertsKeepEscalatingNote(alertsToAcknowledge,alertsToLink.length,)}</p>)}',
    );
  });

  test("gates the box on writing the state timeline first, then updating the alert, worded as acknowledging an alert", () => {
    const code: string = dense(ACKNOWLEDGE_ON_DECLARE);
    const gate: string = bodyOf(code, "exportconstgetAcknowledgeAlertsGate:");

    expect(code).toContain(
      'constACKNOWLEDGE_GATE_OPTIONS:PermissionGateOptions={verb:"acknowledge",singularName:"alert",};',
    );

    const timelineCheck: string =
      "consttimelineGate:PermissionGateResult=PermissionGate.check(newAlertStateTimeline(),ModelAction.Create,ACKNOWLEDGE_GATE_OPTIONS,);";
    const earlyReturn: string =
      "if(!timelineGate.isAllowed){returntimelineGate;}";
    const alertCheck: string =
      "returnPermissionGate.check(newAlert(),ModelAction.Update,ACKNOWLEDGE_GATE_OPTIONS,);";

    expect(gate.indexOf(timelineCheck)).toBe(0);
    expect(gate.indexOf(earlyReturn)).toBeGreaterThan(
      gate.indexOf(timelineCheck),
    );
    expect(gate.indexOf(alertCheck)).toBeGreaterThan(gate.indexOf(earlyReturn));
  });

  test("reads alert states and existing links alongside the alerts, before the loader comes down", () => {
    const code: string = dense(CREATE_PAGE);
    const loader: string = bodyOf(code, "constfetchInitialValuesFromAlerts:");

    const reads: string =
      "awaitPromise.all([fetchAlertsToLink(parsedAlertIds.alertIds),fetchAlertSeverities(),fetchIncidentSeverities(),fetchAlertStates(),fetchIncidentsLinkedToAlerts(parsedAlertIds.alertIds),]);";

    expect(loader).toContain(reads);

    const readsAt: number = loader.indexOf(reads);
    const loaderDownAt: number = loader.lastIndexOf("setIsLoading(false);");

    for (const statement of [
      "setIncidentsLinkedToAlerts(existingLinks);",
      "setAlertsToAcknowledge(toAcknowledge&&toAcknowledge.alertIds.length>0?toAcknowledge:null,);",
    ]) {
      expect({
        statement: statement,
        afterReads: loader.indexOf(statement) > readsAt,
        beforeLoaderDown: loader.indexOf(statement) < loaderDownAt,
      }).toEqual({
        statement: statement,
        afterReads: true,
        beforeLoaderDown: true,
      });
    }

    // States that could not be read mean nothing is offered.
    expect(loader).toContain(
      "consttoAcknowledge:AlertsToAcknowledge|null=alertStates?IncidentFromAlerts.getAlertsToAcknowledge({",
    );
    expect(loader).toContain(":null;setAlertsToLink(alerts);");
  });

  test("reads the alert states fail-soft, so a failed read only leaves the box out", () => {
    const states: string = bodyOf(dense(CREATE_PAGE), "constfetchAlertStates:");

    expect(states.startsWith("try{")).toBe(true);
    expect(states.endsWith("}catch{returnnull;}")).toBe(true);
    expect(states).toContain(
      "awaitModelAPI.getList<AlertState>({modelType:AlertState,query:{},limit:LIMIT_PER_PROJECT,skip:0,select:{_id:true,order:true,isAcknowledgedState:true},sort:{order:SortOrder.Ascending},});",
    );
    expect(countOf(states, "await")).toBe(1);
  });

  test("reads the existing links fail-soft, so a failed read only leaves the hint out", () => {
    const links: string = bodyOf(
      dense(CREATE_PAGE),
      "constfetchIncidentsLinkedToAlerts:",
    );
    const tryAt: number = links.indexOf("try{");
    const readAt: number = links.indexOf(
      "awaitModelAPI.getList<IncidentAlert>({modelType:IncidentAlert,query:{alertId:newIncludes(alertIds),},",
    );
    const catchAt: number = links.indexOf("}catch{returnnewMap();}");

    expect(tryAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(tryAt);
    expect(catchAt).toBeGreaterThan(readAt);
    expect(countOf(links, "await")).toBe(1);
    expect(links.endsWith("returnbyAlertId;")).toBe(true);
  });

  /*
   * The alert read is the one the whole page depends on: its state is taken
   * as a plain id and compared with the fail-soft state list, rather than
   * joining the state into that read.
   */
  test("keeps the required alert read to the alert's own state id", () => {
    const alerts: string = bodyOf(
      dense(CREATE_PAGE),
      "constfetchAlertsToLink:",
    );

    expect(alerts).toContain("currentAlertStateId:true,");
    expect(alerts).not.toContain("currentAlertState:");
    expect(alerts).not.toContain("try{");
  });

  test("warns on the On-Call step when the acknowledged alerts leave nobody paged", () => {
    const code: string = dense(CREATE_PAGE);

    expect(code).toContain(
      'if(!item.onCallDutyPolicies||!Array.isArray(item.onCallDutyPolicies)||item.onCallDutyPolicies.length===0){return(<p>Noon-callpolicieswillbeexecutedwhenthisincidentiscreated.{willAcknowledgeAlerts?`${ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE}`:""}</p>);}',
    );
  });
});

describe("the server acknowledging the alerts an incident is declared from", () => {
  test("shares one miscDataProps key between the page and the server", () => {
    expect(denseCommon(INCIDENT_ALERT_LINK_TYPES)).toContain(
      'exportconstINCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY:string="acknowledgeAlertsToLink";',
    );
  });

  test("validates the request after the alert ids and before the incident number is taken", () => {
    const onBeforeCreate: string = methodBody(
      denseCommon(INCIDENT_SERVICE),
      "protectedoverrideasynconBeforeCreate(createBy:CreateBy<Model>,",
    );

    const alertIdsAt: number = onBeforeCreate.indexOf(
      "awaitIncidentAlertService.validateAlertIdsForNewIncident({",
    );
    const acknowledgeAt: number = onBeforeCreate.indexOf(
      "constacknowledgedAlertStateId:ObjectID|null=awaitIncidentAlertService.validateAcknowledgeAlertsForNewIncident({projectId:projectId,acknowledgeAlerts:createBy.miscDataProps?.[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY],alertIds:validatedAlertIds,props:createBy.props,});",
    );
    const counterAt: number = onBeforeCreate.indexOf(
      "awaitProjectService.incrementAndGetIncidentCounter(projectId);",
    );

    expect(alertIdsAt).toBeGreaterThan(-1);
    expect(acknowledgeAt).toBeGreaterThan(alertIdsAt);
    expect(counterAt).toBeGreaterThan(acknowledgeAt);
    expect(onBeforeCreate).toContain(
      "if(validatedAlertIds.length>0){carryForward={alertIdsToLink:validatedAlertIds,acknowledgedAlertStateId:acknowledgedAlertStateId,};}",
    );
  });

  test("reads the key on create only, never again once the incident exists", () => {
    const code: string = denseCommon(INCIDENT_SERVICE);
    const onBeforeCreate: string = methodBody(
      code,
      "protectedoverrideasynconBeforeCreate(createBy:CreateBy<Model>,",
    );

    expect(countOf(code, "[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]")).toBe(1);
    expect(
      countOf(onBeforeCreate, "[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]"),
    ).toBe(1);
    // After creation the decision comes from the validated carry-forward alone.
    expect(
      bodyOf(code, "privateshouldAcknowledgeAlertsDeclaredWith(", "):boolean{"),
    ).toBe(
      "constcarryForward:IncidentCreateCarryForward=(onCreate.carryForwardasIncidentCreateCarryForward)||null;returnBoolean(carryForward?.acknowledgedAlertStateId);",
    );
  });

  test("acknowledges after linking, without waiting for it or failing because of it", () => {
    const code: string = denseCommon(INCIDENT_SERVICE);
    const declared: string = methodBody(
      code,
      "privateasynclinkAlertsDeclaredWithIncident(",
    );

    const linkAt: number = declared.indexOf(
      "awaitIncidentAlertService.linkAlertsToIncident({",
    );
    const gateAt: number = declared.indexOf(
      "if(!this.shouldAcknowledgeAlertsDeclaredWith(onCreate)){return;}",
    );
    const acknowledgeCall: string =
      "IncidentAlertService.acknowledgeAlertsDeclaredWithIncident({projectId:projectId,incidentId:incidentId,alertIds:alertIds,linkedAlertIds:linkedAlertIds,acknowledgedByUserId:this.getDeclaringUserId(onCreate,createdItem),}).then((acknowledged:AcknowledgeDeclaredAlertsResult)=>{";
    const acknowledgeAt: number = declared.indexOf(acknowledgeCall);

    expect(linkAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(linkAt);
    expect(acknowledgeAt).toBeGreaterThan(gateAt);
    expect(declared.slice(acknowledgeAt)).toContain(
      "}).catch((error:Error)=>{logger.error(",
    );

    // Fire-and-forget: neither awaited nor returned, and called nowhere else.
    expect(declared).not.toContain(
      "awaitIncidentAlertService.acknowledgeAlertsDeclaredWithIncident",
    );
    expect(declared).not.toContain(
      "returnIncidentAlertService.acknowledgeAlertsDeclaredWithIncident",
    );
    expect(countOf(code, "acknowledgeAlertsDeclaredWithIncident(")).toBe(1);

    // The links it acknowledges beside are the ones that exist.
    expect(declared).toContain(
      "linkedAlertIds=[...result.linkedAlertIds,...result.alreadyLinkedAlertIds,];",
    );
  });

  test("the linking itself is still awaited by onCreateSuccess", () => {
    const onCreateSuccess: string = methodBody(
      denseCommon(INCIDENT_SERVICE),
      "protectedoverrideasynconCreateSuccess(",
    );

    expect(onCreateSuccess).toContain(
      "awaitthis.linkAlertsDeclaredWithIncident(onCreate,createdItem,privacyRulesApplied,);",
    );
  });

  test("checks the caller may change every alert's state, unless root, before handing back the state to acknowledge with", () => {
    const validate: string = methodBody(
      denseCommon(INCIDENT_ALERT_SERVICE),
      "publicasyncvalidateAcknowledgeAlertsForNewIncident(",
    );

    const notAskedAt: number = validate.indexOf(
      "if(data.acknowledgeAlerts===undefined||data.acknowledgeAlerts===null||data.acknowledgeAlerts===false){returnnull;}",
    );
    const notBooleanAt: number = validate.indexOf(
      "if(data.acknowledgeAlerts!==true){thrownewBadDataException(",
    );
    const noAlertsAt: number = validate.indexOf(
      "if(data.alertIds.length===0){thrownewBadDataException(",
    );
    const stateAt: number = validate.indexOf(
      "awaitAlertStateService.findOneBy({query:{projectId:data.projectId,isAcknowledgedState:true,},",
    );
    const noStateAt: number = validate.indexOf(
      "if(!acknowledgedState||!acknowledgedState._id){thrownewBadDataException(",
    );
    const authorizationAt: number = validate.indexOf(
      "if(!data.props.isRoot&&!data.props.isMasterAdmin){try{awaitAlertStateChangeAuthorization.assertCanChangeStateOfAlerts({projectId:data.projectId,alertIds:data.alertIds,props:data.props,});}catch(error){",
    );
    const returnAt: number = validate.indexOf(
      "returnnewObjectID(acknowledgedState._id.toString());",
    );

    expect(notAskedAt).toBe(0);
    expect(notBooleanAt).toBeGreaterThan(notAskedAt);
    expect(noAlertsAt).toBeGreaterThan(notBooleanAt);
    expect(stateAt).toBeGreaterThan(noAlertsAt);
    expect(noStateAt).toBeGreaterThan(stateAt);
    expect(authorizationAt).toBeGreaterThan(noStateAt);
    expect(returnAt).toBeGreaterThan(authorizationAt);
    expect(
      validate.endsWith("returnnewObjectID(acknowledgedState._id.toString());"),
    ).toBe(true);

    // A refusal is a 400 the user can act on; anything else keeps its own answer.
    expect(validate).toContain(
      "if(errorinstanceofNotAuthorizedException||errorinstanceofBadDataException){thrownewBadDataException(",
    );
    expect(validate).toContain("}throwerror;}}");
  });

  test("writes the acknowledgements as root, credited to the declaring user, with nothing to authorize on its own", () => {
    const code: string = denseCommon(INCIDENT_ALERT_SERVICE);

    expect(code).toContain(
      'importAlertStateChangeAuthorizationfrom"../Utils/Alert/AlertStateChangeAuthorization";',
    );
    // It takes no caller props: the caller was checked in validateAcknowledgeAlertsForNewIncident.
    expect(code).toContain(
      "publicasyncacknowledgeAlertsDeclaredWithIncident(data:{projectId:ObjectID;incidentId:ObjectID;alertIds:Array<ObjectID>;linkedAlertIds:Array<ObjectID>;acknowledgedByUserId:ObjectID|undefined;}):Promise<AcknowledgeDeclaredAlertsResult>{",
    );

    const acknowledge: string = methodBody(
      code,
      "publicasyncacknowledgeAlertsDeclaredWithIncident(",
    );

    expect(acknowledge).toContain(
      "awaitAlertService.changeAlertState({projectId:data.projectId,alertId:alertId,alertStateId:acknowledgedStateId,notifyOwners:true,rootCause:rootCause,stateChangeLog:undefined,createdByUserId:data.acknowledgedByUserId,props:{isRoot:true,},});",
    );
    expect(countOf(acknowledge, "changeAlertState(")).toBe(1);
    expect(acknowledge).not.toContain("assertCanChangeStateOfAlerts");
    expect(acknowledge).not.toContain("miscDataProps");
    expect(acknowledge).not.toContain("props:data.props");

    // Only the alerts of this project are ever read or moved.
    expect(acknowledge).toContain(
      "awaitAlertService.findBy({query:{_id:QueryHelper.any(alertIds),projectId:data.projectId,},",
    );
  });

  test("never names a private incident in the acknowledgement's cause", () => {
    const code: string = denseCommon(INCIDENT_ALERT_SERVICE);
    const acknowledge: string = methodBody(
      code,
      "publicasyncacknowledgeAlertsDeclaredWithIncident(",
    );

    expect(acknowledge).toContain(
      "constrootCause:string=getDeclaredAlertAcknowledgementCause({incidentNumber:formatNumber(incident?.incidentNumberWithPrefix,incident?.incidentNumber,),isIncidentPrivate:incident?.isPrivate===true,});",
    );
    expect(acknowledge).toContain("isPrivate:true,");
    expect(acknowledge).not.toContain("incident?.title");
    expect(acknowledge).not.toContain("title:true");
  });

  test("is only ever started by IncidentService, after the validated declaration", () => {
    const callers: Array<string> = [];

    for (const directory of SERVER_SOURCE_DIRS) {
      for (const file of sourceFilesUnder(directory)) {
        const code: string = stripComments(fs.readFileSync(file, "utf8"));
        const calls: number =
          countOf(code, ".acknowledgeAlertsDeclaredWithIncident(") +
          countOf(code, ".validateAcknowledgeAlertsForNewIncident(");

        if (calls > 0) {
          callers.push(`${path.relative(PACKAGES_ROOT, file)}:${calls}`);
        }
      }
    }

    expect(callers).toEqual([`Common/${INCIDENT_SERVICE}:2`]);
  });

  test("credits the alert's state change to the user it is written for", () => {
    const changeState: string = methodBody(
      denseCommon(ALERT_SERVICE),
      "publicasyncchangeAlertState(",
    );

    const creditAt: number = changeState.indexOf(
      "if(createdByUserId){statusTimeline.createdByUserId=createdByUserId;}",
    );
    const writeAt: number = changeState.indexOf(
      "awaitAlertStateTimelineService.create({data:statusTimeline,props:props||{},});",
    );

    expect(creditAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(creditAt);
  });

  test("the authorization checks both halves of an acknowledgement for every alert", () => {
    const code: string = denseCommon(STATE_CHANGE_AUTHORIZATION);
    const check: string = methodBody(
      code,
      "publicstaticasyncassertCanChangeStateOfAlerts(",
    );

    const timelineAt: number = check.indexOf(
      "ModelPermission.checkCreatePermissions(AlertStateTimeline,probe,data.props);",
    );
    const perAlertAt: number = check.indexOf(
      "for(constalertofalerts){awaitModelPermission.checkUpdatePermissionByModel({modelType:Alert,",
    );
    const scopeAt: number = check.indexOf(
      "awaitModelPermission.checkUpdateQueryPermissions(Alert,alertQuery,{currentAlertStateId:ObjectID.getZeroObjectID(),},data.props,);",
    );
    const privacyAt: number = check.indexOf(
      "query:applyAlertSelfPrivacyFilter(permittedQuery,data.props),",
    );
    const refuseAt: number = check.indexOf(
      "if(!allPermitted){thrownewNotAuthorizedException(",
    );

    expect(
      check.startsWith(
        "if(data.props.isRoot||data.alertIds.length===0){return;}",
      ),
    ).toBe(true);
    expect(timelineAt).toBeGreaterThan(-1);
    expect(perAlertAt).toBeGreaterThan(timelineAt);
    expect(scopeAt).toBeGreaterThan(perAlertAt);
    expect(privacyAt).toBeGreaterThan(scopeAt);
    expect(refuseAt).toBeGreaterThan(privacyAt);
    expect(check).toContain(
      "constallPermitted:boolean=data.alertIds.every((alertId:ObjectID):boolean=>{returnpermittedIds.has(alertId.toString().toLowerCase());},);",
    );
  });
});
