// Tailwind
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Email from "Common/Types/Email";
import { getSupportEmailAddress } from "Common/Types/HelpAndSupport/HelpAndSupport";
import NotFound from "Common/UI/Components/404";
import Page from "Common/UI/Components/Page/Page";
import { useHelpAndSupport } from "Common/UI/Utils/HelpAndSupport";
import React, { FunctionComponent, ReactElement } from "react";

const PageNotFound: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Contact Support writes to the server's support address: OneUptime's,
   * the server's own, or none where its admins hid it (Help and Support).
   */
  const supportEmail: string | null = getSupportEmailAddress(
    useHelpAndSupport(),
  );

  return (
    <Page title={""} breadcrumbLinks={[]}>
      <NotFound
        homeRoute={new Route("/dashboard")}
        supportEmail={supportEmail ? new Email(supportEmail) : null}
      />
    </Page>
  );
};

export default PageNotFound;
