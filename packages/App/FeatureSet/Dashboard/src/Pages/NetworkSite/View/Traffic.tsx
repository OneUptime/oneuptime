import PageComponentProps from "../../PageComponentProps";
import NetworkTrafficView from "../../../Components/NetworkTraffic/NetworkTrafficView";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One site's traffic: the flow records of the devices at the site, on one
 * page - which of them carry the most, who talks to whom, what for.
 */
const NetworkSiteTraffic: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <NetworkTrafficView
      key={modelId.toString()}
      scope={{ kind: "site", networkSiteId: modelId }}
    />
  );
};

export default NetworkSiteTraffic;
