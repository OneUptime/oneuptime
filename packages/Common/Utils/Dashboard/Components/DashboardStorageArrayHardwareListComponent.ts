import DashboardStorageArrayHardwareListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardStorageArrayHardwareListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import {
  STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER,
  StorageArrayFiltersSection,
  getStorageArrayCommonArguments,
} from "./DashboardStorageArrayResourceListShared";

export default class DashboardStorageArrayHardwareListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardStorageArrayHardwareListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.StorageArrayHardwareList,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 50,
        /*
         * A hardware wall — one cell per component, drive and controller,
         * colored by status — is the view an operator scans for the one red
         * cell, so honeycomb is the default, like the Ceph OSD wall. The list
         * view stays one dropdown away.
         */
        viewMode: "honeycomb",
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardStorageArrayHardwareListComponent>
  > {
    const args: Array<
      ComponentArgument<DashboardStorageArrayHardwareListComponent>
    > =
      getStorageArrayCommonArguments<DashboardStorageArrayHardwareListComponent>();

    args.push({
      name: "Component Kind",
      description: "Quick filter by hardware component, drive or controller",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "kindFilter",
      section: StorageArrayFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        {
          label: "Hardware components only",
          value: StorageArrayResourceKind.Hardware,
        },
        { label: "Drives only", value: StorageArrayResourceKind.Drive },
        {
          label: "Controllers only",
          value: StorageArrayResourceKind.Controller,
        },
      ],
    });

    args.push({
      name: "Status",
      description: "Quick filter by component status",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: StorageArrayFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        {
          label: "Unhealthy only",
          value: STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER,
        },
      ],
    });

    return args;
  }
}
