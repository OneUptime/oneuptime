import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import OnCallDutyTimeLogTable from "../../Components/OnCallPolicy/TimeLog/OnCallDutyTimeLogTable";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";

const Dashboard: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <ErrorMessage message={"Project not found."} />;
  }

  return <OnCallDutyTimeLogTable projectId={projectId} />;
};

export default Dashboard;
