import ExploreProducts from "../../Components/Home/ExploreProducts";
import GettingStarted, {
  WelcomeCardView,
} from "../../Components/Home/GettingStarted";
import HomeCommandBar, {
  getCurrentCreateActionGates,
} from "../../Components/Home/HomeCommandBar";
import {
  HomeCounts,
  getHomeCounts,
} from "../../Components/Home/HomeOverviewData";
import NeedsAttention from "../../Components/Home/NeedsAttention";
import {
  ProjectHealthKind,
  getProjectHealth,
} from "../../Components/Home/ProjectHealth";
import ProjectHealthCard from "../../Components/Home/ProjectHealthCard";
import ProjectResources from "../../Components/Home/ProjectResources";
import HiddenProductsWithData from "../../Components/ProjectProducts/HiddenProductsWithData";
import ServerSetupCard from "../../Components/ServerSetup/ServerSetupCard";
import SetupCheckInCard from "../../Components/Feedback/SetupCheckInCard";
import useSetupHealthSummary from "../../Components/SetupHealth/UseSetupHealthSummary";
import UpcomingMaintenance from "../../Components/Home/UpcomingMaintenance";
import useHomeOverview, {
  UseHomeOverviewResult,
} from "../../Components/Home/UseHomeOverview";
import { PaletteCreateActionGates } from "../../Components/CommandPalette/DashboardCommandPaletteHelpers";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import UiAnalytics from "Common/UI/Utils/Analytics";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useClockTick from "Common/UI/Utils/UseClockTick";
import Project from "Common/Models/DatabaseModels/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Home: the first page of a project, and the one people come back to.
 *
 * It answers, top to bottom:
 *   1. Can I find or start what I came for?  Search and the create actions.
 *   2. Is anything wrong?                    The health headline and strip.
 *   3. Is this project set up?               Getting Started, until it is;
 *                                            then what else to set up.
 *   4. What exactly needs me?                The open work, by name.
 *   5. What is in this project?              Its resources, and what is
 *                                            coming up.
 *   6. What else can OneUptime do?           The product directory.
 *
 * Except while a new project's quickstart shows (#8897): the question
 * "What do you want to do first?", then the steps its goals bring. Then
 * Home is the quickstart and nothing else - no search bar, no row of
 * zeros, no empty lists - so a new person meets one thing to do, not
 * eight. Only what cannot wait shows above it: an incident or anything
 * else that needs someone (the health card), and a server that is not set
 * up, to its admin. Hiding the quickstart, or finishing it, brings the
 * rest of Home back, and the line left behind shows it again.
 *
 * The headline, the strip and the open-work list are drawn from ONE parallel
 * batch (UseHomeOverview / HomeOverviewData), so they always agree and the
 * page asks the database each question once. The other cards fetch their
 * own small reads beside it, never behind it: while the quickstart's answer
 * is read, they are drawn out of sight, already reading.
 */

/*
 * Steps 4 and 5 share a row from xl up: the open work in two thirds, the
 * project's resources with what is coming up in the last third. Below xl
 * the row is one column and every card is as tall as what it holds.
 *
 * The two sides are rarely the same height - "Nothing needs your attention"
 * beside seven resources, or sixteen open problems beside them - and a side
 * that ended early left a gap of bare page under it. So the row ends on one
 * line: the grid stretches both columns to the row's height (its default,
 * align-items: stretch - never items-start here), each column stacks its
 * cards, and the LAST card in each column takes the height the row has left
 * (Card's fillHeight draws its frame to the bottom). Which card is last
 * depends on the data - Upcoming maintenance is left out when nothing is
 * scheduled - so the rule is the column's, not a card's.
 */
const HOME_ROW_COLUMN_CLASS_NAME: string =
  "flex min-w-0 flex-col gap-5 [&>*:last-child]:flex-1";

export const HOME_ROW_CLASS_NAME: string =
  "grid grid-cols-1 gap-5 xl:grid-cols-3";

export const HOME_ROW_MAIN_COLUMN_CLASS_NAME: string = `${HOME_ROW_COLUMN_CLASS_NAME} xl:col-span-2`;

export const HOME_ROW_SIDE_COLUMN_CLASS_NAME: string =
  HOME_ROW_COLUMN_CLASS_NAME;

// What the quickstart said it draws (GettingStarted's onViewChange).
export interface HomeWelcome {
  view: WelcomeCardView | null;
  isTakingHome: boolean;
  /*
   * The Welcome card offers to create the first monitor: its step is left,
   * on the checklist or among what else to set up (#7759).
   */
  offersFirstMonitor: boolean;
}

/*
 * Whether the health card's headline ends on "Create your first monitor"
 * (#7759): for whoever may create a monitor, unless the Welcome card
 * already offers that step - one start for one job on a page, never two
 * that lead to the same guided setup.
 */
export const isCreateFirstMonitorShown: (data: {
  canCreateMonitor: boolean;
  welcome: HomeWelcome;
}) => boolean = (data: {
  canCreateMonitor: boolean;
  welcome: HomeWelcome;
}): boolean => {
  return data.canCreateMonitor && !data.welcome.offersFirstMonitor;
};

// What Home is drawing.
export enum HomeMode {
  // The quickstart's answer is not read yet: nothing is decided.
  Deciding = "deciding",
  // A new project's quickstart, the question or its steps: Home is that.
  Quickstart = "quickstart",
  // Everything else: the overview, top to bottom.
  Overview = "overview",
}

/*
 * Which page Home is, by what the quickstart says it draws: nothing decided
 * until its answer is read, the quickstart alone while it is a new
 * project's (GettingStarted's isQuickstartTakingHome), the overview
 * otherwise - with the checklist in it when an older project has one.
 */
export const getHomeMode: (welcome: HomeWelcome) => HomeMode = (
  welcome: HomeWelcome,
): HomeMode => {
  if (welcome.view === null) {
    return HomeMode.Deciding;
  }

  return welcome.isTakingHome ? HomeMode.Quickstart : HomeMode.Overview;
};

/*
 * Whether the quickstart makes room for the health card above it: an open
 * incident, or anything else that needs someone - an alert, a monitor that
 * is not operational, an SLO at risk. A first monitor that goes down while
 * its project is still being set up is said at the top, as on any Home.
 * Nothing open, maintenance in progress or nothing monitored yet is the
 * quickstart's to say.
 */
export const needsSomeoneDuringQuickstart: (
  counts: HomeCounts | null,
) => boolean = (counts: HomeCounts | null): boolean => {
  if (!counts) {
    return false;
  }

  const kind: ProjectHealthKind = getProjectHealth(counts).kind;

  return (
    kind === ProjectHealthKind.Incidents ||
    kind === ProjectHealthKind.NeedsAttention
  );
};

export interface ComponentProps extends PageComponentProps {
  isLoadingProjects: boolean;
  projects: Array<Project>;
}

const Home: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * ProjectUtil.getCurrentProjectId() constructs a fresh ObjectID on every
   * call, so its identity churns on every render. The widgets key their
   * fetch effects on this id - memoize it on its string VALUE so a Home
   * re-render (the clock ticking, projects reloading) never re-fires their
   * requests.
   */
  const currentProjectIdString: string | null =
    ProjectUtil.getCurrentProjectId()?.toString() || null;

  const currentProjectId: ObjectID | null = useMemo((): ObjectID | null => {
    return currentProjectIdString ? new ObjectID(currentProjectIdString) : null;
  }, [currentProjectIdString]);

  const overview: UseHomeOverviewResult = useHomeOverview(currentProjectId);

  // Re-read once a minute, so "2 minutes ago" does not stay "just now".
  const now: Date = useClockTick(false);

  /*
   * Bumped by Refresh, so the cards that read on their own count again
   * along with the batch.
   */
  const [refreshKey, setRefreshKey] = useState<number>(0);

  /*
   * What the quickstart draws (GettingStarted reads it, and says): null
   * until its answer is read, for each project in turn.
   */
  const [welcome, setWelcome] = useState<HomeWelcome>({
    view: null,
    isTakingHome: false,
    offersFirstMonitor: false,
  });

  /*
   * How many things in the setup need a look (Setup health, #6812): read
   * beside the batch, and said at the end of "Needs attention".
   */
  const setupHealthCount: number | null = useSetupHealthSummary(
    currentProjectId,
    refreshKey,
  );

  /*
   * What the user may create, by the command palette's rule. Read on every
   * render: the permission snapshot arrives with the first API response, and
   * the batch landing re-renders the page with it.
   */
  const gates: PaletteCreateActionGates = getCurrentCreateActionGates();

  useEffect(() => {
    if (!props.isLoadingProjects && props.projects.length === 0) {
      Navigation.navigate(RouteMap[PageMap.WELCOME] as Route);
      return;
    }

    UiAnalytics.capture("dashboard/home", {
      projectId: ProjectUtil.getCurrentProjectId()!,
    });
  }, [props.projects]);

  if (!currentProjectId || !currentProjectIdString) {
    return <PageSkeleton />;
  }

  const refresh: () => void = (): void => {
    overview.refresh();
    setRefreshKey((key: number): number => {
      return key + 1;
    });
  };

  const mode: HomeMode = getHomeMode(welcome);
  const counts: HomeCounts | null = overview.data
    ? getHomeCounts(overview.data)
    : null;

  const commandBar: ReactElement = (
    <HomeCommandBar projectId={currentProjectIdString} gates={gates} />
  );

  const healthCard: ReactElement = (
    <ProjectHealthCard
      counts={counts}
      isLoading={overview.isLoading}
      isRefreshing={overview.isRefreshing}
      error={overview.error}
      loadedAt={overview.loadedAt}
      now={now}
      onRefresh={refresh}
      canCreateMonitor={isCreateFirstMonitorShown({
        canCreateMonitor: gates.canCreateMonitor,
        welcome: welcome,
      })}
    />
  );

  return (
    <div
      data-testid="home-overview"
      data-home-mode={mode}
      className="space-y-5"
    >
      {mode === HomeMode.Deciding ? (
        <div
          data-testid="home-deciding"
          aria-hidden="true"
          className="h-64 animate-pulse rounded-2xl border border-gray-200 bg-white"
        ></div>
      ) : (
        <></>
      )}

      {mode === HomeMode.Quickstart ? (
        needsSomeoneDuringQuickstart(counts) ? (
          healthCard
        ) : (
          <></>
        )
      ) : (
        /*
         * Drawn out of sight while Home decides, so its reads run beside
         * the quickstart's instead of behind it.
         */
        <div hidden={mode === HomeMode.Deciding} className="space-y-5">
          {commandBar}
          {healthCard}
        </div>
      )}

      {/*
       * Is this server set up? For its master admins only, while email,
       * HTTPS or the choice about sign-ups is still open. It is the one
       * place Home asks for the server's setup: the Welcome checklist has
       * no step of its own for the server's email (#7018).
       */}
      <ServerSetupCard />

      <GettingStarted
        projectId={currentProjectId}
        className="!mb-0"
        onViewChange={(
          view: WelcomeCardView | null,
          isTakingHome: boolean,
          offersFirstMonitor: boolean,
        ) => {
          setWelcome({
            view: view,
            isTakingHome: isTakingHome,
            offersFirstMonitor: offersFirstMonitor,
          });
        }}
      />

      {mode === HomeMode.Quickstart ? (
        <></>
      ) : (
        <div hidden={mode === HomeMode.Deciding} className="space-y-5">
          {/*
           * Is OneUptime set up the way you wanted? Once, for the project's
           * creator in its first weeks, never while something is open
           * (#6832). It asks the server whether to ask, which counts as
           * asked, so it waits until Home has decided to show it.
           */}
          {mode === HomeMode.Overview ? (
            <SetupCheckInCard
              projectId={currentProjectIdString}
              isInIncident={
                overview.data
                  ? overview.data.activeIncidents.count +
                      overview.data.activeAlerts.count >
                    0
                  : null
              }
              setupHealthCount={setupHealthCount}
            />
          ) : (
            <></>
          )}

          {/*
           * A product the project hides that started receiving data (#6814):
           * one line, for whoever may choose the project's products.
           */}
          <HiddenProductsWithData />

          <div data-testid="home-overview-row" className={HOME_ROW_CLASS_NAME}>
            <div
              data-testid="home-overview-row-main"
              className={HOME_ROW_MAIN_COLUMN_CLASS_NAME}
            >
              <NeedsAttention
                data={overview.data}
                isLoading={overview.isLoading}
                now={now}
                setupHealthCount={setupHealthCount}
              />
            </div>
            <div
              data-testid="home-overview-row-side"
              className={HOME_ROW_SIDE_COLUMN_CLASS_NAME}
            >
              <ProjectResources
                projectId={currentProjectId}
                totalMonitors={
                  overview.data
                    ? overview.data.totalMonitors
                    : overview.isLoading
                      ? null
                      : undefined
                }
                totalSlos={
                  overview.data
                    ? overview.data.totalSlos
                    : overview.isLoading
                      ? null
                      : undefined
                }
                refreshKey={refreshKey}
              />
              <UpcomingMaintenance
                projectId={currentProjectId}
                now={now}
                refreshKey={refreshKey}
              />
            </div>
          </div>

          <ExploreProducts projectId={currentProjectIdString} />
        </div>
      )}
    </div>
  );
};

export default Home;
