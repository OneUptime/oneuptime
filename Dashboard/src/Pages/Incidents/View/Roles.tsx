import IncidentMemberRoleAssignment from "../../../Components/Incident/IncidentMemberRoleAssignment";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IncidentRoles: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <IncidentMemberRoleAssignment incidentId={modelId} />
    </Fragment>
  );
};

export default IncidentRoles;
