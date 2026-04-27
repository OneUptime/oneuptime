import Page from "../../Components/Page/Page";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import StatusPageUtil from "../../Utils/StatusPage";
import { SubscribePageProps } from "./SubscribePageUtils";
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
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import SubscriberUtil from "Common/UI/Utils/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

const SubscribePage: FunctionComponent<SubscribePageProps> = (
  props: SubscribePageProps,
): ReactElement => {
  const { t } = useTranslation();
  const statusPageSubscriberId: string | undefined =
    Navigation.getLastParamAsObjectID().toString();

  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  const statusPageId: ObjectID = LocalStorage.getItem(
    "statusPageId",
  ) as ObjectID;

  const updateApiUrl: URL = URL.fromString(
    URL.fromString(STATUS_PAGE_API_URL.toString())
      .addRoute(`/update-subscription/${statusPageId.toString()}`)
      .addRoute("/" + statusPageSubscriberId.toString())
      .toString(),
  );

  const getSubscriptionUrl: URL = URL.fromString(
    URL.fromString(STATUS_PAGE_API_URL.toString())
      .addRoute(`/get-subscription/${statusPageId.toString()}`)
      .addRoute("/" + statusPageSubscriberId.toString())
      .toString(),
  );

  const [
    categoryCheckboxOptionsAndCategories,
    setCategoryCheckboxOptionsAndCategories,
  ] = useState<CategoryCheckboxOptionsAndCategories>({
    categories: [],
    options: [],
  });

  const [isLaoding, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

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
          );

        setCategoryCheckboxOptionsAndCategories(result);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchCheckboxOptionsAndCategories().catch((error: Error) => {
      setError(error.message);
    });
  }, []);

  if (!statusPageId) {
    throw new BadDataException("Status Page ID is required");
  }

  if (!statusPageSubscriberId) {
    throw new BadDataException("Status Page Subscriber ID is required");
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
      fieldType: FormFieldSchemaType.Email,
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

  return (
    <Page>
      {isLaoding ? <PageLoader isVisible={isLaoding} /> : <></>}

      {error ? <ErrorMessage message={error} /> : <></>}

      {!isLaoding && !error ? (
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
                    id="email-form"
                    name="Status Page > Update Subscription"
                    fields={fields}
                    createOrUpdateApiUrl={updateApiUrl}
                    requestHeaders={API.getDefaultHeaders()}
                    fetchItemApiUrl={getSubscriptionUrl}
                    formType={FormType.Update}
                    modelIdToEdit={new ObjectID(statusPageSubscriberId)}
                    submitButtonText={t("subscribe.update.title")}
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
      ) : (
        <></>
      )}
    </Page>
  );
};

export default SubscribePage;
