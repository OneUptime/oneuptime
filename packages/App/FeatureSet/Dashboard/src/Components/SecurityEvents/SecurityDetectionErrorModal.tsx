import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { VoidFunction } from "Common/Types/FunctionTypes";
import GenericObject from "Common/Types/GenericObject";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { SecurityDetectionMessage } from "./SecurityDetectionStatus";

/*
 * A threat intel feed's or a detection rule's last messages in full, from
 * its row's View Error: each under the column it is stored in (Last Error,
 * Last Match Error), each with its own copy button, as a Security Event
 * Connection's View Error shows its error.
 */

export interface ComponentProps {
  // The feed or rule the messages are about, as its row names it.
  itemName: string;
  messages: Array<SecurityDetectionMessage>;
  onClose: () => void;
}

const SecurityDetectionErrorModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * A failure is what support asks for. A run's note about its own work
   * (an overflow) is advice for whoever reads it, so it is not offered to
   * support, and its button copies a message, not an error.
   */
  const hasFailure: boolean = props.messages.some(
    (item: SecurityDetectionMessage): boolean => {
      return !item.isNotice;
    },
  );

  return (
    <Modal
      title={props.itemName}
      description={
        hasFailure
          ? "Copy this message when contacting support. Credentials are redacted."
          : undefined
      }
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div className="space-y-5" data-testid="security-detection-messages">
        {props.messages.map((item: SecurityDetectionMessage): ReactElement => {
          const label: string =
            translator.translateText(item.label) || item.label;

          return (
            <section key={item.label} className="space-y-2" aria-label={label}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-gray-900">{label}</h3>
                <CopyTextButton
                  textToBeCopied={item.message}
                  label={item.isNotice ? "Copy" : "Copy Error"}
                  size="sm"
                  variant="soft"
                />
              </div>
              <pre
                aria-label={
                  item.isNotice
                    ? label
                    : translator.translateText("Full error message")
                }
                tabIndex={0}
                /*
                 * An error keeps the monospace a pre draws, as the
                 * connections' View Error does; a note is a sentence, in the
                 * page's own type.
                 */
                className={`max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm text-gray-800 ${
                  item.isNotice ? "[font-family:inherit]" : ""
                }`}
              >
                {item.message}
              </pre>
            </section>
          );
        })}
      </div>
    </Modal>
  );
};

export default SecurityDetectionErrorModal;

export interface SecurityDetectionErrors<T> {
  // Opens the dialog on this feed's or rule's messages.
  show: (item: T) => void;
  // The dialog while it is open, for the page to render.
  element: ReactElement | null;
}

/*
 * The page's half of View Error: which row's messages are open, and the
 * dialog that shows them. A hook, so a page needs no state of its own for it.
 */
export function useSecurityDetectionErrors<
  T extends { name?: string | undefined },
>(
  getMessages: (item: T) => Array<SecurityDetectionMessage>,
): SecurityDetectionErrors<T> {
  const [openItem, setOpenItem] = useState<T | null>(null);

  const messages: Array<SecurityDetectionMessage> = openItem
    ? getMessages(openItem)
    : [];

  return {
    show: (item: T): void => {
      setOpenItem(item);
    },
    element:
      openItem && messages.length > 0 ? (
        <SecurityDetectionErrorModal
          itemName={openItem.name || ""}
          messages={messages}
          onClose={(): void => {
            setOpenItem(null);
          }}
        />
      ) : null,
  };
}

/*
 * View Error on a row with a message: reading it is the row's one obvious
 * next step, so it is the row's button, ahead of the call to action the row
 * shows otherwise. Rows without a message do not show it.
 */
export function getViewErrorActionButton<T extends GenericObject>(data: {
  getMessages: (item: T) => Array<SecurityDetectionMessage>;
  show: (item: T) => void;
}): ActionButtonSchema<T> {
  return {
    title: "View Error",
    buttonStyleType: ButtonStyleType.OUTLINE,
    icon: IconProp.Error,
    placement: ActionButtonPlacement.Primary,
    isVisible: (item: T): boolean => {
      return data.getMessages(item).length > 0;
    },
    onClick: (item: T, onCompleteAction: VoidFunction): void => {
      data.show(item);
      onCompleteAction();
    },
  };
}
