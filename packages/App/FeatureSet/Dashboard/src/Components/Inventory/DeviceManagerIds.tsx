import { getDeviceManagementProviderTitle } from "Common/Types/DeviceManagement/DeviceManagementProvider";
import {
  ManagedDeviceServiceId,
  getManagedDeviceServiceIds,
} from "Common/Types/DeviceManagement/ManagedDeviceIdentity";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE ID EACH DEVICE MANAGER KNOWS A DEVICE BY, IN INVENTORY (#10097).
 *
 * Esper cannot grant the OneUptime Android agent READ_LOGS, READ_DROPBOX_DATA
 * or usage access (#9967): over Secure Remote ADB, one device at a time,
 * `espercli secureadb connect --device <ID>` does, and it takes the device's
 * Esper ID, which only Esper's console showed. Each import writes the ID its
 * service knows the device by on the device's host
 * (ManagedDeviceIdentity.getManagedDeviceServiceIds), so Inventory > All
 * Items shows it in a Device Manager ID column, beside Agent Permissions:
 * filtered to Missing and exported, the list holds each device's ID, ready
 * for a loop over the command. Microsoft Intune's, Workspace ONE UEM's and
 * SOTI MobiControl's IDs are the ones their consoles and APIs show a device
 * by, so the column reads them too.
 *
 * A cell holds each ID, with a copy button, and the device manager it is
 * from under it - a device two device managers enroll, moved from one to
 * the other, has both. A device no device manager imports reads the quiet
 * dash. The CSV export writes the IDs alone, as a command takes them.
 */

export const DEVICE_MANAGER_ID_TITLE: string =
  translationKey("Device Manager ID");

export interface ComponentProps {
  attributes: unknown;
}

const DeviceManagerIds: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const ids: Array<ManagedDeviceServiceId> = getManagedDeviceServiceIds(
    props.attributes,
  );

  if (ids.length === 0) {
    return <TableEmptyValue />;
  }

  // Named as the asset details' copy buttons are: "Copy Device Manager ID".
  const copyTitle: string = translator.translateTemplate("Copy {{name}}", {
    name:
      translator.translateText(DEVICE_MANAGER_ID_TITLE) ||
      DEVICE_MANAGER_ID_TITLE,
  });

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      {ids.map((id: ManagedDeviceServiceId): ReactElement => {
        return (
          <div
            key={id.provider}
            className="min-w-0"
            data-testid={`device-manager-id-${id.provider}`}
          >
            <div className="flex min-w-0 items-center gap-x-1">
              <code className="min-w-0 break-all rounded bg-gray-100 px-1 text-xs text-gray-700">
                {id.deviceId}
              </code>
              <CopyTextButton
                textToBeCopied={id.deviceId}
                iconOnly={true}
                title={copyTitle}
              />
            </div>
            {/* A product's name, the same in every language. */}
            <div className="mt-0.5 text-xs text-gray-500">
              {getDeviceManagementProviderTitle(id.provider)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// What the CSV export writes: the IDs alone, as a command takes them.
export function getDeviceManagerIdsExportValue(attributes: unknown): string {
  return getManagedDeviceServiceIds(attributes)
    .map((id: ManagedDeviceServiceId): string => {
      return id.deviceId;
    })
    .join(", ");
}

export default DeviceManagerIds;
