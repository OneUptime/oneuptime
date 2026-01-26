import AlertEpisodesTable from "../../Components/AlertEpisode/AlertEpisodesTable";
import AlertStateUtil from "../../Utils/AlertState";
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
import AlertState from "Common/Models/DatabaseModels/AlertState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const ActiveEpisodes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [unresolvedAlertStates, setUnresolvedAlertStates] = useState<
    Array<AlertState>
  >([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchAlertStates: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      setUnresolvedAlertStates(
        await AlertStateUtil.getUnresolvedAlertStates(
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
    fetchAlertStates().catch((err: Error) => {
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
          title: "Active Episodes",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOME_ACTIVE_EPISODES] as Route,
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

        {!isLoading && !error && unresolvedAlertStates.length > 0 && (
          <AlertEpisodesTable
            query={{
              projectId: ProjectUtil.getCurrentProjectId()!,
              currentAlertStateId: new Includes(
                unresolvedAlertStates.map((state: AlertState) => {
                  return state.id!;
                }),
              ),
            }}
            noItemsMessage="Nice work! No Active Episodes so far."
            title="Active Episodes"
            description="Here is a list of all the Active Alert Episodes for this project."
          />
        )}
      </div>
    </Page>
  );
};

export default ActiveEpisodes;
