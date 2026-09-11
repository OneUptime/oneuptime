import Includes from "../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../Types/BaseDatabase/IncludesAnyOfGroups";
import DashboardVariable, {
  DashboardVariableOption,
  DashboardVariableType,
} from "../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "./VariableInterpolation";

export interface DashboardLabelFilterData {
  labelIds?: Array<string> | undefined;
  labelVariableId?: string | undefined;
  variables?: Array<DashboardVariable> | undefined;
}

export default class DashboardLabelVariable {
  public static getOptions(
    variable: DashboardVariable,
  ): Array<DashboardVariableOption> {
    const options: Array<DashboardVariableOption> | undefined =
      variable.labelOptions;
    if (
      !Array.isArray(options) ||
      options.length === 0 ||
      options.length > 1000
    ) {
      throw new BadDataException(
        "A project label variable must offer between 1 and 1000 labels.",
      );
    }

    const seen: Set<string> = new Set<string>();
    for (const option of options) {
      if (
        !option ||
        typeof option.value !== "string" ||
        !ObjectID.isValidUUID(option.value) ||
        typeof option.label !== "string" ||
        option.label.trim().length === 0 ||
        option.label.length > 1024 ||
        seen.has(option.value)
      ) {
        throw new BadDataException(
          "Project label variable choices must have unique label IDs and nonempty display names.",
        );
      }
      seen.add(option.value);
    }
    return options;
  }

  public static getFilter(
    data: DashboardLabelFilterData,
  ): Includes | IncludesAnyOfGroups | undefined {
    const fixed: Array<string> = [...new Set(data.labelIds || [])];
    if (!data.labelVariableId) {
      return fixed.length > 0 ? new Includes(fixed) : undefined;
    }

    const matching: Array<DashboardVariable> = (data.variables || []).filter(
      (variable: DashboardVariable) => {
        return variable.id === data.labelVariableId;
      },
    );
    const variable: DashboardVariable | undefined = matching[0];
    if (
      matching.length !== 1 ||
      !variable ||
      variable.type !== DashboardVariableType.ProjectLabel
    ) {
      throw new BadDataException(
        "The dashboard widget's label variable is missing or is not a project label variable. Edit the widget to select a label variable.",
      );
    }

    const allowed: Set<string> = new Set(
      DashboardLabelVariable.getOptions(variable).map(
        (option: DashboardVariableOption) => {
          return option.value;
        },
      ),
    );
    const resolved: ResolvedVariableValue | undefined =
      DashboardVariableInterpolation.resolveValue(variable);
    const selected: Array<string> =
      resolved?.multi ||
      (resolved?.scalar !== undefined ? [resolved.scalar] : []);
    if (
      selected.length > 100 ||
      selected.some((value: string) => {
        return !allowed.has(value);
      })
    ) {
      throw new BadDataException(
        "Choose up to 100 labels offered by this dashboard variable, or select All.",
      );
    }

    if (selected.length === 0) {
      return fixed.length > 0 ? new Includes(fixed) : undefined;
    }
    const dynamic: Array<string> = [...new Set(selected)];
    return fixed.length > 0
      ? new IncludesAnyOfGroups([fixed, dynamic])
      : new Includes(dynamic);
  }

  public static interpolateTitle(
    title: string | undefined,
    variables: Array<DashboardVariable> | undefined,
  ): string | undefined {
    if (!title || !variables?.length) {
      return title;
    }
    return title.replace(
      /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g,
      (placeholder: string, name: string): string => {
        const variable: DashboardVariable | undefined = variables.find(
          (item: DashboardVariable) => {
            return item.name === name;
          },
        );
        if (!variable) {
          return placeholder;
        }
        const resolved: ResolvedVariableValue | undefined =
          DashboardVariableInterpolation.resolveValue(variable);
        if (!resolved) {
          return "All";
        }
        const values: Array<string> = resolved.multi || [
          resolved.scalar as string,
        ];
        return values
          .map((value: string): string => {
            if (variable.type !== DashboardVariableType.ProjectLabel) {
              return value;
            }
            return (
              variable.labelOptions?.find((option: DashboardVariableOption) => {
                return option.value === value;
              })?.label || "Unavailable label"
            );
          })
          .join(", ");
      },
    );
  }
}
