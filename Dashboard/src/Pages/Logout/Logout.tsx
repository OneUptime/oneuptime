import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import Page from "CommonUI/src/Components/Page/Page";
import { ACCOUNTS_URL } from "CommonUI/src/Config";
import UiAnalytics from "CommonUI/src/Utils/Analytics";
import Navigation from "CommonUI/src/Utils/Navigation";
import UserUtil from "CommonUI/src/Utils/User";
import React, { FunctionComponent, ReactElement } from "react";
import useAsyncEffect from "use-async-effect";

const Logout: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [error, setError] = React.useState<string | null>(null);

  useAsyncEffect(async () => {
    try {
      UiAnalytics.logout();
      await UserUtil.logout();
      Navigation.navigate(ACCOUNTS_URL);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || err.toString());
      } else {
        setError("Unknown error");
      }
    }
  }, []);

  return (
    <Page
      title={"Logout"}
      breadcrumbLinks={[
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
