import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import RumDocumentationCard from "../RumDocumentationCard";
import { PICK_ANOTHER_KEY } from "../../Telemetry/IngestRefusalWords";

/*
 * "Pick another key" (issue #6378): what a RUM application sends is refused
 * because its key is turned off or expired, so the fix is to send with
 * another. This is the application's own setup guide in a dialog: its first
 * step picks the key (or creates one), and the code under it is filled in
 * with that key, ready to go in place of the refused one. Opened from the
 * setup check and from the empty Exceptions and Logs.
 */

export const PICK_ANOTHER_KEY_DESCRIPTION: string = translationKey(
  "Pick another key in the first step, or create one. The code under it has that key filled in: put it in your app in place of the refused key.",
);

export interface ComponentProps {
  // The application's service.name, filled into the code.
  appName: string;
  // "browser" or "mobile", as ingest records it: which guide, which key type.
  clientType?: string | undefined;
  onClose: () => void;
}

const RumKeySetupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Modal
      title={PICK_ANOTHER_KEY}
      description={PICK_ANOTHER_KEY_DESCRIPTION}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Done"
    >
      <div data-testid="rum-pick-key-setup">
        <RumDocumentationCard
          isBare={true}
          title={PICK_ANOTHER_KEY}
          description={PICK_ANOTHER_KEY_DESCRIPTION}
          appName={props.appName}
          clientType={props.clientType}
        />
      </div>
    </Modal>
  );
};

export default RumKeySetupModal;
