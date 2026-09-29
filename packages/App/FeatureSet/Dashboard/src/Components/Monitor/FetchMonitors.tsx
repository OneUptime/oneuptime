import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import MonitorsElement from "./Monitors";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  monitorIds: Array<ObjectID>;
}

const FetchMonitors: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>("");
  const [monitor, setMonitor] = React.useState<Array<Monitor>>([]);

  const fetchMonitor: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const monitor: ListResult<Monitor> = await ModelAPI.getList({
        modelType: Monitor,
        query: {
          _id: new Includes(props.monitorIds),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          name: true,
          _id: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setMonitor(monitor.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchMonitor().catch((err: Exception) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  return <MonitorsElement monitors={monitor} />;
};

export default FetchMonitors;
