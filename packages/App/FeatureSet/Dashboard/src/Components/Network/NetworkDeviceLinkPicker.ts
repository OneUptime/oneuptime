import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * THE DEVICE AN UNKNOWN SENDER IS LINKED TO, SEARCHED ON THE SERVER (#10646).
 *
 * "It is one of my devices" - on the syslog sources and the flow senders -
 * read the project's first 500 devices by name and offered those: a device
 * past them could not be picked, so its address could not be linked. The
 * dialog's picker searches the server as it is typed in (EntityDropdown),
 * by name or by hostname, which is often what a sender's address is; the
 * hostname is drawn beside each name, so two of one name are told apart.
 * An archived device is hidden from lists, and never offered.
 *
 * The device picked is read again, by its id, just before its Other
 * Addresses are written: the dialog no longer holds a copy read when it
 * opened, which another edit could have changed since.
 */

/*
 * A device by its name, with the address it is reached at beside it when
 * that says more: a device named after its own hostname is not named
 * twice, and one with no name is named by its hostname.
 */
export const formatNetworkDeviceOption: (
  option: DropdownOption,
  record: BaseModel,
) => DropdownOption = (
  option: DropdownOption,
  record: BaseModel,
): DropdownOption => {
  const device: NetworkDevice = record as NetworkDevice;
  const name: string = device.name?.trim() || "";
  const hostname: string = device.hostname?.trim() || "";
  const formatted: DropdownOption = {
    ...option,
    label: name || hostname || option.label,
    // A device's name is its owner's, drawn as written.
    isUserContent: true,
  };

  if (!name || !hostname || name === hostname) {
    delete formatted.description;
  }

  return formatted;
};

export const NETWORK_DEVICE_LINK_PICKER: {
  modelType: typeof NetworkDevice;
  labelField: string;
  valueField: string;
  searchFields: Array<string>;
  descriptionField: string;
  query: Record<string, unknown>;
  formatOption: (option: DropdownOption, record: BaseModel) => DropdownOption;
} = {
  modelType: NetworkDevice,
  labelField: "name",
  valueField: "_id",
  searchFields: ["name", "hostname"],
  descriptionField: "hostname",
  query: { isArchived: false },
  formatOption: formatNetworkDeviceOption,
};

// The device picked, as it is now: null when it is gone.
export const readNetworkDeviceToLink: (
  deviceId: string,
) => Promise<NetworkDevice | null> = async (
  deviceId: string,
): Promise<NetworkDevice | null> => {
  return await ModelAPI.getItem<NetworkDevice>({
    modelType: NetworkDevice,
    id: new ObjectID(deviceId),
    select: {
      _id: true,
      name: true,
      hostname: true,
      otherAddresses: true,
    },
  });
};
