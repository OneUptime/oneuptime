import React, { FunctionComponent, ReactElement } from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Host from "Common/Models/DatabaseModels/Host";
import AddHostGuide from "./AddHostGuide";

/*
 * Add Host on the Hosts list: the one-command guide in a dialog, without
 * the guide's own card - the dialog's title says what it is for. Closing it
 * leaves the list, which shows the new host once it has connected.
 */

export interface ComponentProps {
  onClose: () => void;
  onHostConnected?: ((host: Host) => void) | undefined;
}

const AddHostModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Modal
      title="Add Host"
      description="Run one command on the host. It installs the OpenTelemetry Collector, and OneUptime keeps its config up to date: no config.yaml to write."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Done"
    >
      <div data-testid="add-host-modal">
        <AddHostGuide isBare={true} onHostConnected={props.onHostConnected} />
      </div>
    </Modal>
  );
};

export default AddHostModal;
