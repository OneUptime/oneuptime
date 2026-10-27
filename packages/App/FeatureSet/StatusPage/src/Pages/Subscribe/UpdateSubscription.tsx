import Page from "../../Components/Page/Page";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import StatusPageModelAPI from "../../Utils/ModelAPI";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import { getManageLinkRequestPage } from "./ManageLinkRequestPage";
import { SubscribePageProps } from "./SubscribePageUtils";
import PageMap from "../../Utils/PageMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberUnsubscribe, {
  StatusPageSubscriberUnsubscribeCredential,
  StatusPageSubscriberUnsubscribeDetails,
  StatusPageSubscriberUnsubscribeState,
} from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { CategoryCheckboxOptionsAndCategories } from "Common/UI/Components/CategoryCheckbox/Index";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelForm, {
  FormType,
  ModelField,
} from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormSkeleton } from "../../Components/Skeleton/PageSkeletons";
import Navigation from "Common/UI/Utils/Navigation";
import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";
import SubscriberUtil from "Common/UI/Utils/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * The subscriber's manage page:
 * {statusPageUrl}/update-subscription/{subscriberId}-{token}.
 *
 * Its link carries the subscription's token, like the unsubscribe link, and
 * the page's two routes (get-subscription and update-subscription) answer
 * only for the subscription that token belongs to: the subscriber id alone,
 * which the team sees on the dashboard, opens nothing. The credential is
 * taken out of the address bar before anything else on the page runs
 * (SensitiveUrlToken), so it is read from there, not from the route - which
 * is also how the unsubscribe page's "manage instead" link hands it over.
 *
 * The page asks the server what the link belongs to first, through the
 * unsubscribe link's read-only route, so a link that does not open a
 * subscription - an old one that carries only the subscriber id, a
 * truncated one, one for a subscription that was removed - says so in the
 * visitor's language, with the way to get a new one, rather than as an
 * error from the form.
 */

enum LinkState {
  Checking = "Checking",
  Valid = "Valid",
  // Out of date (no token), malformed, or not a subscription's link.
  NotValid = "NotValid",
  Error = "Error",
}

const SubscribePage: FunctionComponent<SubscribePageProps> = (
  props: SubscribePageProps,
): ReactElement => {
  const { t } = useTranslation();

  const [credential] =
    useState<StatusPageSubscriberUnsubscribeCredential | null>(() => {
      return StatusPageSubscriberUnsubscribe.parseCredential(
        SensitiveUrlToken.read(),
      );
    });

  const [linkState, setLinkState] = useState<LinkState>(() => {
    return credential && credential.token
      ? LinkState.Checking
      : LinkState.NotValid;
  });

  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  // The status page this tab shows (checked below, before anything is drawn).
  const statusPageId: ObjectID = StatusPageUtil.getStatusPageId() as ObjectID;

  // ".../{statusPageId}/{subscriberId}/{token}" for the page's three routes.
  const credentialRoute: string =
    statusPageId && credential && credential.token
      ? `/${statusPageId.toString()}/${credential.subscriberId}/${credential.token}`
      : "";

  const updateApiUrl: URL = URL.fromString(
    STATUS_PAGE_API_URL.toString(),
  ).addRoute(`/update-subscription${credentialRoute}`);

  const getSubscriptionUrl: URL = URL.fromString(
    STATUS_PAGE_API_URL.toString(),
  ).addRoute(`/get-subscription${credentialRoute}`);

  const [
    categoryCheckboxOptionsAndCategories,
    setCategoryCheckboxOptionsAndCategories,
  ] = useState<CategoryCheckboxOptionsAndCategories>({
    categories: [],
    options: [],
  });

  const [isLaoding, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const checkLink: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
            `/${StatusPageSubscriberUnsubscribe.PAGE_ROUTE_SEGMENT}${credentialRoute}`,
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const details: StatusPageSubscriberUnsubscribeDetails =
        response.data as unknown as StatusPageSubscriberUnsubscribeDetails;

      setLinkState(
        details.state === StatusPageSubscriberUnsubscribeState.Invalid
          ? LinkState.NotValid
          : LinkState.Valid,
      );
    } catch {
      setLinkState(LinkState.Error);
    }
  };

  useEffect(() => {
    if (linkState !== LinkState.Checking || !credentialRoute) {
      return;
    }

    void checkLink();
  }, [credentialRoute]);

  const fetchCheckboxOptionsAndCategories: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        setIsLoading(true);

        const result: CategoryCheckboxOptionsAndCategories =
          await SubscriberUtil.getCategoryCheckboxPropsBasedOnResources(
            statusPageId,
            URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
              `/resources/${statusPageId.toString()}`,
            ),
            StatusPageModelAPI,
          );

        setCategoryCheckboxOptionsAndCategories(result);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    if (!props.allowSubscribersToChooseResources) {
      return;
    }

    fetchCheckboxOptionsAndCategories().catch((error: Error) => {
      setError(error.message);
    });
  }, [props.allowSubscribersToChooseResources]);

  if (!statusPageId) {
    throw new BadDataException("Status Page ID is required");
  }

  StatusPageUtil.checkIfUserHasLoggedIn();

  const fields: Array<ModelField<StatusPageSubscriber>> = [
    {
      field: {
        subscriberEmail: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      title: t("subscribe.email.yourEmail"),
      fieldType: FormFieldSchemaType.Email,
      required: (model: FormValues<StatusPageSubscriber>) => {
        return model && Boolean(model.subscriberEmail);
      },
      disabled: true,
      placeholder: t("subscribe.email.placeholder"),
      showIf: (model: FormValues<StatusPageSubscriber>) => {
        return model && Boolean(model.subscriberEmail);
      },
    },
    {
      field: {
        slackWorkspaceName: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      title: t("subscribe.slack.workspaceName"),
      fieldType: FormFieldSchemaType.Text,
      required: (model: FormValues<StatusPageSubscriber>) => {
        return model && Boolean(model.slackWorkspaceName);
      },
      disabled: true,
      placeholder: t("subscribe.slack.workspaceNamePlaceholder"),
      showIf: (model: FormValues<StatusPageSubscriber>) => {
        return model && Boolean(model.slackWorkspaceName);
      },
    },
    {
      field: {
        subscriberPhone: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      title: t("subscribe.sms.yourPhoneNumber"),
      // A phone number: read as an email address, it never validated, so an SMS subscriber could not save.
      fieldType: FormFieldSchemaType.Phone,
      required: (model: FormValues<StatusPageSubscriber>) => {
        return model && Boolean(model.subscriberPhone);
      },
      placeholder: t("subscribe.sms.placeholder"),
      disabled: true,
      showIf: (model: FormValues<StatusPageSubscriber>) => {
        return model && Boolean(model.subscriberPhone);
      },
    },
  ];

  if (props.allowSubscribersToChooseResources) {
    fields.push({
      field: {
        isSubscribedToAllResources: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      title: t("subscribe.resources.all"),
      description: t("subscribe.resources.allDescription"),
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      defaultValue: true,
    });

    fields.push({
      field: {
        statusPageResources: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      title: t("subscribe.resources.select"),
      description: t("subscribe.resources.selectDescription"),
      fieldType: FormFieldSchemaType.CategoryCheckbox,
      required: false,
      categoryCheckboxProps: categoryCheckboxOptionsAndCategories,
      showIf: (model: FormValues<StatusPageSubscriber>) => {
        return !model || !model.isSubscribedToAllResources;
      },
    });
  }

  if (props.allowSubscribersToChooseEventTypes) {
    fields.push({
      field: {
        isSubscribedToAllEventTypes: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      title: t("subscribe.eventTypes.all"),
      description: t("subscribe.eventTypes.allDescription"),
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      defaultValue: true,
    });

    fields.push({
      field: {
        statusPageEventTypes: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      title: t("subscribe.eventTypes.select"),
      description: t("subscribe.eventTypes.selectDescription"),
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      required: false,
      dropdownOptions: SubscriberUtil.getDropdownPropsBasedOnEventTypes(),
      showIf: (model: FormValues<StatusPageSubscriber>) => {
        return !model || !model.isSubscribedToAllEventTypes;
      },
    });
  }

  fields.push({
    field: {
      isUnsubscribed: true,
    },
    showEvenIfPermissionDoesNotExist: true,
    title: t("subscribe.update.unsubscribe"),
    description: t("subscribe.update.unsubscribeDescription"),
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
  });

  /*
   * Where to ask for a new link: the Subscribe page of a channel this page
   * offers, whose Manage Existing Subscription tab sends one.
   */
  const newLinkPage: PageMap | null = getManageLinkRequestPage({
    channels: {
      enableEmailSubscribers: props.enableEmailSubscribers,
      enableSMSSubscribers: props.enableSMSSubscribers,
      enableSlackSubscribers: props.enableSlackSubscribers,
      enableMicrosoftTeamsSubscribers: props.enableMicrosoftTeamsSubscribers,
    },
    isPreview: Boolean(StatusPageUtil.isPreviewPage()),
  });

  const renderLinkNotValid: () => ReactElement = (): ReactElement => {
    return (
      <Card title={t("subscribe.update.title")}>
        <div data-testid="update-subscription-link-not-valid">
          <p className="text-sm text-gray-700" role="status">
            {t("subscribe.update.linkNotValid")}
          </p>
          {newLinkPage ? (
            <div className="mt-6">
              {/*
               * As wide as the card, like the form's Update Subscription
               * button this card stands in for (maxPrimaryButtonWidth).
               */}
              <Button
                title={t("subscribe.update.getNewLink")}
                buttonStyle={ButtonStyleType.PRIMARY}
                style={{ marginInlineStart: "0px", width: "100%" }}
                dataTestId="update-subscription-get-new-link"
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[newLinkPage] as Route,
                    ),
                  );
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (linkState === LinkState.NotValid) {
      return renderLinkNotValid();
    }

    if (linkState === LinkState.Error) {
      return <ErrorMessage message={t("subscribe.update.loadFailed")} />;
    }

    if (linkState === LinkState.Checking || isLaoding) {
      return <FormSkeleton />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    return (
      <div className="justify-center">
        <div>
          {isSuccess && (
            <p className="text-center text-gray-400 mb-20 mt-20">
              {" "}
              {t("subscribe.update.saved")}{" "}
            </p>
          )}

          {!isSuccess ? (
            <div className="">
              <Card
                title={t("subscribe.update.title")}
                description={t("subscribe.update.description")}
              >
                <ModelForm<StatusPageSubscriber>
                  modelType={StatusPageSubscriber}
                  modelAPI={StatusPageModelAPI}
                  id="email-form"
                  name="Status Page > Update Subscription"
                  fields={fields}
                  createOrUpdateApiUrl={updateApiUrl}
                  requestHeaders={API.getDefaultHeaders()}
                  fetchItemApiUrl={getSubscriptionUrl}
                  formType={FormType.Update}
                  modelIdToEdit={new ObjectID(credential!.subscriberId)}
                  submitButtonText={t("subscribe.update.submit")}
                  onSuccess={() => {
                    setIsSuccess(true);
                  }}
                  maxPrimaryButtonWidth={true}
                />
              </Card>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  };

  return <Page>{renderBody()}</Page>;
};

export default SubscribePage;
