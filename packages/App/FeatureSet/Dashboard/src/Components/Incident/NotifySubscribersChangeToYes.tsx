import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import {
  NOTIFY_REVIEW_CHANGE_TO_YES,
  NOTIFY_REVIEW_CHANGE_TO_YES_TEST_ID,
} from "./NewIncidentNotifyDefaultCopy";
import {
  ENABLED_CLASS_NAME,
  LINK_CLASS_NAME,
} from "./SubscriberNotificationPreviewButton";

/*
 * "Change to Yes": a small link beside the "No" of Notify Status Page
 * Subscribers on the last step of Declare New Incident, in a project that
 * starts the box unticked (#7606, NewIncidentNotifyDefaultCopy). Pressing
 * it ticks the box - the incident will then be declared notifying, and the
 * line reads "Yes", with "Preview" beside it and who that reaches under it
 * when the incident is on a monitor. Nothing is sent until the incident is
 * declared.
 *
 * It is drawn as the Preview link on the same line is (its classes, so the
 * two cannot drift apart and the dark theme covers both), as one word or
 * two the size of the text around it. Its name is what it shows, so a voice
 * command can say what it sees.
 */

export interface ComponentProps {
  onClick: () => void;
  dataTestId?: string | undefined;
}

const NotifySubscribersChangeToYes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <button
      type="button"
      data-testid={props.dataTestId || NOTIFY_REVIEW_CHANGE_TO_YES_TEST_ID}
      onClick={() => {
        props.onClick();
      }}
      className={`${LINK_CLASS_NAME} ${ENABLED_CLASS_NAME}`}
    >
      {translateString(NOTIFY_REVIEW_CHANGE_TO_YES) ||
        NOTIFY_REVIEW_CHANGE_TO_YES}
    </button>
  );
};

export default NotifySubscribersChangeToYes;
