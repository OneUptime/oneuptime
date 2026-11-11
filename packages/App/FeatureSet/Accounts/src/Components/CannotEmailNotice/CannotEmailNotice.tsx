import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a page that would have emailed its reader says in place of its form
 * while the server cannot send email yet (GET /global-config/vars'
 * canSendEmail): that it cannot, and who can let them in instead. Forgot
 * password and the sign-in link page draw it, each in its own words.
 *
 * The same for everyone who opens the page - a fact about the server, never
 * about an account.
 */

export interface ComponentProps {
  text: string;
  testId: string;
}

const CannotEmailNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Alert
      type={AlertType.WARNING}
      title={props.text}
      dataTestId={props.testId}
    />
  );
};

export default CannotEmailNotice;
