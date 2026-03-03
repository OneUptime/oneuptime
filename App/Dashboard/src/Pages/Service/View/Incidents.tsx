import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ServiceMonitor from "Common/Models/DatabaseModels/ServiceMonitor";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Incident from "Common/Models/DatabaseModels/Incident";

const ServiceIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [monitorIds, setMonitorIds] = useState<Array<ObjectID> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMonitorsInService: PromiseVoidFunction =
    async (): Promise<void> => {
      // Fetch MonitorStatus by ID
      try {
        setIsLoading(true);
        const serviceMonitors: ListResult<ServiceMonitor> =
          await ModelAPI.getList<ServiceMonitor>({
            modelType: ServiceMonitor,
            query: {
              serviceId: modelId,
            },
            select: {
              monitorId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {},
          });

        const monitorIds: ObjectID[] = serviceMonitors.data.map(
          (serviceMonitor: ServiceMonitor) => {
            return serviceMonitor.monitorId!;
          },
        );

        setMonitorIds(monitorIds);
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
        setError(API.getFriendlyMessage(err));
      }
    };

  useEffect(() => {
    fetchMonitorsInService().catch((error: Error) => {
      setError(API.getFriendlyMessage(error));
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  const query: Query<Incident> = {};

  if (monitorIds) {
    query.monitors = new Includes(monitorIds);
  }

  return (
    <Fragment>
      <IncidentsTable
        query={query}
        disableCreate={true}
        title={"Service Incidents"}
        description="List of incidents that belong to monitors in this service."
        noItemsMessage={"No incidents found for this service."}
      />
    </Fragment>
  );
};

export default ServiceIncidents;
