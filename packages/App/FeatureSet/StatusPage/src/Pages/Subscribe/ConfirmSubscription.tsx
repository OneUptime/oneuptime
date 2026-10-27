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
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormSkeleton } from "../../Components/Skeleton/PageSkeletons";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import Navigation from "Common/UI/Utils/Navigation";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import PageComponentProps from "../PageComponentProps";
import {
  ConfirmationSignUpChannels,
  LINK_NOT_VALID_STATUS_CODES,
  getConfirmationSignUpPage,
} from "./ConfirmationSignUpPage";

export interface ComponentProps extends PageComponentProps {
  /*
   * The channels the page offers that confirm by a link, for the way to a
   * new link when this one has expired or is not valid.
   */
  signUpChannels: ConfirmationSignUpChannels;
}

// What opening the link came to.
enum ConfirmationState {
  Confirming = "confirming",
  Confirmed = "confirmed",
  // The link confirms nothing: it has expired, or it is not valid.
  LinkNotValid = "link-not-valid",
  // Something else went wrong: the server, the network.
  Failed = "failed",
}

const ConfirmSubscription: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  // The status page this tab shows (checked below, before anything is drawn).
  const id: ObjectID = StatusPageUtil.getStatusPageId() as ObjectID;

  const [state, setState] = useState<ConfirmationState>(
    ConfirmationState.Confirming,
  );
  const [failure, setFailure] = useState<string>("");

  const confirmSubscription: PromiseVoidFunction = async (): Promise<void> => {
    let statusPageSubscriberId: string = "";

    try {
      statusPageSubscriberId = Navigation.getLastParamAsObjectID().toString();
    } catch {
      statusPageSubscriberId = "";
    }

    const token: string | null =
      Navigation.getQueryStringByName("verification-token");

    // A link with a part missing confirms nothing.
    if (!token || !statusPageSubscriberId) {
      setState(ConfirmationState.LinkNotValid);
      return;
    }

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get({
          url: URL.fromString(STATUS_PAGE_API_URL.toString())
            .addRoute(`/confirm-subscription/${statusPageSubscriberId}`)
            .addQueryParam("verification-token", token),
        });

      if (response instanceof HTTPErrorResponse) {
        if (LINK_NOT_VALID_STATUS_CODES.includes(response.statusCode)) {
          setState(ConfirmationState.LinkNotValid);
          return;
        }

        throw response;
      }

      setState(ConfirmationState.Confirmed);
    } catch (err) {
      setFailure(API.getFriendlyMessage(err));
      setState(ConfirmationState.Failed);
    }
  };

  useEffect(() => {
    confirmSubscription().catch((error: Error) => {
      setFailure(error.message);
      setState(ConfirmationState.Failed);
    });
  }, []);

  if (!id) {
    throw new BadDataException("Status Page ID is required");
  }

  StatusPageUtil.checkIfUserHasLoggedIn();

  // Where to sign up again for a new link.
  const signUpPage: PageMap | null = getConfirmationSignUpPage({
    channels: props.signUpChannels,
    isPreview: Boolean(StatusPageUtil.isPreviewPage()),
  });

  const renderBody: () => ReactElement = (): ReactElement => {
    if (state === ConfirmationState.Confirming) {
      return <FormSkeleton />;
    }

    if (state === ConfirmationState.Confirmed) {
      return <ErrorMessage message={t("subscribe.confirm.success")} />;
    }

    if (state === ConfirmationState.LinkNotValid) {
      return (
        <div data-testid="confirm-subscription-link-not-valid">
          <ErrorMessage
            message={t("subscribe.confirm.linkNotValid")}
            action={
              signUpPage ? (
                <Button
                  title={t("subscribe.confirm.subscribeAgain")}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  dataTestId="confirm-subscription-subscribe-again"
                  onClick={() => {
                    Navigation.navigate(
                      RouteUtil.populateRouteParams(
                        RouteMap[signUpPage] as Route,
                      ),
                    );
                  }}
                />
              ) : undefined
            }
          />
        </div>
      );
    }

    return <ErrorMessage message={failure} />;
  };

  return (
    <Page
      title={t("subscribe.confirm.title")}
      breadcrumbLinks={[
        {
          title: t("nav.overview"),
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
              : (RouteMap[PageMap.OVERVIEW] as Route),
          ),
        },
        {
          title: t("subscribe.confirm.title"),
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_CONFIRM_SUBSCRIPTION] as Route)
              : (RouteMap[PageMap.CONFIRM_SUBSCRIPTION] as Route),
          ),
        },
      ]}
    >
      {renderBody()}
    </Page>
  );
};

export default ConfirmSubscription;
