import IncidentsTable from "../../Components/Incident/IncidentsTable";
import IncidentStateUtil from "../../Utils/IncidentState";
import DashboardNavigation from "../../Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import Page from "CommonUI/src/Components/Page/Page";
import API from "CommonUI/src/Utils/API/API";
import UiAnalytics from "CommonUI/src/Utils/Analytics";
import Navigation from "CommonUI/src/Utils/Navigation";
import IncidentState from "Model/Models/IncidentState";
import Project from "Model/Models/Project";
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
          DashboardNavigation.getProjectId()!,
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
      projectId: DashboardNavigation.getProjectId()?.toString(),
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
        {isLoading && <PageLoader isVisible={true} />}
        {error && <ErrorMessage error={error} />}

        {!isLoading && !error && unresolvedIncidentStates.length > 0 && (
          <IncidentsTable
            viewPageRoute={RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS] as Route,
            )}
            query={{
              projectId: DashboardNavigation.getProjectId()?.toString(),
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
