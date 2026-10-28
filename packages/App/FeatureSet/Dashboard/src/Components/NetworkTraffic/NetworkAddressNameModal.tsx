import { getNetworkAddressNameFormFields } from "./NetworkAddressNameFormFields";
import NetworkAddressName from "Common/Models/DatabaseModels/NetworkAddressName";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Name this address" on a Traffic page (issue #5340): the Address Name
 * form in a dialog, the address filled in. The address stays editable -
 * widening 10.18.167.36 to 10.18.167.0/24 names the subnet instead, which
 * is often what was meant. Saved, the page reads its names again.
 *
 * It only adds a name. A name someone gave is changed in one place,
 * Network > Settings > Address Names, where the card's Edit in Settings
 * goes (ResourceDetailsOnePlaceGuard holds every detail to one form).
 */

export interface ComponentProps {
  address: string;
  onClose: () => void;
  onSaved: () => void;
}

const NetworkAddressNameModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelFormModal<NetworkAddressName>
      title="Name this address"
      name="Name an address"
      description="The Traffic pages show the address by this name, before any name from your inventory or DNS."
      modelType={NetworkAddressName}
      submitButtonText="Save"
      onClose={props.onClose}
      onSuccess={() => {
        props.onSaved();
      }}
      initialValues={{ address: props.address }}
      formProps={{
        name: "Name an address",
        modelType: NetworkAddressName,
        id: "network-address-name-form",
        formType: FormType.Create,
        fields: getNetworkAddressNameFormFields(),
      }}
    />
  );
};

export default NetworkAddressNameModal;
