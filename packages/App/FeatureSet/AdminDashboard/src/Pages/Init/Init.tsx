import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { ServerSetupChecklistAnswer } from "Common/Types/ServerSetup/ServerSetupChecklist";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import { BILLING_ENABLED } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import ServerSetupChecklistLoader from "Common/UI/Utils/ServerSetupChecklist";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * Where /admin lands. While a required check of the server's setup is still
 * open - email, HTTPS, who can sign up - on a self-hosted server, that is
 * Server setup: a new server's first admin is shown what is left without
 * having to find it. Otherwise, and on OneUptime Cloud, or when the
 * checklist cannot be read, Users, as before.
 */
export const getInitialPage: (
  answer: ServerSetupChecklistAnswer | null,
) => PageMap = (answer: ServerSetupChecklistAnswer | null): PageMap => {
  if (!BILLING_ENABLED && answer && answer.openRequired.length > 0) {
    return PageMap.SERVER_SETUP;
  }

  return PageMap.USERS;
};

const Init: FunctionComponent = (): ReactElement => {
  useEffect(() => {
    let isCurrent: boolean = true;

    const answer: Promise<ServerSetupChecklistAnswer | null> = BILLING_ENABLED
      ? Promise.resolve(null)
      : ServerSetupChecklistLoader.load();

    answer
      .catch((): null => {
        return null;
      })
      .then((loaded: ServerSetupChecklistAnswer | null): void => {
        if (!isCurrent) {
          return;
        }

        Navigation.navigate(RouteMap[getInitialPage(loaded)] as Route, {
          forceNavigate: true,
        });
      })
      .catch((): void => {
        // Navigation does not throw.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <Page title={""} breadcrumbLinks={[]}>
      <PageLoader isVisible={true} />
    </Page>
  );
};

export default Init;
