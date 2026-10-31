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

const WHITESPACE: RegExp = /\s+/g;

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

interface HeaderKind {
  name: string;
  changeState: string;
  timeline: string;
  tone: "ai" | "warning" | "danger";
  /*
   * How the band is wired when its tone follows what it holds: a scheduled
   * maintenance event's says in amber that it missed a boundary, or, quiet,
   * that it is kept off its status pages until its publish time (#5249).
   */
  bandWiring?: string;
  // What a locked state button says first, in the words of what was pressed.
  lockSentence: string;
  /*
   * Whether the record can be private: its state is then changed only with
   * the permissions of the teams that own it, so the state buttons ask with
   * what the reader holds on it (PrivateRecordScope).
   */
  canBePrivate: boolean;
}

const KINDS: Array<HeaderKind> = [
  {
    name: "incident",
    changeState: "Components/Incident/ChangeState.tsx",
    timeline: "IncidentStateTimeline",
    tone: "ai",
    lockSentence: "You do not have permission to change this incident's state.",
    canBePrivate: true,
  },
  {
    name: "alert",
    changeState: "Components/Alert/ChangeState.tsx",
    timeline: "AlertStateTimeline",
    tone: "ai",
    lockSentence: "You do not have permission to change this alert's state.",
    canBePrivate: true,
  },
  {
    name: "incident episode",
    changeState: "Components/IncidentEpisode/ChangeState.tsx",
    timeline: "IncidentEpisodeStateTimeline",
    tone: "danger",
    lockSentence: "You do not have permission to change this episode's state.",
    canBePrivate: true,
  },
  {
    name: "alert episode",
    changeState: "Components/AlertEpisode/ChangeState.tsx",
    timeline: "AlertEpisodeStateTimeline",
    tone: "danger",
    lockSentence: "You do not have permission to change this episode's state.",
    canBePrivate: true,
  },
  {
    name: "scheduled maintenance event",
    changeState: "Components/ScheduledMaintenance/ChangeState.tsx",
    timeline: "ScheduledMaintenanceStateTimeline",
    tone: "warning",
    bandWiring:
      'headerNoticeTone={overdueNotice?"warning":"neutral"}headerNotice={overdueNotice||props.publishingNotice}',
    lockSentence: "You do not have permission to change this event's state.",
    canBePrivate: false,
  },
];

describe.each(KINDS)("the $name header", (kind: HeaderKind) => {
  const code: string = readCode(kind.changeState);

  test("is the shared event header", () => {
    expect(countOf(code, "<EventStatusPanel")).toBe(1);
  });

  test("asks who may add to its own state timeline before offering a state change", () => {
    /*
     * A locked button says, first, that the reader may not change this
     * record's state - not that they may not "create this State Timeline" -
     * and then which permissions would let them.
     */
    const sentence: string = `{sentence:translationKey("${kind.lockSentence.replace(
      WHITESPACE,
      "",
    )}",),}`;

    expect(code).toContain(
      kind.canBePrivate
        ? `stateChangeGate={PermissionGate.check(new${kind.timeline}(),ModelAction.Create,withPrivateRecordGateOptions(${sentence},privateRecordOptions,),)}`
        : `stateChangeGate={PermissionGate.check(new${kind.timeline}(),ModelAction.Create,${sentence},)}`,
    );
    expect(code).toContain(
      `import${kind.timeline}from"Common/Models/DatabaseModels/${kind.timeline}";`,
    );
    expect(code).toContain(
      kind.canBePrivate
        ? 'importPermissionGate,{ModelAction,PermissionGateOptions,}from"Common/UI/Utils/PermissionGate";'
        : 'importPermissionGate,{ModelAction}from"Common/UI/Utils/PermissionGate";',
    );
  });

  /*
   * A private incident, alert or episode is changed only with the
   * permissions of the teams that own it (PrivateRecordScope): its state
   * buttons, and the note its dialog offers, ask with what the reader holds
   * on the record its page is open on - read from the row of its state
   * timeline, a part of it.
   */
  test("asks with what the reader holds on a private record, when it can be one", () => {
    expect(
      code.includes(
        `constPRIVATE_RECORD_STATE_TIMELINE:${kind.timeline}=new${kind.timeline}();`,
      ),
    ).toBe(kind.canBePrivate);
    expect(
      code.includes(
        "constprivateRecordOptions:PermissionGateOptions|undefined=usePrivateRecordGateOptions(PRIVATE_RECORD_STATE_TIMELINE);",
      ),
    ).toBe(kind.canBePrivate);
    expect(
      code.includes(
        'import{usePrivateRecordGateOptions,withPrivateRecordGateOptions,}from"Common/UI/Utils/PrivateRecordScope";',
      ),
    ).toBe(kind.canBePrivate);
    // Every note the dialog offers is asked about the same way.
    expect(countOf(code, "noteGateOptions:privateRecordOptions,")).toBe(
      kind.canBePrivate ? countOf(code, "noteModel:new") : 0,
    );
  });

  test("paints its notice in its own band", () => {
    expect(code).toContain(
      kind.bandWiring || `headerNoticeTone="${kind.tone}"headerNotice={`,
    );
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
      'exportconstSCHEDULED_MAINTENANCE_STATE_LOADING_TEXT:string=translationKey("Loadingscheduledmaintenancestatus",);',
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
    // Add owners until it is over, to a reader who may add one, right there.
    expect(page).toContain(
      "addOwners:!isEventOver&&owners.canAddOwners?{target:owners.target,",
    );
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
