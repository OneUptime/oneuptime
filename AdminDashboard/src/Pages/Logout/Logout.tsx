import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "Common/UI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/src/Components/Loader/PageLoader";
import Page from "Common/UI/src/Components/Page/Page";
import { ACCOUNTS_URL } from "Common/UI/src/Config";
import UiAnalytics from "Common/UI/src/Utils/Analytics";
import Navigation from "Common/UI/src/Utils/Navigation";
import UserUtil from "Common/UI/src/Utils/User";
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
