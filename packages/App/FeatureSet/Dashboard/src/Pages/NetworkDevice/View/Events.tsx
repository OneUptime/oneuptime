import PageComponentProps from "../../PageComponentProps";
import NetworkEventsView, {
  NetworkEventsDeviceInfo,
} from "../../../Components/NetworkEvents/NetworkEventsView";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * One device's Events page: what it reported, newest first, read out of
 * its syslog and its traps.
 *
 * The device's name, addresses, maker and probe are read here for two
 * things: the set-up guide the page shows before the first message arrives
 * (which probe to send to, whose steps to open on, and which addresses the
 * messages are matched by), and the name an alert made from this page is
 * given.
 */
const NetworkDeviceEvents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [device, setDevice] = useState<NetworkEventsDeviceInfo | undefined>(
    undefined,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<NetworkDevice>({
      modelType: NetworkDevice,
      id: modelId,
      select: {
        _id: true,
        name: true,
        hostname: true,
        otherAddresses: true,
        vendor: true,
        sysDescr: true,
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
          name: item.name || undefined,
          hostname: item.hostname || undefined,
          otherAddresses: item.otherAddresses || undefined,
          probeName: item.probe?.name || undefined,
          isGlobalProbe: Boolean(item.probe?.isGlobalProbe),
          // Whatever says who made it: the parsers tell a maker by either.
          vendor:
            [item.vendor, item.sysDescr]
              .filter((text: string | undefined): boolean => {
                return Boolean(text && text.trim());
              })
              .join(" ") || undefined,
        });
      })
      .catch(() => {
        // The page reads well without the device's details.
      });

    return () => {
      isCurrent = false;
    };
  }, [modelId.toString()]);

  return (
    <NetworkEventsView
      key={modelId.toString()}
      scope={{ kind: "device", networkDeviceId: modelId.toString() }}
      device={device}
    />
  );
};

export default NetworkDeviceEvents;
