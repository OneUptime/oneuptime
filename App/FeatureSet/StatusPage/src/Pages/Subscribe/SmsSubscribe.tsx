import Page from "../../Components/Page/Page";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import StatusPageModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import SubscribeSideMenu from "./SideMenu";
import { SubscribePageProps } from "./SubscribePageUtils";
import Route from "Common/Types/API/Route";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
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
import LocalStorage from "Common/UI/Utils/LocalStorage";
import SubscriberUtil from "Common/UI/Utils/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";

const SubscribePage: FunctionComponent<SubscribePageProps> = (
  props: SubscribePageProps,
): ReactElement => {
  const { t } = useTranslation();
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  const id: ObjectID = LocalStorage.getItem("statusPageId") as ObjectID;

  const [
    categoryCheckboxOptionsAndCategories,
    setCategoryCheckboxOptionsAndCategories,
  ] = useState<CategoryCheckboxOptionsAndCategories>({
    categories: [],
    options: [],
  });
  /*
   * Start in the loading state when the effect below is actually going to
   * fetch. Starting at false rendered the whole form, then swapped it for a
   * loader, then rendered it again — a visible flash on a page the reader is
   * already looking at. It must stay false when the fetch is skipped, or the
   * loader would never clear.
   */
  const [isLaoding, setIsLoading] = useState<boolean>(
    Boolean(props.allowSubscribersToChooseResources),
  );
  const [error, setError] = useState<string | undefined>(undefined);

  const fetchCheckboxOptionsAndCategories: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        setIsLoading(true);

        const result: CategoryCheckboxOptionsAndCategories =
          await SubscriberUtil.getCategoryCheckboxPropsBasedOnResources(
            id,
            URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
              `/resources/${id.toString()}`,
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
      setIsLoading(false);
      return;
    }

    fetchCheckboxOptionsAndCategories().catch((error: Error) => {
      setError(error.message);
    });
  }, [props.allowSubscribersToChooseResources]);

  if (!id) {
    throw new BadDataException("Status Page ID is required");
  }

  StatusPageUtil.checkIfUserHasLoggedIn();

  const fields: Array<ModelField<StatusPageSubscriber>> = [
    {
      field: {
        subscriberPhone: true,
      },
      title: t("subscribe.sms.yourPhoneNumber"),
      fieldType: FormFieldSchemaType.Phone,
      required: true,
      placeholder: t("subscribe.sms.placeholder"),
      disableSpellCheck: true,
    },
  ];

  if (props.allowSubscribersToChooseResources) {
    fields.push({
      field: {
        isSubscribedToAllResources: true,
      },
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

  const getNewSubscriptionContentElement: GetReactElementFunction =
    (): ReactElement => {
      return (
        <ModelForm<StatusPageSubscriber>
          modelType={StatusPageSubscriber}
          modelAPI={StatusPageModelAPI}
          id="sms-form"
          name="Status Page > SMS Subscribe"
          fields={fields}
          createOrUpdateApiUrl={URL.fromString(
            STATUS_PAGE_API_URL.toString(),
          ).addRoute(`/subscribe/${id.toString()}`)}
          requestHeaders={API.getDefaultHeaders()}
          formType={FormType.Create}
          submitButtonText={t("subscribe.submit")}
          onBeforeCreate={async (item: StatusPageSubscriber) => {
            const id: ObjectID = LocalStorage.getItem(
              "statusPageId",
            ) as ObjectID;
            if (!id) {
              throw new BadDataException("Status Page ID is required");
            }

            item.statusPageId = id;
            return item;
          }}
          onSuccess={() => {
            setIsSuccess(true);
          }}
          maxPrimaryButtonWidth={true}
        />
      );
    };

  const getManageExistingSubscriptionContentElement: GetReactElementFunction =
    (): ReactElement => {
      return (
        <ModelForm<StatusPageSubscriber>
          modelType={StatusPageSubscriber}
          modelAPI={StatusPageModelAPI}
          id="sms-manage-form"
          name="Status Page > Manage SMS Subscription"
          fields={[
            {
              field: {
                subscriberPhone: true,
              },
              title: t("subscribe.sms.managePrompt"),
              description: t("subscribe.sms.manageDescription"),
              fieldType: FormFieldSchemaType.Phone,
              required: true,
              placeholder: t("subscribe.sms.placeholder"),
              disableSpellCheck: true,
            },
          ]}
          createOrUpdateApiUrl={URL.fromString(
            STATUS_PAGE_API_URL.toString(),
          ).addRoute(`/manage-subscription/${id.toString()}`)}
          requestHeaders={API.getDefaultHeaders()}
          formType={FormType.Create}
          submitButtonText={t("subscribe.sendManagementLink")}
          onBeforeCreate={async (item: StatusPageSubscriber) => {
            const id: ObjectID = LocalStorage.getItem(
              "statusPageId",
            ) as ObjectID;
            if (!id) {
              throw new BadDataException("Status Page ID is required");
            }

            item.statusPageId = id;
            return item;
          }}
          onSuccess={() => {
            setIsSuccess(true);
          }}
          maxPrimaryButtonWidth={true}
        />
      );
    };

  return (
    <Page
      title={t("subscribe.title")}
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
          title: t("subscribe.title"),
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_SMS] as Route)
              : (RouteMap[PageMap.SUBSCRIBE_SMS] as Route),
          ),
        },
      ]}
      sideMenu={
        <SubscribeSideMenu
          isPreviewStatusPage={Boolean(StatusPageUtil.isPreviewPage())}
          enableSMSSubscribers={props.enableSMSSubscribers}
          enableEmailSubscribers={props.enableEmailSubscribers}
          enableSlackSubscribers={props.enableSlackSubscribers}
          enableMicrosoftTeamsSubscribers={
            props.enableMicrosoftTeamsSubscribers
          }
          enableWebhookSubscribers={props.enableWebhookSubscribers}
        />
      }
    >
      {isLaoding ? <FormSkeleton /> : <></>}

      {error ? <ErrorMessage message={error} /> : <></>}

      {!isLaoding && !error ? (
        <div className="justify-center">
          <div>
            {isSuccess && (
              <p className="text-center text-gray-400 mb-20 mt-20">
                {" "}
                {t("subscribe.subscribedSuccessfully")}
              </p>
            )}

            {!isSuccess ? (
              <div className="">
                <Card
                  title={t("subscribe.sms.title")}
                  description={t("subscribe.sms.description")}
                >
                  <Tabs
                    tabs={[
                      {
                        name: t("subscribe.newSubscription"),
                        children: getNewSubscriptionContentElement(),
                      },
                      {
                        name: t("subscribe.manageExisting"),
                        children: getManageExistingSubscriptionContentElement(),
                      },
                    ]}
                    onTabChange={() => {}}
                  />
                </Card>
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
      ) : (
        <></>
      )}
    </Page>
  );
};

export default SubscribePage;
