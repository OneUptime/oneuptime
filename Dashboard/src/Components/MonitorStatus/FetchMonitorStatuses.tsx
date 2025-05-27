import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
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
import MonitorStatusesElement from "./MonitorStatusesElement";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  monitorStatusIds: Array<ObjectID>;
  shouldAnimate: boolean;
}

const FetchMonitorStatuses: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>("");
  const [monitorStatus, setMonitorStatus] = React.useState<
    Array<MonitorStatus>
  >([]);

  const fetchMonitorStatus: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const monitorStatus: ListResult<MonitorStatus> = await ModelAPI.getList({
        modelType: MonitorStatus,
        query: {
          _id: new Includes(props.monitorStatusIds),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          name: true,
          _id: true,
          color: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setMonitorStatus(monitorStatus.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchMonitorStatus().catch((err: Exception) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  return (
    <MonitorStatusesElement
      monitorStatuses={monitorStatus}
      shouldAnimate={props.shouldAnimate}
    />
  );
};

export default FetchMonitorStatuses;
