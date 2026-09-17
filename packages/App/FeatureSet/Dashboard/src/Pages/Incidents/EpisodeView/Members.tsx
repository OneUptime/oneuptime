import IncidentEpisodeMemberRoleAssignment from "../../../Components/IncidentEpisode/IncidentEpisodeMemberRoleAssignment";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const EpisodeMembers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <IncidentEpisodeMemberRoleAssignment incidentEpisodeId={modelId} />
    </Fragment>
  );
};

export default EpisodeMembers;
