import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident and alert overview pages share one layout contract:
 *
 *   - the first load shows EventOverviewSkeleton, and nothing after that ever
 *     unmounts the page again (an acknowledge, an edit or a role change
 *     refreshes it in the background);
 *   - the header carries facts and the AI summary, directly under it sits one
 *     EventStatBar, and the AI investigation leads the left column;
 *   - the right column's details card uses the compact detail style.
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

// Every `title: "..."` between two markers, in order.
function titlesBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): Array<string> {
  const start: number = indexOfOrFail(source, startMarker);
  const end: number = source.indexOf(endMarker, start);
  const section: string = source.slice(start, end < 0 ? undefined : end);

  return Array.from(section.matchAll(/ title: "([^"]*)"/g)).map(
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
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
  expectedDetailTitles: [
    "Declared At",
    "Declared By",
    "On-Call Duty Policies",
    "Subscriber Notification Status",
    "Labels",
    "Incident Number",
    "Incident ID",
  ],
  expectedFactLabels: ["Declared", "Declared by"],
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
  expectedDetailTitles: [
    "Created At",
    "Created By",
    "Monitor",
    "Episode",
    "On-Call Duty Policies",
    "Labels",
    "Alert Number",
    "Alert ID",
  ],
  expectedFactLabels: ["Created", "Monitor", "Episode"],
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

  test("the stat bar has three segment cells", () => {
    expect(countOccurrences(page.view, 'variant="segment"')).toBe(3);
    expect(countOccurrences(page.view, "<EventStatTile")).toBe(3);
    expect(page.view).toContain('label="Duration"');
    expect(page.view).toContain(
      `ariaLabel="${page.noun === "incident" ? "Incident" : "Alert"} response times"`,
    );
  });

  test("response times come from the shared first-entry reading", () => {
    expect(page.view).toContain("getEventResponseTimes({");
    expect(countOccurrences(page.view, "getTimeToStateText({")).toBe(2);
    expect(page.view).toContain("reachedAt: responseTimes.acknowledgedAt,");
    expect(page.view).toContain("reachedAt: responseTimes.resolvedAt,");
    expect(page.view).not.toContain(".reverse()");
    expect(page.view).not.toContain("getLastTimelineDateForState");
  });

  test("the left column leads with the AI investigation", () => {
    const order: Array<number> = [
      "<InvestigationPanel",
      "<TelemetryCompanionSignalTabs",
      "<MonitorSummarySnapshotCard",
      page.affectedResourcesElement,
      "<RemediationSuggestionCard",
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

  test("the right column: details, then resources, then custom fields last", () => {
    const details: number = indexOfOrFail(page.view, page.detailsCardName);
    const resources: number = indexOfOrFail(
      page.view,
      'name="Affected Resources"',
    );
    const customFields: number = indexOfOrFail(
      page.view,
      "<OverviewCustomFields",
    );

    expect(details).toBeLessThan(resources);
    expect(resources).toBeLessThan(customFields);
    expect(indexOfOrFail(page.view, page.feedElement)).toBeLessThan(details);
  });

  test("both detail cards use the compact style", () => {
    expect(countOccurrences(page.view, "style: DetailStyle.Compact,")).toBe(2);
    expect(page.view).toContain(
      'import { DetailStyle } from "Common/UI/Components/Detail/Detail";',
    );
  });

  test("details fields: when and who first, number and id last", () => {
    expect(
      titlesBetween(page.view, page.detailsId, "modelId: modelId"),
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
  test("incident roles sit between the details card and affected resources", () => {
    const view: string = INCIDENT_PAGE.view;
    const details: number = indexOfOrFail(view, 'name="Incident Details"');
    const roles: number = indexOfOrFail(view, "<IncidentMemberRoleAssignment");
    const resources: number = indexOfOrFail(view, 'name="Affected Resources"');

    expect(details).toBeLessThan(roles);
    expect(roles).toBeLessThan(resources);
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
      "const handleResendNotification: () => Promise<void> =",
    );

    expect(resendBody).toContain("setDetailsRefresher(");
    expect(resendBody).not.toContain("setLoadedModelId");
    expect(resendBody).not.toContain("fetchData(");
    expect(INCIDENT_PAGE.view).toContain("refresher={detailsRefresher}");
  });

  test("a failed resend is reported under the status it failed to change, not as a refresh failure", () => {
    const resendBody: string = arrowBodyAfter(
      INCIDENT_PAGE.view,
      "const handleResendNotification: () => Promise<void> =",
    );

    expect(resendBody).toContain("setResendNotificationErrorState(null);");
    expect(resendBody).toContain(
      "setResendNotificationErrorState({ subjectId: modelIdString, value: BaseAPI.getFriendlyMessage(err), });",
    );
    expect(resendBody).not.toContain("setRefreshError");
    expect(INCIDENT_PAGE.view).toContain(
      '"Could not resend notifications: " + resendNotificationError',
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
    expect(INCIDENT_PAGE.view).toContain(
      "setDeclaredBy({ subjectId: modelIdString, value: getEventCreatorName({",
    );
    expect(INCIDENT_PAGE.view).toContain(
      "declaredBy?.subjectId === modelIdString",
    );
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
      expect(page.changeState).toContain('durationPrefix = "Lasted";');
      expect(page.changeState).not.toContain("Resolved in");
      expect(page.view).toContain(
        'label={`${resolvedState?.name || "Resolved"} in`}',
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
