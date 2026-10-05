import IconProp from "Common/Types/Icon/IconProp";
import { SubscriberNotificationPreviewRequest } from "Common/Types/StatusPage/SubscriberNotificationPreview";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import SubscriberNotificationPreviewCopy from "../StatusPage/SubscriberNotificationPreviewCopy";
import SubscriberNotificationPreviewModal from "./SubscriberNotificationPreviewModal";

/*
 * 'Preview': a small link on the line of the value that sets an incident
 * notification off - beside the "Yes" of Notify Status Page Subscribers on
 * the last step of declaring an incident, and beside the public note
 * composer's "Notify status page subscribers" box. It opens
 * SubscriberNotificationPreviewModal with the draft as it stands when it is
 * pressed.
 *
 * "This preview notification button is quite big. Can we please improve the
 * UI?" It was a bordered, shadowed button with a 20px envelope on a line of
 * its own under the value - as wide as the screen on a phone - so it read as
 * the next thing to do rather than as part of the answer above it. Now it is
 * one word and an eye in the link colour, on the value's own line, the size
 * of the text around it.
 *
 * - Its accessible name is "Preview notification": it says what is previewed
 *   when it is read on its own (a screen reader's list of buttons), and it
 *   holds the word on screen, so a voice command can say what it sees
 *   ("click Preview"). Every locale's name holds that locale's word
 *   (App/Tests/Dashboard/SubscriberNotificationPreviewWiring.test.ts).
 * - Nothing to preview yet (a note with no text): grey, and still a stop for
 *   the keyboard - aria-disabled rather than disabled - so the reason can be
 *   read: the tooltip shows it on hover and focus, aria-describedby reads
 *   it. Pressing it does nothing.
 * - It says it opens a dialog (aria-haspopup), and the dialog hands the
 *   focus back to it when it closes (Modal).
 * - Its hit area is 24px tall while it takes the 20px of a line of text, so
 *   the line it sits on keeps its height.
 * - Every colour it draws with has a dark theme rule in Theme.css
 *   (App/Tests/Dashboard/SubscriberNotificationPreviewDarkMode.test.ts), and
 *   the underline it gains on hover shows in both themes.
 */

export interface ComponentProps {
  /*
   * The draft to preview, read when the link is pressed. Null opens
   * nothing.
   */
  getRequest: () => SubscriberNotificationPreviewRequest | null;
  // Nothing to preview yet: grey, with disabledReason saying why.
  isDisabled?: boolean | undefined;
  disabledReason?: string | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

// The link colour, underlined on hover.
const ENABLED_CLASS_NAME: string =
  "cursor-pointer text-indigo-600 hover:text-indigo-700 hover:underline";

const DISABLED_CLASS_NAME: string = "cursor-not-allowed text-gray-400";

/*
 * The size of the text it sits in. The padding makes the hit area 24px tall
 * and gives the focus ring room around the word; the negative margins take
 * that padding back out of the layout, so the line keeps the height and the
 * spacing it had without the link.
 */
const LINK_CLASS_NAME: string =
  "-mx-1 -my-0.5 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-sm font-medium underline-offset-2 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const SubscriberNotificationPreviewButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const reasonId: string = useId();
  const [openRequest, setOpenRequest] =
    useState<SubscriberNotificationPreviewRequest | null>(null);

  const dataTestId: string =
    props.dataTestId || "subscriber-notification-preview-button";
  const isDisabled: boolean = Boolean(props.isDisabled);
  const disabledReason: string =
    isDisabled && props.disabledReason ? props.disabledReason : "";

  const link: ReactElement = (
    <button
      type="button"
      data-testid={dataTestId}
      aria-label={translate(
        SubscriberNotificationPreviewCopy.previewButtonAccessibleName,
      )}
      aria-haspopup="dialog"
      aria-disabled={isDisabled ? true : undefined}
      aria-describedby={disabledReason ? reasonId : undefined}
      onClick={() => {
        if (isDisabled) {
          return;
        }

        const request: SubscriberNotificationPreviewRequest | null =
          props.getRequest();

        if (request) {
          setOpenRequest(request);
        }
      }}
      className={`${LINK_CLASS_NAME} ${
        isDisabled ? DISABLED_CLASS_NAME : ENABLED_CLASS_NAME
      } ${props.className || ""}`}
    >
      <Icon icon={IconProp.Eye} className="h-4 w-4 shrink-0" />
      <span>{translate(SubscriberNotificationPreviewCopy.previewButton)}</span>
    </button>
  );

  return (
    <>
      {disabledReason ? (
        <>
          {/*
           * The reason sits outside the link, so it describes the link
           * without becoming part of its name.
           */}
          <Tooltip text={disabledReason} isTriggerAlreadyDescribed={true}>
            {link}
          </Tooltip>
          <span
            id={reasonId}
            className="sr-only"
            data-testid={`${dataTestId}-reason`}
          >
            {translate(disabledReason)}
          </span>
        </>
      ) : (
        link
      )}
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
    </>
  );
};

export default SubscriberNotificationPreviewButton;
