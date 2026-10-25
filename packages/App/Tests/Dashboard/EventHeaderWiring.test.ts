import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The four kinds of event header - incident, alert, episode (incident and
 * alert) and scheduled maintenance - are one header (EventStatusPanel). App
 * has no renderer, so these read the sources and pin what holds the four
 * together: who may change the state, the placeholders, the band's tone,
 * each kind's own facts, and the menus drawn over the page. What the header
 * draws is covered by Common's jsdom suites (EventStatusPanel,
 * EventPeopleFacts, EventStateTrack, EventFactLinks, the ChangeState and
 * overview page suites) and, at real widths, by packages/E2E/EventOverview.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, "");
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

interface HeaderKind {
  name: string;
  changeState: string;
  timeline: string;
  tone: "ai" | "warning" | "danger";
}

const KINDS: Array<HeaderKind> = [
  {
    name: "incident",
    changeState: "Components/Incident/ChangeState.tsx",
    timeline: "IncidentStateTimeline",
    tone: "ai",
  },
  {
    name: "alert",
    changeState: "Components/Alert/ChangeState.tsx",
    timeline: "AlertStateTimeline",
    tone: "ai",
  },
  {
    name: "incident episode",
    changeState: "Components/IncidentEpisode/ChangeState.tsx",
    timeline: "IncidentEpisodeStateTimeline",
    tone: "danger",
  },
  {
    name: "alert episode",
    changeState: "Components/AlertEpisode/ChangeState.tsx",
    timeline: "AlertEpisodeStateTimeline",
    tone: "danger",
  },
  {
    name: "scheduled maintenance event",
    changeState: "Components/ScheduledMaintenance/ChangeState.tsx",
    timeline: "ScheduledMaintenanceStateTimeline",
    tone: "warning",
  },
];

describe.each(KINDS)("the $name header", (kind: HeaderKind) => {
  const code: string = readCode(kind.changeState);

  test("is the shared event header", () => {
    expect(countOf(code, "<EventStatusPanel")).toBe(1);
  });

  test("asks who may add to its own state timeline before offering a state change", () => {
    expect(code).toContain(
      `stateChangeGate={PermissionGate.check(new${kind.timeline}(),ModelAction.Create,)}`,
    );
    expect(code).toContain(
      `import${kind.timeline}from"Common/Models/DatabaseModels/${kind.timeline}";`,
    );
    expect(code).toContain(
      'importPermissionGate,{ModelAction}from"Common/UI/Utils/PermissionGate";',
    );
  });

  test("paints its notice in its own band", () => {
    expect(code).toContain(`headerNoticeTone="${kind.tone}"headerNotice={`);
  });
});

describe("the placeholders", () => {
  test.each([
    [
      "Components/Incident/ChangeState.tsx",
      '<EventHeaderSkeletontestId="incident-state-placeholder"loadingText="Loadingincidentstatus"buttonCount={2}factCount={4}/>',
    ],
    [
      "Components/Alert/ChangeState.tsx",
      '<EventHeaderSkeletontestId="alert-state-placeholder"loadingText="Loadingalertstatus"buttonCount={3}factCount={4}/>',
    ],
    [
      "Components/ScheduledMaintenance/ChangeState.tsx",
      '<EventHeaderSkeletontestId="scheduled-maintenance-state-loading"loadingText={SCHEDULED_MAINTENANCE_STATE_LOADING_TEXT}buttonCount={2}factCount={4}/>',
    ],
    [
      "Components/EpisodeView/EpisodeHeader.tsx",
      '<EventHeaderSkeletontestId="episode-header-skeleton"loadingText={props.loadingText||"Loadingepisode"}buttonCount={2}factCount={5}/>',
    ],
    [
      "Components/EventView/EventOverviewSkeleton.tsx",
      '<EventHeaderSkeletontestId="event-overview-skeleton-hero"/>',
    ],
  ])("%s draws the header's own placeholder", (file: string, usage: string) => {
    expect(readCode(file)).toContain(usage);
  });

  test("no placeholder draws a header of its own any more", () => {
    for (const file of [
      "Components/Incident/ChangeState.tsx",
      "Components/Alert/ChangeState.tsx",
      "Components/ScheduledMaintenance/ChangeState.tsx",
      "Components/EpisodeView/EpisodeHeader.tsx",
      "Components/EventView/EventOverviewSkeleton.tsx",
    ]) {
      // The old placeholder's row of title and buttons.
      expect({
        file,
        oldRow: readCode(file).includes(
          'className="flexflex-colgap-3md:flex-rowmd:items-startmd:justify-between"',
        ),
      }).toEqual({ file, oldRow: false });
    }
  });

  test("the scheduled maintenance placeholder's words are looked up in the reader's language", () => {
    expect(
      readCode("Components/ScheduledMaintenance/ChangeState.tsx"),
    ).toContain(
      'exportconstSCHEDULED_MAINTENANCE_STATE_LOADING_TEXT:string=translationKey("Loadingscheduledmaintenancestatus");',
    );
    expect(readCode("Components/EventView/EventHeaderSkeleton.tsx")).toContain(
      "{translator.translateText(props.loadingText)}",
    );
  });
});

describe("each kind keeps its own facts", () => {
  test("an incident names its commander, its owners and its monitors, each monitor a link", () => {
    const page: string = readCode("Pages/Incidents/View/Index.tsx");

    expect(page).toContain("getCommanderFact({");
    expect(page).toContain("getOwnersFact({");
    expect(page).toContain(
      '<EventFactLinksdataTestId="event-monitor-links"maxVisible={MAX_HEADER_MONITORS}',
    );
    expect(page).toContain("RouteMap[PageMap.MONITOR_VIEW]asRoute");
  });

  test("an alert names its owners, its monitor and its episode, each a link", () => {
    const page: string = readCode("Pages/Alerts/View/Index.tsx");

    expect(page).toContain("getOwnersFact({");
    expect(page).toContain('<EventFactLinksdataTestId="event-monitor-links"');
    expect(page).toContain('<EventFactLinksdataTestId="event-episode-links"');
    expect(page).toContain("RouteMap[PageMap.ALERT_EPISODE_VIEW]asRoute");
  });

  test("an episode names who runs it, how it was formed and when it last grew", () => {
    for (const page of [
      "Pages/Incidents/EpisodeView/Index.tsx",
      "Pages/Alerts/EpisodeView/Index.tsx",
    ]) {
      expect(readCode(page)).toContain("getOwnersFact({");
    }
    expect(readCode("Pages/Incidents/EpisodeView/Index.tsx")).toContain(
      "getCommanderFact({",
    );
    expect(readCode("Components/EpisodeView/EpisodeHeader.tsx")).toContain(
      'label:"Grouping"',
    );
  });

  test("a scheduled maintenance event names its owners, its status pages, each a link, and who created it", () => {
    const page: string = readCode(
      "Pages/ScheduledMaintenanceEvents/View/Index.tsx",
    );

    expect(page).toContain(
      'useEventOwners({ownerUserModelType:ScheduledMaintenanceOwnerUser,ownerTeamModelType:ScheduledMaintenanceOwnerTeam,resourceIdField:"scheduledMaintenanceId",resourceId:modelId,});',
    );
    expect(page).toContain("canAddOwners:!isEventOver,");
    expect(page).toContain(
      '<EventFactLinksdataTestId="event-status-page-links"',
    );
    expect(page).toContain("RouteMap[PageMap.STATUS_PAGE_VIEW]asRoute");
    expect(page).toContain("value:<PersonFactValuename={createdByName}/>,");
    // Its window stays in the stat bar under the header.
    expect(page).toContain("<ScheduledMaintenanceWindowStats");
  });
});

describe("the header's menus", () => {
  test("are drawn over the page: the header is a size container, which a menu inside it could not leave", () => {
    const panel: string = readCode("Components/EventView/EventStatusPanel.tsx");

    // Open channel's menu, and the ⋯ of the other states.
    expect(countOf(panel, "<MoreMenutext=")).toBe(2);
    expect(countOf(panel, "isMenuPortaled={true}")).toBe(2);
  });
});
