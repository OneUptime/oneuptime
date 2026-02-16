import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

export default class MonitorTypeUtil {
  public static monitorTypesAsDropdownOptions(): Array<DropdownOption> {
    const monitorTypes: Array<MonitorTypeProps> =
      MonitorTypeHelper.getAllMonitorTypeProps();

    return monitorTypes.map((props: MonitorTypeProps) => {
      return {
        value: props.monitorType,
        label: props.title,
      };
    });
  }

  public static monitorTypesAsCardSelectOptions(): Array<CardSelectOption> {
    const monitorTypes: Array<MonitorTypeProps> =
      MonitorTypeHelper.getAllMonitorTypeProps();

    return monitorTypes.map((props: MonitorTypeProps) => {
      return {
        value: props.monitorType,
        title: props.title,
        description: props.description,
        icon: props.icon,
      };
    });
  }

  public static monitorTypesAsCategorizedCardSelectOptions(): Array<CardSelectOptionGroup> {
    const categories: Array<MonitorTypeCategory> =
      MonitorTypeHelper.getMonitorTypeCategories();
    const allProps: Array<MonitorTypeProps> =
      MonitorTypeHelper.getAllMonitorTypeProps();

    return categories.map(
      (category: MonitorTypeCategory): CardSelectOptionGroup => {
        return {
          label: category.label,
          options: category.monitorTypes
            .map((monitorType: MonitorType): CardSelectOption | null => {
              const typeProps: MonitorTypeProps | undefined = allProps.find(
                (p: MonitorTypeProps) => p.monitorType === monitorType,
              );

              if (!typeProps) {
                return null;
              }

              return {
                value: typeProps.monitorType,
                title: typeProps.title,
                description: typeProps.description,
                icon: typeProps.icon,
              };
            })
            .filter(
              (option: CardSelectOption | null): option is CardSelectOption =>
                option !== null,
            ),
        };
      },
    );
  }
}
