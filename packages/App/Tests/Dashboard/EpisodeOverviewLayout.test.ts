import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident episode and alert episode overviews were a single column: a
 * two-column details card, a legacy stepper, two fixed-width info cards and
 * a feed, with a full-page loader that unmounted everything on every change.
 * They now follow the incident page: a header built on EventStatusPanel, one
 * stat bar, and a two-thirds / one-third grid with the member list first.
 *
 * App's node test environment cannot render React, so the layout contract is
 * pinned here as comment-stripped, whitespace-squashed source. Behaviour is
 * covered by the RTL suites in Common/Tests/App/Dashboard
 * (IncidentEpisodeViewFields, AlertEpisodeViewFields, EpisodeMembersCard,
 * EpisodeChangeState).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSquashed(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function indexOfOrFail(source: string, fragment: string): number {
  const index: number = source.indexOf(fragment);

  if (index < 0) {
    throw new Error(`Expected source to contain: ${fragment}`);
  }

  return index;
}

function countOccurrences(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

interface EpisodePage {
  name: string;
  pagePath: string;
  changeStatePath: string;
  feedPath: string;
  memberModel: string;
  episodeIdField: string;
  memberSortField: string;
  countLabel: string;
  countField: string;
  cardTitle: string;
  feedElement: string;
  viewAllPage: string;
  memberViewPage: string;
  memberSelect: string;
  memberRow: string;
  startedAt: string;
}

const EPISODE_PAGES: Array<EpisodePage> = [
  {
    name: "Incident episode",
    pagePath: "Pages/Incidents/EpisodeView/Index.tsx",
    changeStatePath: "Components/IncidentEpisode/ChangeState.tsx",
    feedPath: "Components/IncidentEpisode/IncidentEpisodeFeed.tsx",
    memberModel: "Incident",
    episodeIdField: "incidentEpisodeId",
    memberSortField: "declaredAt",
    countLabel: "Incidents",
    countField: "incidentCount",
    cardTitle: "Incidents in this episode",
    feedElement: "<IncidentEpisodeFeedElement",
    viewAllPage: "PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS",
    memberViewPage: "PageMap.INCIDENT_VIEW",
    memberSelect: "INCIDENT_EPISODE_MEMBER_SELECT",
    memberRow: "getIncidentEpisodeMemberRow",
    startedAt:
      "startedAt: episode?.declaredAt || episode?.createdAt || undefined",
  },
  {
    name: "Alert episode",
    pagePath: "Pages/Alerts/EpisodeView/Index.tsx",
    changeStatePath: "Components/AlertEpisode/ChangeState.tsx",
    feedPath: "Components/AlertEpisode/AlertEpisodeFeed.tsx",
    memberModel: "Alert",
    episodeIdField: "alertEpisodeId",
    memberSortField: "createdAt",
    countLabel: "Alerts",
    countField: "alertCount",
    cardTitle: "Alerts in this episode",
    feedElement: "<AlertEpisodeFeedElement",
    viewAllPage: "PageMap.ALERT_EPISODE_VIEW_ALERTS",
    memberViewPage: "PageMap.ALERT_VIEW",
    memberSelect: "ALERT_EPISODE_MEMBER_SELECT",
    memberRow: "getAlertEpisodeMemberRow",
    startedAt: "startedAt: episode?.createdAt || undefined",
  },
];

describe("episode overview layout", () => {
  test.each(EPISODE_PAGES)(
    "$name shows a skeleton on first load and never unmounts on refresh",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.pagePath);

      expect(source).toContain(
        "const [loadedModelId, setLoadedModelId] = useState<string | null>(null);",
      );
      /*
       * Decided at render time against the id in the URL, so moving to
       * another episode on the same route (the page is not remounted) shows
       * the skeleton on its very first render instead of mounting every card
       * with the new id over the previous episode's numbers.
       */
      expect(source).toContain(
        'if (loadedModelId !== modelIdString) { return ( <EventOverviewSkeleton statCount={4} loadingText="Loading episode" /> ); }',
      );
      expect(source).not.toContain("isFirstLoad");
      // The old full-page loader unmounted every card on each state change.
      expect(source).not.toContain("PageLoader");
      expect(source).not.toContain("setIsLoading(true)");
      // Only a retry of a failed first load goes back to the skeleton.
      expect(countOccurrences(source, "setLoadedModelId(null)")).toBe(1);
      expect(source).toContain("setLoadedModelId(requestedModelId);");

      // A reload fired by a card of the previous episode is dropped.
      const guard: number = indexOfOrFail(
        source,
        "if (requestedModelId !== currentModelIdRef.current) { return; }",
      );

      expect(guard).toBeLessThan(
        indexOfOrFail(
          source,
          "const requestId: number = requestIdRef.current + 1;",
        ),
      );
      expect(source).toContain(
        "useEffect(() => { currentModelIdRef.current = modelIdString; hasLoadedRef.current = false;",
      );

      // A refresh that fails keeps the page and reports inline.
      expect(source).toContain("if (hasLoadedRef.current) { setRefreshError(");
      // Stale responses (a newer request, or another episode) are dropped.
      expect(source).toContain(
        "if (requestId !== requestIdRef.current) { return; }",
      );
      // A failed first load offers a retry.
      expect(source).toContain("<ErrorMessage message={error} onRefreshClick=");
    },
  );

  test.each(EPISODE_PAGES)(
    "$name loads its timing data in parallel",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.pagePath);

      expect(source).toContain("await Promise.all([");
      expect(source).toContain(`${page.countField}: true`);
      expect(source).toContain("resolvedAt: true");
      expect(source).toContain(page.startedAt);
      // Never measured from "now" or the first timeline entry any more.
      expect(source).not.toContain("|| new Date()");
      expect(source).not.toContain("episodeStateTimeline[0]?.startsAt");
    },
  );

  test.each(EPISODE_PAGES)(
    "$name renders the header, then one four-cell stat bar, then the grid",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.pagePath);

      const header: number = indexOfOrFail(source, "<ChangeEpisodeState");
      const statBar: number = indexOfOrFail(
        source,
        '<EventStatBar columns={4} ariaLabel="Episode timing">',
      );
      const grid: number = indexOfOrFail(
        source,
        '<div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">',
      );

      expect(header).toBeLessThan(statBar);
      expect(statBar).toBeLessThan(grid);

      expect(countOccurrences(source, '<EventStatTile variant="segment"')).toBe(
        4,
      );
      expect(source).toContain("label={`${timing.acknowledgedStateName} in`}");
      expect(source).toContain("label={`${timing.resolvedStateName} in`}");
      expect(source).toContain('label="Duration"');
      expect(source).toContain(`label="${page.countLabel}"`);
      expect(source).toContain(
        "<LiveDuration startDate={timing.durationStartsAt} endDate={timing.durationEndsAt} />",
      );

      // The legacy fixed-width row is gone.
      expect(source).not.toContain("InfoCard");
      expect(source).not.toContain("w-1/2");
      expect(source).not.toContain("space-x-5");
    },
  );

  test.each(EPISODE_PAGES)(
    "$name puts members, telemetry and feed on the left and details on the right",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.pagePath);

      const leftColumn: number = indexOfOrFail(
        source,
        '<div className="min-w-0 xl:col-span-2">',
      );
      const members: number = indexOfOrFail(
        source,
        `<EpisodeMembersCard<${page.memberModel}>`,
      );
      const telemetry: number = indexOfOrFail(
        source,
        "<TelemetrySnapshotPanel",
      );
      const feed: number = indexOfOrFail(source, page.feedElement);
      const rightColumn: number = indexOfOrFail(
        source,
        '<div className="min-w-0 xl:col-span-1">',
      );
      const details: number = indexOfOrFail(source, "<CardModelDetail<");

      expect(leftColumn).toBeLessThan(members);
      expect(members).toBeLessThan(telemetry);
      expect(telemetry).toBeLessThan(feed);
      expect(feed).toBeLessThan(rightColumn);
      expect(rightColumn).toBeLessThan(details);
    },
  );

  test.each(EPISODE_PAGES)(
    "$name wires the member card to the right model, fields and routes",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.pagePath);

      expect(source).toContain(`modelType={${page.memberModel}}`);
      expect(source).toContain(`episodeIdField="${page.episodeIdField}"`);
      expect(source).toContain(`sortField="${page.memberSortField}"`);
      expect(source).toContain(`select={${page.memberSelect}}`);
      expect(source).toContain(`toRow={${page.memberRow}}`);
      expect(source).toContain(`title="${page.cardTitle}"`);
      expect(source).toContain(`RouteMap[${page.viewAllPage}] as Route`);
      expect(source).toContain(`RouteMap[${page.memberViewPage}] as Route`);
      expect(source).toContain("refreshToken={contentRefreshToken}");
    },
  );

  test.each(EPISODE_PAGES)(
    "$name refreshes children in place after changes",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.pagePath);

      expect(source).toContain("refreshToken={headerRefreshToken}");
      expect(source).toContain("refresher={detailsRefresher}");
      expect(source).toContain(
        `${page.feedElement} ${page.episodeIdField}={modelId} refreshToken={contentRefreshToken} />`,
      );
      expect(source).toContain("onSaveSuccess={() => {");
      expect(source).toContain("onActionComplete={async () => {");
    },
  );

  test.each(EPISODE_PAGES)(
    "$name details card is compact, single column and ends with the episode ID",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.pagePath);

      expect(source).toContain("showDetailsInNumberOfColumns: 1,");
      expect(source).toContain("style: DetailStyle.Compact,");

      const fieldsStart: number = indexOfOrFail(source, "fields: [ { field: {");
      const detailFields: string = source.slice(fieldsStart);
      const titles: Array<string> = Array.from(
        detailFields.matchAll(/title: "([^"]+)", fieldType: FieldType\./g),
      ).map((match: RegExpMatchArray) => {
        return match[1]!;
      });

      expect(titles).toEqual([
        "Episode Number",
        "Current State",
        "Episode Severity",
        page.countLabel === "Incidents" ? "Incident Count" : "Alert Count",
        "Grouping Rule",
        "Created By",
        "On-Call Duty Policies",
        "Created At",
        "Labels",
        "Episode ID",
      ]);

      // The title is the header's job now; the edit form still has it.
      expect(detailFields).not.toContain('title: "Episode Title", fieldType');
      expect(source).toContain(
        'title: "Episode Title", stepId: "episode-details"',
      );
      // No more hand-rolled SVG chip for the number.
      expect(source).not.toContain("<svg");
    },
  );

  test.each(EPISODE_PAGES)(
    "$name layout hands its side menu the id from the route on every render",
    (page: EpisodePage) => {
      const layout: string = readSquashed(
        page.pagePath.replace("Index.tsx", "Layout.tsx"),
      );
      const sideMenu: string = readSquashed(
        page.pagePath.replace("Index.tsx", "SideMenu.tsx"),
      );

      expect(layout).toContain("const { id } = useParams();");
      expect(layout).toContain(
        'const modelId: ObjectID = new ObjectID(id || "");',
      );
      expect(layout).toContain("sideMenu={<SideMenu modelId={modelId} />}");

      for (const hook of ["useState", "useEffect", "useMemo", "useRef"]) {
        expect(sideMenu).not.toContain(hook);
      }

      expect(
        countOccurrences(sideMenu, "{ modelId: props.modelId }"),
      ).toBeGreaterThan(3);
    },
  );

  test("only the incident episode page has episode roles", () => {
    const incident: string = readSquashed(EPISODE_PAGES[0]!.pagePath);
    const alert: string = readSquashed(EPISODE_PAGES[1]!.pagePath);

    const details: number = indexOfOrFail(incident, "<CardModelDetail<");
    const roles: number = indexOfOrFail(
      incident,
      "<IncidentEpisodeMemberRoleAssignment",
    );

    expect(details).toBeLessThan(roles);
    expect(alert).not.toContain("MemberRoleAssignment");
  });
});

describe("episode header", () => {
  test.each(EPISODE_PAGES)(
    "$name header loads its own data without a page loader flash",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.changeStatePath);

      expect(source).toContain("refreshToken?: number | undefined;");
      expect(source).toContain(
        'return <EpisodeHeaderSkeleton loadingText="Loading episode" />;',
      );
      expect(source).toContain(
        "return <EpisodeHeaderError message={error} onRetry={retryLoad} />;",
      );
      expect(source).toContain("await Promise.all([");
      expect(source).toContain("episodeNumberWithPrefix: true");
      expect(source).toContain("isPrivate: true");
      expect(source).toContain("resolvedAt: true");
      expect(source).toContain("limit: LIMIT_PER_PROJECT");
      expect(source).not.toContain("PageLoader");
    },
  );

  test.each(EPISODE_PAGES)(
    "$name header passes identifier, title, severity, privacy, duration and facts",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.changeStatePath);

      expect(source).toContain(
        'episode?.episodeNumberWithPrefix || (episode?.episodeNumber ? "#" + episode.episodeNumber : undefined)',
      );
      expect(source).toContain('title={episode?.title || "Untitled episode"}');
      expect(source).toContain("isPrivate={episode?.isPrivate === true}");
      expect(source).toContain(
        "durationStartsAt={timing.durationStartsAt} durationEndsAt={timing.durationEndsAt}",
      );
      /*
       * The pill runs to the CURRENT resolution; the stat bar's "Resolved in"
       * counts to the FIRST. Sharing that label made a reopened episode
       * contradict itself.
       */
      expect(source).toContain(
        'durationPrefix={ timing.durationStartsAt ? timing.isResolved ? "Lasted" : "Ongoing for" : undefined }',
      );
      expect(source).not.toContain("${timing.resolvedStateName} in");
      expect(source).toContain(page.startedAt);
      expect(source).toContain("facts={getEpisodeHeaderFacts({");
      expect(source).toContain(
        `memberNoun: "${page.memberModel.toLowerCase()}"`,
      );
      expect(source).toContain('moreMenuTitle="Move episode to"');
    },
  );
});

describe("episode feeds", () => {
  test.each(EPISODE_PAGES)(
    "$name feed reloads on refreshToken and uses the Actions menu",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.feedPath);

      expect(source).toContain("refreshToken?: number | undefined;");
      expect(source).toContain("refreshToken: props.refreshToken,");
      expect(source).toContain("<MoreMenu");
      expect(source).toContain("<span>Actions</span>");
      expect(source).toContain('text="Execute On-Call Policy"');
      expect(source).toContain('text="Add Private Note"');
      // The flat card buttons are gone; only the icon-only refresh remains.
      expect(source).not.toContain('title: "Execute On-Call Policy"');
      expect(source).not.toContain('title: "Add Private Note"');
      expect(source).toContain('title: "Refresh"');
      // Icons come from the exhaustive per-event-type table.
      expect(source).not.toContain("let icon: IconProp = IconProp.Circle;");
    },
  );

  test("the incident episode feed can add a public note", () => {
    const source: string = readSquashed(EPISODE_PAGES[0]!.feedPath);

    expect(source).toContain('text="Add Public Note"');
    expect(source).toContain("modelType={IncidentEpisodePublicNote}");
    expect(source).toContain(
      "model.incidentEpisodeId = props.incidentEpisodeId!;",
    );
    expect(source).toContain(
      "shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true",
    );
  });

  test("alert episodes have no public notes, so their feed offers none", () => {
    const source: string = readSquashed(EPISODE_PAGES[1]!.feedPath);

    expect(source).not.toContain("Add Public Note");
  });
});

describe("episode overview right column fits its width", () => {
  /*
   * The right column is about 300px wide. The details card's side-by-side
   * header squeezed its title beside "Edit Incident Episode" into a column
   * one word wide.
   */
  test.each(EPISODE_PAGES)(
    "$name details card stacks its header and says Edit",
    (page: EpisodePage) => {
      const source: string = readSquashed(page.pagePath);
      const rightColumn: string = source.slice(
        indexOfOrFail(source, '<div className="min-w-0 xl:col-span-1">'),
      );

      expect(rightColumn).toContain(
        'cardProps={{ title: "Episode Details", description: "Key facts about this episode.", headerLayout: "stacked", }} isEditable={true} editButtonText="Edit"',
      );
      expect(source).not.toContain("Here are more details for this episode.");
    },
  );

  test("the incident episode roles card stacks its header", () => {
    const incident: string = readSquashed(EPISODE_PAGES[0]!.pagePath);

    expect(incident).toContain(
      '<IncidentEpisodeMemberRoleAssignment incidentEpisodeId={modelId} headerLayout="stacked"',
    );
  });
});
