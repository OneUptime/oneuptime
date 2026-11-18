import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import { ACCOUNTS_URL } from "Common/UI/Config";
import UiAnalytics from "Common/UI/Utils/Analytics";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { useTranslation } from "react-i18next";

const Logout: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [error, setError] = React.useState<string | null>(null);

  const logout: PromiseVoidFunction = async (): Promise<void> => {
    UiAnalytics.logout();
    /*
     * The sign-in page opens only once the server has signed this browser
     * out, or the wait for it is over (issue #9508): opened at once, it
     * cancelled the sign-out in Firefox, which left the session's cookies
     * behind for the next person on the browser.
     */
    await UserUtil.logout();
    Navigation.navigate(ACCOUNTS_URL);
  };

  useEffect(() => {
    logout().catch((error: Error) => {
      setError(error.message || error.toString());
    });
  }, []);

  return (
    <Page
      title={t("pages.signOut.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.INIT] as Route),
        },
        {
          title: t("breadcrumbs.signOut"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.LOGOUT] as Route),
        },
      ]}
    >
      {!error ? <PageLoader isVisible={true} /> : <></>}
      {error ? <ErrorMessage message={error} /> : <></>}
    </Page>
  );
};

export default Logout;
