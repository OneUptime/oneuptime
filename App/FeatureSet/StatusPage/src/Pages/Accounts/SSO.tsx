import {
  STATUS_PAGE_API_URL,
  STATUS_PAGE_SSO_API_URL,
} from "../../Utils/Config";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelList from "Common/UI/Components/ModelList/ModelList";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import React, { FunctionComponent, useState } from "react";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
}

const LoginPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const statusPageObjectId: ObjectID | null = StatusPageUtil.getStatusPageId();
  const statusPageId: string | undefined = statusPageObjectId?.toString();
  const requiresMasterPasswordLock: boolean =
    StatusPageUtil.isPrivateStatusPage() &&
    StatusPageUtil.requiresMasterPassword() &&
    !StatusPageUtil.isMasterPasswordValidated();
  const logoUrl: string | null =
    props.logoFileId && props.logoFileId.toString() && statusPageId
      ? URL.fromString(STATUS_PAGE_API_URL.toString())
          .addRoute(`/logo/${statusPageId}`)
          .toString()
      : null;

  if (!statusPageObjectId) {
    return <></>;
  }

  if (requiresMasterPasswordLock) {
    StatusPageUtil.navigateToMasterPasswordPage();
    return <></>;
  }

  if (!StatusPageUtil.isPrivateStatusPage()) {
    Navigation.navigate(
      new Route(
        StatusPageUtil.isPreviewPage()
          ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
          : "/",
      ),
    );
  }

  if (statusPageObjectId && UserUtil.isLoggedIn(statusPageObjectId)) {
    const safeRedirectUrl: string | null = StatusPageUtil.getSafeRedirectUrl();
    if (safeRedirectUrl) {
      Navigation.navigate(new Route(safeRedirectUrl));
    } else {
      Navigation.navigate(StatusPageUtil.getDefaultRedirectRoute());
    }
  }

  const safeRedirectUrlForStorage: string | null =
    StatusPageUtil.getSafeRedirectUrl();
  if (safeRedirectUrlForStorage) {
    // save this to local storage, so in the overview page. We can redirect to this page.
    LocalStorage.setItem("redirectUrl", safeRedirectUrlForStorage);
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {logoUrl ? (
          <img style={{ height: "70px", margin: "auto" }} src={logoUrl} />
        ) : (
          <></>
        )}
        <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
          Log in with SSO
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Please login to view {props.statusPageName || "Status Page"}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <ModelList<StatusPageSSO>
            id="sso-list"
            overrideFetchApiUrl={URL.fromString(
              STATUS_PAGE_API_URL.toString(),
            ).addRoute("/sso/" + StatusPageUtil.getStatusPageId()?.toString())}
            modelType={StatusPageSSO}
            titleField="name"
            descriptionField="description"
            select={{
              name: true,
              description: true,
              _id: true,
            }}
            noItemsMessage="No SSO Providers Configured or Enabled"
            onSelectChange={(list: Array<StatusPageSSO>) => {
              if (list && list.length > 0) {
                setIsLoading(true);
                Navigation.navigate(
                  URL.fromURL(STATUS_PAGE_SSO_API_URL).addRoute(
                    new Route(
                      `/${StatusPageUtil.getStatusPageId()?.toString()}/${
                        list[0]?._id
                      }`,
                    ),
                  ),
                );
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
