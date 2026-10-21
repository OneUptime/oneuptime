import PageComponentProps from "../../PageComponentProps";
import NetworkTrafficView, {
  NetworkTrafficDeviceInfo,
} from "../../../Components/NetworkTraffic/NetworkTrafficView";
import DevicePacketCaptures from "../../../Components/PacketCapture/DevicePacketCaptures";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * One device's Traffic page: where its traffic goes, from the flow records
 * it exports (NetFlow, IPFIX or sFlow) - and, below, the packet captures
 * run on its probe, for when the flows are not enough (issue #4601: flows
 * first, captures second).
 *
 * The device's addresses and probe are read here only for the set-up guide
 * the page shows before the first flow arrives: which probe to send to, and
 * which addresses the records are matched by.
 */
const NetworkDeviceTraffic: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [device, setDevice] = useState<NetworkTrafficDeviceInfo | undefined>(
    undefined,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<NetworkDevice>({
      modelType: NetworkDevice,
      id: modelId,
      select: {
        _id: true,
        hostname: true,
        otherAddresses: true,
        probe: {
          _id: true,
          name: true,
          isGlobalProbe: true,
        },
      },
    })
      .then((item: NetworkDevice | null) => {
        if (!isCurrent || !item) {
          return;
        }

        setDevice({
          hostname: item.hostname || undefined,
          otherAddresses: item.otherAddresses || undefined,
          probeName: item.probe?.name || undefined,
          isGlobalProbe: Boolean(item.probe?.isGlobalProbe),
        });
      })
      .catch(() => {
        // The guide reads well without the device's details.
      });

    return () => {
      isCurrent = false;
    };
  }, [modelId.toString()]);

  return (
    <Fragment>
      <NetworkTrafficView
        key={modelId.toString()}
        scope={{ kind: "device", networkDeviceId: modelId }}
        device={device}
      />
      <DevicePacketCaptures networkDeviceId={modelId} />
    </Fragment>
  );
};

export default NetworkDeviceTraffic;
