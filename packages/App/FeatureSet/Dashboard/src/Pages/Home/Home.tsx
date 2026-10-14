import ExploreProducts from "../../Components/Home/ExploreProducts";
import GettingStarted from "../../Components/Home/GettingStarted";
import HomeCommandBar, {
  getCurrentCreateActionGates,
} from "../../Components/Home/HomeCommandBar";
import { getHomeCounts } from "../../Components/Home/HomeOverviewData";
import NeedsAttention from "../../Components/Home/NeedsAttention";
import ProjectHealthCard from "../../Components/Home/ProjectHealthCard";
import ProjectResources from "../../Components/Home/ProjectResources";
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
import PageLoader from "Common/UI/Components/Loader/PageLoader";
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
 *   3. Is this project set up?               Getting Started, until it is.
 *   4. What exactly needs me?                The open work, by name.
 *   5. What is in this project?              Its resources, and what is
 *                                            coming up.
 *   6. What else can OneUptime do?           The product directory.
 *
 * The headline, the strip and the open-work list are drawn from ONE parallel
 * batch (UseHomeOverview / HomeOverviewData), so they always agree and the
 * page asks the database each question once. The other cards fetch their
 * own small reads beside it, never behind it.
 */

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
    return <PageLoader isVisible={true} />;
  }

  const refresh: () => void = (): void => {
    overview.refresh();
    setRefreshKey((key: number): number => {
      return key + 1;
    });
  };

  return (
    <div data-testid="home-overview" className="space-y-5">
      <HomeCommandBar projectId={currentProjectIdString} gates={gates} />

      <ProjectHealthCard
        counts={overview.data ? getHomeCounts(overview.data) : null}
        isLoading={overview.isLoading}
        isRefreshing={overview.isRefreshing}
        error={overview.error}
        loadedAt={overview.loadedAt}
        now={now}
        onRefresh={refresh}
      />

      <GettingStarted projectId={currentProjectId} className="!mb-0" />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <NeedsAttention
            data={overview.data}
            isLoading={overview.isLoading}
            now={now}
          />
        </div>
        <div className="min-w-0 space-y-5">
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
  );
};

export default Home;
