import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
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
import IncidentSeveritiesElement from "./IncidentSeveritiesElement";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  incidentSeverityIds: Array<ObjectID>;
}

const FetchIncidentSeverities: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>("");
  const [incidentSeverities, setIncidentSeverities] = React.useState<
    Array<IncidentSeverity>
  >([]);

  const fetchIncidentSeverities: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const incidentSeverities: ListResult<IncidentSeverity> =
          await ModelAPI.getList({
            modelType: IncidentSeverity,
            query: {
              _id: new Includes(props.incidentSeverityIds),
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

        setIncidentSeverities(incidentSeverities.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchIncidentSeverities().catch((err: Exception) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  return <IncidentSeveritiesElement incidentSeverities={incidentSeverities} />;
};

export default FetchIncidentSeverities;
