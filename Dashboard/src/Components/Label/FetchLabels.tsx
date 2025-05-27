import Label from "Common/Models/DatabaseModels/Label";
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
import LabelsElement from "./Labels";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  labelIds: Array<ObjectID>;
}

const FetchLabels: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>("");
  const [labels, setLabels] = React.useState<Array<Label>>([]);

  const fetchLabels: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const labels: ListResult<Label> = await ModelAPI.getList({
        modelType: Label,
        query: {
          _id: new Includes(props.labelIds),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          name: true,
          color: true,
          _id: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setLabels(labels.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchLabels().catch((err: Exception) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  return <LabelsElement labels={labels} />;
};

export default FetchLabels;
