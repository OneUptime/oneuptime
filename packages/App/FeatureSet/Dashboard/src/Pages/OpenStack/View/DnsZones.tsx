import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackDnsZoneList } from "../../../Components/OpenStack/OpenStackLists";

/*
 * Every Designate zone, in Designate's own words. One in ERROR means its worker gave up writing it to a DNS
 * server, and one PENDING past half an hour has nothing working on it. A zone's recordsets that aren't ACTIVE
 * are on its own page.
 */
const OpenStackCloudDnsZones: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackDnsZoneList openStackCloudId={modelId} />;
};

export default OpenStackCloudDnsZones;
