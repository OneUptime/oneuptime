import React, { FunctionComponent, ReactElement } from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import AddResourceGuide, { ResourceOnboarding } from "./AddResourceGuide";

/*
 * A list's Add button: the resource's Add guide in a dialog, without the
 * guide's own card - the dialog's title says what it is for. Closing it
 * leaves the list, which shows the new resource once it has connected.
 */

export interface ComponentProps {
  onboarding: ResourceOnboarding;
  onClose: () => void;
  onConnected?: ((record: BaseModel) => void) | undefined;
}

const AddResourceModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Modal
      title={props.onboarding.addTitle}
      description={props.onboarding.addDescription}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Done"
    >
      <div data-testid="add-resource-modal">
        <AddResourceGuide
          onboarding={props.onboarding}
          isBare={true}
          onConnected={props.onConnected}
        />
      </div>
    </Modal>
  );
};

export default AddResourceModal;
