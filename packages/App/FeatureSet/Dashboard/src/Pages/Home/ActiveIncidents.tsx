import IncidentsTable from "../../Components/Incident/IncidentsTable";
import IncidentStateUtil from "../../Utils/IncidentState";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Every open incident in the project, in the full incidents table. Home used
 * to be this table; Home is now the project's overview, which lists the
 * newest few and links here for the rest, the way it links to Active Alerts.
 */
const ActiveIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
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
    <div>
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
          emptyState={{
            isAllClear: true,
            title: "No active incidents",
            description: "Nice work! Every incident is resolved.",
          }}
          title="Active Incidents"
          description="Incidents that are not resolved yet: problems affecting your users right now. View an incident to see who is responding and to post updates."
        />
      )}
    </div>
  );
};

export default ActiveIncidents;
