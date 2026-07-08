import Icon from "../Icon/Icon";
import Input from "../Input/Input";
import {
  ModelGroup,
  filterModelGroups,
  groupComponentsByModel,
} from "./DatabaseStepUtils";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentType,
} from "../../../Types/Workflow/Component";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A model → operation drill-down for database-record steps: pick a model
 * (searchable), then pick the operation (Find / Create / Update / Delete, or
 * the On-Create/Update/Delete triggers). It hands back the real component
 * object, so nothing is reconstructed.
 */

export interface ComponentProps {
  components: Array<ComponentMetadata>;
  componentType: ComponentType;
  selectedComponentId?: string | undefined;
  onSelect: (component: ComponentMetadata) => void;
}

const DatabaseStepPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [search, setSearch] = useState<string>("");
  const [selectedTableName, setSelectedTableName] = useState<string | null>(
    null,
  );

  const groups: Array<ModelGroup> = groupComponentsByModel(
    props.components,
    props.componentType,
  );

  const selectedGroup: ModelGroup | undefined = groups.find(
    (group: ModelGroup) => {
      return group.tableName === selectedTableName;
    },
  );

  if (selectedGroup) {
    return (
      <div>
        <button
          type="button"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
          onClick={() => {
            setSelectedTableName(null);
          }}
        >
          <Icon icon={IconProp.ChevronLeft} className="h-3.5 w-3.5" />
          All records
        </button>

        <h4 className="mb-2 text-sm font-semibold text-gray-700">
          {selectedGroup.name}
        </h4>

        <div className="grid grid-cols-1 gap-2">
          {selectedGroup.components.map((component: ComponentMetadata) => {
            const isSelected: boolean =
              props.selectedComponentId === component.id;
            return (
              <button
                key={component.id}
                type="button"
                onClick={() => {
                  props.onSelect(component);
                }}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left cursor-pointer ${
                  isSelected
                    ? "border-indigo-400 bg-indigo-50"
                    : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                }`}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                  <Icon icon={component.iconProp} className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">
                    {component.title}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {component.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const filteredGroups: Array<ModelGroup> = filterModelGroups(groups, search);

  return (
    <div>
      <div className="mb-3">
        <Input
          placeholder="Search records (e.g. Incident, Monitor)…"
          onChange={(value: string) => {
            setSearch(value);
          }}
        />
      </div>

      {filteredGroups.length === 0 ? (
        <p className="p-2 text-sm text-gray-500">
          No records match your search.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredGroups.map((group: ModelGroup) => {
            return (
              <button
                key={group.tableName}
                type="button"
                onClick={() => {
                  setSelectedTableName(group.tableName);
                }}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {group.name}
                  </span>
                  <span className="block text-xs text-gray-400">
                    {group.components.length} action
                    {group.components.length === 1 ? "" : "s"}
                  </span>
                </span>
                <Icon
                  icon={IconProp.ChevronRight}
                  className="h-4 w-4 shrink-0 text-gray-300"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DatabaseStepPicker;
