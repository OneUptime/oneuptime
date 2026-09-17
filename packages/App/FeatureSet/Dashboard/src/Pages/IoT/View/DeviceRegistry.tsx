import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import IoTDeviceCredential from "Common/Models/DatabaseModels/IoTDeviceCredential";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import PermissionUtil from "Common/UI/Utils/Permission";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import User from "Common/UI/Utils/User";

/*
 * Device Registry for a fleet — registered devices and their
 * per-device MQTT credentials. Registering a device:
 *
 *   - issues a per-device credential (this row's ID is the MQTT
 *     username, the secret is the password) scoped to the device's
 *     own topics, individually revocable via the Enabled toggle,
 *   - marks the device as EXPECTED: it survives the stale-inventory
 *     cleanup (shown as Offline instead of vanishing), and the
 *     Device Offline alert template fires when it goes silent.
 *
 * The Device ID must match the device.id label the device stamps on
 * its datapoints (and the <device> segment of its MQTT topics).
 */

const IoTFleetDeviceRegistry: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The secret is readable only by Owner/Admin/ReadIoTDeviceCredential
   * (fleet-only readers deliberately can't). Selecting the column for
   * a user who can't read it makes the whole list request fail, so
   * only add the secret column when the user can read it.
   */
  const canReadSecret: boolean =
    User.isMasterAdmin() ||
    PermissionHelper.doesPermissionsIntersect(
      PermissionUtil.getAllPermissions(),
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ReadIoTDeviceCredential,
      ],
    );

  const secretColumn: Column<IoTDeviceCredential> = {
    field: {
      secretKey: true,
    },
    title: "MQTT Password (Secret)",
    type: FieldType.Element,
    hideOnMobile: true,
    getElement: (item: IoTDeviceCredential): ReactElement => {
      if (!item.secretKey) {
        return <span className="text-sm text-gray-400">—</span>;
      }
      return <HiddenText text={item.secretKey.toString()} isCopyable={true} />;
    },
  };

  return (
    <Fragment>
      <ModelTable<IoTDeviceCredential>
        modelType={IoTDeviceCredential}
        id="iot-device-registry-table"
        userPreferencesKey="iot-device-registry-table"
        query={{
          iotFleetId: modelId,
        }}
        onBeforeCreate={(
          item: IoTDeviceCredential,
        ): Promise<IoTDeviceCredential> => {
          item.iotFleetId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showRefreshButton={true}
        name="IoT Device Registry"
        singularName="Registered Device"
        selectMoreFields={{ name: true }}
        searchableFields={["name", "externalId"]}
        cardProps={{
          title: "Device Registry",
          description:
            "Registered devices get their own MQTT credential (row ID as username, secret as password), individual revocation, and offline alerts when they go silent. The Device ID must match the device.id the device reports.",
        }}
        noItemsMessage={
          "No registered devices. Devices can still report with the project-wide ingestion key — register them here for per-device credentials and silent-death offline detection."
        }
        formFields={[
          {
            field: {
              externalId: true,
            },
            title: "Device ID",
            description:
              "Must match the device.id label the device stamps on its datapoints and MQTT topics.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "sensor-001",
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Boiler room temperature sensor",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            description:
              "Disabled credentials are rejected at connect and pause silent-death detection for the device.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
          },
        ]}
        filters={[]}
        columns={[
          {
            field: {
              externalId: true,
            },
            title: "Device",
            type: FieldType.Element,
            getElement: (item: IoTDeviceCredential): ReactElement => {
              return (
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-900">
                    {(item.name as string) || (item.externalId as string)}
                  </span>
                  {item.name ? (
                    <span className="text-xs text-gray-500">
                      {item.externalId as string}
                    </span>
                  ) : (
                    <Fragment />
                  )}
                </div>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: IoTDeviceCredential): ReactElement => {
              return (
                <StatusBadge
                  text={item.isEnabled === false ? "Revoked" : "Enabled"}
                  type={
                    item.isEnabled === false
                      ? StatusBadgeType.Danger
                      : StatusBadgeType.Success
                  }
                />
              );
            },
          },
          {
            field: {
              _id: true,
            },
            title: "MQTT Username",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTDeviceCredential): ReactElement => {
              return (
                <span className="text-xs font-mono text-gray-700">
                  {item._id?.toString() || "—"}
                </span>
              );
            },
          },
          ...(canReadSecret ? [secretColumn] : []),
          {
            field: {
              lastConnectedAt: true,
            },
            title: "Last Connected",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
        ]}
      />
    </Fragment>
  );
};

export default IoTFleetDeviceRegistry;
