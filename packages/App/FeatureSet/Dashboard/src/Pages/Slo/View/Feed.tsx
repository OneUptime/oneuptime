import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import { getSloResourceFeedProps } from "../../../Components/Slo/SloFeed";
import ObjectID from "Common/Types/ObjectID";
import ServiceLevelObjectiveFeed from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const SloFeedPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  /*
   * The feed route is <sloId>/feed, so the id is one segment back.
   * getLastParamAsObjectID(0) would read the literal string "feed".
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<ServiceLevelObjectiveFeed>
      {...getSloResourceFeedProps({ sloId: modelId })}
    />
  );
};

export default SloFeedPage;
