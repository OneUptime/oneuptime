import { DashboardVariableType } from "Common/Types/Dashboard/DashboardVariable";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Each dashboard variable source's name, a key of its own.
 *
 * The names are the stored enum values (Common/Types/Dashboard/
 * DashboardVariable), which the extractor does not read, so the Variables
 * dialog's Source dropdown showed them in English in every language. The
 * dropdown looks each label up; what is stored stays the enum's value.
 */
export const DASHBOARD_VARIABLE_TYPE_NAMES: Readonly<
  Record<DashboardVariableType, string>
> = {
  [DashboardVariableType.CustomList]: translationKey("Custom List"),
  [DashboardVariableType.Query]: translationKey("Query"),
  [DashboardVariableType.TextInput]: translationKey("Text Input"),
  [DashboardVariableType.TelemetryAttribute]: translationKey(
    "Telemetry Attribute",
  ),
  [DashboardVariableType.ProjectLabel]: translationKey("Project Labels"),
};

// A source's English name, for the dropdown to look up.
export const getDashboardVariableTypeName: (
  type: DashboardVariableType,
) => string = (type: DashboardVariableType): string => {
  return DASHBOARD_VARIABLE_TYPE_NAMES[type] || type;
};
