import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberUnsubscribe, {
  StatusPageSubscriberUnsubscribeChannel,
  StatusPageSubscriberUnsubscribeCredential,
  StatusPageSubscriberUnsubscribeDetails,
  StatusPageSubscriberUnsubscribeState,
} from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * The page every unsubscribe link in a subscriber notification opens:
 * {statusPageUrl}/unsubscribe/{subscriberId}-{token}.
 *
 * It works on private status pages without signing in - that is what it is
 * for - so it is not an ordinary status page page: it never checks for a
 * signed-in visitor, shows nothing of the status page but its name and logo
 * (which the sign-in page shows anyone anyway), and runs none of the page's
 * custom JavaScript. MasterPage renders it on its own, like the sign-in pages.
 *
 * Opening it changes nothing: it asks the server what the link belongs to and
 * waits for the reader to confirm, because mail scanners open every link and
 * one click is not a decision. The link's credential is taken out of the
 * address bar before anything else on the page runs (SensitiveUrlToken), so
 * it is read from there, not from the route.
 */

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
}

enum PageState {
  Loading = "Loading",
  // The link is good and the subscription is live.
  Confirm = "Confirm",
  // Cancelled just now, by this page.
  Unsubscribed = "Unsubscribed",
  // Cancelled before this visit.
  AlreadyUnsubscribed = "AlreadyUnsubscribed",
  // A link that carries only the subscriber id (see StatusPageSubscriberAPI).
  OutOfDate = "OutOfDate",
  Invalid = "Invalid",
  Error = "Error",
}

const CHANNEL_LABEL_KEYS: Record<
  StatusPageSubscriberUnsubscribeChannel,
  string
> = {
  [StatusPageSubscriberUnsubscribeChannel.Email]:
    "subscribe.unsubscribe.channelEmail",
  [StatusPageSubscriberUnsubscribeChannel.SMS]:
    "subscribe.unsubscribe.channelSms",
  [StatusPageSubscriberUnsubscribeChannel.Slack]:
    "subscribe.unsubscribe.channelSlack",
  [StatusPageSubscriberUnsubscribeChannel.MicrosoftTeams]:
    "subscribe.unsubscribe.channelMicrosoftTeams",
  [StatusPageSubscriberUnsubscribeChannel.Webhook]:
    "subscribe.unsubscribe.channelWebhook",
};

const UnsubscribePage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

  const [credential] =
    useState<StatusPageSubscriberUnsubscribeCredential | null>(() => {
      return StatusPageSubscriberUnsubscribe.parseCredential(
        SensitiveUrlToken.read(),
      );
    });

  const [pageState, setPageState] = useState<PageState>(PageState.Loading);
  const [details, setDetails] =
    useState<StatusPageSubscriberUnsubscribeDetails | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const getApiUrl: () => URL | null = (): URL | null => {
    if (!statusPageId || !credential || !credential.token) {
      return null;
    }

    return URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
      `/unsubscribe/${statusPageId.toString()}/${credential.subscriberId}/${credential.token}`,
    );
  };

  useEffect(() => {
    if (!statusPageId) {
      return;
    }

    if (!credential) {
      setPageState(PageState.Invalid);
      return;
    }

    if (!credential.token) {
      setPageState(PageState.OutOfDate);
      return;
    }

    const loadDetails: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({ url: getApiUrl()! });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const loaded: StatusPageSubscriberUnsubscribeDetails =
          response.data as unknown as StatusPageSubscriberUnsubscribeDetails;

        setDetails(loaded);

        if (loaded.state === StatusPageSubscriberUnsubscribeState.Subscribed) {
          setPageState(PageState.Confirm);
        } else if (
          loaded.state === StatusPageSubscriberUnsubscribeState.Unsubscribed
        ) {
          setPageState(PageState.AlreadyUnsubscribed);
        } else {
          setPageState(PageState.Invalid);
        }
      } catch {
        setPageState(PageState.Error);
      }
    };

    void loadDetails();
  }, [statusPageId?.toString()]);

  const unsubscribe: () => Promise<void> = async (): Promise<void> => {
    const url: URL | null = getApiUrl();

    if (!url) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({ url: url, data: {} });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (
        response.data["state"] ===
        StatusPageSubscriberUnsubscribeState.Unsubscribed
      ) {
        // Done with the credential: a reload shows the invalid-link state, not a second prompt.
        SensitiveUrlToken.clear();
        setPageState(PageState.Unsubscribed);
      } else {
        setPageState(PageState.Invalid);
      }
    } catch {
      setSubmitError(t("subscribe.unsubscribe.failed"));
    }

    setIsSubmitting(false);
  };

  if (!statusPageId) {
    return <PageLoader isVisible={true} />;
  }

  const logoUrl: string | null =
    props.logoFileId && props.logoFileId.toString()
      ? URL.fromString(STATUS_PAGE_API_URL.toString())
          .addRoute(`/logo/${statusPageId.toString()}`)
          .toString()
      : null;

  /*
   * The subscriber's Update Subscription page. It is only offered on a
   * public status page: on a private one it needs a signed-in visitor, which
   * the reader of this page may not be.
   */
  const manageSubscriptionRoute: Route | null =
    credential && !StatusPageUtil.isPrivateStatusPage()
      ? RouteUtil.populateRouteParams(
          StatusPageUtil.isPreviewPage()
            ? (RouteMap[PageMap.PREVIEW_UPDATE_SUBSCRIPTION] as Route)
            : (RouteMap[PageMap.UPDATE_SUBSCRIPTION] as Route),
          new ObjectID(credential.subscriberId),
        )
      : null;

  const renderContact: () => ReactElement | null = (): ReactElement | null => {
    if (!details?.channel) {
      return null;
    }

    const label: string = t(CHANNEL_LABEL_KEYS[details.channel]);

    return (
      <p
        className="mt-4 text-sm text-gray-700 break-words"
        data-testid="unsubscribe-contact"
      >
        {label}
        {details.contact ? (
          <>
            {": "}
            <span className="font-medium text-gray-900">{details.contact}</span>
          </>
        ) : null}
      </p>
    );
  };

  const renderManageLink: (text: string) => ReactElement | null = (
    text: string,
  ): ReactElement | null => {
    if (!manageSubscriptionRoute) {
      return null;
    }

    return (
      <p className="mt-6 text-center text-sm">
        <Link
          to={manageSubscriptionRoute}
          className="font-medium text-indigo-600 hover:text-indigo-500"
        >
          {text}
        </Link>
      </p>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    switch (pageState) {
      case PageState.Loading:
        return (
          <PageLoader
            isVisible={true}
            className="flex w-full items-center justify-center py-4"
          />
        );

      case PageState.Confirm:
        return (
          <div>
            <p className="text-sm text-gray-700">
              {t("subscribe.unsubscribe.confirmPrompt")}
            </p>
            {renderContact()}
            {details?.wasAddedByTeam ? (
              <div
                className="mt-4 rounded-md bg-yellow-50 p-3 text-sm text-yellow-800"
                role="note"
                data-testid="unsubscribe-added-by-team"
              >
                {t("subscribe.unsubscribe.addedByTeamWarning")}
              </div>
            ) : null}
            {submitError ? (
              <p className="mt-4 text-sm text-red-600" role="alert">
                {submitError}
              </p>
            ) : null}
            <div className="mt-6">
              <Button
                title={t("subscribe.unsubscribe.confirmButton")}
                buttonStyle={ButtonStyleType.DANGER}
                isLoading={isSubmitting}
                disabled={isSubmitting}
                className="w-full justify-center"
                dataTestId="unsubscribe-confirm"
                onClick={() => {
                  void unsubscribe();
                }}
              />
            </div>
            {renderManageLink(t("subscribe.unsubscribe.manageInstead"))}
          </div>
        );

      case PageState.Unsubscribed:
        return (
          <div>
            <p className="text-sm text-gray-700" role="status">
              {t("subscribe.unsubscribe.success")}
            </p>
            {renderContact()}
          </div>
        );

      case PageState.AlreadyUnsubscribed:
        return (
          <div>
            <p className="text-sm text-gray-700" role="status">
              {t("subscribe.unsubscribe.alreadyUnsubscribed")}
            </p>
            {renderContact()}
          </div>
        );

      case PageState.OutOfDate:
        return (
          <div>
            <p className="text-sm text-gray-700">
              {t("subscribe.unsubscribe.outOfDateLink")}
            </p>
            {renderManageLink(t("subscribe.unsubscribe.manageSubscription"))}
          </div>
        );

      case PageState.Invalid:
        return (
          <p className="text-sm text-gray-700">
            {t("subscribe.unsubscribe.invalidLink")}
          </p>
        );

      case PageState.Error:
      default:
        return (
          <p className="text-sm text-red-600" role="alert">
            {t("subscribe.unsubscribe.loadFailed")}
          </p>
        );
    }
  };

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {logoUrl ? (
          <img
            style={{ height: "70px", margin: "auto" }}
            src={logoUrl}
            alt={props.statusPageName || ""}
          />
        ) : null}
        <h2 className="mt-6 text-center text-2xl tracking-tight text-gray-900">
          {props.statusPageName
            ? t("subscribe.unsubscribe.titleWithName", {
                statusPageName: props.statusPageName,
              })
            : t("subscribe.unsubscribe.title")}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {renderBody()}
        </div>
      </div>
    </div>
  );
};

export default UnsubscribePage;
