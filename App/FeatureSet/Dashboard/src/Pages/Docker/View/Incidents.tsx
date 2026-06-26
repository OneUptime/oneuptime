import Includes from "Common/Types/BaseDatabase/Includes";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Incident from "Common/Models/DatabaseModels/Incident";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";

const DockerHostIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Incident> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.dockerHosts = new Includes([modelId]);
  }

  return (
    <Fragment>
      <IncidentsTable query={query} />
    </Fragment>
  );
};

export default DockerHostIncidents;
