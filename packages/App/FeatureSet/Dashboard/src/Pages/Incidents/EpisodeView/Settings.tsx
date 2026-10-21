import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import StatusPageVisibilityCard from "../../../Components/StatusPageVisibility/StatusPageVisibilityCard";
import { StatusPageVisibilityKind } from "../../../Components/StatusPageVisibility/StatusPageVisibilitySwitchCopy";

/*
 * An episode's Settings: whether it shows on status pages, one switch that
 * saves the moment it is flipped.
 */
const EpisodeSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <StatusPageVisibilityCard
      kind={StatusPageVisibilityKind.IncidentEpisode}
      modelId={modelId}
    />
  );
};

export default EpisodeSettings;
