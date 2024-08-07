import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { useEffect } from "react";

const Logout: () => JSX.Element = () => {
  const [error, setError] = React.useState<string | null>(null);

  const logout: PromiseVoidFunction = async (): Promise<void> => {
    if (StatusPageUtil.getStatusPageId()) {
      await UserUtil.logout(StatusPageUtil.getStatusPageId()!);
      const navRoute: Route = StatusPageUtil.isPreviewPage()
        ? RouteUtil.populateRouteParams(
            RouteMap[PageMap.PREVIEW_LOGIN]!,
            StatusPageUtil.getStatusPageId()!,
          )
        : RouteUtil.populateRouteParams(
            RouteMap[PageMap.LOGIN]!,
            StatusPageUtil.getStatusPageId()!,
          );
      Navigation.navigate(navRoute, {
        forceNavigate: true,
      });
    }
  };

  useEffect(() => {
    logout().catch((error: Error) => {
      setError(error.message || error.toString());
    });
  }, [StatusPageUtil.getStatusPageId()]);

  if (error) {
    return <ErrorMessage error={error} />;
  }

  return <PageLoader isVisible={true} />;
};

export default Logout;
