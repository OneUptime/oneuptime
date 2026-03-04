import IncidentEpisodesTable from "../../Components/IncidentEpisode/IncidentEpisodesTable";
import IncidentStateUtil from "../../Utils/IncidentState";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const ActiveIncidentEpisodes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
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
    fetchIncidentStates().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

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
        {
          title: "Active Incident Episodes",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOME_ACTIVE_INCIDENT_EPISODES] as Route,
          ),
        },
      ]}
      sideMenu={
        <DashboardSideMenu project={props.currentProject || undefined} />
      }
    >
      <div>
        {isLoading && <PageLoader isVisible={true} />}
        {error && <ErrorMessage message={error} />}

        {!isLoading && !error && unresolvedIncidentStates.length > 0 && (
          <IncidentEpisodesTable
            query={{
              projectId: ProjectUtil.getCurrentProjectId()!,
              currentIncidentStateId: new Includes(
                unresolvedIncidentStates.map((state: IncidentState) => {
                  return state.id!;
                }),
              ),
            }}
            noItemsMessage="Nice work! No Active Incident Episodes so far."
            title="Active Incident Episodes"
            description="Here is a list of all the Active Incident Episodes for this project."
          />
        )}
      </div>
    </Page>
  );
};

export default ActiveIncidentEpisodes;
