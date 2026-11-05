import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackDatabaseInstanceList } from "../../../Components/OpenStack/OpenStackLists";

/*
 * Every Trove database, in Trove's own words. One in error stays that way until someone deals with it,
 * and one left on its way for an hour reads Stuck: Trove gives up on a guest by itself well before that,
 * so nothing is working on it, and it has no list of workers to say why.
 */
const OpenStackCloudDatabaseInstances: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackDatabaseInstanceList openStackCloudId={modelId} />;
};

export default OpenStackCloudDatabaseInstances;
