import HelpAndSupport from "Common/UI/Utils/HelpAndSupport";
import UserUtil from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * WHERE THIS SERVER SENDS ITS PEOPLE FOR HELP, READ ONCE WHEN THE DASHBOARD
 * STARTS (#10864-#10866).
 *
 * env.js already said every place's choice, the support address and the
 * help page. The links it holds back - a chat link of the server's own,
 * often an invitation into its workspace, and the mobile app's page - are
 * read here, for a signed-in person, and every component that draws one is
 * drawn again when they arrive (useHelpAndSupport). Where they cannot be
 * read, those places show nothing rather than OneUptime's.
 */
const HelpAndSupportInit: FunctionComponent = (): ReactElement => {
  useEffect(() => {
    if (UserUtil.isLoggedIn()) {
      void HelpAndSupport.load();
    }
  }, []);

  return <></>;
};

export default HelpAndSupportInit;
