import IncidentsTable from "../../Components/Incident/IncidentsTable";
import GettingStarted from "../../Components/Home/GettingStarted";
import OverviewStats from "../../Components/Home/OverviewStats";
import IncidentStateUtil from "../../Utils/IncidentState";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import UiAnalytics from "Common/UI/Utils/Analytics";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps extends PageComponentProps {
  isLoadingProjects: boolean;
  projects: Array<Project>;
}

const Home: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [unresolvedIncidentStates, setUnresolvedIncidentStates] = useState<
    Array<IncidentState>
  >([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  /*
   * ProjectUtil.getCurrentProjectId() constructs a fresh ObjectID on every
   * call, so its identity churns on every render. GettingStarted and
   * OverviewStats key their fetch effects on this id — memoize it on its
   * string VALUE so a Home re-render (loading flags flipping, projects
   * reloading) never re-fires their count requests.
   */
  const currentProjectIdString: string | null =
    ProjectUtil.getCurrentProjectId()?.toString() || null;

  const currentProjectId: ObjectID | null = useMemo((): ObjectID | null => {
    return currentProjectIdString ? new ObjectID(currentProjectIdString) : null;
  }, [currentProjectIdString]);

  const fetchIncidentStates: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      setUnresolvedIncidentStates(
        await IncidentStateUtil.getUnresolvedIncidentStates(
          ProjectUtil.getCurrentProjectId()!,
        ),
      );
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.isLoadingProjects && props.projects.length === 0) {
      Navigation.navigate(RouteMap[PageMap.WELCOME] as Route);
      return;
    }
    UiAnalytics.capture("dashboard/home", {
      projectId: ProjectUtil.getCurrentProjectId()!,
    });

    fetchIncidentStates().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.projects]);

  return (
    <Page
      title={"Home"}
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
      ]}
      sideMenu={
        <DashboardSideMenu project={props.currentProject || undefined} />
      }
    >
      <div>
        {/*
         * GettingStarted and OverviewStats only need the project id and manage
         * their own loading states — gating them behind the incident-states
         * fetch would serialize the page's requests for nothing. Only the
         * incidents table below actually needs the unresolved states.
         */}
        {currentProjectId && (
          <div>
            <GettingStarted projectId={currentProjectId} />

            <OverviewStats projectId={currentProjectId} />
          </div>
        )}

        {isLoading && <PageLoader isVisible={true} />}
        {error && <ErrorMessage message={error} />}

        {!isLoading &&
          !error &&
          currentProjectId &&
          unresolvedIncidentStates.length > 0 && (
            <IncidentsTable
              query={{
                projectId: currentProjectId,
                currentIncidentStateId: new Includes(
                  unresolvedIncidentStates.map((state: IncidentState) => {
                    return state.id!;
                  }),
                ),
              }}
              noItemsMessage="Nice work! No Active Incidents so far."
              title="Active Incidents"
              description="Here is a list of all the Active Incidents for this project."
            />
          )}
      </div>
    </Page>
  );
};

export default Home;
