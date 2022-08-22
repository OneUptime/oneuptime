import { MonitorTypeHelper, MonitorTypeProps } from "Common/Types/Monitor/MonitorType";
import { DropdownOption } from "CommonUI/src/Components/Dropdown/Dropdown";

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
}