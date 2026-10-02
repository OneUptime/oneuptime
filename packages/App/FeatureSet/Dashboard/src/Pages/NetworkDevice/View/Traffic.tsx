import PageComponentProps from "../../PageComponentProps";
import FlowTopTalkers from "../../../Components/NetworkDevice/FlowTopTalkers";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

/*
 * Traffic page for one device: NetFlow top talkers (sources,
 * destinations, protocol/port pairs by bytes), plus how to turn the
 * firehose on for devices that are not exporting yet.
 */
const NetworkDeviceTraffic: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
            <TranslatedSentence
              template="Traffic analysis is powered by {{protocol}}. Your probe listens for flow records on UDP port 2055 — point this device's flow export at the probe's IP address and traffic will appear here within a few minutes."
              slots={{ protocol: <strong>NetFlow v5</strong> }}
            />
          </p>
          <p className="text-gray-500">
            {translator.translateText(
              "On most routers and L3 switches this is two steps: enable flow accounting on the interfaces you care about, then add a flow export destination pointing at the probe. Records are matched to this device by the exporter IP address, which must equal this device's hostname/IP as registered here.",
            )}
          </p>
        </div>
      </Card>
    </Fragment>
  );
};

export default NetworkDeviceTraffic;
