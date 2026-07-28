import Columns from "./Columns";
import {
  CustomFieldDefinition,
  getCustomFieldColumns,
  getCustomFieldDefinitions,
} from "./CustomFieldColumns";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../Utils/Project";
import { Logger } from "../../Utils/Logger";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { useEffect, useMemo, useState } from "react";

export interface CustomFieldColumnsResult<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> {
  columns: Columns<TBaseModel>;
  definitions: Array<CustomFieldDefinition>;
  isLoading: boolean;
  error: string;
}

/*
 * Loads a resource's custom field *definitions* and turns them into table
 * columns.
 *
 * The definitions arrive after the table's first render, which is fine: they
 * only add columns, and every one of them is hidden until the viewer switches
 * it on. What must NOT wait on this request is the `customFields` entry in the
 * API select - the table does not refetch when its column set changes, so the
 * select has to be right from the first request. BaseModelTable handles that
 * from the synchronous `customFieldsModelType` prop instead.
 *
 * Pass `undefined` for the model type to switch the whole thing off; the hook
 * still runs (hooks cannot be conditional) but makes no request.
 */
export type UseCustomFieldColumnsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  customFieldsModelType?: { new (): BaseModel } | undefined;
  projectId?: ObjectID | null | undefined;
}) => CustomFieldColumnsResult<TBaseModel>;

const useCustomFieldColumns: UseCustomFieldColumnsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  customFieldsModelType?: { new (): BaseModel } | undefined;
  projectId?: ObjectID | null | undefined;
}): CustomFieldColumnsResult<TBaseModel> => {
  const { customFieldsModelType } = data;

  const [definitions, setDefinitions] = useState<Array<CustomFieldDefinition>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const projectId: ObjectID | null =
    data.projectId ?? ProjectUtil.getCurrentProjectId();

  const projectIdString: string = projectId?.toString() || "";
  const modelName: string = customFieldsModelType?.name || "";

  useEffect(() => {
    if (!customFieldsModelType || !projectId) {
      setDefinitions([]);
      return;
    }

    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>(
          {
            modelType: customFieldsModelType,
            query: {
              projectId: projectId,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              name: true,
              customFieldType: true,
              description: true,
              dropdownOptions: true,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            sort: {},
          },
        );

        if (isCancelled) {
          return;
        }

        setDefinitions(getCustomFieldDefinitions(result.data || []));
      } catch (err) {
        if (isCancelled) {
          return;
        }

        /*
         * Custom fields are a paid feature and the caller may not have read
         * access to the definition table, so a failure here is expected in
         * normal operation. It costs the viewer some optional columns; it must
         * never take the table down with it.
         */
        Logger.warn(
          `Could not load custom field definitions for ${modelName}: ${
            (err as Error)?.message || String(err)
          }`,
        );
        setDefinitions([]);
        setError((err as Error)?.message || "");
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    load().catch(() => {
      // load() already funnels every failure into the catch above.
    });

    return () => {
      isCancelled = true;
    };
  }, [modelName, projectIdString]);

  const columns: Columns<TBaseModel> = useMemo(() => {
    if (definitions.length === 0) {
      return [];
    }

    return getCustomFieldColumns<TBaseModel>({ definitions });
  }, [definitions]);

  return { columns, definitions, isLoading, error };
};

export default useCustomFieldColumns;
