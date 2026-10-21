import IncidentsTable from "../../Components/Incident/IncidentsTable";
import useUnresolvedStateIds from "../../Components/EventView/useUnresolvedStateIds";
import ProjectUtil from "Common/UI/Utils/Project";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Active: in a state above the project's resolved state. The resolved
   * state and any state placed after it are over (Common/Utils/ResolvedState).
   */
  const { unresolvedStateIds, error } = useUnresolvedStateIds("incident");

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!unresolvedStateIds) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <IncidentsTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        currentIncidentStateId: new Includes(
          unresolvedStateIds.map((stateId: ObjectID) => {
            return stateId.toString();
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
  );
};

export default IncidentsPage;
