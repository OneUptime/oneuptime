import IconProp from "Common/Types/Icon/IconProp";
import { SubscriberNotificationPreviewRequest } from "Common/Types/StatusPage/SubscriberNotificationPreview";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement, useState } from "react";
import SubscriberNotificationPreviewCopy from "../StatusPage/SubscriberNotificationPreviewCopy";
import SubscriberNotificationPreviewModal from "./SubscriberNotificationPreviewModal";

/*
 * 'Preview notification', where an incident notification is about to be
 * set off: the last step of declaring an incident, and the public note
 * composer. Opens SubscriberNotificationPreviewModal with the draft as it
 * stands when clicked.
 */

export interface ComponentProps {
  /*
   * The draft to preview, read when the button is clicked. Null disables the
   * button, with disabledReason as its tooltip.
   */
  getRequest: () => SubscriberNotificationPreviewRequest | null;
  isDisabled?: boolean | undefined;
  disabledReason?: string | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const SubscriberNotificationPreviewButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [openRequest, setOpenRequest] =
    useState<SubscriberNotificationPreviewRequest | null>(null);

  const dataTestId: string =
    props.dataTestId || "subscriber-notification-preview-button";

  return (
    <div className={props.className || "mt-2"}>
      <Button
        title={SubscriberNotificationPreviewCopy.previewButton}
        icon={IconProp.Email}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        disabled={props.isDisabled}
        tooltip={props.isDisabled ? props.disabledReason : undefined}
        dataTestId={dataTestId}
        onClick={() => {
          const request: SubscriberNotificationPreviewRequest | null =
            props.getRequest();

          if (request) {
            setOpenRequest(request);
          }
        }}
      />
      {openRequest ? (
        <SubscriberNotificationPreviewModal
          request={openRequest}
          onClose={() => {
            setOpenRequest(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SubscriberNotificationPreviewButton;
