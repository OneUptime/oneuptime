import { getNetworkAddressNameFormFields } from "./NetworkAddressNameFormFields";
import NetworkAddressName from "Common/Models/DatabaseModels/NetworkAddressName";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Name this address" and "Rename" on a Traffic page (issue #5340): the
 * Address Name form in a dialog, the address filled in. The address stays
 * editable - widening 10.18.167.36 to 10.18.167.0/24 names the subnet
 * instead, which is often what was meant. Saved, the page reads its names
 * again.
 */

export interface ComponentProps {
  address: string;
  // Rename: the Address Name the address already has.
  addressNameId?: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}

const NetworkAddressNameModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isRename: boolean = Boolean(props.addressNameId);

  return (
    <ModelFormModal<NetworkAddressName>
      title={isRename ? "Rename this address" : "Name this address"}
      name={isRename ? "Rename an address" : "Name an address"}
      description="The Traffic pages show the address by this name, before any name from your inventory or DNS."
      modelType={NetworkAddressName}
      submitButtonText="Save"
      onClose={props.onClose}
      onSuccess={() => {
        props.onSaved();
      }}
      modelIdToEdit={
        props.addressNameId ? new ObjectID(props.addressNameId) : undefined
      }
      initialValues={isRename ? undefined : { address: props.address }}
      formProps={{
        name: isRename ? "Rename an address" : "Name an address",
        modelType: NetworkAddressName,
        id: "network-address-name-form",
        formType: isRename ? FormType.Update : FormType.Create,
        fields: getNetworkAddressNameFormFields(),
      }}
    />
  );
};

export default NetworkAddressNameModal;
