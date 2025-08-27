import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MonitorStatusElement from "./MonitorStatusElement";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";

export interface ComponentProps {
  monitorId: ObjectID;
  shouldAnimate: boolean;
}

const GetMonitorStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMonitorStatusById: PromiseVoidFunction =
    async (): Promise<void> => {
      // Fetch MonitorStatus by ID
      try {
        setIsLoading(true);
        const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
          modelType: Monitor,
          id: props.monitorId,
          select: {
            currentMonitorStatus: {
              name: true,
              color: true,
            },
          },
        });

        if (!monitor) {
          setIsLoading(false);
          setError(ExceptionMessages.MonitorNotFound);
          return;
        }

        if (!monitor.currentMonitorStatus) {
          setIsLoading(false);
          setError("Monitor status not found");
          return;
        }

        setMonitorStatus(monitor.currentMonitorStatus);

        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
        setError(API.getFriendlyMessage(err));
      }
    };

  useEffect(() => {
    fetchMonitorStatusById().catch((error: Error) => {
      setError(API.getFriendlyMessage(error));
    });
  }, []);

  if (error) {
    return <p>{error}</p>;
  }

  if (isLoading) {
    return <Loader loaderType={LoaderType.Bar} />;
  }

  if (!monitorStatus) {
    return <p>Monitor status not found</p>;
  }

  return (
    <MonitorStatusElement
      monitorStatus={monitorStatus}
      shouldAnimate={props.shouldAnimate}
    />
  );
};

export default GetMonitorStatusElement;
