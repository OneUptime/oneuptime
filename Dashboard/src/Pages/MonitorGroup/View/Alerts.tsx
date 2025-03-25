import AlertsTable from "../../../Components/Alert/AlertsTable";
import PageComponentProps from "../../PageComponentProps";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const MonitorAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [monitorIds, setMonitorIds] = React.useState<ObjectID[]>([]);

  const [error, setError] = React.useState<string | undefined>(undefined);

  const loadMonitorsIds: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const monitorGroupResources: ListResult<MonitorGroupResource> =
        await ModelAPI.getList({
          modelType: MonitorGroupResource,
          query: {
            monitorGroupId: modelId.toString(),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            monitorId: true,
          },
          sort: {},
        });

      const monitorIds: Array<ObjectID> = monitorGroupResources.data.map(
        (monitorGroupResource: MonitorGroupResource): ObjectID => {
          return monitorGroupResource.monitorId!;
        },
      );

      setMonitorIds(monitorIds);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    loadMonitorsIds().catch(() => {});
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <AlertsTable
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          monitorId: monitorIds,
        }}
      />
    </Fragment>
  );
};

export default MonitorAlerts;
