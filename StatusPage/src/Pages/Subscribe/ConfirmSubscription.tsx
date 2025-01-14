import Page from "../../Components/Page/Page";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Navigation from "Common/UI/Utils/Navigation";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import PageComponentProps from "../PageComponentProps";

const SubscribePage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const id: ObjectID = LocalStorage.getItem("statusPageId") as ObjectID;

  const [isLaoding, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const confirmSubscription: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const statusPageSubscriberId: string =
        Navigation.getLastParamAsObjectID().toString();
      const token: string | null =
        Navigation.getQueryStringByName("verification-token");

      if (!token) {
        setError("Token is required");
        return;
      }

      if (!statusPageSubscriberId) {
        setError("Subscriber ID is required");
        return;
      }

      // hit the confirm subscription endpoint
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get(
          URL.fromString(STATUS_PAGE_API_URL.toString())
            .addRoute(`/confirm-subscription/${statusPageSubscriberId}`)
            .addQueryParam("verification-token", token),
        );

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setError("Subscription confirmed successfully");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    confirmSubscription().catch((error: Error) => {
      setError(error.message);
    });
  }, []);

  if (!id) {
    throw new BadDataException("Status Page ID is required");
  }

  StatusPageUtil.checkIfUserHasLoggedIn();

  return (
    <Page
      title={"Confirm Subscription"}
      breadcrumbLinks={[
        {
          title: "Overview",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
              : (RouteMap[PageMap.OVERVIEW] as Route),
          ),
        },
        {
          title: "Confirm Subscription",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_CONFIRM_SUBSCRIPTION] as Route)
              : (RouteMap[PageMap.CONFIRM_SUBSCRIPTION] as Route),
          ),
        },
      ]}
    >
      {isLaoding ? <PageLoader isVisible={isLaoding} /> : <></>}

      {error ? <ErrorMessage message={error} /> : <></>}
    </Page>
  );
};

export default SubscribePage;
