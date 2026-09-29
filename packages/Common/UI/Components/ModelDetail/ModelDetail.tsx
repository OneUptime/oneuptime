import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../Utils/Permission";
import User from "../../Utils/User";
import Detail, { DetailStyle } from "../Detail/Detail";
import DetailField from "../Detail/Field";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Loader, { LoaderType } from "../Loader/Loader";
import Field from "./Field";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { VeryLightGray } from "../../../Types/BrandColors";
import Dictionary from "../../../Types/Dictionary";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import React, { ReactElement, useEffect, useRef, useState } from "react";
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
  onItemLoaded?: ((item: TBaseModel) => void) | undefined;
  refresher?: undefined | boolean;
  showDetailsInNumberOfColumns?: number | undefined;
  onBeforeFetch?: (() => Promise<JSONObject>) | undefined;
  selectMoreFields?: Select<TBaseModel>;
  // Forwarded to Detail. Leave unset for the default layout.
  style?: DetailStyle | undefined;
}

const ModelDetail: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [item, setItem] = useState<TBaseModel | null>(null);

  const [onBeforeFetchData, setOnBeforeFetchData] = useState<
    JSONObject | undefined
  >(undefined);

  /*
   * Bumped by every fetch (and on unmount). A response only lands if no newer
   * fetch has started since, so a slow earlier request can never overwrite
   * the item - or call onItemLoaded with - what a later one already loaded.
   */
  const fetchGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      fetchGenerationRef.current++;
    };
  }, []);

  type HasPermissionToReadFieldFunction = (fieldName: string) => boolean;

  /*
   * The server rejects the WHOLE get-item request when the select names a
   * single column the caller cannot read (SelectPermission.checkSelectPermission
   * throws NotAuthorizedException), which blanks the entire card instead of
   * hiding one row. setDetailFields() below already drops unreadable fields
   * from the render, so the fetch has to drop them too - the same thing
   * BaseModelTable does for its selectMoreFields.
   */
  const hasPermissionToReadField: HasPermissionToReadFieldFunction = (
    fieldName: string,
  ): boolean => {
    if (User.isMasterAdmin()) {
      return true;
    }

    const accessControl: Dictionary<ColumnAccessControl> =
      new props.modelType().getColumnAccessControlForAllColumns() || {};

    const fieldPermissions: Array<Permission> =
      accessControl[fieldName]?.read || [];

    return PermissionHelper.doesPermissionsIntersect(
      PermissionUtil.getAllPermissions(),
      fieldPermissions,
    );
  };

  type GetSelectFields = () => Select<TBaseModel>;

  const getSelectFields: GetSelectFields = (): Select<TBaseModel> => {
    const select: Select<TBaseModel> = {};

    /*
     * _id is never a declared field on most cards, but CardModelDetail needs
     * it to know which record its edit modal is updating. It is exempt from
     * select permission checks server-side, so it is always safe to ask for.
     */
    (select as Dictionary<boolean>)["_id"] = true;

    for (const field of props.fields) {
      if (!field.field) {
        continue;
      }
      for (const key of Object.keys(field.field)) {
        if (!hasPermissionToReadField(key)) {
          continue;
        }
        select[key as keyof TBaseModel] = true;
      }
    }

    for (const field of Object.keys(props.selectMoreFields || {})) {
      const keyofField: keyof TBaseModel = field as keyof TBaseModel;
      if (
        typeof field === "string" &&
        field &&
        props.selectMoreFields &&
        (props.selectMoreFields as Select<TBaseModel>)[keyofField] &&
        hasPermissionToReadField(field)
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
      const model: BaseModel = new props.modelType();

      for (const field of props.fields || []) {
        if (!field.field) {
          continue;
        }
        for (const key of Object.keys(field.field)) {
          if (!hasPermissionToReadField(key)) {
            continue;
          }

          if (model.isFileColumn(key)) {
            (relationSelect as JSONObject)[key] = {
              file: true,
              _id: true,
              fileType: true,
              name: true,
            };
          } else if (model.isEntityColumn(key)) {
            (relationSelect as JSONObject)[key] = (field.field as any)[key];
          }
        }
      }

      return relationSelect;
    };

  type GetDetailFieldsFunction = () => Array<DetailField<TBaseModel>>;

  /*
   * Derived on every render rather than stored once at mount. A getElement
   * usually closes over the page's state and props (a resend handler, a
   * translation function, a field set that depends on data the page loads
   * later), and a copy captured at mount keeps rendering - and calling back
   * with - those first values forever.
   */
  const getDetailFields: GetDetailFieldsFunction = (): Array<
    DetailField<TBaseModel>
  > => {
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

    return fieldsToSet;
  };

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    fetchGenerationRef.current++;
    const generation: number = fetchGenerationRef.current;

    type IsStaleFunction = () => boolean;

    const isStale: IsStaleFunction = (): boolean => {
      return generation !== fetchGenerationRef.current;
    };

    // get item.
    setIsLoading(true);
    props.onLoadingChange?.(true);
    setError("");
    try {
      if (props.onBeforeFetch) {
        const model: JSONObject = await props.onBeforeFetch();

        if (isStale()) {
          return;
        }

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

      if (isStale()) {
        return;
      }

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
      if (isStale()) {
        return;
      }

      setError(API.getFriendlyMessage(err));
      props.onError?.(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
    props.onLoadingChange?.(false);
  };

  /*
   * Keyed on the id's string, not the ObjectID. Pages build that ObjectID
   * inline (Navigation.getLastParamAsObjectID(), ObjectID.getZeroObjectID(),
   * ProjectUtil.getCurrentProjectId()), each of which returns a new instance
   * per call - so keying on identity refetched, and flashed the loader, on
   * every parent re-render, and looped forever on a page whose onItemLoaded
   * set state. A page that needs fresh data has to say so through refresher.
   */
  useAsyncEffect(async () => {
    if (props.modelId && props.modelType) {
      await fetchItem();
    }
  }, [props.modelId?.toString(), props.refresher, props.modelType]);

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
      fields={getDetailFields()}
      showDetailsInNumberOfColumns={props.showDetailsInNumberOfColumns}
      style={props.style}
    />
  );
};

export default ModelDetail;
