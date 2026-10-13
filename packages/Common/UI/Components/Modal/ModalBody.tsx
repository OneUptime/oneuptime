import Alert, { AlertType } from "../Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: Array<ReactElement> | ReactElement;
  error?: string | undefined;
}

/*
 * A dialog's body, with the reason its last action failed - a refusal the
 * server sent back - drawn first, above what the dialog holds. The alert
 * keeps the gap the rest of a dialog's blocks keep: drawn flush, it ran into
 * whatever came first (Start Packet Capture's red refusal sat on its yellow
 * notice, two banners read as one). The Modal brings it into view when it
 * appears.
 */
const ModalBody: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="modal-body">
      {props.error && (
        <Alert
          title={props.error}
          type={AlertType.DANGER}
          className="mb-4"
          dataTestId="modal-error"
        />
      )}
      {props.children}
    </div>
  );
};

export default ModalBody;
