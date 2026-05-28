import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";

const getAffectedResourceLabel: (resource: StatusPageResource) => string = (
  resource: StatusPageResource,
): string => {
  const groupName: string = resource.statusPageGroup?.name || "";
  const isGrid: boolean =
    resource.statusPageGroup?.viewMode === StatusPageGroupViewMode.Grid;
  const rowValue: string = resource.rowAxisValue || "";
  const columnValue: string = resource.columnAxisValue || "";

  if (isGrid && (rowValue || columnValue)) {
    const cellLabel: string =
      rowValue && columnValue
        ? `${rowValue} × ${columnValue}`
        : rowValue || columnValue;
    return groupName ? `${groupName} — ${cellLabel}` : cellLabel;
  }

  const displayName: string = resource.displayName || "";
  return groupName ? `${groupName}: ${displayName}` : displayName;
};

export default getAffectedResourceLabel;
