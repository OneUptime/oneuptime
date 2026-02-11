import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Page from "./Page";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import React, { ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import Select from "../../../Server/Types/Database/Select";

export interface ComponentProps<TBaseModel extends BaseModel> {
  title?: string | undefined;
  breadcrumbLinks?: Array<Link> | undefined;
  children: Array<ReactElement> | ReactElement;
  sideMenu?: undefined | ReactElement;
  className?: string | undefined;
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  modelNameField: string;
  modelAPI?: typeof ModelAPI | undefined;
}

const ModelPage: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");
  const [labels, setLabels] = useState<Array<Label>>([]);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    // get item.
    setIsLoading(true);

    setError("");
    try {
      const modelInstance: TBaseModel = new props.modelType();
      const labelsColumn: string | null =
        modelInstance.getAccessControlColumn();

      const select: JSONObject = {
        [props.modelNameField]: true,
      };

      if (labelsColumn) {
        select[labelsColumn] = {
          _id: true,
          name: true,
          color: true,
        } as Select<TBaseModel>;
      }

      const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

      const item: TBaseModel | null = await modelAPI.getItem({
        modelType: props.modelType,
        id: props.modelId,
        select: select as Select<TBaseModel>,
        requestOptions: {},
      });

      if (!item) {
        setError(
          `Cannot load ${(
            new props.modelType()?.singularName || "item"
          ).toLowerCase()}. It could be because you don't have enough permissions to read this ${(
            new props.modelType()?.singularName || "item"
          ).toLowerCase()}.`,
        );

        return;
      }

      if (labelsColumn) {
        const columnValue: Array<Label> | null = (
          item as BaseModel
        ).getColumnValue(labelsColumn) as Array<Label> | null;

        const loadedLabels: Array<Label> =
          columnValue || ((item as any)[labelsColumn] as Array<Label>) || [];
        setLabels(loadedLabels);
      } else {
        setLabels([]);
      }

      setTitle(
        `${props.title || ""} - ${
          (item as any)[props.modelNameField] as string
        }`,
      );
    } catch (err) {
      setLabels([]);
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  const [title, setTitle] = useState<string | undefined>(props.title);

  useAsyncEffect(async () => {
    // fetch the model
    await fetchItem();
  }, []);

  return (
    <Page
      {...props}
      labels={labels.length > 0 ? labels : undefined}
      isLoading={isLoading}
      error={error}
      title={title}
    />
  );
};

export default ModelPage;
