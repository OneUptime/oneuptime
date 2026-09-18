import PageComponentProps from "../../PageComponentProps";
import FlowTopTalkers from "../../../Components/NetworkDevice/FlowTopTalkers";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Traffic page for one device: NetFlow top talkers (sources,
 * destinations, protocol/port pairs by bytes), plus how to turn the
 * firehose on for devices that are not exporting yet.
 */
const NetworkDeviceTraffic: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <FlowTopTalkers networkDeviceId={modelId} />
      <Card
        title="Setting up NetFlow"
        description="How traffic data gets here, if this page is empty."
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            Traffic analysis is powered by <strong>NetFlow v5</strong>. Your
            probe listens for flow records on UDP port 2055 — point this
            device&apos;s flow export at the probe&apos;s IP address and traffic
            will appear here within a few minutes.
          </p>
          <p className="text-gray-500">
            On most routers and L3 switches this is two steps: enable flow
            accounting on the interfaces you care about, then add a flow export
            destination pointing at the probe. Records are matched to this
            device by the exporter IP address, which must equal this
            device&apos;s hostname/IP as registered here.
          </p>
        </div>
      </Card>
    </Fragment>
  );
};

export default NetworkDeviceTraffic;
