import {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
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
}
