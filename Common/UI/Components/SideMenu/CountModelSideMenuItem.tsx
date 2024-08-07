import API from "../../Utils/API/API";
import Query from "../../Utils/BaseDatabase/Query";
import ModelAPI, { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";
import { BadgeType } from "../Badge/Badge";
import SideMenuItem from "./SideMenuItem";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  link: Link;
  modelType?: { new (): TBaseModel } | undefined;
  badgeType?: BadgeType | undefined;
  countQuery?: Query<TBaseModel> | undefined;
  requestOptions?: RequestOptions | undefined;
  icon?: undefined | IconProp;
  className?: undefined | string;
  onCountFetchInit?: (() => void) | undefined;
}

const CountModelSideMenuItem: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [count, setCount] = useState<number>(0);

  const fetchCount: PromiseVoidFunction = async (): Promise<void> => {
    if (!props.modelType) {
      return;
    }

    if (!props.countQuery) {
      return;
    }

    setError("");
    setIsLoading(true);

    if (props.onCountFetchInit) {
      props.onCountFetchInit();
    }

    try {
      const count: number = await ModelAPI.count<BaseModel>({
        modelType: props.modelType,
        query: props.countQuery,
        requestOptions: props.requestOptions,
      });

      setCount(count);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.countQuery]);

  return (
    <SideMenuItem
      link={props.link}
      badge={!isLoading && !error ? count : undefined}
      badgeType={props.badgeType}
      icon={props.icon}
      className={props.className}
    />
  );
};

export default CountModelSideMenuItem;
