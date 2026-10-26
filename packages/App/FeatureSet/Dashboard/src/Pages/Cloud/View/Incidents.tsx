import Includes from "Common/Types/BaseDatabase/Includes";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import { CreateFromRecordKind } from "../../../Components/CreateFromRecord/CreateFromRecord";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Incident from "Common/Models/DatabaseModels/Incident";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * A cloud resource's incidents: the ones linked to it - by a person, by the
 * monitor that watches it (its Linked Resources), or by OneUptime AI - with
 * Declare Incident keeping the resource picked.
 */
const CloudResourceIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Incident> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.cloudResources = new Includes([modelId]);
  }

  return (
    <Fragment>
      <IncidentsTable
        query={query}
        createFrom={{ kind: CreateFromRecordKind.CloudResource, id: modelId }}
      />
    </Fragment>
  );
};

export default CloudResourceIncidents;
