import PacketCapturesTable from "./PacketCapturesTable";
import Probe from "Common/Models/DatabaseModels/Probe";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  probeId: ObjectID;
}

/*
 * A probe page's Packet Captures card: reads what the probe last said about
 * capturing, then lists its captures with Start Packet Capture.
 */
const ProbePacketCaptures: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: PromiseVoidFunction = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const item: Probe | null = await ModelAPI.getItem<Probe>({
          modelType: Probe,
          id: props.probeId,
          select: {
            _id: true,
            name: true,
            projectId: true,
            isGlobalProbe: true,
            packetCaptureCapability: true,
          },
        });

        setProbe(item);
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
  }, [props.probeId]);

  if (isLoading) {
    return (
      <Card title="Packet Captures">
        <ComponentLoader />
      </Card>
    );
  }

  if (error || !probe) {
    return (
      <Card title="Packet Captures">
        <ErrorMessage message={error || "This probe could not be loaded."} />
      </Card>
    );
  }

  return <PacketCapturesTable probe={probe} />;
};

export default ProbePacketCaptures;
