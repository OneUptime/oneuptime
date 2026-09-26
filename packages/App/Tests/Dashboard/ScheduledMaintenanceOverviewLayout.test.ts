import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * App's node test environment cannot render React, so the scheduled
 * maintenance overview's layout contract is pinned here as comment-stripped,
 * whitespace-squashed source. Behaviour is covered by the RTL suites in
 * Common/Tests/App/Dashboard (ScheduledMaintenanceChangeState and
 * ScheduledMaintenanceFeedRefresh) and the pure timing rules by
 * ScheduledMaintenanceTiming.test.ts.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readRawSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8");
};

const squash: (source: string) => string = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return squash(readRawSource(...relativeParts));
};

const PAGE_PATH: Array<string> = [
  "Pages",
  "ScheduledMaintenanceEvents",
  "View",
  "Index.tsx",
];
const CHANGE_STATE_PATH: Array<string> = [
  "Components",
  "ScheduledMaintenance",
  "ChangeState.tsx",
];
const FEED_PATH: Array<string> = [
  "Components",
  "ScheduledMaintenance",
  "ScheduledMaintenanceFeed.tsx",
];

const page: string = readSource(...PAGE_PATH);
const changeState: string = readSource(...CHANGE_STATE_PATH);
const feed: string = readSource(...FEED_PATH);

type IndexOfFunction = (source: string, needle: string) => number;

// Like indexOf, but fails loudly instead of returning -1.
const indexOf: IndexOfFunction = (source: string, needle: string): number => {
  const index: number = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`Expected source to contain: ${needle}`);
  }

  return index;
};

type CountFunction = (source: string, needle: string) => number;

const count: CountFunction = (source: string, needle: string): number => {
  return source.split(needle).length - 1;
};

describe("scheduled maintenance overview: layout follows the route id", () => {
  test("the side menu gets the id parsed from the route on every render and keeps no state", () => {
    const layout: string = readSource(
      "Pages",
      "ScheduledMaintenanceEvents",
      "View",
      "Layout.tsx",
    );
    const sideMenu: string = readSource(
      "Pages",
      "ScheduledMaintenanceEvents",
      "View",
      "SideMenu.tsx",
    );

    expect(layout).toContain("const { id } = useParams();");
    expect(layout).toContain(
      'const modelId: ObjectID = new ObjectID(id || "");',
    );
    expect(layout).toContain("sideMenu={<SideMenu modelId={modelId} />}");

    for (const hook of ["useState", "useEffect", "useMemo", "useRef"]) {
      expect(sideMenu).not.toContain(hook);
    }

    expect(count(sideMenu, "{ modelId: props.modelId }")).toBeGreaterThan(3);
  });
});

describe("scheduled maintenance overview: loading", () => {
  test("shows the event overview skeleton on first load instead of a page loader", () => {
    expect(page).toContain(
      'import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";',
    );
    expect(page).toContain("<EventOverviewSkeleton");
    expect(page).not.toContain("PageLoader");
  });

  test("only the first load of an event shows the skeleton; refreshes keep the page mounted", () => {
    /*
     * The loaded event is stamped with its id. The page stays mounted when
     * the reader moves to another event, so "an item is in state" never meant
     * "this event is loaded": a failed first load of the next event used to
     * render the previous one under the new URL.
     */
    expect(page).toContain(
      "const isCurrentEventLoaded: boolean = loadedEvent?.modelId === modelIdString;",
    );
    expect(page).toContain(
      "setLoadedEvent({ modelId: modelIdString, item: item });",
    );
    expect(page).toContain(
      "return current?.modelId === modelIdString ? current : null;",
    );
    expect(page).not.toContain("setScheduledMaintenance(");
    expect(page).toContain("setLoadedModelId(modelIdString);");
    // A refresh flips the toggle; it never clears the loaded event.
    expect(page).toContain("}, [modelIdString, refreshToggle]);");
    expect(indexOf(page, "if (!isCurrentEventLoaded) {")).toBeLessThan(
      indexOf(page, "<EventOverviewSkeleton"),
    );
  });

  test("a failed first load shows an error with a retry, not an empty page", () => {
    expect(page).toContain("<ErrorMessage message={loadError}");
    expect(page).toContain("onRefreshClick={() => {");
    expect(page).toContain(
      "setLoadError(API.getFriendlyMessage(err as Exception));",
    );
    expect(page).not.toContain("degrade gracefully");
  });

  test("ignores responses that belong to an older request", () => {
    expect(page).toContain(
      "if (requestNumber !== latestRequestRef.current) { return; }",
    );
  });

  test("the header starts loading and never uses the full-page loader", () => {
    expect(changeState).toContain(
      "const [isLoading, setIsLoading] = useState<boolean>(true);",
    );
    expect(changeState).not.toContain("PageLoader");
    expect(changeState).not.toContain("mt-52");
    expect(changeState).toContain('role="status"');
    expect(changeState).toContain('aria-live="polite"');
    expect(changeState).toContain("motion-safe:animate-pulse");
  });

  test("the header loads states, timeline and templates in parallel", () => {
    expect(changeState).toContain(
      "await Promise.all([ fetchScheduledMaintenanceStates(), fetchScheduledMaintenanceStateTimelines(), fetchScheduledMaintenanceNoteTemplates(), ]);",
    );
  });
});

describe("scheduled maintenance overview: header", () => {
  test("passes context facts into the header", () => {
    expect(page).toContain("facts={heroFacts}");
    expect(page).toContain('label: "Status pages"');
    expect(page).toContain('label: "Created by"');
    expect(page).toContain("statusPages: { _id: true, name: true, },");
    expect(page).toContain("createdByUser: { name: true, email: true, },");
    expect(changeState).toContain("facts={props.facts}");
  });

  test("derives timing from the pure timing util and re-evaluates it on a timeout loop", () => {
    expect(changeState).toContain(
      'from "../../Utils/ScheduledMaintenanceTiming";',
    );
    expect(changeState).toContain(
      "const timing: ScheduledMaintenanceTiming = getScheduledMaintenanceTiming({",
    );
    expect(changeState).toContain("durationPrefix={timing.durationPrefix}");
    expect(changeState).toContain("durationStartsAt={timing.durationStartsAt}");
    expect(changeState).toContain("durationEndsAt={timing.durationEndsAt}");
    expect(changeState).toContain("setTimeout(() => {");
    expect(changeState).toContain("clearTimeout(timeout);");
    expect(changeState).not.toContain("setInterval");
    // The old one-shot countdown check is gone.
    expect(changeState).not.toContain(
      "OneUptimeDate.isInTheFuture(props.eventStartsAt)",
    );
  });

  test("shows overdue phases as a header notice", () => {
    expect(changeState).toContain("headerNotice={overdueNotice}");
    expect(changeState).toContain(
      "timing.isOverdue && timing.overdueSince ? ( <OverdueNotice",
    );
    expect(changeState).toContain("bg-amber-50");
  });

  test("re-reads the timeline after a missed boundary and refreshes the page on a real change", () => {
    expect(changeState).toContain(
      "shouldRecheckScheduledMaintenanceState(timing, now)",
    );
    expect(changeState).toContain("onActionCompleteRef.current();");
  });

  test("keeps the pinned action ids", () => {
    const rawChangeState: string = readRawSource(...CHANGE_STATE_PATH);

    expect(count(rawChangeState, 'id: "sm-mark-ongoing-btn"')).toBe(1);
    expect(count(rawChangeState, 'id: "sm-mark-complete-btn"')).toBe(2);
  });
});

describe("scheduled maintenance overview: stat bar", () => {
  test("renders one stat bar of three segments under the header", () => {
    expect(page).toContain("<EventStatBar columns={3}");
    expect(count(page, 'variant="segment"')).toBe(3);
    expect(page).toContain('label="Starts"');
    expect(page).toContain('label="Ends"');
    expect(page).toContain('label="Duration"');
    expect(indexOf(page, "<ChangeScheduledMaintenanceState")).toBeLessThan(
      indexOf(page, "<ScheduledMaintenanceWindowStats"),
    );
    expect(indexOf(page, "<ScheduledMaintenanceWindowStats")).toBeLessThan(
      indexOf(
        page,
        'className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3"',
      ),
    );
  });

  test("keeps the window length as the duration and names the timezone once, inside the bar", () => {
    expect(page).toContain(
      "<LiveDuration startDate={eventStartsAt} endDate={eventEndsAt} />",
    );
    expect(count(page, "getCurrentTimezoneString()")).toBe(1);
    // Folded into the Duration cell, not a loose footnote under the bar.
    expect(page).toContain("description={plannedWindowDescription}");
    expect(page).not.toContain('"Times in "');
    expect(page).not.toContain("Your local timezone");
    expect(
      indexOf(page, 'label="Duration"') <
        indexOf(page, "description={plannedWindowDescription}"),
    ).toBe(true);
    expect(
      indexOf(page, "description={plannedWindowDescription}"),
    ).toBeLessThan(indexOf(page, "</EventStatBar>"));
  });

  /*
   * The zone used to be glued onto English text in code, which no locale
   * key can match. It is one key with a placeholder, looked up and then
   * filled in by the page (react-i18next's not-ready t() does not
   * interpolate), and passed to EventStatTile as is since the tile does not
   * translate its description.
   */
  test("looks the timezone description up as one key and fills the zone in itself", () => {
    expect(page).toContain(
      'export const PLANNED_WINDOW_DESCRIPTION_TEMPLATE: string = "Planned window · times in {{abbreviation}}";',
    );
    expect(page).not.toContain('"Planned window · times in " +');
    expect(page).toContain(
      "const timezoneValues: Dictionary<string> = { abbreviation: OneUptimeDate.getCurrentTimezoneString(), };",
    );
    expect(page).toContain(
      "translateString(PLANNED_WINDOW_DESCRIPTION_TEMPLATE) || PLANNED_WINDOW_DESCRIPTION_TEMPLATE",
    );
    expect(
      indexOf(page, "translateString(PLANNED_WINDOW_DESCRIPTION_TEMPLATE)"),
    ).toBeLessThan(
      indexOf(page, "return timezoneValues[name] ?? placeholder;"),
    );
  });

  test("describes start and end relative to a clock that keeps moving", () => {
    expect(count(page, "formatScheduledMaintenanceRelativeTime(")).toBe(2);
    expect(page).toContain(
      "}, SCHEDULED_MAINTENANCE_TIMING_REFRESH_INTERVAL_IN_MS);",
    );
  });
});

describe("scheduled maintenance overview: columns", () => {
  test("left column holds runbooks then the feed; right column details, custom fields, affected resources", () => {
    const grid: number = indexOf(
      page,
      'className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3"',
    );
    const left: number = indexOf(page, 'className="min-w-0 xl:col-span-2"');
    const runbooks: number = indexOf(page, "<EntityRunbooks");
    const feedElement: number = indexOf(
      page,
      "<ScheduledMaintenanceFeedElement",
    );
    const right: number = indexOf(page, 'className="min-w-0 xl:col-span-1"');
    const details: number = indexOf(
      page,
      'name="Scheduled Maintenance Details"',
    );
    const customFields: number = indexOf(page, "<OverviewCustomFields");
    const resources: number = indexOf(page, 'name="Affected Resources"');

    expect(grid).toBeLessThan(left);
    expect(left).toBeLessThan(runbooks);
    expect(runbooks).toBeLessThan(feedElement);
    expect(feedElement).toBeLessThan(right);
    expect(right).toBeLessThan(details);
    expect(details).toBeLessThan(customFields);
    expect(customFields).toBeLessThan(resources);
  });

  test("refreshes the feed after state changes and edits", () => {
    expect(page).toContain("refreshToken={feedRefreshToken}");
    expect(count(page, "setFeedRefreshToken((token: number) => {")).toBe(3);
    expect(feed).toContain("refreshToken?: number | undefined;");
    expect(feed).toContain("refreshToken: props.refreshToken,");
  });
});

describe("scheduled maintenance overview: details card", () => {
  test("uses the compact detail style in one column", () => {
    expect(page).toContain(
      "showDetailsInNumberOfColumns: 1, style: DetailStyle.Compact,",
    );
    expect(page).toContain(
      'import { DetailStyle } from "Common/UI/Components/Detail/Detail";',
    );
  });

  test("drops the unused timeline request", () => {
    expect(page).not.toContain("onBeforeFetch");
    expect(page).not.toContain("LIMIT_PER_PROJECT");
    expect(page).not.toContain("ScheduledMaintenanceStateTimeline");
  });

  test("orders the fields with the number last-but-one and the id last", () => {
    const titles: Array<string> = [
      'title: "Starts At"',
      'title: "Ends At"',
      'title: "Created At"',
      'title: "Shown on Status Pages"',
      'title: "Subscriber Reminders"',
      'title: "Subscriber Notifications"',
      'title: "Labels", fieldType: FieldType.Element',
      'title: "Scheduled Maintenance Number"',
      'title: "Scheduled Maintenance ID"',
    ];
    const fieldsStart: number = indexOf(page, "style: DetailStyle.Compact,");
    const positions: Array<number> = titles.map((title: string): number => {
      return page.indexOf(title, fieldsStart);
    });

    for (const position of positions) {
      expect(position).toBeGreaterThan(fieldsStart);
    }

    expect(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(positions);
  });

  test("shows reminders as an element with corrected copy", () => {
    expect(page).toContain('postfix=" before the event begins"');
    expect(page).not.toContain("is begins");
    expect(page).toContain(
      'title: "Subscriber Reminders", fieldType: FieldType.Element,',
    );
    expect(page).not.toContain("fieldType: FieldType.Boolean");
  });

  test("surfaces a failed notification resend instead of swallowing it", () => {
    expect(page).toContain(
      "setResendNotificationErrorState({ modelId: modelIdString, message: API.getFriendlyMessage(err as Exception), });",
    );
    // Read only for the event it failed for.
    expect(page).toContain(
      "resendNotificationErrorState?.modelId === modelIdString",
    );
    expect(page).toContain("{resendNotificationError && (");
    expect(page).toContain('role="alert"');
    expect(page).not.toContain("handle appropriately");
  });

  test("keeps the custom fields card as the first model and custom field type on the page", () => {
    expect(page.match(/modelType=\{([A-Za-z0-9_]+)\}/)?.[1]).toBe(
      "ScheduledMaintenance",
    );
    expect(page.match(/customFieldType=\{([A-Za-z0-9_]+)\}/)?.[1]).toBe(
      "ScheduledMaintenanceCustomField",
    );
  });
});

describe("scheduled maintenance overview: affected resources", () => {
  const RELATIONS: Array<{ relation: string; model: string; type: string }> = [
    { relation: "monitors", model: "Monitor", type: "Monitor" },
    { relation: "hosts", model: "Host", type: "Host" },
    {
      relation: "kubernetesClusters",
      model: "KubernetesCluster",
      type: "KubernetesCluster",
    },
    { relation: "dockerHosts", model: "DockerHost", type: "DockerHost" },
    { relation: "podmanHosts", model: "PodmanHost", type: "PodmanHost" },
    {
      relation: "proxmoxClusters",
      model: "ProxmoxCluster",
      type: "ProxmoxCluster",
    },
    {
      relation: "vmwareVCenters",
      model: "VMwareVCenter",
      type: "VMwareVCenter",
    },
    { relation: "cephClusters", model: "CephCluster", type: "CephCluster" },
    {
      relation: "dockerSwarmClusters",
      model: "DockerSwarmCluster",
      type: "DockerSwarmCluster",
    },
    { relation: "iotFleets", model: "IoTFleet", type: "IoTFleet" },
    {
      relation: "databaseServers",
      model: "DatabaseServer",
      type: "DatabaseServer",
    },
    { relation: "networkSites", model: "NetworkSite", type: "NetworkSite" },
    { relation: "services", model: "Service", type: "Service" },
  ];

  test.each(RELATIONS)(
    "$relation is offered, written back, registered, selected and displayed",
    ({
      relation,
      model,
      type,
    }: {
      relation: string;
      model: string;
      type: string;
    }) => {
      // Offered by the picker (prettier may wrap the value in its braces).
      expect(page).toContain(`"${type}",`);
      expect(page).toMatch(
        new RegExp(
          `${relation}=\\{ ?values\\.${relation} as Array<${model}> ?\\}`,
        ),
      );
      // Written back by the form's onChange, or the selection is dropped on save.
      expect(page).toContain(`${relation}: payload.${relation},`);
      // Selected for display and shown.
      expect(page).toContain(`${relation}: { name: true, _id: true,`);
      expect(page).toMatch(
        new RegExp(`${relation}=\\{ ?item\\.${relation} \\|\\| \\[\\] ?\\}`),
      );

      if (relation !== "monitors") {
        // Registered so ModelForm loads and submits the relation.
        expect(page).toContain(`field: { ${relation}: true },`);
      }
    },
  );

  test("the picker's resource types list every relation, in the incident page's order plus network sites", () => {
    expect(page).toContain(
      'resourceTypes={[ "Monitor", "Host", "KubernetesCluster", "DockerHost", "PodmanHost", "ProxmoxCluster", "VMwareVCenter", "CephCluster", "DockerSwarmCluster", "IoTFleet", "DatabaseServer", "NetworkSite", "Service", ]}',
    );
  });
});

describe("scheduled maintenance feed", () => {
  test("fixes the note modal names and copy", () => {
    expect(feed).not.toContain("scheduledMaintenancet");
    expect(feed).not.toContain("create-scheduledMaintenance-internal-note");
    expect(count(feed, '"create-scheduled-maintenance-public-note"')).toBe(3);
    expect(count(feed, '"create-scheduled-maintenance-internal-note"')).toBe(3);
    // The public note form no longer borrows the state timeline form's id.
    expect(feed).not.toContain("create-scheduled-maintenance-state-timeline");
    expect(feed).not.toContain(
      "Post a public note about this state change to the status page.",
    );
  });

  test("maps every feed event type to an icon through a typed record", () => {
    expect(feed).toContain(
      "export const SCHEDULED_MAINTENANCE_FEED_ICONS: Record< ScheduledMaintenanceFeedEventType, IconProp > = {",
    );
    expect(feed).toContain(
      "[ScheduledMaintenanceFeedEventType.OwnerRuleExecuted]: IconProp.User,",
    );
    expect(feed).toContain(
      "[ScheduledMaintenanceFeedEventType.LabelRuleExecuted]: IconProp.Tag,",
    );
  });
});

describe("scheduled maintenance overview: right column fits its width", () => {
  /*
   * The right column is about 300px wide. Side-by-side card headers squeezed
   * each title beside "Edit Scheduled Maintenance Event" into a column one
   * word wide, and two resource tiles per row clipped every name.
   */
  const rightColumn: string = page.slice(
    indexOf(page, 'className="min-w-0 xl:col-span-1"'),
  );

  test("both detail cards stack their headers and say Edit", () => {
    expect(count(rightColumn, 'headerLayout: "stacked",')).toBe(2);
    expect(count(rightColumn, 'editButtonText="Edit"')).toBe(2);
    expect(count(rightColumn, "isEditable={true}")).toBe(2);
    expect(page).not.toContain("Here are more details for this event.");
  });

  test("the cards carry short descriptions", () => {
    expect(rightColumn).toContain(
      'title: "Maintenance Details", description: "Key facts about this maintenance event.", headerLayout: "stacked",',
    );
    expect(rightColumn).toContain(
      'title: "Affected Resources", description: "Monitors, services and infrastructure this maintenance affects.", headerLayout: "stacked",',
    );
  });

  test("custom fields stack too, and resources render in one column", () => {
    expect(rightColumn).toContain(
      'resourceName="Scheduled Maintenance" headerLayout="stacked"',
    );
    expect(count(page, "<AffectedResourcesDisplay")).toBe(1);
    expect(rightColumn).toContain(
      "services={item.services || []} columns={1} />",
    );
  });
});
