import DeviceManagementProvider, {
  getDeviceManagementProviderTitle,
  isDeviceManagementProvider,
} from "Common/Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "Common/Types/JSON";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import React, { FunctionComponent, ReactElement } from "react";
import {
  DEVICE_MANAGEMENT_PROVIDER_CHOICES,
  DeviceManagementProviderChoice,
} from "./DeviceManagementWords";

/*
 * "Connect device manager" (#9837): which service enrolls the devices -
 * Esper or Microsoft Intune - before that service's own form asks for its
 * settings. One question; nothing is saved here.
 */

export interface ComponentProps {
  onClose: () => void;
  onChoose: (provider: DeviceManagementProvider) => void;
}

export const DEVICE_MANAGER_CARD_OPTIONS: Array<CardSelectOption> =
  DEVICE_MANAGEMENT_PROVIDER_CHOICES.map(
    (choice: DeviceManagementProviderChoice): CardSelectOption => {
      return {
        value: choice.provider,
        // A product name, the same in every language.
        title: getDeviceManagementProviderTitle(choice.provider),
        description: choice.description,
        icon: choice.icon,
      };
    },
  );

const DeviceManagerPickerModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <BasicFormModal<JSONObject>
      title="Connect a device manager"
      description="Choose the service that enrolls your devices. OneUptime only reads from it."
      name="Inventory > Managed Devices > Connect Device Manager"
      modalWidth={ModalWidth.Medium}
      submitButtonText="Continue"
      onClose={props.onClose}
      onSubmit={(values: JSONObject): void => {
        const provider: unknown = values["provider"];

        props.onChoose(
          isDeviceManagementProvider(provider)
            ? provider
            : DeviceManagementProvider.Esper,
        );
      }}
      formProps={{
        id: "choose-device-manager-form",
        initialValues: { provider: DeviceManagementProvider.Esper },
        fields: [
          {
            field: { provider: true },
            title: "Device manager",
            fieldType: FormFieldSchemaType.CardSelect,
            cardSelectSingleColumn: true,
            required: true,
            dataTestId: "device-manager-field",
            cardSelectOptions: DEVICE_MANAGER_CARD_OPTIONS,
          },
        ],
      }}
    />
  );
};

export default DeviceManagerPickerModal;
