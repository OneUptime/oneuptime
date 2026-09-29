import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LoadingRegion from "../../Components/Skeleton/LoadingRegion";
import Navigation from "Common/UI/Utils/Navigation";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

const Logout: () => JSX.Element = () => {
  const { t } = useTranslation();
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
    return <ErrorMessage message={error} />;
  }

  /*
   * Logout is not in the shell's bypass list, so this renders inside the full
   * page chrome. A bare loader left a 13rem gap with the footer directly under
   * it — the clearest instance of the mid-page footer. Fill the content area
   * instead and say what is happening.
   */
  return (
    <LoadingRegion className="flex min-h-[50vh] items-center justify-center">
      <p className="text-sm text-gray-500">
        {t("accounts.signingOut", { defaultValue: "Signing you out..." })}
      </p>
    </LoadingRegion>
  );
};

export default Logout;
