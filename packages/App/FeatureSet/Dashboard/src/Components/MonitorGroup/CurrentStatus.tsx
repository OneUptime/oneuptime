import URL from "Common/Types/API/URL";
import Color from "Common/Types/Color";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Loader from "Common/UI/Components/Loader/Loader";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import NoMonitorsStatus from "./NoMonitorsStatus";

export interface ComponentProps {
  monitorGroupId: ObjectID;
}

const CurrentStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [currentGroupStatus, setCurrentGroupStatus] =
    React.useState<MonitorStatus | null>(null);

  const [error, setError] = React.useState<string | undefined>(undefined);

  /*
   * How many monitors the group holds. The server answers an empty group's
   * status as the operational one, so the list said Operational for a
   * group whose Overview says it has no monitors yet. Null when it could
   * not be counted: the status is then shown as the server gives it.
   */
  const [monitorCount, setMonitorCount] = React.useState<number | null>(null);

  const loadCurrentStatus: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const [currentStatus, count]: [MonitorStatus | null, number | null] =
        await Promise.all([
          ModelAPI.post<MonitorStatus>({
            modelType: MonitorStatus,
            apiUrl: URL.fromString(APP_API_URL.toString())
              .addRoute(new MonitorGroup().getCrudApiPath()!)
              .addRoute("/current-status/")
              .addRoute(`/${props.monitorGroupId.toString()}`),
          }),
          ModelAPI.count<MonitorGroupResource>({
            modelType: MonitorGroupResource,
            query: {
              monitorGroupId: props.monitorGroupId,
            },
          }).catch((): null => {
            return null;
          }),
        ]);

      setMonitorCount(count);
      setCurrentGroupStatus(currentStatus);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    loadCurrentStatus().catch(() => {});
  }, []);

  if (isLoading) {
    return <Loader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (monitorCount === 0) {
    return <NoMonitorsStatus />;
  }

  if (!currentGroupStatus) {
    throw new BadDataException("Current Group Status not found");
  }

  return (
    <Statusbubble
      color={currentGroupStatus.color! as Color}
      text={currentGroupStatus.name! as string}
      shouldAnimate={true}
    />
  );
};

export default CurrentStatusElement;
