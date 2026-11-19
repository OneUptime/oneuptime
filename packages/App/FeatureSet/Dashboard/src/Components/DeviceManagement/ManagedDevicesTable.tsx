import ManagedDevice from "Common/Models/DatabaseModels/ManagedDevice";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ManagedDeviceStatusPill from "./ManagedDeviceStatusPill";

/*
 * Every Android device the project's Esper connections enroll, one row
 * each: whether it is there (online, or offline and since when, being set
 * up, disabled, removed), its group, its model and its Android version and
 * patch level. Filter by any of them - a group, a model, a patch level -
 * and open a device to see its Inventory page: its apps, its card from
 * Esper and what its apps or agent send.
 */

export interface ComponentProps {
  refreshToggle: string;
}

const ManagedDevicesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = OneUptimeDate.getCurrentDate();

  return (
    <ModelTable<ManagedDevice>
      modelType={ManagedDevice}
      refreshToggle={props.refreshToggle}
      id="managed-devices-table"
      name="Inventory > Managed Devices > Devices"
      userPreferencesKey="managed-devices-table"
      query={{ projectId: ProjectUtil.getCurrentProjectId()! }}
      selectMoreFields={{
        alias: true,
        serialNumber: true,
        providerState: true,
        removedAt: true,
        manufacturer: true,
        groupPath: true,
        securityPatchLevel: true,
        inventoryItemId: true,
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      onViewPage={async (item: ManagedDevice): Promise<Route> => {
        // A device's page is its host's in Inventory.
        if (item.inventoryItemId) {
          return RouteUtil.populateRouteParams(
            RouteMap[PageMap.INVENTORY_VIEW] as Route,
            { modelId: item.inventoryItemId },
          );
        }

        return Navigation.getCurrentRoute();
      }}
      sortBy="deviceName"
      sortOrder={SortOrder.Ascending}
      showRefreshButton={true}
      searchableFields={["deviceName", "alias", "serialNumber"]}
      searchPlaceholder="Search by name, alias or serial number"
      cardProps={{
        title: "Devices",
        description:
          "The Android devices your Esper connections import. Open one for its apps, what Esper says about it and the telemetry it sends.",
      }}
      noItemsMessage="No managed devices yet. They appear a minute after you connect Esper."
      filters={[
        {
          field: { groupName: true },
          type: FieldType.Text,
          title: "Group",
        },
        {
          field: { model: true },
          type: FieldType.Text,
          title: "Model",
        },
        {
          field: { osVersion: true },
          type: FieldType.Text,
          title: "Android Version",
        },
        {
          field: { securityPatchLevel: true },
          type: FieldType.Text,
          title: "Security Patch Level",
        },
        {
          field: { lastCheckInAt: true },
          type: FieldType.Date,
          title: "Last Check-In",
        },
      ]}
      columns={[
        {
          field: { deviceName: true },
          title: "Device",
          type: FieldType.Element,
          // Names read their own way, each on its own line.
          getLineText: drawsItsOwnLines,
          getElement: (item: ManagedDevice): ReactElement => {
            const name: string = item.alias || item.deviceName || "";
            const second: string = [
              item.alias ? item.deviceName : "",
              item.serialNumber,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <div className="min-w-0">
                <IsolatedLine
                  text={name}
                  className="truncate text-sm font-medium text-gray-900"
                />
                {second ? (
                  <IsolatedLine
                    text={second}
                    className="truncate text-xs text-gray-500"
                  />
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { lastCheckInAt: true },
          title: "Status",
          type: FieldType.Element,
          getElement: (item: ManagedDevice): ReactElement => {
            return (
              <ManagedDeviceStatusPill
                providerState={item.providerState}
                lastCheckInAt={item.lastCheckInAt}
                removedAt={item.removedAt}
                now={now}
                showAge={true}
              />
            );
          },
        },
        {
          field: { groupName: true },
          title: "Group",
          type: FieldType.Element,
          getLineText: drawsItsOwnLines,
          getElement: (item: ManagedDevice): ReactElement => {
            const group: string = item.groupPath || item.groupName || "";

            return group ? (
              <IsolatedLine text={group} className="text-sm text-gray-900" />
            ) : (
              <TableEmptyValue />
            );
          },
        },
        {
          field: { model: true },
          title: "Model",
          type: FieldType.Element,
          hideOnMobile: true,
          getLineText: drawsItsOwnLines,
          getElement: (item: ManagedDevice): ReactElement => {
            const model: string = [item.manufacturer, item.model]
              .filter(Boolean)
              .join(" ");

            return model ? (
              <IsolatedLine text={model} className="text-sm text-gray-900" />
            ) : (
              <TableEmptyValue />
            );
          },
        },
        {
          field: { osVersion: true },
          title: "Android",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: ManagedDevice): ReactElement => {
            if (!item.osVersion) {
              return <TableEmptyValue />;
            }

            return (
              <div className="min-w-0">
                <div className="text-sm text-gray-900">{item.osVersion}</div>
                {item.securityPatchLevel ? (
                  <div className="text-xs text-gray-500">
                    {translator.translateTemplate("Patch {{level}}", {
                      level: item.securityPatchLevel,
                    })}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
      ]}
    />
  );
};

export default ManagedDevicesTable;
