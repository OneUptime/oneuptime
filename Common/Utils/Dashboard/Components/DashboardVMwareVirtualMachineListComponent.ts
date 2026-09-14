import DashboardVMwareVirtualMachineListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardVMwareVirtualMachineListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  VMwareFiltersSection,
  getVMwareCommonArguments,
} from "./DashboardVMwareResourceListShared";

export default class DashboardVMwareVirtualMachineListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardVMwareVirtualMachineListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.VMwareVirtualMachineList,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 25,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardVMwareVirtualMachineListComponent>
  > {
    const args: Array<
      ComponentArgument<DashboardVMwareVirtualMachineListComponent>
    > = getVMwareCommonArguments<DashboardVMwareVirtualMachineListComponent>();

    /*
     * Power state is inferred at ingest: the vcenter receiver emits
     * vcenter.vm.cpu.* only for powered-on VMs, so "off" covers both
     * powered-off and suspended machines.
     */
    args.push({
      name: "Power State",
      description: "Quick filter by virtual machine power state",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "powerStateFilter",
      section: VMwareFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Powered on only", value: "on" },
        { label: "Powered off only", value: "off" },
      ],
    });

    args.push({
      name: "Templates",
      description:
        "Include VM templates alongside virtual machines, hide them, or show only templates",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "templateFilter",
      section: VMwareFiltersSection,
      dropdownOptions: [
        { label: "VMs and templates", value: "" },
        { label: "Hide templates", value: "exclude" },
        { label: "Templates only", value: "only" },
      ],
    });

    return args;
  }
}
