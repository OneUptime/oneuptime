import ServerSetupChecklist from "../../Components/ServerSetup/ServerSetupChecklist";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import {
  useServerSetupChecklist,
  UseServerSetupChecklistResult,
} from "Common/UI/Utils/ServerSetupChecklist";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * SERVER SETUP (/admin/setup): WHAT THIS SERVER STILL NEEDS.
 *
 * The page a new server's first admin lands on in the Admin Dashboard while
 * a required check is open (Init), and the one the Dashboard's card, `npm
 * start`'s last lines and the install guides send them to. Its address is
 * kept: the Welcome checklist (#6803) and the docs (#6827) link to it.
 */

export const SERVER_SETUP_PAGE_TITLE: string = "Server setup";

export const SERVER_SETUP_PAGE_LOAD_ERROR: string =
  "The setup checklist could not be read. Reload the page to try again.";

const SetupPage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const checklist: UseServerSetupChecklistResult = useServerSetupChecklist();

  return (
    <Page
      title={SERVER_SETUP_PAGE_TITLE}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: SERVER_SETUP_PAGE_TITLE,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVER_SETUP] as Route,
          ),
        },
      ]}
    >
      {checklist.isLoading ? (
        <PageLoader isVisible={true} />
      ) : checklist.answer ? (
        <ServerSetupChecklist
          answer={checklist.answer}
          onAnswer={checklist.setAnswer}
        />
      ) : (
        <ErrorMessage message={t(SERVER_SETUP_PAGE_LOAD_ERROR)} />
      )}
    </Page>
  );
};

export default SetupPage;
