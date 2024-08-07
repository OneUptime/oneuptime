import DashboardNavigation from "../../../Utils/Navigation";
import PageComponentProps from "../../PageComponentProps";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import { Green, Red } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/src/Components/Alerts/Alert";
import { CategoryCheckboxOptionsAndCategories } from "Common/UI/src/Components/CategoryCheckbox/Index";
import ErrorMessage from "Common/UI/src/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/src/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/src/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/src/Components/Forms/Types/FormValues";
import PageLoader from "Common/UI/src/Components/Loader/PageLoader";
import ModelTable from "Common/UI/src/Components/ModelTable/ModelTable";
import Pill from "Common/UI/src/Components/Pill/Pill";
import FieldType from "Common/UI/src/Components/Types/FieldType";
import API from "Common/UI/src/Utils/API/API";
import ModelAPI from "Common/UI/src/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/src/Utils/Navigation";
import SubscriberUtil from "Common/UI/src/Utils/StatusPage";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [
    allowSubscribersToChooseResources,
    setAllowSubscribersToChooseResources,
  ] = React.useState<boolean>(false);
  const [isSMSSubscribersEnabled, setIsSMSSubscribersEnabled] =
    React.useState<boolean>(false);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>("");
  const [
    categoryCheckboxOptionsAndCategories,
    setCategoryCheckboxOptionsAndCategories,
  ] = useState<CategoryCheckboxOptionsAndCategories>({
    categories: [],
    options: [],
  });

  const fetchCheckboxOptionsAndCategories: PromiseVoidFunction =
    async (): Promise<void> => {
      const result: CategoryCheckboxOptionsAndCategories =
        await SubscriberUtil.getCategoryCheckboxPropsBasedOnResources(modelId);

      setCategoryCheckboxOptionsAndCategories(result);
    };

  const fetchStatusPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const statusPage: StatusPage | null = await ModelAPI.getItem({
        modelType: StatusPage,
        id: modelId,
        select: {
          allowSubscribersToChooseResources: true,
          enableSmsSubscribers: true,
        },
      });

      if (statusPage && statusPage.allowSubscribersToChooseResources) {
        setAllowSubscribersToChooseResources(
          statusPage.allowSubscribersToChooseResources,
        );
        await fetchCheckboxOptionsAndCategories();
      }

      if (statusPage && statusPage.enableSmsSubscribers) {
        setIsSMSSubscribersEnabled(statusPage.enableSmsSubscribers);
      }

      setIsLoading(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchStatusPage().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const [formFields, setFormFields] = React.useState<
    Array<ModelField<StatusPageSubscriber>>
  >([]);

  useEffect(() => {
    if (isLoading) {
      return; // don't do anything if loading
    }

    const formFields: Array<ModelField<StatusPageSubscriber>> = [
      {
        field: {
          subscriberPhone: true,
        },
        title: "Phone Number",
        description: "Status page updates will be sent to this phone number.",
        fieldType: FormFieldSchemaType.Phone,
        required: true,
        placeholder: "+11234567890",
      },
      {
        field: {
          sendYouHaveSubscribedMessage: true,
        },
        title: "Send Subscription SMS",
        description:
          'Send "You have subscribed to this status page" SMS to this subscriber?',
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        doNotShowWhenEditing: true,
      },
      {
        field: {
          isUnsubscribed: true,
        },
        title: "Unsubscribe",
        description: "Unsubscribe this phone number from the status page.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        doNotShowWhenCreating: true,
      },
    ];

    if (allowSubscribersToChooseResources) {
      formFields.push({
        field: {
          isSubscribedToAllResources: true,
        },
        title: "Subscribe to All Resources",
        description: "Send notifications for all resources.",
        fieldType: FormFieldSchemaType.Checkbox,
        required: false,
        defaultValue: true,
      });

      formFields.push({
        field: {
          statusPageResources: true,
        },
        title: "Select Resources to Subscribe",
        description: "Please select the resources you want to subscribe to.",
        fieldType: FormFieldSchemaType.CategoryCheckbox,
        required: false,
        categoryCheckboxProps: categoryCheckboxOptionsAndCategories,
        showIf: (model: FormValues<StatusPageSubscriber>) => {
          return !model || !model.isSubscribedToAllResources;
        },
      });
    }

    setFormFields(formFields);
  }, [isLoading]);

  return (
    <Fragment>
      {isLoading ? <PageLoader isVisible={true} /> : <></>}

      {error ? <ErrorMessage error={error} /> : <></>}

      {!error && !isLoading ? (
        <>
          {!isSMSSubscribersEnabled && (
            <Alert
              type={AlertType.DANGER}
              title="SMS subscribers are not enabled for this status page. Please enable it in Subscriber Settings"
            />
          )}
          <ModelTable<StatusPageSubscriber>
            modelType={StatusPageSubscriber}
            id="table-subscriber"
            name="Status Page > SMS Subscribers"
            isDeleteable={true}
            showViewIdButton={true}
            isCreateable={true}
            isEditable={true}
            isViewable={false}
            selectMoreFields={{
              subscriberPhone: true,
            }}
            query={{
              statusPageId: modelId,
              projectId: DashboardNavigation.getProjectId()?.toString(),
              subscriberPhone: new NotNull(),
            }}
            onBeforeCreate={(
              item: StatusPageSubscriber,
            ): Promise<StatusPageSubscriber> => {
              if (!props.currentProject || !props.currentProject._id) {
                throw new BadDataException("Project ID cannot be null");
              }

              item.statusPageId = modelId;
              item.projectId = new ObjectID(props.currentProject._id);
              return Promise.resolve(item);
            }}
            cardProps={{
              title: "SMS Subscribers",
              description:
                "Here are the list of subscribers who have subscribed to the status page.",
            }}
            noItemsMessage={"No subscribers found."}
            formFields={formFields}
            showRefreshButton={true}
            viewPageRoute={Navigation.getCurrentRoute()}
            filters={[
              {
                field: {
                  subscriberPhone: true,
                },
                title: "Phone Number",
                type: FieldType.Phone,
              },
              {
                field: {
                  isUnsubscribed: true,
                },
                title: "Is Unsubscribed",
                type: FieldType.Boolean,
              },
              {
                field: {
                  createdAt: true,
                },
                title: "Subscribed At",
                type: FieldType.DateTime,
              },
            ]}
            columns={[
              {
                field: {
                  subscriberPhone: true,
                },
                title: "SMS",
                type: FieldType.Phone,
              },
              {
                field: {
                  isUnsubscribed: true,
                },
                title: "Status",
                type: FieldType.Text,
                getElement: (item: StatusPageSubscriber): ReactElement => {
                  if (item["isUnsubscribed"]) {
                    return <Pill color={Red} text={"Unsubscribed"} />;
                  }
                  return <Pill color={Green} text={"Subscribed"} />;
                },
              },
              {
                field: {
                  createdAt: true,
                },
                title: "Subscribed At",
                type: FieldType.Date,
              },
            ]}
          />
        </>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default StatusPageDelete;
