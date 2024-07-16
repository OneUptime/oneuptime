import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import API from "CommonUI/src/Utils/API/API";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import Monitor from "Model/Models/Monitor";
import MonitorStatus from "Model/Models/MonitorStatus";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MonitorStatusElement from "./MonitorStatusElement";
import Loader, { LoaderType } from "CommonUI/src/Components/Loader/Loader";

export interface ComponentProps {
  monitorId: ObjectID;
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
          setError("Monitor not found");
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

  return <MonitorStatusElement monitorStatus={monitorStatus} />;
};

export default GetMonitorStatusElement;
