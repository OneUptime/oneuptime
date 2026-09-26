import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// Where a method's `): Promise<...>` return type ends and its body begins.
const PROMISE_RETURN_TYPE_PATTERN: RegExp = /\):Promise<[^{]*>\{/;
const SOURCE_FILE_PATTERN: RegExp = /\.tsx?$/;
const TEST_FILE_PATTERN: RegExp = /\.test\.tsx?$/;

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
 *     before "More actions", neutral, never counted as state actions, and
 *     only puts the actions beside a title once there is room (xl);
 *   - the create page only asks the server to acknowledge the alerts when it
 *     is also linking them and the box is offered, allowed and ticked, its
 *     two extra reads can never take the page down, and the incidents an
 *     alert is already linked to open in a new tab, under a note worded by
 *     whether every alert or only some are linked;
 *   - the server refuses an impossible acknowledgement before the incident
 *     number is taken, checks the caller's right to change the state of the
 *     alerts it will acknowledge - only those not acknowledged yet - before
 *     anything is written as root, writes exactly those alerts a few at a
 *     time, and never makes the request wait for (or fail because of) the
 *     acknowledgements.
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

  const match: RegExpExecArray | null = PROMISE_RETURN_TYPE_PATTERN.exec(
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
      SOURCE_FILE_PATTERN.test(entry.name) &&
      !TEST_FILE_PATTERN.test(entry.name)
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

/*
 * The alert header now holds three actions beside a title. Next to a side
 * menu, a header that put them beside the title from md squeezed the title
 * down to a few characters, so the titled layout waits for xl; the compact
 * layout (no title, just pills) keeps md.
 */
describe("EventStatusPanel layouts", () => {
  test("build one actions cluster, whose full-width breakpoint each layout chooses", () => {
    const code: string = dense(EVENT_STATUS_PANEL);

    expect(code).toContain(
      'constgetActionsCluster:(widthClassName:string)=>ReactElement=(widthClassName:string,):ReactElement=>{return(<divclassName={`flexw-fullflex-wrapitems-centerjustify-endgap-2${widthClassName}`}role="group"aria-label="Eventactions">',
    );
    // One call per layout, and no shared, fixed-width cluster left behind.
    expect(countOf(code, "getActionsCluster(")).toBe(2);
    expect(code).not.toContain("{actionsCluster}");
    expect(countOf(code, 'aria-label="Eventactions"')).toBe(1);
  });

  test("put the actions beside the title only from xl in the titled header", () => {
    const code: string = dense(EVENT_STATUS_PANEL);
    const titled: string = sectionBetween(
      code,
      "{props.title?(",
      "{hasMeta&&(",
    );

    expect(
      titled.startsWith(
        '<divclassName="px-4py-4sm:px-5"><divclassName="flexflex-colgap-3xl:flex-rowxl:items-startxl:justify-between"><divclassName="min-w-0">',
      ),
    ).toBe(true);
    expect(
      titled.endsWith(
        '</div>{getActionsCluster("xl:w-autoxl:shrink-0")}</div>',
      ),
    ).toBe(true);
    expect(titled).not.toContain("md:");

    // The exact classes, spaces and all, as Tailwind reads them.
    const source: string = readCode(EVENT_STATUS_PANEL);

    expect(source).toContain(
      'className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"',
    );
    expect(source).toContain('{getActionsCluster("xl:w-auto xl:shrink-0")}');
    expect(source).toContain(
      "className={`flex w-full flex-wrap items-center justify-end gap-2 ${widthClassName}`}",
    );
  });

  test("keep the compact layout's actions beside the pills from md", () => {
    const code: string = dense(EVENT_STATUS_PANEL);
    const compact: string = sectionBetween(
      code,
      '):(<divclassName="flexflex-colgap-3px-4py-4sm:px-5md:flex-rowmd:items-centermd:justify-between">',
      "{props.states.length>1&&(",
    );

    expect(compact.endsWith('{getActionsCluster("md:w-auto")}</div>)}')).toBe(
      true,
    );
    expect(compact).not.toContain("xl:");
    expect(readCode(EVENT_STATUS_PANEL)).toContain(
      'className="flex flex-col gap-3 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between"',
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

describe("the create-incident page flagging alerts that already have an incident", () => {
  const ONE_ALERT_ALL_LINKED: string =
    "This alert is already linked to an incident. If it is the same problem, update that incident instead of declaring another one.";
  const SEVERAL_ALERTS_ALL_LINKED: string =
    "These alerts are already linked to incidents. If it is the same problem, update that incident instead of declaring another one.";
  const SOME_ALERTS_LINKED: string =
    "Some of these alerts are already linked to an incident. If it is the same problem, link the other alerts to that incident from the alerts list instead of declaring another one.";

  /*
   * With every alert linked there is nothing left to link, so the note sends
   * the user to the existing incident; with only some, the others can still
   * be linked to it. The number of alerts only picks singular or plural.
   */
  test("words the note by whether every alert is linked, then by how many there are", () => {
    const note: string = bodyOf(
      dense(CREATE_PAGE),
      "constgetAlreadyLinkedNote:",
    );

    const everyLinkedAt: number = note.indexOf(
      'constisEveryAlertLinked:boolean=alerts.every((alert:Alert):boolean=>{return((incidentsLinkedToAlerts.get(alert._id?.toString()||"")||[]).length>0);});',
    );
    const branchAt: number = note.indexOf(
      "if(isEveryAlertLinked){returnalerts.length===1?",
    );

    expect(everyLinkedAt).toBe(0);
    expect(branchAt).toBeGreaterThan(everyLinkedAt);
    expect(countOf(note, "return")).toBe(3);

    // The exact words, in branch order: one alert, several, only some.
    const source: string = readCode(CREATE_PAGE);
    const words: string = sectionBetween(
      source,
      "const getAlreadyLinkedNote: GetAlreadyLinkedNoteFunction",
      "type GetIncidentReferenceFunction",
    );

    expect(words).toContain(
      `return alerts.length === 1 ? "${ONE_ALERT_ALL_LINKED}" : "${SEVERAL_ALERTS_ALL_LINKED}"; }`,
    );
    expect(words).toContain(`return "${SOME_ALERTS_LINKED}"; }`);
  });

  test("shows the note only when an alert is linked, from that one function", () => {
    const code: string = dense(CREATE_PAGE);

    expect(code).toContain(
      '{alertsToLink.some((alert:Alert):boolean=>{return((incidentsLinkedToAlerts.get(alert._id?.toString()||"",)||[]).length>0);})&&(<pclassName="mt-2"data-testid="incident-create-alerts-already-linked-note">{getAlreadyLinkedNote(alertsToLink,incidentsLinkedToAlerts,)}</p>)}',
    );
    expect(countOf(code, "getAlreadyLinkedNote(")).toBe(1);

    // The old count-only wording, which sent a lone alert to be linked again, is gone.
    const source: string = readCode(CREATE_PAGE);

    expect(source).not.toContain("alertsToLink.length === 1 ?");
    expect(source).not.toContain("Check that it is not the same problem");
  });

  /*
   * Following the link in the same tab would unmount a five-step form the
   * user may have half filled in; a new tab keeps it.
   */
  test("opens each incident an alert is already linked to in a new tab", () => {
    const hint: string = sectionBetween(
      dense(CREATE_PAGE),
      'data-testid="incident-create-alert-already-linked">',
      "</span>",
    );

    expect(hint).toContain(
      '<LinkclassName="font-mediumunderline"openInNewTab={true}to={RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW]asRoute,{modelId:newObjectID(incident._id!.toString(),),},)}>{getIncidentReference(incident)}</Link>',
    );
    expect(countOf(hint, "<Link")).toBe(1);

    // Link turns openInNewTab into target="_blank".
    expect(denseCommon("UI/Components/Link/Link.tsx")).toContain(
      'if(props.openInNewTab){linkProps["target"]="_blank";}',
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
      "constalertsToAcknowledge:AlertsToAcknowledgeOnDeclare|null=awaitIncidentAlertService.validateAcknowledgeAlertsForNewIncident({projectId:projectId,acknowledgeAlerts:createBy.miscDataProps?.[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY],alertIds:validatedAlertIds,props:createBy.props,});",
    );
    const carryForwardAt: number = onBeforeCreate.indexOf(
      "if(validatedAlertIds.length>0){carryForward={alertIdsToLink:validatedAlertIds,acknowledgedAlertStateId:alertsToAcknowledge?.acknowledgedAlertStateId||null,alertIdsToAcknowledge:alertsToAcknowledge?.alertIdsToAcknowledge||[],};}",
    );
    const counterAt: number = onBeforeCreate.indexOf(
      "awaitProjectService.incrementAndGetIncidentCounter(projectId);",
    );

    expect(alertIdsAt).toBeGreaterThan(-1);
    expect(acknowledgeAt).toBeGreaterThan(alertIdsAt);
    expect(carryForwardAt).toBeGreaterThan(acknowledgeAt);
    expect(counterAt).toBeGreaterThan(carryForwardAt);
    // The validator is asked once, and its answer is only carried forward.
    expect(
      countOf(onBeforeCreate, "validateAcknowledgeAlertsForNewIncident("),
    ).toBe(1);
  });

  /*
   * The alerts to acknowledge travel next to - never instead of - the alerts
   * to link: every validated alert is linked, only the checked subset is
   * acknowledged.
   */
  test("carries the checked alerts to acknowledge forward beside the alerts to link", () => {
    const code: string = denseCommon(INCIDENT_SERVICE);

    expect(code).toContain(
      "typeIncidentCreateCarryForward={alertIdsToLink:Array<ObjectID>;acknowledgedAlertStateId:ObjectID|null;alertIdsToAcknowledge:Array<ObjectID>;}|null;",
    );
    expect(code).toContain(
      'importIncidentAlertService,{AcknowledgeDeclaredAlertsResult,AlertsToAcknowledgeOnDeclare,LinkAlertsToIncidentResult,}from"./IncidentAlertService";',
    );
    // The linking still reads every validated alert, not the subset.
    expect(
      bodyOf(code, "privategetAlertIdsDeclaredWith(", "):Array<ObjectID>{"),
    ).toBe(
      "constcarryForward:IncidentCreateCarryForward=(onCreate.carryForwardasIncidentCreateCarryForward)||null;returncarryForward?.alertIdsToLink||[];",
    );
    expect(denseCommon(INCIDENT_ALERT_SERVICE)).toContain(
      "exportinterfaceAlertsToAcknowledgeOnDeclare{acknowledgedAlertStateId:ObjectID;alertIdsToAcknowledge:Array<ObjectID>;}",
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
    /*
     * After creation the decision - and which alerts - comes from the
     * validated carry-forward alone: nothing without the Acknowledged state,
     * otherwise exactly the alerts the caller was checked for.
     */
    expect(
      bodyOf(
        code,
        "privategetAlertIdsToAcknowledgeDeclaredWith(",
        "):Array<ObjectID>{",
      ),
    ).toBe(
      "constcarryForward:IncidentCreateCarryForward=(onCreate.carryForwardasIncidentCreateCarryForward)||null;if(!carryForward?.acknowledgedAlertStateId){return[];}returncarryForward.alertIdsToAcknowledge||[];",
    );
    // Defined once, asked once; the old yes/no gate is gone.
    expect(countOf(code, "getAlertIdsToAcknowledgeDeclaredWith(")).toBe(2);
    expect(code).not.toContain("shouldAcknowledgeAlertsDeclaredWith");
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
      "constalertIdsToAcknowledge:Array<ObjectID>=this.getAlertIdsToAcknowledgeDeclaredWith(onCreate);if(alertIdsToAcknowledge.length===0){return;}",
    );
    // Only the checked subset is written; the links it acknowledges beside are all of them.
    const acknowledgeCall: string =
      "IncidentAlertService.acknowledgeAlertsDeclaredWithIncident({projectId:projectId,incidentId:incidentId,alertIds:alertIdsToAcknowledge,linkedAlertIds:linkedAlertIds,acknowledgedByUserId:this.getDeclaringUserId(onCreate,createdItem),}).then((acknowledged:AcknowledgeDeclaredAlertsResult)=>{";
    const acknowledgeAt: number = declared.indexOf(acknowledgeCall);

    expect(linkAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(linkAt);
    expect(acknowledgeAt).toBeGreaterThan(gateAt);
    expect(declared.slice(acknowledgeAt)).toContain(
      "}).catch((error:Error)=>{logger.error(",
    );
    // Failures are counted against the alerts it was asked to acknowledge.
    expect(declared.slice(acknowledgeAt)).toContain(
      "if(acknowledged.failed.length>0){logger.error(`${acknowledged.failed.length}of${alertIdsToAcknowledge.length}alertscouldnotbeacknowledgedwhentheincidentwasdeclaredfromthem.`,",
    );
    expect(declared).not.toContain("alertIds:alertIds,linkedAlertIds");

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

  test("checks the caller may change the state of the alerts it will acknowledge, unless root, before handing them back with the state", () => {
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
    const noProjectAt: number = validate.indexOf(
      "if(!data.projectId){thrownewBadDataException(",
    );
    // The state's order is what "acknowledged yet" is measured against.
    const stateAt: number = validate.indexOf(
      "constacknowledgedState:AlertState|null=awaitAlertStateService.findOneBy({query:{projectId:projectId,isAcknowledgedState:true,},select:{_id:true,order:true,},props:{isRoot:true,},});",
    );
    const noStateAt: number = validate.indexOf(
      "if(!acknowledgedState||!acknowledgedState._id||acknowledgedState.order===undefined||acknowledgedState.order===null){thrownewBadDataException(",
    );
    // Read as root, for this project only, just the state order it needs.
    const alertsAt: number = validate.indexOf(
      "constalerts:Array<Alert>=awaitAlertService.findBy({query:{_id:QueryHelper.any(data.alertIds),projectId:projectId,},select:{_id:true,currentAlertState:{order:true,},},limit:LIMIT_PER_PROJECT,skip:0,props:{isRoot:true,},});",
    );
    /*
     * Kept: alerts before Acknowledged, or with no state order. Dropped:
     * alerts at or past it, and alerts not found - never written, so never
     * checked.
     */
    const subsetAt: number = validate.indexOf(
      "constalertIdsToAcknowledge:Array<ObjectID>=data.alertIds.filter((alertId:ObjectID):boolean=>{constkey:string=normalizeId(alertId);if(!stateOrderByAlertId.has(key)){returnfalse;}constorder:number|undefined=stateOrderByAlertId.get(key);returnorder===undefined||order<acknowledgedOrder;},);",
    );
    const authorizationAt: number = validate.indexOf(
      "if(alertIdsToAcknowledge.length>0&&!data.props.isRoot&&!data.props.isMasterAdmin){try{awaitAlertStateChangeAuthorization.assertCanChangeStateOfAlerts({projectId:projectId,alertIds:alertIdsToAcknowledge,props:data.props,});}catch(error){",
    );
    const returned: string =
      "return{acknowledgedAlertStateId:newObjectID(acknowledgedState._id.toString()),alertIdsToAcknowledge:alertIdsToAcknowledge,};";
    const returnAt: number = validate.indexOf(returned);

    expect(notAskedAt).toBe(0);
    expect(notBooleanAt).toBeGreaterThan(notAskedAt);
    expect(noAlertsAt).toBeGreaterThan(notBooleanAt);
    expect(noProjectAt).toBeGreaterThan(noAlertsAt);
    expect(stateAt).toBeGreaterThan(noProjectAt);
    expect(noStateAt).toBeGreaterThan(stateAt);
    expect(alertsAt).toBeGreaterThan(noStateAt);
    expect(subsetAt).toBeGreaterThan(alertsAt);
    expect(authorizationAt).toBeGreaterThan(subsetAt);
    expect(returnAt).toBeGreaterThan(authorizationAt);
    expect(validate.endsWith(returned)).toBe(true);

    expect(validate).toContain(
      "for(constalertofalerts){if(alert._id){stateOrderByAlertId.set(normalizeId(alert._id),alert.currentAlertState?.order??undefined,);}}",
    );

    // The authorization sees the subset only, and only once.
    expect(countOf(validate, "assertCanChangeStateOfAlerts(")).toBe(1);
    expect(validate).not.toContain("alertIds:data.alertIds");

    // A refusal is a 400 the user can act on; anything else keeps its own answer.
    expect(validate).toContain(
      "if(errorinstanceofNotAuthorizedException||errorinstanceofBadDataException){thrownewBadDataException(",
    );
    expect(validate).toContain("}throwerror;}}");
  });

  test("hands back the Acknowledged state and the checked alerts, typed as such", () => {
    expect(denseCommon(INCIDENT_ALERT_SERVICE)).toContain(
      "publicasyncvalidateAcknowledgeAlertsForNewIncident(data:{projectId:ObjectID|undefined;acknowledgeAlerts:unknown;alertIds:Array<ObjectID>;props:DatabaseCommonInteractionProps;}):Promise<AlertsToAcknowledgeOnDeclare|null>{",
    );
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
    expect(code).toContain(
      "privateasyncacknowledgeDeclaredAlert(data:{projectId:ObjectID;alertId:ObjectID;acknowledgedStateId:ObjectID;acknowledgedOrder:number;rootCause:string;acknowledgedByUserId:ObjectID|undefined;}):Promise<string|null>{",
    );

    const acknowledge: string = methodBody(
      code,
      "publicasyncacknowledgeAlertsDeclaredWithIncident(",
    );
    const acknowledgeOne: string = methodBody(
      code,
      "privateasyncacknowledgeDeclaredAlert(",
    );

    // One write per alert, in the per-alert helper, and nowhere else here.
    expect(acknowledgeOne).toContain(
      "awaitAlertService.changeAlertState({projectId:data.projectId,alertId:data.alertId,alertStateId:data.acknowledgedStateId,notifyOwners:true,rootCause:data.rootCause,stateChangeLog:undefined,createdByUserId:data.acknowledgedByUserId,props:{isRoot:true,},});",
    );
    expect(countOf(acknowledgeOne, "changeAlertState(")).toBe(1);
    expect(countOf(acknowledge, "changeAlertState(")).toBe(0);
    // Defined once, called once: from the batches below.
    expect(countOf(code, "acknowledgeDeclaredAlert(")).toBe(2);

    for (const body of [acknowledge, acknowledgeOne]) {
      expect(body).not.toContain("assertCanChangeStateOfAlerts");
      expect(body).not.toContain("miscDataProps");
      expect(body).not.toContain("props:data.props");
    }

    // Only the alerts of this project are ever read or moved.
    expect(acknowledge).toContain(
      "awaitAlertService.findBy({query:{_id:QueryHelper.any(alertIds),projectId:data.projectId,},",
    );
  });

  test("settles which alerts to write before writing any, and never writes one it skipped", () => {
    const acknowledge: string = methodBody(
      denseCommon(INCIDENT_ALERT_SERVICE),
      "publicasyncacknowledgeAlertsDeclaredWithIncident(",
    );

    const classify: string = sectionBetween(
      acknowledge,
      "constalertIdsToWrite:Array<ObjectID>=[];",
      "for(letindex:number=0;",
    );

    expect(classify).toBe(
      'for(constalertIdofalertIds){constkey:string=normalizeId(alertId);constalert:Alert|undefined=alertById.get(key);if(!alert){result.failed.push({alertId:alertId,message:"Thealertcouldnotbefoundinthisproject.",});continue;}conststateOrder:number|undefined=alert.currentAlertState?.order??undefined;if(stateOrder!==undefined&&stateOrder>=acknowledgedOrder){result.alreadyAcknowledgedAlertIds.push(alertId);continue;}if(ownedBySync.has(key)){result.leftToLinkedAlertSyncAlertIds.push(alertId);continue;}alertIdsToWrite.push(alertId);}',
    );
    // Written: only what the classification left in alertIdsToWrite.
    expect(countOf(acknowledge, "alertIdsToWrite.push(")).toBe(1);
  });

  /*
   * Each acknowledgement is a full state change that waits on its Slack /
   * Microsoft Teams post, so one at a time could leave the last of 50 alerts
   * escalating for minutes. A small fixed batch instead, each finished
   * before the next starts.
   */
  test("writes the alerts in batches of a few at once, each batch finished before the next", () => {
    const code: string = denseCommon(INCIDENT_ALERT_SERVICE);
    const acknowledge: string = methodBody(
      code,
      "publicasyncacknowledgeAlertsDeclaredWithIncident(",
    );

    expect(code).toContain(
      "constDECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY:number=5;",
    );
    // Declared once, used for the step and the slice.
    expect(countOf(code, "DECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY")).toBe(3);

    expect(acknowledge).toContain(
      "for(letindex:number=0;index<alertIdsToWrite.length;index+=DECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY){constbatch:Array<ObjectID>=alertIdsToWrite.slice(index,index+DECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY,);constoutcomes:Array<string|null>=awaitPromise.all(batch.map((alertId:ObjectID):Promise<string|null>=>{returnthis.acknowledgeDeclaredAlert({projectId:data.projectId,alertId:alertId,acknowledgedStateId:acknowledgedStateId,acknowledgedOrder:acknowledgedOrder,rootCause:rootCause,acknowledgedByUserId:data.acknowledgedByUserId,});}),);",
    );
    expect(countOf(acknowledge, "Promise.all(")).toBe(1);
    expect(acknowledge).not.toContain("Promise.allSettled(");

    // Outcomes are read back in the batch's own order, so results keep the input order.
    expect(acknowledge).toContain(
      "batch.forEach((alertId:ObjectID,batchIndex:number)=>{constfailure:string|null=outcomes[batchIndex]??null;if(failure===null){result.acknowledgedAlertIds.push(alertId);return;}result.failed.push({alertId:alertId,message:failure});logger.error(",
    );
  });

  test("classifies each write by one read-back of the alert's state order, as root, in this project", () => {
    const code: string = denseCommon(INCIDENT_ALERT_SERVICE);
    const acknowledgeOne: string = methodBody(
      code,
      "privateasyncacknowledgeDeclaredAlert(",
    );

    const writeAt: number = acknowledgeOne.indexOf(
      'letfailure:string="Thealert\'sstatedidnotchangetoAcknowledged.";try{awaitAlertService.changeAlertState({',
    );
    const writeFailureAt: number = acknowledgeOne.indexOf(
      "}catch(error){failure=errorinstanceofError?error.message:String(error);}",
    );
    const readBackAt: number = acknowledgeOne.indexOf(
      "try{constalert:Alert|null=awaitAlertService.findOneBy({query:{_id:data.alertId,projectId:data.projectId,},select:{currentAlertState:{order:true,},},props:{isRoot:true,},});",
    );
    const comparedAt: number = acknowledgeOne.indexOf(
      "constorder:number|undefined=alert?.currentAlertState?.order??undefined;if(order!==undefined&&order>=data.acknowledgedOrder){returnnull;}",
    );

    expect(writeAt).toBe(0);
    expect(writeFailureAt).toBeGreaterThan(writeAt);
    expect(readBackAt).toBeGreaterThan(writeFailureAt);
    expect(comparedAt).toBeGreaterThan(readBackAt);
    // An unreadable alert is not counted as done: the write's failure stands.
    expect(acknowledgeOne.endsWith("}catch{}returnfailure;")).toBe(true);

    // One write and one read per alert; the Acknowledged state is not read again.
    expect(countOf(acknowledgeOne, "await")).toBe(2);
    expect(acknowledgeOne).not.toContain("AlertStateService");
    expect(code).not.toContain("isAlertAcknowledged(");
    expect(code).not.toContain("isAlertAtOrPastAcknowledged");
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
      "ModelPermission.checkCreatePermissions(AlertStateTimeline,probe,data.props,);",
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
