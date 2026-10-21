import AlertsTable from "../../Components/Alert/AlertsTable";
import AlertStateUtil from "../../Utils/AlertState";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const Home: FunctionComponent<PageComponentProps> = (): ReactElement => {
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
    <div>
      {isLoading && <PageLoader isVisible={true} />}
      {error && <ErrorMessage message={error} />}

      {!isLoading && !error && unresolvedAlertStates.length > 0 && (
        <AlertsTable
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          }}
          emptyState={{
            isAllClear: true,
            title: "No active alerts",
            description: "Nice work! Every alert is resolved.",
          }}
          title="Active Alerts"
          description="Alerts that are not resolved yet: problems your team should look into before users notice. View an alert to acknowledge or resolve it."
        />
      )}
    </div>
  );
};

export default Home;
