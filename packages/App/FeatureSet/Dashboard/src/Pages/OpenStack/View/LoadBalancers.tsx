import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  OpenStackAmphoraList,
  OpenStackLoadBalancerList,
  OpenStackLoadBalancerPoolList,
} from "../../../Components/OpenStack/OpenStackLists";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";

/*
 * Every Octavia load balancer, then the pools behind them and the amphorae they run in. A load
 * balancer in error stays that way until someone deals with it, one left pending for an hour reads
 * Stuck, and a pool whose members all fail reads ERROR in its operating status while it and its load
 * balancer still provision ACTIVE. Listeners and members aren't here: the exporter has no series for
 * them.
 */
const OpenStackCloudLoadBalancers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.LoadBalancer}
      />
      <OpenStackLoadBalancerList openStackCloudId={modelId} />
      <OpenStackLoadBalancerPoolList openStackCloudId={modelId} />
      <OpenStackAmphoraList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudLoadBalancers;
