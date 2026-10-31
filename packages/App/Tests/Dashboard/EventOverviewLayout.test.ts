import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident and alert overview pages share one layout contract:
 *
 *   - the first load shows EventOverviewSkeleton, and nothing after that ever
 *     unmounts the page again (an acknowledge, an edit or a role change
 *     refreshes it in the background);
 *   - the header carries facts - who runs it first: the commander and the
 *     owners - and the AI summary; directly under it sits one EventStatBar,
 *     read left to right as the response (started, acknowledged in, resolved
 *     in), and the duration is the header's alone;
 *   - What happened (the description and the root cause) leads the left
 *     column, then the AI investigation;
 *   - the right column opens on what the event affects, and its details
 *     card uses the compact detail style.
 *
 * Behaviour is exercised by the RTL suites in Common/Tests/App/Dashboard
 * (EventOverviewPages.test.tsx, ChangeAlertStateAIHeader.test.tsx,
 * ChangeIncidentStateHeader.test.tsx). The App suite runs in plain Node with
 * no renderer, so what is pinned here is the wiring those suites stub out.
 * Sources are comment-stripped and whitespace-squashed first so a prettier
 * re-wrap cannot turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/*
 * Squashed source with the spaces prettier puts inside a call's parentheses,
 * and a call's trailing comma, taken out: "f( a, b, )" reads "f(a, b)"
 * however wide the line was that prettier wrapped.
 */
function tight(text: string): string {
  return text
    .replace(/,\s*\)/g, ")")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

/*
 * The block body of the first arrow function after `marker`, braces
 * included. Good enough for the handlers pinned here, none of which contain
 * an unbalanced brace inside a string.
 */
function arrowBodyAfter(source: string, marker: string): string {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex < 0) {
    throw new Error(`Marker not found: ${marker}`);
  }

  const arrowIndex: number = source.indexOf("=> {", markerIndex);

  if (arrowIndex < 0) {
    throw new Error(`No arrow body after: ${marker}`);
  }

  const openIndex: number = arrowIndex + 3;
  let depth: number = 0;

  for (let index: number = openIndex; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(openIndex, index + 1);
      }
    }
  }

  throw new Error(`Unbalanced body after: ${marker}`);
}

function indexOfOrFail(source: string, needle: string): number {
  const index: number = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`Not found: ${needle}`);
  }

  return index;
}

/*
 * Every title between two markers, in order. A title is either a string
 * literal, returned without its quotes, or a reference to a shared copy
 * constant (e.g. IncidentStatusPageScopeCopy.overviewFieldTitle), returned as
 * written. Lower-case values such as the `title: true` of a select block are
 * not titles.
 */
function titlesBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): Array<string> {
  const start: number = indexOfOrFail(source, startMarker);
  const end: number = source.indexOf(endMarker, start);

  if (end < 0) {
    throw new Error(`Not found after ${startMarker}: ${endMarker}`);
  }

  const section: string = source.slice(start, end);

  return Array.from(
    section.matchAll(/ title: (?:"([^"]*)"|([A-Z]\w*\.\w+))/g),
  ).map((match: RegExpMatchArray) => {
    return (match[1] ?? match[2])!;
  });
}

interface EventPage {
  noun: "incident" | "alert";
  view: string;
  layout: string;
  sideMenu: string;
  changeState: string;
  affectedResources: string;
  changeStateElement: string;
  affectedResourcesElement: string;
  feedElement: string;
  detailsCardName: string;
  detailsId: string;
  expectedDetailTitles: Array<string>;
  expectedFactLabels: Array<string>;
  // The first tile of the stat bar: when it started, and by whom.
  startLabel: string;
  startedAt: string;
  impactStartedAt: string;
  startedBy: string;
  // The model the What happened card edits.
  model: string;
  description: string;
  rootCause: string;
  // The owners the header names, and where its Add owners goes.
  ownerUserModel: string;
  ownerTeamModel: string;
  ownerResourceIdField: string;
  ownersPage: string;
}

const INCIDENT_PAGE: EventPage = {
  noun: "incident",
  view: readSource("Pages", "Incidents", "View", "Index.tsx"),
  layout: readSource("Pages", "Incidents", "View", "Layout.tsx"),
  sideMenu: readSource("Pages", "Incidents", "View", "SideMenu.tsx"),
  changeState: readSource("Components", "Incident", "ChangeState.tsx"),
  affectedResources: readSource(
    "Pages",
    "Incidents",
    "View",
    "AffectedResources.tsx",
  ),
  changeStateElement: "<ChangeIncidentState",
  affectedResourcesElement: "<IncidentAffectedResources",
  feedElement: "<IncidentFeedElement",
  detailsCardName: 'name="Incident Details"',
  detailsId: 'id: "model-detail-incidents"',
  /*
   * When it was declared, and by whom, are the stat bar's Declared tile:
   * the card no longer says them a second time.
   */
  expectedDetailTitles: [
    "On-Call Duty Policies",
    "Subscriber Notification Status",
    // The status pages the incident is limited to, beside who was notified.
    "IncidentStatusPageScopeCopy.overviewFieldTitle",
    "Labels",
    "Incident Number",
    "Incident ID",
  ],
  // The commander and the owners are built by the shared fact builders.
  expectedFactLabels: [],
  startLabel: "Declared",
  startedAt: "incidentStartedAt",
  impactStartedAt: "incidentImpactStartedAt",
  startedBy: "incidentDeclaredBy",
  model: "Incident",
  description: "incidentDescription",
  rootCause: "incidentRootCause",
  ownerUserModel: "IncidentOwnerUser",
  ownerTeamModel: "IncidentOwnerTeam",
  ownerResourceIdField: "incidentId",
  ownersPage: "PageMap.INCIDENT_VIEW_OWNERS",
};

const ALERT_PAGE: EventPage = {
  noun: "alert",
  view: readSource("Pages", "Alerts", "View", "Index.tsx"),
  layout: readSource("Pages", "Alerts", "View", "Layout.tsx"),
  sideMenu: readSource("Pages", "Alerts", "View", "SideMenu.tsx"),
  changeState: readSource("Components", "Alert", "ChangeState.tsx"),
  affectedResources: readSource(
    "Pages",
    "Alerts",
    "View",
    "AffectedResources.tsx",
  ),
  changeStateElement: "<ChangeAlertState",
  affectedResourcesElement: "<AlertAffectedResources",
  feedElement: "<AlertFeedElement",
  detailsCardName: 'name="Alert Details"',
  detailsId: 'id: "model-detail-alerts"',
  /*
   * Who raised it is the stat bar's Created tile. Created At stays: it is
   * drawn on the card's ID line, as every details card's record time is.
   */
  expectedDetailTitles: [
    "Created At",
    "Monitor",
    "Episode",
    "On-Call Duty Policies",
    "Labels",
    "Alert Number",
    "Alert ID",
  ],
  expectedFactLabels: ["Monitor", "Episode"],
  startLabel: "Created",
  startedAt: "alertStartedAt",
  impactStartedAt: "alertImpactStartedAt",
  startedBy: "alertCreatedBy",
  model: "Alert",
  description: "alertDescription",
  rootCause: "alertRootCause",
  ownerUserModel: "AlertOwnerUser",
  ownerTeamModel: "AlertOwnerTeam",
  ownerResourceIdField: "alertId",
  ownersPage: "PageMap.ALERT_VIEW_OWNERS",
};

const PAGES: Array<[string, EventPage]> = [
  ["incident", INCIDENT_PAGE],
  ["alert", ALERT_PAGE],
];

describe.each(PAGES)(
  "%s overview loading",
  (_name: string, page: EventPage) => {
    test("the first render is the skeleton, not a full-page loader", () => {
      // Nothing is loaded yet, so the first render is the skeleton.
      expect(page.view).toContain(
        "const [loadedModelId, setLoadedModelId] = useState<string | null>(null);",
      );
      expect(page.view).toMatch(
        /if \(loadedModelId !== modelIdString\) \{ return \(? ?<EventOverviewSkeleton statCount=\{3\}/,
      );
      expect(page.view).toContain(
        'import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";',
      );
      expect(page.view).not.toContain("PageLoader");
    });

    test("fetching never flips the page back to its first-load state", () => {
      const fetchBody: string = arrowBodyAfter(
        page.view,
        "const fetchData: (options: FetchDataOptions) => Promise<void> =",
      );

      expect(fetchBody).not.toContain("setLoadedModelId(null)");
      // A settled fetch (loaded or failed) marks the id it was started for.
      expect(fetchBody).toContain("setLoadedModelId(requestedModelId);");
      // Only the retry of a failed first load goes back to the skeleton.
      expect(countOccurrences(page.view, "setLoadedModelId(null)")).toBe(1);
      expect(
        arrowBodyAfter(page.view, "const retryFirstLoad: () => void ="),
      ).toContain("setLoadedModelId(null)");
    });

    /*
     * The page stays mounted when the reader follows a link to another event
     * on the same route. Resetting a loading flag in an effect let the first
     * render for the new id mount every card with that id over the previous
     * event's data. The Common RTL suite drives this; these pin the shape.
     */
    test("a different event is a first load decided at render time, not in an effect", () => {
      expect(page.view).not.toContain("isLoading");

      const effectStart: number = indexOfOrFail(
        page.view,
        "useEffect(() => { currentModelIdRef.current = modelIdString;",
      );
      const effect: string = page.view.slice(
        effectStart,
        page.view.indexOf("}, [modelIdString]);", effectStart),
      );

      expect(effect).toContain("fetchData({ isBackgroundRefresh: false })");
      expect(effect).not.toContain("setLoadedModelId(null)");
    });

    test("a refresh from a card of the previous event cannot cancel the next event's load", () => {
      const fetchBody: string = arrowBodyAfter(
        page.view,
        "const fetchData: (options: FetchDataOptions) => Promise<void> =",
      );
      const guard: number = indexOfOrFail(
        fetchBody,
        "if (requestedModelId !== currentModelIdRef.current) { return; }",
      );

      expect(fetchBody).toContain(
        "const requestedModelId: string = modelIdString;",
      );
      expect(guard).toBeLessThan(
        indexOfOrFail(fetchBody, "fetchGenerationRef.current++;"),
      );
    });

    test("a refresh is a background refresh", () => {
      const refreshBody: string = arrowBodyAfter(
        page.view,
        "const refreshData: () => void =",
      );

      expect(refreshBody).toContain("fetchData({ isBackgroundRefresh: true })");
      expect(
        countOccurrences(page.view, "fetchData({ isBackgroundRefresh: true })"),
      ).toBe(1);
    });

    test("a failed refresh is reported inline and the page stays mounted", () => {
      expect(page.view).toContain("if (options.isBackgroundRefresh) {");
      expect(page.view).toContain(
        "setRefreshError(BaseAPI.getFriendlyMessage(err));",
      );
      expect(page.view).toContain('role="alert"');
      expect(page.view).toContain(`Could not refresh this ${page.noun}.`);
    });

    test("a failed first load offers a retry", () => {
      expect(page.view).toContain(
        "<ErrorMessage message={error} onRefreshClick={retryFirstLoad} />",
      );
    });

    test("overlapping fetches cannot land out of order", () => {
      expect(page.view).toContain(
        "if (generation !== fetchGenerationRef.current) { return; }",
      );
    });

    test("the page reads its three rows together", () => {
      expect(page.view).toContain("await Promise.all([");
    });

    test("the header action refreshes in the background and refreshes the feed", () => {
      const actionBody: string = arrowBodyAfter(
        page.view,
        "onActionComplete={",
      );

      expect(actionBody).toContain("refreshData();");
      expect(actionBody).toContain("refreshFeed();");
      expect(actionBody).not.toContain("fetchData(");
    });

    test("saving the details card refreshes in the background", () => {
      const saveBody: string = arrowBodyAfter(
        page.view.slice(indexOfOrFail(page.view, page.detailsCardName)),
        "onSaveSuccess={",
      );

      expect(saveBody).toContain("refreshData();");
      expect(saveBody).not.toContain("fetchData(");
    });

    test("the unused details timeline request is gone", () => {
      expect(page.view).not.toContain("onBeforeFetch");
    });
  },
);

describe.each(PAGES)("%s overview layout", (_name: string, page: EventPage) => {
  test("the stat bar sits between the header and the grid", () => {
    const header: number = indexOfOrFail(page.view, page.changeStateElement);
    const statBar: number = indexOfOrFail(
      page.view,
      "<EventStatBar columns={3}",
    );
    const grid: number = indexOfOrFail(
      page.view,
      '<div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">',
    );

    expect(header).toBeLessThan(statBar);
    expect(statBar).toBeLessThan(grid);
  });

  test("the stat bar has three segment cells, opening on when it started", () => {
    expect(countOccurrences(page.view, 'variant="segment"')).toBe(3);
    expect(countOccurrences(page.view, "<EventStatTile")).toBe(3);
    expect(page.view).toContain(
      `ariaLabel="${page.noun === "incident" ? "Incident" : "Alert"} response times"`,
    );

    // The first tile: when it started, how long impact had gone on, by whom.
    const startTile: string = tight(
      page.view.slice(
        indexOfOrFail(page.view, "<EventStatTile"),
        indexOfOrFail(
          page.view,
          'label={translator.translateTemplate("{{stateName}} in"',
        ),
      ),
    );

    expect(startTile).toContain(`label="${page.startLabel}"`);
    expect(startTile).toContain("icon={IconProp.Calendar}");
    // The time, then its zone, smaller (EventStartTileValue).
    expect(startTile).toContain(
      `${page.startedAt} ? (<EventStartTileValue startedAt={${page.startedAt}} />) : ("-")`,
    );
    expect(startTile).toContain(
      `note={getImpactBeforeStartText({ impactStartedAt: ${page.impactStartedAt}, startedAt: ${page.startedAt}, }, translator)}`,
    );
    expect(startTile).toContain(
      `description={getEventStartedByText(${page.startedBy} || {}, translator)}`,
    );
  });

  test("the duration is said once: the header's, beside the state", () => {
    // No Duration tile, live or ended, a second time under the header.
    expect(page.view).not.toContain('label="Duration"');
    expect(page.view).not.toContain("<LiveDuration");
    expect(page.view).not.toContain("Ended {{date}}");
    // The header still draws it, from when the event started.
    expect(page.view).toContain("eventStartsAt={durationStartDate}");
    expect(page.changeState).toContain("durationStartsAt={durationStartsAt}");
  });

  test("response times come from the shared first-entry reading", () => {
    expect(page.view).toContain("getEventResponseTimes({");
    expect(countOccurrences(tight(page.view), "getTimeToStateText({")).toBe(2);
    // Worded in the reader's language: the page hands its translator in.
    expect(
      countOccurrences(tight(page.view), "}, translator)"),
    ).toBeGreaterThanOrEqual(2);
    expect(page.view).toContain("reachedAt: responseTimes.acknowledgedAt,");
    expect(page.view).toContain("reachedAt: responseTimes.resolvedAt,");
    expect(page.view).not.toContain(".reverse()");
    expect(page.view).not.toContain("getLastTimelineDateForState");
  });

  test("the left column leads with what happened, then the AI investigation", () => {
    const order: Array<number> = [
      '<div className="min-w-0 xl:col-span-2">',
      `<EventWhatHappenedCard<${page.model}>`,
      "<InvestigationPanel",
      "<TelemetryCompanionSignalTabs",
      "<MonitorSummarySnapshotCard",
      page.affectedResourcesElement,
      "<EntityRunbooks",
      page.feedElement,
    ].map((needle: string) => {
      return indexOfOrFail(page.view, needle);
    });

    expect(
      [...order].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(order);
  });

  /*
   * Block 43: what OneUptime AI is doing to fix it is the AI card's second
   * step, up top. It was a card of its own down here, under the telemetry
   * and the affected resources, and easy to miss entirely.
   */
  test("draws no Remediation card of its own: remediation is the AI card's second step", () => {
    expect(page.view).not.toContain("<RemediationSuggestionCard");
    expect(page.view).not.toContain("<RemediationStep");
    expect(page.view).not.toContain("useAiCardFold");
  });

  test("the right column opens on what it affects, then details, then custom fields last", () => {
    const rightColumn: number = indexOfOrFail(
      page.view,
      '<div className="min-w-0 xl:col-span-1">',
    );
    const resources: number = indexOfOrFail(
      page.view,
      'name="Affected Resources"',
    );
    const videoCall: number = indexOfOrFail(page.view, "<EventVideoCallsCard");
    const details: number = indexOfOrFail(page.view, page.detailsCardName);
    const customFields: number = indexOfOrFail(
      page.view,
      "<OverviewCustomFields",
    );

    expect(indexOfOrFail(page.view, page.feedElement)).toBeLessThan(
      rightColumn,
    );
    // The first card of the column: beside what happened, what it hit.
    expect(page.view).toContain(
      `<div className="min-w-0 xl:col-span-1"> <CardModelDetail<${page.model}> name="Affected Resources"`,
    );
    expect(rightColumn).toBeLessThan(resources);
    expect(resources).toBeLessThan(videoCall);
    expect(videoCall).toBeLessThan(details);
    expect(details).toBeLessThan(customFields);
  });

  test("both detail cards use the compact style", () => {
    expect(countOccurrences(page.view, "style: DetailStyle.Compact,")).toBe(2);
    expect(page.view).toContain(
      'import { DetailStyle } from "Common/UI/Components/Detail/Detail";',
    );
  });

  test("details fields: the facts the header and the stat bar do not say, number and id last", () => {
    /*
     * The card's field list ends where its own modelId follows it; a field
     * may pass `{ modelId: modelId }` to a route of its own before that.
     */
    expect(
      titlesBetween(page.view, page.detailsId, "], modelId: modelId,"),
    ).toEqual(page.expectedDetailTitles);
  });

  test("the series labels the page already read are handed to the resource card", () => {
    expect(page.view).toContain("seriesLabels={seriesLabels}");
    expect(page.affectedResources).toContain(
      "seriesLabels?: JSONObject | null | undefined;",
    );
    expect(page.affectedResources).toContain(
      "if (hasSeriesLabelsFromPage) { return; }",
    );
  });

  test("the header gets facts built from data the page already loads", () => {
    expect(page.view).toContain("facts={headerFacts}");
    expect(page.changeState).toContain("facts={props.facts}");

    for (const label of page.expectedFactLabels) {
      expect(page.view).toContain(`label: "${label}"`);
    }

    expect(page.view).toContain("onItemLoaded: (item:");
    // When it started is the stat bar's: no Declared / Created fact.
    expect(page.view).not.toContain('label: "Declared"');
    expect(page.view).not.toContain('label: "Created"');
    expect(page.view).not.toContain('label: "Declared by"');
  });

  test("who owns it sits in the header, read once for the event on screen", () => {
    expect(page.view).toContain(
      `const owners: EventOwnersState = useEventOwners({ ownerUserModelType: ${page.ownerUserModel}, ownerTeamModelType: ${page.ownerTeamModel}, resourceIdField: "${page.ownerResourceIdField}", resourceId: modelId, });`,
    );
    const ownersFact: number = indexOfOrFail(
      page.view,
      "const ownersFact: EventStatusFact | null = getOwnersFact({ owners: owners.owners,",
    );

    expect(page.view.slice(ownersFact, ownersFact + 400)).toContain(
      `RouteMap[${page.ownersPage}] as Route`,
    );
    /*
     * Add owners is offered only while the event is open, to a reader who
     * may add one - right there, in the Add owners list: the owners read
     * again, and the feed when one was added.
     */
    expect(page.view.slice(ownersFact, ownersFact + 600)).toMatch(
      /addOwners: !(isResolved|durationEndDate) && owners\.canAddOwners \? \{ target: owners\.target, onOwnersChanged: async \(change: OwnersChange\): Promise<void> => \{ if \(change\.wasAdded\) \{ refreshFeed\(\); \} await owners\.refresh\(\); \}, \} : undefined,/,
    );
    // Owners come before the event's own facts (its monitor, its episode).
    expect(
      indexOfOrFail(page.view, "headerFacts.push(ownersFact);"),
    ).toBeLessThan(indexOfOrFail(page.view, "headerFacts.push({"));
  });

  test("the What happened card shows the event's own description and root cause, and saves through the page", () => {
    const card: string = page.view.slice(
      indexOfOrFail(page.view, `<EventWhatHappenedCard<${page.model}>`),
    );
    const cardProps: string = card.slice(0, card.indexOf("/>"));

    expect(cardProps).toContain(`modelType={${page.model}}`);
    expect(cardProps).toContain("modelId={modelId}");
    expect(cardProps).toContain(`description={${page.description}}`);
    expect(cardProps).toContain(`rootCause={${page.rootCause}}`);
    // A save refreshes in place - the card's text and the feed - never reloads.
    expect(cardProps).toContain(
      "onSaved={() => { refreshData(); refreshFeed(); }}",
    );
    /*
     * The edit dialog says the description is public where it is: an
     * incident's shows on its status pages, an alert's nowhere.
     */
    if (page.model === "Incident") {
      expect(cardProps).toContain('statusPageRecord="incident"');
    } else {
      expect(cardProps).not.toContain("statusPageRecord");
    }
  });

  test("the page reads what the card and the start tile show with its own row", () => {
    const fetchBody: string = arrowBodyAfter(
      page.view,
      "const fetchData: (options: FetchDataOptions) => Promise<void> =",
    );

    for (const column of [
      "description: true,",
      "rootCause: true,",
      "impactStartedAt: true,",
      "isCreatedAutomatically: true,",
      "createdByProbe: { name: true, },",
      "createdByUser: { name: true, email: true, },",
    ]) {
      expect(fetchBody).toContain(column);
    }

    expect(fetchBody).toContain(
      `set${page.description.charAt(0).toUpperCase()}${page.description.slice(1)}(`,
    );
    expect(fetchBody).toContain(
      `set${page.rootCause.charAt(0).toUpperCase()}${page.rootCause.slice(1)}(`,
    );
  });

  test("the header never flashes a full-page loader of its own", () => {
    expect(page.changeState).not.toContain("PageLoader");
    expect(page.changeState).toContain(
      "const [isLoading, setIsLoading] = useState<boolean>(true);",
    );
    expect(page.changeState).toContain("StatePlaceholder />");
  });

  test("the header reads its states, timeline and templates together", () => {
    expect(page.changeState).toContain("await Promise.all([");
  });
});

describe("incident-only layout", () => {
  test("incident roles follow the details card, under the column's affected resources", () => {
    const view: string = INCIDENT_PAGE.view;
    const details: number = indexOfOrFail(view, 'name="Incident Details"');
    const roles: number = indexOfOrFail(view, "<IncidentMemberRoleAssignment");
    const resources: number = indexOfOrFail(view, 'name="Affected Resources"');

    expect(resources).toBeLessThan(details);
    expect(details).toBeLessThan(roles);
  });

  test("the header names the commander from what the roles card reads", () => {
    const view: string = INCIDENT_PAGE.view;

    // No read of its own: the roles card reports, stamped with its incident.
    expect(view).toContain(
      "const onRolesLoaded: ( recordId: string, snapshot: EventRolesSnapshot, ) => void = useCallback( (recordId: string, snapshot: EventRolesSnapshot): void => { setRolesSnapshot({ subjectId: recordId, value: snapshot }); }, [], );",
    );
    expect(view).toContain(
      "rolesSnapshot?.subjectId === modelIdString ? rolesSnapshot.value : undefined;",
    );
    /*
     * The header's Assign gives the commander right there, to a reader who
     * may give a role: the incident's role row, the person named at once
     * (withRoleGiven), the roles card and the feed read again.
     */
    expect(view).toContain(
      '<IncidentMemberRoleAssignment incidentId={modelId} headerLayout="stacked" onRolesLoaded={onRolesLoaded} refreshToken={rolesRefreshToken}',
    );
    expect(view).toContain(
      "const [rolesRefreshToken, setRolesRefreshToken] = useState<number>(0);",
    );
    expect(view).toContain(
      "const primaryRole: PrimaryRoleHolding | null = getPrimaryRoleHolding(currentRolesSnapshot); const mayAssignRoles: boolean = PermissionGate.check( new IncidentMember(), ModelAction.Create, privateRecordOptions, ).isAllowed; const commanderFact: EventStatusFact | null = getCommanderFact({ holding: primaryRole, onAssign: isResolved || !primaryRole || !mayAssignRoles ? undefined : async (person: PeoplePickerOption): Promise<void> => { const incidentId: string = modelIdString; await assignIncidentRole({ incidentId: new ObjectID(incidentId), userId: new ObjectID(person.id), roleId: new ObjectID(primaryRole.role.id), });",
    );
    expect(view).toContain("withRoleGiven({");
    /*
     * A private incident's roles are given only with the permissions of the
     * teams that own it: asked with what the reader holds on it, the header
     * offers Assign only when one of those may (PrivateRecordScope).
     */
    expect(view).toContain(
      "const privateRecordOptions: PermissionGateOptions | undefined = usePrivateRecordGateOptions(PRIVATE_RECORD_INCIDENT);",
    );
    expect(view).toContain(
      "const PRIVATE_RECORD_INCIDENT: Incident = new Incident();",
    );
    expect(view).toContain(
      "setRolesRefreshToken((token: number): number => { return token + 1; }); refreshFeed(); },",
    );
    // Nothing takes the reader to the roles card any more.
    expect(view).not.toContain("useRoleAssignRequest");
    expect(view).not.toContain("EVENT_ROLES_CARD_ID");
    expect(view).not.toContain("assignRequest");
    // The commander first, then the owners.
    expect(
      indexOfOrFail(view, "headerFacts.push(commanderFact);"),
    ).toBeLessThan(indexOfOrFail(view, "headerFacts.push(ownersFact);"));
    // Assign is offered while the incident is open: it is not yet resolved.
    expect(view).toContain(
      "const isResolved: boolean = Boolean(durationEndDate);",
    );
  });

  test("the Affected Resources card shows the status the incident holds its monitors in", () => {
    const resources: string = INCIDENT_PAGE.view.slice(
      indexOfOrFail(INCIDENT_PAGE.view, 'name="Affected Resources"'),
      indexOfOrFail(INCIDENT_PAGE.view, "<EventVideoCallsCard"),
    );

    expect(resources).toContain(
      'field: { changeMonitorStatusTo: { name: true, color: true, }, }, title: "Change Monitor Status to", fieldType: FieldType.Entity, showIf: (item: Incident): boolean => { return (item.monitors || []).length > 0; },',
    );
    expect(resources).toContain(
      "<ChangeMonitorStatusToElement monitorStatus={item.changeMonitorStatusTo} />",
    );
  });

  test("a role change only refreshes the feed", () => {
    const memberBody: string = arrowBodyAfter(
      INCIDENT_PAGE.view,
      "onMemberChange={",
    );

    expect(memberBody).toContain("refreshFeed();");
    expect(memberBody).not.toContain("fetchData(");
    expect(memberBody).not.toContain("refreshData(");
  });

  test("resending subscriber notifications refreshes only the details card", () => {
    const resendBody: string = arrowBodyAfter(
      INCIDENT_PAGE.view,
      "const handleResendNotification: ( options: ResendNotificationOptions, ) => Promise<void> = async (",
    );

    expect(resendBody).toContain("setDetailsRefresher(");
    expect(resendBody).not.toContain("setLoadedModelId");
    expect(resendBody).not.toContain("fetchData(");
    expect(INCIDENT_PAGE.view).toContain("refresher={detailsRefresher}");
  });

  test("a failed resend is reported under the status it failed to change, not as a refresh failure", () => {
    const resendBody: string = arrowBodyAfter(
      INCIDENT_PAGE.view,
      "const handleResendNotification: ( options: ResendNotificationOptions, ) => Promise<void> = async (",
    );

    expect(resendBody).toContain("setResendNotificationErrorState(null);");
    expect(resendBody).toContain(
      "setResendNotificationErrorState({ subjectId: modelIdString, value: BaseAPI.getFriendlyMessage(err), });",
    );
    expect(resendBody).not.toContain("setRefreshError");
    // One translated sentence, filled with the resend's own error.
    expect(INCIDENT_PAGE.view).toContain(
      'translator.translateTemplate( "Could not resend notifications: {{error}}", { error: resendNotificationError }, )',
    );

    // A refresh does not retry the resend, so it never clears the error.
    const fetchBody: string = arrowBodyAfter(
      INCIDENT_PAGE.view,
      "const fetchData: (options: FetchDataOptions) => Promise<void> =",
    );

    expect(fetchBody).not.toContain("setResendNotificationErrorState");
  });

  test("the header lists affected monitors from the affected resources card", () => {
    // Stamped with the incident it was read for, and read only for that one.
    expect(INCIDENT_PAGE.view).toContain(
      "setAffectedMonitorsState({ subjectId: modelIdString, value: item.monitors || [], });",
    );
    expect(INCIDENT_PAGE.view).toContain(
      "affectedMonitorsState?.subjectId === modelIdString",
    );
    // Who declared it is read with the incident's own row, not a card's.
    expect(INCIDENT_PAGE.view).not.toContain("setDeclaredBy(");
    expect(INCIDENT_PAGE.view).toContain(
      'label: affectedMonitors.length === 1 ? "Monitor" : "Monitors",',
    );
    expect(INCIDENT_PAGE.view).toContain(
      "RouteMap[PageMap.MONITOR_VIEW] as Route",
    );
  });
});

describe("alert-only layout", () => {
  test("the episode relation select only asks for columns readable on a relation query", () => {
    /*
     * AlertEpisode.episodeNumber and episodeNumberWithPrefix are not flagged
     * canReadOnRelationQuery. Selecting either through Alert.alertEpisode
     * makes the server reject the whole details request.
     */
    const detailsSection: string = ALERT_PAGE.view.slice(
      indexOfOrFail(ALERT_PAGE.view, 'id: "model-detail-alerts"'),
    );
    const episodeSelect: string =
      detailsSection.split("alertEpisode: {")[1]!.split("}")[0] || "";

    expect(episodeSelect).toContain("title: true");
    expect(episodeSelect).not.toContain("episodeNumber");
  });

  test("the header reads the monitor and episode from the details card", () => {
    // Stamped with the alert they were read for, and read only for that one.
    expect(ALERT_PAGE.view).toContain(
      "setAlertMonitorState({ subjectId: modelIdString, value: item.monitor || undefined, });",
    );
    expect(ALERT_PAGE.view).toContain(
      "setAlertEpisodeState({ subjectId: modelIdString, value: item.alertEpisode || undefined, });",
    );
    expect(ALERT_PAGE.view).toContain(
      "alertMonitorState?.subjectId === modelIdString",
    );
    expect(ALERT_PAGE.view).toContain(
      "alertEpisodeState?.subjectId === modelIdString",
    );
  });
});

describe.each(PAGES)(
  "%s series resource card copy",
  (_name: string, page: EventPage) => {
    const otherNoun: string = page.noun === "incident" ? "alert" : "incident";

    test('calls its commands card "Debug commands"', () => {
      expect(page.affectedResources).toContain('title="Debug commands"');
      expect(page.affectedResources).not.toContain("Start Here");
    });

    test("uses the right noun everywhere, including the empty state", () => {
      expect(page.affectedResources).toContain(
        `No resource labels on this ${page.noun}.`,
      );
      expect(page.affectedResources.toLowerCase()).not.toContain(
        `this ${otherNoun}`,
      );
    });

    test("skips the monitor type read when there are no series labels", () => {
      expect(page.affectedResources).toContain(
        "if (!hasSeriesLabels) { setMonitorType(undefined); return; }",
      );
    });
  },
);

describe.each(PAGES)(
  "%s overview right column fits its width",
  (_name: string, page: EventPage) => {
    /*
     * The right column is about 300px wide. Side-by-side card headers
     * squeezed each title beside an "Edit Incident" button into a column one
     * word wide, and two resource tiles per row clipped every name.
     */
    const rightColumn: string = page.view.slice(
      indexOfOrFail(page.view, '<div className="min-w-0 xl:col-span-1">'),
    );

    test("both detail cards stack their headers and say Edit", () => {
      expect(countOccurrences(rightColumn, 'headerLayout: "stacked",')).toBe(2);
      expect(countOccurrences(rightColumn, 'editButtonText="Edit"')).toBe(2);
      expect(countOccurrences(rightColumn, "isEditable={true}")).toBe(2);
      expect(page.view).not.toContain("Here are more details for this");
    });

    test("the details card has a short description", () => {
      const title: string = page.noun === "incident" ? "Incident" : "Alert";

      expect(rightColumn).toContain(
        `title: "${title} Details", description: "Key facts about this ${page.noun}.", headerLayout: "stacked",`,
      );
      expect(rightColumn).toMatch(
        /title: "Affected Resources", description: "[^"]{1,70}", headerLayout: "stacked",/,
      );
    });

    test("custom fields stack too, and resources render in one column", () => {
      expect(rightColumn).toMatch(
        /resourceName="(Incident|Alert)" headerLayout="stacked"/,
      );
      expect(countOccurrences(page.view, "<AffectedResourcesDisplay")).toBe(1);
      expect(rightColumn).toMatch(/columns=\{1\} \/>/);
    });
  },
);

describe.each(PAGES)(
  "%s layout follows the id in the route",
  (_name: string, page: EventPage) => {
    /*
     * The AI report links one event to another on the same route, which keeps
     * the layout mounted. Its heading is ModelPage's job (covered by
     * Common/Tests/UI/Components/ModelPageModelChange.test.tsx); the side menu
     * must build every link from the id of the current render.
     */
    test("the side menu gets the id parsed from the route on every render", () => {
      expect(page.layout).toContain("const { id } = useParams();");
      expect(page.layout).toContain(
        'const modelId: ObjectID = new ObjectID(id || "");',
      );
      expect(page.layout).toContain("modelId={modelId}");
      expect(page.layout).toContain(
        "sideMenu={<SideMenu modelId={modelId} />}",
      );
    });

    test("the side menu keeps no state of its own, so no link can go stale", () => {
      for (const hook of ["useState", "useEffect", "useMemo", "useRef"]) {
        expect(page.sideMenu).not.toContain(hook);
      }

      expect(
        countOccurrences(page.sideMenu, "{ modelId: props.modelId }"),
      ).toBeGreaterThan(3);
      expect(page.sideMenu).not.toContain("getLastParam");
    });
  },
);

describe("header duration label", () => {
  /*
   * The stat bar's "Resolved in" counts to the FIRST resolution. The header's
   * duration runs to the CURRENT one, so it must not borrow that label: a
   * reopened event would read "Resolved in" twice with two numbers.
   */
  test.each(PAGES)(
    "the %s header says how long a resolved event lasted",
    (_name: string, page: EventPage) => {
      expect(page.changeState).toContain(
        'durationPrefix = translationKey("Lasted");',
      );
      expect(page.changeState).not.toContain("Resolved in");
      expect(page.changeState).not.toContain('"{{stateName}} in"');
      /*
       * The stat bar's label: "<resolved state's name> in", translated whole.
       * The state's name is a term the sentence translates: the seeded
       * "Resolved" reads in the reader's language, a state the project named
       * itself reads as written.
       */
      expect(page.view).toContain(
        'label={translator.translateTemplate("{{stateName}} in", { stateName: translatableTerm(resolvedState?.name || "Resolved"), })}',
      );
    },
  );
});

describe("incident right column roles card", () => {
  test("the roles card stacks its header", () => {
    expect(INCIDENT_PAGE.view).toContain(
      '<IncidentMemberRoleAssignment incidentId={modelId} headerLayout="stacked"',
    );
  });
});
