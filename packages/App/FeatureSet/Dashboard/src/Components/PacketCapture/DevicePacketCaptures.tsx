import PacketCapturesTable from "./PacketCapturesTable";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  networkDeviceId: ObjectID;
}

/*
 * A device's Packet Captures, on its Traffic page: captures run on the
 * device's own probe - the one that can reach it - and start filtered to the
 * device's address, so "what is this switch saying" is three clicks. A
 * device with no probe is told how to get one.
 */
const DevicePacketCaptures: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: PromiseVoidFunction = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const item: NetworkDevice | null =
          await ModelAPI.getItem<NetworkDevice>({
            modelType: NetworkDevice,
            id: props.networkDeviceId,
            select: {
              _id: true,
              hostname: true,
              probeId: true,
              probe: {
                _id: true,
                name: true,
                projectId: true,
                isGlobalProbe: true,
                packetCaptureCapability: true,
              },
            },
          });

        setDevice(item);
        setError("");
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.networkDeviceId]);

  if (isLoading) {
    return (
      <Card title="Packet Captures">
        <ComponentLoader />
      </Card>
    );
  }

  if (error || !device) {
    return (
      <Card title="Packet Captures">
        <ErrorMessage message={error || "This device could not be loaded."} />
      </Card>
    );
  }

  const probe: Probe | undefined = device.probe;

  if (!device.probeId || !probe) {
    return (
      <Card
        title="Packet Captures"
        description="Capture this device's traffic from the probe that monitors it."
      >
        <div
          className="text-sm text-gray-600"
          data-testid="device-packet-capture-no-probe"
        >
          {translator.translateText(
            "This device has no probe. Assign one in its settings to capture its traffic from there.",
          )}{" "}
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
              { modelId: props.networkDeviceId },
            )}
            className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            {translator.translateText("Open device settings")}
          </Link>
        </div>
      </Card>
    );
  }

  if (!probe.id) {
    probe.id = device.probeId;
  }

  return (
    <PacketCapturesTable
      probe={probe}
      networkDeviceId={props.networkDeviceId}
      defaultHost={device.hostname || undefined}
      description="Capture this device's traffic from its probe, then download the file and open it in Wireshark. New captures start filtered to the device's address."
    />
  );
};

export default DevicePacketCaptures;
