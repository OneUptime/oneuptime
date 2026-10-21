import AlertsTable from "../../Components/Alert/AlertsTable";
import useUnresolvedStateIds from "../../Components/EventView/useUnresolvedStateIds";
import ProjectUtil from "Common/UI/Utils/Project";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const AlertsPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  /*
   * Active: in a state above the project's resolved state. The resolved
   * state and any state placed after it are over (Common/Utils/ResolvedState).
   */
  const { unresolvedStateIds, error } = useUnresolvedStateIds("alert");

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!unresolvedStateIds) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <AlertsTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        currentAlertStateId: new Includes(
          unresolvedStateIds.map((stateId: ObjectID) => {
            return stateId.toString();
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
  );
};

export default AlertsPage;
