import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import Page from "CommonUI/src/Components/Page/Page";
import { ACCOUNTS_URL } from "CommonUI/src/Config";
import UiAnalytics from "CommonUI/src/Utils/Analytics";
import Navigation from "CommonUI/src/Utils/Navigation";
import UserUtil from "CommonUI/src/Utils/User";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

const Logout: FunctionComponent = (): ReactElement => {
  const [error, setError] = React.useState<string | null>(null);

  const logout: PromiseVoidFunction = async (): Promise<void> => {
    UiAnalytics.logout();
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
      title={"Logout"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.INIT] as Route),
        },
        {
          title: "Logout",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.LOGOUT] as Route),
        },
      ]}
    >
      {!error ? <PageLoader isVisible={true} /> : <></>}
      {error ? <ErrorMessage error={error} /> : <></>}
    </Page>
  );
};

export default Logout;
