import IncidentsTable from "../../Components/Incident/IncidentsTable";
import IncidentStateUtil from "../../Utils/IncidentState";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
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
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-gray-900">Welcome back</h1>
          {props.currentProject?.name ? (
            <p className="mt-1 text-sm text-gray-500">
              {`Here's what's happening across ${props.currentProject.name} right now.`}
            </p>
          ) : null}
        </div>
        {isLoading && <PageLoader isVisible={true} />}
        {error && <ErrorMessage message={error} />}

        {!isLoading && !error && unresolvedIncidentStates.length > 0 && (
          <IncidentsTable
            query={{
              projectId: ProjectUtil.getCurrentProjectId()!,
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

        {!isLoading && !error && unresolvedIncidentStates.length === 0 && (
          <EmptyState
            id="home-all-clear"
            icon={IconProp.CheckCircle}
            title="All clear"
            description="No active incidents right now. We'll surface anything that needs your attention here."
            showSolidBackground={true}
          />
        )}
      </div>
    </Page>
  );
};

export default Home;
