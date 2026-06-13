import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import { EntityFilterModelType } from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";

type ModelTypeOf<T extends BaseModel> = { new (): T };

interface EntityModelDef<T extends BaseModel> {
  modelType: ModelTypeOf<T>;
  sortField: keyof T;
  sortOrder: SortOrder;
}

function getEntityModelDef(
  entityFilterModelType: EntityFilterModelType,
): EntityModelDef<BaseModel> {
  switch (entityFilterModelType) {
    case EntityFilterModelType.IncidentSeverity:
      return {
        modelType: IncidentSeverity as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.AlertSeverity:
      return {
        modelType: AlertSeverity as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.IncidentState:
      return {
        modelType: IncidentState as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.AlertState:
      return {
        modelType: AlertState as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.MonitorStatus:
      return {
        modelType: MonitorStatus as unknown as ModelTypeOf<BaseModel>,
        sortField: "priority" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.Monitor:
      return {
        modelType: Monitor as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.Label:
      return {
        modelType: Label as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.KubernetesCluster:
      return {
        modelType: KubernetesCluster as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.DockerHost:
      return {
        modelType: DockerHost as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.ProxmoxCluster:
      return {
        modelType: ProxmoxCluster as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.CephCluster:
      return {
        modelType: CephCluster as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    default:
      throw new Error(
        `Unsupported entity filter model type: ${entityFilterModelType}`,
      );
  }
}

export interface EntityFilterDropdownProps {
  entityFilterModelType: EntityFilterModelType;
  isMultiSelect: boolean;
  value: string | Array<string> | undefined;
  placeholder?: string | undefined;
  onChange: (value: string | Array<string> | null) => void;
}

const EntityFilterDropdown: FunctionComponent<EntityFilterDropdownProps> = (
  props: EntityFilterDropdownProps,
): ReactElement => {
  const [options, setOptions] = useState<Array<DropdownOption>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        setError("No project selected.");
        setIsLoading(false);
        return;
      }

      try {
        const def: EntityModelDef<BaseModel> = getEntityModelDef(
          props.entityFilterModelType,
        );

        const listResult: ListResult<BaseModel> =
          await ModelAPI.getList<BaseModel>({
            modelType: def.modelType,
            query: { projectId: projectId } as Query<BaseModel>,
            limit: 1000,
            skip: 0,
            select: { _id: true, name: true } as Record<string, true>,
            sort: { [def.sortField]: def.sortOrder } as Record<
              string,
              SortOrder
            >,
          });

        const newOptions: Array<DropdownOption> = listResult.data.map(
          (item: BaseModel) => {
            return {
              value: ((item as unknown as { _id: string })._id as string) || "",
              label:
                ((item as unknown as { name: string }).name as string) ||
                "Unnamed",
            };
          },
        );

        setOptions(newOptions);
        setError(null);
      } catch (err: unknown) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsLoading(false);
    };

    load();
  }, [props.entityFilterModelType]);

  if (isLoading) {
    return (
      <div className="text-xs text-gray-500 py-2 px-3 border border-gray-200 rounded-md bg-gray-50">
        Loading options...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-red-600 py-2 px-3 border border-red-200 rounded-md bg-red-50">
        {error}
      </div>
    );
  }

  let initialValue: DropdownOption | Array<DropdownOption> | undefined =
    undefined;

  if (props.isMultiSelect) {
    const selectedValues: Array<string> = Array.isArray(props.value)
      ? props.value
      : [];
    initialValue = options.filter((opt: DropdownOption) => {
      return selectedValues.includes(opt.value as string);
    });
  } else if (typeof props.value === "string" && props.value) {
    initialValue = options.find((opt: DropdownOption) => {
      return opt.value === props.value;
    });
  }

  return (
    <Dropdown
      options={options}
      isMultiSelect={props.isMultiSelect}
      placeholder={props.placeholder || "Select..."}
      value={initialValue}
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        if (value === null) {
          props.onChange(props.isMultiSelect ? [] : "");
          return;
        }

        if (Array.isArray(value)) {
          props.onChange(
            value.map((v: DropdownValue) => {
              return v.toString();
            }),
          );
        } else {
          props.onChange(value.toString());
        }
      }}
    />
  );
};

export default EntityFilterDropdown;
