import {
  readSessionEndReason,
  SESSION_ENDED_QUERY_PARAM,
  SessionEndReason,
} from "Common/Types/UserSession/SessionLength";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * Why the person on the sign-in page was signed out, when the server ended
 * their session (Common/Types/UserSession/SessionLength.ts): its length or
 * its idle timeout was reached. The Dashboard and the Admin Dashboard send
 * the browser here with ?sessionEnded=<reason> (Common/UI/Utils/
 * SessionEndReturn) and keep the page the person was on, which they are
 * brought back to once they sign in - as this says.
 *
 * A reason this page does not know, and every other way of arriving here,
 * shows nothing.
 */

export const SESSION_ENDED_NOTICE_TEST_ID: string = "session-ended-notice";

// The locale key of what is said for each reason.
export const SESSION_ENDED_NOTICE_KEYS: Readonly<
  Record<SessionEndReason, string>
> = {
  [SessionEndReason.LengthReached]: "login.sessionEnded.lengthReached",
  [SessionEndReason.Inactive]: "login.sessionEnded.inactive",
};

export interface ComponentProps {
  className?: string | undefined;
}

const SessionEndedNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  // Read once, as the page opens: what the address said when the person arrived.
  const [reason] = useState<SessionEndReason | null>(
    (): SessionEndReason | null => {
      return readSessionEndReason(
        Navigation.getQueryStringByName(SESSION_ENDED_QUERY_PARAM),
      );
    },
  );

  if (!reason) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.INFO}
      title={t(SESSION_ENDED_NOTICE_KEYS[reason])}
      className={props.className}
      dataTestId={SESSION_ENDED_NOTICE_TEST_ID}
    />
  );
};

export default SessionEndedNotice;
