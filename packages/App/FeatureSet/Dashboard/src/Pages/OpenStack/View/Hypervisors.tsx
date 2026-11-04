import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackHypervisorList } from "../../../Components/OpenStack/OpenStackLists";

/*
 * Every compute host, and what Nova and Placement have promised on it. Those numbers are
 * promises and not load, so every column says "allocated". A host Nova lost keeps its last
 * numbers, and would read as idle capacity on its own, so its row says it is lost and that
 * its numbers are last known. Its state is its own row's, which the ingest takes from its
 * nova-compute (OpenStackSnapshotScan), so a host's short and full names need no join here.
 */
const OpenStackCloudHypervisors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackHypervisorList openStackCloudId={modelId} />;
};

export default OpenStackCloudHypervisors;
