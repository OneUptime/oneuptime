import ManagedDeviceApp from "Common/Models/DatabaseModels/ManagedDeviceApp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The apps installed on a managed device, with their versions, on the
 * device's Inventory page: what Esper reported the last time it read the
 * device's apps (every 6 hours). The app the device runs in kiosk mode, and
 * the apps Esper installed and manages, say so.
 */

export interface ComponentProps {
  managedDeviceId: ObjectID;
}

const ManagedDeviceAppsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelTable<ManagedDeviceApp>
      modelType={ManagedDeviceApp}
      id="managed-device-apps-table"
      name="Inventory > Item > Installed Apps"
      userPreferencesKey="managed-device-apps-table"
      query={{ managedDeviceId: props.managedDeviceId }}
      selectMoreFields={{
        versionCode: true,
        isKioskApp: true,
        isManagedByService: true,
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy="appName"
      sortOrder={SortOrder.Ascending}
      searchableFields={["appName", "packageName"]}
      searchPlaceholder="Search by app or package name"
      cardProps={{
        title: "Installed Apps",
        description:
          "The apps on this device and their versions, as Esper reported them. Read every 6 hours.",
      }}
      noItemsMessage="No apps read yet. Esper's list of them arrives within a few minutes of the first read."
      filters={[
        {
          field: { versionName: true },
          type: FieldType.Text,
          title: "Version",
        },
      ]}
      columns={[
        {
          field: { appName: true },
          title: "App",
          type: FieldType.Element,
          getLineText: drawsItsOwnLines,
          getElement: (item: ManagedDeviceApp): ReactElement => {
            return (
              <div className="min-w-0">
                <IsolatedLine
                  text={item.appName || item.packageName || ""}
                  className="truncate text-sm font-medium text-gray-900"
                />
                {item.appName && item.packageName ? (
                  <IsolatedLine
                    text={item.packageName}
                    className="truncate font-mono text-xs text-gray-500"
                  />
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { versionName: true },
          title: "Version",
          type: FieldType.Element,
          getLineText: drawsItsOwnLines,
          getElement: (item: ManagedDeviceApp): ReactElement => {
            if (!item.versionName && !item.versionCode) {
              return <TableEmptyValue />;
            }

            return (
              <div className="min-w-0">
                <IsolatedLine
                  text={item.versionName || item.versionCode || ""}
                  className="text-sm text-gray-900"
                />
                {item.versionName && item.versionCode ? (
                  <IsolatedLine
                    text={item.versionCode}
                    className="text-xs text-gray-500"
                  />
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { isKioskApp: true },
          title: "Role",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: ManagedDeviceApp): ReactElement => {
            if (!item.isKioskApp && !item.isManagedByService) {
              return <TableEmptyValue />;
            }

            return (
              <div className="flex flex-wrap gap-1">
                {item.isKioskApp ? (
                  <Pill
                    text="Kiosk App"
                    tone={PillTone.Info}
                    isDotHidden={true}
                  />
                ) : (
                  <></>
                )}
                {item.isManagedByService ? (
                  <Pill
                    text="Managed by Esper"
                    tone={PillTone.Neutral}
                    isDotHidden={true}
                  />
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

export default ManagedDeviceAppsTable;
