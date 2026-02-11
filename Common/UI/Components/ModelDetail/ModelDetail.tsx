import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../Utils/Permission";
import User from "../../Utils/User";
import Detail from "../Detail/Detail";
import DetailField from "../Detail/Field";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Loader, { LoaderType } from "../Loader/Loader";
import Field from "./Field";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { VeryLightGray } from "../../../Types/BrandColors";
import Dictionary from "../../../Types/Dictionary";
import {
  PromiseVoidFunction,
  VoidFunction,
} from "../../../Types/FunctionTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import React, { ReactElement, useEffect, useState } from "react";
import { useAsyncEffect } from "use-async-effect";
import Select from "../../../Types/BaseDatabase/Select";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  id: string;
  fields: Array<Field<TBaseModel>>;
  onLoadingChange?: undefined | ((isLoading: boolean) => void);
  modelId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
  onError?: ((error: string) => void) | undefined;
  onItemLoaded?: (item: TBaseModel) => void | undefined;
  refresher?: undefined | boolean;
  showDetailsInNumberOfColumns?: number | undefined;
  onBeforeFetch?: (() => Promise<JSONObject>) | undefined;
  selectMoreFields?: Select<TBaseModel>;
}

const ModelDetail: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [fields, setFields] = useState<Array<DetailField<TBaseModel>>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [item, setItem] = useState<TBaseModel | null>(null);

  const [onBeforeFetchData, setOnBeforeFetchData] = useState<
    JSONObject | undefined
  >(undefined);

  type GetSelectFields = () => Select<TBaseModel>;

  const getSelectFields: GetSelectFields = (): Select<TBaseModel> => {
    const select: Select<TBaseModel> = {};
    for (const field of props.fields) {
      const keyofField: keyof TBaseModel | null = field.field
        ? (Object.keys(field.field)[0] as string as keyof TBaseModel)
        : null;

      if (keyofField) {
        select[keyofField] = true;
      }
    }

    for (const field of Object.keys(props.selectMoreFields || {})) {
      const keyofField: keyof TBaseModel = field as keyof TBaseModel;
      if (
        typeof field === "string" &&
        field &&
        props.selectMoreFields &&
        (props.selectMoreFields as Select<TBaseModel>)[keyofField]
      ) {
        select[keyofField] = props.selectMoreFields[keyofField] as JSONObject;
      }
    }

    return select;
  };

  type GetRelationSelectFunction = () => Select<TBaseModel>;

  const getRelationSelect: GetRelationSelectFunction =
    (): Select<TBaseModel> => {
      const relationSelect: Select<TBaseModel> = {};

      for (const field of props.fields || []) {
        const key: string | null = field.field
          ? (Object.keys(field.field)[0] as string)
          : null;

        if (key && new props.modelType()?.isFileColumn(key)) {
          (relationSelect as JSONObject)[key] = {
            file: true,
            _id: true,
            fileType: true,
            name: true,
          };
        } else if (key && new props.modelType()?.isEntityColumn(key)) {
          (relationSelect as JSONObject)[key] = (field.field as any)[key];
        }
      }

      return relationSelect;
    };

  const setDetailFields: VoidFunction = (): void => {
    // set fields.

    const userPermissions: Array<Permission> =
      PermissionUtil.getAllPermissions();

    const model: BaseModel = new props.modelType();

    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns() || {};

    const fieldsToSet: Array<DetailField<TBaseModel>> = [];

    for (const field of props.fields) {
      const keys: Array<string> = Object.keys(field.field ? field.field : {});

      if (keys.length > 0) {
        const key: keyof TBaseModel = keys[0] as keyof TBaseModel;

        let fieldPermissions: Array<Permission> = [];

        fieldPermissions = accessControl[key]?.read || [];

        const hasPermissions: boolean =
          fieldPermissions &&
          PermissionHelper.doesPermissionsIntersect(
            userPermissions,
            fieldPermissions,
          );

        if (hasPermissions || User.isMasterAdmin()) {
          fieldsToSet.push({
            ...field,
            key: key,
            getElement: field.getElement
              ? (item: TBaseModel): ReactElement => {
                  return field.getElement!(item, onBeforeFetchData, fetchItem);
                }
              : undefined,
          });
        }
      } else {
        fieldsToSet.push({
          ...field,
          key: null,
          getElement: field.getElement
            ? (item: TBaseModel): ReactElement => {
                return field.getElement!(item, onBeforeFetchData, fetchItem);
              }
            : undefined,
        });
      }
    }

    setFields(fieldsToSet);
  };

  useEffect(() => {
    if (props.modelType) {
      setDetailFields();
    }
  }, [onBeforeFetchData, props.modelType]);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    // get item.
    setIsLoading(true);
    props.onLoadingChange?.(true);
    setError("");
    try {
      if (props.onBeforeFetch) {
        const model: JSONObject = await props.onBeforeFetch();
        setOnBeforeFetchData(model);
      }

      const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

      const item: TBaseModel | null = await modelAPI.getItem({
        modelType: props.modelType,
        id: props.modelId,
        select: {
          ...getSelectFields(),
          ...getRelationSelect(),
        },
      });

      if (!item) {
        setError(
          `Cannot load ${(
            new props.modelType()?.singularName || "item"
          ).toLowerCase()}. It could be because you don't have enough permissions to read this ${(
            new props.modelType()?.singularName || "item"
          ).toLowerCase()}.`,
        );
      }

      if (props.onItemLoaded && item) {
        props.onItemLoaded(item);
      }

      setItem(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      props.onError?.(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
    props.onLoadingChange?.(false);
  };

  useAsyncEffect(async () => {
    if (props.modelId && props.modelType) {
      await fetchItem();
    }
  }, [props.modelId, props.refresher, props.modelType]);

  if (isLoading) {
    return (
      <div
        className="row text-center flex justify-center"
        style={{
          marginTop: "50px",
          marginBottom: "50px",
        }}
      >
        <Loader loaderType={LoaderType.Bar} color={VeryLightGray} size={200} />
      </div>
    );
  }

  if (error) {
    return (
      <p
        className="text-center color-light-Gray500"
        style={{
          marginTop: "50px",
          marginBottom: "50px",
        }}
      >
        {error} <br />{" "}
        <span
          onClick={async () => {
            await fetchItem();
          }}
          className="underline primary-on-hover"
        >
          Refresh?
        </span>
      </p>
    );
  }

  if (!item) {
    return <ErrorMessage message="Item not found" />;
  }

  return (
    <Detail
      id={props.id}
      item={item}
      fields={fields}
      showDetailsInNumberOfColumns={props.showDetailsInNumberOfColumns}
    />
  );
};

export default ModelDetail;
