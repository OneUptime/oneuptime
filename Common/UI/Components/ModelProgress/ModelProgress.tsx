import API from "../../Utils/API/API";
import Query from "../../../Types/BaseDatabase/Query";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Card from "../Card/Card";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import ProgressBar from "../ProgressBar/ProgressBar";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  title: string;
  description: string;
  totalCount: number;
  countQuery: Query<TBaseModel>;
  modelType: { new (): TBaseModel };
}

const ModelProgress: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [count, setCount] = useState<number>(0);

  const fetchCount: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const count: number = await ModelAPI.count<TBaseModel>({
        modelType: props.modelType,
        query: props.countQuery,
      });

      setCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  return (
    <Card title={props.title} description={props.description}>
      <div className="w-full -mt-6">
        {!error && (
          <div>
            <ErrorMessage error={error} />
          </div>
        )}
        {isLoading && <ComponentLoader />}
        {!error && !isLoading && (
          <ProgressBar
            totalCount={props.totalCount}
            count={count}
            suffix={props.title}
          />
        )}
      </div>
    </Card>
  );
};

export default ModelProgress;
