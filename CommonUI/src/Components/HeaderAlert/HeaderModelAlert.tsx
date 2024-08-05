import API from "../../Utils/API/API";
import Query from "../../Utils/BaseDatabase/Query";
import ModelAPI, { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";
import HeaderAlert from "./HeaderAlert";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  icon: IconProp;
  modelType: { new (): TBaseModel };
  singularName: string;
  pluralName: string;
  query: Query<TBaseModel>;
  requestOptions?: RequestOptions | undefined;
  onCountFetchInit?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
  refreshToggle?: boolean | undefined;
  className?: string | undefined;
}

const HeaderModelAlert: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    fetchCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.refreshToggle]);

  const fetchCount: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    if (props.onCountFetchInit) {
      props.onCountFetchInit();
    }

    try {
      const count: number = await ModelAPI.count<TBaseModel>({
        modelType: props.modelType,
        query: props.query,
        requestOptions: props.requestOptions,
      });

      setCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    setIsLoading(true);
    fetchCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
    setIsLoading(false);
  }, []);

  if (error) {
    return <></>;
  }

  if (isLoading) {
    return <></>;
  }

  if (count === 0) {
    return <></>;
  }

  return (
    <HeaderAlert
      title={`${count} ${count > 1 ? props.pluralName : props.singularName}`}
      icon={props.icon}
      onClick={props.onClick}
      className={props.className}
    />
  );
};

export default HeaderModelAlert;
