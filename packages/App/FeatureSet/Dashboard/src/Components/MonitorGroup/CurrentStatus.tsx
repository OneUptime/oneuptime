import URL from "Common/Types/API/URL";
import Color from "Common/Types/Color";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Loader from "Common/UI/Components/Loader/Loader";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import NoMonitorsStatus from "./NoMonitorsStatus";
import MonitorGroupDisabledStatus from "./MonitorGroupDisabledStatus";
import { fetchMonitorGroupMonitoringSummary } from "./MonitorGroupMonitoringAPI";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringSummary,
} from "Common/Utils/Monitor/MonitorGroupMonitoring";

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

  /*
   * How many of its monitors have monitoring turned off (issue #6401): when
   * every one has, the group reads Disabled, as on its Overview. Null when
   * it could not be read: the status is then shown as the server gives it.
   */
  const [monitoringSummary, setMonitoringSummary] =
    React.useState<MonitorGroupMonitoringSummary | null>(null);

  const loadCurrentStatus: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const [currentStatus, count, summary]: [
        MonitorStatus | null,
        number | null,
        MonitorGroupMonitoringSummary | null,
      ] = await Promise.all([
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
        fetchMonitorGroupMonitoringSummary(props.monitorGroupId).catch(
          (): null => {
            return null;
          },
        ),
      ]);

      setMonitorCount(count);
      setMonitoringSummary(summary);
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

  if (
    MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(monitoringSummary)
  ) {
    return <MonitorGroupDisabledStatus />;
  }

  if (!currentGroupStatus) {
    throw new BadDataException("Current Group Status not found");
  }

  return (
    <Statusbubble
      color={currentGroupStatus.color! as Color}
      text={currentGroupStatus.name! as string}
      isUserContent={isRecordNameAsWritten(
        StateListType.MonitorStatus,
        currentGroupStatus.name,
      )}
      shouldAnimate={true}
    />
  );
};

export default CurrentStatusElement;
