import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Dashboard playlists' wiring (issue #5235): the API that keeps them, the
 * Dashboards side menu's Playlists, the pages' routes - the player's
 * outside the Dashboards layout, so nothing of the page is drawn around a
 * screen's dashboards - the breadcrumbs, the search, and the player's
 * boards drawn as the dashboards' editors saved them.
 *
 * The behaviour is tested where it lives (Common/Tests/App/Dashboard: the
 * player, its rounds and keys, the forms' field, the playback board; the
 * offline browser suite in E2E/DashboardPlaylists). What is left is each
 * piece handed to the next, and a break there leaves no trace: a page
 * nobody can reach, or a player drawn inside the side menu. So the sources
 * are read, comments stripped and whitespace squashed first, so a comment
 * cannot pass a test and prettier re-wrapping a line cannot fail one.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const DASHBOARD_SRC: string = "App/FeatureSet/Dashboard/src";

function withoutBlockComments(code: string): string {
  const parts: Array<string> = [];
  let at: number = 0;
  let open: number = code.indexOf("/*");

  while (open >= 0) {
    const close: number = code.indexOf("*/", open + 2);

    if (close < 0) {
      break;
    }

    parts.push(code.slice(at, open));
    at = close + 2;
    open = code.indexOf("/*", at);
  }

  parts.push(code.slice(at));

  return parts.join(" ");
}

function readCode(relative: string): string {
  return withoutBlockComments(
    fs.readFileSync(path.join(PACKAGES, relative), "utf8"),
  )
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

/*
 * RouteMap's addresses hold "/*" (`/monitors/*`), which a comment strip
 * would read as a comment's start: it is read with whitespace squashed only.
 */
function readSquashed(relative: string): string {
  return fs
    .readFileSync(path.join(PACKAGES, relative), "utf8")
    .replace(/\s+/g, " ");
}

function indexOfOnce(code: string, text: string): number {
  const first: number = code.indexOf(text);

  expect(first).toBeGreaterThan(-1);
  expect(code.indexOf(text, first + 1)).toBe(-1);

  return first;
}

describe("the API", () => {
  test("keeps playlists through their own service, registered beside the dashboards'", () => {
    const api: string = readCode("App/FeatureSet/BaseAPI/Index.ts");

    expect(api).toContain(
      'import DashboardPlaylist from "Common/Models/DatabaseModels/DashboardPlaylist";',
    );
    expect(api).toContain(
      "new BaseAPI<DashboardPlaylist, DashboardPlaylistServiceType>( DashboardPlaylist, DashboardPlaylistService, ).getRouter()",
    );
  });

  test("the model and the service are in their indexes, once", () => {
    indexOfOnce(
      readCode("Common/Models/DatabaseModels/Index.ts"),
      "DashboardPlaylist,",
    );
    indexOfOnce(
      readCode("Common/Server/Services/Index.ts"),
      "DashboardPlaylistService,",
    );
  });
});

describe("the routes", () => {
  const routeMap: string = readSquashed(`${DASHBOARD_SRC}/Utils/RouteMap.ts`);
  const routes: string = readCode(
    `${DASHBOARD_SRC}/Routes/DashboardRoutes.tsx`,
  );

  test("Playlists, a playlist, and a playlist playing, each at its own address under Dashboards", () => {
    expect(routeMap).toContain('[PageMap.DASHBOARD_PLAYLISTS]: "playlists",');
    expect(routeMap).toContain(
      "[PageMap.DASHBOARD_PLAYLIST_VIEW]: `playlists/${RouteParams.ModelID}`,",
    );
    expect(routeMap).toContain(
      "[PageMap.DASHBOARD_PLAYLIST_PLAY]: `playlists/${RouteParams.ModelID}/play`,",
    );

    for (const page of [
      "DASHBOARD_PLAYLISTS",
      "DASHBOARD_PLAYLIST_VIEW",
      "DASHBOARD_PLAYLIST_PLAY",
    ]) {
      expect(routeMap).toContain(
        `[PageMap.${page}]: new Route( \`/dashboard/\${RouteParams.ProjectID}/dashboards/\${ DashboardsRoutePath[PageMap.${page}] }\`, ),`,
      );
    }
  });

  test("the list and a playlist's page are inside the Dashboards layout, ahead of the dashboard view's :id", () => {
    const layoutStart: number = indexOfOnce(
      routes,
      '<PageRoute path="/" element={<DashboardsLayout {...props} />}>',
    );
    const layoutEnd: number = indexOfOnce(
      routes,
      "mountPageKey: PageMap.DASHBOARDS_ROOT, })} </PageRoute>",
    );
    const list: number = indexOfOnce(
      routes,
      'path={DashboardsRoutePath[PageMap.DASHBOARD_PLAYLISTS] || ""} element={ <DashboardPlaylists {...props} pageRoute={RouteMap[PageMap.DASHBOARD_PLAYLISTS] as Route} />',
    );
    const view: number = indexOfOnce(
      routes,
      'path={DashboardsRoutePath[PageMap.DASHBOARD_PLAYLIST_VIEW] || ""} element={ <DashboardPlaylistView {...props} pageRoute={RouteMap[PageMap.DASHBOARD_PLAYLIST_VIEW] as Route} />',
    );

    expect(list).toBeGreaterThan(layoutStart);
    expect(list).toBeLessThan(layoutEnd);
    expect(view).toBeGreaterThan(layoutStart);
    expect(view).toBeLessThan(layoutEnd);
  });

  test("the player is outside the layout - no side menu, no breadcrumbs - and ahead of the dashboard view's route", () => {
    const layoutEnd: number = indexOfOnce(
      routes,
      "mountPageKey: PageMap.DASHBOARDS_ROOT, })} </PageRoute>",
    );
    const play: number = indexOfOnce(
      routes,
      'path={DashboardsRoutePath[PageMap.DASHBOARD_PLAYLIST_PLAY] || ""} element={ <DashboardPlaylistPlay {...props} pageRoute={RouteMap[PageMap.DASHBOARD_PLAYLIST_PLAY] as Route} />',
    );
    const dashboardView: number = indexOfOnce(
      routes,
      'path={DashboardsRoutePath[PageMap.DASHBOARD_VIEW] || ""} element={<DashboardViewLayout {...props} />}',
    );

    expect(play).toBeGreaterThan(layoutEnd);
    expect(play).toBeLessThan(dashboardView);
  });

  test("the pages are the playlist ones", () => {
    expect(routes).toContain(
      'import DashboardPlaylists from "../Pages/Dashboards/Playlists/Playlists";',
    );
    expect(routes).toContain(
      'import DashboardPlaylistView from "../Pages/Dashboards/Playlists/PlaylistView";',
    );
    expect(routes).toContain(
      'import DashboardPlaylistPlay from "../Pages/Dashboards/Playlists/PlaylistPlay";',
    );
  });
});

describe("finding them", () => {
  test("Dashboards' side menu has Playlists under Dashboards, lit on a playlist's page too", () => {
    const menu: string = readCode(
      `${DASHBOARD_SRC}/Pages/Dashboards/SideMenu.tsx`,
    );
    const dashboards: number = indexOfOnce(
      menu,
      'title: "Dashboards", to: RouteUtil.populateRouteParams( RouteMap[PageMap.DASHBOARDS] as Route, ), }, icon: IconProp.Window,',
    );
    const playlists: number = indexOfOnce(
      menu,
      'title: "Playlists", to: RouteUtil.populateRouteParams( RouteMap[PageMap.DASHBOARD_PLAYLISTS] as Route, ), }, activeRoute: Navigation.isOnThisPage(playlistViewRoute) ? playlistViewRoute : undefined, icon: IconProp.QueueList,',
    );
    const settings: number = indexOfOnce(menu, 'title: "Settings",');

    expect(playlists).toBeGreaterThan(dashboards);
    expect(playlists).toBeLessThan(settings);
    expect(menu).toContain(
      "const playlistViewRoute: Route = RouteUtil.populateRouteParams( RouteMap[PageMap.DASHBOARD_PLAYLIST_VIEW] as Route, );",
    );
  });

  test("the breadcrumbs name the list and a playlist's page", () => {
    const crumbs: string = readCode(
      `${DASHBOARD_SRC}/Utils/Breadcrumbs/DashboardBreadCrumbs.ts`,
    );

    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.DASHBOARD_PLAYLISTS, [ "Project", "Dashboards", "Playlists", ])',
    );
    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.DASHBOARD_PLAYLIST_VIEW, [ "Project", "Dashboards", "Playlists", "View Playlist", ])',
    );
    // The player has none: nothing is drawn around it.
    expect(crumbs).not.toContain("PageMap.DASHBOARD_PLAYLIST_PLAY");
  });

  test("the search finds Playlists by the words a NOC uses", () => {
    const search: string = readCode(
      `${DASHBOARD_SRC}/Components/CommandPalette/PageSearchIndex.ts`,
    );

    expect(search).toContain(
      'page: PageMap.DASHBOARD_PLAYLISTS, title: "Playlists", icon: IconProp.QueueList, keywords: [ "noc", "wallboard", "tv", "rotate", "slideshow", "kiosk", ],',
    );
  });
});

describe("the player", () => {
  test("the play page plays the address's playlist, and Exit goes back to the playlist's page", () => {
    const play: string = readCode(
      `${DASHBOARD_SRC}/Pages/Dashboards/Playlists/PlaylistPlay.tsx`,
    );

    expect(play).toContain("const { id } = useParams();");
    expect(play).toContain(
      'const playlistId: ObjectID = new ObjectID(id || "");',
    );
    expect(play).toContain(
      "onExit={() => { Navigation.navigate( RouteUtil.populateRouteParams( RouteMap[PageMap.DASHBOARD_PLAYLIST_VIEW] as Route, { modelId: playlistId }, ), ); }}",
    );
  });

  test("draws each dashboard with the real viewer, as a playlist's turn", () => {
    const player: string = readCode(
      `${DASHBOARD_SRC}/Components/Dashboard/Playlist/PlaylistPlayer.tsx`,
    );

    expect(player).toContain('import DashboardViewer from "../DashboardView";');
    expect(player).toContain(
      "<DashboardViewer dashboardId={new ObjectID(entry.dashboardId)} isPlayback={true} />",
    );
    // A test hands in its own stand-in; the page never does.
    expect(player).toContain(
      "props.renderDashboard || renderPlaylistDashboard;",
    );
  });

  test("the page under it does not scroll, and the screen is kept awake", () => {
    const player: string = readCode(
      `${DASHBOARD_SRC}/Components/Dashboard/Playlist/PlaylistPlayer.tsx`,
    );

    expect(player).toContain("usePageScrollLock(true);");
    expect(player).toContain("useScreenWakeLock(true);");
  });

  test("a playlist's turn has no toolbar and no editing, and opens on the saved defaults", () => {
    const view: string = readCode(
      `${DASHBOARD_SRC}/Components/Dashboard/DashboardView.tsx`,
    );

    expect(view).toContain(
      "const canEditDashboard: boolean = editGate.isAllowed && !isPlayback;",
    );
    expect(view).toContain("savedDefaultsOnly: isPlayback,");
    expect(view).toContain("if (isPlayback) { return (");
  });
});

describe("the pages", () => {
  test("Play is each row's first button on the list, and the playlist page's own", () => {
    const list: string = readCode(
      `${DASHBOARD_SRC}/Pages/Dashboards/Playlists/Playlists.tsx`,
    );
    const page: string = readCode(
      `${DASHBOARD_SRC}/Pages/Dashboards/Playlists/PlaylistView.tsx`,
    );

    expect(list).toContain(
      'title: "Play", icon: IconProp.Play, buttonStyleType: ButtonStyleType.NORMAL, placement: ActionButtonPlacement.Primary,',
    );
    expect(page).toContain(
      'buttons: [ { title: "Play", icon: IconProp.Play, buttonStyle: ButtonStyleType.PRIMARY,',
    );
  });

  test("Create and Edit use the same three fields", () => {
    const list: string = readCode(
      `${DASHBOARD_SRC}/Pages/Dashboards/Playlists/Playlists.tsx`,
    );
    const page: string = readCode(
      `${DASHBOARD_SRC}/Pages/Dashboards/Playlists/PlaylistView.tsx`,
    );

    expect(list).toContain(
      "formFields={getPlaylistFormFields({ language: translator.language })}",
    );
    expect(page).toContain(
      "formFields={getPlaylistFormFields({ language: translator.language, currentIntervalInSeconds: intervalInSeconds, })}",
    );
  });

  test("a deleted playlist goes back to the list", () => {
    const page: string = readCode(
      `${DASHBOARD_SRC}/Pages/Dashboards/Playlists/PlaylistView.tsx`,
    );

    expect(page).toContain(
      "<ModelDelete modelType={DashboardPlaylist} modelId={modelId} onDeleteSuccess={() => { Navigation.navigate( RouteUtil.populateRouteParams( RouteMap[PageMap.DASHBOARD_PLAYLISTS] as Route, ), ); }} />",
    );
  });
});
